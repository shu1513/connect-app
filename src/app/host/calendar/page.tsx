import type { Metadata } from "next";
import Link from "next/link";
import { TimeZoneSelect } from "@/components/time-zone-select";
import { calendarOf, clockText, hoursAndTimeOff, inZone, mayKeepMemberHours } from "@/lib/booking/calendar";
import { AFTER_CALL_MINUTES, BREAK_CHOICES_MINUTES, DEFAULT_LENGTHS, HORIZON_CHOICES_WEEKS, LENGTH_CHOICES_MINUTES, lengthWords, NOTICE_CHOICES_HOURS, readLengths } from "@/lib/booking/rules";
import { ownBookingsTakingTime } from "@/lib/booking/bookings";
import { readNotice } from "@/lib/notice";
import { requireUser } from "@/lib/session";
import { timeZones } from "@/lib/time-zones";
import { addHours, addOff, editHours, removeHours, removeOff, saveChoices } from "./actions";
import { SitePage } from "@/components/site-page";

export const metadata: Metadata = { title: "Your calendar" };

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export default async function HostCalendarPage(props: PageProps<"/host/calendar">) {
  const user = await requireUser("/host/calendar");
  const notice = readNotice("/host/calendar", await props.searchParams);
  const calendar = await calendarOf(user.id, user.timeZone);
  const { hours, off } = await hoursAndTimeOff(user.id, new Date());
  // Calls and requests she has as a customer close her own page too: shown, so a missing time explains itself (plans/42).
  const ownBookings = await ownBookingsTakingTime(user.id, new Date());
  // The "Members only" tick is offered to a host who may offer a membership, or who already has such hours (one rule, also the action's).
  const forMembers = await mayKeepMemberHours(user.id);
  // A host sets a shortest and a longest call. A list saved before that (ticked lengths) shows as its two ends.
  const saved = readLengths(calendar.lengths);
  const lengths = saved.length > 0 ? saved : DEFAULT_LENGTHS;
  const shortest = lengths[0];
  const longest = lengths[lengths.length - 1];
  const field = "mt-1 rounded border border-neutral-400 bg-transparent px-3 py-2";
  const button = "rounded border border-neutral-500 px-3 py-1.5 text-sm";

  return (
    <SitePage className="mx-auto w-full max-w-2xl px-4 py-10">
      <p className="text-sm">
        <Link href="/host" className="inline-flex min-h-11 items-center underline underline-offset-2">
          ← Hosting
        </Link>
      </p>
      <h1 className="mt-4 text-2xl font-semibold">Your calendar</h1>
      <p className="mt-2 text-sm opacity-70">
        People can ask you for a call in the hours you set here. Several people may ask for the same time, and you choose
        who you take.
      </p>

      {notice && (
        <p role="status" className="mt-4 rounded border border-neutral-400 p-3 text-sm">
          {notice}
        </p>
      )}

      <section className="mt-8">
        <h2 className="text-lg font-semibold">Your weekly hours</h2>
        <p className="mt-1 text-sm opacity-70">
          Times are in your calendar&apos;s time zone ({calendar.timeZone.replace(/_/g, " ")}). They stay the same for you when the
          clocks change.
        </p>
        {hours.length === 0 ? (
          <p className="mt-3 text-sm">You have no hours yet, so nobody can book you.</p>
        ) : (
          <ul className="mt-3 space-y-1 text-sm">
            {hours.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center gap-3">
                <span className="w-56">
                  {DAYS[h.weekday - 1]}, {clockText(h.startMinute)} to {clockText(h.endMinute)}
                  {h.membersOnly && <span className="ml-2 rounded border border-neutral-400 px-1.5 py-0.5 text-xs">Members only</span>}
                </span>
                <form action={removeHours}>
                  <input type="hidden" name="id" value={h.id} />
                  <button type="submit" className="underline underline-offset-2">
                    Remove
                  </button>
                </form>
                {/* Changing or moving a stretch is one change, never a removal first and an addition later: so a cut in hours is seen as what it is. */}
                <details className="basis-full">
                  <summary className="cursor-pointer underline underline-offset-2">Change these hours</summary>
                  <form action={editHours} className="mt-2 flex flex-wrap items-end gap-2">
                    <input type="hidden" name="remove" value={h.id} />
                    <label>
                      Day
                      <select name="weekday" defaultValue={h.weekday} className={`${field} block`}>
                        {DAYS.map((day, i) => (
                          <option key={day} value={i + 1}>
                            {day}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      From
                      <input name="from" type="time" required defaultValue={clockText(h.startMinute)} className={`${field} block`} />
                    </label>
                    <label>
                      To
                      <input name="to" type="time" required defaultValue={h.endMinute === 1440 ? "00:00" : clockText(h.endMinute)} className={`${field} block`} />
                    </label>
                    {forMembers && (
                      <label className="flex min-h-11 items-center gap-2">
                        <input name="membersOnly" type="checkbox" defaultChecked={h.membersOnly} />
                        Members only
                      </label>
                    )}
                    <button type="submit" className={button}>
                      Save
                    </button>
                  </form>
                </details>
              </li>
            ))}
          </ul>
        )}
        <form action={addHours} className="mt-4 flex flex-wrap items-end gap-2 text-sm">
          <label>
            Day
            <select name="weekday" className={`${field} block`}>
              {DAYS.map((day, i) => (
                <option key={day} value={i + 1}>
                  {day}
                </option>
              ))}
            </select>
          </label>
          <label>
            From
            <input name="from" type="time" required className={`${field} block`} />
          </label>
          <label>
            To
            <input name="to" type="time" required className={`${field} block`} />
          </label>
          {forMembers && (
            <label className="flex min-h-11 items-center gap-2">
              <input name="membersOnly" type="checkbox" />
              Members only
            </label>
          )}
          <button type="submit" className={button}>
            Add hours
          </button>
        </form>
        <p className="mt-1 text-sm opacity-70">To end at midnight, enter 00:00 as the &quot;to&quot; time.</p>
        {forMembers && (
          <p className="mt-1 text-sm opacity-70">
            Hours marked &quot;Members only&quot; can be booked by your members with their membership time, and by nobody else. They count toward
            the room you have for members like any other hours.
          </p>
        )}
      </section>

      {ownBookings.length > 0 && (
        <section className="mt-10">
          <h2 className="text-lg font-semibold">Taken by your own bookings</h2>
          <p className="mt-1 text-sm opacity-70">
            Calls you booked with other hosts, and requests of yours that wait for an answer. Nobody can book you at these times, or
            in your break after them.
          </p>
          <ul className="mt-3 space-y-1 text-sm">
            {ownBookings.map((own) => (
              <li key={own.bookingId}>
                <Link href={`/bookings/${own.bookingId}`} className="underline underline-offset-2">
                  {inZone(calendar.timeZone, own.startsAt)} to {inZone(calendar.timeZone, own.endsAt)}
                </Link>
                : {own.waiting ? `your request to ${own.hostName}, waiting for an answer` : `your call with ${own.hostName}`}. You can be
                booked again from {inZone(calendar.timeZone, own.freeAgainAt)}.
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-10">
        <h2 className="text-lg font-semibold">Time off</h2>
        <p className="mt-1 text-sm opacity-70">A holiday or an afternoon when you cannot take calls, whatever your weekly hours say.</p>
        {off.length > 0 && (
          <ul className="mt-3 space-y-1 text-sm">
            {off.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-3">
                <span>
                  {inZone(calendar.timeZone, t.startsAt)} to {inZone(calendar.timeZone, t.endsAt)}
                </span>
                <form action={removeOff}>
                  <input type="hidden" name="id" value={t.id} />
                  <button type="submit" className="underline underline-offset-2">
                    Remove
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
        <form action={addOff} className="mt-4 flex flex-wrap items-end gap-2 text-sm">
          <label>
            From
            <input name="from" type="datetime-local" required className={`${field} block`} />
          </label>
          <label>
            To
            <input name="to" type="datetime-local" required className={`${field} block`} />
          </label>
          <button type="submit" className={button}>
            Add time off
          </button>
        </form>
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-semibold">Your choices</h2>
        <form action={saveChoices} className="mt-3 max-w-md space-y-4 text-sm">
          <label className="block">
            Calendar time zone
            <TimeZoneSelect zones={timeZones()} saved={calendar.timeZone} />
            <span className="mt-1 block opacity-70">Changing this moves your future open times. Calls already booked do not move.</span>
          </label>
          <fieldset>
            <legend>Call lengths you offer</legend>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-2">
              <label className="block">
                Shortest call
                <select name="shortest" defaultValue={shortest} className={`${field} block`}>
                  {LENGTH_CHOICES_MINUTES.map((minutes) => (
                    <option key={minutes} value={minutes}>
                      {lengthWords(minutes)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                Longest call
                <select name="longest" defaultValue={longest} className={`${field} block`}>
                  {LENGTH_CHOICES_MINUTES.map((minutes) => (
                    <option key={minutes} value={minutes}>
                      {lengthWords(minutes)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className="mt-1 opacity-70">
              A customer picks any length between the two, in steps of 5 minutes. The price of a call follows its length: a 5-minute call costs a third of your 15-minute price. Our fee includes 30 cents for each
              paid call, whatever its length, so on a short call at a low price it takes a larger part. The same 30 cents is taken again each
              time paid time is added during a call.
            </p>
          </fieldset>
          <label className="block">
            Shortest notice
            <select name="noticeHours" defaultValue={calendar.noticeHours} className={`${field} block`}>
              {NOTICE_CHOICES_HOURS.map((hours) => (
                <option key={hours} value={hours}>
                  {hours / 24} {hours === 24 ? "day" : "days"}
                </option>
              ))}
            </select>
            <span className="mt-1 block opacity-70">
              Paid calls sometimes need a little longer than this, so there is time for you to answer and for the payment to be
              arranged.
            </span>
          </label>
          <label className="block">
            How far ahead you can be booked
            <select name="horizonWeeks" defaultValue={calendar.horizonWeeks} className={`${field} block`}>
              {HORIZON_CHOICES_WEEKS.map((weeks) => (
                <option key={weeks} value={weeks}>
                  {weeks} weeks
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            Break after each call
            <select name="breakMinutes" defaultValue={Math.max(calendar.breakMinutes, AFTER_CALL_MINUTES)} className={`${field} block`}>
              {BREAK_CHOICES_MINUTES.map((minutes) => (
                <option key={minutes} value={minutes}>
                  {minutes} minutes
                </option>
              ))}
            </select>
            <span className="mt-1 block opacity-70">
              With a short break, your next customer may already be waiting in their room while you finish. Their waiting is
              never counted.
            </span>
          </label>
          <button type="submit" className={button}>
            Save
          </button>
        </form>
      </section>
    </SitePage>
  );
}
