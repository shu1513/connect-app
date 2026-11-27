/**
 * Testing tool: asks the app running on this computer for what the phone app's call screen needs,
 * the way the phone app does, and checks it (plans/45-phone-apps/09-the-call.md): what the screen
 * is sent before anyone enters; the entry pass, by the one join check the website uses (refused
 * while unpaid, before the room opens, after the end, after a cancellation, for a blocked pair,
 * for a paused account, and while calls are paused across Connect); where a call stands; "End
 * call and report"; and the report form, with the website's reasons and refusals.
 *
 * It places one hold at Stripe with a test card, so it runs only with Stripe's test key (start
 * the app it talks to with the same `.env.local`), and it asks the video service to close the
 * rooms of the calls it stops. It only runs against a database made for checking (its name must
 * end in "_check"). It removes what it made, here and at Stripe. It never prints a secret.
 *
 * Usage: DATABASE_URL=…/something_check npx tsx scripts/app-room-check.ts [--app=http://localhost:3000]
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { randomBytes, randomUUID } from "node:crypto";
import http from "node:http";
import { and, desc, eq, inArray, like, sql } from "drizzle-orm";
import { APP_ORIGIN } from "../src/lib/auth-rules";
import { APP_HEADER, SIGN_IN_HEADER } from "../src/lib/app-door/rules";
import type { AppCallLive, AppCallPage, AppEndedScreen, AppPass, AppReportForm, AppReportSent, AppRoom, Refusal } from "../src/lib/app-door/types";
import { END_WORDS } from "../src/lib/call-page/end-words";
import { APP_ROOM_WORDS, ROOM_WORDS } from "../src/lib/call-page/room-words";
import { BLOCK_WORDS } from "../src/lib/safety/block-words";
import { REPORT_WORDS } from "../src/lib/safety/report-words";
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
      // (A connection that breaks after the first lines of the answer says so here, not on the request.)
      response.on("error", reject);
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
    // An answer that never comes, or never ends, does not hang the check (and so its clean-up) for good.
    request.setTimeout(60_000, () => request.destroy(new Error(`no answer from ${url.pathname} within a minute`)));
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
  const { createPaymentForCall } = await import("../src/lib/payments/hold");
  await db.delete(schema.rateLimit);

  const now = new Date();
  const made: string[] = [];
  const callIds: string[] = [];
  /** Signs up the app's way, confirms the email in a browser, finishes "18 and terms" (pretended), and signs in the app's way. */
  async function newPerson(name: string) {
    const person = { name: `Caller ${name} ${RUN}`, email: `approom-${RUN}-${name}@example.test`, password: randomBytes(12).toString("base64url"), jar: new Map() as Jar };
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
        .values({ hostId, customerId, startsAt, endsAt, roomName: `approom-${randomUUID()}`, pricePer15Cents: options.price ?? 0, freeCancelMinutes: options.freeCancel ?? 0, ...(options.cancelled ? { cancelledAt: now, cancelledBy: "customer" } : {}) })
        .returning();
      callIds.push(call.id);
      if ((options.price ?? 0) > 0) await createPaymentForCall(tx, call);
      const [payment] = await tx.select().from(schema.payments).where(eq(schema.payments.callId, call.id));
      return { call, payment: payment ?? null };
    });
  }
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

  try {
    const host = await newPerson("host");
    const cust = await newPerson("cust");
    const stranger = await newPerson("stranger");
    const handle = `ar${RUN}host`;
    const hostName = `Rosa Room ${RUN}`;
    await db.insert(schema.hostProfiles).values({ userId: host.id, handle, handleKey: handle, displayName: hostName, pricePer15Cents: 2000, status: "approved", usConfirmedAt: now });
    const { setSwitches, switches } = await import("../src/lib/safety/switches");
    const { REPORT_REASONS } = await import("../src/lib/safety/reports");
    const room = async (id: string, jar?: Jar) => {
      const reply = await asApp(`/api/app/calls/${id}/room`, { jar });
      return { reply, body: reply.status === 200 ? (reply.json as AppRoom) : null };
    };
    const live = (id: string, jar?: Jar) => asApp(`/api/app/calls/${id}/live`, { jar });
    /** What an entry pass says inside (it is signed, not hidden): who, by which name, and which room. */
    const inside = (token: string) => JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as { sub?: string; name?: string; video?: Record<string, unknown> };

    // A free call whose room is open now (it opens 5 minutes before the start), one far ahead, one unpaid, one cancelled, one over.
    const open = await newCall(host.id, cust.id, { startsIn: 3 });
    const ahead = await newCall(host.id, cust.id, { startsIn: 3 * 60 });
    const unpaid = await newCall(host.id, cust.id, { startsIn: 3, price: 2000, minutes: 10 });
    const gone = await newCall(host.id, cust.id, { startsIn: 3, cancelled: true });
    const over = await newCall(host.id, cust.id, { startsIn: -90, minutes: 30 });

    // ----------------------------------------------------------------------
    console.log("\n1. What the call's screen is sent before anyone enters");
    {
      const { reply, body } = await room(open.call.id, cust.jar);
      check("nobody signed in, a stranger, a browser, and something that is no id get nothing", refusal((await room(open.call.id)).reply) === "not_signed_in" && refusal((await room(open.call.id, stranger.jar)).reply) === "not_found" && refusal(await asBrowser(`/api/app/calls/${open.call.id}/room`, { jar: cust.jar })) === "not_the_app" && refusal((await room("nothing", cust.jar)).reply) === "not_found");
      check("the customer: who with (the host by the name on her page), the times, and that nothing stands in the way", reply.status === 200 && body?.role === "customer" && body.other === hostName && body.startsAt === open.call.startsAt.toISOString() && body.endsAt === open.call.endsAt.toISOString() && body.opensAt === new Date(open.call.startsAt.getTime() - 5 * MINUTE).toISOString() && body.ready === true && body.about === null, reply.text.slice(0, 160));
      check("it has exactly the parts the app knows, and is not kept on the way", keys(body) === "about,askEverySeconds,countdownSeconds,endsAt,id,opensAt,other,ready,role,serverNow,startsAt,watchSeconds,words" && String(reply.headers["cache-control"]).includes("no-store"), keys(body));
      check("no account id and no email address travels", !reply.text.includes(host.id) && !reply.text.includes(cust.id) && !reply.text.includes("@example.test"));
      const words = (body?.words ?? {}) as Record<string, string>;
      check("every sentence came, and none is empty", Object.keys(words).length === 43 && Object.values(words).every((said) => typeof said === "string" && said.trim() !== ""), String(Object.keys(words).length));
      check("the sentences are the website's own where the website has them", words.check === ROOM_WORDS.check && words.join === ROOM_WORDS.join && words.ended === ROOM_WORDS.ended && words.disconnected === ROOM_WORDS.disconnected && words.endNow === ROOM_WORDS.endNow && words.endNowYes === ROOM_WORDS.endNowYes && words.endNowSure === END_WORDS.sure("free") && Object.keys(words).length === 43 && words.endFailed === ROOM_WORDS.endFailed && words.timeLeft === ROOM_WORDS.timeLeft);
      check("and the app's own name the other person as this person knows them", words.notJoined === APP_ROOM_WORDS.notJoined(hostName) && words.left === APP_ROOM_WORDS.left(hostName) && words.cameraWhy === APP_ROOM_WORDS.cameraWhy(hostName) && words.useThisPhone === APP_ROOM_WORDS.useThisPhone);
      check("when to ask where the call stands comes from the server", body?.watchSeconds === 120 && body.askEverySeconds === 2 && body.countdownSeconds === 60);
      const forHost = (await room(open.call.id, host.jar)).body;
      check("the host reads the same call from her side, by the customer's name", forHost?.role === "host" && forHost.other === cust.name && forHost.ready === true && forHost.words.notJoined === APP_ROOM_WORDS.notJoined(cust.name));
      check("a call far ahead: nothing stands in its way, and its room opens later", (await room(ahead.call.id, cust.jar)).body?.ready === true && Date.parse((await room(ahead.call.id, cust.jar)).body?.opensAt ?? "") > Date.now());
      check("an unpaid call, a cancelled call and a call that is over are not ready: the call's own page says why", (await room(unpaid.call.id, cust.jar)).body?.ready === false && (await room(unpaid.call.id, host.jar)).body?.ready === false && (await room(gone.call.id, cust.jar)).body?.ready === false && (await room(over.call.id, cust.jar)).body?.ready === false);
      await db.update(schema.user).set({ pausedAt: now }).where(eq(schema.user.id, cust.id));
      check("a paused person is told so", refusal((await room(open.call.id, cust.jar)).reply) === "paused");
      await db.update(schema.user).set({ pausedAt: null }).where(eq(schema.user.id, cust.id));
      const page = (await callPage(open.call.id, cust.jar)).body;
      check("the call's page, with its room open, carries the button that leads here", page?.state === "room" && page.room?.open === true && page.room.enter === APP_ROOM_WORDS.goToCall);
    }

    // ----------------------------------------------------------------------
    console.log("\n2. The entry pass: the one join check");
    {
      const id = open.call.id;
      check("nobody signed in, a stranger and a browser get none", refusal(await step(id, "enter")) === "not_signed_in" && refusal(await step(id, "enter", stranger.jar)) === "not_found" && refusal(await asBrowser(`/api/app/calls/${id}/enter`, { jar: cust.jar, body: {} })) === "not_the_app");
      check("before the room opens: refused in the website's sentence", sentence(await step(ahead.call.id, "enter", cust.jar)) === "This room is not open yet.");
      check("while unpaid: refused, for the customer and for the host", sentence(await step(unpaid.call.id, "enter", cust.jar)) === "This call has not been paid for yet." && sentence(await step(unpaid.call.id, "enter", host.jar)) === "This call has not been paid for yet.");
      check("after a cancellation, and after the end", sentence(await step(gone.call.id, "enter", cust.jar)) === "This call was cancelled." && sentence(await step(over.call.id, "enter", cust.jar)) === "This call has ended.");
      await db.update(schema.user).set({ pausedAt: now }).where(eq(schema.user.id, cust.id));
      check("a paused account is turned away at the door", refusal(await step(id, "enter", cust.jar)) === "paused");
      await db.update(schema.user).set({ pausedAt: null }).where(eq(schema.user.id, cust.id));
      await db.insert(schema.blocks).values({ blockerId: host.id, blockedId: cust.id });
      check("a blocked pair: the call reads as ended, for both", sentence(await step(id, "enter", cust.jar)) === "This call has ended." && sentence(await step(id, "enter", host.jar)) === "This call has ended.");
      await db.delete(schema.blocks).where(eq(schema.blocks.blockerId, host.id));
      const before = await switches();
      await setSwitches({ joiningOff: true });
      let paused: Reply = { status: 0, json: null, text: "not asked", headers: {} };
      try {
        paused = await step(id, "enter", cust.jar);
      } finally {
        await setSwitches({ joiningOff: before.joiningOff });
      }
      check("while calls are paused across Connect: said so, as a switch and not as this call's fault", refusal(paused) === "switched_off" && sentence(paused) === "Calls are paused across Connect right now. Please try again shortly.");

      const entered = await step(id, "enter", cust.jar);
      const pass = entered.json as AppPass;
      const said = entered.status === 200 ? inside(pass.token) : {};
      check("the customer of an open, free call gets a pass, and nothing else", entered.status === 200 && keys(pass) === "endsAt,serverNow,serverUrl,token" && /^wss:\/\//.test(pass.serverUrl) && pass.endsAt === open.call.endsAt.toISOString() && Math.abs(Date.parse(pass.serverNow) - Date.now()) < 60_000 && String(entered.headers["cache-control"]).includes("no-store"), `${entered.status} ${entered.text.slice(0, 120)}`);
      check("the pass is for this person, this room and no other, to join and nothing more", said.sub === cust.id && said.name === cust.name && said.video?.room === open.call.roomName && said.video?.roomJoin === true && said.video?.roomAdmin !== true && said.video?.roomRecord !== true && said.video?.roomCreate !== true, JSON.stringify(said.video));
      const hostPass = (await step(id, "enter", host.jar)).json as AppPass;
      check("the host enters under the name on her page", inside(hostPass.token).sub === host.id && inside(hostPass.token).name === hostName);
      const web = await asBrowser(`/api/calls/${id}/token`, { jar: cust.jar, body: {} });
      const webPass = web.json as { token?: string; serverUrl?: string; endsAt?: string; role?: string };
      check("the website's own address hands the same person the same kind of pass for the same room", web.status === 200 && webPass.serverUrl === pass.serverUrl && webPass.endsAt === pass.endsAt && webPass.role === "customer" && inside(webPass.token ?? "").sub === said.sub && inside(webPass.token ?? "").video?.room === said.video?.room && JSON.stringify(Object.keys(inside(webPass.token ?? "").video ?? {}).sort()) === JSON.stringify(Object.keys(said.video ?? {}).sort()), `${web.status}`);
      check("and refuses what the app's address refuses, in the same sentences", ((await asBrowser(`/api/calls/${ahead.call.id}/token`, { jar: cust.jar, body: {} })).json as { error?: string }).error === "This room is not open yet." && ((await asBrowser(`/api/calls/${unpaid.call.id}/token`, { jar: cust.jar, body: {} })).json as { error?: string }).error === "This call has not been paid for yet.");

      // A paid call: no pass until the money is held, then a pass.
      await step(unpaid.call.id, "pay", cust.jar);
      const card = await confirmAtStripe(unpaid.call.id, "pm_card_visa");
      await step(unpaid.call.id, "pay-check", cust.jar);
      const paid = await step(unpaid.call.id, "enter", cust.jar);
      check("once the money is held, the paid call can be entered, by both", card.status === "requires_capture" && paid.status === 200 && (await step(unpaid.call.id, "enter", host.jar)).status === 200 && (await room(unpaid.call.id, cust.jar)).body?.ready === true, `${card.status} ${paid.status}`);
    }

    // ----------------------------------------------------------------------
    console.log("\n3. Where the call stands");
    {
      const id = open.call.id;
      check("nobody signed in, a stranger and a browser get nothing", refusal(await live(id)) === "not_signed_in" && refusal(await live(id, stranger.jar)) === "not_found" && refusal(await asBrowser(`/api/app/calls/${id}/live`, { jar: cust.jar })) === "not_the_app" && refusal(await live("nothing", cust.jar)) === "not_found");
      const reply = await live(id, cust.jar);
      const body = reply.json as AppCallLive;
      check("the call's end, the server's clock, and that it was neither cancelled nor stopped", reply.status === 200 && keys(body) === "cancelled,endsAt,safetyEnded,serverNow" && body.endsAt === open.call.endsAt.toISOString() && body.cancelled === false && body.safetyEnded === false && Math.abs(Date.parse(body.serverNow) - Date.now()) < 60_000, reply.text.slice(0, 160));
      const web = (await asBrowser(`/api/calls/${id}/live`, { jar: cust.jar })).json as { endsAt?: string; cancelled?: boolean; safetyEnded?: boolean };
      check("the website's own address says the same", web.endsAt === body.endsAt && web.cancelled === false && web.safetyEnded === false);
      // Time added to a call moves its end: the screen follows what this address says.
      const longer = new Date(open.call.endsAt.getTime() + 10 * MINUTE);
      await db.update(schema.calls).set({ endsAt: longer }).where(eq(schema.calls.id, id));
      check("a later end is said as soon as it is there", ((await live(id, host.jar)).json as AppCallLive).endsAt === longer.toISOString() && ((await step(id, "enter", cust.jar)).json as AppPass).endsAt === longer.toISOString());
      check("a cancelled call says so", ((await live(gone.call.id, cust.jar)).json as AppCallLive).cancelled === true);
      await db.update(schema.user).set({ pausedAt: now }).where(eq(schema.user.id, cust.id));
      check("someone whose account was paused a moment ago can still learn where their call stands", (await live(id, cust.jar)).status === 200);
      await db.update(schema.user).set({ pausedAt: null }).where(eq(schema.user.id, cust.id));
    }

    // ----------------------------------------------------------------------
    console.log("\n4. End call now");
    const second = await newCall(host.id, cust.id, { startsIn: 2 });
    {
      const id = open.call.id;
      check("nobody signed in, a stranger and a browser cannot end a call", refusal(await step(id, "end-now")) === "not_signed_in" && refusal(await step(id, "end-now", stranger.jar)) === "not_found" && refusal(await asBrowser(`/api/app/calls/${id}/end-now`, { jar: cust.jar, body: {} })) === "not_the_app" && (await callRow(id)).safetyEndedAt === null);
      check("a call whose room is not open yet cannot be ended this way (it can be cancelled)", sentence(await step(ahead.call.id, "end-now", cust.jar)) === "This call has not started yet." && (await callRow(ahead.call.id)).safetyEndedAt === null);
      // The founder raises the oldest copy of the app still allowed while a call is under way: entering then asks
      // for an update, but "End call now" is still answered, in its own words (here: for a call whose room
      // has not opened, so nothing is ended by asking).
      const floorBefore = (await switches()).appOldestVersion;
      const raised = ["", ""];
      try {
        await setSwitches({ appOldestVersion: "9000.0.0" });
        raised[0] = refusal(await step(ahead.call.id, "enter", cust.jar)) ?? "";
        raised[1] = sentence(await step(ahead.call.id, "end-now", cust.jar)) ?? "";
      } finally {
        await setSwitches({ appOldestVersion: floorBefore });
      }
      check("with the oldest allowed copy raised, entering asks for an update, but 'End call now' is still answered", raised[0] === "update_needed" && raised[1] === "This call has not started yet.", raised.join(" | "));
      const ended = await step(id, "end-now", cust.jar);
      const row = await callRow(id);
      check("the customer ends the call for both: it is ended, and by whom and in which role is written down", ended.status === 200 && keys(ended.json) === "closed,ended" && (ended.json as { ended?: boolean }).ended === true && (ended.json as { closed?: boolean }).closed === true && row.safetyEndedAt !== null && row.safetyEndedBy === cust.id && (row.endedNowBy ?? "").startsWith("customer") && row.cancelledAt === null, `${ended.status} ${ended.text.slice(0, 120)}`);
      check("'ended' was only answered with proof: the room is written down as closed", (await callRow(id)).closedAt !== null);
      check("nobody can enter it again, and both are told it has ended", sentence(await step(id, "enter", cust.jar)) === "This call has ended." && sentence(await step(id, "enter", host.jar)) === "This call has ended." && ((await live(id, host.jar)).json as AppCallLive).safetyEnded === true && (await room(id, host.jar)).body?.ready === false);
      check("pressed again (the first answer was lost, say), or by the other person, it still answers that the call is ended, and whose press it was stays", (await step(id, "end-now", cust.jar)).status === 200 && (await step(id, "end-now", host.jar)).status === 200 && (await callRow(id)).safetyEndedBy === cust.id);
      check("the step's earlier name is gone (no copy of the app was ever given out with it)", refusal(await step(id, "end-and-report", cust.jar)) === "not_found");
      // The screen after it: who ended the call, and the three choices, in the website's words. No account id travels.
      const screenReply = await asApp(`/api/app/calls/${id}/ended`, { jar: cust.jar });
      const screen = screenReply.json as AppEndedScreen | null;
      check("the screen after it: who ended the call, and the three choices with what each does", screenReply.status === 200 && keys(screen) === "block,lines,neither,report,title,what" && screen?.title === END_WORDS.title && screen.lines[0] === END_WORDS.byYou(true) && screen.report.label === REPORT_WORDS.reportPerson(hostName) && screen.report.what === END_WORDS.reportWhat(hostName) && screen.block.label === BLOCK_WORDS.label(hostName) && screen.block.what === END_WORDS.blockWhat(hostName) && screen.block.done === false && keys(screen.block) === "done,doneWords,label,no,sure,what,yes" && screen.neither.label === END_WORDS.neither, screenReply.text.slice(0, 200));
      check("it carries no account id and is not kept on the way", !screenReply.text.includes(host.id) && !screenReply.text.includes(cust.id) && String(screenReply.headers["cache-control"]).includes("no-store"));
      const hostScreen = (await asApp(`/api/app/calls/${id}/ended`, { jar: host.jar })).json as AppEndedScreen | null;
      check("the host reads who ended it, by the customer's name", hostScreen?.lines[0] === END_WORDS.byOther(cust.name, true) && hostScreen.block.label === BLOCK_WORDS.label(cust.name));
      check("nobody signed in, a stranger and a browser get no such screen; nor is there one for a call that has not ended", refusal(await asApp(`/api/app/calls/${id}/ended`)) === "not_signed_in" && refusal(await asApp(`/api/app/calls/${id}/ended`, { jar: stranger.jar })) === "not_found" && refusal(await asBrowser(`/api/app/calls/${id}/ended`, { jar: cust.jar })) === "not_the_app" && refusal(await asApp(`/api/app/calls/${ahead.call.id}/ended`, { jar: cust.jar })) === "not_found");
      // The website's own button on another call, by the host: the same end.
      const web = await asBrowser(`/api/calls/${second.call.id}/end-now`, { jar: host.jar, body: {} });
      check("the website's own button does the same to a call", web.status === 200 && (await callRow(second.call.id)).safetyEndedBy === host.id && (await callRow(second.call.id)).endedNowBy === "host" && ((await live(second.call.id, cust.jar)).json as AppCallLive).safetyEnded === true);
      // A paused person can still end a call they are in.
      const third = await newCall(host.id, cust.id, { startsIn: 2 });
      await db.update(schema.user).set({ pausedAt: now }).where(eq(schema.user.id, cust.id));
      const byPaused = await step(third.call.id, "end-now", cust.jar);
      await db.update(schema.user).set({ pausedAt: null }).where(eq(schema.user.id, cust.id));
      check("a paused person can still end a call they are in", byPaused.status === 200 && (await callRow(third.call.id)).safetyEndedBy === cust.id);
      // "Block" from the screen after the press names only the call. (Last here: it cancels the calls of the two that are still to come.)
      check("a stranger cannot block through a call that is not theirs", refusal(await step(id, "block", stranger.jar)) === "not_found" && refusal(await step(id, "block")) === "not_signed_in");
      const blocked = await step(id, "block", cust.jar);
      const [blockRow] = await db.select().from(schema.blocks).where(and(eq(schema.blocks.blockerId, cust.id), eq(schema.blocks.blockedId, host.id)));
      check('"Block" blocks the other person of that call, cancels their call that is still to come, and says so', blocked.status === 200 && keys(blocked.json) === "notice" && (blocked.json as { notice?: string }).notice === BLOCK_WORDS.done && Boolean(blockRow) && (await callRow(ahead.call.id)).cancelledAt !== null, `${blocked.status} ${blocked.text.slice(0, 120)}`);
      const afterBlock = ((await asApp(`/api/app/calls/${id}/ended`, { jar: cust.jar })).json as AppEndedScreen).block;
      check("the screen then says only that the block stands, and keeps a button to block again", afterBlock.done === true && afterBlock.doneWords === END_WORDS.blocked(hostName) && afterBlock.label === END_WORDS.blockAgain(hostName) && afterBlock.what === END_WORDS.blockAgainWhat(hostName) && !/are cancelled|have ended/.test(`${afterBlock.doneWords} ${afterBlock.what} ${afterBlock.sure}`));
      // Taken away again: the rest of this script needs the two unblocked. (The calls the block cancelled stay cancelled.)
      await db.delete(schema.blocks).where(and(eq(schema.blocks.blockerId, cust.id), eq(schema.blocks.blockedId, host.id)));
    }

    // ----------------------------------------------------------------------
    console.log("\n5. The report form");
    {
      const form = async (query: string, jar?: Jar) => {
        const reply = await asApp(`/api/app/report?${query}`, { jar });
        return { reply, body: reply.status === 200 ? (reply.json as AppReportForm) : null };
      };
      const send = (body: unknown, jar?: Jar) => asApp("/api/app/report", { jar, body });
      const { reply, body } = await form(`call=${open.call.id}`, cust.jar);
      check("nobody signed in and a browser get no form", refusal((await form(`call=${open.call.id}`)).reply) === "not_signed_in" && refusal(await asBrowser(`/api/app/report?call=${open.call.id}`, { jar: cust.jar })) === "not_the_app");
      check("the form, in the website's words, with the website's reasons", reply.status === 200 && body?.title === REPORT_WORDS.title && body.words === REPORT_WORDS.aboutPerson && body.what === REPORT_WORDS.what && body.more === REPORT_WORDS.more && body.send === REPORT_WORDS.send && body.danger === REPORT_WORDS.danger && body.textMax === 2000 && JSON.stringify(body.reasons) === JSON.stringify(REPORT_REASONS.map((reason) => ({ key: reason.key, label: reason.label }))), reply.text.slice(0, 160));
      check("it has exactly the parts the app knows, and is not kept on the way", keys(body) === "choose,danger,more,reasons,rules,send,stopped,textMax,title,what,words" && keys(body?.rules) === "after,before,link" && String(reply.headers["cache-control"]).includes("no-store"), keys(body));
      check("after 'End call now' it says the call was ended for both; for any other call it does not", body?.stopped === REPORT_WORDS.stopped && (await form(`call=${ahead.call.id}`, cust.jar)).body?.stopped === null && (await form(`call=${open.call.id}`, stranger.jar)).body?.stopped === null);
      // A call marked as stopped whose room is not confirmed closed yet: the form does not say "has been ended for both".
      const unproven = await newCall(host.id, cust.id, { startsIn: 2 });
      await db.update(schema.calls).set({ safetyEndedAt: new Date(), safetyEndedBy: cust.id }).where(eq(schema.calls.id, unproven.call.id));
      check("while the room's closing is not confirmed, the form says the call is being ended, not that it has been", (await form(`call=${unproven.call.id}`, cust.jar)).body?.stopped === REPORT_WORDS.stopping);
      // An entry pass handed out just before the stop stays good until the video service has confirmed the closing,
      // so that sentence must not say that nobody can come back in.
      check("and that sentence does not promise that nobody can join again", !/nobody can/i.test(REPORT_WORDS.stopping) && /being ended/.test(REPORT_WORDS.stopping) && /Nobody can rejoin/.test(REPORT_WORDS.stopped));
      const { closeCallIfDue } = await import("../src/lib/video/closing");
      check("a call that is not there is never taken for a closed room", (await closeCallIfDue(randomUUID())) === "no such call");
      check("it says that reporting someone also blocks them", body?.words.includes("Reporting someone also blocks them") === true);
      check("the app reports from a call, a request or a host's page, and from nothing else", (await form(`profile=${handle}`, stranger.jar)).reply.status === 200 && (await form(`booking=${randomUUID()}`, cust.jar)).reply.status === 200 && refusal((await form(`post=${randomUUID()}`, cust.jar)).reply) === "not_found" && refusal((await form("", cust.jar)).reply) === "not_found" && refusal((await form(`call=${open.call.id}&profile=${handle}`, cust.jar)).reply) === "not_found" && refusal((await form("profile=..%2Fadmin", cust.jar)).reply) === "not_found");

      check("what is sent must be whole", refusal(await send({ place: "call", id: open.call.id }, cust.jar)) === "not_valid" && refusal(await send({ place: "post", id: randomUUID(), reason: "other", text: "" }, cust.jar)) === "not_valid" && refusal(await send({ place: "call", id: open.call.id, reason: "other", text: 7 }, cust.jar)) === "not_valid" && refusal(await send(null, cust.jar)) === "not_valid");
      check("no reason chosen, and too many words: the form's own sentences", sentence(await send({ place: "call", id: open.call.id, reason: "", text: "" }, cust.jar)) === "Choose a reason." && sentence(await send({ place: "call", id: open.call.id, reason: "other", text: "x".repeat(2001) }, cust.jar)) === "Please keep it under 2000 characters.");
      check("somebody else's call, and a request that does not exist, cannot be reported from", sentence(await send({ place: "call", id: open.call.id, reason: "other", text: "" }, stranger.jar)) === "Call not found." && sentence(await send({ place: "booking", id: randomUUID(), reason: "other", text: "" }, cust.jar)) === "Request not found.");
      check("nobody signed in and a browser cannot send one", refusal(await send({ place: "call", id: open.call.id, reason: "other", text: "" })) === "not_signed_in" && refusal(await asBrowser("/api/app/report", { jar: cust.jar, body: { place: "call", id: open.call.id, reason: "other", text: "" } })) === "not_the_app");
      const noneYet = (await db.select().from(schema.reports).where(inArray(schema.reports.reporterId, made))).length;
      const sent = await send({ place: "call", id: open.call.id, reason: "other", text: "  It went   badly. " }, cust.jar);
      const notice = (sent.json as AppReportSent | null)?.notice ?? "";
      const [report] = await db.select().from(schema.reports).where(eq(schema.reports.reporterId, cust.id));
      check("the customer reports the call: thanked with the report's number", noneYet === 0 && sent.status === 200 && keys(sent.json) === "notice" && notice === REPORT_WORDS.thanksPerson(report?.reference ?? -1), `${sent.status} ${sent.text.slice(0, 160)}`);
      check("who it is about was worked out on the server: the other person of that call", report?.reportedId === host.id && report.context === "call" && report.contextId === open.call.id && report.reason === "other" && report.text === "It went badly." && report.urgent === false);
      check("and the person reported is blocked for the reporter, as the form said", (await db.select().from(schema.blocks).where(and(eq(schema.blocks.blockerId, cust.id), eq(schema.blocks.blockedId, host.id)))).length === 1);
      check("the coming call between the two was cancelled by the block", (await callRow(ahead.call.id)).cancelledAt !== null);
      const fromPage = await send({ place: "profile", id: handle, reason: "impersonation", text: "" }, stranger.jar);
      const [second2] = await db.select().from(schema.reports).where(eq(schema.reports.reporterId, stranger.id));
      check("a host's page can be reported by someone who never had a call with her", fromPage.status === 200 && second2?.reportedId === host.id && second2.context === "profile" && second2.contextId === handle);
      check("nobody can report themselves", sentence(await send({ place: "profile", id: handle, reason: "other", text: "" }, host.jar)) === "You cannot report yourself.");
    }
  } finally {
    // An account of this run that was made but never noted (its confirmation email did not come, say) is removed too.
    for (const lost of await db.select({ id: schema.user.id }).from(schema.user).where(like(schema.user.email, `approom-${RUN}-%`))) if (!made.includes(lost.id)) made.push(lost.id);
    const ids = made.length ? made : ["-"];
    const mine = callIds.length ? callIds : [randomUUID()];
    const payments = await db.select({ id: schema.payments.id, intent: schema.payments.stripePaymentIntentId }).from(schema.payments).where(inArray(schema.payments.callId, mine));
    // Nothing of this run stays open at Stripe: a hold that is still there is let go.
    for (const payment of payments) if (payment.intent) await stripe().paymentIntents.cancel(payment.intent).catch(() => undefined);
    const paymentIds = payments.length ? payments.map((p) => p.id) : [randomUUID()];
    // Whatever could not be removed is said, counts as a failure of the check, and the rest is still removed.
    const quietly = async (what: Promise<unknown>) =>
      what.catch((error: Error) => {
        failures++;
        console.log(` FAIL  could not remove something of this run: ${error.message.slice(0, 120)}`);
      });
    await quietly(db.delete(schema.reports).where(inArray(schema.reports.reporterId, ids)));
    await quietly(db.delete(schema.blocks).where(inArray(schema.blocks.blockerId, ids)));
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
    await quietly(db.delete(schema.emailOutbox).where(like(schema.emailOutbox.to, `approom-${RUN}-%`)));
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
