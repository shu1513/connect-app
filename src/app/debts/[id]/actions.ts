"use server";

import { redirect } from "next/navigation";
import { answerObjection, cancelDebt, countHandReversal, DebtError, holdDebt, objectToDebt, sendNoticeAgain, settleOutside } from "@/lib/disputes/takeback";
import { withNotice } from "@/lib/notice";
import { requireAdmin, requireUser } from "@/lib/session";

const DEBT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The take-back a form is about, and its page. Anything that is not a take-back's own number goes nowhere. */
function debtOf(formData: FormData, elseTo: string): { id: string; page: string } {
  const id = String(formData.get("debt") ?? "");
  if (!DEBT_ID.test(id)) redirect(elseTo);
  // (A founder who is also the take-back's host stays in the founder's view.)
  return { id, page: `/debts/${id}${formData.get("as") === "founder" ? "?as=founder" : ""}` };
}

const said = (error: unknown, what: string): string => {
  if (!(error instanceof DebtError)) console.error(`[take-backs] ${what} failed`, error);
  return error instanceof DebtError ? error.message : "Something went wrong. Nothing was changed. Please try again.";
};

/**
 * The host's "I think this is wrong" on a take-back that has a page of its own (plans/46-part-3-money-owed.md,
 * decision 6). The library checks that it is this host's and that it still only has its notice.
 */
export async function objectDebtAction(formData: FormData) {
  const user = await requireUser();
  const { id, page } = debtOf(formData, "/host");
  let notice: string;
  try {
    await objectToDebt({ debtId: id, hostId: user.id, objection: String(formData.get("objection") ?? "") });
    notice = "We have your objection. Nothing is taken until a person at Connect has answered you.";
  } catch (error) {
    notice = said(error, "an objection to a take-back");
  }
  redirect(withNotice(page, notice));
}

/** The founder holds a take-back for an objection that came by email. */
export async function holdDebtAction(formData: FormData) {
  const admin = await requireAdmin();
  const { id, page } = debtOf(formData, "/admin");
  const held = await holdDebt({ debtId: id, adminId: admin.id, note: String(formData.get("note") ?? "") });
  redirect(withNotice(page, held ? "Held. Nothing is taken until you have decided: answer the host, or call the take-back off." : "This take-back cannot be held any more: the app has started it, or it is already held, answered or ended."));
}

/** The founder's answer to an objection: it is taken after all, and the host is sent the answer as written. */
export async function answerDebtAction(formData: FormData) {
  const admin = await requireAdmin();
  const { id, page } = debtOf(formData, "/admin");
  let notice: string;
  try {
    const answered = await answerObjection({ debtId: id, adminId: admin.id, answer: String(formData.get("answer") ?? "") });
    notice = answered ? "Saved. Your answer is on the host's Messages page and goes out by email. It is taken no earlier than the first day, and no earlier than 3 days after that email has arrived." : "There is no objection to answer here any more.";
  } catch (error) {
    notice = said(error, "answering an objection");
  }
  redirect(withNotice(page, notice));
}

/** The founder calls a take-back off. Connect then carries the amount. */
export async function cancelDebtAction(formData: FormData) {
  const admin = await requireAdmin();
  const { id, page } = debtOf(formData, "/admin");
  const cancelled = await cancelDebt({ debtId: id, adminId: admin.id });
  redirect(withNotice(page, cancelled ? "Called off. Nothing is taken, Connect carries the amount, and the host has been told." : "This take-back can no longer be called off: the app has started it, or it has ended."));
}

/** The founder sends the notice (or the answer) again when the first did not arrive. */
export async function sendAgainDebtAction(formData: FormData) {
  const admin = await requireAdmin();
  const { id, page } = debtOf(formData, "/admin");
  const again = await sendNoticeAgain({ debtId: id, adminId: admin.id });
  redirect(withNotice(page, again ? "Written again: a new message is on the host's Messages page and goes out by email. The days count from this one arriving." : "Nothing was sent: this take-back's email has nothing wrong with it, or the take-back is no longer waiting for it."));
}

/** The founder records that a take-back was settled with the host outside the app: what the host paid back, and how. */
export async function settleDebtAction(formData: FormData) {
  const admin = await requireAdmin();
  const { id, page } = debtOf(formData, "/admin");
  const typed = String(formData.get("repaid") ?? "").trim();
  let notice: string;
  try {
    if (!/^\d{1,7}(\.\d{1,2})?$/.test(typed)) throw new DebtError("Type what the host paid back in dollars, like 12.50 (or 0 if nothing).");
    const settled = await settleOutside({ debtId: id, adminId: admin.id, repaidCents: Math.round(Number(typed) * 100), note: String(formData.get("note") ?? "") });
    notice = settled ? "Recorded as settled. Nothing is taken from the host's Stripe balance for it, and the host has been told." : "This take-back can no longer be settled here: the app has started it, or it has ended.";
  } catch (error) {
    notice = said(error, "settling a take-back");
  }
  redirect(withNotice(page, notice));
}

/** The founder says what a reversal made by hand at Stripe was for: this take-back, or nothing to do with one. */
export async function countReversalAction(formData: FormData) {
  const admin = await requireAdmin();
  const { id, page } = debtOf(formData, "/admin");
  const reversalId = String(formData.get("reversal") ?? "");
  const what = String(formData.get("for") ?? "");
  let notice: string;
  try {
    if (!/^[A-Za-z0-9_]{5,100}$/.test(reversalId)) throw new DebtError("That form is no longer valid. Reload the page and try again.");
    if (what !== "paid" && what !== "twice" && what !== "other") throw new DebtError("That form is no longer valid. Reload the page and try again.");
    const counted = await countHandReversal({ debtId: id, adminId: admin.id, reversalId, as: what });
    notice = !counted
      ? "That reversal is already accounted for."
      : what === "paid"
        ? "Counted for this take-back: it is in the books as taken back, the host has been told, and only what is left stays owed."
        : what === "twice"
          ? "Recorded: the host has paid twice. They have been told that the money is owed back to them. Send it to them in Stripe."
          : "Noted: that reversal had nothing to do with a take-back. The app goes on by its usual rules.";
  } catch (error) {
    notice = said(error, "accounting for a reversal made by hand");
  }
  redirect(withNotice(page, notice));
}

