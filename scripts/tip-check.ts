/**
 * Testing tool: a tip after a call (plans/44), through the real pages and against Stripe's test
 * mode, the way scripts/project-journey-check.ts walks a project.
 *
 * What is real and what is pretended:
 *   real       sign-up and the confirmation link of everyone who looks at a page; every page
 *              (fetched from the running app with that person's login) and every button that is
 *              pressed on one (the form is taken as the page drew it and posted with that person's
 *              cookies); every tip's payment (the app's own PaymentIntent, confirmed with one of
 *              Stripe's test cards, as a browser would); the emails written; blocking and closing
 *              an account (the app's own functions).
 *   pretended  the welcome step's tick boxes; a host's approval; that two people had a call
 *              (written with a final record); the waiting (three days: the money is taken by the
 *              app's own function with a later clock); a pause and a suspension (the person's line
 *              is written and the same step is run that the real ones run for contributions); and
 *              people who never open a page are written straight into the database.
 *
 * Collecting moves real test money, so it needs a real test payout account: with --payouts the
 * tip's host borrows the one of host@test.local for that step.
 *
 * It needs the app running and the Stripe test key. Stop the always-on helper first: the helper's
 * function is run here, and it acts on every contribution in the database, so the script must have
 * this computer's test database to itself. It sets the founder's tips and projects switches and
 * puts them back at the end, and removes everything it made here (people whose email starts
 * "tipcheck-", also those of an earlier run that was stopped). What it made at Stripe stays there
 * as test history. The founder's page is skipped with a note if the test admin's login is not set
 * up (test-accounts.local.md in the folder the script is run from).
 *
 * Usage: npx tsx scripts/tip-check.ts                              (everything but collecting)
 *        npx tsx scripts/tip-check.ts --payouts                    (also collecting)
 *        npx tsx scripts/tip-check.ts --app=http://localhost:3210  (the app at another address)
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { and, eq, inArray, like, or, sql } from "drizzle-orm";
import { TERMS_VERSION } from "../src/lib/terms";
import { requireLocalDatabase } from "./local-only";
import { refusalWhileDisputed } from "./stopped-customer";
import { totpCode } from "./totp";

const BASE = process.argv.find((arg) => arg.startsWith("--app="))?.slice("--app=".length).replace(/\/$/, "") ?? "http://localhost:3000";
const RUN = randomUUID().slice(0, 8);
const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const RETURN = "https://example.com/return";

let failures = 0;
function check(label: string, ok: boolean, detail: unknown = "") {
  const shown = typeof detail === "string" ? detail : JSON.stringify(detail);
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${!ok && shown ? `  (${shown.slice(0, 500)})` : ""}`);
  if (!ok) failures++;
}

type Jar = Map<string, string>;
type Reply = { status: number; json: Record<string, unknown> | null; text: string; words: string; location: string };

const unescape = (text: string) => text.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
/** What a person reads on a page: the text, without the markup. */
const words = (html: string) => unescape(html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ");

/** One request to the app, the way a browser would send it. Cookies are kept in the jar. Redirects are not followed. */
async function send(path: string, options: { json?: unknown; form?: FormData; jar?: Jar } = {}): Promise<Reply> {
  const headers: Record<string, string> = { origin: BASE, "sec-fetch-site": "same-origin" };
  if (options.json !== undefined) headers["content-type"] = "application/json";
  if (options.jar?.size) headers.cookie = [...options.jar].map(([k, v]) => `${k}=${v}`).join("; ");
  const body = options.form ?? (options.json !== undefined ? JSON.stringify(options.json) : undefined);
  const response = await fetch(path.startsWith("http") ? path : `${BASE}${path}`, { method: body !== undefined ? "POST" : "GET", headers, body, redirect: "manual" });
  for (const cookie of response.headers.getSetCookie()) {
    const [pair, ...attributes] = cookie.split(";");
    const at = pair.indexOf("=");
    const name = pair.slice(0, at).trim();
    const value = pair.slice(at + 1);
    if (!value || attributes.some((a) => /^\s*max-age=0\s*$/i.test(a))) options.jar?.delete(name);
    else options.jar?.set(name, value);
  }
  const text = await response.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = JSON.parse(text);
  } catch {
    // a page, not JSON
  }
  return { status: response.status, json, text, words: words(text), location: (response.headers.get("location") ?? "").replace(BASE, "") };
}

/** A form as a page drew it: its buttons and every field a browser would send, in order. */
type Form = { buttons: Array<{ words: string; name: string | null; value: string }>; fields: Array<[string, string]>; action: string | null };
const attribute = (tag: string, name: string): string | null => {
  const found = tag.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`));
  return found ? unescape(found[1]) : null;
};
function formsOf(html: string): Form[] {
  return [...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/g)].map(([, formAttributes, inner]) => {
    const fields: Array<[string, string]> = [];
    for (const [tag, , selectAttributes, options] of inner.matchAll(/<input\b[^>]*>|<(select)\b([^>]*)>([\s\S]*?)<\/select>/g)) {
      if (selectAttributes !== undefined) {
        const name = attribute(selectAttributes, "name");
        const all = [...options.matchAll(/<option\b([^>]*)>/g)].map((m) => m[1]);
        const chosen = all.find((o) => /(?:^|\s)selected(?:=|\s|$)/.test(o)) ?? all[0];
        if (name && chosen !== undefined) fields.push([name, attribute(chosen, "value") ?? ""]);
        continue;
      }
      const name = attribute(tag, "name");
      if (!name) continue;
      const type = attribute(tag, "type") ?? "text";
      if ((type === "checkbox" || type === "radio") && !/\schecked(?:=|\s|\/|>)/.test(tag)) continue;
      fields.push([name, attribute(tag, "value") ?? (type === "checkbox" ? "on" : "")]);
    }
    const buttons = [...inner.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map((m) => ({ words: words(m[2]).trim(), name: attribute(m[1], "name"), value: attribute(m[1], "value") ?? "" }));
    return { buttons, fields, action: attribute(formAttributes, "action") };
  });
}

async function main() {
  requireLocalDatabase();
  if (!process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_")) throw new Error("This script needs the Stripe test key (sk_test_...) in .env.local.");
  const { db, schema } = await import("../src/db");
  const { stripe } = await import("../src/lib/payments/stripe");
  const { setSwitches, switches } = await import("../src/lib/safety/switches");
  const { runContributionJobs } = await import("../src/lib/contributions/jobs");
  const C = await import("../src/lib/contributions/charge");
  const S = await import("../src/lib/contributions/start");
  const R = await import("../src/lib/contributions/refund");
  const T = await import("../src/lib/contributions/tip-start");
  const rules = await import("../src/lib/contributions/tip-rules");
  const { tipThere } = await import("../src/lib/contributions/tips");
  const { lockForPayment } = await import("../src/lib/contributions/locks");
  const { saveTipsSwitch, saveProjectsSwitch } = await import("../src/lib/contributions/switch");
  const { endContributionsOf, letGoAll } = await import("../src/lib/contributions/ending");
  const { currentSplit } = await import("../src/lib/payments/actions");
  const { unsentEarnings } = await import("../src/lib/payments/collect");
  const { handleStripeEvent } = await import("../src/lib/payments/stripe-events");
  const { rateCall } = await import("../src/lib/ratings/ratings");
  const { block } = await import("../src/lib/safety/blocks");
  const { closeAccount } = await import("../src/lib/profiles/closing");
  const { runningProjectOf } = await import("../src/lib/projects/projects");
  const pays = schema.contributionPayments;
  const withPayouts = process.argv.includes("--payouts");
  const { NO_TIP, TIPS_OFF, TIP_THERE, TIP_WORDING_VERSION, tipSentences, callDay } = rules;

  const up = await send("/login").catch(() => null);
  if (!up || up.status !== 200) throw new Error(`The app is not running at ${BASE}. Start it first.`);

  type Person = { id: string; name: string; email: string; jar: Jar };
  const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const page = (path: string, who?: Person) => send(path, { jar: who?.jar });
  const PM = async (id: string) => (await db.select().from(pays).where(eq(pays.id, id)))[0];
  const CO = async (id: string) => (await db.select().from(schema.contributions).where(eq(schema.contributions.id, id)))[0];
  const shareOf = async (paymentId: string) => (await db.select().from(schema.payments).where(eq(schema.payments.contributionPaymentId, paymentId)))[0];
  const tipsOfCall = (callId: string) => db.select().from(schema.contributions).where(and(eq(schema.contributions.kind, "tip"), eq(schema.contributions.callId, callId)));
  const tipsOf = (who: Person) => db.select().from(schema.contributions).where(and(eq(schema.contributions.kind, "tip"), eq(schema.contributions.contributorId, who.id)));
  const intentOf = async (paymentId: string) => stripe().paymentIntents.retrieve((await PM(paymentId)).stripePaymentIntentId!);
  /** What a refused action said. */
  const refused = (promise: Promise<unknown>) => promise.then(() => "(it was not refused)", (error: unknown) => (error instanceof Error ? error.message : String(error)));

  async function emailsTo(to: string, subject: string, tries = 15): Promise<number> {
    for (let i = 0; i < tries; i++) {
      const found = await db.select({ id: schema.emailOutbox.id }).from(schema.emailOutbox).where(and(eq(schema.emailOutbox.to, to), like(schema.emailOutbox.subject, `%${subject}%`)));
      if (found.length > 0) return found.length;
      await pause(200);
    }
    return 0;
  }
  const emailCount = async (to: string, subject: string) => (await db.select({ id: schema.emailOutbox.id }).from(schema.emailOutbox).where(and(eq(schema.emailOutbox.to, to), like(schema.emailOutbox.subject, `%${subject}%`)))).length;

  /** Signs up the way the form does and opens the link in the confirmation email. The welcome step's tick boxes are pretended. */
  async function signUp(name: string): Promise<Person> {
    const person = { name: `Tip ${name} ${RUN}`, email: `tipcheck-${RUN}-${name.toLowerCase()}@example.test`, password: randomBytes(12).toString("base64url"), jar: new Map() as Jar };
    // Attempt limits are per network address, and every sign-up here comes from the same one.
    await db.delete(schema.rateLimit);
    await send("/api/auth/sign-up/email", { json: { name: person.name, email: person.email, password: person.password, callbackURL: "/welcome" }, jar: person.jar });
    if ((await emailsTo(person.email, "Confirm your email", 25)) === 0) throw new Error(`No confirmation email for ${person.email}`);
    const link = (await db.select().from(schema.emailOutbox).where(and(eq(schema.emailOutbox.to, person.email), like(schema.emailOutbox.subject, "%Confirm your email%"))))[0].body.match(/https?:\/\/\S+/)?.[0] ?? "";
    await send(link.replace(/^https?:\/\/[^/]+/, BASE), { jar: person.jar });
    const [row] = await db.select().from(schema.user).where(eq(schema.user.email, person.email));
    const now = new Date();
    await db.update(schema.user).set({ adultConfirmedAt: now, termsAcceptedAt: now, termsVersion: TERMS_VERSION, timeZone: "America/New_York" }).where(eq(schema.user.id, row.id));
    return { id: row.id, name: person.name, email: person.email, jar: person.jar };
  }
  let made = 0;
  /** Pretended: a person who never opens a page, written straight into the database. */
  async function quiet(name: string): Promise<Person> {
    const row = { id: `tipcheck-${RUN}-${++made}`, name: `Tip ${name} ${RUN} ${made}`, email: `tipcheck-${RUN}-q${made}@example.test` };
    const stamp = new Date();
    await db.insert(schema.user).values({ ...row, emailVerified: true, adultConfirmedAt: stamp, termsAcceptedAt: stamp, termsVersion: TERMS_VERSION, timeZone: "America/New_York" });
    return { ...row, jar: new Map() };
  }
  /** Pretended: the person is a host whose page is approved and who can be paid. */
  async function asHost<P extends Person>(person: P, name: string): Promise<P & { handle: string; displayName: string }> {
    const handle = `tp${RUN}${name.toLowerCase()}`;
    const displayName = `${name} Tips ${RUN}`;
    await db.insert(schema.hostProfiles).values({ userId: person.id, handle, handleKey: handle, displayName, pricePer15Cents: 1000, status: "approved", usConfirmedAt: new Date() });
    await db.insert(schema.hostSettings).values({ userId: person.id, payoutsReady: true }).onConflictDoNothing();
    await db.insert(schema.hostCalendars).values({ userId: person.id, timeZone: "America/New_York", lengths: "30", noticeHours: 24, horizonWeeks: 2, breakMinutes: 5 });
    return { ...person, handle, displayName };
  }

  /** Presses a button on a page as that person: the form with that button is taken as it was drawn and posted back. */
  async function press(who: Person, path: string, button: string, change: Record<string, string | string[] | null> = {}, opts: { where?: (form: Form) => boolean; drawn?: string } = {}): Promise<Reply & { found: boolean }> {
    const html = opts.drawn ?? (await page(path, who)).text;
    const form = formsOf(html).find((f) => f.buttons.some((b) => b.words === button) && (opts.where?.(f) ?? true));
    if (!form) return { status: 0, json: null, text: "", words: "", location: "", found: false };
    const data = new FormData();
    for (const [name, value] of form.fields) if (!(name in change)) data.append(name, value);
    for (const [name, value] of Object.entries(change)) for (const one of value === null ? [] : Array.isArray(value) ? value : [value]) data.append(name, one);
    const pressed = form.buttons.find((b) => b.words === button);
    if (pressed?.name) data.append(pressed.name, pressed.value);
    return { ...(await send(path, { form: data, jar: who.jar })), found: true };
  }
  /** The sentence the app shows after an action (it travels, signed, in the address the person is sent to). */
  const noticeOf = (reply: Reply) => decodeURIComponent(reply.location.match(/[?&]notice=([^&#]*)/)?.[1] ?? "");
  /** Where a form that only asks for a page leads, with its fields in the address as a browser writes them. */
  function leadsTo(html: string, button: string, change: Record<string, string> = {}): string | null {
    const form = formsOf(html).find((f) => f.buttons.some((b) => b.words === button));
    if (!form?.action) return null;
    const query = new URLSearchParams();
    for (const [name, value] of form.fields) query.append(name, change[name] ?? value);
    return `${form.action}?${query}`;
  }
  const hasMark = (reply: Reply, mark: string) => reply.text.includes(mark);

  /**
   * Pretended: these two had a call two days ago, written with a final record: both were in the
   * room for 20 minutes, and the room is confirmed closed. With `what` it is a call that did not
   * go like that.
   */
  async function hadCall(host: Person, customer: Person, what: "ordinary" | "cancelled" | "ended_with_report" | "just_over" | "short" | "old" = "ordinary"): Promise<string> {
    const startsAt = new Date(Date.now() - (what === "just_over" ? 31 * MIN : what === "old" ? 9 * DAY : 2 * DAY));
    const endsAt = new Date(startsAt.getTime() + 30 * MIN);
    const [call] = await db
      .insert(schema.calls)
      .values({
        hostId: host.id,
        customerId: customer.id,
        startsAt,
        endsAt,
        roomName: `tipcheck-${randomUUID()}`,
        pricePer15Cents: 0,
        ...(what === "just_over" ? {} : { closedAt: new Date(endsAt.getTime() + MIN) }),
        ...(what === "cancelled" ? { cancelledAt: new Date(startsAt.getTime() - 60 * MIN), cancelledBy: "customer" } : {}),
        ...(what === "ended_with_report" ? { safetyEndedAt: new Date(startsAt.getTime() + 10 * MIN), safetyEndedBy: "customer" } : {}),
      })
      .returning();
    await db.insert(schema.bookings).values({ hostId: host.id, customerId: customer.id, startsAt, endsAt, lengthMinutes: 30, breakMinutes: 5, pricePer15Cents: 0, totalCents: 0, freeCancelMinutes: 0, stage: "accepted", requestKey: randomUUID(), callId: call.id });
    for (const who of [host.id, customer.id]) {
      const event = (type: string, minutes: number) => ({ provider: "livekit", providerEventId: `EV_${randomUUID()}`, callId: call.id, type, roomSessionId: "RM_tipcheck", participantIdentity: who, participantSessionId: `PA_${who.slice(-6)}_${call.id.slice(0, 6)}`, providerTime: new Date(startsAt.getTime() + minutes * MIN), payload: "{}" });
      await db.insert(schema.attendanceEvents).values([event("participant_joined", 0), event("participant_left", what === "short" ? 1 : 20)]);
    }
    return call.id;
  }
  const results = (callId: string, who: Person) => page(`/calls/${callId}/results`, who);
  const boxShown = (reply: Reply) => reply.status === 200 && hasMark(reply, "data-tip-ask");
  /** The page is there, and the box is not on it. (A page that failed to open never counts as "no box".) */
  const noBox = (reply: Reply) => reply.status === 200 && !hasMark(reply, "data-tip-ask");
  /** The state of the tip's line on a call's results, or null when the page is there and has no line. */
  const tipLine = (reply: Reply) => (reply.status !== 200 ? `not a page (${reply.status})` : (reply.text.match(/data-tip="([a-z_]+)"/)?.[1] ?? null));

  /** A tip started by the app's own function, and made ready at Stripe, as "Continue to the card step" does. */
  async function atCardStep(customer: Person, callId: string, dollars = "5.00") {
    const started = await T.startTip({ customerId: customer.id, callId, amount: dollars, requestKey: randomUUID(), wordingVersion: TIP_WORDING_VERSION, now: new Date() });
    await S.payNow({ paymentId: started.paymentId, contributorId: customer.id });
    return started;
  }
  /** What the customer's browser does at the card step: confirms the payment THE APP made with one of Stripe's test cards. Then the app looks. */
  async function pay(paymentId: string, card = "pm_card_visa") {
    await stripe().paymentIntents.confirm((await PM(paymentId)).stripePaymentIntentId!, { payment_method: card, return_url: RETURN });
    return C.syncPayment(paymentId, new Date());
  }
  /** A tip that is held: a customer of their own (or the one given), a call with the host, the card step, a test card. */
  async function heldTip(host: Person, opts: { customer?: Person; dollars?: string; card?: string; callId?: string } = {}) {
    const customer = opts.customer ?? (await quiet("giver"));
    const callId = opts.callId ?? (await hadCall(host, customer));
    const started = await atCardStep(customer, callId, opts.dollars);
    await pay(started.paymentId, opts.card);
    return { customer, callId, ...started };
  }
  /** The money of one held payment is taken, at its own moment (three days later, pretended). */
  const take = async (paymentId: string) => C.takePayment(paymentId, (await PM(paymentId)).takeAt!);
  /** The always-on helper's work on contributions, at a moment. */
  async function helper(at: Date) {
    await runContributionJobs(at);
    await runContributionJobs(at);
  }

  // --------------------------------------------------------------------------
  // Cleaning up
  // --------------------------------------------------------------------------
  const [seeded] = await db.select().from(schema.user).where(eq(schema.user.email, "host@test.local"));
  let payoutAccountBefore: string | null = null;
  /** If an earlier run stopped while its host held the test payout account, the seeded host gets it back before anything is deleted. */
  async function payoutAccountBack() {
    const [holder] = await db
      .select({ userId: schema.hostSettings.userId, stripeAccountId: schema.hostSettings.stripeAccountId })
      .from(schema.hostSettings)
      .innerJoin(schema.user, eq(schema.user.id, schema.hostSettings.userId))
      .where(and(like(schema.user.email, "tipcheck-%"), sql`${schema.hostSettings.stripeAccountId} is not null`));
    if (!holder || !seeded) return;
    await db.transaction(async (tx) => {
      await tx.update(schema.hostSettings).set({ stripeAccountId: null }).where(eq(schema.hostSettings.userId, holder.userId));
      await tx.update(schema.hostSettings).set({ stripeAccountId: holder.stripeAccountId, payoutsReady: true }).where(eq(schema.hostSettings.userId, seeded.id));
    });
    console.log("   (the test payout account was given back to host@test.local)");
  }
  /** Lets a test payment go at Stripe before its line here is removed. One that cannot be let go stops the clean-up. */
  async function letGoAtStripe(intentId: string) {
    await stripe().paymentIntents.cancel(intentId).catch(async () => {
      const left = await stripe().paymentIntents.retrieve(intentId).catch(() => null);
      if (left?.status !== "canceled" && left?.status !== "succeeded") throw new Error(`The test payment ${intentId} could not be let go at Stripe (it is "${left?.status ?? "unknown"}"). Nothing was removed; the next run tries again.`);
    });
  }
  /** Removes everything this script ever made: the people whose email starts "tipcheck-", and all that hangs on them. Nothing else. */
  async function wipe() {
    await payoutAccountBack();
    const ids = (await db.select({ id: schema.user.id }).from(schema.user).where(like(schema.user.email, "tipcheck-%"))).map((row) => row.id);
    if (ids.length === 0) {
      await db.delete(schema.emailOutbox).where(like(schema.emailOutbox.to, "tipcheck-%"));
      return;
    }
    const contributionIds = (await db.select({ id: schema.contributions.id }).from(schema.contributions).where(or(inArray(schema.contributions.hostId, ids), inArray(schema.contributions.contributorId, ids)))).map((row) => row.id);
    const theirPayments = contributionIds.length > 0 ? await db.select().from(pays).where(inArray(pays.contributionId, contributionIds)) : [];
    // Nothing stays held on a test card.
    for (const payment of theirPayments) {
      if (payment.stripePaymentIntentId && (payment.status === "to_pay" || payment.status === "held")) await letGoAtStripe(payment.stripePaymentIntentId);
    }
    const cpIds = theirPayments.map((payment) => payment.id);
    // The founder's email about a pair over $1,000 is addressed to the founders, not to anyone of ours: found by the payment it names.
    for (const id of cpIds) await db.delete(schema.emailOutbox).where(like(schema.emailOutbox.dedupeKey, `contribution-1000:${id}:%`));
    const calls =(await db.select({ id: schema.calls.id }).from(schema.calls).where(or(inArray(schema.calls.hostId, ids), inArray(schema.calls.customerId, ids)))).map((row) => row.id);
    const bookings = (await db.select({ id: schema.bookings.id }).from(schema.bookings).where(or(inArray(schema.bookings.hostId, ids), inArray(schema.bookings.customerId, ids)))).map((row) => row.id);
    const shares = cpIds.length > 0 ? (await db.select({ id: schema.payments.id }).from(schema.payments).where(inArray(schema.payments.contributionPaymentId, cpIds))).map((row) => row.id) : [];
    const projectIds = (await db.select({ id: schema.projects.id }).from(schema.projects).where(inArray(schema.projects.hostId, ids))).map((row) => row.id);
    const steps: Array<() => Promise<unknown>> = [
      () => db.delete(schema.collectionItems).where(inArray(schema.collectionItems.collectionId, db.select({ id: schema.collections.id }).from(schema.collections).where(inArray(schema.collections.hostId, ids)))),
      () => db.delete(schema.collections).where(inArray(schema.collections.hostId, ids)),
      async () => shares.length > 0 && (await db.delete(schema.ledgerEntries).where(inArray(schema.ledgerEntries.paymentId, shares))),
      async () => shares.length > 0 && (await db.delete(schema.moneyOperations).where(inArray(schema.moneyOperations.paymentId, shares))),
      async () => calls.length > 0 && (await db.delete(schema.refundRequests).where(inArray(schema.refundRequests.callId, calls))),
      async () => shares.length > 0 && (await db.delete(schema.payments).where(inArray(schema.payments.id, shares))),
      async () => cpIds.length > 0 && (await db.delete(schema.ledgerEntries).where(inArray(schema.ledgerEntries.contributionPaymentId, cpIds))),
      async () => cpIds.length > 0 && (await db.delete(schema.moneyOperations).where(inArray(schema.moneyOperations.contributionPaymentId, cpIds))),
      async () => cpIds.length > 0 && (await db.delete(schema.contributionRefunds).where(inArray(schema.contributionRefunds.contributionPaymentId, cpIds))),
      async () => cpIds.length > 0 && (await db.delete(pays).where(inArray(pays.id, cpIds))),
      async () => contributionIds.length > 0 && (await db.delete(schema.contributionCards).where(inArray(schema.contributionCards.contributionId, contributionIds))),
      async () => contributionIds.length > 0 && (await db.delete(schema.contributionAgreements).where(inArray(schema.contributionAgreements.contributionId, contributionIds))),
      async () => contributionIds.length > 0 && (await db.delete(schema.contributions).where(inArray(schema.contributions.id, contributionIds))),
      () => db.delete(schema.ratings).where(or(inArray(schema.ratings.raterId, ids), inArray(schema.ratings.ratedId, ids))),
      () => db.delete(schema.reports).where(or(inArray(schema.reports.reporterId, ids), inArray(schema.reports.reportedId, ids))),
      () => db.delete(schema.blocks).where(or(inArray(schema.blocks.blockerId, ids), inArray(schema.blocks.blockedId, ids))),
      () => db.delete(schema.follows).where(or(inArray(schema.follows.followerId, ids), inArray(schema.follows.hostId, ids))),
      () => db.delete(schema.adminActions).where(or(inArray(schema.adminActions.targetUserId, ids), inArray(schema.adminActions.adminId, ids))),
      async () => bookings.length > 0 && (await db.delete(schema.busyEntries).where(inArray(schema.busyEntries.bookingId, bookings))),
      async () => bookings.length > 0 && (await db.delete(schema.bookings).where(inArray(schema.bookings.id, bookings))),
      async () => calls.length > 0 && (await db.delete(schema.attendanceEvents).where(inArray(schema.attendanceEvents.callId, calls))),
      async () => calls.length > 0 && (await db.delete(schema.calls).where(inArray(schema.calls.id, calls))),
      async () => projectIds.length > 0 && (await db.delete(schema.projectPosts).where(inArray(schema.projectPosts.projectId, projectIds))),
      () => db.delete(schema.projects).where(inArray(schema.projects.hostId, ids)),
      () => db.delete(schema.hostCalendars).where(inArray(schema.hostCalendars.userId, ids)),
      () => db.delete(schema.hostSettings).where(inArray(schema.hostSettings.userId, ids)),
      () => db.delete(schema.hostProfiles).where(inArray(schema.hostProfiles.userId, ids)),
      () => db.delete(schema.stripeCustomers).where(inArray(schema.stripeCustomers.userId, ids)),
      () => db.delete(schema.emailOutbox).where(like(schema.emailOutbox.to, "tipcheck-%")),
      () => db.delete(schema.session).where(inArray(schema.session.userId, ids)),
      () => db.delete(schema.account).where(inArray(schema.account.userId, ids)),
      () => db.delete(schema.user).where(inArray(schema.user.id, ids)),
    ];
    // A step that fails is a failed check: what it should have removed may still be there.
    for (const step of steps) await step().catch((error) => check("clean-up: each step could remove what it is for", false, error instanceof Error ? error.message.split("\n")[0] : String(error)));
  }

  const atStart = await switches();
  console.log(`(The founder's switches at the start: tips ${atStart.tipsOff ? "off" : "on"}, projects "${atStart.projects}". They are put back at the end.)`);
  // Asked before anything is changed. This script saves both switches for real and puts them back; that is only
  // harmless for what is not ours in two cases, and it stops otherwise:
  //   - projects were on for everyone: then no monthly contribution of anyone carries the mark of a switched-off
  //     host, and with the other hosts kept named (below) none gets one;
  //   - no tip of anyone else is waiting or held: switching tips off gives up every tip that is not taken, and
  //     putting the switch back cannot bring a hold back.
  if (atStart.projects !== "everyone") throw new Error(`The founder's projects switch is "${atStart.projects}" in this database. This script changes it and puts it back, which is only harmless when it is "everyone". Nothing was changed.`);
  const [foreignTip] = await db
    .select({ id: pays.id })
    .from(pays)
    .innerJoin(schema.contributions, eq(schema.contributions.id, pays.contributionId))
    .innerJoin(schema.user, eq(schema.user.id, schema.contributions.contributorId))
    .where(and(eq(schema.contributions.kind, "tip"), inArray(pays.status, ["to_pay", "held"]), sql`${pays.endedHow} is null`, sql`${schema.user.email} not like 'tipcheck-%'`))
    .limit(1);
  if (foreignTip) throw new Error("A tip that this script did not make is waiting for its card or held in this database. Switching tips off would give it up, so nothing was changed. Cancel it first, or let its three days pass.");
  /** Whoever saves a switch for this script: its line in the founder's record is removed at the end. */
  let switchSaver: Person | null = null;
  /** The ids of the lines the test admin's own presses on the tips switch wrote into the founder's record. */
  const founderRecord: string[] = [];

  try {
    await wipe();
    payoutAccountBefore = seeded ? ((await db.select().from(schema.hostSettings).where(eq(schema.hostSettings.userId, seeded.id)))[0]?.stripeAccountId ?? null) : null;
    await setSwitches({ tipsOff: false, projects: "everyone", projectsHosts: [] });
    // Attempt limits are per network address, and every request here comes from the same one.
    await db.delete(schema.rateLimit);
    switchSaver = await quiet("founder");

    // ----------------------------------------------------------------------
    console.log("\n1. Who is asked for a tip, and who is not");
    const host = await asHost(await signUp("Hana"), "Hana");
    const cara = await signUp("Cara");
    const goodCall = await hadCall(host, cara);
    const asked = await results(goodCall, cara);
    check(
      "after a call that took place, the customer's results show the box: her name, the three amounts each with what it costs, and \"Give a tip\"",
      boxShown(asked) && asked.words.includes(`Thank ${host.displayName} with a tip`) && asked.words.includes("$2.00 (you pay $2.37)") && asked.words.includes("$5.00 (you pay $5.46)") && asked.words.includes("$10.00 (you pay $10.61)") && formsOf(asked.text).some((f) => f.buttons.some((b) => b.words === "Give a tip")),
      asked.words.slice(0, 300),
    );
    check("the box says that the host receives the whole tip and Connect keeps nothing", asked.words.includes(`${host.displayName} receives the whole tip; Connect keeps nothing of it.`));
    check("the host, looking at the same call, sees no box and no tip", noBox(await results(goodCall, host)) && tipLine(await results(goodCall, host)) === null);
    const cancelledCall = await hadCall(host, cara, "cancelled");
    const reportedCall = await hadCall(host, cara, "ended_with_report");
    const freshCall = await hadCall(host, cara, "just_over");
    const shortCall = await hadCall(host, cara, "short");
    const oldCall = await hadCall(host, cara, "old");
    const refundCall = await hadCall(host, cara);
    await db.insert(schema.refundRequests).values({ callId: refundCall, customerId: cara.id, reason: "other", note: "", askedAt: new Date(), status: "declined" });
    check("there is no box for a call that was cancelled", noBox(await results(cancelledCall, cara)));
    check("none for a call ended with \"End call and report\"", noBox(await results(reportedCall, cara)));
    check("none while a call's record is not final yet", noBox(await results(freshCall, cara)));
    check("none when the two were in the room together for under 2 minutes", noBox(await results(shortCall, cara)));
    check("none later than 7 days after the call", noBox(await results(oldCall, cara)));
    check("none for a call she asked a refund of, also when the request was declined", noBox(await results(refundCall, cara)));
    // The stars. (Each on a call of its own: a rating cannot be changed.)
    const starCalls = new Map<number, string>();
    for (const stars of [1, 2, 3, 4, 5]) {
      const callId = await hadCall(host, cara);
      await rateCall({ callId, raterId: cara.id, stars, now: new Date() });
      starCalls.set(stars, callId);
    }
    check("the box is there after a rating of 5 stars, and after 4", boxShown(await results(starCalls.get(5)!, cara)) && boxShown(await results(starCalls.get(4)!, cara)));
    check("and gone after a rating of 3, of 2 and of 1", noBox(await results(starCalls.get(3)!, cara)) && noBox(await results(starCalls.get(2)!, cara)) && noBox(await results(starCalls.get(1)!, cara)));
    // A page she has hidden from search still counts: the call took place.
    await db.update(schema.hostProfiles).set({ hidden: true }).where(eq(schema.hostProfiles.userId, host.id));
    check("a host who has hidden her page can still be given a tip for a call that took place", boxShown(await results(goodCall, cara)));
    await db.update(schema.hostProfiles).set({ hidden: false }).where(eq(schema.hostProfiles.userId, host.id));
    await db.update(schema.user).set({ pausedAt: new Date() }).where(eq(schema.user.id, host.id));
    check("a paused host cannot: no box", noBox(await results(goodCall, cara)));
    await db.update(schema.user).set({ pausedAt: null }).where(eq(schema.user.id, host.id));
    check("opening all those pages started no tip", (await tipsOf(cara)).length === 0);

    // One box, not two: a host with a running project.
    const pia = await asHost(await signUp("Pia"), "Pia");
    const PROJECT = `A film about the sea ${RUN}`;
    await press(pia, "/host/project", "Start the project", { name: PROJECT, description: "A short film about the people who work on the sea at night." });
    await press(pia, "/host/project", "Save the amounts", { once: ["10", "", ""], monthly: ["995", "", ""] });
    const mona = await signUp("Mona");
    const monaCall = await hadCall(pia, mona);
    const withProject = await results(monaCall, mona);
    check("when the box about the host's project is shown, the tip box is not", Boolean(await runningProjectOf(pia.id)) && hasMark(withProject, "data-project-ask") && noBox(withProject), `${withProject.status}`);
    check("and the summary page for a tip says the same, with nothing to press", await (async () => {
      const summary = await page(`/tips/new?call=${monaCall}&amount=5.00`, mona);
      return summary.status === 200 && summary.words.includes(NO_TIP) && !formsOf(summary.text).some((f) => f.buttons.some((b) => b.words === "Continue to the card step"));
    })());

    // ----------------------------------------------------------------------
    console.log("\n2. The server refuses what the page would not offer");
    const to = leadsTo(asked.text, "Give a tip", { amount: "5.00" }) ?? "";
    check("\"Give a tip\" leads to the summary page, with the call and the amount in the address", to.startsWith(`/tips/new?call=${goodCall}`) && to.includes("amount=5.00"), to);
    const summary = await page(to, cara);
    const sentences = tipSentences({ tipCents: 500, hostName: host.displayName, callOn: callDay({ timeZone: "America/New_York" }, (await db.select().from(schema.calls).where(eq(schema.calls.id, goodCall)))[0].startsAt) });
    check("the page before paying says the total and every sentence the plan asks for", summary.words.includes("$5.46, once") && sentences.every((sentence) => summary.words.includes(sentence)), sentences.find((sentence) => !summary.words.includes(sentence)));
    check("opening the summary wrote nothing", (await tipsOf(cara)).length === 0);
    const dan = await signUp("Dan");
    check("another customer cannot open the summary for her call", (await page(to, dan)).status === 404);
    const byDan = await press(dan, to, "Continue to the card step", {}, { drawn: summary.text });
    check("nor send her summary's form: it is refused, and nothing is started", byDan.found && noticeOf(byDan) === NO_TIP && (await tipsOfCall(goodCall)).length === 0, noticeOf(byDan));
    const byHost = await press(host, to, "Continue to the card step", {}, { drawn: summary.text });
    check("the host cannot send it either", byHost.found && noticeOf(byHost) === NO_TIP && (await tipsOfCall(goodCall)).length === 0, noticeOf(byHost));
    check("the app's own function refuses a tip for a call that is not the person's, and for one that does not exist, with the same words", (await refused(T.startTip({ customerId: dan.id, callId: goodCall, amount: "5", requestKey: randomUUID(), wordingVersion: TIP_WORDING_VERSION, now: new Date() }))) === NO_TIP && (await refused(T.startTip({ customerId: dan.id, callId: randomUUID(), amount: "5", requestKey: randomUUID(), wordingVersion: TIP_WORDING_VERSION, now: new Date() }))) === NO_TIP);
    check("a customer whose bank has an open dispute cannot start a tip, and is told why", /Your bank has an open dispute/.test((await refusalWhileDisputed(cara.id, host.id, () => T.startTip({ customerId: cara.id, callId: goodCall, amount: "5", requestKey: randomUUID(), wordingVersion: TIP_WORDING_VERSION, now: new Date() }))) ?? "") && (await tipsOfCall(goodCall)).length === 0);
    for (const [label, callId] of [["a cancelled call", cancelledCall], ["a call rated 2 stars", starCalls.get(2)!], ["a call older than 7 days", oldCall], ["a call with a refund request", refundCall]] as const) {
      check(`a tip for ${label} is refused by the server, whatever the page showed`, (await refused(T.startTip({ customerId: cara.id, callId, amount: "5", requestKey: randomUUID(), wordingVersion: TIP_WORDING_VERSION, now: new Date() }))) === NO_TIP);
    }
    // A summary that was opened before she rated the call low.
    const staleCall = await hadCall(host, cara);
    const staleTo = `/tips/new?call=${staleCall}&amount=5.00`;
    const staleSummary = await page(staleTo, cara);
    await rateCall({ callId: staleCall, raterId: cara.id, stars: 2, now: new Date() });
    const stale = await press(cara, staleTo, "Continue to the card step", {}, { drawn: staleSummary.text });
    check("a summary that was open before she rated the call 2 stars is refused when it is sent", stale.found && noticeOf(stale) === NO_TIP && (await tipsOfCall(staleCall)).length === 0, noticeOf(stale));
    check("a summary whose wording has changed since it was drawn is refused", /wording of this page has changed/.test(await refused(T.startTip({ customerId: cara.id, callId: goodCall, amount: "5", requestKey: randomUUID(), wordingVersion: "an older version", now: new Date() }))));
    check("$1.99 is refused, and so is nonsense, and so is more than a card payment can be", (await page(`/tips/new?call=${goodCall}&amount=1.99`, cara)).words.includes("The smallest tip is $2.") && (await page(`/tips/new?call=${goodCall}&amount=lots`, cara)).words.includes("Please type an amount in dollars") && (await page(`/tips/new?call=${goodCall}&amount=97099.71`, cara)).words.includes("The largest tip is $97,099.70."));
    check("an amount typed into the box counts before one that was picked", (await page(`/tips/new?call=${goodCall}&amount=5.00&other=7`, cara)).words.includes("$7.52, once"));

    // ----------------------------------------------------------------------
    console.log("\n3. One tip, from the box to the host's earnings");
    const sent = await press(cara, to, "Continue to the card step", {}, { drawn: summary.text });
    const tipId = sent.location.match(/^\/contributions\/([0-9a-f-]{36})$/)?.[1] ?? "";
    const again = await press(cara, to, "Continue to the card step", {}, { drawn: summary.text });
    const [tipRow] = await tipsOfCall(goodCall);
    check("\"Continue to the card step\" starts the tip: $5.00 for this call, $5.46 to pay", Boolean(tipId) && tipRow?.id === tipId && tipRow.kind === "tip" && tipRow.tipCents === 500 && tipRow.amountCents === 546 && tipRow.projectId === null && tipRow.hostId === host.id, `${sent.location} ${noticeOf(sent)}`);
    check("the same press, sent twice, is one tip", again.location === `/contributions/${tipId}` && (await tipsOfCall(goodCall)).length === 1, again.location);
    const [payment0] = await db.select().from(pays).where(eq(pays.contributionId, tipId));
    const paymentId = payment0.id;
    check("its payment is written with the tip's own fee: 2.9% and 30 cents, nothing of Connect's, nothing extra for a card from abroad", payment0.amountCents === 546 && payment0.feePercentBps === 290 && payment0.feeFixedCents === 30 && payment0.feeForeignCardBps === 0);
    const [agreement] = await db.select().from(schema.contributionAgreements).where(eq(schema.contributionAgreements.contributionId, tipId));
    check("what she agreed to is kept, with the version of the wording", agreement?.version === TIP_WORDING_VERSION && agreement.kind === "tip" && agreement.amountCents === 546);
    const cardStep = await page(`/contributions/${tipId}`, cara);
    check("the tip's own page is the card step, in a tip's words, and hands the payment's secret to her form", cardStep.status === 200 && cardStep.words.includes(`Your tip for ${host.displayName}`) && cardStep.words.includes("a tip of $5.00") && cardStep.words.includes("a payment fee of $0.46") && cardStep.words.includes("The card step") && cardStep.text.includes("_secret_"), String(cardStep.status));
    check("at the card step her results show the tip as waiting for her card, and no second box", tipLine(await results(goodCall, cara)) === "to_pay" && noBox(await results(goodCall, cara)));
    check("the host is shown nothing of a tip that has no hold yet, and is sent nothing", tipLine(await results(goodCall, host)) === null && (await emailCount(host.email, "sent you a tip")) === 0);
    check("a second tip for the same call is refused while the first is being paid", (await page(`/tips/new?call=${goodCall}&amount=2`, cara)).words.includes(TIP_THERE) && (await refused(T.startTip({ customerId: cara.id, callId: goodCall, amount: "2", requestKey: randomUUID(), wordingVersion: TIP_WORDING_VERSION, now: new Date() }))) === TIP_THERE);

    await stripe().paymentIntents.confirm((await PM(paymentId)).stripePaymentIntentId!, { payment_method: "pm_card_visa", return_url: RETURN });
    const paid = await send(`/api/contributions/${tipId}/sync`, { json: { payment: paymentId }, jar: cara.jar });
    check("with a test card entered, the app finds the hold at Stripe itself: $5.46 is held", paid.status === 200 && paid.json?.status === "held" && (await PM(paymentId)).status === "held", JSON.stringify(paid.json));
    check("she is sent the receipt, in a tip's words", (await emailsTo(cara.email, `Your tip for ${host.displayName}: $5.00`)) === 1);
    check("the host is told, once: a tip of $5.00, all of it hers", (await emailsTo(host.email, `${cara.name} sent you a tip of $5.00`)) === 1);
    const account = await page("/account", cara);
    check("\"Your account\" lists it under \"Tips you gave\", as held, and not under \"Projects you support\"", account.words.includes("Tips you gave") && account.text.includes(`/contributions/${tipId}`) && account.words.includes("Held on your card") && !account.words.includes("Projects you support"));
    const hostHeld = await results(goodCall, host);
    check("the host now sees the tip on the call's results, held, with \"Let it go\"", tipLine(hostHeld) === "held" && hostHeld.words.includes(`A tip of $5.00 from ${cara.name}`) && formsOf(hostHeld.text).some((f) => f.buttons.some((b) => b.words === "Let it go")));
    check("her own results show it as held, with the way to cancel", tipLine(await results(goodCall, cara)) === "held" && (await results(goodCall, cara)).words.includes("See your tip, or cancel it"));

    // Three days later. (Taken by the app's own function for this one payment, with the later clock: a round of the
    // helper with a clock three days ahead would take every hold in this computer's test database, not only ours.
    // That the helper takes held money at its moment is the contribution's own code, proven by contribution-check.)
    await take(paymentId);
    const taken = await PM(paymentId);
    const share = await shareOf(paymentId);
    check("three days later the money is taken: $5.46", taken.status === "taken" && taken.takenCents === 546, taken.status);
    check("the host's share is the whole tip: $5.00, and the fee is the 46 cents", share?.originalHostShareCents === 500 && share.originalFeeCents === 46 && share.kind === "contribution" && share.callId === null, { share: share?.originalHostShareCents, fee: share?.originalFeeCents });
    check("the tip is complete", (await CO(tipId)).status === "ended" && (await CO(tipId)).endedHow === "paid");
    const hostTaken = await results(goodCall, host);
    check("the host's results say the money was taken, her share of $5.00, and offer \"Refund\"", tipLine(hostTaken) === "taken" && hostTaken.words.includes("Your share: $5.00") && formsOf(hostTaken.text).some((f) => f.buttons.some((b) => b.words === "Refund")));
    const earning = (await unsentEarnings(new Date(), host.id)).find((one) => one.payment.contributionPaymentId === paymentId);
    check("among her earnings it is a tip for that call, $5.00, not ready for one reason alone: its 7 days", earning?.shareCents === 500 && earning.tip?.callId === goodCall && earning.heldBack === "not_yet" && earning.project === null, { share: earning?.shareCents, tip: earning?.tip, why: earning?.heldBack });
    check("the tip's page says it was taken, and that giving it back is the host's decision", (await page(`/contributions/${tipId}`, cara)).words.includes("$5.46 was taken") && (await page(`/contributions/${tipId}`, cara)).words.includes("This tip is complete."));
    check("a paid tip keeps its call: no box, and a second tip is refused", noBox(await results(goodCall, cara)) && (await refused(T.startTip({ customerId: cara.id, callId: goodCall, amount: "2", requestKey: randomUUID(), wordingVersion: TIP_WORDING_VERSION, now: new Date() }))) === TIP_THERE);
    const secondCall = await hadCall(host, cara);
    check("after another call with her, the box is back", boxShown(await results(secondCall, cara)));

    if (!withPayouts) {
      console.log("   SKIPPED collecting: it moves real test money and needs a real test payout account. Run with --payouts.");
    } else {
      const { refreshPayoutsReady, getHostSettings } = await import("../src/lib/payments/hosts");
      const { collectEarnings } = await import("../src/lib/payments/collect");
      const settings = seeded ? await getHostSettings(seeded.id) : null;
      const ready = seeded && settings?.stripeAccountId ? await refreshPayoutsReady(seeded.id) : false;
      check("the test host's payout account is ready", Boolean(ready));
      if (seeded && settings?.stripeAccountId && ready) {
        const payoutAccount = settings.stripeAccountId;
        // One payout account belongs to one host at a time, so the tip's host takes over the test account for this step.
        const give = (from: string, toWhom: string) =>
          db.transaction(async (tx) => {
            await tx.update(schema.hostSettings).set({ stripeAccountId: null }).where(eq(schema.hostSettings.userId, from));
            await tx.update(schema.hostSettings).set({ stripeAccountId: payoutAccount, payoutsReady: true }).where(eq(schema.hostSettings.userId, toWhom));
          });
        await give(seeded.id, host.id);
        try {
          const pressAt = (now: Date) => collectEarnings({ collectionId: randomUUID(), hostId: host.id, startedBy: host.id, now }).then(() => null, (error: unknown) => error as Error);
          // (The "Your earnings" part of the Hosting page is only drawn for a host with a payout account, which she has for this step.)
          const hosting = await page("/host", host);
          check("her Hosting page lists it among her earnings as \"Tip for the call on ...\", $5.00, with a link to that call and the day it is ready", hosting.status === 200 && hosting.text.includes(`href="/calls/${goodCall}/results"`) && /Tip for the call on .{0,120}, \$5\.00: ready on/.test(hosting.words), hosting.words.match(/Not ready yet.{0,300}/)?.[0]);
          const before = (await unsentEarnings(new Date(taken.takenAt!.getTime() + 7 * DAY - MIN), host.id)).find((one) => one.payment.contributionPaymentId === paymentId);
          check("a minute before the tip's 7 days its share is not ready to collect, for that reason alone", before?.heldBack === "not_yet", before?.heldBack);
          const collected = await pressAt(new Date(Math.max(share.transferDueAt!.getTime(), taken.takenAt!.getTime() + 7 * DAY) + MIN));
          const after = await shareOf(paymentId);
          // The whole tip, less the 25-cent charge of a collection (Stripe's charge for a payout).
          check("seven days after the taking she collects it: $5.00, less the 25-cent collection charge", collected === null && after.transferStatus === "sent" && after.transferCents === 475 && after.payoutFeeCents === 25, `${collected?.message} ${after.transferStatus} ${after.transferCents}`);
          const transfer = after.stripeTransferId ? await stripe().transfers.retrieve(after.stripeTransferId) : null;
          check("at Stripe the transfer comes from the tip's own charge", transfer?.destination === payoutAccount && transfer.source_transaction === taken.stripeChargeId);
          const hostSent = await results(goodCall, host);
          check("once collected, the host is offered no refund: only Connect can refund it now", hostSent.words.includes("sent to you") && hostSent.words.includes("only Connect can refund it now") && !formsOf(hostSent.text).some((f) => f.buttons.some((b) => b.words === "Refund")) && /already been collected/.test(await refused(R.refundContribution({ paymentId, amountCents: 100, by: "host", deciderId: host.id, reason: "a check", requestKey: randomUUID() }))));
        } finally {
          await give(host.id, seeded.id);
        }
      } else {
        console.log("   Set up payouts for host@test.local on the Hosting page first.");
      }
    }

    // ----------------------------------------------------------------------
    console.log("\n4. Cancelling, letting go, and one tip for each call");
    const two = await atCardStep(cara, secondCall, "2");
    check("a tip of $2.00 costs $2.37", (await CO(two.contributionId)).amountCents === 237 && (await CO(two.contributionId)).tipCents === 200);
    await pay(two.paymentId);
    check("(it is held; the host is told of this call's tip, once)", (await PM(two.paymentId)).status === "held" && (await emailsTo(host.email, `${cara.name} sent you a tip of $2.00`)) === 1);
    const cancelled = await press(cara, `/contributions/${two.contributionId}`, "Cancel, nothing is charged");
    await helper(new Date());
    check("\"Cancel, nothing is charged\" lets the hold go at Stripe, and her page then says that nothing was charged", cancelled.found && (await intentOf(two.paymentId)).status === "canceled" && (await page(`/contributions/${two.contributionId}`, cara)).words.includes("Cancelled. The hold was let go, and nothing was charged."), noticeOf(cancelled));
    check("she is sent \"nothing was charged\", in a tip's words", (await emailsTo(cara.email, `Nothing was charged: your tip for ${host.displayName}`)) === 1);
    check("both still see that tip on the call, as cancelled; and the box is back for her", tipLine(await results(secondCall, host)) === "cancelled" && boxShown(await results(secondCall, cara)));
    const three = await atCardStep(cara, secondCall, "3");
    await pay(three.paymentId);
    check("after a tip that is certainly gone, a new one for the same call works", (await PM(three.paymentId)).status === "held");
    check("the host is not emailed a second time for the same call", (await emailCount(host.email, `${cara.name} sent you a tip of`)) === 2);
    const hostLetGo = await press(host, `/calls/${secondCall}/results`, "Let it go");
    await helper(new Date());
    check("the host lets a held tip go from the call's results: the hold is gone at Stripe, and the customer is told", hostLetGo.found && hostLetGo.location.startsWith(`/calls/${secondCall}/results`) && (await intentOf(three.paymentId)).status === "canceled" && (await PM(three.paymentId)).endedHow === "host_let_go" && (await emailCount(cara.email, "Nothing was charged: your tip for")) === 2, noticeOf(hostLetGo));
    // Another host's tips: one held, one taken and not collected. Their two forms, as her own page draws them, are sent by the wrong host.
    const olga = await asHost(await signUp("Olga"), "Olga");
    const olgaHeld = await heldTip(olga);
    const olgaTaken = await heldTip(olga);
    await take(olgaTaken.paymentId);
    const olgaHeldPage = await results(olgaHeld.callId, olga);
    const olgaTakenPage = await results(olgaTaken.callId, olga);
    const wrongLetGo = await press(host, `/calls/${olgaHeld.callId}/results`, "Let it go", {}, { drawn: olgaHeldPage.text });
    const wrongRefund = await press(host, `/calls/${olgaTaken.callId}/results`, "Refund", {}, { drawn: olgaTakenPage.text });
    check(
      "a host cannot let go of, or refund, a tip that is not hers: each form, sent by another host, changes nothing and tells her nothing",
      wrongLetGo.found && wrongLetGo.location === "/" && wrongRefund.found && wrongRefund.location === "/" && (await PM(olgaHeld.paymentId)).status === "held" && (await PM(olgaHeld.paymentId)).endedHow === null && (await PM(olgaTaken.paymentId)).refundedCents === 0 && (await db.select().from(schema.contributionRefunds).where(eq(schema.contributionRefunds.contributionPaymentId, olgaTaken.paymentId))).length === 0,
      `${wrongLetGo.location} ${wrongRefund.location} ${(await PM(olgaHeld.paymentId)).status}`,
    );
    check("the app's own functions refuse the same, as \"not found\"", (await refused(R.refundContribution({ paymentId: olgaTaken.paymentId, amountCents: 100, by: "host", deciderId: host.id, reason: "a check", requestKey: randomUUID() }))) === "Payment not found." && /not found/i.test(await refused((await import("../src/lib/contributions/monthly")).letPaymentGo({ paymentId: olgaHeld.paymentId, by: "host", actorId: host.id }))));
    // A tip of her own that never had a hold is not shown to her; a form that names its payment gets the same answer as one that names nothing of hers.
    const unseenCustomer = await quiet("giver");
    const unseen = await atCardStep(unseenCustomer, await hadCall(host, unseenCustomer));
    const unseenLetGo = await press(host, `/calls/${olgaHeld.callId}/results`, "Let it go", { payment: unseen.paymentId }, { drawn: olgaHeldPage.text });
    check("a form that names a tip of hers that never had a hold tells her nothing either: not that it exists, nor which call it is for", unseenLetGo.found && unseenLetGo.location === "/" && (await PM(unseen.paymentId)).status === "to_pay" && (await PM(unseen.paymentId)).endedHow === null, unseenLetGo.location);
    await C.giveUp(unseen.paymentId, "cancelled", new Date());

    // A tip that is still being cancelled keeps its call. (Pretended: its reason is saved, and the hold is not let go yet.)
    const slow = await heldTip(host);
    await db.transaction(async (tx) => C.giveUpInStep(tx, await lockForPayment(tx, slow.paymentId), "cancelled", new Date()));
    check("while a tip is still being cancelled, no second one for its call can start", (await CO(slow.contributionId)).status === "ended" && (await tipThere(db, slow.callId)) && (await refused(T.startTip({ customerId: slow.customer.id, callId: slow.callId, amount: "2", requestKey: randomUUID(), wordingVersion: TIP_WORDING_VERSION, now: new Date() }))) === TIP_THERE);
    await helper(new Date());
    check("once its hold is certainly gone, one can", (await PM(slow.paymentId)).status === "given_up" && !(await tipThere(db, slow.callId)));
    // Cancelled, and the money is taken at that very moment after all.
    const late = await heldTip(host);
    await db.transaction(async (tx) => C.giveUpInStep(tx, await lockForPayment(tx, late.paymentId), "cancelled", new Date()));
    await stripe().paymentIntents.capture((await PM(late.paymentId)).stripePaymentIntentId!);
    await C.syncPayment(late.paymentId, new Date());
    const lateRefunds = await db.select().from(schema.contributionRefunds).where(eq(schema.contributionRefunds.contributionPaymentId, late.paymentId));
    check("a cancelled tip whose money was taken after all is paid back in full, once, with nothing for the host", (await PM(late.paymentId)).status === "taken" && lateRefunds.length === 1 && lateRefunds[0].amountCents === 546 && !(await shareOf(late.paymentId)), { refunds: lateRefunds.length });
    check("and it keeps its call for good: a second tip stays refused", (await refused(T.startTip({ customerId: late.customer.id, callId: late.callId, amount: "2", requestKey: randomUUID(), wordingVersion: TIP_WORDING_VERSION, now: new Date() }))) === TIP_THERE);
    await helper(new Date());
    await helper(new Date());
    check("the refund reaches her card", (await PM(late.paymentId)).refundedCents === 546 && (await db.select().from(schema.contributionRefunds).where(eq(schema.contributionRefunds.contributionPaymentId, late.paymentId))).length === 1, (await PM(late.paymentId)).refundedCents);
    // Two tips for one call, started at the same moment.
    const eager = await quiet("giver");
    const eagerCall = await hadCall(host, eager);
    const both = await Promise.allSettled([1, 2].map(() => T.startTip({ customerId: eager.id, callId: eagerCall, amount: "5", requestKey: randomUUID(), wordingVersion: TIP_WORDING_VERSION, now: new Date() })));
    check("two tips for one call started at the same moment: one starts, the other is refused", both.filter((one) => one.status === "fulfilled").length === 1 && (await tipsOfCall(eagerCall)).length === 1, both.map((one) => (one.status === "rejected" ? (one.reason as Error).message : "started")));

    // ----------------------------------------------------------------------
    console.log("\n5. A card step that runs out");
    const left = await atCardStep(await quiet("giver"), await hadCall(host, cara), "5").catch(() => null);
    check("(a tip for a call that is not the person's own is never started, also here)", left === null);
    const fay = await signUp("Fay");
    const fayCall = await hadCall(host, fay);
    const abandoned = await atCardStep(fay, fayCall);
    await db.update(pays).set({ cardStepExpiresAt: new Date(Date.now() - MIN) }).where(eq(pays.id, abandoned.paymentId));
    await helper(new Date());
    check("a card step that ran out undoes the tip: nothing was held, and her page says so", (await PM(abandoned.paymentId)).status === "given_up" && (await PM(abandoned.paymentId)).endedHow === "card_step" && (await page(`/contributions/${abandoned.contributionId}`, fay)).words.includes("The card step was not finished in time."));
    check("the host never saw it and was sent nothing; the customer is asked again, and it is not listed under \"Tips you gave\"", tipLine(await results(fayCall, host)) === null && (await emailCount(host.email, `${fay.name} sent you a tip`)) === 0 && boxShown(await results(fayCall, fay)) && !(await page("/account", fay)).words.includes("Tips you gave"));
    // A hold placed in time, heard of only after the card step's time.
    const inTime = await atCardStep(fay, fayCall);
    const confirmed = await stripe().paymentIntents.confirm((await PM(inTime.paymentId)).stripePaymentIntentId!, { payment_method: "pm_card_visa", return_url: RETURN, expand: ["latest_charge"] });
    const heldAt = typeof confirmed.latest_charge === "object" && confirmed.latest_charge ? confirmed.latest_charge.created * 1000 : Date.now();
    await db.update(pays).set({ cardStepExpiresAt: new Date(heldAt + 1000) }).where(eq(pays.id, inTime.paymentId));
    await pause(2500);
    await helper(new Date());
    check("a hold placed within the card step's time counts, also when the app hears of it only afterwards", (await PM(inTime.paymentId)).status === "held" && (await PM(inTime.paymentId)).endedHow === null, (await PM(inTime.paymentId)).status);
    await C.giveUp(inTime.paymentId, "cancelled", new Date());
    // Stripe is still working on a payment when the card step's time is over: nothing is decided until it has an outcome.
    const gus = await quiet("giver");
    const gusCall = await hadCall(host, gus);
    const working = await atCardStep(gus, gusCall);
    await db.update(pays).set({ cardStepExpiresAt: new Date(Date.now() - MIN) }).where(eq(pays.id, working.paymentId));
    const intents = stripe().paymentIntents;
    const realRetrieve = intents.retrieve;
    const snapshot = await intents.retrieve((await PM(working.paymentId)).stripePaymentIntentId!, { expand: ["latest_charge", "payment_method"] });
    intents.retrieve = (() => Promise.resolve({ ...snapshot, status: "processing" })) as unknown as typeof intents.retrieve;
    try {
      await helper(new Date());
    } finally {
      intents.retrieve = realRetrieve;
    }
    check("while Stripe is still working on a payment, its card step is not ended, and no second tip for the call can start", (await PM(working.paymentId)).status === "to_pay" && (await PM(working.paymentId)).endedHow === null && (await refused(T.startTip({ customerId: gus.id, callId: gusCall, amount: "2", requestKey: randomUUID(), wordingVersion: TIP_WORDING_VERSION, now: new Date() }))) === TIP_THERE, (await PM(working.paymentId)).endedHow);
    await helper(new Date());
    check("once Stripe shows that nothing came of it, the card step is ended", (await PM(working.paymentId)).status === "given_up" && (await PM(working.paymentId)).endedHow === "card_step");
    // A card that was saved for a booking is that booking's alone (decision 7). (Pretended: a card is saved at Stripe the way a booking's card step saves one.)
    const bo = await quiet("giver");
    const boTip = await atCardStep(bo, await hadCall(host, bo));
    const [boCustomer] = await db.select().from(schema.stripeCustomers).where(eq(schema.stripeCustomers.userId, bo.id));
    const saved = await stripe().setupIntents.create({ customer: boCustomer.stripeCustomerId, payment_method: "pm_card_visa", allowed_payment_method_types: ["card"], confirm: true, usage: "off_session", metadata: { bookingId: randomUUID() } });
    await stripe().paymentIntents.confirm((await PM(boTip.paymentId)).stripePaymentIntentId!, { payment_method: saved.payment_method as string, return_url: RETURN });
    await C.syncPayment(boTip.paymentId, new Date());
    await helper(new Date());
    // The same when Stripe no longer shows the card as kept for the customer (a booking's card is removed there after its
    // call): our own line of the booking still knows the card by its id. (Pretended: the id of the card this tip was
    // paid with is written onto a booking of the customer's before the app looks.)
    const dee = await quiet("giver");
    const deeCall = await hadCall(host, dee);
    const deeTip = await atCardStep(dee, deeCall);
    const deePaid = await stripe().paymentIntents.confirm((await PM(deeTip.paymentId)).stripePaymentIntentId!, { payment_method: "pm_card_visa", return_url: RETURN });
    await db.update(schema.bookings).set({ stripePaymentMethodId: deePaid.payment_method as string }).where(eq(schema.bookings.callId, deeCall));
    await C.syncPayment(deeTip.paymentId, new Date());
    await helper(new Date());
    check("nor on a card that our own lines know as a booking's, also when Stripe no longer shows it as kept", (await PM(deeTip.paymentId)).status === "given_up" && (await PM(deeTip.paymentId)).endedHow === "saved_card" && (await intentOf(deeTip.paymentId)).status === "canceled",`${(await PM(deeTip.paymentId)).status} ${(await PM(deeTip.paymentId)).endedHow}`);
    check("a hold placed for a tip on a card that was saved for a booking is not accepted: it is let go, and nothing is taken", (await PM(boTip.paymentId)).status === "given_up" && (await PM(boTip.paymentId)).endedHow === "saved_card" && (await intentOf(boTip.paymentId)).status === "canceled", `${(await PM(boTip.paymentId)).status} ${(await PM(boTip.paymentId)).endedHow}`);

    // ----------------------------------------------------------------------
    console.log("\n6. Refunds are the host's decision");
    const ray = await signUp("Ray");
    const rayCall = await hadCall(host, ray);
    const refundable = await heldTip(host, { customer: ray, callId: rayCall });
    await take(refundable.paymentId);
    const half = await press(host, `/calls/${rayCall}/results`, "Refund", { amount: "2.73" });
    await helper(new Date());
    check("the host gives back $2.73 of the $5.46 from the call's results: it goes to the customer's card", half.found && (await PM(refundable.paymentId)).refundedCents === 273, `${noticeOf(half)} ${(await PM(refundable.paymentId)).refundedCents}`);
    check("her share gets smaller in the same proportion: $2.50 of the $5.00", currentSplit(await shareOf(refundable.paymentId)).hostShareCents === 250, currentSplit(await shareOf(refundable.paymentId)).hostShareCents);
    check("both pages say so, and the customer is sent an email", (await results(rayCall, host)).words.includes("$2.73 was paid back to the customer") && (await page(`/contributions/${refundable.contributionId}`, ray)).words.includes("$2.73 of it was paid back to your card") && (await emailsTo(ray.email, `$2.73 of your tip for ${host.displayName}`)) === 1);
    check("more than is left cannot be given back", /At most \$2\.73/.test(await refused(R.refundContribution({ paymentId: refundable.paymentId, amountCents: 300, by: "host", deciderId: host.id, reason: "a check", requestKey: randomUUID() }))));
    const rest = await press(host, `/calls/${rayCall}/results`, "Refund", { amount: "2.73" });
    await helper(new Date());
    check("she gives back the rest: all of it is back on the card, and her share is nothing", rest.found && (await PM(refundable.paymentId)).refundedCents === 546 && currentSplit(await shareOf(refundable.paymentId)).hostShareCents === 0, (await PM(refundable.paymentId)).refundedCents);
    check("a refunded tip still keeps its call", noBox(await results(rayCall, ray)) && tipLine(await results(rayCall, ray)) === "taken");

    // ----------------------------------------------------------------------
    console.log("\n7. A block, a pause, a closed account and a suspended page");
    const ben = await signUp("Ben");
    const benPaid = await heldTip(host, { customer: ben });
    await take(benPaid.paymentId);
    const benHeld = await heldTip(host, { customer: ben });
    await block({ blockerId: ben.id, blockedId: host.id, now: new Date() });
    await helper(new Date());
    check("a block lets a held tip between the two go, and leaves a taken one alone", (await PM(benHeld.paymentId)).status === "given_up" && (await intentOf(benHeld.paymentId)).status === "canceled" && (await PM(benPaid.paymentId)).status === "taken" && (await shareOf(benPaid.paymentId))?.originalHostShareCents === 500);
    check("the taken tip is still shown to both, and nobody is asked for another", tipLine(await results(benPaid.callId, ben)) === "taken" && tipLine(await results(benPaid.callId, host)) === "taken" && noBox(await results(benHeld.callId, ben)));
    // A pause. (Pretended: the person's line is written, and the step is run that a real pause runs for contributions.)
    const pat = await quiet("giver");
    const patHeld = await heldTip(host, { customer: pat });
    await letGoAll(await db.transaction(async (tx) => {
      await tx.update(schema.user).set({ pausedAt: new Date() }).where(eq(schema.user.id, pat.id));
      return endContributionsOf(tx, pat.id, "paused", new Date());
    }));
    check("a paused customer's held tip is let go, and a new one is refused", (await PM(patHeld.paymentId)).status === "given_up" && (await refused(T.startTip({ customerId: pat.id, callId: await hadCall(host, pat), amount: "2", requestKey: randomUUID(), wordingVersion: TIP_WORDING_VERSION, now: new Date() }))) === "Your account is paused, so you cannot give a tip at the moment.");
    // A closed account: the app's own function.
    const cleo = await signUp("Cleo");
    const cleoPaid = await heldTip(host, { customer: cleo });
    await take(cleoPaid.paymentId);
    const cleoHeld = await heldTip(host, { customer: cleo });
    await closeAccount({ userId: cleo.id, by: switchSaver.id });
    await helper(new Date());
    check("closing the customer's account lets their held tip go and leaves their taken one alone", (await PM(cleoHeld.paymentId)).status === "given_up" && (await PM(cleoPaid.paymentId)).status === "taken");
    check("the host still sees the taken tip on that call (the closed account can no longer sign in)", tipLine(await results(cleoPaid.callId, host)) === "taken");
    // A suspended host page. (Pretended in the same way.)
    const sue = await asHost(await quiet("host"), "Sue");
    const sueHeld = await heldTip(sue);
    await letGoAll(await db.transaction(async (tx) => {
      await tx.update(schema.hostProfiles).set({ status: "suspended" }).where(eq(schema.hostProfiles.userId, sue.id));
      return endContributionsOf(tx, sue.id, "suspended", new Date(), { asHostOnly: true });
    }));
    check("a suspended host page lets a held tip for her go, and a new one is refused", (await PM(sueHeld.paymentId)).status === "given_up" && (await refused(T.startTip({ customerId: sueHeld.customer.id, callId: await hadCall(sue, sueHeld.customer), amount: "2", requestKey: randomUUID(), wordingVersion: TIP_WORDING_VERSION, now: new Date() }))) === NO_TIP);

    // ----------------------------------------------------------------------
    console.log("\n8. Tips and contributions counted together, and a bank dispute");
    // Mona contributes $995 every month to Pia's project, through the pages.
    const diary = await page(`/h/${pia.handle}/project`, mona);
    const contributeTo = leadsTo(diary.text, "Contribute every month", { amount: "995.00" }) ?? "";
    const startedMonthly = await press(mona, contributeTo, "Continue to the card step", { agreed: "on" }, { drawn: (await page(contributeTo, mona)).text });
    const monthlyId = startedMonthly.location.match(/^\/contributions\/([0-9a-f-]{36})$/)?.[1] ?? "";
    const [monthlyPayment] = monthlyId ? await db.select().from(pays).where(eq(pays.contributionId, monthlyId)) : [];
    if (!monthlyPayment) throw new Error(`The monthly contribution did not start: ${noticeOf(startedMonthly)}`);
    await pay(monthlyPayment.id);
    await take(monthlyPayment.id);
    check("(she contributes $995.00 a month to the host's project, and the first month was taken)", (await PM(monthlyPayment.id)).status === "taken" && (await CO(monthlyId)).status === "running");
    const afterContributing = await results(monaCall, mona);
    check("someone who already contributes is not shown the project's box, so they are asked for a tip", !hasMark(afterContributing, "data-project-ask") && boxShown(afterContributing));
    const monaTip = await heldTip(pia, { customer: mona, callId: monaCall });
    // $995.00 taken and $5.46 held: $1,000.46, over the line.
    check("a $5.00 tip ($5.46) on top of $995.00 crosses the $1,000 line: the tip carries the 30-day mark", (await PM(monaTip.paymentId)).thirtyDayMark === true && (await PM(monthlyPayment.id)).thirtyDayMark === true);
    await take(monaTip.paymentId);
    const monaShare = await shareOf(monaTip.paymentId);
    check("its share waits 30 days from its taking, not 7", Math.abs(monaShare.transferDueAt!.getTime() - ((await PM(monaTip.paymentId)).takenAt!.getTime() + 30 * DAY)) < MIN, monaShare.transferDueAt?.toISOString());
    // A dispute, with Stripe's test card that is always disputed, on a tip for a second call.
    const disputed = await heldTip(pia, { customer: mona, card: "pm_card_createDispute" });
    await take(disputed.paymentId);
    let disputeId: string | undefined;
    for (let i = 0; i < 30 && !disputeId; i++) {
      disputeId = (await stripe().disputes.list({ payment_intent: (await PM(disputed.paymentId)).stripePaymentIntentId!, limit: 1 })).data[0]?.id;
      if (!disputeId) await pause(2000);
    }
    check("(Stripe's test card opened a dispute)", Boolean(disputeId));
    if (disputeId) {
      await handleStripeEvent({ type: "charge.dispute.created", data: { object: { id: disputeId } } } as Parameters<typeof handleStripeEvent>[0]);
      check("a message about a dispute finds the tip's payment and records it as open", (await PM(disputed.paymentId)).dispute === "open");
      const [recorded] = await db.select().from(schema.disputes).where(eq(schema.disputes.id, disputeId));
      check("the dispute has a record of its own, as the tip's payment's, for this host and this customer (plans/47)", recorded?.contributionPaymentId === disputed.paymentId && recorded.hostId === pia.id && recorded.customerId === mona.id, JSON.stringify(recorded ?? null).slice(0, 160));
      const toldAbout = await db.select().from(schema.messages).where(like(schema.messages.key, `dispute:${disputeId}:%`));
      check("the host is told in words about a tip, and the customer's message leads to that call's page", toldAbout.some((one) => one.userId === pia.id && one.body.includes("a tip for the call on")) && toldAbout.some((one) => one.userId === mona.id && one.path === `/calls/${disputed.callId}/results`), toldAbout.map((one) => one.path).join(" "));
      check("the tip can be neither collected nor refunded", (await unsentEarnings(new Date(Date.now() + 40 * DAY), pia.id)).find((one) => one.payment.contributionPaymentId === disputed.paymentId)?.heldBack === "dispute" && /disputed/.test(await refused(R.refundContribution({ paymentId: disputed.paymentId, amountCents: 100, by: "host", deciderId: pia.id, reason: "a check", requestKey: randomUUID() }))));
      check("and her monthly contribution goes on", (await CO(monthlyId)).status === "running");
      check("the host's results of that call say that the charge is disputed, and offer no refund", (await results(disputed.callId, pia)).words.includes("has disputed this charge") && !formsOf((await results(disputed.callId, pia)).text).some((f) => f.buttons.some((b) => b.words === "Refund")));
    }

    // ----------------------------------------------------------------------
    console.log("\n9. Ratings are not touched");
    const ratingsBefore = (await db.select({ n: sql<number>`count(*)::int` }).from(schema.ratings).where(eq(schema.ratings.ratedId, host.id)))[0].n;
    const shy = await quiet("giver");
    const shyTip = await heldTip(host, { customer: shy });
    check("giving a tip writes no rating", (await db.select({ n: sql<number>`count(*)::int` }).from(schema.ratings).where(eq(schema.ratings.ratedId, host.id)))[0].n === ratingsBefore);
    await rateCall({ callId: shyTip.callId, raterId: shy.id, stars: 1, now: new Date() });
    await helper(new Date());
    check("a low rating given after a tip leaves the tip as it is", (await PM(shyTip.paymentId)).status === "held" && (await PM(shyTip.paymentId)).endedHow === null);
    await C.giveUp(shyTip.paymentId, "cancelled", new Date());

    // ----------------------------------------------------------------------
    console.log("\n10. The switches");
    const quietHost = await asHost(await quiet("host"), "Tess");
    const t1 = await heldTip(quietHost);
    const t2Customer = await quiet("giver");
    const t2 = await atCardStep(t2Customer, await hadCall(quietHost, t2Customer));
    // A held contribution to a project of the same kind of host, to see that each switch touches only its own.
    const kim = await signUp("Kim");
    const kimTo = leadsTo((await page(`/h/${pia.handle}/project`, kim)).text, "Contribute once", { amount: "10.00" }) ?? "";
    const kimStarted = await press(kim, kimTo, "Continue to the card step", {}, { drawn: (await page(kimTo, kim)).text });
    const kimId = kimStarted.location.match(/^\/contributions\/([0-9a-f-]{36})$/)?.[1] ?? "";
    const [kimPayment] = kimId ? await db.select().from(pays).where(eq(pays.contributionId, kimId)) : [];
    if (!kimPayment) throw new Error(`Kim's contribution did not start: ${noticeOf(kimStarted)}`);
    await pay(kimPayment.id);
    // (Mona already contributes to her project, so she is asked for a tip and not for the project.)
    const piaTip = await heldTip(pia, { customer: mona });
    check("(a tip and a contribution to the same host are both held)", (await PM(kimPayment.id)).status === "held" && (await PM(piaTip.paymentId)).status === "held");

    // Off for our hosts. A host of someone else with a payment that is not taken stays named, so that this script
    // never gives up a payment it did not make. (With none there, the switch is simply off.)
    const ours = (await db.select({ id: schema.user.id }).from(schema.user).where(like(schema.user.email, "tipcheck-%"))).map((row) => row.id);
    const withOpenPayment = (await db.select({ hostId: schema.contributions.hostId }).from(pays).innerJoin(schema.contributions, eq(schema.contributions.id, pays.contributionId)).where(inArray(pays.status, ["to_pay", "held"]))).map((row) => row.hostId);
    // And every host with a monthly contribution that runs: between two months it has no payment that is not taken, and it must not be marked either.
    const withMonthly = (await db.select({ hostId: schema.contributions.hostId }).from(schema.contributions).where(and(eq(schema.contributions.kind, "monthly"), sql`${schema.contributions.status} <> 'ended'`))).map((row) => row.hostId);
    const others = [...new Set([...withOpenPayment, ...withMonthly])].filter((id) => !ours.includes(id));
    await saveProjectsSwitch({ adminId: switchSaver.id, values: others.length > 0 ? { projects: "named", projectsHosts: others } : { projects: "off" }, detail: "off for the tip check's hosts" });
    await helper(new Date());
    check("switching PROJECTS off gives up the held contribution and does not touch a held tip", (await PM(kimPayment.id)).status === "given_up" && (await PM(piaTip.paymentId)).status === "held" && (await PM(piaTip.paymentId)).endedHow === null && (await PM(t1.paymentId)).status === "held");
    check("and a tip can still be started while projects are off", (await PM((await heldTip(quietHost)).paymentId)).status === "held");
    await saveProjectsSwitch({ adminId: switchSaver.id, values: { projects: "everyone", projectsHosts: atStart.projectsHosts }, detail: "on for everyone (the tip check)" });
    const kim2To = leadsTo((await page(`/h/${pia.handle}/project`, kim)).text, "Contribute once", { amount: "10.00" }) ?? "";
    const kim2Started = await press(kim, kim2To, "Continue to the card step", {}, { drawn: (await page(kim2To, kim)).text });
    const kim2Id = kim2Started.location.match(/^\/contributions\/([0-9a-f-]{36})$/)?.[1] ?? "";
    const [kim2Payment] = kim2Id ? await db.select().from(pays).where(eq(pays.contributionId, kim2Id)) : [];
    if (kim2Payment) await pay(kim2Payment.id);
    check("(with projects on again, a new contribution is held)", kim2Payment ? (await PM(kim2Payment.id)).status === "held" : false);

    // A card form that is open in a browser, with its secret, when tips are switched off.
    const openCustomer = await signUp("Omar");
    const openCall = await hadCall(host, openCustomer);
    const freshCall2 = await hadCall(host, openCustomer);
    const open = await atCardStep(openCustomer, openCall);
    const openPage = await page(`/contributions/${open.contributionId}`, openCustomer);
    const openSummary = await page(`/tips/new?call=${freshCall2}&amount=5.00`, openCustomer);
    check("(his card form is open, with its secret, and a summary for another call too)", openPage.text.includes("_secret_") && formsOf(openSummary.text).some((f) => f.buttons.some((b) => b.words === "Continue to the card step")));
    await saveTipsSwitch({ adminId: switchSaver.id, off: true });
    check("switching TIPS off gives up every tip that is not taken: the held ones and the open card steps", (await PM(t1.paymentId)).endedHow === "switch" && (await PM(t2.paymentId)).endedHow === "switch" && (await PM(piaTip.paymentId)).endedHow === "switch" && (await PM(open.paymentId)).endedHow === "switch");
    await helper(new Date());
    check("their holds are let go at Stripe, and the open card step's payment is cancelled there", (await intentOf(t1.paymentId)).status === "canceled" && (await PM(t1.paymentId)).status === "given_up" && (await intentOf(open.paymentId)).status === "canceled" && (await PM(t2.paymentId)).status === "given_up");
    check("a tip that was taken before is not touched", (await PM(paymentId)).status === "taken" && (await PM(benPaid.paymentId)).status === "taken");
    check("and a held contribution to a project is not touched by the TIPS switch", Boolean(kim2Payment) && (await PM(kim2Payment.id)).status === "held" && (await PM(kim2Payment.id)).endedHow === null);
    const offForm = await stripe().paymentIntents.confirm((await PM(open.paymentId)).stripePaymentIntentId!, { payment_method: "pm_card_visa", return_url: RETURN }).then(() => "it was confirmed", () => "refused");
    check("the card form that was open can no longer place a hold", offForm === "refused", offForm);
    const offPress = await press(openCustomer, `/tips/new?call=${freshCall2}&amount=5.00`, "Continue to the card step", {}, { drawn: openSummary.text });
    check("a summary that was open before is refused, and nothing is started", offPress.found && noticeOf(offPress) === TIPS_OFF && (await tipsOfCall(freshCall2)).length === 0, noticeOf(offPress));
    const offSummary = await page(`/tips/new?call=${freshCall2}&amount=5.00`, openCustomer);
    check("while tips are off: no box, and the summary page says so with nothing to press", noBox(await results(freshCall2, openCustomer)) && offSummary.words.includes(TIPS_OFF) && !formsOf(offSummary.text).some((f) => f.buttons.some((b) => b.words === "Continue to the card step")));
    // A hold that a form opened earlier still places in the moment before its payment is cancelled at Stripe.
    // (Pretended: the switch's line alone is written, so the tip is still waiting for its card as if that moment lasted.)
    await setSwitches({ tipsOff: false });
    const racing = await atCardStep(openCustomer, freshCall2);
    await setSwitches({ tipsOff: true });
    check(
      "while tips are off, no way to pay is handed out for a tip that is still waiting for its card: neither by the button nor by opening its page",
      (await PM(racing.paymentId)).status === "to_pay" && (await PM(racing.paymentId)).endedHow === null && (await S.payNow({ paymentId: racing.paymentId, contributorId: openCustomer.id })) === null && (await S.secretToPay({ paymentId: racing.paymentId, contributorId: openCustomer.id })) === null && !(await page(`/contributions/${racing.contributionId}`, openCustomer)).text.includes("_secret_"),
    );
    await pay(racing.paymentId);
    await helper(new Date());
    check("a hold that still lands while tips are off is not accepted: it is let go, and nothing is kept", (await PM(racing.paymentId)).status === "given_up" && (await PM(racing.paymentId)).endedHow === "switch" && (await intentOf(racing.paymentId)).status === "canceled", `${(await PM(racing.paymentId)).status} ${(await PM(racing.paymentId)).endedHow}`);
    // The helper's own search is the net behind the step that saves the switch.
    await setSwitches({ tipsOff: false });
    const netTip = await heldTip(quietHost);
    const netStep = await atCardStep(await (async () => t2Customer)(), await hadCall(quietHost, t2Customer));
    await setSwitches({ tipsOff: true });
    await helper(new Date());
    check("the helper gives up a held tip and an open card step that the saving of the switch did not reach", (await PM(netTip.paymentId)).status === "given_up" && (await PM(netTip.paymentId)).endedHow === "switch" && (await PM(netStep.paymentId)).endedHow === "switch");
    // Money that Stripe was already asked to take at that very moment.
    await setSwitches({ tipsOff: false });
    const mid = await heldTip(quietHost);
    await saveTipsSwitch({ adminId: switchSaver.id, off: true });
    check("a tip whose money may not be taken while tips are off is not taken: it was given up with the switch", (await C.takePayment(mid.paymentId, (await PM(mid.paymentId)).takeAt ?? new Date(Date.now() + 4 * DAY))).status !== "taken" && !(await shareOf(mid.paymentId)));

    await saveTipsSwitch({ adminId: switchSaver.id, off: false });
    await helper(new Date());
    check("switched on again, nothing old comes back", (await PM(t1.paymentId)).status === "given_up" && (await PM(open.paymentId)).status === "given_up" && (await PM(racing.paymentId)).status === "given_up" && (await PM(mid.paymentId)).status === "given_up");
    check("and the box is back for a call that qualifies", boxShown(await results(freshCall2, openCustomer)));
    // The host ends her project while a tip for her and a contribution to it are both held.
    const piaTip2 = await heldTip(pia, { customer: mona });
    const ended = await press(pia, "/host/project", "End this project", { sure: "on" });
    await helper(new Date());
    check("the host ending her project gives up the held contribution to it, and does not touch her held tip", ended.found && (await runningProjectOf(pia.id)) === null && Boolean(kim2Payment) && (await PM(kim2Payment.id)).status === "given_up" && (await PM(piaTip2.paymentId)).status === "held" && (await PM(piaTip2.paymentId)).endedHow === null, noticeOf(ended));
    check("the saving of the tips switch is in the founder's record", (await db.select().from(schema.adminActions).where(and(eq(schema.adminActions.action, "tips switch set"), eq(schema.adminActions.adminId, switchSaver.id)))).length === 3);

    // ----------------------------------------------------------------------
    console.log("\n11. The founder's page");
    const accounts = existsSync("test-accounts.local.md") ? readFileSync("test-accounts.local.md", "utf8").split("\n") : [];
    const adminSecret = accounts.find((l) => l.startsWith("admin TOTP secret:"))?.replace("admin TOTP secret:", "").trim();
    const adminPassword = accounts.find((l) => l.includes("admin@test.local"))?.split("|").map((c) => c.trim())[3];
    const admin: Person = { id: "", name: "admin", email: "admin@test.local", jar: new Map() };
    if (adminSecret && adminPassword) {
      await send("/api/auth/sign-in/email", { json: { email: "admin@test.local", password: adminPassword }, jar: admin.jar });
      await send("/api/auth/two-factor/verify-totp", { json: { code: totpCode(adminSecret), trustDevice: false }, jar: admin.jar });
    }
    check("the founder's page is \"not found\" for a host and for a customer", (await page("/admin/projects", host)).status === 404 && (await page("/admin/projects", cara)).status === 404);
    const founder = await page("/admin/projects", admin);
    if (founder.status !== 200 && adminSecret && adminPassword) {
      check("the founder's page opens for the test admin's login", false, `it answered ${founder.status}`);
    } else if (founder.status !== 200) {
      console.log("   SKIPPED the founder's own view: the test admin's login is not set up (test-accounts.local.md, npx tsx scripts/secure-test-admin.ts).");
    } else {
      check("the founder's page has the tips switch, on, and the way to every tip", hasMark(founder, "data-tips-switch") && founder.words.includes("Save tips switch") && founder.text.includes('href="/admin/projects?tips=1"'));
      const everyTip = await page("/admin/projects?tips=1", admin);
      check("\"Every tip\" lists the tips, each as a tip for a call, with who gave it to whom", hasMark(everyTip, "data-tip-payments") && everyTip.words.includes(`from ${cara.name} to ${host.name}, a tip of $5.00 for a call`), everyTip.words.slice(0, 200));
      // Each of the two is found by the link to its own call, and what is said of it is read inside its own row.
      const rowOf = (callId: string) => words(founder.text.split(/<li\b/).find((part) => part.includes(`href="/calls/${callId}/results"`)) ?? "");
      check("the tip over the $1,000 line is in the list of what needs a look, named as a tip, with the mark in its own row", rowOf(monaCall).includes(`from ${mona.name} to ${pia.name}, a tip of $5.00 for a call`) && rowOf(monaCall).includes("Counted over the $1,000 line"), rowOf(monaCall).slice(0, 200));
      check("so is the disputed one, with the dispute in its own row, and no day on which the host could collect it", rowOf(disputed.callId).includes("a tip of $5.00 for a call") && rowOf(disputed.callId).includes("has disputed this charge") && !rowOf(disputed.callId).includes("The host can collect it from"), rowOf(disputed.callId).slice(0, 300));
      const lastTip = await heldTip(host);
      const let1 = await press(admin, "/admin/projects?tips=1", "Let it go", { note: "A check by the tip script." }, { where: (form) => form.fields.some(([name, value]) => name === "payment" && value === lastTip.paymentId) });
      await helper(new Date());
      check("the founder lets a held tip go, with a reason", let1.found && (await PM(lastTip.paymentId)).status === "given_up" && (await PM(lastTip.paymentId)).endedHow === "founder_let_go", noticeOf(let1));
      // The line each press writes into the founder's record is noted by its id right after that press, and removed
      // at the end: exactly one new line for one press. Anything else is not ours to judge, and is left where it is.
      const linesOfAdmin = async () => (await db.select({ id: schema.adminActions.id }).from(schema.adminActions).innerJoin(schema.user, eq(schema.user.id, schema.adminActions.adminId)).where(and(eq(schema.adminActions.action, "tips switch set"), eq(schema.user.email, "admin@test.local")))).map((row) => row.id);
      const pressSwitch = async (tips: "on" | "off") => {
        const before = await linesOfAdmin();
        const reply = await press(admin, "/admin/projects", "Save tips switch", { tips });
        const added = (await linesOfAdmin()).filter((id) => !before.includes(id));
        if (added.length === 1) founderRecord.push(added[0]);
        return { reply, recorded: added.length === 1 };
      };
      const off = await pressSwitch("off");
      check("the founder switches tips off on the page, and it is in the founder's record", off.reply.found && noticeOf(off.reply).startsWith("Tips are off.") && (await switches()).tipsOff === true && off.recorded, noticeOf(off.reply));
      const on = await pressSwitch("on");
      check("and on again", on.reply.found && noticeOf(on.reply) === "Tips are on." && (await switches()).tipsOff === false && on.recorded, noticeOf(on.reply));
      await send("/api/auth/sign-out", { json: {}, jar: admin.jar });
    }

    // ----------------------------------------------------------------------
    console.log("\n12. The pages that only read");
    const tipsCode = readFileSync("src/lib/contributions/tips.ts", "utf8");
    const resultsCode = readFileSync("src/app/calls/[id]/results/page.tsx", "utf8");
    const summaryCode = readFileSync("src/app/tips/new/page.tsx", "utf8");
    check("the file behind the box and the tip's lines has no statement that writes, and does not ask Stripe", !/\.(insert|update|delete|transaction|execute)\(/.test(tipsCode) && !/stripe\(\)/.test(tipsCode));
    check("the results page and the summary page import none of the code that starts, pays, stops or refunds", !/from "@\/lib\/contributions\/(start|tip-start|charge|monthly|refund|ending|switch|jobs)"/.test(resultsCode + summaryCode));
  } finally {
    await setSwitches({ tipsOff: atStart.tipsOff, projects: atStart.projects, projectsHosts: atStart.projectsHosts }).catch((error) => check("afterwards: the founder's switches could be put back", false, String(error)));
    // The lines this run's own two presses wrote into the founder's record, by their ids (they name no person, so the clean-up by person does not find them).
    if (founderRecord.length > 0) await db.delete(schema.adminActions).where(inArray(schema.adminActions.id, founderRecord)).catch((error) => check("afterwards: this run's lines in the founder's record could be removed", false, String(error)));
    await wipe().catch((error) => check("afterwards: what this run made could be removed", false, String(error)));
    await db.delete(schema.rateLimit);
  }

  const [left] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.user).where(like(schema.user.email, "tipcheck-%"));
  const [leftEmails] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.emailOutbox).where(like(schema.emailOutbox.to, "tipcheck-%"));
  const [leftTips] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.contributions).where(eq(schema.contributions.kind, "tip"));
  const atEnd = await switches();
  check("the script's own test data was cleaned up, and the founder's switches are as they were", left.n === 0 && leftEmails.n === 0 && atEnd.tipsOff === atStart.tipsOff && atEnd.projects === atStart.projects && atEnd.projectsHosts.join(",") === atStart.projectsHosts.join(","), `${left.n} people left, ${leftTips.n} tips in the database`);
  const [seededAfter] = seeded ? await db.select().from(schema.hostSettings).where(eq(schema.hostSettings.userId, seeded.id)) : [];
  check("the test payout account is where it was", (seededAfter?.stripeAccountId ?? null) === payoutAccountBefore);
  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
