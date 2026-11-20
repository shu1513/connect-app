/**
 * Which part of the app a person is in, from what the server said on opening
 * (plans/45-phone-apps/03-signing-in.md). Plain logic, tested on its own.
 */
import type { AppStart } from "../../../src/lib/app-door/types";

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
