import Link from "next/link";
import { getHostSettings, refreshPayoutsReady } from "@/lib/payments/hosts";
import { FREE_CANCEL_CHOICES_MINUTES } from "@/lib/payments/rules";
import { stripeConfigured } from "@/lib/payments/stripe";
import { requireUser } from "@/lib/session";
import { saveCancelRule, startPayoutSetup } from "./actions";

const RULE_LABEL: Record<number, string> = {
  0: "Any time before the start (our default)",
  60: "Until 1 hour before the start",
  720: "Until 12 hours before the start",
  1440: "Until 24 hours before the start",
};

export default async function HostPage(props: PageProps<"/host">) {
  const user = await requireUser();
  const { notice } = await props.searchParams;

  let settings = await getHostSettings(user.id);
  // Always ask Stripe; never assume the account is ready.
  if (settings.stripeAccountId && stripeConfigured()) {
    await refreshPayoutsReady(user.id).catch(() => undefined);
    settings = await getHostSettings(user.id);
  }

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10">
      <p className="text-sm">
        <Link href="/" className="underline underline-offset-2">
          ← Your calls
        </Link>
      </p>
      <h1 className="mt-4 text-2xl font-semibold">Hosting settings</h1>

      {typeof notice === "string" && (
        <p role="status" className="mt-4 rounded border border-neutral-400 p-3 text-sm">
          {notice}
        </p>
      )}

      <section className="mt-8">
        <h2 className="text-lg font-semibold">Getting paid</h2>
        {!stripeConfigured() ? (
          <p className="mt-2 text-sm opacity-70">Paid calls are switched off because Stripe is not set up.</p>
        ) : settings.payoutsReady ? (
          <>
            <p className="mt-2 text-sm text-green-700">Your payout account is ready. You can host paid calls.</p>
            <p className="mt-1 text-sm opacity-70">
              You are paid once a week, for calls that ended at least 7 days earlier. Our fee is 4.9% plus 30 cents per
              paid call (1.5% more when the customer&apos;s card is from outside the United States), and 25 cents per payout.
            </p>
            <form action={startPayoutSetup} className="mt-3">
              <button type="submit" className="text-sm underline underline-offset-2">
                Update your payout details at Stripe
              </button>
            </form>
          </>
        ) : (
          <>
            <p className="mt-2 text-sm">
              {settings.stripeAccountId
                ? "Your payout account is not finished yet. Stripe still needs some details from you."
                : "To host paid calls, set up a payout account. Stripe collects your identity and bank details on its own secure pages; we never see them."}
            </p>
            <form action={startPayoutSetup} className="mt-3">
              <button type="submit" className="rounded bg-blue-600 px-4 py-2 font-medium text-white">
                {settings.stripeAccountId ? "Continue payout setup" : "Set up payouts"}
              </button>
            </form>
          </>
        )}
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-semibold">Your cancelling rule</h2>
        <p className="mt-2 text-sm opacity-70">
          How long before the start can a customer cancel for free? After that, cancelling costs them the full booked
          price, and you can still choose to refund them. You can always cancel your own calls for free before they start.
        </p>
        <form action={saveCancelRule} className="mt-3 space-y-2">
          {FREE_CANCEL_CHOICES_MINUTES.map((minutes) => (
            <label key={minutes} className="flex items-center gap-2 text-sm">
              <input type="radio" name="freeCancelMinutes" value={minutes} defaultChecked={settings.freeCancelMinutes === minutes} />
              {RULE_LABEL[minutes]}
            </label>
          ))}
          <button type="submit" className="mt-2 rounded border border-neutral-500 px-3 py-1.5 text-sm">
            Save rule
          </button>
        </form>
      </section>
    </main>
  );
}
