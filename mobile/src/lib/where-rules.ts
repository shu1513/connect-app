/**
 * Which part of the app a person is in, from what the server said on opening
 * (plans/45-phone-apps/03-signing-in.md). Plain logic, tested on its own.
 */
import type { AppStart, AppWelcome } from "../../../src/lib/app-door/types";

export type Where =
  /** Nobody is signed in: the first screens (sign in, create account). */
  | "front"
  /** Signed in, but "18 or older and terms" is still to do. */
  | "welcome"
  /** Signed in, with nothing in the way. */
  | "home";

export function whereFor(start: AppStart): Where {
  if (!start.me) return "front";
  return start.me.next === "welcome" ? "welcome" : "home";
}

/** The first screen for someone not signed in: "check your email" if this phone remembers that step, else the first opening. */
export function frontStart(rememberedEmail: string | null): "check-email" | "first" {
  return rememberedEmail ? "check-email" : "first";
}

/** Whether an answer really is what the "18 and terms" step shows, with every part the screen reads. */
export function isWelcome(data: unknown): data is AppWelcome {
  if (data === null || typeof data !== "object" || Array.isArray(data)) return false;
  const step = data as Record<string, unknown>;
  if (typeof step.done !== "boolean" || typeof step.returning !== "boolean") return false;
  if (step.timeZone !== null && typeof step.timeZone !== "string") return false;
  if (!Array.isArray(step.timeZones) || !step.timeZones.every((zone) => typeof zone === "string")) return false;
  // The versions that are announced and not yet in effect: each with its sentence and its link, or none at all.
  if (!Array.isArray(step.coming) || !step.coming.every(isComing)) return false;
  // The documents the step accepts, each with the version shown: without them the step could not say what was agreed to.
  return Array.isArray(step.agreements) && step.agreements.every(isAgreement);
}

function isComing(data: unknown): boolean {
  if (data === null || typeof data !== "object" || Array.isArray(data)) return false;
  const one = data as Record<string, unknown>;
  if (typeof one.name !== "string" || typeof one.title !== "string" || typeof one.version !== "string" || typeof one.from !== "string" || typeof one.accepted !== "boolean") return false;
  return typeof one.words === "string" && one.words !== "" && typeof one.link === "string" && one.link !== "" && typeof one.href === "string";
}

function isAgreement(data: unknown): boolean {
  if (data === null || typeof data !== "object" || Array.isArray(data)) return false;
  const one = data as Record<string, unknown>;
  return typeof one.name === "string" && typeof one.title === "string" && typeof one.version === "string" && typeof one.href === "string";
}

/**
 * The time zone offered first on the "18 and terms" step: the saved one, else the phone's own if
 * the server accepts it, else none (the person then chooses from the list).
 */
export function firstTimeZone(saved: string | null, phone: string | null, accepted: readonly string[]): string | null {
  if (saved && accepted.includes(saved)) return saved;
  return phone && accepted.includes(phone) ? phone : null;
}

/** The zones that match what was typed, at most `limit`: "lon" finds "Europe/London". */
export function zonesMatching(typed: string, accepted: readonly string[], limit = 20): string[] {
  const wanted = typed.trim().toLowerCase().replace(/\s+/g, "_");
  if (!wanted) return [];
  return accepted.filter((zone) => zone.toLowerCase().includes(wanted)).slice(0, limit);
}
