/**
 * What a host is shown about the requests that wait for her answer, gathered once for the
 * website's list (the requests page and the home page) and for the phone app
 * (plans/45-phone-apps/07-a-hosts-requests.md, decision 1).
 *
 * Nothing about a customer whose account is closed, or while either has blocked the other
 * (plans/38, decision 7): closing an account or blocking ends the waiting requests, but that step
 * can fail, and a request that is still there is then shown with the name, its time, length and
 * price, and nothing else: no rating, no "ID confirmed", no photo, no note, and not what they
 * wrote when asking. The name stays: the host has to know whose request she is declining.
 */
import "server-only";
import { hostNotesAbout, openAndUnblocked } from "@/lib/people/contacts";
import { photosForHost } from "@/lib/profiles/photo";
import { averagesFor } from "@/lib/ratings/ratings";
import { verifiedAmong } from "@/lib/safety/identity";
import type { waitingForHost } from "./bookings";

export type Waiting = Awaited<ReturnType<typeof waitingForHost>>;

/** What the host may know about the customer of one waiting request. */
export type WaitingAbout = {
  /** Anything about the customer may be shown: their account is open and neither has blocked the other. */
  known: boolean;
  /** How other hosts have rated them; null when there are too few ratings, or nothing may be shown. */
  rating: Awaited<ReturnType<typeof averagesFor>> extends Map<string, infer Shown> ? Shown : never;
  /** They have passed the identity check. Only a yes or no. */
  idConfirmed: boolean;
  /** What they wrote when asking; empty when they wrote nothing, or nothing may be shown. */
  words: string;
  /** The host's own private note about them, when there is one she may read. */
  note: string | null;
  /** Their photo, only if this host is handed it. */
  photoId: string | null;
};

/** The requests grouped by the time asked for, in the order given (the soonest call first). */
export function byTime(waiting: Waiting): Array<[string, Waiting]> {
  const groups = new Map<string, Waiting>();
  for (const row of waiting) {
    const key = row.booking.startsAt.toISOString();
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups];
}

/** How many different times these requests ask for. A time several people asked for counts as one. */
export function timesAskedFor(waiting: Waiting): number {
  return byTime(waiting).length;
}

/**
 * What may be shown about the customer of each of these requests, by the request's id. `waiting`
 * is this host's own list (`waitingForHost`, asked for with her id); what is known about each
 * customer is asked for here, a fixed number of questions however many requests there are.
 */
export async function aboutWaiting(hostId: string, waiting: Waiting, now: Date): Promise<Map<string, WaitingAbout>> {
  const customers = [...new Set(waiting.map((row) => row.booking.customerId))];
  // Whom anything may be shown about: an open account, and no block in either direction.
  const allowed = await openAndUnblocked(hostId, customers);
  const known = customers.filter((id) => allowed.has(id));
  const [ratings, idConfirmed, notes, photoIds] = await Promise.all([
    // How other hosts have rated each of these customers: one question to the database for all of them.
    averagesFor(known, "customer", now),
    verifiedAmong(known),
    // The host's own notes about these customers (plans/32). The lookup asks every rule itself.
    hostNotesAbout(hostId, known),
    // Their photos (plans/35): the ids only, and only of those this host is handed a photo of.
    photosForHost(hostId, known),
  ]);
  return new Map(
    waiting.map(({ booking }) => {
      const id = booking.customerId;
      const may = allowed.has(id);
      return [booking.id, { known: may, rating: may ? (ratings.get(id) ?? null) : null, idConfirmed: idConfirmed.has(id), words: may ? booking.note : "", note: notes.get(id) ?? null, photoId: photoIds.get(id) ?? null }];
    }),
  );
}
