import { redirect } from "next/navigation";
import { refreshPayoutsReady } from "@/lib/payments/hosts";
import { requireUser } from "@/lib/session";

/**
 * Where Stripe sends a host back after its payout form. Arriving here proves
 * nothing, so we ask Stripe whether the account can now receive money.
 */
export default async function PayoutsReturnPage() {
  const user = await requireUser();
  const ready = await refreshPayoutsReady(user.id).catch(() => false);
  const notice = ready
    ? "Your payout account is ready."
    : "Stripe still needs some details before you can be paid. You can continue the setup below.";
  redirect(`/host?notice=${encodeURIComponent(notice)}`);
}
