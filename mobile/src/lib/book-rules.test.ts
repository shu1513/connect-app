import { chosenTime, isBooking, isBookSummary, isCardStep, isId, isIdentity, isStripeCheckPage, requestScreen, sameId, tickedFor } from "./book-rules";

const ID = "157202f9-5fd5-49e8-a4b7-e80af19ab4e8";
const summary = {
  kind: "ok",
  title: "Ask Maya for a call",
  startsAt: "2026-11-21T17:00:00.000Z",
  minutes: 30,
  hostTime: "For Maya: Saturday, November 21 at 11:00 AM CST",
  price: "$40.00 at most ($20.00 per 15 minutes)",
  what: "A private one-to-one video call.",
  pointsTitle: "Request this time, subject to Maya's approval",
  points: [[{ bold: "This is a request, not a reservation." }, " Others may ask too."], ["You will have an answer by ", { time: "2026-11-21T14:18:00.913Z" }, "."]],
  note: { label: "What would you like to talk about?", max: 300 },
  cardTerms: "I allow Connect to save my card…",
  idLine: null,
  button: "Continue to card details",
  requestKey: ID,
  seen: { price: 2000, freeCancel: 60 },
};
const booking = {
  id: ID,
  title: "Your request to Maya",
  hostHandle: "maya",
  stage: "card",
  stageWords: "Almost there: enter your card to send the request.",
  reason: null,
  startsAt: "2026-11-21T17:00:00.000Z",
  minutes: 30,
  price: { label: "Price", words: "$40.00 at most" },
  hearBy: null,
  card: { title: "Your card", words: "Nothing is held or charged now.", button: "Save card and send request", deadline: ["Enter your card by ", { time: "2026-11-20T14:48:03.800Z" }, "."], givenUp: "a", notSaved: "b", notConfirmed: "c" },
  waitingWords: null,
  takeBack: null,
  takeBackSure: null,
  call: null,
  refreshSeconds: null,
  notice: null,
};

describe("what a customer reads before asking", () => {
  it("takes each of the four answers", () => {
    expect(isBookSummary(summary)).toBe(true);
    expect(isBookSummary({ kind: "gone", title: "That time is no longer open", button: "Choose another time" })).toBe(true);
    expect(isBookSummary({ kind: "own", title: "This is your own page", words: "You cannot book a call with yourself." })).toBe(true);
    expect(isBookSummary({ kind: "confirm_id", title: "One thing first", words: "…", small: "…", button: "Confirm who I am" })).toBe(true);
  });
  it("refuses an answer with a part missing or of the wrong kind", () => {
    expect(isBookSummary(null)).toBe(false);
    expect(isBookSummary({ ...summary, kind: "else" })).toBe(false);
    expect(isBookSummary({ ...summary, requestKey: "again" })).toBe(false);
    expect(isBookSummary({ ...summary, seen: { price: "2000", freeCancel: 60 } })).toBe(false);
    expect(isBookSummary({ ...summary, points: [[{ time: "soon" }]] })).toBe(false);
    expect(isBookSummary({ ...summary, points: [[{ link: "https://example.com" }]] })).toBe(false);
    expect(isBookSummary({ ...summary, cardTerms: undefined })).toBe(false);
    expect(isBookSummary({ ...summary, startsAt: "soon" })).toBe(false);
  });
});

describe("what a tick of the card box was given for", () => {
  it("is the same while nothing that was agreed to changes", () => {
    expect(tickedFor(summary as never)).not.toBeNull();
    expect(tickedFor({ ...summary, requestKey: "257202f9-5fd5-49e8-a4b7-e80af19ab4e8", points: [] } as never)).toBe(tickedFor(summary as never));
  });
  it("is another as soon as the price, the cancelling rule, the words, the time or the length does", () => {
    const was = tickedFor(summary as never);
    expect(tickedFor({ ...summary, seen: { price: 3000, freeCancel: 60 } } as never)).not.toBe(was);
    expect(tickedFor({ ...summary, seen: { price: 2000, freeCancel: 1440 } } as never)).not.toBe(was);
    expect(tickedFor({ ...summary, cardTerms: "I allow Connect to hold up to $60.00…" } as never)).not.toBe(was);
    expect(tickedFor({ ...summary, price: "$60.00 at most ($30.00 per 15 minutes)" } as never)).not.toBe(was);
    expect(tickedFor({ ...summary, startsAt: "2026-11-22T17:00:00.000Z" } as never)).not.toBe(was);
    expect(tickedFor({ ...summary, minutes: 15 } as never)).not.toBe(was);
  });
  it("is nothing for a free call, and for anything that is not a summary to send", () => {
    expect(tickedFor({ ...summary, cardTerms: null } as never)).toBeNull();
    expect(tickedFor({ kind: "gone", title: "That time is no longer open", button: "Choose another time" })).toBeNull();
    expect(tickedFor(null)).toBeNull();
  });
});

describe("a request's page", () => {
  it("takes a page at the card step and one that waits", () => {
    expect(isBooking(booking)).toBe(true);
    const sure = { words: "The host will no longer be able to accept it.", yes: "Take it back", no: "Keep it" };
    expect(isBooking({ ...booking, stage: "waiting", card: null, hearBy: "2026-11-21T14:18:00.913Z", takeBack: "Take this request back", takeBackSure: sure, refreshSeconds: 20, waitingWords: "…" })).toBe(true);
    expect(isBooking({ ...booking, stage: "accepted", card: null, call: { id: ID } })).toBe(true);
    // A button to take it back without the question to ask first is not taken.
    expect(isBooking({ ...booking, stage: "waiting", card: null, takeBack: "Take this request back", takeBackSure: null })).toBe(false);
  });
  it("refuses an answer with a part missing or of the wrong kind", () => {
    expect(isBooking({ ...booking, id: "../start" })).toBe(false);
    expect(isBooking({ ...booking, card: { ...booking.card, deadline: "soon" } })).toBe(false);
    expect(isBooking({ ...booking, card: { title: "Your card" } })).toBe(false);
    expect(isBooking({ ...booking, refreshSeconds: 0 })).toBe(false);
    expect(isBooking({ ...booking, call: { id: "x" } })).toBe(false);
    expect(isBooking({ ...booking, price: "$40.00" })).toBe(false);
  });
});

describe("what the card sheet is given", () => {
  const step = { clientSecret: "seti_1UdsdcDLvGtpPRHZvDqJ7QJ1_secret_VfD35J03bq3tMvByskUeoWnYUd", publishableKey: "pk_test_51Abc", merchant: "Connect" };
  it("takes a secret for saving a card and a key that may be shown", () => {
    expect(isCardStep(step)).toBe(true);
    expect(isCardStep({ ...step, publishableKey: "pk_live_51Abc" })).toBe(true);
  });
  it("never a secret for a payment, a secret key, or anything else", () => {
    expect(isCardStep({ ...step, clientSecret: "pi_1Uds_secret_VfD3" })).toBe(false);
    expect(isCardStep({ ...step, publishableKey: "sk_test_51Abc" })).toBe(false);
    expect(isCardStep({ ...step, publishableKey: "rk_live_51Abc" })).toBe(false);
    expect(isCardStep({ ...step, merchant: " " })).toBe(false);
    expect(isCardStep({ clientSecret: step.clientSecret })).toBe(false);
  });
});

describe("where an identity check stands", () => {
  it("takes the answer, and refuses one with a part missing", () => {
    const identity = { passed: false, pending: true, title: "Confirm who you are", words: ["…"], button: "Start a new check", tries: "2 of 3 tries left", small: "…" };
    expect(isIdentity(identity)).toBe(true);
    expect(isIdentity({ ...identity, button: null, tries: null })).toBe(true);
    expect(isIdentity({ ...identity, passed: "yes" })).toBe(false);
    expect(isIdentity({ ...identity, words: "…" })).toBe(false);
  });
});

describe("the only page opened for an identity check", () => {
  it("is Stripe's own, locked", () => {
    expect(isStripeCheckPage("https://verify.stripe.com/start/test_YWNjdF8x")).toBe(true);
  });
  it("and nothing else", () => {
    expect(isStripeCheckPage("http://verify.stripe.com/start/x")).toBe(false);
    expect(isStripeCheckPage("https://verify.stripe.com.example.com/start/x")).toBe(false);
    expect(isStripeCheckPage("https://example.com/verify.stripe.com")).toBe(false);
    expect(isStripeCheckPage("https://someone@verify.stripe.com/start/x")).toBe(false);
    expect(isStripeCheckPage("https://verify.stripe.com:8443/start/x")).toBe(false);
    expect(isStripeCheckPage("connect://identity")).toBe(false);
    expect(isStripeCheckPage("javascript:alert(1)")).toBe(false);
    expect(isStripeCheckPage(null)).toBe(false);
  });
});

describe("addresses the app makes itself", () => {
  it("an id has exactly the shape the server gives its ids", () => {
    expect(isId(ID)).toBe(true);
    expect(isId("------------------------------------")).toBe(false);
    expect(isId("157202f95fd549e8a4b7e80af19ab4e8----")).toBe(false);
    expect(sameId(ID.toUpperCase())).toBe(ID);
    expect(sameId("soon")).toBe("");
    expect(isId("157202f9-5fd5-49e8-a4b7-e80af19ab4e8/card")).toBe(false);
    expect(isId("../../start")).toBe(false);
    expect(isId(undefined)).toBe(false);
  });
  it("the card sheet comes back to the request's own screen", () => {
    expect(requestScreen("connect", ID)).toBe(`connect://bookings/${ID}`);
    expect(requestScreen("connect", "x")).toBeNull();
    expect(requestScreen("https://example.com/?", ID)).toBeNull();
  });
  it("a chosen time is a moment and a whole length", () => {
    expect(chosenTime("2026-11-21T17:00:00.000Z", "30")).toEqual({ start: "2026-11-21T17:00:00.000Z", length: 30 });
    expect(chosenTime("soon", "30")).toBeNull();
    expect(chosenTime("2026-11-21T17:00:00.000Z", "half an hour")).toBeNull();
    expect(chosenTime("2026-11-21T17:00:00.000Z", ["30"])).toBeNull();
    expect(chosenTime(undefined, undefined)).toBeNull();
  });
});
