/**
 * Testing tool: asks the app running on this computer for a host's requests the way the phone app
 * does, and checks them (plans/45-phone-apps/07-a-hosts-requests.md): the list of waiting
 * requests and what a host may know about each person asking; one request as the host sees it;
 * accepting and declining, with the same call, busy time, passed-over requests and emails as the
 * website's own functions give; every refusal; the host's private note; and blocking.
 *
 * It needs Stripe's test key only because the booking functions ask for it (it saves no card and
 * holds nothing). It empties the table of attempt limits as it goes, so it only runs against a
 * database made for checking (its name must end in "_check"). It removes what it made.
 *
 * Usage: DATABASE_URL=…/something_check npx tsx scripts/app-requests-check.ts [--app=http://localhost:3000]
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { randomBytes, randomUUID } from "node:crypto";
import http from "node:http";
import { and, desc, eq, inArray, like, or, sql } from "drizzle-orm";
import { APP_ORIGIN } from "../src/lib/auth-rules";
import { APP_HEADER, SIGN_IN_HEADER } from "../src/lib/app-door/rules";
import type { AppBooking, AppNoteSaved, AppRequests, Refusal } from "../src/lib/app-door/types";
import { NOTE_MAX } from "../src/lib/people/note-rules";
import { TERMS_VERSION } from "../src/lib/terms";
import { requireLocalDatabase } from "./local-only";

const BASE = process.argv.find((arg) => arg.startsWith("--app="))?.slice("--app=".length).replace(/\/$/, "") ?? "http://localhost:3000";
const RUN = randomUUID().slice(0, 8);
const MINUTE = 60_000;

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}

type Jar = Map<string, string>;
type Reply = { status: number; json: unknown; text: string; headers: http.IncomingHttpHeaders };

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
        const text = Buffer.concat(chunks).toString("utf8");
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
        resolve({ status: response.statusCode ?? 0, json, text, headers: response.headers });
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
const sentence = (reply: Reply) => (reply.json as Refusal | null)?.error?.message ?? `no sentence, status ${reply.status}`;
const keys = (value: unknown) => Object.keys((value ?? {}) as object).sort().join(",");

async function main() {
  requireLocalDatabase();
  if (!process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_")) throw new Error("This script only runs with a Stripe test key.");
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
  const B = await import("../src/lib/booking/bookings");

  const now = new Date();
  const made: string[] = [];
  /** Signs up the app's way, confirms the email in a browser, finishes "18 and terms" (pretended), and signs in the app's way. */
  async function newPerson(name: string) {
    const person = { name: `Asker ${name} ${RUN}`, email: `appreq-${RUN}-${name}@example.test`, password: randomBytes(12).toString("base64url"), jar: new Map() as Jar };
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
  /** A person who never signs in here, written straight to the database, with a passed identity check (pretended). */
  async function person(name: string) {
    const id = `ar-${RUN}-${name}`;
    const email = `appreq-${RUN}-${name}@example.test`;
    await db.insert(schema.user).values({ id, name: `Person ${name} ${RUN}`, email, emailVerified: true, adultConfirmedAt: now, termsAcceptedAt: now, termsVersion: TERMS_VERSION, timeZone: "America/Chicago" });
    await db.insert(schema.identityChecks).values({ userId: id, stripeSessionId: `vs_check_${RUN}_${name}`, status: "verified", adult: true, checkedAt: now });
    made.push(id);
    return { id, name: `Person ${name} ${RUN}`, email };
  }
  /** Makes someone a host with free calls, a page open to everyone and a calendar open all week. */
  async function asHost<T extends { id: string }>(who: T, name: string, displayName: string) {
    const handle = `ar${RUN}${name}`.toLowerCase();
    await db.insert(schema.hostProfiles).values({ userId: who.id, handle, handleKey: handle, displayName, pricePer15Cents: 0, status: "approved", usConfirmedAt: now });
    await db.insert(schema.hostCalendars).values({ userId: who.id, timeZone: "America/Chicago", lengths: "15,30", noticeHours: 24, horizonWeeks: 2, breakMinutes: 5 });
    await db.insert(schema.weeklyHours).values([1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ hostId: who.id, weekday, startMinute: 0, endMinute: 1440 })));
    await db.insert(schema.hostSettings).values({ userId: who.id });
    return { ...who, handle, displayName };
  }
  /** A request made by the website's own function, as a customer's browser would make it. */
  const ask = async (customer: { id: string; name: string; email: string }, hostId: string, startsAt: Date, note = "") =>
    (await B.askForCall({ customer, hostId, startsAt, lengthMinutes: 30, note, requestKey: randomUUID(), agreedToCardTerms: false, seen: { pricePer15Cents: 0, freeCancelMinutes: 0 }, now: new Date() })).booking;
  const timesOf = async (hostId: string) => B.openTimes((await B.offerOf(hostId))!, 30, new Date());
  const row = async (id: string) => (await db.select().from(schema.bookings).where(eq(schema.bookings.id, id)))[0];
  const list = async (jar?: Jar) => {
    const reply = await asApp("/api/app/requests", { jar });
    return { reply, body: reply.status === 200 ? (reply.json as AppRequests) : null };
  };
  const requestPage = async (id: string, jar?: Jar) => {
    const reply = await asApp(`/api/app/bookings/${id}`, { jar });
    return { reply, body: reply.status === 200 ? (reply.json as AppBooking) : null };
  };
  const step = (id: string, name: string, jar?: Jar, body: unknown = {}) => asApp(`/api/app/bookings/${id}/${name}`, { jar, body });
  const busyOf = async (userId: string) => db.select().from(schema.busyEntries).where(eq(schema.busyEntries.userId, userId));
  const emailsTo = async (to: string, subjectPart: string) => (await db.select().from(schema.emailOutbox).where(and(eq(schema.emailOutbox.to, to), like(schema.emailOutbox.subject, `%${subjectPart}%`)))).length;
  const everyRequest = (body: AppRequests | null) => body?.groups.flatMap((group) => group.requests) ?? [];

  try {
    const hana = await asHost(await newPerson("hana"), "hana", `Hana Answers ${RUN}`);
    const other = await asHost(await newPerson("other"), "other", `Other Host ${RUN}`);
    const cust = await newPerson("cust");
    await db.insert(schema.identityChecks).values({ userId: cust.id, stripeSessionId: `vs_check_${RUN}_cust`, status: "verified", adult: true, checkedAt: now });
    const [ann, ben, cy, dee, eve] = await Promise.all(["ann", "ben", "cy", "dee", "eve"].map((name) => person(name)));
    const times = await timesOf(hana.id);
    if (times.length < 60) throw new Error(`Too few open times to check with: ${times.length}.`);
    let used = 0;
    const next = () => times[4 + used++ * 3];

    // ----------------------------------------------------------------------
    console.log("\n1. The list of waiting requests");
    const sameTime = next();
    const annAsk = await ask(ann, hana.id, sameTime, "About my garden.");
    const benAsk = await ask(ben, hana.id, sameTime);
    const cyAsk = await ask(cy, hana.id, next(), "A question about bread.");
    const custAsk = await ask({ id: cust.id, name: cust.name, email: cust.email }, hana.id, next(), "Hello from the app's customer.");
    {
      check("nobody signed in, and a browser, get nothing", refusal((await list()).reply) === "not_signed_in" && refusal(await asBrowser("/api/app/requests", { jar: hana.jar })) === "not_the_app");
      const empty = await list(cust.jar);
      check("someone nobody has asked has an empty list, and is told so", empty.reply.status === 200 && empty.body?.groups.length === 0 && empty.body.empty === "Nothing is waiting for your answer." && empty.body.title === "Requests for calls (0)");
      const { reply, body } = await list(hana.jar);
      check("the host's list: its title, its lines, and how often to ask again", reply.status === 200 && body?.title === "Requests for calls (4)" && body.empty === null && body.intro.length === 2 && body.intro[0].startsWith("Several people may ask for the same time.") && body.intro[1].includes("Your Available now page shows those the moment they arrive.") && body.refreshSeconds > 0, JSON.stringify(body).slice(0, 160));
      check("it has exactly the parts the app knows, and is not kept on the way", keys(body) === "empty,groups,intro,refreshSeconds,title" && String(reply.headers["cache-control"]).includes("no-store"), keys(body));
      check("grouped by the time asked for, the soonest first; a time two people asked for is one group and says so", body?.groups.length === 3 && body.groups[0].startsAt === sameTime.toISOString() && body.groups[0].requests.length === 2 && body.groups[0].many === "2 people asked for this time. Choose one." && body.groups[1].many === null && body.groups.map((group) => group.startsAt).join() === [...body.groups.map((group) => group.startsAt)].sort().join());
      const one = everyRequest(body).find((request) => request.id === annAsk.id);
      check("one request: who, how long, the price, by when", one?.name === ann.name && one.minutes === 30 && one.price === "free" && one.kind === "booked" && one.respondBy === annAsk.respondBy?.toISOString());
      check("and what the host may know: no rating yet (said in words), ID confirmed, what they wrote", one?.known === true && one.rating === null && one.ratingWords === "New: not enough ratings yet" && one.idConfirmed === true && one.words === "About my garden." && one.note === null && one.photoId === null);
      check("each request has exactly the parts the app knows", keys(one) === "answer,id,idConfirmed,kind,known,minutes,name,note,photoId,price,rating,ratingWords,respondBy,words" && one?.answer.kind === "booked" && one.answer.accept === "Accept" && one.answer.sure.length === 3, keys(one));
      check("no account id and no email address travels", !reply.text.includes(ann.id) && !reply.text.includes(hana.id) && !reply.text.includes("@example.test"));
      const web = await asBrowser("/host/requests", { jar: hana.jar });
      check("the website's page says the same sentences, from the same place", web.status === 200 && web.text.includes("2 people asked for this time. Choose one.") && web.text.includes("New: not enough ratings yet") && web.text.includes("Requests for calls (") && web.text.includes(ann.name), `${web.status}`);

      // A request left over from a customer whose account is closed, or across a block: the name and nothing else.
      await db.update(schema.user).set({ closedAt: now }).where(eq(schema.user.id, cy.id));
      await db.insert(schema.blocks).values({ blockerId: ben.id, blockedId: hana.id });
      const after = everyRequest((await list(hana.jar)).body);
      const closed = after.find((request) => request.id === cyAsk.id);
      const blocked = after.find((request) => request.id === benAsk.id);
      const bare = (request: typeof closed) => request !== undefined && request.known === false && request.rating === null && request.ratingWords === null && request.idConfirmed === false && request.words === "" && request.note === null && request.photoId === null;
      check("of a customer whose account is closed: the name, the time, the price, and nothing personal", bare(closed) && closed?.name === cy.name && closed.price === "free", JSON.stringify(closed));
      check("the same across a block, whoever blocked whom", bare(blocked) && blocked?.name === ben.name);
      check("everyone else is shown as before", after.find((request) => request.id === annAsk.id)?.words === "About my garden.");
      // One request as the host sees it follows the very same rule.
      const closedPage = (await requestPage(cyAsk.id, hana.jar)).body;
      check("and one such request, opened, says no more than the list", closedPage?.role === "host" && closedPage.host?.customerName === cy.name && closedPage.host.known === false && closedPage.host.rating === null && closedPage.host.ratingWords === null && closedPage.host.idConfirmed === false && closedPage.host.words === null && closedPage.host.photoId === null && closedPage.host.note === null, JSON.stringify(closedPage?.host).slice(0, 200));
      await db.update(schema.user).set({ closedAt: null }).where(eq(schema.user.id, cy.id));
      await db.delete(schema.blocks).where(eq(schema.blocks.blockerId, ben.id));
    }

    // ----------------------------------------------------------------------
    console.log("\n2. One request as the host sees it");
    {
      const { reply, body } = await requestPage(annAsk.id, hana.jar);
      check("the host reads a request sent to her", reply.status === 200 && body?.role === "host" && body.title === `Request from ${ann.name}` && body.stage === "waiting" && body.stageWords === "Waiting for your answer.", reply.text.slice(0, 120));
      check("with when, the price, and by when she must answer", body?.startsAt === sameTime.toISOString() && body.minutes === 30 && body.price.words === "Free" && body.hearBy?.label === "Answer by" && body.hearBy.at === annAsk.respondBy?.toISOString());
      check("what she may know about the person asking", body?.host?.customerName === ann.name && body.host.known === true && body.host.ratingWords === "New: not enough ratings yet" && body.host.idConfirmed === true && body.host.words?.label === "Their note" && body.host.words.text === "About my garden.");
      check("the host's part has exactly the parts the app knows", keys(body?.host) === "answer,customerName,idConfirmed,known,note,photoId,rating,ratingWords,words", keys(body?.host));
      const sure = body?.host?.answer?.sure ?? [];
      check("how she answers: Accept, with the question to ask first, and Decline", body?.host?.answer?.kind === "booked" && body.host.answer.accept === "Accept" && body.host.answer.decline === "Decline" && sure[0] === "Accept a 30-minute call on " && typeof sure[1] === "object" && "time" in sure[1] && sure[1].time === sameTime.toISOString() && sure[2] === ", for free?" && body.host.answer.yes === "Accept" && body.host.answer.no === "Not now" && body.host.answer.elsewhere === null, JSON.stringify(sure));
      check("her own notepad about them, empty so far", body?.host?.note?.title === `About ${ann.name}` && body.host.note.text === null && body.host.note.max === NOTE_MAX && body.host.note.hint === "Your private notes. Only you can see them.");
      check("she can block them, and is asked first", body?.block?.label === `Block ${ann.name}` && body.block.sure.startsWith(`${ann.name} will not be able to ask you for calls any more`) && body.block.yes === "Block");
      check("nothing that is the customer's to do is on her page", body?.takeBack === null && body.takeBackSure === null && body.card === null && body.waitingWords === null && body.refreshSeconds === 20);
      check("no account id and no email address travels", !reply.text.includes(ann.id) && !reply.text.includes(hana.id) && !reply.text.includes("@example.test"));
      // The customer of the same kind of request sees nothing of the host's part.
      const mine = await requestPage(custAsk.id, cust.jar);
      check("the customer's page of a request has no host's part, and nothing about ratings or notes", mine.body?.role === "customer" && mine.body.host === null && !mine.reply.text.includes("ratingWords") && mine.body.block?.label === `Block ${hana.displayName}` && mine.body.takeBack !== null);
      check("another host, and a stranger, do not find it", refusal((await requestPage(annAsk.id, other.jar)).reply) === "not_found" && refusal((await requestPage(annAsk.id, cust.jar)).reply) === "not_found" && refusal((await requestPage(annAsk.id)).reply) === "not_signed_in");
      // What does not exist for the host: a request still at its card step, and a member's booking that never became a call.
      const base = { hostId: hana.id, customerId: dee.id, lengthMinutes: 30, breakMinutes: 5, pricePer15Cents: 2000, totalCents: 4000, freeCancelMinutes: 0, note: "" };
      const slot = next();
      const [draft] = await db.insert(schema.bookings).values({ ...base, startsAt: slot, endsAt: new Date(slot.getTime() + 30 * MINUTE), stage: "card", source: "customer", requestKey: randomUUID() }).returning();
      const [unmade] = await db.insert(schema.bookings).values({ ...base, startsAt: slot, endsAt: new Date(slot.getTime() + 30 * MINUTE), stage: "paying", source: "member", requestKey: randomUUID() }).returning();
      const gone = await requestPage(draft.id, hana.jar);
      check("a request still at its card step does not exist for the host, in the same words as somebody else's", refusal(gone.reply) === "not_found" && gone.reply.text === (await requestPage(annAsk.id, other.jar)).reply.text);
      check("nor does a member's booking that never became a call", refusal((await requestPage(unmade.id, hana.jar)).reply) === "not_found");
      check("and none of her steps reach them", refusal(await step(draft.id, "accept", hana.jar)) === "not_found" && refusal(await step(draft.id, "decline", hana.jar)) === "not_found" && refusal(await step(unmade.id, "accept", hana.jar)) === "not_found" && refusal(await step(draft.id, "block", hana.jar)) === "not_found" && refusal(await step(draft.id, "note", hana.jar, { text: "x", shown: null })) === "not_found" && (await row(draft.id)).stage === "card");
      check("they are not on her list either", !everyRequest((await list(hana.jar)).body).some((request) => request.id === draft.id || request.id === unmade.id));
    }

    // ----------------------------------------------------------------------
    console.log("\n3. Accepting");
    {
      check("nobody signed in, a browser, another host and the customer cannot accept", refusal(await step(annAsk.id, "accept")) === "not_signed_in" && refusal(await asBrowser(`/api/app/bookings/${annAsk.id}/accept`, { jar: hana.jar, body: {} })) === "not_the_app" && refusal(await step(annAsk.id, "accept", other.jar)) === "not_found" && refusal(await step(custAsk.id, "accept", cust.jar)) === "not_found" && refusal(await step(custAsk.id, "decline", cust.jar)) === "not_found" && (await row(annAsk.id)).stage === "waiting" && (await row(custAsk.id)).stage === "waiting");
      await db.update(schema.user).set({ pausedAt: now }).where(eq(schema.user.id, hana.id));
      check("a paused host cannot accept, and is told she is paused", refusal(await step(annAsk.id, "accept", hana.jar)) === "paused" && (await row(annAsk.id)).stage === "waiting");
      await db.update(schema.user).set({ pausedAt: null }).where(eq(schema.user.id, hana.id));

      const done = await step(annAsk.id, "accept", hana.jar);
      const page = done.json as AppBooking;
      const accepted = await row(annAsk.id);
      check("the host accepts: the call is booked, and the answer is the request's page as it stands", done.status === 200 && page.stage === "accepted" && page.stageWords === "You accepted. The call is booked." && page.notice === "Accepted. The call is booked, and anyone else who asked for that time has been told." && page.host?.answer === null && page.call?.id === accepted.callId && page.hearBy === null, done.text.slice(0, 160));
      const [call] = await db.select().from(schema.calls).where(eq(schema.calls.id, accepted.callId!));
      const passed = await row(benAsk.id);
      check("the call is made, both are taken for it, and the other person who asked for that time is told", call?.hostId === hana.id && call.customerId === ann.id && call.startsAt.getTime() === sameTime.getTime() && call.billing === "host" && (await busyOf(hana.id)).some((b) => b.bookingId === annAsk.id) && (await busyOf(ann.id)).some((b) => b.bookingId === annAsk.id) && passed.stage === "passed_over" && (await busyOf(ben.id)).length === 0);
      check("with the emails", (await emailsTo(ann.email, "accepted your request")) === 1 && (await emailsTo(hana.email, `You accepted a call with ${ann.name}`)) === 1 && (await emailsTo(ben.email, hana.displayName)) >= 2);
      // The very same through the website's own function, for another host with the same two requests.
      const twin = await asHost(await person("twin"), "twin", `Twin Host ${RUN}`);
      const twinTime = (await timesOf(twin.id))[6];
      const first = await ask(dee, twin.id, twinTime, "About my garden.");
      const second = await ask(eve, twin.id, twinTime);
      const { callId } = await B.accept({ bookingId: first.id, hostId: twin.id, now: new Date() });
      const [twinCall] = await db.select().from(schema.calls).where(eq(schema.calls.id, callId));
      const length = (list2: Awaited<ReturnType<typeof busyOf>>, bookingId: string) => {
        const entry = list2.find((b) => b.bookingId === bookingId)!;
        return entry.endsAt.getTime() - entry.startsAt.getTime();
      };
      check(
        "it is the same call, the same busy time and the same passed-over request as the website's own function makes",
        twinCall.billing === call.billing && twinCall.pricePer15Cents === call.pricePer15Cents && twinCall.endsAt.getTime() - twinCall.startsAt.getTime() === call.endsAt.getTime() - call.startsAt.getTime() && length(await busyOf(twin.id), first.id) === length(await busyOf(hana.id), annAsk.id) && length(await busyOf(dee.id), first.id) === length(await busyOf(ann.id), annAsk.id) && (await row(second.id)).stage === passed.stage && (await row(second.id)).endedReason === passed.endedReason && (await row(first.id)).payBy === accepted.payBy,
      );
      check("and the same emails", (await emailsTo(dee.email, "accepted your request")) === 1 && (await emailsTo(eve.email, twin.displayName)) === (await emailsTo(ben.email, hana.displayName)));

      const twice = await step(annAsk.id, "accept", hana.jar);
      check("answered a second time, it is no longer waiting, whichever answer comes second", sentence(twice) === "This request is no longer waiting for an answer." && sentence(await step(annAsk.id, "decline", hana.jar)) === "This request is no longer waiting for an answer." && sentence(await step(benAsk.id, "accept", hana.jar)) === "This request is no longer waiting for an answer." && (await row(annAsk.id)).stage === "accepted");
      check("the page then shows what really happened", (await requestPage(benAsk.id, hana.jar)).body?.stageWords === "You accepted another request for that time." && (await requestPage(annAsk.id, hana.jar)).body?.stage === "accepted");

      // After the time to answer.
      await db.update(schema.bookings).set({ respondBy: new Date(Date.now() - MINUTE) }).where(eq(schema.bookings.id, cyAsk.id));
      check("after the time to answer has passed", sentence(await step(cyAsk.id, "accept", hana.jar)) === "The time to answer this request has passed." && (await row(cyAsk.id)).stage === "waiting");
      await db.update(schema.bookings).set({ respondBy: cyAsk.respondBy }).where(eq(schema.bookings.id, cyAsk.id));
      // The time taken meanwhile: the host asked somebody else for a call of her own at that very time.
      await db.insert(schema.identityChecks).values({ userId: hana.id, stripeSessionId: `vs_check_${RUN}_hana`, status: "verified", adult: true, checkedAt: now });
      const own = await ask({ id: hana.id, name: hana.name, email: hana.email }, other.id, cyAsk.startsAt);
      check("with the time taken meanwhile by a request of her own", sentence(await step(cyAsk.id, "accept", hana.jar)) === "You already have a call or a request of your own at that time, so this one cannot be accepted." && (await row(cyAsk.id)).stage === "waiting");
      await B.takeBack({ bookingId: own.id, customerId: hana.id, now: new Date() });
      // A paid request, and no payout account.
      const paidSlot = next();
      const [paid] = await db.insert(schema.bookings).values({ hostId: hana.id, customerId: dee.id, startsAt: paidSlot, endsAt: new Date(paidSlot.getTime() + 30 * MINUTE), lengthMinutes: 30, breakMinutes: 5, pricePer15Cents: 2000, totalCents: 4000, freeCancelMinutes: 0, note: "", stage: "waiting", source: "customer", requestKey: randomUUID(), requestedAt: now, respondBy: new Date(Date.now() + 60 * MINUTE) }).returning();
      const paidPage = (await requestPage(paid.id, hana.jar)).body;
      check("a paid request asks 'for $40.00?' before it is accepted", paidPage?.host?.answer?.sure[2] === " for $40.00?" && paidPage.price.words === "$40.00 at most");
      check("without a payout account a paid request cannot be accepted, in the website's own sentence", sentence(await step(paid.id, "accept", hana.jar)) === "Your payout account is not ready, so you cannot accept paid requests yet. Finish the payout setup first." && (await row(paid.id)).stage === "waiting");
      // A call asked for right now is answered where such calls arrive.
      const [instant] = await db.insert(schema.bookings).values({ hostId: hana.id, customerId: eve.id, startsAt: new Date(Date.now() + 3 * MINUTE), endsAt: new Date(Date.now() + 33 * MINUTE), lengthMinutes: 30, breakMinutes: 5, pricePer15Cents: 0, totalCents: 0, freeCancelMinutes: 0, note: "", stage: "waiting", source: "now", requestKey: randomUUID(), requestedAt: now, respondBy: new Date(Date.now() + 2 * MINUTE) }).returning();
      const onList = everyRequest((await list(hana.jar)).body).find((request) => request.id === instant.id);
      const instantPage = (await requestPage(instant.id, hana.jar)).body;
      check("a call asked for right now is on the list as that kind, and its page says where it is answered", onList?.kind === "now" && onList.answer.elsewhere === "A request for a call right now is answered on your Available now page." && instantPage?.host?.answer?.kind === "now" && instantPage.host.answer.elsewhere === "A request for a call right now is answered on your Available now page.");
      check("and neither answer is taken for it here", sentence(await step(instant.id, "accept", hana.jar)) === "A request for a call right now is answered on your Available now page." && sentence(await step(instant.id, "decline", hana.jar)) === sentence(await step(instant.id, "accept", hana.jar)) && (await row(instant.id)).stage === "waiting");
      await db.delete(schema.bookings).where(inArray(schema.bookings.id, [paid.id, instant.id]));
    }

    // ----------------------------------------------------------------------
    console.log("\n4. Declining");
    {
      await db.update(schema.user).set({ pausedAt: now }).where(eq(schema.user.id, hana.id));
      const done = await step(cyAsk.id, "decline", hana.jar);
      await db.update(schema.user).set({ pausedAt: null }).where(eq(schema.user.id, hana.id));
      const page = done.json as AppBooking;
      check("the host declines (a paused host too), and the answer is the page as it stands", done.status === 200 && page.stage === "declined" && page.stageWords === "You declined this request." && page.notice === "Declined. The customer has been told." && page.host?.answer === null, done.text.slice(0, 160));
      check("the customer is free again and told", (await row(cyAsk.id)).stage === "declined" && !(await busyOf(cy.id)).some((b) => b.bookingId === cyAsk.id) && (await emailsTo(cy.email, "could not take your request")) === 1);
      check("declined a second time, it is no longer waiting", sentence(await step(cyAsk.id, "decline", hana.jar)) === "This request is no longer waiting for an answer.");
      let refusedAgain = "";
      await ask(cy, hana.id, next()).catch((error: Error) => (refusedAgain = error.message));
      check("for seven days that customer cannot ask her again, as on the website", refusedAgain === "This host is not taking requests from you at the moment.", refusedAgain);
      check("the list no longer has it", !everyRequest((await list(hana.jar)).body).some((request) => request.id === cyAsk.id));
    }

    // ----------------------------------------------------------------------
    console.log("\n5. The host's private note");
    {
      const save = (id: string, jar: Jar | undefined, body: unknown) => step(id, "note", jar, body);
      check("nobody signed in, a browser, another host and the customer cannot write it", refusal(await save(custAsk.id, undefined, { text: "x", shown: null })) === "not_signed_in" && refusal(await asBrowser(`/api/app/bookings/${custAsk.id}/note`, { jar: hana.jar, body: { text: "x", shown: null } })) === "not_the_app" && refusal(await save(custAsk.id, other.jar, { text: "x", shown: null })) === "not_found" && refusal(await save(custAsk.id, cust.jar, { text: "x", shown: null })) === "not_found");
      check("what is sent must be a note and what the screen was showing", refusal(await save(custAsk.id, hana.jar, { text: 5, shown: null })) === "not_valid" && refusal(await save(custAsk.id, hana.jar, { text: "x" })) === "not_valid" && refusal(await save(custAsk.id, hana.jar, {})) === "not_valid");
      const saved = await save(custAsk.id, hana.jar, { text: "Likes mornings.", shown: null });
      check("she saves a note, and is told so", saved.status === 200 && keys(saved.json) === "text,words" && (saved.json as AppNoteSaved).text === "Likes mornings." && (saved.json as AppNoteSaved).words === "Saved.");
      check("it is on the request's page and on the list from then on", (await requestPage(custAsk.id, hana.jar)).body?.host?.note?.text === "Likes mornings." && everyRequest((await list(hana.jar)).body).find((request) => request.id === custAsk.id)?.note === "Likes mornings.");
      check("the customer never sees it", !(await requestPage(custAsk.id, cust.jar)).reply.text.includes("mornings"));
      const stale = await save(custAsk.id, hana.jar, { text: "Likes evenings.", shown: null });
      check("a save from a screen that is out of date is refused, and nothing is lost", refusal(stale) === "not_valid" && sentence(stale).endsWith("Nothing was saved. What you typed is still in the box.") && (await requestPage(custAsk.id, hana.jar)).body?.host?.note?.text === "Likes mornings.", sentence(stale));
      const long = await save(custAsk.id, hana.jar, { text: "x".repeat(NOTE_MAX + 1), shown: "Likes mornings." });
      check("a note that is too long is refused in the website's sentence", sentence(long).startsWith("A note can be at most ") && sentence(long).endsWith("Nothing was saved. What you typed is still in the box."));
      const changed = await save(custAsk.id, hana.jar, { text: "Likes evenings.", shown: "Likes mornings." });
      const emptied = await save(custAsk.id, hana.jar, { text: "", shown: "Likes evenings." });
      check("she changes it, and an empty note removes it", (changed.json as AppNoteSaved).text === "Likes evenings." && emptied.status === 200 && (emptied.json as AppNoteSaved).text === null && (await db.select().from(schema.hostNotes).where(eq(schema.hostNotes.hostId, hana.id))).length === 0);
      // Across a block no note can be kept, and none is shown.
      await db.insert(schema.blocks).values({ blockerId: cust.id, blockedId: hana.id });
      const across = await save(custAsk.id, hana.jar, { text: "After the block.", shown: null });
      check("across a block she can keep no note", sentence(across) === "You can keep a note only about someone who has asked you for a call. Nothing was saved. What you typed is still in the box." && (await requestPage(custAsk.id, hana.jar)).body?.host?.note === null);
      await db.delete(schema.blocks).where(eq(schema.blocks.blockerId, cust.id));
    }

    // ----------------------------------------------------------------------
    console.log("\n6. Blocking");
    {
      check("nobody signed in, a browser and another host cannot block through a request", refusal(await step(custAsk.id, "block")) === "not_signed_in" && refusal(await asBrowser(`/api/app/bookings/${custAsk.id}/block`, { jar: hana.jar, body: {} })) === "not_the_app" && refusal(await step(custAsk.id, "block", other.jar)) === "not_found" && (await db.select().from(schema.blocks).where(eq(schema.blocks.blockedId, cust.id))).length === 0);
      const done = await step(custAsk.id, "block", hana.jar);
      const page = done.json as AppBooking;
      const blocks = await db.select().from(schema.blocks).where(and(eq(schema.blocks.blockerId, hana.id), eq(schema.blocks.blockedId, cust.id)));
      check("the host blocks the person asking: it is done, and their request has ended", done.status === 200 && blocks.length === 1 && page.notice === "Blocked. They cannot ask you for calls any more, and any requests or future calls between you have ended." && page.stage !== "waiting" && page.host?.answer === null && (await row(custAsk.id)).stage !== "waiting", done.text.slice(0, 200));
      check("from then on her page of it says nothing personal about them", page.host?.known === false && page.host.words === null && page.host.note === null && page.host.customerName === cust.name);
      check("and it is off her list", !everyRequest((await list(hana.jar)).body).some((request) => request.id === custAsk.id));
      const again = await step(custAsk.id, "block", hana.jar);
      check("blocking again changes nothing and is answered the same way", again.status === 200 && (await db.select().from(schema.blocks).where(and(eq(schema.blocks.blockerId, hana.id), eq(schema.blocks.blockedId, cust.id)))).length === 1);
      // The customer of a request can block its host the same way.
      const custAsk2 = await ask({ id: cust.id, name: cust.name, email: cust.email }, other.id, (await timesOf(other.id))[9]);
      const byCustomer = await step(custAsk2.id, "block", cust.jar);
      check("the customer of a request can block its host the same way", byCustomer.status === 200 && (byCustomer.json as AppBooking).role === "customer" && (byCustomer.json as AppBooking).notice?.startsWith("Blocked.") === true && (await db.select().from(schema.blocks).where(and(eq(schema.blocks.blockerId, cust.id), eq(schema.blocks.blockedId, other.id)))).length === 1 && (await row(custAsk2.id)).stage !== "waiting");
      check("a step that does not exist is not found", refusal(await step(custAsk.id, "report", hana.jar)) === "not_found");
    }
  } finally {
    const ids = made.length ? made : ["-"];
    const mine = await db.select({ id: schema.bookings.id, callId: schema.bookings.callId }).from(schema.bookings).where(or(inArray(schema.bookings.customerId, ids), inArray(schema.bookings.hostId, ids)));
    const bookingIds = mine.length ? mine.map((b) => b.id) : [randomUUID()];
    const callIds = mine.flatMap((b) => (b.callId ? [b.callId] : []));
    await db.delete(schema.busyEntries).where(inArray(schema.busyEntries.bookingId, bookingIds));
    await db.delete(schema.bookings).where(inArray(schema.bookings.id, bookingIds));
    if (callIds.length) await db.delete(schema.calls).where(inArray(schema.calls.id, callIds));
    await db.delete(schema.hostNotes).where(or(inArray(schema.hostNotes.hostId, ids), inArray(schema.hostNotes.customerId, ids)));
    await db.delete(schema.identityChecks).where(inArray(schema.identityChecks.userId, ids));
    await db.delete(schema.blocks).where(or(inArray(schema.blocks.blockerId, ids), inArray(schema.blocks.blockedId, ids)));
    await db.delete(schema.weeklyHours).where(inArray(schema.weeklyHours.hostId, ids));
    await db.delete(schema.hostCalendars).where(inArray(schema.hostCalendars.userId, ids));
    await db.delete(schema.hostSettings).where(inArray(schema.hostSettings.userId, ids));
    await db.delete(schema.hostProfiles).where(inArray(schema.hostProfiles.userId, ids));
    await db.delete(schema.emailOutbox).where(like(schema.emailOutbox.to, `appreq-${RUN}-%`));
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
