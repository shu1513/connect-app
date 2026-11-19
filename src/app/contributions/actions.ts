"use server";

import { redirect } from "next/navigation";
import { letPaymentGo, stopContribution } from "@/lib/contributions/monthly";
import { ContributionError } from "@/lib/contributions/rules";
import { contributionFor, payNow, startContribution } from "@/lib/contributions/start";
import { withNotice } from "@/lib/notice";
import { MoneyError } from "@/lib/payments/operations";
import { requireActiveUser, requireUser } from "@/lib/session";

/**
 * What a contributor does with a contribution. These are the only things that may start a
 * contribution, or make a payment ready at Stripe; opening or reloading a page never does. Every
 * action takes the person from the login, never from the form, and asks the library, which checks
 * again that the contribution or payment is theirs.
 *
 * Starting and paying need an account that is not paused. Cancelling and stopping do not: they
 * work whatever else is going on.
 */

function problem(error: unknown): string {
  if (error instanceof ContributionError || error instanceof MoneyError) return error.message;
  console.error("[contributions] a contributor's action failed", error);
  return "Something went wrong. Nothing was charged. Please try again.";
}

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** An id from a form, or "" when it is not one: it becomes part of an address of our own only when it is. */
const idOf = (value: FormDataEntryValue | null): string => (ID.test(String(value ?? "")) ? String(value).toLowerCase() : "");

/**
 * "Continue to the card step" on the summary page: the form with the request's id that was made
 * when the page was drawn, so a second press starts nothing new. The payment is made ready here,
 * so that the page that follows only has to read it. If Stripe cannot be reached now, the
 * contribution still stands: its page offers "Continue to the card step" for the 30 minutes.
 */
export async function startContributionAction(formData: FormData) {
  const user = await requireActiveUser("/account");
  const projectId = idOf(formData.get("project"));
  const kind = formData.get("kind") === "monthly" ? "monthly" : "once";
  const amount = String(formData.get("amount") ?? "").slice(0, 20);
  let to: string;
  try {
    const started = await startContribution({ contributorId: user.id, projectId, kind, amount, requestKey: String(formData.get("request") ?? ""), agreed: formData.get("agreed") === "on", wordingVersion: String(formData.get("wording") ?? ""), now: new Date() });
    await payNow({ paymentId: started.paymentId, contributorId: user.id }).catch((error) => console.error(`[contributions] could not make payment ${started.paymentId} ready yet`, error));
    to = `/contributions/${started.contributionId}`;
  } catch (error) {
    to = withNotice(`/contributions/new?project=${projectId}&kind=${kind}&amount=${encodeURIComponent(amount)}`, problem(error));
  }
  redirect(to);
}

/** "Continue to the card step" and "Pay now" on a contribution's page: makes the payment the page showed ready to be paid by hand. */
export async function payNowAction(formData: FormData) {
  const user = await requireActiveUser("/account");
  const found = await contributionFor(user.id, String(formData.get("contribution") ?? ""));
  if (!found) redirect("/account");
  const back = `/contributions/${found.contribution.id}`;
  let to = back;
  try {
    // The payment the page showed, and only if it is one of this contribution's.
    const payment = found.payments.find((one) => one.id === idOf(formData.get("payment")));
    const ready = payment ? await payNow({ paymentId: payment.id, contributorId: user.id }) : null;
    if (!ready) to = withNotice(back, "There is nothing to pay at the moment. This page shows how your contribution stands.");
  } catch (error) {
    to = withNotice(back, problem(error));
  }
  redirect(to);
}

/** "Cancel, nothing is charged": one payment that has not been taken is let go. */
export async function cancelPaymentAction(formData: FormData) {
  const user = await requireUser("/account");
  const found = await contributionFor(user.id, String(formData.get("contribution") ?? ""));
  if (!found) redirect("/account");
  const back = `/contributions/${found.contribution.id}`;
  let notice = "We are cancelling this payment. This page says so once it is done; only then is it certain that nothing was charged.";
  try {
    await letPaymentGo({ paymentId: idOf(formData.get("payment")), by: "contributor", actorId: user.id });
  } catch (error) {
    notice = problem(error);
  }
  redirect(withNotice(back, notice));
}

/** "Stop contributing": at once, whatever else is going on. */
export async function stopContributionAction(formData: FormData) {
  const user = await requireUser("/account");
  const found = await contributionFor(user.id, String(formData.get("contribution") ?? ""));
  if (!found) redirect("/account");
  const back = `/contributions/${found.contribution.id}`;
  if (formData.get("sure") !== "on") redirect(withNotice(back, "Tick the box to stop contributing. Nothing was changed."));
  let notice = "Your contribution has stopped. No further month is held or taken.";
  try {
    await stopContribution({ contributionId: found.contribution.id, contributorId: user.id });
  } catch (error) {
    notice = problem(error);
  }
  redirect(withNotice(back, notice));
}
