/**
 * Testing tool: runs the safety journeys against the local app, database and
 * Stripe's test area. It makes its own people, and removes them afterwards.
 *
 * Needs: the app running (npm run dev), the test accounts (npm run seed), and
 * the test admin's second step set up (npx tsx scripts/secure-test-admin.ts).
 * Usage: npx tsx scripts/safety-check.ts
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { and, eq, inArray, like, or } from "drizzle-orm";
import { TERMS_VERSION } from "../src/lib/terms";
import { requireLocalDatabase } from "./local-only";
import { totpCode } from "./totp";

const BASE = "http://localhost:3000";
const RUN = randomUUID().slice(0, 8);
const HOUR = 3_600_000;

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}

type Jar = Map<string, string>;
async function send(path: string, options: { method?: string; body?: unknown; jar?: Jar } = {}) {
  const headers: Record<string, string> = { origin: BASE };
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (options.jar?.size) headers.cookie = [...options.jar].map(([k, v]) => `${k}=${v}`).join("; ");
  const response = await fetch(`${BASE}${path}`, { method: options.method ?? (options.body !== undefined ? "POST" : "GET"), headers, body: options.body !== undefined ? JSON.stringify(options.body) : undefined, redirect: "manual" });
  for (const cookie of response.headers.getSetCookie()) {
    const [pair, ...attrs] = cookie.split(";");
    const at = pair.indexOf("=");
    const name = pair.slice(0, at).trim();
    const value = pair.slice(at + 1);
    if (!value || attrs.some((a) => /max-age=0/i.test(a))) options.jar?.delete(name);
    else options.jar?.set(name, value);
  }
  const text = await response.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = JSON.parse(text);
  } catch {
    // a page
  }
  return { status: response.status, json, text, location: response.headers.get("location") };
}
const api = (path: string, body: unknown, jar?: Jar) => send(`/api/auth${path}`, { body, jar });

async function main() {
  requireLocalDatabase();
  const { db, schema } = await import("../src/db");
  const B = await import("../src/lib/booking/bookings");
  const { block, blockedBy, unblock } = await import("../src/lib/safety/blocks");
  const { isBlockedEitherWay } = await import("../src/lib/safety/block-check");
  const R = await import("../src/lib/safety/reports");
  const { endCallForSafety } = await import("../src/lib/safety/calls");
  const { identityState, startIdentityCheck, refreshIdentity } = await import("../src/lib/safety/identity");
  const { setSwitches, switches } = await import("../src/lib/safety/switches");
  const { decideProfile, ProfileError } = await import("../src/lib/profiles/profiles");
  const { startHold, syncHold } = await import("../src/lib/payments/hold");
  const { stripe } = await import("../src/lib/payments/stripe");

  const now = new Date();
  const refused = async (work: Promise<unknown>) => (await work.then(() => null).catch((e) => e)) instanceof Error;
  const made: string[] = [];
  async function person(name: string) {
    const id = `sf-${RUN}-${name}`;
    const email = `safetycheck-${RUN}-${name}@example.test`;
    await db.insert(schema.user).values({ id, name: `Check ${name}`, email, emailVerified: true, adultConfirmedAt: now, termsAcceptedAt: now, termsVersion: TERMS_VERSION, timeZone: "America/New_York" });
    made.push(id);
    return { id, name: `Check ${name}`, email };
  }
  async function makeHost(p: { id: string }, price: number) {
    await db.insert(schema.hostProfiles).values({ userId: p.id, handle: `sf${RUN}${p.id.slice(-4)}`, handleKey: `sf${RUN}${p.id.slice(-4)}`, displayName: `Host ${p.id.slice(-4)}`, pricePer15Cents: price, status: "approved", usConfirmedAt: now });
    await db.insert(schema.hostSettings).values({ userId: p.id }).onConflictDoNothing();
    await db.insert(schema.hostCalendars).values({ userId: p.id, timeZone: "America/New_York", lengths: "30", noticeHours: 24, horizonWeeks: 2, breakMinutes: 5 });
    await db.insert(schema.weeklyHours).values([1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ hostId: p.id, weekday, startMinute: 0, endMinute: 1440 })));
  }
  const verified = (userId: string) => db.insert(schema.identityChecks).values({ userId, stripeSessionId: `vs_check_${randomUUID()}`, status: "verified", adult: true, verifiedName: "Checked Person", checkedAt: now });
  const ask = async (customer: { id: string; name: string; email: string }, hostId: string, startsAt: Date) => {
    const offer = await B.offerOf(hostId);
    return B.askForCall({ customer, hostId, startsAt, lengthMinutes: 30, note: "check", requestKey: randomUUID(), agreedToCardTerms: true, seen: { pricePer15Cents: offer?.pricePer15Cents ?? -1, freeCancelMinutes: offer?.freeCancelMinutes ?? -1 }, now });
  };
  const slotsOf = async (hostId: string) => {
    const offer = (await B.offerOf(hostId))!;
    return (await B.openTimes(offer, 30, now)).filter((t) => t.getTime() > now.getTime() + 72 * HOUR);
  };
  const emails = async (to: string, subject: string) => (await db.select().from(schema.emailOutbox).where(and(eq(schema.emailOutbox.to, to), like(schema.emailOutbox.subject, `%${subject}%`)))).length;
  const reloadUser = async (id: string) => (await db.select().from(schema.user).where(eq(schema.user.id, id)))[0];

  const [adminUser] = await db.select().from(schema.user).where(eq(schema.user.email, "admin@test.local"));
  const secretLine = readFileSync("test-accounts.local.md", "utf8").split("\n").find((l) => l.startsWith("admin TOTP secret:"));
  const adminPassword = readFileSync("test-accounts.local.md", "utf8").split("\n").find((l) => l.includes("admin@test.local"))?.split("|").map((c) => c.trim())[3];
  if (!adminUser || !secretLine || !adminPassword) throw new Error("Run npm run seed and npx tsx scripts/secure-test-admin.ts first.");
  const adminSecret = secretLine.replace("admin TOTP secret:", "").trim();

  try {
    // ----------------------------------------------------------------------
    console.log("\n1. The admin's second login step");
    {
      const jar: Jar = new Map();
      const first = await api("/sign-in/email", { email: "admin@test.local", password: adminPassword }, jar);
      check("the password alone does not log the admin in", first.status === 200 && first.json?.twoFactorRedirect === true && !jar.has("better-auth.session_token"), JSON.stringify(first.json));
      check("the admin pages are not reachable yet", (await send("/admin", { jar })).status !== 200);
      const wrong = await api("/two-factor/verify-totp", { code: "000000", trustDevice: false }, jar);
      check("a wrong code is refused", wrong.status !== 200);
      const right = await api("/two-factor/verify-totp", { code: totpCode(adminSecret), trustDevice: false }, jar);
      check("the right code logs the admin in", right.status === 200 && jar.has("better-auth.session_token"), String(right.status));
      check("now the admin pages open", (await send("/admin", { jar })).status === 200 && (await send("/admin/reports", { jar })).status === 200);
      const trust = await send("/api/auth/two-factor/disable", { body: { password: adminPassword }, jar });
      check("the second step cannot be switched off from the app", trust.status === 404, String(trust.status));

      // A login made before the second step was set up does not count as an admin login.
      const [adminRow] = await db.select().from(schema.admins).where(eq(schema.admins.userId, adminUser.id));
      const token = `old-${RUN}`;
      await db.insert(schema.session).values({ id: `old-${RUN}`, token, userId: adminUser.id, expiresAt: new Date(Date.now() + HOUR), createdAt: new Date(adminRow.securedAt!.getTime() - HOUR), updatedAt: new Date() });
      // (Session cookies are signed, so an old session is checked through the gate directly.)
      const { countsAsAdminLogin } = await import("../src/lib/admin-gate");
      const old = await countsAsAdminLogin({ id: adminUser.id, twoFactorEnabled: true, sessionCreatedAt: new Date(adminRow.securedAt!.getTime() - HOUR) });
      const fresh = await countsAsAdminLogin({ id: adminUser.id, twoFactorEnabled: true, sessionCreatedAt: new Date() });
      check("a login from before the second step was set up does not count; a new one does", old === false && fresh === true);
      await db.delete(schema.session).where(eq(schema.session.token, token));

      const stranger = await person("stranger");
      const notAdmin = await countsAsAdminLogin({ id: stranger.id, twoFactorEnabled: true, sessionCreatedAt: new Date() });
      check("someone who is not an admin never counts, second step or not", notAdmin === false);
    }

    // ----------------------------------------------------------------------
    console.log("\n2. The rules must be accepted again when they change");
    {
      const olivia = await person("olivia");
      await db.update(schema.user).set({ termsVersion: "an-old-version" }).where(eq(schema.user.id, olivia.id));
      const [row] = await db.select().from(schema.user).where(eq(schema.user.id, olivia.id));
      check("an account on an old version of the terms is treated as not yet welcomed", row.termsVersion !== TERMS_VERSION);
      // (The gate itself compares the version; the accounts journeys cover the welcome page.)
    }

    // ----------------------------------------------------------------------
    console.log("\n3. Pausing an account");
    {
      const host = await person("host3");
      await makeHost(host, 0);
      await verified(host.id);
      const cust = await person("cust3");
      await verified(cust.id);
      const [slot] = await slotsOf(host.id);
      // A call of theirs that has not started: pausing must cancel it, so nobody waits for (or pays for) a call they may not join.
      const other3 = await person("other3");
      const soon = new Date(Date.now() + 5 * 3_600_000);
      const upcoming = await B.createTestCall({ hostId: other3.id, customerId: cust.id, startsAt: soon, endsAt: new Date(soon.getTime() + 15 * 60_000), pricePer15Cents: 0, freeCancelMinutes: 0 });
      const paused = await R.pauseAccount({ adminId: adminUser.id, userId: cust.id, ruleKey: "harassment", note: "Check.", requestId: randomUUID() });
      const [cancelled] = await db.select().from(schema.calls).where(eq(schema.calls.id, upcoming.callId));
      check("pausing cancels their calls that have not started, at no charge", paused.callsNotEnded === 0 && cancelled.cancelledAt !== null && cancelled.cancelledBy === "admin" && cancelled.cancelledLate === false);
      check("a paused customer cannot ask", await refused(ask(cust, host.id, slot)));
      check("and is told by email, with the rule", (await emails(cust.email, "is paused")) === 1 && Boolean((await reloadUser(cust.id)).pausedReason?.startsWith("No threats")));
      await R.liftPause({ adminId: adminUser.id, userId: cust.id });
      const asked = await ask(cust, host.id, slot);
      check("after the pause is lifted they can", asked.booking.stage === "waiting");
      await R.pauseAccount({ adminId: adminUser.id, userId: host.id, ruleKey: "sexual", note: "", requestId: randomUUID() });
      check("pausing a host ends the requests waiting for them", (await db.select().from(schema.bookings).where(eq(schema.bookings.id, asked.booking.id)))[0].stage === "declined");
      check("a paused host cannot accept, and cannot be booked", (await refused(B.accept({ bookingId: asked.booking.id, hostId: host.id, now }))) && (await B.offerOf(host.id)) === null);
      check("an admin account cannot be paused", await refused(R.pauseAccount({ adminId: adminUser.id, userId: adminUser.id, ruleKey: "scam", note: "", requestId: randomUUID() })));
      check("pausing an account that is already paused is refused", await refused(R.pauseAccount({ adminId: adminUser.id, userId: host.id, ruleKey: "scam", note: "", requestId: randomUUID() })));
      const same = randomUUID();
      await R.warn({ adminId: adminUser.id, userId: host.id, ruleKey: "scam", note: "Once.", requestId: same });
      await R.warn({ adminId: adminUser.id, userId: host.id, ruleKey: "scam", note: "Once.", requestId: same });
      check("sending the same warning form twice warns once", (await emails(host.email, "reminder of the Connect rules")) === 1);
      const actions = await db.select().from(schema.adminActions).where(eq(schema.adminActions.targetUserId, cust.id));
      check("each action is written down", actions.map((a) => a.action).sort().join() === "account paused,pause lifted", actions.map((a) => a.action).join());
    }

    // ----------------------------------------------------------------------
    console.log("\n4. Blocking");
    {
      const host = await person("host4");
      await makeHost(host, 0);
      await verified(host.id);
      const amy = await person("amy");
      const ben = await person("ben");
      await verified(amy.id);
      await verified(ben.id);
      const [s1, , s2, , s3] = await slotsOf(host.id);
      const waiting = await ask(amy, host.id, s1);
      const acceptedReq = await ask(amy, host.id, s2);
      await B.accept({ bookingId: acceptedReq.booking.id, hostId: host.id, now });
      const bens = await ask(ben, host.id, s3);

      await block({ blockerId: host.id, blockedId: amy.id, now });
      const [w, a, b] = await Promise.all([waiting.booking.id, acceptedReq.booking.id, bens.booking.id].map((id) => db.select().from(schema.bookings).where(eq(schema.bookings.id, id)).then((r) => r[0])));
      check("the host's block ends Amy's waiting request and cancels their future call, and leaves Ben's alone", w.stage === "ran_out" && a.stage === "cancelled" && b.stage === "waiting", `${w.stage} ${a.stage} ${b.stage}`);
      check("Amy's time is free again", (await db.select().from(schema.busyEntries).where(eq(schema.busyEntries.userId, amy.id))).length === 0);
      check("Amy is told the call was cancelled, but nothing about a block", (await emails(amy.email, "was cancelled")) === 1 && w.endedReason === "the request could not go ahead");
      check("Amy cannot ask again, and is told only that the time is not open", (await ask(amy, host.id, s1).catch((e) => e.message)) === "That time is no longer open. Please choose another.");
      check("the block works both ways", await isBlockedEitherWay(amy.id, host.id));
      const bensAgain = await ask(ben, host.id, (await slotsOf(host.id))[6]);
      await block({ blockerId: ben.id, blockedId: host.id, now });
      check("a customer's block stops the host accepting their request", (await refused(B.accept({ bookingId: bensAgain.booking.id, hostId: host.id, now }))) && (await db.select().from(schema.bookings).where(eq(schema.bookings.id, bensAgain.booking.id)))[0].stage === "ran_out");
      // Each list of blocked people shows a name its owner already knew: a host by their display name
      // (never their account name), a customer by their own name.
      const bensList = await blockedBy(ben.id);
      const hostsList = await blockedBy(host.id);
      check("a customer's blocked list shows the host by their display name; a host's shows the customer by their own name", bensList.length === 1 && bensList[0].name === `Host ${host.id.slice(-4)}` && hostsList.length === 1 && hostsList[0].name === amy.name, `${bensList[0]?.name} / ${hostsList[0]?.name}`);
      await unblock(host.id, amy.id);
      check("after unblocking, Amy can ask again, but what ended stays ended", (await ask(amy, host.id, s1)).booking.stage === "waiting" && (await db.select().from(schema.bookings).where(eq(schema.bookings.id, acceptedReq.booking.id)))[0].stage === "cancelled");
      check("nobody can block themselves", await refused(block({ blockerId: amy.id, blockedId: amy.id, now })));
    }

    // ----------------------------------------------------------------------
    console.log("\n5. End call and report");
    {
      const [hana] = await db.select().from(schema.user).where(eq(schema.user.email, "host@test.local"));
      const cust = await person("cust5");
      const startsAt = new Date(Date.now() - 60_000);
      const { callId } = await B.createTestCall({ hostId: hana.id, customerId: cust.id, startsAt, endsAt: new Date(startsAt.getTime() + 10 * 60_000), pricePer15Cents: 2000, freeCancelMinutes: 0 });
      const [call] = await db.select().from(schema.calls).where(eq(schema.calls.id, callId));
      const payment = async () => (await db.select().from(schema.payments).where(eq(schema.payments.callId, callId)))[0];
      // The customer pays, as they would on the call page.
      await startHold({ payment: await payment(), call, customer: cust, now: new Date() });
      await stripe().paymentIntents.confirm((await payment()).stripePaymentIntentId!, { payment_method: "pm_card_visa", return_url: "https://example.com/return" });
      await syncHold((await payment()).id, new Date());
      check("the money is held before the call", (await payment()).status === "held");

      await endCallForSafety({ call, by: cust.id, now: new Date() });
      const [ended] = await db.select().from(schema.calls).where(eq(schema.calls.id, callId));
      check("the call is marked as ended for safety, by the customer", ended.safetyEndedAt !== null && ended.safetyEndedBy === cust.id);
      check("the charge goes to the founder's review list instead of being charged automatically", (await payment()).needsReview === true);
      await endCallForSafety({ call, by: hana.id, now: new Date() });
      check("pressing it twice changes nothing", (await db.select().from(schema.calls).where(eq(schema.calls.id, callId)))[0].safetyEndedBy === cust.id);

      console.log("   …and the same through the app, with the clock and the door");
      const [cory] = await db.select().from(schema.user).where(eq(schema.user.email, "customer@test.local"));
      const coryPassword = readFileSync("test-accounts.local.md", "utf8").split("\n").find((l) => l.includes("customer@test.local"))?.split("|").map((c) => c.trim())[3] ?? "";
      const coryJar: Jar = new Map();
      await api("/sign-in/email", { email: "customer@test.local", password: coryPassword }, coryJar);
      const liveStart = new Date(Date.now() - 4 * 60_000);
      const liveHost = await person("livehost5");
      const live = await B.createTestCall({ hostId: liveHost.id, customerId: cory.id, startsAt: liveStart, endsAt: new Date(liveStart.getTime() + 10 * 60_000), pricePer15Cents: 0, freeCancelMinutes: 0 });
      const before = await send(`/api/calls/${live.callId}/token`, { method: "POST", jar: coryJar });
      check("before the stop, the customer can get into the call", before.status === 200, String(before.status));
      const stop = await send(`/api/calls/${live.callId}/end-for-safety`, { method: "POST", jar: coryJar });
      check("the stop button's request is accepted", stop.status === 200, String(stop.status));
      const after = await send(`/api/calls/${live.callId}/token`, { method: "POST", jar: coryJar });
      check("after it, nobody gets back in", after.status === 409, String(after.status));
      const strangerStop = await send(`/api/calls/${callId}/end-for-safety`, { method: "POST", jar: coryJar });
      check("someone not on a call cannot stop it", strangerStop.status === 404, String(strangerStop.status));
      // Only a call that is going on can be ended this way: not one that has yet to open (that would dodge
      // the host's cancelling rule), and not one that is over (that would stop it being charged or rated as usual).
      const later = new Date(Date.now() + 3 * 3_600_000);
      const future = await B.createTestCall({ hostId: liveHost.id, customerId: cory.id, startsAt: later, endsAt: new Date(later.getTime() + 10 * 60_000), pricePer15Cents: 0, freeCancelMinutes: 0 });
      const early = await send(`/api/calls/${future.callId}/end-for-safety`, { method: "POST", jar: coryJar });
      check("a call that has not opened yet cannot be ended this way", early.status === 409 && (await db.select().from(schema.calls).where(eq(schema.calls.id, future.callId)))[0].safetyEndedAt === null, String(early.status));
      const earlier = new Date(Date.now() - 30 * 60_000);
      const over = await B.createTestCall({ hostId: liveHost.id, customerId: cory.id, startsAt: earlier, endsAt: new Date(earlier.getTime() + 10 * 60_000), pricePer15Cents: 0, freeCancelMinutes: 0 });
      const late = await send(`/api/calls/${over.callId}/end-for-safety`, { method: "POST", jar: coryJar });
      check("and a call that is already over is left as it is", late.status === 200 && (await db.select().from(schema.calls).where(eq(schema.calls.id, over.callId)))[0].safetyEndedAt === null, String(late.status));
      // The clock: the host was connected the whole booked time, but only the time before the stop counts.
      const [stopped] = await db.select().from(schema.calls).where(eq(schema.calls.id, live.callId));
      const row = (identity: string, type: string, at: Date) => ({ provider: "livekit", providerEventId: `EV_${randomUUID()}`, callId: live.callId, type, roomSessionId: "RM_safety", participantIdentity: identity, participantSessionId: `PA_${identity}`, providerTime: at, payload: "{}" });
      await db.insert(schema.attendanceEvents).values([row(liveHost.id, "participant_joined", liveStart), row(liveHost.id, "participant_left", stopped.endsAt), row(cory.id, "participant_joined", liveStart), row(cory.id, "participant_left", stopped.endsAt)]);
      await db.update(schema.calls).set({ closedAt: new Date(stopped.endsAt.getTime() + 60_000) }).where(eq(schema.calls.id, live.callId));
      const { loadAttendance } = await import("../src/lib/attendance/load");
      const counted = await loadAttendance({ ...stopped }, new Date(stopped.endsAt.getTime() + 10 * 60_000));
      // Whole seconds, the way the counting rule reads times.
      const expected = Math.floor(stopped.safetyEndedAt!.getTime() / 1000) - Math.floor(liveStart.getTime() / 1000);
      check("time after the stop is not counted", counted.result.totals?.hostSeconds === expected && counted.bookedSeconds === expected, `${counted.result.totals?.hostSeconds} vs ${expected}`);

      const { reference } = await R.createReport({ reporterId: cust.id, context: "call", contextId: callId, reason: "threats", text: "Check: shouting.", now: new Date() });
      const [report] = await db.select().from(schema.reports).where(eq(schema.reports.reference, reference));
      check("the report is about the other person on the call, worked out by the server", report.reportedId === hana.id && report.urgent === true);
      check("the admin is emailed at once because it is urgent", (await emails("admin@test.local", `Urgent report R-${reference}`)) === 1);
      check("reporting also blocks", await isBlockedEitherWay(cust.id, hana.id));
      await unblock(cust.id, hana.id);

      check("a report about a call you are not on is refused", await refused(R.createReport({ reporterId: (await person("nosy")).id, context: "call", contextId: callId, reason: "other", text: "", now: new Date() })));
      check("an unknown reason is refused", await refused(R.createReport({ reporterId: cust.id, context: "call", contextId: callId, reason: "made-up", text: "", now: new Date() })));
      const hidden = await person("hidden5");
      await makeHost(hidden, 0);
      await db.update(schema.hostProfiles).set({ hidden: true }).where(eq(schema.hostProfiles.userId, hidden.id));
      const [hiddenProfile] = await db.select().from(schema.hostProfiles).where(eq(schema.hostProfiles.userId, hidden.id));
      check("a page nobody can see cannot be reported by its address either", await refused(R.createReport({ reporterId: cust.id, context: "profile", contextId: hiddenProfile.handle, reason: "other", text: "", now: new Date() })));

      await R.closeReport({ reportId: report.id, adminId: adminUser.id, note: "Checked." });
      check("closing tells the reporter, with the reference and no more", (await emails(cust.email, `R-${reference} has been looked at`)) === 1);
      check("closing twice is refused", await refused(R.closeReport({ reportId: report.id, adminId: adminUser.id, note: "Again." })));
      await R.warn({ adminId: adminUser.id, userId: hana.id, ruleKey: "harassment", note: "Please be kind.", requestId: randomUUID() });
      check("a warning email names the rule", (await emails("host@test.local", "reminder of the Connect rules")) >= 1);
      const open = await R.openReports();
      check("the founder's list no longer shows it", !open.some((o) => o.report.id === report.id));
    }

    // ----------------------------------------------------------------------
    console.log("\n6. The identity check");
    {
      const newHost = await person("host6");
      await makeHost(newHost, 0);
      await db.update(schema.hostProfiles).set({ status: "pending" }).where(eq(schema.hostProfiles.userId, newHost.id));
      const [profile] = await db.select().from(schema.hostProfiles).where(eq(schema.hostProfiles.userId, newHost.id));
      const approve = () => decideProfile({ userId: newHost.id, decision: "approved", by: adminUser.id, seen: { displayName: profile.displayName, about: profile.about } });
      const before = await approve().catch((e) => e);
      check("a profile cannot be approved before the identity check passes", before instanceof ProfileError);

      const url = await startIdentityCheck(newHost, "https://example.com/return");
      check("a check can be started at Stripe and gives a page to go to", url.startsWith("https://"));
      const state = await refreshIdentity(newHost.id);
      check("until Stripe has an answer, nothing counts as passed", state.passed === false && state.triesLeft === 2, JSON.stringify(state));
      await db.update(schema.identityChecks).set({ status: "verified", adult: true, verifiedName: "Checked Host" }).where(eq(schema.identityChecks.userId, newHost.id));
      check("once passed, approval works", (await approve().then(() => true).catch(() => false)) && (await identityState(newHost.id)).verifiedName === "Checked Host");

      const minor = await person("minor6");
      await db.insert(schema.identityChecks).values({ userId: minor.id, stripeSessionId: `vs_check_${randomUUID()}`, status: "verified", adult: false, checkedAt: now });
      check("a verified person under 18 does not count as passed", (await identityState(minor.id)).passed === false);

      const freeHost = await person("free6");
      await makeHost(freeHost, 0);
      await verified(freeHost.id);
      const fan = await person("fan6");
      const [slot] = await slotsOf(freeHost.id);
      check("a first free call needs the identity check", (await ask(fan, freeHost.id, slot).catch((e) => e.message))?.includes("confirm who you are"));
      await verified(fan.id);
      check("after it, the free call can be asked for", (await ask(fan, freeHost.id, slot)).booking.stage === "waiting");
      const paidHost = await person("paid6");
      await makeHost(paidHost, 2000);
      await verified(paidHost.id);
      await db.update(schema.hostSettings).set({ payoutsReady: true }).where(eq(schema.hostSettings.userId, paidHost.id));
      const unchecked = await person("unchecked6");
      const paidAsk = await ask(unchecked, paidHost.id, (await slotsOf(paidHost.id))[0]).catch((e) => e);
      check("a paid call does not need it", !(paidAsk instanceof Error) && paidAsk.booking.stage === "card", paidAsk instanceof Error ? paidAsk.message : "");
    }

    // ----------------------------------------------------------------------
    console.log("\n7. The stop switches");
    {
      const host = await person("host7");
      await makeHost(host, 0);
      await verified(host.id);
      const cust = await person("cust7");
      await verified(cust.id);
      await setSwitches({ requestsOff: true, joiningOff: false });
      check("with new requests switched off, nobody can ask", (await ask(cust, host.id, (await slotsOf(host.id))[0]).catch((e) => e.message))?.includes("not taking new requests"));
      await setSwitches({ requestsOff: false, joiningOff: false });
      check("switched back on, asking works again", (await ask(cust, host.id, (await slotsOf(host.id))[0])).booking.stage === "waiting");
      check("the switches read back as saved", JSON.stringify(await switches()) === JSON.stringify({ requestsOff: false, joiningOff: false }));
    }
  } finally {
    await setSwitches({ requestsOff: false, joiningOff: false });
    const ids = made.length ? made : ["-"];
    const bookings = await db.select({ id: schema.bookings.id }).from(schema.bookings).where(or(inArray(schema.bookings.customerId, ids), inArray(schema.bookings.hostId, ids)));
    const bookingIds = bookings.map((b) => b.id);
    if (bookingIds.length) {
      await db.delete(schema.busyEntries).where(inArray(schema.busyEntries.bookingId, bookingIds));
      await db.delete(schema.bookings).where(inArray(schema.bookings.id, bookingIds));
    }
    const calls = await db.select({ id: schema.calls.id }).from(schema.calls).where(or(inArray(schema.calls.hostId, ids), inArray(schema.calls.customerId, ids)));
    for (const call of calls) {
      const [payment] = await db.select().from(schema.payments).where(eq(schema.payments.callId, call.id));
      if (payment) continue; // paid test calls are left as test data, like the payments script does
      await db.delete(schema.attendanceEvents).where(eq(schema.attendanceEvents.callId, call.id));
      await db.delete(schema.calls).where(eq(schema.calls.id, call.id));
    }
    await db.delete(schema.reports).where(or(inArray(schema.reports.reporterId, ids), inArray(schema.reports.reportedId, ids)));
    await db.delete(schema.blocks).where(or(inArray(schema.blocks.blockerId, ids), inArray(schema.blocks.blockedId, ids)));
    await db.delete(schema.identityChecks).where(inArray(schema.identityChecks.userId, ids));
    await db.delete(schema.emailOutbox).where(like(schema.emailOutbox.to, `safetycheck-${RUN}-%`));
    for (const id of made) await db.update(schema.hostProfiles).set({ status: "suspended", hidden: true }).where(eq(schema.hostProfiles.userId, id));
  }

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
