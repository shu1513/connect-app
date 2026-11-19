/**
 * A host's photo: Connect's own copy of the profile picture of a social media account the host
 * has confirmed (plans/29). Hosts never upload one.
 *
 * One press is three steps, so that no database step is held open while a network or a checking
 * service is asked:
 *   1. start:  one short step under a lock for that host, and with the person's and the profile's
 *              locks. Everything that can say "no" before anyone is asked is read here, and the
 *              try is written down. Whatever removes a photo or changes an account holds the same
 *              two locks, so it either sees this try and stops it, or comes first.
 *   2. the outside work: the network is asked, the picture fetched, Connect's copy made, and the
 *              checking services asked in their order.
 *   3. finish: one short step with the person's and the profile's locks. The photo is written only
 *              if the try is still running and the account it was taken from is still the host's
 *              confirmed account, exactly as it was at the start.
 *
 * A photo is shown only after an outside service has looked at all of it and found nothing:
 * Connect's own checker is never asked here. `photoFor` is the only function that hands out a
 * photo's bytes. The steps other files share are in photo-steps.ts.
 */
import { createHash } from "node:crypto";
import { and, eq, exists, gt, inArray, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, schema } from "@/db";
import { askInOrder } from "@/lib/projects/checks/order";
import { recordAnswers, services, turnsFor } from "@/lib/projects/checks/services";
import type { Checker } from "@/lib/projects/checks/types";
import { makeCopy, type Copy } from "@/lib/projects/copy";
import { mayGoOnSql } from "@/lib/projects/child-safety";
import { adminUrl, tellFounders } from "@/lib/projects/picture-steps";
import { givePlace, takePlace } from "@/lib/projects/pictures";
import { PICTURE, ProjectError } from "@/lib/projects/rules";
import { recordAdminAction } from "@/lib/safety/audit";
import { readInstagramPhoto, type PhotoReader } from "./bio-check";
import { fetchPicture } from "./photo-fetch";
import { PHOTO, PICTURE_SERVERS, pictureAddress, serverFamily, type PhotoNetwork } from "./photo-rules";
import { deletePhotoInStep, stopTriesInStep } from "./photo-steps";
import { INSTAGRAM_CHECKS_PER_HOUR, INSTAGRAM_PHOTO, lockedProfile, ProfileError } from "./profiles";

const photos = schema.hostPhotos;
const tries = schema.hostPhotoTries;
const NOT_FOUND = "That photo is no longer there.";
/** The exact shape of an id: anything else never reaches the database, which would answer it with an error instead of "not found". */
const isId = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

/** How a press ended. The first eight are written to the try's line; the rest said "no" before a try was written. */
export type PhotoOutcome =
  | "shown"
  | "not_accepted"
  | "refused_before"
  | "no_picture"
  | "not_fetched"
  | "unusable"
  | "not_checked"
  | "stopped"
  /** The account cannot do this now: closed, paused, or without a host profile. */
  | "cannot"
  /** The host has a photo that was removed and reported. */
  | "locked"
  /** No confirmed account on that network. */
  | "no_account"
  /** Another try of this host is still under way. */
  | "running"
  | "limit"
  /** Everyone together has asked Instagram too often this hour. */
  | "busy"
  /** No checking service is set up, or the services owe their next answers to diary pictures. */
  | "no_checker"
  /** Another picture is being opened on this server right now. */
  | "place_taken"
  /** Something of our own broke (the database, most likely). Not the same as "stopped", where something was decided meanwhile. */
  | "failed";

/**
 * What a press works with. The Hosting page hands in nothing. The check script hands in stand-ins
 * for the network, the picture server, the services and the clock, and keeps the look at the
 * diary's pictures to the people it made (`diaryHosts`), as the queue's round does.
 */
export type PhotoOptions = {
  read?: PhotoReader;
  fetch?: (address: URL) => Promise<Buffer | null>;
  services?: Checker[];
  clock?: () => Date;
  diaryHosts?: string[];
  /**
   * For the check script, which changes things "meanwhile" here: after Meta was asked, after the copy was made, when
   * a service has refused the picture and before that is written down, and after the services' answers were written.
   */
  meanwhile?: (at: "asked" | "copied" | "refused" | "checked") => Promise<void>;
};

/** A service's refusal of this try's picture, once it is known. It is about the picture, so it is written down whatever else fails. */
type Known = { refusal?: { sha256: string; by: string; detail: string } };

/**
 * Writes a refusal to the try, with the fingerprint, also when the try was stopped meanwhile. With
 * the person's and the profile's locks, which the finish of every try holds too: so a refusal and
 * a finish for the same host happen one after the other. Whichever comes first, a copy a service
 * has refused is not the host's photo afterwards: the finish looks for the refusal before it
 * writes, and a refusal takes down a photo that is this very copy. Says whether it took one down.
 */
async function writeRefusal(userId: string, tryId: string, refusal: NonNullable<Known["refusal"]>, now: Date): Promise<boolean> {
  return db.transaction(async (tx) => {
    await lockedProfile(tx, userId);
    await tx.update(tries).set({ result: "not_accepted", sha256: refusal.sha256, checkedBy: refusal.by, detail: refusal.detail.slice(0, 300), endedAt: now }).where(eq(tries.id, tryId));
    const gone = await tx.delete(photos).where(and(eq(photos.userId, userId), eq(photos.sha256, refusal.sha256), isNull(photos.lockedAt))).returning({ id: photos.id });
    return gone.length > 0;
  });
}

type Started = { tryId: string; nameKey: string; accountId: string | null };

/** How a press ended; for a picture that cannot be used, why; and whether a refusal took down the host's photo because it was the same picture. */
export type PhotoResult = { outcome: PhotoOutcome; detail?: string; tookDown?: boolean };

/** "Use my Instagram photo" and "Update": the whole press. */
export async function takePhoto(input: { userId: string; network: PhotoNetwork }, options: PhotoOptions = {}): Promise<PhotoResult> {
  // TikTok's picture can only be had at a sign-in there: part two of plans/29.
  if (input.network !== "instagram") return { outcome: "no_account" };
  const clock = options.clock ?? (() => new Date());
  // A service without a key is not asked.
  const asked = (options.services ?? services()).filter((service) => service.keyMark);

  const started = await startTry(input.userId, input.network, asked.length > 0, clock, options.diaryHosts);
  if (typeof started === "string") return { outcome: started };
  const end = (result: Exclude<PhotoOutcome, "shown">, detail: string) => endTry(started.tryId, result, detail, clock());
  const known: Known = {};

  try {
    // 2. The outside work. Meta first: the account's number and where its picture is, from one answer.
    const answer = await (options.read ?? readInstagramPhoto)(started.nameKey).catch(() => ({ kind: "unavailable" as const }));
    await options.meanwhile?.("asked");
    if (answer.kind === "refused") {
      // Our own key or permission, never the host's account: the founder's page says so.
      await db.insert(schema.bioChecks).values({ userId: input.userId, network: INSTAGRAM_PHOTO, startedAt: clock(), result: "refused" }).catch(() => undefined);
    }
    if (answer.kind === "no_account" || answer.kind === "no_picture") return { outcome: await end("no_picture", answer.kind) };
    if (answer.kind !== "picture") return { outcome: await end("not_fetched", `instagram: ${answer.kind}`) };
    // The entry was proven by signing in: the name must still lead to that very account.
    if (started.accountId && answer.accountId !== started.accountId) return { outcome: await end("no_picture", "the name now leads to another account") };
    const address = pictureAddress(answer.address, PICTURE_SERVERS[input.network]);
    if (!address) {
      console.error(`[host-photo] ${input.network} named a picture server that is not allowed: ${serverFamily(answer.address)}`);
      return { outcome: await end("not_fetched", "a picture server that is not allowed") };
    }
    return await copyCheckAndFinish({ userId: input.userId, network: input.network, tryId: started.tryId, source: { nameKey: started.nameKey, accountId: answer.accountId }, address }, asked, clock, options, known);
  } catch (error) {
    console.error("[host-photo] a try failed", error instanceof Error ? error.name : "error");
    // A refusal that was already known is what is written now, not a plain "stopped": the same picture must not get
    // a second chance because something of ours broke.
    if (known.refusal) {
      const tookDown = await writeRefusal(input.userId, started.tryId, known.refusal, clock()).catch(() => false);
      return { outcome: "not_accepted", tookDown };
    }
    // The try is ended if it still can be. If even that fails, it counts as stopped at the host's next press, two
    // minutes or more after its start (startTry).
    await end("stopped", "the try failed").catch(() => undefined);
    return { outcome: "failed" };
  }
}

// ---------------------------------------------------------------------------
// 1. The start
// ---------------------------------------------------------------------------

async function startTry(userId: string, network: PhotoNetwork, hasChecker: boolean, clock: () => Date, diaryHosts: string[] | undefined): Promise<Started | Exclude<PhotoOutcome, "shown">> {
  return db.transaction(async (tx) => {
    // This host's presses one after the other.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`host-photo:${userId}`}))`);
    // Then the person and the profile, in the app's order. Removing a photo, changing an account and closing an
    // account hold these too while they stop the tries that are running: so each of them either sees this try,
    // or has finished before this try is written.
    const { closed, paused, profile } = await lockedProfile(tx, userId);
    // Last, the lock that guards everyone's requests to Instagram (the bio check takes it too), so that it is held
    // only for the few reads below and never while waiting for a host's own locks. Nothing that holds it ever
    // waits for a person or a profile, so the order cannot turn round.
    if (network === "instagram") await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"bio-check:instagram:global"}))`);
    // Read with the locks held, never before waiting for them.
    const now = clock();
    if (closed || paused || !profile) return "cannot";
    const [locked] = await tx.select({ id: photos.id }).from(photos).where(and(eq(photos.userId, userId), isNotNull(photos.lockedAt))).limit(1);
    if (locked) return "locked";
    const [entry] = await tx
      .select({ nameKey: schema.socialAccounts.nameKey, providerAccountId: schema.socialAccounts.providerAccountId })
      .from(schema.socialAccounts)
      .where(and(eq(schema.socialAccounts.userId, userId), eq(schema.socialAccounts.network, network), isNotNull(schema.socialAccounts.confirmedAt)));
    if (!entry) return "no_account";

    // One at a time. A try that never ended (the server stopped under it) counts as stopped after two minutes.
    const open = await tx.select({ id: tries.id, startedAt: tries.startedAt }).from(tries).where(and(eq(tries.userId, userId), isNull(tries.result)));
    if (open.some((one) => now.getTime() - one.startedAt.getTime() < PHOTO.runningMs)) return "running";
    if (open.length > 0) await stopTriesInStep(tx, userId, now, "it never ended");
    // A try counts from the moment it starts, however it ends.
    const [{ today }] = await tx
      .select({ today: sql<number>`count(*)::int` })
      .from(tries)
      .where(and(eq(tries.userId, userId), gt(tries.startedAt, new Date(now.getTime() - 24 * 3_600_000))));
    if (today >= PHOTO.triesPerDay) return "limit";
    if (network === "instagram") {
      // Everyone's requests to Instagram in the last hour, bio checks and photos together, against the bio check's own limit.
      const hourAgo = new Date(now.getTime() - 3_600_000);
      const [bios] = await tx.select({ n: sql<number>`count(*)::int` }).from(schema.bioChecks).where(and(eq(schema.bioChecks.network, "instagram"), gt(schema.bioChecks.startedAt, hourAgo)));
      const [taken] = await tx.select({ n: sql<number>`count(*)::int` }).from(tries).where(and(eq(tries.network, "instagram"), gt(tries.startedAt, hourAgo)));
      if (bios.n + taken.n >= INSTAGRAM_CHECKS_PER_HOUR) return "busy";
    }
    if (!hasChecker) return "no_checker";
    if (await diaryIsOwed(tx, diaryHosts)) return "no_checker";

    const [attempt] = await tx.insert(tries).values({ userId, network, startedAt: now, entryNameKey: entry.nameKey, entryAccountId: entry.providerAccountId }).returning({ id: tries.id });
    return { tryId: attempt.id, nameKey: entry.nameKey, accountId: entry.providerAccountId };
  });
}

/**
 * Diary pictures that are shown after a check for nudity only get a service's next answers when it
 * answers again (plans/23). A photo does not go ahead of them: it is not started while one is owed
 * its full check, and it is sent to no service once one has come to be owed it. Only pictures the
 * queue would really send: one the founder or a report holds back is owed nothing by the services.
 */
function owedDiaryPicture(diaryHosts: string[] | undefined): SQL | undefined {
  const pictures = schema.projectPictures;
  return and(eq(pictures.state, "shown"), eq(pictures.level, "nudity_only"), mayGoOnSql, diaryHosts ? inArray(pictures.hostId, diaryHosts) : undefined);
}
async function diaryIsOwed(reader: Pick<typeof db, "select">, diaryHosts: string[] | undefined): Promise<boolean> {
  const [owed] = await reader.select({ id: schema.projectPictures.id }).from(schema.projectPictures).where(owedDiaryPicture(diaryHosts)).limit(1);
  return Boolean(owed);
}

/** Writes how a try ended, if nothing has ended it yet. If something has (it was stopped meanwhile), nothing is written and "stopped" is what the host is told. */
async function endTry(tryId: string, result: Exclude<PhotoOutcome, "shown">, detail: string, now: Date, more: { sha256?: string; checkedBy?: string } = {}): Promise<PhotoOutcome> {
  const written = await db
    .update(tries)
    .set({ result, detail: detail.slice(0, 300), endedAt: now, ...more })
    .where(and(eq(tries.id, tryId), isNull(tries.result)))
    .returning({ id: tries.id });
  return written.length > 0 ? result : "stopped";
}

// ---------------------------------------------------------------------------
// 2. and 3. From the picture's address to the photo
// ---------------------------------------------------------------------------

type Candidate = { userId: string; network: PhotoNetwork; tryId: string; source: { nameKey: string; accountId: string }; address: URL };

async function copyCheckAndFinish(candidate: Candidate, asked: Checker[], clock: () => Date, options: PhotoOptions, known: Known): Promise<PhotoResult> {
  const end = (result: Exclude<PhotoOutcome, "shown">, detail: string, more?: { sha256?: string; checkedBy?: string }) => endTry(candidate.tryId, result, detail, clock(), more);

  // One picture is opened at a time on this server, a diary upload or a photo: a large one needs a lot of memory
  // while it is open. The place is given back before any checking service is asked.
  if (!takePlace()) {
    const ended = await end("not_fetched", "another picture was being opened");
    return { outcome: ended === "stopped" ? "stopped" : "place_taken" };
  }
  // Nothing but the fetching and the copying happens while the place is held: what is written down about it comes after.
  let made: { copy: Copy } | { unusable: string } | null;
  try {
    const original = await (options.fetch ?? fetchPicture)(candidate.address);
    made = original ? await makeCopy(original).then(
      (copy) => ({ copy }),
      (error: unknown) => {
        if (!(error instanceof ProjectError)) throw error;
        return { unusable: error.message };
      },
    ) : null;
  } finally {
    givePlace();
  }
  if (!made) return { outcome: await end("not_fetched", "the picture could not be fetched") };
  if ("unusable" in made) return { outcome: await end("unusable", made.unusable), detail: made.unusable };
  const { copy } = made;
  await options.meanwhile?.("copied");
  const sha256 = createHash("sha256").update(copy.bytes).digest("hex");

  // The same copy as one that was refused before, as a photo or in her diary, or that is locked there: a new try is
  // not a second chance at a clean answer. No service is asked.
  const before = await refusedBefore(db, candidate.userId, sha256);
  if (before) {
    const outcome = await end("refused_before", before === "locked" ? "the same picture as a locked diary picture" : "the same picture as one that was refused before", { sha256 });
    if (before === "locked" && outcome === "refused_before") {
      // The try has its result. An email that cannot be written does not change what the host is told.
      await db
        .transaction((tx) =>
          tellFounders(tx, {
            subject: "A locked picture was tried as a host's photo",
            text: `A host pressed "Use my photo", and the profile picture that came back is the same, byte for byte, as a diary picture of theirs that you removed and reported. It was not taken.\n\n${adminUrl()}`,
            key: `host-photo-locked-before:${candidate.tryId}`,
          }),
        )
        .catch(() => console.error("[host-photo] the founder could not be told about a locked picture tried as a photo"));
    }
    return { outcome };
  }

  // The services, in their order. Connect's own checker is not asked: only a full check shows a photo. Right before
  // each request, one read asks three things at once: is the try still running, is no diary picture owed its full
  // check, and has no service refused this very copy in the meantime (an earlier try of the host's, stopped while a
  // service was still looking)? If not, the picture is sent to nobody (else). A request that is already on its way
  // cannot be called back.
  const earlier = alias(tries, "earlier");
  const mayStillAsk = async () => {
    const [row] = await db
      .select({
        result: tries.result,
        owed: sql<boolean>`${exists(db.select({ one: sql`1` }).from(schema.projectPictures).where(owedDiaryPicture(options.diaryHosts)))}`,
        refused: sql<boolean>`${exists(db.select({ one: sql`1` }).from(earlier).where(and(eq(earlier.userId, candidate.userId), eq(earlier.sha256, sha256), eq(earlier.result, "not_accepted"))))}`,
      })
      .from(tries)
      .where(eq(tries.id, candidate.tryId));
    return Boolean(row) && row.result === null && !row.owed && !row.refused;
  };
  const { outcome: answer, asked: answers } = await askInOrder(await turnsFor(asked, copy.bytes, clock), null, mayStillAsk);

  // A refusal is written first, before anything else can fail: it is about the picture, so it is written with the
  // fingerprint also when the try was stopped meanwhile.
  let tookDown = false;
  if (answer.kind === "refused") {
    known.refusal = { sha256, by: answer.by, detail: answer.detail };
    await options.meanwhile?.("refused");
    tookDown = await writeRefusal(candidate.userId, candidate.tryId, known.refusal, clock());
  }
  // What each answer means for the service itself is written whatever becomes of the try. If that cannot be written,
  // the photo's own outcome stands.
  await recordAnswers(asked, answers, clock()).catch(() => console.error("[host-photo] what the checking services answered could not be written down"));
  await options.meanwhile?.("checked");

  if (answer.kind === "refused") return { outcome: "not_accepted", tookDown };
  if (answer.kind !== "shown" || answer.level !== "full") return { outcome: await end("not_checked", answer.detail, { sha256 }) };
  return { outcome: await finish(candidate, copy, sha256, { by: answer.by, detail: answer.detail }, clock) };
}

/** Whether this host's copy with this fingerprint was refused before, as a photo or as a diary picture, or is locked in her diary. */
async function refusedBefore(reader: Pick<typeof db, "select">, userId: string, sha256: string): Promise<"refused" | "locked" | null> {
  const pictures = schema.projectPictures;
  const inDiary = await reader
    .select({ state: pictures.state })
    .from(pictures)
    .where(and(eq(pictures.hostId, userId), eq(pictures.sha256, sha256), or(eq(pictures.state, "locked"), eq(pictures.refusedByChecker, true))));
  if (inDiary.some((picture) => picture.state === "locked")) return "locked";
  if (inDiary.length > 0) return "refused";
  const [asPhoto] = await reader.select({ id: tries.id }).from(tries).where(and(eq(tries.userId, userId), eq(tries.sha256, sha256), eq(tries.result, "not_accepted"))).limit(1);
  return asPhoto ? "refused" : null;
}

/**
 * 3. The finish. With the person's and the profile's locks, in the app's order, and then the try's
 * own line. The photo is written only if nothing has stopped the try, the account may still do
 * this, the confirmed entry on that network has the name and the number it had at the start, and
 * no service has refused this very copy in the meantime (see writeRefusal).
 */
async function finish(candidate: Candidate, copy: Copy, sha256: string, passed: { by: string; detail: string }, clock: () => Date): Promise<PhotoOutcome> {
  return db.transaction(async (tx) => {
    const { closed, paused, profile } = await lockedProfile(tx, candidate.userId);
    const [attempt] = await tx.select().from(tries).where(eq(tries.id, candidate.tryId)).for("update");
    // The clock is read only now: waiting for the locks may have taken a while.
    const now = clock();
    if (!attempt || attempt.result !== null) return "stopped";
    const stop = async (why: string): Promise<PhotoOutcome> => {
      await tx.update(tries).set({ result: "stopped", detail: why, sha256, endedAt: now }).where(eq(tries.id, attempt.id));
      return "stopped";
    };
    if (closed || paused || !profile) return stop("the account could no longer do this");
    const [locked] = await tx.select({ id: photos.id }).from(photos).where(and(eq(photos.userId, candidate.userId), isNotNull(photos.lockedAt))).limit(1);
    if (locked) return stop("a photo was removed and reported meanwhile");
    const [entry] = await tx
      .select({ nameKey: schema.socialAccounts.nameKey, providerAccountId: schema.socialAccounts.providerAccountId })
      .from(schema.socialAccounts)
      .where(and(eq(schema.socialAccounts.userId, candidate.userId), eq(schema.socialAccounts.network, candidate.network), isNotNull(schema.socialAccounts.confirmedAt)));
    if (!entry || entry.nameKey !== attempt.entryNameKey || entry.providerAccountId !== attempt.entryAccountId) return stop("the account changed meanwhile");
    // Looked for once more, with the locks a refusal's own write takes: an earlier try of this host's, stopped while a
    // service was still looking at the same copy, may have brought its refusal since this try began.
    if (await refusedBefore(tx, candidate.userId, sha256)) {
      await tx.update(tries).set({ result: "refused_before", detail: "the same picture was refused while this try was under way", sha256, endedAt: now }).where(eq(tries.id, attempt.id));
      return "refused_before";
    }

    // The old photo goes and the new one comes in one step. A new photo has a new address.
    await deletePhotoInStep(tx, candidate.userId);
    await tx.insert(photos).values({
      userId: candidate.userId,
      network: candidate.network,
      sourceNameKey: candidate.source.nameKey,
      sourceAccountId: candidate.source.accountId,
      width: copy.width,
      height: copy.height,
      byteLength: copy.bytes.length,
      sha256,
      bytes: copy.bytes,
      takenAt: now,
      checkedBy: passed.by,
      rulesVersion: PICTURE.rulesVersion,
      checkDetail: passed.detail.slice(0, 300),
    });
    await tx.update(tries).set({ result: "shown", sha256, checkedBy: passed.by, endedAt: now }).where(eq(tries.id, attempt.id));
    return "shown";
  });
}

// ---------------------------------------------------------------------------
// Removing
// ---------------------------------------------------------------------------

/** The host removes their photo. A try that is under way writes nothing afterwards. Says whether there was a photo. */
export async function removePhoto(input: { userId: string; now: Date }): Promise<boolean> {
  return db.transaction(async (tx) => {
    await lockedProfile(tx, input.userId);
    await stopTriesInStep(tx, input.userId, input.now, "the host removed the photo");
    return deletePhotoInStep(tx, input.userId);
  });
}

/** The photo the founder is looking at, with its host's locks taken first, for one decision. */
async function decide(photoId: string, work: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0], photo: { id: string; userId: string; lockedAt: Date | null; network: string; sourceNameKey: string; sourceAccountId: string; takenAt: Date }) => Promise<void>): Promise<void> {
  if (!isId(photoId)) throw new ProfileError(NOT_FOUND);
  await db.transaction(async (tx) => {
    const [found] = await tx.select({ userId: photos.userId }).from(photos).where(eq(photos.id, photoId));
    if (!found) throw new ProfileError(NOT_FOUND);
    await lockedProfile(tx, found.userId);
    const [photo] = await tx
      .select({ id: photos.id, userId: photos.userId, lockedAt: photos.lockedAt, network: photos.network, sourceNameKey: photos.sourceNameKey, sourceAccountId: photos.sourceAccountId, takenAt: photos.takenAt })
      .from(photos)
      .where(eq(photos.id, photoId))
      .for("update");
    if (!photo) throw new ProfileError(NOT_FOUND);
    await work(tx, photo);
  });
}

/** The founder removes the photo they are looking at. Not a locked one, and not one that has been replaced since. */
export async function removePhotoAsFounder(input: { adminId: string; photoId: string; now: Date }): Promise<void> {
  await decide(input.photoId, async (tx, photo) => {
    if (photo.lockedAt) throw new ProfileError("That photo is already removed and reported.");
    await stopTriesInStep(tx, photo.userId, input.now, "the founder removed the photo");
    await tx.delete(photos).where(eq(photos.id, photo.id));
    await recordAdminAction({ adminId: input.adminId, action: "host photo removed", targetUserId: photo.userId, targetId: photo.id }, tx);
  });
}

/**
 * "Remove and report" (plans/23, "What the law asks"): the photo is locked. Nobody is handed it
 * again, it is kept exactly as it is, and nothing deletes it afterwards. While a host has a locked
 * photo they can take no other. What belonged to it at this moment is kept with it, as a locked
 * diary picture keeps its post: the host's profile and confirmed accounts, which the host can
 * change afterwards.
 */
export async function lockPhotoAsFounder(input: { adminId: string; photoId: string; now: Date }): Promise<void> {
  await decide(input.photoId, async (tx, photo) => {
    if (photo.lockedAt) throw new ProfileError("That photo is already removed and reported.");
    await stopTriesInStep(tx, photo.userId, input.now, "the founder removed and reported the photo");
    const [person] = await tx.select({ name: schema.user.name, email: schema.user.email }).from(schema.user).where(eq(schema.user.id, photo.userId));
    const [profile] = await tx.select().from(schema.hostProfiles).where(eq(schema.hostProfiles.userId, photo.userId));
    const accounts = await tx
      .select({ network: schema.socialAccounts.network, nameKey: schema.socialAccounts.nameKey, url: schema.socialAccounts.url, providerAccountId: schema.socialAccounts.providerAccountId, confirmedAt: schema.socialAccounts.confirmedAt })
      .from(schema.socialAccounts)
      .where(and(eq(schema.socialAccounts.userId, photo.userId), isNotNull(schema.socialAccounts.confirmedAt)));
    const context = JSON.stringify({
      account: person ?? null,
      profile: profile ? { handle: profile.handle, displayName: profile.displayName, about: profile.about, status: profile.status, hidden: profile.hidden } : null,
      confirmedAccounts: accounts,
      photo: { network: photo.network, name: photo.sourceNameKey, number: photo.sourceAccountId, takenAt: photo.takenAt },
    });
    await tx.update(photos).set({ lockedAt: input.now, lockedBy: input.adminId, lockedContext: context }).where(eq(photos.id, photo.id));
    await recordAdminAction({ adminId: input.adminId, action: "host photo removed and reported", targetUserId: photo.userId, targetId: photo.id }, tx);
  });
}

/** "I have made the report": the day and time the founder says the report to the authorities was really made. */
export async function recordPhotoReportMade(input: { adminId: string; photoId: string; madeAt: Date; now: Date }): Promise<void> {
  if (Number.isNaN(input.madeAt.getTime())) throw new ProfileError("Please give the day and time the report was made.");
  if (input.madeAt > input.now) throw new ProfileError("That time has not come yet. Please give the time the report was really made.");
  await decide(input.photoId, async (tx, photo) => {
    if (!photo.lockedAt) throw new ProfileError("Only a photo that was removed and reported has a report.");
    await tx.update(photos).set({ reportMadeAt: input.madeAt }).where(eq(photos.id, photo.id));
    await recordAdminAction({ adminId: input.adminId, action: "report of a host photo recorded", targetUserId: photo.userId, targetId: photo.id, detail: `made ${input.madeAt.toISOString()}` }, tx);
  });
}

// ---------------------------------------------------------------------------
// Handing a photo out
// ---------------------------------------------------------------------------

export type Viewer = { id: string; admin: boolean } | null;

/**
 * A photo's bytes for this viewer, or null. The whole rule (plans/29, "Who sees it"):
 *
 *   the host's page                                    visitor   the host   the founder
 *   open to everyone (approved, not hidden, not closed)  yes       yes        yes
 *   hidden, waiting, declined or suspended               no        yes        yes
 *   a locked photo, whatever the page                    no        no         no
 *
 * `open` says whether the answer went to someone who could see the photo without being logged
 * in; only such an answer may be kept by a browser. A photo that was replaced or removed has no
 * line any more, so its old address gives nothing.
 */
export async function photoFor(viewer: Viewer, photoId: string): Promise<{ bytes: Buffer; open: boolean } | null> {
  if (!isId(photoId)) return null;
  // One read: the bytes come with the very facts the decision is made from, so the answer is never about a page as
  // it was a moment earlier.
  const [row] = await db
    .select({ userId: photos.userId, bytes: photos.bytes, status: schema.hostProfiles.status, hidden: schema.hostProfiles.hidden, closedAt: schema.user.closedAt })
    .from(photos)
    .innerJoin(schema.user, eq(schema.user.id, photos.userId))
    .leftJoin(schema.hostProfiles, eq(schema.hostProfiles.userId, photos.userId))
    .where(and(eq(photos.id, photoId), isNull(photos.lockedAt)));
  if (!row) return null;
  const open = row.status === "approved" && row.hidden === false && !row.closedAt;
  if (!open && viewer?.id !== row.userId && !viewer?.admin) return null;
  return { bytes: row.bytes, open };
}

/** The ids of these hosts' photos, for a page that has already decided that each host's page is open to this viewer. Never the bytes. */
export async function photosOf(hostIds: string[]): Promise<Map<string, string>> {
  const byHost = new Map<string, string>();
  if (hostIds.length === 0) return byHost;
  const rows = await db.select({ id: photos.id, userId: photos.userId }).from(photos).where(and(inArray(photos.userId, hostIds), isNull(photos.lockedAt)));
  for (const row of rows) byHost.set(row.userId, row.id);
  return byHost;
}

/**
 * What has become of these photos, for the founder's page of reports: "current" (still that host's
 * photo) or "locked" (removed and reported, and kept). One that is in neither was removed or
 * replaced, and is gone.
 */
export async function photoStates(photoIds: string[]): Promise<Map<string, "current" | "locked">> {
  const states = new Map<string, "current" | "locked">();
  const ids = photoIds.filter(isId);
  if (ids.length === 0) return states;
  const rows = await db.select({ id: photos.id, lockedAt: photos.lockedAt }).from(photos).where(inArray(photos.id, ids));
  for (const row of rows) states.set(row.id, row.lockedAt ? "locked" : "current");
  return states;
}

export type OwnPhoto = { id: string; network: string; sourceNameKey: string; takenAt: Date };

/** What the Hosting page shows its host: their photo if they have one, and whether one of theirs was removed and reported. */
export async function ownPhotoState(userId: string): Promise<{ photo: OwnPhoto | null; locked: boolean }> {
  const rows = await db.select({ id: photos.id, network: photos.network, sourceNameKey: photos.sourceNameKey, takenAt: photos.takenAt, lockedAt: photos.lockedAt }).from(photos).where(eq(photos.userId, userId));
  const current = rows.find((row) => !row.lockedAt);
  return { photo: current ? { id: current.id, network: current.network, sourceNameKey: current.sourceNameKey, takenAt: current.takenAt } : null, locked: rows.some((row) => row.lockedAt) };
}

export type AdminPhoto = { id: string; userId: string; network: string; sourceNameKey: string; takenAt: Date; lockedAt: Date | null; reportMadeAt: Date | null };

/** Every photo of these hosts, the locked ones too, for the founder's page. Never the bytes. */
export async function photosForAdmin(userIds: string[]): Promise<AdminPhoto[]> {
  if (userIds.length === 0) return [];
  return db
    .select({ id: photos.id, userId: photos.userId, network: photos.network, sourceNameKey: photos.sourceNameKey, takenAt: photos.takenAt, lockedAt: photos.lockedAt, reportMadeAt: photos.reportMadeAt })
    .from(photos)
    .where(inArray(photos.userId, userIds))
    .orderBy(photos.takenAt);
}
