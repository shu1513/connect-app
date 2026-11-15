/**
 * The short summary of a call's quality record: when each person was
 * connected and why each connection ended (from the video service's own
 * messages, which neither person can change), and about how long each
 * connection was at each grade (from the notes the two browsers sent).
 *
 * Plain functions: no database. The summary holds roles, times and grades,
 * never account ids, regions or anything else from the saved messages.
 */
import { CONFIRM_EVERY_MS, type Grade } from "./rules";

/**
 * A grade is carried forward this long after a note, and no longer: the call
 * screen confirms twice a minute, so a longer silence means that browser was
 * not reporting. A gap is "unknown", never filled in.
 */
export const CARRY_MS = CONFIRM_EVERY_MS * 1.5;

export type Role = "host" | "customer";

/** Why a connection ended, in words that do not say whose fault it was. */
export type EndedBecause = "own_device" | "timed_out" | "failed" | "removed" | "replaced" | "no_reason";

export const ENDED_WORDS: Record<EndedBecause, string> = {
  own_device: "The connection ended from the person's own device. This also happens when the app reconnects by itself after a stumble.",
  timed_out: "The video service reported that the connection timed out.",
  failed: "The video service reported that the connection failed.",
  removed: "The video service removed the person (the room was closed, or the call was stopped).",
  replaced: "The video service removed the person because they joined again from another tab or device.",
  no_reason: "The video service gave no reason.",
};

/** The video service's reason names (and their numbers, in case a message carries those). */
const REASONS: Record<string, EndedBecause> = {
  CLIENT_INITIATED: "own_device",
  CONNECTION_TIMEOUT: "timed_out",
  SIGNAL_CLOSE: "failed",
  STATE_MISMATCH: "failed",
  MEDIA_FAILURE: "failed",
  JOIN_FAILURE: "failed",
  PARTICIPANT_REMOVED: "removed",
  ROOM_DELETED: "removed",
  ROOM_CLOSED: "removed",
  SERVER_SHUTDOWN: "removed",
  DUPLICATE_IDENTITY: "replaced",
};
const REASON_NUMBERS: Record<number, string> = {
  1: "CLIENT_INITIATED",
  2: "DUPLICATE_IDENTITY",
  3: "SERVER_SHUTDOWN",
  4: "PARTICIPANT_REMOVED",
  5: "ROOM_DELETED",
  6: "STATE_MISMATCH",
  7: "JOIN_FAILURE",
  9: "SIGNAL_CLOSE",
  10: "ROOM_CLOSED",
  14: "CONNECTION_TIMEOUT",
  15: "MEDIA_FAILURE",
};

/** Reads why a connection ended out of a saved "participant left" message. Anything unreadable is "no reason". */
export function endedBecause(payload: string): EndedBecause {
  try {
    const reason = (JSON.parse(payload) as { participant?: { disconnectReason?: unknown } }).participant?.disconnectReason;
    const name = typeof reason === "number" ? REASON_NUMBERS[reason] : typeof reason === "string" ? reason : undefined;
    return (name && REASONS[name]) || "no_reason";
  } catch {
    return "no_reason";
  }
}

export type SavedMessage = { type: string; identity: string | null; sessionId: string | null; time: Date; payload: string };
export type SavedNote = { reporterId: string; aboutId: string; grade: string; connectionId: string; seq: number; seenAt: Date };

/** Seconds at each grade, as one browser reported them about one person. */
export type GradeTimes = {
  excellent: number;
  good: number;
  poor: number;
  lost: number;
  /** The seconds of the call that browser was reporting a grade for. */
  reported: number;
  /** The rest of the call: no report, or the video service had no grade yet. */
  unknown: number;
};

export type PersonQuality = {
  /** Each connection inside the call's time. `until` is null when no "left" message was saved. */
  connections: Array<{ from: string; until: string | null; ended: EndedBecause | null }>;
  /** As that person's own browser reported it. */
  ownBrowser: GradeTimes;
  /** As the other person's browser reported it. */
  otherBrowser: GradeTimes;
};

export type QualitySummary = {
  /** The length of the call's time, in seconds. */
  callSeconds: number;
  /** False when no browser sent any note: quality unknown. */
  anyNotes: boolean;
  host: PersonQuality;
  customer: PersonQuality;
};

const GRADED: readonly Grade[] = ["excellent", "good", "poor", "lost"];

/** About how long one person's connection was at each grade, from one browser's notes about them. */
export function gradeTimes(notes: Array<Pick<SavedNote, "grade" | "connectionId" | "seq" | "seenAt">>, window: { start: Date; end: Date }): GradeTimes {
  const start = window.start.getTime();
  const end = window.end.getTime();
  // Each note counts once, however often it arrived, and they are put in the order the browser saw them.
  const once = new Map<string, (typeof notes)[number]>();
  for (const note of notes) once.set(`${note.connectionId}:${note.seq}`, note);
  const ordered = [...once.values()].sort((a, b) => a.seenAt.getTime() - b.seenAt.getTime() || a.seq - b.seq);

  const ms = { excellent: 0, good: 0, poor: 0, lost: 0 };
  ordered.forEach((note, index) => {
    const from = Math.max(note.seenAt.getTime(), start);
    const next = ordered[index + 1]?.seenAt.getTime() ?? Infinity;
    const until = Math.min(next, note.seenAt.getTime() + CARRY_MS, end);
    if (until > from && (GRADED as readonly string[]).includes(note.grade)) ms[note.grade as keyof typeof ms] += until - from;
  });
  const seconds = (value: number) => Math.round(value / 1000);
  const reported = seconds(ms.excellent + ms.good + ms.poor + ms.lost);
  const total = Math.max(0, seconds(end - start));
  return { excellent: seconds(ms.excellent), good: seconds(ms.good), poor: seconds(ms.poor), lost: seconds(ms.lost), reported: Math.min(reported, total), unknown: Math.max(0, total - reported) };
}

/** Each connection of one person inside the call's time, with why it ended. */
export function connectionsOf(messages: SavedMessage[], identity: string, window: { start: Date; end: Date }): PersonQuality["connections"] {
  const sessions = new Map<string, { from?: Date; until?: Date; ended?: EndedBecause }>();
  for (const message of messages) {
    if (message.identity !== identity || !message.sessionId) continue;
    const session = sessions.get(message.sessionId) ?? {};
    if (message.type === "participant_joined") session.from = message.time;
    else if (message.type === "participant_left") {
      session.until = message.time;
      session.ended = endedBecause(message.payload);
    } else continue;
    sessions.set(message.sessionId, session);
  }
  return [...sessions.values()]
    .filter((s): s is { from: Date; until?: Date; ended?: EndedBecause } => Boolean(s.from) && s.from! < window.end && (!s.until || s.until > window.start))
    .sort((a, b) => a.from.getTime() - b.from.getTime())
    .map((s) => ({
      from: new Date(Math.max(s.from.getTime(), window.start.getTime())).toISOString(),
      until: s.until ? new Date(Math.min(s.until.getTime(), window.end.getTime())).toISOString() : null,
      // A connection that lasted to the end of the call's time did not "end" inside it.
      ended: s.until && s.until < window.end ? (s.ended ?? "no_reason") : null,
    }));
}

/** The whole summary of one call. Depends only on what was saved, so working it out twice gives the same answer unless something new arrived. */
export function summarise(input: { hostId: string; customerId: string; start: Date; end: Date; messages: SavedMessage[]; notes: SavedNote[] }): QualitySummary {
  const window = { start: input.start, end: input.end };
  const person = (id: string, otherId: string): PersonQuality => ({
    connections: connectionsOf(input.messages, id, window),
    ownBrowser: gradeTimes(input.notes.filter((n) => n.aboutId === id && n.reporterId === id), window),
    otherBrowser: gradeTimes(input.notes.filter((n) => n.aboutId === id && n.reporterId === otherId), window),
  });
  return {
    callSeconds: Math.max(0, Math.round((input.end.getTime() - input.start.getTime()) / 1000)),
    anyNotes: input.notes.length > 0,
    host: person(input.hostId, input.customerId),
    customer: person(input.customerId, input.hostId),
  };
}
