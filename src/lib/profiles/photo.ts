/**
 * A host's photo: Connect's own copy of the profile picture of a social media account the host
 * has confirmed (plans/29), or of a picture the host uploaded (plans/35).
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
 * For TikTok the three steps are the same, only spread over a sign-in (plans/33): Connect keeps no
 * key from TikTok, so the picture can only be had when the host signs in there. The start is the
 * press (startPhotoTry), then the host is away at TikTok, and what comes back is taken up by one
 * return (takeUpTry) and goes through the outside work and the finish (finishTikTokTry).
 *
 * An upload is the same three steps again (uploadPhoto): the start asks for no confirmed account,
 * "the picture is fetched" means the file is read out of the request, and the finish compares no
 * account. The copy that is kept is a square cut from the middle.
 *
 * A photo is shown only after an outside service has looked at all of it and found nothing:
 * Connect's own checker is never asked here. `photoFor` is the only function that hands out a
 * photo's bytes. The steps other files share are in photo-steps.ts.
 */
import { createHash } from "node:crypto";
import { and, eq, exists, gt, inArray, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, schema } from "@/db";
import { hasAskedHost, haveAskedHost } from "@/lib/people/contacts";
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
import { PHOTO, PICTURE_SERVERS, pictureAddress, serverFamily, type PhotoNetwork, type PhotoSource } from "./photo-rules";
import { deletePhotoInStep, stopTriesInStep } from "./photo-steps";
import { INSTAGRAM_CHECKS_PER_HOUR, INSTAGRAM_PHOTO, lockedProfile, ProfileError } from "./profiles";
import { readSocialName } from "./social";

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
  | "failed"
  /** TikTok only: the account the host signed in with is not the one confirmed on their page. */
  | "other_account"
  /** TikTok only: the account the host signed in with is confirmed for another host. */
  | "taken_account"
  /** TikTok only: this return was already taken up (the same address opened twice), or its try has ended since. */
  | "already_returned";

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

/** A try that was written down. `entry` is the confirmed account it started from; an upload starts from none. */
type Started = { tryId: string; entry: { nameKey: string; accountId: string | null } | null };

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
  // A try on a network always starts from a confirmed entry (startTry).
  const entry = started.entry;
  if (!entry) return { outcome: await end("stopped", "a try on a network without an entry") };

  try {
    // 2. The outside work. Meta first: the account's number and where its picture is, from one answer.
    const answer = await (options.read ?? readInstagramPhoto)(entry.nameKey).catch(() => ({ kind: "unavailable" as const }));
    await options.meanwhile?.("asked");
    if (answer.kind === "refused") {
      // Our own key or permission, never the host's account: the founder's page says so.
      await db.insert(schema.bioChecks).values({ userId: input.userId, network: INSTAGRAM_PHOTO, startedAt: clock(), result: "refused" }).catch(() => undefined);
    }
    if (answer.kind === "no_account" || answer.kind === "no_picture") return { outcome: await end("no_picture", answer.kind) };
    if (answer.kind !== "picture") return { outcome: await end("not_fetched", `instagram: ${answer.kind}`) };
    // The entry was proven by signing in: the name must still lead to that very account.
    if (entry.accountId && answer.accountId !== entry.accountId) return { outcome: await end("no_picture", "the name now leads to another account") };
    const address = pictureAddress(answer.address, PICTURE_SERVERS[input.network]);
    if (!address) {
      console.error(`[host-photo] ${input.network} named a picture server that is not allowed: ${serverFamily(answer.address)}`);
      return { outcome: await end("not_fetched", "a picture server that is not allowed") };
    }
    const original = () => (options.fetch ?? fetchPicture)(address);
    return await copyCheckAndFinish({ userId: input.userId, network: input.network, tryId: started.tryId, source: { nameKey: entry.nameKey, accountId: answer.accountId }, original }, asked, clock, options, known);
  } catch (error) {
    return afterFailure(error, input.userId, started.tryId, known, clock);
  }
}

/**
 * "Upload a photo" (plans/35): the whole press. `read` hands over the file as it arrived; it is
 * called only after the start has said yes, and while this server's one place for pictures is
 * held, so a request that is refused is never read. It may throw a ProjectError with words for
 * the person (too large, not one file), which ends the try as "unusable".
 */
export async function uploadPhoto(input: { userId: string; read: () => Promise<Buffer> }, options: Omit<PhotoOptions, "read" | "fetch"> = {}): Promise<PhotoResult> {
  const clock = options.clock ?? (() => new Date());
  const asked = (options.services ?? services()).filter((service) => service.keyMark);
  const started = await startTry(input.userId, "upload", asked.length > 0, clock, options.diaryHosts);
  if (typeof started === "string") return { outcome: started };
  const known: Known = {};
  try {
    return await copyCheckAndFinish({ userId: input.userId, network: "upload", tryId: started.tryId, source: null, original: input.read }, asked, clock, options, known);
  } catch (error) {
    return afterFailure(error, input.userId, started.tryId, known, clock);
  }
}

/** What a press comes to when something of our own broke in the outside work. */
async function afterFailure(error: unknown, userId: string, tryId: string, known: Known, clock: () => Date): Promise<PhotoResult> {
  console.error("[host-photo] a try failed", error instanceof Error ? error.name : "error");
  // A refusal that was already known is what is written now, not a plain "stopped": the same picture must not get
  // a second chance because something of ours broke.
  if (known.refusal) {
    const tookDown = await writeRefusal(userId, tryId, known.refusal, clock()).catch(() => false);
    return { outcome: "not_accepted", tookDown };
  }
  // The try is ended if it still can be. If even that fails, it counts as stopped at the host's next press, two
  // minutes or more after its start (startTry).
  await endTry(tryId, "stopped", "the try failed", clock()).catch(() => undefined);
  return { outcome: "failed" };
}

// ---------------------------------------------------------------------------
// TikTok: the same try, spread over a sign-in (plans/33)
// ---------------------------------------------------------------------------

/**
 * "Use my TikTok photo", the press: the same start as Instagram's, with the same locks and the
 * same refusals, before the host is sent to TikTok. The try is written down here, so that whatever
 * removes the photo or changes the account while the host is away stops it.
 */
export async function startPhotoTry(input: { userId: string; network: "tiktok" }, options: Pick<PhotoOptions, "services" | "clock" | "diaryHosts"> = {}): Promise<{ tryId: string } | Exclude<PhotoOutcome, "shown">> {
  const hasChecker = (options.services ?? services()).some((service) => service.keyMark);
  const started = await startTry(input.userId, input.network, hasChecker, options.clock ?? (() => new Date()), options.diaryHosts);
  return typeof started === "string" ? started : { tryId: started.tryId };
}

/**
 * The host's return from TikTok takes the try up, with one guarded change: this try, this host, a
 * TikTok try, still running, and not taken up before. Only the return that gets "true" may go on
 * with the try or end it. A second request for the same return gets "false", and does nothing.
 */
export async function takeUpTry(input: { userId: string; tryId: string }, now: Date): Promise<boolean> {
  if (!isId(input.tryId)) return false;
  const taken = await db
    .update(tries)
    .set({ returnedAt: now })
    .where(and(eq(tries.id, input.tryId), eq(tries.userId, input.userId), eq(tries.network, "tiktok"), isNull(tries.result), isNull(tries.returnedAt)))
    .returning({ id: tries.id });
  return taken.length > 0;
}

/**
 * Ends a try that was written at the press but whose host could not be sent to TikTok after all
 * (the note could not be put in their browser). Only a try nobody has taken up yet.
 */
export async function abandonTry(input: { userId: string; tryId: string }, now: Date): Promise<void> {
  if (!isId(input.tryId)) return;
  await db
    .update(tries)
    .set({ result: "stopped", detail: "the host could not be sent to TikTok", endedAt: now })
    .where(and(eq(tries.id, input.tryId), eq(tries.userId, input.userId), isNull(tries.result), isNull(tries.returnedAt)));
}

/** Ends a try its return has taken up, when the host did not finish at TikTok or TikTok gave no usable answer. So the host need not wait two minutes to press again. */
export async function endTakenUpTry(tryId: string, result: "stopped" | "not_fetched", detail: string, now: Date): Promise<void> {
  await endTry(tryId, result, detail, now);
}

/**
 * What TikTok answered at a sign-in the host started for their photo, for the try that return has
 * taken up. The account must be the entry the try started from: by TikTok's number when the entry
 * has one, otherwise by its name. The entry itself is never written to here. From the picture's
 * address on, it is the very path an Instagram photo takes.
 */
export async function finishTikTokTry(input: { userId: string; tryId: string; account: { openId: string; username: string; pictureAddress?: string } }, options: PhotoOptions = {}): Promise<PhotoResult> {
  const clock = options.clock ?? (() => new Date());
  const asked = (options.services ?? services()).filter((service) => service.keyMark);
  const end = (result: Exclude<PhotoOutcome, "shown" | "other_account" | "taken_account" | "already_returned">, detail: string) => endTry(input.tryId, result, detail, clock());
  const known: Known = {};
  try {
    const [attempt] = await db
      .select({ entryNameKey: tries.entryNameKey, entryAccountId: tries.entryAccountId, result: tries.result })
      .from(tries)
      .where(and(eq(tries.id, input.tryId), eq(tries.userId, input.userId), eq(tries.network, "tiktok")));
    // (A TikTok try always has the name of the entry it started from.)
    const entryNameKey = attempt?.entryNameKey;
    if (!attempt || attempt.result !== null || !entryNameKey) return { outcome: "stopped" };
    // The number is the network's own text. It is kept exactly as it came, never read as a number.
    if (!/^[\x21-\x7e]{1,200}$/.test(input.account.openId)) return { outcome: await end("not_fetched", "an account number that cannot be used") };
    const signedIn = readSocialName("tiktok", input.account.username);
    const same = attempt.entryAccountId ? attempt.entryAccountId === input.account.openId : !("problem" in signedIn) && signedIn.nameKey === entryNameKey;
    if (!same) {
      const ended = await end("no_picture", "another account than the confirmed one signed in");
      return { outcome: ended === "stopped" ? "stopped" : "other_account" };
    }
    // The same guarantee an ordinary sign-in gets from the database: this number is not another host's confirmed account.
    // (It can only matter for an entry that was confirmed without a number.) Looked for here, before anything is
    // fetched, and once more in the finish.
    if (await confirmedElsewhere(db, "tiktok", input.account.openId, input.userId)) {
      const ended = await end("no_picture", "the account is confirmed for another host");
      return { outcome: ended === "stopped" ? "stopped" : "taken_account" };
    }
    if (!input.account.pictureAddress) return { outcome: await end("no_picture", "tiktok sent no picture") };
    const address = pictureAddress(input.account.pictureAddress, PICTURE_SERVERS.tiktok);
    if (!address) {
      console.error(`[host-photo] tiktok named a picture server that is not allowed: ${serverFamily(input.account.pictureAddress)}`);
      return { outcome: await end("not_fetched", "a picture server that is not allowed") };
    }
    // The photo remembers TikTok's number from this answer and the entry's name, also when the entry has no number.
    const original = () => (options.fetch ?? fetchPicture)(address);
    return await copyCheckAndFinish({ userId: input.userId, network: "tiktok", tryId: input.tryId, source: { nameKey: entryNameKey, accountId: input.account.openId }, original }, asked, clock, options, known);
  } catch (error) {
    return afterFailure(error, input.userId, input.tryId, known, clock);
  }
}

// ---------------------------------------------------------------------------
// 1. The start
// ---------------------------------------------------------------------------

async function startTry(userId: string, network: PhotoSource, hasChecker: boolean, clock: () => Date, diaryHosts: string[] | undefined): Promise<Started | Exclude<PhotoOutcome, "shown">> {
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
    // A photo from a network is a host's: it needs a host profile. Anyone may upload one (plans/35).
    if (closed || paused || (network !== "upload" && !profile)) return "cannot";
    const [locked] = await tx.select({ id: photos.id }).from(photos).where(and(eq(photos.userId, userId), isNotNull(photos.lockedAt))).limit(1);
    if (locked) return "locked";
    // A photo from a network starts from the host's confirmed account there. An upload starts from none.
    const [entry] =
      network === "upload"
        ? []
        : await tx
            .select({ nameKey: schema.socialAccounts.nameKey, providerAccountId: schema.socialAccounts.providerAccountId })
            .from(schema.socialAccounts)
            .where(and(eq(schema.socialAccounts.userId, userId), eq(schema.socialAccounts.network, network), isNotNull(schema.socialAccounts.confirmedAt)));
    if (network !== "upload" && !entry) return "no_account";

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

    const [attempt] = await tx.insert(tries).values({ userId, network, startedAt: now, entryNameKey: entry?.nameKey ?? null, entryAccountId: entry?.providerAccountId ?? null }).returning({ id: tries.id });
    return { tryId: attempt.id, entry: entry ? { nameKey: entry.nameKey, accountId: entry.providerAccountId } : null };
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

/**
 * What a try has in hand once it knows where its picture is. `source` is the account the picture
 * comes from (none for an upload). `original` gets the picture as it is: fetched from the
 * network's server, or read out of the upload's request. Null: it could not be had.
 */
type Candidate = { userId: string; network: PhotoSource; tryId: string; source: { nameKey: string; accountId: string } | null; original: () => Promise<Buffer | null> };

async function copyCheckAndFinish(candidate: Candidate, asked: Checker[], clock: () => Date, options: PhotoOptions, known: Known): Promise<PhotoResult> {
  const end = (result: Exclude<PhotoOutcome, "shown">, detail: string, more?: { sha256?: string; checkedBy?: string }) => endTry(candidate.tryId, result, detail, clock(), more);

  // One picture is opened at a time on this server, a diary upload or a photo: a large one needs a lot of memory
  // while it is open. The place is given back before any checking service is asked.
  if (!takePlace()) {
    const ended = await end("not_fetched", "another picture was being opened");
    return { outcome: ended === "stopped" ? "stopped" : "place_taken" };
  }
  // Nothing but the fetching (or the reading of an upload) and the copying happens while the place is held: what is
  // written down about it comes after.
  const fingerprint = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
  let made: { copy: Copy; diarySha256: string | null } | { unusable: string } | null;
  try {
    made = await (async () => {
      const original = await candidate.original();
      if (!original) return null;
      if (candidate.network !== "upload") {
        // A photo from a network is copied exactly as a diary picture is, so one fingerprint serves for both.
        const copy = await makeCopy(original);
        return { copy, diarySha256: fingerprint(copy.bytes) };
      }
      // An uploaded photo is kept as a square, which never has the fingerprint of a diary picture of the same file.
      // So the diary's kind of copy is made as well, only for its fingerprint, and thrown away. A file the diary
      // itself could not have copied (too long and thin, too detailed) is no diary picture of anyone's.
      const copy = await makeCopy(original, { square: PHOTO.uploadSide });
      const whole = await makeCopy(original).catch((error: unknown) => {
        if (!(error instanceof ProjectError)) throw error;
        return null;
      });
      return { copy, diarySha256: whole ? fingerprint(whole.bytes) : null };
    })().catch((error: unknown) => {
      // Words for the person: the file is not a picture Connect can use, or the upload could not be read as one file.
      if (!(error instanceof ProjectError)) throw error;
      return { unusable: error.message };
    });
  } finally {
    givePlace();
  }
  if (!made) return { outcome: await end("not_fetched", "the picture could not be fetched") };
  if ("unusable" in made) return { outcome: await end("unusable", made.unusable), detail: made.unusable };
  const { copy, diarySha256 } = made;
  await options.meanwhile?.("copied");
  const sha256 = fingerprint(copy.bytes);

  // The same copy as one that was refused before, as a photo or in her diary, or that is locked there: a new try is
  // not a second chance at a clean answer. No service is asked.
  const before = await refusedBefore(db, candidate.userId, sha256, diarySha256);
  if (before) {
    const outcome = await end("refused_before", before === "locked" ? "the same picture as a locked diary picture" : "the same picture as one that was refused before", { sha256 });
    if (before === "locked" && outcome === "refused_before") {
      // The try has its result. An email that cannot be written does not change what the host is told.
      await db
        .transaction((tx) =>
          tellFounders(tx, {
            subject: "A locked picture was tried as a host's photo",
            text: `A host tried to take a photo${candidate.network === "upload" ? " by uploading a picture" : ""}, and the picture is the same as a diary picture of theirs that you removed and reported. It was not taken.\n\n${adminUrl()}`,
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
        refused: sql<boolean>`${exists(db.select({ one: sql`1` }).from(earlier).where(and(eq(earlier.userId, candidate.userId), inArray(earlier.sha256, printsOf(sha256, diarySha256)), eq(earlier.result, "not_accepted"))))}`,
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
  return { outcome: await finish(candidate, copy, { sha256, diarySha256 }, { by: answer.by, detail: answer.detail }, clock) };
}

/** Whether this account number, on this network, is another host's confirmed account. */
async function confirmedElsewhere(reader: Pick<typeof db, "select">, network: PhotoNetwork, accountId: string, userId: string): Promise<boolean> {
  const [elsewhere] = await reader
    .select({ id: schema.socialAccounts.id })
    .from(schema.socialAccounts)
    .where(and(eq(schema.socialAccounts.network, network), eq(schema.socialAccounts.providerAccountId, accountId), isNotNull(schema.socialAccounts.confirmedAt), sql`${schema.socialAccounts.userId} <> ${userId}`))
    .limit(1);
  return Boolean(elsewhere);
}

/** The fingerprints a file can have been refused under as a photo: its own copy's, and the whole copy's when that is another. */
const printsOf = (sha256: string, diarySha256: string | null): string[] => (diarySha256 && diarySha256 !== sha256 ? [sha256, diarySha256] : [sha256]);

/**
 * Whether this host's picture was refused before, as a photo or as a diary picture, or is locked in
 * her diary. `sha256` is the fingerprint of the photo's own copy. `diarySha256` is the fingerprint
 * the same file has as a diary picture, compared with her diary: the same as `sha256` for a photo
 * from a network, another for an upload, and null when the diary could not have copied the file at
 * all. Her earlier tries are compared with both: a photo from a network is kept as the whole copy,
 * so a picture refused that way and then uploaded as the very same file is known by the whole
 * copy's fingerprint, not by the square's.
 */
async function refusedBefore(reader: Pick<typeof db, "select">, userId: string, sha256: string, diarySha256: string | null): Promise<"refused" | "locked" | null> {
  const pictures = schema.projectPictures;
  const inDiary = diarySha256
    ? await reader
        .select({ state: pictures.state })
        .from(pictures)
        .where(and(eq(pictures.hostId, userId), eq(pictures.sha256, diarySha256), or(eq(pictures.state, "locked"), eq(pictures.refusedByChecker, true))))
    : [];
  if (inDiary.some((picture) => picture.state === "locked")) return "locked";
  if (inDiary.length > 0) return "refused";
  const [asPhoto] = await reader.select({ id: tries.id }).from(tries).where(and(eq(tries.userId, userId), inArray(tries.sha256, printsOf(sha256, diarySha256)), eq(tries.result, "not_accepted"))).limit(1);
  return asPhoto ? "refused" : null;
}

/**
 * 3. The finish. With the person's and the profile's locks, in the app's order, and then the try's
 * own line. The photo is written only if nothing has stopped the try, the account may still do
 * this, the confirmed entry on that network has the name and the number it had at the start, the
 * account the picture came from has not become another host's confirmed account, and no service
 * has refused this very copy in the meantime (see writeRefusal).
 */
async function finish(candidate: Candidate, copy: Copy, prints: { sha256: string; diarySha256: string | null }, passed: { by: string; detail: string }, clock: () => Date): Promise<PhotoOutcome> {
  const { sha256 } = prints;
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
    if (closed || paused || (candidate.network !== "upload" && !profile)) return stop("the account could no longer do this");
    const [locked] = await tx.select({ id: photos.id }).from(photos).where(and(eq(photos.userId, candidate.userId), isNotNull(photos.lockedAt))).limit(1);
    if (locked) return stop("a photo was removed and reported meanwhile");
    // A photo from a network: its account must still be the host's confirmed one. An upload came from no account.
    if (candidate.network !== "upload") {
      if (!candidate.source) return stop("a photo from a network without its account");
      const [entry] = await tx
        .select({ nameKey: schema.socialAccounts.nameKey, providerAccountId: schema.socialAccounts.providerAccountId })
        .from(schema.socialAccounts)
        .where(and(eq(schema.socialAccounts.userId, candidate.userId), eq(schema.socialAccounts.network, candidate.network), isNotNull(schema.socialAccounts.confirmedAt)));
      if (!entry || entry.nameKey !== attempt.entryNameKey || entry.providerAccountId !== attempt.entryAccountId) return stop("the account changed meanwhile");
      // An entry confirmed without a number is tied to its name. If the account that name led to has, in the meantime
      // or before, been confirmed by number for another host, its picture is not this host's photo.
      if (await confirmedElsewhere(tx, candidate.network, candidate.source.accountId, candidate.userId)) {
        await tx.update(tries).set({ result: "no_picture", detail: "the account is confirmed for another host", sha256, endedAt: now }).where(eq(tries.id, attempt.id));
        return "taken_account";
      }
    }
    // Looked for once more, with the locks a refusal's own write takes: an earlier try of this host's, stopped while a
    // service was still looking at the same copy, may have brought its refusal since this try began.
    if (await refusedBefore(tx, candidate.userId, sha256, prints.diarySha256)) {
      await tx.update(tries).set({ result: "refused_before", detail: "the same picture was refused while this try was under way", sha256, endedAt: now }).where(eq(tries.id, attempt.id));
      return "refused_before";
    }

    // The old photo goes and the new one comes in one step. A new photo has a new address.
    await deletePhotoInStep(tx, candidate.userId);
    await tx.insert(photos).values({
      userId: candidate.userId,
      network: candidate.network,
      sourceNameKey: candidate.source?.nameKey ?? null,
      sourceAccountId: candidate.source?.accountId ?? null,
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
async function decide(photoId: string, work: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0], photo: { id: string; userId: string; lockedAt: Date | null; network: string; sourceNameKey: string | null; sourceAccountId: string | null; takenAt: Date }) => Promise<void>): Promise<void> {
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
 * A photo's bytes for this viewer, or null. The whole rule (plans/29, "Who sees it"; plans/35):
 *
 *   the photo's owner                                  visitor   a host the owner   the owner   the founder
 *                                                                has asked
 *   has a host page open to everyone                     yes       yes                yes         yes
 *   anyone else: a customer, or a host whose page is
 *   hidden, waiting, declined or suspended               no        yes                yes         yes
 *   a locked photo, whoever's                            no        no                 no          no
 *
 * "A host the owner has asked" is the rule a host's notes go by (hasAskedHost): the owner really
 * sent this viewer a request, neither has blocked the other, and the owner's account is not
 * closed. It is asked afresh each time, after the read that brought the bytes: a "yes" that
 * became a "no" in between is at most a moment old.
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
  if (open || viewer?.id === row.userId || viewer?.admin) return { bytes: row.bytes, open };
  if (viewer && !row.closedAt && (await hasAskedHost(viewer.id, row.userId))) return { bytes: row.bytes, open: false };
  return null;
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
 * The ids of these people's photos, for a host's own pages (the requests, "Available now", one
 * booking): only of the people this host is handed a photo of, by the very rule the photo's
 * address goes by (hasAskedHost). Being on the host's list is never taken as proof: a host who
 * was blocked, or whose booking was a test call, learns nothing here, not even whether the person
 * has a photo or has changed it. Never the bytes.
 */
export async function photosForHost(hostId: string, customerIds: string[]): Promise<Map<string, string>> {
  const all = [...(await photosOf([...new Set(customerIds)]))];
  // One check for everyone on the list (plans/38); it is the very code of the single check.
  const handed = await haveAskedHost(
    hostId,
    all.map(([customerId]) => customerId),
  );
  return new Map(all.filter(([customerId]) => handed.has(customerId)));
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

/** `sourceNameKey` is the account the photo came from; null for an uploaded one. */
export type OwnPhoto = { id: string; network: string; sourceNameKey: string | null; takenAt: Date };

/** What the Hosting page shows its host: their photo if they have one, and whether one of theirs was removed and reported. */
export async function ownPhotoState(userId: string): Promise<{ photo: OwnPhoto | null; locked: boolean }> {
  const rows = await db.select({ id: photos.id, network: photos.network, sourceNameKey: photos.sourceNameKey, takenAt: photos.takenAt, lockedAt: photos.lockedAt }).from(photos).where(eq(photos.userId, userId));
  const current = rows.find((row) => !row.lockedAt);
  return { photo: current ? { id: current.id, network: current.network, sourceNameKey: current.sourceNameKey, takenAt: current.takenAt } : null, locked: rows.some((row) => row.lockedAt) };
}

/** `name` is the person's own name on their account: what the founder's page shows for someone without a host profile. */
export type AdminPhoto = { id: string; userId: string; name: string; network: string; sourceNameKey: string | null; takenAt: Date; lockedAt: Date | null; reportMadeAt: Date | null };

/** Every photo, the locked ones too, for the founder's page: everyone's, or only these people's. Never the bytes. */
export async function photosForAdmin(userIds?: string[]): Promise<AdminPhoto[]> {
  if (userIds && userIds.length === 0) return [];
  return db
    .select({ id: photos.id, userId: photos.userId, name: schema.user.name, network: photos.network, sourceNameKey: photos.sourceNameKey, takenAt: photos.takenAt, lockedAt: photos.lockedAt, reportMadeAt: photos.reportMadeAt })
    .from(photos)
    .innerJoin(schema.user, eq(schema.user.id, photos.userId))
    .where(userIds ? inArray(photos.userId, userIds) : undefined)
    .orderBy(photos.takenAt);
}
