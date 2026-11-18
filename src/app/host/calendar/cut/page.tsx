import type { Metadata } from "next";
import { and, eq, inArray } from "drizzle-orm";
import Link from "next/link";
import { SitePage } from "@/components/site-page";
import { db, schema } from "@/db";
import { CalendarError, clockText, previewWeeklyHoursChange, type HoursChange } from "@/lib/booking/calendar";
import { hostMinutes } from "@/lib/membership/room";
import { MEMBERSHIP, timeWords } from "@/lib/membership/rules";
import { readNotice } from "@/lib/notice";
import { requireUser } from "@/lib/session";
import { saveCutAction } from "../actions";

export const metadata: Metadata = { title: "Fewer hours: your members" };

export const dynamic = "force-dynamic";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const people = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The step in which a host who cuts her weekly hours decides about her members (the rulebook's
 * "When a host later offers fewer hours"). The change it is about travels in the address; nothing
 * is saved by opening this page. What it shows is worked out on the server by the same function
 * saving uses, and the form carries a short mark of it: if anything about her members changed
 * meanwhile, saving shows this page again as things stand then.
 */
export default async function CutPage(props: PageProps<"/host/calendar/cut">) {
  const user = await requireUser("/host/calendar");
  const query = await props.searchParams;
  const notice = readNotice("/host/calendar/cut", query);
  const text = (key: string) => (typeof query[key] === "string" ? (query[key] as string) : "");
  const change: HoursChange = {
    ...(text("remove") ? { remove: text("remove") } : {}),
    ...(text("from") ? { add: { weekday: Number(text("weekday")), from: text("from"), to: text("to"), membersOnly: text("membersOnly") === "on" } } : {}),
  };
  const back = (
    <p className="text-sm">
      <Link href="/host/calendar" className="inline-flex min-h-11 items-center underline underline-offset-2">
        ← Your calendar (nothing is changed)
      </Link>
    </p>
  );

  const refused = (message: string) => (
    <SitePage className="mx-auto w-full max-w-2xl px-4 py-10">
      {back}
      <h1 className="mt-4 text-2xl font-semibold">Those hours cannot be changed like this</h1>
      <p role="alert" className="mt-4 rounded border border-red-600 p-3 text-sm">
        {message}
      </p>
    </SitePage>
  );

  // This step is only ever about a stretch of the signed-in host's own hours that is removed or changed. Anything else in
  // the address (no stretch, a made-up one, another host's) shows nothing and offers nothing to save.
  const [removed] = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(change.remove ?? "")
    ? await db.select().from(schema.weeklyHours).where(and(eq(schema.weeklyHours.id, change.remove!), eq(schema.weeklyHours.hostId, user.id)))
    : [];
  if (!removed) return refused("Those hours are no longer in your calendar. Nothing was changed. Please look at your calendar again.");

  let cut;
  try {
    cut = await previewWeeklyHoursChange(user.id, change);
  } catch (error) {
    if (!(error instanceof CalendarError)) throw error;
    return refused(error.message);
  }
  // Choices for members belong to a cut. A change that does not make the week shorter is saved on the calendar page, with nothing to choose.
  if (cut.hoursAfter >= (await hostMinutes(db, user.id))) return refused("This change does not make your week shorter, so there is nothing to choose for your members. Nothing was changed. You can make it on your calendar page.");

  // The invitations that would be taken back are named. They are looked up as this host's own, like everything here.
  const invited = cut.invitationsTakenBack.length > 0 ? await db.select({ customerId: schema.memberships.customerId }).from(schema.memberships).where(and(inArray(schema.memberships.id, cut.invitationsTakenBack), eq(schema.memberships.hostId, user.id))) : [];
  const ids = [...cut.members.map((member) => member.customerId), ...invited.map((row) => row.customerId)];
  const names = new Map(ids.length > 0 ? (await db.select({ id: schema.user.id, name: schema.user.name }).from(schema.user).where(inArray(schema.user.id, ids))).map((row) => [row.id, row.name]) : []);
  const invitedNames = invited.map((row) => names.get(row.customerId) ?? "someone").join(", ");
  const fits = cut.needed <= cut.hoursAfter;

  return (
    <SitePage className="mx-auto w-full max-w-2xl px-4 py-10">
      {back}
      <h1 className="mt-4 text-2xl font-semibold">Fewer hours: what happens to your members</h1>

      {notice && (
        <p role="alert" className="mt-4 rounded border border-red-600 p-3 text-sm">
          {notice}
        </p>
      )}

      <p className="mt-4 text-sm">
        The change:{" "}
        {`${DAYS[removed.weekday - 1]}, ${clockText(removed.startMinute)} to ${clockText(removed.endMinute)}`}
        {change.add ? ` becomes ${DAYS[change.add.weekday - 1] ?? "?"}, ${change.add.from} to ${change.add.to === "00:00" ? "24:00" : change.add.to}${change.add.membersOnly ? " (members only)" : ""}.` : " is removed."}
      </p>

      <ul className="mt-4 list-disc space-y-2 pl-5 text-sm">
        <li>
          <strong>
            Your members need {timeWords(cut.needed)} a month from their next payment on. With these hours you offer {timeWords(cut.hoursAfter)}.
          </strong>
        </li>
        <li>
          This month you still owe {timeWords(cut.owedThisMonth)}. Months that have already started go on whatever you choose here, so for a while you may owe more than your new hours hold. Nobody loses anything in the middle of a month they paid
          for.
        </li>
        {cut.invitationsTakenBack.length > 0 && (
          <li>
            {people(cut.invitationsTakenBack.length, "open invitation no longer fits and is", "open invitations no longer fit and are")} taken back{invitedNames ? `: ${invitedNames}` : ""}. They are told. Invitations give way before members.
          </li>
        )}
        {cut.leaving.length > 0 && <li>{people(cut.leaving.length, "member whose renewal is already stopped is", "members whose renewal is already stopped are")} leaving anyway and need no choice.</li>}
      </ul>

      <form action={saveCutAction} className="mt-6 text-sm">
        <input type="hidden" name="remove" value={removed.id} />
        {change.add && (
          <>
            <input type="hidden" name="weekday" value={change.add.weekday} />
            <input type="hidden" name="from" value={change.add.from} />
            <input type="hidden" name="to" value={change.add.to} />
            {change.add.membersOnly && <input type="hidden" name="membersOnly" value="on" />}
          </>
        )}
        {/* What this page showed. If anything about the members changed since, nothing is saved and this page is shown again. */}
        <input type="hidden" name="mark" value={cut.mark} />

        <h2 className="text-lg font-semibold">Choose for each member</h2>
        <p className="mt-1 opacity-70">
          {fits
            ? "Everyone still fits. You can keep them all."
            : "To start with, your newest members are set to \"pause\" until the others fit. Change it as you like. The change is saved only when the members you keep, with the smaller times you offer, fit in the new hours."}
        </p>
        {cut.members.length === 0 ? (
          <p className="mt-3">No member would get a next month, so there is nothing to choose.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {cut.members.map((member) => {
              const smaller = Array.from({ length: Math.max(0, member.minutes / MEMBERSHIP.stepMinutes - 1) }, (_, i) => (i + 1) * MEMBERSHIP.stepMinutes);
              const canOfferLess = member.monthStarted && member.openOfferMinutes === null && smaller.length > 0;
              return (
                <li key={member.membershipId} className="rounded border border-neutral-400 p-3">
                  <p className="font-medium">
                    {names.get(member.customerId) ?? "A member"}: {timeWords(member.minutes)} a month
                  </p>
                  {member.openOfferMinutes !== null && <p className="mt-1 opacity-80">Has an open offer of {timeWords(member.openOfferMinutes)} a month from an earlier cut. &quot;Keep&quot; leaves them with that offer; &quot;pause&quot; takes it back.</p>}
                  {member.unpaid && <p className="mt-1 opacity-80">Their payment is still being tried. Pausing cancels that payment and pauses them at once.</p>}
                  <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2">
                    <label className="flex min-h-11 items-center gap-2">
                      <input type="radio" name={`choice:${member.membershipId}`} value="keep" defaultChecked={member.suggested === "keep"} required /> Keep
                    </label>
                    {canOfferLess && (
                      <label className="flex min-h-11 flex-wrap items-center gap-2">
                        <input type="radio" name={`choice:${member.membershipId}`} value="less" /> Offer less time:
                        <select name={`minutes:${member.membershipId}`} defaultValue={smaller[smaller.length - 1]} aria-label="The smaller time to offer" className="rounded border border-neutral-400 bg-transparent px-2 py-1">
                          {smaller.map((minutes) => (
                            <option key={minutes} value={minutes}>
                              {timeWords(minutes)}
                            </option>
                          ))}
                        </select>
                        a month, at their price
                      </label>
                    )}
                    <label className="flex min-h-11 items-center gap-2">
                      <input type="radio" name={`choice:${member.membershipId}`} value="pause" defaultChecked={member.suggested === "pause"} /> Pause after this month
                    </label>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <ul className="mt-4 list-disc space-y-1 pl-5 opacity-80">
          <li>A member you pause is told by email, keeps the month they paid for, and is paused when it ends. They can resume as soon as there is room.</li>
          <li>
            A member you offer less time gets an email with two buttons, to accept or to say &quot;No thanks&quot;. With &quot;No thanks&quot;, or no answer before their month ends, they are paused when it ends. A &quot;No thanks&quot; cannot be undone by
            you.
          </li>
          <li>You can undo a pause you chose, or take an unanswered offer back, in your member list for as long as that member&apos;s month runs, if there is room.</li>
        </ul>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button type="submit" className="rounded bg-blue-600 px-4 py-2 font-medium text-white">
            Save the new hours and these choices
          </button>
          <Link href="/host/calendar" className="inline-flex min-h-11 items-center underline underline-offset-2">
            Do not change anything
          </Link>
        </div>
      </form>
    </SitePage>
  );
}
