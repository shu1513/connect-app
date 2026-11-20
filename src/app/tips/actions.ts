"use server";

import { and, eq, inArray, isNotNull, or } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { letPaymentGo } from "@/lib/contributions/monthly";
import { refundContribution } from "@/lib/contributions/refund";
import { ContributionError, readSum } from "@/lib/contributions/rules";
import { payNow } from "@/lib/contributions/start";
import { startTip } from "@/lib/contributions/tip-start";
import { withNotice } from "@/lib/notice";
import { formatMoney } from "@/lib/payments/access";
import { MoneyError } from "@/lib/payments/operations";
import { requireActiveUser, requireUser } from "@/lib/session";

/**
 * What people do about a tip (plans/44). Starting one is the customer's; from its card step on,
 * a tip lives on its own page (/contributions/[id]) and uses that page's actions. Letting a held
 * tip go and refunding a taken one are the host's, from the results of the call the tip was given
 * for. Every action takes the person from the login, never from the form, and the library checks
 * again that the call, or the payment, is theirs.
 */

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** An id from a form, or "" when it is not one: it becomes part of an address of our own only when it is. */
const idOf = (value: FormDataEntryValue | null): string => (ID.test(String(value ?? "")) ? String(value).toLowerCase() : "");

function problem(error: unknown): string {
  if (error instanceof ContributionError || error instanceof MoneyError) return error.message;
  console.error("[tips] an action failed", error);
  return "Something went wrong. Please look at this page again to see how things stand, and try again.";
}

/**
 * "Continue to the card step" on the summary page: the form with the request's id that was made
 * when the page was drawn, so a second press starts nothing new. The payment is made ready here,
 * so that the page that follows only has to read it. If Stripe cannot be reached now, the tip
 * still stands: its page offers "Continue to the card step" for the 30 minutes.
 */
export async function startTipAction(formData: FormData) {
  const user = await requireActiveUser("/account");
  const callId = idOf(formData.get("call"));
  const amount = String(formData.get("amount") ?? "").slice(0, 20);
  let to: string;
  try {
    const started = await startTip({ customerId: user.id, callId, amount, requestKey: String(formData.get("request") ?? ""), wordingVersion: String(formData.get("wording") ?? ""), now: new Date() });
    await payNow({ paymentId: started.paymentId, contributorId: user.id }).catch((error) => console.error(`[tips] could not make payment ${started.paymentId} ready yet`, error));
    to = `/contributions/${started.contributionId}`;
  } catch (error) {
    to = withNotice(`/tips/new?call=${callId}&amount=${encodeURIComponent(amount)}`, problem(error));
  }
  redirect(to);
}

/**
 * The tip payment a host's form names, if it is a payment of a tip for one of HER calls that she
 * may see, with that call's id: the page she is sent back to. Null for anything else; the library
 * checks once more. A tip that never had a hold is not shown to its host (plans/44, decision 2),
 * so it is not found here either: it looks the same as one that does not exist.
 */
async function hostsTip(hostId: string, formData: FormData): Promise<{ paymentId: string; callId: string } | null> {
  const paymentId = idOf(formData.get("payment"));
  if (!paymentId) return null;
  const pays = schema.contributionPayments;
  const [found] = await db
    .select({ callId: schema.contributions.callId })
    .from(pays)
    .innerJoin(schema.contributions, eq(schema.contributions.id, pays.contributionId))
    .where(and(eq(pays.id, paymentId), eq(schema.contributions.kind, "tip"), eq(schema.contributions.hostId, hostId), or(isNotNull(pays.authorisedAt), inArray(pays.status, ["held", "taken"]))));
  return found?.callId ? { paymentId, callId: found.callId } : null;
}

/** "Let it go" on a call's results: a tip that is only held, at no cost to anyone. */
export async function letTipGoAsHostAction(formData: FormData) {
  const user = await requireUser("/");
  const tip = await hostsTip(user.id, formData);
  if (!tip) redirect("/");
  let notice = "The tip is being let go. This page says so once that is done.";
  try {
    await letPaymentGo({ paymentId: tip.paymentId, by: "host", actorId: user.id });
  } catch (error) {
    notice = problem(error);
  }
  redirect(withNotice(`/calls/${tip.callId}/results`, notice));
}

/** "Refund" on a call's results: all or part of a tip whose money was taken, until her share of it has been sent to her. */
export async function refundTipAsHostAction(formData: FormData) {
  const user = await requireUser("/");
  const tip = await hostsTip(user.id, formData);
  if (!tip) redirect("/");
  let notice: string;
  try {
    const request = idOf(formData.get("request"));
    if (!request) throw new ContributionError("Please open the page again. Nothing was refunded.");
    const amountCents = readSum(String(formData.get("amount") ?? ""));
    const refund = await refundContribution({ paymentId: tip.paymentId, amountCents, by: "host", deciderId: user.id, reason: String(formData.get("reason") ?? "").replace(/\s+/g, " ").trim().slice(0, 300), requestKey: request });
    // The amount that is really owed: a form sent a second time gets the refund its first sending made.
    notice = `The refund of ${formatMoney(refund.amountCents)} is on its way to the customer's card.`;
  } catch (error) {
    notice = problem(error);
  }
  redirect(withNotice(`/calls/${tip.callId}/results`, notice));
}
