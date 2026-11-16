/**
 * Testing tool: the whole app as one journey, across every module, and then a walk over every page.
 *
 * Part 1, one story from start to finish. A new host signs up, sets up and is approved; a visitor
 * finds them, picks a time, creates an account and lands back on that time; asks, is accepted, the
 * call happens, both rate, each appears in the other's contacts. Then the same customer books a
 * paid call with host@test.local (whose payout account is ready in the Stripe sandbox): card saved,
 * money held, call charged, the host's share collected by the host.
 *
 * Part 2, every page: as a visitor, a customer, a host and the founder, each page loads (or sends
 * the person where it should), has the top bar and its own tab title, and every link on it leads
 * somewhere.
 *
 * What is real and what is pretended:
 *   real       sign-up, the confirmation email and its link, every page (fetched from the running
 *              app with that person's login), asking, accepting, the card and the hold and the
 *              charge (Stripe sandbox), ratings, contacts, the emails written.
 *   pretended  the two tick boxes of the welcome step and the ID check (written straight to the
 *              database, as the other check scripts do); the founder's approval (the same function
 *              the admin page calls); who was connected and when (attendance messages added by
 *              hand); and the waiting: once a call is agreed it is moved into the past, so that
 *              the pages, which use the real clock, show it as over.
 *
 * It needs the app running (npm run dev). Stop the always-on helper first. The paid part needs the
 * Stripe test key and payouts set up for host@test.local, and is skipped with a note otherwise; the
 * founder's pages need `npx tsx scripts/secure-test-admin.ts`, and are skipped with a note otherwise.
 *
 * What it touches besides its own rows, all of it on this computer's test database only:
 *   - It clears the local "too many attempts" counters at the start and the end (as the accounts
 *     check does), because every request here comes from one network address.
 *   - The paid part books a time with host@test.local. It is skipped while that host has requests
 *     waiting, so that accepting this one cannot end somebody else's.
 *   - Charging the finished call runs the same step the always-on helper runs, with the real
 *     clock, so any other call in the database that is already over and unpaid is settled too.
 * It removes its requests and emails and hides its host; the people, calls and payments stay as
 * test data, like the other scripts leave them.
 *
 * Usage: npx tsx scripts/journey-check.ts
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { and, desc, eq, inArray, isNull, like, or } from "drizzle-orm";
import { TERMS_VERSION } from "../src/lib/terms";
import { requireLocalDatabase } from "./local-only";
import { totpCode } from "./totp";

const BASE = "http://localhost:3000";
const RUN = randomUUID().slice(0, 8);
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}

type Jar = Map<string, string>;
type Reply = { status: number; json: Record<string, unknown> | null; text: string; location: string | null };

/** One request to the app, the way a browser would send it. Cookies are kept in the jar. Redirects are not followed. */
async function send(path: string, options: { body?: unknown; jar?: Jar } = {}): Promise<Reply> {
  const headers: Record<string, string> = { origin: BASE };
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (options.jar?.size) headers.cookie = [...options.jar].map(([k, v]) => `${k}=${v}`).join("; ");
  const response = await fetch(path.startsWith("http") ? path : `${BASE}${path}`, {
    method: options.body !== undefined ? "POST" : "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    redirect: "manual",
  });
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
  return { status: response.status, json, text, location: response.headers.get("location") };
}

const api = (path: string, body: unknown, jar?: Jar) => send(`/api/auth${path}`, { body, jar });
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const unescape = (text: string) => text.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
/** What a person reads on a page: the text, without the markup. */
const words = (html: string) => unescape(html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ");
/** Where the ordinary links on a page lead. */
const linksOf = (html: string) => [...html.matchAll(/<a\b[^>]*?\bhref="([^"]+)"/g)].map((m) => unescape(m[1]));
/** Which top bar a page has: "member", "visitor", "bare" (the sign-up steps) or "none". */
const barOf = (html: string) => html.match(/data-site-header="(\w+)"/)?.[1] ?? "none";
const titleOf = (html: string) => unescape(html.match(/<title>([^<]*)<\/title>/)?.[1] ?? "");
/** The path a redirect leads to, whether it was sent as a full address or not. */
const pathOf = (location: string | null) => (location ? location.replace(BASE, "") : "");

async function main() {
  requireLocalDatabase();
  const { db, schema } = await import("../src/db");
  const B = await import("../src/lib/booking/bookings");
  const calendar = await import("../src/lib/booking/calendar");
  const profiles = await import("../src/lib/profiles/profiles");
  const { rateCall } = await import("../src/lib/ratings/ratings");
  const { contactsOf } = await import("../src/lib/people/contacts");

  const up = await send("/login").catch(() => null);
  if (!up || up.status !== 200) throw new Error("The app is not running. Start it with `npm run dev` first.");
  // Attempt limits are per network address, and every request here comes from the same one.
  await db.delete(schema.rateLimit);

  const address = (name: string) => `journey-${RUN}-${name}@example.test`;
  const made: string[] = [];

  /** The newest email to an address whose subject contains some words. Emails are written in the background, so wait a little. */
  async function emailTo(to: string, subject: string, tries = 25) {
    for (let i = 0; i < tries; i++) {
      const found = await db.select().from(schema.emailOutbox).where(and(eq(schema.emailOutbox.to, to), like(schema.emailOutbox.subject, `%${subject}%`))).orderBy(desc(schema.emailOutbox.createdAt));
      if (found.length > 0) return { body: found[0].body, link: found[0].body.match(/https?:\/\/\S+/)?.[0] ?? "", count: found.length };
      await pause(200);
    }
    return null;
  }

  /** Signs up the way the form does and opens the link in the confirmation email. `next` is the page the person was heading for. */
  async function signUp(name: string, next?: string) {
    const person = { name: `Journey ${name}`, email: address(name), password: randomBytes(12).toString("base64url"), jar: new Map() as Jar };
    await api("/sign-up/email", { name: person.name, email: person.email, password: person.password, callbackURL: next ? `/welcome?next=${encodeURIComponent(next)}` : "/welcome" });
    const mail = await emailTo(person.email, "Confirm your email");
    if (!mail) throw new Error(`No confirmation email for ${person.email}`);
    const landed = await send(mail.link, { jar: person.jar });
    const [row] = await db.select().from(schema.user).where(eq(schema.user.email, person.email));
    made.push(row.id);
    return { ...person, id: row.id, landedOn: pathOf(landed.location) };
  }
  /** Pretended: the two tick boxes and the time zone of the welcome step. */
  const tickWelcome = (userId: string) => {
    const now = new Date();
    return db.update(schema.user).set({ adultConfirmedAt: now, termsAcceptedAt: now, termsVersion: TERMS_VERSION, timeZone: "America/New_York" }).where(eq(schema.user.id, userId));
  };
  /** Pretended: a passed ID check for an adult. */
  const passIdCheck = (p: { id: string; name: string }) =>
    db.insert(schema.identityChecks).values({ userId: p.id, stripeSessionId: `vs_journey_${randomUUID()}`, status: "verified", adult: true, verifiedName: `${p.name} Legalname`, checkedAt: new Date() });
  const page = async (path: string, jar?: Jar) => {
    const reply = await send(path, { jar });
    return { ...reply, words: words(reply.text) };
  };
  const bookPath = (handle: string, slot: Date, length: number) => `/h/${handle}/book?length=${length}&start=${encodeURIComponent(slot.toISOString())}`;
  const ask = async (customer: { id: string; name: string; email: string }, hostId: string, startsAt: Date, lengthMinutes: number, note: string) => {
    const offer = await B.offerOf(hostId);
    return B.askForCall({ customer, hostId, startsAt, lengthMinutes, note, requestKey: randomUUID(), agreedToCardTerms: true, seen: { pricePer15Cents: offer?.pricePer15Cents ?? -1, freeCancelMinutes: offer?.freeCancelMinutes ?? -1 }, now: new Date() });
  };
  /** Pretended: the waiting. An agreed call is moved so that it ended 20 minutes ago, and both people were in it the whole time. */
  async function happenedAlready(callId: string, bookingId: string, minutes: number) {
    const endsAt = new Date(Math.floor((Date.now() - 20 * MINUTE) / 1000) * 1000);
    const startsAt = new Date(endsAt.getTime() - minutes * MINUTE);
    await db.delete(schema.busyEntries).where(eq(schema.busyEntries.bookingId, bookingId));
    await db.update(schema.bookings).set({ startsAt, endsAt }).where(eq(schema.bookings.id, bookingId));
    // A payment is charged for the stretch of the call it covers, so that stretch moves with the call.
    await db.update(schema.payments).set({ coversFrom: startsAt, coversUntil: endsAt }).where(eq(schema.payments.callId, callId));
    const [call] = await db.update(schema.calls).set({ startsAt, endsAt, closedAt: new Date(endsAt.getTime() + MINUTE) }).where(eq(schema.calls.id, callId)).returning();
    for (const identity of [call.hostId, call.customerId]) {
      const row = (type: string, providerTime: Date) => ({ provider: "livekit", providerEventId: `EV_${randomUUID()}`, callId, type, roomSessionId: `RM_journey_${RUN}`, participantIdentity: identity, participantSessionId: `PA_${identity.slice(-6)}_${randomUUID().slice(0, 6)}`, providerTime, payload: "{}" });
      const session = row("participant_joined", startsAt);
      await db.insert(schema.attendanceEvents).values([session, { ...row("participant_left", endsAt), participantSessionId: session.participantSessionId }]);
    }
    return call;
  }

  let freeBookingId = "";
  let freeCallId = "";
  let handle = "";
  let hostJar: Jar = new Map();
  let customerJar: Jar = new Map();

  try {
    // ----------------------------------------------------------------------
    console.log("\n1. A new host signs up and gets ready");
    const host = await signUp("host");
    hostJar = host.jar;
    check("the link in the confirmation email leads to the welcome step", host.landedOn === "/welcome", host.landedOn);
    await tickWelcome(host.id);
    handle = `jrn_${RUN}`;
    {
      const start = await page("/host", host.jar);
      check("the Hosting page opens with a \"Getting started\" list", start.status === 200 && start.words.includes("Getting started") && start.words.includes("1. Fill in your profile and send it for approval."), String(start.status));
      await profiles.createHostProfile(host.id, { handle, displayName: `Jo Journey ${RUN}`, about: "Here to talk.", pricePer15Cents: 0, usConfirmed: true });
      const sent = await page("/host", host.jar);
      check("with the profile sent, the list says the ID check comes before approval", sent.words.includes("We look at your profile once you have confirmed who you are (step 2)."));
      check("a free host is not asked to set up payouts", !sent.words.includes("Set up payouts, so you can be paid for calls."));
      check("the page is not public yet", (await page(`/h/${handle}`)).status === 404);

      await passIdCheck(host);
      check("with the ID confirmed, the list says the profile is being looked at", (await page("/host", host.jar)).words.includes("We look at every profile ourselves. You will get an email with the answer."));

      const [admin] = await db.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.email, "admin@test.local"));
      const approve = () => profiles.decideProfile({ userId: host.id, decision: "approved", by: admin?.id ?? host.id, seen: { displayName: `Jo Journey ${RUN}`, about: "Here to talk." } });
      await approve();
      await approve(); // the founder presses the button twice
      const mail = await emailTo(host.email, "Your Connect page is approved");
      check("approving sends the host one email, with the address of their page", mail?.count === 1 && mail.body.includes(`/h/${handle}`), String(mail?.count));

      const approved = await page("/host", host.jar);
      check("the list now has one step left: the calendar", approved.words.includes("Getting started") && approved.words.includes("Set up your calendar: your time zone, the call lengths you offer, and your hours. Your calendar"));
      const noHours = await page(`/h/${handle}`);
      check("the page is public, and says the host is not taking calls yet", noHours.status === 200 && noHours.words.includes("is not taking calls at the moment."), String(noHours.status));
      check("a visitor sees the top bar with the ways in", barOf(noHours.text) === "visitor" && linksOf(noHours.text).includes("/signup") && linksOf(noHours.text).includes("/login"));

      await calendar.calendarOf(host.id, "America/New_York");
      await calendar.saveCalendarChoices(host.id, { timeZone: "America/New_York", lengths: [15, 30], noticeHours: 24, horizonWeeks: 2, breakMinutes: 5 });
      for (const weekday of [1, 2, 3, 4, 5, 6, 7]) await calendar.addWeeklyHours(host.id, { weekday, from: "00:00", to: "00:00" });
      const ready = await page("/host", host.jar);
      check("with hours set, the list is gone and the page gives the public address", !ready.words.includes("Getting started") && ready.words.includes(`Your page is public: /h/${handle}`));
    }

    // ----------------------------------------------------------------------
    console.log("\n2. A visitor finds the host, picks a time, creates an account and lands back on that time");
    const offer = (await B.offerOf(host.id))!;
    const slot = (await B.openTimes(offer, 15, new Date()))[3];
    const chosen = bookPath(handle, slot, 15);
    {
      const front = await page("/");
      check("the front address explains Connect to a visitor", front.status === 200 && front.words.includes("A private video call, one to one") && barOf(front.text) === "visitor", String(front.status));
      const found = await page(`/search?q=${encodeURIComponent(`Jo Journey ${RUN}`)}`);
      check("search finds the new host", found.status === 200 && linksOf(found.text).includes(`/h/${handle}`));

      const stopped = await send(chosen);
      const login = pathOf(stopped.location);
      check("picking a time while logged out leads to login, carrying the time", login === `/login?next=${encodeURIComponent(chosen)}`, login);
      const loginPage = await page(login);
      check("the login page's \"Create an account\" link carries the time too", linksOf(loginPage.text).includes(`/signup?next=${encodeURIComponent(chosen)}`), linksOf(loginPage.text).filter((l) => l.startsWith("/signup")).join(" "));
      const signupPage = await page(`/signup?next=${encodeURIComponent(chosen)}`);
      check("and the sign-up page's \"Log in\" link carries it back", linksOf(signupPage.text).includes(`/login?next=${encodeURIComponent(chosen)}`));
      check("a sign-up page told to go to another site afterwards drops that", linksOf((await page("/signup?next=https%3A%2F%2Fevil.example%2Fx")).text).includes("/login"));
    }
    const customer = await signUp("customer", chosen);
    customerJar = customer.jar;
    {
      check("the link in the confirmation email leads to the welcome step, still carrying the time", customer.landedOn === `/welcome?next=${encodeURIComponent(chosen)}`, customer.landedOn);
      const welcome = await page(customer.landedOn, customer.jar);
      const carried = unescape(welcome.text.match(/name="next" value="([^"]*)"/)?.[1] ?? "");
      check("the welcome step keeps it in its form", welcome.status === 200 && carried === chosen, carried);
      check("the sign-up steps show only the site's name, not the full bar", barOf(welcome.text) === "bare");
      await tickWelcome(customer.id);
      const onward = await send(customer.landedOn, { jar: customer.jar });
      check("after the welcome step the new customer is back on the time they picked", pathOf(onward.location) === chosen, pathOf(onward.location));

      const idFirst = await page(chosen, customer.jar);
      check("a free call asks for the ID check first, with a way there and back", idFirst.status === 200 && idFirst.words.includes("One thing first") && linksOf(idFirst.text).includes(`/identity?next=${encodeURIComponent(chosen)}`), String(idFirst.status));
      check("that screen is no dead end: it has the top bar", barOf(idFirst.text) === "member");
      await passIdCheck(customer);
      const form = await page(chosen, customer.jar);
      check("with the ID confirmed, the same address shows the request form", form.status === 200 && /name="note"/.test(form.text) && form.words.includes(`Jo Journey ${RUN}`), String(form.status));
    }

    // ----------------------------------------------------------------------
    console.log("\n3. The request, the answer, the call, the ratings, the contacts");
    {
      const { booking } = await ask(customer, host.id, slot, 15, `Hello from run ${RUN}`);
      freeBookingId = booking.id;
      check("the request is waiting for the host", booking.stage === "waiting");
      const hostHome = await page("/", host.jar);
      check("the host's home page says a request is waiting", hostHome.words.includes("1 request for a call waiting for your answer."));
      const requests = await page("/host/requests", host.jar);
      check("the host sees who asks, and the note that came with the request", requests.words.includes(customer.name) && requests.words.includes(`Hello from run ${RUN}`));
      check("the customer got the \"request sent\" email", (await emailTo(customer.email, "was sent", 5)) !== null);

      const { callId } = await B.accept({ bookingId: booking.id, hostId: host.id, now: new Date() });
      freeCallId = callId;
      check("the customer got the \"accepted\" email, with a link to the request", ((await emailTo(customer.email, "accepted your request", 5))?.body ?? "").includes(`/bookings/${booking.id}`));
      const customerHome = await page("/", customer.jar);
      check("the call is on the customer's home page, under the host's display name", customerHome.words.includes(`Jo Journey ${RUN}`) && customerHome.words.includes("Not open yet"));

      await happenedAlready(callId, booking.id, 15);
      const results = await page(`/calls/${callId}/results`, customer.jar);
      check("after the call, the customer's results page offers to rate it", results.status === 200 && results.words.includes(`How was your call with Jo Journey ${RUN}?`) && results.words.includes("This was a free call."), String(results.status));
      check("and to book the same host again", linksOf(results.text).includes(`/h/${handle}`) && results.words.includes(`Book another call with Jo Journey ${RUN}`));
      check("the raw record from the video service is not shown to the two people", !results.words.includes("Messages received from the video service") && !results.words.includes("Room confirmed closed") && !results.text.includes("PA_"));
      const hostResults = await page(`/calls/${callId}/results`, host.jar);
      check("the host's results page offers to rate, and has no \"book again\"", hostResults.words.includes(`How was your call with ${customer.name}?`) && !hostResults.words.includes("Book another call"));
      check("the home page reminds the customer to rate", (await page("/", customer.jar)).words.includes("Waiting for your rating"));

      await rateCall({ callId, raterId: customer.id, stars: 5, now: new Date() });
      await rateCall({ callId, raterId: host.id, stars: 4, now: new Date() });
      check("once rated, the results page says what was given and the reminder is gone", (await page(`/calls/${callId}/results`, customer.jar)).words.includes(`You gave Jo Journey ${RUN} 5 stars.`) && !(await page("/", customer.jar)).words.includes("Waiting for your rating"));
      const { block, unblock } = await import("../src/lib/safety/blocks");
      await block({ blockerId: host.id, blockedId: customer.id, now: new Date() });
      check("if the host blocks the customer, the customer is no longer invited to book again", !(await page(`/calls/${callId}/results`, customer.jar)).words.includes("Book another call"));
      await unblock(host.id, customer.id);
      await db.update(schema.hostProfiles).set({ hidden: true }).where(eq(schema.hostProfiles.userId, host.id));
      check("nor while the host has hidden their page", !(await page(`/calls/${callId}/results`, customer.jar)).words.includes("Book another call"));
      await db.update(schema.hostProfiles).set({ hidden: false }).where(eq(schema.hostProfiles.userId, host.id));
      const customerContacts = await page("/contacts", customer.jar);
      const hostContacts = await page("/contacts", host.jar);
      check("each is now in the other's \"People you have talked to\"", customerContacts.words.includes(`Jo Journey ${RUN}`) && hostContacts.words.includes(customer.name));
    }

    // ----------------------------------------------------------------------
    console.log("\n4. The same customer books a paid call: card, hold, charge, and the host collects");
    const [hana] = await db.select().from(schema.user).where(eq(schema.user.email, "host@test.local"));
    const hanaOffer = hana ? await B.offerOf(hana.id) : null;
    if (!process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_") || !hana || !hanaOffer || hanaOffer.pricePer15Cents === 0 || !hanaOffer.canTakePaid) {
      console.log("   SKIPPED: this part needs the Stripe test key, and host@test.local approved, charging for calls, with hours and payouts set up.");
    } else if ((await B.waitingForHost(hana.id)).length > 0) {
      console.log("   SKIPPED: host@test.local has requests waiting for an answer. Answer them first, so that accepting this run's request cannot end one of them.");
    } else paid: {
      const { stripe } = await import("../src/lib/payments/stripe");
      const { tryHoldOnce } = await import("../src/lib/booking/jobs");
      const { settleFinishedCalls } = await import("../src/lib/payments/jobs");
      const price = hanaOffer.pricePer15Cents;
      const dollars = `$${(price / 100).toFixed(2)}`;
      const far = (await B.openTimes(hanaOffer, 15, new Date())).filter((t) => t.getTime() > Date.now() + 96 * HOUR);
      const paidSlot: Date | undefined = far[Math.floor(Math.random() * Math.min(far.length, 150))];
      if (!paidSlot) {
        console.log("   SKIPPED: host@test.local has no open 15-minute time more than 4 days ahead.");
        break paid;
      }
      const summary = await page(bookPath(hanaOffer.handle, paidSlot, 15), customer.jar);
      check("the summary page shows the price before anything is asked", summary.status === 200 && summary.words.includes(dollars), String(summary.status));

      const { booking, clientSecret } = await ask(customer, hana.id, paidSlot, 15, "A paid call");
      check("a paid request first needs a card", booking.stage === "card" && Boolean(clientSecret));
      check("the request's own page shows the card step", (await page(`/bookings/${booking.id}`, customer.jar)).status === 200);
      await stripe().setupIntents.confirm(booking.stripeSetupIntentId!, { payment_method: "pm_card_visa", return_url: "https://example.com/return" });
      const sent = await B.finishCardStep({ bookingId: booking.id, customerId: customer.id, now: new Date() });
      check("with the card saved, the request goes to the host", sent.stage === "waiting");

      const { callId } = await B.accept({ bookingId: booking.id, hostId: hana.id, now: new Date() });
      const ownPayment = async () => (await db.select().from(schema.payments).where(and(eq(schema.payments.callId, callId), isNull(schema.payments.extensionId))))[0];
      check("accepting makes the call, with its payment waiting", (await ownPayment()).status === "awaiting_payment" && (await ownPayment()).bookedCents === price);
      const [accepted] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, booking.id));
      const [call] = await db.select().from(schema.calls).where(eq(schema.calls.id, callId));
      // Pretended: it is now 2 days before the call, when the saved card is tried.
      const held = await tryHoldOnce({ booking: accepted, call, payment: await ownPayment() }, new Date(paidSlot.getTime() - 47 * HOUR));
      check("2 days before the call, the price is held on the saved card", held === "held" && (await ownPayment()).status === "held", held);

      await happenedAlready(callId, booking.id, 15);
      await settleFinishedCalls(new Date());
      // The call was moved into the past above, so its end is read back rather than worked out from the chosen time.
      const [ended] = await db.select({ endsAt: schema.calls.endsAt }).from(schema.calls).where(eq(schema.calls.id, callId));
      const waiting = await page(`/calls/${callId}/results`, customer.jar);
      check("after the call nothing is taken yet: the customer sees what will be charged, and can ask for a refund", (await ownPayment()).status === "held" && waiting.words.includes("To be charged") && waiting.words.includes(dollars) && waiting.words.includes("Ask for a refund"), (await ownPayment()).status);
      // Pretended: it is now 24 hours and 10 minutes after the call, and nobody asked for a refund.
      await settleFinishedCalls(new Date(ended.endsAt.getTime() + 24 * HOUR + 10 * 60_000));
      const charged = await ownPayment();
      check(`a day after the call, the customer is charged the ${dollars} for the 15 minutes both were there`, charged.status === "charged" && charged.chargedCents === price, `${charged.status} ${charged.chargedCents}`);
      check("nobody asked for a refund, so the host's share is ready to collect 24 hours after the call; nothing was sent before", charged.transferStatus === "not_due" && charged.transferDueAt?.getTime() === ended.endsAt.getTime() + 24 * HOUR && (await stripe().transfers.list({ transfer_group: callId, limit: 5 })).data.length === 0, `${charged.transferStatus} ${charged.transferDueAt?.toISOString()}`);
      // Pretended: it is now a day after the call, and the host presses "Collect earnings".
      const { collectEarnings } = await import("../src/lib/payments/collect");
      const { reconcileOperations } = await import("../src/lib/payments/jobs");
      const collectionId = randomUUID();
      await collectEarnings({ collectionId, hostId: hana.id, startedBy: hana.id, now: charged.transferDueAt! });
      // The test host may have many older shares waiting too; the helper finishes whatever one press did not get to.
      await reconcileOperations(new Date(Date.now() + 5 * 60_000));
      const collected = await ownPayment();
      check("the host collects: the share is sent to their Stripe payout account", collected.transferStatus === "sent" && (collected.transferCents ?? 0) + (collected.payoutFeeCents ?? 0) === charged.originalHostShareCents && (await stripe().transfers.list({ transfer_group: callId, limit: 5 })).data.length === 1, collected.transferStatus);
      // That press was at a pretend time, days ahead. Move it into the past, so the test host can collect in the app today.
      await db.update(schema.collections).set({ acceptedAt: new Date(Date.now() - 48 * HOUR) }).where(eq(schema.collections.id, collectionId));
      const receipt = await page(`/calls/${callId}/results`, customer.jar);
      check("the customer's results page shows the charge, and offers to book again", receipt.status === 200 && receipt.words.includes(dollars) && linksOf(receipt.text).includes(`/h/${hanaOffer.handle}`), String(receipt.status));
      await rateCall({ callId, raterId: customer.id, stars: 5, now: new Date() });
      check("the paid host's customer list now has this customer", (await contactsOf(hana.id, new Date())).some((c) => c.userId === customer.id));
    }

    // ----------------------------------------------------------------------
    console.log("\n5. Every page, for each kind of person");
    const BARE = ["/login", "/signup", "/forgot-password", "/check-email", "/reset-password"];
    /** Opens each page and checks its answer, its top bar and its tab title; then opens every link found on those pages once. */
    async function walk(who: string, jar: Jar | undefined, pages: Array<[string, number | string]>) {
      const wrong: string[] = [];
      const linked = new Map<string, string>();
      for (const [path, expected] of pages) {
        const reply = await send(path, { jar });
        if (typeof expected === "string") {
          if (!(reply.status >= 300 && reply.status < 400) || pathOf(reply.location) !== expected) wrong.push(`${path}: expected to be sent to ${expected}, got ${reply.status} ${pathOf(reply.location)}`);
          continue;
        }
        if (reply.status !== expected) {
          wrong.push(`${path}: ${reply.status}, expected ${expected}`);
          continue;
        }
        if (expected !== 200) continue;
        const bare = BARE.some((b) => path.startsWith(b));
        const wantBar = /^\/calls\/[^/]+$/.test(path) ? "none" : bare ? "bare" : jar ? "member" : "visitor";
        if (barOf(reply.text) !== wantBar) wrong.push(`${path}: top bar "${barOf(reply.text)}", expected "${wantBar}"`);
        const title = titleOf(reply.text);
        if (path === "/" ? title !== "Connect" : !/^.+ — Connect$/.test(title)) wrong.push(`${path}: tab title "${title}"`);
        for (const href of linksOf(reply.text)) {
          if (!href.startsWith("/") || href.startsWith("//") || href.startsWith("/api/")) continue;
          const key = href.split(/[?#]/)[0];
          if (!linked.has(key)) linked.set(key, href);
        }
      }
      check(`${who}: each of ${pages.length} pages answers as it should, with the right top bar and its own tab title`, wrong.length === 0, wrong.join("; "));
      const broken: string[] = [];
      for (const href of linked.values()) {
        // Follow where the link really ends up: a link that only ever sends the person on, or to a page that is not there, is broken.
        let at = href;
        let reply = await send(at, { jar });
        for (let hops = 0; hops < 5 && reply.status >= 300 && reply.status < 400; hops++) {
          at = pathOf(reply.location);
          if (!at.startsWith("/")) break; // off to another site (Stripe, Google): not ours to open
          reply = await send(at, { jar });
        }
        if (reply.status !== 200 && at.startsWith("/")) broken.push(`${href} → ${at} ${reply.status}`);
      }
      check(`${who}: every link on those pages (${linked.size}) leads somewhere`, broken.length === 0, broken.join("; "));
    }

    await walk("a visitor", undefined, [
      ["/", 200], ["/search", 200], [`/search?q=Jo+Journey+${RUN}`, 200], [`/h/${handle}`, 200], ["/login", 200], ["/signup", 200], ["/forgot-password", 200], ["/check-email", 200],
      ["/rules", 200], ["/terms", 200], ["/privacy", 200], ["/unsubscribe", 200], ["/reset-password", 200], ["/h/nobody_here_at_all", 404],
      [`/h/${handle}/now?length=15`, `/login?next=${encodeURIComponent(`/h/${handle}/now?length=15`)}`], ["/admin/secure", "/login"],
      ["/account", "/login?next=%2Faccount"], ["/contacts", "/login?next=%2Fcontacts"], ["/host", "/login?next=%2Fhost"], ["/host/requests", "/login?next=%2Fhost%2Frequests"],
      [`/bookings/${freeBookingId}`, `/login?next=${encodeURIComponent(`/bookings/${freeBookingId}`)}`], [`/calls/${freeCallId}`, `/login?next=${encodeURIComponent(`/calls/${freeCallId}`)}`],
      [`/calls/${freeCallId}/results`, `/login?next=${encodeURIComponent(`/calls/${freeCallId}/results`)}`], ["/admin", "/login"], ["/identity", "/login"],
    ]);
    const signedIn = (jar: Jar): [string, Jar, Array<[string, number | string]>] => [
      "",
      jar,
      [
        ["/", 200], ["/account", 200], ["/contacts", 200], ["/search", 200], ["/host", 200], ["/host/calendar", 200], ["/host/requests", 200], ["/host/now", 200], ["/identity", 200],
        [`/bookings/${freeBookingId}`, 200], [`/calls/${freeCallId}`, 200], [`/calls/${freeCallId}/results`, 200], [`/report?call=${freeCallId}`, 200], [`/h/${handle}`, 200],
        ["/rules", 200], ["/terms", 200], ["/privacy", 200], ["/unsubscribe", 200], ["/paused", "/"], ["/login", "/"], ["/signup", "/"], ["/welcome", "/"],
        [`/h/${handle}/now?length=15`, 200], ["/admin", 404], ["/admin/people", 404], ["/admin/reports", 404], ["/admin/outbox", 404], ["/admin/secure", 404], ["/calls/new", 404], [`/bookings/${randomUUID()}`, 404],
      ],
    ];
    await walk("the customer", ...(signedIn(customerJar).slice(1) as [Jar, Array<[string, number | string]>]));
    await walk("the host", ...(signedIn(hostJar).slice(1) as [Jar, Array<[string, number | string]>]));

    const accounts = existsSync("test-accounts.local.md") ? readFileSync("test-accounts.local.md", "utf8").split("\n") : [];
    const adminSecret = accounts.find((l) => l.startsWith("admin TOTP secret:"))?.replace("admin TOTP secret:", "").trim();
    const adminPassword = accounts.find((l) => l.includes("admin@test.local"))?.split("|").map((c) => c.trim())[3];
    const adminJar: Jar = new Map();
    if (adminSecret && adminPassword) {
      await api("/sign-in/email", { email: "admin@test.local", password: adminPassword }, adminJar);
      await api("/two-factor/verify-totp", { code: totpCode(adminSecret), trustDevice: false }, adminJar);
    }
    if ((await send("/admin", { jar: adminJar })).status !== 200) {
      console.log("   SKIPPED the founder's pages: the test admin's login is not set up (npx tsx scripts/secure-test-admin.ts).");
    } else {
      await walk("the founder", adminJar, [["/", 200], ["/admin", 200], ["/admin/people", 200], ["/admin/reports", 200], ["/admin/outbox", 200], ["/admin/secure", "/admin"], [`/calls/${freeCallId}/results`, 200], ["/calls/new", 404]]);
      const record = await page(`/calls/${freeCallId}/results`, adminJar);
      check("the founder, and only the founder, sees the raw record of a call", record.words.includes("Messages received from the video service") && record.words.includes("Room confirmed closed."));
      await api("/sign-out", {}, adminJar);
    }
  } finally {
    // Remove this run's requests and emails, and take its host out of sight. People, calls and payments stay as test data.
    const mine = made.length ? await db.select({ id: schema.bookings.id }).from(schema.bookings).where(or(inArray(schema.bookings.customerId, made), inArray(schema.bookings.hostId, made))) : [];
    const ids = mine.map((b) => b.id);
    if (ids.length) {
      for (const id of ids) await db.delete(schema.emailOutbox).where(like(schema.emailOutbox.dedupeKey, `%:${id}:%`));
      await db.delete(schema.busyEntries).where(inArray(schema.busyEntries.bookingId, ids));
      await db.delete(schema.bookings).where(inArray(schema.bookings.id, ids));
    }
    await db.delete(schema.emailOutbox).where(like(schema.emailOutbox.to, `journey-${RUN}-%`));
    if (made.length) {
      await db.delete(schema.identityChecks).where(inArray(schema.identityChecks.userId, made));
      await db.delete(schema.session).where(inArray(schema.session.userId, made));
      await db.update(schema.hostProfiles).set({ status: "suspended", hidden: true }).where(inArray(schema.hostProfiles.userId, made));
    }
    await db.delete(schema.rateLimit);
  }

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
