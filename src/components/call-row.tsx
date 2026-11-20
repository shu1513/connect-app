import Link from "next/link";
import { CustomerDetailsLines } from "@/components/customer-details";
import { HostPhoto } from "@/components/host-photo";
import { LocalTime } from "@/components/local-time";
import type { CustomerDetails } from "@/lib/home/rules";

/**
 * One call as the home page lists it. Made on the server for the person looking, and holding only
 * what is drawn: never a payment's or a request's whole record (plans/43, decision 18).
 */
export type ListedCall = {
  id: string;
  startsAt: string;
  endsAt: string;
  minutes: number;
  /** The other person, as this person knows them: a host by the name on their page. */
  name: string;
  /** The other person's photo: a host's, or a customer's when this person hosts the call and is handed one (plans/38). */
  photoId: string | null;
  /** This person hosts the call. */
  hosting: boolean;
  /** "Open now", or nothing while the room is not open yet. */
  open: boolean;
  /** The call is over: its booked end has passed, or it was ended with a report. */
  finished: boolean;
  /** What the list says about the call's money. */
  payment: string;
  /**
   * What the call earned its host, for a finished call this person hosted, once something of it
   * is charged (plans/43, decision 8). Worked out on the server and sent with hosted calls only.
   */
  earned?: { text: string; soFar: boolean };
  /**
   * About the customer, for the host of the call only (plans/38). The server attaches it to the
   * calls this person hosts and to no others; `hosting` above is only how the row reads.
   */
  about?: CustomerDetails;
};

/**
 * A call's row: in the list by day, and under the calendar for the call that was tapped. A call
 * that is over says so, says what it earned, and leads to its results instead of its room.
 */
export function CallRow({ call, timeOnly }: { call: ListedCall; timeOnly: boolean }) {
  return (
    <li className={`flex ${call.about ? "items-start" : "items-center"} gap-3 border-t border-[#e7e5e4] py-3 first:border-t-0`} data-call={call.id}>
      <HostPhoto photoId={call.photoId} name={call.name} small />
      <div className="min-w-0 flex-1 text-sm">
        <p className="text-base font-bold">
          {timeOnly ? (
            <time dateTime={call.startsAt}>{new Date(call.startsAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZoneName: "short" })}</time>
          ) : (
            <LocalTime iso={call.startsAt} />
          )}{" "}
          · {call.name}
        </p>
        <p className="text-[#57534e]">
          {call.minutes} minutes · {call.payment}
          {call.hosting && (
            <>
              {" "}
              · <span data-hosting>You host this call</span>
            </>
          )}
          {call.open && !call.finished && (
            <>
              {" "}
              · <strong>Open now</strong>
            </>
          )}
          {call.finished && (
            <>
              {" "}
              · <span data-finished>Finished</span>
            </>
          )}
        </p>
        {call.earned && (
          <p className="font-semibold text-[#44403c]" data-earned>
            You earned {call.earned.text}
            {call.earned.soFar && " so far"}
          </p>
        )}
        {call.about && <CustomerDetailsLines callId={call.id} name={call.name} about={call.about} short />}
      </div>
      <Link href={call.finished ? `/calls/${call.id}/results` : `/calls/${call.id}`} className="inline-flex min-h-11 shrink-0 items-center underline underline-offset-2">
        {call.finished ? "Results" : "Open"}
      </Link>
    </li>
  );
}
