import type { Metadata } from "next";
import { eq, inArray } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LocalTime } from "@/components/local-time";
import { SitePage } from "@/components/site-page";
import { db, schema } from "@/db";
import type { Membership, MembershipMonth, MembershipRefund } from "@/db/schema";
import { hostForMember, membershipFor } from "@/lib/membership/access";
import { PAUSED_WHY } from "@/lib/membership/emails";
import { holdTiming, isFrozen, minutesCovered, monthTotalCents, timeWords } from "@/lib/membership/rules";
import { readNotice } from "@/lib/notice";
import { formatMoney } from "@/lib/payments/access";
import { membershipsOnFor } from "@/lib/safety/switches";
import { requireUser } from "@/lib/session";
import { ownFourteenDays } from "@/lib/membership/fourteen-days";
import { acceptOfferAction, cancelAction, cancelNowAction, cancelWithin14DaysAction, declineOfferAction, keepAction } from "./actions";

// The same title whoever asks: nothing is given away before it is known who may see the page.
export const metadata: Metadata = { title: "Your membership" };

export const dynamic = "force-dynamic";

const button = "rounded border border-neutral-500 px-3 py-1.5 text-sm";
const NOT_CHARGED: Record<string, string> = {
  cancel_now: "you chose \"Cancel now\"",
  // (A month is given up after 7 days without a payment, and also when the member or the host cancels while its payment is still open.)
  given_up: "its payment did not go through, or was cancelled before it did",
  ending: "the membership ended",
  card_step: "the card step was not finished in time",
  no_room: "the host's hours had no room",
  hold_lost: "your bank released the hold before it was taken",
  cancelled_at_stripe: "the payment was cancelled",
  offer_off: "the host had switched the membership off",
  switch: "memberships were not being renewed",
};

/**
 * One membership, for its member and nobody else (the rulebook's "Cancelling the membership",
 * "Switching back on" and "A paused membership, and resuming"): where it stands, the time left,
 * the buttons the rulebook offers in that state and no others, an open offer of less time, and the
 * monthly receipts. Someone else's membership and one that does not exist are both "not found".
 */
export default async function MembershipPage(props: PageProps<"/memberships/[id]">) {
  const { id } = await props.params;
  const here = `/memberships/${id}`;
  const user = await requireUser(here);
  const found = await membershipFor(user.id, id);
  if (!found) notFound();
  const { membership, months } = found;
  const query = await props.searchParams;
  const notice = readNotice(`/memberships/${membership.id}`, query) ?? readNotice(here, query);
  const askedOffer = typeof query.offer === "string" ? query.offer : "";
  const now = new Date();
  // A new membership in its first 14 days can be cancelled at once by its member (plans/46, part 3c).
  const fourteen = await ownFourteenDays(membership, now);

  // The host as this member may see her (also when her page is hidden). An ended membership still names her.
  const [host, [profile], open, [hostOffer], payBacks] = await Promise.all([
    hostForMember(user.id, membership.hostId, now),
    db.select({ displayName: schema.hostProfiles.displayName, handle: schema.hostProfiles.handle }).from(schema.hostProfiles).where(eq(schema.hostProfiles.userId, membership.hostId)),
    membershipsOnFor(membership.hostId),
    db.select({ on: schema.membershipOffers.on }).from(schema.membershipOffers).where(eq(schema.membershipOffers.hostId, membership.hostId)),
    months.length > 0 ? db.select().from(schema.membershipRefunds).where(inArray(schema.membershipRefunds.monthId, months.map((month) => month.id))) : Promise.resolve([] as MembershipRefund[]),
  ]);
  const hostName = host?.displayName ?? profile?.displayName ?? "your host";
  const current = months.find((month) => month.id === membership.currentMonthId) ?? null;
  const started = current && (current.status === "running" || current.status === "held") && current.endsAt && current.endsAt > now ? current : null;
  const frozen = current ? isFrozen(current) : false;
  const ownPrice = membership.ownPricePer15Cents ?? 0;
  const ownMinutes = membership.ownMinutes ?? 0;
  const nextCents = monthTotalCents(ownPrice, ownMinutes);

  return (
    <SitePage className="mx-auto w-full max-w-2xl px-4 py-10">
      <p className="text-sm">
        <Link href="/account#memberships" className="inline-flex min-h-11 items-center underline underline-offset-2">
          ← Your account
        </Link>
      </p>
      <h1 className="mt-2 text-2xl font-semibold">Your membership with {hostName}</h1>

      {notice && (
        <p role="status" className="mt-4 rounded border border-neutral-400 p-3 text-sm">
          {notice}
        </p>
      )}
      {/* An offer can be answered strictly before the month ends: after that its link says so, also before the helper has tidied it away. */}
      {askedOffer && (membership.offerId?.toLowerCase() !== askedOffer.toLowerCase() || !started) && (
        <p role="status" className="mt-4 rounded border border-neutral-400 p-3 text-sm">
          The offer of less time that this link was for is no longer open: it was answered, taken back, or its time ran out. This page shows how your membership stands now.
        </p>
      )}

      <section className="mt-6 text-sm">
        {membership.status === "invited" &&
          (membership.inviteExpiresAt && membership.inviteExpiresAt > now && profile ? (
            <p>
              {hostName} has invited you. The invitation is open until <LocalTime iso={membership.inviteExpiresAt.toISOString()} />.{" "}
              <Link href={`/h/${profile.handle}/membership?invite=${membership.inviteId}`} className="underline underline-offset-2">
                See the invitation
              </Link>
            </p>
          ) : (
            <p>The invitation has run out. You are not a member, and nothing was charged.</p>
          ))}

        {membership.status === "joining" && (
          <p>
            You are at the card step: you are not a member until your card is entered and the first month is held on it.{" "}
            {host && (
              <Link href={`/h/${host.handle}/membership`} className="underline underline-offset-2">
                Go to the card step
              </Link>
            )}
          </p>
        )}

        {membership.status === "active" && started && <Running membership={membership} month={started} hostName={hostName} hostHandle={host?.handle ?? null} canBook={host?.canBook ?? false} open={open} offerOn={Boolean(hostOffer?.on)} frozen={frozen} nextCents={nextCents} fourteenUntil={fourteen?.lastDay ?? null} fourteenAsked={fourteen?.asked ?? null} fourteenBlockedBy={fourteen?.blockedBy ?? null} now={now} />}

        {membership.status === "active" && !started && (
          <>
            {current?.status === "to_pay" ? (
              <p>
                <strong>Your next month is being started.</strong> {formatMoney(current.totalCents)} is being held on your card right now. This page shows your time as soon as that is done; it usually takes less than a minute.
              </p>
            ) : membership.memberStoppedAt || membership.hostStoppedAt || membership.offerStoppedAt || membership.offerId || !open ? (
              <p>
                <strong>Your month has ended.</strong> Your membership is being paused, and no new month is charged. This page shows it in a moment.
              </p>
            ) : (
              <p>
                <strong>Your month has ended.</strong> Your next month is being started. This page shows your time as soon as that is done; it usually takes less than a minute.
              </p>
            )}
            {/* Cancelling stays possible in this in-between moment too: a member must always be able to stop a payment. */}
            {(current?.status === "to_pay" || !membership.memberStoppedAt) && (
              <form action={cancelAction} className="mt-4">
                <input type="hidden" name="membership" value={membership.id} />
                <button type="submit" className={button}>
                  Cancel membership
                </button>
                <span className="ml-2 opacity-70">
                  {current?.status === "to_pay"
                    ? "If the payment is still open when you press this, it is cancelled, your membership is paused at once and nothing is charged for the new month. If it has gone through by then, the new month is yours, and your membership ends when that month is over."
                    : "If your next month has not started when you press this, no new month is charged and your membership is paused. If it has started by then, that month is yours, and your membership ends when it is over."}
                </span>
              </form>
            )}
          </>
        )}

        {membership.status === "unpaid" && current && (
          <>
            <p>
              <strong>Your monthly payment did not go through.</strong> {current.needsAction ? "Your bank wants you to approve it yourself. " : ""}Until it does you have no member time and cannot book as a member.
            </p>
            <p className="mt-2">
              <Link href={`/memberships/${membership.id}/pay`} className="inline-flex min-h-11 items-center rounded bg-blue-600 px-4 py-2 font-medium text-white">
                Pay now: {formatMoney(current.totalCents)}
              </Link>
            </p>
            {current.giveUpAt && (
              <p className="mt-2 opacity-80">
                {current.nextTryAt && current.nextTryAt > now ? (
                  <>
                    We also try your card again on <LocalTime iso={current.nextTryAt.toISOString()} />.{" "}
                  </>
                ) : null}
                If no payment has gone through by <LocalTime iso={current.giveUpAt.toISOString()} />, your membership is paused. Nothing is charged while it is paused.
              </p>
            )}
            <form action={cancelAction} className="mt-4">
              <input type="hidden" name="membership" value={membership.id} />
              <button type="submit" className={button}>
                Cancel membership
              </button>
              <span className="ml-2 opacity-70">
                If the payment is still open when you press this, it is cancelled, your membership is paused at once and nothing is charged. If it has gone through by then, that month is yours, and your membership ends when it is over.
              </span>
            </form>
          </>
        )}

        {membership.status === "paused" && (
          <>
            <p>
              <strong>Paused{membership.pausedReason && PAUSED_WHY[membership.pausedReason] ? `, because ${PAUSED_WHY[membership.pausedReason]}` : ""}.</strong> It costs nothing and gives no member time. You can still book {hostName} like any customer.
            </p>
            <p className="mt-2 opacity-80">Resuming is like joining again: you get {hostName}&apos;s membership as it is then, tick the box, enter a card, and a new month starts.</p>
            {host ? (
              <p className="mt-2">
                <Link href={`/h/${host.handle}/membership`} className="inline-flex min-h-11 items-center rounded bg-blue-600 px-4 py-2 font-medium text-white">
                  Resume membership
                </Link>
              </p>
            ) : (
              <p className="mt-2">It cannot be resumed at the moment.</p>
            )}
          </>
        )}

        {membership.status === "ended" && (
          <p>
            <strong>Ended{membership.endedReason ? `: ${membership.endedReason}` : ""}.</strong> You are not charged for it again. It cannot be resumed or switched back on; coming back needs a new invitation from {hostName}. Your receipts, and anything paid back, are below.
          </p>
        )}
      </section>

      {membership.offerId && membership.offeredMinutes && started && (
        <section className="mt-6 rounded border border-neutral-400 p-3 text-sm">
          <h2 className="font-semibold">{hostName} offers you less time</h2>
          <p className="mt-1">
            {hostName} is cutting their hours. They offer you {timeWords(membership.offeredMinutes)} a month instead of {timeWords(ownMinutes)}, at your same price. You would pay {formatMoney(monthTotalCents(ownPrice, membership.offeredMinutes))} a
            month instead of {formatMoney(nextCents)}, from your next month on <LocalTime iso={started.endsAt!.toISOString()} />. Answer before then. The month you paid for does not change either way.
          </p>
          <p className="mt-1 opacity-80">
            The smaller time stays, also if {hostName} adds hours again later. With &quot;No thanks&quot;, or no answer, your membership is paused when this month ends, and that cannot be taken back by {hostName}; you can resume later when there is room.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <form action={acceptOfferAction}>
              <input type="hidden" name="membership" value={membership.id} />
              <input type="hidden" name="offer" value={membership.offerId} />
              <button type="submit" className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white">
                Accept {timeWords(membership.offeredMinutes)} a month
              </button>
            </form>
            <form action={declineOfferAction}>
              <input type="hidden" name="membership" value={membership.id} />
              <input type="hidden" name="offer" value={membership.offerId} />
              <button type="submit" className={button}>
                No thanks
              </button>
            </form>
          </div>
        </section>
      )}

      <section className="mt-8 text-sm">
        <h2 className="text-lg font-semibold">Monthly receipts</h2>
        {months.length === 0 ? (
          <p className="mt-2 opacity-70">Nothing has been charged.</p>
        ) : (
          <ul className="mt-2 space-y-3">
            {months.map((month) => (
              <Receipt key={month.id} month={month} payBacks={payBacks.filter((line) => line.monthId === month.id)} />
            ))}
          </ul>
        )}
      </section>
    </SitePage>
  );
}

/** The one moment a held month's page and receipt name: until then "Cancel now" is offered, and the money is taken right after it. */
const lastFreeMoment = (month: MembershipMonth): Date | null => (month.authorisedAt && month.holdExpiresAt ? holdTiming({ authorisedAt: month.authorisedAt, holdExpiresAt: month.holdExpiresAt }).offeredUntil : month.takeAt);

/** A membership with a month that has started: the time, the hold, whether and when it renews, and the buttons. */
function Running(props: { membership: Membership; month: MembershipMonth; hostName: string; hostHandle: string | null; canBook: boolean; open: boolean; offerOn: boolean; frozen: boolean; nextCents: number; /** The last day (UTC) "Cancel within 14 days" is open for this new membership, or null when it is not. */ fourteenUntil: string | null; /** A request to cancel within 14 days that is on record and not finished: the button stays, also after the last day. */ fourteenAsked: { day: string; inWriting: boolean } | null; /** A rule that stops such a request for now: said on the page, with no button. */ fourteenBlockedBy: string | null; now: Date }) {
  const { membership, month, hostName, now, fourteenUntil, fourteenAsked, fourteenBlockedBy } = props;
  // A month whose payment has a problem the founder must look at (Stripe took a part, or holds more than one payment): its time is not there to book.
  const troubled = Boolean(month.problem);
  const held = month.status === "held";
  const freeCents = held ? month.totalCents : month.freeCents;
  const endsAt = month.endsAt!;
  // The last moment "Cancel now" is offered: 72 hours after the bank's own time for the hold, or sooner if the card's hold ends sooner.
  const cancelNowUntil = held ? lastFreeMoment(month) : null;
  const canCancelNow = Boolean(cancelNowUntil && cancelNowUntil > now);
  const saidNo = Boolean(membership.hostStoppedAt) && membership.pausedReason === "offer";
  const stopped = Boolean(membership.memberStoppedAt || membership.hostStoppedAt || membership.offerStoppedAt);
  const ownStop = Boolean(membership.memberStoppedAt || membership.offerStoppedAt);
  const price = formatMoney(membership.ownPricePer15Cents ?? month.pricePer15Cents);
  const time = timeWords(membership.ownMinutes ?? month.includedMinutes);

  return (
    <>
      {troubled ? (
        <p role="alert" className="rounded border border-red-600 p-3">
          There is a problem with this month&apos;s payment, and we are looking into it. Until it is settled, this month&apos;s time cannot be booked. You do not need to do anything; we will write to you. The month runs until{" "}
          <LocalTime iso={endsAt.toISOString()} />.
        </p>
      ) : (
        <p>
          <strong>{timeWords(minutesCovered(freeCents, month.pricePer15Cents))} left this month</strong>, until <LocalTime iso={endsAt.toISOString()} />. Your price is {formatMoney(month.pricePer15Cents)} per 15 minutes.
        </p>
      )}
      {props.frozen && (
        <p role="alert" className="mt-2 rounded border border-red-600 p-3">
          This month is frozen, because its payment is disputed with your bank. Until that is settled its time cannot be booked, used or paid back.
        </p>
      )}
      {held && !troubled && (
        <p className="mt-2">
          This month&apos;s {formatMoney(month.totalCents)} is <strong>held on your card, not yet taken</strong>. It is taken when you make your first booking of the month
          {cancelNowUntil ? (
            <>
              , or on <LocalTime iso={cancelNowUntil.toISOString()} />, whichever comes first
            </>
          ) : null}
          .
        </p>
      )}
      {!props.canBook ? (
        <p className="mt-2">No new bookings can be made at the moment, because {hostName}&apos;s page is being checked. Your membership, your time and your receipts stay as they are.</p>
      ) : props.hostHandle && !props.frozen && !troubled ? (
        <p className="mt-2">
          <Link href={`/h/${props.hostHandle}#member`} className="inline-flex min-h-11 items-center underline underline-offset-2">
            Book a call with your membership
          </Link>
        </p>
      ) : null}

      <h2 className="mt-6 text-lg font-semibold">{stopped ? "It does not renew" : "Your next payment"}</h2>
      {!stopped && (
        <p className="mt-1">
          {!props.open
            ? "Memberships are not being renewed at the moment. If that is still so when this month ends, yours is paused then and nothing is charged."
            : membership.offerId
              ? `Your membership renews on that day only if you accept the smaller time ${hostName} offered (below). Otherwise it is paused then.`
              : `${formatMoney(props.nextCents)} for ${time}, at ${price} per 15 minutes, is held on your card when this month ends.`}
        </p>
      )}
      {membership.memberStoppedAt && (
        <p className="mt-1">
          You cancelled. Your membership <strong>ends on <LocalTime iso={endsAt.toISOString()} /></strong> and is then paused. Until then nothing changes: your bookings stay, and the time you have left can still be booked and used. No new month is
          charged.
        </p>
      )}
      {membership.offerStoppedAt && <p className="mt-1">{hostName} switched the membership off during this month, so it does not renew. Once it is on again, &quot;Keep my membership&quot; brings your renewal back.</p>}
      {saidNo && <p className="mt-1">You said &quot;No thanks&quot; to the smaller time {hostName} offered, so your membership is paused when this month ends. You can resume it later when there is room.</p>}
      {membership.hostStoppedAt && !saidNo && <p className="mt-1">{hostName} has paused your membership after this month. Only {hostName} can take that back. You can resume by yourself afterwards, when there is room.</p>}

      {ownStop && !(props.open && props.offerOn) && (
        <p className="mt-3">
          &quot;Keep my membership&quot; is not open at the moment, because {!props.offerOn ? `${hostName} is not offering a membership right now` : "memberships are not being renewed at the moment"}. If that changes before this month ends, the button is here
          again. Otherwise your membership is paused then, and you can resume it later.
        </p>
      )}
      {ownStop && props.open && props.offerOn && (
        <form action={keepAction} className="mt-3">
          <input type="hidden" name="membership" value={membership.id} />
          <button type="submit" className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white">
            Keep my membership
          </button>
          <p className="mt-2 opacity-80">
            Nothing is charged at that moment.{" "}
            {membership.hostStoppedAt
              ? "It takes back your own cancelling only: your membership stays set to pause when this month ends, for the reason above."
              : (
                  <>
                    Your next payment would be {formatMoney(props.nextCents)} for {time}, on <LocalTime iso={endsAt.toISOString()} />. It needs room in {hostName}&apos;s hours for your next month.
                  </>
                )}
          </p>
        </form>
      )}

      {fourteenAsked && fourteenBlockedBy && (
        <p className="mt-6 rounded border border-neutral-400 p-3" data-fourteen-on-record>
          {fourteenAsked.inWriting ? `Your request to cancel within 14 days reached us on ${fourteenAsked.day} (UTC), in time, ` : `You pressed "Cancel within 14 days" on ${fourteenAsked.day} (UTC), in time, `}
          and it could not be finished yet. It is on record, so the 14 days cannot run out on it. {fourteenBlockedBy}
        </p>
      )}

      {(!membership.memberStoppedAt || canCancelNow || fourteenUntil) && (
        <details className="mt-6">
          <summary className="cursor-pointer underline underline-offset-2">Cancel membership</summary>
          <p className="mt-2">
            Your price of {price} per 15 minutes and your {time} a month are yours while your membership goes on. If it is paused and you come back later, you get {hostName}&apos;s membership as it is then.
          </p>
          <div className="mt-3 flex flex-wrap items-start gap-3">
            {!membership.memberStoppedAt && (
              <form action={cancelAction}>
                <input type="hidden" name="membership" value={membership.id} />
                <button type="submit" className={button}>
                  Cancel at the end of the month
                </button>
              </form>
            )}
            {canCancelNow && (
              <form action={cancelNowAction}>
                <input type="hidden" name="membership" value={membership.id} />
                {/* The month whose hold this button is about. */}
                <input type="hidden" name="month" value={month.id} />
                <button type="submit" className={button}>
                  Cancel now, nothing is charged
                </button>
              </form>
            )}
            {fourteenUntil && (
              <form action={cancelWithin14DaysAction} data-fourteen-days>
                <input type="hidden" name="membership" value={membership.id} />
                {/* The month this button is about: the first month of a new membership. */}
                <input type="hidden" name="month" value={month.id} />
                <button type="submit" className={button}>
                  Cancel within 14 days
                </button>
              </form>
            )}
          </div>
          <ul className="mt-3 list-disc space-y-1 pl-5 opacity-80">
            {fourteenUntil && (
              <li>
                {fourteenAsked ? (
                  <span data-fourteen-on-record>
                    {fourteenAsked.inWriting ? `Your request to cancel within 14 days reached us on ${fourteenAsked.day} (UTC), in time, ` : `You pressed "Cancel within 14 days" on ${fourteenAsked.day} (UTC), in time, `}
                    and it could not be finished yet. It is on record, so the 14 days cannot run out on it: we keep trying to finish it by ourselves, and you can press the button again here.{" "}
                  </span>
                ) : (
                  <>&quot;Cancel within 14 days&quot; is for a new membership, until the end of {fourteenUntil} (UTC). </>
                )}
                It <strong>ends your membership at once, for good</strong>: to come back you would need a new invitation from{" "}
                {hostName}. {held ? "If this month's amount is still only held on your card at that moment, it is let go and nothing is charged; if it has been taken by then, what you have not used goes back to your card." : "What you paid for this month goes back to your card, except for time you have used and for a call you cancelled late or missed that was already charged; those stay paid for at the member price."}{" "}
                Calls you have booked from your membership that are still to come are cancelled; one that has already begun is worked out as usual.
              </li>
            )}
            {!membership.memberStoppedAt && (
              <li>
                &quot;Cancel at the end of the month&quot; stops the renewal. Until <LocalTime iso={endsAt.toISOString()} /> nothing changes; that day your membership is paused.{held ? " The amount held for this month is still taken: the month is yours." : ""}
              </li>
            )}
            {canCancelNow && cancelNowUntil && (
              <li>
                &quot;Cancel now&quot; lets the hold on your card go and pauses your membership today. Nothing is charged for this month. It is offered until <LocalTime iso={cancelNowUntil.toISOString()} />, and only while nothing has been booked from
                this month.
              </li>
            )}
          </ul>
        </details>
      )}
    </>
  );
}

/** One month's receipt: what was held or paid and when, what became of the money, and anything paid back. */
function Receipt({ month, payBacks }: { month: MembershipMonth; payBacks: MembershipRefund[] }) {
  const paid = month.takenCents ?? 0;
  return (
    <li className="rounded border border-neutral-400 p-3">
      <p className="font-medium">
        Month {month.number}
        {month.startsAt && month.endsAt ? (
          <>
            : <LocalTime iso={month.startsAt.toISOString()} /> to <LocalTime iso={month.endsAt.toISOString()} />
          </>
        ) : null}
      </p>
      <p className="mt-1">
        {timeWords(month.includedMinutes)} at {formatMoney(month.pricePer15Cents)} per 15 minutes: {formatMoney(month.totalCents)}.{" "}
        {month.problem ? (
          <>
            This month&apos;s payment has a problem that we are looking into{paid > 0 ? `; ${formatMoney(paid)} was taken so far` : ""}.
          </>
        ) : month.status === "given_up" || (month.status === "to_pay" && month.endedHow) ? (
          <>Nothing was charged{month.endedHow && NOT_CHARGED[month.endedHow] ? `, because ${NOT_CHARGED[month.endedHow]}` : ""}.</>
        ) : month.status === "to_pay" ? (
          <>Not paid yet.</>
        ) : month.status === "held" ? (
          <>
            Held on your card, not yet taken
            {lastFreeMoment(month) ? (
              <>
                {" "}
                (taken at your first booking, or on <LocalTime iso={lastFreeMoment(month)!.toISOString()} />)
              </>
            ) : null}
            .
          </>
        ) : (
          <>
            {formatMoney(paid)} paid
            {month.takenAt ? (
              <>
                {" "}
                on <LocalTime iso={month.takenAt.toISOString()} />
              </>
            ) : null}
            .
          </>
        )}
      </p>
      {paid > 0 && (
        <p className="mt-1 opacity-80">
          Used on calls: {formatMoney(month.usedCents)}. Set aside for booked calls: {formatMoney(month.setAsideCents)}. Not used yet: {formatMoney(month.freeCents)}. Expired: {formatMoney(month.expiredCents)}. Paid back:{" "}
          {formatMoney(month.paidBackCents)}
          {month.toPayBackCents > 0 ? `, and ${formatMoney(month.toPayBackCents)} is on its way back to your card` : ""}.
        </p>
      )}
      {isFrozen(month) && <p className="mt-1">This month&apos;s payment is disputed with your bank, so nothing of it moves until that is settled.</p>}
      {payBacks.length > 0 && (
        <ul className="mt-1 list-disc space-y-1 pl-5 opacity-80">
          {payBacks.map((line) => (
            <li key={line.id}>
              {formatMoney(line.amountCents)} {line.status === "done" ? "paid back to your card" : "is being paid back to your card"}
              {line.status === "done" && line.finishedAt ? (
                <>
                  {" "}
                  on <LocalTime iso={line.finishedAt.toISOString()} />
                </>
              ) : null}
              . {line.reason}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
