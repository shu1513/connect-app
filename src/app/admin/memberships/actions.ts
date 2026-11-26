"use server";

import { redirect } from "next/navigation";
import { cancelWithin14Days } from "@/lib/membership/fourteen-days";
import { MembershipError } from "@/lib/membership/rules";
import { withNotice } from "@/lib/notice";
import { requireAdmin } from "@/lib/session";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The founder cancels a new membership within 14 days of joining, for a member who asked in writing instead of
 * pressing their own button (plans/46-part-3-money-owed.md, decision 13). The founder enters the day the request
 * reached Connect. What is refused, and why, comes back as a sentence.
 */
export async function cancelWithin14DaysAction(formData: FormData) {
  const admin = await requireAdmin();
  const back = (notice: string): never => redirect(withNotice("/admin/memberships", notice));
  const membershipId = String(formData.get("membership") ?? "");
  if (!UUID.test(membershipId)) back("That form is no longer valid. Reload the page and try again.");
  let notice: string;
  try {
    // (The month the form was drawn for goes along: if the membership has another one by now, nothing is cancelled.)
    const shown = String(formData.get("month") ?? "");
    await cancelWithin14Days({ membershipId, by: { as: "founder", adminId: admin.id, requestDay: String(formData.get("day") ?? "").trim() }, shownMonthId: UUID.test(shown) ? shown : undefined });
    notice = "The membership is cancelled within the 14 days. The member and the host are told. A hold is let go, calls still to come are cancelled, and what goes back to the card shows under \"Pay-backs not done\" until Stripe has confirmed it.";
  } catch (error) {
    // A MembershipError is a refusal before anything changed. Anything else may have happened after the ending was saved.
    if (error instanceof MembershipError) notice = `${error.message} Nothing was changed.`;
    else {
      console.error("[membership] cancelling within 14 days failed", error);
      notice = "We could not confirm what happened. Look at the membership below: if it says \"Ended\", it was cancelled and you do not need to press again.";
    }
  }
  back(notice);
}
