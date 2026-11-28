/**
 * Testing tool: asks the app running on this computer for the home page the way the phone app
 * does, and checks it (plans/45-phone-apps/04-the-home-page.md): as someone new, as a customer,
 * as a host, and as someone who is both; the nine rules the home page's builders left for a phone
 * version, each by name; that nothing of a diary or a project is in the answer; the four steps of
 * "Suggested hosts"; and photos, for those who may see them and those who may not.
 *
 * It empties the table of attempt limits as it goes, so it only runs against a database made for
 * checking (its name must end in "_check"), never the one other work shares. It removes what it
 * made.
 *
 * Usage: DATABASE_URL=…/something_check npx tsx scripts/app-home-check.ts [--app=http://localhost:3000]
 * (the app must be running against the same database)
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { randomBytes, randomUUID } from "node:crypto";
import http from "node:http";
import { and, desc, eq, inArray, like, or, sql } from "drizzle-orm";
import { APP_ORIGIN } from "../src/lib/auth-rules";
import { APP_HEADER, SIGN_IN_HEADER } from "../src/lib/app-door/rules";
import type { AppCalls, AppHome, Refusal } from "../src/lib/app-door/types";
import { TERMS_VERSION } from "../src/lib/terms";
import { requireLocalDatabase } from "./local-only";

const BASE = process.argv.find((arg) => arg.startsWith("--app="))?.slice("--app=".length).replace(/\/$/, "") ?? "http://localhost:3000";
const RUN = randomUUID().slice(0, 8);
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}

type Jar = Map<string, string>;
type Reply = { status: number; json: unknown; text: string; bytes: Buffer; headers: http.IncomingHttpHeaders };

/**
 * One request sent exactly as given, with nothing added. (The usual `fetch` of this tool adds a
 * browser-like mark of its own to every request, which a phone app does not send, and which the
 * door rightly refuses.)
 */
function plain(path: string, options: { body?: unknown; headers?: Record<string, string>; jar?: Jar } = {}): Promise<Reply> {
  const url = new URL(path.startsWith("http") ? path : `${BASE}${path}`);
  const payload = options.body !== undefined ? JSON.stringify(options.body) : undefined;
  const headers: Record<string, string> = { ...options.headers };
  if (payload !== undefined) {
    headers["content-type"] = "application/json";
    headers["content-length"] = String(Buffer.byteLength(payload));
  }
  return new Promise((resolve, reject) => {
    const request = http.request(url, { method: payload !== undefined ? "POST" : "GET", headers }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => {
        const bytes = Buffer.concat(chunks);
        const text = bytes.toString("utf8");
        for (const cookie of response.headers["set-cookie"] ?? []) {
          const [pair, ...attributes] = cookie.split(";");
          const at = pair.indexOf("=");
          const name = pair.slice(0, at).trim();
          const value = pair.slice(at + 1);
          if (!value || attributes.some((a) => /^\s*max-age=0\s*$/i.test(a))) options.jar?.delete(name);
          else options.jar?.set(name, value);
        }
        let json: unknown = null;
        try {
          json = JSON.parse(text);
        } catch {
          // not JSON
        }
        resolve({ status: response.statusCode ?? 0, json, text, bytes, headers: response.headers });
      });
    });
    request.on("error", reject);
    if (payload !== undefined) request.write(payload);
    request.end();
  });
}
const asCookie = (jar: Jar) => [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
/** A request the way the phone app sends it: to the door with its sign-in in the app's own header, to the login tool as the kit does. */
function asApp(path: string, options: { body?: unknown; jar?: Jar } = {}): Promise<Reply> {
  const kept = options.jar?.size ? asCookie(options.jar) : null;
  const headers: Record<string, string> = { [APP_HEADER]: "android 1.0.0" };
  if (path.startsWith("/api/app/")) {
    if (kept) headers[SIGN_IN_HEADER] = kept;
  } else {
    headers["expo-origin"] = APP_ORIGIN;
    if (kept) headers.cookie = kept;
  }
  return plain(path, { ...options, headers });
}
/** A request the way a browser on our own site sends it. */
function asBrowser(path: string, options: { body?: unknown; jar?: Jar } = {}): Promise<Reply> {
  const headers: Record<string, string> = { origin: BASE, "sec-fetch-site": "same-origin", "sec-fetch-mode": "cors", "sec-fetch-dest": "empty" };
  if (options.jar?.size) headers.cookie = asCookie(options.jar);
  return plain(path, { ...options, headers });
}
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const refusal = (reply: Reply) => (reply.json as Refusal | null)?.error?.code ?? `no code, status ${reply.status}`;
/** Every name of a part anywhere in an answer, however deep. */
function namesIn(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) for (const item of value) namesIn(item, found);
  else if (value !== null && typeof value === "object") {
    for (const [name, inner] of Object.entries(value)) {
      found.add(name);
      namesIn(inner, found);
    }
  }
  return found;
}
/** The day, as the calendar names it, so many days from now on the world's clock. */
const dayFromNow = (days: number) => new Date(Date.now() + days * DAY).toISOString().slice(0, 10);

async function main() {
  requireLocalDatabase();
  const setting = new URL(process.env.DATABASE_URL ?? "");
  for (const override of ["database", "dbname", "host", "hostaddr", "port", "service"]) {
    if (setting.searchParams.has(override)) throw new Error(`DATABASE_URL must name its database in the address itself, not with "?${override}=".`);
  }
  const { db, schema } = await import("../src/db");
  const [{ name: database }] = (await db.execute(sql`select current_database() as name`)) as unknown as { name: string }[];
  if (!database.endsWith("_check")) throw new Error(`This script empties the attempt limits, so it only runs against a database made for checking (a name ending in "_check"), not "${database}".`);
  const up = await asBrowser("/login").catch(() => null);
  if (!up || up.status !== 200) throw new Error(`The app is not running at ${BASE}. Start it first.`);
  await db.delete(schema.rateLimit);

  const now = new Date();
  const made: string[] = [];
  const calls: string[] = [];
  const home = async (jar: Jar, day?: string) => {
    const reply = await asApp(`/api/app/home${day ? `?day=${day}` : ""}`, { jar });
    return { reply, body: reply.status === 200 ? (reply.json as AppHome) : null };
  };

  /** Signs up the app's way, confirms the email in a browser, finishes "18 and terms" (pretended), and signs in the app's way. */
  async function newPerson(name: string) {
    const person = { name: `Home ${name} ${RUN}`, email: `apphome-${RUN}-${name}@example.test`, password: randomBytes(12).toString("base64url"), jar: new Map() as Jar };
    await asApp("/api/auth/sign-up/email", { body: { name: person.name, email: person.email, password: person.password, callbackURL: `${BASE}/welcome` } });
    let link = "";
    for (let i = 0; i < 25 && !link; i++) {
      const found = await db.select().from(schema.emailOutbox).where(and(eq(schema.emailOutbox.to, person.email), like(schema.emailOutbox.subject, "%Confirm your email%"))).orderBy(desc(schema.emailOutbox.createdAt));
      link = found[0]?.body.match(/https?:\/\/\S+/)?.[0] ?? "";
      if (!link) await pause(200);
    }
    if (!link) throw new Error(`No confirmation email for ${person.email}`);
    await asBrowser(link, { jar: new Map() });
    const [row] = await db.select().from(schema.user).where(eq(schema.user.email, person.email));
    made.push(row.id);
    await db.update(schema.user).set({ adultConfirmedAt: now, termsAcceptedAt: now, termsVersion: TERMS_VERSION, timeZone: "America/New_York" }).where(eq(schema.user.id, row.id));
    const signIn = await asApp("/api/auth/sign-in/email", { body: { email: person.email, password: person.password }, jar: person.jar });
    if (signIn.status !== 200) throw new Error(`Could not sign in ${person.email} the app's way: ${signIn.status}`);
    return { ...person, id: row.id };
  }
  /** A person who never signs in here, written straight to the database. */
  async function person(name: string) {
    const id = `ah-${RUN}-${name}`;
    const email = `apphome-${RUN}-${name}@example.test`;
    await db.insert(schema.user).values({ id, name: `Account ${name} ${RUN}`, email, emailVerified: true, adultConfirmedAt: now, termsAcceptedAt: now, termsVersion: TERMS_VERSION, timeZone: "America/New_York" });
    made.push(id);
    return { id, name: `Account ${name} ${RUN}`, email };
  }
  /** Makes someone a host whose page is open to everyone. */
  async function asHost<T extends { id: string }>(who: T, name: string, displayName: string) {
    const handle = `ah${RUN}${name}`.toLowerCase();
    await db.insert(schema.hostProfiles).values({ userId: who.id, handle, handleKey: handle, displayName, pricePer15Cents: 0, status: "approved", usConfirmedAt: now });
    return { ...who, handle, displayName };
  }
  /** A host who can be asked for a call right now: free calls, a calendar open all week, "Available now" on. */
  async function goOnline(hostId: string) {
    await db.insert(schema.hostCalendars).values({ userId: hostId, timeZone: "America/New_York", lengths: "15,30", noticeHours: 24, horizonWeeks: 2, breakMinutes: 5 });
    await db.insert(schema.weeklyHours).values([1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ hostId, weekday, startMinute: 0, endMinute: 1440 })));
    const at = new Date();
    await db.update(schema.hostCalendars).set({ availableUntil: new Date(at.getTime() + 60 * MINUTE), availableSeenAt: at }).where(eq(schema.hostCalendars.userId, hostId));
  }
  /** A call of 30 minutes that starts so many minutes from now (a negative number: it started that long ago), with the request it came from. */
  async function call(input: { hostId: string; customerId: string; startsInMinutes: number; words?: string }) {
    const startsAt = new Date(Math.floor((Date.now() + input.startsInMinutes * MINUTE) / 1000) * 1000);
    const endsAt = new Date(startsAt.getTime() + 30 * MINUTE);
    const [row] = await db
      .insert(schema.calls)
      .values({ hostId: input.hostId, customerId: input.customerId, startsAt, endsAt, roomName: `apphome-${randomUUID()}`, closedAt: endsAt.getTime() < Date.now() ? new Date(endsAt.getTime() + 1000) : null })
      .returning();
    calls.push(row.id);
    await db.insert(schema.bookings).values({ hostId: row.hostId, customerId: row.customerId, startsAt, endsAt, lengthMinutes: 30, breakMinutes: 5, pricePer15Cents: 0, totalCents: 0, freeCancelMinutes: 0, note: input.words ?? "", stage: "accepted", requestKey: randomUUID(), source: "customer", requestedAt: now, decidedAt: now, callId: row.id });
    return row;
  }
  /** A request that waits for the host's answer. */
  async function waitingRequest(hostId: string, customerId: string, startsInMinutes: number, words: string) {
    const startsAt = new Date(Math.floor((Date.now() + startsInMinutes * MINUTE) / 1000) * 1000);
    const [row] = await db
      .insert(schema.bookings)
      .values({ hostId, customerId, startsAt, endsAt: new Date(startsAt.getTime() + 30 * MINUTE), lengthMinutes: 30, breakMinutes: 5, pricePer15Cents: 0, totalCents: 0, freeCancelMinutes: 0, note: words, stage: "waiting", requestKey: randomUUID(), requestedAt: now, respondBy: new Date(Date.now() + 2 * 60 * MINUTE) })
      .returning();
    return row;
  }
  const photoOf = async (userId: string) =>
    (await db.insert(schema.hostPhotos).values({ userId, network: "upload", width: 8, height: 8, byteLength: 5, sha256: randomUUID(), bytes: Buffer.from("photo"), takenAt: now, checkedBy: "apphomecheck", rulesVersion: "apphomecheck" }).returning({ id: schema.hostPhotos.id }))[0].id;

  try {
    // ----------------------------------------------------------------------
    console.log("\n1. Who may ask, and someone new");
    const cust = await newPerson("cust");
    {
      check("nobody signed in is refused", refusal(await asApp("/api/app/home")) === "not_signed_in");
      check("a browser is refused, signed in or not", refusal(await asBrowser("/api/app/home", { jar: cust.jar })) === "not_the_app");
      const { reply, body } = await home(cust.jar);
      check("a new person gets a home page with their first name", reply.status === 200 && body?.firstName === "Home", `${reply.status}`);
      check("it may not be kept by anything on the way", String(reply.headers["cache-control"]).includes("no-store"));
      check("no call: the card has its sentence, and no countdown", body?.next === null && body.noCall === "Welcome to Connect. Find someone you follow, and ask them for a call.");
      check("nothing of what they do not have", body?.calls.length === 0 && body.calendar.shown === false && body.hosting === null && body.toAnswer.count === 0 && body.toRate.length === 0 && body.requests.length === 0 && body.followed.total === 0);
      check("the last line offers to take calls", body?.takeCalls === true);
      check(
        "the answer has exactly the parts the app knows",
        Object.keys(body ?? {}).sort().join(",") === "calendar,calls,firstName,followed,hosting,next,noCall,refreshSeconds,requests,serverNow,suggested,takeCalls,toAnswer,toRate",
        Object.keys(body ?? {}).sort().join(","),
      );
      // Someone who has not done "18 and terms" is sent to that step.
      await db.update(schema.user).set({ termsVersion: "older" }).where(eq(schema.user.id, cust.id));
      check("someone with '18 and terms' still to do is refused with that", refusal(await asApp("/api/app/home", { jar: cust.jar })) === "welcome_needed");
      await db.update(schema.user).set({ termsVersion: TERMS_VERSION }).where(eq(schema.user.id, cust.id));
    }

    // ----------------------------------------------------------------------
    console.log("\n2. A customer: a call booked, a request, a followed host");
    const hostA = await asHost(await person("hosta"), "hosta", `Host A ${RUN}`);
    const hostB = await asHost(await person("hostb"), "hostb", `Host B ${RUN}`);
    await goOnline(hostB.id);
    const hostAPhoto = await photoOf(hostA.id);
    const booked = await call({ hostId: hostA.id, customerId: cust.id, startsInMinutes: 30, words: "About my channel" });
    await db.insert(schema.payments).values({ callId: booked.id, coversFrom: booked.startsAt, coversUntil: booked.endsAt, pricePer15Cents: 2000, bookedCents: 4000, feePercentBps: 490, feeFixedCents: 30, feeForeignCardBps: 150 });
    const asked = await waitingRequest(hostB.id, cust.id, 3 * 24 * 60, "Could we talk?");
    await db.insert(schema.follows).values([hostA, hostB].map((h) => ({ followerId: cust.id, hostId: h.id, how: "self" })));
    {
      const { body } = await home(cust.jar);
      const one = body?.calls.find((c) => c.id === booked.id);
      check("the call is there, by the host's name on her page, as a call they booked", one?.name === hostA.displayName && one.hosting === false && one.finished === false && one.minutes === 30);
      check("with the host's photo, by its id", one?.photoId === hostAPhoto);
      check("it is the next call, with when its room opens", body?.next?.id === booked.id && typeof body.next.opensAt === "string" && body.noCall === null);
      check("rule 1: nothing about a customer on a call they booked", one !== undefined && !("about" in one));
      check("rule 3: a call they booked says what they pay, never what a host earned", one?.payment === "$40.00, not paid yet" && !("earned" in one) && !("moneyOpen" in one), one?.payment);
      check("the calendar is shown, for today", body?.calendar.shown === true && body.calendar.day === null && body.calendar.cut === false);
      const mine = body?.requests.find((r) => r.id === asked.id);
      check("their own request, with the host's name and how it stands", mine?.hostName === hostB.displayName && mine.words === "waiting for the host's answer", mine?.words);
      check("the hosts they follow, the one who is available first", body?.followed.total === 2 && body.followed.hosts[0]?.name === hostB.displayName && body.followed.hosts[0].available === true && body.followed.hosts[1]?.available === false);
      check("a followed host is a name, a page, 'available' and a photo, and nothing else", body?.followed.hosts.every((h) => Object.keys(h).sort().join(",") === "available,handle,name,photoId") === true);
      check("they are not a host: no hosting line, nothing to answer", body?.hosting === null && body.toAnswer.count === 0 && body.takeCalls === false);
    }

    // ----------------------------------------------------------------------
    console.log("\n3. A host: what she is told about a customer, what she earned, requests");
    const hostC = await asHost(await newPerson("hostc"), "hostc", `Host C ${RUN}`);
    const other = await person("other");
    const custPhoto = await photoOf(cust.id);
    const coming = await call({ hostId: hostC.id, customerId: cust.id, startsInMinutes: 60, words: "A question about lighting" });
    const past = await call({ hostId: hostC.id, customerId: other.id, startsInMinutes: -3 * 60 });
    const fee = Math.round(4000 * 0.049) + 30;
    await db.insert(schema.payments).values({ callId: past.id, coversFrom: past.startsAt, coversUntil: past.endsAt, pricePer15Cents: 2000, bookedCents: 4000, feePercentBps: 490, feeFixedCents: 30, feeForeignCardBps: 150, status: "charged", chargedCents: 4000, chargedAt: past.endsAt, originalFeeCents: fee, originalHostShareCents: 4000 - fee });
    // Her own note about this customer, and another host's note about the same customer, which she must never be handed.
    await db.insert(schema.hostNotes).values([
      { hostId: hostC.id, customerId: cust.id, text: "My own note about this customer" },
      { hostId: hostA.id, customerId: cust.id, text: "Another host's private note" },
    ]);
    // Two people ask for the very same time.
    const first = await waitingRequest(hostC.id, other.id, 2 * 24 * 60, "First asker");
    const [second] = await db
      .insert(schema.bookings)
      .values({ hostId: hostC.id, customerId: cust.id, startsAt: first.startsAt, endsAt: first.endsAt, lengthMinutes: 30, breakMinutes: 5, pricePer15Cents: 0, totalCents: 0, freeCancelMinutes: 0, note: "Second asker, same time", stage: "waiting", requestKey: randomUUID(), requestedAt: now, respondBy: new Date(Date.now() + 2 * 60 * MINUTE) })
      .returning();
    const asks = [first, second];
    {
      const { reply, body } = await home(hostC.jar);
      const text = reply.text;
      const hosted = body?.calls.find((c) => c.id === coming.id);
      const finished = body?.calls.find((c) => c.id === past.id);
      check("she has hosting to do, and her page is named", body?.hosting?.page === hostC.handle);
      check("rule 1: about the customer of a call she hosts that is not over", hosted?.hosting === true && hosted.about?.words === "A question about lighting" && typeof hosted.about.idConfirmed === "boolean" && typeof hosted.about.callsBefore === "number");
      check("rule 1: exactly the six things, no more", Object.keys(hosted?.about ?? {}).sort().join(",") === "callsBefore,idConfirmed,lastCallAt,member,note,words", Object.keys(hosted?.about ?? {}).join(","));
      check("the customer's photo, because she is handed one for a booked call", hosted?.photoId === custPhoto);
      check("rule 1: nothing about the customer of a call that is over", finished !== undefined && !("about" in finished) && finished.photoId === null);
      check("rule 2: no customer's email anywhere in the answer", !text.includes(cust.email) && !text.includes(other.email));
      check("rule 2 and rule 5: her own note comes with the call (the app folds it in lists); another host's note never does", hosted?.about?.note === "My own note about this customer" && !text.includes("Another host's private note"), String(hosted?.about?.note));
      check("rule 2: no part named for an email, an ID's name, a card, or an account's id", ![...namesIn(body)].some((name) => /email|card|idName|legalName|customerId|hostId|userId/i.test(name)), [...namesIn(body)].filter((name) => /email|card|idName|legalName|customerId|hostId|userId/i.test(name)).join(","));
      check("rule 3: a finished call she hosted says what it earned, by the one rule", finished?.finished === true && finished.earned?.cents === 4000 - fee && finished.earned.soFar === false, JSON.stringify(finished?.earned));
      check("rule 3: a call that is not over has earned nothing yet", hosted !== undefined && !("earned" in hosted));
      check("rule 4: a time asked for is a start, an end and a count, and two people asking for one time are one", body?.calendar.asks.length === 1 && body.calendar.asks[0].count === 2 && Object.keys(body.calendar.asks[0]).sort().join(",") === "count,endsAt,startsAt");
      check("the requests to answer: how many, at how many times, each with a name, a length, a price and a time to answer by", body?.toAnswer.count === 2 && body.toAnswer.times === 1 && body.toAnswer.shown.length === 2 && body.toAnswer.shown.every((r) => asks.some((a) => a.id === r.id) && r.minutes === 30 && r.price === "free" && typeof r.respondBy === "string"));
      check("a request in the list carries nothing more about the person who asked (that is the request's own screen)", body?.toAnswer.shown.every((r) => Object.keys(r).sort().join(",") === "endsAt,id,minutes,name,price,respondBy,startsAt") === true);
      // (plans/45-phone-apps/09a-what-is-built-put-right.md, decision 6.) The home page's own numbers, its calendar's
      // groups and the names on it follow the same rule as the list of requests: a request whose two people may no
      // longer act (an account paused or closed, or a block between them, written straight into the database here, so
      // nothing has been tidied up) is not counted, not grouped and not named.
      {
        const answerOf = async () => (await home(hostC.jar)).body;
        const only = (page: Awaited<ReturnType<typeof answerOf>>, kept: { id: string }, leftOut: { name: string }) =>
          page?.toAnswer.count === 1 && page.toAnswer.times === 1 && page.toAnswer.shown.length === 1 && page.toAnswer.shown[0].id === kept.id && !page.toAnswer.shown.some((r) => r.name === leftOut.name) && page.calendar.asks.length === 1 && page.calendar.asks[0].count === 1;
        try {
          await db.update(schema.user).set({ pausedAt: new Date() }).where(eq(schema.user.id, other.id));
          check("a customer paused a moment ago: his request is not in the number, not in the calendar's group, and not named", only(await answerOf(), second, other));
          await db.update(schema.user).set({ pausedAt: null, closedAt: new Date() }).where(eq(schema.user.id, other.id));
          check("the same for a customer whose account was closed a moment ago", only(await answerOf(), second, other));
          await db.update(schema.user).set({ closedAt: null }).where(eq(schema.user.id, other.id));
          await db.insert(schema.blocks).values({ blockerId: cust.id, blockedId: hostC.id });
          check("and across a block, whoever blocked whom", only(await answerOf(), first, cust));
          await db.delete(schema.blocks).where(and(eq(schema.blocks.blockerId, cust.id), eq(schema.blocks.blockedId, hostC.id)));
          await db.update(schema.user).set({ pausedAt: new Date() }).where(eq(schema.user.id, hostC.id));
          const hers = await answerOf();
          check("a host paused a moment ago has nothing to answer on her home page: no number, no group, no name", hers?.toAnswer.count === 0 && hers.toAnswer.times === 0 && hers.toAnswer.shown.length === 0 && hers.calendar.asks.length === 0);
        } finally {
          await db.update(schema.user).set({ pausedAt: null, closedAt: null }).where(inArray(schema.user.id, [other.id, hostC.id]));
          await db.delete(schema.blocks).where(and(eq(schema.blocks.blockerId, cust.id), eq(schema.blocks.blockedId, hostC.id)));
        }
        const back = await answerOf();
        check("with all of that lifted, both requests are counted, grouped and named again", back?.toAnswer.count === 2 && back.toAnswer.shown.length === 2 && back.calendar.asks[0]?.count === 2);
      }
      check("rule 6: no star rating beside any call", !body?.calls.some((c) => "rating" in c || "stars" in c));
      check("rule 9: nothing that opens a room: no room name, no key for the video service", !text.includes(coming.roomName) && !/roomName|token/i.test([...namesIn(body)].join(",")));
      // The customer of that call sees it as theirs, with nothing about themselves.
      const theirs = (await home(cust.jar)).body?.calls.find((c) => c.id === coming.id);
      check("the same call, asked for by its customer: booked, and nothing about a customer", theirs?.hosting === false && theirs !== undefined && !("about" in theirs) && theirs.name === hostC.displayName);
    }

    // ----------------------------------------------------------------------
    console.log("\n4. Someone who is both: one page");
    {
      const own = await call({ hostId: hostA.id, customerId: hostC.id, startsInMinutes: 5 * 60 });
      const { body } = await home(hostC.jar);
      const booked2 = body?.calls.find((c) => c.id === own.id);
      const hosted = body?.calls.find((c) => c.id === coming.id);
      check("a call she booked and a call she hosts are on the one page, each as what it is", booked2?.hosting === false && hosted?.hosting === true && !("about" in (booked2 ?? {})));
      check("the next call is the soonest of both kinds", body?.next?.id === coming.id);
    }

    // ----------------------------------------------------------------------
    console.log("\n5. The calendar: the day asked for, and never every call");
    {
      // She has three calls sooner than this one (in an hour, in five hours, in eight), so it is not one of "the soonest three".
      await call({ hostId: hostC.id, customerId: other.id, startsInMinutes: 8 * 60 });
      const far = await call({ hostId: hostC.id, customerId: other.id, startsInMinutes: 40 * 24 * 60 });
      const today = (await home(hostC.jar)).body;
      check("rule 8: a call far ahead is not loaded with today's days", today?.calls.some((c) => c.id === far.id) === false);
      const there = (await home(hostC.jar, dayFromNow(40))).body;
      check("rule 7: it comes when the calendar asks for its day", there?.calls.some((c) => c.id === far.id) === true && there.calendar.day === dayFromNow(40));
      check("rule 8: and the soonest calls for the card come along whatever the day", there?.calls.some((c) => c.id === coming.id) === true && there.next?.id === coming.id);
      const nonsense = (await home(hostC.jar, "not-a-day")).body;
      check("a day that is not one is read as today", nonsense?.calendar.day === null && nonsense.calls.some((c) => c.id === far.id) === false);
      check("rule 7: times are moments on the world's clock, for the phone to lay out in its own zone", today?.calls.every((c) => /Z$/.test(c.startsAt) && /Z$/.test(c.endsAt)) === true && /Z$/.test(today.serverNow));
    }

    // ----------------------------------------------------------------------
    console.log("\n6. Nothing of a diary or a project");
    {
      const { reply, body } = await home(cust.jar);
      const names = [...namesIn(body)];
      check("no part of the answer is named for a diary, a project, a post, news, a contribution or a tip", !names.some((name) => /diary|project|post|news|contribut|tip|tell/i.test(name)), names.filter((name) => /diary|project|post|news|contribut|tip|tell/i.test(name)).join(","));
      check("and none of those words is anywhere in it", !/diary|project|contribut/i.test(reply.text));
      check("the diary choice does not travel inside a followed host", !reply.text.includes("tellPosts") && !reply.text.includes("tellOnline") && !reply.text.includes("hoursFrom"));
    }

    // ----------------------------------------------------------------------
    console.log("\n7. Suggested hosts: the four steps");
    {
      const fresh = await newPerson("fresh");
      const sug = await asHost(await person("sug"), "sug", `Suggested ${RUN}`);
      await goOnline(sug.id);
      const before = (await home(fresh.jar)).body;
      check("reading the home page makes no suggestions", before?.suggested?.made === false && before.suggested.hosts.length === 0);
      check("reading it again still makes none", (await home(fresh.jar)).body?.suggested?.made === false);
      check("nobody signed in cannot ask for them to be made", refusal(await asApp("/api/app/suggestions/make", { body: {} })) === "not_signed_in");
      const make = await asApp("/api/app/suggestions/make", { body: {}, jar: fresh.jar });
      const after = (await home(fresh.jar)).body;
      check("the separate step makes today's", make.status === 200 && after?.suggested?.made === true, `${make.status}`);
      const shown = after?.suggested?.hosts.find((h) => h.handle === sug.handle);
      check("a host with an open time is among them, as a search result shows one", shown !== undefined && shown.name === sug.displayName && shown.price === "Free calls" && shown.seen === false && shown.availableNow === true, JSON.stringify(shown ?? after?.suggested?.hosts.map((h) => h.handle)));
      check("a suggested host says nothing of why, and carries no account id", after?.suggested?.hosts.every((h) => Object.keys(h).sort().join(",") === "availableNow,handle,languages,name,nextOpen,photoId,place,price,rating,seen") === true);
      if (shown && after?.suggested) {
        const day = after.suggested.day;
        check("'seen' needs a day and places", refusal(await asApp("/api/app/suggestions/seen", { body: { day }, jar: fresh.jar })) === "not_valid");
        const seen = await asApp("/api/app/suggestions/seen", { body: { day, places: [shown.place] }, jar: fresh.jar });
        check("'seen' marks the card as seen", seen.status === 200 && (await home(fresh.jar)).body?.suggested?.hosts.find((h) => h.handle === sug.handle)?.seen === true);
        const [line] = await db.select().from(schema.suggestionShows).where(and(eq(schema.suggestionShows.viewerId, fresh.id), eq(schema.suggestionShows.hostId, sug.id)));
        const opened = await asApp("/api/app/suggestions/opened", { body: { day, place: shown.place }, jar: fresh.jar });
        const [lineAfter] = await db.select().from(schema.suggestionShows).where(and(eq(schema.suggestionShows.viewerId, fresh.id), eq(schema.suggestionShows.hostId, sug.id)));
        check("'opened' is recorded on the person's own line", opened.status === 200 && line.openedAt === null && lineAfter.openedAt !== null);
        // Another person's steps cannot touch someone else's lines: a second person with an untouched line of her own,
        // and a stranger who sends "seen", "opened" and "hide" for every place and for that very host.
        const victim = await newPerson("victim");
        await asApp("/api/app/suggestions/make", { body: {}, jar: victim.jar });
        const hers = async () => (await db.select().from(schema.suggestionShows).where(and(eq(schema.suggestionShows.viewerId, victim.id), eq(schema.suggestionShows.hostId, sug.id))))[0];
        const untouched = await hers();
        const stranger = await newPerson("stranger");
        await asApp("/api/app/suggestions/seen", { body: { day, places: [1, 2, 3, 4, 5, 6] }, jar: stranger.jar });
        for (const place of [1, 2, 3, 4, 5, 6]) await asApp("/api/app/suggestions/opened", { body: { day, place }, jar: stranger.jar });
        await asApp("/api/app/suggestions/hide", { body: { handle: sug.handle }, jar: stranger.jar });
        const after2 = await hers();
        check("the second person has a line for that host, not seen and not opened", untouched !== undefined && untouched.seenAt === null && untouched.openedAt === null);
        check("a stranger's steps leave it exactly as it was, and the host is still suggested to her", after2 !== undefined && after2.seenAt === null && after2.openedAt === null && (await home(victim.jar)).body?.suggested?.hosts.some((h) => h.handle === sug.handle) === true);
        check("'hide' needs a handle", refusal(await asApp("/api/app/suggestions/hide", { body: {}, jar: fresh.jar })) === "not_valid");
        const hide = await asApp("/api/app/suggestions/hide", { body: { handle: sug.handle }, jar: fresh.jar });
        check("'hide' takes the host out of the row", hide.status === 200 && (await home(fresh.jar)).body?.suggested?.hosts.some((h) => h.handle === sug.handle) === false);
      }
      check("a step that does not exist is not found", refusal(await asApp("/api/app/suggestions/else", { body: {}, jar: fresh.jar })) === "not_found");
      check("a browser cannot take a step", refusal(await asBrowser("/api/app/suggestions/make", { body: {}, jar: fresh.jar })) === "not_the_app");
      // A paused person gets none, and none are made for them.
      const paused = await newPerson("paused");
      await db.update(schema.user).set({ pausedAt: new Date() }).where(eq(schema.user.id, paused.id));
      const pausedMake = await asApp("/api/app/suggestions/make", { body: {}, jar: paused.jar });
      const madeFor = await db.select().from(schema.suggestionDays).where(eq(schema.suggestionDays.viewerId, paused.id));
      check("a paused person may look at the home page, gets no suggestions, and none are made", (await home(paused.jar)).body?.suggested === null && pausedMake.status === 200 && madeFor.length === 0);
    }

    // ----------------------------------------------------------------------
    console.log("\n8. Photos: who may see which");
    {
      const stranger = await newPerson("looker");
      const open = await asApp(`/api/app/photos/${hostAPhoto}`);
      check("an approved, visible host's photo is open to anyone, signed in or not", open.status === 200 && open.headers["content-type"] === "image/jpeg" && open.bytes.toString() === "photo");
      check("nothing on the way, and nothing of the phone's own, may store it; the app may keep it in memory for five minutes", open.headers["cache-control"] === "private, no-store" && open.headers["x-connect-keep"] === "300");
      check("nothing in it may run", open.headers["x-content-type-options"] === "nosniff" && String(open.headers["content-security-policy"]).includes("sandbox"));
      const hidden = await asApp(`/api/app/photos/${custPhoto}`);
      check("a customer's photo is not for someone not signed in", hidden.status === 404 && refusal(hidden) === "not_found" && String(hidden.headers["cache-control"]).includes("no-store"));
      check("nor for a signed-in stranger", refusal(await asApp(`/api/app/photos/${custPhoto}`, { jar: stranger.jar })) === "not_found");
      const forHost = await asApp(`/api/app/photos/${custPhoto}`, { jar: hostC.jar });
      check("it is for a host the customer has asked, and is never kept, not even in the app's memory", forHost.status === 200 && forHost.bytes.toString() === "photo" && forHost.headers["cache-control"] === "private, no-store" && forHost.headers["x-connect-keep"] === undefined);
      // A host who has to accept the terms again is a guest to the photos, as on the website, until she has.
      await db.update(schema.user).set({ termsVersion: "older" }).where(eq(schema.user.id, hostC.id));
      check("a host with '18 and terms' to do again is not handed a customer's photo", refusal(await asApp(`/api/app/photos/${custPhoto}`, { jar: hostC.jar })) === "not_found");
      check("but still gets a photo anyone may see", (await asApp(`/api/app/photos/${hostAPhoto}`, { jar: hostC.jar })).status === 200);
      await db.update(schema.user).set({ termsVersion: TERMS_VERSION }).where(eq(schema.user.id, hostC.id));
      check("and for the customer themselves", (await asApp(`/api/app/photos/${custPhoto}`, { jar: cust.jar })).status === 200);
      // Rule from the plan: the founder's wider view is never given through the app.
      await db.insert(schema.admins).values({ userId: stranger.id });
      check("an admin gets no wider view through the app", refusal(await asApp(`/api/app/photos/${custPhoto}`, { jar: stranger.jar })) === "not_found");
      await db.delete(schema.admins).where(eq(schema.admins.userId, stranger.id));
      check("a photo that does not exist, and an id that is not one, are the same 'not found'", refusal(await asApp(`/api/app/photos/${randomUUID()}`, { jar: cust.jar })) === "not_found" && refusal(await asApp("/api/app/photos/not-an-id", { jar: cust.jar })) === "not_found");
      check("a browser cannot fetch a photo through the app's address", refusal(await asBrowser(`/api/app/photos/${hostAPhoto}`)) === "not_the_app");
      // A host whose page is hidden: her photo is no longer open.
      await db.update(schema.hostProfiles).set({ hidden: true }).where(eq(schema.hostProfiles.userId, hostA.id));
      check("once her page is hidden, a host's photo is no longer open to a stranger", refusal(await asApp(`/api/app/photos/${hostAPhoto}`, { jar: stranger.jar })) === "not_found");
      const followedNow = (await home(cust.jar)).body?.followed.hosts.find((h) => h.name === hostA.displayName);
      check("and a followed host whose page is hidden is listed by name only", followedNow !== undefined && followedNow.handle === null && followedNow.photoId === null && followedNow.available === false);
      await db.update(schema.hostProfiles).set({ hidden: false }).where(eq(schema.hostProfiles.userId, hostA.id));

      // (plans/45-phone-apps/09a-what-is-built-put-right.md, decision 6.) A customer paused while a call with this host
      // is under way: a pause cancels only calls that have not started, so the call stays on her home page and in her
      // Calls. Nothing about him goes with it any more: not what he wrote, not his ID mark, not his photo's id. And the
      // photo's own address refuses her, since a phone may still hold the id. (Last here: it puts a call under way.)
      const underWay = await call({ hostId: hostC.id, customerId: cust.id, startsInMinutes: -5, words: "Written when asking for the call under way" });
      const [idCheck] = await db.insert(schema.identityChecks).values({ userId: cust.id, stripeSessionId: `vs_check_${RUN}_underway`, status: "verified", adult: true, checkedAt: now }).returning({ id: schema.identityChecks.id });
      const onHome = async () => (await home(hostC.jar)).body?.calls.find((c) => c.id === underWay.id);
      const inCalls = async () => {
        const reply = await asApp("/api/app/calls?kind=coming&page=1", { jar: hostC.jar });
        return reply.status === 200 ? (reply.json as AppCalls).calls.find((c) => c.id === underWay.id) : undefined;
      };
      const photoFor = (jar: Jar) => asApp(`/api/app/photos/${custPhoto}`, { jar });
      type Row = Awaited<ReturnType<typeof onHome>>;
      const withDetails = (row: Row) => row !== undefined && row.hosting === true && row.about?.words === "Written when asking for the call under way" && row.about.idConfirmed === true && row.photoId === custPhoto;
      const bare = (row: Row) => row !== undefined && row.hosting === true && row.name === cust.name && !("about" in row) && row.photoId === null;
      try {
        check("(as things stand, the call under way carries what he wrote, his ID mark and his photo's id, on Home and in Calls)", withDetails(await onHome()) && withDetails(await inCalls()) && (await photoFor(hostC.jar)).status === 200);
        await db.update(schema.user).set({ pausedAt: new Date() }).where(eq(schema.user.id, cust.id));
        const during = await home(hostC.jar);
        check("a customer paused during a call that is under way: the row stays on the host's home page, without his words, his ID mark or his photo", bare(during.body?.calls.find((c) => c.id === underWay.id)) && !during.reply.text.includes("Written when asking for the call under way") && !during.reply.text.includes(custPhoto), JSON.stringify(during.body?.calls.find((c) => c.id === underWay.id)).slice(0, 200));
        check("the same in her Calls", bare(await inCalls()));
        const refusedPhoto = await photoFor(hostC.jar);
        check("and the photo's own address refuses her, as for any photo that is not hers to see", refusedPhoto.status === 404 && refusal(refusedPhoto) === "not_found" && refusedPhoto.bytes.toString() !== "photo");
        check("(he still gets his own photo)", (await photoFor(cust.jar)).status === 200);
        await db.update(schema.user).set({ pausedAt: null }).where(eq(schema.user.id, cust.id));
        // A host whose own pause is the only thing in the way keeps what is hers.
        await db.update(schema.user).set({ pausedAt: new Date() }).where(eq(schema.user.id, hostC.id));
        check("a paused host keeps what is hers while her own pause is the only thing in the way: the details and the photo", withDetails(await onHome()) && withDetails(await inCalls()) && (await photoFor(hostC.jar)).status === 200);
        await db.update(schema.user).set({ pausedAt: new Date() }).where(eq(schema.user.id, cust.id));
        check("but not once the customer is paused as well", bare(await onHome()) && bare(await inCalls()) && refusal(await photoFor(hostC.jar)) === "not_found");
        await db.update(schema.user).set({ pausedAt: null }).where(inArray(schema.user.id, [cust.id, hostC.id]));
        check("with the pauses lifted, everything about him is back beside the call", withDetails(await onHome()) && withDetails(await inCalls()) && (await photoFor(hostC.jar)).status === 200);
      } finally {
        await db.update(schema.user).set({ pausedAt: null }).where(inArray(schema.user.id, [cust.id, hostC.id]));
        await db.delete(schema.identityChecks).where(eq(schema.identityChecks.id, idCheck.id));
      }
    }
  } finally {
    const ids = made.length ? made : ["-"];
    const callIds = calls.length ? calls : [randomUUID()];
    await db.delete(schema.admins).where(inArray(schema.admins.userId, ids));
    await db.delete(schema.suggestionShows).where(or(inArray(schema.suggestionShows.viewerId, ids), inArray(schema.suggestionShows.hostId, ids)));
    await db.delete(schema.suggestionDays).where(inArray(schema.suggestionDays.viewerId, ids));
    await db.delete(schema.bookings).where(or(inArray(schema.bookings.hostId, ids), inArray(schema.bookings.customerId, ids)));
    await db.delete(schema.hostNotes).where(or(inArray(schema.hostNotes.hostId, ids), inArray(schema.hostNotes.customerId, ids)));
    await db.delete(schema.hostPhotos).where(inArray(schema.hostPhotos.userId, ids));
    await db.delete(schema.follows).where(or(inArray(schema.follows.followerId, ids), inArray(schema.follows.hostId, ids)));
    await db.delete(schema.payments).where(inArray(schema.payments.callId, callIds));
    await db.delete(schema.calls).where(inArray(schema.calls.id, callIds));
    await db.delete(schema.weeklyHours).where(inArray(schema.weeklyHours.hostId, ids));
    await db.delete(schema.hostCalendars).where(inArray(schema.hostCalendars.userId, ids));
    await db.delete(schema.hostProfiles).where(inArray(schema.hostProfiles.userId, ids));
    await db.delete(schema.emailOutbox).where(like(schema.emailOutbox.to, `apphome-${RUN}-%`));
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
