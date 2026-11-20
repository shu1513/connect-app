import { AboutCustomer } from "@/components/about-customer";
import { LocalTime } from "@/components/local-time";
import { callsBeforeWords, type CustomerDetails } from "@/lib/home/rules";

/**
 * What a host sees about the customer of a call she hosts, on the home page (plans/38): what they
 * want to talk about, "ID confirmed", "Your member", how often the two have talked, and her own
 * note, folded. Each only when there is something to show.
 *
 * It draws what it is given and decides nothing: the server makes these details for the host of
 * the call only (src/lib/home/customer-details.ts), and a call without them draws nothing here.
 */
export function CustomerDetailsLines({ callId, name, about, short = false }: { callId: string; name: string; about: CustomerDetails; short?: boolean }) {
  return (
    <div data-customer-details={callId}>
      {about.words && (
        // In a list, two lines of it; on the card of the next call, all of it.
        <p className={`mt-1 break-words text-[#44403c] ${short ? "line-clamp-2" : "whitespace-pre-line"}`} data-customer-words>
          &ldquo;{about.words}&rdquo;
        </p>
      )}
      <p className="mt-1 text-[#57534e]">
        {about.idConfirmed && (
          <>
            <span className="text-green-700" data-customer-id>
              ID confirmed
            </span>{" "}
            ·{" "}
          </>
        )}
        {about.member && (
          <>
            <span data-customer-member>Your member</span> ·{" "}
          </>
        )}
        <span data-customer-before={about.callsBefore}>
          {callsBeforeWords(about.callsBefore)}
          {about.callsBefore > 0 && about.lastCallAt && (
            <>
              {" "}
              <LocalTime iso={about.lastCallAt} dateOnly />
            </>
          )}
        </span>
      </p>
      {/* The key: when this place comes to hold another call, a note that was open is closed again. */}
      {about.note && <AboutCustomer key={callId} name={name} text={about.note} folded />}
    </div>
  );
}
