/**
 * Sending what is in the outbox, through Resend when a key is set.
 *
 * The rules: a row is claimed before the network is touched, so two helpers
 * never send the same email; the row's own ID is the idempotency key, so a
 * retry after a lost answer cannot send twice; a try older than Resend's
 * 24-hour memory whose answer was lost is never repeated blindly; a helper that
 * died mid-send leaves a lease that runs out, after which the row is picked up
 * again; bounced or complaining addresses are not written to again; and nothing
 * is sent after it has expired, or once the person or the call it is about no
 * longer wants it.
 */
import { and, eq, isNull, like, lte, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { SUPPORT_EMAIL } from "@/lib/terms";

/** How many emails one call of deliverEmails sends at most. */
const BATCH = 20;
const LEASE_MS = 2 * 60_000;
const MAX_ATTEMPTS = 6;
/** Waits before the next try: a minute, five, thirty, two hours, eight hours. */
const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3_600_000, 8 * 3_600_000];
const IDEMPOTENCY_MEMORY_MS = 24 * 3_600_000;
/** A reasonable day's worth of event and reminder emails to one address. Login emails have their own limits. */
const DAILY_CAP_PER_ADDRESS = 50;

/** For test scripts only: touch nothing but emails to matching addresses, so a check never changes other rows. */
export type Only = { toLike: string };

export type Outcome = { ok: true; providerId: string } | { ok: false; permanent: boolean; error: string };
export type Transport = (email: { id: string; to: string; subject: string; text: string; headers: Record<string, string> }) => Promise<Outcome>;

export function deliveryConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

export function fromAddress(): string {
  return process.env.EMAIL_FROM || "Connect <notifications@connect.example>";
}

/** Resend's HTTP API, called directly. The row ID is the idempotency key. */
export const resendTransport: Transport = async (email) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, "content-type": "application/json", "idempotency-key": email.id },
      body: JSON.stringify({ from: fromAddress(), to: [email.to], reply_to: SUPPORT_EMAIL, subject: email.subject, text: email.text, headers: email.headers }),
      signal: controller.signal,
    });
    const body = (await response.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
    if (response.ok && body.id) return { ok: true, providerId: body.id };
    // Permanent: the request itself is bad (a bad address, a bad payload). Temporary: too many
    // requests, an earlier try with this key still in progress (409), a key or domain that is
    // not set up yet (401/403: fixed by configuration, so the retries give it time), or 5xx.
    const stillRunning = response.status === 409 && body.name === "concurrent_idempotent_requests";
    const permanent = response.status >= 400 && response.status < 500 && ![401, 403, 429].includes(response.status) && !stillRunning;
    return { ok: false, permanent, error: `${response.status} ${body.name ?? ""} ${body.message ?? ""}`.trim() };
  } catch (error) {
    return { ok: false, permanent: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
};

/** Marks an address as one we must not write to again (the sending service says it bounces or complained). */
export async function suppressAddress(address: string, reason: string): Promise<void> {
  await db.insert(schema.emailSuppressions).values({ address: address.trim().toLowerCase(), reason }).onConflictDoNothing();
}

const isLoginEmail = (kind: string) => kind === "confirm" || kind === "reset";

/**
 * Expired emails are closed whether or not sending is set up, and login links
 * are never kept past their time.
 */
export async function expireStaleEmails(now: Date): Promise<number> {
  const rows = await db
    .update(schema.emailOutbox)
    .set({ status: "failed", lastError: "expired before it could be sent", leaseUntil: null, body: sql`case when ${schema.emailOutbox.kind} in ('confirm', 'reset') then '' else ${schema.emailOutbox.body} end` })
    .where(and(or(eq(schema.emailOutbox.status, "queued"), and(eq(schema.emailOutbox.status, "sending"), lte(schema.emailOutbox.leaseUntil, now))), lte(schema.emailOutbox.expiresAt, now)))
    .returning({ id: schema.emailOutbox.id });
  return rows.length;
}

/**
 * Claims one due email for this helper, so no other helper touches it for a
 * while. A row left in "sending" by a helper that died is claimed again once
 * its lease has run out; whether that earlier try reached the service is then
 * unknown, which the idempotency key makes safe for a day.
 */
async function claimOne(now: Date, only?: Only): Promise<typeof schema.emailOutbox.$inferSelect | undefined> {
  return db.transaction(async (tx) => {
    const [due] = await tx
      .select({ id: schema.emailOutbox.id })
      .from(schema.emailOutbox)
      .where(
        and(
          or(
            // (The database keeps microseconds and the clock passed in has milliseconds: compare at the same precision.)
            and(eq(schema.emailOutbox.status, "queued"), sql`date_trunc('milliseconds', ${schema.emailOutbox.nextAttemptAt}) <= ${now.toISOString()}::timestamptz`, or(isNull(schema.emailOutbox.leaseUntil), lte(schema.emailOutbox.leaseUntil, now))),
            and(eq(schema.emailOutbox.status, "sending"), lte(schema.emailOutbox.leaseUntil, now)),
          ),
          only ? like(schema.emailOutbox.to, only.toLike) : undefined,
        ),
      )
      .orderBy(schema.emailOutbox.nextAttemptAt)
      .limit(1)
      .for("update", { skipLocked: true });
    if (!due) return undefined;
    // The lease runs from the real clock, however long the batch has been going.
    const [row] = await tx.update(schema.emailOutbox).set({ status: "sending", leaseUntil: new Date(Math.max(now.getTime(), Date.now()) + LEASE_MS) }).where(eq(schema.emailOutbox.id, due.id)).returning();
    return row;
  });
}

type Claimed = Pick<typeof schema.emailOutbox.$inferSelect, "id" | "leaseUntil">;

/** Only the helper holding the current lease may write; a helper whose lease ran out and was taken over writes nothing. */
function ownedBy(email: Claimed) {
  return and(eq(schema.emailOutbox.id, email.id), eq(schema.emailOutbox.status, "sending"), eq(schema.emailOutbox.leaseUntil, email.leaseUntil!));
}

async function finish(email: Claimed, values: Partial<typeof schema.emailOutbox.$inferInsert>): Promise<void> {
  await db.update(schema.emailOutbox).set({ ...values, leaseUntil: null }).where(ownedBy(email));
}

async function fail(email: typeof schema.emailOutbox.$inferSelect, reason: string): Promise<void> {
  // A login link is not kept once the email will never go.
  await finish(email, { status: "failed", lastError: reason, ...(isLoginEmail(email.kind) ? { body: "" } : {}) });
}

/**
 * A reminder written earlier may no longer be wanted when its turn comes:
 * the person switched reminders off, was paused or closed, the call was
 * cancelled, or the request was answered. Returns why not, or null.
 */
async function noLongerWanted(email: typeof schema.emailOutbox.$inferSelect): Promise<string | null> {
  const key = email.dedupeKey ?? "";
  const reminder = key.match(/^reminder:([^:]+):([^:]+):/);
  const expiring = key.match(/^expiring:(.+)$/);
  if (!reminder && !expiring) return null;
  let userId: string;
  if (reminder) {
    const [call] = await db.select({ cancelledAt: schema.calls.cancelledAt, safetyEndedAt: schema.calls.safetyEndedAt }).from(schema.calls).where(eq(schema.calls.id, reminder[1]));
    if (!call || call.cancelledAt || call.safetyEndedAt) return "the call is no longer happening";
    userId = reminder[2];
  } else {
    const [booking] = await db.select({ stage: schema.bookings.stage, hostId: schema.bookings.hostId }).from(schema.bookings).where(eq(schema.bookings.id, expiring![1]));
    if (!booking || booking.stage !== "waiting") return "the request has been answered or has ended";
    userId = booking.hostId;
  }
  const [person] = await db.select({ reminderEmails: schema.user.reminderEmails, closedAt: schema.user.closedAt, pausedAt: schema.user.pausedAt }).from(schema.user).where(eq(schema.user.id, userId));
  if (!person || person.closedAt) return "the account is closed";
  if (person.pausedAt) return "the account is paused";
  if (!person.reminderEmails) return "reminders are switched off";
  return null;
}

/**
 * Sends up to a batch of due emails, one claim at a time so a claim never
 * outlives its lease. `transport` is Resend unless a test passes something else.
 * Returns how many were sent.
 */
export async function deliverEmails(now: Date, transport: Transport = resendTransport, only?: Only): Promise<number> {
  await expireStaleEmails(now);
  if (transport === resendTransport && !deliveryConfigured()) return 0;
  let sent = 0;
  for (let i = 0; i < BATCH; i++) {
    const email = await claimOne(now, only);
    if (!email) break;
    // Time moves on while a batch is being sent; every check uses the real clock.
    const at = new Date(Math.max(now.getTime(), Date.now()));
    try {
      // Checked right before sending: still worth sending, and to an address we may write to.
      if (email.expiresAt && email.expiresAt <= at) {
        await fail(email, "expired before it could be sent");
        continue;
      }
      const [bad] = await db.select().from(schema.emailSuppressions).where(eq(schema.emailSuppressions.address, email.to));
      if (bad) {
        await fail(email, `address not written to: ${bad.reason}`);
        continue;
      }
      const why = await noLongerWanted(email);
      if (why) {
        await fail(email, `no longer wanted: ${why}`);
        continue;
      }
      if (email.kind === "booking") {
        const [{ today }] = await db
          .select({ today: sql<number>`count(*)::int` })
          .from(schema.emailOutbox)
          .where(and(eq(schema.emailOutbox.to, email.to), eq(schema.emailOutbox.status, "sent"), sql`${schema.emailOutbox.sentAt} > ${new Date(at.getTime() - 24 * 3_600_000).toISOString()}::timestamptz`));
        if (today >= DAILY_CAP_PER_ADDRESS) {
          // Waiting is not a try: it does not count against the attempts.
          await finish(email, { status: "queued", nextAttemptAt: new Date(at.getTime() + 3_600_000), lastError: "waiting: this address has had a lot of email today" });
          continue;
        }
      }
      // A try whose answer was lost more than a day ago cannot be repeated safely: Resend has forgotten the key.
      if (email.attempts > 0 && email.firstTriedAt && at.getTime() - email.firstTriedAt.getTime() > IDEMPOTENCY_MEMORY_MS) {
        await fail(email, "an earlier try is more than a day old and its outcome is unknown; not repeated. Check at the sending service");
        continue;
      }

      // Counted as a try right before the service is asked, so a crash from here on is treated as an unknown outcome.
      const [tried] = await db
        .update(schema.emailOutbox)
        .set({ attempts: sql`${schema.emailOutbox.attempts} + 1`, firstTriedAt: sql`coalesce(${schema.emailOutbox.firstTriedAt}, ${at.toISOString()}::timestamptz)`, lastError: "unknown: the sending service was asked and has not answered yet" })
        .where(ownedBy(email))
        .returning({ attempts: schema.emailOutbox.attempts });
      // The lease was taken over by another helper (this one was too slow): it sends, not us.
      if (!tried) continue;
      const outcome = await transport({ id: email.id, to: email.to, subject: email.subject, text: email.body, headers: email.headers ? (JSON.parse(email.headers) as Record<string, string>) : {} });
      if (outcome.ok) {
        // Login links are not kept once the email is out.
        await finish(email, { status: "sent", sentAt: new Date(), providerId: outcome.providerId, lastError: null, ...(isLoginEmail(email.kind) ? { body: "" } : {}) });
        sent++;
      } else if (outcome.permanent || tried.attempts >= MAX_ATTEMPTS) {
        await fail(email, outcome.error);
        console.error(`[email] could not send ${email.id} to ${email.to}: ${outcome.error}`);
      } else {
        const wait = BACKOFF_MS[Math.min(tried.attempts - 1, BACKOFF_MS.length - 1)];
        await finish(email, { status: "queued", nextAttemptAt: new Date(at.getTime() + wait), lastError: `unknown or temporary: ${outcome.error}` });
      }
    } catch (error) {
      // Something went wrong on our side. The lease runs out and the email is claimed again.
      console.error(`[email] delivery of ${email.id} failed; will retry`, error);
    }
  }
  return sent;
}
