/**
 * The checking queue (plans/23, "Pictures"; plans/24, "How the queue decides"). One round of it is
 * run by the always-on helper every few seconds, and by nobody else: no page ever loads this file.
 *
 * A round does three things, one picture at a time:
 *   1. asks the child-safety tool, if Connect has one, about pictures it has not answered for;
 *   2. sends waiting pictures to the checkers in their order, the ones that were only checked
 *      for nudity first, and writes down what happens to each;
 *   3. deletes the bytes of removed and refused pictures that nothing needs any more.
 *
 * Never two answers for one picture: before a picture is checked the round claims it, with its
 * own mark and a time limit. An everyday checker's answer is written only if the mark is still
 * this round's, the time has not run out, and the picture's counter has not moved (the host or
 * the founder decided something in between). The one exception is a match from the child-safety
 * tool: it always counts, however late.
 */
import { randomUUID } from "node:crypto";
import { and, asc, eq, exists, inArray, isNull, lte, ne, notInArray, or, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import type { ProjectPicture } from "@/db/schema";
import { azureChecker } from "./checks/azure";
import { openAiChecker } from "./checks/openai";
import { askInOrder, waitMinutes, type Asked, type Outcome } from "./checks/order";
import { ownChecker } from "./checks/own";
import { sightengineChecker } from "./checks/sightengine";
import type { Answer, Checker } from "./checks/types";
import { childTool, mayGoOn, switchChildCheckOn, type ChildAnswer, type ChildTool } from "./child-safety";
import { adminUrl, deleteBytesIfFree, lockInStep, lockPost, refuseInStep, goneWithBytes, tellFounders } from "./picture-steps";
import { PICTURE } from "./rules";

const pictures = schema.projectPictures;
const files = schema.projectPictureFiles;
const checkers = schema.pictureCheckers;

/** How long a round may hold a picture. Longer than the slowest try: three services and the own checker's start. */
const CLAIM_MS = 2 * 60_000;
/** A service that was out is not asked again for this long. */
const COOL_MS = 5 * 60_000;
const PER_ROUND = 10;
const CHILD_PER_ROUND = 5;
const DAY_MS = 24 * 3_600_000;
/** The child-safety tool may take this long over one picture. After that the round goes on, and the picture is asked about again later. */
const TOOL_WITHIN_MS = 15_000;

/** The outside services, in the queue's order. */
export const services = (): Checker[] => [openAiChecker(), azureChecker(), sightengineChecker()];

/**
 * What a round works with. The helper hands in nothing. The check script hands in stand-ins and
 * its own clock, and keeps the round to the pictures of the people it made (`onlyHosts`), so that
 * a stand-in never decides about a real picture in the test database.
 */
export type RoundOptions = { now?: () => Date; services?: Checker[]; own?: Checker | null; tool?: ChildTool | null; onlyHosts?: string[] };

export async function runPictureRound(options: RoundOptions = {}): Promise<void> {
  const now = options.now ?? (() => new Date());
  const round = randomUUID();
  const tool = options.tool === undefined ? childTool() : options.tool;
  const whose = options.onlyHosts ? inArray(pictures.hostId, options.onlyHosts) : undefined;
  if (tool) await childStep(round, tool, now, whose);

  // A service without a key is not part of the queue.
  const asked = (options.services ?? services()).filter((service) => service.keyMark);
  const own = options.own === undefined ? ownChecker() : options.own;
  const seen: string[] = [];
  for (let i = 0; i < PER_ROUND; i++) {
    const picture = await claimOne(round, now(), and(everyday(now()), whose), [sql`case when ${pictures.state} = 'shown' then 0 else 1 end`, asc(pictures.uploadedAt), asc(pictures.id)], seen, true);
    if (!picture) break;
    seen.push(picture.id);
    await checkOne(round, picture, asked, own, now);
  }

  for (const id of await goneWithBytes(20, now(), whose)) await db.transaction((tx) => deleteBytesIfFree(tx, id, now()));
  await tellAboutNudityOnly(now(), whose);
}

/** The pictures the everyday checkers may be asked about now: waiting, or shown after a check for nudity only; due; and allowed on by the child-safety rule. */
function everyday(now: Date): SQL | undefined {
  return and(
    or(eq(pictures.state, "waiting"), and(eq(pictures.state, "shown"), eq(pictures.level, "nudity_only"))),
    lte(pictures.nextTryAt, now),
    // The same rule as mayGoOn in child-safety.ts, which is asked again once the picture is claimed.
    inArray(pictures.childCheck, ["clear", "not_set_up"]),
    eq(pictures.suspectedByFounder, false),
    eq(pictures.suspectedByReport, false),
  );
}

/**
 * Claims one picture for this round, or finds none. A picture another round holds is left alone
 * until that round's time has run out; after that it can be claimed afresh, so a round that died
 * holds nothing up. `seen` are the pictures this round has already had.
 */
async function claimOne(round: string, now: Date, which: SQL | undefined, order: Array<SQL>, seen: string[], counts: boolean): Promise<ProjectPicture | null> {
  const free = or(isNull(pictures.claimedUntil), lte(pictures.claimedUntil, now));
  const pick = db
    .select({ id: pictures.id })
    .from(pictures)
    .where(and(which, free, seen.length > 0 ? notInArray(pictures.id, seen) : undefined))
    .orderBy(...order)
    .limit(1)
    .for("update", { skipLocked: true });
  const [claimed] = await db
    .update(pictures)
    .set({ claimId: round, claimedUntil: new Date(now.getTime() + CLAIM_MS), ...(counts ? { tries: sql`${pictures.tries} + 1` } : {}), updatedAt: now })
    .where(inArray(pictures.id, pick))
    .returning();
  return claimed ?? null;
}

// ---------------------------------------------------------------------------
// The everyday checkers
// ---------------------------------------------------------------------------

async function checkOne(round: string, picture: ProjectPicture, asked: Checker[], own: Checker | null, now: () => Date): Promise<void> {
  const [file] = await db.select({ bytes: files.bytes }).from(files).where(eq(files.pictureId, picture.id));
  // Asked again on the picture as it was claimed: the one rule about who may go on is in child-safety.ts.
  if (!file || !mayGoOn(picture)) return settle(round, picture, { kind: "wait", detail: file ? "Held back for now." : "The picture's file is missing." }, now());

  const rows = await db.select().from(checkers);
  const at = now();
  const safely = (check: Promise<Answer>): Promise<Answer> => check.catch((error) => ({ kind: "fault", detail: `the checker failed: ${error instanceof Error ? error.message : "error"}`.slice(0, 220) }));
  const turns = asked.map((service) => {
    const row = rows.find((line) => line.service === service.name);
    // A service with a fault on record is always asked, never passed over as "still out": a fault holds the queue until the service answers properly.
    return { name: service.name, cooling: !row?.faultSince && Boolean(row?.outUntil && row.outUntil > at), worked: Boolean(service.keyMark) && row?.lastGoodKey === service.keyMark, check: () => safely(service.check(file.bytes)) };
  });
  // A picture that is already shown is only here for its full check: the own checker has had it.
  /** Asked before each request: is the picture still this round's, and as it was claimed? If the founder, the host or a report has changed something meanwhile, it is sent to nobody else. */
  const mayStillAsk = async () => {
    const [row] = await db.select().from(pictures).where(eq(pictures.id, picture.id));
    return Boolean(row) && stillAsClaimed(round, picture, row, now());
  };
  const { outcome, asked: answers } = await askInOrder(turns, picture.state === "waiting" && own ? () => safely(own.check(file.bytes)) : null, mayStillAsk);
  await recordAnswers(asked, answers, now());
  await settle(round, picture, outcome, now());
}

/** Whether a picture is still held by this round, within its time, and as it was when the round claimed it. */
function stillAsClaimed(round: string, claimed: ProjectPicture, row: ProjectPicture, at: Date): boolean {
  return row.claimId === round && row.version === claimed.version && row.state === claimed.state && row.claimedUntil !== null && row.claimedUntil > at && mayGoOn(row);
}

/** Writes what a try came to, if this round still holds the picture and nothing was decided about it in between. */
async function settle(round: string, claimed: ProjectPicture, outcome: Outcome, at: Date): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx.select().from(pictures).where(eq(pictures.id, claimed.id)).for("update");
    // The time ran out and another round has it now: that round's answer counts, not this one.
    if (!row || row.claimId !== round) return;
    if (!stillAsClaimed(round, claimed, row, at)) {
      // A late answer, or the host or the founder decided in between: it changes nothing. The picture is let go,
      // and if it was removed meanwhile, its bytes go now.
      await tx.update(pictures).set({ claimId: null, claimedUntil: null, updatedAt: at }).where(eq(pictures.id, row.id));
      await deleteBytesIfFree(tx, row.id, at);
      return;
    }
    // A picture that is shown after a check for nudity only is due again the moment a service's five minutes are over,
    // so that it is the first one asked about when full checking is back.
    const [{ back }] = await tx.select({ back: sql<Date | null>`min(${checkers.outUntil})` }).from(checkers).where(sql`${checkers.outUntil} > ${at.toISOString()}::timestamptz`);
    const nudityOnlyAgain = back ? new Date(back) : new Date(at.getTime() + COOL_MS);
    if (outcome.kind === "refused") {
      await refuseInStep(tx, { pictureId: row.id, by: outcome.by, detail: outcome.detail, now: at });
    } else if (outcome.kind === "shown") {
      await tx
        .update(pictures)
        .set({
          state: "shown",
          level: outcome.level,
          checkedBy: outcome.by,
          checkedAt: at,
          rulesVersion: PICTURE.rulesVersion,
          checkDetail: outcome.detail,
          version: sql`${pictures.version} + 1`,
          claimId: null,
          claimedUntil: null,
          nextTryAt: outcome.level === "nudity_only" ? nudityOnlyAgain : null,
          updatedAt: at,
        })
        .where(eq(pictures.id, row.id));
    } else if (row.state === "waiting") {
      await tx
        .update(pictures)
        .set({ checkDetail: outcome.detail, claimId: null, claimedUntil: null, nextTryAt: new Date(at.getTime() + waitMinutes(row.tries) * 60_000), updatedAt: at })
        .where(eq(pictures.id, row.id));
    } else {
      // Shown after a check for nudity only, and still no full answer: it stays as it is.
      await tx.update(pictures).set({ claimId: null, claimedUntil: null, nextTryAt: nudityOnlyAgain, updatedAt: at }).where(eq(pictures.id, row.id));
    }
  });
}

/**
 * What each service's answer means for the service itself: a complete, valid answer is remembered
 * with the key that gave it; "out" starts its five minutes; a fault is written down, and the
 * founder is emailed at once and then once a day while it lasts.
 */
async function recordAnswers(asked: Checker[], answers: Asked[], at: Date): Promise<void> {
  for (const { name, answer } of answers) {
    const service = asked.find((one) => one.name === name);
    if (!service) continue; // Connect's own checker has no line: when it fails, the picture's own line says so.
    await db.transaction(async (tx) => {
      await tx.insert(checkers).values({ service: name }).onConflictDoNothing();
      const [row] = await tx.select().from(checkers).where(eq(checkers.service, name)).for("update");
      if (answer.kind === "flagged" && answer.partial) {
        // The picture is refused, but an answer with parts missing does not show that the service works with this key. Nothing is written about the service.
      } else if (answer.kind === "clean" || answer.kind === "flagged") {
        await tx.update(checkers).set({ lastGoodAt: at, lastGoodKey: service.keyMark, outUntil: null, faultSince: null, faultDetail: null, faultToldAt: null }).where(eq(checkers.service, name));
      } else if (answer.kind === "out") {
        await tx.update(checkers).set({ outUntil: new Date(at.getTime() + COOL_MS) }).where(eq(checkers.service, name));
      } else {
        const tell = !row.faultToldAt || at.getTime() - row.faultToldAt.getTime() >= DAY_MS;
        // Its five minutes, if it was "out" a moment ago, are over with this: a fault is never waited out.
        await tx.update(checkers).set({ outUntil: null, faultSince: row.faultSince ?? at, faultDetail: answer.detail, faultToldAt: tell ? at : row.faultToldAt }).where(eq(checkers.service, name));
        if (tell) {
          await tellFounders(tx, {
            subject: `A picture checking service has a fault: ${name}`,
            text: `The picture checking service "${name}" gave an answer Connect could not use:\n\n${answer.detail}\n\nThis is not the same as the service being used up. While it lasts, new pictures wait and are shown to nobody. The usual cause is a wrong or expired key. Put the right key into the settings, or take that service's key out, which takes the service out of the queue.\n\n${adminUrl()}`,
            key: `picture-checker-fault:${name}:${at.toISOString()}`,
          });
        }
      }
    });
  }
}

/** The founder is told when pictures are being shown after a check for nudity only: at once for the first, then once a day while any is, with how many and since when. */
async function tellAboutNudityOnly(at: Date, whose: SQL | undefined): Promise<void> {
  const [{ n, since }] = await db
    .select({ n: sql<number>`count(*)::int`, since: sql<Date | null>`min(${pictures.checkedAt})` })
    .from(pictures)
    .where(and(whose, eq(pictures.state, "shown"), eq(pictures.level, "nudity_only")));
  if (n === 0) return;
  const longest = since ? ` The one that has waited longest has been shown like this since ${new Date(since).toISOString().slice(0, 16).replace("T", " ")} (UTC).` : "";
  await db.transaction((tx) =>
    tellFounders(tx, {
      subject: "Pictures are being shown after a check for nudity only",
      text: `${n === 1 ? "One picture is" : `${n} pictures are`} being shown although only Connect's own checker has looked at ${n === 1 ? "it" : "them"}, and that one only looks for nudity.${longest} This happens when every outside checking service is used up or cannot be reached. Each such picture gets its full check as soon as a service answers again.\n\n${adminUrl()}`,
      key: `pictures-nudity-only:${at.toISOString().slice(0, 10)}`,
    }),
  );
}

// ---------------------------------------------------------------------------
// The child-safety tool
// ---------------------------------------------------------------------------

/**
 * Asks the tool about pictures it has not answered for: first the ones that wait for it (uploaded
 * since it was switched on), then the ones from before that day, the oldest first, a few in each
 * round. Only pictures whose bytes are still kept. The first real answer switches the tool on for
 * good. If the tool does not answer, the round asks it nothing more.
 */
async function childStep(round: string, tool: ChildTool, now: () => Date, whose: SQL | undefined): Promise<void> {
  const seen: string[] = [];
  const which = and(whose, inArray(pictures.childCheck, ["waiting", "not_set_up"]), ne(pictures.state, "locked"), exists(db.select({ one: sql`1` }).from(files).where(eq(files.pictureId, pictures.id))));
  for (let i = 0; i < CHILD_PER_ROUND; i++) {
    const picture = await claimOne(round, now(), which, [sql`case when ${pictures.childCheck} = 'waiting' then 0 else 1 end`, asc(pictures.uploadedAt), asc(pictures.id)], seen, false);
    if (!picture) return;
    seen.push(picture.id);
    const [file] = await db.select({ bytes: files.bytes }).from(files).where(eq(files.pictureId, picture.id));
    // Bounded here too, whatever the tool's own limits are: one picture it never answers for must not stop the round.
    let tooSlow: NodeJS.Timeout | undefined;
    const noAnswer = new Promise<ChildAnswer>((resolve) => (tooSlow = setTimeout(() => resolve("unreachable"), TOOL_WITHIN_MS)));
    const answer: ChildAnswer = file ? await Promise.race([tool.ask(file.bytes).catch(() => "unreachable" as const), noAnswer]) : "unreachable";
    clearTimeout(tooSlow);
    await settleChild(round, picture, answer, now());
    if (answer === "unreachable") return;
    await switchChildCheckOn(now());
  }
}

/** Writes the tool's answer. It is about the picture's exact bytes, which never change, so it counts whatever else has happened to the picture since. */
async function settleChild(round: string, claimed: ProjectPicture, answer: ChildAnswer, at: Date): Promise<void> {
  await db.transaction(async (tx) => {
    // The post first, then the picture, as everywhere: a match also hides the post.
    await lockPost(tx, claimed.postId);
    const [row] = await tx.select().from(pictures).where(eq(pictures.id, claimed.id)).for("update");
    if (!row) return;
    const letGo = row.claimId === round ? { claimId: null, claimedUntil: null } : {};
    if (answer === "unreachable") {
      await tx.update(pictures).set({ ...letGo, updatedAt: at }).where(eq(pictures.id, row.id));
      return;
    }
    if (answer === "clear") {
      // A match is never taken back: a "clear" that comes in after one changes nothing.
      await tx.update(pictures).set({ ...letGo, ...(row.childCheck === "match" ? {} : { childCheck: "clear" as const }), updatedAt: at }).where(eq(pictures.id, row.id));
      // A picture that was removed or refused meanwhile was only kept for this answer.
      await deleteBytesIfFree(tx, row.id, at);
      return;
    }
    await tx.update(pictures).set({ childCheck: "match", updatedAt: at }).where(eq(pictures.id, row.id));
    if (row.state !== "locked") await lockInStep(tx, { pictureId: row.id, postId: row.postId, by: null, now: at });
    await tellFounders(tx, {
      subject: "A picture matched the list of known child abuse pictures",
      text: `The child-safety tool matched a picture a host uploaded. It was locked at once: nobody can see it, its post is hidden, and it is kept exactly as it is. Please open the projects page now and follow the steps for making the report.\n\n${adminUrl()}`,
      key: `picture-match:${row.id}`,
    });
  });
}
