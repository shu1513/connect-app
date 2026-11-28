/**
 * What the app shows when it opens, from the server's answer to its first question
 * (plans/45-phone-apps/02-the-frame.md). Plain logic, tested on its own.
 */
import type { AppStart } from "../../../src/lib/app-door/types";
import { UNREACHABLE, type Answer } from "./api-rules";

export type Opening =
  /** Still asking. */
  | { kind: "asking" }
  /** The server answered; the app carries on with what it said. */
  | { kind: "ready"; start: AppStart }
  /** This copy of the app is too old: a screen that says so, and nothing else. */
  | { kind: "update"; message: string }
  /** The server could not be reached: say so plainly, and offer to try again. */
  | { kind: "unreachable"; message: string };

export const PLEASE_UPDATE = "This version of the Connect app is too old. Please update the app to carry on.";

const isThing = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * Whether an answer really is the opening answer, with every part the screens read. The type
 * says what the server promises; this is the check that it kept the promise, so that half an
 * answer, or some other site's answer, never opens the app.
 */
export function isStart(data: unknown): data is AppStart {
  if (!isThing(data) || typeof data.updateNeeded !== "boolean" || typeof data.termsVersion !== "string" || typeof data.supportEmail !== "string") return false;
  const switches = data.switches;
  if (!isThing(switches) || typeof switches.tips !== "boolean" || typeof switches.availableNow !== "boolean") return false;
  if (switches.memberships !== "on" && switches.memberships !== "use_only" && switches.memberships !== "off") return false;
  const me = data.me;
  if (me === null) return true;
  if (!isThing(me) || typeof me.id !== "string" || typeof me.name !== "string" || typeof me.email !== "string" || typeof me.paused !== "boolean") return false;
  if (me.timeZone !== null && typeof me.timeZone !== "string") return false;
  if (me.next !== null && me.next !== "welcome") return false;
  return me.host === null || (isThing(me.host) && typeof me.host.status === "string" && typeof me.host.hidden === "boolean");
}

/**
 * What a paused person reads on the home screen (plans/45-phone-apps/09a-what-is-built-put-right.md,
 * decision 3), paragraph by paragraph: that the account is paused, what it can still do, where the
 * reason is, and where to write. Never the reason itself: the server does not send it. It is typed
 * by a person at Connect, and is in the email sent at the pause and on the website.
 */
export function pausedWords(supportEmail: string): string[] {
  return [
    "Your account is paused. You can still look at your calls, take a request back, cancel a call, and report or block someone. You cannot book, host or join calls.",
    "The reason is in the email we sent you when your account was paused, and on the Connect website.",
    `If you think this is a mistake, write to ${supportEmail}.`,
  ];
}

/**
 * Whether an answer says "this copy is too old", in so many words. This is read before anything
 * else about the answer: a later server may send parts this copy does not know, and an old copy
 * must still understand that it has to be updated.
 */
function saysUpdate(data: unknown): boolean {
  return isThing(data) && data.updateNeeded === true;
}

/**
 * Whether Connect itself answered: a whole opening answer, "please update", or one of its own
 * refusals. Not getting through (no connection, some other site's page, half an answer) is the
 * other case.
 */
export function gotThrough(answer: Answer<AppStart>): boolean {
  return answer.ok ? saysUpdate(answer.data) || isStart(answer.data) : answer.code !== "unreachable";
}

/** Whether an answer of the opening address says, as a whole answer, that somebody is signed in. */
export function someoneSignedIn(answer: Answer<AppStart>): boolean {
  return answer.ok && isStart(answer.data) && answer.data.me !== null;
}

/**
 * Where an answer of the opening address leads. An answer that says "update" leads to the update
 * screen even though the address itself answered; a refusal of any other kind is treated as not
 * having reached Connect, since the opening address refuses nobody who comes the app's way; and
 * so is an answer without the parts it must have.
 */
export function openingFrom(answer: Answer<AppStart>): Opening {
  if (answer.ok) {
    if (saysUpdate(answer.data)) return { kind: "update", message: PLEASE_UPDATE };
    return isStart(answer.data) ? { kind: "ready", start: answer.data } : { kind: "unreachable", message: UNREACHABLE };
  }
  if (answer.code === "update_needed") return { kind: "update", message: answer.message };
  return { kind: "unreachable", message: answer.message };
}

/**
 * What the app shows after an answer, given what it shows now. Once the app is open and in use, a
 * question asked quietly (on coming back to the front) that does not get through changes nothing:
 * the person keeps the screen they were on, and whatever they do next says for itself if Connect
 * cannot be reached. Whatever Connect itself answers always counts: a newer answer replaces the
 * old one (someone signed out elsewhere is signed out here), "this copy is too old" closes the
 * app, and a refusal never leaves the old, signed-in screens standing.
 */
/**
 * What the app shows the moment someone signs out, before the server has been asked anything:
 * the same app with nobody signed in. It does not wait for the server, and does not depend on
 * reaching it: a phone handed to the next person shows nothing of the one before.
 */
export function signedOut(now: Opening): Opening {
  return now.kind === "ready" ? { kind: "ready", start: { ...now.start, me: null } } : now;
}

export function openingAfter(now: Opening, answer: Answer<AppStart>): Opening {
  return now.kind === "ready" && !gotThrough(answer) ? now : openingFrom(answer);
}
