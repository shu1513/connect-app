/**
 * A call's page before the call, and a person's calls a page at a time, for the phone app
 * (plans/45-phone-apps/08-the-calls-page.md): what the website's pages show, from the very same
 * gathering (src/lib/call-page/gather.ts, src/lib/home/list-calls.ts) and with the very same
 * sentences (src/lib/call-page/words.ts).
 *
 * The answers are built field by field. No account id travels, no card or Stripe detail, and
 * nothing about a customer beyond what the home page's own rules hand a host.
 */
import "server-only";
import { gatherCallPage, type CallPage } from "@/lib/call-page/gather";
import { APP_ROOM_WORDS } from "@/lib/call-page/room-words";
import { END_WORDS } from "@/lib/call-page/end-words";
import { CALL_WORDS, cancelRuleSentence, cancelWords, paidHowWords, payPoints } from "@/lib/call-page/words";
import { roomOpensAt, roomState } from "@/lib/calls";
import { comingCallRows, listCalls, pastCallRows } from "@/lib/home/list-calls";
import { payOpensAt } from "@/lib/payments/rules";
import { callFor } from "./home";
import type { AppCallPage, AppCalls } from "./types";

/** How often the app asks again while a hold may land any second, and while a page can otherwise change by itself. */
const FOLLOW_SECONDS = 3;
const WATCH_SECONDS = 30;

/** The state's own sentence and the smaller one under it, in the website's words. */
function stateWords(page: CallPage): Pick<AppCallPage, "words" | "small"> {
  const { call, state } = page;
  if (state === "cancelled") return { words: [CALL_WORDS.cancelled], small: null };
  if (state === "ended") return { words: [CALL_WORDS.ended], small: null };
  if (state === "blocked") return { words: [CALL_WORDS.blocked], small: null };
  if (state === "too_early") return { words: [CALL_WORDS.tooEarlyBefore, { time: payOpensAt(call.startsAt).toISOString() }, CALL_WORDS.tooEarlyAfter], small: CALL_WORDS.tooEarlySmall };
  if (state === "host_waits") return { words: [CALL_WORDS.hostWaits(page.otherName ?? "the customer")], small: `${CALL_WORDS.hostWaitsSmall(page.bookedPrice ?? "")}${CALL_WORDS.updatesByItself}` };
  return { words: null, small: null };
}

/**
 * One call's page, for one of its two people; null for anyone else, whether or not the call
 * exists. Only ever reads: a hold that waits at Stripe is asked about with the step "pay-check".
 */
export async function callPageFor(person: { id: string }, callId: string, now: Date, notice: string | null = null): Promise<AppCallPage | null> {
  const page = await gatherCallPage(person.id, callId, now, { sync: false });
  if (!page) return null;
  const { call, role, payment } = page;
  // A call whose booked end has passed is over, whatever else was open about it (unpaid, or its room simply
  // empty now): the page then says so and offers nothing more. (The website's page finds this out by its own clock.)
  const state = page.state !== "cancelled" && roomState(call, now) === "closed" ? "ended" : page.state;
  const over = state === "cancelled" || state === "ended";
  return {
    id: call.id,
    role,
    title: CALL_WORDS.title(page.otherName ?? "Unknown"),
    roleWords: CALL_WORDS.role(role),
    startsAt: call.startsAt.toISOString(),
    endsAt: call.endsAt.toISOString(),
    paidHow: paidHowWords({ kind: payment?.kind ?? null, role, pricePer15: page.pricePer15, upTo: page.upTo }),
    serverNow: now.toISOString(),
    state,
    ...stateWords({ ...page, state }),
    pay:
      state === "pay" && page.bookedPrice && page.pricePer15
        ? {
            title: CALL_WORDS.payTitle,
            points: payPoints({ pricePer15: page.pricePer15, bookedPrice: page.bookedPrice, billing: call.billing, cancelRule: cancelRuleSentence(call.freeCancelMinutes, page.bookedPrice), wholeBookingSaid: page.wholeBookingSaid }),
            button: CALL_WORDS.payButton(page.bookedPrice),
            givenUp: CALL_WORDS.payGivenUp,
            notHeld: CALL_WORDS.payNotHeld,
            notConfirmed: `${CALL_WORDS.payNotConfirmed} Please try again in a moment.`,
            checkAgain: CALL_WORDS.payCheckAgain,
          }
        : null,
    room: state === "room" ? { opensAt: roomOpensAt(call).toISOString(), open: roomState(call, now) === "open", enter: APP_ROOM_WORDS.goToCall } : null,
    // Only for the host, only when there is a note, and never once the call is over.
    about: role === "host" && !over && page.about?.text ? { title: CALL_WORDS.aboutTitle(page.otherName ?? "this customer"), text: page.about.text } : null,
    cancel:
      !over && page.cancel !== "not_allowed"
        ? { words: cancelWords({ member: payment?.kind === "member_call", outcome: page.cancel, bookedPrice: page.bookedPrice, frozen: page.memberFrozen }), button: CALL_WORDS.cancelButton, shown: page.cancel, yes: CALL_WORDS.cancelYes, no: CALL_WORDS.cancelNo }
        : null,
    // Once the call is over, the two can still report or block each other: the screen that follows "End call now" does it.
    afterEnd: state === "ended" ? { label: END_WORDS.reportOrBlock(page.otherName ?? (role === "host" ? "the customer" : "the host")) } : null,
    refreshSeconds: over ? null : page.follows ? FOLLOW_SECONDS : WATCH_SECONDS,
    notice,
  };
}

/** A person's calls, a page at a time: the coming ones (the soonest first) or the past ones (the newest first). */
export async function callsFor(person: { id: string }, kind: "coming" | "past", page: number, now: Date): Promise<AppCalls> {
  if (kind === "coming") {
    const { calls, later } = await comingCallRows(person.id, page, now);
    const listed = await listCalls(person.id, calls, now);
    return { kind, serverNow: new Date().toISOString(), title: CALL_WORDS.comingTitle, calls: listed.map((call) => ({ ...callFor(call), status: null })), page, more: later, empty: calls.length === 0 ? (page === 1 ? CALL_WORDS.noComing : CALL_WORDS.noMore) : null };
  }
  const { calls, older } = await pastCallRows(person.id, page, now);
  const listed = await listCalls(person.id, calls, now);
  const cancelled = new Set(calls.filter((call) => call.cancelledAt).map((call) => call.id));
  return {
    kind,
    serverNow: new Date().toISOString(),
    title: CALL_WORDS.pastTitle,
    // A past call is never open and is always over, also one that was cancelled before its time.
    calls: listed.map((call) => ({ ...callFor(call), open: false, finished: true, status: cancelled.has(call.id) ? CALL_WORDS.statusCancelled : CALL_WORDS.statusEnded })),
    page,
    more: older,
    empty: calls.length === 0 ? (page === 1 ? CALL_WORDS.noPast : CALL_WORDS.noMore) : null,
  };
}
