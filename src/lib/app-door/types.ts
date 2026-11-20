/**
 * The shapes of what the server answers to the phone app (plans/45-phone-apps/01-the-door.md).
 *
 * This file imports nothing, on purpose: the app reads it as types only, from where it is, so
 * that an answer changed here without the app being changed fails the app's type check.
 */

/** Why the door refused. Each comes with the sentence to show, written by the server. */
export type RefusalCode =
  /** The request did not come in the app's way (no app header, or a browser's marks). */
  | "not_the_app"
  /** This copy of the app is older than the oldest one the founder still allows. */
  | "update_needed"
  /** Nobody is logged in (also the answer for a closed account, which has no login left). */
  | "not_signed_in"
  /** Logged in, but the email address is not confirmed yet. */
  | "confirm_email"
  /** Logged in, but "18 or older" and the terms are not done (or the terms changed). */
  | "welcome_needed"
  /** The account is paused: it may look, but not start or join anything. */
  | "paused"
  /** The founder has switched this off for the apps. */
  | "switched_off"
  /** The thing does not exist, or not for this person. Never says which. */
  | "not_found"
  /** What was sent cannot be used as it is; the sentence says why. */
  | "not_valid";

export type Refusal = { error: { code: RefusalCode; message: string } };

/**
 * Memberships in the apps: everything; or members may spend time already paid for and nothing
 * in the app can take a monthly payment; or nothing but seeing and cancelling one's own.
 */
export type AppMemberships = "on" | "use_only" | "off";

/** What is switched on for the apps right now. A thing that is off is also refused by the server. */
export type AppSwitches = {
  memberships: AppMemberships;
  tips: boolean;
  availableNow: boolean;
};

/** Who is logged in, as the app needs it on opening. */
export type AppPerson = {
  id: string;
  name: string;
  email: string;
  timeZone: string | null;
  paused: boolean;
  /** What stands between this person and the home page; null when nothing does. */
  next: "welcome" | null;
  /** Her host profile's state, or null for someone who never applied. */
  host: { status: string; hidden: boolean } | null;
};

/** The answer of GET /api/app/start. */
export type AppStart = {
  /** True when this copy of the app is too old: show "please update" and nothing else. */
  updateNeeded: boolean;
  switches: AppSwitches;
  /** null when nobody is logged in. */
  me: AppPerson | null;
  /** The version of the terms in force, so the app can say which it is showing. */
  termsVersion: string;
};
