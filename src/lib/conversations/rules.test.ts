import { describe, expect, it } from "vitest";
import { callsThatCount, callTerms, CONVERSATION, type Facts, hostWokeIt, isSendKey, limitProblem, mayWrite, OPEN_MS, type PairCall, tidyMessage } from "./rules";
import { limitWords, refusalWords } from "./words";

const now = new Date("2026-12-01T12:00:00.000Z");
const ago = (ms: number) => new Date(now.getTime() - ms);

/** A pair who have talked, with nothing in the way, outside a call, and no message from the host yet. */
const base: Facts = {
  role: "host",
  switchOn: true,
  blockedByMe: false,
  blockedByOther: false,
  paused: false,
  closed: false,
  otherClosed: false,
  aroundCall: false,
  talked: true,
  hostPagePublic: true,
  muted: false,
  hostLastWroteAt: null,
};
const host = (over: Partial<Facts> = {}): Facts => ({ ...base, role: "host", ...over });
const customer = (over: Partial<Facts> = {}): Facts => ({ ...base, role: "customer", ...over });

describe("around a call", () => {
  it("both may write, also two who have never talked, and it wakes nothing", () => {
    expect(mayWrite(host({ aroundCall: true, talked: false }), now)).toEqual({ ok: true, wakes: false });
    expect(mayWrite(customer({ aroundCall: true, talked: false }), now)).toEqual({ ok: true, wakes: false });
  });

  it("the customer's switch does not reach into a call", () => {
    expect(mayWrite(host({ aroundCall: true, muted: true }), now)).toEqual({ ok: true, wakes: false });
    expect(mayWrite(customer({ aroundCall: true, muted: true }), now)).toEqual({ ok: true, wakes: false });
  });

  it("a host whose page is not public still writes around a call", () => {
    expect(mayWrite(host({ aroundCall: true, hostPagePublic: false }), now)).toEqual({ ok: true, wakes: false });
  });
});

describe("the host, outside a call", () => {
  it("may write to someone she has talked with, and that wakes the conversation", () => {
    expect(mayWrite(host(), now)).toEqual({ ok: true, wakes: true });
  });

  it("never to someone she has not talked with", () => {
    expect(mayWrite(host({ talked: false }), now)).toEqual({ ok: false, why: "closed" });
    // Not even with a recent message of hers on record (a first call that was cancelled, decision 8).
    expect(mayWrite(host({ talked: false, hostLastWroteAt: ago(1000) }), now)).toEqual({ ok: false, why: "closed" });
  });

  it("a second message inside her own 7 days wakes nothing; one at exactly 7 days wakes again", () => {
    expect(mayWrite(host({ hostLastWroteAt: ago(OPEN_MS - 1000) }), now)).toEqual({ ok: true, wakes: false });
    expect(mayWrite(host({ hostLastWroteAt: ago(OPEN_MS) }), now)).toEqual({ ok: true, wakes: true });
  });

  it("is refused when the customer switched her off, and when her page is not public", () => {
    expect(mayWrite(host({ muted: true }), now)).toEqual({ ok: false, why: "not_taking" });
    expect(mayWrite(host({ hostPagePublic: false }), now)).toEqual({ ok: false, why: "page_not_public" });
    // His switch is said first: it must not depend on her page what she is told about him.
    expect(mayWrite(host({ muted: true, hostPagePublic: false }), now)).toEqual({ ok: false, why: "not_taking" });
  });
});

describe("the customer, outside a call", () => {
  it("cannot wake a quiet conversation", () => {
    expect(mayWrite(customer(), now)).toEqual({ ok: false, why: "book_again" });
  });

  it("may answer while the host's latest message is less than 7 days old, to the second", () => {
    expect(mayWrite(customer({ hostLastWroteAt: ago(OPEN_MS - 1000) }), now)).toEqual({ ok: true, wakes: false });
    expect(mayWrite(customer({ hostLastWroteAt: ago(OPEN_MS) }), now)).toEqual({ ok: false, why: "book_again" });
    expect(mayWrite(customer({ hostLastWroteAt: ago(OPEN_MS + 1000) }), now)).toEqual({ ok: false, why: "book_again" });
  });

  it("may still answer a host whose page was hidden since", () => {
    expect(mayWrite(customer({ hostLastWroteAt: ago(1000), hostPagePublic: false }), now)).toEqual({ ok: true, wakes: false });
  });

  it("not when they have not talked, whatever she wrote", () => {
    expect(mayWrite(customer({ talked: false, hostLastWroteAt: ago(1000) }), now)).toEqual({ ok: false, why: "book_again" });
  });

  it("with his own switch on he is told so, and can write only around a call", () => {
    expect(mayWrite(customer({ muted: true, hostLastWroteAt: ago(1000) }), now)).toEqual({ ok: false, why: "you_muted" });
    // Two who have not talked have no switch to speak of: the conversation is simply closed.
    expect(mayWrite(customer({ muted: true, talked: false }), now)).toEqual({ ok: false, why: "book_again" });
  });
});

describe("what stops everybody", () => {
  it("the founder's switch comes first, also around a call", () => {
    for (const facts of [host({ aroundCall: true }), customer({ aroundCall: true }), host({ blockedByMe: true })]) {
      expect(mayWrite({ ...facts, switchOn: false }, now)).toEqual({ ok: false, why: "switched_off" });
    }
  });

  it("a block, in either direction, also around a call", () => {
    expect(mayWrite(host({ aroundCall: true, blockedByMe: true }), now)).toEqual({ ok: false, why: "you_blocked" });
    expect(mayWrite(customer({ aroundCall: true, blockedByMe: true }), now)).toEqual({ ok: false, why: "you_blocked" });
    expect(mayWrite(host({ aroundCall: true, blockedByOther: true }), now)).toEqual({ ok: false, why: "not_taking" });
    expect(mayWrite(customer({ aroundCall: true, blockedByOther: true }), now)).toEqual({ ok: false, why: "closed" });
  });

  it("a blocked host and a switched-off host get the same answer and the same sentence", () => {
    const blocked = mayWrite(host({ blockedByOther: true }), now);
    const muted = mayWrite(host({ muted: true }), now);
    expect(blocked).toEqual(muted);
    expect(blocked).toEqual({ ok: false, why: "not_taking" });
    expect(refusalWords("not_taking", "Cory")).toBe("Cory is not taking messages right now.");
  });

  it("a blocked person is never told so when they are paused as well", () => {
    expect(mayWrite(host({ blockedByOther: true, paused: true }), now)).toEqual({ ok: false, why: "not_taking" });
  });

  it("a blocked host and a switched-off host get the same answer whatever else is true of her", () => {
    // Also when the two no longer count as having talked (after "End call and report") and his switch is still on.
    for (const more of [{ paused: true }, { hostPagePublic: false }, { otherClosed: true }, { closed: true }, { hostLastWroteAt: ago(1000) }, { talked: false }, { talked: false, paused: true }] as Partial<Facts>[]) {
      expect(mayWrite(host({ ...more, muted: true }), now)).toEqual(mayWrite(host({ ...more, blockedByOther: true }), now));
      expect(mayWrite(host({ ...more, muted: true }), now)).toEqual({ ok: false, why: "not_taking" });
    }
  });

  it("someone whose own account closed while their message waited cannot send it", () => {
    expect(mayWrite(host({ aroundCall: true, closed: true }), now)).toEqual({ ok: false, why: "closed" });
    expect(mayWrite(customer({ aroundCall: true, closed: true }), now)).toEqual({ ok: false, why: "closed" });
  });

  it("a paused account cannot write, and nobody can write to a closed one", () => {
    expect(mayWrite(host({ aroundCall: true, paused: true }), now)).toEqual({ ok: false, why: "paused" });
    expect(mayWrite(customer({ aroundCall: true, otherClosed: true }), now)).toEqual({ ok: false, why: "closed" });
  });
});

describe("hostWokeIt", () => {
  it("is false with no message, and true only inside the 7 days", () => {
    expect(hostWokeIt(null, now)).toBe(false);
    expect(hostWokeIt(ago(0), now)).toBe(true);
    expect(hostWokeIt(ago(OPEN_MS - 1), now)).toBe(true);
    expect(hostWokeIt(ago(OPEN_MS), now)).toBe(false);
  });
});

describe("the limits", () => {
  const none = { lastMinute: 0, lastDay: 0, inARow: 0, wakesLastDay: 0 };

  it("nothing is wrong below each limit", () => {
    expect(limitProblem({ lastMinute: CONVERSATION.perMinute - 1, lastDay: CONVERSATION.perDay - 1, inARow: CONVERSATION.inARow - 1, wakesLastDay: CONVERSATION.wakesPerDay - 1 }, true)).toBeNull();
  });

  it("each limit refuses the message that would pass it", () => {
    expect(limitProblem({ ...none, lastMinute: CONVERSATION.perMinute }, false)).toBe("minute");
    expect(limitProblem({ ...none, lastDay: CONVERSATION.perDay }, false)).toBe("day");
    expect(limitProblem({ ...none, inARow: CONVERSATION.inARow }, false)).toBe("in_a_row");
    expect(limitProblem({ ...none, wakesLastDay: CONVERSATION.wakesPerDay }, true)).toBe("wakes");
  });

  it("the count of wakes only matters for a message that wakes", () => {
    expect(limitProblem({ ...none, wakesLastDay: CONVERSATION.wakesPerDay }, false)).toBeNull();
  });

  it("every limit has a sentence", () => {
    for (const problem of ["minute", "day", "in_a_row", "wakes"] as const) expect(limitWords(problem, "Cory").length).toBeGreaterThan(10);
  });
});

describe("a message as it is kept", () => {
  it("keeps the words, makes line ends alike and trims the ends", () => {
    expect(tidyMessage("  Hello\r\nthere  \n")).toBe("Hello\nthere");
  });

  it("refuses nothing at all and anything too long", () => {
    expect(tidyMessage("   \n ")).toBeNull();
    expect(tidyMessage("a".repeat(CONVERSATION.maxChars))).toHaveLength(CONVERSATION.maxChars);
    expect(tidyMessage("a".repeat(CONVERSATION.maxChars + 1))).toBeNull();
  });

  it("a once-only key is a random id and nothing else", () => {
    expect(isSendKey("3f6c2a1e-9b7d-4c7e-8a55-0d9b1c2e3f40")).toBe(true);
    expect(isSendKey("short")).toBe(false);
    expect(isSendKey("has spaces in it, which no id has")).toBe(false);
  });
});

describe("every refusal has a sentence", () => {
  it("and none is empty", () => {
    for (const why of ["switched_off", "you_blocked", "not_taking", "closed", "paused", "page_not_public", "you_muted", "book_again"] as const) {
      expect(refusalWords(why, "Hana").length).toBeGreaterThan(10);
    }
  });
});

describe("the calls that count", () => {
  const call = (over: Partial<PairCall> = {}): PairCall => ({ source: "customer", begunAt: ago(30 * 24 * 3_600_000), agreedAt: ago(29 * 24 * 3_600_000), endsAt: ago(20 * 24 * 3_600_000), bothJoined: true, ...over });

  it("a booked call, a call now and a member's call count; a check script's never", () => {
    expect(callsThatCount([call(), call({ source: "now" }), call({ source: "member" }), call({ source: "admin" })], null)).toHaveLength(3);
  });

  it('after "End call and report" only a request begun after the press counts, and never a member\'s booking', () => {
    const stop = ago(10 * 24 * 3_600_000);
    const before = call({ begunAt: new Date(stop.getTime() - 1) });
    const atThePress = call({ begunAt: stop });
    const after = call({ begunAt: new Date(stop.getTime() + 1) });
    const nowAfter = call({ source: "now", begunAt: new Date(stop.getTime() + 1) });
    const memberAfter = call({ source: "member", begunAt: new Date(stop.getTime() + 1) });
    // A request that was begun before the press and agreed after it does not count either: only the first step is asked about.
    const agreedAfter = call({ begunAt: new Date(stop.getTime() - 1), agreedAt: new Date(stop.getTime() + 1000) });
    expect(callsThatCount([before, atThePress, after, nowAfter, memberAfter, agreedAfter], stop)).toEqual([after, nowAfter]);
  });

  it("around a call: from its agreement until 7 days after its booked end, to the second", () => {
    expect(callTerms([call({ endsAt: ago(OPEN_MS - 1000) })], now).aroundCall).toBe(true);
    expect(callTerms([call({ endsAt: ago(OPEN_MS) })], now).aroundCall).toBe(false);
    // A call booked for next week is around already.
    expect(callTerms([call({ endsAt: new Date(now.getTime() + 7 * 24 * 3_600_000), bothJoined: false })], now).aroundCall).toBe(true);
    // Any one call is enough.
    expect(callTerms([call(), call({ endsAt: ago(1000) })], now).aroundCall).toBe(true);
    expect(callTerms([], now)).toEqual({ aroundCall: false, talked: false, latestAgreedAt: null });
  });

  it("they have talked: a call that is over and that both joined, that same call", () => {
    expect(callTerms([call()], now).talked).toBe(true);
    expect(callTerms([call({ bothJoined: false })], now).talked).toBe(false);
    // Not over yet: both are in it right now.
    expect(callTerms([call({ endsAt: new Date(now.getTime() + 60_000) })], now).talked).toBe(false);
    // One call that is over and was missed, one that is still to come: no.
    expect(callTerms([call({ bothJoined: false }), call({ endsAt: new Date(now.getTime() + 60_000) })], now).talked).toBe(false);
  });

  it("the latest agreement is the latest of them, whatever their order", () => {
    const early = call({ agreedAt: ago(5000) });
    const late = call({ agreedAt: ago(1000) });
    expect(callTerms([late, early], now).latestAgreedAt).toEqual(late.agreedAt);
  });
});
