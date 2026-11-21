"use server";

import { redirect } from "next/navigation";
import { chooseAnswer, ChoiceError } from "@/lib/disputes/choose";
import { allowPayingAgain } from "@/lib/disputes/paying";
import { cancelDebt } from "@/lib/disputes/takeback";
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
  const cancelled = /^[0-9a-f-]{36}$/.test(debtId) && (await cancelDebt({ debtId, adminId: admin.id }));
  redirect(withNotice(`/disputes/${id}`, cancelled ? "Cancelled. Nothing is taken back, and the host has been told." : "This take-back can no longer be cancelled: the app has started it, or it was already settled."));
}
