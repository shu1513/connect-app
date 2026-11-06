import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

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

/** A host's claim to a social media account, proven with a code in that account's bio. */
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("social_accounts_user_network_uq").on(t.userId, t.network),
    // The database itself guarantees one confirmed owner per name per network.
    uniqueIndex("social_accounts_confirmed_uq").on(t.network, t.nameKey).where(sql`${t.confirmedAt} is not null`),
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
    /** "customer" for a real request; "admin" for a call made on the admin test page. */
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

/** One record per paid call. */
export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    callId: uuid("call_id")
      .notNull()
      .unique()
      .references(() => calls.id),

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
    /** True while the customer's bank is disputing the charge. Blocks refunds and the host's payout. */
    disputeOpen: boolean("dispute_open").notNull().default(false),

    /** not_due, due, sent or not_owed. */
    transferStatus: text("transfer_status").notNull().default("not_due"),
    transferDueAt: timestamp("transfer_due_at", { withTimezone: true }),
    /** What was actually sent to the host for this call. */
    transferCents: integer("transfer_cents"),
    /** The share of the 25-cent payout charge taken from this call's transfer. */
    payoutFeeCents: integer("payout_fee_cents"),
    stripeTransferId: text("stripe_transfer_id"),
    transferredAt: timestamp("transferred_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("payments_status_idx").on(t.status), index("payments_transfer_idx").on(t.transferStatus)],
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
    paymentId: uuid("payment_id")
      .notNull()
      .references(() => payments.id),
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
  (t) => [index("money_operations_payment_idx").on(t.paymentId), index("money_operations_status_idx").on(t.status)],
);

/**
 * The 25-cent payout charge is taken once per host per weekly payday.
 * This row is what "once" means: only one payment can hold it.
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

/** The money record. Only ever added to: a correction is a new line, never an edit. */
export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    paymentId: uuid("payment_id")
      .notNull()
      .references(() => payments.id),
    /** customer_charge, customer_refund, platform_fee, host_share, host_transfer, payout_fee, hold_released. */
    kind: text("kind").notNull(),
    /** Positive adds, negative takes away. */
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default("usd"),
    stripeRef: text("stripe_ref"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ledger_entries_payment_idx").on(t.paymentId)],
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

export type Call = typeof calls.$inferSelect;
export type Booking = typeof bookings.$inferSelect;
export type HostCalendar = typeof hostCalendars.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type Refund = typeof refunds.$inferSelect;
export type AttendanceEvent = typeof attendanceEvents.$inferSelect;
