/**
 * What the app shows when it opens, from the server's answer to its first question
 * (plans/45-phone-apps/02-the-frame.md). Plain logic, tested on its own.
 */
import type { AppStart } from "../../../src/lib/app-door/types";
import type { Answer } from "./api-rules";

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

/**
 * Where an answer of the opening address leads. An answer that says "update" leads to the update
 * screen even though the address itself answered; a refusal of any other kind is treated as not
 * having reached Connect, since the opening address refuses nobody who comes the app's way.
 */
export function openingFrom(answer: Answer<AppStart>): Opening {
  if (answer.ok) return answer.data.updateNeeded ? { kind: "update", message: PLEASE_UPDATE } : { kind: "ready", start: answer.data };
  if (answer.code === "update_needed") return { kind: "update", message: answer.message };
  return { kind: "unreachable", message: answer.message };
}

/**
 * What the app shows after an answer, given what it shows now. Once the app is open and in use, a
 * question asked quietly (on coming back to the front) that does not get through changes nothing:
 * the person keeps the screen they were on, and whatever they do next says for itself if Connect
 * cannot be reached. A real answer always counts, and so does "this copy is too old".
 */
export function openingAfter(now: Opening, answer: Answer<AppStart>): Opening {
  const next = openingFrom(answer);
  return now.kind === "ready" && next.kind === "unreachable" ? now : next;
}
