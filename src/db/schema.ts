import {
  bigserial,
  boolean,
  index,
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

export type Call = typeof calls.$inferSelect;
export type AttendanceEvent = typeof attendanceEvents.$inferSelect;
