/**
 * Testing tool: a project as one journey through the real pages (plans/26), from a host's first
 * post to the founder's switch, as a host and as a contributor would walk it.
 *
 * What is real and what is pretended:
 *   real       sign-up and the confirmation link; every page (fetched from the running app with
 *              that person's login) and every button: each form is taken as the page drew it, with
 *              the fields Next puts in it, and posted with that person's cookies; the upload of a
 *              picture; every contribution's payment (the app's own PaymentIntent, confirmed with
 *              one of Stripe's test cards, as a browser would, and then the app's own "check"
 *              address); the emails written.
 *   pretended  the welcome step's tick boxes; the host's approval (written straight to the
 *              database, as the other check scripts do); that two people had a call (written with
 *              a final record); the picture checker (a stand-in that says "clean"); the waiting
 *              (three days, a month: run with a later clock by the always-on helper's own
 *              function, each taking at the moment its own hold gives); and, in the short cases at
 *              the end, a pause, a hidden page, a membership and the closing of a report.
 *
 * Collecting moves real test money, so it needs a real test payout account: with --payouts the
 * journey's host borrows the one of host@test.local for that step. That step is not walked through
 * the pages: the paid call is made by the app's functions, and the collection is started by the
 * function behind "Collect earnings" with a later clock, since the button always collects at the
 * real moment. Without --payouts the step is skipped.
 *
 * It needs the app running (npm run dev) and the Stripe test key. Stop the always-on helper first:
 * the helper's function is run here with a later clock, and it acts on every contribution in the
 * database, so the script must have this computer's test database to itself. It sets the founder's
 * projects switch and puts it back at the end, and removes everything it made here (people whose
 * email starts "pjourney-", also those of an earlier run that was stopped; of such a run only its
 * lines "projects switch set" in the founder's record stay, since they name no person). What it
 * made at Stripe stays there as test history: customers, their saved test cards, charges and
 * transfers. A hold is let go before its line here is removed; if Stripe cannot be reached for
 * that, the clean-up stops, says so, and is tried again by the next run. The founder's page is
 * skipped with a note if the test admin's login is not set up (npx tsx scripts/secure-test-admin.ts).
 *
 * Usage: npx tsx scripts/project-journey-check.ts            (everything but collecting)
 *        npx tsx scripts/project-journey-check.ts --payouts  (also collecting)
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { and, desc, eq, gte, inArray, like, or, sql } from "drizzle-orm";
import type { Checker } from "../src/lib/projects/checks/types";
import { TERMS_VERSION } from "../src/lib/terms";
import { requireLocalDatabase } from "./local-only";
import { totpCode } from "./totp";

const BASE = "http://localhost:3000";
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
type Reply = { status: number; json: Record<string, unknown> | null; text: string; words: string; location: string; type: string };

const unescape = (text: string) => text.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
/** What a person reads on a page: the text, without the markup. */
const words = (html: string) => unescape(html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ");

/** One request to the app, the way a browser would send it: a page, a JSON message, or a form. Cookies are kept in the jar. Redirects are not followed. */
async function send(path: string, options: { json?: unknown; form?: FormData; jar?: Jar } = {}): Promise<Reply> {
  // (A browser says of every request of a page of ours that it comes from that page.)
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
  const type = response.headers.get("content-type") ?? "";
  // A picture is not read as text.
  const text = type.startsWith("image/") ? "" : await response.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = JSON.parse(text);
  } catch {
    // a page, not JSON
  }
  return { status: response.status, json, text, words: words(text), location: (response.headers.get("location") ?? "").replace(BASE, ""), type };
}

/**
 * A form as a page drew it: its buttons (with the name and value a browser sends for the one that
 * is pressed) and every field a browser would send (hidden ones, ticked boxes, chosen options),
 * in order. Boxes for longer text are not read: what is typed into them is given when pressing.
 */
type Form = { buttons: Array<{ words: string; name: string | null; value: string }>; fields: Array<[string, string]>; words: string; action: string | null };
const attribute = (tag: string, name: string): string | null => {
  const found = tag.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`));
  return found ? unescape(found[1]) : null;
};
function formsOf(html: string): Form[] {
  return [...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/g)].map(([, formAttributes, inner]) => {
    const fields: Array<[string, string]> = [];
    // In the order of the page, as a browser sends them.
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
      if (type === "file") continue;
      if ((type === "checkbox" || type === "radio") && !/\schecked(?:=|\s|\/|>)/.test(tag)) continue;
      fields.push([name, attribute(tag, "value") ?? (type === "checkbox" ? "on" : "")]);
    }
    const buttons = [...inner.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map((m) => ({ words: words(m[2]).trim(), name: attribute(m[1], "name"), value: attribute(m[1], "value") ?? "" }));
    return { buttons, fields, words: words(inner), action: attribute(formAttributes, "action") };
  });
}

async function main() {
  requireLocalDatabase();
  if (!process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_")) throw new Error("This script needs the Stripe test key (sk_test_...) in .env.local.");
  const { db, schema } = await import("../src/db");
  const { stripe } = await import("../src/lib/payments/stripe");
  const { setSwitches, switches } = await import("../src/lib/safety/switches");
  const { runContributionJobs } = await import("../src/lib/contributions/jobs");
  const { monthlyDue } = await import("../src/lib/contributions/rules");
  const { summarySentences, agreementBox } = await import("../src/lib/contributions/wording");
  const { NOT_TAKING } = await import("../src/lib/contributions/start");
  const { currentSplit } = await import("../src/lib/payments/actions");
  const { unsentEarnings } = await import("../src/lib/payments/collect");
  const { runPictureRound } = await import("../src/lib/projects/queue");
  const { runningProjectOf, PROJECTS_OFF } = await import("../src/lib/projects/projects");
  const { createReport } = await import("../src/lib/safety/reports");
  const pays = schema.contributionPayments;
  const withPayouts = process.argv.includes("--payouts");

  const up = await send("/login").catch(() => null);
  if (!up || up.status !== 200) throw new Error("The app is not running. Start it with `npm run dev` first.");

  type Person = { id: string; name: string; email: string; jar: Jar };
  type Host = Person & { handle: string; displayName: string };
  const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const page = (path: string, who?: Person) => send(path, { jar: who?.jar });
  const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
  const PM = async (id: string) => (await db.select().from(pays).where(eq(pays.id, id)))[0];
  const CO = async (id: string) => (await db.select().from(schema.contributions).where(eq(schema.contributions.id, id)))[0];
  const paymentsOf = (contributionId: string) => db.select().from(pays).where(eq(pays.contributionId, contributionId)).orderBy(pays.number);
  const contributionsOf = (who: Person) => db.select().from(schema.contributions).where(eq(schema.contributions.contributorId, who.id)).orderBy(desc(schema.contributions.createdAt));
  const shareOf = async (paymentId: string) => (await db.select().from(schema.payments).where(eq(schema.payments.contributionPaymentId, paymentId)))[0];
  const postsOf = (projectId: string) => db.select().from(schema.projectPosts).where(eq(schema.projectPosts.projectId, projectId)).orderBy(desc(schema.projectPosts.createdAt));

  /** How many emails to an address have these words in their subject. Emails are written in the same step as what they tell of; a little time is still given. */
  async function emailsTo(to: string, subject: string, tries = 15): Promise<number> {
    for (let i = 0; i < tries; i++) {
      const found = await db.select({ id: schema.emailOutbox.id }).from(schema.emailOutbox).where(and(eq(schema.emailOutbox.to, to), like(schema.emailOutbox.subject, `%${subject}%`)));
      if (found.length > 0) return found.length;
      await pause(200);
    }
    return 0;
  }

  /** Signs up the way the form does and opens the link in the confirmation email. The welcome step's tick boxes are pretended. */
  async function signUp(name: string): Promise<Person> {
    const person = { name: `Journey ${name} ${RUN}`, email: `pjourney-${RUN}-${name.toLowerCase()}@example.test`, password: randomBytes(12).toString("base64url"), jar: new Map() as Jar };
    await send("/api/auth/sign-up/email", { json: { name: person.name, email: person.email, password: person.password, callbackURL: "/welcome" }, jar: person.jar });
    if ((await emailsTo(person.email, "Confirm your email", 25)) === 0) throw new Error(`No confirmation email for ${person.email}`);
    const link = (await db.select().from(schema.emailOutbox).where(and(eq(schema.emailOutbox.to, person.email), like(schema.emailOutbox.subject, "%Confirm your email%"))))[0].body.match(/https?:\/\/\S+/)?.[0] ?? "";
    await send(link, { jar: person.jar });
    const [row] = await db.select().from(schema.user).where(eq(schema.user.email, person.email));
    const now = new Date();
    await db.update(schema.user).set({ adultConfirmedAt: now, termsAcceptedAt: now, termsVersion: TERMS_VERSION, timeZone: "America/New_York" }).where(eq(schema.user.id, row.id));
    return { id: row.id, name: person.name, email: person.email, jar: person.jar };
  }
  /** Pretended: a host whose page is approved and who can be paid. Everything about her project she does herself, through the pages. */
  async function newHost(name: string): Promise<Host> {
    const person = await signUp(name);
    const handle = `pj${RUN}${name.toLowerCase()}`;
    const displayName = `${name} Journey ${RUN}`;
    await db.insert(schema.hostProfiles).values({ userId: person.id, handle, handleKey: handle, displayName, pricePer15Cents: 1000, status: "approved", usConfirmedAt: new Date() });
    await db.insert(schema.hostSettings).values({ userId: person.id, payoutsReady: true }).onConflictDoNothing();
    await db.insert(schema.hostCalendars).values({ userId: person.id, timeZone: "America/New_York", lengths: "30", noticeHours: 24, horizonWeeks: 2, breakMinutes: 5 });
    return { ...person, handle, displayName };
  }

  /**
   * Presses a button on a page as that person: the page is fetched, the form with that button is
   * taken as it was drawn, and posted back to the page's own address. `change` sets or (with null)
   * leaves out fields, as typing, ticking, unticking or choosing would; a list fills several boxes
   * of one name in their order. `drawn` posts a form from a page that was fetched earlier.
   */
  async function press(who: Person, path: string, button: string, change: Record<string, string | string[] | null> = {}, opts: { where?: (form: Form) => boolean; drawn?: string } = {}): Promise<Reply & { found: boolean }> {
    const html = opts.drawn ?? (await page(path, who)).text;
    const form = formsOf(html).find((f) => f.buttons.some((b) => b.words === button) && (opts.where?.(f) ?? true));
    if (!form) return { status: 0, json: null, text: "", words: "", location: "", type: "", found: false };
    const data = new FormData();
    for (const [name, value] of form.fields) if (!(name in change)) data.append(name, value);
    for (const [name, value] of Object.entries(change)) for (const one of value === null ? [] : Array.isArray(value) ? value : [value]) data.append(name, one);
    // A button with a name of its own (one of two buttons in a form) sends it, as a browser does for the one that was pressed.
    const pressed = form.buttons.find((b) => b.words === button);
    if (pressed?.name) data.append(pressed.name, pressed.value);
    return { ...(await send(path, { form: data, jar: who.jar })), found: true };
  }
  /** The sentence the app shows after an action (it travels, signed, in the address the person is sent to). */
  const noticeOf = (reply: Reply) => decodeURIComponent(reply.location.match(/[?&]notice=([^&#]*)/)?.[1] ?? "");
  /** Where a form that only asks for a page (the "Contribute" forms of the diary) leads, with its fields in the address as a browser writes them. */
  function leadsTo(html: string, button: string, change: Record<string, string> = {}): string | null {
    const form = formsOf(html).find((f) => f.buttons.some((b) => b.words === button));
    if (!form?.action) return null;
    const query = new URLSearchParams();
    for (const [name, value] of form.fields) query.append(name, change[name] ?? value);
    return `${form.action}?${query}`;
  }
  const hasMark = (reply: Reply, mark: string) => reply.text.includes(mark);
  /** The visitor's own line beside a project, as a page drew it: "monthly", "card_step", "contribute", or null when the page is there and has none. */
  const ownLine = (reply: Reply) => (reply.status !== 200 ? `not a page (${reply.status})` : (reply.text.match(/data-own-line="([a-z_]+)"/)?.[1] ?? null));

  /**
   * Pretended: these two had a call two days ago, written with a final record: both were in the
   * room for 20 minutes, and the room is confirmed closed. With `what` it is a call that did not
   * take place like that: cancelled, ended with "End call and report", or over only a moment ago.
   */
  async function hadCall(host: Person, customer: Person, what: "ordinary" | "cancelled" | "ended_with_report" | "just_over" = "ordinary"): Promise<string> {
    const startsAt = new Date(Date.now() - (what === "just_over" ? 31 * MIN : 2 * DAY));
    const endsAt = new Date(startsAt.getTime() + 30 * MIN);
    const [call] = await db
      .insert(schema.calls)
      .values({
        hostId: host.id,
        customerId: customer.id,
        startsAt,
        endsAt,
        roomName: `pjourney-${randomUUID()}`,
        pricePer15Cents: 0,
        ...(what === "just_over" ? {} : { closedAt: new Date(endsAt.getTime() + MIN) }),
        ...(what === "cancelled" ? { cancelledAt: new Date(startsAt.getTime() - 60 * MIN), cancelledBy: "customer" } : {}),
        ...(what === "ended_with_report" ? { safetyEndedAt: new Date(startsAt.getTime() + 10 * MIN), safetyEndedBy: "customer" } : {}),
      })
      .returning();
    await db.insert(schema.bookings).values({ hostId: host.id, customerId: customer.id, startsAt, endsAt, lengthMinutes: 30, breakMinutes: 5, pricePer15Cents: 0, totalCents: 0, freeCancelMinutes: 0, stage: "accepted", requestKey: randomUUID(), callId: call.id });
    // (Every one of them has the same record of the two in the room, also the cancelled one: so only what the call is named for keeps the box away.)
    for (const who of [host.id, customer.id]) {
      const event = (type: string, minutes: number) => ({ provider: "livekit", providerEventId: `EV_${randomUUID()}`, callId: call.id, type, roomSessionId: "RM_pjourney", participantIdentity: who, participantSessionId: `PA_${who.slice(-6)}_${call.id.slice(0, 6)}`, providerTime: new Date(startsAt.getTime() + minutes * MIN), payload: "{}" });
      await db.insert(schema.attendanceEvents).values([event("participant_joined", 0), event("participant_left", 20)]);
    }
    return call.id;
  }
  const results = (callId: string, who: Person) => page(`/calls/${callId}/results`, who);
  const boxShown = (reply: Reply) => reply.status === 200 && hasMark(reply, "data-project-ask");
  /** The page is there, and the box is not on it. (A page that failed to open never counts as "no box".) */
  const noBox = (reply: Reply) => reply.status === 200 && !hasMark(reply, "data-project-ask");

  /** What the contributor's browser does at the card step: confirms the payment THE APP made, with one of Stripe's test cards, then asks the app's own address what became of it. */
  async function payInBrowser(who: Person, contributionId: string, paymentId: string, card = "pm_card_visa") {
    const intentId = (await PM(paymentId)).stripePaymentIntentId;
    if (!intentId) return { status: 0, json: null } as Pick<Reply, "status" | "json">;
    await stripe().paymentIntents.confirm(intentId, { payment_method: card, return_url: RETURN }).catch(() => undefined);
    return send(`/api/contributions/${contributionId}/sync`, { json: { payment: paymentId }, jar: who.jar });
  }
  /**
   * A person contributes through the pages: from the diary's "Contribute" part to the summary, and
   * from its button to the card step. Returns the contribution that was started, or null with the
   * sentence the app refused with.
   */
  async function contribute(who: Person, host: Host, kind: "once" | "monthly", dollars: string, tick = true): Promise<{ contributionId: string; paymentId: string; summary: Reply } | { contributionId: null; summary: Reply; notice: string }> {
    const diary = await page(`/h/${host.handle}/project`, who);
    const to = leadsTo(diary.text, kind === "monthly" ? "Contribute every month" : "Contribute once", { amount: dollars });
    const summary = to ? await page(to, who) : diary;
    const sent = await press(who, to ?? "", "Continue to the card step", kind === "monthly" && tick ? { agreed: "on" } : {}, { drawn: summary.text });
    const id = sent.location.match(/^\/contributions\/([0-9a-f-]{36})$/)?.[1];
    if (!id) return { contributionId: null, summary, notice: noticeOf(sent) };
    const [first] = await paymentsOf(id);
    return { contributionId: id, paymentId: first.id, summary };
  }
  /** The always-on helper's work on contributions, at a moment: twice, since one round writes a month down and the next tries its card. */
  async function helper(at: Date) {
    await runContributionJobs(at);
    await runContributionJobs(at);
  }

  // --------------------------------------------------------------------------
  // The test payout account, borrowed for the collecting step only
  // --------------------------------------------------------------------------
  const [seeded] = await db.select().from(schema.user).where(eq(schema.user.email, "host@test.local"));
  /** Whose payout account it is before the journey starts: read after the first clean-up, which gives back an account an earlier run still held. */
  let payoutAccountBefore: string | null = null;
  /** If an earlier run stopped while its host held the test payout account, the seeded host gets it back before anything is deleted. */
  async function payoutAccountBack() {
    const [holder] = await db
      .select({ userId: schema.hostSettings.userId, stripeAccountId: schema.hostSettings.stripeAccountId })
      .from(schema.hostSettings)
      .innerJoin(schema.user, eq(schema.user.id, schema.hostSettings.userId))
      .where(and(like(schema.user.email, "pjourney-%"), sql`${schema.hostSettings.stripeAccountId} is not null`));
    if (!holder || !seeded) return;
    await db.transaction(async (tx) => {
      await tx.update(schema.hostSettings).set({ stripeAccountId: null }).where(eq(schema.hostSettings.userId, holder.userId));
      await tx.update(schema.hostSettings).set({ stripeAccountId: holder.stripeAccountId, payoutsReady: true }).where(eq(schema.hostSettings.userId, seeded.id));
    });
    console.log("   (the test payout account was given back to host@test.local)");
  }

  /**
   * Lets a test payment go at Stripe before its line here is removed. One that cannot be let go
   * stops the clean-up: its lines stay, so that the next run can try again, and nothing is left
   * held at Stripe with nothing here that knows of it.
   */
  async function letGoAtStripe(intentId: string) {
    await stripe().paymentIntents.cancel(intentId).catch(async () => {
      const left = await stripe().paymentIntents.retrieve(intentId).catch(() => null);
      // Already cancelled, or already taken (a charge that is kept as test history), is fine.
      if (left?.status !== "canceled" && left?.status !== "succeeded") throw new Error(`The test payment ${intentId} could not be let go at Stripe (it is "${left?.status ?? "unknown"}"). Nothing was removed; the next run tries again.`);
    });
  }

  /** Removes everything this script ever made: the people whose email starts "pjourney-", and all that hangs on them. */
  async function wipe() {
    await payoutAccountBack();
    const ids = (await db.select({ id: schema.user.id }).from(schema.user).where(like(schema.user.email, "pjourney-%"))).map((row) => row.id);
    if (ids.length === 0) {
      // Emails are found by their address alone, so one that outlived its person is still removed.
      await db.delete(schema.emailOutbox).where(like(schema.emailOutbox.to, "pjourney-%"));
      return;
    }
    const contributionIds = (await db.select({ id: schema.contributions.id }).from(schema.contributions).where(or(inArray(schema.contributions.hostId, ids), inArray(schema.contributions.contributorId, ids)))).map((row) => row.id);
    const theirPayments = contributionIds.length > 0 ? await db.select().from(pays).where(inArray(pays.contributionId, contributionIds)) : [];
    // Nothing stays held on a test card.
    for (const payment of theirPayments) {
      if (!payment.stripePaymentIntentId || (payment.status !== "to_pay" && payment.status !== "held")) continue;
      const intentId = payment.stripePaymentIntentId;
      await letGoAtStripe(intentId);
    }
    const cpIds = theirPayments.map((payment) => payment.id);
    const calls = (await db.select({ id: schema.calls.id }).from(schema.calls).where(or(inArray(schema.calls.hostId, ids), inArray(schema.calls.customerId, ids)))).map((row) => row.id);
    const bookings = (await db.select({ id: schema.bookings.id }).from(schema.bookings).where(or(inArray(schema.bookings.hostId, ids), inArray(schema.bookings.customerId, ids)))).map((row) => row.id);
    const shares = [
      ...(cpIds.length > 0 ? await db.select({ id: schema.payments.id }).from(schema.payments).where(inArray(schema.payments.contributionPaymentId, cpIds)) : []),
      ...(calls.length > 0 ? await db.select({ id: schema.payments.id }).from(schema.payments).where(inArray(schema.payments.callId, calls)) : []),
    ].map((row) => row.id);
    // The same for a paid call's hold that a run left behind before the call was charged: also one Stripe has placed and we had not recorded yet.
    const callHolds = calls.length > 0 ? await db.select().from(schema.payments).where(and(inArray(schema.payments.callId, calls), inArray(schema.payments.status, ["awaiting_payment", "held"]))) : [];
    for (const held of callHolds) if (held.stripePaymentIntentId) await letGoAtStripe(held.stripePaymentIntentId);
    const projectIds = (await db.select({ id: schema.projects.id }).from(schema.projects).where(inArray(schema.projects.hostId, ids))).map((row) => row.id);
    const pictureIds = (await db.select({ id: schema.projectPictures.id }).from(schema.projectPictures).where(inArray(schema.projectPictures.hostId, ids))).map((row) => row.id);
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
      () => db.delete(schema.reports).where(or(inArray(schema.reports.reporterId, ids), inArray(schema.reports.reportedId, ids))),
      () => db.delete(schema.blocks).where(or(inArray(schema.blocks.blockerId, ids), inArray(schema.blocks.blockedId, ids))),
      () => db.delete(schema.adminActions).where(inArray(schema.adminActions.targetUserId, ids)),
      async () => bookings.length > 0 && (await db.delete(schema.busyEntries).where(inArray(schema.busyEntries.bookingId, bookings))),
      async () => bookings.length > 0 && (await db.delete(schema.bookings).where(inArray(schema.bookings.id, bookings))),
      async () => calls.length > 0 && (await db.delete(schema.attendanceEvents).where(inArray(schema.attendanceEvents.callId, calls))),
      async () => calls.length > 0 && (await db.delete(schema.calls).where(inArray(schema.calls.id, calls))),
      () => db.delete(schema.memberships).where(or(inArray(schema.memberships.hostId, ids), inArray(schema.memberships.customerId, ids))),
      async () => pictureIds.length > 0 && (await db.delete(schema.projectPictureFiles).where(inArray(schema.projectPictureFiles.pictureId, pictureIds))),
      () => db.delete(schema.projectPictures).where(inArray(schema.projectPictures.hostId, ids)),
      async () => projectIds.length > 0 && (await db.delete(schema.projectPosts).where(inArray(schema.projectPosts.projectId, projectIds))),
      () => db.delete(schema.projects).where(inArray(schema.projects.hostId, ids)),
      () => db.delete(schema.hostCalendars).where(inArray(schema.hostCalendars.userId, ids)),
      () => db.delete(schema.hostSettings).where(inArray(schema.hostSettings.userId, ids)),
      () => db.delete(schema.hostProfiles).where(inArray(schema.hostProfiles.userId, ids)),
      () => db.delete(schema.stripeCustomers).where(inArray(schema.stripeCustomers.userId, ids)),
      () => db.delete(schema.emailOutbox).where(like(schema.emailOutbox.to, "pjourney-%")),
      () => db.delete(schema.session).where(inArray(schema.session.userId, ids)),
      () => db.delete(schema.account).where(inArray(schema.account.userId, ids)),
      () => db.delete(schema.user).where(inArray(schema.user.id, ids)),
    ];
    // A step that fails is a failed check: what it should have removed may still be there.
    for (const step of steps) await step().catch((error) => check("clean-up: each step could remove what it is for", false, error instanceof Error ? error.message.split("\n")[0] : String(error)));
  }

  const startedAt = new Date();
  const atStart = await switches();
  console.log(`(The founder's projects switch is "${atStart.projects}"${atStart.projectsHosts.length > 0 ? ` with ${atStart.projectsHosts.length} named` : ""}; it is put back at the end.)`);
  // The stand-in picture checker answers in the name of the first service. What the app remembers about that service is put back at the end.
  const [checkerBefore] = await db.select().from(schema.pictureCheckers).where(eq(schema.pictureCheckers.service, "openai"));
  const standIn: Checker = { name: "openai", keyMark: "the-journey-stand-in", check: async () => ({ kind: "clean", detail: "the journey's stand-in said clean" }) };

  try {
    await wipe();
    payoutAccountBefore = seeded ? ((await db.select().from(schema.hostSettings).where(eq(schema.hostSettings.userId, seeded.id)))[0]?.stripeAccountId ?? null) : null;
    await setSwitches({ projects: "everyone", projectsHosts: [] });
    // Attempt limits are per network address, and every request here comes from the same one.
    await db.delete(schema.rateLimit);

    // ----------------------------------------------------------------------
    console.log("\n1. A host starts a project, writes two posts, one with a picture, and says which amounts she suggests");
    const host = await newHost("Hana");
    const NAME = `A film about the sea ${RUN}`;
    const ABOUT = "A short film about the people who work on the sea at night. It is filmed over one winter.";
    const started = await press(host, "/host/project", "Start the project", { name: NAME, description: ABOUT });
    const project = (await runningProjectOf(host.id))!;
    check("\"Start the project\" starts it", started.found && noticeOf(started).startsWith("Your project has started") && project?.name === NAME, noticeOf(started));
    const first = await press(host, "/host/project", "Add to the diary", { text: "Day one. We met the crew of the night boat." });
    const second = await press(host, "/host/project", "Add to the diary", { text: "Day two. The first pictures are here." });
    const [post2, post1] = await postsOf(project.id);
    check("she writes two posts into the diary", first.found && second.found && noticeOf(second) === "Your post is in the diary." && Boolean(post1 && post2), `${noticeOf(first)} / ${noticeOf(second)}`);

    const sharp = (await import("sharp")).default;
    const upload = new FormData();
    upload.append("picture", new Blob([new Uint8Array(await sharp({ create: { width: 320, height: 200, channels: 3, background: { r: 20, g: 60, b: 120 } } }).png().toBuffer())], { type: "image/png" }), "sea.png");
    const uploaded = await send(`/host/project/posts/${post2.id}/pictures`, { form: upload, jar: host.jar });
    const [picture] = await db.select().from(schema.projectPictures).where(eq(schema.projectPictures.postId, post2.id));
    check("she adds a picture to the second post: it is kept, waiting for its check", uploaded.status === 303 && noticeOf(uploaded).startsWith("Your picture was added") && picture?.state === "waiting", `${uploaded.status} ${noticeOf(uploaded)}`);
    check("until it is checked, nobody else can fetch it", picture ? (await page(`/pictures/${picture.id}`)).status === 404 : false);
    await runPictureRound({ services: [standIn], own: null, tool: null, onlyHosts: [host.id] });
    const shownPicture = picture ? (await db.select().from(schema.projectPictures).where(eq(schema.projectPictures.id, picture.id)))[0] : null;
    check("the stand-in checker passes it, and it is shown", shownPicture?.state === "shown", shownPicture?.state);
    const diaryOut = await page(`/h/${host.handle}/project`);
    const fetched = picture ? await page(`/pictures/${picture.id}`) : null;
    check("a visitor who is not signed in reads the diary with both posts, and can fetch the picture", diaryOut.status === 200 && diaryOut.words.includes("Day one.") && diaryOut.words.includes("Day two.") && Boolean(picture && diaryOut.text.includes(`/pictures/${picture.id}`)) && fetched?.status === 200 && fetched.type.startsWith("image/"), `${diaryOut.status} ${fetched?.status} ${fetched?.type}`);
    check("with no amounts suggested yet, the diary has no \"Contribute\" part", diaryOut.status === 200 && !hasMark(diaryOut, "data-contribute"));

    // ----------------------------------------------------------------------
    console.log("\n2. A customer who had a call with her sees the box on the call's results");
    const cara = await signUp("Cara");
    const goodCall = await hadCall(host, cara);
    check("while her project takes no contributions, there is no box after a call", noBox(await results(goodCall, cara)));
    const amounts = await press(host, "/host/project", "Save the amounts", { once: ["10", "25", "50"], monthly: ["5", "10", ""] });
    check("she suggests three amounts for once and two for every month", amounts.found && (await runningProjectOf(host.id))?.suggestedOnce === "1000,2500,5000" && (await runningProjectOf(host.id))?.suggestedMonthly === "500,1000", `${noticeOf(amounts)} ${(await runningProjectOf(host.id))?.suggestedOnce}`);

    const asked = await results(goodCall, cara);
    check(
      "the customer's results of the call now show the box: her name, the project, the first lines of what it is about, and \"See the project\"",
      boxShown(asked) && asked.words.includes(`${host.displayName} is working on ${NAME}`) && asked.words.includes(ABOUT) && asked.words.includes("See the project") && asked.text.includes(`href="/h/${host.handle}/project"`),
      asked.words.slice(0, 300),
    );
    check("the box has no amount and no button that pays", !/\$\d/.test(asked.text.match(/<section[^>]*data-project-ask[\s\S]*?<\/section>/)?.[0] ?? "$1") && !/<form|<button/.test(asked.text.match(/<section[^>]*data-project-ask[\s\S]*?<\/section>/)?.[0] ?? "<form"));
    check("the host, looking at the same call, sees no box", noBox(await results(goodCall, host)));
    const cancelledCall = await hadCall(host, cara, "cancelled");
    const reportedCall = await hadCall(host, cara, "ended_with_report");
    const freshCall = await hadCall(host, cara, "just_over");
    const refundCall = await hadCall(host, cara);
    await db.insert(schema.refundRequests).values({ callId: refundCall, customerId: cara.id, reason: "other", note: "", askedAt: new Date(), status: "declined" });
    check("there is no box for a call that was cancelled", noBox(await results(cancelledCall, cara)));
    check("none for a call ended with \"End call and report\"", noBox(await results(reportedCall, cara)));
    check("none for a call she asked a refund of, also when the request was declined", noBox(await results(refundCall, cara)));
    check("none while a call's record is not final yet", noBox(await results(freshCall, cara)));
    check("and the box is still there on the call that took place", boxShown(await results(goodCall, cara)));
    check("opening those pages started no contribution", (await contributionsOf(cara)).length === 0);

    // ----------------------------------------------------------------------
    console.log("\n3. She contributes once");
    const hostPage = await page(`/h/${host.handle}`, cara);
    check("on the host's page the project's box says \"Contribute\" to her, and leads to the diary's \"Contribute\" part", ownLine(hostPage) === "contribute" && hostPage.text.includes(`href="/h/${host.handle}/project#contribute"`) && (await page(`/h/${host.handle}/project`, cara)).text.includes('id="contribute"'));
    check("a visitor who is not signed in, and the host herself, get no such line", ownLine(await page(`/h/${host.handle}`)) === null && ownLine(await page(`/h/${host.handle}`, host)) === null);
    const once = await contribute(cara, host, "once", "25.00");
    const onceSentences = summarySentences({ kind: "once", amountCents: 2500, hostName: host.displayName, projectName: NAME });
    check("the page before paying says the amount and every sentence the rulebook asks for", once.summary.words.includes("$25.00, once") && onceSentences.every((sentence) => once.summary.words.includes(sentence)), onceSentences.find((sentence) => !once.summary.words.includes(sentence)));
    if (once.contributionId === null) throw new Error(`The contribution did not start: ${once.notice}`);
    const cardStep = await page(`/contributions/${once.contributionId}`, cara);
    check("\"Continue to the card step\" leads to the card step, which hands the payment's secret to her form", cardStep.status === 200 && cardStep.words.includes("The card step") && cardStep.text.includes("_secret_"), String(cardStep.status));
    check("at the card step the host's page and the diary say \"Finish contributing\", with a link to it", ownLine(await page(`/h/${host.handle}`, cara)) === "card_step" && ownLine(await page(`/h/${host.handle}/project`, cara)) === "card_step" && (await page(`/h/${host.handle}`, cara)).text.includes(`href="/contributions/${once.contributionId}"`) && (await page(`/h/${host.handle}/project`, cara)).text.includes(`href="/contributions/${once.contributionId}"`));
    check("and the box after the call is still there: nothing has been held yet", boxShown(await results(goodCall, cara)));
    // Pretended: the card step's 30 minutes ran out a moment ago, and the helper has not been by yet.
    const stepEnds = (await PM(once.paymentId)).cardStepExpiresAt;
    await db.update(pays).set({ cardStepExpiresAt: new Date(Date.now() - MIN) }).where(eq(pays.id, once.paymentId));
    check("a card step whose time is over is not offered to be finished: both pages say \"Contribute\" instead", ownLine(await page(`/h/${host.handle}`, cara)) === "contribute" && ownLine(await page(`/h/${host.handle}/project`, cara)) === null && hasMark(await page(`/h/${host.handle}/project`, cara), "data-contribute"));
    await db.update(pays).set({ cardStepExpiresAt: stepEnds }).where(eq(pays.id, once.paymentId));
    const paid = await payInBrowser(cara, once.contributionId, once.paymentId);
    check("with a test card entered, the app finds the hold at Stripe itself: $25.00 is held", paid.status === 200 && paid.json?.status === "held" && (await PM(once.paymentId)).status === "held", JSON.stringify(paid.json));
    check("the email about the hold is written, and the host is told of her new contributor", (await emailsTo(cara.email, `Your contribution to ${host.displayName}'s project: $25.00`)) === 1 && (await emailsTo(host.email, `${cara.name} contributes to`)) === 1);
    const account = await page("/account", cara);
    check("\"Your account\" lists it under \"Projects you support\", as held", account.words.includes("Projects you support") && account.text.includes(`/contributions/${once.contributionId}`) && account.words.includes("Held on your card"));
    check("the box is gone from the call's results: she contributes", noBox(await results(goodCall, cara)));

    // ----------------------------------------------------------------------
    console.log("\n4. She cancels while it is held");
    const cancelled = await press(cara, `/contributions/${once.contributionId}`, "Cancel, nothing is charged");
    await helper(new Date());
    const afterCancel = await page(`/contributions/${once.contributionId}`, cara);
    const onceIntent = await stripe().paymentIntents.retrieve((await PM(once.paymentId)).stripePaymentIntentId!);
    check("\"Cancel, nothing is charged\" lets the hold go at Stripe, and her page then says that nothing was charged", cancelled.found && onceIntent.status === "canceled" && afterCancel.words.includes("Cancelled. The hold was let go, and nothing was charged."), `${noticeOf(cancelled)} / ${onceIntent.status}`);
    check("she is sent \"nothing was charged\"", (await emailsTo(cara.email, "Nothing was charged: your $25.00")) === 1);
    check("the box stays gone, since she has contributed before; the host's page offers \"Contribute\" again", noBox(await results(goodCall, cara)) && ownLine(await page(`/h/${host.handle}`, cara)) === "contribute");

    // ----------------------------------------------------------------------
    console.log("\n5. She contributes every month, and three days later the money is taken");
    const noTick = await contribute(cara, host, "monthly", "10.00", false);
    check("without the tick in the box a monthly contribution is refused, and says why", noTick.contributionId === null && /tick the box/.test(noTick.notice) && noTick.summary.words.includes(agreementBox(1000)), noTick.contributionId === null ? noTick.notice : "it started");
    const monthly = await contribute(cara, host, "monthly", "10.00");
    if (monthly.contributionId === null) throw new Error(`The monthly contribution did not start: ${monthly.notice}`);
    check("with the box ticked it starts; the page before paying said every sentence for a monthly contribution", summarySentences({ kind: "monthly", amountCents: 1000, hostName: host.displayName, projectName: NAME }).every((sentence) => monthly.summary.words.includes(sentence)));
    const month1 = monthly.paymentId;
    const diaryAtStep = await page(`/h/${host.handle}/project`, cara);
    check("while its card step is open the diary says \"Finish contributing\", and offers no second monthly contribution", ownLine(diaryAtStep) === "card_step" && diaryAtStep.text.includes('data-kind="once"') && !diaryAtStep.text.includes('data-kind="monthly"'));
    // Pretended: that card step's 30 minutes ran out a moment ago, and the helper has not been by yet.
    const monthlyStepEnds = (await PM(month1)).cardStepExpiresAt;
    await db.update(pays).set({ cardStepExpiresAt: new Date(Date.now() - MIN) }).where(eq(pays.id, month1));
    const diaryStepOver = await page(`/h/${host.handle}/project`, cara);
    check("and when its time is over but it has not been ended yet: no line, and still no monthly form that would only be refused", ownLine(diaryStepOver) === null && diaryStepOver.text.includes('data-kind="once"') && !diaryStepOver.text.includes('data-kind="monthly"'));
    await db.update(pays).set({ cardStepExpiresAt: monthlyStepEnds }).where(eq(pays.id, month1));
    const paidMonthly = await payInBrowser(cara, monthly.contributionId, month1);
    check("the first month is held on her card", paidMonthly.json?.status === "held" && (await CO(monthly.contributionId)).status === "running" && (await CO(monthly.contributionId)).firstHoldAt !== null, JSON.stringify(paidMonthly.json));
    const hostPageMonthly = await page(`/h/${host.handle}`, cara);
    const diaryMonthly = await page(`/h/${host.handle}/project`, cara);
    check("the host's page now says \"You contribute $10.00 a month\", with a link to her contribution", ownLine(hostPageMonthly) === "monthly" && hostPageMonthly.words.includes("You contribute $10.00 a month") && hostPageMonthly.text.includes(`href="/contributions/${monthly.contributionId}"`));
    check("the diary says the same, and offers her \"Contribute once\" but no second monthly contribution", ownLine(diaryMonthly) === "monthly" && diaryMonthly.words.includes("You contribute $10.00 a month") && diaryMonthly.text.includes('data-kind="once"') && !diaryMonthly.text.includes('data-kind="monthly"'));
    await helper((await PM(month1)).takeAt!);
    const taken1 = await PM(month1);
    const share1 = await shareOf(month1);
    check("three days later the helper takes the money, and writes the host's share", taken1.status === "taken" && taken1.takenCents === 1000 && Boolean(share1), taken1.status);
    const hostProject = await page("/host/project", host);
    check("the host sees her contributor, the payment and her share on her project's page", hostProject.words.includes(cara.name) && hostProject.words.includes("$10.00 every month") && hostProject.words.includes("$10.00 was taken") && hostProject.words.includes(`Your share: ${money(currentSplit(share1).hostShareCents)}`) && hostProject.words.includes("Nothing is ready to collect right now"), hostProject.words.match(/Contributors have paid[^.]*\.[^.]*\./)?.[0]);
    // (Read from the function the "Your earnings" part is drawn from: that part is only drawn for a host with a payout account, which this host borrows in step 6 only.)
    const earning1 = (await unsentEarnings(new Date(), host.id)).find((earning) => earning.payment.contributionPaymentId === month1);
    check("and in her earnings, as not ready yet", earning1?.shareCents === currentSplit(share1).hostShareCents && earning1.heldBack !== null && earning1.project === NAME, { share: earning1?.shareCents, why: earning1?.heldBack, project: earning1?.project });

    // ----------------------------------------------------------------------
    console.log("\n6. Seven days later she collects it, together with a call's share");
    if (!withPayouts) {
      console.log("   SKIPPED: collecting moves real test money and needs a real test payout account. Run with --payouts.");
    } else {
      const { refreshPayoutsReady, getHostSettings } = await import("../src/lib/payments/hosts");
      const { collectEarnings } = await import("../src/lib/payments/collect");
      const { createPaymentForCall, startHold, syncHold } = await import("../src/lib/payments/hold");
      const { settleFinishedCalls } = await import("../src/lib/payments/jobs");
      const settings = seeded ? await getHostSettings(seeded.id) : null;
      const ready = seeded && settings?.stripeAccountId ? await refreshPayoutsReady(seeded.id) : false;
      check("the test host's payout account is ready", Boolean(ready));
      if (!seeded || !settings?.stripeAccountId || !ready) {
        console.log("   Set up payouts for host@test.local on the Hosting page first.");
      } else {
        const payoutAccount = settings.stripeAccountId;
        // (Made by the app's functions, not through the pages: a paid call of ten minutes with another customer, held on a test card and charged at its moment.)
        const dan = await signUp("Dan");
        const startsAt = new Date(Math.ceil((Date.now() + 10 * MIN) / 1000) * 1000);
        const paidCall = await db.transaction(async (tx) => {
          const [call] = await tx.insert(schema.calls).values({ hostId: host.id, customerId: dan.id, startsAt, endsAt: new Date(startsAt.getTime() + 10 * MIN), roomName: `pjourney-${randomUUID()}`, pricePer15Cents: 2000 }).returning();
          await createPaymentForCall(tx, call);
          const [payment] = await tx.select().from(schema.payments).where(eq(schema.payments.callId, call.id));
          return { call, payment };
        });
        await startHold({ payment: paidCall.payment, call: paidCall.call, customer: dan, now: new Date() });
        const [withIntent] = await db.select().from(schema.payments).where(eq(schema.payments.id, paidCall.payment.id));
        await stripe().paymentIntents.confirm(withIntent.stripePaymentIntentId!, { payment_method: "pm_card_visa", return_url: RETURN });
        await syncHold(paidCall.payment.id, new Date());
        for (const who of [host.id, dan.id]) {
          const event = (type: string, seconds: number) => ({ provider: "livekit", providerEventId: `EV_${randomUUID()}`, callId: paidCall.call.id, type, roomSessionId: "RM_pjourney", participantIdentity: who, participantSessionId: `PA_${who.slice(-6)}_paid`, providerTime: new Date(startsAt.getTime() + seconds * 1000), payload: "{}" });
          await db.insert(schema.attendanceEvents).values([event("participant_joined", 0), event("participant_left", 600)]);
        }
        await db.update(schema.calls).set({ closedAt: new Date(startsAt.getTime() + 11 * MIN) }).where(eq(schema.calls.id, paidCall.call.id));
        await settleFinishedCalls(new Date(startsAt.getTime() + (24 * 60 + 3) * MIN));
        const callShare = async () => (await db.select().from(schema.payments).where(eq(schema.payments.id, paidCall.payment.id)))[0];
        check("(a 10-minute call at $20.00 per 15 minutes was charged: $13.33, the host's share $12.38)", (await callShare()).chargedCents === 1333 && (await callShare()).originalHostShareCents === 1238, `${(await callShare()).status} ${(await callShare()).chargedCents}`);
        // One payout account belongs to one host at a time, so the journey's host takes over the test account for this step.
        const give = (from: string, to: string) =>
          db.transaction(async (tx) => {
            await tx.update(schema.hostSettings).set({ stripeAccountId: null }).where(eq(schema.hostSettings.userId, from));
            await tx.update(schema.hostSettings).set({ stripeAccountId: payoutAccount, payoutsReady: true }).where(eq(schema.hostSettings.userId, to));
          });
        await give(seeded.id, host.id);
        try {
          const pressAt = (now: Date) => collectEarnings({ collectionId: randomUUID(), hostId: host.id, startedBy: host.id, now }).then(() => null, (error: unknown) => error as Error);
          const dueOf = async () => Math.max((await shareOf(month1)).transferDueAt!.getTime(), (await callShare()).transferDueAt!.getTime(), taken1.takenAt!.getTime() + 7 * DAY);
          const before = (await unsentEarnings(new Date(taken1.takenAt!.getTime() + 7 * DAY - MIN), host.id)).find((earning) => earning.payment.contributionPaymentId === month1);
          check("a minute before the contribution's 7 days its share is not ready to collect, for that reason alone", before?.heldBack === "not_yet", before?.heldBack);
          const both = await pressAt(new Date((await dueOf()) + MIN));
          const [fromContribution, fromCall] = [await shareOf(month1), await callShare()];
          const collections = await db.select().from(schema.collections).where(eq(schema.collections.hostId, host.id));
          // $12.38 from the call and her share of the contribution, less one 25-cent collection charge.
          // (Collected by the function behind "Collect earnings", with the later clock: the button itself always collects at the real moment.)
          check("seven days after the taking one collection sends her share of the contribution and the call's share together, with one collection charge", both === null && fromContribution.transferStatus === "sent" && fromCall.transferStatus === "sent" && collections.length === 1 && (fromContribution.transferCents ?? 0) + (fromCall.transferCents ?? 0) === currentSplit(share1).hostShareCents + 1238 - 25 && (fromContribution.payoutFeeCents ?? 0) + (fromCall.payoutFeeCents ?? 0) === 25, `${both?.message} ${fromContribution.transferStatus} ${fromCall.transferStatus} in ${collections.length} collection(s)`);
          const transfer = fromContribution.stripeTransferId ? await stripe().transfers.retrieve(fromContribution.stripeTransferId) : null;
          check("at Stripe the contribution's transfer comes from the contribution's own charge", transfer?.destination === payoutAccount && transfer.source_transaction === (await PM(month1)).stripeChargeId);
          check("her project's page now says the share was sent to her, and her Hosting page shows the collection", (await page("/host/project", host)).words.includes(", sent to you") && (await page("/host", host)).words.includes("Your last collection"));
        } finally {
          await give(host.id, seeded.id);
        }
      }
    }

    // ----------------------------------------------------------------------
    console.log("\n7. A month later the next payment is held and taken without anyone pressing anything");
    const firstHold = (await CO(monthly.contributionId)).firstHoldAt!;
    await helper(new Date(monthlyDue(firstHold, 2).getTime() - MIN));
    check("a minute before the month's day nothing is written", (await paymentsOf(monthly.contributionId)).length === 1);
    await helper(monthlyDue(firstHold, 2));
    const [, month2] = await paymentsOf(monthly.contributionId);
    check("on its day the helper writes month 2 down and holds $10.00 on the card she saved", month2?.number === 2 && month2.status === "held" && month2.amountCents === 1000, `${month2?.number}:${month2?.status}`);
    check("she is sent the email about that month's hold", (await emailsTo(cara.email, `Your contribution to ${host.displayName}'s project: $10.00`)) === 2);
    await helper((await PM(month2.id)).takeAt!);
    check("and three days after that hold its money is taken", (await PM(month2.id)).status === "taken" && Boolean(await shareOf(month2.id)), (await PM(month2.id)).status);
    const twoMonths = await page(`/contributions/${monthly.contributionId}`, cara);
    check("her contribution's page shows both months as taken", (twoMonths.text.match(/data-payment="taken"/g) ?? []).length === 2 && twoMonths.words.includes("$10.00, month 2"));

    // ----------------------------------------------------------------------
    console.log("\n8. The host refunds part of the second month before collecting it");
    const refunded = await press(host, "/host/project", "Refund", { amount: "3.00" }, { where: (form) => form.fields.some(([name, value]) => name === "payment" && value === month2.id) });
    await helper(new Date());
    const afterRefund = await PM(month2.id);
    check("\"Refund\" with $3.00 pays $3.00 back to the contributor's card", refunded.found && afterRefund.refundedCents === 300, `${noticeOf(refunded)} ${afterRefund.refundedCents}`);
    check("the host's page and the contributor's page both say so, and she is sent an email", (await page("/host/project", host)).words.includes("$3.00 was paid back") && (await page(`/contributions/${monthly.contributionId}`, cara)).words.includes("$3.00 of it was paid back to your card") && (await emailsTo(cara.email, "$3.00 of your contribution")) === 1);
    const share2 = await shareOf(month2.id);
    // Her share of $10.00 was $9.21. With $7.00 of the $10.00 kept, it is seven tenths of that: $6.45.
    check("her share of that month is smaller in the same proportion ($6.45 of $9.21), and not sent", share2.transferStatus !== "sent" && share2.originalHostShareCents === 921 && currentSplit(share2).hostShareCents === 645, `${share2.originalHostShareCents} ${currentSplit(share2).hostShareCents}`);

    // ----------------------------------------------------------------------
    console.log("\n9. The customer stops");
    const noSure = await press(cara, `/contributions/${monthly.contributionId}`, "Stop contributing");
    check("\"Stop contributing\" without the tick changes nothing", noSure.found && /Tick the box/.test(noticeOf(noSure)) && (await CO(monthly.contributionId)).status === "running", noticeOf(noSure));
    const stopped = await press(cara, `/contributions/${monthly.contributionId}`, "Stop contributing", { sure: "on" });
    check("with the tick it stops at once", stopped.found && (await CO(monthly.contributionId)).status === "ended" && (await page(`/contributions/${monthly.contributionId}`, cara)).words.includes("This monthly contribution has ended."), noticeOf(stopped));
    check("she and the host are told by email", (await emailsTo(cara.email, "has ended")) >= 1 && (await emailsTo(host.email, "A monthly contribution to")) === 1);
    await helper(monthlyDue(firstHold, 3));
    check("a month later nothing more is written or held", (await paymentsOf(monthly.contributionId)).length === 2);
    check("the host's page offers her \"Contribute\" again, and the box after the call stays gone", ownLine(await page(`/h/${host.handle}`, cara)) === "contribute" && noBox(await results(goodCall, cara)));

    // ----------------------------------------------------------------------
    console.log("\n10. A second customer contributes, and the host ends the project while that payment is held");
    const eve = await signUp("Eve");
    const eves = await contribute(eve, host, "once", "10.00");
    if (eves.contributionId === null) throw new Error(`Eve's contribution did not start: ${eves.notice}`);
    await payInBrowser(eve, eves.contributionId, eves.paymentId);
    check("(her $10.00 is held)", (await PM(eves.paymentId)).status === "held");
    const noBoxTicked = await press(host, "/host/project", "End this project");
    check("\"End this project\" without the tick changes nothing", noBoxTicked.found && (await runningProjectOf(host.id)) !== null, noticeOf(noBoxTicked));
    const ended = await press(host, "/host/project", "End this project", { sure: "on" });
    await helper(new Date());
    const evesIntent = await stripe().paymentIntents.retrieve((await PM(eves.paymentId)).stripePaymentIntentId!);
    check("with the tick the project ends, and the held payment is let go at Stripe", ended.found && noticeOf(ended).startsWith("Your project has ended") && (await runningProjectOf(host.id)) === null && evesIntent.status === "canceled" && (await PM(eves.paymentId)).status === "given_up", `${noticeOf(ended)} / ${evesIntent.status}`);
    check("the contributor whose hold was let go is told that nothing was charged; the one whose money was taken, that the project has ended", (await emailsTo(eve.email, "Nothing was charged: your $10.00")) === 1 && (await emailsTo(cara.email, `project "${NAME}" has ended`)) === 1);
    const endedDiary = await page(`/h/${host.handle}/project`, eve);
    check("the diary stays readable, says \"This project has ended\", and takes no contributions", endedDiary.status === 200 && endedDiary.words.includes("This project has ended.") && endedDiary.words.includes("Day two.") && !hasMark(endedDiary, "data-contribute"));
    const endedHostPage = await page(`/h/${host.handle}`, eve);
    check("the host's page no longer shows the project's box, and a call's results no box", endedHostPage.status === 200 && !hasMark(endedHostPage, "data-project-box") && noBox(await results(await hadCall(host, eve), eve)));

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
    check("the founder's page is \"not found\" for a host and for a contributor", (await page("/admin/projects", host)).status === 404 && (await page("/admin/projects", cara)).status === 404);
    const founder = await page("/admin/projects", admin);
    const founderIn = founder.status === 200;
    if (!founderIn && adminSecret && adminPassword) {
      check("the founder's page opens for the test admin's login", false, `it answered ${founder.status}`);
    } else if (!founderIn) {
      console.log("   SKIPPED the founder's own view: the test admin's login is not set up (npx tsx scripts/secure-test-admin.ts).");
    } else {
      // $10.00 and $10.00 were taken and $3.00 paid back: $17.00 received.
      check("the founder sees the project and what it received after refunds", founder.words.includes(NAME) && founder.words.includes("$17.00 received in contributions (after refunds)"), founder.words.match(new RegExp(`${NAME}.{0,200}`))?.[0]);
      const itsPayments = await page(`/admin/projects?payments=${project.id}`, admin);
      check("and every payment of it: both months, the one she cancelled, and the one the project's end let go", itsPayments.words.includes(`from ${cara.name} to ${host.name}`) && itsPayments.words.includes("month 2 of a monthly contribution") && itsPayments.words.includes(`from ${eve.name} to ${host.name}`) && itsPayments.words.includes("$3.00 was paid back") && (itsPayments.text.match(/data-payment="cancelled"/g) ?? []).length === 2, itsPayments.words.slice(0, 300));
      const hidden = await press(admin, `/admin/projects?post=${post1.id}`, "Hide this post", { note: "A check by the journey script." });
      const diaryAfterHiding = await page(`/h/${host.handle}/project`);
      check("the founder hides a post: it leaves the diary, where the other post stays, and its host is told why", hidden.found && noticeOf(hidden).startsWith("The post is hidden") && diaryAfterHiding.status === 200 && diaryAfterHiding.words.includes("Day two.") && !diaryAfterHiding.words.includes("Day one.") && (await page(`/host/project?project=${project.id}`, host)).words.includes('Hidden by Connect: nobody else can see this post. "A check by the journey script."'), noticeOf(hidden));
      const heldBack = await press(admin, `/admin/projects?payments=${project.id}`, "Hold back", { note: "A check by the journey script." }, { where: (form) => form.fields.some(([name, value]) => name === "payment" && value === month2.id) });
      check("the founder holds a share back, with a reason: the host's earnings say so", heldBack.found && noticeOf(heldBack).startsWith("The share is held back") && (await PM(month2.id)).founderHold === "held" && (await unsentEarnings(new Date(), host.id)).find((earning) => earning.payment.contributionPaymentId === month2.id)?.heldBack === "founder", noticeOf(heldBack));
    }

    // ----------------------------------------------------------------------
    console.log("\n12. The founder's switch is turned off while a second host's project is running");
    await db.delete(schema.rateLimit);
    const hoa = await newHost("Hoa");
    const NAME2 = `A garden on the roof ${RUN}`;
    await press(hoa, "/host/project", "Start the project", { name: NAME2, description: "Vegetables for the whole house, grown on the roof." });
    await press(hoa, "/host/project", "Add to the diary", { text: "The first beds are built." });
    await press(hoa, "/host/project", "Save the amounts", { once: ["10", "", ""], monthly: ["", "", ""] });
    const project2 = (await runningProjectOf(hoa.id))!;
    const [hoaPost] = await postsOf(project2.id);
    const finn = await signUp("Finn");
    const finnCall = await hadCall(hoa, finn);
    check("(her project runs: the customer who had a call with her sees the box and the \"Contribute\" line)", boxShown(await results(finnCall, finn)) && ownLine(await page(`/h/${hoa.handle}`, finn)) === "contribute");
    // Two forms left open in a tab from before the switch: the customer's summary page and the host's post form.
    const finnDiary = await page(`/h/${hoa.handle}/project`, finn);
    const finnTo = leadsTo(finnDiary.text, "Contribute once", { amount: "10.00" }) ?? "";
    const finnSummary = await page(finnTo, finn);
    const hoaDrawn = await page("/host/project", hoa);
    if (founderIn) {
      const off = await press(admin, "/admin/projects", "Save projects switch", { projects: "off" });
      check("the founder switches projects off on the founder's page", off.found && noticeOf(off) === "Projects are off." && (await switches()).projects === "off", noticeOf(off));
    } else {
      await setSwitches({ projects: "off", projectsHosts: [] });
    }
    const finnPressed = await press(finn, finnTo, "Continue to the card step", {}, { drawn: finnSummary.text });
    check("nobody can contribute to it: a form that was open before is refused, and nothing is started", finnPressed.found && noticeOf(finnPressed) === NOT_TAKING && (await contributionsOf(finn)).length === 0, noticeOf(finnPressed));
    const finnSummaryOff = await page(finnTo, finn);
    check("the page before paying says so too, and offers nothing to press", finnSummaryOff.status === 200 && finnSummaryOff.words.includes(NOT_TAKING) && !formsOf(finnSummaryOff.text).some((f) => f.buttons.some((b) => b.words === "Continue to the card step")));
    const hoaPressed = await press(hoa, "/host/project", "Add to the diary", { text: "This must not be saved." }, { drawn: hoaDrawn.text });
    check("she cannot write: a post from a form that was open before is not saved, and she is told why", hoaPressed.found && hoaPressed.words.includes(PROJECTS_OFF) && (await postsOf(project2.id)).length === 1, `${hoaPressed.status} ${noticeOf(hoaPressed)}`);
    check("her own page says that projects are not open", (await page("/host/project", hoa)).words.includes("Projects are not open at the moment."));
    const offDiary = await page(`/h/${hoa.handle}/project`, finn);
    check("the box after a call and the \"Contribute\" line are gone, and so is the diary's \"Contribute\" part", noBox(await results(finnCall, finn)) && ownLine(await page(`/h/${hoa.handle}`, finn)) === null && offDiary.status === 200 && !hasMark(offDiary, "data-contribute"));
    check("her diary stays readable, for her customer and for a visitor who is not signed in", offDiary.status === 200 && offDiary.words.includes("The first beds are built.") && (await page(`/h/${hoa.handle}/project`)).words.includes("The first beds are built."));
    if (founderIn) {
      const on = await press(admin, "/admin/projects", "Save projects switch", { projects: "everyone" });
      check("switched on again, the box and the line are back", on.found && boxShown(await results(finnCall, finn)) && ownLine(await page(`/h/${hoa.handle}`, finn)) === "contribute", noticeOf(on));
      await send("/api/auth/sign-out", { json: {}, jar: admin.jar });
    } else {
      await setSwitches({ projects: "everyone", projectsHosts: [] });
      check("switched on again, the box and the line are back", boxShown(await results(finnCall, finn)) && ownLine(await page(`/h/${hoa.handle}`, finn)) === "contribute");
    }

    // ----------------------------------------------------------------------
    console.log("\n13. Short cases the journey does not reach");
    // A paused host. (Pretended: the pause is written straight to her account.)
    await db.update(schema.user).set({ pausedAt: new Date() }).where(eq(schema.user.id, hoa.id));
    check("a paused host: no box after a call, and no \"Contribute\" line on her page", noBox(await results(finnCall, finn)) && ownLine(await page(`/h/${hoa.handle}`, finn)) === null);
    await db.update(schema.user).set({ pausedAt: null }).where(eq(schema.user.id, hoa.id));
    // A hidden host page, opened by a member. (Pretended: the page is hidden and the membership written straight in.)
    await db.update(schema.hostProfiles).set({ hidden: true }).where(eq(schema.hostProfiles.userId, hoa.id));
    await db.insert(schema.memberships).values({ hostId: hoa.id, customerId: finn.id, status: "active", since: new Date() });
    const hiddenPage = await page(`/h/${hoa.handle}`, finn);
    check("a hidden host page opens for her member, without the project: no box on it, no line, and no box after a call", hiddenPage.status === 200 && !hasMark(hiddenPage, "data-project-box") && ownLine(hiddenPage) === null && noBox(await results(finnCall, finn)) && (await page(`/h/${hoa.handle}`, eve)).status === 404, String(hiddenPage.status));
    await db.update(schema.hostProfiles).set({ hidden: false }).where(eq(schema.hostProfiles.userId, hoa.id));
    await db.delete(schema.memberships).where(eq(schema.memberships.hostId, hoa.id));
    check("(with the pause and the hiding undone, the box and the line are back)", boxShown(await results(finnCall, finn)) && ownLine(await page(`/h/${hoa.handle}`, finn)) === "contribute");
    // Reports. (Pretended: the founder's closing of each report is written straight in.)
    const close = (reporter: Person) => db.update(schema.reports).set({ status: "closed", closedAt: new Date() }).where(eq(schema.reports.reporterId, reporter.id));
    const ivy = await signUp("Ivy");
    const ivyCall = await hadCall(hoa, ivy);
    const jay = await signUp("Jay");
    const jayCall = await hadCall(hoa, jay);
    check("(both customers see the box before they report anything)", boxShown(await results(ivyCall, ivy)) && boxShown(await results(jayCall, jay)));
    await createReport({ reporterId: ivy.id, context: "profile", contextId: hoa.handle, reason: "other", text: "A check by the journey script.", now: new Date() });
    await close(ivy);
    check("a report about the person, closed since: no box, and no \"Contribute\" line either, because such a report also blocks", noBox(await results(ivyCall, ivy)) && ownLine(await page(`/h/${hoa.handle}`, ivy)) === null);
    await createReport({ reporterId: jay.id, context: "post", contextId: hoaPost.id, reason: "other", text: "A check by the journey script.", now: new Date() });
    await close(jay);
    check("a report about one of her posts, closed since: no box after a call, but the \"Contribute\" line stays, since such a report does not block", noBox(await results(jayCall, jay)) && ownLine(await page(`/h/${hoa.handle}`, jay)) === "contribute");

    // The code of the two boxes only reads.
    const askCode = readFileSync("src/lib/projects/ask.ts", "utf8");
    const resultsCode = readFileSync("src/app/calls/[id]/results/page.tsx", "utf8");
    const hostPageCode = readFileSync("src/app/h/[handle]/page.tsx", "utf8");
    const diaryCode = readFileSync("src/app/h/[handle]/project/diary.tsx", "utf8");
    check("the file behind the two boxes has no statement that writes, and does not name Stripe", !/\.(insert|update|delete|transaction|execute)\(/.test(askCode) && !/stripe/i.test(askCode.replace(/^\s*(\/\*\*|\*|\/\/).*$/gm, "")));
    check("each of the three pages asks that file for its box or line, and imports none of the code that starts, pays, stops or refunds a contribution", (resultsCode.match(/askAfterCall\(/g) ?? []).length === 1 && (hostPageCode.match(/contributionOf\(/g) ?? []).length === 1 && (diaryCode.match(/contributionOf\(/g) ?? []).length === 1 && !/from "@\/lib\/contributions\/(start|charge|monthly|refund|ending|switch|jobs)"/.test(resultsCode + hostPageCode + diaryCode));
  } finally {
    await setSwitches({ projects: atStart.projects, projectsHosts: atStart.projectsHosts }).catch((error) => check("afterwards: the projects switch could be put back", false, String(error)));
    await db
      .transaction(async (tx) => {
        await tx.delete(schema.pictureCheckers).where(eq(schema.pictureCheckers.service, "openai"));
        if (checkerBefore) await tx.insert(schema.pictureCheckers).values(checkerBefore);
      })
      .catch((error) => check("afterwards: what the app remembered about the first picture service could be put back", false, String(error)));
    // The founder's own record of this run's presses on the switch (they name no person, so the clean-up by person does not find them).
    await db.delete(schema.adminActions).where(and(eq(schema.adminActions.action, "projects switch set"), gte(schema.adminActions.createdAt, startedAt), inArray(schema.adminActions.adminId, db.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.email, "admin@test.local"))))).catch((error) => check("afterwards: this run's lines in the founder's record could be removed", false, String(error)));
    await wipe().catch((error) => check("afterwards: what this run made could be removed", false, String(error)));
    await db.delete(schema.rateLimit);
  }

  const [left] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.user).where(like(schema.user.email, "pjourney-%"));
  const [leftEmails] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.emailOutbox).where(like(schema.emailOutbox.to, "pjourney-%"));
  const atEnd = await switches();
  check("the script's own test data was cleaned up, and the founder's switch is as it was before the script", left.n === 0 && leftEmails.n === 0 && atEnd.projects === atStart.projects && atEnd.projectsHosts.join(",") === atStart.projectsHosts.join(","), `${left.n} people left; ${atEnd.projects}`);
  const [checkerAfter] = await db.select().from(schema.pictureCheckers).where(eq(schema.pictureCheckers.service, "openai"));
  const [seededAfter] = seeded ? await db.select().from(schema.hostSettings).where(eq(schema.hostSettings.userId, seeded.id)) : [];
  check("what the app remembered about the first picture service, and the test payout account, are as they were", JSON.stringify(checkerAfter ?? null) === JSON.stringify(checkerBefore ?? null) && (seededAfter?.stripeAccountId ?? null) === payoutAccountBefore, { checker: checkerAfter?.lastGoodKey ?? null });
  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
