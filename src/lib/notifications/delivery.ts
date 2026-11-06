/**
 * Sending what is in the outbox, through Resend when a key is set.
 *
 * The rules: a row is claimed before the network is touched, so two helpers
 * never send the same email; the row's own ID is the idempotency key, so a
 * retry after a lost answer cannot send twice; a lost answer older than
 * Resend's 24-hour memory is never retried blindly; bounced or complaining
 * addresses are not written to again; and nothing is sent after it has
 * expired or once the call it is about is gone.
 */
import { and, eq, isNull, lte, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { SUPPORT_EMAIL } from "@/lib/terms";

const BATCH = 20;
const LEASE_MS = 2 * 60_000;
const MAX_ATTEMPTS = 6;
/** Waits before the next try: a minute, five, thirty, two hours, eight hours. */
const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3_600_000, 8 * 3_600_000];
const IDEMPOTENCY_MEMORY_MS = 24 * 3_600_000;
/** A reasonable day's worth of event and reminder emails to one address. Login emails have their own limits. */
const DAILY_CAP_PER_ADDRESS = 50;

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
    // 4xx (other than too many requests) means this email will never go: a bad address, a bad key, a bad domain.
    const permanent = response.status >= 400 && response.status < 500 && response.status !== 429;
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

/** Claims a batch of due emails for this helper, so no other helper touches them for a while. */
async function claim(now: Date): Promise<(typeof schema.emailOutbox.$inferSelect)[]> {
  return db.transaction(async (tx) => {
    const due = await tx
      .select({ id: schema.emailOutbox.id })
      .from(schema.emailOutbox)
      .where(and(eq(schema.emailOutbox.status, "queued"), lte(schema.emailOutbox.nextAttemptAt, now), or(isNull(schema.emailOutbox.leaseUntil), lte(schema.emailOutbox.leaseUntil, now))))
      .orderBy(schema.emailOutbox.nextAttemptAt)
      .limit(BATCH)
      .for("update", { skipLocked: true });
    if (due.length === 0) return [];
    const ids = due.map((d) => d.id);
    return tx
      .update(schema.emailOutbox)
      .set({ status: "sending", leaseUntil: new Date(now.getTime() + LEASE_MS), attempts: sql`${schema.emailOutbox.attempts} + 1` })
      .where(sql`${schema.emailOutbox.id} in ${ids}`)
      .returning();
  });
}

async function finish(id: string, values: Partial<typeof schema.emailOutbox.$inferInsert>): Promise<void> {
  await db.update(schema.emailOutbox).set({ ...values, leaseUntil: null }).where(eq(schema.emailOutbox.id, id));
}

/**
 * Sends one batch. `transport` is Resend unless a test passes something else.
 * Returns how many were sent.
 */
export async function deliverEmails(now: Date, transport: Transport = resendTransport): Promise<number> {
  if (transport === resendTransport && !deliveryConfigured()) return 0;
  const batch = await claim(now);
  let sent = 0;
  for (const email of batch) {
    try {
      // Checked right before sending: still worth sending, and to an address we may write to.
      if (email.expiresAt && email.expiresAt <= now) {
        await finish(email.id, { status: "failed", lastError: "expired before it could be sent" });
        continue;
      }
      const [bad] = await db.select().from(schema.emailSuppressions).where(eq(schema.emailSuppressions.address, email.to));
      if (bad) {
        await finish(email.id, { status: "failed", lastError: `address not written to: ${bad.reason}` });
        continue;
      }
      if (email.kind === "booking") {
        const [{ today }] = await db
          .select({ today: sql<number>`count(*)::int` })
          .from(schema.emailOutbox)
          .where(and(eq(schema.emailOutbox.to, email.to), eq(schema.emailOutbox.status, "sent"), sql`${schema.emailOutbox.sentAt} > ${new Date(now.getTime() - 24 * 3_600_000).toISOString()}::timestamptz`));
        if (today >= DAILY_CAP_PER_ADDRESS) {
          await finish(email.id, { status: "queued", nextAttemptAt: new Date(now.getTime() + 3_600_000), lastError: "waiting: this address has had a lot of email today" });
          continue;
        }
      }
      // A try whose answer was lost more than a day ago cannot be repeated safely: Resend has forgotten the key.
      if (email.attempts > 1 && now.getTime() - email.createdAt.getTime() > IDEMPOTENCY_MEMORY_MS && email.lastError?.startsWith("unknown")) {
        await finish(email.id, { status: "failed", lastError: "unknown outcome too old to retry safely; check at the sending service" });
        continue;
      }

      const outcome = await transport({ id: email.id, to: email.to, subject: email.subject, text: email.body, headers: email.headers ? (JSON.parse(email.headers) as Record<string, string>) : {} });
      if (outcome.ok) {
        // Login links are not kept once the email is out.
        const purge = email.kind === "confirm" || email.kind === "reset";
        await finish(email.id, { status: "sent", sentAt: now, providerId: outcome.providerId, lastError: null, ...(purge ? { body: "" } : {}) });
        sent++;
      } else if (outcome.permanent || email.attempts >= MAX_ATTEMPTS) {
        await finish(email.id, { status: "failed", lastError: outcome.error });
        console.error(`[email] could not send ${email.id} to ${email.to}: ${outcome.error}`);
      } else {
        const wait = BACKOFF_MS[Math.min(email.attempts - 1, BACKOFF_MS.length - 1)];
        await finish(email.id, { status: "queued", nextAttemptAt: new Date(now.getTime() + wait), lastError: `unknown or temporary: ${outcome.error}` });
      }
    } catch (error) {
      // Something went wrong on our side. The lease runs out and the email is tried again.
      console.error(`[email] delivery of ${email.id} failed; will retry`, error);
    }
  }
  return sent;
}
