import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import Link from "next/link";
import { SitePage } from "@/components/site-page";
import { db, schema } from "@/db";
import { offerOfHost, previewOfferChange } from "@/lib/membership/offers";
import { monthTotalCents, timeWords } from "@/lib/membership/rules";
import { readNotice } from "@/lib/notice";
import { formatMoney } from "@/lib/payments/access";
import { DEFAULT_FEE_TERMS } from "@/lib/payments/pricing";
import { requireUser } from "@/lib/session";
import { saveMembershipAction } from "../membership-actions";

export const metadata: Metadata = { title: "Your membership: what this change does" };

export const dynamic = "force-dynamic";

const people = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The page a host sees before a change to her membership is saved (the rulebook's "Changing the
 * membership" and "Switching the offer off"): what it does, with numbers, worked out on the server
 * by the same function that saving uses, and a "Save this change" button. The button carries the
 * proposed values and a short mark of what was shown here; if anything changed meanwhile, saving
 * shows this page again. Nothing is kept anywhere between the two pages, and nothing is saved by
 * opening this one.
 */
export default async function MembershipChangePage(props: PageProps<"/host/membership">) {
  const user = await requireUser("/host");
  const query = await props.searchParams;
  const notice = readNotice("/host/membership", query);
  const input = { on: query.on === "1", pricePer15Cents: Math.round(Number(query.price) * 100), includedMinutes: Number(query.minutes) };
  const back = (
    <p className="text-sm">
      <Link href="/host#membership" className="inline-flex min-h-11 items-center underline underline-offset-2">
        ← Hosting, Membership
      </Link>
    </p>
  );
  const wellFormed = Number.isInteger(input.pricePer15Cents) && Number.isInteger(input.includedMinutes);
  const [change, current, [profile], members] = await Promise.all([
    wellFormed ? previewOfferChange(user.id, input) : null,
    offerOfHost(db, user.id),
    db.select({ pricePer15Cents: schema.hostProfiles.pricePer15Cents }).from(schema.hostProfiles).where(eq(schema.hostProfiles.userId, user.id)),
    db.select({ id: schema.memberships.id, status: schema.memberships.status }).from(schema.memberships).where(eq(schema.memberships.hostId, user.id)),
  ]);

  if (!change || change.problem) {
    return (
      <SitePage className="mx-auto w-full max-w-2xl px-4 py-10">
        {back}
        <h1 className="mt-4 text-2xl font-semibold">This cannot be saved</h1>
        <p role="alert" className="mt-4 rounded border border-red-600 p-3 text-sm">
          {change?.problem ?? "Enter a member price and choose a time."}
        </p>
        <p className="mt-4 text-sm">Nothing was changed.</p>
      </SitePage>
    );
  }

  // Switching off keeps the price and the time; only the switch moves.
  const price = input.on || !current ? input.pricePer15Cents : current.pricePer15Cents;
  const minutes = input.on || !current ? input.includedMinutes : current.includedMinutes;
  const monthly = monthTotalCents(price, minutes);
  const nothingChanges = !change.termsChanged && !change.switchingOn && !change.switchingOff && change.lowered.length === 0;
  const paying = members.filter((member) => member.status === "active" || member.status === "unpaid").length;
  const sameFrom = new Set(change.lowered.map((member) => member.fromPricePer15Cents)).size === 1;
  // What reaches the host of what members pay less: the percentage part of our fee goes down with it. An estimate, said as one.
  const lessForHost = Math.round(change.lessPerMonthCents * (1 - DEFAULT_FEE_TERMS.percentBps / 10_000));

  return (
    <SitePage className="mx-auto w-full max-w-2xl px-4 py-10">
      {back}
      <h1 className="mt-4 text-2xl font-semibold">{change.switchingOff ? "Switch your membership off?" : current ? "Change your membership?" : "Offer this membership?"}</h1>

      {notice && (
        <p role="alert" className="mt-4 rounded border border-red-600 p-3 text-sm">
          {notice}
        </p>
      )}

      {nothingChanges ? (
        <p className="mt-4 text-sm">This is your membership as it is now. There is nothing to save.</p>
      ) : (
        <>
          <ul className="mt-4 list-disc space-y-2 pl-5 text-sm">
            {change.switchingOff ? (
              <>
                <li>
                  <strong>Nobody can be invited, join or resume</strong> while your membership is off.
                </li>
                {change.invitationsTakenBack.length > 0 && <li>{people(change.invitationsTakenBack.length, "open invitation is", "open invitations are")} taken back, and the people are told.</li>}
                {change.renewalsStopping.length > 0 && (
                  <li>
                    {people(change.renewalsStopping.length, "member keeps", "members keep")} the month they paid for (also one whose money is still only held) and can use it to its end. Their renewal is stopped: they are
                    paused when the month ends, and they are told by email.
                  </li>
                )}
                {change.pausedAtOnce.length > 0 && <li>{people(change.pausedAtOnce.length, "member whose payment was", "members whose payments were")} still open: that payment is cancelled and they are paused at once.</li>}
                <li>Switching it on again later charges nobody by itself: a member whose month is still running can choose to keep their membership, and a paused member can resume.</li>
              </>
            ) : (
              <>
                <li>
                  <strong>
                    Members pay {formatMoney(monthly)} a month for {timeWords(minutes)}
                  </strong>{" "}
                  ({formatMoney(price)} per 15 minutes).{profile?.pricePer15Cents ? ` Your regular price for ${timeWords(minutes)} is ${formatMoney(monthTotalCents(profile.pricePer15Cents, minutes))}.` : ""}
                </li>
                {change.termsChanged && current && <li>New invitations get this price and time.</li>}
                {change.invitationsTakenBack.length > 0 && (
                  <li>{people(change.invitationsTakenBack.length, "open invitation is", "open invitations are")} taken back, because they were for the membership as it was. You can invite those people again.</li>
                )}
                {change.lowered.length > 0 && (
                  <li>
                    {people(change.lowered.length, "member pays", "members pay")} {sameFrom ? `${formatMoney(change.lowered[0].fromPricePer15Cents)} per 15 minutes` : "more than this per 15 minutes"} now. From their next month they will pay{" "}
                    {formatMoney(price)}, like new members, for good. Together they will pay {formatMoney(change.lessPerMonthCents)} less a month. After our fee that is about {formatMoney(lessForHost)} less for you. They are told by email.
                  </li>
                )}
                {paying > change.lowered.length && <li>{paying - change.lowered.length === paying ? "Nothing changes for the people who are already members" : "Nothing changes for your other members"}: they keep their time, and their price only ever goes down.</li>}
                <li>A month that is already running, held or being paid for never changes.</li>
              </>
            )}
          </ul>

          <form action={saveMembershipAction} className="mt-6 flex flex-wrap items-center gap-3 text-sm">
            {input.on && <input type="hidden" name="on" value="1" />}
            <input type="hidden" name="priceCents" value={input.pricePer15Cents} />
            <input type="hidden" name="minutes" value={input.includedMinutes} />
            {/* What this page showed. If anything changed since, nothing is saved and this page is shown again. */}
            <input type="hidden" name="mark" value={change.mark} />
            <button type="submit" className="rounded bg-blue-600 px-4 py-2 font-medium text-white">
              Save this change
            </button>
            <Link href="/host#membership" className="inline-flex min-h-11 items-center underline underline-offset-2">
              Do not change anything
            </Link>
          </form>
        </>
      )}
    </SitePage>
  );
}
