import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LocalTime } from "@/components/local-time";
import { SitePage } from "@/components/site-page";
import { warm } from "@/components/warm-ui";
import { db, schema } from "@/db";
import { disputeForViewer } from "@/lib/disputes/pages";
import { aboutOwner, ownerOf } from "@/lib/disputes/record";
import { isAppeal, reasonWords, standingOf } from "@/lib/disputes/status";
import { formatMoney } from "@/lib/payments/access";
import { getSignedIn, isAdminSession, requireUser } from "@/lib/session";
import { SUPPORT_EMAIL } from "@/lib/terms";

// The same title whoever asks: nothing is given away before it is known who may see the page.
export const metadata: Metadata = { title: "A bank dispute" };

export const dynamic = "force-dynamic";

/**
 * One bank dispute, for the host whose money it is about and for the founder (plans/47, part 1):
 * what is disputed, why, and where it stands. Someone else's dispute and one that does not exist
 * are both "not found". The customer has no page here: they are told in their messages, and read
 * about the payment on the page of what they paid for.
 */
export default async function DisputePage(props: PageProps<"/disputes/[id]">) {
  const { id } = await props.params;
  const user = await requireUser(`/disputes/${id}`);
  const founder = await isAdminSession(await getSignedIn());
  const dispute = await disputeForViewer(id, user, founder);
  if (!dispute) notFound();
  const asHost = dispute.hostId === user.id;

  const about = await aboutOwner(db, ownerOf(dispute));
  const [customer] = await db.select({ name: schema.user.name }).from(schema.user).where(eq(schema.user.id, dispute.customerId));
  const [host] = await db.select({ name: schema.user.name }).from(schema.user).where(eq(schema.user.id, dispute.hostId));
  const [profile] = await db.select({ displayName: schema.hostProfiles.displayName }).from(schema.hostProfiles).where(eq(schema.hostProfiles.userId, dispute.hostId));
  const names = { host: profile?.displayName ?? host?.name ?? "the host", customer: customer?.name ?? "the customer" };
  const what = about ? about.what(asHost ? "host" : "founder", user, names) : "a payment";
  const question = dispute.stage === "question";
  const standing = standingOf(dispute.status);

  return (
    <SitePage className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6 sm:py-12">
      <p className="text-sm">
        <Link href={asHost ? "/host" : "/admin"} className="inline-flex min-h-11 items-center underline underline-offset-2">
          ← {asHost ? "Hosting" : "Admin"}
        </Link>
      </p>
      <h1 className={warm.title}>{question ? "A bank's question about a payment" : "A bank dispute"}</h1>

      <div className="mt-6 rounded border border-neutral-400 p-4 text-sm" data-dispute={dispute.id} data-stage={dispute.stage} data-standing={standing}>
        <p>
          {question ? `${names.customer}'s bank has asked about ` : `${names.customer}'s bank has opened a dispute over `}
          {what}.
        </p>
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
          <dt className="opacity-70">Amount</dt>
          <dd data-amount>{formatMoney(dispute.amountCents)}</dd>
          <dt className="opacity-70">The bank&apos;s reason</dt>
          <dd>{reasonWords(dispute.reason)}</dd>
          <dt className="opacity-70">Opened</dt>
          <dd>
            <LocalTime iso={dispute.openedAt.toISOString()} />
          </dd>
          <dt className="opacity-70">Where it stands</dt>
          <dd data-where>
            {standing === "waiting" && !dispute.noAnswer && (question ? "The bank is waiting for an answer to its question." : "The bank is waiting for an answer.")}
            {standing === "waiting" && dispute.noAnswer && "The bank is deciding by itself. It takes no answer to this one."}
            {standing === "with_bank" && !isAppeal(dispute.status) && "The bank is deciding. That can take up to three months."}
            {standing === "with_bank" && isAppeal(dispute.status) && "The bank is looking at it once more (an appeal)."}
            {standing === "won" && "It has ended: the payment stands."}
            {standing === "lost" && "It has ended: the bank returned the money to the customer."}
            {standing === "closed" && (question ? "The bank closed its question. It did not become a dispute." : "It was closed without a decision by the bank.")}
          </dd>
          {founder && !asHost && standing === "waiting" && (
            <>
              <dt className="opacity-70">The bank&apos;s deadline</dt>
              <dd data-due>{dispute.noAnswer ? "The bank takes no answer to this one." : dispute.dueBy ? <LocalTime iso={dispute.dueBy.toISOString()} /> : "Stripe gives no date."}</dd>
            </>
          )}
        </dl>
      </div>

      <div className="mt-6 text-sm" data-what-it-means>
        {asHost ? (
          <>
            {(standing === "waiting" || standing === "with_bank") && (
              <p>
                While this is open, the money for this payment cannot be collected. The bank decides how it ends, and we will tell you when it has. Please do not contact the
                customer about it.
              </p>
            )}
            {(standing === "won" || standing === "closed") && (
              <p>
                This dispute no longer holds the money for this payment back. Your{" "}
                <Link href="/host" className="underline underline-offset-2">
                  earnings
                </Link>{" "}
                show when it can be collected.
              </p>
            )}
            {standing === "lost" && (
              <p>
                Your share of the {formatMoney(dispute.amountCents)} the bank returned is no longer yours, and the money for this payment stays held back. If you had already
                collected it, Connect may ask you to pay it back.
              </p>
            )}
            <p className="mt-3 opacity-70">
              If you think something here is wrong, write to{" "}
              <a href={`mailto:${SUPPORT_EMAIL}`} className="underline underline-offset-2">
                {SUPPORT_EMAIL}
              </a>
              .
            </p>
          </>
        ) : (
          <>
            {standing === "waiting" && !dispute.noAnswer && <p>The app does not answer the bank yet. For now this still has to be answered by hand in Stripe, before the bank&apos;s deadline.</p>}
            {standing === "waiting" && dispute.noAnswer && <p>The bank takes no answer to this one, so there is nothing to send. It decides by itself.</p>}
            {standing === "with_bank" && !isAppeal(dispute.status) && <p>Nothing can be sent to the bank now. The money for this payment stays where it is until the bank has decided.</p>}
            {standing === "with_bank" && isAppeal(dispute.status) && (
              <p>
                The app sends nothing to the bank in an appeal. If something has to be sent, that is done by hand in Stripe. The money for this payment stays where it is until the
                bank has decided.
              </p>
            )}
            {(standing === "won" || standing === "closed") && <p>This dispute no longer holds the money for this payment back.</p>}
            {standing === "lost" && (
              <p>The host&apos;s share of this payment stays held back. If the host had already collected it, the app takes nothing back: that still has to be settled by hand.</p>
            )}
            <p className="mt-3 opacity-70" data-stripe-id>
              At Stripe: {dispute.id}
              {dispute.compliance ? ". This is a compliance dispute: fighting it costs 500 dollars." : ""}
            </p>
          </>
        )}
      </div>
    </SitePage>
  );
}
