import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { LocalTime } from "@/components/local-time";
import { SitePage } from "@/components/site-page";
import { db, schema } from "@/db";
import { membershipFor } from "@/lib/membership/access";
import { secretToPay } from "@/lib/membership/charge";
import { timeWords } from "@/lib/membership/rules";
import { readNotice, withNotice } from "@/lib/notice";
import { formatMoney } from "@/lib/payments/access";
import { stripePublishableKey } from "@/lib/payments/stripe";
import { requireUser } from "@/lib/session";
import { payNowAction } from "@/app/h/[handle]/membership/actions";
import { MembershipCardForm, PaymentCheck } from "@/app/h/[handle]/membership/card-form";

export const metadata: Metadata = { title: "Pay for your membership" };

export const dynamic = "force-dynamic";

/**
 * "Pay now" after a monthly payment that did not go through, reached from the email and from the
 * member's page. For the member of that membership only. Opening or reloading it starts nothing:
 * the card form is shown for the payment the month already has, once the "Pay now" button (an
 * action) has made it ready to be paid by hand.
 */
export default async function PayPage(props: PageProps<"/memberships/[id]/pay">) {
  const { id } = await props.params;
  const user = await requireUser(`/memberships/${id}/pay`);
  const found = await membershipFor(user.id, id);
  if (!found) notFound();
  const { membership, months } = found;
  const here = `/memberships/${membership.id}/pay`;
  const notice = readNotice(here, await props.searchParams);
  const now = new Date();
  const month = months.find((m) => m.id === membership.currentMonthId) ?? null;

  // Paid meanwhile (by this form, by the saved card, or in another tab): the member's page says how it stands.
  if (membership.status === "active" && month && (month.status === "held" || month.status === "running")) {
    redirect(withNotice(`/memberships/${membership.id}`, "Your payment went through. Your membership time is there to book."));
  }

  const [profile] = await db.select({ displayName: schema.hostProfiles.displayName }).from(schema.hostProfiles).where(eq(schema.hostProfiles.userId, membership.hostId));
  const hostName = profile?.displayName ?? "your host";
  const toPay = membership.status === "unpaid" && month && month.status === "to_pay" && !month.endedHow && !(month.giveUpAt && month.giveUpAt <= now) ? month : null;
  // Read only: the secret of the payment this month already has, when it is ready to be paid by hand.
  const secret = toPay ? await secretToPay({ monthId: toPay.id, memberId: user.id, now }) : null;

  return (
    <SitePage className="mx-auto w-full max-w-2xl px-4 py-10">
      <p className="text-sm">
        <Link href={`/memberships/${membership.id}`} className="inline-flex min-h-11 items-center underline underline-offset-2">
          ← Your membership with {hostName}
        </Link>
      </p>
      <h1 className="mt-2 text-2xl font-semibold">Pay for your membership</h1>

      {notice && (
        <p role="status" className="mt-4 rounded border border-neutral-400 p-3 text-sm">
          {notice}
        </p>
      )}

      {!toPay ? (
        <p className="mt-4 text-sm">
          There is nothing to pay here at the moment.{" "}
          {membership.status === "paused" ? "Your membership is paused; nothing is charged while it is paused, and you can resume it from its page." : membership.status === "ended" ? "This membership has ended." : "Your membership's page shows how it stands."}
        </p>
      ) : (
        <div className="mt-4 text-sm">
          <p>
            <strong>
              {formatMoney(toPay.totalCents)} for {timeWords(toPay.includedMinutes)}
            </strong>{" "}
            of calls with {hostName}: your next month. {toPay.needsAction ? "Your bank wants you to approve this payment yourself." : "The payment did not go through."} Until it does you have no member time.
          </p>
          {toPay.giveUpAt && (
            <p className="mt-2 opacity-80">
              You can pay until <LocalTime iso={toPay.giveUpAt.toISOString()} />. After that your membership is paused, and nothing is charged.
            </p>
          )}
          {secret ? (
            <>
              <MembershipCardForm membershipId={membership.id} monthId={toPay.id} clientSecret={secret.clientSecret} publishableKey={stripePublishableKey()} button={`Hold ${formatMoney(toPay.totalCents)} for this month`} />
              <p className="mt-3 opacity-70">
                The amount is only held at first. It is taken when you make your first booking of the month, or after 72 hours, whichever comes first. The card you use here is kept for the monthly payment from now on.
              </p>
            </>
          ) : (
            <>
              <form action={payNowAction} className="mt-4">
                <input type="hidden" name="membership" value={membership.id} />
                <button type="submit" className="rounded bg-blue-600 px-4 py-2 font-medium text-white">
                  Pay now
                </button>
                <span className="ml-2 opacity-70">The next step asks for your card.</span>
              </form>
              <PaymentCheck membershipId={membership.id} monthId={toPay.id} />
            </>
          )}
        </div>
      )}
    </SitePage>
  );
}
