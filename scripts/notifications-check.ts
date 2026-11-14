/**
 * Testing tool: the notification journeys against the local app and database,
 * with a pretend sending service (nothing is really sent). Removes what it made.
 *
 * Needs the app running (npm run dev) and the helper stopped: the reminder
 * writers are run here with a pretend clock, so they also write reminders for
 * any other calls in the local database that fall in the shifted windows, and
 * a running helper would send those (and this run's emails) if sending is on.
 * Usage: npx tsx scripts/notifications-check.ts
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { randomUUID } from "node:crypto";
import { and, eq, inArray, like, or } from "drizzle-orm";
import { TERMS_VERSION } from "../src/lib/terms";
import { requireLocalDatabase } from "./local-only";

const BASE = "http://localhost:3000";
// The links in this run's emails point at the app on this computer, whatever .env.local says (it may name a tunnel).
process.env.BETTER_AUTH_URL = BASE;
const RUN = randomUUID().slice(0, 8);
const HOUR = 3_600_000;
const MINUTE = 60_000;

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}

async function main() {
  requireLocalDatabase();
  const { db, schema } = await import("../src/db");
  const { writeCallReminders, writeRequestReminders } = await import("../src/lib/notifications/reminders");
  const delivery = await import("../src/lib/notifications/delivery");
  const { deliverEmails, suppressAddress } = delivery;
  type Transport = Parameters<typeof deliverEmails>[1] & object;
  const { sendEmail, queueEmail } = await import("../src/lib/email");
  const { answerDeadline } = await import("../src/lib/booking/rules");

  const now = new Date();
  // Sending touches only this run's emails, never other rows in the outbox.
  const ONLY = { toLike: `notifycheck-${RUN}-%` };
  const made: string[] = [];
  async function person(name: string) {
    const id = `nt-${RUN}-${name}`;
    const email = `notifycheck-${RUN}-${name}@example.test`;
    await db.insert(schema.user).values({ id, name: `Check ${name}`, email, emailVerified: true, adultConfirmedAt: now, termsAcceptedAt: now, termsVersion: TERMS_VERSION, timeZone: "America/New_York" });
    made.push(id);
    return { id, name: `Check ${name}`, email };
  }
  const call = async (hostId: string, customerId: string, startsAt: Date, paid = false) =>
    (await db.insert(schema.calls).values({ hostId, customerId, startsAt, endsAt: new Date(startsAt.getTime() + 30 * MINUTE), roomName: `notify-${randomUUID()}`, pricePer15Cents: paid ? 2000 : 0 }).returning())[0];
  const rows = (to: string, subject: string) => db.select().from(schema.emailOutbox).where(and(eq(schema.emailOutbox.to, to), like(schema.emailOutbox.subject, `%${subject}%`)));
  const row = async (id: string) => (await db.select().from(schema.emailOutbox).where(eq(schema.emailOutbox.id, id)))[0];

  try {
    // ----------------------------------------------------------------------
    console.log("\n1. Reminders before a call");
    {
      const host = await person("host1");
      const cust = await person("cust1");
      await db.insert(schema.hostProfiles).values({ userId: host.id, handle: `nt${RUN}h1`, handleKey: `nt${RUN}h1`, displayName: "Host One", pricePer15Cents: 2000, status: "approved", usConfirmedAt: now });
      const c = await call(host.id, cust.id, new Date(now.getTime() + 23.5 * HOUR), true);
      await db.insert(schema.payments).values({ callId: c.id, coversFrom: c.startsAt, coversUntil: c.endsAt, pricePer15Cents: 2000, bookedCents: 4000, feePercentBps: 490, feeFixedCents: 30, feeForeignCardBps: 150 });
      await writeCallReminders(now);
      await writeCallReminders(now);
      const toCust = await rows(cust.email, "Tomorrow");
      const toHost = await rows(host.email, "Tomorrow");
      check("the day-before reminder is written once for each person", toCust.length === 1 && toHost.length === 1, `${toCust.length} ${toHost.length}`);
      check("it names the host by their display name, and says what counts for money", toCust[0].body.includes("Host One") && toCust[0].body.includes("5 minutes before the start are not counted"));
      check("it has an unsubscribe link and the one-click headers", toCust[0].body.includes("/unsubscribe?token=") && JSON.parse(toCust[0].headers ?? "{}")["List-Unsubscribe-Post"] === "List-Unsubscribe=One-Click");
      check("it is dropped if it has not gone 12 hours before the call (a late 'Tomorrow' would be wrong)", toCust[0].expiresAt?.getTime() === c.startsAt.getTime() - 12 * HOUR);

      await writeCallReminders(new Date(c.startsAt.getTime() - 45 * MINUTE));
      check("the hour-before reminder arrives in its window", (await rows(cust.email, "In an hour")).length === 1);
      await writeCallReminders(new Date(c.startsAt.getTime() - 3 * MINUTE));
      const open = await rows(cust.email, "room is open");
      check("the room-open reminder says the room is open and links to the call", open.length === 1 && open[0].body.includes(`/calls/${c.id}`));
      await writeCallReminders(new Date(c.startsAt.getTime() + MINUTE));
      check("nothing more once the call has started", (await rows(cust.email, "")).length === 3);

      const late = await call(host.id, cust.id, new Date(now.getTime() + 22 * HOUR));
      await writeCallReminders(now);
      check("a helper that comes back late does not send a stale day-before reminder", (await rows(cust.email, "Tomorrow")).length === 1);
      void late;

      const cancelled = await call(host.id, cust.id, new Date(now.getTime() + 23.6 * HOUR));
      await db.update(schema.calls).set({ cancelledAt: now, cancelledBy: "host" }).where(eq(schema.calls.id, cancelled.id));
      const quiet = await person("quiet1");
      await db.update(schema.user).set({ reminderEmails: false }).where(eq(schema.user.id, quiet.id));
      const forQuiet = await call(host.id, quiet.id, new Date(now.getTime() + 23.7 * HOUR));
      await writeCallReminders(now);
      check("no reminders for a cancelled call, or for someone who switched them off", (await rows(cust.email, "Tomorrow")).length === 1 && (await rows(quiet.email, "")).length === 0);
      void forQuiet;
    }

    // ----------------------------------------------------------------------
    console.log("\n2. A request about to run out");
    {
      const host = await person("host2");
      const cust = await person("cust2");
      const startsAt = new Date(now.getTime() + 5 * 24 * HOUR);
      const respondBy = answerDeadline({ startsAt, paid: false, freeCancelMinutes: 0, requestedAt: new Date(now.getTime() - 22.5 * HOUR) });
      const [booking] = await db.insert(schema.bookings).values({ hostId: host.id, customerId: cust.id, startsAt, endsAt: new Date(startsAt.getTime() + 30 * MINUTE), lengthMinutes: 30, breakMinutes: 5, pricePer15Cents: 0, totalCents: 0, freeCancelMinutes: 0, stage: "waiting", requestKey: randomUUID(), requestedAt: new Date(now.getTime() - 22.5 * HOUR), respondBy }).returning();
      await writeRequestReminders(now);
      await writeRequestReminders(now);
      const reminders = await rows(host.email, "runs out soon");
      check("the host is reminded once, about 90 minutes before the deadline", reminders.length === 1 && reminders[0].expiresAt?.getTime() === respondBy.getTime(), `${reminders.length}`);
      await db.update(schema.bookings).set({ stage: "declined" }).where(eq(schema.bookings.id, booking.id));
    }

    // ----------------------------------------------------------------------
    console.log("\n3. Stopping reminder emails from a link");
    {
      const hostId = `nt-${RUN}-host1`;
      const [person1] = await db.select().from(schema.user).where(eq(schema.user.id, `nt-${RUN}-cust1`));
      if (!person1?.unsubscribeToken) throw new Error("the customer from journey 1 has no unsubscribe token; journey 1 should have made one");
      const token = person1.unsubscribeToken;
      const opened = await fetch(`${BASE}/unsubscribe?token=${token}`, { redirect: "manual" });
      check("opening the link changes nothing (scanners open links)", opened.status === 200 && (await db.select().from(schema.user).where(eq(schema.user.id, person1.id)))[0].reminderEmails === true);
      const bad = await fetch(`${BASE}/api/unsubscribe?token=not-a-real-token-at-all`, { method: "POST" });
      check("a made-up token is refused", bad.status === 404);
      // The one-click address is the one advertised in the email's own header, posted the way mail programs do it.
      const [reminder] = await rows(person1.email, "Tomorrow");
      const oneClick = (JSON.parse(reminder.headers ?? "{}")["List-Unsubscribe"] as string).replace(/^<|>$/g, "");
      const clicked = await fetch(oneClick, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click" });
      check("the one-click way (the header's address) switches reminders off for that person only", oneClick.includes("/api/unsubscribe?token=") && clicked.status === 200 && (await db.select().from(schema.user).where(eq(schema.user.id, person1.id)))[0].reminderEmails === false && (await db.select().from(schema.user).where(eq(schema.user.id, hostId)))[0].reminderEmails === true);
      // A new call, due for a reminder right now: nothing is written for the person who opted out, and the host still gets theirs.
      const later = await call(hostId, person1.id, new Date(now.getTime() + 50 * MINUTE));
      await writeCallReminders(now);
      check("and no more reminders are written for them", (await rows(person1.email, "In an hour")).length === 1 && (await db.select().from(schema.emailOutbox).where(like(schema.emailOutbox.dedupeKey, `reminder:${later.id}:%`))).length === 1);
      // A reminder already waiting in the outbox when they opt out is not sent either.
      const [queuedEarlier] = await db.select().from(schema.emailOutbox).where(eq(schema.emailOutbox.dedupeKey, `reminder:${later.id}:${hostId}:hour`));
      await db.update(schema.user).set({ reminderEmails: false }).where(eq(schema.user.id, hostId));
      await deliverEmails(new Date(), async () => ({ ok: true, providerId: "should-not-send" }), ONLY);
      const afterOptOut = await row(queuedEarlier.id);
      check("a reminder already written is dropped if the person opts out before it is sent", afterOptOut.status === "failed" && (afterOptOut.lastError ?? "").includes("switched off"), `${afterOptOut.status} ${afterOptOut.lastError}`);
      await db.update(schema.user).set({ reminderEmails: true }).where(eq(schema.user.id, hostId));
    }

    // ----------------------------------------------------------------------
    console.log("\n4. Sending, with a pretend sending service");
    {
      const sentTo: string[] = [];
      const idsSeen: string[] = [];
      const fake = (behaviour: "ok" | "temporary" | "permanent"): Transport => async (email) => {
        idsSeen.push(email.id);
        if (behaviour === "ok") {
          sentTo.push(email.to);
          return { ok: true, providerId: `fake_${email.id.slice(0, 8)}` };
        }
        return { ok: false, permanent: behaviour === "permanent", error: behaviour };
      };
      const addr = (name: string) => `notifycheck-${RUN}-${name}@example.test`;

      await sendEmail({ to: addr("link"), kind: "confirm", subject: "Confirm your email address for Connect", text: "http://localhost:3000/api/auth/verify-email?token=secret" });
      const [link] = await rows(addr("link"), "Confirm");
      await deliverEmails(new Date(), fake("ok"), ONLY);
      const linkAfter = await row(link.id);
      check("a queued email is sent once, recorded with the service's reference, and its login link is purged", linkAfter.status === "sent" && Boolean(linkAfter.providerId?.startsWith("fake_")) && linkAfter.body === "" && idsSeen.includes(link.id), linkAfter.status);
      check("the email's own ID is what the service is given as the idempotency key", idsSeen.includes(link.id) && idsSeen.every((id) => /^[0-9a-f-]{36}$/.test(id)));
      await deliverEmails(new Date(), fake("ok"), ONLY);
      check("sent emails are not sent again", sentTo.filter((t) => t === addr("link")).length === 1);

      await db.transaction((tx) => queueEmail(tx, { to: addr("flaky"), subject: "Flaky", text: "x", key: `flaky:${RUN}` }));
      const [flaky] = await rows(addr("flaky"), "Flaky");
      await deliverEmails(new Date(), fake("temporary"), ONLY);
      const once = await row(flaky.id);
      check("a temporary failure is tried again later, not at once", once.status === "queued" && once.attempts === 1 && once.nextAttemptAt > now && once.leaseUntil === null, `${once.status} ${once.attempts}`);
      await deliverEmails(new Date(), fake("ok"), ONLY);
      check("not before its time", (await row(flaky.id)).status === "queued");
      await deliverEmails(new Date(once.nextAttemptAt.getTime() + 1000), fake("ok"), ONLY);
      check("then it goes", (await row(flaky.id)).status === "sent");

      await db.transaction((tx) => queueEmail(tx, { to: addr("dead"), subject: "Dead", text: "x", key: `dead:${RUN}` }));
      const [dead] = await rows(addr("dead"), "Dead");
      await deliverEmails(new Date(), fake("permanent"), ONLY);
      check("a permanent refusal is recorded as failed, with the reason", (await row(dead.id)).status === "failed" && (await row(dead.id)).lastError === "permanent");

      await suppressAddress(addr("gone"), "bounced");
      await db.transaction((tx) => queueEmail(tx, { to: addr("gone"), subject: "Gone", text: "x", key: `gone:${RUN}` }));
      const [gone] = await rows(addr("gone"), "Gone");
      await deliverEmails(new Date(), fake("ok"), ONLY);
      check("an address that bounced is never written to again", (await row(gone.id)).status === "failed" && !sentTo.includes(addr("gone")));

      // Someone who marked our email as spam gets no more reminders or event emails, but still the login link they ask for.
      await suppressAddress(addr("spam"), "complained");
      await db.transaction((tx) => queueEmail(tx, { to: addr("spam"), subject: "Spam event", text: "x", key: `spam:${RUN}` }));
      await sendEmail({ to: addr("spam"), kind: "reset", subject: "Reset your Connect password", text: "http://localhost:3000/reset-password?token=secret" });
      const [spamEvent] = await rows(addr("spam"), "Spam event");
      const [spamReset] = await rows(addr("spam"), "Reset");
      await deliverEmails(new Date(), fake("ok"), ONLY);
      check("an address that complained gets no event email, but does get a password reset it asked for", (await row(spamEvent.id)).status === "failed" && (await row(spamReset.id)).status === "sent", `${(await row(spamEvent.id)).status} ${(await row(spamReset.id)).status}`);

      // "Slow down" from the service is not a try: the email goes back as it was, due after the wait, and the batch stops.
      await db.transaction((tx) => queueEmail(tx, { to: addr("busy"), subject: "Busy", text: "x", key: `busy:${RUN}` }));
      const [busy] = await rows(addr("busy"), "Busy");
      // Measured against the moments around the delivery itself, so a slow computer cannot fail this check.
      const before = Date.now();
      await deliverEmails(new Date(), async () => ({ ok: false, permanent: false, error: "429 rate_limit_exceeded", slowDown: 2000 }), ONLY);
      const after = Date.now();
      const slowed = await row(busy.id);
      check("being asked to slow down does not count as a try, and the email is due again shortly", slowed.status === "queued" && slowed.attempts === 0 && slowed.firstTriedAt === null && slowed.nextAttemptAt.getTime() >= before + 2000 && slowed.nextAttemptAt.getTime() <= after + 2000, `${slowed.status} ${slowed.attempts}`);
      await db.update(schema.emailOutbox).set({ nextAttemptAt: new Date() }).where(eq(schema.emailOutbox.id, busy.id));
      await deliverEmails(new Date(), fake("ok"), ONLY);
      check("and then it goes", (await row(busy.id)).status === "sent");

      // A row that used up its tries without ever recording an outcome (a helper died each time) is closed, not tried again.
      await db.transaction((tx) => queueEmail(tx, { to: addr("worn"), subject: "Worn out", text: "x", key: `worn:${RUN}` }));
      const [worn] = await rows(addr("worn"), "Worn out");
      await db.update(schema.emailOutbox).set({ status: "sending", attempts: 6, firstTriedAt: new Date(now.getTime() - HOUR), leaseUntil: new Date(now.getTime() - 5 * MINUTE) }).where(eq(schema.emailOutbox.id, worn.id));
      await deliverEmails(new Date(), fake("ok"), ONLY);
      check("an email that used up its tries without an outcome is closed, not tried for ever", (await row(worn.id)).status === "failed" && !idsSeen.includes(worn.id), (await row(worn.id)).lastError ?? "");

      await db.transaction((tx) => queueEmail(tx, { to: addr("old"), subject: "Old", text: "x", key: `old:${RUN}`, expiresAt: new Date(now.getTime() - 1000) }));
      const [old] = await rows(addr("old"), "Old");
      await deliverEmails(new Date(), fake("ok"), ONLY);
      check("an email that has expired is not sent", (await row(old.id)).status === "failed" && !sentTo.includes(addr("old")));

      await db.transaction((tx) => queueEmail(tx, { to: addr("lost"), subject: "Lost", text: "x", key: `lost:${RUN}` }));
      const [lost] = await rows(addr("lost"), "Lost");
      await db.update(schema.emailOutbox).set({ attempts: 2, lastError: "unknown or temporary: timeout", firstTriedAt: new Date(now.getTime() - 25 * HOUR), createdAt: new Date(now.getTime() - 26 * HOUR) }).where(eq(schema.emailOutbox.id, lost.id));
      await deliverEmails(new Date(), fake("ok"), ONLY);
      check("a try whose answer was lost more than a day ago is not repeated blindly", (await row(lost.id)).status === "failed" && !sentTo.includes(addr("lost")));

      // A helper that died mid-send: the row sits in "sending" with a lease that has run out. It is picked up again
      // (the same ID goes to the service, which remembers it for a day), and the login link is not kept once it is out.
      await db.transaction((tx) => queueEmail(tx, { to: addr("crashed"), subject: "Crashed", text: "x", key: `crashed:${RUN}` }));
      const [crashed] = await rows(addr("crashed"), "Crashed");
      await db.update(schema.emailOutbox).set({ status: "sending", attempts: 1, firstTriedAt: new Date(now.getTime() - 10 * MINUTE), leaseUntil: new Date(now.getTime() - 5 * MINUTE), lastError: "unknown: the sending service was asked and has not answered yet" }).where(eq(schema.emailOutbox.id, crashed.id));
      await deliverEmails(new Date(), fake("ok"), ONLY);
      const recovered = await row(crashed.id);
      check("an email left mid-send by a helper that died is picked up again with the same ID, once", recovered.status === "sent" && recovered.attempts === 2 && idsSeen.filter((id) => id === crashed.id).length === 1, `${recovered.status} ${recovered.attempts}`);
      // The same, but the lost try is older than the service's memory: it is not repeated.
      await db.update(schema.emailOutbox).set({ status: "sending", attempts: 1, firstTriedAt: new Date(now.getTime() - 26 * HOUR), leaseUntil: new Date(now.getTime() - 5 * MINUTE) }).where(eq(schema.emailOutbox.id, crashed.id));
      await deliverEmails(new Date(), fake("ok"), ONLY);
      check("but not if that lost try is more than a day old", (await row(crashed.id)).status === "failed" && idsSeen.filter((id) => id === crashed.id).length === 1);

      // Expired login emails lose their link text even when nothing is being sent.
      await db.transaction((tx) => queueEmail(tx, { to: addr("stale"), subject: "Stale link", text: "secret-link", key: `stale:${RUN}`, expiresAt: new Date(now.getTime() - MINUTE) }));
      const [stale] = await rows(addr("stale"), "Stale link");
      await db.update(schema.emailOutbox).set({ kind: "confirm" }).where(eq(schema.emailOutbox.id, stale.id));
      await delivery.expireStaleEmails(new Date(), ONLY);
      check("an expired login email is closed and its link text purged, whether or not sending is set up", (await row(stale.id)).status === "failed" && (await row(stale.id)).body === "");

      // Two helpers at once: each email goes out once.
      for (let i = 0; i < 6; i++) await db.transaction((tx) => queueEmail(tx, { to: addr(`many${i}`), subject: "Many", text: "x", key: `many:${RUN}:${i}` }));
      // Batches are small and the outbox may hold older rows too, so keep going until nothing is left.
      for (let i = 0; i < 10; i++) {
        const [a, b] = await Promise.all([deliverEmails(new Date(), fake("ok"), ONLY), deliverEmails(new Date(), fake("ok"), ONLY)]);
        if (a + b === 0) break;
      }
      const manyIds = (await db.select({ id: schema.emailOutbox.id }).from(schema.emailOutbox).where(like(schema.emailOutbox.dedupeKey, `many:${RUN}:%`))).map((r) => r.id);
      check("two helpers sending at the same time send each email exactly once", manyIds.length === 6 && manyIds.every((id) => idsSeen.filter((seen) => seen === id).length === 1), String(sentTo.filter((t) => t.includes("many")).length));
    }
  } finally {
    const ids = made.length ? made : ["-"];
    const calls = await db.select({ id: schema.calls.id }).from(schema.calls).where(or(inArray(schema.calls.hostId, ids), inArray(schema.calls.customerId, ids)));
    for (const c of calls) {
      await db.delete(schema.payments).where(eq(schema.payments.callId, c.id));
      await db.delete(schema.calls).where(eq(schema.calls.id, c.id));
    }
    await db.delete(schema.bookings).where(or(inArray(schema.bookings.hostId, ids), inArray(schema.bookings.customerId, ids)));
    await db.delete(schema.hostProfiles).where(inArray(schema.hostProfiles.userId, ids));
    await db.delete(schema.emailOutbox).where(like(schema.emailOutbox.to, `notifycheck-${RUN}-%`));
    await db.delete(schema.emailSuppressions).where(like(schema.emailSuppressions.address, `notifycheck-${RUN}-%`));
    await db.delete(schema.user).where(inArray(schema.user.id, ids));
  }

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
