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
import { and, desc, eq, like } from "drizzle-orm";
import { requireLocalDatabase } from "./local-only";

const BASE = "http://localhost:3000";
const RUN = randomUUID().slice(0, 8);

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}

type Jar = Map<string, string>;
type Reply = { status: number; json: Record<string, unknown> | null; text: string; location: string | null };

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
  return { status: response.status, json, text, location: response.headers.get("location") };
}

const api = (path: string, body: unknown, jar?: Jar) => send(`/api/auth${path}`, { body, jar });
const strongPassword = () => randomBytes(12).toString("base64url");
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  requireLocalDatabase();
  const { db, schema } = await import("../src/db");
  const { sendEmail, MAX_EMAILS_PER_ADDRESS_PER_HOUR } = await import("../src/lib/email");
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
      .set({ adultConfirmedAt: now, termsAcceptedAt: now, termsVersion: "check", timeZone: "America/New_York" })
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
      await db.update(schema.user).set({ adultConfirmedAt: now, termsAcceptedAt: now, termsVersion: "check", timeZone: "America/New_York" }).where(eq(schema.user.id, row.id));
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

      const target = address("mailbox");
      for (let i = 0; i < MAX_EMAILS_PER_ADDRESS_PER_HOUR + 3; i++) await sendEmail({ to: target, subject: `Check ${i}`, text: "check" });
      const received = await db.select().from(schema.emailOutbox).where(eq(schema.emailOutbox.to, target));
      check(`one address gets at most ${MAX_EMAILS_PER_ADDRESS_PER_HOUR} emails an hour, whoever asks`, received.length === MAX_EMAILS_PER_ADDRESS_PER_HOUR, String(received.length));
      const burst = address("burst");
      await Promise.all(Array.from({ length: 12 }, (_, i) => sendEmail({ to: burst, subject: `Burst ${i}`, text: "check" })));
      const burstReceived = await db.select().from(schema.emailOutbox).where(eq(schema.emailOutbox.to, burst));
      check("also when many are asked for at the same moment", burstReceived.length === MAX_EMAILS_PER_ADDRESS_PER_HOUR, String(burstReceived.length));
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
    {
      const details = { displayName: "Check Host", about: "Testing only.", pricePer15Cents: 2000, usConfirmed: true };
      check("a blocked handle is refused", await refused(profiles.createHostProfile(host.id, { ...details, handle: "admin" })));
      check("a blocked handle with underscores is refused", await refused(profiles.createHostProfile(host.id, { ...details, handle: "sup_port" })));
      check("a handle with other alphabets is refused", await refused(profiles.createHostProfile(host.id, { ...details, handle: "jаne_doe" })));
      check("a price under $5 is refused", await refused(profiles.createHostProfile(host.id, { ...details, handle, pricePer15Cents: 300 })));
      check("a host outside the United States is refused", await refused(profiles.createHostProfile(host.id, { ...details, handle, usConfirmed: false })));

      await profiles.createHostProfile(host.id, { ...details, handle: `  @${handle.toUpperCase()} ` });
      const [made] = await db.select().from(schema.hostProfiles).where(eq(schema.hostProfiles.userId, host.id));
      check("the profile is saved, waiting for approval", made?.handle === handle && made.status === "pending", `${made?.handle} ${made?.status}`);
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
      await approve(host.id);
      const shown = await page(handle);
      check("public once approved, without logging in", shown.status === 200 && shown.text.includes("Check Host"), String(shown.status));
      check("the page never shows the email address", !shown.text.includes(host.email));
      check("capital letters in the address still find it", (await page(handle.toUpperCase())).status === 200);

      await profiles.setProfileHidden(host.id, true);
      check("hidden by the host: not found", (await page(handle)).status === 404);
      await profiles.setProfileHidden(host.id, false);

      await profiles.updateHostProfile(host.id, { displayName: "Check Host", about: "A new about text.", pricePer15Cents: 2500 });
      check("editing the about text and price keeps it public", (await page(handle)).status === 200);
      await profiles.updateHostProfile(host.id, { displayName: "A Famous Person", about: "A new about text.", pricePer15Cents: 2500 });
      check("a new display name must be approved again", (await page(handle)).status === 404);
      const stale = profiles.decideProfile({ userId: host.id, decision: "approved", by: host.id, seen: { displayName: "Check Host", about: "A new about text." } });
      check("approving the old name (an admin page left open) does not approve the new one", (await refused(stale)) && (await page(handle)).status === 404);
      await approve(host.id);

      await profiles.decideProfile({ userId: host.id, decision: "suspended", by: host.id });
      await profiles.updateHostProfile(host.id, { displayName: "Check Host", about: "", pricePer15Cents: 2500 });
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
      await profiles.createHostProfile(rival.id, { handle: `rival_${RUN}`, displayName: "Check Rival", about: "", pricePer15Cents: 0, usConfirmed: true });
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
    }
    // ----------------------------------------------------------------------
    console.log("\n7. Doors that must stay shut");
    await freshLimits();
    {
      const visitor = await newPerson("visitor");
      const statuses = await Promise.all(["/calls/new", "/admin", "/admin/people", "/admin/outbox"].map(async (path) => (await send(path, { jar: visitor.jar })).status));
      check("a normal user cannot open the test-call page, the admin pages or the sent emails", statuses.every((s) => s === 404), statuses.join(" "));
      const stranger = await send("/", { jar: new Map() });
      check("someone who is not logged in is sent to the login page", (stranger.location ?? "").includes("/login"), stranger.location ?? "");
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
      await closing.closeAccount({ userId: host.id, by: admin.userId });
      check("logged out everywhere", await loggedOut(host.jar));
      check("the app sends them to the login page", ((await send("/", { jar: host.jar })).location ?? "").includes("/login"));
      const attempt = await api("/sign-in/email", { email: host.email, password }, new Map());
      check("cannot log in again", attempt.status === 401 && attempt.json?.token === undefined, String(attempt.status));
      check("their page is gone", (await page(handle)).status === 404);
      const after = await db.select().from(schema.calls).where(eq(schema.calls.hostId, host.id));
      check("their calls that had not started are cancelled", after.length === 2 && after.every((c) => c.cancelledAt !== null && c.cancelledBy === "admin" && c.cancelledLate === false));
      const [payment] = await db.select().from(schema.payments).where(eq(schema.payments.callId, paidCall.id));
      check("and nobody is charged for them", payment.status === "closed_uncharged" && freeCall.pricePer15Cents === 0, payment.status);
      check("closing twice is refused", await refused(closing.closeAccount({ userId: host.id, by: admin.userId })));

      await closing.reopenAccount(host.id);
      check("after opening it again they can log in", (await api("/sign-in/email", { email: host.email, password }, new Map())).status === 200);
      check("but the profile stays suspended until approved again", (await page(handle)).status === 404);
    }
  } finally {
    // Remove everything this run made.
    const mine = await db.select({ id: schema.user.id }).from(schema.user).where(like(schema.user.email, `check-${RUN}-%`));
    for (const { id } of mine) {
      const calls = await db.select({ id: schema.calls.id }).from(schema.calls).where(eq(schema.calls.hostId, id));
      for (const call of calls) {
        await db.delete(schema.payments).where(eq(schema.payments.callId, call.id));
        await db.delete(schema.calls).where(eq(schema.calls.id, call.id));
      }
      await db.delete(schema.socialAccounts).where(eq(schema.socialAccounts.userId, id));
      await db.delete(schema.hostProfiles).where(eq(schema.hostProfiles.userId, id));
      await db.delete(schema.hostSettings).where(eq(schema.hostSettings.userId, id));
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
