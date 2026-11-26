import type { Metadata } from "next";
import { desc, inArray } from "drizzle-orm";
import Link from "next/link";
import { LocalTime } from "@/components/local-time";
import { SitePage } from "@/components/site-page";
import { db, schema } from "@/db";
import type { Membership, MembershipMonth, MembershipRefund } from "@/db/schema";
import { fourteenDayCases, openFourteenDayRequests } from "@/lib/membership/fourteen-days";
import { timeWords } from "@/lib/membership/rules";
import { formatMoney } from "@/lib/payments/access";
import { switches } from "@/lib/safety/switches";
import { readNotice } from "@/lib/notice";
import { requireAdmin } from "@/lib/session";
import { cancelWithin14DaysAction } from "./actions";

export const metadata: Metadata = { title: "Memberships" };

export const dynamic = "force-dynamic";

const MEMBERSHIP_STATE: Record<string, string> = {
  invited: "Invited",
  joining: "At the card step",
  active: "Active",
  unpaid: "Payment failed, being tried again",
  paused: "Paused",
  ended: "Ended",
};
const MONTH_STATE: Record<string, string> = {
  to_pay: "To be paid",
  held: "Held on the card, not yet taken",
  running: "Running",
  closed: "Over, not yet finished",
  finished: "Finished",
  given_up: "Given up, nothing charged",
};
const ENDED_HOW: Record<string, string> = {
  cancel_now: "the member chose \"Cancel now\"",
  given_up: "not paid in 7 days, or cancelled while its payment was open",
  ending: "the membership ended",
  card_step: "the card step ran out",
  no_room: "no room in the host's hours",
  hold_lost: "the bank let the hold go",
  cancelled_at_stripe: "cancelled at Stripe",
};

/**
 * The founder's page for memberships: every membership with where it stands, and for each of its
 * months the six places its money is in, what failed, what is owed back and what a bank disputes.
 * (The switch that opens memberships is on "Reports and safety".) It changes one thing: a new
 * membership can be cancelled here within 14 days of joining, for a member who asked in writing
 * instead of pressing their own button.
 */
export default async function AdminMembershipsPage(props: PageProps<"/admin/memberships">) {
  await requireAdmin();
  const notice = readNotice("/admin/memberships", await props.searchParams);
  const now = new Date();
  // Every membership, with no cut-off: the counts and the lists of what needs a look must never leave an old one out.
  const [current, memberships] = await Promise.all([switches(), db.select().from(schema.memberships).orderBy(desc(schema.memberships.updatedAt))]);
  const ids = memberships.map((membership) => membership.id);
  const months = ids.length > 0 ? await db.select().from(schema.membershipMonths).where(inArray(schema.membershipMonths.membershipId, ids)).orderBy(desc(schema.membershipMonths.number)) : [];
  const monthIds = months.map((month) => month.id);
  const payBacks = monthIds.length > 0 ? await db.select().from(schema.membershipRefunds).where(inArray(schema.membershipRefunds.monthId, monthIds)) : [];
  const personIds = [...new Set(memberships.flatMap((membership) => [membership.hostId, membership.customerId]))];
  const people = new Map(personIds.length > 0 ? (await db.select({ id: schema.user.id, name: schema.user.name }).from(schema.user).where(inArray(schema.user.id, personIds))).map((row) => [row.id, row.name]) : []);

  const monthsOf = (membershipId: string) => months.filter((month) => month.membershipId === membershipId);
  const owedOf = (monthId: string) => payBacks.filter((line) => line.monthId === monthId);
  const notFinished = months.filter((month) => ["to_pay", "held", "running", "closed"].includes(month.status));
  const failed = memberships.filter((membership) => membership.status === "unpaid");
  const owed = payBacks.filter((line) => line.status !== "done");
  // A dispute that is open or lost freezes the month. One that was won is over: it stays in the month's own row below, not in this count.
  const disputed = months.filter((month) => month.dispute === "open" || month.dispute === "lost");
  const membershipById = new Map(memberships.map((membership) => [membership.id, membership]));
  const who = (membership: Membership | undefined) => (membership ? `${people.get(membership.customerId) ?? "?"} with ${people.get(membership.hostId) ?? "?"}` : "?");
  // The new memberships whose first month is running: the 14-day form is for these, and for no other.
  const fourteen = await fourteenDayCases(memberships, now);
  // Requests to cancel within 14 days that were made in time and are not finished. Normally none: the helper finishes them.
  const openRequests = await openFourteenDayRequests(memberships, now);
  const today = now.toISOString().slice(0, 10);

  return (
    <SitePage className="mx-auto w-full max-w-4xl px-4 py-10">
      <p className="text-sm">
        <Link href="/admin" className="inline-flex min-h-11 items-center underline underline-offset-2">
          ← Admin
        </Link>
      </p>
      <h1 className="mt-4 text-2xl font-semibold">Memberships</h1>
      {notice && (
        <p className="mt-3 rounded border border-neutral-400 p-3 text-sm" role="status" data-notice>
          {notice}
        </p>
      )}
      <p className="mt-2 text-sm">
        The switch is{" "}
        <strong>{current.memberships === "off" ? "off" : current.memberships === "named" ? `on for ${current.membershipsHosts.length} named ${current.membershipsHosts.length === 1 ? "host" : "hosts"}` : "on for everyone"}</strong>.{" "}
        <Link href="/admin/reports" className="underline underline-offset-2">
          Change it on &quot;Reports and safety&quot;
        </Link>
        . This page shows. The one thing it changes: a new membership can be cancelled within 14 days here, when the member asked in writing (the form is on that membership, below).
      </p>

      <section className="mt-6 grid gap-3 text-sm sm:grid-cols-4">
        <Tile label="Months not finished" value={notFinished.length} />
        <Tile label="Payments that failed" value={failed.length} />
        <Tile label="Pay-backs not done" value={owed.length} />
        <Tile label="Months under dispute" value={disputed.length} />
      </section>

      {openRequests.length > 0 && (
        <section className="mt-8 text-sm" data-fourteen-open>
          <h2 className="text-lg font-semibold">Cancelled within 14 days, not finished</h2>
          <p className="mt-1 opacity-70">
            Each of these was asked in time and is on record, so the 14 days cannot run out on it. The helper finishes it by itself as soon as it can; what a rule stops needs you.
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {openRequests.map((request) => (
              <li key={request.membershipId}>
                {who(membershipById.get(request.membershipId))}:{" "}
                {request.by.as === "founder" ? `a request in writing that reached Connect on ${request.by.requestDay}, entered on ${request.askedDay}` : `the member pressed their own button on ${request.askedDay}`} (days in UTC).{" "}
                {request.stoppedBy ? (
                  <>
                    <strong>It needs you.</strong> {request.stoppedBy}
                  </>
                ) : (
                  "The helper is finishing it. If it is still here in a few minutes, use the form on that membership below: the day is already filled in."
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {failed.length > 0 && (
        <section className="mt-8 text-sm">
          <h2 className="text-lg font-semibold">Payments that failed</h2>
          <ul className="mt-2 space-y-1">
            {failed.map((membership) => {
              const month = monthsOf(membership.id).find((m) => m.id === membership.currentMonthId);
              return (
                <li key={membership.id}>
                  {who(membership)}: {month ? formatMoney(month.totalCents) : ""}
                  {month?.nextTryAt ? (
                    <>
                      , next try <LocalTime iso={month.nextTryAt.toISOString()} />
                    </>
                  ) : null}
                  {month?.giveUpAt ? (
                    <>
                      , given up on <LocalTime iso={month.giveUpAt.toISOString()} />
                    </>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {owed.length > 0 && (
        <section className="mt-8 text-sm">
          <h2 className="text-lg font-semibold">Pay-backs not done</h2>
          <ul className="mt-2 space-y-1">
            {owed.map((line) => (
              <PayBack key={line.id} line={line} label={who(membershipById.get(months.find((month) => month.id === line.monthId)?.membershipId ?? ""))} />
            ))}
          </ul>
        </section>
      )}

      {disputed.length > 0 && (
        <section className="mt-8 text-sm">
          <h2 className="text-lg font-semibold">Months under dispute</h2>
          <ul className="mt-2 space-y-1">
            {disputed.map((month) => (
              <li key={month.id}>
                {who(membershipById.get(month.membershipId))}, month {month.number}: the dispute is <strong>{month.dispute}</strong>
. The month is frozen: nothing of it is booked, used, given back, paid back or collected.
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-8 text-sm">
        <h2 className="text-lg font-semibold">Every membership</h2>
        <p className="mt-1 opacity-70">
          All {memberships.length}, the most recently changed first. For each month, the six places its money is in always add up to what was paid.
        </p>
        {memberships.length === 0 ? (
          <p className="mt-3 opacity-70">There are no memberships.</p>
        ) : (
          <ul className="mt-3 space-y-4">
            {memberships.map((membership) => (
              <li key={membership.id} className="rounded border border-neutral-400 p-3">
                <p className="font-medium">
                  {who(membership)} <span className="ml-2 rounded border border-neutral-400 px-1.5 py-0.5 text-xs font-normal">{MEMBERSHIP_STATE[membership.status] ?? membership.status}</span>
                </p>
                <p className="mt-1 opacity-80">
                  {membership.ownMinutes && membership.ownPricePer15Cents ? `${timeWords(membership.ownMinutes)} a month at ${formatMoney(membership.ownPricePer15Cents)} per 15 minutes. ` : ""}
                  {membership.status === "invited" && membership.inviteExpiresAt ? (membership.inviteExpiresAt > now ? "The invitation is open. " : "The invitation has run out. ") : ""}
                  {membership.memberStoppedAt ? "The member cancelled: no renewal. " : ""}
                  {membership.hostStoppedAt ? (membership.pausedReason === "offer" ? "The member said \"No thanks\" to less time: no renewal. " : "The host paused it after this month. ") : ""}
                  {membership.offerStoppedAt ? "The host switched her membership off: no renewal unless the member keeps it. " : ""}
                  {membership.offerId && membership.offeredMinutes ? `An offer of ${timeWords(membership.offeredMinutes)} a month is open. ` : ""}
                  {membership.status === "paused" && membership.pausedReason ? `Paused: ${membership.pausedReason}. ` : ""}
                  {membership.status === "ended" && membership.endedReason ? `Ended: ${membership.endedReason}. ` : ""}
                  {membership.status === "ended" && !membership.cleanupDoneAt ? "Its clean-up is not finished yet. " : ""}
                </p>
                {fourteen.has(membership.id) && (
                  <details className="mt-2 rounded border border-neutral-400 p-2" data-fourteen-days>
                    <summary className="cursor-pointer">The member wrote to cancel within 14 days of joining</summary>
                    <form action={cancelWithin14DaysAction} className="mt-2 space-y-2">
                      <input type="hidden" name="membership" value={membership.id} />
                      {/* The month this form is about: the first month of a new membership. */}
                      <input type="hidden" name="month" value={fourteen.get(membership.id)!.monthId} />
                      <p className="opacity-80">
                        Members can do this themselves on their membership&apos;s page; this form is for one who wrote to us instead. Joined on {fourteen.get(membership.id)!.joinedDay}; a request counts if it reached Connect by{" "}
                        {fourteen.get(membership.id)!.lastDay} (days in UTC).{fourteen.get(membership.id)!.onRecordDay ? ` A request of ${fourteen.get(membership.id)!.onRecordDay} is on record and not finished: that day is filled in below.` : ""} The membership ends at once. An amount that is still only held is let go. If the month was taken, what was not used goes back to the card, and calls still to
                        come are cancelled (a call under way is worked out as usual). Time that was used, and a call cancelled late or missed that was already charged, stay paid for. This cannot be undone.
                      </p>
                      <p>
                        <label>
                          The day the member&apos;s request reached Connect:{" "}
                          <input type="date" name="day" required min={fourteen.get(membership.id)!.joinedDay} max={today} defaultValue={fourteen.get(membership.id)!.onRecordDay ?? undefined} className="rounded border border-neutral-400 px-2 py-1" />
                        </label>
                      </p>
                      <button type="submit" className="rounded border border-neutral-500 px-3 py-1.5 font-medium">
                        Cancel this membership within the 14 days
                      </button>
                    </form>
                  </details>
                )}
                {monthsOf(membership.id).length > 0 && (
                  <div className="mt-2 overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="border-b border-neutral-400">
                        <tr>
                          {["Month", "State", "Paid", "Free", "Set aside", "Used", "Expired", "To pay back", "Paid back"].map((head) => (
                            <th key={head} className="py-1 pr-3 font-medium">
                              {head}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {monthsOf(membership.id).map((month) => (
                          <MonthRow key={month.id} month={month} owed={owedOf(month.id)} />
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </SitePage>
  );
}

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border border-neutral-400 p-3">
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
      <p className="opacity-70">{label}</p>
    </div>
  );
}

function PayBack({ line, label }: { line: MembershipRefund; label: string }) {
  return (
    <li>
      {label}: {formatMoney(line.amountCents)}, {line.status === "at_stripe" ? "sent to Stripe, not confirmed yet" : line.lastFailedAt ? "refused by Stripe; it is tried again" : "owed, not sent yet"}. {line.reason}
    </li>
  );
}

/** One month: its state and the six places its money is in. A month whose places do not add up to what was paid is marked. */
function MonthRow({ month, owed }: { month: MembershipMonth; owed: MembershipRefund[] }) {
  const places = [month.freeCents, month.setAsideCents, month.usedCents, month.expiredCents, month.toPayBackCents, month.paidBackCents];
  const sum = places.reduce((a, b) => a + b, 0);
  const paid = month.takenCents ?? 0;
  const open = owed.filter((line) => line.status !== "done").length;
  return (
    <tr className="border-b border-neutral-300/40 align-top">
      <td className="py-1 pr-3 whitespace-nowrap">
        {month.number}
        {month.endsAt ? (
          <>
            {" "}
            (to <LocalTime iso={month.endsAt.toISOString()} />)
          </>
        ) : null}
      </td>
      <td className="py-1 pr-3">
        {MONTH_STATE[month.status] ?? month.status}
        {month.endedHow ? `: ${ENDED_HOW[month.endedHow] ?? month.endedHow}` : ""}
        {month.dispute !== "none" ? `. Dispute: ${month.dispute}` : ""}
        {month.problem ? `. ${month.problem}` : ""}
        {open > 0 ? `. ${open} pay-back${open === 1 ? "" : "s"} not done` : ""}
        {paid > 0 && sum !== paid && !month.problem ? ". THE PLACES DO NOT ADD UP" : ""}
      </td>
      <td className="py-1 pr-3 tabular-nums">{paid > 0 ? formatMoney(paid) : `(${formatMoney(month.totalCents)})`}</td>
      {places.map((cents, i) => (
        <td key={i} className="py-1 pr-3 tabular-nums">
          {formatMoney(cents)}
        </td>
      ))}
    </tr>
  );
}
