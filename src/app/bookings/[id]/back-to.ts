/** The pages with a list of requests: the requests page, and the home page (plans/38). */
const LISTS: Record<string, string> = { requests: "/host/requests", home: "/" };

/**
 * Where Accept and Decline go back to: the page the button was on, named by the form. Only our
 * own pages are allowed, from a fixed list; anything else is the page of the request itself.
 */
export function backTo(from: unknown, bookingId: string): string {
  return typeof from === "string" && Object.hasOwn(LISTS, from) ? LISTS[from] : `/bookings/${bookingId}`;
}
