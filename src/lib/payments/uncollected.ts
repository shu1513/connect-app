/**
 * Earnings a host has not collected for 12 months are sent to her without being asked
 * (plans/46-part-3-money-owed.md, decision 12; the draft Host Agreement, section 7.7).
 *
 * The helper does it, in a loop of its own. For each host it first writes its try down, under the
 * host's lock. Then it runs the whole of what her own button runs (collectEarnings: ask Stripe
 * whether the payout account is ready, accept under her lock, send), under the try's own id. So
 * everything that holds a share back today holds it back here too, two helpers at once make one
 * try, and a try that is run again is the same collection.
 *
 * What decides is asked last, inside the step that accepts the collection, with her row, her
 * account and every share locked: the account is open, the try is still open, and the 12 months
 * hold for the shares that are really ready at that moment. The try gets its outcome "collected" in
 * that same step, so a collection and its try can never say different things.
 *
 * A try that makes no collection (the account is not ready, nothing can be collected, she collected
 * herself in that minute) is written down with the reason, and the next try is a week later. A
 * collection of which nothing went through starts her 24 hours, as always, and not the 12 months.
 *
 * She is told once every transfer has its answer, or, from 26 hours after the collection was
 * accepted, with what is known by then. A closed account is never touched: the founder's final
 * collection exists for it.
 */
import { and, asc, desc, eq, inArray, isNull, lte } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Payment, UncollectedTry } from "@/db/schema";
import { errorSummary } from "@/lib/email";
import { tell } from "@/lib/messages/messages";
import { HOME_COUNTRY } from "@/lib/profiles/countries";
import { monthsBefore } from "@/lib/retention";
import { formatMoney } from "./access";
import { collectEarnings, hostsWithDatedShares, lastAcceptedAt, lastCollectionThrough, oldestDatedShare, unansweredCollectionsOf, viewOfCollection } from "./collect";
import { getHostSettings } from "./hosts";
import { MoneyError, type Tx } from "./operations";
import { canCollectAgainAt } from "./rules";
import { uncollectedWords } from "./uncollected-words";

/** After this many months without a collection that went through, the helper starts one. */
export const UNCOLLECTED_MONTHS = 12;
const DAY_MS = 24 * 3_600_000;
/** After a try, the next try of the same host is no sooner than this. */
export const TRY_AGAIN_AFTER_MS = 7 * DAY_MS;
/** A try with no outcome written is run again once it is this old: by then the helper that wrote it has usually stopped. */
export const RUN_AGAIN_AFTER_MS = 2 * 60_000;
/** A try that still cannot be run after this long is written down as "nothing", so that the next one comes a week later. */
export const GIVE_UP_AFTER_MS = DAY_MS;
/**
 * From this long after the collection was accepted she is told with what is known by then, also when a transfer
 * has no clear answer yet. Counted from the acceptance, not from the try (a try can be run long after it was
 * written down), and a little more than a day: a transfer Stripe will not make is given up 24 hours after the
 * acceptance (jobs.ts), so by then she can usually be told how it ended and not that it is "still being checked".
 */
export const TELL_ANYWAY_AFTER_MS = 26 * 3_600_000;

const NOT_DUE = "She has collected in the last 12 months, or nothing that is ready has waited that long.";
const TRY_OVER = "This try has already ended.";
const NOT_ANSWERED = "A collection of hers from the last 12 months has no answer from Stripe yet. Until it has, nobody can say that she has not collected.";

/** The same day and time, this many months later. A day the later month does not have becomes its last day. */
const monthsAfter = (from: Date, months: number): Date => monthsBefore(from, -months);


type Reader = Pick<Tx, "select">;
/** Only the check scripts pass this: only these hosts are looked at. */
export type OnlyHosts = { hostIds: string[] };

/**
 * Whether a host who has not collected since this moment is due: its anniversary, 12 months on, has passed.
 * Counted forward from that moment, so that once she is due she stays due (counting back from today would make
 * 28 February due and 29 February not).
 */
export function uncollectedDue(since: Date | null, now: Date): boolean {
  return since !== null && now.getTime() > monthsAfter(since, UNCOLLECTED_MONTHS).getTime();
}

/**
 * Whether a collection of hers that is still without its answer could mean she has collected in the last 12
 * months. Judged by the one rule above: if that collection turned out to have gone through, would she still be
 * due? If not, nothing is started until it is answered. (One rule for both, so that a collection counts the same
 * on its anniversary whether it is answered or not.)
 */
export const blocksWhileUnanswered = (acceptedAt: Date, now: Date): boolean => !uncollectedDue(acceptedAt, now);

const recentUnanswered = async (reader: Reader, hostId: string, now: Date): Promise<boolean> => (await unansweredCollectionsOf(reader, hostId)).some((acceptedAt) => blocksWhileUnanswered(acceptedAt, now));

/** When the next try of a host may be written down, given her latest one. */
export function nextTryAt(lastClaimedAt: Date | null): Date | null {
  return lastClaimedAt ? new Date(lastClaimedAt.getTime() + TRY_AGAIN_AFTER_MS) : null;
}

/**
 * Since when this host has not collected, for FINDING her: her last collection that went through; if she never
 * had one, the date carried by her oldest share that is not sent and whose date has come. Null when she has no
 * such share. Something may still hold that share back: what decides is asked again when the collection is
 * accepted, for the shares that are really ready (`mayCollect`).
 */
export async function uncollectedSince(reader: Reader, hostId: string, now: Date): Promise<Date | null> {
  const oldest = await oldestDatedShare(reader, hostId, now);
  if (!oldest) return null;
  return (await lastCollectionThrough(reader, hostId)) ?? oldest;
}

/**
 * What decides, asked inside the step that accepts the collection: the try is still open, and the 12 months hold
 * for the shares that would really be sent now. Then the try is marked "collected" in that same step. Gives back
 * words of refusal, or null.
 */
async function mayCollect(tx: Tx, tryId: string, hostId: string, now: Date, ready: Payment[]): Promise<string | null> {
  const [tried] = await tx.select().from(schema.uncollectedTries).where(eq(schema.uncollectedTries.id, tryId)).for("update");
  if (!tried || tried.hostId !== hostId || tried.outcome !== null) return TRY_OVER;
  // Her own press of yesterday may have gone through at Stripe with its answer lost: no second collection, and no
  // second charge, on top of one that is not answered.
  if (await recentUnanswered(tx, hostId, now)) return NOT_ANSWERED;
  // Her last collection that went through is read again here: the money helper may have finished one meanwhile.
  const oldestReady = ready.reduce<Date | null>((oldest, payment) => (payment.transferDueAt && (!oldest || payment.transferDueAt < oldest) ? payment.transferDueAt : oldest), null);
  const since = (await lastCollectionThrough(tx, hostId)) ?? oldestReady;
  if (!uncollectedDue(since, now)) return NOT_DUE;
  await tx.update(schema.uncollectedTries).set({ outcome: "collected", reason: null, endedAt: now }).where(eq(schema.uncollectedTries.id, tryId));
  return null;
}

/**
 * Writes a try down for this host, with her row locked, if one seems due: her account is open, the 12 months
 * hold by the dates her shares carry, her 24 hours are over, her last try is a week old and none is still
 * running. Gives back the try, or null.
 */
export async function claimTry(hostId: string, at?: Date): Promise<UncollectedTry | null> {
  // Her settings row is the lock every collection of hers takes. It is made on first use.
  await getHostSettings(hostId);
  return db.transaction(async (tx) => {
    await tx.select({ userId: schema.hostSettings.userId }).from(schema.hostSettings).where(eq(schema.hostSettings.userId, hostId)).for("update");
    const now = at ?? new Date();
    const [person] = await tx.select({ closedAt: schema.user.closedAt }).from(schema.user).where(eq(schema.user.id, hostId));
    if (!person || person.closedAt) return null;
    const since = await uncollectedSince(tx, hostId, now);
    if (!since || !uncollectedDue(since, now)) return null;
    // A recent collection without its answer: no try is written, and the next round looks again (by then the
    // money helper has usually found the answer).
    if (await recentUnanswered(tx, hostId, now)) return null;
    // Within her 24 hours a collection would be refused. No try is written: the next round looks again.
    const again = canCollectAgainAt(await lastAcceptedAt(tx, hostId));
    if (again && now < again) return null;
    const [last] = await tx.select().from(schema.uncollectedTries).where(eq(schema.uncollectedTries.hostId, hostId)).orderBy(desc(schema.uncollectedTries.claimedAt)).limit(1);
    if (last && (last.outcome === null || now < nextTryAt(last.claimedAt)!)) return null;
    const [made] = await tx.insert(schema.uncollectedTries).values({ hostId, claimedAt: now, uncollectedSince: since }).returning();
    return made;
  });
}

/**
 * Writes down what came of a try that made no collection, once. With the try's row locked, and the collection
 * looked for under that lock: if another runner of this same try got its collection accepted meanwhile, the try
 * says "collected", whatever this runner was refused.
 */
async function endWithNothing(tryId: string, reason: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [tried] = await tx.select().from(schema.uncollectedTries).where(eq(schema.uncollectedTries.id, tryId)).for("update");
    if (!tried || tried.outcome !== null) return;
    const [made] = await tx.select({ id: schema.collections.id }).from(schema.collections).where(eq(schema.collections.id, tryId));
    await tx
      .update(schema.uncollectedTries)
      .set(made ? { outcome: "collected", reason: null, endedAt: new Date() } : { outcome: "nothing", reason, endedAt: new Date() })
      .where(eq(schema.uncollectedTries.id, tryId));
  });
}

/**
 * Runs a try: the same collection her own button makes, under the try's id, for an open account only, and only
 * if `mayCollect` says so at the last moment.
 */
export async function runTry(tried: Pick<UncollectedTry, "id" | "hostId" | "claimedAt">, at?: Date): Promise<void> {
  try {
    await collectEarnings({ collectionId: tried.id, hostId: tried.hostId, startedBy: null, now: at, openAccountOnly: true, onlyIf: (tx, now, ready) => mayCollect(tx, tried.id, tried.hostId, now, ready) });
  } catch (error) {
    // A refusal before anything was accepted: nothing was sent and no charge was taken. (If this try's collection
    // is there all the same, another runner made it, and the try says so.)
    if (error instanceof MoneyError) return endWithNothing(tried.id, error.message);
    // Anything else (Stripe did not answer, say): the try stays as it is and is run again. Not for ever.
    console.error(`[uncollected] the try ${tried.id} for host ${tried.hostId} could not be run; it will be run again`, error);
    if ((at ?? new Date()).getTime() - tried.claimedAt.getTime() > GIVE_UP_AFTER_MS) await endWithNothing(tried.id, `It could not be run for a day: ${errorSummary(error)}`);
    return;
  }
  // The collection is there. Its try was marked in the step that accepted it; a collection that was accepted
  // without that step's question (only the check scripts do that) is marked here.
  await endWithNothing(tried.id, "");
}

/**
 * The daily round: every host with an open account who seems not to have collected for 12 months gets a try, and
 * it is run. One host's failure never stops the others.
 */
export async function collectUncollected(at?: Date, only?: OnlyHosts): Promise<void> {
  const hostIds = (await hostsWithDatedShares(at ?? new Date())).filter((id) => !only || only.hostIds.includes(id));
  for (const hostId of hostIds) {
    try {
      // Looked at without her lock first, so that a host who is not due costs two small questions and no lock.
      if (!uncollectedDue(await uncollectedSince(db, hostId, at ?? new Date()), at ?? new Date())) continue;
      const tried = await claimTry(hostId, at);
      if (tried) await runTry(tried, at);
    } catch (error) {
      console.error(`[uncollected] could not look at host ${hostId}; the next round looks again`, error);
    }
  }
}

/**
 * About once a minute: a try that was written down and never got its outcome is run again (the helper stopped in
 * the middle, or Stripe did not answer). This asks Stripe, and can take long when Stripe is slow.
 */
export async function rerunUnfinishedTries(at?: Date, only?: OnlyHosts): Promise<void> {
  const now = at ?? new Date();
  if (only && only.hostIds.length === 0) return;
  const unfinished = await db
    .select()
    .from(schema.uncollectedTries)
    .where(and(isNull(schema.uncollectedTries.outcome), lte(schema.uncollectedTries.claimedAt, new Date(now.getTime() - RUN_AGAIN_AFTER_MS)), only ? inArray(schema.uncollectedTries.hostId, only.hostIds) : undefined))
    .orderBy(asc(schema.uncollectedTries.claimedAt));
  for (const tried of unfinished) await runTry(tried, at).catch((error) => console.error(`[uncollected] running the try ${tried.id} again failed; will retry`, error));
}

/**
 * About once a minute, in a round of its own: a host whose collection's transfers are all answered is told what
 * was sent. This asks only the database, so it never waits behind the tries that are run again.
 */
export async function tellOfCollections(at?: Date, only?: OnlyHosts): Promise<void> {
  const now = at ?? new Date();
  if (only && only.hostIds.length === 0) return;
  const untold = await db
    .select()
    .from(schema.uncollectedTries)
    .where(and(eq(schema.uncollectedTries.outcome, "collected"), isNull(schema.uncollectedTries.toldAt), only ? inArray(schema.uncollectedTries.hostId, only.hostIds) : undefined))
    .orderBy(asc(schema.uncollectedTries.claimedAt));
  for (const tried of untold) await tellOfTry(tried.id, now).catch((error) => console.error(`[uncollected] telling the host of the try ${tried.id} failed; will retry`, error));
}

/** Both of the above, one after the other: for the check scripts, and for a single pass of the helper. */
export async function followUpUncollected(at?: Date, only?: OnlyHosts): Promise<void> {
  await rerunUnfinishedTries(at, only);
  await tellOfCollections(at, only);
}

/**
 * Tells the host what her collection really did, once: when every share of it has its answer, or, from 26 hours
 * after the collection was accepted, with what is known by then (what has no answer is named as such, a charge
 * too). Gives back whether she was told now.
 */
export async function tellOfTry(tryId: string, now: Date = new Date()): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [tried] = await tx.select().from(schema.uncollectedTries).where(eq(schema.uncollectedTries.id, tryId)).for("update");
    if (!tried || tried.outcome !== "collected" || tried.toldAt) return false;
    const [collection] = await tx.select().from(schema.collections).where(eq(schema.collections.id, tried.id));
    // Cannot happen while the record is sound: "collected" is only written once the collection is there.
    if (!collection) throw new Error(`The try ${tried.id} says "collected" and has no collection.`);
    const view = await viewOfCollection(collection, tx);
    // A share that only carries the charge has no cents "being checked", and is unanswered all the same.
    if (view.unanswered > 0 && now.getTime() - collection.acceptedAt.getTime() < TELL_ANYWAY_AFTER_MS) return false;
    const [host] = await tx.select({ id: schema.user.id, email: schema.user.email }).from(schema.user).where(eq(schema.user.id, tried.hostId));
    const [profile] = await tx.select({ country: schema.hostProfiles.country }).from(schema.hostProfiles).where(eq(schema.hostProfiles.userId, tried.hostId));
    const money = (cents: number) => (cents > 0 ? formatMoney(cents) : null);
    const told = uncollectedWords({
      sent: money(view.sentCents),
      charge: money(view.feeCents),
      notSent: money(view.refusedCents),
      checking: money(view.checkingCents),
      checkingCharge: money(view.checkingFeeCents),
      abroad: Boolean(profile) && profile.country !== HOME_COUNTRY,
    });
    await tell(tx, { to: host, key: `uncollected:${tried.id}:host:${host.id}`, subject: told.subject, text: told.text, path: "/host" });
    await tx.update(schema.uncollectedTries).set({ toldAt: now }).where(eq(schema.uncollectedTries.id, tried.id));
    return true;
  });
}
