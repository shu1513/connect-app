import Link from "next/link";
import { TimeZoneSelect } from "@/components/time-zone-select";
import { calendarOf, clockText, hoursAndTimeOff, inZone } from "@/lib/booking/calendar";
import { BREAK_CHOICES_MINUTES, HORIZON_CHOICES_WEEKS, LENGTH_CHOICES_MINUTES, NOTICE_CHOICES_HOURS, readLengths } from "@/lib/booking/rules";
import { readNotice } from "@/lib/notice";
import { requireUser } from "@/lib/session";
import { timeZones } from "@/lib/time-zones";
import { addHours, addOff, removeHours, removeOff, saveChoices } from "./actions";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export default async function HostCalendarPage(props: PageProps<"/host/calendar">) {
  const user = await requireUser();
  const notice = readNotice("/host/calendar", await props.searchParams);
  const calendar = await calendarOf(user.id, user.timeZone);
  const { hours, off } = await hoursAndTimeOff(user.id, new Date());
  const lengths = readLengths(calendar.lengths);
  const field = "mt-1 rounded border border-neutral-400 bg-transparent px-3 py-2";
  const button = "rounded border border-neutral-500 px-3 py-1.5 text-sm";

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10">
      <p className="text-sm">
        <Link href="/host" className="underline underline-offset-2">
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
              <li key={h.id} className="flex items-center gap-3">
                <span className="w-56">
                  {DAYS[h.weekday - 1]}, {clockText(h.startMinute)} to {clockText(h.endMinute)}
                </span>
                <form action={removeHours}>
                  <input type="hidden" name="id" value={h.id} />
                  <button type="submit" className="underline underline-offset-2">
                    Remove
                  </button>
                </form>
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
          <button type="submit" className={button}>
            Add hours
          </button>
        </form>
        <p className="mt-1 text-sm opacity-70">To end at midnight, enter 00:00 as the &quot;to&quot; time.</p>
      </section>

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
            <div className="mt-1 flex gap-4">
              {LENGTH_CHOICES_MINUTES.map((minutes) => (
                <label key={minutes} className="flex items-center gap-1">
                  <input type="checkbox" name="lengths" value={minutes} defaultChecked={lengths.includes(minutes)} />
                  {minutes} min
                </label>
              ))}
            </div>
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
            <select name="breakMinutes" defaultValue={calendar.breakMinutes} className={`${field} block`}>
              {BREAK_CHOICES_MINUTES.map((minutes) => (
                <option key={minutes} value={minutes}>
                  {minutes} {minutes === 1 ? "minute" : "minutes"}
                </option>
              ))}
            </select>
            <span className="mt-1 block opacity-70">
              With a short break, your next caller may already be waiting in their room while you finish. Their waiting is
              never counted.
            </span>
          </label>
          <button type="submit" className={button}>
            Save
          </button>
        </form>
      </section>
    </main>
  );
}
