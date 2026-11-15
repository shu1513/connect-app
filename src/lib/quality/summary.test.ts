import { describe, expect, it } from "vitest";
import { connectionsOf, endedBecause, gradeTimes, summarise, type SavedMessage, type SavedNote } from "./summary";

const at = (clock: string) => new Date(`2027-01-13T${clock}Z`);
// A ten-minute call.
const window = { start: at("09:00:00"), end: at("09:10:00") };
const note = (clock: string, grade: string, seq: number, connectionId = "c1"): SavedNote => ({ reporterId: "host", aboutId: "host", grade, connectionId, seq, seenAt: at(clock) });
/** A note every 30 seconds from one moment to another, all with one grade, as a browser that keeps reporting sends them. */
const steady = (from: string, until: string, grade: string, firstSeq = 0, connectionId = "c1") => {
  const notes: SavedNote[] = [];
  for (let t = at(from).getTime(), seq = firstSeq; t < at(until).getTime(); t += 30_000, seq++) notes.push({ ...note("09:00:00", grade, seq, connectionId), seenAt: new Date(t) });
  return notes;
};

describe("about how long at each grade", () => {
  it("a browser that kept reporting one grade covers the whole call", () => {
    expect(gradeTimes(steady("09:00:00", "09:10:00", "excellent"), window)).toEqual({ excellent: 600, good: 0, poor: 0, lost: 0, reported: 600, unknown: 0 });
  });
  it("a change is counted from the moment the browser saw it", () => {
    const notes = [...steady("09:00:00", "09:04:00", "good"), note("09:04:10", "poor", 100), ...steady("09:04:30", "09:10:00", "poor", 101)];
    expect(gradeTimes(notes, window)).toEqual({ excellent: 0, good: 250, poor: 350, lost: 0, reported: 600, unknown: 0 });
  });
  it("a grade is carried forward 45 seconds and no longer: a gap is unknown, never filled in", () => {
    // Reports until 09:03:00, silence, then again from 09:07:00.
    const notes = [...steady("09:00:00", "09:03:01", "good"), ...steady("09:07:00", "09:10:00", "good", 50)];
    const times = gradeTimes(notes, window);
    expect(times.good).toBe(180 + 45 + 180);
    expect(times.unknown).toBe(600 - 405);
  });
  it("no notes at all is unknown, not good", () => {
    expect(gradeTimes([], window)).toEqual({ excellent: 0, good: 0, poor: 0, lost: 0, reported: 0, unknown: 600 });
  });
  it("the video service's own 'unknown' grade counts as unknown", () => {
    const times = gradeTimes([note("09:00:00", "unknown", 0), ...steady("09:00:30", "09:10:00", "good", 1)], window);
    expect(times).toMatchObject({ good: 570, reported: 570, unknown: 30 });
  });
  it("late, repeated and out-of-order notes give the same answer", () => {
    const inOrder = [...steady("09:00:00", "09:05:00", "good"), ...steady("09:05:00", "09:10:00", "lost", 10)];
    const shuffled = [...inOrder].reverse();
    const repeated = [...shuffled, ...inOrder.slice(3, 9)];
    expect(gradeTimes(shuffled, window)).toEqual(gradeTimes(inOrder, window));
    expect(gradeTimes(repeated, window)).toEqual(gradeTimes(inOrder, window));
    expect(gradeTimes(inOrder, window)).toMatchObject({ good: 300, lost: 300 });
  });
  it("only the call's own time counts", () => {
    const notes = [...steady("08:56:00", "09:12:00", "good")];
    expect(gradeTimes(notes, window)).toMatchObject({ good: 600, reported: 600, unknown: 0 });
  });
  it("a rejoin (a new connection, numbered from zero again) is put in order by time", () => {
    const notes = [...steady("09:00:00", "09:02:00", "good", 0, "first"), ...steady("09:05:00", "09:10:00", "poor", 0, "second")];
    expect(gradeTimes(notes, window)).toMatchObject({ good: 120 + 15, poor: 300 });
  });
});

const message = (type: string, identity: string, sessionId: string, clock: string, reason?: unknown): SavedMessage => ({
  type,
  identity,
  sessionId,
  time: at(clock),
  payload: JSON.stringify({ event: type, participant: { identity, region: "somewhere", ...(reason === undefined ? {} : { disconnectReason: reason }) } }),
});

describe("why a connection ended, from the video service's own messages", () => {
  it("is put in neutral words", () => {
    const reason = (value: unknown) => endedBecause(JSON.stringify({ participant: { disconnectReason: value } }));
    expect(reason("CLIENT_INITIATED")).toBe("own_device");
    expect(reason("CONNECTION_TIMEOUT")).toBe("timed_out");
    expect(reason(14)).toBe("timed_out");
    expect(reason("SIGNAL_CLOSE")).toBe("failed");
    expect(reason("ROOM_DELETED")).toBe("removed");
    expect(reason("PARTICIPANT_REMOVED")).toBe("removed");
    expect(reason("DUPLICATE_IDENTITY")).toBe("replaced");
    expect(reason("SOMETHING_NEW")).toBe("no_reason");
    expect(reason(undefined)).toBe("no_reason");
    expect(endedBecause("{}")).toBe("no_reason");
    expect(endedBecause("not json")).toBe("no_reason");
  });
  it("lists each connection of a person inside the call's time", () => {
    const messages = [
      message("participant_joined", "host", "s1", "08:58:00"),
      message("participant_left", "host", "s1", "09:03:00", "CONNECTION_TIMEOUT"),
      message("participant_joined", "host", "s2", "09:04:00"),
      message("participant_left", "host", "s2", "09:10:00", "ROOM_DELETED"),
      message("participant_joined", "customer", "s3", "09:00:10"),
      message("track_published", "host", "s2", "09:04:01"),
    ];
    expect(connectionsOf(messages, "host", window)).toEqual([
      { from: "2027-01-13T09:00:00.000Z", until: "2027-01-13T09:03:00.000Z", ended: "timed_out" },
      // It lasted to the end of the call's time: it did not end inside it.
      { from: "2027-01-13T09:04:00.000Z", until: "2027-01-13T09:10:00.000Z", ended: null },
    ]);
    // No "left" message was saved for the customer.
    expect(connectionsOf(messages, "customer", window)).toEqual([{ from: "2027-01-13T09:00:10.000Z", until: null, ended: null }]);
  });
});

describe("the summary of a call", () => {
  const messages = [message("participant_joined", "h", "s1", "09:00:00"), message("participant_left", "h", "s1", "09:06:00", "CLIENT_INITIATED"), message("participant_joined", "c", "s2", "09:00:00")];
  const from = (reporterId: string, aboutId: string, grade: string) => steady("09:00:00", "09:06:00", grade).map((n) => ({ ...n, reporterId, aboutId }));
  const notes = [...from("h", "h", "good"), ...from("h", "c", "excellent"), ...from("c", "h", "poor"), ...from("c", "c", "excellent")];
  const summary = summarise({ hostId: "h", customerId: "c", ...window, messages, notes });

  it("shows each person twice: as their own browser reported it and as the other's did, also where they differ", () => {
    expect(summary.host.ownBrowser).toMatchObject({ good: 375, poor: 0 });
    expect(summary.host.otherBrowser).toMatchObject({ good: 0, poor: 375 });
    expect(summary.customer.ownBrowser.excellent).toBe(375);
    expect(summary.callSeconds).toBe(600);
    expect(summary.anyNotes).toBe(true);
  });
  it("holds no account ids and nothing else from the saved messages", () => {
    const text = JSON.stringify(summary);
    expect(text).not.toContain("somewhere");
    expect(text).not.toContain('"h"');
    expect(Object.keys(summary).sort()).toEqual(["anyNotes", "callSeconds", "customer", "host"]);
  });
  it("is the same when worked out again, and says so when no browser reported", () => {
    expect(JSON.stringify(summarise({ hostId: "h", customerId: "c", ...window, messages: [...messages].reverse(), notes: [...notes].reverse() }))).toBe(JSON.stringify(summary));
    const silent = summarise({ hostId: "h", customerId: "c", ...window, messages, notes: [] });
    expect(silent.anyNotes).toBe(false);
    expect(silent.host.ownBrowser.unknown).toBe(600);
    expect(silent.host.connections).toHaveLength(1);
  });
});
