import { describe, expect, it, vi } from "vitest";

// The rules below are plain; the file they live in also talks to the database and to Stripe.
vi.mock("@/db", () => ({ db: {}, schema: {} }));
vi.mock("./collect", () => ({}));
vi.mock("./hosts", () => ({}));
vi.mock("@/lib/messages/messages", () => ({}));
vi.mock("@/lib/email", () => ({}));

import { nextTryAt, uncollectedDue } from "./uncollected";
import { STARTED_BY_CONNECT, uncollectedWords } from "./uncollected-words";

const at = (iso: string) => new Date(iso);

describe("when a host who has not collected is due", () => {
  it("is due only after more than 12 months, to the moment", () => {
    const now = at("2027-11-21T10:00:00Z");
    expect(uncollectedDue(at("2026-11-21T09:59:59Z"), now)).toBe(true);
    expect(uncollectedDue(at("2026-11-21T10:00:00Z"), now)).toBe(false);
    expect(uncollectedDue(at("2026-12-21T10:00:00Z"), now)).toBe(false);
  });

  it("is never due when she has nothing whose date has come", () => {
    expect(uncollectedDue(null, at("2027-11-21T10:00:00Z"))).toBe(false);
  });

  it("counts months of the calendar forward: 12 months after 29 February is 28 February", () => {
    const since = at("2028-02-29T12:00:00Z");
    expect(uncollectedDue(since, at("2029-02-28T12:00:00Z"))).toBe(false);
    expect(uncollectedDue(since, at("2029-02-28T12:00:01Z"))).toBe(true);
  });

  it("once due, stays due: 28 February at noon is still due on the morning of 29 February a year on", () => {
    const since = at("2027-02-28T12:00:00Z");
    expect(uncollectedDue(since, at("2028-02-28T18:00:00Z"))).toBe(true);
    expect(uncollectedDue(since, at("2028-02-29T09:00:00Z"))).toBe(true);
    expect(uncollectedDue(since, at("2028-03-01T09:00:00Z"))).toBe(true);
  });
});

describe("the next try after one that was written down", () => {
  it("is a week later, and at once when there was none", () => {
    expect(nextTryAt(null)).toBeNull();
    expect(nextTryAt(at("2027-11-21T10:00:00Z"))).toEqual(at("2027-11-28T10:00:00Z"));
  });
});

describe("what the host is told", () => {
  const nothing = { sent: null, charge: null, notSent: null, checking: null, checkingCharge: null, abroad: false };

  it("says why, what was sent in US dollars, the charge, and that she can collect herself", () => {
    const told = uncollectedWords({ ...nothing, sent: "$79.75", charge: "$0.25" });
    expect(told.subject).toBe("We sent you your earnings: $79.75");
    expect(told.text).toContain("You had not collected your earnings on Connect for more than 12 months.");
    expect(told.text).toContain("Sent to your Stripe payout account: $79.75, in US dollars.");
    expect(told.text).toContain("The collection charge that was taken: $0.25. The amount above is what was sent after it.");
    expect(told.text).toContain("Stripe pays what it received to your bank account.");
    expect(told.text).toContain('once in 24 hours, with "Collect earnings" on your Hosting page');
    expect(told.text).not.toContain("exchange rate");
    expect(told.text).not.toContain("Not sent");
    expect(told.text).not.toContain("Still being checked");
    expect(told.text).not.toContain("shows how things stand now");
  });

  it("names a share that did not go as not sent, and an unanswered one as still being checked, and promises nothing about either", () => {
    const told = uncollectedWords({ ...nothing, sent: "$12.38", notSent: "$12.38", checking: "$12.38" });
    expect(told.text).toContain("Not sent: $12.38. It is still yours.");
    expect(told.text).toContain("Still being checked: $12.38. We have no clear answer from Stripe for it yet. If it went through, it is in your Stripe payout account; if it did not, it is still yours.");
    expect(told.text).toContain('"Your earnings" on your Hosting page shows how things stand now, and what you can collect.');
    expect(told.text).not.toContain("The collection charge that was taken");
    // Why it did not go is not always known, and whether it can be collected later is not ours to promise.
    expect(told.text).not.toContain("refused");
    expect(told.text).not.toContain("stays ready");
  });

  it("names a collection charge whose share has no answer yet", () => {
    const withShare = uncollectedWords({ ...nothing, checking: "$12.13", checkingCharge: "$0.25" });
    expect(withShare.text).toContain("Still being checked: $12.13, with a collection charge of $0.25.");
    const chargeOnly = uncollectedWords({ ...nothing, sent: "$0.20", checkingCharge: "$0.20" });
    expect(chargeOnly.text).toContain("Still being checked: a collection charge of $0.20. We do not know yet whether it is taken.");
    expect(chargeOnly.text).not.toContain("The collection charge that was taken");
  });

  it("never says anything was sent when nothing was", () => {
    const notSent = uncollectedWords({ ...nothing, notSent: "$24.76" });
    expect(notSent.subject).toBe("We tried to send you your earnings");
    expect(notSent.text).toContain("Nothing was sent, and no collection charge was taken.");
    expect(notSent.text).not.toContain("Stripe pays what it received");
    const checking = uncollectedWords({ ...nothing, checking: "$12.13" });
    expect(checking.subject).toBe("We are sending you your earnings");
    expect(checking.text).toContain("Nothing is confirmed as sent yet.");
    expect(checking.text).not.toContain("Sent to your Stripe payout account");
  });

  it("tells a host in another country that Stripe turns the dollars into her own money", () => {
    const told = uncollectedWords({ ...nothing, sent: "$79.75", charge: "$0.25", abroad: true });
    expect(told.text).toContain("If your bank account is not in US dollars, Stripe turns the dollars into your own money when it pays your bank, at its exchange rate of that moment.");
  });

  it("has a sentence for her Hosting page", () => {
    expect(STARTED_BY_CONNECT).toContain("you had not collected for more than 12 months");
  });
});
