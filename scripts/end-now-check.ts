/**
 * Testing tool: "End call now" (plans/51-end-call-now.md), against the local database, the running
 * app and Stripe's test area. It makes its own people, and tidies up after itself.
 *
 * What it proves: who pressed is what was written; how a call is charged in each case (with a real
 * hold and a real charge in Stripe's test area where money moves); what a customer's report after
 * his own press does, and what every other report does not do; the guard at 2 and at 3 of 5, with
 * the founder told once; that nothing reaches the founder's review list; the three choices.
 *
 * Needs: the app running, the test accounts (npm run seed), and test-accounts.local.md in this folder.
 * Usage: npx tsx scripts/end-now-check.ts [--app=http://localhost:3000]
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { and, eq, inArray, like, or } from "drizzle-orm";
import { CARD_CONSENT_VERSION } from "../src/lib/booking/rules";
import { TERMS_VERSION } from "../src/lib/terms";
import { requireLocalDatabase } from "./local-only";

const BASE = process.argv.find((arg) => arg.startsWith("--app="))?.slice("--app=".length).replace(/\/$/, "") ?? "http://localhost:3000";
const RUN = randomUUID().slice(0, 8);
const MIN = 60_000;
const DAY = 24 * 60 * MIN;

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}

type Jar = Map<string, string>;
async function send(path: string, options: { method?: string; body?: unknown; jar?: Jar } = {}) {
  const headers: Record<string, string> = { origin: BASE };
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (options.jar?.size) headers.cookie = [...options.jar].map(([k, v]) => `${k}=${v}`).join("; ");
  const response = await fetch(`${BASE}${path}`, { method: options.method ?? (options.body !== undefined ? "POST" : "GET"), headers, body: options.body !== undefined ? JSON.stringify(options.body) : undefined, redirect: "manual" });
  for (const cookie of response.headers.getSetCookie()) {
    const [pair, ...attrs] = cookie.split(";");
    const at = pair.indexOf("=");
    const name = pair.slice(0, at).trim();
    const value = pair.slice(at + 1);
    if (!value || attrs.some((a) => /max-age=0/i.test(a))) options.jar?.delete(name);
    else options.jar?.set(name, value);
  }
  const text = await response.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = JSON.parse(text);
  } catch {
    // a page
  }
  return { status: response.status, json, text, location: response.headers.get("location") };
}
/** A page's words as a person reads them: no tags, the few marks React writes for quotes put back. */
const words = (html: string) => html.replace(/<!--.*?-->/g, "").replace(/<[^>]+>/g, " ").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");

async function main() {
  if (!process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_")) throw new Error("This script only runs with a Stripe test key.");
  requireLocalDatabase();
  if ((await fetch(`${BASE}/login`).catch(() => null))?.status !== 200) throw new Error(`The app is not running at ${BASE}.`);
  const { db, schema } = await import("../src/db");
  const B = await import("../src/lib/booking/bookings");
  const R = await import("../src/lib/safety/reports");
  const { endCallNow } = await import("../src/lib/safety/calls");
  const { endReportPreview } = await import("../src/lib/safety/end-report");
  const { block } = await import("../src/lib/safety/blocks");
  const { isBlockedEitherWay } = await import("../src/lib/safety/block-check");
  const { owedFor } = await import("../src/lib/payments/owed");
  const { settleOrdinaryCharges } = await import("../src/lib/payments/take");
  const { startHold, syncHold } = await import("../src/lib/payments/hold");
  const { releasePayment } = await import("../src/lib/payments/actions");
  const { reviewChargeLimitCents } = await import("../src/lib/payments/pricing");
  const { stripe } = await import("../src/lib/payments/stripe");
  const { END_WORDS } = await import("../src/lib/call-page/end-words");
  const { REPORT_WORDS } = await import("../src/lib/safety/report-words");
  const { BLOCK_WORDS } = await import("../src/lib/safety/block-words");

  const now = new Date();
  const made: string[] = [];
  const fakeHeld: string[] = [];
  type Person = { id: string; name: string; email: string };
  async function person(name: string): Promise<Person> {
    const id = `en-${RUN}-${name}`;
    const email = `endnowcheck-${RUN}-${name}@example.test`;
    await db.insert(schema.user).values({ id, name: `Check ${name}`, email, emailVerified: true, adultConfirmedAt: now, termsAcceptedAt: now, termsVersion: TERMS_VERSION, timeZone: "America/New_York" });
    made.push(id);
    return { id, name: `Check ${name}`, email };
  }
  /** A host with a page, so that a customer knows her by a display name. */
  async function hostPerson(name: string): Promise<Person & { displayName: string }> {
    const p = await person(name);
    const displayName = `Host ${name}`;
    await db.insert(schema.hostProfiles).values({ userId: p.id, handle: `en${RUN}${name}`, handleKey: `en${RUN}${name}`, displayName, pricePer15Cents: 2000, status: "approved", usConfirmedAt: now });
    return { ...p, displayName };
  }

  const PRICE = 2000; // $20 per 15 minutes: a 30-minute call is $40.00
  type CallRow = typeof schema.calls.$inferSelect;
  const callOf = async (id: string): Promise<CallRow> => (await db.select().from(schema.calls).where(eq(schema.calls.id, id)))[0];
  const pay = async (callId: string) => (await db.select().from(schema.payments).where(eq(schema.payments.callId, callId)))[0];
  /** A booked call. `startsIn`: minutes from now (negative for a call in the past). */
  async function newCall(host: Person, cust: Person, options: { startsIn: number; minutes?: number; price?: number; freeCancelMinutes?: number; billing?: "host" | "together" }): Promise<CallRow> {
    const startsAt = new Date(Math.ceil((Date.now() + options.startsIn * MIN) / 1000) * 1000);
    const { callId } = await B.createTestCall({ hostId: host.id, customerId: cust.id, startsAt, endsAt: new Date(startsAt.getTime() + (options.minutes ?? 30) * MIN), pricePer15Cents: options.price ?? PRICE, freeCancelMinutes: options.freeCancelMinutes ?? 0 });
    if (options.billing === "together") await db.update(schema.calls).set({ billing: "together" }).where(eq(schema.calls.id, callId));
    return callOf(callId);
  }
  /** Places the hold the way the customer's browser would, with one of Stripe's test cards. */
  async function hold(call: CallRow, cust: Person) {
    await startHold({ payment: await pay(call.id), call, customer: cust, now: new Date() });
    await stripe().paymentIntents.confirm((await pay(call.id)).stripePaymentIntentId!, { payment_method: "pm_card_visa", return_url: "https://example.com/return" });
    await syncHold((await pay(call.id)).id, new Date());
    if ((await pay(call.id)).status !== "held") throw new Error("The hold could not be placed in Stripe's test area.");
  }
  /** A hold only in our own record, for the cases where no money has to move: nothing is asked of Stripe, and it is closed again at the end. */
  async function pretendHeld(call: CallRow) {
    const payment = await pay(call.id);
    await db.update(schema.payments).set({ status: "held", heldAt: new Date(), holdExpiresAt: new Date(call.endsAt.getTime() + 5 * DAY) }).where(eq(schema.payments.id, payment.id));
    fakeHeld.push(payment.id);
  }
  /** The room's record, as if the video service had sent it. Offsets are seconds from the call's start; the room is then confirmed closed. */
  async function attend(call: CallRow, visits: Array<["host" | "customer", number, number]>) {
    let n = 0;
    for (const [who, from, to] of visits) {
      const identity = who === "host" ? call.hostId : call.customerId;
      const session = `PA_${who}_${n++}_${randomUUID().slice(0, 6)}`;
      const row = (type: string, offset: number) => ({ provider: "livekit", providerEventId: `EV_${randomUUID()}`, callId: call.id, type, roomSessionId: "RM_endnow", participantIdentity: identity, participantSessionId: session, providerTime: new Date(call.startsAt.getTime() + offset * 1000), payload: "{}" });
      await db.insert(schema.attendanceEvents).values([row("participant_joined", from), row("participant_left", to)]);
    }
    const fresh = await callOf(call.id);
    await db.update(schema.calls).set({ closedAt: new Date((fresh.safetyEndedAt ?? fresh.endsAt).getTime() + 5_000) }).where(eq(schema.calls.id, call.id));
  }
  /** "End call now", pressed `seconds` after the call's start (a pretend clock, as the other money checks use). */
  const press = async (call: CallRow, by: Person, seconds: number) => endCallNow({ call: await callOf(call.id), by: by.id, now: new Date(call.startsAt.getTime() + seconds * 1000) });
  /** The moment the money of a call is taken when nobody asked for a refund: 24 hours and 3 minutes after its start. */
  const takenAt = (call: CallRow) => new Date(call.startsAt.getTime() + DAY + 3 * MIN);
  const take = async (call: CallRow) => settleOrdinaryCharges(call.id, takenAt(call));
  const owed = async (call: CallRow) => owedFor(await callOf(call.id), await pay(call.id), takenAt(call));
  const cents = async (call: CallRow) => {
    const result = await owed(call);
    return result.is === "amount" ? `${result.cents} ${result.reason}` : result.is;
  };
  /** Marks a call's payment as charged in full, in our own record only (no money moves): a normal call that was paid for. */
  const paidInFull = async (call: CallRow) => db.update(schema.payments).set({ status: "charged", chargedCents: 4000, chargeReason: "attendance", chargedAt: new Date(), transferStatus: "not_owed" }).where(eq(schema.payments.callId, call.id));
  const report = (reporter: Person, callId: string, at = new Date()) => R.createReport({ reporterId: reporter.id, context: "call", contextId: callId, reason: "other", text: "Check.", now: at });
  const messagesLike = async (key: string) => db.select().from(schema.messages).where(like(schema.messages.key, key));

  try {
    // ----------------------------------------------------------------------
    console.log("\n1. The press: who pressed is what was written");
    {
      const host = await hostPerson("h1");
      const cust = await person("c1");
      const open = await newCall(host, cust, { startsIn: 2, price: 0 });
      const first = await endCallNow({ call: open, by: cust.id, now: new Date() });
      const row = await callOf(open.id);
      check("the customer presses: the call is ended, by him, in his role (a free call: nothing about a whole booking holds for it)", first.state === "ended" && first.byMe && first.by === "customer" && !first.old && row.safetyEndedAt !== null && row.safetyEndedBy === cust.id && row.endedNowBy === "customer_untold", JSON.stringify(first));
      const again = await endCallNow({ call: open, by: cust.id, now: new Date() });
      check("pressed again by the same person: the same answer, and nothing is rewritten", again.state === "ended" && again.byMe && again.by === "customer" && (await callOf(open.id)).safetyEndedAt?.getTime() === row.safetyEndedAt?.getTime());
      const other = await endCallNow({ call: open, by: host.id, now: new Date() });
      check("pressed by the other person afterwards: told the truth, the customer ended it", other.state === "ended" && !other.byMe && other.by === "customer" && (await callOf(open.id)).safetyEndedBy === cust.id, JSON.stringify(other));

      const race = await newCall(host, cust, { startsIn: 40, price: 0 });
      const at = new Date(race.startsAt.getTime() + 60_000);
      const [a, b] = await Promise.all([endCallNow({ call: race, by: host.id, now: at }), endCallNow({ call: race, by: cust.id, now: at })]);
      const raced = await callOf(race.id);
      const winner = raced.safetyEndedBy === host.id ? "host" : "customer";
      check("both press in the same moment: one is written, and both are told who", a.state === "ended" && b.state === "ended" && a.byMe !== b.byMe && a.by === winner && b.by === winner && (raced.endedNowBy ?? "").startsWith(winner), `${JSON.stringify(a)} ${JSON.stringify(b)}`);

      const ahead = await newCall(host, cust, { startsIn: 3 * 60, price: 0 });
      const early = await endCallNow({ call: ahead, by: cust.id, now: new Date() });
      check("a call whose room is not open yet: refused, nothing written", early.state === "not_open_yet" && (await callOf(ahead.id)).safetyEndedAt === null);
      const past = await newCall(host, cust, { startsIn: -90, price: 0 });
      const late = await endCallNow({ call: past, by: cust.id, now: new Date() });
      check("a call whose room had closed already: nothing written, it was simply over", late.state === "over" && (await callOf(past.id)).safetyEndedAt === null && (await callOf(past.id)).endedNowBy === null);
      const gone = await newCall(host, cust, { startsIn: 80, price: 0 });
      await db.update(schema.calls).set({ cancelledAt: new Date(), cancelledBy: "host" }).where(eq(schema.calls.id, gone.id));
      const cancelled = await endCallNow({ call: gone, by: cust.id, now: new Date(gone.startsAt.getTime() + 60_000) });
      check("a cancelled call is not ended on top", cancelled.state === "over" && (await callOf(gone.id)).safetyEndedAt === null);
      const stranger = await person("s1");
      const notMine = await endCallNow({ call: await newCall(host, cust, { startsIn: 120, price: 0 }), by: stranger.id, now: new Date(Date.now() + 121 * MIN) });
      check("someone who is not on the call ends nothing", notMine.state === "over");

      // Time was added a moment ago: the page still holds the old end, the row has the new one. The press goes by the row.
      const longer = await newCall(host, cust, { startsIn: 160, minutes: 10, price: 0 });
      await db.update(schema.calls).set({ endsAt: new Date(longer.endsAt.getTime() + 10 * MIN) }).where(eq(schema.calls.id, longer.id));
      const inAdded = await endCallNow({ call: longer, by: host.id, now: new Date(longer.endsAt.getTime() + MIN) });
      check("pressed during time that was added a moment ago: the room's times are read from the call itself", inAdded.state === "ended" && inAdded.by === "host" && (await callOf(longer.id)).endedNowBy === "host", JSON.stringify(inAdded));

      // A call ended with the earlier button keeps its mark; a press afterwards says so and changes nothing.
      const old = await newCall(host, cust, { startsIn: 260, price: 0 });
      await db.update(schema.calls).set({ safetyEndedAt: new Date(old.startsAt.getTime() + MIN), safetyEndedBy: host.id }).where(eq(schema.calls.id, old.id));
      const onOld = await endCallNow({ call: old, by: cust.id, now: new Date(old.startsAt.getTime() + 2 * MIN) });
      check('a call ended with the earlier "End call and report" stays as it is', onOld.state === "ended" && onOld.old && onOld.by === "host" && !onOld.byMe && (await callOf(old.id)).endedNowBy === null, JSON.stringify(onOld));
    }

    // ----------------------------------------------------------------------
    console.log("\n2. The money, with real holds and charges in Stripe's test area");
    {
      const host = await hostPerson("h2");
      const cust = await person("c2");
      // Every call is 30 minutes at $20 per 15 minutes ($40.00) and is ended 10 minutes in.
      const hostEnds = await newCall(host, cust, { startsIn: 10 });
      const custEnds = await newCall(host, cust, { startsIn: 50 });
      const hostLate = await newCall(host, cust, { startsIn: 90 });
      const noShow = await newCall(host, cust, { startsIn: 130 });
      const instant = await newCall(host, cust, { startsIn: 170, billing: "together" });
      const tiny = await newCall(host, cust, { startsIn: 210 });
      for (const call of [hostEnds, custEnds, hostLate, noShow, instant, tiny]) await hold(call, cust);
      const capturable = await Promise.all([hostEnds, custEnds, hostLate, noShow, instant, tiny].map(async (call) => (await stripe().paymentIntents.retrieve((await pay(call.id)).stripePaymentIntentId!)).amount_capturable));
      check("each call has $40.00 held on the card", capturable.every((amount) => amount === 4000), capturable.join());

      await press(hostEnds, host, 600);
      await attend(hostEnds, [["host", 0, 601], ["customer", 0, 601]]);
      await press(custEnds, cust, 600);
      await attend(custEnds, [["host", 0, 601], ["customer", 0, 601]]);
      await press(hostLate, cust, 600);
      await attend(hostLate, [["host", 120, 601], ["customer", 0, 601]]);
      await press(noShow, cust, 600);
      await attend(noShow, [["customer", 0, 601]]);
      await press(instant, cust, 600);
      await attend(instant, [["host", 0, 601], ["customer", 60, 601]]);
      await press(tiny, host, 10);
      await attend(tiny, [["host", 0, 11], ["customer", 0, 11]]);
      const all = [hostEnds, custEnds, hostLate, noShow, instant, tiny];
      check("the press puts nothing on the founder's review list", (await Promise.all(all.map((call) => pay(call.id)))).every((p) => p.needsReview === false && p.status === "held"));

      check("the host ended it: her 10 minutes, $13.33", (await cents(hostEnds)) === "1333 attendance", await cents(hostEnds));
      check("the customer ended it: the whole booking, $40.00", (await cents(custEnds)) === "4000 customer_ended", await cents(custEnds));
      check("the customer ended it and the host had come 2 minutes late: her 8 minutes and the rest, $37.33, not the minutes he waited", (await cents(hostLate)) === "3733 customer_ended", await cents(hostLate));
      check("the customer ended it and the host never came: nothing", (await cents(noShow)) === "0 attendance", await cents(noShow));
      check('an "available now" call: the 9 minutes both were in, $12.00, whoever ends', (await cents(instant)) === "1200 attendance", await cents(instant));
      check("under 50 cents: nothing", (await cents(tiny)) === "0 attendance", await cents(tiny));

      for (const call of all) {
        await settleOrdinaryCharges(call.id, new Date(takenAt(call).getTime() - 5 * MIN));
      }
      check("a few minutes before the planned moment nothing is taken yet", (await Promise.all(all.map((call) => pay(call.id)))).every((p) => p.status === "held"));
      for (const call of all) await take(call);
      const charged = async (call: CallRow) => {
        const p = await pay(call.id);
        const intent = await stripe().paymentIntents.retrieve(p.stripePaymentIntentId!);
        return `${p.status} ${p.chargedCents ?? "-"} ${p.chargeReason ?? "-"} ${intent.status} ${intent.amount_received}`;
      };
      check("the host ended it: Stripe took $13.33", (await charged(hostEnds)) === "charged 1333 attendance succeeded 1333", await charged(hostEnds));
      check("the customer ended it: Stripe took the whole $40.00, and the charge says why", (await charged(custEnds)) === "charged 4000 customer_ended succeeded 4000", await charged(custEnds));
      check("the host came late: Stripe took $37.33", (await charged(hostLate)) === "charged 3733 customer_ended succeeded 3733", await charged(hostLate));
      check("the host never came: nothing was taken, and the hold was let go", (await charged(noShow)) === "closed_uncharged - - canceled 0", await charged(noShow));
      check('"available now": Stripe took $12.00', (await charged(instant)) === "charged 1200 attendance succeeded 1200", await charged(instant));
      check("under 50 cents: the hold was let go", (await charged(tiny)) === "closed_uncharged - - canceled 0", await charged(tiny));
      check("none of them was ever under review", (await Promise.all(all.map((call) => pay(call.id)))).every((p) => p.needsReview === false));
      const taken = await pay(custEnds.id);
      check("the whole-booking charge keeps the host's real time (10 minutes), for its receipt and for a bank dispute", taken.frozenHostSeconds === 600 && taken.originalHostShareCents !== null && taken.originalFeeCents! + taken.originalHostShareCents! === 4000, `${taken.frozenHostSeconds}`);
      await take(custEnds);
      check("taking it again changes nothing", (await charged(custEnds)) === "charged 4000 customer_ended succeeded 4000");
    }

    // ----------------------------------------------------------------------
    console.log("\n3. The edges of the rule (our own record only: no money moves)");
    {
      const host = await hostPerson("h3");
      const cust = await person("c3");
      const leftEarly = await newCall(host, cust, { startsIn: -400 });
      const justLeft = await newCall(host, cust, { startsIn: -360 });
      const freeBefore = await newCall(host, cust, { startsIn: -320, freeCancelMinutes: 0 });
      const lateBefore = await newCall(host, cust, { startsIn: -280, freeCancelMinutes: 60 });
      const hostBefore = await newCall(host, cust, { startsIn: -240, freeCancelMinutes: 60 });
      const atEnd = await newCall(host, cust, { startsIn: -200 });
      for (const call of [leftEarly, justLeft, freeBefore, lateBefore, hostBefore, atEnd]) await pretendHeld(call);

      await press(leftEarly, cust, 600);
      await attend(leftEarly, [["host", 0, 300], ["customer", 0, 601]]);
      check("the host had left 5 minutes before he pressed: only her 5 minutes, $6.67", (await cents(leftEarly)) === "667 attendance", await cents(leftEarly));
      await press(justLeft, cust, 600);
      await attend(justLeft, [["host", 0, 560], ["customer", 0, 601]]);
      check("her connection dropped 40 seconds before he pressed: she counts as there, her 9 minutes 20 and the rest, $39.11", (await cents(justLeft)) === "3911 customer_ended", await cents(justLeft));
      await press(freeBefore, cust, -120);
      await attend(freeBefore, [["host", -200, -119], ["customer", -200, -119]]);
      check("he pressed 2 minutes before the start, where cancelling was still free: nothing", (await cents(freeBefore)) === "0 attendance", await cents(freeBefore));
      check("and a report after that has nothing to lower: it decides and counts nothing", (await endReportPreview(await callOf(freeBefore.id), cust.id, new Date())) === null);
      await press(lateBefore, cust, -120);
      await attend(lateBefore, [["customer", -200, -119]]);
      check("he pressed 2 minutes before the start, where cancelling would have cost the booking: the whole $40.00", (await cents(lateBefore)) === "4000 customer_ended", await cents(lateBefore));
      await press(hostBefore, host, -120);
      await attend(hostBefore, [["host", -200, -119]]);
      check("the host pressed before the start: nothing, whatever her cancelling rule", (await cents(hostBefore)) === "0 attendance", await cents(hostBefore));
      await press(atEnd, cust, 1790);
      await attend(atEnd, [["host", 0, 1791], ["customer", 0, 1791]]);
      check("he pressed 10 seconds before the end: the booked price and never more", (await cents(atEnd)) === "4000 customer_ended", await cents(atEnd));

      // Time was added, then the call was ended: each stretch has its own payment and follows the same rule.
      const added = async (by: "host" | "customer") => {
        const call = await newCall(host, cust, { startsIn: by === "host" ? -160 : -100, minutes: 10 });
        await pretendHeld(call);
        const own = await pay(call.id);
        const [extension] = await db.insert(schema.callExtensions).values({ callId: call.id, minutes: 10, oldEndsAt: call.endsAt, newEndsAt: new Date(call.endsAt.getTime() + 10 * MIN), priceCents: 1333, status: "accepted", decidedAt: call.endsAt }).returning();
        await db.update(schema.calls).set({ endsAt: extension.newEndsAt }).where(eq(schema.calls.id, call.id));
        const [extra] = await db
          .insert(schema.payments)
          .values({ ...own, id: randomUUID(), extensionId: extension.id, coversFrom: extension.oldEndsAt, coversUntil: extension.newEndsAt, bookedCents: 1333, stripePaymentIntentId: null })
          .returning();
        fakeHeld.push(extra.id);
        // Ended 6 minutes into the 10 added minutes, with both there all along.
        await press(call, by === "host" ? host : cust, 16 * 60);
        await attend(call, [["host", 0, 961], ["customer", 0, 961]]);
        const fresh = await callOf(call.id);
        const said = async (payment: typeof own) => {
          const result = await owedFor(fresh, payment, takenAt(call));
          return result.is === "amount" ? `${result.cents} ${result.reason}` : result.is;
        };
        return `${await said(own)} / ${await said(extra)}`;
      };
      check("the host ended it 6 minutes into 10 added minutes: the first 10 minutes in full, and $8.00 of the added time", (await added("host")) === "1333 attendance / 800 attendance");
      check("the customer ended it there: the first 10 minutes, and all of the added time he asked for, $13.33", (await added("customer")) === "1333 attendance / 1333 customer_ended");
    }

    // ----------------------------------------------------------------------
    console.log("\n4. The customer's report after his own press");
    {
      const host = await hostPerson("h4");
      const other = await hostPerson("h4b");
      const third = await hostPerson("h4c");
      const fourth = await hostPerson("h4d");
      const fifth = await hostPerson("h4e");
      const cust = await person("c4");
      // With a real hold: he ends the call 10 minutes in, reports the host, and Stripe takes only the 10 minutes.
      const real = await newCall(host, cust, { startsIn: 12 });
      await hold(real, cust);
      await press(real, cust, 600);
      await attend(real, [["host", 0, 601], ["customer", 0, 601]]);
      check("before a report: the whole booking, $40.00", (await cents(real)) === "4000 customer_ended");
      check("and a report would lower it, which is what the screen may say", (await endReportPreview(await callOf(real.id), cust.id, new Date()))?.effect === "minutes");
      const sent = await report(cust, real.id);
      const after = await callOf(real.id);
      check("his report from that call is written on the call as: charged by the minutes", sent.endEffect === "minutes" && after.endReportEffect === "minutes" && after.endReportAt !== null, String(after.endReportEffect));
      check("the report blocks, as everywhere", sent.block === "done" && (await isBlockedEitherWay(cust.id, host.id)));
      check("the thank-you says what it did to the charge", (await import("../src/lib/safety/report-words")).reportNotice(sent).notice.endsWith(END_WORDS.thanksLowered));
      check("now the record gives the 10 minutes, $13.33", (await cents(real)) === "1333 attendance", await cents(real));
      await take(real);
      const p = await pay(real.id);
      const intent = await stripe().paymentIntents.retrieve(p.stripePaymentIntentId!);
      check("Stripe took $13.33, with nothing on the founder's review list", p.status === "charged" && p.chargedCents === 1333 && p.chargeReason === "attendance" && !p.needsReview && intent.amount_received === 1333, `${p.status} ${p.chargedCents}`);
      const second = await report(cust, real.id);
      check("a second report about the same call decides nothing more", second.endEffect === null && (await callOf(real.id)).endReportEffect === "minutes");

      // The host pressed, and the customer reports: the minutes either way, and nothing is written.
      const hostPressed = await newCall(other, cust, { startsIn: -300 });
      await pretendHeld(hostPressed);
      await press(hostPressed, other, 600);
      await attend(hostPressed, [["host", 0, 601], ["customer", 0, 601]]);
      const whenHost = await report(cust, hostPressed.id);
      check("the host had pressed: his report changes nothing about the money", whenHost.endEffect === null && (await callOf(hostPressed.id)).endReportEffect === null && (await cents(hostPressed)) === "1333 attendance");

      // The customer pressed, and the HOST reports him: the whole booking stays.
      const hostReports = await newCall(third, cust, { startsIn: -260 });
      await pretendHeld(hostReports);
      await press(hostReports, cust, 600);
      await attend(hostReports, [["host", 0, 601], ["customer", 0, 601]]);
      const byHost = await report(third, hostReports.id);
      check("a report by the host changes nothing about the money: the whole booking stays", byHost.endEffect === null && (await callOf(hostReports.id)).endReportEffect === null && (await cents(hostReports)) === "4000 customer_ended");

      // A report made from her page, not from the call, decides nothing.
      const elsewhere = await newCall(fourth, cust, { startsIn: -220 });
      await pretendHeld(elsewhere);
      await press(elsewhere, cust, 600);
      await attend(elsewhere, [["host", 0, 601], ["customer", 0, 601]]);
      const fromPage = await R.createReport({ reporterId: cust.id, context: "profile", contextId: `en${RUN}h4d`, reason: "other", text: "Check.", now: new Date() });
      check("a report made from the host's page, not from the call, decides nothing about the call", fromPage.endEffect === null && (await callOf(elsewhere.id)).endReportEffect === null && (await cents(elsewhere)) === "4000 customer_ended");

      // After the money was taken a report changes nothing by itself.
      const tooLate = await newCall(fifth, cust, { startsIn: -180 });
      await pretendHeld(tooLate);
      await press(tooLate, cust, 600);
      await attend(tooLate, [["host", 0, 601], ["customer", 0, 601]]);
      await db.update(schema.payments).set({ status: "charged", chargedCents: 4000, chargeReason: "customer_ended", chargedAt: new Date() }).where(eq(schema.payments.id, (await pay(tooLate.id)).id));
      const lateReport = await report(cust, tooLate.id);
      check("after the money was taken, a report decides nothing by itself (the refund paths remain), and he is told so", lateReport.endEffect === null && lateReport.endTooLate && (await callOf(tooLate.id)).endReportEffect === null && (await pay(tooLate.id)).chargedCents === 4000 && (await endReportPreview(await callOf(tooLate.id), cust.id, new Date())) === null && (await import("../src/lib/safety/report-words")).reportNotice(lateReport).notice.endsWith(END_WORDS.thanksTooLate));

      // His card step was begun before the press and its hold is not recorded yet when he reports (the bank's approval
      // may still arrive): the report is taken into account all the same, so that hold cannot be charged in full afterwards.
      const seventh = await hostPerson("h4g");
      const stillOpen = await newCall(seventh, cust, { startsIn: -100 });
      await db.update(schema.payments).set({ stripePaymentIntentId: `pi_endnowcheck_${RUN}` }).where(eq(schema.payments.callId, stillOpen.id));
      fakeHeld.push((await pay(stillOpen.id)).id);
      await press(stillOpen, cust, 600);
      await attend(stillOpen, [["host", 0, 601], ["customer", 0, 601]]);
      const whileOpen = await report(cust, stillOpen.id);
      check("a report made while a card step that was begun is still open is written on the call: charged by the minutes", (await pay(stillOpen.id)).status === "awaiting_payment" && (whileOpen.endEffect === "minutes" || whileOpen.endEffect === "minutes_uncounted") && (await callOf(stillOpen.id)).endReportEffect === whileOpen.endEffect, String(whileOpen.endEffect));
      // A call whose card step was never begun cannot be paid for any more: a report has nothing to lower, and says nothing about money.
      const tenth = await hostPerson("h4j");
      const neverPaid = await newCall(tenth, cust, { startsIn: -460 });
      await press(neverPaid, cust, 600);
      const onUnpaid = await report(cust, neverPaid.id);
      check("a report about a call that was never paid for decides nothing, counts nothing, and says nothing about money", onUnpaid.endEffect === null && !onUnpaid.endTooLate && (await callOf(neverPaid.id)).endReportEffect === null);

      // He was never told that it costs the whole booking: his booking was made under the earlier words. The call is
      // charged by the host's time, as he was told. (Only the booking's own words decide this, never the page or the
      // address the press came from.)
      const eighth = await hostPerson("h4h");
      const oldWords = await newCall(eighth, cust, { startsIn: -60 });
      await pretendHeld(oldWords);
      await db.update(schema.bookings).set({ cardConsentVersion: "2026-11-c" }).where(eq(schema.bookings.callId, oldWords.id));
      await press(oldWords, cust, 600);
      await attend(oldWords, [["host", 0, 601], ["customer", 0, 601]]);
      check("a booking made under the earlier words: his press is written as 'not told', and he pays for the host's 10 minutes only", (await callOf(oldWords.id)).endedNowBy === "customer_untold" && (await cents(oldWords)) === "1333 attendance" && (await endReportPreview(await callOf(oldWords.id), cust.id, new Date())) === null, `${(await callOf(oldWords.id)).endedNowBy} ${await cents(oldWords)}`);
      // A call ended with the earlier button: its money is the founder's, and a report decides nothing.
      const sixth = await hostPerson("h4f");
      const old = await newCall(sixth, cust, { startsIn: -140 });
      await pretendHeld(old);
      await db.update(schema.calls).set({ safetyEndedAt: new Date(old.startsAt.getTime() + 600_000), safetyEndedBy: cust.id }).where(eq(schema.calls.id, old.id));
      await db.update(schema.payments).set({ needsReview: true, reviewReason: "The call was ended with \"End call and report\". Decide the amount after reading the report." }).where(eq(schema.payments.id, (await pay(old.id)).id));
      await attend(old, [["host", 0, 601], ["customer", 0, 601]]);
      const onOld = await report(cust, old.id);
      await settleOrdinaryCharges(old.id, takenAt(old));
      const oldRow = await callOf(old.id);
      const oldPay = await pay(old.id);
      check('a call ended with the earlier "End call and report" keeps its review and its ceiling', onOld.endEffect === null && oldRow.endReportEffect === null && oldPay.needsReview && oldPay.status === "held" && reviewChargeLimitCents({ pricePer15Cents: PRICE, coversFrom: oldPay.coversFrom, coversUntil: oldPay.coversUntil, callEndsAt: oldRow.endsAt, safetyEndedAt: oldRow.safetyEndedAt }) === 1333);
    }

    // ----------------------------------------------------------------------
    console.log("\n5. The guard: three of the last five");
    {
      const cust = await person("c5");
      const admins = await db.select({ id: schema.admins.userId }).from(schema.admins);
      const founderTold = async () => (await messagesLike(`end-guard:${cust.id}:%`)).length;
      const custTold = async (callId: string) => (await messagesLike(`end-report-whole:${callId}`)).length;
      let n = 0;
      let slot = -3000;
      /** A booked call of his with a host of its own, that took place: both there, ended by him 10 minutes in (or run to its end). */
      const call = async (ended: boolean) => {
        const host = await hostPerson(`g${n++}`);
        const made = await newCall(host, cust, { startsIn: (slot += 40) });
        await pretendHeld(made);
        if (ended) await press(made, cust, 600);
        await attend(made, ended ? [["host", 0, 601], ["customer", 0, 601]] : [["host", 0, 1800], ["customer", 0, 1800]]);
        // A call that ran to its end and was paid for: only such a call, or one that carries a report, is one of "his last 5".
        if (!ended) await paidInFull(made);
        return { call: made, host };
      };
      const endedAndReported = async () => {
        const one = await call(true);
        const sent = await report(cust, one.call.id);
        return { ...one, sent };
      };

      const somebody = await person("c5other");
      /** Another person's call with that host: it took place (both there), or it was only ever booked. */
      const theirCall = async (host: Person, tookPlace: boolean) => {
        const theirs = await newCall(host, somebody, { startsIn: (slot += 40) });
        // "Took place" here means it was really paid for: a call that cost that person nothing proves nothing.
        if (tookPlace) {
          await attend(theirs, [["host", 0, 1800], ["customer", 0, 1800]]);
          await paidInFull(theirs);
        } else {
          // Both in the room for a moment, and nothing charged: anyone can arrange that.
          await attend(theirs, [["host", 0, 5], ["customer", 0, 5]]);
        }
        return theirs;
      };

      // His first. Somebody else has reported that host from a call that cost them nothing (both in the room for a moment): that changes nothing.
      const firstCall = await call(true);
      await report(somebody, (await theirCall(firstCall.host, false)).id);
      const first = await report(cust, firstCall.call.id);
      check("his first report after ending a call lowers the charge, is counted, and tells nobody", first.endEffect === "minutes" && (await founderTold()) === 0, String(first.endEffect));
      check("(a report by someone else from a call that cost them nothing does not make his uncounted)", (await callOf(firstCall.call.id)).endReportEffect === "minutes");

      // A host that another person has also reported, from a call of their own that took place: lowered, and not counted.
      const reportedHost = await call(true);
      await report(somebody, (await theirCall(reportedHost.host, true)).id);
      const uncounted = await report(cust, reportedHost.call.id);
      check("a report about a host another person has also reported from a call they really paid for: lowered, and not counted", uncounted.endEffect === "minutes_uncounted" && (await cents(reportedHost.call)) === "1333 attendance", String(uncounted.endEffect));
      check("what he reads is the same as for any lowered report: nothing tells him about other people's reports", (await import("../src/lib/safety/report-words")).reportNotice(uncounted).notice.replace(/R-\d+/, "R-0") === (await import("../src/lib/safety/report-words")).reportNotice(first).notice.replace(/R-\d+/, "R-0"));

      // The next. Somebody else has reported this host's PAGE, which anyone can do: that changes nothing either.
      const secondCall = await call(true);
      await R.createReport({ reporterId: somebody.id, context: "profile", contextId: `en${RUN}g${n - 1}`, reason: "other", text: "Check.", now: new Date() });
      const second = await report(cust, secondCall.call.id);
      check("2 of 5 (the one that did not count is not one of them): lowered, counted, and still nobody is told", second.endEffect === "minutes" && (await founderTold()) === 0 && (await cents(secondCall.call)) === "1333 attendance", String(second.endEffect));
      const third = await endedAndReported();
      const told = await messagesLike(`end-guard:${cust.id}:%`);
      check("3 of 5: lowered, and the founder is told once, in the app and by email", third.sent.endEffect === "minutes" && told.length === admins.length && told.length > 0, `${told.length} of ${admins.length}`);
      check("what the founder reads names the customer and no detail of any report", told.every((m) => m.subject === END_WORDS.founderSubject && m.body.includes(cust.name) && m.body.includes("3 times among their last 5 calls") && !m.body.includes("Check.") && !/Host g\d/.test(m.body) && m.path === "/admin/reports"));
      check("with its email", (await db.select().from(schema.emailOutbox).where(like(schema.emailOutbox.dedupeKey, `end-guard:${cust.id}:%`))).length === admins.length);

      // Past the line. This host, too, was reported by somebody else from a call that took place: it makes no difference now.
      const fourthCall = await call(true);
      await report(somebody, (await theirCall(fourthCall.host, true)).id);
      check("past the line, the screen no longer promises a lower charge", (await endReportPreview(await callOf(fourthCall.call.id), cust.id, new Date()))?.effect === "whole");
      const fourth = await report(cust, fourthCall.call.id);
      check("the next report is not lowered: the whole booking is charged, whoever else has reported that host", fourth.endEffect === "whole" && (await callOf(fourthCall.call.id)).endReportEffect === "whole" && (await cents(fourthCall.call)) === "4000 customer_ended", await cents(fourthCall.call));
      check("the report and the block still go through", fourth.block === "done" && (await isBlockedEitherWay(cust.id, fourthCall.host.id)) && (await db.select().from(schema.reports).where(eq(schema.reports.reference, fourth.reference))).length === 1);
      const toCust = await messagesLike(`end-report-whole:${fourthCall.call.id}`);
      check("the customer is told at once, plainly, by the name he knows the host by, without being accused", toCust.length === 1 && toCust[0].userId === cust.id && toCust[0].body.includes(fourthCall.host.displayName) && toCust[0].body.includes("It does not change what the call you ended is charged") && !/abus|fraud|cheat|false/i.test(toCust[0].body) && toCust[0].path === `/calls/${fourthCall.call.id}/results`);
      check("and the thank-you after the report says the same", (await import("../src/lib/safety/report-words")).reportNotice(fourth).notice.endsWith(END_WORDS.thanksNotLowered));
      check("the founder is not told again", (await founderTold()) === admins.length && (await custTold(reportedHost.call.id)) === 0);

      // Normal calls push the old ones out of "his last 5".
      await call(false);
      await call(false);
      await call(false);
      const later = await endedAndReported();
      check("after normal calls have pushed the old ones out, a report lowers the charge again", later.sent.endEffect === "minutes" && (await founderTold()) === admins.length, String(later.sent.endEffect));

      // Reports made newest first decide the same: what counts is what stands on his calls, not the order he reports in.
      const rev = await person("c5rev");
      let slotRev = -3000;
      const revCalls: CallRow[] = [];
      for (let i = 0; i < 4; i++) {
        const host = await hostPerson(`r${n++}`);
        const made = await newCall(host, rev, { startsIn: (slotRev += 40) });
        await pretendHeld(made);
        await press(made, rev, 600);
        await attend(made, [["host", 0, 601], ["customer", 0, 601]]);
        revCalls.push(made);
      }
      const reversed: Array<string | null> = [];
      for (const made of [...revCalls].reverse()) reversed.push((await report(rev, made.id)).endEffect);
      check("four ended calls reported newest first: three are lowered, the fourth is not, as in any other order", reversed.join() === "minutes,minutes,minutes,whole", reversed.join());
      check("and the founder is told of that customer once", (await messagesLike(`end-guard:${rev.id}:%`)).length === admins.length);

      // "Available now" calls are not among his last 5: they cannot push anything out.
      const fresh = await person("c5b");
      let slot2 = -3000;
      const quick = async (kind: "reported" | "instant") => {
        const host = await hostPerson(`q${n++}`);
        const made = await newCall(host, fresh, { startsIn: (slot2 += 40), billing: kind === "instant" ? "together" : "host" });
        await pretendHeld(made);
        if (kind === "reported") await press(made, fresh, 600);
        await attend(made, [["host", 0, 601], ["customer", 0, 601]]);
        if (kind !== "reported") await paidInFull(made);
        return kind === "reported" ? (await report(fresh, made.id)).endEffect : null;
      };
      const three = [await quick("reported"), await quick("reported"), await quick("reported")];
      for (let i = 0; i < 4; i++) await quick("instant");
      // Nor does a booked call that cost him nothing (both joined for a moment, nothing was charged).
      for (let i = 0; i < 4; i++) {
        const host = await hostPerson(`q${n++}`);
        const made = await newCall(host, fresh, { startsIn: (slot2 += 40) });
        await pretendHeld(made);
        await attend(made, [["host", 0, 5], ["customer", 0, 5]]);
      }
      check('"available now" calls, and booked calls that cost nothing, do not push anything out of his last 5', three.join() === "minutes,minutes,minutes" && (await quick("reported")) === "whole");
      // Past the line, reports on calls that then cost nothing (the host never came) are not lowered and are no part of
      // his history either: they cannot push the counted ones out.
      const noShows: Array<string | null> = [];
      for (let i = 0; i < 2; i++) {
        const host = await hostPerson(`q${n++}`);
        const made = await newCall(host, fresh, { startsIn: (slot2 += 40) });
        await pretendHeld(made);
        await press(made, fresh, 600);
        await attend(made, [["customer", 0, 601]]);
        noShows.push((await report(fresh, made.id)).endEffect);
      }
      check("two reports past the line on calls that cost nothing do not clear it: the next real one is still not lowered", noShows.join() === "whole,whole" && (await quick("reported")) === "whole", noShows.join());

      // Two reports in the same moment cannot both slip under the line.
      const twin = await person("c5c");
      let slot3 = -3000;
      const twinCall = async () => {
        const host = await hostPerson(`t${n++}`);
        const made = await newCall(host, twin, { startsIn: (slot3 += 40) });
        await pretendHeld(made);
        await press(made, twin, 600);
        await attend(made, [["host", 0, 601], ["customer", 0, 601]]);
        return made;
      };
      await report(twin, (await twinCall()).id);
      await report(twin, (await twinCall()).id);
      const [x, y, z] = [await twinCall(), await twinCall(), await twinCall()];
      const together = await Promise.all([report(twin, x.id), report(twin, y.id), report(twin, z.id)]);
      const effects = together.map((sent) => sent.endEffect).sort().join();
      check("three reports in the same moment, with two already lowered: one more is lowered, the others are not", effects === "minutes,whole,whole", effects);
      check("and the founder is told of that customer once", (await messagesLike(`end-guard:${twin.id}:%`)).length === admins.length);
    }

    // ----------------------------------------------------------------------
    console.log("\n6. The screen after the press, and the pages, as the test host and the test customer");
    {
      const lines = readFileSync("test-accounts.local.md", "utf8").split("\n");
      const passwordOf = (email: string) => lines.find((l) => l.includes(email))?.split("|").map((c) => c.trim())[3] ?? "";
      const [hana] = await db.select().from(schema.user).where(eq(schema.user.email, "host@test.local"));
      const [cory] = await db.select().from(schema.user).where(eq(schema.user.email, "customer@test.local"));
      if (!hana || !cory) throw new Error("Run `npm run seed` first.");
      const [hanaPage] = await db.select().from(schema.hostProfiles).where(eq(schema.hostProfiles.userId, hana.id));
      const login = async (email: string) => {
        const jar: Jar = new Map();
        const answer = await send("/api/auth/sign-in/email", { body: { email, password: passwordOf(email) }, jar });
        if (answer.status !== 200) throw new Error(`Could not log in as ${email}: ${answer.status}`);
        return jar;
      };
      const coryJar = await login("customer@test.local");
      const hanaJar = await login("host@test.local");
      const madeHere: string[] = [];
      /** A call between the two test accounts, put straight into the database (they may have other calls at any time). */
      const direct = async (price: number, startsIn: number) => {
        const startsAt = new Date(Math.ceil((Date.now() + startsIn * MIN) / 1000) * 1000);
        const [row] = await db.insert(schema.calls).values({ hostId: hana.id, customerId: cory.id, startsAt, endsAt: new Date(startsAt.getTime() + 30 * MIN), roomName: `endnow-${randomUUID()}`, pricePer15Cents: price }).returning();
        madeHere.push(row.id);
        // Its booking, as one made today carries it: with the version of the words that say what "End call now" costs.
        await db.insert(schema.bookings).values({ hostId: hana.id, customerId: cory.id, startsAt, endsAt: row.endsAt, lengthMinutes: 30, breakMinutes: 5, pricePer15Cents: price, totalCents: price * 2, freeCancelMinutes: 0, note: "", stage: "accepted", source: "admin", requestKey: randomUUID(), requestedAt: new Date(), decidedAt: new Date(), callId: row.id, cardConsentVersion: price > 0 ? CARD_CONSENT_VERSION : null });
        if (price > 0) {
          const { createPaymentForCall } = await import("../src/lib/payments/hold");
          await db.transaction((tx) => createPaymentForCall(tx, row));
          await pretendHeld(row);
        }
        return row;
      };
      try {
        const paid = await direct(PRICE, -2);
        const callPage = words((await send(`/calls/${paid.id}`, { jar: coryJar })).text);
        check('the call\'s page no longer says "End call and report" anywhere', !callPage.includes("End call and report"));
        const notYet = await send(`/calls/${paid.id}/ended`, { jar: coryJar });
        check("the screen after the press is not there for a call that is still going on", notYet.status === 307 && (notYet.location ?? "").endsWith(`/calls/${paid.id}`), `${notYet.status} ${notYet.location}`);
        const stop = await send(`/api/calls/${paid.id}/end-now`, { method: "POST", jar: coryJar });
        check("the customer presses the button on the website: ended, by him", stop.status === 200 && stop.json?.ended === "you" && (await callOf(paid.id)).endedNowBy === "customer", `${stop.status} ${JSON.stringify(stop.json)}`);
        const repeat = await send(`/api/calls/${paid.id}/end-now`, { method: "POST", jar: hanaJar });
        check("the other person pressing afterwards is told who ended it, and nothing is rewritten", repeat.status === 200 && repeat.json?.ended === "other" && (await callOf(paid.id)).safetyEndedBy === cory.id, JSON.stringify(repeat.json));
        check("the press says whether the room is confirmed closed", typeof stop.json?.closed === "boolean");
        check("nobody gets back in", (await send(`/api/calls/${paid.id}/token`, { method: "POST", jar: coryJar })).status === 409);
        check("a stranger to the call cannot end it or see its screen", (await send(`/api/calls/${paid.id}/end-now`, { method: "POST" })).status === 401 && (await send(`/calls/${randomUUID()}/ended`, { jar: coryJar })).status === 404);

        const screen = words((await send(`/calls/${paid.id}/ended`, { jar: coryJar })).text);
        check("his screen says he ended it, and what that means for the money, without promising what is not known yet", screen.includes("You ended this call") && screen.includes("your whole booked time is charged") && screen.includes(`if ${hanaPage.displayName} was not in the call when you ended it, neither is the rest`) && screen.includes(END_WORDS.moneyWhen), screen.slice(0, 300));
        check('"nobody can come back in" is said only once the room is written down as closed', screen.includes("Nobody can come back in") === ((await callOf(paid.id)).closedAt !== null));
        check('it has the three choices: "Report", "Block" and "Neither", each with what it does', screen.includes(REPORT_WORDS.reportPerson(hanaPage.displayName)) && screen.includes(END_WORDS.reportWhat(hanaPage.displayName)) && screen.includes(BLOCK_WORDS.label(hanaPage.displayName)) && screen.includes(END_WORDS.blockWhat(hanaPage.displayName)) && screen.includes(END_WORDS.neither) && screen.includes(END_WORDS.neitherWhat(hanaPage.displayName)));
        check("the block's sentence says what it ends before it is pressed: other calls, a membership, a monthly contribution", /still to come are cancelled at no charge/.test(END_WORDS.blockWhat("X")) && /membership or monthly contribution between you ends/.test(END_WORDS.blockWhat("X")));
        // (plans/45-phone-apps/09a-what-is-built-put-right.md, decision 2.) The same function gives the phone app its own
        // sentence: the calls as on the website, never a contribution, and a membership only while memberships are on for the apps.
        const [appOn, appOff] = [END_WORDS.blockWhat("X", { memberships: true }), END_WORDS.blockWhat("X", { memberships: false })];
        check("the website's page shows the website's sentence, not the phone app's", !screen.includes(END_WORDS.blockWhat(hanaPage.displayName, { memberships: true })) && !screen.includes(END_WORDS.blockWhat(hanaPage.displayName, { memberships: false })));
        check("the phone app's sentence, from the same function, names no contribution; a membership only while those are on for the apps", [appOn, appOff].every((said) => /still to come are cancelled at no charge/.test(said) && !/contribution/i.test(said)) && /any membership between you ends/.test(appOn) && !/membership/i.test(appOff), `${appOn} | ${appOff}`);
        check("it says openly that a report lowers this call's charge", screen.includes(END_WORDS.reportLowers(hanaPage.displayName, false)));
        check("he knows the host by the name on her page, never by her account name", hanaPage.displayName === hana.name || !screen.includes(hana.name));
        const form = words((await send(`/report?call=${paid.id}`, { jar: coryJar })).text);
        check("the report form says the call was ended, and what a report does to its charge", (form.includes(REPORT_WORDS.stopped) || form.includes(REPORT_WORDS.stopping)) && form.includes(END_WORDS.reportLowers(hanaPage.displayName, false)) && !form.includes("looked at by a person"));
        const hostScreen = words((await send(`/calls/${paid.id}/ended`, { jar: hanaJar })).text);
        check("the host's screen says the customer ended it, and has the same three choices by his name", hostScreen.includes(`${cory.name} ended this call`) && hostScreen.includes("the whole booked time is charged") && hostScreen.includes(BLOCK_WORDS.label(cory.name)) && hostScreen.includes(END_WORDS.neither) && !hostScreen.includes("If you report"));
        const results = words((await send(`/calls/${paid.id}/results`, { jar: coryJar })).text);
        check('the call\'s page says who ended it, with "End call now", and keeps "Report" and "Block"', results.includes("You ended this call on") && results.includes('with "End call now"') && results.includes("your whole booked time is charged") && results.includes(`Report ${hanaPage.displayName}`) && results.includes(`Block ${hanaPage.displayName}`) && !results.includes("End call and report") && !results.includes("decided by a person"));

        // "Neither" leads to the call's own page, and nothing else happens.
        const screenHtml = (await send(`/calls/${paid.id}/ended`, { jar: coryJar })).text;
        check('"Neither" is a plain link to the call\'s page, and "Report" a link to the form for this call', new RegExp(`data-choice="neither"[^]*?href="/calls/${paid.id}/results"[^]*?</section>`).test(screenHtml) && new RegExp(`data-choice="report"[^]*?href="/report\\?call=${paid.id}"[^]*?</section>`).test(screenHtml));
        check('"Neither" changes nothing: no report, and the charge as it was', (await callOf(paid.id)).endReportEffect === null && (await db.select().from(schema.reports).where(and(eq(schema.reports.context, "call"), eq(schema.reports.contextId, paid.id)))).length === 0);
        // After a report of his that lowered the charge. (Written straight onto the call here: a real report would block,
        // and a block between the two test accounts would end what other checks have set up between them.)
        await db.update(schema.calls).set({ endReportAt: new Date(), endReportEffect: "minutes" }).where(eq(schema.calls.id, paid.id));
        const hostAfter = words((await send(`/calls/${paid.id}/results`, { jar: hanaJar })).text);
        const custAfter = words((await send(`/calls/${paid.id}/results`, { jar: coryJar })).text);
        check("after his report his page says the charge is by the time the call lasted", custAfter.includes("is charged only for the time the call lasted"));
        check("the host's page says only which rule the charge follows, never that she was reported", !/reported (the host|you|her|him)|You reported/i.test(hostAfter) && hostAfter.includes("It is charged for your time in the call up to that moment."), hostAfter.slice(0, 200));
        check("nor does her screen after the call", !/reported (the host|you|her|him)|You reported|If you report/i.test(words((await send(`/calls/${paid.id}/ended`, { jar: hanaJar })).text)));

        // The host presses on another call: her screen, and the customer's.
        const second = await direct(PRICE, -2);
        const byHost = await send(`/api/calls/${second.id}/end-now`, { method: "POST", jar: hanaJar });
        const hers = words((await send(`/calls/${second.id}/ended`, { jar: hanaJar })).text);
        const his = words((await send(`/calls/${second.id}/ended`, { jar: coryJar })).text);
        check("the host presses: her screen says she ended it and is paid for her time up to then", byHost.json?.ended === "you" && hers.includes("You ended this call") && hers.includes("Only your time in the call up to that moment is charged"), hers.slice(0, 200));
        check("the customer's says the host ended it and he pays only for her time, and promises nothing for a report", his.includes(`${hanaPage.displayName} ended this call`) && his.includes(`You pay only for the time ${hanaPage.displayName} was in the call`) && !his.includes("If you report"));

        // The address the button had before still ends the call (a page that was open when the app was updated). It is
        // no way to choose a cheaper rule: which rule holds comes from the booking's own words, never from the address.
        const third = await direct(PRICE, -2);
        const oldAddress = await send(`/api/calls/${third.id}/end-for-safety`, { method: "POST", jar: coryJar });
        const viaOld = words((await send(`/calls/${third.id}/ended`, { jar: coryJar })).text);
        check("the address the button had before still ends the call, and cannot be used to pay less: the booking's words decide", oldAddress.status === 200 && oldAddress.json?.ended === "you" && (await callOf(third.id)).endedNowBy === "customer" && viaOld.includes("your whole booked time is charged"), `${oldAddress.status} ${(await callOf(third.id)).endedNowBy}`);
        // A booking made under the earlier words: the question says what he was told, and so does the screen after it.
        const fourth = await direct(PRICE, -2);
        await db.update(schema.bookings).set({ cardConsentVersion: "2026-11-c" }).where(eq(schema.bookings.callId, fourth.id));
        const askedPage = (await send(`/calls/${fourth.id}`, { jar: coryJar })).text;
        const pressedOld = await send(`/api/calls/${fourth.id}/end-now`, { method: "POST", jar: coryJar });
        const told = words((await send(`/calls/${fourth.id}/ended`, { jar: coryJar })).text);
        check("a booking made under the earlier words: he is not charged the whole booking he was never told about, and no screen says so", pressedOld.status === 200 && (await callOf(fourth.id)).endedNowBy === "customer_untold" && told.includes(`You pay only for the time ${hanaPage.displayName} was in the call`) && !told.includes("whole booked time") && !told.includes("If you report") && askedPage.includes("wholeBookingSaid") && /wholeBookingSaid\\?":false/.test(askedPage), `${pressedOld.status} ${(await callOf(fourth.id)).endedNowBy}`);

        // A call that had simply run out when the button was pressed.
        const over = await direct(0, -90);
        const pressedLate = await send(`/api/calls/${over.id}/end-now`, { method: "POST", jar: coryJar });
        const overScreen = words((await send(`/calls/${over.id}/ended`, { jar: coryJar })).text);
        check("pressed just after the room closed: nothing is written, and the three choices are still there", pressedLate.status === 200 && pressedLate.json?.ended === "over" && (await callOf(over.id)).safetyEndedAt === null && overScreen.includes(END_WORDS.alreadyOver) && overScreen.includes(END_WORDS.neither));
        const ahead = await direct(0, 3 * 60);
        check("a call that has not opened cannot be ended this way", (await send(`/api/calls/${ahead.id}/end-now`, { method: "POST", jar: coryJar })).status === 409 && (await callOf(ahead.id)).safetyEndedAt === null);
      } finally {
        if (madeHere.length > 0) {
          await db.delete(schema.messages).where(or(...madeHere.map((id) => like(schema.messages.key, `%${id}%`))));
          await db.delete(schema.emailOutbox).where(or(...madeHere.map((id) => like(schema.emailOutbox.dedupeKey, `%${id}%`))));
          const payments = await db.select({ id: schema.payments.id }).from(schema.payments).where(inArray(schema.payments.callId, madeHere));
          if (payments.length > 0) {
            await db.delete(schema.ledgerEntries).where(inArray(schema.ledgerEntries.paymentId, payments.map((p) => p.id)));
            await db.delete(schema.payments).where(inArray(schema.payments.id, payments.map((p) => p.id)));
          }
          await db.delete(schema.attendanceEvents).where(inArray(schema.attendanceEvents.callId, madeHere));
          await db.delete(schema.bookings).where(inArray(schema.bookings.callId, madeHere));
          await db.delete(schema.calls).where(inArray(schema.calls.id, madeHere));
        }
      }
    }

    // ----------------------------------------------------------------------
    console.log('\n7. "Block", from the screen after the press');
    {
      const host = await hostPerson("h7");
      const cust = await person("c7");
      const ended = await newCall(host, cust, { startsIn: -60, price: 0 });
      await press(ended, cust, 600);
      const future = await newCall(host, cust, { startsIn: 3 * 24 * 60, price: 0 });
      await block({ blockerId: cust.id, blockedId: host.id, now: new Date() });
      check("the block cancels their other call that is still to come, as its sentence says, and leaves the ended call as it is", (await callOf(future.id)).cancelledAt !== null && (await callOf(future.id)).cancelledLate === false && (await callOf(ended.id)).cancelledAt === null && (await callOf(ended.id)).endedNowBy === "customer_untold");
      check("it writes nothing about money on the ended call", (await callOf(ended.id)).endReportEffect === null);
    }
  } finally {
    // The holds that only ever stood in our own record are closed, so no helper tries to charge them at Stripe.
    if (fakeHeld.length > 0) await db.update(schema.payments).set({ status: "closed_uncharged", needsReview: false, transferStatus: "not_owed", reviewReason: "Closed by the end-now check." }).where(and(inArray(schema.payments.id, fakeHeld), inArray(schema.payments.status, ["held", "awaiting_payment"])));
    const ids = made.length ? made : ["-"];
    // A real hold that a failed check left behind is let go at Stripe.
    const left = await db.select({ id: schema.payments.id }).from(schema.payments).innerJoin(schema.calls, eq(schema.calls.id, schema.payments.callId)).where(and(inArray(schema.calls.customerId, ids), eq(schema.payments.status, "held")));
    for (const { id } of left) await releasePayment({ paymentId: id, note: "Released by the end-now check." }).catch(() => null);
    await db.delete(schema.messages).where(inArray(schema.messages.userId, ids));
    await db.delete(schema.messages).where(like(schema.messages.key, `end-guard:en-${RUN}-%`));
    await db.delete(schema.emailOutbox).where(or(like(schema.emailOutbox.to, `endnowcheck-${RUN}-%`), like(schema.emailOutbox.dedupeKey, `end-guard:en-${RUN}-%`)));
    await db.delete(schema.reports).where(or(inArray(schema.reports.reporterId, ids), inArray(schema.reports.reportedId, ids)));
    await db.delete(schema.blocks).where(or(inArray(schema.blocks.blockerId, ids), inArray(schema.blocks.blockedId, ids)));
    const bookings = await db.select({ id: schema.bookings.id }).from(schema.bookings).where(or(inArray(schema.bookings.customerId, ids), inArray(schema.bookings.hostId, ids)));
    if (bookings.length > 0) {
      await db.delete(schema.busyEntries).where(inArray(schema.busyEntries.bookingId, bookings.map((b) => b.id)));
      await db.delete(schema.bookings).where(inArray(schema.bookings.id, bookings.map((b) => b.id)));
    }
    const calls = await db.select({ id: schema.calls.id }).from(schema.calls).where(or(inArray(schema.calls.hostId, ids), inArray(schema.calls.customerId, ids)));
    for (const call of calls) {
      // Paid test calls stay as test data, like the payments check leaves them: every one of them is over, with its payment settled or closed.
      const [payment] = await db.select({ id: schema.payments.id }).from(schema.payments).where(eq(schema.payments.callId, call.id)).limit(1);
      if (payment) continue;
      await db.delete(schema.attendanceEvents).where(eq(schema.attendanceEvents.callId, call.id));
      await db.delete(schema.calls).where(eq(schema.calls.id, call.id));
    }
    for (const id of made) await db.update(schema.hostProfiles).set({ status: "suspended", hidden: true }).where(eq(schema.hostProfiles.userId, id));
  }

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
