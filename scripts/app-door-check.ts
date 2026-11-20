/**
 * Testing tool: talks to the app running on this computer the way the phone app will, and checks
 * the door for it (plans/45-phone-apps/01-the-door.md): what comes in the app's way and what does
 * not, signing in from an app, where emailed links may lead, the opening address, the switches
 * for the apps, and that the login is only extended by the phone's own request to the login tool.
 *
 * It empties the table of attempt limits and rewrites the founder's switches as it goes, so it
 * only runs against a database made for checking (its name must end in "_check"), never the one
 * other work shares. It removes the accounts it made and puts the switches back as they were.
 *
 * Usage: DATABASE_URL=…/something_check npx tsx scripts/app-door-check.ts [--app=http://localhost:3000]
 * (the app must be running against the same database)
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { randomBytes, randomUUID } from "node:crypto";
import http from "node:http";
import { and, asc, desc, eq, inArray, like, sql } from "drizzle-orm";
import { APP_ORIGIN } from "../src/lib/auth-rules";
import { APP_HEADER, SIGN_IN_HEADER } from "../src/lib/app-door/rules";
import type { AppStart, Refusal } from "../src/lib/app-door/types";
import { TERMS_VERSION } from "../src/lib/terms";
import { requireLocalDatabase } from "./local-only";

const BASE = process.argv.find((arg) => arg.startsWith("--app="))?.slice("--app=".length) ?? "http://localhost:3000";
const RUN = randomUUID().slice(0, 8);
const DAY = 24 * 3_600_000;

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}

/** What a phone keeps of a login: each cookie's value, and until when the server said to keep it. */
type Jar = Map<string, { value: string; until: number | null }>;
type Reply = { status: number; json: Record<string, unknown> | null; text: string; location: string | null; headers: http.IncomingHttpHeaders; setCookies: string[] };

function keepCookies(jar: Jar | undefined, setCookies: string[]) {
  for (const cookie of setCookies) {
    const [pair, ...attributes] = cookie.split(";");
    const at = pair.indexOf("=");
    const name = pair.slice(0, at).trim();
    const value = pair.slice(at + 1);
    const maxAge = attributes.map((a) => /^\s*max-age=(-?\d+)\s*$/i.exec(a)?.[1]).find((found) => found !== undefined);
    if (!value || maxAge === "0") jar?.delete(name);
    else jar?.set(name, { value, until: maxAge === undefined ? null : Date.now() + Number(maxAge) * 1000 });
  }
}
const asCookie = (jar: Jar) => [...jar].map(([name, kept]) => `${name}=${kept.value}`).join("; ");

/**
 * One request sent exactly as given, with nothing added. (The usual `fetch` of this tool adds a
 * browser-like mark of its own to every request, which a phone app does not send, and which the
 * door rightly refuses. So requests are sent with the plain sender underneath.)
 */
function plain(path: string, options: { method?: string; body?: unknown; headers?: Record<string, string>; jar?: Jar } = {}): Promise<Reply> {
  const url = new URL(path.startsWith("http") ? path : `${BASE}${path}`);
  const payload = options.body !== undefined ? JSON.stringify(options.body) : undefined;
  const headers: Record<string, string> = { ...options.headers };
  if (payload !== undefined) {
    headers["content-type"] = "application/json";
    headers["content-length"] = String(Buffer.byteLength(payload));
  }
  return new Promise((resolve, reject) => {
    const request = http.request(url, { method: options.method ?? (payload !== undefined ? "POST" : "GET"), headers }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        const setCookies = response.headers["set-cookie"] ?? [];
        keepCookies(options.jar, setCookies);
        let json: Record<string, unknown> | null = null;
        try {
          json = JSON.parse(text);
        } catch {
          // not JSON
        }
        resolve({ status: response.statusCode ?? 0, json, text, location: response.headers.location ?? null, headers: response.headers, setCookies });
      });
    });
    request.on("error", reject);
    if (payload !== undefined) request.write(payload);
    request.end();
  });
}

type Sent = { method?: string; body?: unknown; jar?: Jar; headers?: Record<string, string> };
/**
 * A request the way the phone app sends it. To the login tool: its name, where it says it comes
 * from, and its kept login as a cookie (what the login tool's kit for phones does). To an address
 * of the door: its name, and its kept login in the app's own header, with no cookie at all.
 */
function asApp(path: string, options: Sent = {}): Promise<Reply> {
  const kept = options.jar?.size ? asCookie(options.jar) : null;
  const headers: Record<string, string> = { [APP_HEADER]: "android 1.0.0" };
  if (path.startsWith("/api/app/")) {
    if (kept) headers[SIGN_IN_HEADER] = kept;
  } else {
    headers["expo-origin"] = APP_ORIGIN;
    if (kept) headers.cookie = kept;
  }
  return plain(path, { ...options, headers: { ...headers, ...options.headers } });
}
/** A request the way a browser on our own site sends it. */
function asBrowser(path: string, options: Sent = {}): Promise<Reply> {
  const headers: Record<string, string> = { origin: BASE, "sec-fetch-site": "same-origin", "sec-fetch-mode": "cors", "sec-fetch-dest": "empty" };
  if (options.jar?.size) headers.cookie = asCookie(options.jar);
  return plain(path, { ...options, headers: { ...headers, ...options.headers } });
}

const strongPassword = () => randomBytes(12).toString("base64url");
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const refusal = (reply: Reply) => (reply.json as Refusal | null)?.error?.code ?? `no code, status ${reply.status}`;

async function main() {
  requireLocalDatabase();
  const setting = new URL(process.env.DATABASE_URL ?? "");
  // The address can also name its database or its computer after a "?", which would win over what is checked here.
  for (const override of ["database", "dbname", "host", "hostaddr", "port", "service"]) {
    if (setting.searchParams.has(override)) throw new Error(`DATABASE_URL must name its database in the address itself, not with "?${override}=".`);
  }
  const { db, schema } = await import("../src/db");
  const { switches, setSwitches } = await import("../src/lib/safety/switches");
  const closing = await import("../src/lib/profiles/closing");
  // Asked of the connection itself, before anything is written: which database is this really?
  const [{ name: database }] = (await db.execute(sql`select current_database() as name`)) as unknown as { name: string }[];
  if (!database.endsWith("_check")) {
    throw new Error(`This script empties the attempt limits and rewrites the switches, so it only runs against a database made for checking (a name ending in "_check"), not "${database}".`);
  }

  const up = await asBrowser("/login").catch(() => null);
  if (!up || up.status !== 200) throw new Error(`The app is not running at ${BASE}. Start it first.`);

  const address = (name: string) => `check-${RUN}-${name}@example.test`;
  const userByEmail = async (email: string) => (await db.select().from(schema.user).where(eq(schema.user.email, email)))[0];
  const freshLimits = () => db.delete(schema.rateLimit);
  const start = async (jar?: Jar, headers?: Record<string, string>) => {
    const reply = await asApp("/api/app/start", { jar, headers });
    return { reply, body: reply.json as AppStart | null };
  };

  /** The emails to an address whose subject contains some words, the oldest first. Emails are sent in the background, so wait a little. */
  async function emails(to: string, subject: string, atLeast = 1): Promise<{ body: string; link: string }[]> {
    for (let i = 0; i < 25; i++) {
      const found = await db
        .select()
        .from(schema.emailOutbox)
        .where(and(eq(schema.emailOutbox.to, to), like(schema.emailOutbox.subject, `%${subject}%`)))
        .orderBy(asc(schema.emailOutbox.createdAt));
      if (found.length >= atLeast) return found.map((mail) => ({ body: mail.body, link: mail.body.match(/https?:\/\/\S+/)?.[0] ?? "" }));
      await pause(200);
    }
    return [];
  }

  /** Signs up the app's way, confirms the email in a browser, finishes "18 and terms", and signs in the app's way. */
  async function newPerson(name: string) {
    const person = { name: `Check ${name}`, email: address(name), password: strongPassword(), jar: new Map() as Jar };
    await asApp("/api/auth/sign-up/email", { body: { name: person.name, email: person.email, password: person.password, callbackURL: `${BASE}/welcome` } });
    const [mail] = await emails(person.email, "Confirm your email");
    if (!mail) throw new Error(`No confirmation email for ${person.email}`);
    await asBrowser(mail.link, { jar: new Map() });
    const row = await userByEmail(person.email);
    const now = new Date();
    await db.update(schema.user).set({ adultConfirmedAt: now, termsAcceptedAt: now, termsVersion: TERMS_VERSION, timeZone: "America/New_York" }).where(eq(schema.user.id, row.id));
    const signIn = await asApp("/api/auth/sign-in/email", { body: { email: person.email, password: person.password }, jar: person.jar });
    if (signIn.status !== 200) throw new Error(`Could not sign in ${person.email} the app's way: ${signIn.status} ${signIn.text.slice(0, 200)}`);
    return { ...person, id: row.id };
  }

  // The founder's switches exactly as they were, to put back at the end: the row itself as the
  // database writes it out (so not a fraction of a second of its date is lost), or that there was none.
  const [saved] = (await db.execute(sql`select row_to_json(s)::text as row from site_switches s where id = 1`)) as unknown as { row: string }[];
  async function restoreSwitches() {
    await db.transaction(async (tx) => {
      await tx.delete(schema.siteSwitches).where(eq(schema.siteSwitches.id, 1));
      if (saved) await tx.execute(sql`insert into site_switches select * from json_populate_record(null::site_switches, ${saved.row}::json)`);
    });
  }

  // Is the app that is running at BASE really working on this same database? A wrong port would
  // otherwise let this script make accounts in one database and clean up in another. A switch is
  // turned here, the app is asked whether it sees it, and the switch is put back.
  {
    let sees = false;
    try {
      await setSwitches({ appOldestVersion: "9000.0.0" });
      const high = await asApp("/api/app/start");
      await setSwitches({ appOldestVersion: "" });
      const none = await asApp("/api/app/start");
      // Two plain answers, saying the opposite of each other, each as the switch stood. Nothing less counts.
      sees = high.status === 200 && none.status === 200 && (high.json as AppStart | null)?.updateNeeded === true && (none.json as AppStart | null)?.updateNeeded === false;
    } finally {
      await restoreSwitches();
    }
    if (!sees) throw new Error(`The app at ${BASE} does not see changes made in the database "${database}". It is running against another database; nothing was changed there.`);
  }

  try {
    // ----------------------------------------------------------------------
    console.log("\n1. What comes in the app's way, and what does not");
    await freshLimits();
    {
      const { reply, body } = await start();
      check("the opening address answers the app, with nobody logged in", reply.status === 200 && body?.me === null, `${reply.status}`);
      check("its answer may not be kept by anything in between", reply.headers["cache-control"] === "private, no-store", String(reply.headers["cache-control"]));
      check("it names the terms in force", body?.termsVersion === TERMS_VERSION);

      const bare = await plain("/api/app/start");
      check("without the app's header it is refused", bare.status === 403 && refusal(bare) === "not_the_app", refusal(bare));
      const malformed = await plain("/api/app/start", { headers: { [APP_HEADER]: "android" } });
      check("a header that is not in the app's form is refused", refusal(malformed) === "not_the_app", refusal(malformed));
      for (const mark of ["sec-fetch-site", "sec-fetch-mode", "sec-fetch-dest"]) {
        const marked = await asApp("/api/app/start", { headers: { [mark]: mark === "sec-fetch-site" ? "same-origin" : "cors" } });
        check(`with the app's header and a browser's mark (${mark}) it is refused`, refusal(marked) === "not_the_app", refusal(marked));
      }
      const fromOurPage = await asBrowser("/api/app/start");
      check("one of our own pages cannot use it either", refusal(fromOurPage) === "not_the_app", refusal(fromOurPage));
    }

    // ----------------------------------------------------------------------
    console.log("\n2. Signing up and signing in from the app");
    await freshLimits();
    const password = strongPassword();
    const one = { name: "Check One", email: address("one"), password, jar: new Map() as Jar };
    {
      const signUp = await asApp("/api/auth/sign-up/email", { body: { name: one.name, email: one.email, password, callbackURL: `${BASE}/welcome` } });
      check("sign-up the app's way is accepted", signUp.status === 200, `${signUp.status} ${signUp.text.slice(0, 120)}`);
      check("signing up gives the app no login", signUp.json?.token === null && signUp.setCookies.length === 0);

      // The link of the sign-up itself, read before anything else can send another.
      const [mail] = await emails(one.email, "Confirm your email");
      const link = new URL(mail?.link ?? "http://none.invalid");
      check("the confirmation link is on the website", link.origin === BASE && link.pathname === "/api/auth/verify-email", mail?.link.slice(0, 60));
      check("and leads on to the website's own 18-and-terms page", link.searchParams.get("callbackURL") === `${BASE}/welcome`, link.searchParams.get("callbackURL") ?? "");

      const early = await asApp("/api/auth/sign-in/email", { body: { email: one.email, password }, jar: one.jar });
      check("the app cannot sign in before the email is confirmed", early.status === 403 && early.json?.code === "EMAIL_NOT_VERIFIED", `${early.status} ${early.json?.code}`);
      check("and the opening address still knows nobody", (await start(one.jar)).body?.me === null);
      const [, resent] = await emails(one.email, "Confirm your email", 2);
      check("that attempt sends the link again, and it too leads to the website", Boolean(resent) && new URL(resent.link).origin === BASE && new URL(resent.link).searchParams.get("callbackURL") === "/", resent?.link.slice(0, 80));

      const browser: Jar = new Map();
      const confirmed = await asBrowser(mail.link, { jar: browser });
      check("opening the link confirms the address and goes on to the website's page", confirmed.status === 302 && confirmed.location === `${BASE}/welcome`, `${confirmed.status} ${confirmed.location}`);
      const inBrowser = await asBrowser("/api/auth/get-session", { jar: browser });
      check("it signs in the browser that opened it, as that person", (inBrowser.json?.user as { email?: string } | undefined)?.email === one.email);
      check("and not the app", (await start(one.jar)).body?.me === null);

      const signIn = await asApp("/api/auth/sign-in/email", { body: { email: one.email, password }, jar: one.jar });
      check("after confirming, the app signs in with the password", signIn.status === 200 && one.jar.size > 0, `${signIn.status}`);
      check("signing in sends the app nowhere", signIn.json?.redirect !== true && !signIn.location, JSON.stringify(signIn.json?.redirect));
      const { reply, body } = await start(one.jar);
      check("the opening address now knows the person", reply.status === 200 && body?.me?.email === one.email, `${reply.status}`);
      check("and that 18-and-terms is still to do", body?.me?.next === "welcome");
      check("it sends exactly the fields the app needs", Object.keys(body?.me ?? {}).sort().join(",") === "email,host,id,name,next,paused,timeZone", Object.keys(body?.me ?? {}).join(","));

      const row = await userByEmail(one.email);
      const now = new Date();
      await db.update(schema.user).set({ adultConfirmedAt: now, termsAcceptedAt: now, termsVersion: TERMS_VERSION, timeZone: "America/New_York" }).where(eq(schema.user.id, row.id));
      const after = (await start(one.jar)).body;
      check("once 18-and-terms is done, nothing stands before the home page", after?.me?.next === null && after?.me?.host === null);

      // The sign-in is read from the app's own header only. A browser's cookie is never looked at.
      const cookieOnly = await plain("/api/app/start", { headers: { [APP_HEADER]: "android 1.0.0", cookie: asCookie(browser) } });
      check("a browser's login cookie, even with the app's header added, is read as nobody", cookieOnly.status === 200 && (cookieOnly.json as AppStart | null)?.me === null, cookieOnly.text.slice(0, 60));
      const both = await plain("/api/app/start", { headers: { [APP_HEADER]: "android 1.0.0", cookie: asCookie(browser), [SIGN_IN_HEADER]: "better-auth.session_token=not-a-login" } });
      check("and it does not stand in for a sign-in header that is not a login", (both.json as AppStart | null)?.me === null);
    }

    // ----------------------------------------------------------------------
    console.log("\n3. Emailed links can only lead to the website");
    await freshLimits();
    {
      for (const destination of ["connect://welcome", "connect://", "exp://127.0.0.1:8081/--/welcome", "https://evil.test/welcome", "//evil.test/welcome", "/.//evil.test", "/%2Fevil.test", "/\\evil.test"]) {
        const email1 = address(`dest-${randomUUID().slice(0, 6)}`);
        const reply = await asApp("/api/auth/sign-up/email", { body: { name: "Check Dest", email: email1, password: strongPassword(), callbackURL: destination } });
        check(`sign-up asking for a link to ${destination} is refused`, reply.status === 403 && !(await userByEmail(email1)), `${reply.status}`);
      }
      const reset = await asApp("/api/auth/request-password-reset", { body: { email: one.email, redirectTo: "connect://reset-password" } });
      check("a reset asking for a link into the app is refused", reset.status === 403, `${reset.status}`);
      const again = await asApp("/api/auth/send-verification-email", { body: { email: one.email, callbackURL: "connect://welcome" } });
      check("so is 'send it again' asking for a link into the app", again.status === 403, `${again.status}`);

      // Real links, changed by hand.
      const two = { email: address("two"), password: strongPassword() };
      await asApp("/api/auth/sign-up/email", { body: { name: "Check Two", email: two.email, password: two.password, callbackURL: `${BASE}/welcome` } });
      const [mail] = await emails(two.email, "Confirm your email");
      for (const destination of ["connect://welcome", "/.//evil.test", "https://evil.test/"]) {
        const changed = new URL(mail.link);
        changed.searchParams.set("callbackURL", destination);
        const opened = await asBrowser(changed.toString(), { jar: new Map() });
        check(`a confirmation link changed to land at ${destination} is refused, with no way on`, opened.status === 403 && !opened.location, `${opened.status} ${opened.location ?? ""}`);
      }
      check("and none of them confirmed anything", (await userByEmail(two.email))?.emailVerified === false);
      // The same with a key that is no longer good: the login tool then sends the person on with an error, and that too must stay on the website.
      const broken = new URL(mail.link);
      broken.searchParams.set("token", `${broken.searchParams.get("token")!.slice(0, -6)}abcdef`);
      const brokenOpened = await asBrowser(broken.toString(), { jar: new Map() });
      check("a link with a bad key sends on to the website's page with the error, nowhere else", (brokenOpened.location ?? "").startsWith(`${BASE}/welcome?error=`), `${brokenOpened.status} ${brokenOpened.location ?? ""}`);
      broken.searchParams.set("callbackURL", "/.//evil.test");
      const brokenElsewhere = await asBrowser(broken.toString(), { jar: new Map() });
      check("and a bad key with a changed landing is refused outright", brokenElsewhere.status === 403 && !brokenElsewhere.location, `${brokenElsewhere.status} ${brokenElsewhere.location ?? ""}`);

      // The reset link, as the website asks for it and as the email carries it.
      const three = await newPerson("reset");
      check("(the person whose password is about to be reset is signed in on the app)", (await start(three.jar)).body?.me?.email === three.email);
      const asked = await asBrowser("/api/auth/request-password-reset", { body: { email: three.email, redirectTo: "/reset-password" } });
      check("the website's own way of asking for a reset still works", asked.status === 200, `${asked.status}`);
      const [resetMail] = await emails(three.email, "Reset your");
      const resetLink = new URL(resetMail?.link ?? "http://none.invalid");
      check("the reset link is on the website", resetLink.origin === BASE && resetLink.pathname.startsWith("/api/auth/reset-password/"), resetMail?.link.slice(0, 60));
      const elsewhere = new URL(resetLink);
      elsewhere.searchParams.set("callbackURL", "connect://reset-password");
      const refused = await asBrowser(elsewhere.toString(), { jar: new Map() });
      check("a reset link changed to land in the app is refused, and hands its key to nobody", refused.status === 403 && !refused.location, `${refused.status} ${refused.location ?? ""}`);
      const opened = await asBrowser(resetLink.toString(), { jar: new Map() });
      const landing = new URL(opened.location ?? "http://none.invalid", BASE);
      check("the real reset link goes on to the website's new-password page with its key", opened.status === 302 && landing.origin === BASE && landing.pathname === "/reset-password" && Boolean(landing.searchParams.get("token")), `${opened.status} ${opened.location ?? ""}`);
      const done = await asBrowser("/api/auth/reset-password", { body: { newPassword: strongPassword(), token: landing.searchParams.get("token") } });
      check("the password is reset on the website", done.status === 200, `${done.status}`);
      check("and the app's old login no longer works", (await start(three.jar)).body?.me === null);
    }

    // ----------------------------------------------------------------------
    console.log("\n4. What is switched off in the login tool stays off for the app");
    await freshLimits();
    {
      // Written out here on purpose, not read from the app's own list: an address taken off that list by mistake must fail this check.
      const off: { path: string; method: "GET" | "POST"; body?: unknown }[] = [
        { path: "/update-user", method: "POST", body: { name: "Other Name" } },
        { path: "/change-email", method: "POST", body: { newEmail: address("changed"), callbackURL: "/" } },
        { path: "/delete-user", method: "POST", body: { password } },
        { path: "/delete-user/callback?token=abc", method: "GET" },
        { path: "/link-social", method: "POST", body: { provider: "google", callbackURL: "/" } },
        { path: "/unlink-account", method: "POST", body: { providerId: "google" } },
        { path: "/revoke-session", method: "POST", body: { token: "abc" } },
        { path: "/revoke-sessions", method: "POST", body: {} },
        { path: "/revoke-other-sessions", method: "POST", body: {} },
        { path: "/two-factor/disable", method: "POST", body: { password } },
      ];
      for (const { path, method, body } of off) {
        const reply = await asApp(`/api/auth${path}`, { method, body, jar: one.jar });
        check(`${method} ${path.split("?")[0]} is not found, asked the app's way`, reply.status === 404, `${reply.status}`);
      }
      const proxy = await asApp("/api/auth/expo-authorization-proxy?authorizationURL=https%3A%2F%2Fevil.test", { jar: one.jar });
      check("the kit's own address for outside logins does not exist here", proxy.status === 404, `${proxy.status}`);
      check("the person's name is unchanged after all that", (await userByEmail(one.email))?.name === one.name);

      const cookie = asCookie(one.jar);
      const noName = await plain("/api/auth/sign-out", { body: {}, headers: { [APP_HEADER]: "android 1.0.0", cookie } });
      check("a request with a login and no 'where from' at all is refused by the login tool", noName.status === 403, `${noName.status}`);
      const otherName = await plain("/api/auth/sign-out", { body: {}, headers: { [APP_HEADER]: "android 1.0.0", "expo-origin": "evil://", cookie } });
      check("so is one that names another app", otherName.status === 403, `${otherName.status}`);
      const browserWithHeader = await plain("/api/auth/sign-out", { body: {}, headers: { origin: "https://evil.test", "expo-origin": APP_ORIGIN, cookie } });
      check("a browser's own 'where from' is never replaced by the app's name", browserWithHeader.status === 403, `${browserWithHeader.status}`);
      check("and the person is still signed in after all three", (await start(one.jar)).body?.me?.email === one.email);
    }

    // ----------------------------------------------------------------------
    console.log("\n5. The login is extended only by the phone's own request to the login tool");
    {
      const row = await userByEmail(one.email);
      const [session] = await db.select().from(schema.session).where(eq(schema.session.userId, row.id)).orderBy(desc(schema.session.createdAt)).limit(1);
      // As if this login was last used two days ago: 30 days from then is 28 days from now, on the server and on the phone.
      const aged = new Date(Date.now() + 28 * DAY);
      await db.update(schema.session).set({ expiresAt: aged }).where(eq(schema.session.id, session.id));
      const kept = [...one.jar].find(([name]) => name.endsWith("session_token"));
      if (kept) kept[1].until = aged.getTime();
      const onServer = async () => (await db.select({ expiresAt: schema.session.expiresAt }).from(schema.session).where(eq(schema.session.id, session.id)))[0]?.expiresAt.getTime() ?? 0;
      const onPhone = () => [...one.jar].find(([name]) => name.endsWith("session_token"))?.[1].until ?? 0;

      const first = await start(one.jar);
      check("an ordinary request of the app still works two days on", first.body?.me?.email === one.email);
      check("it does not extend the login on the server", (await onServer()) === aged.getTime(), `${await onServer()} vs ${aged.getTime()}`);
      check("nor hand out a renewed one", first.reply.setCookies.length === 0 && onPhone() === aged.getTime());

      const before = Date.now();
      const renewed = await asApp("/api/auth/get-session", { jar: one.jar });
      const server = await onServer();
      const thirtyDays = (at: number) => Math.abs(at - (before + 30 * DAY)) < 5 * 60_000;
      check("the phone's own request to the login tool extends it on the server, to 30 days from now", renewed.status === 200 && thirtyDays(server), new Date(server).toISOString());
      check("and the phone is handed a login it keeps just as long", renewed.setCookies.some((cookie) => /session_token=/.test(cookie)) && thirtyDays(onPhone()), new Date(onPhone()).toISOString());
      check("which the phone then uses", (await start(one.jar)).body?.me?.email === one.email);
    }

    // ----------------------------------------------------------------------
    console.log("\n6. The switches for the apps");
    {
      // Before the founder has saved anything there is no row at all.
      await db.delete(schema.siteSwitches).where(eq(schema.siteSwitches.id, 1));
      const none = (await start()).body!;
      check("with no switch ever saved: memberships on, tips off, available now on, nobody too old", none.switches.memberships === "on" && none.switches.tips === false && none.switches.availableNow === true && none.updateNeeded === false, JSON.stringify(none));
      // A row made by something else, with the apps' fields left to the database's own starting values.
      await db.insert(schema.siteSwitches).values({ id: 1 });
      const [bornRow] = await db.select().from(schema.siteSwitches).where(eq(schema.siteSwitches.id, 1));
      check("the database starts the apps' switches as: memberships on, tips off, available now on, no oldest version", bornRow.appMemberships === "on" && bornRow.appTips === false && bornRow.appAvailableNow === true && bornRow.appOldestVersion === "", JSON.stringify([bornRow.appMemberships, bornRow.appTips, bornRow.appAvailableNow, bornRow.appOldestVersion]));
      const born = (await start()).body!;
      check("the database's own starting values say the same", JSON.stringify(born.switches) === JSON.stringify(none.switches) && born.updateNeeded === false, JSON.stringify(born.switches));

      await setSwitches({ appMemberships: "use_only", appAvailableNow: false, appOldestVersion: "0.9.0", joiningOff: true });
      await setSwitches({ appTips: true });
      const kept = await switches();
      check("the tips switch for the apps is saved", kept.appTips === true && (await db.select().from(schema.siteSwitches).where(eq(schema.siteSwitches.id, 1)))[0].appTips === true);
      check("saving one switch leaves every other as it was", kept.appMemberships === "use_only" && kept.appAvailableNow === false && kept.appOldestVersion === "0.9.0" && kept.joiningOff === true && kept.memberships === "everyone", JSON.stringify(kept));
      const told = (await start()).body!;
      check("the app is told the middle position of memberships and that 'available now' is off", told.switches.memberships === "use_only" && told.switches.availableNow === false);
      check("tips stay off for the apps even with their switch on, while the website has no tips", told.switches.tips === false);
      await setSwitches({ joiningOff: false, appTips: false, appAvailableNow: true });

      await setSwitches({ appMemberships: "off" });
      check("memberships off for the apps alone are off in the apps", (await start()).body!.switches.memberships === "off" && (await switches()).memberships === "everyone");
      await setSwitches({ appMemberships: "on", memberships: "off" });
      check("memberships off for everyone are off in the apps, whatever the apps' switch says", (await start()).body!.switches.memberships === "off");
      await setSwitches({ memberships: "everyone", requestsOff: true });
      check("'no new requests' also takes 'available now' out of the apps", (await start()).body!.switches.availableNow === false);
      await setSwitches({ requestsOff: false });

      await setSwitches({ appOldestVersion: "1.0.1" });
      const old = await start();
      check("a copy older than the oldest allowed is told to update, by the one address that still answers it", old.reply.status === 200 && old.body?.updateNeeded === true);
      const newer = await start(undefined, { [APP_HEADER]: "android 1.0.1" });
      check("a copy that is new enough is not", newer.body?.updateNeeded === false);
      await db.update(schema.siteSwitches).set({ appOldestVersion: "soon" }).where(eq(schema.siteSwitches.id, 1));
      check("an oldest version that is not a version locks nobody out", (await start()).body?.updateNeeded === false);
      await db.update(schema.siteSwitches).set({ appMemberships: "sometimes" }).where(eq(schema.siteSwitches.id, 1));
      check("a memberships position that is not one of the three counts as off", (await start()).body!.switches.memberships === "off");
      await restoreSwitches();
    }

    // ----------------------------------------------------------------------
    console.log("\n7. A paused account, and a closed account");
    await freshLimits();
    {
      const four = await newPerson("four");
      await db.update(schema.user).set({ pausedAt: new Date() }).where(eq(schema.user.id, four.id));
      check("a paused account is told so", (await start(four.jar)).body?.me?.paused === true);
      await db.update(schema.user).set({ pausedAt: null }).where(eq(schema.user.id, four.id));

      // What a wrong password looks like on the wire: the measure for everything a closed account gets.
      const wrong = await asApp("/api/auth/sign-in/email", { body: { email: four.email, password: strongPassword() }, jar: new Map() });
      const same = (reply: Reply) => reply.status === wrong.status && reply.text === wrong.text && reply.setCookies.length === 0;
      check("a wrong password gets the login tool's ordinary answer", wrong.status === 401 && wrong.json?.code === "INVALID_EMAIL_OR_PASSWORD", `${wrong.status} ${wrong.json?.code}`);

      const guest = await start();
      await closing.closeAccount({ userId: four.id, by: four.id });
      const closed = await start(four.jar);
      check("a closed account's old login is answered exactly as nobody is", closed.reply.status === guest.reply.status && closed.reply.text === guest.reply.text, closed.reply.text.slice(0, 80));
      const rightPassword = await asApp("/api/auth/sign-in/email", { body: { email: four.email, password: four.password }, jar: new Map() });
      check("signing in to it with the right password is answered exactly as a wrong password is", same(rightPassword), `${rightPassword.status} ${rightPassword.text.slice(0, 80)}`);
      const fromBrowser = await asBrowser("/api/auth/sign-in/email", { body: { email: four.email, password: four.password, callbackURL: "/" }, jar: new Map() });
      check("in a browser too", fromBrowser.status === wrong.status && fromBrowser.text === wrong.text, `${fromBrowser.status} ${fromBrowser.text.slice(0, 80)}`);
      const otherCase = await asApp("/api/auth/sign-in/email", { body: { email: four.email.toUpperCase(), password: four.password }, jar: new Map() });
      check("and written in capital letters", same(otherCase), `${otherCase.status} ${otherCase.text.slice(0, 80)}`);
      // An address that is not an email address, but that turns into this one when made lower-case
      // (its "k" is the Kelvin sign, not the letter): it must get the same answer whether the account is closed or not.
      const kelvin = (email: string) => email.replace("check-", "chec\u212a-");
      const strange = await asApp("/api/auth/sign-in/email", { body: { email: kelvin(address("nobody-at-all")), password: four.password }, jar: new Map() });
      const strangeClosed = await asApp("/api/auth/sign-in/email", { body: { email: kelvin(four.email), password: four.password }, jar: new Map() });
      check("an address with a letter that is not a plain one is turned away the same for a closed account as for any other", kelvin(four.email).toLowerCase() === four.email && strangeClosed.status === strange.status && strangeClosed.text === strange.text, `${strangeClosed.status} vs ${strange.status}`);

      // Closed before its email was ever confirmed: no "confirm your email" answer, and no new confirmation email.
      const five = { email: address("five"), password: strongPassword() };
      await asApp("/api/auth/sign-up/email", { body: { name: "Check Five", email: five.email, password: five.password, callbackURL: `${BASE}/welcome` } });
      await emails(five.email, "Confirm your email");
      const fiveRow = await userByEmail(five.email);
      await closing.closeAccount({ userId: fiveRow.id, by: fiveRow.id });
      const unconfirmed = await asApp("/api/auth/sign-in/email", { body: { email: five.email, password: five.password }, jar: new Map() });
      check("an account closed before it was confirmed is answered as a wrong password too", same(unconfirmed), `${unconfirmed.status} ${unconfirmed.text.slice(0, 80)}`);
      await pause(1200);
      check("and is not sent the confirmation again", (await emails(five.email, "Confirm your email")).length === 1);
    }
  } finally {
    await restoreSwitches();
    const mine = await db.select({ id: schema.user.id }).from(schema.user).where(like(schema.user.email, `check-${RUN}-%`));
    const ids = mine.map((person) => person.id);
    if (ids.length > 0) {
      // Reset keys that were asked for and never used point at the person by their value.
      await db.delete(schema.verification).where(inArray(schema.verification.value, ids));
      await db.delete(schema.hostProfiles).where(inArray(schema.hostProfiles.userId, ids));
      await db.delete(schema.user).where(inArray(schema.user.id, ids));
    }
    await db.delete(schema.emailOutbox).where(like(schema.emailOutbox.to, `check-${RUN}-%`));
    await db.delete(schema.rateLimit);
  }

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
