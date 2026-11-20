/**
 * One call as a list or a calendar draws it, and a person's calls a page at a time
 * (plans/45-phone-apps/08-the-calls-page.md, decision 6). The home page, "Past calls" and the
 * phone app's Calls place all describe a call through `listedCall` here, so who sees what about
 * the other person, and what a host earned, is decided once (plans/38, plans/43): always through
 * `customerDetailsFor` and `earnedFrom`, never by picking fields.
 */
import "server-only";
import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, lte, or } from "drizzle-orm";
import type { ListedCall } from "@/components/call-row";
import { db, schema } from "@/db";
import type { Call, Payment } from "@/db/schema";
import { roomState } from "@/lib/calls";
import { customerDetailsFor } from "@/lib/home/customer-details";
import { earnedFrom, unsettled } from "@/lib/home/earned";
import { paymentLine, paymentsByCall } from "@/lib/home/payment-line";
import { HOME, notOver } from "@/lib/home/rules";
import { formatMoney } from "@/lib/payments/access";
import { currentSplit } from "@/lib/payments/actions";
import { openPhotosOf } from "@/lib/profiles/photo";

/** What describing a call needs to know besides the call itself. */
export type ListingContext = {
  userId: string;
  /** The moment the list is put together: by it a call counts as finished, and a room as open. */
  drawn: Date;
  paymentsOf: Map<string, Payment[]>;
  /** The photos of the hosts of calls this person booked. */
  photos: Map<string, string>;
  /** About the customers of the calls this person hosts that are not over (`customerDetailsFor`). */
  aboutOf: Awaited<ReturnType<typeof customerDetailsFor>>;
  /** The other person's name, as this person knows them. */
  otherOf: (call: Call) => string;
};

/** Each call as a page draws it: the words and numbers only, never a whole record (plans/43, decision 18). */
export function listedCall(call: Call, context: ListingContext): ListedCall {
  const { userId, drawn, aboutOf } = context;
  const hosting = call.hostId === userId;
  // Over: stopped, cancelled (a late cancellation is charged at once, and that is the host's to see), or past its booked end.
  const finished = Boolean(call.safetyEndedAt) || Boolean(call.cancelledAt) || call.endsAt.getTime() <= drawn.getTime();
  const paid = context.paymentsOf.get(call.id) ?? [];
  // What a finished call earned its host (plans/43, decision 8): her share of each charge, by the one rule for that.
  // Worked out here, and only for a call this person hosted.
  const parts = hosting && finished ? paid.map((payment) => ({ status: payment.status, needsReview: payment.needsReview, shareCents: payment.status === "charged" ? currentSplit(payment).hostShareCents : 0 })) : null;
  const earned = parts ? earnedFrom(parts) : null;
  return {
    id: call.id,
    startsAt: call.startsAt.toISOString(),
    endsAt: call.endsAt.toISOString(),
    minutes: Math.round((call.endsAt.getTime() - call.startsAt.getTime()) / 60_000),
    name: context.otherOf(call),
    // The host's photo for a call this person booked; the customer's for a call they host that is not over, when they are handed one.
    photoId: call.customerId === userId ? (context.photos.get(call.hostId) ?? null) : finished ? null : (aboutOf.get(call.id)?.photoId ?? null),
    hosting,
    open: roomState(call, drawn) === "open",
    finished,
    payment: paymentLine(paid),
    ...(earned ? { earned: { text: formatMoney(earned.cents), cents: earned.cents, soFar: earned.soFar } } : {}),
    ...(parts && unsettled(parts) ? { moneyOpen: true } : {}),
    // Only ever set for a call this person hosts that is not over: `customerDetailsFor` answers for no other.
    // (Not even an empty place for it on any other call: nothing about a customer is named where there is nothing to say.)
    ...(!finished && aboutOf.has(call.id) ? { about: aboutOf.get(call.id)!.details } : {}),
  };
}

/** This person's calls, whichever they are, each described as above. Asks only for what these calls need. */
export async function listCalls(userId: string, calls: Call[], now: Date): Promise<ListedCall[]> {
  if (calls.length === 0) return [];
  // Only the names of the people this person has calls with.
  const otherIds = [...new Set(calls.map((c) => (c.hostId === userId ? c.customerId : c.hostId)))];
  // A customer knows their host by the display name on the host's page, never by the host's account name.
  const myHostIds = [...new Set(calls.filter((c) => c.customerId === userId).map((c) => c.hostId))];
  const [people, hostProfiles, payments, aboutOf, photos] = await Promise.all([
    db.select({ id: schema.user.id, name: schema.user.name }).from(schema.user).where(inArray(schema.user.id, otherIds)),
    myHostIds.length > 0 ? db.select({ userId: schema.hostProfiles.userId, displayName: schema.hostProfiles.displayName }).from(schema.hostProfiles).where(inArray(schema.hostProfiles.userId, myHostIds)) : [],
    db.select().from(schema.payments).where(inArray(schema.payments.callId, calls.map((c) => c.id))),
    // About the customers of the calls this person hosts that are not over, and of no other call (plans/38).
    customerDetailsFor(userId, calls.filter((call) => notOver(call, now)), now),
    // Only of hosts whose page anyone may see now: this list names a host whatever has become of her page.
    openPhotosOf(myHostIds),
  ]);
  const nameOf = new Map(people.map((p) => [p.id, p.name]));
  const hostNameOf = new Map(hostProfiles.map((p) => [p.userId, p.displayName]));
  const drawn = new Date();
  const context: ListingContext = {
    userId,
    drawn,
    paymentsOf: paymentsByCall(payments),
    photos,
    aboutOf,
    // A host is only ever named by the name on her page, never by her account name.
    otherOf: (call) => (call.hostId === userId ? nameOf.get(call.customerId) : hostNameOf.get(call.hostId)) ?? "Unknown",
  };
  return calls.map((call) => listedCall(call, context));
}

const mineOf = (userId: string) => or(eq(schema.calls.hostId, userId), eq(schema.calls.customerId, userId));

/**
 * "Past calls" (plans/36, decision 7): this person's calls that are over, the newest first, a page
 * at a time. Exactly the calls the home page does not hold: cancelled, ended with a report, or
 * with their booked end passed. Never a call the person is not part of.
 */
export async function pastCallRows(userId: string, page: number, now: Date): Promise<{ calls: Call[]; older: boolean }> {
  // One more than a page holds, to know whether there are older ones.
  const found = await db
    .select()
    .from(schema.calls)
    .where(
      and(
        mineOf(userId),
        // The opposite of the home page's "not over" (src/lib/home/rules.ts).
        or(isNotNull(schema.calls.cancelledAt), isNotNull(schema.calls.safetyEndedAt), lte(schema.calls.endsAt, now)),
      ),
    )
    .orderBy(desc(schema.calls.startsAt), desc(schema.calls.id))
    .limit(HOME.pastPerPage + 1)
    .offset((page - 1) * HOME.pastPerPage);
  return { calls: found.slice(0, HOME.pastPerPage), older: found.length > HOME.pastPerPage };
}

/**
 * Every call of this person's that is not over (the home page's own rule), the soonest first, a
 * page at a time: also the ones far ahead, which the home page does not load.
 */
export async function comingCallRows(userId: string, page: number, now: Date): Promise<{ calls: Call[]; later: boolean }> {
  const found = await db
    .select()
    .from(schema.calls)
    .where(and(mineOf(userId), isNull(schema.calls.cancelledAt), isNull(schema.calls.safetyEndedAt), gt(schema.calls.endsAt, now)))
    .orderBy(asc(schema.calls.startsAt), asc(schema.calls.endsAt), asc(schema.calls.id))
    .limit(HOME.pastPerPage + 1)
    .offset((page - 1) * HOME.pastPerPage);
  return { calls: found.slice(0, HOME.pastPerPage), later: found.length > HOME.pastPerPage };
}
