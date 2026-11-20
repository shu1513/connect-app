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

/** One host in a list of search results. Everyone listed has a page that anyone may open. */
export type AppFoundHost = {
  handle: string;
  name: string;
  about: string;
  price: string;
  languages: string[];
  socials: Array<{ label: string; name: string }>;
  rating: { average: number; count: number } | null;
  photoId: string | null;
};

/** The answer of GET /api/app/search?q=…. */
export type AppSearch = {
  /** What was searched for, as the server read it. */
  typed: string;
  /** False when too little was typed to search: then `hint` says how much is needed. */
  searched: boolean;
  hint: string | null;
  hosts: AppFoundHost[];
  /** Set when there may be more than are shown: the line asking to type more. */
  more: string | null;
};

/** A length a call can have, with its words for a list to choose from: "30 minutes, $40.00". */
export type AppLength = { minutes: number; words: string };

/**
 * The answer of GET /api/app/hosts/[handle]: a host's page for the person looking at it. No
 * project, no diary, no contribution. The host's account id is never in it.
 */
export type AppHostPage = {
  handle: string;
  name: string;
  about: string;
  photoId: string | null;
  languages: string[];
  rating: { average: number; count: number } | null;
  /** Her confirmed social media accounts. Empty on a page that is not open to everyone. */
  socials: Array<{ label: string; name: string; url: string }>;
  /** This is the viewer's own page. */
  own: boolean;
  /** Her page's address on the web, for sharing: only for a page anyone may open. */
  shareUrl: string | null;
  /** The viewer's own following, "visitor" for someone not signed in, or null when no Follow button is shown. */
  follow: "following" | "ended" | "none" | "visitor" | null;
  price: string;
  /** What the call is, and until when it can be cancelled for free. */
  callWords: string;
  /** She only takes calls from people who have confirmed their ID. `confirmId`: this viewer has not, and is offered the check. */
  verifiedOnly: boolean;
  confirmId: boolean;
  /**
   * She can take a call right away: the lengths to choose from, and how soon she answers. Null when she
   * cannot. `freshSeconds`: for how long this may be shown without asking again; after that it is not known.
   */
  now: { lengths: AppLength[]; answerMinutes: number; paid: boolean; freshSeconds: number } | null;
  /**
   * Asking for a call at a time: the heading, why nothing can be asked (or null), the lengths, the one chosen,
   * and its open times. `titleNotNow` is the heading for when "available now" is no longer believed.
   */
  ask: { title: string; titleNotNow: string; closed: string | null; words: string | null; lengths: AppLength[]; chosen: number | null; starts: string[]; noTimes: string | null };
  /**
   * Everything about a membership with her, for this viewer. Null when there is nothing to show, or
   * when memberships are switched off for the apps (the page then reads as to someone who is no member).
   */
  membership: {
    /** She has invited this viewer: until when the invitation is open. */
    invitedUntil: string | null;
    /** A membership that is not (or not yet) running, in words. */
    state: { status: "joining" | "unpaid" | "paused"; words: string } | null;
    /** A running membership: the time left, and the times that can be booked with it. */
    member: {
      left: string;
      until: string;
      price: string;
      /** Set while this month's money is only held on the card. */
      held: string | null;
      /** The time left does not cover a call. */
      tooLittle: boolean;
      /** Whether times can be booked with this month from the app. False where the apps may not take the month's payment and it is only held so far. */
      canBook: boolean;
      lengths: AppLength[];
      chosen: number | null;
      times: Array<{ startsAt: string; membersOnly: boolean }>;
    } | null;
  } | null;
};

/** A piece of a sentence: plain words, words to stress, or an exact moment, which the phone writes in its own time zone. */
export type AppPart = string | { bold: string } | { time: string };

/**
 * The answer of GET /api/app/hosts/[handle]/book: what a customer reads before asking a host for
 * a call at a time. Every word and number is the server's; the app adds nothing up.
 */
export type AppBookSummary =
  /** The time cannot be asked for (any more). */
  | { kind: "gone"; title: string; button: string }
  /** The person is looking at their own page. */
  | { kind: "own"; title: string; words: string }
  /** The identity check comes first. */
  | { kind: "confirm_id"; title: string; words: string; small: string; button: string }
  | {
      kind: "ok";
      title: string;
      startsAt: string;
      minutes: number;
      /** The start in the host's own time zone, in words. */
      hostTime: string;
      price: string;
      /** What is being asked for: a private one-to-one video call, and until when it can be cancelled for free. */
      what: string;
      pointsTitle: string;
      points: AppPart[][];
      /** The note to the host: its label, and the most it can hold. */
      note: { label: string; max: number };
      /** For a paid call: the words beside the box that must be ticked before anything is sent. Null for a free call. */
      cardTerms: string | null;
      /** That the host sees the person's ID is confirmed; null when it is not. */
      idLine: string | null;
      button: string;
      /** Makes a request sent twice count once. The app keeps the first one it was given for as long as the screen stands. */
      requestKey: string;
      /** The price and the cancelling rule this summary showed, handed back as they are when the request is sent. */
      seen: { price: number; freeCancel: number };
    };

/** The answer of POST /api/app/hosts/[handle]/book: the request that was made, to open its screen. */
export type AppBookSent = { id: string };

/**
 * The answer of GET /api/app/bookings/[id]: one request for a call, for the customer who made it.
 * (The host's side of a request comes with the screens for answering one.)
 */
export type AppBooking = {
  id: string;
  title: string;
  /** The host's page, to look for another time. */
  hostHandle: string | null;
  stage: string;
  /** Where the request stands, in one sentence; and, for one that ended unsent, why. */
  stageWords: string;
  reason: string | null;
  startsAt: string;
  minutes: number;
  price: { label: string; words: string };
  /** While it waits for the host: by when the answer comes. */
  hearBy: string | null;
  /**
   * At the card step: the words about the card and by when it must be entered, and what to say when the
   * card sheet was closed and the request is still not sent (closed without a card, a card that was not
   * saved, a card not confirmed yet). Null at every other stage.
   */
  card: { title: string; words: string; button: string; deadline: AppPart[]; givenUp: string; notSaved: string; notConfirmed: string } | null;
  /** Under a request that waits for the host's answer. */
  waitingWords: string | null;
  /** The label of the button that takes the request back; null when it cannot be taken back. */
  takeBack: string | null;
  /** The call, once there is one, and what else its page is for. */
  call: { id: string; words: string } | null;
  /** While the request can still change by itself: how often the app asks again. */
  refreshSeconds: number | null;
  /** What was just done, in the answer to a step ("Your request was taken back…"); null otherwise. */
  notice: string | null;
};

/** The answer of POST /api/app/bookings/[id]/card: what Stripe's card sheet needs. Nothing is held or charged by it. */
export type AppCardStep = { clientSecret: string; publishableKey: string; merchant: string };

/** The answer of GET /api/app/identity: where the signed-in person's identity check stands. */
export type AppIdentity = {
  passed: boolean;
  /** A check is still being looked at by Stripe. */
  pending: boolean;
  title: string;
  /** What to say, paragraph by paragraph. */
  words: string[];
  /** The label of the button that starts a check; null when none can be started. */
  button: string | null;
  /** "2 of 3 tries left"; null when it does not matter. */
  tries: string | null;
  small: string;
};

/** The answer of POST /api/app/identity/start: Stripe's own page for the check, to open in the browser sheet. */
export type AppIdentityStart = { url: string };

/** The answer of the follow and unfollow addresses: the sentence to show, and how the following stands now. */
export type AppFollowDone = { words: string; follow: "following" | "ended" | "none" };
