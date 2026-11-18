import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { LocalTime } from "@/components/local-time";
import { SitePage } from "@/components/site-page";
import { warm } from "@/components/warm-ui";
import { db } from "@/db";
import type { MembershipOffer } from "@/db/schema";
import { offerOf, openTimes } from "@/lib/booking/bookings";
import { firstLength } from "@/lib/booking/rules";
import { hostForMemberByHandle, invitationFor, membershipFor, oldInvitationFor, ownMembershipByHandle, type HostForMember } from "@/lib/membership/access";
import { secretToPay } from "@/lib/membership/charge";
import { offerOfHost } from "@/lib/membership/offers";
import { monthTotalCents, timeWords } from "@/lib/membership/rules";
import { agreementBox, agreementSentences, MEMBERSHIP_WORDING_VERSION } from "@/lib/membership/wording";
import { readNotice } from "@/lib/notice";
import { formatMoney } from "@/lib/payments/access";
import { stripePublishableKey } from "@/lib/payments/stripe";
import { membershipsOnFor } from "@/lib/safety/switches";
import { requireUser } from "@/lib/session";
import { joinAction, payNowAction, resumeAction } from "./actions";
import { MembershipCardForm, PaymentCheck } from "./card-form";

// The same title whoever asks, so the page's title gives nothing away before it is known who may see it.
export const metadata: Metadata = { title: "Membership" };

export const dynamic = "force-dynamic";

const CLOSED_WHY: Record<string, string> = {
  ran_out: "Its 24 hours are over.",
  taken_back: "The host took it back.",
  replaced: "The host has sent you a newer invitation since. Please use the link in the newer email.",
};

/**
 * The invitation, joining and resuming (the rulebook's "Joining" and "A paused membership, and
 * resuming"). For the person an invitation was sent to, for someone at the card step, and for a
 * paused member, also when the host's page is hidden from the public; for everyone else it is
 * "not found", like a page that does not exist.
 *
 * Opening or reloading this page never starts anything: it never makes a payment, a month or a
 * membership, and never moves a deadline. Only the buttons do, through the actions.
 */
export default async function MembershipJoinPage(props: PageProps<"/h/[handle]/membership">) {
  const { handle } = await props.params;
  const query = await props.searchParams;
  const invite = typeof query.invite === "string" ? query.invite : "";
  const here = `/h/${handle}/membership`;
  const user = await requireUser(invite ? `${here}?invite=${encodeURIComponent(invite)}` : here);
  const notice = readNotice(here, query);
  const now = new Date();

  // An invitation's link: for the person it was sent to, for this host, and for exactly that invitation.
  if (invite) {
    const invited = await invitationFor(user.id, invite, now);
    if (invited && invited.host.handle === handle.toLowerCase()) {
      return <Invitation invite={invite} host={invited.host} offer={invited.offer} minutes={invited.membership.inviteMinutes ?? invited.offer.includedMinutes} expiresAt={invited.membership.inviteExpiresAt} expired={invited.expired} notice={notice} now={now} />;
    }
  }

  const host = await hostForMemberByHandle(user.id, handle, now);
  // Their own membership with this host. It is found apart from the host's page: when a card step's time has just run out,
  // the host's page is closed to a first-time joiner again, but what became of their payment is still theirs to see.
  const own = await ownMembershipByHandle(user.id, handle);
  const mine = own && (host || own.membership.status === "joining") ? own.membership : undefined;

  if (invite) {
    // An old link says what became of it, and never opens a newer invitation. Someone else's link is "not found".
    const old = await oldInvitationFor(user.id, invite);
    if (!old) notFound();
    // After "Join", the same link leads on to the card step or to the membership.
    if (old.outcome !== "accepted" || !mine || mine.inviteId?.toLowerCase() !== invite.toLowerCase()) {
      return (
        <Frame title="This invitation is no longer open">
          {old.outcome === "accepted" ? (
            <p className="mt-4 text-sm">
              It was already used to join, and cannot be used a second time. How that membership stands is on{" "}
              <Link href="/account#memberships" className="underline underline-offset-2">
                Your account
              </Link>
              .
            </p>
          ) : (
            <>
              <p className="mt-4 text-sm">{CLOSED_WHY[old.outcome] ?? "It can no longer be used."} Nothing was charged.</p>
              <p className="mt-2 text-sm">If you would still like to join, ask the host to invite you again.</p>
            </>
          )}
        </Frame>
      );
    }
  }
  if (!own || !mine) notFound();
  const hostName = host?.displayName ?? own.hostName;

  // Their own open invitation, reached without its link: the link is theirs to have.
  if (mine.status === "invited") redirect(mine.inviteId ? `${here}?invite=${mine.inviteId}` : `/h/${own.handle}`);
  if (mine.status === "active" || mine.status === "unpaid") redirect(`/memberships/${mine.id}`);

  if (mine.status === "joining") {
    const found = await membershipFor(user.id, mine.id);
    const month = found?.months.find((m) => m.id === mine.currentMonthId);
    if (!month) notFound();
    const ranOut = month.status !== "to_pay" || Boolean(month.endedHow) || Boolean(month.cardStepExpiresAt && month.cardStepExpiresAt <= now);
    // Read only: the secret of the payment this month already has, for its member, while it can still be paid.
    const secret = ranOut ? null : await secretToPay({ monthId: month.id, memberId: user.id, now });
    return (
      <Frame title={`Your membership with ${hostName}: your card`} back={host ? { href: `/h/${host.handle}`, text: host.displayName } : undefined}>
        {notice && <Notice text={notice} />}
        <p className="mt-4 text-sm">
          <strong>
            {formatMoney(month.totalCents)} a month for {timeWords(month.includedMinutes)}
          </strong>{" "}
          of calls with {hostName}.{ranOut ? "" : " Enter your card: the first month's amount is then held on it, and your membership starts at that moment."}
        </p>
        {ranOut ? (
          <>
            {/* Nothing is claimed before the bank was asked: a hold placed in time, whose way back arrived late, still counts. */}
            <p role="alert" className="mt-4 rounded border border-red-600 p-3 text-sm">
              The time for the card step is over. We are checking with the bank what became of your payment. If your card was held in time, your membership has started and this page shows it in a moment. If not, you are not a member and nothing is
              charged; a hold your bank may show is let go, though it can still be shown for a few days. You can then start again from your invitation, or from &quot;Your account&quot; if you were a member before.
            </p>
            <PaymentCheck membershipId={mine.id} monthId={month.id} />
          </>
        ) : secret ? (
          <>
            {month.cardStepExpiresAt && (
              <p className="mt-2 text-sm opacity-70">
                This step is open until <LocalTime iso={month.cardStepExpiresAt.toISOString()} />. After that your place is given up and nothing is charged.
              </p>
            )}
            <MembershipCardForm membershipId={mine.id} monthId={month.id} clientSecret={secret.clientSecret} publishableKey={stripePublishableKey()} button={`Hold ${formatMoney(month.totalCents)} and start my membership`} />
            <p className="mt-3 text-sm opacity-70">The amount is only held now. It is taken when you make your first booking of the month, or after 72 hours, whichever comes first. Your card is kept for the monthly payment.</p>
          </>
        ) : (
          <>
            <p className="mt-4 text-sm">One moment: your payment is not ready for your card yet, or it is already being looked at.</p>
            <form action={payNowAction} className="mt-3">
              <input type="hidden" name="membership" value={mine.id} />
              <input type="hidden" name="from" value="join" />
              <button type="submit" className={warm.button}>
                Continue to the card step
              </button>
            </form>
            <PaymentCheck membershipId={mine.id} monthId={month.id} />
          </>
        )}
      </Frame>
    );
  }

  // Only a card step is shown while the host's page is closed to this person.
  if (!host) notFound();

  // Paused: resuming is joining again without an invitation, on the host's membership as it is now.
  const offer = await offerOfHost(db, host.userId);
  const open = Boolean(offer?.on) && (await membershipsOnFor(host.userId));
  return (
    <Frame title={`Resume your membership with ${host.displayName}`} back={{ href: `/memberships/${mine.id}`, text: "Your membership" }}>
      {notice && <Notice text={notice} />}
      <p className="mt-4 text-sm">Your membership is paused. It costs nothing and gives no member time.</p>
      {!offer || !open ? (
        <p className="mt-2 text-sm">{host.displayName} is not offering a membership at the moment, so yours cannot be resumed now. It stays paused, and you can still book {host.displayName} like any customer.</p>
      ) : (
        <>
          <p className="mt-2 text-sm">Resuming is like joining again: you get {host.displayName}&apos;s membership as it is now, and a new month starts today.</p>
          <Terms host={host} offer={offer} minutes={offer.includedMinutes} />
          <form action={resumeAction} className="mt-5 text-sm">
            <input type="hidden" name="handle" value={host.handle} />
            <input type="hidden" name="membership" value={mine.id} />
            <input type="hidden" name="offerVersion" value={offer.version} />
            <Agree hostName={host.displayName} />
            <button type="submit" className={`${warm.button} mt-4`}>
              Resume membership
            </button>
            <p className="mt-2 opacity-70">The next page asks for your card. Nothing is held before that. Resuming needs room in {host.displayName}&apos;s hours; if there is none right now, you are told and nothing changes.</p>
          </form>
        </>
      )}
    </Frame>
  );
}

function Frame(props: { title: string; back?: { href: string; text: string }; children: React.ReactNode }) {
  return (
    <SitePage className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6 sm:py-12">
      {props.back && (
        <p className="text-sm">
          <Link href={props.back.href} className="inline-flex min-h-11 items-center underline underline-offset-2">
            ← {props.back.text}
          </Link>
        </p>
      )}
      <h1 className={`${warm.title} mt-2`}>{props.title}</h1>
      {props.children}
    </SitePage>
  );
}

function Notice({ text }: { text: string }) {
  return (
    <p role="alert" className="mt-4 rounded border border-neutral-400 p-3 text-sm">
      {text}
    </p>
  );
}

/** What the membership is: the monthly amount, the time, the member price beside the regular price, and the sentences the person agrees to. */
function Terms({ host, offer, minutes }: { host: HostForMember; offer: MembershipOffer; minutes: number }) {
  const monthly = monthTotalCents(offer.pricePer15Cents, minutes);
  return (
    <section className={`${warm.card} mt-5`}>
      <p className="text-lg font-semibold">
        {formatMoney(monthly)} a month for {timeWords(minutes)} of calls
      </p>
      <p className="mt-1 text-sm">
        Your member price is {formatMoney(offer.pricePer15Cents)} per 15 minutes. {host.displayName}&apos;s regular price is {formatMoney(host.pricePer15Cents)} per 15 minutes, so the same time would cost{" "}
        {formatMoney(monthTotalCents(host.pricePer15Cents, minutes))} the ordinary way.
      </p>
      <ul className="mt-4 list-disc space-y-2 pl-5 text-sm">
        {agreementSentences({ hostName: host.displayName, monthlyCents: monthly, includedMinutes: minutes }).map((sentence) => (
          <li key={sentence}>{sentence}</li>
        ))}
      </ul>
    </section>
  );
}

/** The tick box, the version of the sentences that were shown, and a request id made now, when the page is drawn: a second press of the same form joins once. */
function Agree({ hostName }: { hostName: string }) {
  return (
    <>
      <input type="hidden" name="wording" value={MEMBERSHIP_WORDING_VERSION} />
      <input type="hidden" name="request" value={randomUUID()} />
      <label className="flex items-start gap-2">
        <input type="checkbox" name="agreed" required className="mt-1" />
        <span>{agreementBox(hostName)}</span>
      </label>
    </>
  );
}

async function Invitation(props: { invite: string; host: HostForMember; offer: MembershipOffer; minutes: number; expiresAt: Date | null; expired: boolean; notice: string | null; now: Date }) {
  const { host, offer, minutes, now } = props;
  if (props.expired) {
    return (
      <Frame title="This invitation has run out">
        <p className="mt-4 text-sm">An invitation is open for 24 hours. Nothing was charged. If you would still like to join, ask {host.displayName} to invite you again.</p>
      </Frame>
    );
  }
  // The host's open times for the coming weeks, as a member would find them (general hours and hours for members only).
  const calendar = host.canBook ? await offerOf(host.userId, db, { forMember: true }) : null;
  const length = calendar ? firstLength(calendar.lengths) : null;
  const times = calendar && length ? (await openTimes(calendar, length, now)).slice(0, 8) : [];
  return (
    <Frame title={`${host.displayName} invites you to a membership`} back={{ href: `/h/${host.handle}`, text: host.displayName }}>
      {props.notice && <Notice text={props.notice} />}
      <p className="mt-4 text-sm">
        A membership is a fixed amount each month, and that money is your talk time with {host.displayName} at a lower price. Calls you book with it are booked at once.
        {props.expiresAt && (
          <>
            {" "}
            This invitation is open until <LocalTime iso={props.expiresAt.toISOString()} />. Nothing is charged unless you join.
          </>
        )}
      </p>
      <Terms host={host} offer={offer} minutes={minutes} />
      <section className="mt-5 text-sm">
        <h2 className="font-semibold">{host.displayName}&apos;s next open times</h2>
        {times.length === 0 ? (
          <p className="mt-1 opacity-70">{host.canBook ? "There are no open times right now. New ones appear on their page." : `${host.displayName}'s page is being checked at the moment, so no times can be booked right now.`}</p>
        ) : (
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {times.map((time) => (
              <li key={time.toISOString()}>
                <LocalTime iso={time.toISOString()} />
              </li>
            ))}
          </ul>
        )}
      </section>
      <form action={joinAction} className="mt-6 text-sm">
        <input type="hidden" name="handle" value={host.handle} />
        <input type="hidden" name="invite" value={props.invite} />
        <Agree hostName={host.displayName} />
        <button type="submit" className={`${warm.button} mt-4`}>
          Join
        </button>
        <p className="mt-2 opacity-70">The next page asks for your card. Nothing is held before that.</p>
      </form>
    </Frame>
  );
}
