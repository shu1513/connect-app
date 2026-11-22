"use server";

import { redirect } from "next/navigation";
import { chooseAnswer, ChoiceError } from "@/lib/disputes/choose";
import { allowPayingAgain } from "@/lib/disputes/paying";
import { answerObjection, cancelDebt, DebtError, holdDebt, objectToDebt } from "@/lib/disputes/takeback";
import { withNotice } from "@/lib/notice";
import { requireAdmin, requireUser } from "@/lib/session";

/** Stripe's own ids for disputes, and nothing else: the id goes into a page address. */
const DISPUTE_ID = /^[A-Za-z0-9_]{5,80}$/;

/**
 * The host's two buttons on a dispute's page: "Fight it" and "Give the money back" (plans/47,
 * decisions 4 and 5). The library checks again that the person asking is that dispute's host, that
 * nothing was chosen before and that the time is not over; the first choice stands.
 */
export async function chooseAction(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("dispute") ?? "");
  if (!DISPUTE_ID.test(id)) redirect("/host");
  const page = `/disputes/${id}`;
  const choice = String(formData.get("choice") ?? "");
  let notice: string;
  try {
    await chooseAnswer({ disputeId: id, by: user.id, choice });
    notice = choice === "give_back" ? "Saved. Connect tells the bank that it does not contest this dispute." : "Saved. Connect sends the bank its record of this payment.";
  } catch (error) {
    if (!(error instanceof ChoiceError)) console.error("[disputes] a host's choice failed", error);
    notice = error instanceof ChoiceError ? error.message : "Something went wrong. Nothing was changed. Please try again.";
  }
  redirect(withNotice(page, notice));
}

/** The founder's button: the customer of a lost dispute may start new payments again. Written down as an admin action. */
export async function allowPayingAction(formData: FormData) {
  const admin = await requireAdmin();
  const id = String(formData.get("dispute") ?? "");
  if (!DISPUTE_ID.test(id)) redirect("/admin");
  const page = `/disputes/${id}`;
  const changed = await allowPayingAgain({ disputeId: id, adminId: admin.id });
  redirect(withNotice(page, changed ? "Saved. This dispute no longer keeps the customer from starting new bookings and payments." : "Nothing to change: this dispute does not keep its customer from paying."));
}

/** The founder's button: a take-back that has only its notice is called off. Written down as an admin action; the host is told. */
export async function cancelDebtAction(formData: FormData) {
  const admin = await requireAdmin();
  const id = String(formData.get("dispute") ?? "");
  if (!DISPUTE_ID.test(id)) redirect("/admin");
  const debtId = String(formData.get("debt") ?? "");
  const cancelled = /^[0-9a-f-]{36}$/.test(debtId) && (await cancelDebt({ debtId, disputeId: id, adminId: admin.id }));
  redirect(withNotice(`/disputes/${id}`, cancelled ? "Cancelled. Nothing is taken back, and the host has been told." : "This take-back can no longer be cancelled: the app has started it, or it was already settled."));
}

const DEBT_ID = /^[0-9a-f-]{36}$/;

/**
 * The host's "I think this is wrong" on a take-back (plans/46-part-3-money-owed.md, decision 6). The library checks that
 * it is this host's and that it still only has its notice. From this moment nothing is taken until the founder has decided.
 */
export async function objectAction(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("dispute") ?? "");
  if (!DISPUTE_ID.test(id)) redirect("/host");
  const debtId = String(formData.get("debt") ?? "");
  let notice: string;
  try {
    if (!DEBT_ID.test(debtId)) throw new DebtError("This is not one of your take-backs.");
    await objectToDebt({ debtId, disputeId: id, hostId: user.id, objection: String(formData.get("objection") ?? "") });
    notice = "We have your objection. Nothing is taken until a person at Connect has answered you.";
  } catch (error) {
    if (!(error instanceof DebtError)) console.error("[disputes] an objection to a take-back failed", error);
    notice = error instanceof DebtError ? error.message : "Something went wrong. Nothing was changed. Please try again.";
  }
  redirect(withNotice(`/disputes/${id}`, notice));
}

/** The founder's button for an objection that came by email: the take-back is held, as if the host had pressed their own. */
export async function holdDebtAction(formData: FormData) {
  const admin = await requireAdmin();
  const id = String(formData.get("dispute") ?? "");
  if (!DISPUTE_ID.test(id)) redirect("/admin");
  const debtId = String(formData.get("debt") ?? "");
  const held = DEBT_ID.test(debtId) && (await holdDebt({ debtId, disputeId: id, adminId: admin.id, note: String(formData.get("note") ?? "") }));
  redirect(withNotice(`/disputes/${id}`, held ? "Held. Nothing is taken until you have decided: answer the host, or cancel the take-back." : "This take-back cannot be held any more: the app has started it, or it is already held, answered or cancelled."));
}

/** The founder's answer to an objection: it is taken after all, and the host is sent the answer as written. */
export async function answerObjectionAction(formData: FormData) {
  const admin = await requireAdmin();
  const id = String(formData.get("dispute") ?? "");
  if (!DISPUTE_ID.test(id)) redirect("/admin");
  const debtId = String(formData.get("debt") ?? "");
  let notice: string;
  try {
    const answered = DEBT_ID.test(debtId) && (await answerObjection({ debtId, disputeId: id, adminId: admin.id, answer: String(formData.get("answer") ?? "") }));
    notice = answered ? "Saved. Your answer is on the host's Messages page and goes out by email. It is taken no earlier than the first day, and no earlier than 3 days after that email has really gone out." : "There is no objection to answer here any more.";
  } catch (error) {
    if (!(error instanceof DebtError)) console.error("[disputes] answering an objection failed", error);
    notice = error instanceof DebtError ? error.message : "Something went wrong. Nothing was changed. Please try again.";
  }
  redirect(withNotice(`/disputes/${id}`, notice));
}

