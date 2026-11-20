"use server";

import { redirect } from "next/navigation";
import { letPaymentGo } from "@/lib/contributions/monthly";
import { refundContribution } from "@/lib/contributions/refund";
import { ContributionError, readSum } from "@/lib/contributions/rules";
import { withNotice } from "@/lib/notice";
import { formatMoney } from "@/lib/payments/access";
import { MoneyError } from "@/lib/payments/operations";
import { changeSuggested } from "@/lib/projects/projects";
import { ProjectError } from "@/lib/projects/rules";
import { requireActiveUser, requireUser } from "@/lib/session";

/**
 * What a host does about the contributions to her project: the amounts she suggests, letting a
 * held payment go, and refunding a taken one until her share has been sent (plans/23, "How it
 * works for a host"). Every action takes the host from the login, never from the form, and the
 * library checks again that the project or the payment is hers.
 */

const PAGE = "/host/project";
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function problem(error: unknown): string {
  if (error instanceof ContributionError || error instanceof MoneyError || error instanceof ProjectError) return error.message;
  console.error("[contributions] a host's action failed", error);
  return "Something went wrong. Nothing was changed. Please try again.";
}

/** Back to the list the form was on: her running project's, or an earlier project's. The id is only used in an address of our own. */
function back(formData: FormData, text: string): never {
  const earlier = String(formData.get("earlier") ?? "");
  redirect(withNotice(ID.test(earlier) ? `${PAGE}?project=${earlier.toLowerCase()}` : PAGE, text));
}

/** The amounts she suggests, three boxes for each kind. A kind left empty is not offered. */
export async function saveSuggestedAction(formData: FormData) {
  const user = await requireActiveUser(PAGE);
  let notice = "Your suggested amounts were saved.";
  try {
    await changeSuggested({ hostId: user.id, projectId: String(formData.get("projectId") ?? ""), once: formData.getAll("once").map(String), monthly: formData.getAll("monthly").map(String), now: new Date() });
  } catch (error) {
    notice = problem(error);
  }
  back(formData, notice);
}

/** "Let it go": a payment that is only held, at no cost to anyone. For a monthly contribution that month is skipped, and the contribution goes on. */
export async function letGoAsHostAction(formData: FormData) {
  const user = await requireUser(PAGE);
  let notice = "The payment is being let go. The list below says so once that is done.";
  try {
    await letPaymentGo({ paymentId: String(formData.get("payment") ?? ""), by: "host", actorId: user.id });
  } catch (error) {
    notice = problem(error);
  }
  back(formData, notice);
}

/** "Refund": all or part of a payment whose money was taken, until her share of it has been sent to her. */
export async function refundAsHostAction(formData: FormData) {
  const user = await requireUser(PAGE);
  let notice: string;
  try {
    const request = String(formData.get("request") ?? "");
    if (!ID.test(request)) throw new ContributionError("Please open the page again. Nothing was refunded.");
    const amountCents = readSum(String(formData.get("amount") ?? ""));
    const refund = await refundContribution({ paymentId: String(formData.get("payment") ?? ""), amountCents, by: "host", deciderId: user.id, reason: String(formData.get("reason") ?? "").replace(/\s+/g, " ").trim().slice(0, 300), requestKey: request.toLowerCase() });
    // The amount that is really owed: a form sent a second time gets the refund its first sending made.
    notice = `The refund of ${formatMoney(refund.amountCents)} is on its way to the contributor's card. Our fee goes back in the same proportion.`;
  } catch (error) {
    notice = problem(error);
  }
  back(formData, notice);
}
