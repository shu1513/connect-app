/**
 * The reminder before a membership month ends (the rulebook's "The reminder"): one email to the
 * member, three days before, saying how much time is left, the moment it expires, and what comes
 * then: the next payment, an offer of less time to answer, or a pause.
 *
 * It is the notice of a payment, so it is sent whatever the person chose for reminder emails, and
 * it carries no unsubscribe footer (that would promise something this email cannot keep). It is
 * written once per month, only inside the three days, and ends with the month: it can never
 * arrive after the payment it announces. When its turn to be sent comes, the membership is looked
 * at once more (`membershipReminderProblem`), and a reminder that is no longer true is dropped.
 */
import { and, eq, gt, inArray, lte } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Membership, MembershipMonth } from "@/db/schema";
import { whenFor } from "@/lib/booking/emails";
import { queueEmail } from "@/lib/email";
import { minutesCovered, monthTotalCents, timeWords } from "@/lib/membership/rules";
import { membershipsOnFor } from "@/lib/safety/switches";

export const REMINDER_BEFORE_MS = 3 * 24 * 3_600_000;

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const keyFor = (monthId: string) => `month-reminder:${monthId}`;

function appUrl(): string {
  return (process.env.BETTER_AUTH_URL || "http://localhost:3000").replace(/\/$/, "");
}

/** What the end of the month brings: a payment, an offer to answer, or a pause. */
type Kind = "renewal" | "offer" | "pause";

const SUBJECT: Record<Kind, (hostName: string) => string> = {
  renewal: (hostName) => `Your membership with ${hostName} renews in 3 days`,
  offer: (hostName) => `Your membership with ${hostName}: an offer to answer in the next 3 days`,
  pause: (hostName) => `Your membership with ${hostName} will be paused in 3 days`,
};

/**
 * How things stand for a month that has started, as of now. "A renewal is coming" needs all of:
 * no stop from either side, the host's membership switched on, and the founder's switch covering
 * that host. Otherwise nothing is promised.
 */
async function standing(membership: Membership): Promise<{ kind: Kind; why: string }> {
  if (membership.memberStoppedAt) return { kind: "pause", why: "you cancelled it" };
  if (membership.hostStoppedAt) return { kind: "pause", why: membership.pausedReason === "offer" ? "you said \"No thanks\" to the smaller time that was offered" : "the host paused it after this month" };
  if (membership.offerStoppedAt) return { kind: "pause", why: "the host switched the membership off during this month" };
  if (membership.offerId && membership.offeredMinutes) return { kind: "offer", why: "" };
  const [offer] = await db.select({ on: schema.membershipOffers.on }).from(schema.membershipOffers).where(eq(schema.membershipOffers.hostId, membership.hostId));
  if (!offer?.on) return { kind: "pause", why: "the host is not offering a membership at the moment" };
  if (!(await membershipsOnFor(membership.hostId))) return { kind: "pause", why: "memberships are not being renewed at the moment" };
  return { kind: "renewal", why: "" };
}

async function hostNameOf(hostId: string): Promise<string> {
  const [profile] = await db.select({ displayName: schema.hostProfiles.displayName }).from(schema.hostProfiles).where(eq(schema.hostProfiles.userId, hostId));
  return profile?.displayName ?? "your host";
}

function textFor(input: { kind: Kind; why: string; membership: Membership; month: MembershipMonth; member: { name: string; timeZone: string | null }; hostName: string }): string {
  const { kind, membership, month, member, hostName } = input;
  const ends = whenFor(member, month.endsAt!);
  const left = timeWords(minutesCovered(month.status === "held" ? month.totalCents : month.freeCents, month.pricePer15Cents));
  const ownPrice = membership.ownPricePer15Cents ?? month.pricePer15Cents;
  const ownMinutes = membership.ownMinutes ?? month.includedMinutes;
  const page = `${appUrl()}/memberships/${membership.id}`;
  const lines = [`Hi ${member.name},`, "", `Your month with ${hostName} ends on ${ends}. You have ${left} left. Time you have not used by then expires and is not paid back.`, ""];
  if (kind === "renewal") {
    lines.push(
      `Your next payment: ${money(monthTotalCents(ownPrice, ownMinutes))} for ${timeWords(ownMinutes)}, on ${ends}. It is first only held on your card.`,
      "",
      `To cancel before then, use "Cancel membership" here: ${page}`,
    );
  } else if (kind === "offer") {
    const offered = membership.offeredMinutes!;
    lines.push(
      `${hostName} has offered you less time. Accept by ${ends} to go on with ${timeWords(offered)} a month for ${money(monthTotalCents(ownPrice, offered))}. Otherwise your membership is paused then, and nothing is charged.`,
      "",
      `Answer here: ${page}?offer=${membership.offerId}`,
    );
  } else {
    lines.push(`Your membership is paused then, because ${input.why}. No payment is taken. A paused membership costs nothing, and you can resume it when there is room.`, "", `Your membership: ${page}`);
  }
  return [...lines, ""].join("\n");
}

/** Writes the reminder for every month that ends within three days and has none yet. Returns how many were written. */
export async function writeMembershipReminders(now: Date): Promise<number> {
  const due = await db
    .select({ membership: schema.memberships, month: schema.membershipMonths })
    .from(schema.membershipMonths)
    .innerJoin(schema.memberships, eq(schema.memberships.currentMonthId, schema.membershipMonths.id))
    .where(and(eq(schema.memberships.status, "active"), inArray(schema.membershipMonths.status, ["running", "held"]), gt(schema.membershipMonths.endsAt, now), lte(schema.membershipMonths.endsAt, new Date(now.getTime() + REMINDER_BEFORE_MS))));
  if (due.length === 0) return 0;
  // Most passes find every reminder already written: one read says which.
  const have = new Set((await db.select({ key: schema.emailOutbox.dedupeKey }).from(schema.emailOutbox).where(inArray(schema.emailOutbox.dedupeKey, due.map(({ month }) => keyFor(month.id))))).map((row) => row.key));
  let written = 0;
  for (const { membership, month } of due) {
    if (have.has(keyFor(month.id)) || !month.endsAt) continue;
    const [member] = await db.select({ name: schema.user.name, email: schema.user.email, timeZone: schema.user.timeZone, closedAt: schema.user.closedAt }).from(schema.user).where(eq(schema.user.id, membership.customerId));
    if (!member || member.closedAt) continue;
    const hostName = await hostNameOf(membership.hostId);
    const { kind, why } = await standing(membership);
    await db.transaction((tx) =>
      queueEmail(tx, {
        to: member.email,
        key: keyFor(month.id),
        subject: SUBJECT[kind](hostName),
        text: textFor({ kind, why, membership, month, member, hostName }),
        // It announces what happens when the month ends: after that moment it would be wrong.
        expiresAt: month.endsAt!,
      }),
    );
    written++;
  }
  return written;
}

/**
 * Asked when a reminder is about to be sent: is it still true? Returns why not, or null. A
 * reminder written for a renewal is dropped if the renewal was stopped, or the membership paused
 * or ended, in the meantime; the same goes for the other two kinds when things changed (the member
 * was told about the change by its own email). It does not look at the person's choice about
 * reminder emails.
 */
export async function membershipReminderProblem(monthId: string, subject: string): Promise<string | null> {
  const [row] = await db
    .select({ membership: schema.memberships, endsAt: schema.membershipMonths.endsAt })
    .from(schema.membershipMonths)
    .innerJoin(schema.memberships, eq(schema.memberships.id, schema.membershipMonths.membershipId))
    .where(eq(schema.membershipMonths.id, monthId));
  if (!row) return "the month is gone";
  const { membership } = row;
  if (membership.status !== "active" || membership.currentMonthId !== monthId) return "the membership is paused, ended or in a later month";
  const { kind } = await standing(membership);
  return SUBJECT[kind](await hostNameOf(membership.hostId)) === subject ? null : "the membership changed after this reminder was written";
}
