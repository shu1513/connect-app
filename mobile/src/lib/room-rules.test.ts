import { clockLine, isBlocked, isEnded, isEndedScreen, isLive, isPass, isReportForm, isReportSent, isRoom, laterEnd, notTheMoment, reportPlace, ROOM_WORD_NAMES } from "./room-rules";

const ID = "3f2c1b7a-9d4e-4f6a-8b1c-2d3e4f5a6b7c";
const words = Object.fromEntries(ROOM_WORD_NAMES.map((name) => [name, `${name} words`]));
const room = {
  id: ID,
  role: "customer",
  other: "Maya",
  startsAt: "2026-11-20T12:00:00.000Z",
  endsAt: "2026-11-20T12:30:00.000Z",
  opensAt: "2026-11-20T11:55:00.000Z",
  serverNow: "2026-11-20T11:56:00.000Z",
  ready: true,
  about: null,
  watchSeconds: 120,
  askEverySeconds: 2,
  countdownSeconds: 60,
  words,
};

describe("what the call's screen is sent before anyone enters", () => {
  it("is taken when whole", () => {
    expect(isRoom(room)).toBe(true);
    expect(isRoom({ ...room, role: "host", about: { title: "About Sam", text: "Likes roses." } })).toBe(true);
  });
  it("is not taken with a sentence missing, a time that is none, or no name", () => {
    for (const name of ROOM_WORD_NAMES) expect(isRoom({ ...room, words: { ...words, [name]: undefined } })).toBe(false);
    expect(isRoom({ ...room, words: { ...words, join: "" } })).toBe(false);
    expect(isRoom({ ...room, endsAt: "soon" })).toBe(false);
    expect(isRoom({ ...room, other: " " })).toBe(false);
    expect(isRoom({ ...room, id: "7" })).toBe(false);
    expect(isRoom({ ...room, watchSeconds: 0 })).toBe(false);
    expect(isRoom({ ...room, ready: "yes" })).toBe(false);
    expect(isRoom(null)).toBe(false);
  });
});

describe("the entry pass", () => {
  const pass = { token: "aaa.bbb.ccc", serverUrl: "wss://connect.livekit.cloud", endsAt: room.endsAt, serverNow: room.serverNow };
  it("is a pass and a locked address of a video service", () => {
    expect(isPass(pass)).toBe(true);
    expect(isPass({ ...pass, serverUrl: "wss://video.example.com:7443/" })).toBe(true);
  });
  it("is not taken with an address that is not locked, that is a web page, or that carries more than a name", () => {
    expect(isPass({ ...pass, serverUrl: "ws://video.example.com" })).toBe(false);
    expect(isPass({ ...pass, serverUrl: "https://video.example.com" })).toBe(false);
    expect(isPass({ ...pass, serverUrl: "wss://user:word@video.example.com" })).toBe(false);
    expect(isPass({ ...pass, serverUrl: "wss://video.example.com/room?x=1" })).toBe(false);
    expect(isPass({ ...pass, token: "" })).toBe(false);
    expect(isPass({ ...pass, token: "not a pass" })).toBe(false);
    expect(isPass({ ...pass, endsAt: null })).toBe(false);
  });
  it("a plain address is only taken where a test build says so", () => {
    expect(isPass({ ...pass, serverUrl: "ws://localhost:7880" }, { plain: true })).toBe(true);
  });
});

describe("where a call stands, and the end of a call", () => {
  it("is read only when whole", () => {
    expect(isLive({ endsAt: room.endsAt, serverNow: room.serverNow, cancelled: false, safetyEnded: false })).toBe(true);
    expect(isLive({ endsAt: room.endsAt, serverNow: room.serverNow, cancelled: false })).toBe(false);
    expect(isLive({ endsAt: "x", serverNow: room.serverNow, cancelled: false, safetyEnded: false })).toBe(false);
    expect(isEnded({ ended: true, closed: true })).toBe(true);
    expect(isEnded({ ended: true, closed: false })).toBe(true);
    expect(isEnded({ ended: true })).toBe(false);
    expect(isEnded({ ended: "yes", closed: true })).toBe(false);
    expect(isEnded({})).toBe(false);
  });
  it('the screen after "End call now" is read only with its lines and all three choices', () => {
    const screen = {
      title: "The call has ended",
      lines: ["You ended this call for both of you. Nobody can come back in."],
      what: "Is there anything else you want to do?",
      report: { label: "Report Maya", what: "Tell us what happened.", money: null },
      block: { label: "Block Maya", what: "Maya can no longer ask you for calls.", done: false, doneWords: "You have blocked Maya.", sure: "Maya can no longer ask you for calls.", yes: "Block", no: "Not now" },
      neither: { label: "Neither", what: "Nothing else happens." },
    };
    expect(isEndedScreen(screen)).toBe(true);
    expect(isEndedScreen({ ...screen, report: { ...screen.report, money: "If you report Maya, this call is charged only for the time it lasted." } })).toBe(true);
    expect(isEndedScreen({ ...screen, lines: [] })).toBe(true);
    expect(isEndedScreen({ ...screen, lines: [""] })).toBe(false);
    expect(isEndedScreen({ ...screen, report: { ...screen.report, money: "" } })).toBe(false);
    expect(isEndedScreen({ ...screen, block: { ...screen.block, done: "no" } })).toBe(false);
    expect(isEndedScreen({ ...screen, block: { ...screen.block, sure: " " } })).toBe(false);
    expect(isEndedScreen({ ...screen, neither: undefined })).toBe(false);
    expect(isEndedScreen(null)).toBe(false);
    expect(isBlocked({ notice: "Blocked." })).toBe(true);
    expect(isBlocked({ notice: " " })).toBe(false);
    expect(isBlocked({})).toBe(false);
  });
  it("the end only ever moves later", () => {
    const known = Date.parse(room.endsAt);
    expect(laterEnd(known, "2026-11-20T12:40:00.000Z")).toBe(Date.parse("2026-11-20T12:40:00.000Z"));
    expect(laterEnd(known, "2026-11-20T12:20:00.000Z")).toBe(known);
    expect(laterEnd(known, "never")).toBe(known);
  });
});

describe("the clock line", () => {
  const clock = { startsIn: "Starts in", timeLeft: "Time left", endsIn: "This call ends in" };
  const startsAt = Date.parse(room.startsAt);
  const endsAt = Date.parse(room.endsAt);
  it("counts to the start, then the time left, then the last minute in the open", () => {
    expect(clockLine(clock, { now: startsAt - 250_000, startsAt, endsAt, countdownSeconds: 60 })).toEqual({ text: "Starts in 4:10", last: false });
    expect(clockLine(clock, { now: startsAt, startsAt, endsAt, countdownSeconds: 60 })).toEqual({ text: "Time left 30:00", last: false });
    expect(clockLine(clock, { now: endsAt - 45_000, startsAt, endsAt, countdownSeconds: 60 })).toEqual({ text: "This call ends in 0:45", last: true });
    expect(clockLine(clock, { now: endsAt + 5_000, startsAt, endsAt, countdownSeconds: 60 })).toEqual({ text: "This call ends in 0:00", last: true });
  });
});

describe("the report form", () => {
  const form = { title: "Report", stopped: null, words: "Tell us what happened.", rules: { before: "Read the ", link: "rules", after: "." }, what: "What happened?", choose: "Choose a reason", reasons: [{ key: "other", label: "Something else" }], more: "Tell us more (optional)", textMax: 2000, send: "Send report", danger: "If someone is in danger…" };
  it("is taken when whole, and not without reasons", () => {
    expect(isReportForm(form)).toBe(true);
    expect(isReportForm({ ...form, stopped: "The call has been ended for both of you." })).toBe(true);
    expect(isReportForm({ ...form, reasons: [] })).toBe(false);
    expect(isReportForm({ ...form, reasons: [{ key: "", label: "x" }] })).toBe(false);
    expect(isReportForm({ ...form, rules: null })).toBe(false);
    expect(isReportSent({ notice: "Thank you. Your report is R-12." })).toBe(true);
    expect(isReportSent({ notice: " " })).toBe(false);
  });
  it("is opened from exactly one place", () => {
    expect(reportPlace({ call: ID })).toEqual({ place: "call", id: ID });
    expect(reportPlace({ profile: "maya-g" })).toEqual({ place: "profile", id: "maya-g" });
    expect(reportPlace({ call: ID, booking: ID })).toBeNull();
    expect(reportPlace({})).toBeNull();
    expect(reportPlace({ profile: "../admin" })).toBeNull();
    expect(reportPlace({ call: ["a", "b"] })).toBeNull();
    // A call and a request are named by an id, never by anything shorter.
    expect(reportPlace({ call: "abc" })).toBeNull();
    // A link that names two places is not guessed at, even if only one of them is real.
    expect(reportPlace({ call: "abc", profile: "maya-g" })).toBeNull();
    expect(reportPlace({ booking: "maya-g" })).toBeNull();
    expect(reportPlace({ booking: ID })).toEqual({ place: "booking", id: ID });
  });
});

describe("whether it is the moment for the call's own screen", () => {
  const opensAt = Date.parse("2026-11-20T11:55:00.000Z");
  const endsAt = Date.parse("2026-11-20T12:30:00.000Z");
  const during = Date.parse("2026-11-20T12:10:00.000Z");
  const going = { cancelled: false, safetyEnded: false };
  const at = { ready: true, opensAt, now: during, endsAt, inCall: false, live: null };

  it("a room that is open and ready is the moment; one that is not open yet, or not ready, is not", () => {
    expect(notTheMoment(at)).toBe(false);
    expect(notTheMoment({ ...at, now: opensAt - 1 })).toBe(true);
    expect(notTheMoment({ ...at, ready: false })).toBe(true);
  });

  it("a fresh \"not ready\" wins also after the screen has asked where the call stands: no camera check for a room nobody can enter", () => {
    // Someone who was on this screen, left it, and comes back while the other person's account is paused.
    expect(notTheMoment({ ...at, ready: false, live: going })).toBe(true);
    expect(notTheMoment({ ...at, ready: true, live: going })).toBe(false);
  });

  it("someone who holds an entry pass is in the call, whatever an earlier answer said", () => {
    expect(notTheMoment({ ...at, ready: false, inCall: true })).toBe(false);
    expect(notTheMoment({ ...at, ready: false, inCall: true, live: going })).toBe(false);
  });

  it("a call that is over as far as the screen knows stays on this screen, which leads on from there", () => {
    expect(notTheMoment({ ...at, ready: false, live: { cancelled: false, safetyEnded: true } })).toBe(false);
    expect(notTheMoment({ ...at, ready: false, live: { cancelled: true, safetyEnded: false } })).toBe(false);
    expect(notTheMoment({ ...at, ready: false, now: endsAt, live: going })).toBe(false);
    // Before the screen has asked anything, a call that was over when it was opened belongs to the call's page.
    expect(notTheMoment({ ...at, ready: false, now: endsAt })).toBe(true);
  });
});
