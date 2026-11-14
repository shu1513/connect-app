import { describe, expect, it } from "vitest";
import { calculateAttendance, countedWindow, JOINED, LEFT, type AttendanceInput, type CallWindow } from "./calc";

// A 15-minute booked call, from second 1000 to second 1900.
const START = 1000;
const END = 1900;
const HOST = "host-1";
const CUSTOMER = "customer-1";
const window: CallWindow = { hostId: HOST, customerId: CUSTOMER, start: START, end: END };

/** A long time after the call, when no more messages are expected. */
const AFTER = { final: true };

let nextId = 0;
function joined(identity: string, sessionId: string, time: number): AttendanceInput {
  return { id: `e${nextId++}`, type: JOINED, identity, sessionId, time };
}
function left(identity: string, sessionId: string, time: number): AttendanceInput {
  return { id: `e${nextId++}`, type: LEFT, identity, sessionId, time };
}

describe("the counting rule", () => {
  it("counts a normal call where both are there the whole time", () => {
    const r = calculateAttendance(
      window,
      [joined(HOST, "h1", START), joined(CUSTOMER, "c1", START), left(HOST, "h1", END), left(CUSTOMER, "c1", END)],
      AFTER,
    );
    expect(r.status).toBe("complete");
    expect(r.totals).toEqual({ hostSeconds: 900, customerSeconds: 900, togetherSeconds: 900 });
  });

  it("host 5 minutes late: host time and time together shrink, customer time does not", () => {
    const r = calculateAttendance(
      window,
      [joined(CUSTOMER, "c1", START), joined(HOST, "h1", START + 300), left(HOST, "h1", END), left(CUSTOMER, "c1", END)],
      AFTER,
    );
    expect(r.totals).toEqual({ hostSeconds: 600, customerSeconds: 900, togetherSeconds: 600 });
  });

  it("customer 5 minutes late: host still gets full host time", () => {
    const r = calculateAttendance(
      window,
      [joined(HOST, "h1", START), joined(CUSTOMER, "c1", START + 300), left(HOST, "h1", END), left(CUSTOMER, "c1", END)],
      AFTER,
    );
    expect(r.totals).toEqual({ hostSeconds: 900, customerSeconds: 600, togetherSeconds: 600 });
  });

  it("host leaves 4 minutes early", () => {
    const r = calculateAttendance(
      window,
      [joined(HOST, "h1", START), joined(CUSTOMER, "c1", START), left(HOST, "h1", END - 240), left(CUSTOMER, "c1", END)],
      AFTER,
    );
    expect(r.totals).toEqual({ hostSeconds: 660, customerSeconds: 900, togetherSeconds: 660 });
  });

  it("a drop and rejoin is one call, and the gap is not counted", () => {
    const r = calculateAttendance(
      window,
      [
        joined(HOST, "h1", START),
        joined(CUSTOMER, "c1", START),
        left(CUSTOMER, "c1", START + 200),
        joined(CUSTOMER, "c2", START + 260), // back after 60 seconds
        left(HOST, "h1", END),
        left(CUSTOMER, "c2", END),
      ],
      AFTER,
    );
    expect(r.status).toBe("complete");
    expect(r.totals).toEqual({ hostSeconds: 900, customerSeconds: 840, togetherSeconds: 840 });
    expect(r.customerIntervals).toEqual([
      { start: START, end: START + 200 },
      { start: START + 260, end: END },
    ]);
  });

  it("a second tab takes over: the overlap counts once, and the old tab's late goodbye changes nothing", () => {
    const r = calculateAttendance(
      window,
      [
        joined(HOST, "h1", START),
        joined(CUSTOMER, "c1", START),
        joined(HOST, "h2", START + 100), // second tab connects
        left(HOST, "h1", START + 103), // old tab's "disconnected" arrives 3 seconds later
        left(HOST, "h2", END),
        left(CUSTOMER, "c1", END),
      ],
      AFTER,
    );
    expect(r.status).toBe("complete");
    expect(r.hostIntervals).toEqual([{ start: START, end: END }]);
    expect(r.totals).toEqual({ hostSeconds: 900, customerSeconds: 900, togetherSeconds: 900 });
  });

  it("gives the same answer whatever order the messages arrive in", () => {
    const events = [
      joined(HOST, "h1", START + 10),
      joined(CUSTOMER, "c1", START + 20),
      left(CUSTOMER, "c1", START + 500),
      joined(CUSTOMER, "c2", START + 530),
      left(HOST, "h1", END - 30),
      left(CUSTOMER, "c2", END),
    ];
    const inOrder = calculateAttendance(window, events, AFTER);
    const reversed = calculateAttendance(window, [...events].reverse(), AFTER);
    expect(reversed).toEqual(inOrder);
    // Host 1010–1870. Customer 1020–1500 and 1530–1900. Together 480 + 340.
    expect(inOrder.totals).toEqual({ hostSeconds: 860, customerSeconds: 850, togetherSeconds: 820 });
  });

  it("ignores repeated copies of the same message", () => {
    const hj = joined(HOST, "h1", START);
    const hl = left(HOST, "h1", END);
    const r = calculateAttendance(window, [hj, hj, hl, hl, hj], AFTER);
    expect(r.status).toBe("complete");
    expect(r.totals).toEqual({ hostSeconds: 900, customerSeconds: 0, togetherSeconds: 0 });
  });

  it("joining before the start does not count early time", () => {
    const r = calculateAttendance(
      window,
      [joined(HOST, "h1", START - 300), joined(CUSTOMER, "c1", START - 120), left(HOST, "h1", END), left(CUSTOMER, "c1", END)],
      AFTER,
    );
    expect(r.totals).toEqual({ hostSeconds: 900, customerSeconds: 900, togetherSeconds: 900 });
  });

  it("staying after the end does not count late time", () => {
    const r = calculateAttendance(
      window,
      [joined(HOST, "h1", START), joined(CUSTOMER, "c1", START), left(HOST, "h1", END + 60), left(CUSTOMER, "c1", END + 55)],
      AFTER,
    );
    expect(r.totals).toEqual({ hostSeconds: 900, customerSeconds: 900, togetherSeconds: 900 });
  });

  it("a visit entirely before the start or after the end counts as zero", () => {
    const r = calculateAttendance(
      window,
      [joined(HOST, "h1", START - 200), left(HOST, "h1", START - 50), joined(CUSTOMER, "c1", END), left(CUSTOMER, "c1", END + 30)],
      AFTER,
    );
    expect(r.status).toBe("complete");
    expect(r.totals).toEqual({ hostSeconds: 0, customerSeconds: 0, togetherSeconds: 0 });
  });

  it("nobody shows up: zero, and that is a complete record", () => {
    const r = calculateAttendance(window, [], AFTER);
    expect(r.status).toBe("complete");
    expect(r.totals).toEqual({ hostSeconds: 0, customerSeconds: 0, togetherSeconds: 0 });
  });

  it("connecting and disconnecting in the same second counts as zero", () => {
    const r = calculateAttendance(window, [joined(HOST, "h1", START + 5), left(HOST, "h1", START + 5)], AFTER);
    expect(r.status).toBe("complete");
    expect(r.totals?.hostSeconds).toBe(0);
  });

  it("ignores messages that are not a connect or disconnect", () => {
    const r = calculateAttendance(
      window,
      [
        { id: "x1", type: "room_started", identity: null, sessionId: null, time: START - 10 },
        { id: "x2", type: "participant_connection_aborted", identity: CUSTOMER, sessionId: "c0", time: START + 5 },
        joined(HOST, "h1", START),
        left(HOST, "h1", END),
      ],
      AFTER,
    );
    expect(r.status).toBe("complete");
    expect(r.totals).toEqual({ hostSeconds: 900, customerSeconds: 0, togetherSeconds: 0 });
  });
});

describe("when the record is incomplete, it says so and never guesses", () => {
  it('a missing "disconnected" on a finished call needs review, with no totals', () => {
    const r = calculateAttendance(
      window,
      [joined(HOST, "h1", START), joined(CUSTOMER, "c1", START), left(CUSTOMER, "c1", END)],
      AFTER,
    );
    expect(r.status).toBe("needs_review");
    expect(r.totals).toBeNull();
    expect(r.reasons.join(" ")).toMatch(/host.*no matching "disconnected"/i);
    // What we do know is still shown.
    expect(r.customerIntervals).toEqual([{ start: START, end: END }]);
  });

  it('a missing "connected" needs review', () => {
    const r = calculateAttendance(
      window,
      [left(HOST, "h1", START + 400), joined(CUSTOMER, "c1", START), left(CUSTOMER, "c1", END)],
      AFTER,
    );
    expect(r.status).toBe("needs_review");
    expect(r.totals).toBeNull();
    expect(r.reasons.join(" ")).toMatch(/host.*no matching "connected"/i);
  });

  it("someone who is not on the call needs review", () => {
    const r = calculateAttendance(
      window,
      [joined(HOST, "h1", START), left(HOST, "h1", END), joined("stranger-9", "s1", START + 50), left("stranger-9", "s1", START + 90)],
      AFTER,
    );
    expect(r.status).toBe("needs_review");
    expect(r.totals).toBeNull();
  });

  it("a failed connection attempt by someone who is not on the call needs review", () => {
    const r = calculateAttendance(
      window,
      [
        joined(HOST, "h1", START),
        left(HOST, "h1", END),
        { id: "ab1", type: "participant_connection_aborted", identity: "stranger-9", sessionId: "s1", time: START + 50 },
      ],
      AFTER,
    );
    expect(r.status).toBe("needs_review");
    expect(r.totals).toBeNull();
  });

  it('a "disconnected" earlier than its "connected" needs review', () => {
    const r = calculateAttendance(window, [joined(HOST, "h1", START + 300), left(HOST, "h1", START + 100)], AFTER);
    expect(r.status).toBe("needs_review");
  });

  it("two different times for the same connection need review", () => {
    const r = calculateAttendance(
      window,
      [joined(HOST, "h1", START), left(HOST, "h1", START + 100), left(HOST, "h1", START + 700)],
      AFTER,
    );
    expect(r.status).toBe("needs_review");
  });

  it("a message with no person or connection needs review", () => {
    const r = calculateAttendance(
      window,
      [{ id: "bad", type: JOINED, identity: null, sessionId: null, time: START }],
      AFTER,
    );
    expect(r.status).toBe("needs_review");
  });

  // An honest limit, written down as a test: if BOTH the "connected" and the
  // "disconnected" for a visit never reach us, nothing in the log shows it.
  it("cannot see a visit when both of its messages are lost (known limit)", () => {
    const r = calculateAttendance(window, [joined(CUSTOMER, "c1", START), left(CUSTOMER, "c1", END)], AFTER);
    expect(r.status).toBe("complete");
    expect(r.totals?.hostSeconds).toBe(0);
  });
});

describe("while the call is still running", () => {
  const RUNNING = { final: false };

  it("shows no totals while someone is still connected, and never guesses where their time ends", () => {
    const r = calculateAttendance(window, [joined(HOST, "h1", START), joined(CUSTOMER, "c1", START + 60)], RUNNING);
    expect(r.status).toBe("in_progress");
    expect(r.stillConnected).toBe(true);
    expect(r.totals).toBeNull();
  });

  it("a lost \"disconnected\" during the call does not turn into invented time", () => {
    // The host really left after 60 seconds, but that message never arrived.
    const r = calculateAttendance(
      window,
      [joined(HOST, "h1", START), joined(CUSTOMER, "c1", START), left(CUSTOMER, "c1", START + 300)],
      RUNNING,
    );
    expect(r.totals).toBeNull();
    expect(r.hostIntervals).toEqual([]);
    expect(r.customerIntervals).toEqual([{ start: START, end: START + 300 }]);
  });

  it("shows totals so far once everyone has disconnected, but is not complete until the call is final", () => {
    const r = calculateAttendance(window, [joined(HOST, "h1", START), left(HOST, "h1", START + 100)], RUNNING);
    expect(r.status).toBe("in_progress");
    expect(r.stillConnected).toBe(false);
    expect(r.totals).toEqual({ hostSeconds: 100, customerSeconds: 0, togetherSeconds: 0 });
  });
});

describe("the part of a call each payment pays for", () => {
  const t = (iso: string) => new Date(`2026-01-01T${iso}Z`);
  const secs = (iso: string) => Math.floor(t(iso).getTime() / 1000);
  // Booked 09:00 to 09:15, then 10 minutes were added: the call now ends at 09:25.
  const call = { startsAt: t("09:00:00"), endsAt: t("09:25:00"), safetyEndedAt: null as Date | null };
  const own = { from: t("09:00:00"), until: t("09:15:00") };
  const extra = { from: t("09:15:00"), until: t("09:25:00") };
  const people = { hostId: "host", customerId: "customer" };
  const visit = (who: string, session: string, from: string, to: string): AttendanceInput[] => [
    { id: `${session}-in`, type: JOINED, identity: who, sessionId: session, time: secs(from) },
    { id: `${session}-out`, type: LEFT, identity: who, sessionId: session, time: secs(to) },
  ];
  const hostSecondsIn = (stretch: { from: Date; until: Date } | undefined, events: AttendanceInput[], stopped: Date | null = null) =>
    calculateAttendance({ ...people, ...countedWindow({ ...call, safetyEndedAt: stopped }, stretch) }, events, { final: true }).totals?.hostSeconds;

  it("without a stretch is the whole call", () => {
    expect(countedWindow(call)).toEqual({ start: secs("09:00:00"), end: secs("09:25:00") });
  });
  it("is exactly each payment's own minutes, with no second counted twice", () => {
    const events = [...visit("host", "h1", "08:58:00", "09:25:00"), ...visit("customer", "c1", "09:00:00", "09:25:00")];
    expect(hostSecondsIn(own, events)).toBe(15 * 60);
    expect(hostSecondsIn(extra, events)).toBe(10 * 60);
    expect(hostSecondsIn(undefined, events)).toBe(25 * 60);
  });
  it("a host who was late is late in the call's own time only", () => {
    const events = [...visit("host", "h1", "09:03:00", "09:25:00"), ...visit("customer", "c1", "09:00:00", "09:25:00")];
    expect(hostSecondsIn(own, events)).toBe(12 * 60);
    expect(hostSecondsIn(extra, events)).toBe(10 * 60);
  });
  it("a host who leaves during the added time is only missing there", () => {
    const events = [...visit("host", "h1", "09:00:00", "09:21:00"), ...visit("customer", "c1", "09:00:00", "09:25:00")];
    expect(hostSecondsIn(own, events)).toBe(15 * 60);
    expect(hostSecondsIn(extra, events)).toBe(6 * 60);
  });
  it("a call stopped during the added time counts the added time only up to the stop", () => {
    const events = [...visit("host", "h1", "09:00:00", "09:19:00"), ...visit("customer", "c1", "09:00:00", "09:19:00")];
    expect(countedWindow({ ...call, safetyEndedAt: t("09:19:00") }, extra)).toEqual({ start: secs("09:15:00"), end: secs("09:19:00") });
    expect(hostSecondsIn(own, events, t("09:19:00"))).toBe(15 * 60);
    expect(hostSecondsIn(extra, events, t("09:19:00"))).toBe(4 * 60);
  });
  it("a call stopped before the added time counts nothing for it", () => {
    const events = [...visit("host", "h1", "09:00:00", "09:10:00"), ...visit("customer", "c1", "09:00:00", "09:10:00")];
    expect(countedWindow({ ...call, safetyEndedAt: t("09:10:00") }, extra)).toEqual({ start: secs("09:15:00"), end: secs("09:15:00") });
    expect(hostSecondsIn(extra, events, t("09:10:00"))).toBe(0);
    expect(hostSecondsIn(own, events, t("09:10:00"))).toBe(10 * 60);
  });
  it("an incomplete record is incomplete for every payment of the call", () => {
    const events: AttendanceInput[] = [{ id: "h-in", type: JOINED, identity: "host", sessionId: "h1", time: secs("09:00:00") }, ...visit("customer", "c1", "09:00:00", "09:25:00")];
    expect(calculateAttendance({ ...people, ...countedWindow(call, own) }, events, { final: true }).status).toBe("needs_review");
    expect(calculateAttendance({ ...people, ...countedWindow(call, extra) }, events, { final: true }).status).toBe("needs_review");
  });
});
