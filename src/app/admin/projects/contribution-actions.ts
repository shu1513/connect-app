"use server";

import { redirect } from "next/navigation";
import { holdBack, release } from "@/lib/contributions/founder";
import { letPaymentGo } from "@/lib/contributions/monthly";
import { refundContribution } from "@/lib/contributions/refund";
import { ContributionError, readSum } from "@/lib/contributions/rules";
import { withNotice } from "@/lib/notice";
import { formatMoney } from "@/lib/payments/access";
import { MoneyError } from "@/lib/payments/operations";
import { requireAdmin } from "@/lib/session";

/**
 * What the founder does about a contribution's payment (plans/23, choice D; plans/25, choice 7):
 * hold its share back, release it sooner, let a held payment go, and refund it. Each asks for the
 * founder's login first, and each needs a reason, which is kept.
 */

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function back(text: string): never {
  redirect(withNotice("/admin/projects", text));
}

function problem(error: unknown): string {
  if (error instanceof ContributionError || error instanceof MoneyError) return error.message;
  console.error("[admin] contribution action failed", error);
  return "Something went wrong. Nothing was changed. Please try again.";
}

const paymentOf = (formData: FormData): string => String(formData.get("payment") ?? "");
const noteOf = (formData: FormData): string => String(formData.get("note") ?? "");

export async function holdBackAction(formData: FormData) {
  const admin = await requireAdmin();
  let notice = "The share is held back. The host cannot collect it until you release it.";
  try {
    await holdBack({ paymentId: paymentOf(formData), adminId: admin.id, note: noteOf(formData), now: new Date() });
  } catch (error) {
    notice = problem(error);
  }
  back(notice);
}

export async function releaseAction(formData: FormData) {
  const admin = await requireAdmin();
  let notice = "Released. If the money has been taken, the host can collect this share from now, unless a refund, a dispute or a sending is under way. If it is only held, its share waits the usual 7 days once the money is taken.";
  try {
    await release({ paymentId: paymentOf(formData), adminId: admin.id, note: noteOf(formData), now: new Date() });
  } catch (error) {
    notice = problem(error);
  }
  back(notice);
}

export async function letGoAsFounderAction(formData: FormData) {
  const admin = await requireAdmin();
  let notice = "The payment is being let go. The list below says so once that is done.";
  try {
    await letPaymentGo({ paymentId: paymentOf(formData), by: "founder", actorId: admin.id, note: noteOf(formData) });
  } catch (error) {
    notice = problem(error);
  }
  back(notice);
}

/** A refund by the founder. After the host's share was sent it is Connect's own money: nothing is taken back from her. */
export async function refundAsFounderAction(formData: FormData) {
  const admin = await requireAdmin();
  let notice: string;
  try {
    const request = String(formData.get("request") ?? "");
    if (!ID.test(request)) throw new ContributionError("Please open the page again. Nothing was refunded.");
    const reason = noteOf(formData).replace(/\s+/g, " ").trim().slice(0, 300);
    if (!reason) throw new ContributionError("Please give a reason. It is kept.");
    const amountCents = readSum(String(formData.get("amount") ?? ""));
    await refundContribution({ paymentId: paymentOf(formData), amountCents, by: "founder", deciderId: admin.id, reason, requestKey: request.toLowerCase() });
    notice = `The refund of ${formatMoney(amountCents)} is on its way to the contributor's card.`;
  } catch (error) {
    notice = problem(error);
  }
  back(notice);
}
