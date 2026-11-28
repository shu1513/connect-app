/**
 * Testing tool: asks the app running on this computer for a call the way the phone app does, and
 * checks it (plans/45-phone-apps/06-asking-for-a-call.md): what a customer reads before sending,
 * in the website's own sentences; that a request sent from the app is the same row, with the same
 * deadlines and the same email, as one made by the website's own function; every refusal; the
 * card step, where only Stripe's word counts; taking a request back; and the identity check,
 * started from the app and read for the person signed in to the app.
 *
 * It saves test cards at Stripe and starts identity checks there, so it runs only with Stripe's
 * test key (nothing is ever held or charged, and nothing real is made). **Start the app it talks
 * to with the same test key** (the same `.env.local`): the app, not this tool, makes the first
 * things at Stripe. The app itself refuses a key that is not a test key unless it was started with
 * ALLOW_LIVE_STRIPE=yes, and this tool stops at the app's first answer about a card if that does
 * not carry this tool's own test key (the same key means the same Stripe test account). By then
 * the app has made one test customer and one card step, and no more. It empties the table of
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
import { answerDeadline, CARD_CONSENT_VERSION, LIMITS, newRequestKey, payCutoff, REQUEST_KEY_LIFE_MS, requestKeyMadeAt } from "../src/lib/booking/rules";
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
    asApp(`/api/app/hosts/${handle}/book`, { jar, body: { start: s.startsAt, length: s.minutes, note: "", requestKey: s.requestKey, ...(s.cardTerms ? { cardTerms: true, cardTermsVersion: s.cardTermsVersion } : {}), seen: s.seen, ...change } });
  const row = async (id: string) => (await db.select().from(schema.bookings).where(eq(schema.bookings.id, id)))[0];
  const requestPage = async (id: string, jar?: Jar) => {
    const reply = await asApp(`/api/app/bookings/${id}`, { jar });
    return { reply, body: reply.status === 200 ? (reply.json as AppBooking) : null };
  };
  const step = (id: string, name: string, jar?: Jar) => asApp(`/api/app/bookings/${id}/${name}`, { jar, body: {} });
  const busyOf = async (userId: string) => db.select().from(schema.busyEntries).where(eq(schema.busyEntries.userId, userId));
  const emailsTo = async (to: string, subjectPart: string) => (await db.select().from(schema.emailOutbox).where(and(eq(schema.emailOutbox.to, to), like(schema.emailOutbox.subject, `%${subjectPart}%`)))).length;
  const CARD_TERMS = (total: string) =>
    `I allow Connect to save my card for this booking only and, if my request is accepted, to hold up to ${total} on it without my being present, and to charge it after the call as described above. If I ask for more time during the call, the price of that extra time is held on the same card and charged in the same way. The card is removed once the call is over. Where a 14-day right to cancel applies to me (in the United Kingdom and Europe): I ask for this call to take place as booked, also within those 14 days, and I understand that the right ends once the call has taken place.`;

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
      check("it has exactly the parts the app knows, and no account id", keys(f) === "button,cardTerms,cardTermsVersion,hostTime,idLine,kind,minutes,note,points,pointsTitle,price,requestKey,seen,seller,startsAt,title,what" && !free.reply.text.includes(maya.id), keys(f));
      // Whether she offers calls as a business or as a private person: her own statement, and nothing until she has made it (plans/46, decision 10).
      const sellerOf = async () => {
        const again = await summary(maya.handle, slot, cust.jar);
        const page = await asApp(`/api/app/hosts/${maya.handle}`, { jar: cust.jar });
        return [again.body?.kind === "ok" ? again.body.seller : "(no summary)", (page.json as AppHostPage | null)?.seller];
      };
      const notSaid = f?.seller;
      await db.update(schema.hostProfiles).set({ sellerKind: "private" }).where(eq(schema.hostProfiles.userId, maya.id));
      const asPrivate = await sellerOf();
      await db.update(schema.hostProfiles).set({ sellerKind: "business" }).where(eq(schema.hostProfiles.userId, maya.id));
      const asBusiness = await sellerOf();
      await db.update(schema.hostProfiles).set({ sellerKind: null }).where(eq(schema.hostProfiles.userId, maya.id));
      check(
        "business or private person: nothing until the host has said, then the website's own line, before asking and on her page",
        notSaid === null && asPrivate[0] === `${maya.displayName} offers calls as a private person, not as a business. Consumer law about buying from a business may then not apply between you and ${maya.displayName}; Connect's own terms do.` && asPrivate[1] === asPrivate[0] && asBusiness[0] === `${maya.displayName} offers calls as a business.` && asBusiness[1] === asBusiness[0],
        JSON.stringify([notSaid, asPrivate, asBusiness]).slice(0, 300),
      );
      check("a free call has no box about a card, and its button sends the request", f?.cardTerms === null && f.cardTermsVersion === null && f.button === "Send request" && f.seen.price === 0 && f.seen.freeCancel === 1440);
      check("it says what is asked for: a live one-to-one call that is not recorded, and a free call's own cancelling rule", f?.what === "A live, private one-to-one video call. It is not recorded. You can cancel for free any time before the call starts." && !JSON.stringify(f).includes("24 hours"), f?.what);
      check("the host's own time is written in her time zone", f?.hostTime.startsWith(`For ${maya.displayName}: `) === true && /C[SD]T$/.test(f?.hostTime ?? ""), f?.hostTime);
      const answerBy = answerDeadline({ startsAt: new Date(slot), paid: false, freeCancelMinutes: 0, requestedAt: new Date() }).getTime();
      const said = f?.points.flat().find((part): part is { time: string } => typeof part === "object" && "time" in part);
      check("the points are the website's, with the moment the answer comes by as a moment for the phone to write", f?.points.length === 5 && typeof f.points[0][0] === "object" && "bold" in f.points[0][0] && f.points[0][0].bold === "This is a request, not a reservation." && said !== undefined && Math.abs(new Date(said.time).getTime() - answerBy) < 5000, JSON.stringify(f?.points[1]));
      check("it says that her ID is seen as confirmed, and nothing more", f?.idLine === `${maya.displayName} can see that your ID is confirmed, never your ID or the name on it.`);
      check("the note can hold what the website allows", f?.note.max === LIMITS.noteMax && f.note.label.includes(`${maya.displayName} sees it, and Connect only if one of you reports the other`));
      const again = await summary(maya.handle, slot, cust.jar);
      check("each summary brings a key of its own, the kind the server takes", /^[0-9a-f-]{36}$/.test(f?.requestKey ?? "") && again.body?.kind === "ok" && again.body.requestKey !== f?.requestKey);
      check("it may not be kept by anything on the way", String(free.reply.headers["cache-control"]).includes("no-store"));

      const paidSlot = nextPaid();
      const paid = await summary(noor.handle, paidSlot, cust.jar);
      const p = paid.body?.kind === "ok" ? paid.body : null;
      check("a paid call: the most it can cost, and the price it is worked out from", p?.price === "$40.00 at most ($20.00 per 15 minutes)" && p.seen.price === 2000 && p.seen.freeCancel === 60, p?.price);
      check("the box about the card carries the website's sentence, word for word", p?.cardTerms === CARD_TERMS("$40.00") && p.cardTermsVersion === CARD_CONSENT_VERSION && p.button === "Continue to card details");
      check("a paid call says the same, with the host's own cancelling rule", p?.what === "A live, private one-to-one video call. It is not recorded. You can cancel for free until 1 hour before the call starts. After that, cancelling costs the full booked price.", p?.what);
      check("the points about the money are all there, with what ending the call himself costs", p?.points.length === 9 && JSON.stringify(p.points).includes("Nothing is held or charged now.") && JSON.stringify(p.points).includes("If you end the call yourself with") && JSON.stringify(p.points).includes("until 1 hour before the call starts") && p.points[8].some((part) => typeof part === "object" && "time" in part && new Date(part.time).getTime() === payCutoff(new Date(paidSlot), 60).getTime()));
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
      // Two sendings with the same key at the very same moment (a second tap, a retry that crosses the first): they
      // are taken one after the other, and both are answered with the one request.
      const both = await okSummary(maya.handle, nextFree(), second.jar);
      const [one, two] = await Promise.all([send(maya.handle, both, second.jar), send(maya.handle, both, second.jar)]);
      check("two sendings with one key at the same moment make one request, and both are told so", one.status === 200 && two.status === 200 && (one.json as AppBookSent).id === (two.json as AppBookSent).id && (await db.select().from(schema.bookings).where(eq(schema.bookings.requestKey, both.requestKey))).length === 1, `${one.status} ${two.status}`);
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

      // A "no" for good uses its key up. A sending with the same key that was held up on its way, and only arrives
      // after everything is in order again, makes nothing: what the app was told stays true.
      const spentKeys = async (userId: string, key: string) => (await db.select().from(schema.spentRequestKeys).where(and(eq(schema.spentRequestKeys.customerId, userId), eq(schema.spentRequestKeys.requestKey, key)))).length;
      const withKey = async (key: string) => (await db.select().from(schema.bookings).where(eq(schema.bookings.requestKey, key))).length;
      const refused = await send(maya.handle, s, cust.jar, { seen: { price: 500, freeCancel: 1440 } });
      const heldUp = await send(maya.handle, s, cust.jar);
      check("a key that was refused for good makes nothing afterwards, though all is in order now", sentence(refused) === sentence(old) && refusal(heldUp) === "not_valid" && sentence(heldUp) === B.KEY_SPENT && (await withKey(s.requestKey)) === 0 && (await spentKeys(cust.id, s.requestKey)) === 1, sentence(heldUp));
      // The same after "not found": her page was hidden when the second try came, and is back when the first arrives.
      const hid = await okSummary(maya.handle, s.startsAt, cust.jar);
      await db.update(schema.hostProfiles).set({ hidden: true }).where(eq(schema.hostProfiles.userId, maya.id));
      const notThere = await send(maya.handle, hid, cust.jar);
      await db.update(schema.hostProfiles).set({ hidden: false }).where(eq(schema.hostProfiles.userId, maya.id));
      const backAgain = await send(maya.handle, hid, cust.jar);
      check("the same after 'not found': the key is used up", refusal(notThere) === "not_found" && sentence(backAgain) === B.KEY_SPENT && (await withKey(hid.requestKey)) === 0);
      check("somebody else's sending is not touched by it: a key is used up for its own person only", (await spentKeys(second.id, s.requestKey)) === 0 && (await spentKeys(second.id, hid.requestKey)) === 0);

      // A sending that has to give up waiting for another with its key (here the place in the queue is held for
      // longer than the app's limit) is told nothing certain: no answer of the door's at all. Its key is not used
      // up, and sent again it goes through. The website's own function has no such limit: it waits, as it always did.
      const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));
      const waitApp = await okSummary(maya.handle, nextFree(), cust.jar);
      const webKey = randomUUID();
      const webTime = nextFree();
      // Each place in the queue is held until it is let go, and the sendings only start once both are held: nothing
      // here depends on how fast anything is.
      const hold = (userId: string, key: string) => {
        let got = () => {};
        let letGo = () => {};
        const held = new Promise<void>((done) => (got = done));
        const until = new Promise<void>((done) => (letGo = done));
        const through = db.transaction(async (tx) => {
          await B.queueForKey(tx, userId, key, { bounded: false });
          got();
          await until;
        });
        return { held, letGo, through };
      };
      const appPlace = hold(cust.id, waitApp.requestKey);
      const webPlace = hold(second.id, webKey);
      await Promise.all([appPlace.held, webPlace.held]);
      const began = Date.now();
      const webCall = B.askForCall({ customer: { id: second.id, name: second.name, email: second.email }, hostId: maya.id, startsAt: new Date(webTime), lengthMinutes: 30, note: "", requestKey: webKey, agreedToCardTerms: false, seen: { pricePer15Cents: 0, freeCancelMinutes: 1440 }, now: new Date() }).then(
        (made) => ({ id: made.booking.id as string | null, after: Date.now() - began, error: "" }),
        (error: Error) => ({ id: null, after: Date.now() - began, error: error.message }),
      );
      // The app's sending comes back by itself, after its waits have run out, while both places are still held.
      // (If it ever lost its limit it would wait for ever: this check gives it 40 seconds, and lets go either way.)
      let gaveUp: Reply = { status: 0, json: null, text: "the app's sending did not come back within 40 seconds", headers: {} };
      let gaveUpAfter = 0;
      let webStillWaits = false;
      try {
        gaveUp = await Promise.race([send(maya.handle, waitApp, cust.jar), pause(40_000).then(() => gaveUp)]);
        gaveUpAfter = Date.now() - began;
        webStillWaits = await Promise.race([webCall.then(() => false), pause(300).then(() => true)]);
      } finally {
        appPlace.letGo();
        webPlace.letGo();
      }
      await Promise.all([appPlace.through, webPlace.through]);
      const web = await webCall;
      check("the app's sending gives up after its limit and is told nothing certain", gaveUp.status === 503 && gaveUp.text === "" && gaveUpAfter >= 8_000 && (await withKey(waitApp.requestKey)) === 0, `${gaveUp.status} after ${gaveUpAfter} ms ${gaveUp.text.slice(0, 80)}`);
      check("its key is not used up: sent again, it goes through", (await spentKeys(cust.id, waitApp.requestKey)) === 0 && (await send(maya.handle, waitApp, cust.jar)).status === 200 && (await withKey(waitApp.requestKey)) === 1);
      check("the website's function is still waiting when the app has given up, and makes its request once the place is free", webStillWaits && web.id !== null && web.after >= gaveUpAfter, JSON.stringify(web));
      // Used-up keys are limited for each person and kept for a day. With the list full, a "no" cannot be written
      // down, so it is not said for good either: the answer is "it cannot be told".
      const full = await okSummary(maya.handle, s.startsAt, second.jar);
      // (This person's list starts empty here: a key used up earlier in this run is still alive, and would rightly be kept.)
      await db.delete(schema.spentRequestKeys).where(eq(schema.spentRequestKeys.customerId, second.id));
      await db.insert(schema.spentRequestKeys).values(Array.from({ length: B.SPENT_KEYS_MAX }, () => ({ customerId: second.id, requestKey: randomUUID() })));
      const notSaid = await send(maya.handle, full, second.jar, { seen: { price: 500, freeCancel: 1440 } });
      check("with a person's list of used-up keys full, a refusal is not said for good", notSaid.status === 503 && notSaid.text === "" && (await spentKeys(second.id, full.requestKey)) === 0, `${notSaid.status}`);
      await db.update(schema.spentRequestKeys).set({ at: new Date(Date.now() - 25 * 3_600_000) }).where(eq(schema.spentRequestKeys.customerId, second.id));
      const saidNow = await send(maya.handle, full, second.jar, { seen: { price: 500, freeCancel: 1440 } });
      const leftOver = (await db.select().from(schema.spentRequestKeys).where(eq(schema.spentRequestKeys.customerId, second.id))).length;
      check("used-up keys older than a day are tidied away, and the refusal is then said", sentence(saidNow) === sentence(old) && leftOver === 1 && (await spentKeys(second.id, full.requestKey)) === 1, `${saidNow.status} ${leftOver}`);
      // Two refusals at the same moment with one place left in the list: one is written down and said, the other is not said for good.
      await db.delete(schema.spentRequestKeys).where(eq(schema.spentRequestKeys.customerId, second.id));
      await db.insert(schema.spentRequestKeys).values(Array.from({ length: B.SPENT_KEYS_MAX - 1 }, () => ({ customerId: second.id, requestKey: randomUUID() })));
      const [pairA, pairB] = [await okSummary(maya.handle, s.startsAt, second.jar), await okSummary(maya.handle, s.startsAt, second.jar)];
      const pair = await Promise.all([send(maya.handle, pairA, second.jar, { seen: { price: 500, freeCancel: 1440 } }), send(maya.handle, pairB, second.jar, { seen: { price: 500, freeCancel: 1440 } })]);
      const inList = (await db.select().from(schema.spentRequestKeys).where(eq(schema.spentRequestKeys.customerId, second.id))).length;
      check("two refusals at once for the last place in the list: one is said, the other is not, and the list is not overfull", pair.map((reply) => reply.status).sort().join() === "400,503" && inList === B.SPENT_KEYS_MAX, `${pair.map((reply) => reply.status).join()} ${inList}`);
      await db.delete(schema.spentRequestKeys).where(eq(schema.spentRequestKeys.customerId, second.id));
      // A key only makes a request for half a day. An older one (a sending held up for longer than a used-up key is
      // remembered, say) makes nothing, though everything else is in order; so does a key the server did not make for the app.
      const fresh2 = await okSummary(maya.handle, s.startsAt, cust.jar);
      const oldKey = newRequestKey(new Date(Date.now() - REQUEST_KEY_LIFE_MS - 60_000));
      const tooOld = await send(maya.handle, fresh2, cust.jar, { requestKey: oldKey });
      const notOurs = await send(maya.handle, fresh2, cust.jar, { requestKey: randomUUID() });
      check("a key older than half a day makes nothing, and neither does one the server did not make for the app", sentence(tooOld) === B.KEY_TOO_OLD && sentence(notOurs) === B.KEY_TOO_OLD && (await withKey(oldKey)) === 0 && requestKeyMadeAt(fresh2.requestKey) !== null && Math.abs(requestKeyMadeAt(fresh2.requestKey)!.getTime() - Date.now()) < 60_000, `${sentence(tooOld)} | ${sentence(notOurs)}`);
      // A request that was made is still found by its key, however old the key has become. (The key is aged in the
      // database: no request can be made with an old key any more.)
      const agedTime = nextFree();
      const agedSummary = await okSummary(maya.handle, agedTime, cust.jar);
      const agedMade = await send(maya.handle, agedSummary, cust.jar);
      const agedKey = newRequestKey(new Date(Date.now() - REQUEST_KEY_LIFE_MS - 60_000));
      await db.update(schema.bookings).set({ requestKey: agedKey }).where(eq(schema.bookings.requestKey, agedSummary.requestKey));
      const agedAgain = await send(maya.handle, agedSummary, cust.jar, { requestKey: agedKey });
      check("a request that was made is still found by its key, however old the key", agedMade.status === 200 && agedAgain.status === 200 && (agedAgain.json as AppBookSent).id === (agedMade.json as AppBookSent).id);
      // The website's own form does not take a key of the app's kind for a new request: an old app key cannot get in that way.
      let throughForm = "made a request";
      const appKind = newRequestKey(new Date());
      await B.askForCall({ customer: { id: cust.id, name: cust.name, email: cust.email }, hostId: maya.id, startsAt: new Date(s.startsAt), lengthMinutes: 30, note: "", requestKey: appKind, agreedToCardTerms: false, seen: { pricePer15Cents: 0, freeCancelMinutes: 1440 }, now: new Date() }).catch((error: Error) => (throughForm = error.message));
      check("the website's form does not make a request with a key of the app's kind", throughForm === "This form is out of date. Please reload the page." && (await withKey(appKind)) === 0, throughForm);
      // A used-up key that names a moment still to come is not forgotten after a day: it is kept until it can make nothing.
      const future = newRequestKey(new Date(Date.now() + 3 * 24 * 3_600_000));
      await db.insert(schema.spentRequestKeys).values([{ customerId: second.id, requestKey: future, at: new Date(Date.now() - 30 * 3_600_000) }, { customerId: second.id, requestKey: newRequestKey(new Date(Date.now() - 40 * 3_600_000)), at: new Date(Date.now() - 30 * 3_600_000) }]);
      const tidying = await okSummary(maya.handle, s.startsAt, second.jar);
      await send(maya.handle, tidying, second.jar, { seen: { price: 500, freeCancel: 1440 } });
      const leftKeys = (await db.select().from(schema.spentRequestKeys).where(eq(schema.spentRequestKeys.customerId, second.id))).map((row) => row.requestKey);
      check("a used-up key that could still make a request later is kept past the day; a dead one is forgotten", leftKeys.includes(future) && leftKeys.includes(tidying.requestKey) && leftKeys.length === 2, String(leftKeys.length));
      await db.delete(schema.spentRequestKeys).where(eq(schema.spentRequestKeys.customerId, second.id));
      // The limit is for the wait for the key only: what was in force before is put back.
      const limits = await db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('lock_timeout', '5s', true)`);
        await B.queueForKey(tx, cust.id, randomUUID(), { bounded: true });
        const [after] = await tx.execute(sql`select current_setting('lock_timeout') as now`);
        return String((after as { now?: unknown }).now);
      });
      check("the wait limit that was in force before is put back after the key is taken", limits === "5s", limits);
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
      const strict = await asApp(`/api/app/hosts/${olly.handle}/book`, { jar: third.jar, body: { start: ollyTime, length: 30, requestKey: randomUUID(), cardTerms: true, cardTermsVersion: CARD_CONSENT_VERSION, seen: { price: 2000, freeCancel: 0 } } });
      check("a host who only takes people with a confirmed ID", sentence(strict) === "This host only takes calls from people who have confirmed their ID. Please confirm who you are on your account page.");
      const paidS = await okSummary(noor.handle, nextPaid(), cust.jar);
      const noTick = await send(noor.handle, paidS, cust.jar, { ...fresh(), cardTerms: false });
      const noBox = await send(noor.handle, paidS, cust.jar, { ...fresh(), cardTerms: undefined });
      check("a paid call without the box ticked, or with no box at all: nothing is sent", sentence(noTick) === "Please tick the box about your card to continue." && sentence(noBox) === sentence(noTick));
      // A tick is for the words it stood beside. Without saying which, or for words that have been changed since, it is no tick.
      check("a tick that does not say which words it was given for is not taken", refusal(await send(noor.handle, paidS, cust.jar, { ...fresh(), cardTermsVersion: undefined })) === "not_valid" && refusal(await send(noor.handle, paidS, cust.jar, { ...fresh(), cardTermsVersion: 7 })) === "not_valid");
      // The website's form hands the same function what it was sent, or "none" when the field was missing: for a paid call that is refused too.
      let noVersion = "";
      await B.askForCall({ customer: { id: cust.id, name: cust.name, email: cust.email }, hostId: noor.id, startsAt: new Date(paidS.startsAt), lengthMinutes: 30, note: "", requestKey: randomUUID(), agreedToCardTerms: true, seen: { pricePer15Cents: 2000, freeCancelMinutes: 60, cardTermsVersion: null }, now: new Date() }).catch((error: Error) => (noVersion = error.message));
      check("a paid form that does not say which wording was ticked sends nothing, on the website either", noVersion === "The words about your card have changed since you opened this page. Please read them again.", noVersion);
      check("a tick given for an earlier wording sends nothing", sentence(await send(noor.handle, paidS, cust.jar, { ...fresh(), cardTermsVersion: "2020-01-a" })) === "The words about your card have changed since you opened this page. Please read them again.");
      await setSwitches({ requestsOff: true });
      check("requests switched off by the founder", sentence(await send(maya.handle, s, cust.jar, fresh())) === "Connect is not taking new requests right now. Please try again later.");
      await restoreSwitches();
      await db.update(schema.user).set({ pausedAt: now }).where(eq(schema.user.id, cust.id));
      check("a paused person", refusal(await send(maya.handle, s, cust.jar, fresh())) === "paused");
      await db.update(schema.user).set({ pausedAt: null }).where(eq(schema.user.id, cust.id));
      // (Two requests were made on purpose above: the sending that gave up waiting, sent again; and the one with the aged key.)
      check("none of those made a request", (await db.select().from(schema.bookings).where(and(inArray(schema.bookings.customerId, [cust.id, third.id]), sql`${schema.bookings.requestKey} not in (${waitApp.requestKey}, ${agedKey})`))).length === 1 && (await db.select().from(schema.bookings).where(eq(schema.bookings.hostId, second.id))).length === 0);
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
      check("it has exactly the parts the app knows", keys(body) === "block,call,card,hearBy,host,hostHandle,id,minutes,notice,price,reason,refreshSeconds,report,role,stage,stageWords,startsAt,takeBack,takeBackSure,title,waitingWords" && body?.role === "customer" && body.host === null, keys(body));
      check("once the request was sent, the customer can report the host from it", body?.report === `Report ${maya.displayName}`);
      check("with when, the price, and by when the answer comes", body?.startsAt === made1.startsAt.toISOString() && body.minutes === 30 && body.price.label === "Price" && body.price.words === "Free" && body.hearBy?.at === made1.respondBy?.toISOString() && body.hearBy?.label === "You will hear by");
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
      // The host of a request reads it as its host (scripts/app-requests-check.ts looks at what she is shown), and never has the customer's steps.
      const self = (await db.select().from(schema.hostProfiles).where(eq(schema.hostProfiles.userId, second.id)))[0];
      await passId(third.id);
      const toSelf = await send(self.handle, await okSummary(self.handle, (await openTimes(self.handle, third.jar))[10], third.jar), third.jar);
      const asHostOf = (toSelf.json as AppBookSent | null)?.id ?? "";
      const hostSide = (await requestPage(asHostOf, second.jar)).body;
      check("the host reads it as the host, without anything that is the customer's to do", toSelf.status === 200 && hostSide?.role === "host" && hostSide.takeBack === null && hostSide.takeBackSure === null && hostSide.card === null && hostSide.waitingWords === null && hostSide.host !== null);
      check("and the customer's steps are not hers: the same 'not found' as for a stranger", refusal(await step(asHostOf, "take-back", second.jar)) === "not_found" && refusal(await step(asHostOf, "card", second.jar)) === "not_found" && refusal(await step(asHostOf, "card-saved", second.jar)) === "not_found" && (await row(asHostOf)).stage === "waiting");
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
      check("its page shows the card step, with the website's words and by when", page?.stage === "card" && page.stageWords === "Almost there: enter your card to send the request." && page.card?.title === "Your card" && page.card.words.startsWith("Nothing is held or charged now.") && page.card.button === "Save card and send request" && page.card.deadline.some((part) => typeof part === "object" && "time" in part && part.time === new Date(made1.createdAt.getTime() + LIMITS.cardStepMinutes * MINUTE).toISOString()) && keys(page.card) === "button,checkAgain,deadline,givenUp,notConfirmed,notSaved,title,words" && page.card.checkAgain === "Check again" && page.refreshSeconds === 30 && page.takeBack === null && page.takeBackSure === null && page.hearBy === null, keys(page?.card));
      check("a request that was not sent yet offers no report", page?.report === null);
      check("the price line says the most it can cost", page?.price.words === "$40.00 at most");

      const card = await step(id, "card", second.jar);
      const c = card.json as AppCardStep;
      if (card.status !== 200) throw new Error("The app at " + BASE + " did not hand out a card step (" + card.status + "). Stopping: what it made at Stripe cannot be checked.");
      // The app this tool talks to must be on Stripe's test key too. Anything else: stop here, before more is made.
      // And on this tool's own test account: what this tool confirms and removes at Stripe must be what the app made there.
      if (card.status === 200 && (!String(c.publishableKey).startsWith("pk_test_") || c.publishableKey !== process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY)) throw new Error("The app at " + BASE + " is not using this tool's Stripe test key (.env.local). Stopping.");
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
      check("the answer is the request's page as it stands now", keys(after) === keys(page) && after.card === null && after.takeBack === "Take this request back" && after.hearBy?.at === made1.respondBy?.toISOString() && after.waitingWords?.endsWith("Nothing is held on your card unless you are accepted.") === true);
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
        check("past its time the request's page offers no card step, says why in place of 'enter your card', and asks again by itself", latePage?.stage === "card" && latePage.card === null && latePage.stageWords === "The time to enter a card for this request has passed. Nothing was sent." && latePage.reason === null && latePage.refreshSeconds === 20, JSON.stringify(latePage).slice(0, 200));
        const lateWeb = await asBrowser(`/bookings/${lateId}`, { jar: third.jar });
        // What the page shows (its own bookkeeping, which repeats the words for the browser, is left out).
        const lateShown = lateWeb.text.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ");
        check("the website's page says the same and shows no card form", lateWeb.status === 200 && lateShown.split("The time to enter a card for this request has passed. Nothing was sent.").length === 2 && !lateShown.includes("Almost there") && lateShown.includes("Choose the time again") && !lateShown.includes("Save card and send request") && !lateShown.includes("The card form could not be loaded"), `${lateWeb.status} ${lateShown.split("The time to enter a card").length - 1} ${lateShown.includes("Almost there")}`);
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
        // One whose time is up no longer stands at the card step, also before the helper has ended it.
        await db.update(schema.bookings).set({ createdAt: new Date(Date.now() - (LIMITS.cardStepMinutes + 1) * MINUTE) }).where(eq(schema.bookings.id, drafts[1]));
        const room = await send(noor.handle, await okSummary(noor.handle, nextPaid(), third.jar), third.jar);
        check("a request whose card time is up no longer counts as standing there", room.status === 200, sentence(room));

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
      check("someone who never did it: what it is, the button, the tries", before.body?.passed === false && before.body.pending === false && before.body.title === "Confirm who you are" && before.body.words.length === 1 && before.body.words[0].startsWith("This confirms that you are a real adult.") && before.body.button === "I agree, continue to Stripe" && before.body.tries === "3 of 3 tries left", JSON.stringify(before.body).slice(0, 200));
      // The Identity Check Notice in effect, in full, above the button (plans/46-agreements-live.md, decision 9).
      const { currentVersion, linkFor, textOf, versionHref } = await import("../src/legal/registry");
      const { parse } = await import("../src/legal/parse");
      const due = currentVersion("identity-check-notice", new Date());
      const notice = before.body?.notice ?? null;
      // The whole text, piece for piece, as the website's own reader gives it for the version in effect.
      const whole = parse(textOf("identity-check-notice", due.version) ?? "", linkFor);
      check("above the button stands the notice in effect, whole (every piece of the website's text), with the address of exactly that version", notice?.name === "identity-check-notice" && notice.version === due.version && notice.href === versionHref("identity-check-notice", due.version) && notice.title.startsWith("Identity Check Notice") && notice.agree.startsWith("By pressing the button you confirm that you have read this notice") && whole.blocks.length > 5 && whole.problems.length === 0 && JSON.stringify(notice.blocks) === JSON.stringify(whole.blocks), `${notice?.version} ${notice?.blocks.length} of ${whole.blocks.length}`);
      const agreed = [{ name: "identity-check-notice", version: due.version }];
      const acceptedLines = () => db.select().from(schema.agreementAcceptances).where(and(eq(schema.agreementAcceptances.userId, fresh.id), eq(schema.agreementAcceptances.document, "identity-check-notice")));
      // Pressing the button is the agreement, and the app must say which notice it showed.
      for (const [label, body] of [
        ["without saying which notice it showed", {}],
        ["naming an older version of the notice", { agreements: [{ name: "identity-check-notice", version: "2020-01-01" }] }],
        ["naming another document", { agreements: [{ name: "terms-of-service", version: due.version }] }],
      ] as const) {
        const tried = await asApp("/api/app/identity/start", { jar: fresh.jar, body });
        check(`a check is not started ${label}: refused in the website's sentence, with no check of this person's and no line of agreement written down`, refusal(tried) === "not_valid" && sentence(tried) === "These documents have changed since this page was opened. Please read them again." && (await db.select().from(schema.identityChecks).where(eq(schema.identityChecks.userId, fresh.id))).length === 0 && (await acceptedLines()).length === 0, `${tried.status} ${tried.text.slice(0, 120)}`);
      }
      check("it has exactly the parts the app knows, and is not kept on the way", keys(before.body) === "button,notice,passed,pending,small,title,tries,words" && keys(before.body?.notice) === "agree,blocks,href,name,open,title,version" && String(before.reply.headers["cache-control"]).includes("no-store"));
      const started = await asApp("/api/app/identity/start", { jar: fresh.jar, body: { agreements: agreed } });
      const url = (started.json as AppIdentityStart | null)?.url ?? "";
      const checks = await db.select().from(schema.identityChecks).where(eq(schema.identityChecks.userId, fresh.id));
      check("starting it answers with Stripe's own page, and the check is this person's", started.status === 200 && keys(started.json) === "url" && new URL(url).protocol === "https:" && new URL(url).hostname.endsWith(".stripe.com") && checks.length === 1 && checks[0].status === "started", `${started.status} ${keys(started.json)}`);
      const lines = await acceptedLines();
      check("the agreement to the notice is written down, once, and the check's own line keeps the notice's version", lines.length === 1 && lines[0].version === due.version && lines[0].occasion === "identity_check" && checks[0]?.noticeVersion === due.version, JSON.stringify(lines.map((l) => [l.version, l.occasion])));
      const session = await stripe().identity.verificationSessions.retrieve(checks[0].stripeSessionId);
      check("at Stripe it names this person, and nobody else", session.metadata?.userId === fresh.id);
      const during = await read(fresh.jar);
      check("while it is open, the page says so and offers a new one", during.body?.passed === false && during.body.pending === true && during.body.words.includes("Your last check is still being looked at. This usually takes a minute or two.") && during.body.button === "I agree, start a new check at Stripe" && during.body.tries === "2 of 3 tries left" && during.body.notice?.version === due.version);
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
      check("passed: it says so, and offers nothing more", passed.body?.passed === true && passed.body.words.length === 1 && passed.body.words[0] === "Done. Your identity is confirmed." && passed.body.button === null && passed.body.tries === null && passed.body.notice === null);
      check("a check cannot be started again after passing", sentence(await asApp("/api/app/identity/start", { jar: fresh.jar, body: { agreements: agreed } })) === "You have already passed the identity check.");
      const s = await summary(maya.handle, nextFree(), fresh.jar);
      check("and the summary of a free call now opens for them", s.body?.kind === "ok");
      // Out of tries.
      const spent = await newPerson("spent");
      await db.insert(schema.identityChecks).values([1, 2, 3].map((n) => ({ userId: spent.id, stripeSessionId: `vs_check_${RUN}_spent${n}`, status: "failed", checkedAt: now })));
      // (Their checks are not at Stripe, so asking Stripe about them fails, and what is known stays.)
      const out = await read(spent.jar);
      check("out of tries: it says to write to us, and offers no button", out.body?.passed === false && out.body.button === null && out.body.tries === null && out.body.notice === null && out.body.words.includes("You have used all 3 tries. Please write to us."), JSON.stringify(out.body).slice(0, 200));
      check("and none can be started", sentence(await asApp("/api/app/identity/start", { jar: spent.jar, body: { agreements: agreed } })) === "You have used all your tries. Please write to us.");
      // A paused account (an "under 18" result pauses it) is told so, and is offered no check.
      await db.update(schema.user).set({ pausedAt: now }).where(eq(schema.user.id, spent.id));
      check("a paused account is told that it is paused, not where the check stands", refusal((await read(spent.jar)).reply) === "paused");
      check("and a paused account starts no check", refusal(await asApp("/api/app/identity/start", { jar: spent.jar, body: { agreements: agreed } })) === "paused");
      await db.update(schema.user).set({ pausedAt: null }).where(eq(schema.user.id, spent.id));
      // Cancel the open check at Stripe, so nothing of this run stays open there.
      await stripe().identity.verificationSessions.cancel(checks[0].stripeSessionId).catch(() => undefined);
    }

    // ----------------------------------------------------------------------
    console.log("\n8. While a pause or a block is not tidied up yet, and a refusal that names no cause (part 09a)");
    {
      // (plans/45-phone-apps/09a-what-is-built-put-right.md, decisions 5 and 6. A pause and a block are written
      // straight into the database here, so the step that ends the requests of the people concerned has not run.)
      const { STOPPED_IN_APP, STOPPED_WHILE_OPEN } = await import("../src/lib/disputes/paying");
      const { whileDisputed } = await import("./stopped-customer");
      const GONE = "This request is no longer available.";
      const guest = await newPerson("guest");
      await passId(guest.id);
      const self = (await db.select().from(schema.hostProfiles).where(eq(schema.hostProfiles.userId, second.id)))[0];
      const selfTimes = await openTimes(self.handle, guest.jar);
      const sentTo = await send(self.handle, await okSummary(self.handle, selfTimes[14], guest.jar), guest.jar);
      const id = (sentTo.json as AppBookSent | null)?.id ?? "";
      if (!id) throw new Error(`The request for part 8 could not be made: ${sentTo.status} ${sentTo.text.slice(0, 160)}`);
      // A second request to the same host, for her to decline while her own account is paused.
      const sentToo = await send(self.handle, await okSummary(self.handle, selfTimes[17], guest.jar), guest.jar);
      const declineId = (sentToo.json as AppBookSent | null)?.id ?? "";
      if (!declineId) throw new Error(`The second request for part 8 could not be made: ${sentToo.status} ${sentToo.text.slice(0, 160)}`);
      /** Whether a request's page was really read, and offers the card step. (A reading that failed offers nothing.) */
      const offersCard = async (bookingId: string, jar: Jar) => {
        const page = (await requestPage(bookingId, jar)).body;
        return page !== null && page.card !== null;
      };
      const setPaused = (userId: string, on: boolean) => db.update(schema.user).set({ pausedAt: on ? new Date() : null }).where(eq(schema.user.id, userId));
      /** A page whose details are withheld: the one sentence, a heading that names nobody, no step, and none of the other person's names anywhere in the answer. */
      const withheld = (reply: Reply, otherNames: string[]) => {
        const page = reply.status === 200 ? (reply.json as AppBooking) : null;
        if (!page || page.stageWords !== GONE || page.title !== "A request for a call" || page.hostHandle !== null || page.reason !== null) return false;
        if (page.hearBy !== null || page.card !== null || page.takeBack !== null || page.takeBackSure !== null || page.waitingWords !== null || page.refreshSeconds !== null) return false;
        const host = page.host;
        if (host !== null && !(host.customerName === "" && host.known === false && host.rating === null && host.ratingWords === null && host.idConfirmed === false && host.words === null && host.note === null && host.answer === null && host.photoId === null)) return false;
        return otherNames.every((name) => !reply.text.includes(name));
      };

      // A customer paused a moment ago.
      await setPaused(guest.id, true);
      const own = await requestPage(id, guest.jar);
      check(
        "a customer paused a moment ago still reads their own request, and is offered only what a paused person may do: take it back, report, block",
        own.body?.stageWords === "Sent. Waiting for the host's answer." && own.body.title === `Your request to ${self.displayName}` && own.body.takeBack !== null && own.body.card === null && own.body.report === `Report ${self.displayName}` && own.body.block?.label === `Block ${self.displayName}`,
        own.reply.text.slice(0, 200),
      );
      const hostLooks = await requestPage(id, second.jar);
      check("the host, asking for that request directly, is told it is no longer available: no name in any field, and no step", withheld(hostLooks.reply, [guest.name]) && hostLooks.body?.role === "host", hostLooks.reply.text.slice(0, 240));
      check('"Report" and "Block" are still there for her, under labels that name nobody', hostLooks.body?.report === "Report this person" && hostLooks.body.block?.label === "Block this person" && hostLooks.body.block.sure.startsWith("This person will not be able to ask you for calls any more"), JSON.stringify([hostLooks.body?.report, hostLooks.body?.block]));
      const noNote = await asApp(`/api/app/bookings/${id}/note`, { jar: second.jar, body: { text: "Written during the pause.", shown: null } });
      check("the note that hangs on the request is not taken while its details are withheld, and nothing is written", refusal(noNote) === "not_valid" && sentence(noNote) === `${GONE} Nothing was saved. What you typed is still in the box.` && (await db.select().from(schema.hostNotes).where(eq(schema.hostNotes.hostId, second.id))).length === 0, sentence(noNote));
      check("accepting it is refused by the step itself", sentence(await step(id, "accept", second.jar)) === "This customer's account is no longer active." && (await row(id)).stage === "waiting");
      await setPaused(guest.id, false);

      // A host paused a moment ago.
      await setPaused(second.id, true);
      const hers = await requestPage(id, second.jar);
      const offered = hers.body?.host?.answer ?? null;
      check("a host paused a moment ago still reads the request, and is offered declining only: no Accept, which the address refuses", hers.body?.role === "host" && hers.body.host?.customerName === guest.name && offered !== null && offered.accept === null && offered.decline === "Decline" && offered.kind === "booked" && refusal(await step(id, "accept", second.jar)) === "paused" && (await row(id)).stage === "waiting", JSON.stringify(hers.body?.host).slice(0, 300));
      const declined = await step(declineId, "decline", second.jar);
      const declinedPage = declined.status === 200 ? (declined.json as AppBooking) : null;
      check("and she can decline from the phone while paused: the request is declined, and the answer is its page as it stands", declinedPage !== null && declinedPage.stage === "declined" && declinedPage.stageWords === "You declined this request." && declinedPage.host?.answer === null && (await row(declineId)).stage === "declined", `${declined.status} ${declined.text.slice(0, 160)}`);
      const custLooks = await requestPage(id, guest.jar);
      check("her customer, asking for the request directly, is told it is no longer available: no name, no host's page, nothing to take back", withheld(custLooks.reply, [self.displayName, self.handle]) && custLooks.body?.role === "customer" && custLooks.body.host === null, custLooks.reply.text.slice(0, 240));
      check('and can still report or block, under labels that name nobody', custLooks.body?.report === "Report this person" && custLooks.body.block?.label === "Block this person");
      // Her own pause keeps her own things for her only while it is the ONE thing in the way. With the customer's
      // account paused as well, or a block between the two, it gives her nothing of the customer: no name, no words,
      // no note, and no note can be saved.
      await setPaused(guest.id, true);
      const bothPaused = await requestPage(id, second.jar);
      const noteBoth = await asApp(`/api/app/bookings/${id}/note`, { jar: second.jar, body: { text: "Written while both are paused.", shown: null } });
      check("a paused host whose customer is paused too is told the request is no longer available, with no name in any field", withheld(bothPaused.reply, [guest.name]) && bothPaused.body?.role === "host", bothPaused.reply.text.slice(0, 240));
      check("and she can save no note on it", refusal(noteBoth) === "not_valid" && sentence(noteBoth) === `${GONE} Nothing was saved. What you typed is still in the box.` && (await db.select().from(schema.hostNotes).where(eq(schema.hostNotes.hostId, second.id))).length === 0, sentence(noteBoth));
      check("the same for the paused customer of a paused host: his own pause gives him nothing of her", withheld((await requestPage(id, guest.jar)).reply, [self.displayName, self.handle]));
      await setPaused(guest.id, false);
      await db.insert(schema.blocks).values({ blockerId: guest.id, blockedId: second.id });
      const pausedAndBlocked = await requestPage(id, second.jar);
      const noteBlocked = await asApp(`/api/app/bookings/${id}/note`, { jar: second.jar, body: { text: "Written across a block.", shown: null } });
      check("nor does a paused host get anything of a customer across a block: no name, and no note is taken", withheld(pausedAndBlocked.reply, [guest.name]) && refusal(noteBlocked) === "not_valid" && sentence(noteBlocked).startsWith(GONE) && (await db.select().from(schema.hostNotes).where(eq(schema.hostNotes.hostId, second.id))).length === 0, pausedAndBlocked.reply.text.slice(0, 240));
      await db.delete(schema.blocks).where(eq(schema.blocks.blockerId, guest.id));
      await setPaused(second.id, false);

      // A block between the two that has not ended the request (yet).
      await db.insert(schema.blocks).values({ blockerId: guest.id, blockedId: second.id });
      const blocker = await requestPage(id, guest.jar);
      const blockedOne = await requestPage(id, second.jar);
      check("across a block each of the two is told the request is no longer available, with no name and no step", withheld(blocker.reply, [self.displayName, self.handle]) && withheld(blockedOne.reply, [guest.name]), `${blocker.reply.text.slice(0, 120)} | ${blockedOne.reply.text.slice(0, 120)}`);
      check('"Report" stays for both; "Block" stays for the one who has not blocked, and is not offered a second time to the one who has', blocker.body?.report === "Report this person" && blockedOne.body?.report === "Report this person" && blockedOne.body.block?.label === "Block this person" && blocker.body.block === null);
      await db.delete(schema.blocks).where(eq(schema.blocks.blockerId, guest.id));
      check("with the block gone the request reads as before, for both", (await requestPage(id, guest.jar)).body?.title === `Your request to ${self.displayName}` && (await requestPage(id, second.jar)).body?.host?.customerName === guest.name);

      // A paid request at its card step, and its host paused a moment ago: no card is saved for it.
      const paidSent = await send(noor.handle, await okSummary(noor.handle, nextPaid(), guest.jar), guest.jar);
      const cardId = (paidSent.json as AppBookSent | null)?.id ?? "";
      check("(a paid request stands at its card step, and offers the card)", (await offersCard(cardId, guest.jar)) && (await row(cardId))?.stage === "card", `${paidSent.status} ${paidSent.text.slice(0, 120)}`);
      await setPaused(noor.id, true);
      const stopped = await requestPage(cardId, guest.jar);
      check("with the host paused a moment ago, the request's page shows the sentence alone: no card step, no Report, no Block", withheld(stopped.reply, [noor.displayName, noor.handle]) && stopped.body?.report === null && stopped.body.block === null, stopped.reply.text.slice(0, 240));
      const noCard = await step(cardId, "card", guest.jar);
      check(
        "and no card can be saved for it: the address refuses in the page's sentence, the step behind it hands out nothing, and blocking through it stays refused",
        refusal(noCard) === "not_valid" && sentence(noCard) === GONE && (await B.cardStepOf({ bookingId: cardId, customer: { id: guest.id, name: guest.name, email: guest.email }, now: new Date() })) === null && refusal(await step(cardId, "block", guest.jar)) === "not_found" && (await row(cardId)).stage === "card",
        `${noCard.status} ${sentence(noCard)}`,
      );
      await setPaused(noor.id, false);
      check("(with the pause lifted the card step is offered again)", await offersCard(cardId, guest.jar));
      await setPaused(guest.id, true);
      check("a paused customer's own request at its card step shows the sentence alone too: entering a card is refused to a paused person", withheld((await requestPage(cardId, guest.jar)).reply, [noor.displayName, noor.handle]) && refusal(await step(cardId, "card", guest.jar)) === "paused");
      await setPaused(guest.id, false);

      // A request that ran out at its card step was never sent: no "Report" (a report also blocks) and no "Block" on
      // its page, and the app takes no report from it. (Written straight into the database, as one that the helper ended.)
      {
        const { REPORT_REASONS } = await import("../src/lib/safety/reports");
        const slot = new Date(nextPaid());
        const [ranOut] = await db
          .insert(schema.bookings)
          .values({ hostId: noor.id, customerId: guest.id, startsAt: slot, endsAt: new Date(slot.getTime() + 30 * MINUTE), lengthMinutes: 30, breakMinutes: 5, pricePer15Cents: 2000, totalCents: 4000, freeCancelMinutes: 60, note: "", stage: "ran_out", source: "customer", requestKey: randomUUID(), endedReason: "the card was not entered in time", endedAt: now })
          .returning();
        const neverSent = (await requestPage(ranOut.id, guest.jar)).body;
        check('a request that ran out at its card step offers neither "Report" nor "Block"', neverSent !== null && neverSent.stage === "ran_out" && neverSent.report === null && neverSent.block === null, JSON.stringify([neverSent?.report, neverSent?.block]));
        const reported = await asApp("/api/app/report", { jar: guest.jar, body: { place: "booking", id: ranOut.id, reason: REPORT_REASONS[0].key, text: "" } });
        const written = await db.select().from(schema.reports).where(eq(schema.reports.reporterId, guest.id));
        const blocksMade = await db.select().from(schema.blocks).where(and(eq(schema.blocks.blockerId, guest.id), eq(schema.blocks.blockedId, noor.id)));
        check("and a report sent from it all the same is refused: nothing is written down, and nobody is blocked", refusal(reported) === "not_valid" && sentence(reported) === "Request not found." && written.length === 0 && blocksMade.length === 0, `${reported.status} ${reported.text.slice(0, 160)}`);
        // (Should that ever fail, what it made is taken away again, so the rest of this run and its clean-up are not in its way.)
        await db.delete(schema.reports).where(eq(schema.reports.reporterId, guest.id));
        await db.delete(schema.blocks).where(and(eq(schema.blocks.blockerId, guest.id), eq(schema.blocks.blockedId, noor.id)));
      }

      // A customer whose bank has an open dispute cannot start anything new that costs money (plans/47, decision 9).
      // In the app the refusal names no bank and no dispute, whatever the dispute was about.
      /** The same as `whileDisputed`, for a dispute about a contribution: written straight into the database, and taken away again. */
      const whileContributionDisputed = async <T>(customerId: string, hostId: string, work: () => Promise<T>): Promise<T> => {
        const disputeId = `du_check_${randomUUID().replace(/-/g, "")}`;
        // All four rows in one step: either all of them are there, or (should one be refused) none is left behind.
        const { project, contribution, payment } = await db.transaction(async (tx) => {
          const [project] = await tx.insert(schema.projects).values({ hostId, name: `Album ${RUN}`, startedAt: new Date(Date.now() - 60 * 24 * 60 * MINUTE) }).returning();
          const [contribution] = await tx.insert(schema.contributions).values({ projectId: project.id, hostId, contributorId: customerId, kind: "once", amountCents: 2500, requestKey: randomUUID() }).returning();
          const [payment] = await tx.insert(schema.contributionPayments).values({ contributionId: contribution.id, number: 1, originKey: `check-${randomUUID()}`, amountCents: 2500, feePercentBps: 0, feeFixedCents: 0, feeForeignCardBps: 0 }).returning();
          await tx.insert(schema.disputes).values({ id: disputeId, contributionPaymentId: payment.id, hostId, customerId, amountCents: 2500, reason: "fraudulent", stage: "chargeback", status: "needs_response", openedAt: new Date(), stageBeganAt: new Date() });
          return { project, contribution, payment };
        });
        try {
          return await work();
        } finally {
          await db.delete(schema.disputes).where(eq(schema.disputes.id, disputeId));
          await db.delete(schema.contributionPayments).where(eq(schema.contributionPayments.id, payment.id));
          await db.delete(schema.contributions).where(eq(schema.contributions.id, contribution.id));
          await db.delete(schema.projects).where(eq(schema.projects.id, project.id));
        }
      };
      const disputeSlot = nextPaid();
      const tryPaid = async () => send(noor.handle, await okSummary(noor.handle, disputeSlot, guest.jar), guest.jar);
      const overCall = await whileDisputed(guest.id, noor.id, tryPaid);
      const overContribution = await whileContributionDisputed(guest.id, noor.id, tryPaid);
      check("a paid request refused in the app after a bank dispute about a call: the app's own sentence", overCall.status === 400 && refusal(overCall) === "not_valid" && sentence(overCall) === STOPPED_IN_APP, `${overCall.status} ${sentence(overCall)}`);
      check("after a dispute about a contribution the app's answer is the same, word for word and field for field", overContribution.status === overCall.status && overContribution.text === overCall.text, overContribution.text.slice(0, 200));
      check('neither answer holds "bank" or "dispute", or anything about a contribution', !/bank|dispute|chargeback|contribution/i.test(`${overCall.text} ${overContribution.text}`));
      let onWebsite = "";
      await whileContributionDisputed(guest.id, noor.id, () =>
        B.askForCall({ customer: { id: guest.id, name: guest.name, email: guest.email }, hostId: noor.id, startsAt: new Date(disputeSlot), lengthMinutes: 30, note: "", requestKey: randomUUID(), agreedToCardTerms: true, seen: { pricePer15Cents: 2000, freeCancelMinutes: 60, cardTermsVersion: CARD_CONSENT_VERSION }, now: new Date() }).then(
          () => undefined,
          (error: Error) => {
            onWebsite = error.message;
          },
        ),
      );
      check("the website's own function keeps its sentence, which says why", onWebsite === STOPPED_WHILE_OPEN, onWebsite);
      // (Two requests of his with her are there already: the one at its card step, and the one that ran out there.)
      check("and none of those made a request", (await db.select().from(schema.bookings).where(and(eq(schema.bookings.customerId, guest.id), eq(schema.bookings.hostId, noor.id)))).length === 2);
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
    await db.delete(schema.agreementAcceptances).where(inArray(schema.agreementAcceptances.userId, ids));
    // The test customers this run made at Stripe go too (their saved cards with them).
    // One that could not be removed there is said, and counts as a failed check: its id is the way to remove it by hand.
    for (const one of await db.select().from(schema.stripeCustomers).where(inArray(schema.stripeCustomers.userId, ids))) {
      const gone = await stripe()
        .customers.del(one.stripeCustomerId)
        .then(() => true)
        .catch((error: { code?: string }) => error?.code === "resource_missing");
      if (!gone) check(`the test customer ${one.stripeCustomerId} was removed at Stripe`, false, "remove it by hand in Stripe's test dashboard");
    }
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
