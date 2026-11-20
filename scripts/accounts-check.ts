/**
 * Testing tool: runs real sign-up, login and profile journeys against the app
 * running on this computer (npm run dev) and the local database, and checks
 * every result. It cleans up the accounts it made.
 *
 * Usage: npx tsx scripts/accounts-check.ts
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { randomBytes, randomUUID } from "node:crypto";
import { and, desc, eq, inArray, like, or } from "drizzle-orm";
import type { BioAnswer, BioSettings } from "../src/lib/profiles/bio-check";
import type { InstagramAccounts, InstagramLookup, InstagramSettings } from "../src/lib/profiles/instagram";
import type { TikTokAccount, TikTokLookup, TikTokSettings } from "../src/lib/profiles/tiktok";
import { TERMS_VERSION } from "../src/lib/terms";
import { requireLocalDatabase } from "./local-only";

const BASE = "http://localhost:3000";
// TikTok's sign-in is switched off for this script, whatever the settings file holds: the checks of the
// by-hand way need it off, and section 6d switches it on for itself with pretended keys.
const TIKTOK_AS_SET = { key: process.env.TIKTOK_CLIENT_KEY, secret: process.env.TIKTOK_CLIENT_SECRET, site: process.env.PUBLIC_APP_URL };
delete process.env.TIKTOK_CLIENT_KEY;
delete process.env.TIKTOK_CLIENT_SECRET;
const RUN = randomUUID().slice(0, 8);

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}

type Jar = Map<string, string>;
type Reply = { status: number; json: Record<string, unknown> | null; text: string; location: string | null; setCookies: string[] };

/** One request to the app, the way a browser would send it. Cookies are kept in the jar. */
async function send(path: string, options: { method?: string; body?: unknown; jar?: Jar } = {}): Promise<Reply> {
  const headers: Record<string, string> = { origin: BASE };
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (options.jar?.size) headers.cookie = [...options.jar].map(([k, v]) => `${k}=${v}`).join("; ");
  const response = await fetch(path.startsWith("http") ? path : `${BASE}${path}`, {
    method: options.method ?? (options.body !== undefined ? "POST" : "GET"),
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    redirect: "manual",
  });
  for (const cookie of response.headers.getSetCookie()) {
    const [pair, ...attributes] = cookie.split(";");
    const at = pair.indexOf("=");
    const name = pair.slice(0, at).trim();
    const value = pair.slice(at + 1);
    const gone = !value || attributes.some((a) => /^\s*max-age=0\s*$/i.test(a));
    if (gone) options.jar?.delete(name);
    else options.jar?.set(name, value);
  }
  const text = await response.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = JSON.parse(text);
  } catch {
    // not JSON (a page)
  }
  return { status: response.status, json, text, location: response.headers.get("location"), setCookies: response.headers.getSetCookie() };
}

const api = (path: string, body: unknown, jar?: Jar) => send(`/api/auth${path}`, { body, jar });
const strongPassword = () => randomBytes(12).toString("base64url");
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  requireLocalDatabase();
  const { db, schema } = await import("../src/db");
  const { removeTestsOf } = await import("../src/lib/connection/tests");
  const { sendEmail, EMAIL_LIMITS } = await import("../src/lib/email");
  const { withNotice } = await import("../src/lib/notice");
  const profiles = await import("../src/lib/profiles/profiles");
  const closing = await import("../src/lib/profiles/closing");
  const { createPaymentForCall } = await import("../src/lib/payments/hold");
  const { ProfileError } = profiles;

  const up = await send("/login").catch(() => null);
  if (!up || up.status !== 200) throw new Error("The app is not running. Start it with `npm run dev` first.");

  const address = (name: string) => `check-${RUN}-${name}@example.test`;
  const userByEmail = async (email: string) => (await db.select().from(schema.user).where(eq(schema.user.email, email)))[0];
  /** Attempt limits are per network address, and every request here comes from the same one. Start each journey clean. */
  const freshLimits = () => db.delete(schema.rateLimit);

  /** The newest email to an address whose subject contains some words. Emails are sent in the background, so wait a little. */
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

  /** Signs up, confirms the email and finishes the welcome step. Returns a logged-in person. */
  async function newPerson(name: string) {
    const person = { name: `Check ${name}`, email: address(name), password: strongPassword(), jar: new Map() as Jar };
    await api("/sign-up/email", { name: person.name, email: person.email, password: person.password, callbackURL: "/welcome" });
    const mail = await email(person.email, "Confirm your email");
    if (!mail) throw new Error(`No confirmation email for ${person.email}`);
    await send(mail.link, { jar: person.jar });
    const row = await userByEmail(person.email);
    // What the welcome page's form does.
    const now = new Date();
    await db
      .update(schema.user)
      .set({ adultConfirmedAt: now, termsAcceptedAt: now, termsVersion: TERMS_VERSION, timeZone: "America/New_York" })
      .where(eq(schema.user.id, row.id));
    return { ...person, id: row.id };
  }
  /** "in", "out", or "error" when the app did not give a clear answer. */
  const sessionOf = async (jar: Jar) => {
    const reply = await send("/api/auth/get-session", { jar });
    if (reply.status !== 200) return "error";
    return reply.json?.user ? "in" : "out";
  };
  const loggedIn = async (jar: Jar) => (await sessionOf(jar)) === "in";
  const loggedOut = async (jar: Jar) => (await sessionOf(jar)) === "out";

  try {
    // ----------------------------------------------------------------------
    console.log("\n1. Sign up, confirm the email address, finish the welcome step");
    await freshLimits();
    {
      const a = { name: "Check One", email: address("one"), password: strongPassword() };
      const signUp = await api("/sign-up/email", { ...a, callbackURL: "/welcome" });
      check("sign-up is accepted", signUp.status === 200, String(signUp.status));
      check("signing up does not log you in", signUp.json?.token === null);
      const early = await api("/sign-in/email", { email: a.email, password: a.password, callbackURL: "/welcome" });
      check("cannot log in before confirming", early.status === 403 && early.json?.code === "EMAIL_NOT_VERIFIED", `${early.status} ${early.json?.code}`);
      check("the account is recorded as not confirmed", (await userByEmail(a.email))?.emailVerified === false);

      const mail = await email(a.email, "Confirm your email");
      check("a confirmation email was sent", Boolean(mail?.link));
      const link = new URL(mail!.link);
      const forged = new URL(link);
      forged.searchParams.set("token", `${link.searchParams.get("token")!.slice(0, -6)}abcdef`);
      const bad = await send(forged.toString(), { jar: new Map() });
      check("a tampered link confirms nothing", (bad.location ?? "").includes("error=") && (await userByEmail(a.email))?.emailVerified === false, bad.location ?? "");

      const jar: Jar = new Map();
      const good = await send(link.toString(), { jar });
      check("the real link confirms the address and logs in", (await userByEmail(a.email))?.emailVerified === true && (await loggedIn(jar)), good.location ?? "");
      check("and leads to the welcome step", (good.location ?? "").endsWith("/welcome"), good.location ?? "");

      const home = await send("/", { jar });
      const hosting = await send("/host", { jar });
      check("nothing else can be used before the welcome step is done", (home.location ?? "").includes("/welcome") && (hosting.location ?? "").includes("/welcome"), `${home.location} ${hosting.location}`);

      const row = await userByEmail(a.email);
      const now = new Date();
      await db.update(schema.user).set({ adultConfirmedAt: now, termsAcceptedAt: now, termsVersion: TERMS_VERSION, timeZone: "America/New_York" }).where(eq(schema.user.id, row.id));
      check("after the welcome step the app opens", (await send("/", { jar })).status === 200);
      const again = await api("/sign-in/email", { email: a.email, password: a.password }, new Map());
      check("and logging in with the password works", again.status === 200, String(again.status));

      console.log("   …someone signs up again with the same address");
      const other = strongPassword();
      const fresh = await api("/sign-up/email", { name: "Brand New", email: address("fresh"), password: strongPassword(), callbackURL: "/welcome" });
      const repeat = await api("/sign-up/email", { name: "Someone Else", email: a.email, password: other, callbackURL: "/welcome" });
      const shape = (r: Reply) => JSON.stringify([r.status, Object.keys(r.json ?? {}).sort(), Object.keys((r.json?.user as object) ?? {}).sort(), r.json?.token]);
      check("the answer looks the same as for a new address", shape(repeat) === shape(fresh), `${shape(repeat)} vs ${shape(fresh)}`);
      const rows = await db.select().from(schema.user).where(eq(schema.user.email, a.email));
      check("no second account, and the name is unchanged", rows.length === 1 && rows[0].name === a.name);
      check("the second password does not work", (await api("/sign-in/email", { email: a.email, password: other }, new Map())).status === 401);
      check("the first password still works", (await api("/sign-in/email", { email: a.email, password: a.password }, new Map())).status === 200);
      check("the owner of the address is told by email", Boolean(await email(a.email, "already have")));

      console.log("   …a password that is too short, or known from a leak");
      const short = await api("/sign-up/email", { name: "Short", email: address("short"), password: "abc123" });
      const leaked = await api("/sign-up/email", { name: "Leaked", email: address("leaked"), password: "password1234" });
      check("a short password is refused", short.status === 400 && short.json?.code === "PASSWORD_TOO_SHORT", `${short.status} ${short.json?.code}`);
      check("a leaked password is refused", leaked.status === 400 && leaked.json?.code === "PASSWORD_COMPROMISED", `${leaked.status} ${leaked.json?.code}`);
      check("neither created an account", !(await userByEmail(address("short"))) && !(await userByEmail(address("leaked"))));
    }

    // ----------------------------------------------------------------------
    console.log("\n2. Forgotten password");
    await freshLimits();
    {
      const p = await newPerson("reset");
      const secondDevice: Jar = new Map();
      await api("/sign-in/email", { email: p.email, password: p.password }, secondDevice);
      check("logged in on two devices", (await loggedIn(p.jar)) && (await loggedIn(secondDevice)));

      const unknown = await api("/request-password-reset", { email: address("nobody"), redirectTo: "/reset-password" });
      const known = await api("/request-password-reset", { email: p.email, redirectTo: "/reset-password" });
      check("the answer is the same whether or not the address has an account", unknown.status === 200 && unknown.text === known.text, `${unknown.text} vs ${known.text}`);
      check("no email goes to an address without an account", !(await db.select().from(schema.emailOutbox).where(eq(schema.emailOutbox.to, address("nobody"))))[0]);

      const mail = await email(p.email, "Reset your");
      check("a reset email was sent", Boolean(mail?.link));
      const landing = await send(mail!.link);
      const token = new URL(landing.location ?? "", BASE).searchParams.get("token") ?? "";
      check("the link leads to the new-password page with a one-time token", (landing.location ?? "").includes("/reset-password") && token.length > 10, landing.location ?? "");

      const leaked = await api("/reset-password", { newPassword: "password1234", token });
      check("a leaked password is refused here too", leaked.status === 400 && leaked.json?.code === "PASSWORD_COMPROMISED", `${leaked.status} ${leaked.json?.code}`);
      const next = strongPassword();
      const done = await api("/reset-password", { newPassword: next, token });
      check("the new password is saved", done.status === 200, String(done.status));
      check("every device is logged out", (await loggedOut(p.jar)) && (await loggedOut(secondDevice)));
      check("the old password no longer works", (await api("/sign-in/email", { email: p.email, password: p.password }, new Map())).status === 401);
      check("the new one does", (await api("/sign-in/email", { email: p.email, password: next }, new Map())).status === 200);
      const reuse = await api("/reset-password", { newPassword: strongPassword(), token });
      check("the link cannot be used a second time", reuse.status === 400, String(reuse.status));

      console.log("   …someone else registered your address first, with their own password, and never confirmed it");
      const yours = address("yours");
      const theirPassword = strongPassword();
      await api("/sign-up/email", { name: "Somebody Else", email: yours, password: theirPassword });
      // You cannot sign up (the address is taken), so you use "Forgot password", which only the owner of the address can finish.
      await api("/request-password-reset", { email: yours, redirectTo: "/reset-password" });
      const resetMail = await email(yours, "Reset your");
      const yourToken = new URL((await send(resetMail!.link)).location ?? "", BASE).searchParams.get("token") ?? "";
      const yourPassword = strongPassword();
      check("the owner of the address can set their own password", (await api("/reset-password", { newPassword: yourPassword, token: yourToken })).status === 200);
      check("the other person's password no longer works", (await api("/sign-in/email", { email: yours, password: theirPassword }, new Map())).status === 401);
      const yourJar: Jar = new Map();
      const first = await api("/sign-in/email", { email: yours, password: yourPassword, callbackURL: "/welcome" }, yourJar);
      if (first.status === 403) {
        // The address still has to be confirmed; logging in sent the link.
        await pause(300);
        const confirm = await email(yours, "Confirm your email");
        await send(confirm!.link, { jar: yourJar });
      }
      check("the owner ends up logged in, with the address confirmed", (await loggedIn(yourJar)) && (await userByEmail(yours))?.emailVerified === true, String(first.status));
      check("and the other person is still locked out", (await api("/sign-in/email", { email: yours, password: theirPassword }, new Map())).status === 401);
    }

    // ----------------------------------------------------------------------
    console.log("\n3. Changing the password logs out every other device");
    await freshLimits();
    {
      const p = await newPerson("change");
      const other: Jar = new Map();
      await api("/sign-in/email", { email: p.email, password: p.password }, other);
      const wrong = await api("/change-password", { currentPassword: "not-my-password", newPassword: strongPassword() }, p.jar);
      check("the current password is needed", wrong.status === 400, String(wrong.status));
      // The browser asks to keep the other devices logged in. The server must not listen.
      const changed = await api("/change-password", { currentPassword: p.password, newPassword: strongPassword(), revokeOtherSessions: false }, p.jar);
      check("the password is changed", changed.status === 200, String(changed.status));
      check("this device stays logged in", await loggedIn(p.jar));
      check("the other device is logged out, whatever the browser asked", await loggedOut(other));
    }

    // ----------------------------------------------------------------------
    console.log("\n4. Repeated attempts are slowed down");
    await freshLimits();
    {
      const statuses: number[] = [];
      for (let i = 0; i < 7; i++) statuses.push((await api("/request-password-reset", { email: address(`flood${i}`), redirectTo: "/reset-password" })).status);
      check("the sixth request for reset emails in an hour is refused", statuses.slice(0, 5).every((s) => s === 200) && statuses[5] === 429 && statuses[6] === 429, statuses.join(" "));
      await freshLimits();

      const max = EMAIL_LIMITS.confirm.max;
      const target = address("mailbox");
      for (let i = 0; i < max + 3; i++) await sendEmail({ to: target, kind: "confirm", subject: `Check ${i}`, text: "check" });
      const sentTo = async (to: string, kind: string) =>
        (await db.select().from(schema.emailOutbox).where(and(eq(schema.emailOutbox.to, to), eq(schema.emailOutbox.kind, kind)))).length;
      check(`one address gets at most ${max} confirmation emails an hour, whoever asks`, (await sentTo(target, "confirm")) === max, String(await sentTo(target, "confirm")));
      const burst = address("burst");
      await Promise.all(Array.from({ length: 12 }, (_, i) => sendEmail({ to: burst, kind: "confirm", subject: `Burst ${i}`, text: "check" })));
      check("also when many are asked for at the same moment", (await sentTo(burst, "confirm")) === max, String(await sentTo(burst, "confirm")));

      // Someone "signs up" with a known address again and again to flood it and use up its allowance.
      for (let i = 0; i < 6; i++) await sendEmail({ to: target, kind: "notice", subject: "You already have an account", text: "check" });
      check("the \"you already have an account\" notice goes out at most once a day", (await sentTo(target, "notice")) === EMAIL_LIMITS.notice.max, String(await sentTo(target, "notice")));
      await sendEmail({ to: target, kind: "reset", subject: "Reset", text: "check" });
      check("and none of that uses up the owner's password-reset emails", (await sentTo(target, "reset")) === 1);
    }

    // ----------------------------------------------------------------------
    console.log("\n5. Host profiles and handles");
    await freshLimits();
    const refused = async (work: Promise<unknown>) => (await work.then(() => null).catch((e) => e)) instanceof ProfileError;
    const handle = `chk_${RUN}`;
    const page = (h: string) => send(`/h/${h}`);
    /** Approves a profile the way the admin page does: naming what was on screen. */
    const approve = async (userId: string) => {
      const [seen] = await db.select().from(schema.hostProfiles).where(eq(schema.hostProfiles.userId, userId));
      await profiles.decideProfile({ userId, decision: "approved", by: userId, seen: { displayName: seen.displayName, about: seen.about } });
    };
    const host = await newPerson("host");
    const copycat = await newPerson("copycat");
    // Approval needs a passed identity check (safety module); test people get one directly.
    const passId = (person: { id: string; name: string }) =>
      db.insert(schema.identityChecks).values({ userId: person.id, stripeSessionId: `vs_acct_${randomUUID()}`, status: "verified", adult: true, verifiedName: person.name, checkedAt: new Date() });
    await passId(host);
    // Approval also needs one confirmed social media account; this writes one as the founder's "confirm" would leave it.
    const prove = (userId: string, network: string, nameKey: string) =>
      db.insert(schema.socialAccounts).values({ userId, network, nameTyped: nameKey, nameKey, url: `https://example.test/${network}/${nameKey}`, code: `connect-${randomUUID().slice(0, 10)}`, codeExpiresAt: new Date(Date.now() + 86_400_000), claimedAt: new Date(), confirmedAt: new Date() });
    const refusedWith = async (work: Promise<unknown>, words: string) => {
      const problem = await work.then(() => null).catch((e) => e);
      return problem instanceof ProfileError && problem.message.includes(words);
    };
    {
      const details = { displayName: "Check Host", about: "Testing only.", pricePer15Cents: 2000, country: "US", languages: ["en"] };
      check("a blocked handle is refused", await refused(profiles.createHostProfile(host.id, { ...details, handle: "admin" })));
      check("a blocked handle with underscores is refused", await refused(profiles.createHostProfile(host.id, { ...details, handle: "sup_port" })));
      check("a handle with other alphabets is refused", await refused(profiles.createHostProfile(host.id, { ...details, handle: "jаne_doe" })));
      check("a price under $5 is refused", await refused(profiles.createHostProfile(host.id, { ...details, handle, pricePer15Cents: 300 })));
      // Where a host can be based: only the countries Connect can pay in (plans/27-hosts-abroad.md). Never guessed.
      check("a host in a country that cannot be paid (Australia) is refused", await refused(profiles.createHostProfile(host.id, { ...details, handle, country: "AU" })));
      check("so is a host who gives no country, or one that is not written as its two capital letters", (await refused(profiles.createHostProfile(host.id, { ...details, handle, country: "" }))) && (await refused(profiles.createHostProfile(host.id, { ...details, handle, country: "gb" }))) && (await refused(profiles.createHostProfile(host.id, { ...details, handle, country: "United Kingdom" }))));

      // The languages a host can hold a call in (plans/34-host-languages.md): one to five, from the list. Never guessed, never trimmed.
      const six = ["en", "es", "fr", "de", "it", "pt"];
      check("a host who ticks no language is refused", await refusedWith(profiles.createHostProfile(host.id, { ...details, handle, languages: [] }), "at least one language"));
      check("so is one who ticks six", await refusedWith(profiles.createHostProfile(host.id, { ...details, handle, languages: six }), "at most 5 languages"));
      check("and one who sends a language that is not in the list, also beside a good one", await refusedWith(profiles.createHostProfile(host.id, { ...details, handle, languages: ["en", "klingon"] }), "from the list"));
      check("none of the three wrote a profile", (await db.select().from(schema.hostProfiles).where(eq(schema.hostProfiles.userId, host.id))).length === 0);

      await profiles.createHostProfile(host.id, { ...details, handle: `  @${handle.toUpperCase()} ` });
      const [made] =await db.select().from(schema.hostProfiles).where(eq(schema.hostProfiles.userId, host.id));
      check("the profile is saved, waiting for approval", made?.handle === handle && made.status === "pending", `${made?.handle} ${made?.status}`);
      const abroad = await newPerson("abroad");
      await profiles.createHostProfile(abroad.id, { ...details, handle: `uk_${RUN}`, country: "GB", languages: ["cy", "en", "cy"] });
      const [madeAbroad] = await db.select().from(schema.hostProfiles).where(eq(schema.hostProfiles.userId, abroad.id));
      check("each profile keeps the languages its host ticked: each once, in the list's order", made?.languages.join() === "en" && madeAbroad?.languages.join() === "en,cy", `${made?.languages} / ${madeAbroad?.languages}`);
      check("a host in the United Kingdom is accepted, and each profile keeps the country its host gave", madeAbroad?.country === "GB" && made?.country === "US" && madeAbroad.usConfirmedAt !== null, `${madeAbroad?.country} ${made?.country}`);
      check("one profile per account", await refused(profiles.createHostProfile(host.id, { ...details, handle: `${handle}_two` })));

      check("the same handle cannot be taken twice", await refused(profiles.createHostProfile(copycat.id, { ...details, handle })));
      check("nor a look-alike that differs only by underscores", await refused(profiles.createHostProfile(copycat.id, { ...details, handle: handle.replace("_", "") })));

      const racerA = await newPerson("racer-a");
      const racerB = await newPerson("racer-b");
      const raced = await Promise.allSettled([
        profiles.createHostProfile(racerA.id, { ...details, handle: `race_${RUN}` }),
        profiles.createHostProfile(racerB.id, { ...details, handle: `race${RUN}` }),
      ]);
      check("two people grabbing look-alike handles at the same moment: exactly one gets it", raced.filter((r) => r.status === "fulfilled").length === 1);

      check("not public while waiting for approval", (await page(handle)).status === 404);
      check("with the ID check passed but no confirmed social media account, it cannot be approved", (await refusedWith(approve(host.id), "no confirmed social media account")) && (await page(handle)).status === 404);
      await prove(host.id, "youtube", `chk-yt-${RUN}`);
      await approve(host.id);
      const shown = await page(handle);
      check("public once approved, without logging in", shown.status === 200 && shown.text.includes("Check Host"), String(shown.status));
      check("the page never shows the email address", !shown.text.includes(host.email));
      check("capital letters in the address still find it", (await page(handle.toUpperCase())).status === 200);

      await profiles.setProfileHidden(host.id, true);
      check("hidden by the host: not found", (await page(handle)).status === 404);
      await profiles.setProfileHidden(host.id, false);

      await profiles.updateHostProfile(host.id, { displayName: "Check Host", about: "A new about text.", pricePer15Cents: 2500, languages: ["en"] });
      check("editing the about text and price keeps it public", (await page(handle)).status === 200);

      // Languages: changing them is saved at once and needs no new approval; a refused save changes nothing.
      const edit = (languages: string[]) => profiles.updateHostProfile(host.id, { displayName: "Check Host", about: "A new about text.", pricePer15Cents: 2500, languages });
      const savedLanguages = async (userId: string) => (await db.select({ languages: schema.hostProfiles.languages }).from(schema.hostProfiles).where(eq(schema.hostProfiles.userId, userId)))[0]?.languages.join();
      await edit(["es", "en"]);
      const withLanguages = await page(handle);
      check("changing the languages saves them, and the approved page stays public", (await savedLanguages(host.id)) === "en,es" && withLanguages.status === 200, await savedLanguages(host.id));
      check("the page names them", withLanguages.text.includes("Languages: English, Spanish"));
      // Each refusal is its own check, in its own words, and each is followed by a look at what is saved.
      for (const [label, languages, words] of [
        ["saving with no language is refused, and what was saved stays", [], "at least one language"],
        ["so is saving with six", six, "at most 5 languages"],
        ["and saving with one that is not in the list", ["es", "klingon"], "from the list"],
      ] as const) {
        const refusedInItsWords = await refusedWith(edit([...languages]), words);
        check(label, refusedInItsWords && (await savedLanguages(host.id)) === "en,es", await savedLanguages(host.id));
      }
      const { searchHosts } = await import("../src/lib/profiles/search");
      const found = await searchHosts(handle, null, new Date());
      check("the public reader and the search give the host's languages", (await profiles.publicProfile(handle))?.languages.join() === "en,es" && found.find((h) => h.handle === handle)?.languages.join() === "en,es");
      // A host from before languages existed, and every host a script writes straight into the database: no languages.
      const earlier = await newPerson("earlier");
      const earlierHandle = `old_${RUN}`;
      await db.insert(schema.hostProfiles).values({ userId: earlier.id, handle: earlierHandle, handleKey: earlierHandle.replace(/_/g, ""), displayName: "Check Earlier", pricePer15Cents: 0, status: "approved", usConfirmedAt: new Date() });
      const earlierPage = await page(earlierHandle);
      const earlierFound = (await searchHosts(earlierHandle, null, new Date())).find((h) => h.handle === earlierHandle);
      check(
        "a host written without languages has none, and is still found and shown, with no line about languages",
        (await savedLanguages(earlier.id)) === "" && (await profiles.publicProfile(earlierHandle))?.languages.length === 0 && earlierFound?.languages.length === 0 && earlierPage.status === 200 && !earlierPage.text.includes("Languages:"),
        `${earlierPage.status} ${JSON.stringify(earlierFound?.languages)}`,
      );
      await profiles.updateHostProfile(host.id, { displayName: "A Famous Person", about: "A new about text.", pricePer15Cents: 2500, languages: ["en"] });
      check("a new display name must be approved again", (await page(handle)).status === 404);
      const stale = profiles.decideProfile({ userId: host.id, decision: "approved", by: host.id, seen: { displayName: "Check Host", about: "A new about text." } });
      check("approving the old name (an admin page left open) does not approve the new one", (await refused(stale)) && (await page(handle)).status === 404);
      await approve(host.id);

      await profiles.decideProfile({ userId: host.id, decision: "suspended", by: host.id });
      await profiles.updateHostProfile(host.id, { displayName: "Check Host", about: "", pricePer15Cents: 2500, languages: ["en"] });
      await profiles.setProfileHidden(host.id, false);
      check("suspended: not found, and the host cannot undo it", (await page(handle)).status === 404);
      await approve(host.id);

      check("a handle nobody has: not found", (await page(`nobody_${RUN}`)).status === 404);
    }

    // ----------------------------------------------------------------------
    console.log("\n6. Social media names");
    await freshLimits();
    {
      const name = `chk.${RUN}`;
      const claim = async (userId: string) =>
        (await db.select().from(schema.socialAccounts).where(and(eq(schema.socialAccounts.userId, userId), eq(schema.socialAccounts.network, "instagram"))))[0];

      check("a link to another site is refused", await refused(profiles.addSocialName(host.id, "instagram", "https://evil.example/someone")));
      await profiles.addSocialName(host.id, "instagram", `https://www.instagram.com/${name.toUpperCase()}/?hl=en`);
      const first = await claim(host.id);
      check("the name is cleaned up and the link is our own", first.nameKey === name && first.url === `https://www.instagram.com/${name}/`, `${first.nameKey} ${first.url}`);
      check("a code is given", /^connect-[a-z0-9]{10}$/.test(first.code));
      check("not shown publicly before it is confirmed", !(await page(handle)).text.includes(first.url));
      check("cannot be confirmed before the host says the code is in place", await refused(profiles.confirmSocialName({ id: first.id, nameKey: name, code: first.code, by: host.id })));

      await profiles.markSocialNameReady(host.id, first.id);
      check("cannot be confirmed under a different name than the one checked", await refused(profiles.confirmSocialName({ id: first.id, nameKey: "someone.else", code: first.code, by: host.id })));
      check("nor with a code other than the one checked", await refused(profiles.confirmSocialName({ id: first.id, nameKey: name, code: "connect-aaaaaaaaaa", by: host.id })));

      // A second host claims the same name before anyone is confirmed.
      const rival = await newPerson("rival");
      await profiles.createHostProfile(rival.id, { handle: `rival_${RUN}`, displayName: "Check Rival", about: "", pricePer15Cents: 0, country: "US", languages: ["en"] });
      await profiles.addSocialName(rival.id, "instagram", name);
      const second = await claim(rival.id);
      await profiles.markSocialNameReady(rival.id, second.id);
      check("each host gets a different code", second.code !== first.code);

      await profiles.confirmSocialName({ id: first.id, nameKey: name, code: first.code, by: host.id });
      const shown = await page(handle);
      check("once confirmed it is shown publicly", shown.text.includes(first.url) && shown.text.includes("account confirmed"));
      check("the same name cannot be confirmed for a second host", await refused(profiles.confirmSocialName({ id: second.id, nameKey: name, code: second.code, by: host.id })));
      check("nor claimed afresh by anyone else", await refused(profiles.addSocialName(copycat.id, "instagram", name)));

      await profiles.addSocialName(host.id, "instagram", `other.${RUN}`);
      const changed = await claim(host.id);
      check("changing the name starts the proof again", changed.confirmedAt === null && changed.claimedAt === null && changed.code !== first.code);
      check("and the old name is no longer shown", !(await page(handle)).text.includes(first.url));

      await profiles.markSocialNameReady(host.id, changed.id);
      await db.update(schema.socialAccounts).set({ codeExpiresAt: new Date(Date.now() - 1000) }).where(eq(schema.socialAccounts.id, changed.id));
      check("a code that has run out cannot be confirmed, even from an admin page left open", await refused(profiles.confirmSocialName({ id: changed.id, nameKey: changed.nameKey, code: changed.code, by: host.id })));
      await db.update(schema.socialAccounts).set({ claimedAt: null }).where(eq(schema.socialAccounts.id, changed.id));
      check("a code that has run out cannot be used", await refused(profiles.markSocialNameReady(host.id, changed.id)));
      check("a link to a post is not taken for an account", await refused(profiles.addSocialName(copycat.id, "instagram", "https://www.instagram.com/p/Cabc123/")));
      check("saying \"the code is not there\" for an old request does not touch the new one", await refused(profiles.rejectSocialName({ id: changed.id, nameKey: name, code: first.code })));
    }

    // ----------------------------------------------------------------------
    console.log("\n6b. One confirmed account, before approval and after");
    await freshLimits();
    {
      const LAST = "needs one confirmed account";
      const statusOf = async (userId: string) => (await db.select().from(schema.hostProfiles).where(eq(schema.hostProfiles.userId, userId)))[0].status;
      const accounts = (userId: string) => db.select().from(schema.socialAccounts).where(eq(schema.socialAccounts.userId, userId)).orderBy(schema.socialAccounts.network);
      const confirmedOf = async (userId: string) => (await accounts(userId)).filter((a) => a.confirmedAt !== null);
      const newHost = async (label: string) => {
        const person = await newPerson(label);
        await profiles.createHostProfile(person.id, { handle: `${label}_${RUN}`, displayName: `Check ${label}`, about: "", pricePer15Cents: 0, country: "US", languages: ["en"] });
        return person;
      };

      const accountOnly = await newHost("acct");
      await prove(accountOnly.id, "youtube", `acct-${RUN}`);
      check("a confirmed account but no ID check: cannot be approved", (await refusedWith(approve(accountOnly.id), "identity check")) && (await statusOf(accountOnly.id)) === "pending");

      const ana = await newHost("ana");
      await passId(ana);
      await profiles.addSocialName(ana.id, "tiktok", `wait.${RUN}`);
      const [waitingClaim] = await accounts(ana.id);
      await profiles.markSocialNameReady(ana.id, waitingClaim.id);
      check("an account that is waiting to be confirmed does not count", (await refusedWith(approve(ana.id), "no confirmed social media account")) && (await statusOf(ana.id)) === "pending");
      await profiles.confirmSocialName({ id: waitingClaim.id, nameKey: waitingClaim.nameKey, code: waitingClaim.code, by: host.id });
      await approve(ana.id);
      check("once the founder has confirmed it, the profile can be approved", (await statusOf(ana.id)) === "approved");

      check("an approved host cannot remove their last confirmed account, and is told why", (await refusedWith(profiles.removeSocialName(ana.id, waitingClaim.id), LAST)) && (await confirmedOf(ana.id)).length === 1);
      check("nor give it a different name, which would start the proof again", (await refusedWith(profiles.addSocialName(ana.id, "tiktok", `other.${RUN}`), LAST)) && (await confirmedOf(ana.id))[0]?.nameKey === `wait.${RUN}`);
      await profiles.addSocialName(ana.id, "tiktok", `@WAIT.${RUN}`);
      check("typing the same name again changes nothing", (await confirmedOf(ana.id)).length === 1);
      await profiles.addSocialName(ana.id, "x", `x${RUN}`);
      const pendingX = (await accounts(ana.id)).find((a) => a.network === "x")!;
      await profiles.removeSocialName(ana.id, pendingX.id);
      check("an account that is not confirmed can always be removed", (await accounts(ana.id)).length === 1);
      await profiles.removeSocialName(ana.id, randomUUID());
      await profiles.removeSocialName(host.id, waitingClaim.id);
      check("removing an account that is not there, or someone else's, changes nothing", (await confirmedOf(ana.id)).length === 1);

      await prove(ana.id, "youtube", `ana-${RUN}`);
      const two = await confirmedOf(ana.id);
      const both = await Promise.allSettled(two.map((a) => profiles.removeSocialName(ana.id, a.id)));
      const refusedAsLast = (r: PromiseSettledResult<unknown>) => r.status === "rejected" && r.reason instanceof ProfileError && r.reason.message.includes(LAST);
      check("with two confirmed accounts, two removals at the same moment: one goes, one is refused as the last one", both.filter((r) => r.status === "fulfilled").length === 1 && both.filter(refusedAsLast).length === 1 && (await confirmedOf(ana.id)).length === 1, both.map((r) => r.status).join(" "));

      await prove(ana.id, "x", `x2${RUN}`);
      const [toReplace] = await confirmedOf(ana.id);
      await profiles.addSocialName(ana.id, toReplace.network, `fresh.${RUN}`.replace(/\./g, toReplace.network === "x" ? "_" : "."));
      check("with two confirmed accounts, one can be given a new name", (await confirmedOf(ana.id)).length === 1 && (await accounts(ana.id)).length === 2);

      await profiles.decideProfile({ userId: ana.id, decision: "declined", by: host.id });
      const [lastOne] = await confirmedOf(ana.id);
      await profiles.removeSocialName(ana.id, lastOne.id);
      check("a host who is not approved can remove their last confirmed account", (await confirmedOf(ana.id)).length === 0);
      check("and then cannot be approved again, also from the list of other profiles", (await refusedWith(approve(ana.id), "no confirmed social media account")) && (await statusOf(ana.id)) === "declined");

      // An approval and the removal of the only confirmed account at the same moment, several times over.
      // Whichever gets there first wins, and the other is refused for exactly that reason. (Which one is
      // first is left to chance here; the rule itself is that both wait for the same locks.)
      const outcomes: string[] = [];
      for (let round = 0; round < 4; round++) {
        const racer = await newHost(`race${round}`);
        await passId(racer);
        await prove(racer.id, "youtube", `race${round}-${RUN}`);
        const [only] = await confirmedOf(racer.id);
        const [approval, removal] = await Promise.allSettled([approve(racer.id), profiles.removeSocialName(racer.id, only.id)]);
        const because = (r: PromiseSettledResult<unknown>, words: string) => r.status === "rejected" && r.reason instanceof ProfileError && r.reason.message.includes(words);
        const status = await statusOf(racer.id);
        const left = (await confirmedOf(racer.id)).length;
        if (approval.status === "fulfilled" && because(removal, LAST) && status === "approved" && left === 1) outcomes.push("approved, the account kept");
        else if (removal.status === "fulfilled" && because(approval, "no confirmed social media account") && status === "pending" && left === 0) outcomes.push("removed, not approved");
        else outcomes.push(`UNEXPECTED ${approval.status} ${removal.status} ${status} ${left}`);
      }
      check("an approval and a removal at the same moment: one wins, the other is refused for that reason, and no approved host is left without an account", outcomes.every((o) => !o.startsWith("UNEXPECTED")), outcomes.join("; "));
      // Adding an account on another network while the founder approves: both go through (this deadlocked before the person's row was locked the gentler way).
      const adder = await newHost("adder");
      await passId(adder);
      await prove(adder.id, "youtube", `adder-${RUN}`);
      const together = await Promise.allSettled([approve(adder.id), profiles.addSocialName(adder.id, "tiktok", `adder.${RUN}`), profiles.addSocialName(adder.id, "x", `ad${RUN}`)]);
      check("adding accounts while the founder approves: all go through", together.every((r) => r.status === "fulfilled") && (await statusOf(adder.id)) === "approved" && (await accounts(adder.id)).length === 3, together.map((r) => r.status).join(" "));
    }
    // ----------------------------------------------------------------------
    console.log("\n6c. Connect looks at the bio itself (Instagram and YouTube)");
    await freshLimits();
    {
      // The networks' answers, the settings and the time are pretended here. Nothing is asked of Meta or Google.
      const AUTO: BioSettings = { instagram: { token: "pretend", accountId: "17841400000000000" }, youtube: { key: "pretend" } };
      let asked = 0;
      const answering = (answer: BioAnswer | (() => BioAnswer)) => async () => {
        asked++;
        return typeof answer === "function" ? answer() : answer;
      };
      let time = Date.now();
      const clock = () => new Date(time);
      const later = (seconds = 31) => (time += seconds * 1000);
      const ready = (userId: string, id: string, read: () => Promise<BioAnswer>, settings: BioSettings = AUTO) =>
        profiles.socialNameReady(userId, id, { read, settings, clock }).then((r) => r.outcome);
      const entryOf = async (userId: string, network: string) =>
        (await db.select().from(schema.socialAccounts).where(and(eq(schema.socialAccounts.userId, userId), eq(schema.socialAccounts.network, network))))[0];
      const onFoundersList = async (userId: string) =>
        (await db.select().from(schema.socialAccounts).where(eq(schema.socialAccounts.userId, userId))).filter((a) => a.claimedAt !== null && a.confirmedAt === null && a.codeExpiresAt > new Date()).length;
      const checksOf = (userId: string) => db.select().from(schema.bioChecks).where(eq(schema.bioChecks.userId, userId)).orderBy(schema.bioChecks.startedAt);
      const newHost = async (label: string) => {
        const person = await newPerson(label);
        await profiles.createHostProfile(person.id, { handle: `${label}_${RUN}`, displayName: `Check ${label}`, about: "", pricePer15Cents: 0, country: "US", languages: ["en"] });
        return person;
      };
      /** An answer that is held back until the script lets it go, to do something while a check is under way. */
      const heldBack = () => {
        let release!: (answer: BioAnswer) => void;
        let started!: () => void;
        const answer = new Promise<BioAnswer>((resolve) => (release = resolve));
        const underWay = new Promise<void>((resolve) => (started = resolve));
        return { read: async () => (asked++, started(), answer), release, underWay };
      };
      /** Waits until a held-back check is really asking. Fails at once if the check ended without asking (a limit, say). */
      const whenAsking = (held: ReturnType<typeof heldBack>, running: Promise<string>) =>
        Promise.race([held.underWay, running.then((outcome) => Promise.reject(new Error(`the check ended before anything was asked: ${outcome}`)))]);

      // Not found, then found.
      const bea = await newHost("bea");
      await passId(bea);
      await profiles.addSocialName(bea.id, "instagram", `bea.${RUN}`);
      const beaEntry = await entryOf(bea.id, "instagram");
      check("the code is not in the bio yet: not found, nothing confirmed, the code unchanged", (await ready(bea.id, beaEntry.id, answering({ kind: "bio", text: "Dancer. No code here." }))) === "not_found" && (await entryOf(bea.id, "instagram")).confirmedAt === null && (await entryOf(bea.id, "instagram")).code === beaEntry.code && asked === 1);
      check("a second check within 30 seconds asks nobody", (await ready(bea.id, beaEntry.id, answering({ kind: "bio", text: beaEntry.code }))) === "too_soon" && asked === 1 && (await entryOf(bea.id, "instagram")).confirmedAt === null);
      check("someone else cannot have this entry checked", (await refused(profiles.socialNameReady(host.id, beaEntry.id, { read: answering({ kind: "bio", text: beaEntry.code }), settings: AUTO, clock }))) && asked === 1);
      later();
      check("the code is in the bio (in capitals, between other words): confirmed at once", (await ready(bea.id, beaEntry.id, answering({ kind: "bio", text: `Dancer ✨ ${beaEntry.code.toUpperCase()} ✨ bookings below` }))) === "confirmed" && asked === 2);
      const beaDone = await entryOf(bea.id, "instagram");
      check("confirmed by Connect, not by a person, and never on the founder's list", beaDone.confirmedAt !== null && beaDone.confirmedBy === null && beaDone.claimedAt === null && (await onFoundersList(bea.id)) === 0);
      check("each check is noted with how it ended, never with the bio's text", (await checksOf(bea.id)).map((c) => c.result).join(",") === "not_found,found" && Object.keys((await checksOf(bea.id))[0]).sort().join(",") === "id,network,result,startedAt,userId");
      await approve(bea.id);
      check("a host whose only account was confirmed this way can be approved, and then cannot remove it", (await db.select().from(schema.hostProfiles).where(eq(schema.hostProfiles.userId, bea.id)))[0].status === "approved" && (await refusedWith(profiles.removeSocialName(bea.id, beaDone.id), "needs one confirmed account")));
      later();
      check("a confirmed account is not checked again", (await ready(bea.id, beaDone.id, answering({ kind: "bio", text: "" }))) === "gone" && asked === 2);

      // Every way it can fail: its own answer, and nothing confirmed.
      const cal = await newHost("cal");
      await profiles.addSocialName(cal.id, "youtube", `@cal-${RUN}`);
      const calEntry = await entryOf(cal.id, "youtube");
      const refusedCount = async (network: string) => (await profiles.refusedBioChecks(clock())).find((r) => r.network === network)?.count ?? 0;
      const refusedBefore = await refusedCount("youtube");
      const failures: Array<[string, () => Promise<BioAnswer>, string]> = [
        ["no account of that name", answering({ kind: "no_account" }), "no_account"],
        ["asked too often", answering({ kind: "too_often", code: 403 }), "unavailable"],
        ["our key was refused", answering({ kind: "refused", code: 400 }), "unavailable"],
        ["not available", answering({ kind: "unavailable" }), "unavailable"],
        ["the request breaks", answering(() => { throw new Error("boom"); }), "unavailable"],
      ];
      const got: string[] = [];
      for (const [, read] of failures) {
        later();
        got.push(await ready(cal.id, calEntry.id, read));
      }
      const calAfter = await entryOf(cal.id, "youtube");
      check("no account, asked too often, key refused, not available, a broken request: each its own answer, nothing confirmed", got.join(",") === failures.map((f) => f[2]).join(",") && calAfter.confirmedAt === null && calAfter.code === calEntry.code && calAfter.claimedAt === null, got.join(","));
      check("and each is noted for what it was", (await checksOf(cal.id)).map((c) => c.result).join(",") === "no_account,too_often,refused,unavailable,unavailable");
      // Counted from this person's own rows, so that whatever else is in the table does not matter.
      const calRefused = (await checksOf(cal.id)).filter((c) => c.result === "refused");
      check("a refused key shows up for the founder's page: once, for the right network, and not the host's own mistakes", calRefused.length === 1 && calRefused[0].network === "youtube" && (await refusedCount("youtube")) >= refusedBefore + 1);

      // The limits.
      const before = asked;
      for (let i = 0; i < profiles.BIO_CHECKS_PER_HOUR - failures.length; i++) {
        later();
        await ready(cal.id, calEntry.id, answering({ kind: "bio", text: "" }));
      }
      later();
      check("after 10 checks in an hour, the next one asks nobody", asked === before + profiles.BIO_CHECKS_PER_HOUR - failures.length && (await ready(cal.id, calEntry.id, answering({ kind: "bio", text: calEntry.code }))) === "limit" && asked === before + profiles.BIO_CHECKS_PER_HOUR - failures.length);
      await profiles.removeSocialName(cal.id, calEntry.id);
      await profiles.addSocialName(cal.id, "youtube", `@cal-${RUN}`);
      await profiles.addSocialName(cal.id, "instagram", `cal.${RUN}`);
      later();
      const calAgain = await entryOf(cal.id, "youtube");
      const askedAtLimit = asked;
      check("removing the entry and adding it again, or using the other network, does not get around that", (await ready(cal.id, calAgain.id, answering({ kind: "bio", text: calAgain.code }))) === "limit" && (await ready(cal.id, (await entryOf(cal.id, "instagram")).id, answering({ kind: "bio", text: "" }))) === "limit" && asked === askedAtLimit);

      const dan = await newHost("dan");
      await profiles.addSocialName(dan.id, "instagram", `dan.${RUN}`);
      const danEntry = await entryOf(dan.id, "instagram");
      const askedBeforeMany = asked;
      const many = await Promise.all(Array.from({ length: 6 }, () => ready(dan.id, danEntry.id, answering({ kind: "bio", text: "" }))));
      check("six presses at the same moment make one request", asked === askedBeforeMany + 1 && many.filter((o) => o === "not_found").length === 1 && many.filter((o) => o === "too_soon").length === 5, many.join(" "));

      // All of Instagram together.
      const eve = await newHost("eve");
      await profiles.addSocialName(eve.id, "instagram", `eve.${RUN}`);
      await profiles.addSocialName(eve.id, "youtube", `@eve-${RUN}`);
      const filler = await db.insert(schema.bioChecks).values(Array.from({ length: profiles.INSTAGRAM_CHECKS_PER_HOUR }, () => ({ userId: dan.id, network: "instagram", startedAt: clock(), result: "not_found" }))).returning({ id: schema.bioChecks.id });
      const askedBeforeBusy = asked;
      check("when everyone together has used the hour's Instagram checks, nobody is asked", (await ready(eve.id, (await entryOf(eve.id, "instagram")).id, answering({ kind: "bio", text: "" }))) === "busy" && asked === askedBeforeBusy);
      check("YouTube is not held up by that", (await ready(eve.id, (await entryOf(eve.id, "youtube")).id, answering({ kind: "bio", text: (await entryOf(eve.id, "youtube")).code }))) === "confirmed");
      await db.delete(schema.bioChecks).where(inArray(schema.bioChecks.id, filler.map((f) => f.id)));

      // Things that happen while a check is under way.
      const fay = await newHost("fay");
      let round = 0;
      const during = async (label: string, meanwhile: (entry: Awaited<ReturnType<typeof entryOf>>) => Promise<unknown>, expected: string, then: (entry: Awaited<ReturnType<typeof entryOf>> | undefined) => boolean) => {
        later();
        await profiles.addSocialName(fay.id, "instagram", `fay${++round}.${RUN}`);
        const entry = await entryOf(fay.id, "instagram");
        const held = heldBack();
        const running = ready(fay.id, entry.id, held.read);
        let outcome: string;
        try {
          await whenAsking(held, running);
          await meanwhile(entry);
        } finally {
          // Whatever happened, the held-back answer is let go, so nothing is left waiting.
          held.release({ kind: "bio", text: `my bio ${entry.code}` });
          outcome = await running;
        }
        const after = await entryOf(fay.id, "instagram");
        check(label, outcome === expected && then(after), `${outcome}, confirmed: ${Boolean(after?.confirmedAt)}`);
        if (after) await db.delete(schema.socialAccounts).where(eq(schema.socialAccounts.id, after.id));
      };
      await during("while a check is under way the host gives the entry another name: nothing is confirmed", () => profiles.addSocialName(fay.id, "instagram", `fay.other.${RUN}`), "gone", (after) => after?.confirmedAt === null && after.nameKey === `fay.other.${RUN}`);
      await during("... the host removes the entry and adds it again (a new code): nothing is confirmed", async (entry) => {
        await profiles.removeSocialName(fay.id, entry.id);
        await profiles.addSocialName(fay.id, "instagram", entry.nameKey);
      }, "gone", (after) => after?.confirmedAt === null);
      await during("... the code runs out: nothing is confirmed", (entry) => db.update(schema.socialAccounts).set({ codeExpiresAt: new Date(time - 1000) }).where(eq(schema.socialAccounts.id, entry.id)), "gone", (after) => after?.confirmedAt === null);
      await during("... the founder confirms it by hand first: it stays confirmed by the founder", async (entry) => {
        await db.update(schema.socialAccounts).set({ claimedAt: new Date() }).where(eq(schema.socialAccounts.id, entry.id));
        await profiles.confirmSocialName({ id: entry.id, nameKey: entry.nameKey, code: entry.code, by: host.id });
      }, "gone", (after) => after?.confirmedAt != null && after.confirmedBy === host.id);
      await during("... the founder says \"the code is not there\" for an entry that was waiting: the check that finds it still confirms", async (entry) => {
        await db.update(schema.socialAccounts).set({ claimedAt: new Date() }).where(eq(schema.socialAccounts.id, entry.id));
        await profiles.rejectSocialName({ id: entry.id, nameKey: entry.nameKey, code: entry.code });
      }, "confirmed", (after) => after?.confirmedAt != null && after.confirmedBy === null && after.claimedAt === null);

      // The same name, two hosts: the first one confirmed keeps it.
      const gus = await newHost("gus");
      const ian = await newHost("ian");
      const shared = `same.${RUN}`;
      await profiles.addSocialName(gus.id, "instagram", shared);
      await profiles.addSocialName(ian.id, "instagram", shared);
      const gusEntry = await entryOf(gus.id, "instagram");
      const ianEntry = await entryOf(ian.id, "instagram");
      const heldGus = heldBack();
      const gusRunning = ready(gus.id, gusEntry.id, heldGus.read);
      let ianOutcome = "";
      try {
        await whenAsking(heldGus, gusRunning);
        ianOutcome = await ready(ian.id, ianEntry.id, answering({ kind: "bio", text: `${gusEntry.code} ${ianEntry.code}` }));
      } finally {
        heldGus.release({ kind: "bio", text: `${gusEntry.code} ${ianEntry.code}` });
      }
      check("two hosts prove the same account at the same moment: one gets it, the other is told it is taken", ianOutcome === "confirmed" && (await gusRunning) === "taken" && (await entryOf(gus.id, "instagram")).confirmedAt === null && (await entryOf(ian.id, "instagram")).confirmedAt !== null);

      // A code that has run out, an entry that was already waiting, and the by-hand way.
      const hal = await newHost("hal");
      await profiles.addSocialName(hal.id, "youtube", `@hal-${RUN}`);
      const halYoutube = await entryOf(hal.id, "youtube");
      await db.update(schema.socialAccounts).set({ codeExpiresAt: new Date(time - 1000) }).where(eq(schema.socialAccounts.id, halYoutube.id));
      const askedBeforeHal = asked;
      check("a code that has run out is not checked", (await ready(hal.id, halYoutube.id, answering({ kind: "bio", text: halYoutube.code }))) === "gone" && asked === askedBeforeHal);
      await profiles.addSocialName(hal.id, "instagram", `hal.${RUN}`);
      const halInstagram = await entryOf(hal.id, "instagram");
      await profiles.markSocialNameReady(hal.id, halInstagram.id);
      check("an entry that was already waiting for the founder can be checked, and then leaves the founder's list", (await onFoundersList(hal.id)) === 1 && (await ready(hal.id, halInstagram.id, answering({ kind: "bio", text: halInstagram.code }))) === "confirmed" && (await onFoundersList(hal.id)) === 0);

      const jo = await newHost("jo");
      for (const [network, name] of [["instagram", `jo.${RUN}`], ["youtube", `@jo-${RUN}`], ["tiktok", `jo.${RUN}`], ["x", `jo${RUN}`]] as const) await profiles.addSocialName(jo.id, network, name);
      const askedBeforeJo = asked;
      const noInstagram: BioSettings = { ...AUTO, instagram: null };
      const noYouTube: BioSettings = { ...AUTO, youtube: null };
      const byHand = [
        await ready(jo.id, (await entryOf(jo.id, "instagram")).id, answering({ kind: "bio", text: "" }), noInstagram),
        await ready(jo.id, (await entryOf(jo.id, "youtube")).id, answering({ kind: "bio", text: "" }), noYouTube),
        await ready(jo.id, (await entryOf(jo.id, "tiktok")).id, answering({ kind: "bio", text: "" })),
        await ready(jo.id, (await entryOf(jo.id, "x")).id, answering({ kind: "bio", text: "" })),
      ];
      check("with its settings missing, Instagram or YouTube goes to the founder as before; TikTok and X always do; nobody is asked", byHand.every((o) => o === "waiting") && asked === askedBeforeJo && (await onFoundersList(jo.id)) === 4 && (await checksOf(jo.id)).length === 0, byHand.join(" "));
    }

    // ----------------------------------------------------------------------
    console.log("\n6d. TikTok is proven by signing in at TikTok");
    await freshLimits();
    {
      // TikTok's side, the settings and the time are pretended here. Nothing is asked of TikTok.
      const tiktok = await import("../src/lib/profiles/tiktok");
      const tiktokLogin = await import("../src/lib/profiles/tiktok-login");
      const ON: TikTokSettings = { clientKey: "pretend", clientSecret: "pretend", returnUrl: "https://connect.example/api/social/tiktok/return", signingSecret: "pretend-note-secret" };
      const BOTH = "user.info.basic,user.info.profile";
      const switchOn = () => Object.assign(process.env, { TIKTOK_CLIENT_KEY: "pretend", TIKTOK_CLIENT_SECRET: "pretend", PUBLIC_APP_URL: "https://connect.example" });
      const switchOff = () => {
        delete process.env.TIKTOK_CLIENT_KEY;
        delete process.env.TIKTOK_CLIENT_SECRET;
        if (TIKTOK_AS_SET.site === undefined) delete process.env.PUBLIC_APP_URL;
        else process.env.PUBLIC_APP_URL = TIKTOK_AS_SET.site;
      };
      const time = Date.now();
      const now = () => new Date(time);
      let asked = 0;
      const says = (answer: TikTokAccount): TikTokLookup => async () => (asked++, answer);
      const account = (openId: string, username: string): TikTokAccount => ({ kind: "account", openId, username });
      // Every name and account number here carries this run's own tag, so runs never meet each other's leftovers.
      const tag = RUN.slice(0, 6);
      const open = (name: string) => `open-${name}-${RUN}`;
      /** One sign-in from start to return, as the two addresses would run it. `change` alters what comes back. */
      const signIn = (userId: string, accountFor: TikTokLookup, change: (r: Parameters<typeof tiktokLogin.finishTikTokLogin>[0]) => void = () => undefined) => {
        const started = tiktokLogin.startTikTokLogin({ userId, now: now(), settings: ON });
        const request = { settings: ON as TikTokSettings | null, code: "one-time-code" as string | null, state: new URL(started.url).searchParams.get("state"), scopes: BOTH as string | null, refused: false, note: started.note as string | undefined, userId, now: now(), accountFor };
        change(request);
        return tiktokLogin.finishTikTokLogin(request);
      };
      const entryOf = async (userId: string, network = "tiktok") =>
        (await db.select().from(schema.socialAccounts).where(and(eq(schema.socialAccounts.userId, userId), eq(schema.socialAccounts.network, network))))[0];
      const confirmedOf = async (userId: string) => (await db.select().from(schema.socialAccounts).where(eq(schema.socialAccounts.userId, userId))).filter((a) => a.confirmedAt !== null);
      const onFoundersList = async (userId: string) =>
        (await db.select().from(schema.socialAccounts).where(eq(schema.socialAccounts.userId, userId))).filter((a) => a.claimedAt !== null && a.confirmedAt === null && a.codeExpiresAt > new Date()).length;
      const statusOf = async (userId: string) => (await db.select().from(schema.hostProfiles).where(eq(schema.hostProfiles.userId, userId)))[0].status;
      const refusedRows = async (userId: string) => (await db.select().from(schema.bioChecks).where(eq(schema.bioChecks.userId, userId))).filter((c) => c.network === "tiktok" && c.result === "refused").length;
      const newHost = async (label: string) => {
        const person = await newPerson(label);
        await profiles.createHostProfile(person.id, { handle: `${label}_${RUN}`, displayName: `Check ${label}`, about: "", pricePer15Cents: 0, country: "US", languages: ["en"] });
        return person;
      };

      // Switched off.
      const kim = await newHost("kim");
      await passId(kim);
      check("switched off (a key missing, or the site's address not https): nothing is asked and nothing saved", tiktok.tiktokSettings() === null && (await signIn(kim.id, says(account(open("kim"), `kim.${tag}`)), (r) => (r.settings = null))) === tiktokLogin.TIKTOK_OFF && asked === 0 && (await entryOf(kim.id)) === undefined);
      switchOn();
      const onNow = tiktok.tiktokSettings() !== null;
      process.env.PUBLIC_APP_URL = "http://localhost:3000";
      check("it is on with both keys and an https address, and off again when the address is not https", onNow && tiktok.tiktokSettings() === null);
      switchOff();

      // The return: Connect's own checks come first.
      const stranger = await newHost("ole");
      const wrong: Array<[string, (r: Parameters<typeof tiktokLogin.finishTikTokLogin>[0]) => void]> = [
        ["no note", (r) => (r.note = undefined)],
        ["a note that was changed", (r) => (r.note = `${r.note}x`)],
        ["a note out of date", (r) => (r.now = new Date(time + 11 * 60_000))],
        ["a value that does not match", (r) => (r.state = "another-value")],
        ["no value", (r) => (r.state = null)],
        ["started as one person, returned as another", (r) => (r.userId = stranger.id)],
        ["TikTok returns a refusal", (r) => (r.refused = true)],
        ["no code", (r) => (r.code = null)],
        ["one permission missing", (r) => (r.scopes = "user.info.basic")],
      ];
      const stopped: string[] = [];
      for (const [label, change] of wrong) {
        const message = await signIn(kim.id, says(account(open("kim"), `kim.${tag}`)), change);
        if (message.includes("is confirmed") || asked !== 0 || (await entryOf(kim.id)) !== undefined || (await entryOf(stranger.id)) !== undefined) stopped.push(label);
      }
      check(`the return is stopped by Connect's own checks, before anything is asked of TikTok (${wrong.length} cases)`, stopped.length === 0, stopped.join("; "));

      // Saving.
      const first = await signIn(kim.id, says(account(open("kim"), `Kim.${tag}`)));
      const kimEntry = await entryOf(kim.id);
      check("a good return: confirmed at once, with TikTok's number, by nobody's hand, never on the founder's list", first === `TikTok @kim.${tag} is confirmed.` && asked === 1 && kimEntry.confirmedAt !== null && kimEntry.providerAccountId === open("kim") && kimEntry.confirmedBy === null && kimEntry.claimedAt === null && kimEntry.codeExpiresAt <= now() && (await onFoundersList(kim.id)) === 0, first);
      await approve(kim.id);
      check("a host whose only account was confirmed by signing in can be approved, and then cannot remove it", (await statusOf(kim.id)) === "approved" && (await refusedWith(profiles.removeSocialName(kim.id, kimEntry.id), "needs one confirmed account")));
      check("the same account under a new name: the name is updated, the proof kept", (await signIn(kim.id, says(account(open("kim"), `kimr.${tag}`)))) === `TikTok @kimr.${tag} is confirmed.` && (await entryOf(kim.id)).id === kimEntry.id && (await entryOf(kim.id)).nameKey === `kimr.${tag}` && (await confirmedOf(kim.id)).length === 1);
      check("a different account replaces the old one in one step: the approved host is never without a confirmed account", (await signIn(kim.id, says(account(open("kim-2"), `kim2.${tag}`)))) === `TikTok @kim2.${tag} is confirmed.` && (await entryOf(kim.id)).providerAccountId === open("kim-2") && (await confirmedOf(kim.id)).length === 1 && (await statusOf(kim.id)) === "approved");

      const lee = await newHost("lee");
      await profiles.addSocialName(lee.id, "tiktok", `lee.${tag}`);
      const leeByHand = await entryOf(lee.id);
      await profiles.markSocialNameReady(lee.id, leeByHand.id);
      await profiles.confirmSocialName({ id: leeByHand.id, nameKey: leeByHand.nameKey, code: leeByHand.code, by: host.id });
      check("an account confirmed by hand stays confirmed and gets TikTok's number", (await signIn(lee.id, says(account(open("lee"), `lee.${tag}`)))) === `TikTok @lee.${tag} is confirmed.` && (await entryOf(lee.id)).id === leeByHand.id && (await entryOf(lee.id)).providerAccountId === open("lee") && (await entryOf(lee.id)).confirmedAt !== null);
      check("the founder's \"confirm\" or \"the code is not there\" from a page left open changes nothing after that", (await refused(profiles.confirmSocialName({ id: leeByHand.id, nameKey: leeByHand.nameKey, code: leeByHand.code, by: host.id }))) && (await refused(profiles.rejectSocialName({ id: leeByHand.id, nameKey: leeByHand.nameKey, code: leeByHand.code }))) && (await entryOf(lee.id)).providerAccountId === open("lee"));

      const max = await newHost("max");
      await profiles.addSocialName(max.id, "tiktok", `max.${tag}`);
      const maxOwn = await entryOf(max.id);
      const byName = await signIn(max.id, says(account(open("max"), `kim2.${tag}`)));
      const byNumber = await signIn(max.id, says(account(open("kim-2"), `brand.new.${tag}`)));
      const maxAfter = await entryOf(max.id);
      check("a name or a number that is confirmed for another host is refused, and the host's own entry is untouched", byName.includes("already confirmed for another host") && byNumber.includes("already confirmed for another host") && maxAfter.nameKey === maxOwn.nameKey && maxAfter.code === maxOwn.code && maxAfter.confirmedAt === null && maxAfter.providerAccountId === null, `${byName} | ${byNumber}`);

      const ned = await newHost("ned");
      const oli = await newHost("oli");
      const both = await Promise.all([signIn(ned.id, says(account(open("same"), `same.${tag}`))), signIn(oli.id, says(account(open("same"), `same.${tag}`)))]);
      check("two hosts connect the same account at the same moment: one gets it, the other is told it is taken", both.filter((m) => m.includes("is confirmed")).length === 1 && both.filter((m) => m.includes("already confirmed for another host")).length === 1 && (await confirmedOf(ned.id)).length + (await confirmedOf(oli.id)).length === 1, both.join(" | "));

      // A replacement at the same moment as a removal, and as an approval: the approved host always keeps one.
      const kimNow = await entryOf(kim.id);
      const swapAndRemove = await Promise.allSettled([signIn(kim.id, says(account(open("kim-3"), `kim3.${tag}`))), profiles.removeSocialName(kim.id, kimNow.id)]);
      // The sign-in gives its answer as a message also when it fails, so the message and the saved number are read.
      const said = (r: PromiseSettledResult<unknown>) => (r.status === "fulfilled" ? String(r.value) : `refused: ${r.reason instanceof Error ? r.reason.message : r.reason}`);
      check("a replacement and a removal at the same moment: the replacement goes through, the removal is refused, and the approved host has the new account", said(swapAndRemove[0]) === `TikTok @kim3.${tag} is confirmed.` && swapAndRemove[1].status === "rejected" && (await entryOf(kim.id)).providerAccountId === open("kim-3") && (await confirmedOf(kim.id)).length === 1 && (await statusOf(kim.id)) === "approved", swapAndRemove.map(said).join(" | "));
      const tom = await newHost("tom");
      await passId(tom);
      await signIn(tom.id, says(account(open("tom"), `tom.${tag}`)));
      const swapAndApprove = await Promise.allSettled([approve(tom.id), signIn(tom.id, says(account(open("tom-2"), `tom2.${tag}`)))]);
      check("a replacement and an approval at the same moment: both go through, and the approved host has the new account", swapAndApprove[0].status === "fulfilled" && said(swapAndApprove[1]) === `TikTok @tom2.${tag} is confirmed.` && (await entryOf(tom.id)).providerAccountId === open("tom-2") && (await statusOf(tom.id)) === "approved" && (await confirmedOf(tom.id)).length === 1, swapAndApprove.map(said).join(" | "));

      await freshLimits(); // this section signs up many people
      const pia = await newHost("pia");
      const pausedMeanwhile = await signIn(pia.id, async () => {
        await db.update(schema.user).set({ pausedAt: new Date() }).where(eq(schema.user.id, pia.id));
        return account(open("pia"), `pia.${tag}`);
      });
      await db.update(schema.user).set({ pausedAt: null }).where(eq(schema.user.id, pia.id));
      const closedMeanwhile = await signIn(pia.id, async () => {
        await db.update(schema.user).set({ closedAt: new Date() }).where(eq(schema.user.id, pia.id));
        return account(open("pia"), `pia.${tag}`);
      });
      await db.update(schema.user).set({ closedAt: null }).where(eq(schema.user.id, pia.id));
      const noProfile = await newPerson("quin");
      check("an account paused or closed while TikTok was answering, or a person with no host profile: nothing is saved", pausedMeanwhile.includes("cannot do this at the moment") && closedMeanwhile.includes("cannot do this at the moment") && (await entryOf(pia.id)) === undefined && (await signIn(noProfile.id, says(account(open("quin"), `quin.${tag}`)))) === "Fill in your host profile first." && (await entryOf(noProfile.id)) === undefined);

      // The founder's warning: only when TikTok refuses our own keys or permissions.
      const before = await refusedRows(pia.id);
      const notOurs = await signIn(pia.id, says({ kind: "failed", reason: "the code was not accepted" }));
      const broke = await signIn(pia.id, async () => {
        throw new Error("boom");
      });
      const afterOthers = await refusedRows(pia.id);
      const ours = await signIn(pia.id, says({ kind: "refused", reason: "invalid_client" }));
      check("a code TikTok will not take, or a request that breaks, is not blamed on our keys", !notOurs.includes("is confirmed") && !broke.includes("is confirmed") && afterOthers === before && (await entryOf(pia.id)) === undefined);
      check("when TikTok refuses our own keys, the host is told to try later and it shows up for the founder's page", ours.includes("try again later") && (await refusedRows(pia.id)) === before + 1 && (await profiles.refusedBioChecks(now())).some((r) => r.network === "tiktok" && r.count >= 1) && (await entryOf(pia.id)) === undefined);
      await db.insert(schema.bioChecks).values(Array.from({ length: profiles.BIO_CHECKS_PER_HOUR + 2 }, () => ({ userId: pia.id, network: "tiktok", startedAt: now(), result: "refused" })));
      await profiles.addSocialName(pia.id, "youtube", `@pia-${tag}`);
      const piaYoutube = await entryOf(pia.id, "youtube");
      const stillChecks = await profiles.socialNameReady(pia.id, piaYoutube.id, { read: async () => ({ kind: "bio", text: piaYoutube.code }), settings: { instagram: null, youtube: { key: "pretend" } }, clock: now });
      check("those rows do not use up the host's own Instagram and YouTube checks", stillChecks.outcome === "confirmed", stillChecks.outcome);

      // The by-hand way for TikTok, while the sign-in is on and off.
      await freshLimits(); // this section signs up many people
      const ria = await newHost("ria");
      await profiles.addSocialName(ria.id, "tiktok", `ria.${tag}`);
      const riaEntry = await entryOf(ria.id);
      const sam = await newHost("sam");
      await profiles.addSocialName(sam.id, "tiktok", `sam.${tag}`);
      const samEntry = await entryOf(sam.id);
      await profiles.markSocialNameReady(sam.id, samEntry.id);
      switchOn();
      try {
        const USE = "Connect your TikTok";
        check("while the sign-in is on, a TikTok name cannot be typed in, also not the one already confirmed", (await refusedWith(profiles.addSocialName(ria.id, "tiktok", `ria.other.${tag}`), USE)) && (await refusedWith(profiles.addSocialName(lee.id, "tiktok", `lee.${tag}`), USE)) && (await entryOf(ria.id)).nameKey === `ria.${tag}`);
        check("and \"I've done it\" from an old page cannot put a TikTok request on the founder's list", (await refusedWith(profiles.markSocialNameReady(ria.id, riaEntry.id), USE)) && (await refusedWith(profiles.socialNameReady(ria.id, riaEntry.id), USE)) && (await onFoundersList(ria.id)) === 0);
        await profiles.addSocialName(ria.id, "x", `ria${tag}`);
        check("the other networks are as before", (await entryOf(ria.id, "x")).nameKey === `ria${tag}`);
        check("a TikTok entry that was already waiting stays on the founder's list, and leaves it when the host connects", (await onFoundersList(sam.id)) === 1 && (await signIn(sam.id, says(account(open("sam"), `sam.${tag}`)))).includes("is confirmed") && (await onFoundersList(sam.id)) === 0 && (await entryOf(sam.id)).id === samEntry.id);
      } finally {
        switchOff();
      }
      await profiles.addSocialName(sam.id, "tiktok", `sam.new.${tag}`);
      const samTyped = await entryOf(sam.id);
      check("with the sign-in off again, typing a name works as before and clears TikTok's number with the old proof", samTyped.nameKey === `sam.new.${tag}` && samTyped.confirmedAt === null && samTyped.providerAccountId === null);

      // Through the running app, as a browser would. A note that is not ours is sent along. Whether the app
      // has TikTok's keys (then the note is refused) or not (then it is switched off), nothing may be saved,
      // and the note must be removed: read from the cookie line the app really sends.
      const returnAddress = "/api/social/tiktok/return?code=one-time-code&state=some-value&scopes=user.info.basic,user.info.profile";
      const noteRemoved = (reply: Reply) =>
        reply.setCookies.some((line) => line.startsWith(`${tiktok.TIKTOK_COOKIE}=;`) && /;\s*path=\/api\/social\/tiktok(;|$)/i.test(line) && (/;\s*max-age=0(;|$)/i.test(line) || /;\s*expires=thu, 01 jan 1970/i.test(line)));
      const visitor = await send(returnAddress, { jar: new Map([[tiktok.TIKTOK_COOKIE, "a-note-from-before"]]) });
      check("the return address without being logged in: the note is removed, and the person is sent to log in and then to the Hosting page", noteRemoved(visitor) && (visitor.location ?? "").includes("/login?next=%2Fhost"), `${visitor.location} | ${visitor.setCookies.join(" || ").slice(0, 160)}`);
      sam.jar.set(tiktok.TIKTOK_COOKIE, "a-note-from-before");
      const reply = await send(returnAddress, { jar: sam.jar });
      const landed = decodeURIComponent(reply.location ?? "");
      check("logged in, with a note that is not ours: the note is removed, back on the Hosting page with a plain message, nothing saved", noteRemoved(reply) && landed.includes("/host?notice=") && (landed.includes(tiktokLogin.TIKTOK_OFF) || landed.includes("TikTok was not connected")) && (await entryOf(sam.id)).nameKey === `sam.new.${tag}`, `${landed.slice(0, 110)} | ${reply.setCookies.join(" || ").slice(0, 160)}`);
    }

    // ----------------------------------------------------------------------
    console.log("\n6e. Instagram can also be proven by signing in at Meta (the code stays)");
    await freshLimits();
    {
      // Meta's side, the settings and the time are pretended here. Nothing is asked of Meta.
      const instagram = await import("../src/lib/profiles/instagram");
      const instagramLogin = await import("../src/lib/profiles/instagram-login");
      const { writeNote } = await import("../src/lib/profiles/login-note");
      const ON: InstagramSettings = { appId: "20193060", appSecret: "pretend", configId: "25986641", returnUrl: "https://connect.example/api/social/instagram/return", signingSecret: "pretend-note-secret" };
      const time = Date.now();
      const now = () => new Date(time);
      let asked = 0;
      const says = (answer: InstagramAccounts): InstagramLookup => async () => (asked++, answer);
      // Every name and account number here carries this run's own tag, so runs never meet each other's leftovers.
      const tag = RUN.slice(0, 6);
      const base = String(parseInt(RUN, 16));
      const num = (n: number) => `${base}${String(n).padStart(3, "0")}`;
      const name = (label: string) => `ig.${label}.${tag}`;
      const shared = (...accounts: Array<[number, string]>): InstagramAccounts => ({ kind: "accounts", accounts: accounts.map(([n, username]) => ({ accountId: num(n), username })) });
      type Return = Parameters<typeof instagramLogin.finishInstagramLogin>[0];
      /** One sign-in from start to return, as the two addresses would run it. `change` alters what comes back. */
      const signIn = (userId: string, accountsFor: InstagramLookup, change: (r: Return) => void = () => undefined) => {
        const started = instagramLogin.startInstagramLogin({ userId, now: now(), settings: ON });
        const request: Return = { settings: ON, code: "one-time-code", state: new URL(started.url).searchParams.get("state"), refused: false, note: started.note, userId, now: now(), accountsFor };
        change(request);
        return instagramLogin.finishInstagramLogin(request);
      };
      const entryOf = async (userId: string, network = "instagram") =>
        (await db.select().from(schema.socialAccounts).where(and(eq(schema.socialAccounts.userId, userId), eq(schema.socialAccounts.network, network))))[0];
      const confirmedOf = async (userId: string) => (await db.select().from(schema.socialAccounts).where(eq(schema.socialAccounts.userId, userId))).filter((a) => a.confirmedAt !== null);
      const onFoundersList = async (userId: string) =>
        (await db.select().from(schema.socialAccounts).where(eq(schema.socialAccounts.userId, userId))).filter((a) => a.claimedAt !== null && a.confirmedAt === null && a.codeExpiresAt > new Date()).length;
      const statusOf = async (userId: string) => (await db.select().from(schema.hostProfiles).where(eq(schema.hostProfiles.userId, userId)))[0].status;
      /** Everything about an entry that a proof touches, as one text, to see that nothing changed. */
      const proofOf = async (userId: string) => {
        const e = await entryOf(userId);
        return e ? JSON.stringify([e.id, e.nameKey, e.nameTyped, e.url, e.code, e.codeExpiresAt, e.claimedAt, e.confirmedAt, e.confirmedBy, e.providerAccountId]) : "none";
      };
      const signInRows = async (userId: string) => (await db.select().from(schema.bioChecks).where(eq(schema.bioChecks.userId, userId))).filter((c) => c.network === profiles.INSTAGRAM_SIGN_IN && c.result === "refused").length;
      const newHost = async (label: string) => {
        const person = await newPerson(label);
        await profiles.createHostProfile(person.id, { handle: `${label}_${RUN}`, displayName: `Check ${label}`, about: "", pricePer15Cents: 0, country: "US", languages: ["en"] });
        return person;
      };
      /** The code way, with Meta's bio service pretended: the code is in the bio. */
      const byCode = async (userId: string, typed: string) => {
        await profiles.addSocialName(userId, "instagram", typed);
        const entry = await entryOf(userId);
        return profiles.socialNameReady(userId, entry.id, { read: async () => ({ kind: "bio", text: `hello ${entry.code}` }), settings: { instagram: { token: "pretend", accountId: "12345" }, youtube: null }, clock: now });
      };

      // Switched off, and the return's own checks.
      const ivo = await newHost("ivo");
      await passId(ivo);
      check("switched off: nothing is asked and nothing saved", (await signIn(ivo.id, says(shared([1, name("ivo")])), (r) => (r.settings = null))) === instagramLogin.INSTAGRAM_OFF && asked === 0 && (await entryOf(ivo.id)) === undefined);
      const stranger = await newHost("jon");
      const wrong: Array<[string, (r: Return) => void]> = [
        ["no note", (r) => (r.note = undefined)],
        ["a note that was changed", (r) => (r.note = `${r.note}x`)],
        ["a note out of date", (r) => (r.now = new Date(time + 11 * 60_000))],
        ["a value that does not match", (r) => (r.state = "another-value")],
        ["no value", (r) => (r.state = null)],
        ["started as one person, returned as another", (r) => (r.userId = stranger.id)],
        ["a note of TikTok's sign-in, for the same person and value", (r) => (r.note = writeNote("tiktok-login", { state: r.state ?? "", userId: r.userId, expiresAt: new Date(time + 600_000) }, ON.signingSecret))],
        ["Meta returns a refusal", (r) => (r.refused = true)],
        ["no code", (r) => (r.code = null)],
      ];
      const stopped: string[] = [];
      for (const [label, change] of wrong) {
        const message = await signIn(ivo.id, says(shared([1, name("ivo")])), change);
        if (message.includes("is confirmed") || asked !== 0 || (await entryOf(ivo.id)) !== undefined || (await entryOf(stranger.id)) !== undefined) stopped.push(label);
      }
      check(`the return is stopped by Connect's own checks, before anything is asked of Meta (${wrong.length} cases)`, stopped.length === 0, stopped.join("; "));

      // One account shared.
      const first = await signIn(ivo.id, says(shared([1, `IG.Ivo.${tag}`])));
      const ivoEntry = await entryOf(ivo.id);
      check("one account shared, no entry yet: confirmed at once, with Meta's number, by nobody's hand, never on the founder's list", first === `Instagram @${name("ivo")} is confirmed.` && asked === 1 && ivoEntry.confirmedAt !== null && ivoEntry.providerAccountId === num(1) && ivoEntry.confirmedBy === null && ivoEntry.claimedAt === null && ivoEntry.codeExpiresAt <= now() && (await onFoundersList(ivo.id)) === 0, first);
      await approve(ivo.id);
      check("a host whose only account was confirmed by signing in can be approved, and then cannot remove it", (await statusOf(ivo.id)) === "approved" && (await refusedWith(profiles.removeSocialName(ivo.id, ivoEntry.id), "needs one confirmed account")));
      check("the same account under a new name: the name is updated, the proof kept", (await signIn(ivo.id, says(shared([1, name("ivor")])))) === `Instagram @${name("ivor")} is confirmed.` && (await entryOf(ivo.id)).id === ivoEntry.id && (await entryOf(ivo.id)).nameKey === name("ivor") && (await confirmedOf(ivo.id)).length === 1);
      check("only a different account shared: it replaces the old one in one step, and the approved host is never without a confirmed account", (await signIn(ivo.id, says(shared([2, name("ivo2")])))) === `Instagram @${name("ivo2")} is confirmed.` && (await entryOf(ivo.id)).providerAccountId === num(2) && (await confirmedOf(ivo.id)).length === 1 && (await statusOf(ivo.id)) === "approved");

      // The code and the sign-in, for one entry.
      const kai = await newHost("kai");
      const coded = await byCode(kai.id, name("kai"));
      const kaiByCode = await entryOf(kai.id);
      check("(the code still confirms an Instagram account by itself)", coded.outcome === "confirmed" && kaiByCode.confirmedAt !== null && kaiByCode.providerAccountId === null, coded.outcome);
      check("an account confirmed with the code stays confirmed and gains Meta's number", (await signIn(kai.id, says(shared([3, name("kai")])))) === `Instagram @${name("kai")} is confirmed.` && (await entryOf(kai.id)).id === kaiByCode.id && (await entryOf(kai.id)).providerAccountId === num(3) && (await entryOf(kai.id)).confirmedAt !== null);
      const kip = await newHost("kip");
      await byCode(kip.id, name("kip.x"));
      await passId(kip);
      await approve(kip.id);
      check("an approved host whose account was confirmed with the code shares only a different account: it replaces the old one in one step", (await signIn(kip.id, says(shared([5, name("kip.y")])))) === `Instagram @${name("kip.y")} is confirmed.` && (await entryOf(kip.id)).providerAccountId === num(5) && (await confirmedOf(kip.id)).length === 1 && (await statusOf(kip.id)) === "approved");
      const lea = await newHost("lea");
      await profiles.addSocialName(lea.id, "instagram", name("lea.typed"));
      const leaTyped = await entryOf(lea.id);
      const leaSigned = await signIn(lea.id, says(shared([4, name("lea.real")])));
      check("a name the host typed is never confirmed when Meta did not list it: the one shared account takes its place", leaSigned === `Instagram @${name("lea.real")} is confirmed.` && (await entryOf(lea.id)).nameKey === name("lea.real") && (await entryOf(lea.id)).providerAccountId === num(4) && (await confirmedOf(lea.id)).every((a) => a.nameKey !== leaTyped.nameKey), leaSigned);
      check("a \"Check now\" for the old code, from a page left open, changes nothing after that", (await profiles.socialNameReady(lea.id, leaTyped.id, { read: async () => ({ kind: "bio", text: leaTyped.code }), settings: { instagram: { token: "pretend", accountId: "12345" }, youtube: null }, clock: now })).outcome === "gone" && (await entryOf(lea.id)).providerAccountId === num(4));

      const liv = await newHost("liv");
      await profiles.addSocialName(liv.id, "instagram", name("liv"));
      const livTyped = await entryOf(liv.id);
      let signedMeanwhile = "";
      const lateLook = await profiles.socialNameReady(liv.id, livTyped.id, {
        read: async () => {
          // While the bio is being read, the host signs in at Meta with a different account.
          signedMeanwhile = await signIn(liv.id, says(shared([6, name("liv.other")])));
          return { kind: "bio", text: livTyped.code };
        },
        settings: { instagram: { token: "pretend", accountId: "12345" }, youtube: null },
        clock: now,
      });
      check("a look at the bio that began before the sign-in and comes back after it cannot put the old name back", signedMeanwhile === `Instagram @${name("liv.other")} is confirmed.` && lateLook.outcome === "gone" && (await entryOf(liv.id)).nameKey === name("liv.other") && (await entryOf(liv.id)).providerAccountId === num(6), `${signedMeanwhile} | ${lateLook.outcome}`);
      // The founder's "confirm" for an entry that waits on the founder's list, pressed at the moment the host signs in.
      const lou = await newHost("lou");
      await profiles.addSocialName(lou.id, "instagram", name("lou"));
      const louTyped = await entryOf(lou.id);
      await profiles.markSocialNameReady(lou.id, louTyped.id);
      const said0 = (r: PromiseSettledResult<unknown>) => (r.status === "fulfilled" ? String(r.value) : `refused: ${r.reason instanceof Error ? r.reason.message : r.reason}`);
      const confirmAndSignIn = await Promise.allSettled([profiles.confirmSocialName({ id: louTyped.id, nameKey: louTyped.nameKey, code: louTyped.code, by: host.id }), signIn(lou.id, says(shared([7, name("lou")])))]);
      const louAfter = await entryOf(lou.id);
      // The founder's press either went through (it was first) or was told that the entry is no longer waiting (the sign-in was first): nothing else.
      const founderOk = confirmAndSignIn[0].status === "fulfilled" || (confirmAndSignIn[0].status === "rejected" && confirmAndSignIn[0].reason instanceof ProfileError);
      check("the founder's \"confirm\" and the host's sign-in at the same moment (in whichever order this run took them): the entry ends as the sign-in's proof, with Meta's number, by nobody's hand", founderOk && said0(confirmAndSignIn[1]) === `Instagram @${name("lou")} is confirmed.` && louAfter.id === louTyped.id && louAfter.confirmedAt !== null && louAfter.confirmedBy === null && louAfter.claimedAt === null && louAfter.providerAccountId === num(7) && (await confirmedOf(lou.id)).length === 1, confirmAndSignIn.map(said0).join(" | "));
      const louProof = await proofOf(lou.id);
      const staleConfirm = await refused(profiles.confirmSocialName({ id: louTyped.id, nameKey: louTyped.nameKey, code: louTyped.code, by: host.id }));
      const afterStaleConfirm = await proofOf(lou.id);
      const staleReject = await refused(profiles.rejectSocialName({ id: louTyped.id, nameKey: louTyped.nameKey, code: louTyped.code }));
      check("and the founder's \"confirm\" or \"the code is not there\" from a page left open is refused, and after each the entry is exactly as it was", staleConfirm && afterStaleConfirm === louProof && staleReject && (await proofOf(lou.id)) === louProof);

      // Several accounts shared: the rule, case by case.
      await freshLimits(); // this section signs up many people
      const mia = await newHost("mia");
      const none = await signIn(mia.id, says(shared()));
      const severalNoEntry = await signIn(mia.id, says(shared([10, name("mia.a")], [11, name("mia.b")])));
      check("none shared, and several shared by a host with no entry: nothing is taken, each with its own sentence", none === profiles.NO_INSTAGRAM_SHARED && severalNoEntry === profiles.SEVERAL_INSTAGRAM_SHARED && (await entryOf(mia.id)) === undefined, `${none} | ${severalNoEntry}`);
      await profiles.addSocialName(mia.id, "instagram", name("mia.b"));
      const miaTyped = await entryOf(mia.id);
      const noMatch = await signIn(mia.id, says(shared([10, name("mia.a")], [12, name("mia.c")])));
      const afterNoMatch = await entryOf(mia.id);
      check("several shared, and none has the name on the host's page: nothing is taken, and the entry keeps its code", noMatch === profiles.SEVERAL_INSTAGRAM_SHARED && afterNoMatch.nameKey === miaTyped.nameKey && afterNoMatch.code === miaTyped.code && afterNoMatch.confirmedAt === null);
      check("several shared, and exactly one has that name: that one", (await signIn(mia.id, says(shared([10, name("mia.a")], [11, `IG.Mia.B.${tag}`])))) === `Instagram @${name("mia.b")} is confirmed.` && (await entryOf(mia.id)).providerAccountId === num(11) && (await entryOf(mia.id)).id === miaTyped.id);
      // Her account (number 11) is renamed, and another shared account now carries its old name.
      const renamed = await signIn(mia.id, says(shared([13, name("mia.b")], [11, name("mia.new")])));
      check("several shared, and one has the number on the host's entry: that one, although another now carries its old name", renamed === `Instagram @${name("mia.new")} is confirmed.` && (await entryOf(mia.id)).providerAccountId === num(11) && (await entryOf(mia.id)).nameKey === name("mia.new"), renamed);
      const numberGone = await signIn(mia.id, says(shared([13, name("mia.new")], [14, name("mia.d")])));
      check("several shared, and none has that number: nothing is taken, also when one carries the entry's name", numberGone === profiles.SEVERAL_INSTAGRAM_SHARED && (await entryOf(mia.id)).providerAccountId === num(11));
      const tooMany = await signIn(mia.id, says({ kind: "failed", reason: "the list of accounts goes on" }));
      const broken = await signIn(mia.id, says({ kind: "failed", reason: "the list of accounts could not be read" }));
      check("a list that goes on, or cannot be read, is refused whole", tooMany.includes("more Instagram accounts than we can look through") && broken.includes("was not connected") && (await entryOf(mia.id)).providerAccountId === num(11));

      // One owner for an account.
      await freshLimits(); // this section signs up many people
      const noa = await newHost("noa");
      await profiles.addSocialName(noa.id, "instagram", name("noa"));
      const noaOwn = await proofOf(noa.id);
      const byName = await signIn(noa.id, says(shared([20, name("kai")])));
      const afterByName = await proofOf(noa.id);
      const byNumber = await signIn(noa.id, says(shared([3, name("brand.new")])));
      const afterByNumber = await proofOf(noa.id);
      // Another host has typed the same name, while nobody had it confirmed yet.
      const oda = await newHost("oda");
      await profiles.addSocialName(oda.id, "instagram", name("noa"));
      const odaOwn = await proofOf(oda.id);
      const pickedIsTaken = await signIn(noa.id, says(shared([21, name("noa")], [22, name("free")])));
      check("(with several shared, her own name picks her own account)", pickedIsTaken === `Instagram @${name("noa")} is confirmed.`, pickedIsTaken);
      const noFallback = await signIn(oda.id, says(shared([21, name("noa")], [23, name("free")])));
      check("a name or a number that is confirmed for another host is refused, and after each refusal the host's own entry is exactly as it was", byName.includes("already confirmed for another host") && byNumber.includes("already confirmed for another host") && afterByName === noaOwn && afterByNumber === noaOwn, `${byName} | ${byNumber}`);
      check("when the account the rule picks belongs to another host, no other shared account is taken in its place, and the entry is exactly as it was", noFallback.includes("already confirmed for another host") && (await proofOf(oda.id)) === odaOwn, noFallback);
      // The same for an entry that is already confirmed: a refusal leaves the old proof whole.
      const kaiProof = await proofOf(kai.id);
      const kaiRefused = await signIn(kai.id, says(shared([21, name("noa")])));
      check("a confirmed host who shares an account that belongs to another host keeps their own confirmed account, untouched", kaiRefused.includes("already confirmed for another host") && (await proofOf(kai.id)) === kaiProof, kaiRefused);
      const pat = await newHost("pat");
      const quy = await newHost("quy");
      const both = await Promise.all([signIn(pat.id, says(shared([30, name("same")]))), signIn(quy.id, says(shared([30, name("same")])))]);
      check("two hosts connect the same account at the same moment: one gets it, the other is told it is taken", both.filter((m) => m.includes("is confirmed")).length === 1 && both.filter((m) => m.includes("already confirmed for another host")).length === 1 && (await confirmedOf(pat.id)).length + (await confirmedOf(quy.id)).length === 1, both.join(" | "));

      // The entry changes while Meta is answering: the choice is made on the entry as it is when it is saved.
      await freshLimits(); // this section signs up many people
      const rex = await newHost("rex");
      await profiles.addSocialName(rex.id, "instagram", name("rex.a"));
      const changedMeanwhile = await signIn(rex.id, async () => {
        await profiles.addSocialName(rex.id, "instagram", name("rex.b"));
        return shared([40, name("rex.a")], [41, name("rex.b")]);
      });
      check("the host changes the name on their page while Meta is answering: the account is chosen by the page as it is then", changedMeanwhile === `Instagram @${name("rex.b")} is confirmed.` && (await entryOf(rex.id)).providerAccountId === num(41), changedMeanwhile);
      const sue = await newHost("sue");
      await profiles.addSocialName(sue.id, "instagram", name("sue"));
      const removedMeanwhile = await signIn(sue.id, async () => {
        await profiles.removeSocialName(sue.id, (await entryOf(sue.id)).id);
        return shared([42, name("sue.a")], [43, name("sue")]);
      });
      check("the host removes the account from their page while Meta is answering: with several shared, nothing is taken", removedMeanwhile === profiles.SEVERAL_INSTAGRAM_SHARED && (await entryOf(sue.id)) === undefined, removedMeanwhile);
      // One return, sent twice at the same moment and once more afterwards (as with its cookie put back): the very same note and value each time.
      const oneStart = instagramLogin.startInstagramLogin({ userId: sue.id, now: now(), settings: ON });
      const oneReturn = (): Return => ({ settings: ON, code: "one-time-code", state: new URL(oneStart.url).searchParams.get("state"), refused: false, note: oneStart.note, userId: sue.id, now: now(), accountsFor: says(shared([44, name("sue.x")])) });
      const sameMoment = await Promise.all([instagramLogin.finishInstagramLogin(oneReturn()), instagramLogin.finishInstagramLogin(oneReturn())]);
      const again = await instagramLogin.finishInstagramLogin(oneReturn());
      const asOther = await instagramLogin.finishInstagramLogin({ ...oneReturn(), userId: rex.id });
      check("one return sent twice at the same moment, and once more later: the same person's same account, confirmed once", [...sameMoment, again].every((m) => m === `Instagram @${name("sue.x")} is confirmed.`) && (await confirmedOf(sue.id)).length === 1 && (await entryOf(sue.id)).providerAccountId === num(44), [...sameMoment, again].join(" | "));
      check("that same return, sent while logged in as someone else, attaches nothing to them", asOther.includes("was not connected") && (await entryOf(rex.id)).providerAccountId === num(41), asOther);
      const tia = await newHost("tia");
      await passId(tia);
      await signIn(tia.id, says(shared([45, name("tia")])));
      const said = (r: PromiseSettledResult<unknown>) => (r.status === "fulfilled" ? String(r.value) : `refused: ${r.reason instanceof Error ? r.reason.message : r.reason}`);
      const swapAndApprove = await Promise.allSettled([approve(tia.id), signIn(tia.id, says(shared([46, name("tia2")])))]);
      check("a replacement and an approval at the same moment: both go through, and the approved host has the new account", swapAndApprove[0].status === "fulfilled" && said(swapAndApprove[1]) === `Instagram @${name("tia2")} is confirmed.` && (await entryOf(tia.id)).providerAccountId === num(46) && (await statusOf(tia.id)) === "approved" && (await confirmedOf(tia.id)).length === 1, swapAndApprove.map(said).join(" | "));
      const tiaNow = await entryOf(tia.id);
      const swapAndRemove = await Promise.allSettled([signIn(tia.id, says(shared([47, name("tia3")]))), profiles.removeSocialName(tia.id, tiaNow.id)]);
      check("a replacement and a removal at the same moment: the replacement goes through, the removal is refused, and the approved host has the new account", said(swapAndRemove[0]) === `Instagram @${name("tia3")} is confirmed.` && swapAndRemove[1].status === "rejected" && swapAndRemove[1].reason instanceof ProfileError && /needs one confirmed account/.test(swapAndRemove[1].reason.message) && (await entryOf(tia.id)).providerAccountId === num(47) && (await confirmedOf(tia.id)).length === 1 && (await statusOf(tia.id)) === "approved", swapAndRemove.map(said).join(" | "));

      // The person.
      await freshLimits(); // this section signs up many people
      const uma = await newHost("uma");
      const pausedMeanwhile = await signIn(uma.id, async () => {
        await db.update(schema.user).set({ pausedAt: new Date() }).where(eq(schema.user.id, uma.id));
        return shared([50, name("uma")]);
      });
      await db.update(schema.user).set({ pausedAt: null }).where(eq(schema.user.id, uma.id));
      const closedMeanwhile = await signIn(uma.id, async () => {
        await db.update(schema.user).set({ closedAt: new Date() }).where(eq(schema.user.id, uma.id));
        return shared([50, name("uma")]);
      });
      await db.update(schema.user).set({ closedAt: null }).where(eq(schema.user.id, uma.id));
      const noProfile = await newPerson("val");
      check("an account paused or closed while Meta was answering, or a person with no host profile: nothing is saved", pausedMeanwhile.includes("cannot do this at the moment") && closedMeanwhile.includes("cannot do this at the moment") && (await entryOf(uma.id)) === undefined && (await signIn(noProfile.id, says(shared([51, name("val")])))) === "Fill in your host profile first." && (await entryOf(noProfile.id)) === undefined);

      // The founder's warning, and the bio check's limits.
      const before = await signInRows(uma.id);
      const notOurs = await signIn(uma.id, says({ kind: "failed", reason: "the code was not accepted" }));
      const broke = await signIn(uma.id, async () => {
        throw new Error("boom");
      });
      const afterOthers = await signInRows(uma.id);
      const ours = await signIn(uma.id, says({ kind: "refused" }));
      const forFounder = await profiles.refusedBioChecks(now());
      check("a code Meta will not take, or a request that breaks, is not blamed on our set-up", !notOurs.includes("is confirmed") && !broke.includes("is confirmed") && afterOthers === before && (await entryOf(uma.id)) === undefined);
      check("when Meta refuses our own set-up, the host is told to try later or use the code, and it shows up for the founder's page under its own name", ours.includes("try again later") && ours.includes("use the code") && (await signInRows(uma.id)) === before + 1 && forFounder.some((r) => r.network === profiles.INSTAGRAM_SIGN_IN && r.count >= 1) && (await entryOf(uma.id)) === undefined, ours);
      // Right after that refusal, and with far more of them than any limit: the bio check is as free as before.
      await db.insert(schema.bioChecks).values(Array.from({ length: profiles.INSTAGRAM_CHECKS_PER_HOUR + 5 }, () => ({ userId: uma.id, network: profiles.INSTAGRAM_SIGN_IN, startedAt: now(), result: "refused" })));
      const atOnce = await byCode(uma.id, name("uma"));
      check("refused sign-ins use up none of the bio check's limits: not the 30 seconds, not the person's hour, not everyone's hour", atOnce.outcome === "confirmed" && profiles.INSTAGRAM_CHECKS_PER_HOUR + 5 > profiles.BIO_CHECKS_PER_HOUR, atOnce.outcome);

      // Through the running app, as a browser would. A note that is not ours is sent along. Whether the app
      // has Meta's settings (then the note is refused) or not (then it is switched off), nothing may be saved,
      // and the note must be removed: read from the cookie line the app really sends.
      const returnAddress = "/api/social/instagram/return?code=one-time-code&state=some-value";
      const noteRemoved = (reply: Reply) =>
        reply.setCookies.some((line) => line.startsWith(`${instagram.INSTAGRAM_COOKIE}=;`) && /;\s*path=\/api\/social\/instagram(;|$)/i.test(line) && (/;\s*max-age=0(;|$)/i.test(line) || /;\s*expires=thu, 01 jan 1970/i.test(line)));
      const visitor = await send(returnAddress, { jar: new Map([[instagram.INSTAGRAM_COOKIE, "a-note-from-before"]]) });
      check("the return address without being logged in: the note is removed, and the person is sent to log in and then to the Hosting page", noteRemoved(visitor) && (visitor.location ?? "").includes("/login?next=%2Fhost"), `${visitor.location} | ${visitor.setCookies.join(" || ").slice(0, 160)}`);
      // (The app the script talks to has the sign-in switched on or off by its own settings file; the message tells which check ran.)
      const on = instagram.instagramSignInOn();
      const umaBefore = await proofOf(uma.id);
      uma.jar.set(instagram.INSTAGRAM_COOKIE, "a-note-from-before");
      const reply = await send(returnAddress, { jar: uma.jar });
      const landed = decodeURIComponent(reply.location ?? "");
      check(`logged in, with a note that is not ours (the sign-in is ${on ? "on: the note is refused" : "off"}): the note is removed, back on the Hosting page with a plain message, and the entry is exactly as it was`, noteRemoved(reply) && landed.includes("/host?notice=") && landed.includes(on ? "Instagram was not connected" : instagramLogin.INSTAGRAM_OFF) && (await proofOf(uma.id)) === umaBefore, `${landed.slice(0, 110)} | ${reply.setCookies.join(" || ").slice(0, 160)}`);
      // The Hosting page keeps the code for Instagram in every state; the button is there only while the sign-in is on.
      const wes = await newHost("wes");
      await profiles.addSocialName(wes.id, "instagram", name("wes"));
      const hosting = await send("/host", { jar: wes.jar });
      // (One state of the page, in whichever position the app's switch is. The other states and the other position are looked at in the browser.)
      const button = /<button[^>]*type="submit"[^>]*>\s*Connect your Instagram\s*<\/button>/.test(hosting.text);
      check(`the Hosting page shows an Instagram account that is not confirmed with its code and "Check now" or "I've done it"; the button is ${on ? "there, as a real button, with the line that points to it" : "not there, and nothing points to it"} (the sign-in is ${on ? "on" : "off"} for the app)`, hosting.status === 200 && hosting.text.includes((await entryOf(wes.id)).code) && /Check now|I(&#x27;|')ve done it/.test(hosting.text) && button === on && hosting.text.includes("Or press") === on, String(hosting.status));
    }

    // ----------------------------------------------------------------------
    console.log("\n7. Doors that must stay shut");
    await freshLimits();
    {
      const visitor = await newPerson("visitor");
      const statuses = await Promise.all(["/calls/new", "/admin", "/admin/people", "/admin/reports", "/admin/outbox"].map(async (path) => (await send(path, { jar: visitor.jar })).status));
      check("a normal user cannot open the admin pages or the sent emails, and the old test-call page is gone", statuses.every((s) => s === 404), statuses.join(" "));
      const stranger = await send("/account", { jar: new Map() });
      check("someone who is not logged in is sent to the login page, with the way back", (stranger.location ?? "").includes("/login?next=%2Faccount"), stranger.location ?? "");
      const front = await send("/", { jar: new Map() });
      check("at the front address they see the visitor's page, not anyone's calls", front.status === 200 && front.text.includes("Go from following to talking.") && front.text.includes("Sign up") && !front.text.includes("Your calls"), String(front.status));
      const token = await send(`/api/calls/${randomUUID()}/token`, { method: "POST", jar: new Map() });
      check("and cannot ask for a call entry pass", token.status === 401, String(token.status));

      const rename = await api("/update-user", { name: "x".repeat(500) }, visitor.jar);
      check("parts of the login tool we do not use are switched off", rename.status === 404 && (await userByEmail(visitor.email))?.name === visitor.name, String(rename.status));

      const words = `Words-from-a-stranger-${RUN}`;
      const forged = await send(`/host?notice=${words}&ns=aaaaaaaaaaaaaaaaaaaaaa`, { jar: visitor.jar });
      const genuine = await send(withNotice("/host", words), { jar: visitor.jar });
      // The words must not appear in the message box (the page address itself is always somewhere in the page's code).
      const inMessageBox = (html: string) => new RegExp(`<p role="status"[^>]*>[^<]*${words}`).test(html);
      check("a message put in a link by someone else is not shown on our pages", forged.status === 200 && !inMessageBox(forged.text), String(forged.status));
      check("our own messages are shown", inMessageBox(genuine.text));
      const moved = await send(withNotice("/admin", words).replace("/admin", "/host"), { jar: visitor.jar });
      check("but not when moved from the page they were made for to another page", moved.status === 200 && !inMessageBox(moved.text));
    }

    // ----------------------------------------------------------------------
    console.log("\n8. Closing an account");
    await freshLimits();
    {
      const [admin] = await db.select().from(schema.admins);
      if (!admin) throw new Error("No admin account. Run `npm run seed` first.");
      check("an admin account cannot be closed", await refused(closing.closeAccount({ userId: admin.userId, by: admin.userId })));

      // Two calls of this host that have not started: a free one, and a paid one not paid for yet.
      const startsAt = new Date(Date.now() + 3_600_000);
      const upcoming = { hostId: host.id, customerId: copycat.id, startsAt, endsAt: new Date(startsAt.getTime() + 600_000) };
      const [freeCall] = await db.insert(schema.calls).values({ ...upcoming, roomName: `acctcheck-${randomUUID()}`, pricePer15Cents: 0 }).returning();
      const paidCall = await db.transaction(async (tx) => {
        const [call] = await tx.insert(schema.calls).values({ ...upcoming, roomName: `acctcheck-${randomUUID()}`, pricePer15Cents: 2000 }).returning();
        await createPaymentForCall(tx, call);
        return call;
      });

      const password = host.password;
      check("before: logged in, profile public", (await loggedIn(host.jar)) && (await page(handle)).status === 200);
      const closed = await closing.closeAccount({ userId: host.id, by: admin.userId });
      check("the founder is told every call was ended", closed.callsNotEnded === 0, String(closed.callsNotEnded));
      check("logged out everywhere", await loggedOut(host.jar));
      check("the app sends them to the login page", ((await send("/account", { jar: host.jar })).location ?? "").includes("/login"));
      const attempt = await api("/sign-in/email", { email: host.email, password }, new Map());
      check("cannot log in again", attempt.status === 401 && attempt.json?.token === undefined, String(attempt.status));
      check("their page is gone", (await page(handle)).status === 404);
      const after = await db.select().from(schema.calls).where(eq(schema.calls.hostId, host.id));
      check("their calls that had not started are cancelled", after.length === 2 && after.every((c) => c.cancelledAt !== null && c.cancelledBy === "admin" && c.cancelledLate === false));
      const [payment] = await db.select().from(schema.payments).where(eq(schema.payments.callId, paidCall.id));
      check("and nobody is charged for them", payment.status === "closed_uncharged" && freeCall.pricePer15Cents === 0, payment.status);
      check("closing twice is refused", await refused(closing.closeAccount({ userId: host.id, by: admin.userId })));

      check("a closed account's profile cannot be approved", (await refusedWith(approve(host.id), "account is closed")) && (await page(handle)).status === 404);
      await closing.reopenAccount(host.id);
      check("after opening it again they can log in", (await api("/sign-in/email", { email: host.email, password }, new Map())).status === 200);
      check("but the profile stays suspended until approved again", (await page(handle)).status === 404);
    }
  } finally {
    // Remove everything this run made. Calls first: they point to two people each.
    const mine = await db.select({ id: schema.user.id }).from(schema.user).where(like(schema.user.email, `check-${RUN}-%`));
    const ids = mine.map((person) => person.id);
    if (ids.length > 0) {
      const calls = await db.select({ id: schema.calls.id }).from(schema.calls).where(or(inArray(schema.calls.hostId, ids), inArray(schema.calls.customerId, ids)));
      for (const call of calls) {
        await db.delete(schema.payments).where(eq(schema.payments.callId, call.id));
        await db.delete(schema.calls).where(eq(schema.calls.id, call.id));
      }
    }
    // First, for everyone: an account one test person confirmed for another, and a profile one decided
    // on for another, point at that person.
    if (ids.length > 0) {
      await db.delete(schema.bioChecks).where(inArray(schema.bioChecks.userId, ids));
      await db.delete(schema.socialAccounts).where(inArray(schema.socialAccounts.userId, ids));
      await db.delete(schema.hostProfiles).where(inArray(schema.hostProfiles.userId, ids));
    }
    for (const id of ids) {
      await db.delete(schema.identityChecks).where(eq(schema.identityChecks.userId, id));
      await db.delete(schema.hostSettings).where(eq(schema.hostSettings.userId, id));
      await removeTestsOf([id]);
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
