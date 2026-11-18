/**
 * Testing tool: a membership as one journey through the real pages, from a host setting it up to
 * the founder's switch being turned off while a month is running.
 *
 * What is real and what is pretended:
 *   real       sign-up and the confirmation link; every page (fetched from the running app with
 *              that person's login) and every button: each form is taken as the page drew it, with
 *              the fields Next puts in it, and posted with that person's cookies; the month's
 *              payment (the app's own PaymentIntent, confirmed with one of Stripe's test cards, as a
 *              browser would, and then the app's own "sync" address); the emails written.
 *   pretended  the welcome step's tick boxes; the host's approval, payout account and first hours
 *              (written straight to the database, as the other check scripts do); that two people
 *              had a call before; the waiting (a month's end, a renewal and the reminder are run
 *              with a later clock, by the same functions the always-on helper runs).
 *
 * It needs the app running (npm run dev) and the Stripe test key. Stop the always-on helper first.
 * It works on this computer's test database only, sets the founder's memberships switch for its own
 * host and puts it back to off at the end, and removes everything it made (people whose email
 * starts "mjourney-"). The founder's page is skipped with a note if the test admin's login is not
 * set up (npx tsx scripts/secure-test-admin.ts).
 *
 * Usage: npx tsx scripts/membership-journey-check.ts
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { and, desc, eq, inArray, like, or, sql } from "drizzle-orm";
import { TERMS_VERSION } from "../src/lib/terms";
import { requireLocalDatabase } from "./local-only";
import { totpCode } from "./totp";

const BASE = "http://localhost:3000";
const RUN = randomUUID().slice(0, 8);
const MIN = 60_000;
const DAY = 24 * 60 * MIN;

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

/** One request to the app, the way a browser would send it: a page, a JSON message, or a form. Cookies are kept in the jar. Redirects are not followed. */
async function send(path: string, options: { json?: unknown; form?: FormData; jar?: Jar } = {}): Promise<Reply> {
  const headers: Record<string, string> = { origin: BASE };
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

/** A form as a page drew it: its buttons' words and every field a browser would send (hidden ones, ticked boxes, chosen options), in order. */
type Form = { buttons: string[]; fields: Array<[string, string]>; words: string };
const attribute = (tag: string, name: string): string | null => {
  const found = tag.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`));
  return found ? unescape(found[1]) : null;
};
function formsOf(html: string): Form[] {
  return [...html.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/g)].map(([, inner]) => {
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
      if ((type === "checkbox" || type === "radio") && !/\schecked(?:=|\s|\/|>)/.test(tag)) continue;
      fields.push([name, attribute(tag, "value") ?? (type === "checkbox" ? "on" : "")]);
    }
    return { buttons: [...inner.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)].map((m) => words(m[1]).trim()), fields, words: words(inner) };
  });
}

async function main() {
  requireLocalDatabase();
  if (!process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_")) throw new Error("This script needs the Stripe test key (sk_test_...) in .env.local.");
  const { db, schema } = await import("../src/db");
  const { stripe } = await import("../src/lib/payments/stripe");
  const { stripeCustomerFor } = await import("../src/lib/payments/hold");
  const { reconcileOperations, settleFinishedCalls } = await import("../src/lib/payments/jobs");
  const { setSwitches } = await import("../src/lib/safety/switches");
  const J = await import("../src/lib/membership/join");
  const C = await import("../src/lib/membership/charge");
  const { closeMonth } = await import("../src/lib/membership/close");
  const { runMembershipJobs } = await import("../src/lib/membership/jobs");
  const { memberBookingView, memberOpenTimes } = await import("../src/lib/membership/book");
  const { MEMBERSHIP_WORDING_VERSION: WORDING, agreementSentences } = await import("../src/lib/membership/wording");
  const { writeMembershipReminders, membershipReminderProblem } = await import("../src/lib/notifications/membership-reminders");
  const { deliverEmails } = await import("../src/lib/notifications/delivery");
  const months = schema.membershipMonths;

  const up = await send("/login").catch(() => null);
  if (!up || up.status !== 200) throw new Error("The app is not running. Start it with `npm run dev` first.");

  type Person = { id: string; name: string; email: string; jar: Jar };
  const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const M = async (id: string) => (await db.select().from(months).where(eq(months.id, id)))[0];
  const MS = async (id: string) => (await db.select().from(schema.memberships).where(eq(schema.memberships.id, id)))[0];
  const membershipOf = async (member: Person, host: Person) => (await db.select().from(schema.memberships).where(and(eq(schema.memberships.customerId, member.id), eq(schema.memberships.hostId, host.id))).orderBy(desc(schema.memberships.createdAt)))[0];
  const monthsOf = (membershipId: string) => db.select().from(months).where(eq(months.membershipId, membershipId)).orderBy(months.number);
  const page = (path: string, who?: Person) => send(path, { jar: who?.jar });

  /** The newest email to an address whose subject contains some words. Emails are written in the background, so wait a little. */
  async function emailTo(to: string, subject: string, tries = 25) {
    for (let i = 0; i < tries; i++) {
      const found = await db.select().from(schema.emailOutbox).where(and(eq(schema.emailOutbox.to, to), like(schema.emailOutbox.subject, `%${subject}%`))).orderBy(desc(schema.emailOutbox.createdAt));
      if (found.length > 0) return { subject: found[0].subject, body: found[0].body, link: (found[0].body.match(/https?:\/\/\S+/g) ?? []).pop()?.replace(/^https?:\/\/[^/]+/, "") ?? "", count: found.length };
      await pause(200);
    }
    return null;
  }

  /** Signs up the way the form does and opens the link in the confirmation email. The welcome step's tick boxes are pretended. */
  async function signUp(name: string): Promise<Person> {
    const person = { name: `Journey ${name} ${RUN}`, email: `mjourney-${RUN}-${name.toLowerCase()}@example.test`, password: randomBytes(12).toString("base64url"), jar: new Map() as Jar };
    await send("/api/auth/sign-up/email", { json: { name: person.name, email: person.email, password: person.password, callbackURL: "/welcome" }, jar: person.jar });
    const mail = await emailTo(person.email, "Confirm your email");
    if (!mail) throw new Error(`No confirmation email for ${person.email}`);
    const link = (await db.select().from(schema.emailOutbox).where(and(eq(schema.emailOutbox.to, person.email), like(schema.emailOutbox.subject, "%Confirm your email%"))))[0].body.match(/https?:\/\/\S+/)?.[0] ?? "";
    await send(link, { jar: person.jar });
    const [row] = await db.select().from(schema.user).where(eq(schema.user.email, person.email));
    const now = new Date();
    await db.update(schema.user).set({ adultConfirmedAt: now, termsAcceptedAt: now, termsVersion: TERMS_VERSION, timeZone: "America/New_York" }).where(eq(schema.user.id, row.id));
    return { id: row.id, name: person.name, email: person.email, jar: person.jar };
  }

  /**
   * Presses a button on a page as that person: the page is fetched, the form with that button is
   * taken as it was drawn, and posted back to the page's own address. `change` sets or (with null)
   * leaves out fields, as ticking, unticking or choosing would. `drawn` posts a form from a page
   * that was fetched earlier, or by someone else. Returns where the app sends the person.
   */
  async function press(who: Person, path: string, button: string | RegExp, change: Record<string, string | null> = {}, opts: { where?: (form: Form) => boolean; drawn?: string } = {}): Promise<Reply & { found: boolean }> {
    const html = opts.drawn ?? (await page(path, who)).text;
    const form = formsOf(html).find((f) => f.buttons.some((b) => (typeof button === "string" ? b === button : button.test(b))) && (opts.where?.(f) ?? true));
    if (!form) return { status: 0, json: null, text: "", words: "", location: "", found: false };
    const data = new FormData();
    for (const [name, value] of form.fields) if (!(name in change)) data.append(name, value);
    for (const [name, value] of Object.entries(change)) if (value !== null) data.append(name, value);
    return { ...(await send(path, { form: data, jar: who.jar })), found: true };
  }
  /** The sentence the app shows after an action (it travels, signed, in the address the person is sent to). */
  const noticeOf = (reply: Reply) => decodeURIComponent(reply.location.match(/[?&]notice=([^&#]*)/)?.[1] ?? "");

  /** Pretended: these two had a call two days ago (a host can invite the people she has talked to). */
  async function talked(host: Person, member: Person) {
    const startsAt = new Date(Date.now() - 2 * DAY);
    const [call] = await db.insert(schema.calls).values({ hostId: host.id, customerId: member.id, startsAt, endsAt: new Date(startsAt.getTime() + 30 * MIN), roomName: `mjourney-${randomUUID()}`, pricePer15Cents: 1000, closedAt: new Date(startsAt.getTime() + 31 * MIN) }).returning();
    await db.insert(schema.bookings).values({ hostId: host.id, customerId: member.id, startsAt, endsAt: call.endsAt, lengthMinutes: 30, breakMinutes: 5, pricePer15Cents: 1000, totalCents: 2000, freeCancelMinutes: 0, stage: "accepted", requestKey: randomUUID(), callId: call.id });
    for (const who of [host.id, member.id]) {
      await db.insert(schema.attendanceEvents).values({ provider: "livekit", providerEventId: `EV_${randomUUID()}`, callId: call.id, type: "participant_joined", roomSessionId: "RM_mjourney", participantIdentity: who, participantSessionId: `PA_${randomUUID().slice(0, 8)}`, providerTime: startsAt, payload: "{}" });
    }
  }
  /** What the member's browser does at the card step: confirms the payment THE APP made, with one of Stripe's test cards, then asks the app's own address what became of it. */
  async function payInBrowser(member: Person, membershipId: string, monthId: string, card = "pm_card_visa") {
    const intentId = (await M(monthId)).stripePaymentIntentId;
    if (!intentId) return { status: 0, json: null } as Pick<Reply, "status" | "json">;
    await stripe().paymentIntents.confirm(intentId, { payment_method: card, return_url: "https://example.com/return" }).catch(() => undefined);
    return send(`/api/memberships/${membershipId}/sync`, { json: { month: monthId }, jar: member.jar });
  }
  /** A member made through the functions of part one (not through the pages): invited, joined, the first month held. */
  async function memberOf(host: Person, name: string): Promise<{ person: Person; membershipId: string; monthId: string }> {
    const person = await signUp(name);
    await talked(host, person);
    const invitation = await J.invite({ hostId: host.id, customerId: person.id, now: new Date() });
    const started = await J.join({ customerId: person.id, inviteId: invitation.inviteId, requestId: randomUUID(), agreed: true, wordingVersion: WORDING, now: new Date() });
    await C.payNow({ monthId: started.monthId, memberId: person.id });
    await payInBrowser(person, started.membershipId, started.monthId);
    return { person, ...started };
  }
  /** The always-on helper's membership work, now: it finishes what a step left for it (a hold to let go, a clean-up). */
  async function helper() {
    for (let i = 0; i < 2; i++) {
      await reconcileOperations(new Date());
      await runMembershipJobs(new Date());
    }
  }

  /** Removes everything this script ever made: the people whose email starts "mjourney-", and all that hangs on them. */
  async function wipe() {
    const ids = (await db.select({ id: schema.user.id }).from(schema.user).where(like(schema.user.email, "mjourney-%"))).map((row) => row.id);
    if (ids.length === 0) return;
    const memberships = (await db.select({ id: schema.memberships.id }).from(schema.memberships).where(or(inArray(schema.memberships.hostId, ids), inArray(schema.memberships.customerId, ids)))).map((row) => row.id);
    const theirMonths = memberships.length > 0 ? await db.select().from(months).where(inArray(months.membershipId, memberships)) : [];
    const monthIds = theirMonths.map((month) => month.id);
    // Nothing stays held on a test card.
    for (const month of theirMonths) if (month.stripePaymentIntentId && (month.status === "to_pay" || month.status === "held")) await stripe().paymentIntents.cancel(month.stripePaymentIntentId).catch(() => undefined);
    const bookings = (await db.select({ id: schema.bookings.id }).from(schema.bookings).where(or(inArray(schema.bookings.hostId, ids), inArray(schema.bookings.customerId, ids)))).map((row) => row.id);
    const calls = (await db.select({ id: schema.calls.id }).from(schema.calls).where(or(inArray(schema.calls.hostId, ids), inArray(schema.calls.customerId, ids)))).map((row) => row.id);
    const payments = [
      ...(monthIds.length > 0 ? await db.select({ id: schema.payments.id }).from(schema.payments).where(inArray(schema.payments.monthId, monthIds)) : []),
      ...(calls.length > 0 ? await db.select({ id: schema.payments.id }).from(schema.payments).where(inArray(schema.payments.callId, calls)) : []),
    ].map((row) => row.id);
    const steps: Array<() => Promise<unknown>> = [
      async () => payments.length > 0 && (await db.delete(schema.collectionItems).where(inArray(schema.collectionItems.paymentId, payments))),
      async () => payments.length > 0 && (await db.delete(schema.ledgerEntries).where(inArray(schema.ledgerEntries.paymentId, payments))),
      async () => payments.length > 0 && (await db.delete(schema.moneyOperations).where(inArray(schema.moneyOperations.paymentId, payments))),
      async () => monthIds.length > 0 && (await db.delete(schema.ledgerEntries).where(inArray(schema.ledgerEntries.monthId, monthIds))),
      async () => monthIds.length > 0 && (await db.delete(schema.moneyOperations).where(inArray(schema.moneyOperations.monthId, monthIds))),
      async () => monthIds.length > 0 && (await db.delete(schema.membershipRefunds).where(inArray(schema.membershipRefunds.monthId, monthIds))),
      async () => bookings.length > 0 && (await db.delete(schema.busyEntries).where(inArray(schema.busyEntries.bookingId, bookings))),
      async () => bookings.length > 0 && (await db.delete(schema.bookingCards).where(inArray(schema.bookingCards.bookingId, bookings))),
      async () => bookings.length > 0 && (await db.delete(schema.bookings).where(inArray(schema.bookings.id, bookings))),
      async () => payments.length > 0 && (await db.delete(schema.payments).where(inArray(schema.payments.id, payments))),
      async () => calls.length > 0 && (await db.delete(schema.attendanceEvents).where(inArray(schema.attendanceEvents.callId, calls))),
      async () => calls.length > 0 && (await db.delete(schema.calls).where(inArray(schema.calls.id, calls))),
      async () => memberships.length > 0 && (await db.update(schema.memberships).set({ currentMonthId: null, agreementId: null, offerMonthId: null }).where(inArray(schema.memberships.id, memberships))),
      async () => monthIds.length > 0 && (await db.delete(months).where(inArray(months.id, monthIds))),
      async () => memberships.length > 0 && (await db.delete(schema.membershipCards).where(inArray(schema.membershipCards.membershipId, memberships))),
      async () => memberships.length > 0 && (await db.delete(schema.membershipAgreements).where(inArray(schema.membershipAgreements.membershipId, memberships))),
      async () => memberships.length > 0 && (await db.delete(schema.membershipInvitations).where(inArray(schema.membershipInvitations.membershipId, memberships))),
      async () => memberships.length > 0 && (await db.delete(schema.memberships).where(inArray(schema.memberships.id, memberships))),
      () => db.delete(schema.weeklyHours).where(inArray(schema.weeklyHours.hostId, ids)),
      () => db.delete(schema.hostCalendars).where(inArray(schema.hostCalendars.userId, ids)),
      () => db.delete(schema.membershipOffers).where(inArray(schema.membershipOffers.hostId, ids)),
      () => db.delete(schema.hostSettings).where(inArray(schema.hostSettings.userId, ids)),
      () => db.delete(schema.hostProfiles).where(inArray(schema.hostProfiles.userId, ids)),
      () => db.delete(schema.stripeCustomers).where(inArray(schema.stripeCustomers.userId, ids)),
      () => db.delete(schema.emailOutbox).where(like(schema.emailOutbox.to, "mjourney-%")),
      () => db.delete(schema.session).where(inArray(schema.session.userId, ids)),
      () => db.delete(schema.account).where(inArray(schema.account.userId, ids)),
      () => db.delete(schema.user).where(inArray(schema.user.id, ids)),
    ];
    for (const step of steps) await step().catch((error) => console.log(`   (clean-up: ${error instanceof Error ? error.message.split("\n")[0] : error})`));
  }

  await wipe();
  // Attempt limits are per network address, and every request here comes from the same one.
  await db.delete(schema.rateLimit);

  try {
    // ----------------------------------------------------------------------
    console.log("\n1. A host sets up her membership and sees her room");
    const host = await signUp("Host");
    const handle = `mj${RUN}`;
    const stamp = new Date();
    // Pretended: an approved host who can be paid, with 3 hours every Monday (12 hours in four weeks) at $10.00 per 15 minutes.
    await db.insert(schema.hostProfiles).values({ userId: host.id, handle, handleKey: handle, displayName: `Jo Journey ${RUN}`, pricePer15Cents: 1000, status: "approved", usConfirmedAt: stamp });
    await db.insert(schema.hostSettings).values({ userId: host.id, payoutsReady: true }).onConflictDoNothing();
    await db.insert(schema.hostCalendars).values({ userId: host.id, timeZone: "America/New_York", lengths: "30", noticeHours: 24, horizonWeeks: 2, breakMinutes: 5 });
    const [monday] = await db.insert(schema.weeklyHours).values({ hostId: host.id, weekday: 1, startMinute: 540, endMinute: 720 }).returning();
    const hostName = `Jo Journey ${RUN}`;

    check("with the founder's switch off, her Hosting page only says memberships are not open", (await page("/host", host)).words.includes("Memberships are not open yet."));
    check("and saving a membership is refused", /not open|cannot be saved/i.test((await page("/host/membership?on=1&price=7.50&minutes=120", host)).words));
    await setSwitches({ memberships: "named", membershipsHosts: [host.id] });

    const preview = await page("/host/membership?on=1&price=7.50&minutes=120", host);
    check("the page before saving shows the monthly amount, and what the same time costs at her regular price", preview.words.includes("Members pay $60.00 a month for 2 hours") && preview.words.includes("$80.00"), preview.words.slice(0, 400));
    check("opening that page saved nothing", (await db.select().from(schema.membershipOffers).where(eq(schema.membershipOffers.hostId, host.id))).length === 0);
    const saved = await press(host, "/host/membership?on=1&price=7.50&minutes=120", "Save this change");
    check("\"Save this change\" saves it and sends her back to the Membership part", saved.found && saved.location.startsWith("/host?") && saved.location.endsWith("#membership"), `${saved.status} ${saved.location}`);
    const hosting = await page("/host", host);
    check("her Hosting page says the membership is on, and how much room her hours leave", hosting.words.includes("Your membership is on.") && hosting.words.includes("Your weekly hours offer 12 hours a month.") && hosting.words.includes("Room for 6 more members."), hosting.words.match(/Your weekly hours[^.]*\.[^.]*\.[^.]*\./)?.[0]);

    const added = await press(host, "/host/calendar", "Add hours", { weekday: "2", from: "09:00", to: "10:00", membersOnly: "on" });
    check("she adds an hour on Tuesdays for members only", added.found && (await page("/host/calendar", host)).words.includes("Members only") && (await page("/host", host)).words.includes("Room for 8 more members."), noticeOf(added));

    const extra = await press(host, "/host/calendar", "Add hours", { weekday: "4", from: "09:00", to: "10:00" });
    const [thursday] = await db.select().from(schema.weeklyHours).where(and(eq(schema.weeklyHours.hostId, host.id), eq(schema.weeklyHours.weekday, 4)));
    const quiet = await press(host, "/host/calendar", "Remove", {}, { where: (form) => form.fields.some(([name, value]) => name === "id" && value === thursday?.id) });
    check("removing hours while she has no members and no invitations is saved at once, with nothing to choose", extra.found && quiet.found && quiet.location.startsWith("/host/calendar?") && /were removed/.test(noticeOf(quiet)) && (await db.select().from(schema.weeklyHours).where(eq(schema.weeklyHours.hostId, host.id))).length === 2, `${quiet.location}`);

    // ----------------------------------------------------------------------
    console.log("\n2. She invites a person she has had a call with");
    const alice = await signUp("Alice");
    const stranger = await signUp("Stranger");
    await talked(host, alice);
    const contacts = await page("/contacts", host);
    check("\"People you have talked to\" offers to invite the person she talked to, and nobody else", contacts.words.includes(`Invite ${alice.name} to your membership`) && !contacts.words.includes(stranger.name));
    const invitedReply = await press(host, "/contacts", `Invite ${alice.name} to your membership`);
    const invitation = await emailTo(alice.email, "invites you to a membership");
    const invitedRow = await membershipOf(alice, host);
    check("the invitation is sent, with a link to the invitation's own page", invitedReply.found && invitedRow?.status === "invited" && Boolean(invitation?.link.startsWith(`/h/${handle}/membership?invite=${invitedRow.inviteId}`)), `${noticeOf(invitedReply)} ${invitation?.link}`);
    const inviteLink = invitation?.link ?? "";
    check("her list now shows the open invitation, with a button to take it back", (await page("/contacts", host)).words.includes("Take the invitation back"));

    // ----------------------------------------------------------------------
    console.log("\n3. The invited person opens the invitation, reads it, and joins with a card");
    const otherHost = await signUp("Otherhost");
    const loggedOut = await page(inviteLink);
    check("someone who is not logged in is sent to log in, and comes back to the same invitation", loggedOut.status >= 300 && loggedOut.status < 400 && loggedOut.location.startsWith("/login?next=") && decodeURIComponent(loggedOut.location).includes(`membership?invite=${invitedRow.inviteId}`), `${loggedOut.status} ${loggedOut.location}`);
    check("a stranger and another host who open the link see \"not found\"", (await page(inviteLink, stranger)).status === 404 && (await page(inviteLink, otherHost)).status === 404 && (await page(inviteLink, host)).status === 404);
    const invitationPage = await page(inviteLink, alice);
    const sentences = agreementSentences({ hostName, monthlyCents: 6000, includedMinutes: 120 });
    check("the invited person sees the amount, the time, both prices, and every sentence they agree to", invitationPage.status === 200 && invitationPage.words.includes("$60.00 a month for 2 hours of calls") && invitationPage.words.includes("$7.50 per 15 minutes") && invitationPage.words.includes("$10.00 per 15 minutes") && sentences.every((sentence) => invitationPage.words.includes(sentence)), String(invitationPage.status));
    check("the host's own page shows the invited person a box with a link to the invitation", (await page(`/h/${handle}`, alice)).text.includes(`/h/${handle}/membership?invite=${invitedRow.inviteId}`));
    check("opening the invitation started nothing", (await MS(invitedRow.id)).status === "invited" && (await monthsOf(invitedRow.id)).length === 0);

    const noTick = await press(alice, inviteLink, "Join", { agreed: null });
    check("\"Join\" without the tick is refused, and says why", noTick.found && /tick the box/.test(noticeOf(noTick)) && (await MS(invitedRow.id)).status === "invited", noticeOf(noTick));
    const asStranger = await press(stranger, inviteLink, "Join", { agreed: "on" }, { drawn: invitationPage.text });
    check("the same form posted by someone else joins nobody", asStranger.found && (await MS(invitedRow.id)).status === "invited" && (await db.select().from(schema.memberships).where(eq(schema.memberships.customerId, stranger.id))).length === 0, `${asStranger.status} ${noticeOf(asStranger)}`);
    const joined = await press(alice, inviteLink, "Join", { agreed: "on" }, { drawn: invitationPage.text });
    const aliceId = invitedRow.id;
    const [month1] = await monthsOf(aliceId);
    check("\"Join\" with the tick leads to the card step, with one month to pay and its payment made ready by the action", joined.location === `/h/${handle}/membership` && (await MS(aliceId)).status === "joining" && month1?.status === "to_pay" && Boolean(month1.stripePaymentIntentId), `${joined.status} ${joined.location} ${noticeOf(joined)}`);
    await press(alice, inviteLink, "Join", { agreed: "on" }, { drawn: invitationPage.text });
    check("the same form pressed a second time joins once: still one month and one agreement", (await monthsOf(aliceId)).length === 1 && (await db.select().from(schema.membershipAgreements).where(eq(schema.membershipAgreements.membershipId, aliceId))).length === 1);
    const cardStep = await page(`/h/${handle}/membership`, alice);
    check("the card step shows the amount and hands the payment's secret to its member's form only", cardStep.status === 200 && cardStep.words.includes("$60.00 a month for 2 hours") && cardStep.text.includes("_secret_") && (await page(`/h/${handle}/membership`, stranger)).status === 404, String(cardStep.status));
    const before = (await M(month1.id)).stripePaymentIntentId;
    await page(`/h/${handle}/membership`, alice);
    check("reloading the card step makes no second payment and moves no deadline", (await M(month1.id)).stripePaymentIntentId === before && (await M(month1.id)).cardStepExpiresAt?.getTime() === month1.cardStepExpiresAt?.getTime() && (await monthsOf(aliceId)).length === 1);
    check("the address the card form asks answers only the member", (await send(`/api/memberships/${aliceId}/sync`, { json: { month: month1.id }, jar: stranger.jar })).status === 404 && (await send(`/api/memberships/${aliceId}/sync`, { json: { month: month1.id } })).status === 401);
    // Pretended: the card step's 30 minutes ran out a moment ago, and the helper has not been by yet.
    await db.update(months).set({ cardStepExpiresAt: new Date(Date.now() - MIN) }).where(eq(months.id, month1.id));
    const tooLate = await page(`/h/${handle}/membership`, alice);
    const asked = await send(`/api/memberships/${aliceId}/sync`, { json: { month: month1.id }, jar: alice.jar });
    check(
      "a card step whose time ran out still opens for its own member: no secret, no claim about the payment, a \"Check again\" button, and the address that button asks answers her with the month as it stands",
      tooLate.status === 200 && tooLate.words.includes("The time for the card step is over. We are checking with the bank") && !tooLate.text.includes("_secret_") && tooLate.words.includes("Check again") && asked.status === 200 && asked.json?.status === "to_pay" && (await page(`/h/${handle}/membership`, stranger)).status === 404,
      `${tooLate.status} ${JSON.stringify(asked.json)} ${tooLate.words.slice(0, 200)}`,
    );
    await db.update(months).set({ cardStepExpiresAt: month1.cardStepExpiresAt }).where(eq(months.id, month1.id));
    const paid = await payInBrowser(alice, aliceId, month1.id);
    check("with a test card entered, the app finds the hold at Stripe itself: the month is held, and she is a member", paid.status === 200 && paid.json?.status === "held" && (await MS(aliceId)).status === "active", JSON.stringify(paid.json));
    const usedLink = await page(inviteLink, alice);
    check("the invitation's link, now used, only leads its own member on to her membership, and shows nobody a \"Join\"", usedLink.location === `/memberships/${aliceId}` && (await page(inviteLink, stranger)).status === 404, `${usedLink.status} ${usedLink.location}`);

    // ----------------------------------------------------------------------
    console.log("\n4. Her membership page and receipt; nobody else can open them");
    const afterJoin = await page(`/h/${handle}/membership`, alice);
    check("the joining page now leads on to her membership", afterJoin.location === `/memberships/${aliceId}`, afterJoin.location);
    const mine = await page(`/memberships/${aliceId}`, alice);
    check("her page shows the time, that the amount is held and not yet taken, and \"Cancel now\"", mine.status === 200 && mine.words.includes("2 hours left this month") && mine.words.includes("held on your card, not yet taken") && mine.words.includes("Cancel now, nothing is charged") && mine.words.includes("Month 1"), mine.words.slice(0, 300));
    check("the monthly receipt was emailed", Boolean(await emailTo(alice.email, "$60.00 for this month")));
    check("\"Your account\" lists the membership", (await page("/account", alice)).text.includes(`/memberships/${aliceId}`));
    check(
      "a stranger, another host and her own host all get \"not found\" for her page, her \"Pay now\" page and her payment",
      (await Promise.all([stranger, otherHost, host].flatMap((who) => [page(`/memberships/${aliceId}`, who), page(`/memberships/${aliceId}/pay`, who), send(`/api/memberships/${aliceId}/sync`, { json: { month: month1.id }, jar: who.jar })]))).every((reply) => reply.status === 404),
    );
    check("the host sees her in the member list", (await page("/host", host)).words.includes(alice.name) && (await page("/contacts", host)).words.includes("A member of yours."));

    // ----------------------------------------------------------------------
    console.log("\n5. She books a time that is for members only");
    const view = await memberBookingView(alice.id, host.id, new Date());
    const memberOnly = view ? (await memberOpenTimes(view, 30, new Date())).find((time) => time.membersOnly) : undefined;
    check("there is an open time for members only", Boolean(memberOnly));
    let callId = "";
    if (memberOnly) {
      const bookPath = `/h/${handle}/book?as=member&length=30&start=${encodeURIComponent(memberOnly.startsAt.toISOString())}`;
      const summary = await page(bookPath, alice);
      check("the summary says what it uses of her membership", summary.status === 200 && summary.words.includes("Uses 30 minutes of your membership"), String(summary.status));
      check("a stranger cannot open a members-only time", !(await page(bookPath, stranger)).words.includes("Uses 30 minutes of your membership"));
      const booked = await press(alice, bookPath, "Book");
      const [booking] = await db.select().from(schema.bookings).where(and(eq(schema.bookings.customerId, alice.id), eq(schema.bookings.source, "member")));
      callId = booking?.callId ?? "";
      check("\"Book\" books the call at once, and this first booking takes the month's money", booked.location.startsWith("/bookings/") && Boolean(callId) && (await M(month1.id)).status === "running" && (await M(month1.id)).setAsideCents === 1500, `${booked.location} ${noticeOf(booked)}`);
      const now1 = await page(`/memberships/${aliceId}`, alice);
      check("her page now shows 1 hour 30 minutes left, the month as paid, and no \"Cancel now\"", now1.words.includes("1 hour 30 minutes left this month") && now1.words.includes("$60.00 paid") && !now1.words.includes("Cancel now, nothing is charged"));
    }

    // ----------------------------------------------------------------------
    console.log("\n6. The call, and the page after it");
    if (callId) {
      // Pretended: the call ended 20 minutes ago and both were in it the whole time.
      const endsAt = new Date(Math.floor((Date.now() - 20 * MIN) / 1000) * 1000);
      const startsAt = new Date(endsAt.getTime() - 30 * MIN);
      const [booking] = await db.select().from(schema.bookings).where(eq(schema.bookings.callId, callId));
      await db.delete(schema.busyEntries).where(eq(schema.busyEntries.bookingId, booking.id));
      await db.update(schema.bookings).set({ startsAt, endsAt }).where(eq(schema.bookings.id, booking.id));
      await db.update(schema.payments).set({ coversFrom: startsAt, coversUntil: endsAt }).where(eq(schema.payments.callId, callId));
      const [call] = await db.update(schema.calls).set({ startsAt, endsAt, closedAt: new Date(endsAt.getTime() + MIN) }).where(eq(schema.calls.id, callId)).returning();
      for (const identity of [call.hostId, call.customerId]) {
        const row = (type: string, providerTime: Date) => ({ provider: "livekit", providerEventId: `EV_${randomUUID()}`, callId, type, roomSessionId: `RM_mjourney_${RUN}`, participantIdentity: identity, participantSessionId: `PA_${identity.slice(-6)}_${RUN}`, providerTime, payload: "{}" });
        await db.insert(schema.attendanceEvents).values([row("participant_joined", startsAt), row("participant_left", endsAt)]);
      }
      await settleFinishedCalls(new Date());
      const results = await page(`/calls/${callId}/results`, alice);
      check("the page after the call opens for her and speaks of her membership time, not of a card", results.status === 200 && /membership/i.test(results.words), String(results.status));
      await settleFinishedCalls(new Date(startsAt.getTime() + 24 * 60 * MIN + 3 * MIN));
      check("a day later the 30 minutes are used, and the six places still add up to what she paid", (await M(month1.id)).usedCents === 1500 && (await M(month1.id)).setAsideCents === 0 && (await M(month1.id)).freeCents === 4500, JSON.stringify(await M(month1.id)).slice(0, 300));
    }

    // ----------------------------------------------------------------------
    console.log("\n7. The reminder, cancelling and \"Keep my membership\"");
    const ends1 = (await M(month1.id)).endsAt!;
    check("more than three days before the month ends, no reminder is written", (await writeMembershipReminders(new Date(ends1.getTime() - 4 * DAY))) === 0 && !(await emailTo(alice.email, "renews soon", 1)));
    await writeMembershipReminders(new Date(ends1.getTime() - 2 * DAY));
    const reminder = await emailTo(alice.email, "renews soon");
    check("inside the three days she gets one reminder: the time left, the next payment and how to cancel", Boolean(reminder) && reminder!.body.includes("You have 1 hour 30 minutes left") && reminder!.body.includes("Your next payment: $60.00 for 2 hours") && reminder!.body.includes(`/memberships/${aliceId}`) && !/unsubscribe/i.test(reminder!.body), reminder?.body);
    await writeMembershipReminders(new Date(ends1.getTime() - DAY));
    check("it is written once, and ends with the month", (await emailTo(alice.email, "renews soon"))?.count === 1 && (await db.select().from(schema.emailOutbox).where(eq(schema.emailOutbox.dedupeKey, `month-reminder:${month1.id}`)))[0]?.expiresAt?.getTime() === ends1.getTime());
    check("while nothing changed, the reminder is still true when its turn to be sent comes", (await membershipReminderProblem(month1.id, reminder!.subject, reminder!.body)) === null);

    const cancelPage = await page(`/memberships/${aliceId}`, alice);
    check("before she confirms, the page says what cancelling gives up", cancelPage.words.includes("Your price of $7.50 per 15 minutes and your 2 hours a month are yours while your membership goes on."));
    const cancelled = await press(alice, `/memberships/${aliceId}`, "Cancel at the end of the month");
    const afterCancel = await page(`/memberships/${aliceId}`, alice);
    check("\"Cancel at the end of the month\" stops the renewal: the page says when it ends, and offers \"Keep my membership\"", cancelled.found && (await MS(aliceId)).memberStoppedAt !== null && afterCancel.words.includes("You cancelled.") && afterCancel.words.includes("Keep my membership") && afterCancel.words.includes("It does not renew"), noticeOf(cancelled));
    check("a reminder that promised a renewal is no longer true", (await membershipReminderProblem(month1.id, reminder!.subject, reminder!.body)) !== null);
    // The sender's own turn, with a pretend sending service: everything else to her goes out, the reminder is dropped.
    await deliverEmails(new Date(), async () => ({ ok: true, providerId: `mjourney-${randomUUID()}` }), { toLike: alice.email });
    const [dropped] = await db.select().from(schema.emailOutbox).where(eq(schema.emailOutbox.dedupeKey, `month-reminder:${month1.id}`));
    check("so when its turn to be sent comes it is dropped, while her other emails go out", dropped?.status === "failed" && /no longer wanted/.test(dropped.lastError ?? "") && (await db.select().from(schema.emailOutbox).where(and(eq(schema.emailOutbox.to, alice.email), eq(schema.emailOutbox.status, "sent")))).length > 0, `${dropped?.status} ${dropped?.lastError}`);
    check("the host is told, and sees that it does not renew", Boolean(await emailTo(host.email, "has cancelled their membership")) && (await page("/host", host)).words.includes("They cancelled: their membership is paused when this month ends."));
    const kept = await press(alice, `/memberships/${aliceId}`, "Keep my membership");
    const afterKeep = await page(`/memberships/${aliceId}`, alice);
    check("\"Keep my membership\" brings the renewal back and charges nothing; the page shows the next payment", kept.found && (await MS(aliceId)).memberStoppedAt === null && afterKeep.words.includes("Your next payment") && afterKeep.words.includes("$60.00 for 2 hours") && (await monthsOf(aliceId)).length === 1, noticeOf(kept));

    // ----------------------------------------------------------------------
    console.log("\n8. The renewal, and \"Cancel now\" in the new month");
    // (Closing the month writes the next one and tries the saved card. The helper is not run at that pretended moment: 30 days on, it would also take the money that is only held.)
    await closeMonth(month1.id, ends1);
    const month2 = (await monthsOf(aliceId))[1];
    check("when the month ends, the next one is written and held on her saved card", month2?.status === "held" && (await MS(aliceId)).currentMonthId === month2.id && (await M(month1.id)).expiredCents === 4500, `${month2?.status}`);
    const renewed = await page(`/memberships/${aliceId}`, alice);
    check("her page shows both receipts, what expired, and offers \"Cancel now\" again", renewed.words.includes("Month 2") && renewed.words.includes("Month 1") && renewed.words.includes("Expired: $45.00") && renewed.words.includes("Cancel now, nothing is charged"));
    const cancelNow = await press(alice, `/memberships/${aliceId}`, "Cancel now, nothing is charged");
    const paused = await page(`/memberships/${aliceId}`, alice);
    check("\"Cancel now\" pauses her today and charges nothing for the new month", cancelNow.found && (await MS(aliceId)).status === "paused" && (await M(month2.id)).status === "given_up" && paused.words.includes("Paused, because you cancelled it") && paused.words.includes("Nothing was charged") && paused.words.includes("Resume membership"), noticeOf(cancelNow));
    check("the hold at Stripe is let go", (await stripe().paymentIntents.retrieve((await M(month2.id)).stripePaymentIntentId!)).status === "canceled");

    // ----------------------------------------------------------------------
    console.log("\n9. A member whose renewal fails, and \"Pay now\"");
    const bob = await memberOf(host, "Bob");
    check("a second member joined", (await MS(bob.membershipId)).status === "active" && (await M(bob.monthId)).status === "held");
    // Pretended: the card he saved stops working (one of Stripe's test cards that can be saved but not charged).
    const bobCustomer = await stripeCustomerFor(bob.person);
    const failing = await stripe().paymentMethods.attach("pm_card_chargeCustomerFail", { customer: bobCustomer });
    await db.update(schema.membershipCards).set({ retiredAt: new Date() }).where(and(eq(schema.membershipCards.membershipId, bob.membershipId), sql`${schema.membershipCards.retiredAt} is null`));
    await db.insert(schema.membershipCards).values({ membershipId: bob.membershipId, stripePaymentMethodId: failing.id, savedAt: new Date() });
    await C.takeNow(bob.monthId, new Date());
    const bobEnds = (await M(bob.monthId)).endsAt!;
    // He has switched reminder emails off. This one is the notice of a payment, so it is sent all the same.
    await db.update(schema.user).set({ reminderEmails: false }).where(eq(schema.user.id, bob.person.id));
    await writeMembershipReminders(new Date(bobEnds.getTime() - 2 * DAY));
    await deliverEmails(new Date(), async () => ({ ok: true, providerId: `mjourney-${randomUUID()}` }), { toLike: bob.person.email });
    const [bobReminder] = await db.select().from(schema.emailOutbox).where(eq(schema.emailOutbox.dedupeKey, `month-reminder:${bob.monthId}`));
    check("a member who switched reminder emails off still gets the reminder before a payment", bobReminder?.status === "sent" && bobReminder.body.includes("Your next payment: $60.00"), `${bobReminder?.status} ${bobReminder?.lastError}`);
    await closeMonth(bob.monthId, bobEnds);
    const bobMonth2 = (await monthsOf(bob.membershipId))[1];
    check("his renewal fails: he is not a paying member, and is told by email with the link to pay", (await MS(bob.membershipId)).status === "unpaid" && bobMonth2?.status === "to_pay" && Boolean((await emailTo(bob.person.email, "did not go through"))?.body.includes(`/memberships/${bob.membershipId}/pay`)), (await MS(bob.membershipId)).status);
    const unpaid = await page(`/memberships/${bob.membershipId}`, bob.person);
    check("his page says so, that he has no member time, until when, and offers \"Pay now\"", unpaid.words.includes("Your monthly payment did not go through.") && unpaid.words.includes("Pay now: $60.00") && unpaid.words.includes("your membership is paused") && !unpaid.words.includes("left this month"));
    check("he cannot book as a member meanwhile", (await memberBookingView(bob.person.id, host.id, new Date())) === null);
    const payPage = await page(`/memberships/${bob.membershipId}/pay`, bob.person);
    check("the \"Pay now\" page shows the amount and a button; opening it starts nothing and hands out no secret yet", payPage.status === 200 && payPage.words.includes("$60.00 for 2 hours") && formsOf(payPage.text).some((f) => f.buttons.includes("Pay now")) && !payPage.text.includes("_secret_"), String(payPage.status));
    const payNow = await press(bob.person, `/memberships/${bob.membershipId}/pay`, "Pay now");
    const cardPage = await page(`/memberships/${bob.membershipId}/pay`, bob.person);
    check("\"Pay now\" makes the payment ready, and the page then shows the card form for the same payment", payNow.found && payNow.location.startsWith(`/memberships/${bob.membershipId}/pay`) && cardPage.text.includes("_secret_") && (await M(bobMonth2.id)).stripePaymentIntentId === bobMonth2.stripePaymentIntentId, `${payNow.location}`);
    const bobPaid = await payInBrowser(bob.person, bob.membershipId, bobMonth2.id);
    const backToPage = await page(`/memberships/${bob.membershipId}/pay`, bob.person);
    check("with a working card the month is held, he is a member again, and the page leads back to his membership", bobPaid.json?.status === "held" && (await MS(bob.membershipId)).status === "active" && backToPage.location.startsWith(`/memberships/${bob.membershipId}`), JSON.stringify(bobPaid.json));

    // ----------------------------------------------------------------------
    console.log("\n10. The host lowers her price; a paused member resumes on the membership as it is now");
    const resumeOld = await page(`/h/${handle}/membership`, alice);
    check("a paused member's resume page shows the membership as it is now, with the sentences and the tick box", resumeOld.status === 200 && resumeOld.words.includes("$60.00 a month for 2 hours of calls") && formsOf(resumeOld.text).some((f) => f.buttons.includes("Resume membership")));
    await writeMembershipReminders(new Date((await M(bobMonth2.id)).endsAt!.getTime() - 2 * DAY));
    const [bobSecond] = await db.select().from(schema.emailOutbox).where(eq(schema.emailOutbox.dedupeKey, `month-reminder:${bobMonth2.id}`));
    check("a reminder for his second month is waiting, and says $60.00", Boolean(bobSecond?.body.includes("Your next payment: $60.00 for 2 hours")) && (await membershipReminderProblem(bobMonth2.id, bobSecond.subject, bobSecond.body)) === null);
    await db.update(schema.hostProfiles).set({ displayName: "Renamed Host" }).where(eq(schema.hostProfiles.userId, host.id));
    const renamed = await membershipReminderProblem(bobMonth2.id, bobSecond.subject, bobSecond.body);
    await db.update(schema.hostProfiles).set({ displayName: hostName }).where(eq(schema.hostProfiles.userId, host.id));
    check("a host who changes her name does not lose her member the reminder: what it says about the payment is unchanged", renamed === null, renamed);
    const lower = await page("/host/membership?on=1&price=6.00&minutes=120", host);
    check("before she saves a lower price, the host is shown who pays less and what it costs her", lower.words.includes("1 member pays $7.50 per 15 minutes now") && lower.words.includes("Together they will pay $12.00 less a month"), lower.words.slice(0, 600));
    const lowered = await press(host, "/host/membership?on=1&price=6.00&minutes=120", "Save this change");
    check("she saves it", lowered.found && (await db.select().from(schema.membershipOffers).where(eq(schema.membershipOffers.hostId, host.id)))[0].pricePer15Cents === 600, noticeOf(lowered));
    const bobAfter = await page(`/memberships/${bob.membershipId}`, bob.person);
    check("the member who was paying more pays the lower price from his next month, and is told", (await MS(bob.membershipId)).ownPricePer15Cents === 600 && bobAfter.words.includes("$48.00 for 2 hours") && Boolean(await emailTo(bob.person.email, "will cost less")), bobAfter.words.match(/Your next payment[^.]*\./)?.[0]);
    check("the waiting reminder that still says $60.00 is no longer true, and would be dropped", /no longer so/.test((await membershipReminderProblem(bobMonth2.id, bobSecond.subject, bobSecond.body)) ?? ""));
    const stale = await press(alice, `/h/${handle}/membership`, "Resume membership", { agreed: "on" }, { drawn: resumeOld.text });
    check("a resume form drawn before the change is refused: nobody agrees to terms they did not see", stale.found && /changed the membership while this page was open/.test(noticeOf(stale)) && (await MS(aliceId)).status === "paused", noticeOf(stale));
    const resumeNew = await page(`/h/${handle}/membership`, alice);
    check("the page now shows the new terms", resumeNew.words.includes("$48.00 a month for 2 hours of calls"));
    const resumed = await press(alice, `/h/${handle}/membership`, "Resume membership", { agreed: "on" });
    const month3 = (await monthsOf(aliceId))[2];
    check("\"Resume membership\" leads to the card step for a new month at the new price", resumed.location === `/h/${handle}/membership` && (await MS(aliceId)).status === "joining" && month3?.totalCents === 4800 && Boolean(month3.stripePaymentIntentId), `${resumed.location} ${noticeOf(resumed)}`);
    const resumePaid = await payInBrowser(alice, aliceId, month3.id);
    check("with her card entered she is a member again, at $6.00 per 15 minutes", resumePaid.json?.status === "held" && (await MS(aliceId)).status === "active" && (await MS(aliceId)).ownPricePer15Cents === 600);

    // ----------------------------------------------------------------------
    console.log("\n11. The host cuts her hours and chooses for each member; one accepts less time, one says no");
    const carol = await memberOf(host, "Carol");
    const dave = await memberOf(host, "Dave");
    const erin = await memberOf(host, "Erin");
    const frank = await signUp("Frank");
    await talked(host, frank);
    await press(host, "/contacts", `Invite ${frank.name} to your membership`);
    const frankOld = (await emailTo(frank.email, "invites you to a membership"))?.link ?? "";
    check("a sixth person has an open invitation", (await page(frankOld, frank)).status === 200 && (await membershipOf(frank, host))?.status === "invited");
    const removal = await press(host, "/host/calendar", "Remove", {}, { where: (form) => form.fields.some(([name, value]) => name === "id" && value === monday.id) });
    check("removing her Monday hours does not save: it sends her to the step where she chooses for her members", removal.found && removal.location.startsWith(`/host/calendar/cut?remove=${monday.id}`) && (await db.select().from(schema.weeklyHours).where(eq(schema.weeklyHours.id, monday.id))).length === 1, removal.location);
    const cut = await page(removal.location, host);
    check("the step says what her members need and what she would offer, and lists every member with the three choices", cut.words.includes("Your members need 10 hours a month from their next payment on. With these hours you offer 4 hours.") && [alice, bob.person, carol.person, dave.person, erin.person].every((p) => cut.words.includes(p.name)) && cut.words.includes("Offer less time"), cut.words.slice(0, 500));
    check("and it names the open invitation that would be taken back", cut.words.includes(`1 open invitation no longer fits and is taken back: ${frank.name}.`));
    check("another host who opens that address is shown nothing of hers", !(await page(removal.location, otherHost)).words.includes(alice.name));
    const tooMany = await press(host, removal.location, "Save the new hours and these choices", Object.fromEntries([aliceId, bob.membershipId, carol.membershipId, dave.membershipId, erin.membershipId].map((id) => [`choice:${id}`, "keep"])));
    check("keeping everyone does not fit, so nothing is saved and she is told", tooMany.found && /need 10 hours a month/.test(noticeOf(tooMany)) && (await db.select().from(schema.weeklyHours).where(eq(schema.weeklyHours.id, monday.id))).length === 1, noticeOf(tooMany));
    const choices: Record<string, string> = {
      [`choice:${aliceId}`]: "keep",
      [`choice:${bob.membershipId}`]: "pause",
      [`choice:${carol.membershipId}`]: "less",
      [`minutes:${carol.membershipId}`]: "60",
      [`choice:${dave.membershipId}`]: "less",
      [`minutes:${dave.membershipId}`]: "60",
      [`choice:${erin.membershipId}`]: "pause",
    };
    const cutSaved = await press(host, removal.location, "Save the new hours and these choices", choices);
    check("with one kept, two offered an hour and two paused, the hours and the choices are saved together", cutSaved.found && cutSaved.location.startsWith("/host/calendar?") && (await db.select().from(schema.weeklyHours).where(eq(schema.weeklyHours.id, monday.id))).length === 0 && (await MS(carol.membershipId)).offeredMinutes === 60 && (await MS(bob.membershipId)).hostStoppedAt !== null && (await MS(aliceId)).hostStoppedAt === null, noticeOf(cutSaved));
    const again = await press(host, removal.location, "Save the new hours and these choices", choices, { drawn: cut.text });
    check("the same form sent a second time changes nothing more", (await MS(carol.membershipId)).offeredMinutes === 60 && !again.location.startsWith("/host/calendar?notice=Your%20hours%20were%20changed"), again.location);

    const frankGone = await page(frankOld, frank);
    check("the invitation that no longer fits was taken back: its link says so, and offers no \"Join\"", (await membershipOf(frank, host))?.status !== "invited" && frankGone.words.includes("This invitation is no longer open") && frankGone.words.includes("The host took it back.") && !formsOf(frankGone.text).some((f) => f.buttons.includes("Join")), `${frankGone.status} ${frankGone.words.slice(0, 200)}`);
    const offerMail = await emailTo(carol.person.email, "offers you less time");
    const carolOffer = (await MS(carol.membershipId)).offerId!;
    check("a member who was offered less time gets an email whose link opens the offer on her page", Boolean(offerMail?.link.startsWith(`/memberships/${carol.membershipId}?offer=${carolOffer}`)), offerMail?.link);
    const offerPage = await page(offerMail?.link ?? `/memberships/${carol.membershipId}`, carol.person);
    check("her page shows the offer with its numbers and both buttons", offerPage.words.includes("1 hour a month instead of 2 hours") && offerPage.words.includes("$24.00 a month instead of $48.00") && offerPage.words.includes("Accept 1 hour a month") && offerPage.words.includes("No thanks"), offerPage.words.match(/offers you less time[^.]*\.[^.]*\./)?.[0]);
    const accepted = await press(carol.person, `/memberships/${carol.membershipId}`, "Accept 1 hour a month");
    check("she accepts: from her next month she has 1 hour for $24.00, and nothing is charged today", accepted.found && (await MS(carol.membershipId)).ownMinutes === 60 && (await MS(carol.membershipId)).offerId === null && (await page(`/memberships/${carol.membershipId}`, carol.person)).words.includes("$24.00 for 1 hour") && (await monthsOf(carol.membershipId)).length === 1, noticeOf(accepted));
    check("the link of the answered offer now says it is no longer open", (await page(`/memberships/${carol.membershipId}?offer=${carolOffer}`, carol.person)).words.includes("is no longer open"));
    const daveDrawn = await page(`/memberships/${dave.membershipId}`, dave.person);
    const declined = await press(dave.person, `/memberships/${dave.membershipId}`, "No thanks");
    const davePage = await page(`/memberships/${dave.membershipId}`, dave.person);
    check("another says \"No thanks\": he keeps his month and is set to pause when it ends", declined.found && (await MS(dave.membershipId)).pausedReason === "offer" && davePage.words.includes("You said \"No thanks\" to the smaller time") && !davePage.words.includes("Keep my membership"), noticeOf(declined));
    const late = await press(dave.person, `/memberships/${dave.membershipId}`, /^Accept/, {}, { drawn: daveDrawn.text });
    check("his old \"Accept\" button no longer works", late.found && /no longer open/.test(noticeOf(late)) && (await MS(dave.membershipId)).ownMinutes === 120, noticeOf(late));
    const list = await page("/host", host);
    check("the host's list shows each of them as they stand, and gives her no \"Undo\" for the \"No thanks\"", list.words.includes("They said \"No thanks\" to the smaller time you offered. That stands") && list.words.includes("You chose \"Pause after this month\".") && formsOf(list.text).filter((f) => f.buttons.includes("Undo")).every((f) => !f.fields.some(([, value]) => value === dave.membershipId)));
    check("a member she paused is told on his page that only she can take it back", (await page(`/memberships/${bob.membershipId}`, bob.person)).words.includes(`${hostName} has paused your membership after this month.`));

    // ----------------------------------------------------------------------
    console.log("\n12. The host ends a membership");
    const forErin = (form: Form) => form.fields.some(([name, value]) => name === "membershipId" && value === erin.membershipId);
    const unsure = await press(host, "/host", "End membership", { sure: null }, { where: forErin });
    check("\"End membership\" without the tick ends nothing", unsure.found && (await MS(erin.membershipId)).status === "active", noticeOf(unsure));
    const ended = await press(host, "/host", "End membership", { sure: "1" }, { where: forErin });
    await helper();
    const erinPage = await page(`/memberships/${erin.membershipId}`, erin.person);
    check("with the tick it ends at once: her page says why, offers no way back, and shows that nothing was charged for the month that was only held", ended.found && (await MS(erin.membershipId)).status === "ended" && erinPage.words.includes("Ended: the host ended it") && !erinPage.words.includes("Resume membership") && !erinPage.words.includes("Keep my membership") && erinPage.words.includes("Nothing was charged"), noticeOf(ended));
    check("the ended member no longer reaches the joining page, and is no member on the host's page", (await page(`/h/${handle}/membership`, erin.person)).status === 404 && !(await page(`/h/${handle}`, erin.person)).words.includes("Your membership"));
    const asOther = await press(carol.person, "/host", "End membership", { sure: "1" }, { drawn: list.text, where: (form) => form.fields.some(([name, value]) => name === "membershipId" && value === aliceId) });
    check("a host's button posted by someone else is refused, and ends nobody's membership", asOther.found && asOther.status >= 300 && asOther.status < 400 && noticeOf(asOther) !== "" && !/has ended/.test(noticeOf(asOther)) && (await MS(aliceId)).status === "active", `${asOther.found} ${asOther.status} ${noticeOf(asOther)}`);

    // Pretended: Carol's month ended a minute ago, and the helper has not been by yet to start the next one.
    await db.update(months).set({ endsAt: new Date(Date.now() - MIN) }).where(eq(months.id, carol.monthId));
    const between = await page(`/memberships/${carol.membershipId}`, carol.person);
    check("in the moment between a month's end and the next one, her page says so and still offers to cancel", between.words.includes("Your month has ended.") && between.words.includes("Your next month is being started.") && formsOf(between.text).some((f) => f.buttons.includes("Cancel membership")), between.words.slice(0, 300));
    const lastMoment = await press(carol.person, `/memberships/${carol.membershipId}`, "Cancel membership");
    check("cancelling in that moment stops the next month: the page then says she is being paused, and no new month is charged", lastMoment.found && (await MS(carol.membershipId)).memberStoppedAt !== null && (await page(`/memberships/${carol.membershipId}`, carol.person)).words.includes("Your membership is being paused, and no new month is charged."), noticeOf(lastMoment));

    // ----------------------------------------------------------------------
    console.log("\n13. The founder's page");
    const accounts = existsSync("test-accounts.local.md") ? readFileSync("test-accounts.local.md", "utf8").split("\n") : [];
    const adminSecret = accounts.find((l) => l.startsWith("admin TOTP secret:"))?.replace("admin TOTP secret:", "").trim();
    const adminPassword = accounts.find((l) => l.includes("admin@test.local"))?.split("|").map((c) => c.trim())[3];
    const admin: Person = { id: "", name: "admin", email: "admin@test.local", jar: new Map() };
    if (adminSecret && adminPassword) {
      await send("/api/auth/sign-in/email", { json: { email: "admin@test.local", password: adminPassword }, jar: admin.jar });
      await send("/api/auth/two-factor/verify-totp", { json: { code: totpCode(adminSecret), trustDevice: false }, jar: admin.jar });
    }
    check("the founder's page is \"not found\" for a host and for a member", (await page("/admin/memberships", host)).status === 404 && (await page("/admin/memberships", alice)).status === 404);
    const founder = await page("/admin/memberships", admin);
    if (founder.status !== 200) {
      console.log("   SKIPPED the founder's own view: the test admin's login is not set up (npx tsx scripts/secure-test-admin.ts).");
    } else {
      check("the founder sees every membership of this journey with where it stands, and each month's six places", [alice, bob.person, carol.person, dave.person, erin.person].every((p) => founder.words.includes(`${p.name} with ${host.name}`)) && founder.words.includes("Ended: the host ended it.") && founder.words.includes("Set aside") && founder.words.includes("The host paused it after this month.") && !founder.words.includes("THE PLACES DO NOT ADD UP"), founder.words.slice(0, 400));
      check("the page has nothing to press: it only shows", formsOf(founder.text).every((f) => f.buttons.every((b) => /log out/i.test(b))), JSON.stringify(formsOf(founder.text).map((f) => f.buttons)));
      await send("/api/auth/sign-out", { json: {}, jar: admin.jar });
    }

    // ----------------------------------------------------------------------
    console.log("\n14. The founder's switch is turned off while months are running");
    const moreHours = await press(host, "/host/calendar", "Add hours", { weekday: "3", from: "09:00", to: "12:00" });
    const invitedAgain = await press(host, "/contacts", `Invite ${frank.name} to your membership`);
    const frankLink = `/h/${handle}/membership?invite=${(await membershipOf(frank, host))?.inviteId}`;
    const frankDrawn = await page(frankLink, frank);
    check("with hours added again, the person whose invitation was taken back is invited anew while memberships are still open", moreHours.found && invitedAgain.found && frankLink !== frankOld && frankDrawn.status === 200 && formsOf(frankDrawn.text).some((f) => f.buttons.includes("Join")), `${noticeOf(moreHours)} / ${noticeOf(invitedAgain)}`);
    const oldLink = await page(frankOld, frank);
    check("the old link still says it is no longer open, and never opens the newer invitation", oldLink.words.includes("This invitation is no longer open") && !formsOf(oldLink.text).some((f) => f.buttons.includes("Join")));
    await setSwitches({ memberships: "off", membershipsHosts: [] });
    const offHost = await page("/host", host);
    check("the host still sees her members and can look after them, and is told nothing new can start", offHost.words.includes("Memberships are not open at the moment.") && offHost.words.includes(alice.name) && formsOf(offHost.text).some((f) => f.buttons.includes("End membership")) && offHost.words.includes("It does not renew while memberships are not open."));
    check("she can no longer invite: no person has an \"Invite\" button", !formsOf((await page("/contacts", host)).text).some((f) => f.buttons.some((b) => b.startsWith("Invite "))));
    const frankJoin = await press(frank, frankLink, "Join", { agreed: "on" }, { drawn: frankDrawn.text });
    check("the invited person can no longer join: nothing starts and nothing is charged", frankJoin.found && (await membershipOf(frank, host)).status === "invited" && (await monthsOf((await membershipOf(frank, host)).id)).length === 0, noticeOf(frankJoin));
    const offAlice = await page(`/memberships/${aliceId}`, alice);
    check("a member's running month goes on: her time is there, and the page promises no renewal", offAlice.words.includes("2 hours left this month") && offAlice.words.includes("Memberships are not being renewed at the moment.") && (await memberBookingView(alice.id, host.id, new Date())) !== null);
    const aliceMonth3 = (await monthsOf(aliceId))[2];
    await C.takeNow(aliceMonth3.id, new Date());
    await closeMonth(aliceMonth3.id, (await M(aliceMonth3.id)).endsAt!);
    check("when that month ends nothing renews: she is paused, and no new month is charged", (await MS(aliceId)).status === "paused" && (await monthsOf(aliceId)).filter((m) => m.status === "held" || m.status === "to_pay").length === 0, (await MS(aliceId)).status);
    const resumeOff = await page(`/h/${handle}/membership`, alice);
    check("and she cannot resume while memberships are off: the page says so and has no button", resumeOff.words.includes("is not offering a membership at the moment") && !formsOf(resumeOff.text).some((f) => f.buttons.includes("Resume membership")));
  } finally {
    await setSwitches({ memberships: "off", membershipsHosts: [] });
    await wipe();
    await db.delete(schema.rateLimit);
  }

  const [left] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.user).where(like(schema.user.email, "mjourney-%"));
  check("the script's own test data was cleaned up, and the founder's switch is off again", left.n === 0 && (await (await import("../src/lib/safety/switches")).switches()).memberships === "off", `${left.n} people left`);
  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
