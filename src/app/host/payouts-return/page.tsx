import { redirect } from "next/navigation";
import { withNotice } from "@/lib/notice";
import { refreshPayoutsReady } from "@/lib/payments/hosts";
import { requireUser } from "@/lib/session";

/**
 * Where Stripe sends a host back after its payout form. Arriving here proves
 * nothing, so we ask Stripe whether the account can now receive money.
 */
export default async function PayoutsReturnPage() {
  const user = await requireUser();
  let notice: string;
  try {
    notice = (await refreshPayoutsReady(user.id))
      ? "Your payout account is ready."
      : "Stripe still needs some details before you can be paid. You can continue the setup below.";
  } catch (error) {
    console.error("[payments] could not check a payout account with Stripe", error);
    notice = "We could not check your payout account with Stripe just now. Please try again in a minute.";
  }
  redirect(withNotice("/host", notice));
}
