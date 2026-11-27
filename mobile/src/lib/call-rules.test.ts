import { callScreen, isCallPage, isCalls, isPayStep } from "./call-rules";

const ID = "157202f9-5fd5-49e8-a4b7-e80af19ab4e8";
const page = {
  id: ID,
  role: "customer",
  title: "Call with Maya",
  roleWords: "(you are the customer)",
  startsAt: "2026-11-21T17:00:00.000Z",
  endsAt: "2026-11-21T17:30:00.000Z",
  paidHow: "$20.00 per 15 minutes, up to $40.00",
  serverNow: "2026-11-20T17:00:00.000Z",
  state: "room",
  words: null,
  small: null,
  pay: null,
  room: { opensAt: "2026-11-21T16:55:00.000Z", open: false, enter: "Go to the call" },
  about: null,
  cancel: { words: "Cancelling now is free. Nothing is charged.", button: "Cancel this call", shown: "free", yes: "Cancel the call", no: "Keep it" },
  afterEnd: null,
  refreshSeconds: 30,
  notice: null,
};
const pay = { title: "Confirm and pay", points: [["This call costs $20.00 per 15 minutes, up to ", { bold: "$40.00" }, " in total."]], button: "Hold $40.00 and confirm the call", givenUp: "a", notHeld: "b", notConfirmed: "c", checkAgain: "Check again" };

describe("a call's page", () => {
  it("takes each kind of page", () => {
    expect(isCallPage(page)).toBe(true);
    expect(isCallPage({ ...page, state: "pay", room: null, pay })).toBe(true);
    expect(isCallPage({ ...page, state: "too_early", room: null, words: ["You can confirm and pay for this call from ", { time: "2026-11-19T17:00:00.000Z" }, "."], small: "That is 2 days before it starts." })).toBe(true);
    expect(isCallPage({ ...page, state: "cancelled", room: null, cancel: null, refreshSeconds: null, words: ["This call was cancelled."], notice: "The call was cancelled. Nothing is charged." })).toBe(true);
    expect(isCallPage({ ...page, role: "host", about: { title: "About Cory", text: "Likes mornings." } })).toBe(true);
    // A call that is over carries the way to "Report", "Block" and "Neither"; no other state does.
    const over = { ...page, state: "ended", room: null, cancel: null, refreshSeconds: null, words: ["This call has ended."] };
    expect(isCallPage({ ...over, afterEnd: { label: "Report or block Maya" } })).toBe(true);
    expect(isCallPage({ ...over, afterEnd: null })).toBe(true);
    expect(isCallPage({ ...over, afterEnd: { label: "" } })).toBe(false);
    expect(isCallPage({ ...page, afterEnd: { label: "Report or block Maya" } })).toBe(false);
    expect(isCallPage({ ...over, afterEnd: undefined })).toBe(false);
  });
  it("refuses a page with a part missing, of the wrong kind, or that does not go with its state", () => {
    expect(isCallPage(null)).toBe(false);
    expect(isCallPage({ ...page, id: "../start" })).toBe(false);
    expect(isCallPage({ ...page, state: "paid" })).toBe(false);
    // A pay step without the state for it, and the state without the step.
    expect(isCallPage({ ...page, pay })).toBe(false);
    expect(isCallPage({ ...page, state: "pay", room: null, pay: null })).toBe(false);
    // The room with another state.
    expect(isCallPage({ ...page, state: "blocked" })).toBe(false);
    expect(isCallPage({ ...page, cancel: { ...page.cancel, shown: "maybe" } })).toBe(false);
    expect(isCallPage({ ...page, words: [{ link: "https://example.com" }] })).toBe(false);
    expect(isCallPage({ ...page, refreshSeconds: 0 })).toBe(false);
  });
});

describe("a page of calls", () => {
  const call = { id: ID, startsAt: "2026-11-21T17:00:00.000Z", endsAt: "2026-11-21T17:30:00.000Z", minutes: 30, name: "Maya", photoId: null, hosting: false, open: false, finished: false, payment: "Free", status: null };
  const calls = { kind: "coming", serverNow: "2026-11-20T17:00:00.000Z", title: "Coming calls", calls: [call], page: 1, more: false, empty: null };
  it("takes coming and past calls", () => {
    expect(isCalls(calls)).toBe(true);
    expect(isCalls({ ...calls, kind: "past", calls: [{ ...call, finished: true, status: "Cancelled" }] })).toBe(true);
    expect(isCalls({ ...calls, calls: [], empty: "You have no call coming up." })).toBe(true);
  });
  it("refuses a page with a part missing or of the wrong kind", () => {
    expect(isCalls({ ...calls, kind: "all" })).toBe(false);
    expect(isCalls({ ...calls, page: 0 })).toBe(false);
    expect(isCalls({ ...calls, calls: [{ ...call, id: "x" }] })).toBe(false);
    expect(isCalls({ ...calls, calls: [{ ...call, status: 5 }] })).toBe(false);
  });
});

describe("what the card sheet is given to place a hold", () => {
  const step = { clientSecret: "pi_MadeUp123_secret_MadeUp456", publishableKey: "pk_test_51Abc", merchant: "Connect" };
  it("takes a payment's secret and a key that may be shown", () => {
    expect(isPayStep(step)).toBe(true);
  });
  it("never a secret for saving a card, a secret key, or anything else", () => {
    expect(isPayStep({ ...step, clientSecret: "seti_1Uds_secret_VfD3" })).toBe(false);
    expect(isPayStep({ ...step, publishableKey: "sk_test_51Abc" })).toBe(false);
    expect(isPayStep({ ...step, merchant: "" })).toBe(false);
    expect(isPayStep({ alreadyHeld: true })).toBe(false);
  });
});

describe("where the card sheet comes back to", () => {
  it("is the call's own screen", () => {
    expect(callScreen("connect", ID)).toBe(`connect://calls/${ID}`);
    expect(callScreen("connect", "x")).toBeNull();
    expect(callScreen("https://example.com/?", ID)).toBeNull();
  });
});
