/**
 * What the pages, and the step that starts a tip, read about tips (plans/44). Reading only:
 * nothing here writes anything, and nothing asks Stripe.
 *
 * `tipFacts` reads everything the rule needs (tip-rules.ts, `whyNoTip`) through the reader it is
 * given. The box on a call's results and the start of a tip both use it, so the page can never
 * offer what the server refuses.
 */
import { and, asc, desc, eq, inArray, isNull, ne, or } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Call, Contribution } from "@/db/schema";
import { loadAttendance } from "@/lib/attendance/load";
import { roleOnCall } from "@/lib/calls";
import { stripeConfigured } from "@/lib/payments/stripe";
import { askAfterCall } from "@/lib/projects/ask";
import { myRating, ratingStateOf } from "@/lib/ratings/ratings";
import { isBlockedEitherWay } from "@/lib/safety/block-check";
import { tipsOn } from "@/lib/safety/switches";
import { whyNoTip, type TipFacts } from "./tip-rules";
import { paymentRows, type PaymentRow } from "./views";

type Reader = Pick<typeof db, "select">;

const pays = schema.contributionPayments;
const tips = schema.contributions;

/**
 * Is there a tip for this call that is not certainly gone (decision 5)? Every earlier PAYMENT of a
 * tip for the call is looked at, not the tip's own state: a tip that was marked cancelled is only
 * gone once its payment is "given up" (Stripe has confirmed that the hold is gone, or there never
 * was one), and one whose money was taken after all counts for good, also after a refund.
 */
export async function tipThere(reader: Reader, callId: string): Promise<boolean> {
  const [found] = await reader
    .select({ id: tips.id })
    .from(tips)
    .leftJoin(pays, eq(pays.contributionId, tips.id))
    .where(and(eq(tips.kind, "tip"), eq(tips.callId, callId), or(isNull(pays.id), ne(pays.status, "given_up"))))
    .limit(1);
  return Boolean(found);
}

/**
 * Everything that decides whether this person may give a tip for this call right now (decision 1),
 * read through `reader`. For anyone but the call's customer nothing more is read.
 */
export async function tipFacts(reader: Reader, viewerId: string, call: Call, now: Date): Promise<TipFacts> {
  const role = roleOnCall(call, viewerId);
  const none: TipFacts = { role, rating: "never", reported: false, blocked: false, refundAsked: false, stars: null, tipThere: false, hostCanReceive: false, customerActive: false, tipsOn: false, stripeReady: false, projectBoxShown: false };
  if (role !== "customer") return none;
  const people = await reader.select({ id: schema.user.id, pausedAt: schema.user.pausedAt, closedAt: schema.user.closedAt }).from(schema.user).where(inArray(schema.user.id, [call.hostId, call.customerId]));
  const host = people.find((person) => person.id === call.hostId);
  const customer = people.find((person) => person.id === call.customerId);
  const [page] = await reader
    .select({ status: schema.hostProfiles.status, hidden: schema.hostProfiles.hidden, handle: schema.hostProfiles.handle, displayName: schema.hostProfiles.displayName })
    .from(schema.hostProfiles)
    .where(eq(schema.hostProfiles.userId, call.hostId));
  const [report] = await reader
    .select({ id: schema.reports.id })
    .from(schema.reports)
    .where(or(and(eq(schema.reports.reporterId, call.customerId), eq(schema.reports.reportedId, call.hostId)), and(eq(schema.reports.reporterId, call.hostId), eq(schema.reports.reportedId, call.customerId))))
    .limit(1);
  const [refund] = await reader.select({ id: schema.refundRequests.id }).from(schema.refundRequests).where(eq(schema.refundRequests.callId, call.id)).limit(1);
  // The host's page as everyone may open it (the rule of `publicProfile`): the project's box is only shown then.
  const openPage = page && host && page.status === "approved" && !page.hidden && !host.closedAt ? { handle: page.handle, displayName: page.displayName } : null;
  const attendance = await loadAttendance(call, now, undefined, reader);
  return {
    role,
    // A call ended with the call's button is never asked about money, though it can be rated (plans/51, decisions 20 and 27).
    rating: call.safetyEndedAt ? "never" : await ratingStateOf(call, now, reader),
    reported: Boolean(report),
    blocked: await isBlockedEitherWay(call.customerId, call.hostId, reader),
    refundAsked: Boolean(refund),
    stars: await myRating(call.id, viewerId, reader),
    tipThere: await tipThere(reader, call.id),
    // A page she has hidden from search still counts: the call took place. A suspended or declined one does not.
    hostCanReceive: Boolean(host && page) && !host!.closedAt && !host!.pausedAt && page!.status === "approved",
    customerActive: Boolean(customer) && !customer!.closedAt && !customer!.pausedAt,
    tipsOn: await tipsOn(reader),
    stripeReady: stripeConfigured(),
    projectBoxShown: (await askAfterCall({ role: "customer", call, attendance, hostPage: openPage }, reader)) !== null,
  };
}

/** A tip as a page shows it: the tip, and its one payment with where it stands. */
export type TipView = { tip: Contribution; tipCents: number; row: PaymentRow };

/** Whether a hold was ever in place for this payment, or its money was taken. */
const began = (row: PaymentRow): boolean => row.payment.authorisedAt !== null || row.payment.status === "held" || row.payment.status === "taken";

/**
 * The tip of a call that gets a line on the call's page: the newest one that this viewer may see.
 * The customer sees their tip from its card step on, and one that was held and then cancelled.
 * The host and the founder see a tip only once a hold was in place for it (decision 2): a tip that
 * was started and left at the card step is never shown to her.
 */
export async function tipOfCall(callId: string, role: "host" | "customer" | "admin"): Promise<TipView | null> {
  const found = await db.select().from(tips).where(and(eq(tips.kind, "tip"), eq(tips.callId, callId))).orderBy(desc(tips.createdAt));
  for (const tip of found) {
    const [row] = await paymentRows(tip.id);
    if (!row) continue;
    if (began(row) || (role === "customer" && row.payment.status !== "given_up")) return { tip, tipCents: tip.tipCents ?? tip.amountCents, row };
  }
  return null;
}

/**
 * What the results page of a call shows about tips: the box that asks (for the customer, when the
 * rule says so), and the tip that exists, if this viewer may see one. Only read: showing the box
 * writes nothing.
 */
export async function tipAfterCall(input: { viewerId: string; role: "host" | "customer" | "admin"; call: Call; now: Date }): Promise<{ ask: boolean; tip: TipView | null }> {
  const tip = await tipOfCall(input.call.id, input.role);
  const ask = input.role === "customer" && whyNoTip(await tipFacts(db, input.viewerId, input.call, input.now)) === null;
  return { ask, tip };
}

export type GivenTip = TipView & { hostName: string; callId: string; callStartsAt: Date | null };

/** "Tips you gave": a person's tips, the newest first. One that was left at the card step and never paid is not listed. */
export async function tipsBy(contributorId: string): Promise<GivenTip[]> {
  const rows = await db
    .select({ tip: tips, hostName: schema.hostProfiles.displayName, userName: schema.user.name, callStartsAt: schema.calls.startsAt })
    .from(tips)
    .innerJoin(schema.user, eq(schema.user.id, tips.hostId))
    .leftJoin(schema.hostProfiles, eq(schema.hostProfiles.userId, tips.hostId))
    .leftJoin(schema.calls, eq(schema.calls.id, tips.callId))
    .where(and(eq(tips.kind, "tip"), eq(tips.contributorId, contributorId)))
    .orderBy(desc(tips.createdAt));
  if (rows.length === 0) return [];
  const payments = await db.select().from(pays).where(inArray(pays.contributionId, rows.map((row) => row.tip.id))).orderBy(asc(pays.number));
  const given: GivenTip[] = [];
  for (const row of rows) {
    const payment = payments.find((one) => one.contributionId === row.tip.id);
    if (!payment || !row.tip.callId) continue;
    const view: PaymentRow = { payment, share: null, refundUnderWayCents: 0, refundableCents: 0 };
    if (!began(view) && payment.status === "given_up") continue;
    given.push({ tip: row.tip, tipCents: row.tip.tipCents ?? row.tip.amountCents, row: view, hostName: row.hostName ?? row.userName, callId: row.tip.callId, callStartsAt: row.callStartsAt });
  }
  return given;
}
