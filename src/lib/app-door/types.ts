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
  /** Why, in the founder's words, when the account is paused and a reason was given; otherwise null. Hers alone to read. */
  pausedReason: string | null;
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
  /** Where to write to Connect: shown to a paused person, and wherever the app says "write to us". */
  supportEmail: string;
};

/** One legal document as the "18 or older and terms" step shows it. */
export type AppAgreement = { name: string; title: string; version: string; href: string };

/** The answer of GET /api/app/welcome: what the "18 or older and terms" step shows. */
export type AppWelcome = {
  /** True when this person has done the step already (the app then goes on). */
  done: boolean;
  /** True when she accepted an earlier version of the terms: the step says "we have updated our terms". */
  returning: boolean;
  /**
   * The documents this step accepts when it is finished, each in the version in effect now, with the path of that
   * exact version on the website (plans/46-agreements-live.md, decision 7). The app shows their names beside its
   * button, each opening that path, and sends their names and versions back. The server writes nothing for a
   * request that does not name them, and answers "not_valid" when they are no longer the ones in effect: the app
   * then asks for the step again.
   */
  agreements: AppAgreement[];
  /** Her saved time zone, if she has one. */
  timeZone: string | null;
  /** Every time zone name the server accepts. The app offers the phone's own if it is among them. */
  timeZones: string[];
};

/** The answer of POST /api/app/welcome. */
export type AppWelcomeDone = { done: true };

/**
 * About the customer of a call, for the host of that call only. Decided on the server; a call a
 * person booked never has one. Never the customer's email, the name on an ID, or card details.
 */
export type AppAbout = {
  /** What the customer wrote when asking for the call; empty when they wrote nothing. */
  words: string;
  /** Only a yes or no. */
  idConfirmed: boolean;
  /** The customer has an active membership with this host. */
  member: boolean;
  /** How often the two have talked before. */
  callsBefore: number;
  /** When the last of those calls started; null when there was none. */
  lastCallAt: string | null;
  /** The host's own private note about this customer, or null. */
  note: string | null;
};

/** One call as a list or a calendar shows it: the words and numbers for the person looking, never a whole record. */
export type AppCall = {
  id: string;
  startsAt: string;
  endsAt: string;
  minutes: number;
  /** The other person, as this person knows them: a host by the name on their page. */
  name: string;
  /** The other person's photo, when this person is handed one. Asked for by its id (GET /api/app/photos/…). */
  photoId: string | null;
  /** This person hosts the call. */
  hosting: boolean;
  /** The room is open now. */
  open: boolean;
  /** The call is over. */
  finished: boolean;
  /** What a list says about the call's money. */
  payment: string;
  /** What the call earned its host: only for a finished call this person hosted, once something of it is charged. */
  earned?: { text: string; cents: number; soFar: boolean };
  /** For a finished call this person hosted: part of its money is not settled yet. */
  moneyOpen?: true;
  /** Only ever on a call this person hosts that is not over. */
  about?: AppAbout;
};

/** A time people have asked a host for and she has not answered: when, and how many asked. Never who. */
export type AppAsk = { startsAt: string; endsAt: string; count: number };

/** A request waiting for this host's answer, as the home page lists it. What else she may know about the person asking is on the request's own screen. */
export type AppWaitingRequest = { id: string; startsAt: string; endsAt: string; minutes: number; price: string; name: string; respondBy: string | null };

/** A suggested host, as a search result shows one. Never why they are suggested. */
export type AppSuggestedHost = {
  /** The place in today's row (1 to 6): what "seen", "opened" and "hide" name. */
  place: number;
  handle: string;
  name: string;
  price: string;
  languages: string[];
  /** Already marked as seen today. */
  seen: boolean;
  rating: { average: number; count: number } | null;
  photoId: string | null;
  availableNow: boolean;
  nextOpen: string | null;
};

/** The answer of GET /api/app/home: the home page of someone who is signed in. No diary, no project, no tip. */
export type AppHome = {
  /** The server's clock when this was put together: what the countdown counts from. */
  serverNow: string;
  firstName: string;
  /** Null for someone with no hosting to do. `page`: her page's handle while it is open to everyone. */
  hosting: { page: string | null } | null;
  /** Every call the page speaks of: the soonest few that are not over, and the ones around the day in view. */
  calls: AppCall[];
  /** The call the countdown is about (one of `calls`), or null. */
  next: { id: string; opensAt: string; notPaid: boolean } | null;
  /** What the "next call" card says when no call is coming; null when one is. */
  noCall: string | null;
  /** The calendar: whether it is shown at all, the day in view (null: today), the asked-for times, and whether the calls were cut short. */
  calendar: { shown: boolean; day: string | null; asks: AppAsk[]; cut: boolean; most: number };
  /** Requests waiting for this person's answer as a host. */
  toAnswer: { count: number; times: number; shown: AppWaitingRequest[] };
  toRate: Array<{ callId: string; otherName: string; endsAt: string }>;
  /** This person's own requests. */
  requests: Array<{ id: string; hostName: string; startsAt: string; words: string }>;
  followed: { total: number; hosts: Array<{ name: string; handle: string | null; available: boolean; photoId: string | null }> };
  /** Null for a paused person. `made`: whether today's have been made (if not, the app asks for that once the page is up). */
  suggested: { day: string; made: boolean; shownFirst: number; why: string; hosts: AppSuggestedHost[] } | null;
  /** The last line of the page. */
  takeCalls: boolean;
  /** How often the app asks again while the page is in front. */
  refreshSeconds: number;
};
