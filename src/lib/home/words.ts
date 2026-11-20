/**
 * The home page's own sentences that both the website's page and the phone app show (plans/36,
 * plans/45-phone-apps/04-the-home-page.md), kept in one place so the two say the same.
 */
import { PASSED_OVER } from "@/lib/booking/rules";

const REQUEST_LABEL: Record<string, string> = {
  card: "card details needed to send it",
  waiting: "waiting for the host's answer",
  declined: "the host could not take it",
  passed_over: "the host accepted another request for that time",
  ran_out: "ended without an answer",
  taken_back: "you took it back",
};
/** A booking a member made with their membership time that is not (or not yet) a call. */
const MEMBER_REQUEST_LABEL: Record<string, string> = {
  paying: "this month's payment is being taken; open it to finish the booking",
  ran_out: "not booked",
};

/** How one of a person's own requests stands, in words. */
export function requestWords(booking: { source: string; stage: string; endedReason: string | null }): string {
  return (booking.source === "member" ? MEMBER_REQUEST_LABEL[booking.stage] : booking.endedReason === PASSED_OVER.ownCall ? PASSED_OVER.ownCall : REQUEST_LABEL[booking.stage]) ?? booking.stage;
}

/** What the "Your next call" card says when no call is coming. `nothingYet`: the person follows nobody and has asked nobody. */
export function noCallWords(nothingYet: boolean): string {
  return nothingYet ? "Welcome to Connect. Find someone you follow, and ask them for a call." : "You have no call coming up. Find a host to ask for one.";
}
