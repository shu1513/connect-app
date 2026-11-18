import { inArray } from "drizzle-orm";
import Link from "next/link";
import { LocalTime } from "@/components/local-time";
import { db, schema } from "@/db";
import type { Membership, MembershipMonth } from "@/db/schema";
import { membersOfHost } from "@/lib/membership/access";
import { offerOfHost } from "@/lib/membership/offers";
import { hostMinutes, promisedMinutes } from "@/lib/membership/room";
import { MEMBERSHIP, minutesCovered, monthTotalCents, timeWords } from "@/lib/membership/rules";
import { formatMoney } from "@/lib/payments/access";
import { membershipsOnFor } from "@/lib/safety/switches";
import { endMemberAction, pauseMemberAction, takeBackOfferAction, undoPauseAction } from "./membership-actions";

const field = "mt-1 rounded border border-neutral-400 bg-transparent px-3 py-2";
const smallButton = "rounded border border-neutral-500 px-3 py-1.5 text-sm";

/** The times a membership can include: 30 minutes to 100 hours, in steps of 30 minutes. */
const TIMES = Array.from({ length: MEMBERSHIP.maxMinutes / MEMBERSHIP.stepMinutes }, (_, i) => (i + 1) * MEMBERSHIP.stepMinutes);

/**
 * The "Membership" part of Hosting (the rulebook's "How it works for a host"): the host's one
 * membership, the room her weekly hours have for members, and her member list. It reads only;
 * every button posts to an action that asks the library, which decides again.
 *
 * Two different states are kept apart when the founder's switch does not cover this host:
 * memberships have never been opened for her (nothing is offered), or selling was stopped while
 * she has members (she still sees and looks after them; only what starts something new is gone).
 */
export async function MembershipPart(props: { hostId: string; regularPricePer15Cents: number | null; payoutsReady: boolean; now: Date }) {
  const { hostId, now } = props;
  const [open, offer, members] = await Promise.all([membershipsOnFor(hostId), offerOfHost(db, hostId), membersOfHost(hostId)]);
  const heading = (
    <h2 className="text-lg font-semibold" id="membership-heading">
      Membership
    </h2>
  );
  if (!open && !offer && members.length === 0) {
    return (
      <section id="membership" className="mt-10 scroll-mt-4">
        {heading}
        <p className="mt-2 text-sm opacity-70">Memberships are not open yet.</p>
      </section>
    );
  }

  const regular = props.regularPricePer15Cents;
  const names = new Map(
    members.length > 0
      ? (await db.select({ id: schema.user.id, name: schema.user.name }).from(schema.user).where(inArray(schema.user.id, members.map(({ membership }) => membership.customerId)))).map((row) => [row.id, row.name])
      : [],
  );
  const [hours, promised] = await Promise.all([hostMinutes(db, hostId), promisedMinutes(db, hostId, now)]);
  const roomFor = offer && offer.includedMinutes > 0 ? Math.max(0, Math.floor((hours - promised) / offer.includedMinutes)) : 0;
  const invitations = members.filter(({ membership }) => membership.status === "invited" && membership.inviteExpiresAt && membership.inviteExpiresAt > now);
  const listed = members.filter(({ membership }) => membership.status !== "invited");
  const cannotOffer = regular === null ? "Set up your host page first." : regular === 0 ? "A host whose calls are free cannot offer a membership." : !props.payoutsReady ? "Your payout account must be ready before you can offer a membership." : null;

  return (
    <section id="membership" className="mt-10 scroll-mt-4">
      {heading}
      <p className="mt-1 text-sm opacity-70">
        A member pays you a fixed amount each month, and that money is their talk time with you at your member price. You invite the people you want as members.
      </p>

      {!open && <p className="mt-3 rounded border border-neutral-400 p-3 text-sm">Memberships are not open at the moment. Months that have started go on, and you can still look after your members below. Nothing new can start: no invitations, and nobody can join, resume or renew.</p>}

      {offer?.on ? (
        <p className="mt-3 text-sm">
          <strong>Your membership is on.</strong> Members pay {formatMoney(monthTotalCents(offer.pricePer15Cents, offer.includedMinutes))} a month for {timeWords(offer.includedMinutes)} ({formatMoney(offer.pricePer15Cents)} per 15 minutes).
          {regular ? ` Your regular price for ${timeWords(offer.includedMinutes)} is ${formatMoney(monthTotalCents(regular, offer.includedMinutes))}.` : ""}
        </p>
      ) : (
        <p className="mt-3 text-sm">{offer ? "Your membership is switched off. Nobody can be invited, join or resume." : "You do not offer a membership yet."}</p>
      )}

      {(offer?.on || members.length > 0) && (
        <p className="mt-2 text-sm">
          Your weekly hours offer {timeWords(hours)} a month. Your members and invitations use {timeWords(promised)}.
          {offer?.on ? ` Room for ${roomFor} more ${roomFor === 1 ? "member" : "members"}.` : ""}
        </p>
      )}

      {cannotOffer && !offer?.on ? (
        <p className="mt-3 text-sm opacity-70">{cannotOffer}</p>
      ) : (
        (open || offer) && (
          <form method="get" action="/host/membership" className="mt-4 flex flex-wrap items-end gap-3 text-sm">
            <label className="flex min-h-11 items-center gap-2">
              <input type="checkbox" name="on" value="1" defaultChecked={offer?.on ?? true} />
              Offer a membership
            </label>
            <label>
              Member price per 15 minutes, in US dollars{regular ? ` (your regular price is ${formatMoney(regular)}; it cannot be more)` : ""}
              <input name="price" type="number" min={MEMBERSHIP.minPricePer15Cents / 100} max={regular ? regular / 100 : undefined} step="0.01" required defaultValue={((offer?.pricePer15Cents ?? regular ?? MEMBERSHIP.minPricePer15Cents) / 100).toFixed(2)} className={`${field} block w-32`} />
            </label>
            <label>
              Time included each month
              <select name="minutes" defaultValue={offer?.includedMinutes ?? 120} className={`${field} block`}>
                {TIMES.map((minutes) => (
                  <option key={minutes} value={minutes}>
                    {timeWords(minutes)}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className={smallButton}>
              See what this changes
            </button>
            <p className="basis-full opacity-70">Nothing is saved yet: the next page shows what the change does, with numbers, and asks you to confirm.</p>
          </form>
        )
      )}

      {invitations.length > 0 && (
        <p className="mt-4 text-sm">
          {invitations.length} open {invitations.length === 1 ? "invitation" : "invitations"}.{" "}
          <Link href="/contacts" className="underline underline-offset-2">
            See them, or take one back
          </Link>
        </p>
      )}
      {offer?.on && open && (
        <p className="mt-2 text-sm">
          <Link href="/contacts" className="inline-flex min-h-11 items-center underline underline-offset-2">
            Invite someone you have had a call with
          </Link>
        </p>
      )}

      {/* The member list is for a host who has, or has had, a membership: with memberships on for every host, someone who has not set one up yet is not shown an empty list. */}
      {(offer || listed.length > 0) && (
        <>
          <h3 className="mt-6 font-semibold">Your members</h3>
          {listed.length === 0 ? (
            <p className="mt-2 text-sm opacity-70">No members yet.</p>
          ) : (
            <ul className="mt-2 space-y-3">
              {listed.map(({ membership, month }) => (
                <Member key={membership.id} membership={membership} month={month} name={names.get(membership.customerId) ?? "A member"} open={open} now={now} />
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

/** One member in the list: where they stand, and the buttons the rulebook gives the host for them. */
function Member(props: { membership: Membership; month: MembershipMonth | null; name: string; open: boolean; now: Date }) {
  const { membership, month, name, open, now } = props;
  const paused = membership.status === "paused";
  const started = month && (month.status === "running" || month.status === "held") && month.endsAt && month.endsAt > now ? month : null;
  const freeCents = started ? (started.status === "held" ? started.totalCents : started.freeCents) : 0;
  // A month still to be paid (a payment that failed, or a renewal being taken right now) is no month that has started:
  // pausing cancels that payment and pauses at once. Judged by the month, as the library does.
  const openPayment = month?.status === "to_pay";
  const saidNo = Boolean(membership.hostStoppedAt) && membership.pausedReason === "offer";
  const stops = Boolean(membership.memberStoppedAt || membership.hostStoppedAt || membership.offerStoppedAt);

  return (
    <li className="rounded border border-neutral-400 p-3 text-sm">
      <p className="font-medium">
        {name}
        {paused && <span className="ml-2 rounded border border-neutral-400 px-1.5 py-0.5 text-xs font-normal">Paused</span>}
      </p>
      <p className="mt-1 opacity-80">
        {membership.since ? (
          <>
            Member since <LocalTime iso={membership.since.toISOString()} />.{" "}
          </>
        ) : null}
        {membership.ownMinutes && membership.ownPricePer15Cents ? `${timeWords(membership.ownMinutes)} a month at ${formatMoney(membership.ownPricePer15Cents)} per 15 minutes.` : ""}
      </p>

      {paused && <p className="mt-1">Paused: they pay nothing and have no member time. They can resume by themselves when there is room. If you do not want them to come back, end the membership.</p>}
      {membership.status === "joining" && <p className="mt-1">Is at the card step right now.</p>}
      {membership.status === "unpaid" && <p className="mt-1">Their monthly payment did not go through. They have no member time until it does; it is tried again, and given up after 7 days. Pausing them cancels that payment and pauses them at once.</p>}
      {membership.status === "active" && openPayment && <p className="mt-1">Their payment for the next month is being taken right now. Pausing them now cancels that payment and pauses them at once.</p>}
      {started && (
        <p className="mt-1">
          {timeWords(minutesCovered(freeCents, started.pricePer15Cents))} left this month. The month ends on <LocalTime iso={started.endsAt!.toISOString()} />
          {/* Said as it is: a renewal that a stop, the founder's switch or an unanswered offer stands in the way of is never promised. */}
          {stops
            ? ", and does not renew."
            : !open
              ? ". It does not renew while memberships are not open."
              : membership.offerId
                ? ". It renews then only if they accept the smaller time you offered; otherwise it is paused."
                : ", and renews then."}
        </p>
      )}
      {started && membership.memberStoppedAt && <p className="mt-1">They cancelled: their membership is paused when this month ends.</p>}
      {started && membership.offerStoppedAt && <p className="mt-1">You switched your membership off during this month, so it does not renew unless they choose to keep it once it is on again.</p>}
      {started && saidNo && <p className="mt-1">They said &quot;No thanks&quot; to the smaller time you offered. That stands: their membership is paused when this month ends, and they can resume later.</p>}
      {started && membership.hostStoppedAt && !saidNo && (
        <form action={undoPauseAction} className="mt-2 flex flex-wrap items-center gap-2">
          <input type="hidden" name="membershipId" value={membership.id} />
          <span>You chose &quot;Pause after this month&quot;.</span>
          <button type="submit" className={smallButton}>
            Undo
          </button>
          {membership.memberStoppedAt || membership.offerStoppedAt ? <span className="opacity-70">(Undoing your pause does not bring the renewal back while the other stop is there.)</span> : null}
        </form>
      )}
      {membership.offerId && membership.offeredMinutes && (
        <div className="mt-2">
          <p>You offered them {timeWords(membership.offeredMinutes)} a month instead. They have not answered yet.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <form action={takeBackOfferAction}>
              <input type="hidden" name="membershipId" value={membership.id} />
              <input type="hidden" name="offerId" value={membership.offerId} />
              <input type="hidden" name="keep" value="1" />
              <button type="submit" className={smallButton}>
                Take the offer back and keep them at their time
              </button>
            </form>
            <form action={takeBackOfferAction}>
              <input type="hidden" name="membershipId" value={membership.id} />
              <input type="hidden" name="offerId" value={membership.offerId} />
              <button type="submit" className={smallButton}>
                Take it back and pause them after this month
              </button>
            </form>
          </div>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-neutral-400/40 pt-3">
        {!paused && membership.status !== "joining" && !membership.hostStoppedAt && (
          <form action={pauseMemberAction}>
            <input type="hidden" name="membershipId" value={membership.id} />
            <button type="submit" className={smallButton}>
              {openPayment ? "Pause now" : "Pause after this month"}
            </button>
          </form>
        )}
        <form action={endMemberAction} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="membershipId" value={membership.id} />
          <label className="flex min-h-11 items-center gap-2">
            <input type="checkbox" name="sure" value="1" required />
            End it for good
          </label>
          <button type="submit" className="rounded border border-red-600 px-3 py-1.5 text-sm text-red-600">
            End membership
          </button>
        </form>
      </div>
      <p className="mt-2 text-xs opacity-70">
        &quot;Pause after this month&quot; stops the renewal: they keep the month they paid for and can resume when there is room. &quot;End membership&quot; ends it at once: their upcoming member calls are cancelled, the time they have not used is paid back to their card, and they can only come back with a new invitation.
      </p>
    </li>
  );
}
