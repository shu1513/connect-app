/**
 * Testing tool: messages between a host and a customer (plans/49-messaging.md, parts 1 and 2),
 * against the local database, with the pages read from the running app the way a browser gets them.
 *
 * What is real and what is pretended:
 *   real       opening a conversation, sending, the limits, the customer's switch, blocking, and
 *              "what is new": the app's own steps, called here as the pages' actions call them.
 *              Sign-up and the confirmation link for the three people who read pages, and every
 *              page, fetched with that person's login.
 *   pretended  the two tick boxes of the welcome step; the hosts, calls, requests and "joined"
 *              lines, which are written straight to the database; and the passing of days, which
 *              is done by moving a call's or a message's time back.
 *
 * It makes its own people, touches no other account, needs no Stripe, and removes what it made.
 * Like the other check scripts it clears the local "too many attempts" counters at the start and
 * the end, because every request here comes from one network address. It moves the founder's
 * switch for messages during its run (on, off for two checks, on again) and puts it back where
 * it was.
 *
 * What it does not cover: what only happens in a browser (the box keeping what was typed, the
 * page asking again every few seconds, the browser saying what it has shown). Those are tried by
 * hand. The edges of each rule to the second are in the tests of the plain rules.
 *
 * Usage: npx tsx scripts/conversation-check.ts            (the app on http://localhost:3000)
 *        npx tsx scripts/conversation-check.ts --app=http://localhost:3210
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { randomBytes, randomUUID } from "node:crypto";
import { and, desc, eq, inArray, like, or, sql } from "drizzle-orm";
import { TERMS_VERSION } from "../src/lib/terms";
import { requireLocalDatabase } from "./local-only";

const BASE = process.argv.find((arg) => arg.startsWith("--app="))?.slice("--app=".length).replace(/\/$/, "") ?? "http://localhost:3000";
// People are signed up through the app, so the app must be a local one, like the database.
if (!/^http:\/\/(localhost|127\.0\.0\.1|[a-z0-9-]+\.localhost)(:\d+)?$/.test(BASE)) throw new Error(`This script only runs against a local app, not ${BASE}.`);
const RUN = randomUUID().slice(0, 8);
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}

type Jar = Map<string, string>;

/** One request to the app, the way a browser would send it. Cookies are kept in the jar. Redirects are not followed. */
async function send(path: string, options: { body?: unknown; jar?: Jar } = {}) {
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
  return { status: response.status, text, location: response.headers.get("location") };
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const unescape = (text: string) => text.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
/** The page without its scripts: the data the browser part is given is in there a second time. */
const markup = (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, " ");
/** What a person reads on a page: the text, without the markup. */
const words = (html: string) => unescape(markup(html).replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ");
const count = (text: string, piece: string) => text.split(piece).length - 1;

async function main() {
  requireLocalDatabase();
  const { db, schema } = await import("../src/db");
  const { openConversation, sendMessage } = await import("../src/lib/conversations/send");
  const { conversationFor, conversationsOf, markShownUpTo, newConversationCount, setMuted, topBarCount, viewFor } = await import("../src/lib/conversations/read");
  const { CONVERSATION } = await import("../src/lib/conversations/rules");
  const { block, unblock } = await import("../src/lib/safety/blocks");
  const { setSwitches, switches } = await import("../src/lib/safety/switches");
  const { createReport, openReports, ReportError } = await import("../src/lib/safety/reports");
  const { keepMessages, KEPT_AFTER, KEPT_BEFORE, keptMessagesFor, MessageGoneError, messagePlaceText, reportableMessage } = await import("../src/lib/safety/kept-messages");
  const { reportNotice } = await import("../src/lib/safety/report-words");
  const { deleteOldConversationMessages } = await import("../src/lib/retention");

  const up = await send("/login").catch(() => null);
  if (!up || up.status !== 200) throw new Error(`The app is not running at ${BASE}. Start it first.`);
  // One run at a time: this script moves the founder's switch and puts it back, and two runs at once could leave it
  // wrong. The lock is held by this run's connection to the database and goes when the run ends.
  const [{ alone }] = await db.execute<{ alone: boolean }>(sql`select pg_try_advisory_lock(hashtext('conversation-check')) as alone`);
  if (!alone) throw new Error("Another run of this script is going on. Wait for it to finish.");
  await db.delete(schema.rateLimit);

  const now = new Date();
  const made: string[] = [];
  const calls: string[] = [];
  const wasOff = (await switches()).conversationsOff;

  const page = async (path: string, jar?: Jar) => {
    const reply = await send(path, { jar });
    return { ...reply, html: markup(reply.text), words: words(reply.text) };
  };

  /** Signs up the way the form does, opens the link in the confirmation email, and ticks the welcome step (pretended). */
  async function signUp(name: string) {
    const person = { name: `Talk ${name} ${RUN}`, email: `talkcheck-${RUN}-${name}@example.test`, password: randomBytes(12).toString("base64url"), jar: new Map() as Jar };
    await send("/api/auth/sign-up/email", { body: { name: person.name, email: person.email, password: person.password, callbackURL: "/welcome" } });
    let link = "";
    for (let i = 0; i < 25 && !link; i++) {
      const found = await db.select().from(schema.emailOutbox).where(and(eq(schema.emailOutbox.to, person.email), like(schema.emailOutbox.subject, "%Confirm your email%"))).orderBy(desc(schema.emailOutbox.createdAt));
      link = found[0]?.body.match(/https?:\/\/\S+/)?.[0] ?? "";
      if (!link) await pause(200);
    }
    if (!link) throw new Error(`No confirmation email for ${person.email}`);
    // The link carries a secret: it is only ever opened on the app this script was pointed at.
    if (new URL(link).origin !== new URL(BASE).origin) throw new Error(`The confirmation link leads to ${new URL(link).origin}, not to ${BASE}. Start the app with its own address set to ${BASE}.`);
    await send(link, { jar: person.jar });
    const [row] = await db.select().from(schema.user).where(eq(schema.user.email, person.email));
    made.push(row.id);
    await db.update(schema.user).set({ adultConfirmedAt: now, termsAcceptedAt: now, termsVersion: TERMS_VERSION, timeZone: "America/New_York" }).where(eq(schema.user.id, row.id));
    return { ...person, id: row.id };
  }
  /** A person who never logs in here, written straight to the database. */
  async function person(name: string) {
    const id = `tk-${RUN}-${name}`;
    await db.insert(schema.user).values({ id, name: `Account ${name} ${RUN}`, email: `talkcheck-${RUN}-${name}@example.test`, emailVerified: true, adultConfirmedAt: now, termsAcceptedAt: now, termsVersion: TERMS_VERSION, timeZone: "America/New_York" });
    made.push(id);
    return { id, name: `Account ${name} ${RUN}` };
  }
  /** Makes someone a host whose page is open to everyone. */
  async function asHost<T extends { id: string }>(who: T, name: string, displayName: string) {
    const handle = `tk${RUN}${name}`.toLowerCase();
    await db.insert(schema.hostProfiles).values({ userId: who.id, handle, handleKey: handle, displayName, pricePer15Cents: 2000, status: "approved", usConfirmedAt: now });
    // With a calendar and hours, so that she can really be booked: the booking buttons ask for that.
    await db.insert(schema.hostCalendars).values({ userId: who.id, timeZone: "America/New_York", lengths: "15,30", noticeHours: 24, horizonWeeks: 2, breakMinutes: 5 });
    await db.insert(schema.weeklyHours).values([1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ hostId: who.id, weekday, startMinute: 0, endMinute: 1440 })));
    return { ...who, handle, displayName };
  }
  /**
   * A call of 30 minutes between a host and a customer with the request it came from, as an
   * agreed call leaves them. `startsInDays` may be negative (it was that long ago). `joined`:
   * who the video service says joined it.
   */
  async function agreed(input: { hostId: string; customerId: string; startsInDays: number; joined?: string[]; source?: string; begunAt?: Date; agreedAt?: Date; cancelled?: boolean; safetyEnded?: Date; endedNow?: "host" | "customer" }) {
    const startsAt = new Date(Math.floor((Date.now() + input.startsInDays * DAY) / 1000) * 1000);
    const endsAt = new Date(startsAt.getTime() + 30 * MINUTE);
    const agreedAt = input.agreedAt ?? new Date(Math.min(Date.now(), startsAt.getTime()) - DAY);
    const begunAt = input.begunAt ?? new Date(agreedAt.getTime() - 60 * MINUTE);
    const [call] = await db
      .insert(schema.calls)
      .values({
        hostId: input.hostId,
        customerId: input.customerId,
        startsAt,
        endsAt,
        roomName: `talk-${randomUUID()}`,
        closedAt: endsAt.getTime() < Date.now() ? new Date(endsAt.getTime() + 1000) : null,
        cancelledAt: input.cancelled ? new Date() : null,
        cancelledBy: input.cancelled ? "host" : null,
        // Ended with the call's button. With `endedNow` it was "End call now" (plans/50), pressed by that person; without,
        // the earlier "End call and report".
        safetyEndedAt: input.safetyEnded ?? null,
        safetyEndedBy: input.safetyEnded ? (input.endedNow === "customer" ? input.customerId : input.hostId) : null,
        endedNowBy: input.safetyEnded ? (input.endedNow ?? null) : null,
        createdAt: agreedAt,
      })
      .returning();
    calls.push(call.id);
    await db.insert(schema.bookings).values({ hostId: input.hostId, customerId: input.customerId, startsAt, endsAt, lengthMinutes: 30, breakMinutes: 5, pricePer15Cents: 0, totalCents: 0, freeCancelMinutes: 0, note: "", stage: input.cancelled ? "cancelled" : "accepted", source: input.source ?? "customer", requestKey: randomUUID(), requestedAt: begunAt, decidedAt: agreedAt, callId: call.id, createdAt: begunAt });
    if (input.joined?.length) {
      await db.insert(schema.attendanceEvents).values(input.joined.map((id) => ({ provider: "talkcheck", providerEventId: randomUUID(), callId: call.id, type: "participant_joined", participantIdentity: id, providerTime: startsAt, payload: "{}" })));
    }
    return call;
  }
  /**
   * Holds these people's calendar locks, the ones a send and a block take first, until the
   * function it gives back is called. So a step can be made to wait, and what happens meanwhile
   * can be chosen.
   */
  async function holdLocks(ids: string[]) {
    let release!: () => void;
    let got!: () => void;
    let failed!: (error: unknown) => void;
    const until = new Promise<void>((resolve) => (release = resolve));
    const ready = new Promise<void>((resolve, reject) => {
      got = resolve;
      failed = reject;
    });
    const done = db.transaction(async (tx) => {
      for (const id of [...new Set(ids)].sort()) await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`calendar:${id}`}))`);
      got();
      await until;
    });
    // If the locks cannot be taken, say so, and do not wait for ever.
    done.catch(failed);
    await ready;
    return async () => {
      release();
      await done;
    };
  }
  /** How many steps are waiting for a lock of that kind right now, in this database. */
  const waitingNow = async () => Number((await db.execute<{ n: number }>(sql`select count(*)::int as n from pg_locks where locktype = 'advisory' and not granted and database = (select oid from pg_database where datname = current_database())`))[0]?.n ?? 0);
  /** Waits until this many steps are waiting. So the order in which steps queue up is known, not hoped for. */
  async function untilWaiting(howMany: number) {
    for (let i = 0; i < 200; i++) {
      if ((await waitingNow()) >= howMany) return;
      await pause(25);
    }
    throw new Error("A step that should be waiting for a lock is not.");
  }
  /** A pair who talked ten days ago: the call is over, both joined it, and its 7 days have passed. */
  const talkedPair = async (hostId: string, customerId: string) => agreed({ hostId, customerId, startsInDays: -10, joined: [hostId, customerId] });

  const say = (conversationId: string, senderId: string, text = `hello ${randomUUID().slice(0, 6)}`, sendKey: string = randomUUID()) => sendMessage({ conversationId, senderId, text, sendKey });
  const sent = (result: Awaited<ReturnType<typeof sendMessage>>) => result.ok;
  const refusedAs = (result: Awaited<ReturnType<typeof sendMessage>>) => (result.ok ? "sent" : result.kind === "refused" ? result.why : result.kind === "limit" ? result.problem : result.kind);
  const rowOf = async (id: string) => (await db.select().from(schema.conversations).where(eq(schema.conversations.id, id)))[0];
  const messagesIn = async (id: string) => db.select().from(schema.conversationMessages).where(eq(schema.conversationMessages.conversationId, id)).orderBy(schema.conversationMessages.number);
  const conversationsBetween = async (a: string, b: string) =>
    db
      .select()
      .from(schema.conversations)
      .where(or(and(eq(schema.conversations.hostId, a), eq(schema.conversations.customerId, b)), and(eq(schema.conversations.hostId, b), eq(schema.conversations.customerId, a))));
  /** Moves the moment the host last wrote back by so many days, as if that long had passed. */
  const hostWroteDaysAgo = async (id: string, days: number) => db.update(schema.conversations).set({ hostLastWroteAt: new Date(Date.now() - days * DAY) }).where(eq(schema.conversations.id, id));
  /** A conversation's row written straight to the database: for the limits, which count over all of a person's conversations. */
  async function rawConversation(hostId: string, customerId: string) {
    const [row] = await db.insert(schema.conversations).values({ hostId, customerId }).returning();
    return row;
  }
  async function rawMessages(conversationId: string, senderId: string, howMany: number, more: { woke?: boolean; minutesAgo?: number } = {}) {
    const [{ lastNumber }] = await db.select({ lastNumber: schema.conversations.lastNumber }).from(schema.conversations).where(eq(schema.conversations.id, conversationId));
    const at = new Date(Date.now() - (more.minutesAgo ?? 120) * MINUTE);
    await db.insert(schema.conversationMessages).values(Array.from({ length: howMany }, (_, i) => ({ conversationId, number: lastNumber + i + 1, senderId, body: `raw ${i}`, sendKey: randomUUID(), woke: more.woke ?? false, createdAt: at })));
    await db.update(schema.conversations).set({ lastNumber: lastNumber + howMany, lastMessageAt: at }).where(eq(schema.conversations.id, conversationId));
  }

  try {
    await setSwitches({ conversationsOff: false });

    // ----------------------------------------------------------------------
    console.log("\n1. Opening a conversation: only around a call or after one, and never a stranger's");
    const hana = await asHost(await signUp("hana"), "hana", `Hana Host ${RUN}`);
    const cory = await signUp("cory");
    const olga = await signUp("olga");
    {
      check("two people with no call between them cannot open one", (await openConversation({ userId: hana.id, customerId: cory.id })) === null);
      check("and nothing is left behind by the refusal", (await conversationsBetween(hana.id, cory.id)).length === 0);
      // A request that waits for the host's answer is not a call.
      const startsAt = new Date(Date.now() + 2 * DAY);
      await db.insert(schema.bookings).values({ hostId: hana.id, customerId: cory.id, startsAt, endsAt: new Date(startsAt.getTime() + 30 * MINUTE), lengthMinutes: 30, breakMinutes: 5, pricePer15Cents: 0, totalCents: 0, freeCancelMinutes: 0, note: "", stage: "waiting", requestKey: randomUUID(), requestedAt: now, respondBy: new Date(Date.now() + DAY) });
      check("a request that is still waiting opens nothing", (await openConversation({ userId: cory.id, customerId: hana.id })) === null && (await openConversation({ userId: hana.id, customerId: cory.id })) === null);

      const coming = await agreed({ hostId: hana.id, customerId: cory.id, startsInDays: 2 });
      check("someone who is not in the call cannot open it by naming the call", (await openConversation({ userId: olga.id, callId: coming.id })) === null);
      check("the host's link beside a past customer opens nothing before a call has taken place", (await openConversation({ userId: hana.id, customerId: cory.id })) === null && (await conversationsBetween(hana.id, cory.id)).length === 0);
      const [first, second] = await Promise.all([openConversation({ userId: hana.id, callId: coming.id }), openConversation({ userId: cory.id, callId: coming.id })]);
      check("once the call is agreed, both can open it, and at the same moment they get the same one", first !== null && first === second);
      check("there is one row for the pair", (await conversationsBetween(hana.id, cory.id)).length === 1);
      const row = await rowOf(first!);
      check("who is the host is taken from the call, not from who pressed", row.hostId === hana.id && row.customerId === cory.id);
      check("an empty conversation is listed for nobody", (await conversationsOf(hana.id)).length === 0 && (await conversationsOf(cory.id)).length === 0);
      check("the customer cannot open one by naming the host as his customer", (await openConversation({ userId: cory.id, customerId: hana.id })) === null && (await conversationsBetween(hana.id, cory.id)).length === 1);
    }
    const [{ id: talk }] = await conversationsBetween(hana.id, cory.id);

    // ----------------------------------------------------------------------
    console.log("\n2. Around a call: both write, in one order, once per press");
    {
      const one = await say(talk, hana.id, "Looking forward to it.");
      const two = await say(talk, cory.id, "Me too.\r\nSee you then.  ");
      check("the host writes, then the customer, as numbers 1 and 2", one.ok && one.number === 1 && two.ok && two.number === 2);
      const stored = await messagesIn(talk);
      check("the words are kept as written, with line ends made alike and the ends trimmed", stored[1]?.body === "Me too.\nSee you then.");
      const both = await Promise.all([say(talk, hana.id, "A"), say(talk, cory.id, "B")]);
      const numbers = (await messagesIn(talk)).map((m) => m.number);
      check("two messages sent at the same moment get two different numbers, with none left out", both.every(sent) && numbers.join(",") === "1,2,3,4");

      const key = randomUUID();
      const press = await Promise.all([say(talk, cory.id, "Only once", key), say(talk, cory.id, "Only once", key)]);
      const again = await say(talk, cory.id, "Only once", key);
      const after = await messagesIn(talk);
      check("the same press sent twice, and once more later, makes one message and gives the same number", press.every(sent) && again.ok && press[0].ok && press[1].ok && press[0].number === press[1].number && again.number === press[0].number && count(after.map((m) => m.body).join("|"), "Only once") === 1);

      check("other words under a key that was already used are not called sent, and nothing more is saved", refusedAs(await say(talk, cory.id, "Other words", key)) === "text" && (await messagesIn(talk)).every((m) => m.body !== "Other words"));
      check("an empty message, one that is too long and one without a proper key are refused", refusedAs(await say(talk, cory.id, "   ")) === "text" && refusedAs(await say(talk, cory.id, "x".repeat(CONVERSATION.maxChars + 1))) === "text" && refusedAs(await say(talk, cory.id, "hi", "short")) === "text");
      check("a stranger cannot write into it, and gets the same answer as for one that does not exist", refusedAs(await say(talk, olga.id)) === "not_found" && refusedAs(await say(randomUUID(), olga.id)) === "not_found" && refusedAs(await say("not-an-id", olga.id)) === "not_found");
      check("nothing of the stranger's was saved", (await messagesIn(talk)).every((m) => m.senderId !== olga.id));

      const hostPage = await page(`/conversations/${talk}`, hana.jar);
      const customerPage = await page(`/conversations/${talk}`, cory.jar);
      check("the host's page shows the conversation under the customer's own name, with the box", hostPage.status === 200 && hostPage.words.includes(cory.name) && hostPage.html.includes("data-composer") && hostPage.words.includes("Looking forward to it."));
      check("the customer's page shows it under her host name, never her account name", customerPage.status === 200 && customerPage.words.includes(hana.displayName) && !customerPage.words.includes(hana.name));
      check("the customer has the Book a time button, to her page", customerPage.html.includes("data-book-a-time") && customerPage.html.includes(`href="/h/${hana.handle}"`));
      check("the host has no such button, and no switch", !hostPage.html.includes("data-book-a-time") && !hostPage.html.includes("data-mute"));
      check("the line about staying on Connect is beside the box", customerPage.words.includes("Calls and payments for them stay on Connect."));
      check("a web address in a message is plain text, not a link", (await say(talk, hana.id, "see https://example.test/x")).ok && !(await page(`/conversations/${talk}`, cory.jar)).html.includes('href="https://example.test/x"'));
      const strangers = await page(`/conversations/${talk}`, olga.jar);
      const missing = await page(`/conversations/${randomUUID()}`, olga.jar);
      check("someone else gets Not found, the same as for a conversation that does not exist", strangers.status === 404 && missing.status === 404 && !strangers.words.includes("Looking forward"));
      check("the page needs a login", [302, 303, 307].includes((await page(`/conversations/${talk}`)).status));
    }

    // ----------------------------------------------------------------------
    console.log("\n3. What is new, and what has been shown");
    {
      const a = await person("newa");
      const host = await asHost(await person("newh"), "newh", `New Host ${RUN}`);
      const id = (await openConversation({ userId: host.id, callId: (await agreed({ hostId: host.id, customerId: a.id, startsInDays: 1 })).id }))!;
      await say(id, host.id, "one");
      check("a message of the other person counts as new, in the top bar's count and in the list", (await newConversationCount(a.id)) === 1 && (await conversationsOf(a.id))[0]?.hasNew === true);
      check("a person's own message never counts as new for them", (await newConversationCount(host.id)) === 0 && (await conversationsOf(host.id))[0]?.hasNew === false);
      await say(id, a.id, "an answer");
      check("answering does not mark the other one's message as shown", (await newConversationCount(a.id)) === 1 && (await newConversationCount(host.id)) === 1);
      await markShownUpTo(a.id, id, 1);
      check("once the browser says it was shown, it is not new any more", (await newConversationCount(a.id)) === 0);
      await markShownUpTo(a.id, id, 999);
      check("a number past the last message is taken as the last message", (await rowOf(id)).customerShownNumber === 2);
      await markShownUpTo(a.id, id, 1);
      check("a late word from an older tab never moves the mark back", (await rowOf(id)).customerShownNumber === 2);
      await markShownUpTo(olga.id, id, 2);
      await markShownUpTo(host.id, randomUUID(), 2);
      check("someone else's word changes nothing", (await rowOf(id)).hostShownNumber === 0);

      // Sixty new messages: all of them are on the page, so none can count as shown that was not there.
      await rawMessages(id, host.id, 60);
      const view = (await viewFor(a.id, id, new Date()))!;
      check("with 60 new messages the page may say that it showed them: none lies before its first one", !view.unshownBefore);
      check("with 60 new messages, all 60 are on the page", view.messages.filter((m) => m.senderId === host.id && m.number > 2).length === 60 && view.messages[0].number <= 3);
      // The host's own browser has shown her everything (it says so after every message of hers that is drawn).
      await markShownUpTo(host.id, id, 62);
      const short = (await viewFor(host.id, id, new Date()))!;
      check("someone with nothing new gets the latest 50, and the page knows there are earlier ones", short.messages.length === CONVERSATION.shown && short.hasEarlier && short.firstNumber === 62 - CONVERSATION.shown + 1);
      const earlier = (await viewFor(host.id, id, new Date(), { from: 1 }))!;
      check("Show earlier brings the rest", earlier.messages.length === 62 && !earlier.hasEarlier && !earlier.hasLater);
      check("nobody else is given any of it", (await viewFor(olga.id, id, new Date())) === null && (await viewFor(olga.id, randomUUID(), new Date())) === null);

      // A message that arrives between the page being drawn and the browser saying what it showed.
      await markShownUpTo(a.id, id, 62);
      check("everything on the page shown, nothing is new", (await newConversationCount(a.id)) === 0);
      // He answers (so that she may write again: she has sent more than five in a row), and she writes once more.
      await say(id, a.id, "an answer to all that");
      const late = await say(id, host.id, "written after the page was drawn");
      await markShownUpTo(a.id, id, 63);
      check("a message that came after the page was drawn stays new when the page says what it showed", late.ok && late.number === 64 && (await newConversationCount(a.id)) === 1, refusedAs(late));
      await db.delete(schema.conversationMessages).where(and(eq(schema.conversationMessages.conversationId, id), eq(schema.conversationMessages.number, 64)));
      check("when the last new message is deleted, nothing is new any more", (await newConversationCount(a.id)) === 0 && (await conversationsOf(a.id))[0]?.hasNew === false);
      const next = await say(id, host.id, "the one after");
      check("and its number is never used again", next.ok && next.number === 65, refusedAs(next));

      // More than a page can hold: "Show earlier" reaches every message, a stretch at a time.
      const long = await person("newl");
      const longId = (await openConversation({ userId: host.id, callId: (await agreed({ hostId: host.id, customerId: long.id, startsInDays: 1 })).id }))!;
      await rawMessages(longId, host.id, 600);
      await markShownUpTo(host.id, longId, 600);
      const oldest = (await viewFor(host.id, longId, new Date(), { from: 1 }))!;
      const middle = (await viewFor(host.id, longId, new Date(), { from: 101 }))!;
      check("of 600 messages, asking from the first gives the first 500 and says there are later ones", oldest.messages.length === 500 && oldest.messages[0].number === 1 && oldest.messages[499].number === 500 && oldest.hasLater && !oldest.hasEarlier);
      check("and asking from the 101st gives the rest, up to the latest", middle.messages.length === 500 && middle.messages[0].number === 101 && middle.messages[499].number === 600 && !middle.hasLater && middle.hasEarlier);

      // The same for someone whose browser has not said yet what it showed (nothing is marked as shown).
      const fresh = (await viewFor(long.id, longId, new Date()))!;
      const back = (await viewFor(long.id, longId, new Date(), { from: fresh.firstNumber! - CONVERSATION.shown }))!;
      check("Show earlier also moves for someone to whom all 600 are new", fresh.messages.length === 500 && fresh.firstNumber === 101 && fresh.hasEarlier && back.messages[0].number === 51 && back.messages.length === 500 && back.hasLater);
      const { mayMarkShown } = await import("../src/lib/conversations/read");
      const fromFirst = (await viewFor(long.id, longId, new Date(), { from: 1 }))!;
      check("a page marks nothing as shown while a new message lies before its first one: not the usual page with 600 new, not a stretch from the 51st", !mayMarkShown(fresh) && fresh.unshownBefore && !mayMarkShown(back));
      check("the stretch from the first message may say that it showed its 500, and then the next stretch may too", mayMarkShown(fromFirst) && fromFirst.messages.length === 500);
      await markShownUpTo(long.id, longId, 500);
      const rest = (await viewFor(long.id, longId, new Date()))!;
      check("after that the usual page holds the rest and may mark it", rest.messages[0].number <= 501 && !rest.unshownBefore && mayMarkShown(rest));
      await db.delete(schema.conversationMessages).where(and(eq(schema.conversationMessages.conversationId, longId), sql`${schema.conversationMessages.number} between 501 and 520`));
      check("messages that were deleted do not count as lying before the page", mayMarkShown((await viewFor(long.id, longId, new Date(), { from: 521 }))!));
      check("a stretch asked for past the last message holds nothing", (await viewFor(long.id, longId, new Date(), { from: 9999 }))!.messages.length === 0 && [302, 303, 307].includes((await page(`/conversations/${talk}?from=9999`, cory.jar)).status));

      // The list: a conversation with something new comes before a later one with nothing new.
      await say(id, a.id, "new for the host");
      await rawMessages(longId, host.id, 1, { minutesAgo: 0 });
      const listed = await conversationsOf(host.id);
      check("in the list, the conversation with something new comes first", listed[0]?.id === id && listed[0].hasNew && listed[1]?.id === longId && !listed[1].hasNew);

      // In the pages: the count in the top bar, the list, and that drawing a page marks nothing.
      await say(talk, hana.id, "Something new for Cory");
      const before = await newConversationCount(cory.id);
      // What Connect itself wrote to him and he has not read is counted in the same number: two such messages are
      // written here, and the number expected is worked out without the function the top bar uses.
      await db.insert(schema.messages).values([1, 2].map((n) => ({ userId: cory.id, subject: `From Connect ${n}`, body: "A message from Connect.", key: `talkcheck-${RUN}-notice-${n}` })));
      const total = await topBarCount(cory.id);
      const list = await page("/messages", cory.jar);
      const read = await page(`/conversations/${talk}`, cory.jar);
      check("the top bar's Messages counts the conversation", before === 1 && total === 3 && /data-messages-link[^>]*data-unread="3"/.test(list.html) && list.words.includes("Messages (3)"), `${before} of ${total}`);
      check("the Messages page lists it under Conversations, marked New, before what Connect wrote", list.html.includes("data-conversations") && list.html.includes('data-conversation="new"') && list.html.indexOf("Conversations") < list.html.indexOf("From Connect") && list.words.includes(hana.displayName));
      check("drawing the conversation's page marks nothing as shown", read.status === 200 && (await newConversationCount(cory.id)) === 1);
      check("someone with no conversation sees the Messages page as before", !(await page("/messages", olga.jar)).html.includes("data-conversations"));
    }

    // ----------------------------------------------------------------------
    console.log("\n4. After the 7 days: the host can wake it, the customer cannot");
    {
      const host = await asHost(await person("wakeh"), "wakeh", `Wake Host ${RUN}`);
      const guest = await person("wakec");
      await talkedPair(host.id, guest.id);
      const id = (await openConversation({ userId: host.id, customerId: guest.id }))!;
      check("a host can open the conversation with someone she talked with ten days ago", typeof id === "string");
      check("the customer cannot write into the quiet conversation", refusedAs(await say(id, guest.id)) === "book_again");
      const first = await say(id, host.id, "I have Thursday free.");
      check("the host can, and her message is marked as one that woke it", first.ok && (await messagesIn(id))[0]?.woke === true);
      check("now the customer can answer", sent(await say(id, guest.id, "Yes please")));
      check("her second message inside her own 7 days does not count as waking it again", sent(await say(id, host.id, "Great")) && (await messagesIn(id))[2]?.woke === false);
      await hostWroteDaysAgo(id, 8);
      await say(id, guest.id).then((r) => check("eight days after her last message he cannot write again: his own answers did not move the date", refusedAs(r) === "book_again"));
      check("and she can wake it once more", sent(await say(id, host.id, "Still free on Friday")) && (await messagesIn(id)).at(-1)?.woke === true);
      {
        // Her 7 days end in three seconds. An answer sent now goes through. The next one is sent in time too, but has
        // to wait for its turn, and its turn comes after the 7 days have ended: it is judged by the clock after the wait.
        await db.update(schema.conversations).set({ hostLastWroteAt: new Date(Date.now() - 7 * DAY + 3000) }).where(eq(schema.conversations.id, id));
        const inTime = await say(id, guest.id, "sent in time");
        const others = await waitingNow();
        const release = await holdLocks([host.id, guest.id]);
        let waiting: ReturnType<typeof say>;
        try {
          waiting = say(id, guest.id, "sent just in time, or so he thought");
          await untilWaiting(others + 1);
          await pause(3500);
        } finally {
          await release();
        }
        check("a message that had to wait past the end of the 7 days is refused: the clock is read after the wait", inTime.ok && refusedAs(await waiting) === "book_again" && (await messagesIn(id)).every((m) => !m.body.includes("or so he thought")), refusedAs(inTime));
      }

      // A call that the customer did not come to: its 7 days ran, and nothing after them.
      const noShow = await person("noshow");
      await agreed({ hostId: host.id, customerId: noShow.id, startsInDays: -10, joined: [host.id] });
      check("after a call the customer missed, the host cannot open or write once its 7 days are over", (await openConversation({ userId: host.id, customerId: noShow.id })) === null);
      const recent = await person("recent");
      await agreed({ hostId: host.id, customerId: recent.id, startsInDays: -3, joined: [host.id] });
      const missed = (await openConversation({ userId: recent.id, callId: calls.at(-1)! }))!;
      check("three days after a call he missed, both can still write (sorry I missed it)", sent(await say(missed, recent.id, "Sorry I missed it")) && sent(await say(missed, host.id, "No problem")));

      // Roles: she was his host. That gives him nothing as her host.
      const both = await asHost(await person("alsohost"), "alsohost", `Also Host ${RUN}`);
      await talkedPair(host.id, both.id);
      check("a customer who is a host too cannot write to his host as if she were his customer", (await openConversation({ userId: both.id, customerId: host.id })) === null && (await conversationsBetween(host.id, both.id)).length === 0);
      const hers = (await openConversation({ userId: host.id, customerId: both.id }))!;
      check("she can write to him, in her conversation", sent(await say(hers, host.id)));
      await talkedPair(both.id, host.id);
      const his = (await openConversation({ userId: both.id, customerId: host.id }))!;
      check("once he has been her host as well, there are two conversations, one for each direction", his !== hers && (await conversationsBetween(host.id, both.id)).length === 2 && sent(await say(his, both.id)));
      const hersListed = await conversationsOf(host.id);
      check("in her list he is named for each conversation: by his own name where he is her customer, by his host name where he is her host", hersListed.find((c) => c.id === hers)?.name === both.name && hersListed.find((c) => c.id === his)?.name === both.displayName);

      // The pages for a quiet conversation.
      await talkedPair(hana.id, olga.id);
      const quiet = (await openConversation({ userId: hana.id, customerId: olga.id }))!;
      await say(quiet, hana.id, "Hello Olga");
      await hostWroteDaysAgo(quiet, 9);
      const closed = await page(`/conversations/${quiet}`, olga.jar);
      check("a quiet conversation shows the customer Book a call to write to her again, with her page", closed.status === 200 && closed.html.includes("data-book-to-write") && closed.words.includes(`Book a call to write to ${hana.displayName} again`) && closed.html.includes(`href="/h/${hana.handle}"`) && !closed.html.includes("data-composer"));
      check("the host still has her box there", (await page(`/conversations/${quiet}`, hana.jar)).html.includes("data-composer"));
    }

    // ----------------------------------------------------------------------
    console.log("\n5. A cancelled call, and a host whose page is hidden");
    {
      const host = await asHost(await person("canh"), "canh", `Cancel Host ${RUN}`);
      const guest = await person("canc");
      const only = await agreed({ hostId: host.id, customerId: guest.id, startsInDays: 3 });
      const id = (await openConversation({ userId: guest.id, callId: only.id }))!;
      check("around the first call both write", sent(await say(id, host.id, "See you soon")) && sent(await say(id, guest.id, "Yes")));
      await db.update(schema.calls).set({ cancelledAt: new Date(), cancelledBy: "customer" }).where(eq(schema.calls.id, only.id));
      check("the first call is cancelled: the conversation is closed for both at once, whatever she wrote", refusedAs(await say(id, host.id)) === "closed" && refusedAs(await say(id, guest.id)) === "book_again");
      check("it can still be read", (await conversationFor(guest.id, id)) !== null && (await messagesIn(id)).length === 2);
      await agreed({ hostId: host.id, customerId: guest.id, startsInDays: 5 });
      check("another call that counts opens it again", sent(await say(id, guest.id, "Booked again")));

      const talked = await person("hid");
      await talkedPair(host.id, talked.id);
      const quiet = (await openConversation({ userId: host.id, customerId: talked.id }))!;
      await say(quiet, host.id, "Hello");
      await db.update(schema.hostProfiles).set({ hidden: true }).where(eq(schema.hostProfiles.userId, host.id));
      check("with her page hidden she cannot write outside a call", refusedAs(await say(quiet, host.id)) === "page_not_public");
      check("the customer can still answer her latest message", sent(await say(quiet, talked.id, "Hi")));
      check("around a call she writes as before", sent(await say(id, host.id, "About our call")));
      await hostWroteDaysAgo(quiet, 9);
      const view = (await viewFor(talked.id, quiet, new Date()))!;
      check("a closed conversation with a host he cannot book just says it is closed, with no button", view.shownRefusal === "closed" && view.bookHref === null);
      await db.update(schema.hostProfiles).set({ hidden: false }).where(eq(schema.hostProfiles.userId, host.id));
    }

    // ----------------------------------------------------------------------
    console.log("\n6. The customer's switch, for one host");
    {
      const host = await asHost(await person("muteh"), "muteh", `Mute Host ${RUN}`);
      const other = await asHost(await person("muteo"), "muteo", `Other Host ${RUN}`);
      const guest = await person("mutec");
      await talkedPair(host.id, guest.id);
      await talkedPair(other.id, guest.id);
      const id = (await openConversation({ userId: host.id, customerId: guest.id }))!;
      const second = (await openConversation({ userId: other.id, customerId: guest.id }))!;
      await say(id, host.id, "Hello");
      check("only the customer of the conversation can move the switch", !(await setMuted(host.id, id, true, new Date())) && !(await setMuted(olga.id, id, true, new Date())) && (await rowOf(id)).customerMutedAt === null);
      check("the customer switches her off", (await setMuted(guest.id, id, true, new Date())) && (await rowOf(id)).customerMutedAt !== null);
      check("now she is refused, with the answer that does not say why", refusedAs(await say(id, host.id)) === "not_taking");
      check("he cannot write either, and is told it is his own switch", refusedAs(await say(id, guest.id)) === "you_muted");
      check("the other host is not touched by it", sent(await say(second, other.id, "Hello from the other host")));
      await agreed({ hostId: host.id, customerId: guest.id, startsInDays: 2 });
      check("around a call he booked, both write, switch or no switch", sent(await say(id, host.id, "About Thursday")) && sent(await say(id, guest.id, "OK")));
      await db.update(schema.calls).set({ cancelledAt: new Date(), cancelledBy: "customer" }).where(eq(schema.calls.id, calls.at(-1)!));
      check("that call gone, she is refused again", refusedAs(await say(id, host.id)) === "not_taking");
      check("he switches it back, and she can write", (await setMuted(guest.id, id, false, new Date())) && sent(await say(id, host.id, "Thanks")));

      // In the pages, with the people who have logins.
      await setMuted(olga.id, (await conversationsBetween(hana.id, olga.id))[0].id, true, new Date());
      const quiet = (await conversationsBetween(hana.id, olga.id))[0].id;
      const hers = await page(`/conversations/${quiet}`, hana.jar);
      const his = await page(`/conversations/${quiet}`, olga.jar);
      check("the host reads that he is not taking messages right now, and has no box", hers.words.includes(`${olga.name} is not taking messages right now.`) && !hers.html.includes("data-composer") && hers.html.includes('data-closed="not_taking"'));
      check("the customer sees his switch as on, with the way to switch it back", his.html.includes('data-mute="on"') && his.words.includes(`Allow messages from ${hana.displayName} again`));
      check("and can still book her from there", his.html.includes("data-book-a-time") && his.html.includes(`href="/h/${hana.handle}"`));
      await setMuted(olga.id, quiet, false, new Date());
    }

    // ----------------------------------------------------------------------
    console.log("\n7. Blocking closes both conversations, at once");
    {
      const host = await asHost(await person("blockh"), "blockh", `Block Host ${RUN}`);
      const guest = await asHost(await person("blockc"), "blockc", `Block Guest ${RUN}`);
      await talkedPair(host.id, guest.id);
      await talkedPair(guest.id, host.id);
      const one = (await openConversation({ userId: host.id, customerId: guest.id }))!;
      const two = (await openConversation({ userId: guest.id, customerId: host.id }))!;
      await say(one, host.id, "Hello");
      await say(two, guest.id, "Hello back");
      // A send and a block at the same moment happen in one order or the other. Both wait for the same locks,
      // and they get them in the order they asked: so here the order is chosen, both ways round.
      {
        const others = await waitingNow();
        const release = await holdLocks([host.id, guest.id]);
        let sending: ReturnType<typeof say>;
        let blocking: ReturnType<typeof block>;
        try {
          sending = say(one, host.id, "Sent before the block");
          await untilWaiting(others + 1);
          blocking = block({ blockerId: guest.id, blockedId: host.id, now: new Date() });
          await untilWaiting(others + 2);
        } finally {
          await release();
        }
        const [first] = await Promise.all([sending, blocking]);
        check("a message that asked first, with a block right behind it, is saved, and the block then stands", first.ok && (await messagesIn(one)).at(-1)?.body === "Sent before the block" && refusedAs(await say(one, host.id)) === "not_taking");
        await unblock(guest.id, host.id);
      }
      {
        const others = await waitingNow();
        const release = await holdLocks([host.id, guest.id]);
        let sending: ReturnType<typeof say>;
        let blocking: ReturnType<typeof block>;
        try {
          blocking = block({ blockerId: guest.id, blockedId: host.id, now: new Date() });
          await untilWaiting(others + 1);
          sending = say(one, host.id, "Sent behind the block");
          await untilWaiting(others + 2);
        } finally {
          await release();
        }
        const [, second] = await Promise.all([blocking, sending]);
        check("a message right behind a block is refused, and nothing of it is saved", refusedAs(second) === "not_taking" && (await messagesIn(one)).every((m) => m.body !== "Sent behind the block"));
      }
      check("after the block the blocked host is refused in both conversations, with the answer of the switch", refusedAs(await say(one, host.id)) === "not_taking" && refusedAs(await say(two, host.id)) === "closed");
      check("the one who blocked is told that they blocked, in both", refusedAs(await say(one, guest.id)) === "you_blocked" && refusedAs(await say(two, guest.id)) === "you_blocked");
      check("no new conversation can be opened across a block", (await openConversation({ userId: host.id, customerId: guest.id })) === one);
      await unblock(guest.id, host.id);
      check("the block lifted, the rules apply again", sent(await say(one, host.id, "Hello again")));

      // In the pages: the blocked host and the switched-off host read the same sentence.
      await block({ blockerId: olga.id, blockedId: hana.id, now: new Date() });
      const quiet = (await conversationsBetween(hana.id, olga.id))[0].id;
      const hers = await page(`/conversations/${quiet}`, hana.jar);
      const his = await page(`/conversations/${quiet}`, olga.jar);
      check("the blocked host reads the very sentence of the switch", hers.words.includes(`${olga.name} is not taking messages right now.`) && hers.html.includes('data-closed="not_taking"') && !hers.words.includes("blocked"));
      check("the one who blocked reads You blocked this person, and has no box, no switch and no booking button", his.words.includes("You blocked this person.") && !his.html.includes("data-composer") && !his.html.includes("data-mute") && !his.html.includes("data-book"));
      await unblock(olga.id, hana.id);
    }

    // ----------------------------------------------------------------------
    console.log("\n8. The limits");
    {
      const host = await asHost(await person("limh"), "limh", `Limit Host ${RUN}`);
      const guests = [await person("lim1"), await person("lim2"), await person("lim3")];
      const ids: string[] = [];
      for (const guest of guests) ids.push((await openConversation({ userId: host.id, callId: (await agreed({ hostId: host.id, customerId: guest.id, startsInDays: 2 })).id }))!);
      // Eight at once into one conversation: five go through.
      const burst = await Promise.all(Array.from({ length: 8 }, () => say(ids[0], host.id)));
      check("of eight messages sent at once with no answer, five go through and three are refused", burst.filter(sent).length === CONVERSATION.inARow && burst.filter((r) => refusedAs(r) === "in_a_row").length === 3);
      check("the five hold before the booked call has even started", refusedAs(await say(ids[0], host.id)) === "in_a_row");
      check("an answer lets her write again", sent(await say(ids[0], guests[0].id, "An answer")) && sent(await say(ids[0], host.id)));
      // Ten a minute, over all her conversations: 6 so far, 4 more, then no more anywhere.
      const more = [await say(ids[1], host.id), await say(ids[1], host.id), await say(ids[1], host.id), await say(ids[1], host.id)];
      check("ten messages in a minute go through over her conversations", more.every(sent));
      const over = await Promise.all([say(ids[2], host.id), say(ids[2], host.id)]);
      check("the eleventh and twelfth, sent at once into another conversation, are both refused", over.every((r) => refusedAs(r) === "minute"));
      check("the other person is not held back by her limit", sent(await say(ids[2], guests[2].id)));

      // A newly agreed call starts the count of five again; nothing else does.
      const second = await asHost(await person("limh2"), "limh2", `Limit Host Two ${RUN}`);
      const guest = await person("lim4");
      const id = (await openConversation({ userId: second.id, callId: (await agreed({ hostId: second.id, customerId: guest.id, startsInDays: 2, agreedAt: new Date(Date.now() - 2 * DAY) })).id }))!;
      await rawMessages(id, second.id, 5, { minutesAgo: 600 });
      check("five unanswered messages from hours ago still hold", refusedAs(await say(id, second.id)) === "in_a_row");
      await agreed({ hostId: second.id, customerId: guest.id, startsInDays: 4, agreedAt: new Date(Date.now() - 1000) });
      check("a newly agreed call lets her write again", sent(await say(id, second.id, "About the new call")));

      // A hundred a day.
      const busy = await asHost(await person("limh3"), "limh3", `Limit Host Three ${RUN}`);
      const sink = await person("lim5");
      const far = await rawConversation(busy.id, sink.id);
      await rawMessages(far.id, busy.id, CONVERSATION.perDay - 1, { minutesAgo: 120 });
      const target = await person("lim6");
      const day = (await openConversation({ userId: busy.id, callId: (await agreed({ hostId: busy.id, customerId: target.id, startsInDays: 2 })).id }))!;
      // The last free place of the day, asked for twice at once: as a host in one conversation, as a customer in another.
      const herHost = await asHost(await person("limh5"), "limh5", `Limit Host Five ${RUN}`);
      const asCustomer = (await openConversation({ userId: busy.id, callId: (await agreed({ hostId: herHost.id, customerId: busy.id, startsInDays: 2 })).id }))!;
      const lastOfDay = await Promise.all([say(day, busy.id), say(asCustomer, busy.id)]);
      check("the hundredth message of a day, sent twice at once in her two roles, goes through once", lastOfDay.filter(sent).length === 1 && lastOfDay.filter((r) => refusedAs(r) === "day").length === 1);
      check("after a hundred messages in a day the next one is refused", refusedAs(await say(day, busy.id)) === "day");

      // The last free place of a minute, the same way.
      const quick = await asHost(await person("limh6"), "limh6", `Limit Host Six ${RUN}`);
      const quickFar = await rawConversation(quick.id, sink.id);
      await rawMessages(quickFar.id, quick.id, CONVERSATION.perMinute - 1, { minutesAgo: 0.2 });
      const q1 = (await openConversation({ userId: quick.id, callId: (await agreed({ hostId: quick.id, customerId: (await person("lim9")).id, startsInDays: 2 })).id }))!;
      const q2 = (await openConversation({ userId: quick.id, callId: (await agreed({ hostId: herHost.id, customerId: quick.id, startsInDays: 2 })).id }))!;
      const lastOfMinute = await Promise.all([say(q1, quick.id), say(q2, quick.id)]);
      check("the tenth message of a minute, sent twice at once in two conversations, goes through once", lastOfMinute.filter(sent).length === 1 && lastOfMinute.filter((r) => refusedAs(r) === "minute").length === 1);

      // Twenty quiet conversations woken in a day.
      const waker = await asHost(await person("limh4"), "limh4", `Limit Host Four ${RUN}`);
      const woken = await rawConversation(waker.id, sink.id);
      // One each, as twenty wakes are twenty conversations; here they are counted, so one row holds them.
      for (let i = 0; i < CONVERSATION.wakesPerDay - 1; i++) await rawMessages(woken.id, waker.id, 1, { woke: true, minutesAgo: 600 - i });
      const past = await person("lim7");
      const pastToo = await person("lim7b");
      await talkedPair(waker.id, past.id);
      await talkedPair(waker.id, pastToo.id);
      const quiet = (await openConversation({ userId: waker.id, customerId: past.id }))!;
      const quietToo = (await openConversation({ userId: waker.id, customerId: pastToo.id }))!;
      const lastWake = await Promise.all([say(quiet, waker.id), say(quietToo, waker.id)]);
      check("the twentieth conversation woken in a day, tried twice at once, is woken once", lastWake.filter(sent).length === 1 && lastWake.filter((r) => refusedAs(r) === "wakes").length === 1);
      check("after twenty conversations woken in a day, the twenty-first is refused", refusedAs(await say(lastWake[0].ok ? quietToo : quiet, waker.id)) === "wakes");
      const near = await person("lim8");
      const around = (await openConversation({ userId: waker.id, callId: (await agreed({ hostId: waker.id, customerId: near.id, startsInDays: 2 })).id }))!;
      check("a message around a call wakes nothing and still goes through", sent(await say(around, waker.id)));
    }

    // ----------------------------------------------------------------------
    console.log('\n9. "End call now" closes nothing; a block does. After an old "End call and report" the two are strangers again');
    {
      // A plain "End call now" (plans/50-end-call-now.md, decision 22): the call counts like any other that was not cancelled.
      const hostNow = await asHost(await person("nowh"), "nowh", `Now Host ${RUN}`);
      const guestNow = await person("nowc");
      const endedCall = await agreed({ hostId: hostNow.id, customerId: guestNow.id, startsInDays: -1, joined: [hostNow.id, guestNow.id], safetyEnded: new Date(Date.now() - DAY + 10 * MINUTE), endedNow: "customer" });
      const open = (await openConversation({ userId: hostNow.id, callId: endedCall.id }))!;
      check('after a plain "End call now", with no report and no block, both can still write', open !== null && sent(await say(open, hostNow.id, "Are you all right?")) && sent(await say(open, guestNow.id, "Yes, my connection broke.")));
      const nowView = (await viewFor(guestNow.id, open, new Date()))!;
      check("the conversation does not count as stopped, and the call counts as one they talked in", !nowView.facts.stopped && nowView.facts.aroundCall && nowView.facts.talked && nowView.shownRefusal === null);
      const { block: blockNow } = await import("../src/lib/safety/blocks");
      await blockNow({ blockerId: guestNow.id, blockedId: hostNow.id, now: new Date() });
      check("a block (and so a report, which blocks) closes it for both", refusedAs(await say(open, guestNow.id)) === "you_blocked" && refusedAs(await say(open, hostNow.id)) === "not_taking");
    }
    {
      // A call ended with the earlier button, "End call and report": that press did not block, so the two are cut off
      // until both have acted again (plans/49-messaging.md, decision 21, kept for such calls only).
      const host = await asHost(await person("stoph"), "stoph", `Stop Host ${RUN}`);
      const guest = await asHost(await person("stopc"), "stopc", `Stop Guest ${RUN}`);
      await talkedPair(host.id, guest.id);
      await talkedPair(guest.id, host.id);
      const booked = await agreed({ hostId: host.id, customerId: guest.id, startsInDays: 6 });
      const one = (await openConversation({ userId: host.id, customerId: guest.id }))!;
      const two = (await openConversation({ userId: guest.id, customerId: host.id }))!;
      await say(one, host.id, "Hello");
      await say(two, guest.id, "Hello");
      check("before it, both can write in both conversations", sent(await say(one, guest.id)) && sent(await say(two, host.id)));
      // A request the customer began before the old press and that is agreed after it.
      const begunBefore = new Date(Date.now() - 10 * MINUTE);
      const stop = new Date(Date.now() - 5 * MINUTE);
      await agreed({ hostId: host.id, customerId: guest.id, startsInDays: -1, joined: [host.id, guest.id], safetyEnded: stop });
      check("the press alone, with no report sent, closes both conversations for both", refusedAs(await say(one, host.id)) === "closed" && refusedAs(await say(one, guest.id)) === "book_again" && refusedAs(await say(two, guest.id)) === "closed" && refusedAs(await say(two, host.id)) === "book_again");
      const view = (await viewFor(guest.id, one, new Date()))!;
      check("an earlier call, a call already booked and her recent message do not keep it open, and no booking button is offered", view.shownRefusal === "closed" && view.bookHref === null && view.facts.stopped && booked.cancelledAt === null);
      await agreed({ hostId: host.id, customerId: guest.id, startsInDays: 3, source: "member", begunAt: new Date(), agreedAt: new Date() });
      check("a member's new booking, which the host is not asked about, opens nothing", refusedAs(await say(one, guest.id)) === "book_again");
      await agreed({ hostId: host.id, customerId: guest.id, startsInDays: 4, begunAt: begunBefore, agreedAt: new Date() });
      check("a request begun before the press and agreed after it opens nothing", refusedAs(await say(one, host.id)) === "closed");
      await agreed({ hostId: host.id, customerId: guest.id, startsInDays: 5, begunAt: new Date(stop.getTime() + 30_000), agreedAt: new Date() });
      check("a request begun within the minute after the press opens nothing either (the two moments come from two clocks)", refusedAs(await say(one, host.id)) === "closed");
      await agreed({ hostId: host.id, customerId: guest.id, startsInDays: 5, begunAt: new Date(), agreedAt: new Date() });
      check("a request begun after the press and accepted opens the conversation of its own direction", sent(await say(one, host.id, "About the new call")) && sent(await say(one, guest.id, "Yes")));
      check("and only that one: the other direction stays closed", refusedAs(await say(two, guest.id)) === "closed");
    }

    // ----------------------------------------------------------------------
    console.log("\n10. A paused or closed account, and the founder's switch");
    {
      const host = await asHost(await person("offh"), "offh", `Off Host ${RUN}`);
      const guest = await person("offc");
      const id = (await openConversation({ userId: host.id, callId: (await agreed({ hostId: host.id, customerId: guest.id, startsInDays: 2 })).id }))!;
      await say(id, host.id, "Hello");
      await db.update(schema.user).set({ pausedAt: new Date(), pausedReason: "check" }).where(eq(schema.user.id, guest.id));
      check("a paused person cannot write, and the other one still can", refusedAs(await say(id, guest.id)) === "paused" && sent(await say(id, host.id)));
      await db.update(schema.user).set({ pausedAt: null, pausedReason: null, closedAt: new Date() }).where(eq(schema.user.id, guest.id));
      check("nobody can write to a closed account", refusedAs(await say(id, host.id)) === "closed");
      check("and a closed account cannot write either (it can close while a message of its own waits)", refusedAs(await say(id, guest.id)) === "closed");
      await db.update(schema.user).set({ closedAt: null }).where(eq(schema.user.id, guest.id));

      await setSwitches({ conversationsOff: true });
      check("with the founder's switch off nothing can be sent", refusedAs(await say(id, host.id)) === "switched_off" && refusedAs(await say(talk, cory.id)) === "switched_off");
      const fresh = await person("offn");
      const freshCall = await agreed({ hostId: host.id, customerId: fresh.id, startsInDays: 2 });
      check("and no new conversation is opened", (await openConversation({ userId: host.id, callId: freshCall.id })) === null);
      const off = await page(`/conversations/${talk}`, cory.jar);
      check("the conversation can still be read, and says that messages are switched off", off.status === 200 && off.words.includes("Looking forward to it.") && off.words.includes("Messages are switched off for the moment.") && !off.html.includes("data-composer"));
      check("it is still listed on Messages", (await page("/messages", cory.jar)).html.includes("data-conversations"));
      await setSwitches({ conversationsOff: false });
      check("switched on again, messages go through", sent(await say(talk, cory.id, "Back again")));
    }

    // ----------------------------------------------------------------------
    console.log("\n11. Deleting messages 12 months after they were sent");
    {
      const host = await asHost(await person("oldh"), "oldh", `Old Host ${RUN}`);
      const guest = await person("oldc");
      const id = (await openConversation({ userId: host.id, callId: (await agreed({ hostId: host.id, customerId: guest.id, startsInDays: 2 })).id }))!;
      await say(id, host.id, "an old message");
      await say(id, guest.id, "an old answer");
      await say(id, host.id, "a message of eleven months ago");
      await say(id, guest.id, "a message of today");
      const monthsAgo = (months: number) => new Date(Date.now() - months * 30.5 * DAY);
      await db.update(schema.conversationMessages).set({ createdAt: monthsAgo(13) }).where(and(eq(schema.conversationMessages.conversationId, id), inArray(schema.conversationMessages.number, [1, 2])));
      await db.update(schema.conversationMessages).set({ createdAt: monthsAgo(11) }).where(and(eq(schema.conversationMessages.conversationId, id), eq(schema.conversationMessages.number, 3)));
      const other = (await openConversation({ userId: hana.id, callId: (await db.select({ id: schema.calls.id }).from(schema.calls).where(and(eq(schema.calls.hostId, hana.id), eq(schema.calls.customerId, cory.id))))[0].id }))!;
      const othersBefore = (await messagesIn(other)).length;
      const gone = await deleteOldConversationMessages(new Date(), { conversationIds: [id] });
      const left = await messagesIn(id);
      check("messages sent more than 12 months ago are deleted, later ones stay", gone === 2 && left.map((m) => m.number).join(",") === "3,4");
      check("the conversation itself stays, with the number of its last message", (await rowOf(id)).lastNumber === 4 && (await conversationFor(guest.id, id)) !== null);
      const next = await say(id, host.id, "the next one");
      check("the next message gets the next number, never an old one", next.ok && next.number === 5);
      check("nothing of another conversation was touched", (await messagesIn(other)).length === othersBefore);
      check("a second round finds nothing more to delete", (await deleteOldConversationMessages(new Date(), { conversationIds: [id] })) === 0 && (await deleteOldConversationMessages(new Date(), { conversationIds: [] })) === 0);
    }

    // ----------------------------------------------------------------------
    console.log("\n12. A report made from a message, what is kept with it, and the founder's look");
    {
      const host = await asHost(await person("reph"), "reph", `Report Host ${RUN}`);
      const guest = await person("repc");
      const founder = await person("repadmin");
      const id = (await openConversation({ userId: host.id, callId: (await agreed({ hostId: host.id, customerId: guest.id, startsInDays: 2 })).id }))!;
      // 200 messages, each with words of its own; then she writes the one that is reported, and he answers.
      // (Two days old, so that they do not count against today's hundred.)
      const at = new Date(Date.now() - 2 * DAY);
      await db.insert(schema.conversationMessages).values(Array.from({ length: 200 }, (_, i) => ({ conversationId: id, number: i + 1, senderId: i % 2 === 0 ? host.id : guest.id, body: `earlier words ${i + 1} ${RUN}`, sendKey: randomUUID(), createdAt: at })));
      await db.update(schema.conversations).set({ lastNumber: 200, lastMessageAt: at }).where(eq(schema.conversations.id, id));
      const SECRET = `pay me outside ${RUN}`;
      const bad = await say(id, host.id, `Please ${SECRET}.`);
      const after = await say(id, guest.id, "No, thank you.");
      check("the two more messages are numbers 201 and 202", bad.ok && bad.number === 201 && after.ok && after.number === 202);
      const report = (who: string, place: string) => createReport({ reporterId: who, context: "message", contextId: place, reason: "offsite", text: "She asked me to pay outside.", now: new Date() });
      const refused = async (trying: Promise<unknown>) => trying.then(() => false, (error) => error instanceof ReportError);
      const reportsOf = async (who: string) => (await db.select({ id: schema.reports.id }).from(schema.reports).where(eq(schema.reports.reporterId, who))).length;

      check("a person cannot report their own message", await refused(report(host.id, messagePlaceText(id, 201))));
      check("someone who is not in the conversation cannot report a message in it", await refused(report(olga.id, messagePlaceText(id, 201))));
      check("a message that is not there cannot be reported", (await refused(report(guest.id, messagePlaceText(id, 999)))) && (await refused(report(guest.id, messagePlaceText(randomUUID(), 1)))));
      check("a place that is not a conversation and a number is refused", (await refused(report(guest.id, id))) && (await refused(report(guest.id, `${id}/0`))) && (await refused(report(guest.id, `${id}/1; drop table`))));
      check("none of those wrote a report or kept anything", (await reportsOf(host.id)) === 0 && (await reportsOf(olga.id)) === 0 && (await reportsOf(guest.id)) === 0 && (await db.select().from(schema.reportConversations).where(eq(schema.reportConversations.conversationId, id))).length === 0);

      const outcome = await report(guest.id, messagePlaceText(id, 201));
      const [saved] = await db.select().from(schema.reports).where(eq(schema.reports.reference, outcome.reference));
      const [kept] = await db.select().from(schema.reportConversations).where(eq(schema.reportConversations.reportId, saved.id));
      const stretch = JSON.parse(kept.messages) as Array<{ number: number; from: string; at: string; body: string }>;
      check("the other person's message can be reported, about its writer, and the report blocks her", outcome.block === "done" && saved.reportedId === host.id && saved.context === "message" && refusedAs(await say(id, host.id)) === "not_taking");
      check(`what is kept: the message, ${KEPT_BEFORE} before it and what came after it, each with its number, writer, time and exact words`, kept.reportedNumber === 201 && stretch.length === KEPT_BEFORE + 2 && kept.keptCount === stretch.length && stretch[0].number === 201 - KEPT_BEFORE && stretch.at(-1)!.number === 202 && stretch.find((m) => m.number === 201)?.body === `Please ${SECRET}.` && stretch.find((m) => m.number === 201)?.from === "reported" && stretch.at(-1)!.from === "reporter" && stretch.every((m) => !Number.isNaN(Date.parse(m.at))));
      check("and how many older ones were left out", kept.olderLeftOut === 200 - KEPT_BEFORE);
      check("the report's own copy holds where the message is, and none of its words", saved.snapshot.includes(id) && !saved.snapshot.includes(SECRET) && !saved.snapshot.includes("earlier words"));
      const listed = (await openReports()).find((entry) => entry.report.id === saved.id)!;
      check("the founder's list says that messages are kept and how many, and holds none of their words", listed.kept?.keptCount === stretch.length && listed.kept.olderLeftOut === 100 && !JSON.stringify(listed).includes(SECRET) && !JSON.stringify(listed).includes("earlier words"));

      // A message in the middle of a long conversation: a fixed stretch before it and after it, no more.
      const middle = await report(guest.id, messagePlaceText(id, 121));
      const [middleSaved] = await db.select().from(schema.reports).where(eq(schema.reports.reference, middle.reference));
      const [middleKept] = await db.select().from(schema.reportConversations).where(eq(schema.reportConversations.reportId, middleSaved.id));
      const middleStretch = JSON.parse(middleKept.messages) as Array<{ number: number }>;
      check(`a message in the middle keeps ${KEPT_BEFORE} before it and ${KEPT_AFTER} after it, and says how many older ones were left out`, middleStretch[0].number === 121 - KEPT_BEFORE && middleStretch.at(-1)!.number === 121 + KEPT_AFTER && middleStretch.length === KEPT_BEFORE + KEPT_AFTER + 1 && middleKept.olderLeftOut === 20);

      const looksBefore = (await db.select().from(schema.adminActions).where(eq(schema.adminActions.targetId, saved.id))).length;
      const failed = await keptMessagesFor({ adminId: `nobody-${RUN}`, reportId: saved.id }).then(() => false, () => true);
      check("when the look cannot be written down, nothing is given back", failed && (await db.select().from(schema.adminActions).where(eq(schema.adminActions.targetId, saved.id))).length === looksBefore);
      const look = await keptMessagesFor({ adminId: founder.id, reportId: saved.id });
      const looks = await db.select().from(schema.adminActions).where(eq(schema.adminActions.targetId, saved.id));
      check("the founder's look gives the kept messages back, and is in the record of admin actions", look?.messages.length === stretch.length && look.reportedNumber === 201 && looks.length === looksBefore + 1 && looks[0].action === "kept messages read" && looks[0].adminId === founder.id && looks[0].targetUserId === host.id);
      check("the record names the report and holds none of the words", looks[0].detail === `R-${outcome.reference}` && !JSON.stringify(looks).includes(SECRET));
      await keptMessagesFor({ adminId: founder.id, reportId: saved.id });
      check("a second look is written down again", (await db.select().from(schema.adminActions).where(eq(schema.adminActions.targetId, saved.id))).length === looksBefore + 2);
      check("a report with nothing kept gives nothing back and writes nothing down", (await keptMessagesFor({ adminId: founder.id, reportId: randomUUID() })) === null);

      // The helper deletes old messages without the conversation's lock. A message that goes between "it is there"
      // and the keeping must stop the report: what is kept is read in one question, and the message must be in it.
      const keeping = (number: number) => db.transaction((tx) => keepMessages(tx, randomUUID(), guest.id, messagePlaceText(id, number))).then(() => "kept", (error) => (error instanceof MessageGoneError ? "gone" : "other"));
      const couldReport = (await reportableMessage(db, guest.id, messagePlaceText(id, 151))) !== null;
      await db.delete(schema.conversationMessages).where(and(eq(schema.conversationMessages.conversationId, id), eq(schema.conversationMessages.number, 151)));
      check("a message that was there a moment ago and is gone when the report is written stops the report, with its neighbours still there", couldReport && (await keeping(151)) === "gone" && (await refused(report(guest.id, messagePlaceText(id, 151)))) && (await messagesIn(id)).some((m) => m.number === 150) && (await messagesIn(id)).some((m) => m.number === 152));
      check("so does a message of the reporter's own, and a conversation that is not theirs", (await keeping(150)) === "gone" && (await db.transaction((tx) => keepMessages(tx, randomUUID(), olga.id, messagePlaceText(id, 153))).then(() => false, (error) => error instanceof MessageGoneError)));
      check("none of that kept anything", (await db.select().from(schema.reportConversations).where(eq(schema.reportConversations.conversationId, id))).length === 2);

      // What is kept does not go when the messages do.
      await db.update(schema.conversationMessages).set({ createdAt: new Date(Date.now() - 400 * DAY) }).where(eq(schema.conversationMessages.conversationId, id));
      const deleted = await deleteOldConversationMessages(new Date(), { conversationIds: [id] });
      const [still] = await db.select().from(schema.reportConversations).where(eq(schema.reportConversations.reportId, saved.id));
      check("when the messages are deleted after 12 months, what is kept with the report stays", deleted === 201 && (await messagesIn(id)).length === 0 && still.messages.includes(SECRET));
      check("a message that was deleted can no longer be reported", await refused(report(guest.id, messagePlaceText(id, 153))));
      const emptied = await page(`/conversations/${talk}`, cory.jar);
      check("(a conversation that still has messages does not say that none remain)", !emptied.words.includes("No messages remain"));

      // With messages switched off, and for a paused person, a report can still be made.
      const host2 = await asHost(await person("reph2"), "reph2", `Report Host Two ${RUN}`);
      const guest2 = await person("repc2");
      const id2 = (await openConversation({ userId: host2.id, callId: (await agreed({ hostId: host2.id, customerId: guest2.id, startsInDays: 2 })).id }))!;
      await say(id2, host2.id, "A message to report");
      await setSwitches({ conversationsOff: true });
      await db.update(schema.user).set({ pausedAt: new Date(), pausedReason: "check" }).where(eq(schema.user.id, guest2.id));
      // (The form's own function cannot be loaded outside the app; its two steps are taken here: the report, then its sentence.)
      const whileOff = reportNotice(await createReport({ reporterId: guest2.id, context: "message", contextId: messagePlaceText(id2, 1), reason: "other", text: "", now: new Date() }));
      await setSwitches({ conversationsOff: false });
      check("with messages switched off, a paused person can still report a message, and reads the usual thank-you", !whileOff.needsReceipt && /^Thank you\. Your report is R-\d+\./.test(whileOff.notice) && (await db.select().from(schema.reportConversations).where(eq(schema.reportConversations.conversationId, id2))).length === 1);

      // In the pages, with the people who have logins: Olga reports a message of Hana's.
      const quiet = (await conversationsBetween(hana.id, olga.id))[0].id;
      await setMuted(olga.id, quiet, false, new Date());
      await say(quiet, hana.id, "One more message for Olga");
      const hers = await page(`/conversations/${quiet}`, hana.jar);
      const his = await page(`/conversations/${quiet}`, olga.jar);
      const theirs = (await messagesIn(quiet)).filter((m) => m.senderId === hana.id).map((m) => m.number);
      check("Report is beside each message of the other person, and beside none of one's own", theirs.every((n) => his.html.includes(`data-report-message="${n}"`) && !hers.html.includes(`data-report-message="${n}"`)) && count(his.html, "data-report-message=") === theirs.length);
      const place = encodeURIComponent(messagePlaceText(quiet, theirs.at(-1)!));
      const form = await page(`/report?message=${place}`, olga.jar);
      check("the link leads to the report form, for that message", his.html.includes(`/report?message=${place}`) && form.status === 200 && form.html.includes('name="context" value="message"') && form.html.includes(`value="${messagePlaceText(quiet, theirs.at(-1)!)}"`));
      const made = await createReport({ reporterId: olga.id, context: "message", contextId: messagePlaceText(quiet, theirs.at(-1)!), reason: "other", text: "", now: new Date() });
      const receipt = await page(`/report/saved/${made.reference}`, olga.jar);
      check("the reporter can open the receipt of her report, with its number and a Block button that names only the report", receipt.status === 200 && receipt.html.includes(`data-report-receipt="${made.reference}"`) && receipt.words.includes(`R-${made.reference}`) && receipt.html.includes("data-block-reported") && receipt.html.includes(`name="reference" value="${made.reference}"`) && !receipt.html.includes(hana.id));
      check("nobody else can, and a number that is no report gives Not found", (await page(`/report/saved/${made.reference}`, hana.jar)).status === 404 && (await page(`/report/saved/${made.reference}`, cory.jar)).status === 404 && (await page("/report/saved/999999999", olga.jar)).status === 404 && (await page("/report/saved/x", olga.jar)).status === 404);
      check("the receipt needs a login", [302, 303, 307].includes((await page(`/report/saved/${made.reference}`)).status));
      check("after the report the reported host is refused, and reads the sentence of the switch", (await page(`/conversations/${quiet}`, hana.jar)).words.includes(`${olga.name} is not taking messages right now.`));
    }
  } finally {
    await setSwitches({ conversationsOff: wasOff });
    // Also a sign-up whose person was never written down here, because its confirmation failed.
    for (const row of await db.select({ id: schema.user.id }).from(schema.user).where(like(schema.user.email, `talkcheck-${RUN}-%`))) if (!made.includes(row.id)) made.push(row.id);
    const ids = made.length ? made : ["-"];
    const callIds = calls.length ? calls : [randomUUID()];
    const mine = (await db.select({ id: schema.conversations.id }).from(schema.conversations).where(or(inArray(schema.conversations.hostId, ids), inArray(schema.conversations.customerId, ids)))).map((row) => row.id);
    const myReports = (await db.select({ id: schema.reports.id }).from(schema.reports).where(or(inArray(schema.reports.reporterId, ids), inArray(schema.reports.reportedId, ids)))).map((row) => row.id);
    if (myReports.length) await db.delete(schema.reportConversations).where(inArray(schema.reportConversations.reportId, myReports));
    await db.delete(schema.adminActions).where(or(inArray(schema.adminActions.adminId, ids), inArray(schema.adminActions.targetUserId, ids)));
    if (myReports.length) await db.delete(schema.reports).where(inArray(schema.reports.id, myReports));
    if (mine.length) await db.delete(schema.conversationMessages).where(inArray(schema.conversationMessages.conversationId, mine));
    if (mine.length) await db.delete(schema.conversations).where(inArray(schema.conversations.id, mine));
    await db.delete(schema.attendanceEvents).where(inArray(schema.attendanceEvents.callId, callIds));
    await db.delete(schema.bookings).where(or(inArray(schema.bookings.hostId, ids), inArray(schema.bookings.customerId, ids)));
    await db.delete(schema.follows).where(or(inArray(schema.follows.followerId, ids), inArray(schema.follows.hostId, ids)));
    await db.delete(schema.blocks).where(or(inArray(schema.blocks.blockerId, ids), inArray(schema.blocks.blockedId, ids)));
    await db.delete(schema.payments).where(inArray(schema.payments.callId, callIds));
    await db.delete(schema.calls).where(inArray(schema.calls.id, callIds));
    await db.delete(schema.messages).where(inArray(schema.messages.userId, ids));
    await db.delete(schema.weeklyHours).where(inArray(schema.weeklyHours.hostId, ids));
    await db.delete(schema.hostCalendars).where(inArray(schema.hostCalendars.userId, ids));
    await db.delete(schema.hostProfiles).where(inArray(schema.hostProfiles.userId, ids));
    await db.delete(schema.emailOutbox).where(like(schema.emailOutbox.to, `talkcheck-${RUN}-%`));
    await db.delete(schema.session).where(inArray(schema.session.userId, ids));
    await db.delete(schema.account).where(inArray(schema.account.userId, ids));
    await db.delete(schema.user).where(inArray(schema.user.id, ids));
    await db.delete(schema.rateLimit);
  }

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
