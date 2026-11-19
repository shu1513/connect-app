import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  bigserial,
  boolean,
  check,
  customType,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/** Raw bytes, as the database keeps them. Used for the pictures of a diary (plans/24) and for hosts' photos (plans/29). */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

// ---------------------------------------------------------------------------
// Login tables. The shape is dictated by the Better Auth library.
// ---------------------------------------------------------------------------

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  // The fields below are ours, not the login library's. They are written only by
  // our own server code, never taken from what a browser sends.
  /** The person's time zone, for example "America/New_York". */
  timeZone: text("time_zone"),
  /** When they ticked "I am 18 or older". */
  adultConfirmedAt: timestamp("adult_confirmed_at", { withTimezone: true }),
  /** When they accepted the terms, and which version. */
  termsAcceptedAt: timestamp("terms_accepted_at", { withTimezone: true }),
  termsVersion: text("terms_version"),
  /** Set when the founder closes the account. A closed account cannot log in. */
  closedAt: timestamp("closed_at", { withTimezone: true }),
  /** Set when the founder pauses the account: it can log in and look, but not book, host or join calls. */
  pausedAt: timestamp("paused_at", { withTimezone: true }),
  pausedReason: text("paused_reason"),
  /** Kept by the login library: whether this person logs in with a second step (admins must). */
  twoFactorEnabled: boolean("two_factor_enabled").notNull().default(false),
  /** Reminder emails before calls and about requests. Emails about things that happened are always sent. */
  reminderEmails: boolean("reminder_emails").notNull().default(true),
  /** The secret in this person's unsubscribe link. Only ever switches reminders off. */
  unsubscribeToken: text("unsubscribe_token").unique(),
});

/** The login library's own table for the second login step (authenticator app and backup codes). */
export const twoFactor = pgTable("two_factor", {
  id: text("id").primaryKey(),
  secret: text("secret").notNull(),
  backupCodes: text("backup_codes").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  verified: boolean("verified").notNull().default(true),
  failedVerificationCount: integer("failed_verification_count").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** The login library's own counter for slowing down repeated attempts. */
export const rateLimit = pgTable("rate_limit", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: bigint("last_request", { mode: "number" }).notNull(),
});

// ---------------------------------------------------------------------------
// Emails. Every email the app sends is written here first. While developing,
// nothing is really sent: this table is the "sent emails" page.
// ---------------------------------------------------------------------------

export const emailOutbox = pgTable(
  "email_outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    to: text("to").notNull(),
    /** confirm, reset or notice. Each kind has its own hourly or daily allowance per address. */
    kind: text("kind").notNull().default("confirm"),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    /** For emails about an event (a booking was accepted): one key per event, so it is written only once. */
    dedupeKey: text("dedupe_key").unique(),
    /** Extra headers for the sending service, as JSON (the one-click unsubscribe headers on reminders). */
    headers: text("headers"),
    /** queued, sending, sent or failed. */
    status: text("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    /** When the sending service was first asked. A try older than a day whose answer was lost is never repeated blindly. */
    firstTriedAt: timestamp("first_tried_at", { withTimezone: true }),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    /** While a helper is sending it, nobody else touches it until this passes. */
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    /** After this, an unsent email is no longer worth sending (a reminder for a call that has passed). */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    providerId: text("provider_id"),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("email_outbox_to_idx").on(t.to, t.createdAt), index("email_outbox_due_idx").on(t.status, t.nextAttemptAt)],
);

/** Addresses we must not write to again: the sending service told us they bounce or complained. */
export const emailSuppressions = pgTable("email_suppressions", {
  address: text("address").primaryKey(),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Host profiles. One per account. Everything else points to the account, never
// to the handle, so a handle can change without breaking anything.
// ---------------------------------------------------------------------------

export const hostProfiles = pgTable("host_profiles", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id),
  /** The short address: /h/<handle>. Small letters, numbers and underscores. */
  handle: text("handle").notNull().unique(),
  /** The handle without underscores. Unique, so look-alikes cannot sit side by side. */
  handleKey: text("handle_key").notNull().unique(),
  displayName: text("display_name").notNull(),
  about: text("about").notNull().default(""),
  /** Price in US cents per 15 minutes. Zero means free calls. */
  pricePer15Cents: integer("price_per_15_cents").notNull(),
  /** The host's own switch. Hidden profiles cannot be found; booked calls still happen. */
  hidden: boolean("hidden").notNull().default(false),
  /** The founder's decision: pending, approved, declined or suspended. The host cannot change it. */
  status: text("status").notNull().default("pending"),
  decidedBy: text("decided_by").references(() => user.id),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  /** When the host confirmed they are based in the United States. */
  usConfirmedAt: timestamp("us_confirmed_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * A host's claim to a social media account, proven with a code in that account's bio or, for
 * TikTok, by signing in there.
 */
export const socialAccounts = pgTable(
  "social_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    /** instagram, tiktok, youtube or x. */
    network: text("network").notNull(),
    /** The name as the host typed it. */
    nameTyped: text("name_typed").notNull(),
    /** The cleaned-up name: no @, small letters. This is what is compared and shown. */
    nameKey: text("name_key").notNull(),
    /** The link to that account, built by us from the cleaned-up name. */
    url: text("url").notNull(),
    /** The code the host must put in the account's bio. Bound to this host, network and name. */
    code: text("code").notNull(),
    codeExpiresAt: timestamp("code_expires_at", { withTimezone: true }).notNull(),
    /** When the host said the code is in the bio. */
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    confirmedBy: text("confirmed_by").references(() => user.id),
    /**
     * The network's own number for the account, kept as text. Only set when the account was proven
     * by signing in at the network; empty for an account proven with a code. For TikTok it is the
     * number TikTok gives the account for our app, so it only means something with that app's keys.
     */
    providerAccountId: text("provider_account_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("social_accounts_user_network_uq").on(t.userId, t.network),
    // The database itself guarantees one confirmed owner per name per network.
    uniqueIndex("social_accounts_confirmed_uq").on(t.network, t.nameKey).where(sql`${t.confirmedAt} is not null`),
    // And one confirmed owner per account number, so a renamed account cannot be proven for a second host.
    uniqueIndex("social_accounts_provider_uq")
      .on(t.network, t.providerAccountId)
      .where(sql`${t.confirmedAt} is not null and ${t.providerAccountId} is not null`),
  ],
);

// ---------------------------------------------------------------------------
// Safety: blocks, reports, identity checks, the stop switches.
// ---------------------------------------------------------------------------

/** One person has cut off another. Checked wherever contact could start or continue. */
export const blocks = pgTable(
  "blocks",
  {
    blockerId: text("blocker_id")
      .notNull()
      .references(() => user.id),
    blockedId: text("blocked_id")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("blocks_pair_uq").on(t.blockerId, t.blockedId), index("blocks_blocked_idx").on(t.blockedId)],
);

/** A report about a person, made from a profile, a request or a call. */
export const reports = pgTable(
  "reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** A short number the reporter can quote, for example "R-1042". */
    reference: bigserial("reference", { mode: "number" }).notNull().unique(),
    reporterId: text("reporter_id")
      .notNull()
      .references(() => user.id),
    reportedId: text("reported_id")
      .notNull()
      .references(() => user.id),
    /** profile, booking or call. */
    context: text("context").notNull(),
    contextId: text("context_id").notNull(),
    reason: text("reason").notNull(),
    text: text("text").notNull(),
    urgent: boolean("urgent").notNull().default(false),
    /** The profile and request as they were at that moment, as text, so they can be read later even if changed. */
    snapshot: text("snapshot").notNull().default("{}"),
    /** open or closed. */
    status: text("status").notNull().default("open"),
    adminNote: text("admin_note"),
    closedBy: text("closed_by").references(() => user.id),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("reports_status_idx").on(t.status, t.urgent), index("reports_reported_idx").on(t.reportedId)],
);

/**
 * An identity check at Stripe: a photo of an ID and a matching selfie. We keep
 * the outcome, "18 or older", and the name on the ID (for the founder only).
 * Never the date of birth, the ID number or any picture.
 */
export const identityChecks = pgTable(
  "identity_checks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    stripeSessionId: text("stripe_session_id").notNull().unique(),
    /** started, processing, verified, failed or canceled. */
    status: text("status").notNull().default("started"),
    adult: boolean("adult"),
    verifiedName: text("verified_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    checkedAt: timestamp("checked_at", { withTimezone: true }),
  },
  (t) => [index("identity_checks_user_idx").on(t.userId)],
);

/** The founder's emergency switches. One row. */
export const siteSwitches = pgTable("site_switches", {
  id: integer("id").primaryKey(),
  requestsOff: boolean("requests_off").notNull().default(false),
  joiningOff: boolean("joining_off").notNull().default(false),
  /**
   * Memberships: "off", "named" (on for the hosts in membershipsHosts only) or "everyone".
   * Three words and not a yes/no with a list, so that an empty list can never mean "everyone".
   * On for everyone unless the founder says otherwise (the founder's decision, 18 November 2026).
   */
  memberships: text("memberships").notNull().default("everyone"),
  /** The account IDs of the hosts the founder named, separated by commas. Only read when memberships is "named". */
  membershipsHosts: text("memberships_hosts").notNull().default(""),
  /**
   * Projects (a host's diary and the contributions to it): "off", "named" or "everyone", read as the
   * memberships switch is. On for everyone unless the founder says otherwise (plans/23, choice F).
   */
  projects: text("projects").notNull().default("everyone"),
  /** The account IDs of the hosts the founder named for projects, separated by commas. Only read when projects is "named". */
  projectsHosts: text("projects_hosts").notNull().default(""),
  /**
   * The moment the tool against known pictures of child abuse first answered correctly. From then on it
   * counts as switched on, whether or not its settings are still there (plans/24, child-safety.ts).
   */
  childCheckOnAt: timestamp("child_check_on_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Calendar and booking.
// ---------------------------------------------------------------------------

/** A host's calendar choices. */
export const hostCalendars = pgTable("host_calendars", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id),
  /** The time zone the weekly hours are written in, for example "America/New_York". */
  timeZone: text("time_zone").notNull(),
  /** Call lengths offered, in minutes, as a list like "15,30". */
  lengths: text("lengths").notNull().default("30"),
  /** Shortest notice, in hours. */
  noticeHours: integer("notice_hours").notNull().default(24),
  /** How far ahead the host can be booked, in weeks. */
  horizonWeeks: integer("horizon_weeks").notNull().default(4),
  /** Break kept free after each call, in minutes. */
  breakMinutes: integer("break_minutes").notNull().default(5),
  /** "Available now": until when the host takes instant calls, and when their page last said they were there. */
  availableUntil: timestamp("available_until", { withTimezone: true }),
  availableSeenAt: timestamp("available_seen_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** A stretch of a weekday the host is free, in the calendar's time zone. */
export const weeklyHours = pgTable(
  "weekly_hours",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hostId: text("host_id")
      .notNull()
      .references(() => user.id),
    /** 1 = Monday ... 7 = Sunday. */
    weekday: integer("weekday").notNull(),
    /** Minutes from midnight. The end may be 1440 (midnight at the end of the day). */
    startMinute: integer("start_minute").notNull(),
    endMinute: integer("end_minute").notNull(),
    /** Only the host's members can book in this stretch. It counts toward her hours like any other. */
    membersOnly: boolean("members_only").notNull().default(false),
  },
  (t) => [index("weekly_hours_host_idx").on(t.hostId)],
);

/** A stretch of time the host is not available. */
export const timeOff = pgTable(
  "time_off",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hostId: text("host_id")
      .notNull()
      .references(() => user.id),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("time_off_host_idx").on(t.hostId)],
);

/**
 * A request for a call, and what became of it. Stages:
 *   card       the customer is entering a card (paid requests only)
 *   paying     made by a member as the first booking of a month: the month's money is being
 *              taken. Nothing is reserved for either person yet. Never touched by the card step.
 *   waiting    sent; the host has not answered
 *   accepted   it became a call (callId)
 *   declined | passed_over | ran_out | taken_back   it ended without a call
 *   cancelled  it was accepted and the call was later cancelled
 * The price, cancelling rule and break are fixed when the request is made.
 */
export const bookings = pgTable(
  "bookings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hostId: text("host_id")
      .notNull()
      .references(() => user.id),
    customerId: text("customer_id")
      .notNull()
      .references(() => user.id),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    lengthMinutes: integer("length_minutes").notNull(),
    breakMinutes: integer("break_minutes").notNull(),
    pricePer15Cents: integer("price_per_15_cents").notNull(),
    totalCents: integer("total_cents").notNull(),
    freeCancelMinutes: integer("free_cancel_minutes").notNull(),
    /** What the customer wants to talk about. Only the host sees it. */
    note: text("note").notNull().default(""),
    stage: text("stage").notNull(),
    /** "customer" for a booked request; "now" for an instant call while the host is available; "admin" for a call made by a check script (once also by a test page, now removed). */
    source: text("source").notNull().default("customer"),
    /** One key per press of the button, so a double click makes one request. */
    requestKey: text("request_key").notNull().unique(),
    /** When it was sent to the host. */
    requestedAt: timestamp("requested_at", { withTimezone: true }),
    /** The host must answer before this. */
    respondBy: timestamp("respond_by", { withTimezone: true }),
    /** Paid bookings: the money must be held before this, or the booking is cancelled for free. */
    payBy: timestamp("pay_by", { withTimezone: true }),
    /** What the customer agreed to about their card, and when. */
    cardConsentVersion: text("card_consent_version"),
    cardConsentAt: timestamp("card_consent_at", { withTimezone: true }),
    stripeSetupIntentId: text("stripe_setup_intent_id"),
    /** The saved card. Removed from Stripe, and cleared here, when it is no longer needed. */
    stripePaymentMethodId: text("stripe_payment_method_id"),
    /** For a booking made as a member (source "member"): the membership month its time comes from. */
    monthId: uuid("month_id").references((): AnyPgColumn => membershipMonths.id),
    callId: uuid("call_id")
      .unique()
      .references(() => calls.id),
    /** When the "you have new requests" email covering this request was written. */
    hostNotifiedAt: timestamp("host_notified_at", { withTimezone: true }),
    /** The one automatic try to hold the money on the saved card. */
    holdTriedAt: timestamp("hold_tried_at", { withTimezone: true }),
    holdFailedAt: timestamp("hold_failed_at", { withTimezone: true }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    /** How it ended, for stages that end it: who or what, in a few words. */
    endedReason: text("ended_reason"),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("bookings_host_idx").on(t.hostId, t.stage),
    index("bookings_customer_idx").on(t.customerId, t.stage),
    index("bookings_stage_idx").on(t.stage),
  ],
);

/**
 * "This person is taken for this stretch of time." A customer has one for each
 * request they are waiting on or call they have; a host has one for each call
 * they accepted (the call plus the break after it).
 *
 * The database refuses two overlapping entries for the same person. That rule
 * is not visible here: it is an exclusion constraint added by hand in the
 * migration, because this library cannot describe one.
 */
export const busyEntries = pgTable(
  "busy_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex("busy_entries_booking_user_uq").on(t.bookingId, t.userId)],
);

// ---------------------------------------------------------------------------
// Calls. Host and customer are roles on the call, not on the account.
// All times are stored in UTC.
// ---------------------------------------------------------------------------

export const calls = pgTable(
  "calls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hostId: text("host_id")
      .notNull()
      .references(() => user.id),
    customerId: text("customer_id")
      .notNull()
      .references(() => user.id),
    /** Start of the booked window. Only time from here counts. */
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    /** End of the booked window. Time after this does not count. */
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    /** The room's name at the video service. Unique per call, never reused. */
    roomName: text("room_name").notNull().unique(),
    /** Set once the room has been confirmed empty after closing time. */
    closedAt: timestamp("closed_at", { withTimezone: true }),
    /** Set when someone pressed "End call and report": the call ended for both at that moment. */
    safetyEndedAt: timestamp("safety_ended_at", { withTimezone: true }),
    safetyEndedBy: text("safety_ended_by"),
    /** Price in cents per 15 minutes. Zero means a free call with no payment. */
    pricePer15Cents: integer("price_per_15_cents").notNull().default(0),
    /** What time is paid for: "host" (the host's time in the room, booked calls) or "together" (time both were in, instant calls). Fixed at creation. */
    billing: text("billing").notNull().default("host"),
    /** The host's cancelling rule when the call was created: minutes before the start that cancelling is free. */
    freeCancelMinutes: integer("free_cancel_minutes").notNull().default(0),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    /** "host" or "customer". */
    cancelledBy: text("cancelled_by"),
    /** True when the customer cancelled after the free period, so the booked price is charged. */
    cancelledLate: boolean("cancelled_late").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("calls_host_idx").on(t.hostId), index("calls_customer_idx").on(t.customerId)],
);

/**
 * One request for more time during a call: the customer asks, the host answers.
 * Where it stands:
 *   open      asked; for a paid call the host sees it once its money is held
 *   accepted  the host said yes and the call's end moved to newEndsAt
 *   declined | ran_out | failed   it ended without adding time
 * A request changes state only with its call locked, and a request that has
 * ended can never become accepted. A paid request has a payment of its own
 * (payments.extensionId), which only an accepted request can ever be charged on.
 */
export const callExtensions = pgTable(
  "call_extensions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    callId: uuid("call_id")
      .notNull()
      .references(() => calls.id),
    minutes: integer("minutes").notNull(),
    /** The call's end when the request was made. Accepting needs it to be unchanged. */
    oldEndsAt: timestamp("old_ends_at", { withTimezone: true }).notNull(),
    newEndsAt: timestamp("new_ends_at", { withTimezone: true }).notNull(),
    /** The price of the extra minutes, at the call's own price. Zero for a free call. */
    priceCents: integer("price_cents").notNull(),
    /** open, accepted, declined, ran_out or failed. */
    status: text("status").notNull().default("open"),
    /** How the added time is paid: by "card", or from the member's "membership" time. Once set it never changes. */
    paidFrom: text("paid_from").notNull().default("card"),
    /** How it ended when it was not accepted, in a few words. */
    endedReason: text("ended_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (t) => [
    index("call_extensions_call_idx").on(t.callId),
    // One open request per call at a time.
    uniqueIndex("call_extensions_one_open_uq").on(t.callId).where(sql`${t.status} = 'open'`),
  ],
);

// ---------------------------------------------------------------------------
// After a call: ratings, and a host's private notes about a customer.
// ---------------------------------------------------------------------------

/**
 * One person's rating of the other after a call. Nobody is ever shown the
 * rating one particular person gave them; only averages are shown (see
 * src/lib/ratings/rules.ts for when a rating counts and what an average shows).
 */
export const ratings = pgTable(
  "ratings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    callId: uuid("call_id")
      .notNull()
      .references(() => calls.id),
    /** Who gave it. */
    raterId: text("rater_id")
      .notNull()
      .references(() => user.id),
    /** Who received it, and in which role on that call: "host" or "customer". */
    ratedId: text("rated_id")
      .notNull()
      .references(() => user.id),
    ratedAs: text("rated_as").notNull(),
    /** 1 to 5. */
    stars: integer("stars").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One rating per person per call. The database guarantees it; the first one stands.
    uniqueIndex("ratings_call_rater_uq").on(t.callId, t.raterId),
    index("ratings_rated_idx").on(t.ratedId, t.ratedAs),
    check("ratings_stars_range", sql`${t.stars} between 1 and 5`),
    check("ratings_rated_as", sql`${t.ratedAs} in ('host', 'customer')`),
  ],
);

/** A host's private note about one customer. Only that host can ever read it. */
export const hostNotes = pgTable(
  "host_notes",
  {
    hostId: text("host_id")
      .notNull()
      .references(() => user.id),
    customerId: text("customer_id")
      .notNull()
      .references(() => user.id),
    text: text("text").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.hostId, t.customerId] })],
);

// ---------------------------------------------------------------------------
// Attendance log. One row per message from the video service, saved exactly
// as received. Rows are never edited.
// ---------------------------------------------------------------------------

export const attendanceEvents = pgTable(
  "attendance_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    provider: text("provider").notNull(),
    /** The video service's own ID for this message. Used to ignore repeats. */
    providerEventId: text("provider_event_id").notNull(),
    callId: uuid("call_id")
      .notNull()
      .references(() => calls.id),
    /** The video service's event name, e.g. "participant_joined". */
    type: text("type").notNull(),
    roomSessionId: text("room_session_id"),
    /** Who the message is about. We issue entry passes with identity = account ID. */
    participantIdentity: text("participant_identity"),
    /** One connection of one person. A rejoin gets a new one. */
    participantSessionId: text("participant_session_id"),
    /** The video service's time on the message. This is what we count with. */
    providerTime: timestamp("provider_time", { withTimezone: true }).notNull(),
    /** When our server received it. Never used for counting. */
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    /** The message body, character for character as it arrived. */
    payload: text("payload").notNull(),
  },
  (t) => [
    uniqueIndex("attendance_events_provider_event_uq").on(t.provider, t.providerEventId),
    index("attendance_events_call_idx").on(t.callId),
  ],
);

// ---------------------------------------------------------------------------
// Payments. All money is in whole cents.
// ---------------------------------------------------------------------------

/** A customer's ID at Stripe. We never store card numbers. */
export const stripeCustomers = pgTable("stripe_customers", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id),
  stripeCustomerId: text("stripe_customer_id").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** A host's payout account at Stripe, and their own settings. */
export const hostSettings = pgTable("host_settings", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id),
  stripeAccountId: text("stripe_account_id").unique(),
  /** Whether Stripe says this account can receive money. Refreshed from Stripe, never assumed. */
  payoutsReady: boolean("payouts_ready").notNull().default(false),
  payoutsCheckedAt: timestamp("payouts_checked_at", { withTimezone: true }),
  /** The host's cancelling rule: minutes before the start that cancelling is free. */
  freeCancelMinutes: integer("free_cancel_minutes").notNull().default(0),
  /** The host's own switch: only people who have passed the identity check can send a new request. */
  verifiedOnly: boolean("verified_only").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** People allowed to use the admin page. */
export const admins = pgTable("admins", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id),
  /** When this admin set up their second login step. Only logins made after this count as admin logins. */
  securedAt: timestamp("secured_at", { withTimezone: true }),
});

/** Every action an admin takes, written down. Rows are only ever added. */
export const adminActions = pgTable(
  "admin_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    adminId: text("admin_id")
      .notNull()
      .references(() => user.id),
    /** What was done, in a few words, for example "profile approved" or "account paused". */
    action: text("action").notNull(),
    /** Whom it was done to, when it was done to a person. */
    targetUserId: text("target_user_id").references(() => user.id),
    /** What it was done to otherwise (a payment, a report, a social account). */
    targetId: text("target_id"),
    detail: text("detail").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("admin_actions_target_idx").on(t.targetUserId), index("admin_actions_time_idx").on(t.createdAt)],
);

/**
 * One record per paid call (the call's own payment), and one more for each
 * paid request for more time on that call. Every payment is held, charged,
 * refunded and paid out on its own, for its own stretch of the call.
 *
 * Code that means "the payment of this call" must say "extensionId is null"
 * (see ownPaymentOn in src/lib/payments/own.ts). The database refuses a second
 * own payment for a call.
 *
 * Every payment has a kind:
 *   card            a payment with its own hold and charge at Stripe (every payment before memberships)
 *   member_call     a part of a membership's month, set aside for one call, then used or given back
 *   member_expired  the part of a month that expired unused; it has no call
 * A payment that is not "card" never has a PaymentIntent of its own and must never reach the code
 * that holds, charges or refunds a card (see cardPayment in src/lib/payments/own.ts).
 */
export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The call this payment is for. A "member_expired" payment and a "contribution" share have none. */
    callId: uuid("call_id").references(() => calls.id),
    /** card, member_call, member_expired or contribution. */
    kind: text("kind").notNull().default("card"),
    /** For a "contribution" share: the contribution's payment the money came from, which owns everything at Stripe. */
    contributionPaymentId: uuid("contribution_payment_id").references((): AnyPgColumn => contributionPayments.id),
    /** The membership month this money belongs to. Null for a card payment. */
    monthId: uuid("month_id").references((): AnyPgColumn => membershipMonths.id),
    /** For a member_call payment: how much of the amount set aside was money that had come back because of the host. */
    hostCausedCents: integer("host_caused_cents").notNull().default(0),
    /** Null for the call's own payment. Otherwise the request for more time this payment is for. */
    extensionId: uuid("extension_id")
      .unique()
      .references(() => callExtensions.id),
    /** The stretch of the call this payment pays for. Only time that counted inside it is charged. */
    coversFrom: timestamp("covers_from", { withTimezone: true }).notNull(),
    coversUntil: timestamp("covers_until", { withTimezone: true }).notNull(),

    // Terms fixed when the call was created. Later changes to settings never reprice it.
    currency: text("currency").notNull().default("usd"),
    pricePer15Cents: integer("price_per_15_cents").notNull(),
    bookedCents: integer("booked_cents").notNull(),
    feePercentBps: integer("fee_percent_bps").notNull(),
    feeFixedCents: integer("fee_fixed_cents").notNull(),
    feeForeignCardBps: integer("fee_foreign_card_bps").notNull(),

    /** awaiting_payment, held, charged or closed_uncharged. */
    status: text("status").notNull().default("awaiting_payment"),
    /** Blocks the automatic charge until the founder decides. */
    needsReview: boolean("needs_review").notNull().default(false),
    reviewReason: text("review_reason"),
    /** Set if the attendance record changed after the charge. The charge itself is never changed. */
    flaggedAfterCharge: boolean("flagged_after_charge").notNull().default(false),

    stripePaymentIntentId: text("stripe_payment_intent_id").unique(),
    stripeChargeId: text("stripe_charge_id"),
    heldAt: timestamp("held_at", { withTimezone: true }),
    holdExpiresAt: timestamp("hold_expires_at", { withTimezone: true }),
    /** Two-letter country of the card, from Stripe. Decides the foreign-card fee. */
    cardCountry: text("card_country"),

    // The time totals the charge was worked out from, frozen at that moment.
    frozenHostSeconds: integer("frozen_host_seconds"),
    frozenCustomerSeconds: integer("frozen_customer_seconds"),
    frozenTogetherSeconds: integer("frozen_together_seconds"),
    /** The last attendance message that was known when the charge was worked out. Later ones mean the record changed. */
    pricedThroughEventId: bigint("priced_through_event_id", { mode: "number" }),

    chargedCents: integer("charged_cents"),
    /** attendance, late_cancel or admin. */
    chargeReason: text("charge_reason"),
    chargedAt: timestamp("charged_at", { withTimezone: true }),
    /** The split at the moment of the charge. */
    originalFeeCents: integer("original_fee_cents"),
    originalHostShareCents: integer("original_host_share_cents"),
    /** Total successfully refunded so far. */
    refundedCents: integer("refunded_cents").notNull().default(0),
    /**
     * Set when the charge was lowered, or dropped, by an answer to a refund request before the money
     * was taken: what the call's record gave at that moment, and who lowered it ("host" or "admin").
     */
    recordCents: integer("record_cents"),
    loweredBy: text("lowered_by"),
    /** True while the customer's bank is disputing the charge. Blocks refunds and the host's payout. */
    disputeOpen: boolean("dispute_open").notNull().default(false),

    /** not_due, due, sent or not_owed. */
    transferStatus: text("transfer_status").notNull().default("not_due"),
    /**
     * From when the host can collect this share. Set when the charge is recorded. It can move later (a
     * refund request on a call; the 30 days of a contribution), and for a contribution's share it can
     * move sooner when the founder releases it.
     */
    transferDueAt: timestamp("transfer_due_at", { withTimezone: true }),
    /** What was actually sent to the host for this call. */
    transferCents: integer("transfer_cents"),
    /** The 25-cent collection charge, if this share was the one that carried it. */
    payoutFeeCents: integer("payout_fee_cents"),
    stripeTransferId: text("stripe_transfer_id"),
    transferredAt: timestamp("transferred_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("payments_status_idx").on(t.status),
    index("payments_transfer_idx").on(t.transferStatus),
    index("payments_call_idx").on(t.callId),
    index("payments_month_idx").on(t.monthId),
    // One own payment per call.
    uniqueIndex("payments_own_call_uq").on(t.callId).where(sql`${t.extensionId} is null`),
    // One "expired time" payment per month.
    uniqueIndex("payments_expired_month_uq").on(t.monthId).where(sql`${t.kind} = 'member_expired'`),
    // One share line at most for each contribution's payment.
    uniqueIndex("payments_contribution_payment_uq").on(t.contributionPaymentId).where(sql`${t.contributionPaymentId} is not null`),
    check(
      "payments_kind_shape",
      sql`(${t.kind} = 'card' and ${t.callId} is not null and ${t.monthId} is null and ${t.contributionPaymentId} is null)
        or (${t.kind} = 'member_call' and ${t.callId} is not null and ${t.monthId} is not null and ${t.contributionPaymentId} is null)
        or (${t.kind} = 'member_expired' and ${t.callId} is null and ${t.monthId} is not null and ${t.contributionPaymentId} is null)
        or (${t.kind} = 'contribution' and ${t.callId} is null and ${t.monthId} is null and ${t.extensionId} is null and ${t.contributionPaymentId} is not null
          and ${t.stripePaymentIntentId} is null and ${t.pricePer15Cents} = 0 and ${t.coversFrom} = ${t.coversUntil}
          and ${t.status} = 'charged' and ${t.chargedCents} is not null and ${t.chargedCents} = ${t.bookedCents} and ${t.chargedAt} is not null
          and ${t.coversFrom} = ${t.chargedAt} and ${t.originalFeeCents} is not null and ${t.originalHostShareCents} is not null
          and ${t.originalFeeCents} + ${t.originalHostShareCents} = ${t.chargedCents} and ${t.stripeChargeId} is not null)`,
    ),
    check("payments_host_caused_range", sql`${t.hostCausedCents} >= 0`),
  ],
);

/** Each refund is its own record. */
export const refunds = pgTable(
  "refunds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    paymentId: uuid("payment_id")
      .notNull()
      .references(() => payments.id),
    amountCents: integer("amount_cents").notNull(),
    decidedBy: text("decided_by")
      .notNull()
      .references(() => user.id),
    /** host or admin. */
    decidedAs: text("decided_as").notNull(),
    reason: text("reason"),
    /** in_progress, done or failed. */
    status: text("status").notNull().default("in_progress"),
    stripeRefundId: text("stripe_refund_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("refunds_payment_idx").on(t.paymentId)],
);

/**
 * What we are about to ask Stripe to do, written down before we ask.
 * The label is unique, and Stripe refuses to repeat an action under the same label.
 */
export const moneyOperations = pgTable(
  "money_operations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The owner is a payment, a membership month or a contribution's payment: exactly one of the three. */
    paymentId: uuid("payment_id").references(() => payments.id),
    monthId: uuid("month_id").references((): AnyPgColumn => membershipMonths.id),
    contributionPaymentId: uuid("contribution_payment_id").references((): AnyPgColumn => contributionPayments.id),
    /** hold, capture, release, refund or transfer. */
    kind: text("kind").notNull(),
    /** The fixed label for this action. Sent to Stripe as the idempotency key. */
    label: text("label").notNull().unique(),
    /** The exact parameters, so a retry sends the same request. */
    params: text("params").notNull(),
    /** started, succeeded or failed. A "started" row means the outcome is not known yet. */
    status: text("status").notNull().default("started"),
    stripeId: text("stripe_id"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    index("money_operations_payment_idx").on(t.paymentId),
    index("money_operations_month_idx").on(t.monthId),
    index("money_operations_status_idx").on(t.status),
    index("money_operations_contribution_payment_idx").on(t.contributionPaymentId),
    check("money_operations_one_owner", sql`num_nonnulls(${t.paymentId}, ${t.monthId}, ${t.contributionPaymentId}) = 1`),
    // One action in flight per owner. The code checks it under the owner's lock; this is the database's own word.
    uniqueIndex("money_operations_payment_started_uq").on(t.paymentId).where(sql`${t.status} = 'started' and ${t.paymentId} is not null`),
    uniqueIndex("money_operations_month_started_uq").on(t.monthId).where(sql`${t.status} = 'started' and ${t.monthId} is not null`),
    uniqueIndex("money_operations_contribution_payment_started_uq").on(t.contributionPaymentId).where(sql`${t.status} = 'started' and ${t.contributionPaymentId} is not null`),
  ],
);

/**
 * History only. While hosts were paid on a weekly payday, the 25-cent charge
 * was taken once per host per payday, and this row was what "once" meant.
 * Nothing reads or writes it any more: the charge is recorded per collection.
 */
export const payoutFees = pgTable(
  "payout_fees",
  {
    hostId: text("host_id")
      .notNull()
      .references(() => user.id),
    /** The weekly payday the share was due on (not the day it happened to be sent). */
    payday: timestamp("payday", { withTimezone: true }).notNull(),
    paymentId: uuid("payment_id")
      .notNull()
      .references(() => payments.id),
  },
  (t) => [uniqueIndex("payout_fees_host_payday_uq").on(t.hostId, t.payday)],
);

/**
 * One accepted press of "Collect earnings". It is written, together with every
 * transfer it will make, in one locked step before Stripe is asked anything.
 */
export const collections = pgTable(
  "collections",
  {
    /** Made when the button is shown, so the same press arriving twice is one collection. */
    id: uuid("id").primaryKey(),
    hostId: text("host_id")
      .notNull()
      .references(() => user.id),
    /** Who pressed: the host, or the founder for a host who can no longer log in. */
    startedBy: text("started_by")
      .notNull()
      .references(() => user.id),
    /** The host's 24 hours until the next collection are counted from here. */
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("collections_host_idx").on(t.hostId, t.acceptedAt)],
);

/**
 * The shares one collection took. Each has its transfer written down as a
 * money action; that action's outcome is the outcome of the share.
 */
export const collectionItems = pgTable(
  "collection_items",
  {
    collectionId: uuid("collection_id")
      .notNull()
      .references(() => collections.id),
    paymentId: uuid("payment_id")
      .notNull()
      .references(() => payments.id),
    operationId: uuid("operation_id")
      .notNull()
      .unique()
      .references(() => moneyOperations.id),
    /** What is sent to the host for this share. */
    amountCents: integer("amount_cents").notNull(),
    /** The collection charge taken from this share: all of it for one share of the collection, 0 for the others. */
    payoutFeeCents: integer("payout_fee_cents").notNull(),
  },
  (t) => [primaryKey({ columns: [t.collectionId, t.paymentId] }), index("collection_items_payment_idx").on(t.paymentId)],
);

/**
 * A customer's request for a refund: one per call, asked within 24 hours of
 * its start. The host answers (or the founder in the host's place).
 *
 * Where it stands (status):
 *   asked     waiting for an answer
 *   answered  answered before the money was taken; the answer for each charge is in refund_request_answers
 *   declined  the host said no after the money had been taken
 *   closed    closed by the founder
 * A refund made after the money was taken is not stored here: it is read from
 * the refund records. A request also counts as answered once a refund of that
 * call, started after the request, has gone through.
 */
export const refundRequests = pgTable("refund_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  callId: uuid("call_id")
    .notNull()
    .unique()
    .references(() => calls.id),
  customerId: text("customer_id")
    .notNull()
    .references(() => user.id),
  /** "connection" (the connection was bad) or "other". */
  reason: text("reason").notNull(),
  /** The customer's sentence about what went wrong. Shown to the host and the founder. */
  note: text("note").notNull().default(""),
  /**
   * The short summary of the call's quality record as it stood when the request was made (JSON).
   * For "connection" it is exactly what the customer confirmed. Kept for one year.
   */
  summary: text("summary"),
  askedAt: timestamp("asked_at", { withTimezone: true }).notNull(),
  status: text("status").notNull().default("asked"),
  decidedBy: text("decided_by").references(() => user.id),
  /** "host" or "admin". */
  decidedAs: text("decided_as"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  /** The message to the customer that came with the answer. */
  message: text("message"),
});

/** The answer for one charge of a call, given before its money was taken. The amount itself is worked out from the call's record when the money is taken. */
export const refundRequestAnswers = pgTable(
  "refund_request_answers",
  {
    requestId: uuid("request_id")
      .notNull()
      .references(() => refundRequests.id),
    paymentId: uuid("payment_id")
      .notNull()
      .references(() => payments.id),
    /** "full" (what the record gives), "less" (at most maxCents) or "nothing". */
    choice: text("choice").notNull(),
    maxCents: integer("max_cents"),
  },
  (t) => [primaryKey({ columns: [t.requestId, t.paymentId] })],
);

/**
 * What each person's browser reported about the two connections during a call:
 * the video service's own grade (excellent, good, poor, lost), noted when the
 * person joined, at every change, and about twice a minute in between.
 *
 * It is a record of what a browser said, never proof: a person can alter or
 * hold back what their own browser sends. Removed 60 days after the call.
 */
export const qualityNotes = pgTable(
  "quality_notes",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    callId: uuid("call_id")
      .notNull()
      .references(() => calls.id),
    /** Whose browser sent this note. */
    reporterId: text("reporter_id")
      .notNull()
      .references(() => user.id),
    /** Whose connection it is about: the host or the customer of the call, worked out on the server. */
    aboutId: text("about_id")
      .notNull()
      .references(() => user.id),
    /** excellent, good, poor, lost or unknown. */
    grade: text("grade").notNull(),
    /** One connection of the reporter to the room. A rejoin gets a new one. */
    connectionId: text("connection_id").notNull(),
    /** The note's number in order within that connection, so late or repeated notes are put right. */
    seq: integer("seq").notNull(),
    /** When the browser saw it, on the server's clock (which the call screen follows). */
    seenAt: timestamp("seen_at", { withTimezone: true }).notNull(),
    /** When it arrived here. */
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("quality_notes_once_uq").on(t.callId, t.reporterId, t.connectionId, t.seq)],
);

/**
 * Connection checks. One row each time someone starts the short "test your connection" check.
 * It holds no result: the answer never leaves the person's browser. The rows exist only so that
 * tests can be limited per person, and so that the helper can close a test room left open.
 */
export const connectionTests = pgTable(
  "connection_tests",
  {
    /** The test's own number. Its room at the video service is "check-<id>"; it is never a call's room. */
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    /** Set once the helper has confirmed the test room is gone. */
    roomClosedAt: timestamp("room_closed_at", { withTimezone: true }),
  },
  (t) => [index("connection_tests_user_idx").on(t.userId, t.startedAt), index("connection_tests_open_idx").on(t.roomClosedAt, t.startedAt)],
);

/**
 * One row each time Connect itself looks at an account's bio for a host's proof code. Used for the
 * limits (per person, and for all of Instagram together) and for the founder's warning when a
 * network does not accept our key. The bio's text is never stored.
 */
export const bioChecks = pgTable(
  "bio_checks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    /**
     * instagram or youtube for a look at a bio. Also "tiktok" and "instagram_sign_in": a sign-in at that
     * network that our own keys or set-up made fail (result "refused"), and "instagram_photo": a request for
     * a host's photo that Meta refused for the same reason (plans/29). Kept here for the founder's warning.
     * Those three names are never counted by the bio check's limits.
     */
    network: text("network").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    /** Empty while the check is under way. Then: found, not_found, no_account, too_often, refused or unavailable. */
    result: text("result"),
  },
  (t) => [index("bio_checks_user_idx").on(t.userId, t.startedAt), index("bio_checks_network_idx").on(t.network, t.startedAt)],
);

/**
 * A host's photo: Connect's own copy of the profile picture of a social media account the host
 * has confirmed (plans/29). One line for each photo. A host has at most one that is not locked;
 * a new photo is a new line with a new id, so an old address stops working.
 *
 * A locked photo ("Remove and report") is kept exactly as it is and never deleted: not by the
 * host, not when its account is removed or replaced, not when the host's account is closed.
 *
 * The bytes are in this line. Every list names the columns it reads and leaves `bytes` out; only
 * `photoFor` (src/lib/profiles/photo.ts) reads them.
 */
export const hostPhotos = pgTable(
  "host_photos",
  {
    /** Used in the photo's address: /host-photos/<id>. */
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    /** instagram or tiktok. */
    network: text("network").notNull(),
    /** The account's name and the network's own number for it, as they were in the answer that gave the picture. */
    sourceNameKey: text("source_name_key").notNull(),
    sourceAccountId: text("source_account_id").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    byteLength: integer("byte_length").notNull(),
    /** A fingerprint of the exact bytes of Connect's copy. */
    sha256: text("sha256").notNull(),
    bytes: bytea("bytes").notNull(),
    takenAt: timestamp("taken_at", { withTimezone: true }).notNull(),
    /** The outside service whose full check passed it, and the version of the rules it was judged by. */
    checkedBy: text("checked_by").notNull(),
    rulesVersion: text("rules_version").notNull(),
    checkDetail: text("check_detail"),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedBy: text("locked_by").references(() => user.id),
    /** When the report to the authorities was really made, as the founder says. */
    reportMadeAt: timestamp("report_made_at", { withTimezone: true }),
    /** The host's profile and confirmed accounts as they were at the moment of locking, as text. The host can change them afterwards; this stays. */
    lockedContext: text("locked_context"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // The database itself guarantees one photo that is not locked for each host.
    uniqueIndex("host_photos_current_uq").on(t.userId).where(sql`${t.lockedAt} is null`),
    index("host_photos_user_idx").on(t.userId),
    check("host_photos_network", sql`${t.network} in ('instagram', 'tiktok')`),
  ],
);

/**
 * One line for each try at taking a host's photo (plans/29). Used for the limit of tries, for
 * "one at a time", for stopping a try that is under way, and to remember the fingerprint of a
 * copy a checking service refused. The picture of a try is never kept here.
 *
 * `result` is empty while the try runs. Then one of:
 *   shown           the photo passed and is the host's photo now
 *   not_accepted    a checking service flagged it (the fingerprint stays, so it is refused again)
 *   refused_before  the same copy as one that was refused before; no service was asked
 *   no_picture      the network showed no such account, no picture, or another account under that name
 *   not_fetched     the network or its picture server could not be asked, or did not answer usably
 *   unusable        the file was not a picture Connect can use (too small, moving, not a picture)
 *   not_checked     no checking service could answer
 *   stopped         something was decided meanwhile (removed, account changed or closed), or it never ended
 */
export const hostPhotoTries = pgTable(
  "host_photo_tries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    network: text("network").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    /** The host's confirmed entry on that network as it was when the try started. The number is empty for an entry proven with the code. */
    entryNameKey: text("entry_name_key").notNull(),
    entryAccountId: text("entry_account_id"),
    result: text("result"),
    /** The fingerprint of Connect's copy, once one was made. */
    sha256: text("sha256"),
    /** The service that answered, and what it said, as text. */
    checkedBy: text("checked_by"),
    detail: text("detail"),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (t) => [
    index("host_photo_tries_user_idx").on(t.userId, t.startedAt),
    index("host_photo_tries_bytes_idx").on(t.userId, t.sha256),
    index("host_photo_tries_network_idx").on(t.network, t.startedAt),
    check("host_photo_tries_network", sql`${t.network} in ('instagram', 'tiktok')`),
    check(
      "host_photo_tries_result",
      sql`${t.result} is null or ${t.result} in ('shown', 'not_accepted', 'refused_before', 'no_picture', 'not_fetched', 'unusable', 'not_checked', 'stopped')`,
    ),
  ],
);

/**
 * When the always-on helper last finished a round of each kind of work.
 * The health address reads this to say whether the helper is alive.
 */
export const helperBeats = pgTable("helper_beats", {
  /** "payments": one full round of the payment work. */
  name: text("name").primaryKey(),
  at: timestamp("at", { withTimezone: true }).notNull(),
});

/** The money record. Only ever added to: a correction is a new line, never an edit. */
export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    /** The owner is a payment, a membership month or a contribution's payment: exactly one of the three. */
    paymentId: uuid("payment_id").references(() => payments.id),
    monthId: uuid("month_id").references((): AnyPgColumn => membershipMonths.id),
    contributionPaymentId: uuid("contribution_payment_id").references((): AnyPgColumn => contributionPayments.id),
    /** customer_charge, customer_refund, platform_fee, host_share, host_transfer, payout_fee, hold_released, connect_cost. */
    kind: text("kind").notNull(),
    /** Positive adds, negative takes away. */
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default("usd"),
    stripeRef: text("stripe_ref"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ledger_entries_payment_idx").on(t.paymentId),
    index("ledger_entries_month_idx").on(t.monthId),
    index("ledger_entries_contribution_payment_idx").on(t.contributionPaymentId),
    check("ledger_entries_one_owner", sql`num_nonnulls(${t.paymentId}, ${t.monthId}, ${t.contributionPaymentId}) = 1`),
  ],
);

/** Messages from Stripe, saved as received. The ID is Stripe's own, so repeats are ignored. */
export const stripeEvents = pgTable("stripe_events", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  payload: text("payload").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  /** Null until we have finished handling it. */
  processedAt: timestamp("processed_at", { withTimezone: true }),
});

// ---------------------------------------------------------------------------
// Memberships (plans/19-memberships.md is the rulebook; plans/20 says how this part is built).
// A member pays a host a monthly amount that is talk time with that host.
// ---------------------------------------------------------------------------

/** The one membership a host offers. */
export const membershipOffers = pgTable(
  "membership_offers",
  {
    hostId: text("host_id")
      .primaryKey()
      .references(() => user.id),
    on: boolean("on").notNull().default(false),
    /** The member price in cents per 15 minutes. Never above the host's regular price. */
    pricePer15Cents: integer("price_per_15_cents").notNull(),
    /** The time included each month. */
    includedMinutes: integer("included_minutes").notNull(),
    /** Goes up with every change. An invitation and an agreement say which version they were for. */
    version: integer("version").notNull().default(1),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("membership_offers_price", sql`${t.pricePer15Cents} >= 500`),
    check("membership_offers_minutes", sql`${t.includedMinutes} between 30 and 6000 and ${t.includedMinutes} % 30 = 0`),
  ],
);

/**
 * One host and one customer. Where it stands (status):
 *   invited   the host has invited this person; nothing is paid
 *   joining   the person pressed "Join" or "Resume" and is at the card step
 *   active    a month is held or running
 *   unpaid    the month's payment failed and is being tried again; no member time
 *   paused    no month and no payment; the member can resume without a new invitation
 *   ended     over for good; coming back needs a new invitation, which makes a new row
 *
 * "The renewal is stopped" is not a status: it is memberStoppedAt (the member cancelled),
 * hostStoppedAt (the host paused them after this month) and offerStoppedAt (the host switched her
 * membership off during the month), three separate marks. The host clears only her own; the
 * member's "Keep my membership" clears the other two.
 *
 * period and currentMonthId keep old work away from a resumed membership: period goes up at every
 * joining and resuming, and only the month in currentMonthId may change the membership's state.
 * An older month still settles its own money. The one exception is a bank dispute, which ends the
 * pair's live membership whichever month it is about.
 */
export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hostId: text("host_id")
      .notNull()
      .references(() => user.id),
    customerId: text("customer_id")
      .notNull()
      .references(() => user.id),
    status: text("status").notNull(),
    period: integer("period").notNull().default(0),
    /** The one month that may change this membership's state. No foreign key: months point here already. */
    currentMonthId: uuid("current_month_id"),
    /** The last joining or resuming. "Who has been there longest" counts from here. */
    since: timestamp("since", { withTimezone: true }),
    /** The member's own price and time for the next month that is written down. The price only ever goes down. */
    ownPricePer15Cents: integer("own_price_per_15_cents"),
    ownMinutes: integer("own_minutes"),
    /** The agreement that applies now (membership_agreements). No foreign key: agreements point here already. */
    agreementId: uuid("agreement_id"),
    memberStoppedAt: timestamp("member_stopped_at", { withTimezone: true }),
    hostStoppedAt: timestamp("host_stopped_at", { withTimezone: true }),
    /**
     * The host switched her membership off while this member's month was running: the renewal is
     * stopped. A mark of its own, so it is never mistaken for the member's own cancelling or the
     * host's pause. Only the member takes it back ("Keep my membership", once the membership is on again).
     */
    offerStoppedAt: timestamp("offer_stopped_at", { withTimezone: true }),
    pausedAt: timestamp("paused_at", { withTimezone: true }),
    pausedReason: text("paused_reason"),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    /** host, admin, or the account ID of whoever caused it. */
    endedBy: text("ended_by"),
    endedReason: text("ended_reason"),
    /** Set once the clean-up after an ending is finished: open payment cancelled, free money owed back, upcoming member calls cancelled. */
    cleanupDoneAt: timestamp("cleanup_done_at", { withTimezone: true }),
    // The open invitation.
    inviteId: uuid("invite_id"),
    invitedAt: timestamp("invited_at", { withTimezone: true }),
    inviteExpiresAt: timestamp("invite_expires_at", { withTimezone: true }),
    inviteOfferVersion: integer("invite_offer_version"),
    inviteMinutes: integer("invite_minutes"),
    // The open offer of less time.
    offerId: uuid("offer_id"),
    offerMonthId: uuid("offer_month_id"),
    offeredMinutes: integer("offered_minutes"),
    offeredAt: timestamp("offered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One live membership per host and customer. A new invitation after an ending makes a new row.
    uniqueIndex("memberships_live_pair_uq").on(t.hostId, t.customerId).where(sql`${t.status} <> 'ended'`),
    index("memberships_customer_idx").on(t.customerId),
    index("memberships_host_status_idx").on(t.hostId, t.status),
    check("memberships_status", sql`${t.status} in ('invited', 'joining', 'active', 'unpaid', 'paused', 'ended')`),
  ],
);

/** One line per invitation sent, for the limit on inviting the same person and for the record. */
export const membershipInvitations = pgTable(
  "membership_invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hostId: text("host_id")
      .notNull()
      .references(() => user.id),
    customerId: text("customer_id")
      .notNull()
      .references(() => user.id),
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => memberships.id),
    inviteId: uuid("invite_id").notNull().unique(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull(),
    /** open, accepted, taken_back, ran_out or replaced. */
    outcome: text("outcome").notNull().default("open"),
  },
  (t) => [index("membership_invitations_pair_idx").on(t.hostId, t.customerId, t.sentAt)],
);

/** What a member agreed to, and when. Lines are only ever added. */
export const membershipAgreements = pgTable(
  "membership_agreements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => memberships.id),
    /** Made when the form was shown, so the same press twice makes one agreement. */
    requestId: uuid("request_id").notNull().unique(),
    /** joined, resumed, less_time or price_lowered. */
    kind: text("kind").notNull(),
    offerVersion: integer("offer_version").notNull(),
    pricePer15Cents: integer("price_per_15_cents").notNull(),
    minutes: integer("minutes").notNull(),
    cardWordingVersion: text("card_wording_version"),
    /** The first month this applies to. */
    firstMonthNumber: integer("first_month_number").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull(),
  },
  (t) => [
    index("membership_agreements_membership_idx").on(t.membershipId),
    check("membership_agreements_kind", sql`${t.kind} in ('joined', 'resumed', 'less_time', 'price_lowered')`),
  ],
);

/**
 * Every card ever saved for a membership. The card in use is the one that is not retired. A
 * retired card is detached at Stripe once nothing open needs it, and only then marked removed.
 * A card that was ever retired is never taken into use again.
 */
export const membershipCards = pgTable(
  "membership_cards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => memberships.id),
    stripePaymentMethodId: text("stripe_payment_method_id").notNull().unique(),
    savedAt: timestamp("saved_at", { withTimezone: true }).notNull(),
    retiredAt: timestamp("retired_at", { withTimezone: true }),
    removedAt: timestamp("removed_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("membership_cards_in_use_uq").on(t.membershipId).where(sql`${t.retiredAt} is null`)],
);

/**
 * Every card a booking ever saved, kept after the card itself is removed. A booking forgets its
 * card when it is removed; this line stays, so a membership can always tell that a card was a
 * booking's and never take it as its own.
 */
export const bookingCards = pgTable("booking_cards", {
  stripePaymentMethodId: text("stripe_payment_method_id").primaryKey(),
  // Nothing in the app ever deletes a booking; the check scripts delete their own, and these lines go with them.
  bookingId: uuid("booking_id")
    .notNull()
    .references(() => bookings.id, { onDelete: "cascade" }),
  seenAt: timestamp("seen_at", { withTimezone: true }).notNull().defaultNow(),
  removedAt: timestamp("removed_at", { withTimezone: true }),
});

/**
 * One month of a membership, written down before its payment is tried. Where it stands (status):
 *   to_pay    written down; no hold yet (the first try, or tries after a failure)
 *   held      the hold is in place; the member has their time; no money is in any place
 *   running   the whole amount is confirmed taken; the six places are filled
 *   closed    past its end: no new bookings; calls not settled yet keep their money set aside
 *   finished  nothing set aside, nothing owed back
 *   given_up  it never became money (endedHow says why)
 *
 * The six places (free, set aside, used, expired, to be paid back, paid back) always add up to
 * totalCents for a running, closed or finished month and are all zero otherwise. The database
 * itself refuses anything else. Two places that change together change in one statement.
 */
export const membershipMonths = pgTable(
  "membership_months",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => memberships.id),
    /** The membership's period this month belongs to. */
    period: integer("period").notNull(),
    number: integer("number").notNull(),
    agreementId: uuid("agreement_id")
      .notNull()
      .references(() => membershipAgreements.id),
    /** agreement:<id>, renewal:<month id> or replacement:<month id>: makes each month exist once. */
    originKey: text("origin_key").notNull().unique(),
    pricePer15Cents: integer("price_per_15_cents").notNull(),
    includedMinutes: integer("included_minutes").notNull(),
    totalCents: integer("total_cents").notNull(),
    feePercentBps: integer("fee_percent_bps").notNull(),
    feeFixedCents: integer("fee_fixed_cents").notNull(),
    feeForeignCardBps: integer("fee_foreign_card_bps").notNull(),
    status: text("status").notNull().default("to_pay"),
    /** Written before a PaymentIntent is cancelled: cancel_now, given_up, ending, card_step, no_room, hold_lost or cancelled_at_stripe. */
    endedHow: text("ended_how"),
    /** Set when Stripe reports something that needs the founder. Such a month gives no time and nothing is tried on it. */
    problem: text("problem"),
    /** For a month started by a person at a card form: the hold must be in place by then. */
    cardStepExpiresAt: timestamp("card_step_expires_at", { withTimezone: true }),
    /** The one claim to create this month's PaymentIntent: written once, never changed. */
    intentRequestedAt: timestamp("intent_requested_at", { withTimezone: true }),
    intentRequest: text("intent_request"),
    stripePaymentIntentId: text("stripe_payment_intent_id").unique(),
    stripeChargeId: text("stripe_charge_id"),
    cardId: uuid("card_id").references(() => membershipCards.id),
    cardCountry: text("card_country"),
    /** The bank's own time for the hold. The month starts here. */
    authorisedAt: timestamp("authorised_at", { withTimezone: true }),
    holdExpiresAt: timestamp("hold_expires_at", { withTimezone: true }),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    /** When the held money is taken if no booking takes it sooner. */
    takeAt: timestamp("take_at", { withTimezone: true }),
    takenAt: timestamp("taken_at", { withTimezone: true }),
    /** What Stripe really took. Differs from totalCents only in the case that goes to the founder. */
    takenCents: integer("taken_cents"),
    /** Numbers the saved-card tries of this month. Goes up when a try is recorded as failed. */
    try: integer("try").notNull().default(1),
    firstFailedAt: timestamp("first_failed_at", { withTimezone: true }),
    nextTryAt: timestamp("next_try_at", { withTimezone: true }),
    giveUpAt: timestamp("give_up_at", { withTimezone: true }),
    /** The bank wants the member's own approval. */
    needsAction: boolean("needs_action").notNull().default(false),
    freeCents: integer("free_cents").notNull().default(0),
    setAsideCents: integer("set_aside_cents").notNull().default(0),
    usedCents: integer("used_cents").notNull().default(0),
    expiredCents: integer("expired_cents").notNull().default(0),
    toPayBackCents: integer("to_pay_back_cents").notNull().default(0),
    paidBackCents: integer("paid_back_cents").notNull().default(0),
    /** The part of freeCents that came back because of the host. Paid back, not expired, at the month's end. */
    hostCausedCents: integer("host_caused_cents").notNull().default(0),
    /** The month's fixed 30 cents is placed once, on the first amount that is used or expires. */
    fixedFeePlaced: boolean("fixed_fee_placed").notNull().default(false),
    /** none, open, won or lost. Open and lost freeze the month. */
    dispute: text("dispute").notNull().default("none"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("membership_months_number_uq").on(t.membershipId, t.number),
    index("membership_months_membership_idx").on(t.membershipId),
    index("membership_months_status_idx").on(t.status),
    check("membership_months_status", sql`${t.status} in ('to_pay', 'held', 'running', 'closed', 'finished', 'given_up')`),
    check("membership_months_dispute", sql`${t.dispute} in ('none', 'open', 'won', 'lost')`),
    check("membership_months_given_up_why", sql`${t.status} <> 'given_up' or ${t.endedHow} is not null`),
    check(
      "membership_months_not_negative",
      sql`${t.freeCents} >= 0 and ${t.setAsideCents} >= 0 and ${t.usedCents} >= 0 and ${t.expiredCents} >= 0 and ${t.toPayBackCents} >= 0 and ${t.paidBackCents} >= 0 and ${t.hostCausedCents} >= 0 and ${t.totalCents} > 0`,
    ),
    check(
      "membership_months_places_add_up",
      sql`(${t.status} in ('running', 'closed', 'finished') and ${t.freeCents} + ${t.setAsideCents} + ${t.usedCents} + ${t.expiredCents} + ${t.toPayBackCents} + ${t.paidBackCents} = ${t.totalCents})
        or (${t.status} in ('to_pay', 'held', 'given_up') and ${t.freeCents} + ${t.setAsideCents} + ${t.usedCents} + ${t.expiredCents} + ${t.toPayBackCents} + ${t.paidBackCents} = 0)`,
    ),
    check("membership_months_host_caused_in_free", sql`${t.hostCausedCents} <= ${t.freeCents}`),
  ],
);

/**
 * One line per pay-back OWED to a member's card from a month. Owing happens once (sourceKey names
 * the one event that owes it); the tries to send it are money actions of the month, numbered by
 * attempt. owed: not at Stripe (never tried, or the last try failed). at_stripe: Stripe accepted
 * it and has not finished. done: the money has gone back.
 */
export const membershipRefunds = pgTable(
  "membership_refunds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    monthId: uuid("month_id")
      .notNull()
      .references(() => membershipMonths.id),
    sourceKey: text("source_key").notNull().unique(),
    amountCents: integer("amount_cents").notNull(),
    reason: text("reason").notNull(),
    /** The call's payment it came from, if any. */
    paymentId: uuid("payment_id").references(() => payments.id),
    status: text("status").notNull().default("owed"),
    attempt: integer("attempt").notNull().default(1),
    stripeRefundId: text("stripe_refund_id"),
    lastFailedAt: timestamp("last_failed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    index("membership_refunds_status_idx").on(t.status),
    index("membership_refunds_month_idx").on(t.monthId),
    check("membership_refunds_status", sql`${t.status} in ('owed', 'at_stripe', 'done')`),
    check("membership_refunds_amount", sql`${t.amountCents} > 0`),
  ],
);

// ---------------------------------------------------------------------------
// Projects (plans/23): a host's one project at a time, and its diary.
// ---------------------------------------------------------------------------

/**
 * A host's project. One can be running per host; the database itself refuses a second. An ended
 * project stays, with its diary, and is still readable at its own address.
 */
export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hostId: text("host_id")
      .notNull()
      .references(() => user.id),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    /** running or ended. */
    status: text("status").notNull().default("running"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    /** Who ended it: host or connect. */
    endedBy: text("ended_by"),
    /**
     * The amounts she suggests for a contribution made once, in cents, separated by commas, up to
     * three. Empty: contributions made once are not offered (plans/23, choice B).
     */
    suggestedOnce: text("suggested_once").notNull().default(""),
    /** The same for a monthly contribution. */
    suggestedMonthly: text("suggested_monthly").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("projects_one_running_uq").on(t.hostId).where(sql`${t.status} = 'running'`),
    index("projects_host_idx").on(t.hostId, t.startedAt),
    check("projects_status", sql`${t.status} in ('running', 'ended')`),
    check("projects_ended_shape", sql`(${t.status} = 'running') = (${t.endedAt} is null)`),
  ],
);

/**
 * One post of a project's diary. A post the host removed, and one the founder hid, both stay as
 * lines: a report made about a post must still find what it was about.
 */
export const projectPosts = pgTable(
  "project_posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    text: text("text").notNull(),
    /** Up to three YouTube addresses, one per line, each rebuilt by us from what the host typed (see youtubeLink). */
    links: text("links").notNull().default(""),
    /** Set when the host removed it. Nobody sees it after that. */
    removedAt: timestamp("removed_at", { withTimezone: true }),
    /** Set when the founder hid it. Only the host and the founder see it, marked "Hidden by Connect". */
    hiddenAt: timestamp("hidden_at", { withTimezone: true }),
    hiddenBy: text("hidden_by").references(() => user.id),
    hiddenNote: text("hidden_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("project_posts_project_idx").on(t.projectId, t.createdAt)],
);

/**
 * A picture of a diary post (plans/24). Only Connect's own copy is ever kept: a JPEG, made again
 * from what was uploaded, with everything hidden in the file left out. Its bytes are in
 * project_picture_files, apart, so that no list can fetch them by accident.
 *
 * Where it stands (state):
 *   waiting   stored; no answer that counts yet. Only the host and the founder see it.
 *   shown     passed. `level` says how far the check went: full, or nudity_only.
 *   refused   a checker flagged it. Nobody sees it, and its bytes are deleted. The host is told
 *             it was not accepted, until she clears it away. Nothing goes to the founder.
 *   removed   removed by the host or the founder. Nobody can fetch it; its bytes are deleted at once
 *             or as soon as a check that is still out has come back. The line stays.
 *   locked    "Remove and report". Its bytes and everything about it are kept and never deleted.
 *
 * `version` goes up with every decision by the founder or the host and with every change of a
 * "suspected" mark; an everyday checker's answer is written only if it has not moved meanwhile.
 * A claim (claimId, claimedUntil) lets one check of a picture run at a time.
 */
export const projectPictures = pgTable(
  "project_pictures",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    postId: uuid("post_id")
      .notNull()
      .references(() => projectPosts.id),
    /** The host who uploaded it. Kept here for the count of a day's uploads. */
    hostId: text("host_id")
      .notNull()
      .references(() => user.id),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    byteLength: integer("byte_length").notNull(),
    /** A fingerprint of the exact bytes of Connect's copy. */
    sha256: text("sha256").notNull(),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull(),
    state: text("state").notNull().default("waiting"),
    /** full or nudity_only. Set when it is shown. */
    level: text("level"),
    /** Whose answer counts: openai, azure, sightengine, own or founder. */
    checkedBy: text("checked_by"),
    checkedAt: timestamp("checked_at", { withTimezone: true }),
    /** The version of the plan's rules the answer was judged by. */
    rulesVersion: text("rules_version"),
    /** What the checker looked at and found, as text. Also kept after the picture is removed. */
    checkDetail: text("check_detail"),
    /** Set once a checker has refused these bytes, and kept when the host clears the picture away: the same bytes are refused again. */
    refusedByChecker: boolean("refused_by_checker").notNull().default(false),
    /** The check against known pictures of child abuse: not_set_up, waiting, clear or match. */
    childCheck: text("child_check").notNull().default("not_set_up"),
    /** Two marks, kept apart: the founder's own, and one that is on while a report for "someone under 18" is open on its post. */
    suspectedByFounder: boolean("suspected_by_founder").notNull().default(false),
    suspectedByReport: boolean("suspected_by_report").notNull().default(false),
    claimId: uuid("claim_id"),
    claimedUntil: timestamp("claimed_until", { withTimezone: true }),
    version: integer("version").notNull().default(0),
    tries: integer("tries").notNull().default(0),
    nextTryAt: timestamp("next_try_at", { withTimezone: true }),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    /** host or founder. */
    removedBy: text("removed_by"),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedBy: text("locked_by").references(() => user.id),
    /** When the report to the authorities was really made, as the founder says. */
    reportMadeAt: timestamp("report_made_at", { withTimezone: true }),
    /** The post as it was at the moment of locking, as text. */
    lockedPost: text("locked_post"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("project_pictures_post_idx").on(t.postId, t.uploadedAt),
    index("project_pictures_host_day_idx").on(t.hostId, t.uploadedAt),
    index("project_pictures_queue_idx").on(t.state, t.nextTryAt),
    index("project_pictures_bytes_idx").on(t.hostId, t.sha256),
    check("project_pictures_state", sql`${t.state} in ('waiting', 'shown', 'refused', 'removed', 'locked')`),
    check("project_pictures_level", sql`${t.level} is null or ${t.level} in ('full', 'nudity_only')`),
    check("project_pictures_shown_has_level", sql`${t.state} <> 'shown' or ${t.level} is not null`),
    check("project_pictures_child_check", sql`${t.childCheck} in ('not_set_up', 'waiting', 'clear', 'match')`),
    check("project_pictures_locked_shape", sql`(${t.state} = 'locked') = (${t.lockedAt} is not null)`),
  ],
);

/** The bytes of a picture, and nothing else. A locked picture's bytes are never deleted. */
export const projectPictureFiles = pgTable("project_picture_files", {
  pictureId: uuid("picture_id")
    .primaryKey()
    .references(() => projectPictures.id),
  bytes: bytea("bytes").notNull(),
});

/**
 * One line for each outside checking service (openai, azure, sightengine): when it last gave a
 * complete, valid answer and with which key, until when it counts as out, and since when it has a
 * fault (a broken answer or a refused key).
 */
export const pictureCheckers = pgTable("picture_checkers", {
  service: text("service").primaryKey(),
  lastGoodAt: timestamp("last_good_at", { withTimezone: true }),
  /** A fingerprint of the key that gave that answer, so "has worked" means "with the key it has now". Never the key itself. */
  lastGoodKey: text("last_good_key"),
  outUntil: timestamp("out_until", { withTimezone: true }),
  faultSince: timestamp("fault_since", { withTimezone: true }),
  faultDetail: text("fault_detail"),
  faultToldAt: timestamp("fault_told_at", { withTimezone: true }),
});


// ---------------------------------------------------------------------------
// Contributions to a project (plans/23, plans/25)
// ---------------------------------------------------------------------------

/**
 * One person's contribution to one project: made once, or every month. The money itself is in
 * contribution_payments, one line for the payment made once and one for each month.
 */
export const contributions = pgTable(
  "contributions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    hostId: text("host_id")
      .notNull()
      .references(() => user.id),
    contributorId: text("contributor_id")
      .notNull()
      .references(() => user.id),
    /** once or monthly. */
    kind: text("kind").notNull(),
    amountCents: integer("amount_cents").notNull(),
    /** card_step, running or ended. */
    status: text("status").notNull().default("card_step"),
    /** Made when the form was shown: the same press, sent twice, is one contribution. */
    requestKey: text("request_key").notNull().unique(),
    /** For a monthly one: the moment of the first hold. Every later month's day is counted from it. */
    firstHoldAt: timestamp("first_hold_at", { withTimezone: true }),
    /** The number of the last month whose payment was written down, so no month is ever made up for. */
    lastWrittenMonth: integer("last_written_month").notNull().default(0),
    /** The numbers of months that were skipped, as JSON. */
    skippedMonths: text("skipped_months").notNull().default("[]"),
    /** Set while the founder's switch does not cover its host (plans/25, choice 13). */
    switchOffAt: timestamp("switch_off_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    /** Why it ended, for the record and the email. */
    endedHow: text("ended_how"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("contributions_project_idx").on(t.projectId),
    index("contributions_host_idx").on(t.hostId),
    index("contributions_contributor_idx").on(t.contributorId),
    // One monthly contribution that is not ended for each person and project.
    uniqueIndex("contributions_one_monthly_uq").on(t.contributorId, t.projectId).where(sql`${t.kind} = 'monthly' and ${t.status} <> 'ended'`),
    check("contributions_kind", sql`${t.kind} in ('once', 'monthly')`),
    check("contributions_status", sql`${t.status} in ('card_step', 'running', 'ended')`),
    check("contributions_amount", sql`${t.amountCents} between 500 and 10000000`),
    check("contributions_ended_shape", sql`(${t.status} = 'ended') = (${t.endedAt} is not null)`),
    check("contributions_not_own", sql`${t.hostId} <> ${t.contributorId}`),
  ],
);

/** What a contributor agreed to, written when they sent the form with the box ticked. Lines are only ever added. */
export const contributionAgreements = pgTable("contribution_agreements", {
  id: uuid("id").primaryKey().defaultRandom(),
  contributionId: uuid("contribution_id")
    .notNull()
    .references(() => contributions.id),
  /** The version of the wording they saw. */
  version: text("version").notNull(),
  kind: text("kind").notNull(),
  amountCents: integer("amount_cents").notNull(),
  agreedAt: timestamp("agreed_at", { withTimezone: true }).notNull(),
});

/**
 * The card saved for a monthly contribution, as membership_cards is for a membership: one in use,
 * retired when the contribution ends, removed at Stripe when nothing needs it. The line stays
 * afterwards, so the card is always known to have been a contribution's.
 */
export const contributionCards = pgTable(
  "contribution_cards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contributionId: uuid("contribution_id")
      .notNull()
      .references(() => contributions.id),
    stripePaymentMethodId: text("stripe_payment_method_id").notNull().unique(),
    savedAt: timestamp("saved_at", { withTimezone: true }).notNull(),
    retiredAt: timestamp("retired_at", { withTimezone: true }),
    removedAt: timestamp("removed_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("contribution_cards_in_use_uq").on(t.contributionId).where(sql`${t.retiredAt} is null`)],
);

/**
 * One payment of a contribution: the one made once, or one month's. It owns everything at Stripe
 * (its one PaymentIntent, every action, every ledger line about the contributor's card). The
 * host's share of it is a line in `payments`, written when the money is taken.
 */
export const contributionPayments = pgTable(
  "contribution_payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contributionId: uuid("contribution_id")
      .notNull()
      .references(() => contributions.id),
    /** 1 for a contribution made once; the number of the month for a monthly one. */
    number: integer("number").notNull(),
    /** Makes each payment exist once. */
    originKey: text("origin_key").notNull().unique(),
    amountCents: integer("amount_cents").notNull(),
    // The fee terms as they were when the payment was written down.
    feePercentBps: integer("fee_percent_bps").notNull(),
    feeFixedCents: integer("fee_fixed_cents").notNull(),
    feeForeignCardBps: integer("fee_foreign_card_bps").notNull(),

    /** The claim for its one PaymentIntent: when it was asked for, and the exact request. Never reset. */
    intentRequestedAt: timestamp("intent_requested_at", { withTimezone: true }),
    intentRequest: text("intent_request"),
    /** The moment its PaymentIntent was last asked of Stripe (the first time or again). Stripe's list showing none is believed only some minutes after it. */
    intentAskedAt: timestamp("intent_asked_at", { withTimezone: true }),
    stripePaymentIntentId: text("stripe_payment_intent_id").unique(),
    stripeChargeId: text("stripe_charge_id"),

    /** to_pay, held, taken or given_up. */
    status: text("status").notNull().default("to_pay"),
    /** Why it was given up. Set first; from that moment nothing new is asked of Stripe for it except letting it go. */
    endedHow: text("ended_how"),

    /** The bank's own time for the hold. */
    authorisedAt: timestamp("authorised_at", { withTimezone: true }),
    /** When the hold ends, by Stripe's own answer for that card. Never a guess. */
    holdExpiresAt: timestamp("hold_expires_at", { withTimezone: true }),
    /** When the money is to be taken. */
    takeAt: timestamp("take_at", { withTimezone: true }),
    /** The last moment it may still be taken: one hour before the hold ends. */
    takeBy: timestamp("take_by", { withTimezone: true }),
    /** The moment Connect had Stripe's answer that the money was taken. Kept, never changed. */
    takenAt: timestamp("taken_at", { withTimezone: true }),
    takenCents: integer("taken_cents"),

    /** The first payment's card step ends here. */
    cardStepExpiresAt: timestamp("card_step_expires_at", { withTimezone: true }),
    // The tries with the saved card, for a monthly payment after the first.
    try: integer("try").notNull().default(1),
    firstFailedAt: timestamp("first_failed_at", { withTimezone: true }),
    nextTryAt: timestamp("next_try_at", { withTimezone: true }),
    giveUpAt: timestamp("give_up_at", { withTimezone: true }),
    /** The bank wants the contributor to confirm. */
    needsAction: boolean("needs_action").notNull().default(false),
    cardId: uuid("card_id").references(() => contributionCards.id),
    cardCountry: text("card_country"),

    /** The 30-day mark of the $1,000 rule, set while the payment is still only held. It stays. */
    thirtyDayMark: boolean("thirty_day_mark").notNull().default(false),
    /** What has been refunded to the contributor's card so far. */
    refundedCents: integer("refunded_cents").notNull().default(0),
    /** none, open, won or lost. */
    dispute: text("dispute").notNull().default("none"),
    /** Goes up each time an answer from Stripe about its disputes is recorded, so an answer that was read before another was recorded is thrown away. */
    disputeVersion: integer("dispute_version").notNull().default(0),
    /** The founder's hold on the share, or release: none, held or released, with who, when and why. */
    founderHold: text("founder_hold").notNull().default("none"),
    founderBy: text("founder_by").references(() => user.id),
    founderAt: timestamp("founder_at", { withTimezone: true }),
    founderNote: text("founder_note"),
    /** Something Stripe showed that the code does not decide. For the founder's list. */
    problem: text("problem"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("contribution_payments_number_uq").on(t.contributionId, t.number),
    index("contribution_payments_status_idx").on(t.status),
    check("contribution_payments_status", sql`${t.status} in ('to_pay', 'held', 'taken', 'given_up')`),
    check("contribution_payments_dispute", sql`${t.dispute} in ('none', 'open', 'won', 'lost')`),
    check("contribution_payments_founder_hold", sql`${t.founderHold} in ('none', 'held', 'released')`),
    check("contribution_payments_given_up_why", sql`${t.status} <> 'given_up' or ${t.endedHow} is not null`),
    check("contribution_payments_taken_shape", sql`(${t.status} = 'taken') = (${t.takenAt} is not null) and (${t.takenAt} is null) = (${t.takenCents} is null)`),
    check("contribution_payments_amounts", sql`${t.amountCents} between 500 and 10000000 and ${t.refundedCents} >= 0 and ${t.refundedCents} <= coalesce(${t.takenCents}, 0)`),
  ],
);

/**
 * A sum that is owed back to a contributor's card: a refund the host or the founder decided, or
 * the full refund owed when a cancellation lost the race with the taking. Writing the line is what
 * makes the money owed; sending it is the helper's work, repeated until it is done.
 */
export const contributionRefunds = pgTable(
  "contribution_refunds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contributionPaymentId: uuid("contribution_payment_id")
      .notNull()
      .references(() => contributionPayments.id),
    /** Names the one event that owes it, so it exists once. */
    sourceKey: text("source_key").notNull().unique(),
    amountCents: integer("amount_cents").notNull(),
    /** host, founder or app. */
    decidedBy: text("decided_by").notNull(),
    deciderId: text("decider_id").references(() => user.id),
    reason: text("reason").notNull(),
    /** True for a refund after the share was sent: it is Connect's own money, and the host's share is not lowered. */
    connectsOwn: boolean("connects_own").notNull().default(false),
    /** owed, at_stripe or done. */
    status: text("status").notNull().default("owed"),
    attempt: integer("attempt").notNull().default(1),
    stripeRefundId: text("stripe_refund_id"),
    lastFailedAt: timestamp("last_failed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    index("contribution_refunds_status_idx").on(t.status),
    index("contribution_refunds_payment_idx").on(t.contributionPaymentId),
    check("contribution_refunds_status", sql`${t.status} in ('owed', 'at_stripe', 'done')`),
    check("contribution_refunds_amount", sql`${t.amountCents} > 0`),
    check("contribution_refunds_decided_by", sql`${t.decidedBy} in ('host', 'founder', 'app')`),
  ],
);

export type Call = typeof calls.$inferSelect;
export type Contribution = typeof contributions.$inferSelect;
export type ContributionPayment = typeof contributionPayments.$inferSelect;
export type ContributionRefund = typeof contributionRefunds.$inferSelect;
export type ContributionCard = typeof contributionCards.$inferSelect;
export type ProjectPicture = typeof projectPictures.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type ProjectPost = typeof projectPosts.$inferSelect;

export type Booking = typeof bookings.$inferSelect;
export type HostCalendar = typeof hostCalendars.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type CallExtension = typeof callExtensions.$inferSelect;
export type Refund = typeof refunds.$inferSelect;
export type RefundRequest = typeof refundRequests.$inferSelect;
export type MembershipOffer = typeof membershipOffers.$inferSelect;
export type Membership = typeof memberships.$inferSelect;
export type MembershipMonth = typeof membershipMonths.$inferSelect;
export type MembershipRefund = typeof membershipRefunds.$inferSelect;
export type MembershipCard = typeof membershipCards.$inferSelect;
export type AttendanceEvent = typeof attendanceEvents.$inferSelect;
