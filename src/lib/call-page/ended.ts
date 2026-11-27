/**
 * The screen after "End call now" (plans/51-end-call-now.md, decision 19): who ended the call,
 * what that means for the money, and the three choices, "Report", "Block" and "Neither". One
 * reading for the website's page (/calls/[id]/ended) and for the phone app's screen. It only reads.
 */
import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { roomClosesAt } from "@/lib/calls";
import { hasBlocked } from "@/lib/follows/follows";
import { callForParticipant } from "@/lib/payments/access";
import { BLOCK_WORDS } from "@/lib/safety/block-words";
import { endReportPreview } from "@/lib/safety/end-report";
import { REPORT_WORDS } from "@/lib/safety/report-words";
import { END_WORDS, endMoneyFor } from "./end-words";

export type EndedScreen = {
  callId: string;
  role: "host" | "customer";
  /** The other person: who "Block" blocks. Never sent to the phone app, which names only the call. */
  otherId: string;
  otherName: string;
  /** The room is written down as closed (the video service has confirmed that both are out). */
  closed: boolean;
  title: string;
  /** Who ended the call, and what that means for the money. */
  lines: string[];
  what: string;
  report: { label: string; what: string; money: string | null };
  /** `done`: the block stands; `doneWords` says so, and nothing more (whether every call still to come was cancelled is said when the block is made). */
  block: { label: string; what: string; done: boolean; doneWords: string };
  neither: { label: string; what: string };
};

/**
 * Null for anyone who is not one of the call's two people. "not_ended" for a call that is still
 * going on, has yet to start, or was cancelled: there is nothing to say after its end.
 */
export async function endedScreenFor(userId: string, callId: string, now: Date): Promise<EndedScreen | "not_ended" | null> {
  const access = await callForParticipant(callId, userId);
  if (!access) return null;
  const { call, role } = access;
  if (call.cancelledAt || (!call.safetyEndedAt && now < roomClosesAt(call))) return "not_ended";

  const otherId = role === "host" ? call.customerId : call.hostId;
  const [customer] = await db.select({ name: schema.user.name }).from(schema.user).where(eq(schema.user.id, call.customerId));
  // A customer knows the host by the name on her page, and by nothing else: never by her account name.
  const [hostPage] = await db.select({ displayName: schema.hostProfiles.displayName }).from(schema.hostProfiles).where(eq(schema.hostProfiles.userId, call.hostId));
  const [hostAccount] = role === "host" || hostPage ? [] : await db.select({ name: schema.user.name }).from(schema.user).where(eq(schema.user.id, call.hostId));
  const names = { host: hostPage?.displayName ?? hostAccount?.name ?? "the host", customer: customer?.name ?? "the customer" };
  const otherName = role === "host" ? names.customer : names.host;

  const lines: string[] = [];
  let reportMoney: string | null = null;
  if (!call.safetyEndedAt) {
    // The room had closed by itself when the button was pressed: the call is charged as any call that ran to its end.
    lines.push(END_WORDS.alreadyOver);
  } else {
    lines.push(call.safetyEndedBy === userId ? END_WORDS.byYou(call.closedAt !== null) : END_WORDS.byOther(otherName, call.closedAt !== null));
    if (call.endedNowBy === null) {
      // Ended with the earlier button: its money waits for the founder, as it always did.
      if (call.pricePer15Cents > 0) lines.push("The charge for this call is decided by a person at Connect.");
    } else {
      const money = END_WORDS.money(role, endMoneyFor(call), names);
      // While the call's own money is still to be taken, when that happens; once it is settled, where to read it.
      const settled = !access.payment || (access.payment.status !== "held" && access.payment.status !== "awaiting_payment");
      const kind = endMoneyFor(call);
      // (Where nothing is charged there is nothing to wait for.)
      if (money) lines.push(...(kind === "free_early" ? [money] : [money, settled ? END_WORDS.moneyDone : END_WORDS.moneyWhen]));
      // For the customer who pressed: what a report would do to the charge right now, so nothing is promised that the guard would not give.
      const preview = await endReportPreview(call, userId, now);
      reportMoney = preview === null ? null : preview.effect === "whole" ? END_WORDS.reportDoesNotLower : END_WORDS.reportLowers(otherName, preview.partly);
    }
  }
  const blockDone = await hasBlocked(userId, otherId);

  return {
    callId: call.id,
    role,
    otherId,
    otherName,
    closed: call.closedAt !== null,
    title: END_WORDS.title,
    lines,
    what: END_WORDS.what,
    report: { label: REPORT_WORDS.reportPerson(otherName), what: END_WORDS.reportWhat(otherName), money: reportMoney },
    // A block that stands can be made again: that tries once more to cancel the calls still to come, and is safe.
    block: { label: blockDone ? END_WORDS.blockAgain(otherName) : BLOCK_WORDS.label(otherName), what: blockDone ? END_WORDS.blockAgainWhat(otherName) : END_WORDS.blockWhat(otherName), done: blockDone, doneWords: END_WORDS.blocked(otherName) },
    neither: { label: END_WORDS.neither, what: END_WORDS.neitherWhat(otherName) },
  };
}
