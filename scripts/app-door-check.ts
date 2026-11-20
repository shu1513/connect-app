/**
 * Testing tool: talks to the app running on this computer the way the phone app will, and checks
 * the door for it (plans/45-phone-apps/01-the-door.md): what comes in the app's way and what does
 * not, signing in from an app, where emailed links may lead, the opening address, the switches
 * for the apps, and that the login is only extended by the phone's own request to the login tool.
 * It cleans up the accounts it made and puts the switches back.
 *
 * Usage: npx tsx scripts/app-door-check.ts [--app=http://localhost:3000]
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { randomBytes, randomUUID } from "node:crypto";
import http from "node:http";
import { and, desc, eq, like } from "drizzle-orm";
import { APP_ORIGIN, UNUSED_LOGIN_PATHS } from "../src/lib/auth-rules";
import { APP_HEADER } from "../src/lib/app-door/rules";
import type { AppStart, Refusal } from "../src/lib/app-door/types";
import { TERMS_VERSION } from "../src/lib/terms";
import { requireLocalDatabase } from "./local-only";

const BASE = process.argv.find((arg) => arg.startsWith("--app="))?.slice("--app=".length) ?? "http://localhost:3000";
const RUN = randomUUID().slice(0, 8);

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}

type Jar = Map<string, string>;
type Reply = { status: number; json: Record<string, unknown> | null; text: string; location: string | null; headers: http.IncomingHttpHeaders; setCookies: string[] };

function keepCookies(jar: Jar | undefined, setCookies: string[]) {
  for (const cookie of setCookies) {
    const [pair, ...attributes] = cookie.split(";");
    const at = pair.indexOf("=");
    const name = pair.slice(0, at).trim();
    const value = pair.slice(at + 1);
    const gone = !value || attributes.some((a) => /^\s*max-age=0\s*$/i.test(a));
    if (gone) jar?.delete(name);
    else jar?.set(name, value);
  }
}

/**
 * One request sent exactly as given, with nothing added. (The usual `fetch` of this tool adds a
 * browser-like mark of its own to every request, which a phone app does not send, and which the
 * door rightly refuses. So the app's requests are sent with the plain sender underneath.)
 */
function plain(path: string, options: { method?: string; body?: unknown; headers?: Record<string, string>; jar?: Jar } = {}): Promise<Reply> {
  const url = new URL(path.startsWith("http") ? path : `${BASE}${path}`);
  const payload = options.body !== undefined ? JSON.stringify(options.body) : undefined;
  const headers: Record<string, string> = { ...options.headers };
  if (payload !== undefined) {
    headers["content-type"] = "application/json";
    headers["content-length"] = String(Buffer.byteLength(payload));
  }
  if (options.jar?.size) headers.cookie = [...options.jar].map(([k, v]) => `${k}=${v}`).join("; ");
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

/** A request the way the phone app sends it: its name and version, where it says it comes from, and its kept login. */
const APP = { [APP_HEADER]: "android 1.0.0", "expo-origin": APP_ORIGIN };
const asApp = (path: string, options: { method?: string; body?: unknown; jar?: Jar; headers?: Record<string, string> } = {}) =>
  plain(path, { ...options, headers: { ...APP, ...options.headers } });
/** A request the way a browser on our own site sends it. */
const asBrowser = (path: string, options: { method?: string; body?: unknown; jar?: Jar } = {}) =>
  plain(path, { ...options, headers: { origin: BASE, "sec-fetch-site": "same-origin", "sec-fetch-mode": "cors", "sec-fetch-dest": "empty" } });

const strongPassword = () => randomBytes(12).toString("base64url");
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const refusal = (reply: Reply) => (reply.json as Refusal | null)?.error?.code ?? `no code, status ${reply.status}`;

async function main() {
  requireLocalDatabase();
  const { db, schema } = await import("../src/db");
  const { switches, setSwitches } = await import("../src/lib/safety/switches");
  const closing = await import("../src/lib/profiles/closing");

  const up = await asBrowser("/login").catch(() => null);
  if (!up || up.status !== 200) throw new Error(`The app is not running at ${BASE}. Start it first.`);

  const address = (name: string) => `check-${RUN}-${name}@example.test`;
  const userByEmail = async (email: string) => (await db.select().from(schema.user).where(eq(schema.user.email, email)))[0];
  const freshLimits = () => db.delete(schema.rateLimit);
  const start = async (jar?: Jar, headers?: Record<string, string>) => {
    const reply = await asApp("/api/app/start", { jar, headers });
    return { reply, body: reply.json as AppStart | null };
  };

  async function email(to: string, subject: string): Promise<{ body: string; link: string } | null> {
    for (let i = 0; i < 25; i++) {
      const [found] = await db
        .select()
        .from(schema.emailOutbox)
        .where(and(eq(schema.emailOutbox.to, to), like(schema.emailOutbox.subject, `%${subject}%`)))
        .orderBy(desc(schema.emailOutbox.createdAt))
        .limit(1);
      if (found) return { body: found.body, link: found.body.match(/https?:\/\/\S+/)?.[0] ?? "" };
      await pause(200);
    }
    return null;
  }

  /** Signs up the app's way, confirms the email in a browser, finishes "18 and terms", and signs in the app's way. */
  async function newPerson(name: string) {
    const person = { name: `Check ${name}`, email: address(name), password: strongPassword(), jar: new Map() as Jar };
    await asApp("/api/auth/sign-up/email", { body: { name: person.name, email: person.email, password: person.password, callbackURL: `${BASE}/welcome` } });
    const mail = await email(person.email, "Confirm your email");
    if (!mail) throw new Error(`No confirmation email for ${person.email}`);
    await asBrowser(mail.link, { jar: new Map() });
    const row = await userByEmail(person.email);
    const now = new Date();
    await db.update(schema.user).set({ adultConfirmedAt: now, termsAcceptedAt: now, termsVersion: TERMS_VERSION, timeZone: "America/New_York" }).where(eq(schema.user.id, row.id));
    const signIn = await asApp("/api/auth/sign-in/email", { body: { email: person.email, password: person.password }, jar: person.jar });
    if (signIn.status !== 200) throw new Error(`Could not sign in ${person.email} the app's way: ${signIn.status} ${signIn.text.slice(0, 200)}`);
    return { ...person, id: row.id };
  }

  const saved = await switches();
  const restoreSwitches = () =>
    setSwitches({
      requestsOff: saved.requestsOff,
      memberships: saved.memberships,
      appMemberships: saved.appMemberships,
      appTips: saved.appTips,
      appAvailableNow: saved.appAvailableNow,
      appOldestVersion: saved.appOldestVersion,
    });

  try {
    // ----------------------------------------------------------------------
    console.log("\n1. What comes in the app's way, and what does not");
    await freshLimits();
    {
      const { reply, body } = await start();
      check("the opening address answers the app, with nobody logged in", reply.status === 200 && body?.me === null, `${reply.status}`);
      check("its answer may not be kept by anything in between", String(reply.headers["cache-control"]).includes("no-store") && String(reply.headers["cache-control"]).includes("private"));
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
      const early = await asApp("/api/auth/sign-in/email", { body: { email: one.email, password }, jar: one.jar });
      check("the app cannot sign in before the email is confirmed", early.status === 403 && early.json?.code === "EMAIL_NOT_VERIFIED", `${early.status} ${early.json?.code}`);
      check("and the opening address still knows nobody", (await start(one.jar)).body?.me === null);

      const mail = await email(one.email, "Confirm your email");
      check("the confirmation link leads to the website", Boolean(mail?.link.startsWith(`${BASE}/`)), mail?.link.slice(0, 60));
      const landing = new URL(mail!.link).searchParams.get("callbackURL") ?? "";
      check("and after confirming, on to the website's own page", landing.startsWith("/") || landing.startsWith(`${BASE}/`), landing);
      const browser: Jar = new Map();
      await asBrowser(mail!.link, { jar: browser });
      check("confirming signs in the browser that opened the link, not the app", browser.size > 0 && (await start(one.jar)).body?.me === null);

      const signIn = await asApp("/api/auth/sign-in/email", { body: { email: one.email, password }, jar: one.jar });
      check("after confirming, the app signs in with the password", signIn.status === 200 && one.jar.size > 0, `${signIn.status}`);
      check("signing in sends the app nowhere", signIn.json?.redirect !== true && !signIn.location, JSON.stringify(signIn.json?.redirect));
      const { reply, body } = await start(one.jar);
      check("the opening address now knows the person", reply.status === 200 && body?.me?.email === one.email, `${reply.status}`);
      check("and that 18-and-terms is still to do", body?.me?.next === "welcome");
      check("it sends nothing it should not", body?.me !== null && Object.keys(body!.me!).sort().join(",") === "email,host,id,name,next,paused,timeZone", Object.keys(body?.me ?? {}).join(","));

      const row = await userByEmail(one.email);
      const now = new Date();
      await db.update(schema.user).set({ adultConfirmedAt: now, termsAcceptedAt: now, termsVersion: TERMS_VERSION, timeZone: "America/New_York" }).where(eq(schema.user.id, row.id));
      const after = (await start(one.jar)).body;
      check("once 18-and-terms is done, nothing stands before the home page", after?.me?.next === null && after?.me?.host === null);
    }

    // ----------------------------------------------------------------------
    console.log("\n3. Emailed links can only lead to the website");
    await freshLimits();
    {
      for (const destination of ["connect://welcome", "connect://", "exp://127.0.0.1:8081/--/welcome", "https://evil.test/welcome", "//evil.test/welcome"]) {
        const email1 = address(`dest-${randomUUID().slice(0, 6)}`);
        const reply = await asApp("/api/auth/sign-up/email", { body: { name: "Check Dest", email: email1, password: strongPassword(), callbackURL: destination } });
        check(`sign-up asking for a link to ${destination} is refused`, reply.status === 403 && !(await userByEmail(email1)), `${reply.status}`);
      }
      const reset = await asApp("/api/auth/request-password-reset", { body: { email: one.email, redirectTo: "connect://reset-password" } });
      check("a reset asking for a link into the app is refused", reset.status === 403, `${reset.status}`);
      const again = await asApp("/api/auth/send-verification-email", { body: { email: one.email, callbackURL: "connect://welcome" } });
      check("so is 'send it again' asking for a link into the app", again.status === 403, `${again.status}`);
      const website = await asBrowser("/api/auth/request-password-reset", { body: { email: one.email, redirectTo: "/reset-password" } });
      check("the website's own way of asking still works", website.status === 200, `${website.status}`);

      // A real link, changed by hand to land in the app.
      const two = { email: address("two"), password: strongPassword() };
      await asApp("/api/auth/sign-up/email", { body: { name: "Check Two", email: two.email, password: two.password, callbackURL: `${BASE}/welcome` } });
      const mail = await email(two.email, "Confirm your email");
      const changed = new URL(mail!.link);
      changed.searchParams.set("callbackURL", "connect://welcome");
      const opened = await asBrowser(changed.toString(), { jar: new Map() });
      check("a confirmation link changed to land in the app is refused", opened.status === 403 && !(opened.location ?? "").startsWith("connect:"), `${opened.status} ${opened.location ?? ""}`);
      check("and confirms nothing", (await userByEmail(two.email))?.emailVerified === false);
    }

    // ----------------------------------------------------------------------
    console.log("\n4. What is switched off in the login tool stays off for the app");
    await freshLimits();
    {
      for (const path of UNUSED_LOGIN_PATHS) {
        const reply = await asApp(`/api/auth${path}`, { body: {}, jar: one.jar });
        check(`${path} is not found, asked the app's way`, reply.status === 404, `${reply.status}`);
      }
      const proxy = await asApp("/api/auth/expo-authorization-proxy?authorizationURL=https%3A%2F%2Fevil.test", { jar: one.jar });
      check("the kit's own address for outside logins does not exist here", proxy.status === 404, `${proxy.status}`);

      const noName = await plain("/api/auth/sign-out", { body: {}, jar: new Map(one.jar), headers: { [APP_HEADER]: "android 1.0.0" } });
      check("a request with a login and no 'where from' at all is refused by the login tool", noName.status === 403, `${noName.status}`);
      const otherName = await plain("/api/auth/sign-out", { body: {}, jar: new Map(one.jar), headers: { [APP_HEADER]: "android 1.0.0", "expo-origin": "evil://" } });
      check("so is one that names another app", otherName.status === 403, `${otherName.status}`);
      const browserWithHeader = await plain("/api/auth/sign-out", { body: {}, jar: new Map(one.jar), headers: { origin: "https://evil.test", "expo-origin": APP_ORIGIN } });
      check("a browser's own 'where from' is never replaced by the app's name", browserWithHeader.status === 403, `${browserWithHeader.status}`);
      check("and the person is still signed in after all three", (await start(one.jar)).body?.me?.email === one.email);
    }

    // ----------------------------------------------------------------------
    console.log("\n5. The login is extended only by the phone's own request to the login tool");
    {
      const row = await userByEmail(one.email);
      const [session] = await db.select().from(schema.session).where(eq(schema.session.userId, row.id)).orderBy(desc(schema.session.createdAt)).limit(1);
      // As if this login was last used two days ago: 30 days from then is 28 days from now.
      const aged = new Date(Date.now() + 28 * 24 * 3_600_000);
      await db.update(schema.session).set({ expiresAt: aged }).where(eq(schema.session.id, session.id));
      const expiry = async () => (await db.select({ expiresAt: schema.session.expiresAt }).from(schema.session).where(eq(schema.session.id, session.id)))[0]?.expiresAt.getTime();

      const first = await start(one.jar);
      check("an ordinary request of the app still works two days on", first.body?.me?.email === one.email);
      check("and does not extend the login, nor hand out a renewed one", (await expiry()) === aged.getTime() && first.reply.setCookies.length === 0, `${await expiry()} vs ${aged.getTime()}`);

      const renewed = await asApp("/api/auth/get-session", { jar: one.jar });
      const after = await expiry();
      check("the phone's own request to the login tool extends it", renewed.status === 200 && (after ?? 0) > aged.getTime() + 24 * 3_600_000, `${after}`);
      check("and hands the renewed login to the phone", renewed.setCookies.some((cookie) => /session_token=/.test(cookie)), renewed.setCookies.map((c) => c.split("=")[0]).join(","));
      check("which the phone then uses", (await start(one.jar)).body?.me?.email === one.email);
    }

    // ----------------------------------------------------------------------
    console.log("\n6. The switches for the apps");
    {
      const fresh = (await start()).body!;
      await setSwitches({ requestsOff: false, memberships: "everyone", appMemberships: "on", appTips: false, appAvailableNow: true, appOldestVersion: "" });
      const on = (await start()).body!;
      check("with everything as it starts: memberships on, tips off, available now on", on.switches.memberships === "on" && on.switches.tips === false && on.switches.availableNow === true, JSON.stringify(on.switches));
      check("and no copy of the app is too old", on.updateNeeded === false && typeof fresh.updateNeeded === "boolean");

      await setSwitches({ appMemberships: "use_only" });
      const useOnly = (await start()).body!;
      check("the middle position of memberships is told to the app", useOnly.switches.memberships === "use_only");
      check("saving one switch leaves the others as they were", useOnly.switches.availableNow === true && (await switches()).memberships === "everyone");

      await setSwitches({ appMemberships: "on", memberships: "off" });
      check("memberships off for everyone are off in the apps, whatever the apps' switch says", (await start()).body!.switches.memberships === "off");
      await setSwitches({ memberships: "everyone", appAvailableNow: false });
      check("'available now' off for the apps is told to the app", (await start()).body!.switches.availableNow === false);
      await setSwitches({ appAvailableNow: true, requestsOff: true });
      check("'no new requests' also takes 'available now' out of the apps", (await start()).body!.switches.availableNow === false);
      await setSwitches({ requestsOff: false, appTips: true });
      check("tips stay off for the apps even if their switch is turned on, while the website has no tips", (await start()).body!.switches.tips === false);

      await setSwitches({ appTips: false, appOldestVersion: "1.0.1" });
      const old = await start();
      check("a copy older than the oldest allowed is told to update, by the one address that still answers it", old.reply.status === 200 && old.body?.updateNeeded === true);
      const newer = await start(undefined, { [APP_HEADER]: "android 1.0.1" });
      check("a copy that is new enough is not", newer.body?.updateNeeded === false);
      await setSwitches({ appOldestVersion: "soon" });
      check("an oldest version that is not a version locks nobody out", (await start()).body?.updateNeeded === false);
      await restoreSwitches();
    }

    // ----------------------------------------------------------------------
    console.log("\n7. A paused account, a reset password, a closed account");
    await freshLimits();
    {
      const three = await newPerson("three");
      await db.update(schema.user).set({ pausedAt: new Date() }).where(eq(schema.user.id, three.id));
      check("a paused account is told so", (await start(three.jar)).body?.me?.paused === true);
      await db.update(schema.user).set({ pausedAt: null }).where(eq(schema.user.id, three.id));

      // A reset, done on the website as the emailed link has it, ends the app's login.
      await asBrowser("/api/auth/request-password-reset", { body: { email: three.email, redirectTo: "/reset-password" } });
      const mail = await email(three.email, "Reset your");
      const token = mail?.link.match(/reset-password\/([^?\s]+)/)?.[1] ?? "";
      const reset = await asBrowser("/api/auth/reset-password", { body: { newPassword: strongPassword(), token } });
      check("the password is reset on the website", reset.status === 200, `${reset.status} ${token ? "" : "no token found"}`);
      check("and the app's old login no longer works", (await start(three.jar)).body?.me === null);

      const four = await newPerson("four");
      await closing.closeAccount({ userId: four.id, by: four.id });
      const closed = await start(four.jar);
      check("a closed account is answered as nobody, with no sign that it was closed", closed.reply.status === 200 && closed.body?.me === null && !/clos/i.test(closed.reply.text), closed.reply.text.slice(0, 80));
      const tryAgain = await asApp("/api/auth/sign-in/email", { body: { email: four.email, password: four.password }, jar: new Map() });
      check("and it cannot sign in again", tryAgain.status !== 200 && !/clos/i.test(tryAgain.text), `${tryAgain.status}`);
    }
  } finally {
    await restoreSwitches();
    const mine = await db.select({ id: schema.user.id }).from(schema.user).where(like(schema.user.email, `check-${RUN}-%`));
    for (const { id } of mine) {
      await db.delete(schema.hostProfiles).where(eq(schema.hostProfiles.userId, id));
      await db.delete(schema.user).where(eq(schema.user.id, id));
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
