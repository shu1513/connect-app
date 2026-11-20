/**
 * What the page on which a customer asks a host for a call at a time shows, gathered once for the
 * website's page and for the phone app (plans/45-phone-apps/06-asking-for-a-call.md). It decides
 * nothing that sending the request does not decide again (askForCall): it only says, for the
 * person looking, whether the time can still be asked for and on what terms.
 */
import "server-only";
import { isBlockedEitherWay } from "@/lib/safety/block-check";
import { identityState } from "@/lib/safety/identity";
import { bookedTotalCents } from "@/lib/payments/pricing";
import { isHostToo, offerOf, openTimes, type Offer } from "./bookings";
import { whenFor } from "./emails";
import { answerDeadline, payCutoff } from "./rules";

export type BookPage =
  /** The time cannot be asked for (any more): gone, never offered, or a block either way. They all look the same. */
  | { kind: "gone"; minutes: number }
  /** The person is looking at their own page. */
  | { kind: "own" }
  /** The identity check comes first: before a free call, or because this host asks it of everyone. */
  | { kind: "confirm_id"; reason: "free" | "host" }
  | {
      kind: "ok";
      offer: Offer;
      startsAt: Date;
      minutes: number;
      totalCents: number;
      paid: boolean;
      idConfirmed: boolean;
      /** By when the host must have answered, were the request sent now. */
      answerBy: Date;
      /** Until when a card that could not be held can be put right. */
      payBy: Date;
      /** The start, written in the host's own time zone. */
      hostZoneTime: string;
      /** The person asking is a host too: the call takes time out of their own calendar. */
      hostToo: boolean;
    };

export async function gatherBookPage(person: { id: string }, host: { userId: string }, asked: { start: unknown; length: unknown }, now: Date): Promise<BookPage> {
  const minutes = Number(asked.length);
  const startsAt = new Date(String(asked.start));
  const offer = await offerOf(host.userId);
  const open = offer && offer.lengths.includes(minutes) && !Number.isNaN(startsAt.getTime()) ? await openTimes(offer, minutes, now) : [];
  const stillOpen = open.some((o) => o.getTime() === startsAt.getTime());
  // A block either way looks, from here, exactly like a time that is no longer open.
  if (!offer || !stillOpen || (await isBlockedEitherWay(person.id, host.userId))) return { kind: "gone", minutes };
  if (person.id === host.userId) return { kind: "own" };

  const totalCents = bookedTotalCents(offer.pricePer15Cents, minutes * 60);
  const paid = totalCents > 0;
  const idConfirmed = (await identityState(person.id)).passed;
  if ((!paid || offer.verifiedOnly) && !idConfirmed) return { kind: "confirm_id", reason: paid ? "host" : "free" };
  return {
    kind: "ok",
    offer,
    startsAt,
    minutes,
    totalCents,
    paid,
    idConfirmed,
    answerBy: answerDeadline({ startsAt, paid, freeCancelMinutes: offer.freeCancelMinutes, requestedAt: now }),
    payBy: payCutoff(startsAt, offer.freeCancelMinutes),
    hostZoneTime: whenFor({ timeZone: offer.timeZone }, startsAt),
    hostToo: await isHostToo(person.id),
  };
}
