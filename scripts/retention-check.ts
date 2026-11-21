/**
 * Testing tool: the end dates for emails and login records (plans/46-agreements-live.md, part 4),
 * against the local database. It makes its own person, emails and login records, touches no
 * others, needs neither Stripe nor the running app, and removes what it made.
 *
 * Usage: npx tsx scripts/retention-check.ts
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { randomUUID } from "node:crypto";
import { eq, inArray, like } from "drizzle-orm";
import { requireLocalDatabase } from "./local-only";

const RUN = randomUUID().slice(0, 8);
const DAY = 24 * 3_600_000;

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}

async function main() {
  requireLocalDatabase();
  const { db, schema } = await import("../src/db");
  const retention = await import("../src/lib/retention");

  const userId = `ret-${RUN}`;
  const address = `retcheck-${RUN}@example.test`;
  const only = { emailKeyLike: `retcheck-${RUN}:%`, userIds: [userId], codeLike: `retcheck-${RUN}:%`, counterKeyLike: `retcheck-${RUN}:%` };
  const made: string[] = [];
  const now = new Date();
  const ago = (days: number) => new Date(now.getTime() - days * DAY);
  const mail = schema.emailOutbox;

  async function email(name: string, values: Partial<typeof mail.$inferInsert>) {
    const [row] = await db
      .insert(mail)
      .values({ to: address, kind: "booking", subject: `Subject ${name}`, body: `Text ${name}`, dedupeKey: `retcheck-${RUN}:${name}`, headers: '{"List-Unsubscribe":"<https://example.test/u>"}', providerId: `prov-${name}`, lastError: null, ...values })
      .returning({ id: mail.id });
    made.push(row.id);
    return row.id;
  }
  const emailNow = async (id: string) => (await db.select().from(mail).where(eq(mail.id, id)))[0];
  const whole = (row: Awaited<ReturnType<typeof emailNow>>) => row.to === address && row.subject.startsWith("Subject") && row.body.startsWith("Text") && row.headers !== null;
  const empty = (row: Awaited<ReturnType<typeof emailNow>>) => row.to === "" && row.subject === "" && row.body === "" && row.headers === null && row.lastError === null && row.providerId === null && row.dedupeKey === `emptied:${row.id}`;

  try {
    await db.insert(schema.user).values({ id: userId, name: "Retention Check", email: address, emailVerified: true });

    console.log("\n1. Emails");
    {
      const TWO_YEARS = 2 * 365 + 1;
      const oldSent = await email("old-sent", { status: "sent", sentAt: ago(TWO_YEARS + 5), createdAt: ago(TWO_YEARS + 5) });
      const oldFailed = await email("old-failed", { status: "failed", lastError: "422 a bad address", createdAt: ago(TWO_YEARS + 5) });
      // Written long ago, sent only last year: counted from the sending.
      const lateSent = await email("late-sent", { status: "sent", sentAt: ago(300), createdAt: ago(TWO_YEARS + 5) });
      const youngSent = await email("young-sent", { status: "sent", sentAt: ago(TWO_YEARS - 10), createdAt: ago(TWO_YEARS - 10) });
      // Not due for a long time, so that a helper running beside this check cannot pick it up and send it.
      const oldWaiting = await email("old-waiting", { status: "queued", createdAt: ago(TWO_YEARS + 5), nextAttemptAt: new Date(now.getTime() + 365 * DAY) });
      const oldSending = await email("old-sending", { status: "sending", createdAt: ago(TWO_YEARS + 5), leaseUntil: new Date(now.getTime() + 365 * DAY) });

      const first = await retention.emptyOldEmails(now, only);
      const sent = await emailNow(oldSent);
      check("an email sent more than two years ago is emptied: address, subject, text, headers and the service's number are gone, and its key names nobody any more", first === 2 && empty(sent), `${first} ${sent.dedupeKey}`);
      check("that it was sent, when, and its kind stay", sent.status === "sent" && sent.sentAt !== null && sent.kind === "booking" && sent.createdAt.getTime() === ago(TWO_YEARS + 5).getTime());
      const failed = await emailNow(oldFailed);
      check("one that was never sent is emptied two years after it was written, with the note of its error; that it failed stays", empty(failed) && failed.status === "failed");
      check("one written long ago and sent last year is left: the two years count from the sending", whole(await emailNow(lateSent)));
      check("one sent a little less than two years ago is left", whole(await emailNow(youngSent)));
      const waitingNow = await emailNow(oldWaiting);
      const sendingNow = await emailNow(oldSending);
      check("one still waiting to be sent, or being sent, is never touched, however old: it stays as it was, with its key", whole(waitingNow) && whole(sendingNow) && waitingNow.status === "queued" && sendingNow.status === "sending" && waitingNow.dedupeKey === `retcheck-${RUN}:old-waiting`);
      check("asked again, nothing is emptied a second time", (await retention.emptyOldEmails(now, only)) === 0);
      // Younger emails keep their keys: the clean-up of refund texts, a year after a request, still finds its emails by them.
      const kept = await db.select({ id: mail.id }).from(mail).where(like(mail.dedupeKey, `retcheck-${RUN}:%`));
      check("an email whose two years are not over keeps its key", kept.length === 4, String(kept.length));
      // Two years on from now, the young one's time has come too.
      const later = new Date(now.getTime() + 30 * DAY);
      check("thirty days later the one that was a little too young is emptied", (await retention.emptyOldEmails(later, only)) === 1 && empty(await emailNow(youngSent)));
    }

    console.log("\n2. Login records");
    {
      const login = (name: string, expiresAt: Date) => db.insert(schema.session).values({ id: `ret-${RUN}-${name}`, userId, token: `ret-${RUN}-${name}-${randomUUID()}`, expiresAt, ipAddress: "203.0.113.7", userAgent: "check" });
      await login("long-over", ago(400));
      await login("over", ago(300));
      await login("open", new Date(now.getTime() + 7 * DAY));
      await db.insert(schema.verification).values([
        { id: `ret-${RUN}-v-old`, identifier: `retcheck-${RUN}:old`, value: "x", expiresAt: ago(400) },
        { id: `ret-${RUN}-v-young`, identifier: `retcheck-${RUN}:young`, value: "x", expiresAt: ago(300) },
      ]);
      const gone = await retention.deleteOldLogins(now, only);
      const left = (await db.select({ id: schema.session.id }).from(schema.session).where(eq(schema.session.userId, userId))).map((row) => row.id).sort();
      check("a login record that ran out more than twelve months ago is deleted; one that ran out later, and one still good, stay", gone === 2 && JSON.stringify(left) === JSON.stringify([`ret-${RUN}-open`, `ret-${RUN}-over`]), `${gone} ${left}`);
      const codes = (await db.select({ id: schema.verification.id }).from(schema.verification).where(like(schema.verification.identifier, `retcheck-${RUN}:%`))).map((row) => row.id);
      check("the same for the login library's one-time codes", JSON.stringify(codes) === JSON.stringify([`ret-${RUN}-v-young`]), String(codes));
      check("asked again, nothing more is deleted", (await retention.deleteOldLogins(now, only)) === 0);
    }

    console.log("\n3. Counters of repeated attempts");
    {
      await db.insert(schema.rateLimit).values([
        { id: `ret-${RUN}-c-old`, key: `retcheck-${RUN}:old`, count: 3, lastRequest: now.getTime() - 8 * DAY },
        { id: `ret-${RUN}-c-young`, key: `retcheck-${RUN}:young`, count: 3, lastRequest: now.getTime() - 6 * DAY },
      ]);
      const gone = await retention.deleteOldAttemptCounters(now, only);
      const left = (await db.select({ id: schema.rateLimit.id }).from(schema.rateLimit).where(like(schema.rateLimit.key, `retcheck-${RUN}:%`))).map((row) => row.id);
      check("a counter that has counted nothing for more than seven days is deleted; a younger one stays", gone === 1 && JSON.stringify(left) === JSON.stringify([`ret-${RUN}-c-young`]), `${gone} ${left}`);
    }
  } finally {
    if (made.length) await db.delete(mail).where(inArray(mail.id, made));
    await db.delete(schema.rateLimit).where(like(schema.rateLimit.key, `retcheck-${RUN}:%`));
    await db.delete(schema.verification).where(like(schema.verification.identifier, `retcheck-${RUN}:%`));
    await db.delete(schema.session).where(inArray(schema.session.userId, [userId]));
    await db.delete(schema.user).where(eq(schema.user.id, userId));
  }

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
