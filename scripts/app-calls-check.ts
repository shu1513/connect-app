/**
 * Testing tool: asks the app running on this computer for a person's calls and for one call's page
 * the way the phone app does, and checks them (plans/45-phone-apps/08-the-calls-page.md): the
 * coming and the past calls, a page at a time; one call's page in each of its states, in the
 * website's own sentences; the customer's confirm-and-pay step, where a hold started from the app
 * is the very hold the website would start, and only Stripe's word counts; and cancelling: free,
 * late, as the host, after the start, and when it turned from free to charged while the person
 * was looking.
 *
 * It places holds at Stripe with Stripe's test cards, so it runs only with Stripe's test key
 * (start the app it talks to with the same `.env.local`). It empties the table of attempt limits
 * as it goes, so it only runs against a database made for checking (its name must end in
 * "_check"). It removes what it made, here and at Stripe. It never prints a secret.
 *
 * Usage: DATABASE_URL=…/something_check npx tsx scripts/app-calls-check.ts [--app=http://localhost:3000]
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { randomBytes, randomUUID } from "node:crypto";
import http from "node:http";
import { and, desc, eq, inArray, like, sql } from "drizzle-orm";
import { APP_ORIGIN } from "../src/lib/auth-rules";
import { APP_HEADER, SIGN_IN_HEADER } from "../src/lib/app-door/rules";
import type { AppCallPage, AppCalls, AppHome, AppPayStep, Refusal } from "../src/lib/app-door/types";
import { payOpensAt } from "../src/lib/payments/rules";
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
/** The hidden fields of the website form that holds a field of this name, as the page was sent. */
function formFields(html: string, holding: string): Record<string, string> | null {
  for (const form of html.match(/<form[\s\S]*?<\/form>/g) ?? []) {
    if (!form.includes(`name="${holding}"`)) continue;
    const fields: Record<string, string> = {};
    for (const input of form.match(/<input[^>]*>/g) ?? []) {
      const name = /name="([^"]*)"/.exec(input)?.[1];
      const value = /value="([^"]*)"/.exec(input)?.[1] ?? "";
      if (name && /type="hidden"/.test(input)) fields[name] = value.replace(/&amp;/g, "&").replace(/&quot;/g, '"');
    }
    return fields;
  }
  return null;
}
/** Sends a website form as a browser does when its button is pressed, and says where the website sends the person next. */
function postForm(path: string, fields: Record<string, string>, jar: Jar): Promise<{ status: number; to: string }> {
  const boundary = `----check${randomUUID()}`;
  const body = Buffer.from(Object.entries(fields).map(([name, value]) => `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`).join("") + `--${boundary}--\r\n`);
  const headers = { origin: BASE, "sec-fetch-site": "same-origin", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document", cookie: asCookie(jar), "content-type": `multipart/form-data; boundary=${boundary}`, "content-length": String(body.length) };
  return new Promise((resolve, reject) => {
    const request = http.request(new URL(`${BASE}${path}`), { method: "POST", headers }, (response) => {
      response.resume();
      response.on("end", () => resolve({ status: response.statusCode ?? 0, to: String(response.headers.location ?? "") }));
    });
    request.on("error", reject);
    request.end(body);
  });
}
const refusal = (reply: Reply) => (reply.json as Refusal | null)?.error?.code ?? `no code, status ${reply.status}`;
const sentence = (reply: Reply) => (reply.json as Refusal | null)?.error?.message ?? `no sentence, status ${reply.status}`;
const keys = (value: unknown) => Object.keys((value ?? {}) as object).sort().join(",");

const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

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
  const { createPaymentForCall } = await import("../src/lib/payments/hold");
  await db.delete(schema.rateLimit);

  const now = new Date();
  const made: string[] = [];
  const callIds: string[] = [];
  /** Signs up the app's way, confirms the email in a browser, finishes "18 and terms" (pretended), and signs in the app's way. */
  async function newPerson(name: string) {
    const person = { name: `Caller ${name} ${RUN}`, email: `appcalls-${RUN}-${name}@example.test`, password: randomBytes(12).toString("base64url"), jar: new Map() as Jar };
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
  /**
   * A call between two people, written straight to the database (as the website's own payments check makes them),
   * with its payment when it has a price. `startsIn` and `minutes` in minutes; a negative start is a call in the past.
   */
  async function newCall(hostId: string, customerId: string, options: { startsIn: number; minutes?: number; price?: number; freeCancel?: number; cancelled?: boolean }) {
    const startsAt = new Date(Math.ceil((Date.now() + options.startsIn * MINUTE) / 1000) * 1000);
    const endsAt = new Date(startsAt.getTime() + (options.minutes ?? 30) * MINUTE);
    return db.transaction(async (tx) => {
      const [call] = await tx
        .insert(schema.calls)
        .values({ hostId, customerId, startsAt, endsAt, roomName: `appcalls-${randomUUID()}`, pricePer15Cents: options.price ?? 0, freeCancelMinutes: options.freeCancel ?? 0, ...(options.cancelled ? { cancelledAt: now, cancelledBy: "customer" } : {}) })
        .returning();
      callIds.push(call.id);
      if ((options.price ?? 0) > 0) await createPaymentForCall(tx, call);
      const [payment] = await tx.select().from(schema.payments).where(eq(schema.payments.callId, call.id));
      return { call, payment: payment ?? null };
    });
  }
  const calls = async (kind: string, jar?: Jar, page = "1") => {
    const reply = await asApp(`/api/app/calls?kind=${kind}&page=${page}`, { jar });
    return { reply, body: reply.status === 200 ? (reply.json as AppCalls) : null };
  };
  const callPage = async (id: string, jar?: Jar) => {
    const reply = await asApp(`/api/app/calls/${id}`, { jar });
    return { reply, body: reply.status === 200 ? (reply.json as AppCallPage) : null };
  };
  const step = (id: string, name: string, jar?: Jar, body: unknown = {}) => asApp(`/api/app/calls/${id}/${name}`, { jar, body });
  const callRow = async (id: string) => (await db.select().from(schema.calls).where(eq(schema.calls.id, id)))[0];
  const paymentOf = async (callId: string) => (await db.select().from(schema.payments).where(eq(schema.payments.callId, callId)))[0];
  /** Confirms the hold of a call at Stripe with one of Stripe's test cards, as the card sheet would. */
  const confirmAtStripe = async (callId: string, testCard: string) => {
    const payment = await paymentOf(callId);
    // What Stripe said, so a check can tell "the card was declined" from anything else that went wrong.
    return stripe()
      .paymentIntents.confirm(payment.stripePaymentIntentId!, { payment_method: testCard, return_url: "https://example.com/return" })
      .then(
        (intent) => ({ status: String(intent.status), code: "" }),
        (error: { code?: string }) => ({ status: "", code: String(error?.code ?? "unknown") }),
      );
  };
  const CHANGED = "Cancelling this call is no longer free: it would now be charged in full. Nothing was cancelled. Please read what cancelling means now.";

  try {
    const host = await newPerson("host");
    const cust = await newPerson("cust");
    const stranger = await newPerson("stranger");
    const handle = `ac${RUN}host`;
    await db.insert(schema.hostProfiles).values({ userId: host.id, handle, handleKey: handle, displayName: `Hana Calls ${RUN}`, pricePer15Cents: 2000, status: "approved", usConfirmedAt: now });
    const hostName = `Hana Calls ${RUN}`;

    // ----------------------------------------------------------------------
    console.log("\n1. The Calls place: coming calls and past calls");
    const soon = await newCall(host.id, cust.id, { startsIn: 3 * 60 });
    const farAhead = await newCall(host.id, cust.id, { startsIn: 40 * 24 * 60 });
    {
      for (const hours of [26, 50, 74]) await newCall(host.id, cust.id, { startsIn: hours * 60 });
      const over = await newCall(host.id, cust.id, { startsIn: -26 * 60 });
      const called = await newCall(host.id, cust.id, { startsIn: 5 * 24 * 60, cancelled: true });
      check("nobody signed in, and a browser, get nothing", refusal((await calls("coming")).reply) === "not_signed_in" && refusal(await asBrowser("/api/app/calls?kind=coming", { jar: cust.jar })) === "not_the_app");
      check("a kind or a page that is none is refused", refusal((await calls("all", cust.jar)).reply) === "not_valid" && refusal((await calls("coming", cust.jar, "0")).reply) === "not_valid" && refusal((await calls("past", cust.jar, "x")).reply) === "not_valid");
      const { reply, body } = await calls("coming", cust.jar);
      check("the customer's coming calls, the soonest first, each once", reply.status === 200 && body?.kind === "coming" && body.title === "Coming calls" && body.calls.length === 5 && body.calls[0].id === soon.call.id && body.calls.map((c) => c.startsAt).join() === [...body.calls.map((c) => c.startsAt)].sort().join() && body.more === false && body.empty === null, `${reply.status} ${body?.calls.length}`);
      check("a call far ahead is among them", body?.calls.at(-1)?.id === farAhead.call.id);
      const home = (await asApp("/api/app/home", { jar: cust.jar })).json as AppHome;
      check("which the home page does not load", !home.calls.some((c) => c.id === farAhead.call.id));
      const one = body?.calls[0];
      check("a call says who with (the host by the name on her page), and nothing of an account", one?.name === hostName && one.hosting === false && one.status === null && one.finished === false && !reply.text.includes(host.id) && !reply.text.includes(cust.id) && !reply.text.includes("@example.test"));
      check("each call has exactly the parts the app knows", keys(one) === "endsAt,finished,hosting,id,minutes,name,open,payment,photoId,startsAt,status", keys(one));
      check("it has exactly the parts the app knows, and is not kept on the way", keys(body) === "calls,empty,kind,more,page,serverNow,title" && String(reply.headers["cache-control"]).includes("no-store"));
      const hosted = await calls("coming", host.jar);
      check("the host sees the same calls from her side, by the customer's name", hosted.body?.calls.length === 5 && hosted.body.calls[0].name === cust.name && hosted.body.calls[0].hosting === true);
      check("a stranger has none, and is told so", (await calls("coming", stranger.jar)).body?.calls.length === 0 && (await calls("coming", stranger.jar)).body?.empty === "You have no call coming up.");
      const past = await calls("past", cust.jar);
      check("past calls: the ones that are over and the cancelled ones, the newest first", past.body?.kind === "past" && past.body.title === "Past calls" && past.body.calls.length === 2 && past.body.calls[0].id === called.call.id && past.body.calls[0].status === "Cancelled" && past.body.calls[1].id === over.call.id && past.body.calls[1].status === "Ended", JSON.stringify(past.body?.calls.map((c) => c.status)));
      check("a past call is never open, also one that was cancelled before its time", past.body?.calls.every((c) => c.open === false && c.finished === true) === true);
      check("the page after the last says there are no more", (await calls("past", cust.jar, "2")).body?.empty === "No more calls." && (await calls("past", stranger.jar)).body?.empty === "No past calls yet.");
      const web = await asBrowser("/calls", { jar: cust.jar });
      check("the website's Past calls lists the same two", web.status === 200 && web.text.includes(`data-call="${over.call.id}"`) && web.text.includes(`data-call="${called.call.id}"`) && !web.text.includes(`data-call="${soon.call.id}"`), `${web.status}`);
      // A host whose page is hidden is still named in one's own calls, but without her photo: nothing says whether she has one.
      const [{ id: photoId }] = await db.insert(schema.hostPhotos).values({ userId: host.id, network: "upload", width: 8, height: 8, byteLength: 5, sha256: randomUUID(), bytes: Buffer.from("photo"), takenAt: now, checkedBy: "appcallscheck", rulesVersion: "appcallscheck" }).returning({ id: schema.hostPhotos.id });
      const withPhoto = (await calls("coming", cust.jar)).body?.calls[0];
      await db.update(schema.hostProfiles).set({ hidden: true }).where(eq(schema.hostProfiles.userId, host.id));
      const hiddenNow = (await calls("coming", cust.jar)).body?.calls[0];
      const hiddenPast = (await calls("past", cust.jar)).body?.calls[0];
      await db.update(schema.hostProfiles).set({ hidden: false }).where(eq(schema.hostProfiles.userId, host.id));
      await db.delete(schema.hostPhotos).where(eq(schema.hostPhotos.userId, host.id));
      check("a host's photo goes with her calls while her page is open, and not once it is hidden; her name stays", withPhoto?.photoId === photoId && hiddenNow?.photoId === null && hiddenNow.name === hostName && hiddenPast?.photoId === null, `${withPhoto?.photoId} ${hiddenNow?.photoId} ${hiddenPast?.photoId}`);
      // One more than a page holds.
      const many = await newPerson("many");
      const base = Date.now() - 3 * DAY;
      const rows = await db
        .insert(schema.calls)
        .values(Array.from({ length: 51 }, (_, i) => ({ hostId: host.id, customerId: many.id, startsAt: new Date(base - i * HOUR), endsAt: new Date(base - i * HOUR + 30 * MINUTE), roomName: `appcalls-${randomUUID()}`, pricePer15Cents: 0, freeCancelMinutes: 0 })))
        .returning({ id: schema.calls.id });
      callIds.push(...rows.map((row) => row.id));
      const first = (await calls("past", many.jar)).body;
      const second = (await calls("past", many.jar, "2")).body;
      check("51 past calls: 50 on the first page with more to come, the oldest alone on the second", first?.calls.length === 50 && first.more === true && first.calls[0].id === rows[0].id && first.calls[49].id === rows[49].id && second?.calls.length === 1 && second.calls[0].id === rows[50].id && second.more === false && second.empty === null && second.page === 2, `${first?.calls.length} ${second?.calls.length}`);
    }

    // ----------------------------------------------------------------------
    console.log("\n2. One call's page, in each of its states");
    const early = await newCall(host.id, cust.id, { startsIn: 4 * 24 * 60, price: 2000, minutes: 10 });
    const payable = await newCall(host.id, cust.id, { startsIn: 20, price: 2000, minutes: 10 });
    {
      const { reply, body } = await callPage(soon.call.id, cust.jar);
      check("a free call for its customer: who with, when, and that it is free", reply.status === 200 && body?.role === "customer" && body.title === `Call with ${hostName}` && body.roleWords === "(you are the customer)" && body.paidHow === "Free call" && body.startsAt === soon.call.startsAt.toISOString() && body.endsAt === soon.call.endsAt.toISOString(), reply.text.slice(0, 160));
      check("nothing stands in its way: the room, when it opens (5 minutes before), and that it is not open yet", body?.state === "room" && body.room?.open === false && body.room.opensAt === new Date(soon.call.startsAt.getTime() - 5 * MINUTE).toISOString() && body.words === null && body.pay === null);
      check("cancelling now is free, and says so", body?.cancel?.shown === "free" && body.cancel.words === "Cancelling now is free. Nothing is charged." && body.cancel.button === "Cancel this call" && body.cancel.yes === "Cancel the call" && body.cancel.no === "Keep it");
      check("it has exactly the parts the app knows, and is not kept on the way", keys(body) === "about,cancel,endsAt,id,notice,paidHow,pay,refreshSeconds,role,roleWords,room,serverNow,small,startsAt,state,title,words" && String(reply.headers["cache-control"]).includes("no-store"), keys(body));
      check("no account id and no email address travels", !reply.text.includes(host.id) && !reply.text.includes(cust.id) && !reply.text.includes("@example.test"));
      const forHost = (await callPage(soon.call.id, host.jar)).body;
      check("the host reads the same call from her side", forHost?.role === "host" && forHost.title === `Call with ${cust.name}` && forHost.roleWords === "(you are the host)" && forHost.state === "room" && forHost.about === null);
      check("nobody signed in, a stranger, a browser, and something that is no id get nothing", refusal((await callPage(soon.call.id)).reply) === "not_signed_in" && refusal((await callPage(soon.call.id, stranger.jar)).reply) === "not_found" && refusal(await asBrowser(`/api/app/calls/${soon.call.id}`, { jar: cust.jar })) === "not_the_app" && refusal((await callPage("-".repeat(36), cust.jar)).reply) === "not_found" && (await callPage(randomUUID(), cust.jar)).reply.text === (await callPage(soon.call.id, stranger.jar)).reply.text);

      const tooEarly = (await callPage(early.call.id, cust.jar)).body;
      const opens = payOpensAt(early.call.startsAt).toISOString();
      check("a paid call more than 2 days ahead: when it can be paid for, as a moment for the phone to write", tooEarly?.state === "too_early" && tooEarly.words?.[0] === "You can confirm and pay for this call from " && typeof tooEarly.words[1] === "object" && "time" in tooEarly.words[1] && tooEarly.words[1].time === opens && tooEarly.small === "That is 2 days before it starts." && tooEarly.pay === null && tooEarly.room === null && tooEarly.paidHow === "$20.00 per 15 minutes, up to $13.33", JSON.stringify(tooEarly?.words));
      const waits = (await callPage(early.call.id, host.jar)).body;
      check("its host is told she waits for the customer to pay", waits?.state === "host_waits" && waits.words?.[0] === `Waiting for ${cust.name} to confirm and pay.` && waits.small?.startsWith("The call can only start once $13.33 is held on their card.") === true && waits.pay === null);

      const toPay = (await callPage(payable.call.id, cust.jar)).body;
      check("a paid call that can be paid for: the confirm-and-pay step in the website's words", toPay?.state === "pay" && toPay.pay?.title === "Confirm and pay" && toPay.pay.points.length === 5 && toPay.pay.button === "Hold $13.33 and confirm the call" && JSON.stringify(toPay.pay.points).includes("$13.33 is held on your card now. Nothing is charged until after the call") && JSON.stringify(toPay.pay.points).includes("That includes time the host spends waiting if you are late or do not join."), JSON.stringify(toPay?.pay?.points).slice(0, 200));
      check("with what to say after the card sheet; the page asks again every half minute", keys(toPay?.pay) === "button,checkAgain,givenUp,notConfirmed,notHeld,points,title" && toPay?.refreshSeconds === 30);
      const near = await newCall(host.id, cust.id, { startsIn: 8, price: 2000, minutes: 10 });
      check("within ten minutes of the call the hold may land any second: the page then asks every few seconds", (await callPage(near.call.id, cust.jar)).body?.refreshSeconds === 3 && (await callPage(near.call.id, host.jar)).body?.refreshSeconds === 3);
      const web = await asBrowser(`/calls/${payable.call.id}`, { jar: cust.jar });
      const shown = web.text.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, "").replace(/<!-- -->/g, "");
      check("the website's page for the same call says the same sentences", web.status === 200 && shown.includes("Confirm and pay") && shown.includes("$13.33 is held on your card now. Nothing is charged until after the call, and you are never charged more than that.") && shown.includes("You can cancel for free at any time before the call starts.") && shown.includes(`Call with ${hostName}`), `${web.status}`);
      const past = await newCall(host.id, cust.id, { startsIn: -5, minutes: 30 });
      const running = (await callPage(past.call.id, cust.jar)).body;
      check("a call that has started can no longer be cancelled, and its room is open", running?.state === "room" && running.room?.open === true && running.cancel === null);
      const gone = await newCall(host.id, cust.id, { startsIn: 60, cancelled: true });
      const cancelled = (await callPage(gone.call.id, cust.jar)).body;
      check("a cancelled call says so, and offers nothing", cancelled?.state === "cancelled" && cancelled.words?.[0] === "This call was cancelled." && cancelled.cancel === null && cancelled.pay === null && cancelled.room === null && cancelled.refreshSeconds === null);
      // Over by the clock: nothing is offered and nothing is asked again, whatever was still open about the call.
      const done = await newCall(host.id, cust.id, { startsIn: -90, minutes: 30 });
      const donePage = (await callPage(done.call.id, cust.jar)).body;
      check("a call whose booked end has passed is over: it says so, offers nothing, and the page does not ask again", donePage?.state === "ended" && donePage.words?.[0] === "This call has ended." && donePage.room === null && donePage.cancel === null && donePage.pay === null && donePage.refreshSeconds === null, JSON.stringify(donePage).slice(0, 200));
      const unpaidOver = await newCall(host.id, cust.id, { startsIn: -90, minutes: 30, price: 2000 });
      const unpaidPage = (await callPage(unpaidOver.call.id, cust.jar)).body;
      const unpaidHost = (await callPage(unpaidOver.call.id, host.jar)).body;
      check("the same for one that was never paid: no pay step for the customer, no waiting for the host", unpaidPage?.state === "ended" && unpaidPage.pay === null && unpaidPage.refreshSeconds === null && unpaidHost?.state === "ended" && unpaidHost.words?.[0] === "This call has ended.", `${unpaidPage?.state} ${unpaidHost?.state}`);
    }

    // ----------------------------------------------------------------------
    console.log("\n3. Confirm and pay: a hold, and only Stripe's word counts");
    {
      const id = payable.call.id;
      check("nobody signed in, a stranger, a browser and the host cannot start it", refusal(await step(id, "pay")) === "not_signed_in" && refusal(await step(id, "pay", stranger.jar)) === "not_found" && refusal(await asBrowser(`/api/app/calls/${id}/pay`, { jar: cust.jar, body: {} })) === "not_the_app" && refusal(await step(id, "pay", host.jar)) === "not_found" && (await paymentOf(id)).stripePaymentIntentId === null);
      check("a free call has nothing to pay, and a step that does not exist is not found", refusal(await step(soon.call.id, "pay", cust.jar)) === "not_found" && refusal(await step(id, "charge", cust.jar)) === "not_found");
      check("too early is refused in the website's sentence", sentence(await step(early.call.id, "pay", cust.jar)) === "This call can be paid for from 2 days before it starts." && (await paymentOf(early.call.id)).stripePaymentIntentId === null);
      await db.update(schema.user).set({ pausedAt: now }).where(eq(schema.user.id, cust.id));
      check("a paused customer is told so", refusal(await step(id, "pay", cust.jar)) === "paused" && (await paymentOf(id)).stripePaymentIntentId === null);
      await db.update(schema.user).set({ pausedAt: null }).where(eq(schema.user.id, cust.id));

      const started = await step(id, "pay", cust.jar);
      const card = started.json as AppPayStep;
      if (started.status !== 200) throw new Error("The app at " + BASE + " did not hand out a pay step (" + started.status + "). Stopping.");
      // The app this tool talks to must be on this tool's own Stripe test key: what is confirmed and removed at Stripe must be what the app made there.
      if (!String(card.publishableKey).startsWith("pk_test_") || card.publishableKey !== process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY) throw new Error("The app at " + BASE + " is not using this tool's Stripe test key (.env.local). Stopping.");
      const intentId = (await paymentOf(id)).stripePaymentIntentId;
      check("the customer starts it: the card sheet gets what it needs to place a hold, and nothing else", keys(card) === "clientSecret,merchant,publishableKey" && /^pi_[A-Za-z0-9]+_secret_[A-Za-z0-9]+$/.test(card.clientSecret) && card.merchant === "Connect" && Boolean(intentId) && String(started.headers["cache-control"]).includes("no-store"), `${started.status} ${keys(card)}`);
      const again = await step(id, "pay", cust.jar);
      const viaWeb = await asBrowser(`/api/calls/${id}/payment/start`, { jar: cust.jar, body: {} });
      check("started again, and started from the website, it is the same one hold", (again.json as AppPayStep).clientSecret === card.clientSecret && viaWeb.status === 200 && (viaWeb.json as { clientSecret?: string }).clientSecret === card.clientSecret && (await paymentOf(id)).stripePaymentIntentId === intentId && (await db.select().from(schema.payments).where(eq(schema.payments.callId, id))).length === 1);
      const early2 = await step(id, "pay-check", cust.jar);
      check("asking where the hold stands before a card is in changes nothing", early2.status === 200 && (early2.json as AppCallPage).state === "pay" && (await paymentOf(id)).status === "awaiting_payment");
      const declined = await confirmAtStripe(id, "pm_card_chargeDeclined");
      check("after a refused card (the bank's own no), nothing is held", declined.code === "card_declined" && ((await step(id, "pay-check", cust.jar)).json as AppCallPage).state === "pay" && (await paymentOf(id)).status === "awaiting_payment", declined.code);
      check("a stranger cannot ask about it", refusal(await step(id, "pay-check", stranger.jar)) === "not_found");
      const approved = await confirmAtStripe(id, "pm_card_visa");
      check("a good card is approved at Stripe as a hold to be taken later", approved.status === "requires_capture", `${approved.status} ${approved.code}`);
      const held = await step(id, "pay-check", cust.jar);
      const page = held.json as AppCallPage;
      check("once Stripe says the money is held, the page moves on to the room", held.status === 200 && page.state === "room" && page.pay === null && (await paymentOf(id)).status === "held", `${held.status} ${page.state}`);
      check("it is a hold, not a charge", (await paymentOf(id)).status === "held" && (await stripe().paymentIntents.retrieve(intentId!)).status === "requires_capture");
      check("the host's page moves on too", (await callPage(id, host.jar)).body?.state === "room");
      const once = await step(id, "pay", cust.jar);
      check("starting it again when the money is held answers with the page, not a second hold", once.status === 200 && (once.json as AppCallPage).state === "room" && (await paymentOf(id)).stripePaymentIntentId === intentId);
      // A card that waits for its bank's approval holds nothing yet.
      const bank = await newCall(host.id, cust.id, { startsIn: 25, price: 2000, minutes: 10 });
      await step(bank.call.id, "pay", cust.jar);
      const waiting = await confirmAtStripe(bank.call.id, "pm_card_threeDSecure2Required");
      check("a card waiting for its bank's approval holds nothing yet", waiting.status === "requires_action" && ((await step(bank.call.id, "pay-check", cust.jar)).json as AppCallPage).state === "pay" && (await paymentOf(bank.call.id)).status === "awaiting_payment", `${waiting.status} ${waiting.code}`);
      // A card approved through a card form left open, after the call was cancelled or was over, does not count,
      // and what tidies up after such a call lets that approval go at Stripe.
      const { settleCancelledCall } = await import("../src/lib/payments/cancel");
      const stale = await newCall(host.id, cust.id, { startsIn: 22, price: 2000, minutes: 10 });
      await step(stale.call.id, "pay", cust.jar);
      await db.update(schema.calls).set({ cancelledAt: new Date(), cancelledBy: "host" }).where(eq(schema.calls.id, stale.call.id));
      const lateCard = await confirmAtStripe(stale.call.id, "pm_card_visa");
      await step(stale.call.id, "pay-check", cust.jar);
      check("a card approved after the call was cancelled does not count as held", lateCard.status === "requires_capture" && (await paymentOf(stale.call.id)).status === "awaiting_payment", `${lateCard.status} ${(await paymentOf(stale.call.id)).status}`);
      await settleCancelledCall(await callRow(stale.call.id), await paymentOf(stale.call.id));
      check("and that approval is let go at Stripe", (await stripe().paymentIntents.retrieve((await paymentOf(stale.call.id)).stripePaymentIntentId!)).status === "canceled" && (await paymentOf(stale.call.id)).status !== "held");
      const overNow = await newCall(host.id, cust.id, { startsIn: 24, price: 2000, minutes: 10 });
      await step(overNow.call.id, "pay", cust.jar);
      await db.update(schema.calls).set({ startsAt: new Date(Date.now() - 40 * MINUTE), endsAt: new Date(Date.now() - 30 * MINUTE) }).where(eq(schema.calls.id, overNow.call.id));
      const overCard = await confirmAtStripe(overNow.call.id, "pm_card_visa");
      await step(overNow.call.id, "pay-check", cust.jar);
      check("nor does one approved after the call's booked end", overCard.status === "requires_capture" && (await paymentOf(overNow.call.id)).status === "awaiting_payment", `${overCard.status} ${(await paymentOf(overNow.call.id)).status}`);
      // (A call paid from a membership has no card step: that refusal is in the one function both the website's
      // address and this one call, src/lib/payments/steps.ts. Making a member's call needs a whole membership with a
      // paid month, which the website's own member-calls-check sets up; it is not made again here.)
    }

    // ----------------------------------------------------------------------
    console.log("\n4. Cancelling");
    {
      const free = await newCall(host.id, cust.id, { startsIn: 6 * 60 });
      check("what cancelling was said to mean must come with the press", refusal(await step(free.call.id, "cancel", cust.jar)) === "not_valid" && refusal(await step(free.call.id, "cancel", cust.jar, { shown: "yes" })) === "not_valid" && (await callRow(free.call.id)).cancelledAt === null);
      check("nobody signed in, a stranger and a browser cannot cancel", refusal(await step(free.call.id, "cancel", undefined, { shown: "free" })) === "not_signed_in" && refusal(await step(free.call.id, "cancel", stranger.jar, { shown: "free" })) === "not_found" && refusal(await asBrowser(`/api/app/calls/${free.call.id}/cancel`, { jar: cust.jar, body: { shown: "free" } })) === "not_the_app" && (await callRow(free.call.id)).cancelledAt === null);
      const done = await step(free.call.id, "cancel", cust.jar, { shown: "free" });
      const page = done.json as AppCallPage;
      check("the customer cancels for free, and the answer is the page as it stands", done.status === 200 && page.state === "cancelled" && page.notice === "The call was cancelled. Nothing is charged." && page.cancel === null && (await callRow(free.call.id)).cancelledBy === "customer" && (await callRow(free.call.id)).cancelledLate === false, done.text.slice(0, 160));
      check("cancelled twice, it says so", sentence(await step(free.call.id, "cancel", cust.jar, { shown: "free" })) === "This call was already cancelled.");
      // The host cancels a call whose money is held: free, and the hold is let go.
      await db.update(schema.user).set({ pausedAt: now }).where(eq(schema.user.id, host.id));
      const byHost = await step(payable.call.id, "cancel", host.jar, { shown: "free" });
      await db.update(schema.user).set({ pausedAt: null }).where(eq(schema.user.id, host.id));
      check("the host cancels (a paused host too): free for the customer, and the hold is let go", byHost.status === 200 && (byHost.json as AppCallPage).state === "cancelled" && (await callRow(payable.call.id)).cancelledBy === "host" && (await callRow(payable.call.id)).cancelledLate === false && (await paymentOf(payable.call.id)).status !== "held", `${byHost.status} ${(await paymentOf(payable.call.id)).status}`);
      check("it says that the hold is being let go, and at Stripe it is", (byHost.json as AppCallPage).notice === "The call was cancelled. Nothing is charged, and the hold on the card is being let go." && (await stripe().paymentIntents.retrieve((await paymentOf(payable.call.id)).stripePaymentIntentId!)).status === "canceled", String((byHost.json as AppCallPage).notice));

      // Late: inside the host's hour, with the money held.
      const late = await newCall(host.id, cust.id, { startsIn: 30, price: 2000, minutes: 10, freeCancel: 60 });
      const lateStart = await step(late.call.id, "pay", cust.jar);
      const before = (await callPage(late.call.id, cust.jar)).body;
      check("before the money is held, cancelling is free whatever the hour (there is nothing to charge)", lateStart.status === 200 && before?.cancel?.shown === "free");
      await confirmAtStripe(late.call.id, "pm_card_visa");
      // The person was shown "free"; meanwhile the money was held, and the free hour is long over.
      const changed = await step(late.call.id, "cancel", cust.jar, { shown: "free" });
      check("cancelling that has turned from free to charged while the person was looking cancels nothing, and says so", refusal(changed) === "not_valid" && sentence(changed) === CHANGED && (await callRow(late.call.id)).cancelledAt === null && (await paymentOf(late.call.id)).status === "held", sentence(changed));
      const after = (await callPage(late.call.id, cust.jar)).body;
      check("the page then says what it means now", after?.cancel?.shown === "late_charge" && after.cancel.words === "Cancelling now is past the free period: the full $13.33 is charged. The host may choose to refund you.");
      const lateDone = await step(late.call.id, "cancel", cust.jar, { shown: "late_charge" });
      check("confirmed as shown, the late cancellation goes through, and says the price is charged", lateDone.status === 200 && (lateDone.json as AppCallPage).state === "cancelled" && (lateDone.json as AppCallPage).notice === "The call was cancelled after the free period, so the booked price is charged." && (await callRow(late.call.id)).cancelledLate === true, lateDone.text.slice(0, 160));
      const charged = await paymentOf(late.call.id);
      const taken = await stripe().paymentIntents.retrieve(charged.stripePaymentIntentId!);
      check("the late charge is the booked price, taken once at Stripe", charged.status === "charged" && charged.bookedCents === 1333 && taken.status === "succeeded" && taken.amount_received === 1333, `${charged.status} ${taken.status} ${taken.amount_received}`);
      // The free period ends while the cancelling waits its turn (here: for the call's own lock). What it means is
      // decided when it happens, not when the button was pressed: nothing is cancelled, and the person is told.
      const edge = await newCall(host.id, cust.id, { startsIn: 60 + 16 / 60, price: 2000, minutes: 10, freeCancel: 60 });
      await step(edge.call.id, "pay", cust.jar);
      await confirmAtStripe(edge.call.id, "pm_card_visa");
      await step(edge.call.id, "pay-check", cust.jar);
      const freeEnds = edge.call.startsAt.getTime() - 60 * MINUTE;
      const edgeShown = (await callPage(edge.call.id, cust.jar)).body?.cancel?.shown;
      let lockTaken = () => {};
      const locked = new Promise<void>((done) => (lockTaken = done));
      const holding = db.transaction(async (tx) => {
        await tx.select({ id: schema.calls.id }).from(schema.calls).where(eq(schema.calls.id, edge.call.id)).for("update");
        lockTaken();
        await pause(Math.max(0, freeEnds + 1_500 - Date.now()));
      });
      await locked;
      const inTime = Date.now() < freeEnds - 300;
      const waited = await step(edge.call.id, "cancel", cust.jar, { shown: "free" });
      await holding;
      check("a free cancellation that had to wait until the free period was over cancels nothing, and says so", edgeShown === "free" && inTime && refusal(waited) === "not_valid" && sentence(waited) === CHANGED && (await callRow(edge.call.id)).cancelledAt === null && (await paymentOf(edge.call.id)).status === "held", `shown ${edgeShown}, sent in time ${inTime}, ${waited.status} ${sentence(waited)}`);
      // Shown as charged, but free by now (the hold fell away): cancelling as shown or cheaper always goes through.
      const cheaper = await newCall(host.id, cust.id, { startsIn: 45, price: 2000, minutes: 10, freeCancel: 60 });
      const cheaperDone = await step(cheaper.call.id, "cancel", cust.jar, { shown: "late_charge" });
      check("cancelling that costs less than was shown goes through", cheaperDone.status === 200 && (cheaperDone.json as AppCallPage).notice === "The call was cancelled. Nothing is charged.");
      // After the start.
      const started = await newCall(host.id, cust.id, { startsIn: -2, minutes: 30 });
      check("a call that has started cannot be cancelled", sentence(await step(started.call.id, "cancel", cust.jar, { shown: "free" })) === "This call has started, so it can no longer be cancelled." && (await callRow(started.call.id)).cancelledAt === null);
      // The website's own form carries what it showed, too.
      const web = await asBrowser(`/calls/${soon.call.id}`, { jar: cust.jar });
      const fields = formFields(web.text, "callId");
      check("the website's form carries what it showed", web.status === 200 && fields?.shown === "free" && fields.callId === soon.call.id, JSON.stringify(Object.keys(fields ?? {})));
      // The website's own button, pressed: once without saying what the page showed, once as the page sent it.
      const { shown: _left, ...withoutShown } = fields ?? {};
      void _left;
      const notSaid = await postForm(`/calls/${soon.call.id}`, withoutShown, cust.jar);
      check("the website's form sent without what it showed cancels nothing, and goes back to the call's page", notSaid.status === 303 && notSaid.to.startsWith(`/calls/${soon.call.id}?`) && (await callRow(soon.call.id)).cancelledAt === null, `${notSaid.status} ${notSaid.to}`);
      const said = await postForm(`/calls/${soon.call.id}`, fields ?? {}, cust.jar);
      check("sent as the page sent it, the call is cancelled, and the website goes on to its results", said.status === 303 && said.to.startsWith(`/calls/${soon.call.id}/results`) && (await callRow(soon.call.id)).cancelledBy === "customer", `${said.status} ${said.to}`);
    }
  } finally {
    const ids = made.length ? made : ["-"];
    const mine = callIds.length ? callIds : [randomUUID()];
    const payments = await db.select({ id: schema.payments.id, intent: schema.payments.stripePaymentIntentId }).from(schema.payments).where(inArray(schema.payments.callId, mine));
    // Nothing of this run stays open at Stripe: a hold that is still there is let go.
    for (const payment of payments) if (payment.intent) await stripe().paymentIntents.cancel(payment.intent).catch(() => undefined);
    const paymentIds = payments.length ? payments.map((p) => p.id) : [randomUUID()];
    const quietly = async (what: Promise<unknown>) => what.catch((error: Error) => console.log(`  (could not remove something of this run: ${error.message.slice(0, 120)})`));
    await quietly(db.delete(schema.ledgerEntries).where(inArray(schema.ledgerEntries.paymentId, paymentIds)));
    await quietly(db.delete(schema.payoutFees).where(inArray(schema.payoutFees.paymentId, paymentIds)));
    await quietly(db.delete(schema.collectionItems).where(inArray(schema.collectionItems.paymentId, paymentIds)));
    await quietly(db.delete(schema.moneyOperations).where(inArray(schema.moneyOperations.paymentId, paymentIds)));
    await quietly(db.delete(schema.attendanceEvents).where(inArray(schema.attendanceEvents.callId, mine)));
    await quietly(db.delete(schema.payments).where(inArray(schema.payments.id, paymentIds)));
    await quietly(db.delete(schema.calls).where(inArray(schema.calls.id, mine)));
    for (const one of await db.select().from(schema.stripeCustomers).where(inArray(schema.stripeCustomers.userId, ids))) {
      const gone = await stripe()
        .customers.del(one.stripeCustomerId)
        .then(() => true)
        .catch((error: { code?: string }) => error?.code === "resource_missing");
      if (!gone) check(`the test customer ${one.stripeCustomerId} was removed at Stripe`, false, "remove it by hand in Stripe's test dashboard");
    }
    await quietly(db.delete(schema.stripeCustomers).where(inArray(schema.stripeCustomers.userId, ids)));
    await quietly(db.delete(schema.hostPhotos).where(inArray(schema.hostPhotos.userId, ids)));
    await quietly(db.delete(schema.hostProfiles).where(inArray(schema.hostProfiles.userId, ids)));
    await quietly(db.delete(schema.emailOutbox).where(like(schema.emailOutbox.to, `appcalls-${RUN}-%`)));
    await quietly(db.delete(schema.user).where(inArray(schema.user.id, ids)));
    await db.delete(schema.rateLimit);
  }

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
