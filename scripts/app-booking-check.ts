/**
 * Testing tool: asks the app running on this computer for a call the way the phone app does, and
 * checks it (plans/45-phone-apps/06-asking-for-a-call.md): what a customer reads before sending,
 * in the website's own sentences; that a request sent from the app is the same row, with the same
 * deadlines and the same email, as one made by the website's own function; every refusal; the
 * card step, where only Stripe's word counts; taking a request back; and the identity check,
 * started from the app and read for the person signed in to the app.
 *
 * It saves test cards at Stripe and starts identity checks there, so it runs only with Stripe's
 * test key (nothing is ever held or charged, and nothing real is made). It empties the table of
 * attempt limits as it goes, so it only runs against a database made for checking (its name must
 * end in "_check"). It removes what it made, here and at Stripe. It never prints a secret.
 *
 * Usage: DATABASE_URL=…/something_check npx tsx scripts/app-booking-check.ts [--app=http://localhost:3000]
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { randomBytes, randomUUID } from "node:crypto";
import http from "node:http";
import { and, desc, eq, inArray, like, or, sql } from "drizzle-orm";
import { APP_ORIGIN } from "../src/lib/auth-rules";
import { APP_HEADER, SIGN_IN_HEADER } from "../src/lib/app-door/rules";
import type { AppBooking, AppBookSent, AppBookSummary, AppCardStep, AppHostPage, AppIdentity, AppIdentityStart, Refusal } from "../src/lib/app-door/types";
import { answerDeadline, CARD_CONSENT_VERSION, LIMITS, payCutoff } from "../src/lib/booking/rules";
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
  // Before anything is made anywhere: only ever Stripe's test mode.
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
  const { stripe } = await import("../src/lib/payments/stripe");
  await db.delete(schema.rateLimit);

  const B = await import("../src/lib/booking/bookings");
  const { runBookingJobs } = await import("../src/lib/booking/jobs");
  const { setSwitches } = await import("../src/lib/safety/switches");
  // The founder's switches exactly as they were, to put back at the end.
  const [saved] = (await db.execute(sql`select row_to_json(s)::text as row from site_switches s where id = 1`)) as unknown as { row: string }[];
  async function restoreSwitches() {
    await db.transaction(async (tx) => {
      await tx.delete(schema.siteSwitches).where(eq(schema.siteSwitches.id, 1));
      if (saved) await tx.execute(sql`insert into site_switches select * from json_populate_record(null::site_switches, ${saved.row}::json)`);
    });
  }

  const now = new Date();
  const made: string[] = [];
  /** Signs up the app's way, confirms the email in a browser, finishes "18 and terms" (pretended), and signs in the app's way. */
  async function newPerson(name: string) {
    const person = { name: `Booker ${name} ${RUN}`, email: `appbook-${RUN}-${name}@example.test`, password: randomBytes(12).toString("base64url"), jar: new Map() as Jar };
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
    const id = `ab-${RUN}-${name}`;
    const email = `appbook-${RUN}-${name}@example.test`;
    await db.insert(schema.user).values({ id, name: `Account ${name} ${RUN}`, email, emailVerified: true, adultConfirmedAt: now, termsAcceptedAt: now, termsVersion: TERMS_VERSION, timeZone: "America/Chicago" });
    made.push(id);
    return { id, name: `Account ${name} ${RUN}`, email };
  }
  /**
   * Makes someone a host who can be asked for a call at a time: a page open to everyone and a calendar open all week.
   * A host who charges is marked as able to be paid straight in the database (this check never pays anyone: it stops
   * at the request, and a request never touches the host's own account at Stripe).
   */
  async function asHost<T extends { id: string }>(who: T, name: string, displayName: string, options: { price?: number; freeCancel?: number; verifiedOnly?: boolean } = {}) {
    const handle = `ab${RUN}${name}`.toLowerCase();
    await db.insert(schema.hostProfiles).values({ userId: who.id, handle, handleKey: handle, displayName, pricePer15Cents: options.price ?? 0, status: "approved", usConfirmedAt: now });
    await db.insert(schema.hostCalendars).values({ userId: who.id, timeZone: "America/Chicago", lengths: "15,30", noticeHours: 24, horizonWeeks: 2, breakMinutes: 5 });
    await db.insert(schema.weeklyHours).values([1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ hostId: who.id, weekday, startMinute: 0, endMinute: 1440 })));
    await db.insert(schema.hostSettings).values({ userId: who.id, payoutsReady: (options.price ?? 0) > 0, freeCancelMinutes: options.freeCancel ?? 0, verifiedOnly: options.verifiedOnly ?? false });
    return { ...who, handle, displayName };
  }
  /** Marks someone as having passed the identity check (pretended: no check at Stripe stands behind it). */
  const passId = (userId: string) => db.insert(schema.identityChecks).values({ userId, stripeSessionId: `vs_check_${RUN}_${randomUUID().slice(0, 8)}`, status: "verified", adult: true, checkedAt: now });
  const openTimes = async (handle: string, jar: Jar) => ((await asApp(`/api/app/hosts/${handle}?length=30`, { jar })).json as AppHostPage).ask.starts;
  const summary = async (handle: string, start: string, jar?: Jar, length = 30) => {
    const reply = await asApp(`/api/app/hosts/${handle}/book?length=${length}&start=${encodeURIComponent(start)}`, { jar });
    return { reply, body: reply.status === 200 ? (reply.json as AppBookSummary) : null };
  };
  type Ok = Extract<AppBookSummary, { kind: "ok" }>;
  const okSummary = async (handle: string, start: string, jar: Jar) => {
    const { body } = await summary(handle, start, jar);
    if (body?.kind !== "ok") throw new Error(`Expected a summary for ${handle} at ${start}, got ${JSON.stringify(body)}`);
    return body as Ok;
  };
  /** Sends the request the way the app does: with what the summary gave it. */
  const send = (handle: string, s: Ok, jar: Jar, change: Record<string, unknown> = {}) =>
    asApp(`/api/app/hosts/${handle}/book`, { jar, body: { start: s.startsAt, length: s.minutes, note: "", requestKey: s.requestKey, ...(s.cardTerms ? { cardTerms: true } : {}), seen: s.seen, ...change } });
  const row = async (id: string) => (await db.select().from(schema.bookings).where(eq(schema.bookings.id, id)))[0];
  const requestPage = async (id: string, jar?: Jar) => {
    const reply = await asApp(`/api/app/bookings/${id}`, { jar });
    return { reply, body: reply.status === 200 ? (reply.json as AppBooking) : null };
  };
  const step = (id: string, name: string, jar?: Jar) => asApp(`/api/app/bookings/${id}/${name}`, { jar, body: {} });
  const busyOf = async (userId: string) => db.select().from(schema.busyEntries).where(eq(schema.busyEntries.userId, userId));
  const emailsTo = async (to: string, subjectPart: string) => (await db.select().from(schema.emailOutbox).where(and(eq(schema.emailOutbox.to, to), like(schema.emailOutbox.subject, `%${subjectPart}%`)))).length;
  const CARD_TERMS = (total: string) =>
    `I allow Connect to save my card for this booking only and, if my request is accepted, to hold up to ${total} on it without my being present, and to charge it after the call as described above. If I ask for more time during the call, the price of that extra time is held on the same card and charged in the same way. The card is removed once the call is over.`;

  try {
    const cust = await newPerson("cust");
    const second = await newPerson("second");
    const third = await newPerson("third");
    // (Her cancelling rule is for paid calls; her calls are free, which can always be cancelled for free.)
    const maya = await asHost(await person("maya"), "maya", `Maya Free ${RUN}`, { freeCancel: 1440 });
    const noor = await asHost(await person("noor"), "noor", `Noor Paid ${RUN}`, { price: 2000, freeCancel: 60 });
    const olly = await asHost(await person("olly"), "olly", `Olly Checks ${RUN}`, { price: 2000, verifiedOnly: true });
    const freeTimes = await openTimes(maya.handle, cust.jar);
    const paidTimes = await openTimes(noor.handle, cust.jar);
    if (freeTimes.length < 40 || paidTimes.length < 40) throw new Error(`Too few open times to check with: ${freeTimes.length} free, ${paidTimes.length} paid.`);
    // Times well apart, so that one request never stands in the way of the next.
    let used = 0;
    const nextFree = () => freeTimes[4 + used++ * 3];
    const nextPaid = () => paidTimes[5 + used++ * 3];

    // ----------------------------------------------------------------------
    console.log("\n1. What a customer reads before sending");
    {
      const slot = nextFree();
      check("someone not signed in is told to sign in", refusal((await summary(maya.handle, slot)).reply) === "not_signed_in");
      check("a browser cannot ask through the app's address", refusal(await asBrowser(`/api/app/hosts/${maya.handle}/book?length=30&start=${encodeURIComponent(slot)}`, { jar: cust.jar })) === "not_the_app");
      check("a host that does not exist is not found", refusal((await summary(`nobody${RUN}`, slot, cust.jar)).reply) === "not_found");

      const first = await summary(maya.handle, slot, cust.jar);
      check(
        "before a first free call the identity check comes first, in the website's own words",
        first.body?.kind === "confirm_id" && first.body.title === "One thing first" && first.body.words.startsWith("Before your first free call, please confirm who you are: a photo of your ID and a selfie on Stripe's own pages") && first.body.button === "Confirm who I am",
        JSON.stringify(first.body).slice(0, 160),
      );
      const strict = await summary(olly.handle, (await openTimes(olly.handle, cust.jar))[6], cust.jar);
      check("and so it does for a host who only takes people with a confirmed ID", strict.body?.kind === "confirm_id" && strict.body.words.startsWith(`${olly.displayName} only takes calls from people who have confirmed their ID.`));
      await passId(cust.id);

      const free = await summary(maya.handle, slot, cust.jar);
      const f = free.body?.kind === "ok" ? free.body : null;
      check("with a confirmed ID, the summary of a free call", free.reply.status === 200 && f !== null && f.title === `Ask ${maya.displayName} for a call` && f.price === "Free" && f.startsAt === slot && f.minutes === 30, JSON.stringify(free.body).slice(0, 200));
      check("it has exactly the parts the app knows, and no account id", keys(f) === "button,cardTerms,hostTime,idLine,kind,minutes,note,points,pointsTitle,price,requestKey,seen,startsAt,title,what" && !free.reply.text.includes(maya.id), keys(f));
      check("a free call has no box about a card, and its button sends the request", f?.cardTerms === null && f.button === "Send request" && f.seen.price === 0 && f.seen.freeCancel === 1440);
      check("it says what is asked for: a live one-to-one call that is not recorded, and a free call's own cancelling rule", f?.what === "A live, private one-to-one video call. It is not recorded. You can cancel for free any time before the call starts." && !JSON.stringify(f).includes("24 hours"), f?.what);
      check("the host's own time is written in her time zone", f?.hostTime.startsWith(`For ${maya.displayName}: `) === true && /C[SD]T$/.test(f?.hostTime ?? ""), f?.hostTime);
      const answerBy = answerDeadline({ startsAt: new Date(slot), paid: false, freeCancelMinutes: 0, requestedAt: new Date() }).getTime();
      const said = f?.points.flat().find((part): part is { time: string } => typeof part === "object" && "time" in part);
      check("the points are the website's, with the moment the answer comes by as a moment for the phone to write", f?.points.length === 5 && typeof f.points[0][0] === "object" && "bold" in f.points[0][0] && f.points[0][0].bold === "This is a request, not a reservation." && said !== undefined && Math.abs(new Date(said.time).getTime() - answerBy) < 5000, JSON.stringify(f?.points[1]));
      check("it says that her ID is seen as confirmed, and nothing more", f?.idLine === `${maya.displayName} can see that your ID is confirmed, never your ID or the name on it.`);
      check("the note can hold what the website allows", f?.note.max === LIMITS.noteMax && f.note.label.includes(`only ${maya.displayName} sees it`));
      const again = await summary(maya.handle, slot, cust.jar);
      check("each summary brings a key of its own, the kind the server takes", /^[0-9a-f-]{36}$/.test(f?.requestKey ?? "") && again.body?.kind === "ok" && again.body.requestKey !== f?.requestKey);
      check("it may not be kept by anything on the way", String(free.reply.headers["cache-control"]).includes("no-store"));

      const paidSlot = nextPaid();
      const paid = await summary(noor.handle, paidSlot, cust.jar);
      const p = paid.body?.kind === "ok" ? paid.body : null;
      check("a paid call: the most it can cost, and the price it is worked out from", p?.price === "$40.00 at most ($20.00 per 15 minutes)" && p.seen.price === 2000 && p.seen.freeCancel === 60, p?.price);
      check("the box about the card carries the website's sentence, word for word", p?.cardTerms === CARD_TERMS("$40.00") && p.button === "Continue to card details");
      check("a paid call says the same, with the host's own cancelling rule", p?.what === "A live, private one-to-one video call. It is not recorded. You can cancel for free until 1 hour before the call starts. After that, cancelling costs the full booked price.", p?.what);
      check("the points about the money are all there", p?.points.length === 8 && JSON.stringify(p.points).includes("Nothing is held or charged now.") && JSON.stringify(p.points).includes("until 1 hour before the call starts") && p.points[7].some((part) => typeof part === "object" && "time" in part && new Date(part.time).getTime() === payCutoff(new Date(paidSlot), 60).getTime()));
      // The website's own page for the same time says the same.
      const web = await asBrowser(`/h/${noor.handle}/book?length=30&start=${encodeURIComponent(paidSlot)}`, { jar: cust.jar });
      check("the website's page for the same time says the same sentences", web.status === 200 && web.text.includes(CARD_TERMS("$40.00")) && web.text.includes(`Ask ${noor.displayName} for a call`) && web.text.includes("$40.00 at most ($20.00 per 15 minutes)") && web.text.includes("This is a request, not a reservation."), `${web.status}`);

      const gone = await summary(maya.handle, new Date(new Date(slot).getTime() + 7 * MINUTE).toISOString(), cust.jar);
      check("a time that is not open is said to be gone", gone.body?.kind === "gone" && gone.body.title === "That time is no longer open" && keys(gone.body) === "button,kind,title");
      check("so is a time that is no time at all, and a length she does not offer", (await summary(maya.handle, "soon", cust.jar)).body?.kind === "gone" && (await summary(maya.handle, slot, cust.jar, 45)).body?.kind === "gone");
      await db.insert(schema.blocks).values({ blockerId: maya.id, blockedId: cust.id });
      const blocked = await summary(maya.handle, slot, cust.jar);
      check("a block looks exactly like a time that is gone", blocked.reply.text === gone.reply.text);
      await db.delete(schema.blocks).where(eq(schema.blocks.blockerId, maya.id));
      // A host looking at her own page.
      const self = await asHost(second, "self", `Second Self ${RUN}`);
      const own = await summary(self.handle, (await openTimes(self.handle, second.jar))[6], second.jar);
      check("nobody books themselves", own.body?.kind === "own" && own.body.words === "You cannot book a call with yourself.");
      await db.update(schema.user).set({ pausedAt: now }).where(eq(schema.user.id, cust.id));
      check("a paused person is told so, and shown no summary", refusal((await summary(maya.handle, slot, cust.jar)).reply) === "paused");
      await db.update(schema.user).set({ pausedAt: null }).where(eq(schema.user.id, cust.id));
    }

    // ----------------------------------------------------------------------
    console.log("\n2. Sending a request for a free call");
    let freeId = "";
    {
      const slot = nextFree();
      const s = await okSummary(maya.handle, slot, cust.jar);
      check("what is sent must be whole: no key, a length in words, a tick that is not a tick", refusal(await send(maya.handle, s, cust.jar, { requestKey: undefined })) === "not_valid" && refusal(await send(maya.handle, s, cust.jar, { length: "30" })) === "not_valid" && refusal(await send(maya.handle, s, cust.jar, { cardTerms: "on" })) === "not_valid" && refusal(await send(maya.handle, s, cust.jar, { seen: null })) === "not_valid");
      check("nobody signed in sends nothing", refusal(await send(maya.handle, s, undefined as unknown as Jar)) === "not_signed_in");
      check("a browser cannot send through the app's address", refusal(await asBrowser(`/api/app/hosts/${maya.handle}/book`, { jar: cust.jar, body: { start: s.startsAt, length: 30, requestKey: s.requestKey, seen: s.seen } })) === "not_the_app");
      check("nothing was made by any of those", (await db.select().from(schema.bookings).where(eq(schema.bookings.customerId, cust.id))).length === 0);

      const sent = await send(maya.handle, s, cust.jar, { note: "  About   my garden.  " });
      freeId = (sent.json as AppBookSent | null)?.id ?? "";
      const made1 = await row(freeId);
      check("a free request goes straight to the host", sent.status === 200 && keys(sent.json) === "id" && made1?.stage === "waiting" && made1.customerId === cust.id && made1.hostId === maya.id && made1.source === "customer", `${sent.status} ${sent.text.slice(0, 120)}`);
      check("with the note tidied, the time asked for, and no card", made1?.note === "About my garden." && made1.startsAt.toISOString() === slot && made1.lengthMinutes === 30 && made1.totalCents === 0 && made1.cardConsentVersion === null && made1.stripeSetupIntentId === null);
      check("the customer's time is kept for it", (await busyOf(cust.id)).some((b) => b.bookingId === freeId));
      // The same request made by the website's own function, for someone else at the same time.
      await passId(second.id);
      const { booking: web } = await B.askForCall({ customer: { id: second.id, name: second.name, email: second.email }, hostId: maya.id, startsAt: new Date(slot), lengthMinutes: 30, note: "About my garden.", requestKey: randomUUID(), agreedToCardTerms: false, seen: { pricePer15Cents: 0, freeCancelMinutes: 1440 }, now: new Date() });
      const same = (a: typeof web, b: typeof web) =>
        a.stage === b.stage && a.source === b.source && a.note === b.note && a.totalCents === b.totalCents && a.pricePer15Cents === b.pricePer15Cents && a.freeCancelMinutes === b.freeCancelMinutes && a.breakMinutes === b.breakMinutes && a.endsAt.getTime() === b.endsAt.getTime() && a.payBy === b.payBy && Math.abs((a.respondBy?.getTime() ?? 0) - (b.respondBy?.getTime() ?? 1e15)) < 5000 && a.hostNotifiedAt === b.hostNotifiedAt;
      check("it is the same row, with the same deadlines, as one made by the website's own function", same(made1, web), `${made1?.respondBy?.toISOString()} ${web.respondBy?.toISOString()}`);
      check("and the same email went into the outbox for each of the two", (await emailsTo(cust.email, `Your request to ${maya.displayName} was sent`)) === 1 && (await emailsTo(second.email, `Your request to ${maya.displayName} was sent`)) === 1);

      const twice = await send(maya.handle, s, cust.jar, { note: "Something else" });
      check("sent again with the same key it is the same one request", twice.status === 200 && (twice.json as AppBookSent).id === freeId && (await db.select().from(schema.bookings).where(eq(schema.bookings.customerId, cust.id))).length === 1 && (await row(freeId)).note === "About my garden.");
      const stolen = await send(maya.handle, s, second.jar);
      check("somebody else's key is refused, and gives nothing away", refusal(stolen) === "not_valid" && sentence(stolen) === "This form is out of date. Please reload the page." && !stolen.text.includes(freeId));
      // The answer to a sending can be lost on the way. Sent again later, the request is found as it was made,
      // whatever has changed since: the host's price, or her page being hidden.
      await db.update(schema.hostProfiles).set({ hidden: true, pricePer15Cents: 500 }).where(eq(schema.hostProfiles.userId, maya.id));
      const later = await send(maya.handle, s, cust.jar);
      const laterNew = await send(maya.handle, s, cust.jar, { seen: { price: 500, freeCancel: 1440 } });
      check("sent again after the host changed her price and hid her page, it is still that one request", later.status === 200 && (later.json as AppBookSent).id === freeId && laterNew.status === 200 && (laterNew.json as AppBookSent).id === freeId && (await row(freeId)).totalCents === 0);
      check("while a new request to a hidden page is not found, and somebody else's key still opens nothing", refusal(await send(maya.handle, s, cust.jar, { requestKey: randomUUID() })) === "not_found" && refusal(await send(maya.handle, s, second.jar)) === "not_found");
      await db.update(schema.hostProfiles).set({ hidden: false, pricePer15Cents: 0 }).where(eq(schema.hostProfiles.userId, maya.id));
    }

    // ----------------------------------------------------------------------
    console.log("\n3. Every refusal, in the website's own sentence");
    {
      const s = await okSummary(maya.handle, nextFree(), cust.jar);
      const fresh = () => ({ requestKey: randomUUID() });
      const old = await send(maya.handle, s, cust.jar, { ...fresh(), seen: { price: 500, freeCancel: 1440 } });
      check("a price that is not the one shown", sentence(old) === "This host's price or cancelling rule changed while you were looking. Please check the details again.");
      const rule = await send(maya.handle, s, cust.jar, { ...fresh(), seen: { price: 0, freeCancel: 60 } });
      check("a cancelling rule that is not the one shown", sentence(rule) === sentence(old));
      check("a time that is not open", sentence(await send(maya.handle, s, cust.jar, { ...fresh(), start: new Date(new Date(s.startsAt).getTime() + 7 * MINUTE).toISOString() })) === "That time is no longer open. Please choose another.");
      check("a time that is no time at all", refusal(await send(maya.handle, s, cust.jar, { ...fresh(), start: "soon" })) === "not_valid");
      check("a length she does not offer", sentence(await send(maya.handle, s, cust.jar, { ...fresh(), length: 45 })) === "This host cannot be booked right now.");
      check("a key that is no key", sentence(await send(maya.handle, s, cust.jar, { requestKey: "again" })) === "This form is out of date. Please reload the page.");
      check("a note that is too long", sentence(await send(maya.handle, s, cust.jar, { ...fresh(), note: "x".repeat(LIMITS.noteMax + 1) })) === `The note can be at most ${LIMITS.noteMax} characters.`);
      check("a host that does not exist", refusal(await send(`nobody${RUN}`, s, cust.jar, fresh())) === "not_found");
      const self = (await db.select().from(schema.hostProfiles).where(eq(schema.hostProfiles.userId, second.id)))[0];
      const own = await asApp(`/api/app/hosts/${self.handle}/book`, { jar: second.jar, body: { start: s.startsAt, length: 30, requestKey: randomUUID(), seen: { price: 0, freeCancel: 0 } } });
      check("booking oneself", sentence(own) === "You cannot book a call with yourself.");
      await db.insert(schema.blocks).values({ blockerId: cust.id, blockedId: maya.id });
      check("a block, which reads as a time that is gone", sentence(await send(maya.handle, s, cust.jar, fresh())) === "That time is no longer open. Please choose another.");
      await db.delete(schema.blocks).where(eq(schema.blocks.blockerId, cust.id));
      // Someone without a confirmed ID: a free call, and a host who asks it of everyone.
      const noId = await asApp(`/api/app/hosts/${maya.handle}/book`, { jar: third.jar, body: { start: s.startsAt, length: 30, requestKey: randomUUID(), seen: { price: 0, freeCancel: 1440 } } });
      check("a free call without a confirmed ID", sentence(noId) === "Before your first free call, please confirm who you are on your account page.");
      const ollyTime = (await openTimes(olly.handle, third.jar))[8];
      const strict = await asApp(`/api/app/hosts/${olly.handle}/book`, { jar: third.jar, body: { start: ollyTime, length: 30, requestKey: randomUUID(), cardTerms: true, seen: { price: 2000, freeCancel: 0 } } });
      check("a host who only takes people with a confirmed ID", sentence(strict) === "This host only takes calls from people who have confirmed their ID. Please confirm who you are on your account page.");
      const paidS = await okSummary(noor.handle, nextPaid(), cust.jar);
      const noTick = await send(noor.handle, paidS, cust.jar, { ...fresh(), cardTerms: false });
      const noBox = await send(noor.handle, paidS, cust.jar, { ...fresh(), cardTerms: undefined });
      check("a paid call without the box ticked, or with no box at all: nothing is sent", sentence(noTick) === "Please tick the box about your card to continue." && sentence(noBox) === sentence(noTick));
      await setSwitches({ requestsOff: true });
      check("requests switched off by the founder", sentence(await send(maya.handle, s, cust.jar, fresh())) === "Connect is not taking new requests right now. Please try again later.");
      await restoreSwitches();
      await db.update(schema.user).set({ pausedAt: now }).where(eq(schema.user.id, cust.id));
      check("a paused person", refusal(await send(maya.handle, s, cust.jar, fresh())) === "paused");
      await db.update(schema.user).set({ pausedAt: null }).where(eq(schema.user.id, cust.id));
      check("none of those made a request", (await db.select().from(schema.bookings).where(inArray(schema.bookings.customerId, [cust.id, third.id]))).length === 1 && (await db.select().from(schema.bookings).where(eq(schema.bookings.hostId, second.id))).length === 0);
      // The limit on requests waiting with one host.
      const more = [await okSummary(maya.handle, nextFree(), cust.jar), await okSummary(maya.handle, nextFree(), cust.jar)];
      for (const one of more) await send(maya.handle, one, cust.jar);
      const over = await send(maya.handle, await okSummary(maya.handle, nextFree(), cust.jar), cust.jar);
      check("more waiting requests with one host than allowed", sentence(over) === `You already have ${LIMITS.waitingPerHost} requests waiting with this host. Wait for an answer, or take one back.`, sentence(over));
    }

    // ----------------------------------------------------------------------
    console.log("\n4. The request's own page");
    {
      const { reply, body } = await requestPage(freeId, cust.jar);
      const made1 = await row(freeId);
      check("the customer reads their request", reply.status === 200 && body?.id === freeId && body.title === `Your request to ${maya.displayName}` && body.stage === "waiting" && body.stageWords === "Sent. Waiting for the host's answer.", reply.text.slice(0, 160));
      check("it has exactly the parts the app knows", keys(body) === "call,card,hearBy,hostHandle,id,minutes,notice,price,reason,refreshSeconds,stage,stageWords,startsAt,takeBack,takeBackSure,title,waitingWords", keys(body));
      check("with when, the price, and by when the answer comes", body?.startsAt === made1.startsAt.toISOString() && body.minutes === 30 && body.price.label === "Price" && body.price.words === "Free" && body.hearBy === made1.respondBy?.toISOString());
      check("taking it back is asked about once more, in words that promise only what is true", body?.takeBackSure?.words === "The host will no longer be able to accept it. This cannot be undone." && body.takeBackSure.yes === "Take it back" && body.takeBackSure.no === "Keep it");
      check("it can be taken back, asks again by itself, and has no card step", body?.takeBack === "Take this request back" && body.refreshSeconds === 20 && body.card === null && body.call === null && body.notice === null && body.waitingWords === "This is a request, not a reservation. Other people may ask for the same time, and the host chooses.");
      check("no account id, no email address and no note travels", !reply.text.includes(maya.id) && !reply.text.includes(cust.id) && !reply.text.includes("@example.test") && !reply.text.includes("garden") && body?.hostHandle === maya.handle);
      check("it may not be kept by anything on the way", String(reply.headers["cache-control"]).includes("no-store"));
      check("nobody signed in, somebody else, and a browser get nothing", refusal((await requestPage(freeId)).reply) === "not_signed_in" && refusal((await requestPage(freeId, second.jar)).reply) === "not_found" && refusal(await asBrowser(`/api/app/bookings/${freeId}`, { jar: cust.jar })) === "not_the_app");
      const none = await requestPage(randomUUID(), cust.jar);
      check("a request that does not exist, and an id that is no id, are not found, in the same words as somebody else's", refusal(none.reply) === "not_found" && none.reply.text === (await requestPage(freeId, second.jar)).reply.text && refusal((await requestPage("abc", cust.jar)).reply) === "not_found");
      // Thirty-six characters that only look like an id never reach the database: the same "not found", not an error.
      const dashes = "-".repeat(36);
      const almost = freeId.replace(/-/g, "") + "----";
      check("something that only looks like an id is not found either, at every address", refusal((await requestPage(dashes, cust.jar)).reply) === "not_found" && refusal((await requestPage(almost, cust.jar)).reply) === "not_found" && refusal(await step(dashes, "card", cust.jar)) === "not_found" && refusal(await step(almost, "card-saved", cust.jar)) === "not_found" && refusal(await step(dashes, "take-back", cust.jar)) === "not_found");
      const capitals = await requestPage(freeId.toUpperCase(), cust.jar);
      check("the id written in capitals opens the same request, and the answer names it the server's way", capitals.reply.status === 200 && capitals.body?.id === freeId);
      // The host's side comes with her own screens: a request to her own page is not answered here yet.
      const self = (await db.select().from(schema.hostProfiles).where(eq(schema.hostProfiles.userId, second.id)))[0];
      await passId(third.id);
      const toSelf = await send(self.handle, await okSummary(self.handle, (await openTimes(self.handle, third.jar))[10], third.jar), third.jar);
      check("the host's side of a request is not answered at this address", toSelf.status === 200 && refusal((await requestPage((toSelf.json as AppBookSent).id, second.jar)).reply) === "not_found", toSelf.text.slice(0, 160));
      await db.update(schema.user).set({ pausedAt: now }).where(eq(schema.user.id, cust.id));
      check("a paused person can still read their own request", (await requestPage(freeId, cust.jar)).reply.status === 200);
      await db.update(schema.user).set({ pausedAt: null }).where(eq(schema.user.id, cust.id));
    }

    // ----------------------------------------------------------------------
    console.log("\n5. A paid request: the card step, where only Stripe's word counts");
    {
      const slot = nextPaid();
      const s = await okSummary(noor.handle, slot, second.jar);
      const sent = await send(noor.handle, s, second.jar);
      const id = (sent.json as AppBookSent | null)?.id ?? "";
      let made1 = await row(id);
      check("a paid request waits for its card: nothing has gone to the host", sent.status === 200 && made1?.stage === "card" && made1.requestedAt === null && made1.totalCents === 4000 && made1.freeCancelMinutes === 60, `${sent.status} ${sent.text.slice(0, 160)}`);
      check("the tick is recorded with the wording's version, and Stripe's step is made", made1?.cardConsentVersion === CARD_CONSENT_VERSION && made1.cardConsentAt !== null && Boolean(made1.stripeSetupIntentId));
      check("nobody's time is taken yet, and no email has gone", !(await busyOf(second.id)).some((b) => b.bookingId === id) && (await emailsTo(second.email, `Your request to ${noor.displayName} was sent`)) === 0);
      const page = (await requestPage(id, second.jar)).body;
      check("its page shows the card step, with the website's words and by when", page?.stage === "card" && page.stageWords === "Almost there: enter your card to send the request." && page.card?.title === "Your card" && page.card.words.startsWith("Nothing is held or charged now.") && page.card.button === "Save card and send request" && page.card.deadline.some((part) => typeof part === "object" && "time" in part && part.time === new Date(made1.createdAt.getTime() + LIMITS.cardStepMinutes * MINUTE).toISOString()) && keys(page.card) === "button,deadline,givenUp,notConfirmed,notSaved,title,words" && page.takeBack === null && page.takeBackSure === null && page.hearBy === null, keys(page?.card));
      check("the price line says the most it can cost", page?.price.words === "$40.00 at most");

      const card = await step(id, "card", second.jar);
      const c = card.json as AppCardStep;
      check("the card sheet gets what it needs, and nothing else", card.status === 200 && keys(c) === "clientSecret,merchant,publishableKey" && /^seti_[A-Za-z0-9]+_secret_[A-Za-z0-9]+$/.test(c.clientSecret) && c.publishableKey.startsWith("pk_test_") && c.merchant === "Connect", `${card.status} ${keys(c)}`);
      check("and the secret is never kept on the way", String(card.headers["cache-control"]).includes("no-store"));
      check("nobody else gets it: somebody else, nobody, a browser", refusal(await step(id, "card", cust.jar)) === "not_found" && refusal(await step(id, "card")) === "not_signed_in" && refusal(await asBrowser(`/api/app/bookings/${id}/card`, { jar: second.jar, body: {} })) === "not_the_app");
      check("a step that does not exist is not found", refusal(await step(id, "charge", second.jar)) === "not_found");
      // Stripe's step is made again when it is missing (Stripe had not answered when the request was made).
      const stepId = made1.stripeSetupIntentId;
      await db.update(schema.bookings).set({ stripeSetupIntentId: null }).where(eq(schema.bookings.id, id));
      const remade = await step(id, "card", second.jar);
      made1 = await row(id);
      check("a card step that was never made is made when asked for, and it is the same one step", remade.status === 200 && made1.stripeSetupIntentId === stepId && (remade.json as AppCardStep).clientSecret === c.clientSecret);

      const early = await step(id, "card-saved", second.jar);
      check("saying 'the card is saved' before it is changes nothing", early.status === 200 && (early.json as AppBooking).stage === "card" && (await row(id)).stage === "card");
      // A card the bank refuses: Stripe does not save it.
      await stripe().setupIntents.confirm(stepId!, { payment_method: "pm_card_chargeDeclined", return_url: "https://example.com/return" }).catch(() => undefined);
      const refusedCard = await step(id, "card-saved", second.jar);
      check("after a refused card, nothing is sent either", (refusedCard.json as AppBooking).stage === "card" && (await row(id)).requestedAt === null);
      check("somebody else cannot say it for them", refusal(await step(id, "card-saved", cust.jar)) === "not_found");

      await stripe().setupIntents.confirm(stepId!, { payment_method: "pm_card_visa", return_url: "https://example.com/return" });
      const saved = await step(id, "card-saved", second.jar);
      const after = saved.json as AppBooking;
      made1 = await row(id);
      check("once Stripe says the card is saved, the request goes to the host", saved.status === 200 && after.stage === "waiting" && made1.stage === "waiting" && made1.requestedAt !== null && Boolean(made1.stripePaymentMethodId), `${saved.status} ${after.stage}`);
      check("the answer is the request's page as it stands now", keys(after) === keys(page) && after.card === null && after.takeBack === "Take this request back" && after.hearBy === made1.respondBy?.toISOString() && after.waitingWords?.endsWith("Nothing is held on your card unless you are accepted.") === true);
      check("with the website's deadlines for a paid call", made1.payBy?.getTime() === payCutoff(new Date(slot), 60).getTime() && Math.abs((made1.respondBy?.getTime() ?? 0) - answerDeadline({ startsAt: new Date(slot), paid: true, freeCancelMinutes: 60, requestedAt: made1.requestedAt! }).getTime()) < 1000);
      check("the customer's time is kept and the email has gone", (await busyOf(second.id)).some((b) => b.bookingId === id) && (await emailsTo(second.email, `Your request to ${noor.displayName} was sent`)) === 1);
      const repeat = await step(id, "card-saved", second.jar);
      check("said again, nothing changes and nothing is sent twice", (repeat.json as AppBooking).stage === "waiting" && (await emailsTo(second.email, `Your request to ${noor.displayName} was sent`)) === 1);
      check("a request that is sent needs no card any more", sentence(await step(id, "card", second.jar)) === "This request does not need a card any more.");

      // The card step lasts as long as the customer was told. Past it nothing can be entered or sent on, also in
      // the moments before the helper has ended the request.
      {
        const lateS = await okSummary(noor.handle, nextPaid(), third.jar);
        const lateId = ((await send(noor.handle, lateS, third.jar)).json as AppBookSent).id;
        const lateRow = await row(lateId);
        await db.update(schema.bookings).set({ createdAt: new Date(Date.now() - (LIMITS.cardStepMinutes + 1) * MINUTE) }).where(eq(schema.bookings.id, lateId));
        const latePage = (await requestPage(lateId, third.jar)).body;
        check("past its time the request's page offers no card step, and says why", latePage?.stage === "card" && latePage.card === null && latePage.reason === "The time to enter a card for this request has passed. Nothing was sent.");
        check("and the card sheet is refused", sentence(await step(lateId, "card", third.jar)) === "The time to enter a card for this request has passed. Nothing was sent.");
        // Even a card that Stripe has saved by then sends nothing: the request ends, and the helper removes the card.
        await stripe().setupIntents.confirm(lateRow.stripeSetupIntentId!, { payment_method: "pm_card_visa", return_url: "https://example.com/return" });
        const lateSaved = await step(lateId, "card-saved", third.jar);
        const ended = lateSaved.json as AppBooking;
        check("a card saved after the time sends nothing: the request ends, in the helper's own words", lateSaved.status === 200 && ended.stage === "ran_out" && ended.reason === "Reason: the card was not entered in time." && (await row(lateId)).requestedAt === null && (await emailsTo(third.email, `Your request to ${noor.displayName} was sent`)) === 0, `${lateSaved.status} ${ended.stage} ${ended.reason}`);

        // Requests standing at the card step are counted: they cannot be made without end.
        const drafts: string[] = [];
        for (let i = 0; i < LIMITS.cardStepsOpen; i++) {
          const made2 = await send(noor.handle, await okSummary(noor.handle, nextPaid(), third.jar), third.jar);
          drafts.push((made2.json as AppBookSent | null)?.id ?? "");
        }
        const over = await send(noor.handle, await okSummary(noor.handle, nextPaid(), third.jar), third.jar);
        check(`${LIMITS.cardStepsOpen} requests can stand at the card step, and the next is refused`, drafts.every((id) => /^[0-9a-f-]{36}$/.test(id)) && sentence(over) === "You have several requests waiting for their card. Finish one of them first, or wait until they have ended.", sentence(over));
        check("nothing was made for the one refused", (await db.select().from(schema.bookings).where(and(eq(schema.bookings.customerId, third.id), eq(schema.bookings.stage, "card")))).length === LIMITS.cardStepsOpen);

        // A call asked for "now" (begun on the website) at its card step, while "available now" is switched off for the apps.
        const [instant] = await db
          .insert(schema.bookings)
          .values({ hostId: noor.id, customerId: cust.id, startsAt: new Date(Date.now() + 5 * MINUTE), endsAt: new Date(Date.now() + 35 * MINUTE), lengthMinutes: 30, breakMinutes: 5, pricePer15Cents: 2000, totalCents: 4000, freeCancelMinutes: 0, note: "", stage: "card", source: "now", requestKey: randomUUID(), cardConsentVersion: CARD_CONSENT_VERSION, cardConsentAt: now })
          .returning();
        check("a call asked for now can have its card entered from the app while that is switched on", (await requestPage(instant.id, cust.jar)).body?.card !== null);
        await setSwitches({ appAvailableNow: false });
        const offPage = await requestPage(instant.id, cust.jar);
        check("with 'available now' switched off for the apps, its page can be read but offers no card step", offPage.reply.status === 200 && offPage.body?.stage === "card" && offPage.body.card === null);
        check("and neither card address sends it on", refusal(await step(instant.id, "card", cust.jar)) === "switched_off" && refusal(await step(instant.id, "card-saved", cust.jar)) === "switched_off" && (await row(instant.id)).stage === "card" && (await row(instant.id)).stripeSetupIntentId === null);
        check("an ordinary request's card step is not touched by that switch", (await requestPage(drafts[0], third.jar)).body?.card !== null);
        await restoreSwitches();
      }

      // ----------------------------------------------------------------------
      console.log("\n6. Taking a request back");
      check("somebody else, nobody and a browser cannot take it back", refusal(await step(id, "take-back", cust.jar)) === "not_found" && refusal(await step(id, "take-back")) === "not_signed_in" && refusal(await asBrowser(`/api/app/bookings/${id}/take-back`, { jar: second.jar, body: {} })) === "not_the_app" && (await row(id)).stage === "waiting");
      await db.update(schema.user).set({ pausedAt: now }).where(eq(schema.user.id, second.id));
      const back = await step(id, "take-back", second.jar);
      await db.update(schema.user).set({ pausedAt: null }).where(eq(schema.user.id, second.id));
      const b = back.json as AppBooking;
      check("the customer takes it back (a paused person too), and is told nothing was held", back.status === 200 && b.stage === "taken_back" && b.stageWords === "You took this request back." && b.notice === "Your request was taken back. Nothing was held or charged." && b.takeBack === null && b.refreshSeconds === null, back.text.slice(0, 160));
      check("their time is free again", (await row(id)).stage === "taken_back" && !(await busyOf(second.id)).some((entry) => entry.bookingId === id));
      check("it cannot be taken back twice", sentence(await step(id, "take-back", second.jar)) === "This request can no longer be taken back.");
      await runBookingJobs(new Date());
      made1 = await row(id);
      const method = await stripe().paymentMethods.retrieve((saved.json ? (await stripe().setupIntents.retrieve(stepId!)).payment_method : null) as string);
      check("after the helper's clean-up the card is gone, here and at Stripe", made1.stripeSetupIntentId === null && made1.stripePaymentMethodId === null && method.customer === null, `${made1.stripeSetupIntentId} ${method.customer}`);
    }

    // ----------------------------------------------------------------------
    console.log("\n7. The identity check");
    {
      const fresh = await newPerson("fresh");
      const read = async (jar?: Jar) => {
        const reply = await asApp("/api/app/identity", { jar });
        return { reply, body: reply.status === 200 ? (reply.json as AppIdentity) : null };
      };
      check("nobody signed in, and a browser, get nothing", refusal((await read()).reply) === "not_signed_in" && refusal(await asBrowser("/api/app/identity", { jar: fresh.jar })) === "not_the_app" && refusal(await asBrowser("/api/app/identity/start", { jar: fresh.jar, body: {} })) === "not_the_app");
      const before = await read(fresh.jar);
      check("someone who never did it: what it is, the button, the tries", before.body?.passed === false && before.body.pending === false && before.body.title === "Confirm who you are" && before.body.words.length === 1 && before.body.words[0].startsWith("This confirms that you are a real adult.") && before.body.button === "Start the check" && before.body.tries === "3 of 3 tries left", JSON.stringify(before.body).slice(0, 200));
      check("it has exactly the parts the app knows, and is not kept on the way", keys(before.body) === "button,passed,pending,small,title,tries,words" && String(before.reply.headers["cache-control"]).includes("no-store"));
      const started = await asApp("/api/app/identity/start", { jar: fresh.jar, body: {} });
      const url = (started.json as AppIdentityStart | null)?.url ?? "";
      const checks = await db.select().from(schema.identityChecks).where(eq(schema.identityChecks.userId, fresh.id));
      check("starting it answers with Stripe's own page, and the check is this person's", started.status === 200 && keys(started.json) === "url" && new URL(url).protocol === "https:" && new URL(url).hostname.endsWith(".stripe.com") && checks.length === 1 && checks[0].status === "started", `${started.status} ${keys(started.json)}`);
      const session = await stripe().identity.verificationSessions.retrieve(checks[0].stripeSessionId);
      check("at Stripe it names this person, and nobody else", session.metadata?.userId === fresh.id);
      const during = await read(fresh.jar);
      check("while it is open, the page says so and offers a new one", during.body?.passed === false && during.body.pending === true && during.body.words.includes("Your last check is still being looked at. This usually takes a minute or two.") && during.body.button === "Start a new check" && during.body.tries === "2 of 3 tries left");
      check("somebody else's page knows nothing of it", (await read(cust.jar)).body?.passed === true && (await read(second.jar)).body?.pending === false);

      // The page Stripe sends the person to: for anyone, saying nothing about anyone.
      const done = await asBrowser("/identity/done");
      const doneAs = await asBrowser("/identity/done?next=https://example.com/&user=" + fresh.id, { jar: cust.jar });
      const visible = (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ");
      check("the page Stripe sends people to opens for a browser that never signed in", done.status === 200 && done.text.includes("Return to the Connect app") && done.text.includes('href="connect://identity"'));
      // (What is looked at is what the page shows. The address asked for is also in the page's own bookkeeping, as on every page of the site.)
      const shown = visible(doneAs.text);
      check("it shows nobody, whoever is signed in to that browser and whatever its address carries", doneAs.status === 200 && !shown.includes(cust.name) && !shown.includes("example.com") && !shown.includes(fresh.id) && !/href="[^"]*example\.com/.test(doneAs.text) && shown.trim() === visible(done.text).trim(), shown.replace(/\s+/g, " ").slice(0, 200));
      check("and opening it changed nothing", (await db.select().from(schema.identityChecks).where(eq(schema.identityChecks.userId, fresh.id)))[0].status === "started");

      // The outcomes (pretended: this tool cannot hold an ID up to a camera).
      await db.update(schema.identityChecks).set({ status: "verified", adult: true }).where(eq(schema.identityChecks.userId, fresh.id));
      const passed = await read(fresh.jar);
      check("passed: it says so, and offers nothing more", passed.body?.passed === true && passed.body.words.length === 1 && passed.body.words[0] === "Done. Your identity is confirmed." && passed.body.button === null && passed.body.tries === null);
      check("a check cannot be started again after passing", sentence(await asApp("/api/app/identity/start", { jar: fresh.jar, body: {} })) === "You have already passed the identity check.");
      const s = await summary(maya.handle, nextFree(), fresh.jar);
      check("and the summary of a free call now opens for them", s.body?.kind === "ok");
      // Out of tries.
      const spent = await newPerson("spent");
      await db.insert(schema.identityChecks).values([1, 2, 3].map((n) => ({ userId: spent.id, stripeSessionId: `vs_check_${RUN}_spent${n}`, status: "failed", checkedAt: now })));
      // (Their checks are not at Stripe, so asking Stripe about them fails, and what is known stays.)
      const out = await read(spent.jar);
      check("out of tries: it says to write to us, and offers no button", out.body?.passed === false && out.body.button === null && out.body.tries === null && out.body.words.includes("You have used all 3 tries. Please write to us."), JSON.stringify(out.body).slice(0, 200));
      check("and none can be started", sentence(await asApp("/api/app/identity/start", { jar: spent.jar, body: {} })) === "You have used all your tries. Please write to us.");
      // Cancel the open check at Stripe, so nothing of this run stays open there.
      await stripe().identity.verificationSessions.cancel(checks[0].stripeSessionId).catch(() => undefined);
    }
  } finally {
    await restoreSwitches();
    const ids = made.length ? made : ["-"];
    const mine = await db.select({ id: schema.bookings.id, setup: schema.bookings.stripeSetupIntentId }).from(schema.bookings).where(or(inArray(schema.bookings.customerId, ids), inArray(schema.bookings.hostId, ids)));
    // Nothing of this run stays open at Stripe.
    for (const booking of mine) if (booking.setup) await stripe().setupIntents.cancel(booking.setup).catch(() => undefined);
    const bookingIds = mine.length ? mine.map((b) => b.id) : [randomUUID()];
    await db.delete(schema.busyEntries).where(inArray(schema.busyEntries.bookingId, bookingIds));
    await db.delete(schema.bookingCards).where(inArray(schema.bookingCards.bookingId, bookingIds));
    await db.delete(schema.bookings).where(inArray(schema.bookings.id, bookingIds));
    await db.delete(schema.identityChecks).where(inArray(schema.identityChecks.userId, ids));
    // The test customers this run made at Stripe go too (their saved cards with them).
    for (const one of await db.select().from(schema.stripeCustomers).where(inArray(schema.stripeCustomers.userId, ids))) await stripe().customers.del(one.stripeCustomerId).catch(() => undefined);
    await db.delete(schema.stripeCustomers).where(inArray(schema.stripeCustomers.userId, ids));
    await db.delete(schema.blocks).where(or(inArray(schema.blocks.blockerId, ids), inArray(schema.blocks.blockedId, ids)));
    await db.delete(schema.weeklyHours).where(inArray(schema.weeklyHours.hostId, ids));
    await db.delete(schema.hostCalendars).where(inArray(schema.hostCalendars.userId, ids));
    await db.delete(schema.hostSettings).where(inArray(schema.hostSettings.userId, ids));
    await db.delete(schema.hostProfiles).where(inArray(schema.hostProfiles.userId, ids));
    await db.delete(schema.emailOutbox).where(like(schema.emailOutbox.to, `appbook-${RUN}-%`));
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
