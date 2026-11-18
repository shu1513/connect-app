import type { Metadata } from "next";
import { desc, inArray } from "drizzle-orm";
import Link from "next/link";
import { LocalTime } from "@/components/local-time";
import { SitePage } from "@/components/site-page";
import { db, schema } from "@/db";
import type { Membership, MembershipMonth, MembershipRefund } from "@/db/schema";
import { timeWords } from "@/lib/membership/rules";
import { formatMoney } from "@/lib/payments/access";
import { switches } from "@/lib/safety/switches";
import { requireAdmin } from "@/lib/session";

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
  given_up: "no payment in 7 days",
  ending: "the membership ended",
  card_step: "the card step ran out",
  no_room: "no room in the host's hours",
  hold_lost: "the bank let the hold go",
  cancelled_at_stripe: "cancelled at Stripe",
};

/**
 * The founder's page for memberships. It only reads: every membership with where it stands, and
 * for each of its months the six places its money is in, what failed, what is owed back and what
 * a bank disputes. (The switch that opens memberships is on "Reports and safety".)
 */
export default async function AdminMembershipsPage() {
  await requireAdmin();
  const now = new Date();
  const [current, memberships] = await Promise.all([switches(), db.select().from(schema.memberships).orderBy(desc(schema.memberships.updatedAt)).limit(300)]);
  const ids = memberships.map((membership) => membership.id);
  const months = ids.length > 0 ? await db.select().from(schema.membershipMonths).where(inArray(schema.membershipMonths.membershipId, ids)).orderBy(desc(schema.membershipMonths.number)) : [];
  const monthIds = months.map((month) => month.id);
  const payBacks = monthIds.length > 0 ? await db.select().from(schema.membershipRefunds).where(inArray(schema.membershipRefunds.monthId, monthIds)) : [];
  const personIds = [...new Set(memberships.flatMap((membership) => [membership.hostId, membership.customerId]))];
  const people = new Map(personIds.length > 0 ? (await db.select({ id: schema.user.id, name: schema.user.name }).from(schema.user).where(inArray(schema.user.id, personIds))).map((row) => [row.id, row.name]) : []);
  const total = await db.$count(schema.memberships);

  const monthsOf = (membershipId: string) => months.filter((month) => month.membershipId === membershipId);
  const owedOf = (monthId: string) => payBacks.filter((line) => line.monthId === monthId);
  const notFinished = months.filter((month) => ["to_pay", "held", "running", "closed"].includes(month.status));
  const failed = memberships.filter((membership) => membership.status === "unpaid");
  const owed = payBacks.filter((line) => line.status !== "done");
  const disputed = months.filter((month) => month.dispute !== "none");
  const membershipById = new Map(memberships.map((membership) => [membership.id, membership]));
  const who = (membership: Membership | undefined) => (membership ? `${people.get(membership.customerId) ?? "?"} with ${people.get(membership.hostId) ?? "?"}` : "?");

  return (
    <SitePage className="mx-auto w-full max-w-4xl px-4 py-10">
      <p className="text-sm">
        <Link href="/admin" className="inline-flex min-h-11 items-center underline underline-offset-2">
          ← Admin
        </Link>
      </p>
      <h1 className="mt-4 text-2xl font-semibold">Memberships</h1>
      <p className="mt-2 text-sm">
        The switch is{" "}
        <strong>{current.memberships === "off" ? "off" : current.memberships === "named" ? `on for ${current.membershipsHosts.length} named ${current.membershipsHosts.length === 1 ? "host" : "hosts"}` : "on for everyone"}</strong>.{" "}
        <Link href="/admin/reports" className="underline underline-offset-2">
          Change it on &quot;Reports and safety&quot;
        </Link>
        . This page only shows; it changes nothing.
      </p>

      <section className="mt-6 grid gap-3 text-sm sm:grid-cols-4">
        <Tile label="Months not finished" value={notFinished.length} />
        <Tile label="Payments that failed" value={failed.length} />
        <Tile label="Pay-backs not done" value={owed.length} />
        <Tile label="Months under dispute" value={disputed.length} />
      </section>

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
                {month.dispute === "open" || month.dispute === "lost" ? ". The month is frozen: nothing of it is booked, used, given back, paid back or collected." : ". Not frozen."}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-8 text-sm">
        <h2 className="text-lg font-semibold">Every membership</h2>
        <p className="mt-1 opacity-70">
          The {memberships.length} changed most recently{total > memberships.length ? ` of ${total}` : ""}. For each month, the six places its money is in always add up to what was paid.
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
