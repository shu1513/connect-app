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

  it("counts months of the calendar: 29 February a year on is 28 February", () => {
    const now = at("2029-02-28T12:00:00Z");
    expect(uncollectedDue(at("2028-02-28T11:59:59Z"), now)).toBe(true);
    expect(uncollectedDue(at("2028-02-29T12:00:00Z"), now)).toBe(false);
  });
});

describe("the next try after one that was written down", () => {
  it("is a week later, and at once when there was none", () => {
    expect(nextTryAt(null)).toBeNull();
    expect(nextTryAt(at("2027-11-21T10:00:00Z"))).toEqual(at("2027-11-28T10:00:00Z"));
  });
});

describe("what the host is told", () => {
  const nothing = { sent: null, charge: null, refused: null, checking: null, abroad: false };

  it("says why, what was sent in US dollars, the charge, and that she can collect herself", () => {
    const told = uncollectedWords({ ...nothing, sent: "$79.75", charge: "$0.25" });
    expect(told.subject).toBe("We sent you your earnings: $79.75");
    expect(told.text).toContain("You had not collected your earnings on Connect for more than 12 months.");
    expect(told.text).toContain("Sent to your Stripe payout account: $79.75, in US dollars.");
    expect(told.text).toContain("The collection charge that was taken: $0.25. The amount above is what was sent after it.");
    expect(told.text).toContain("Stripe pays what it received to your bank account.");
    expect(told.text).toContain('once in 24 hours, with "Collect earnings" on your Hosting page');
    expect(told.text).not.toContain("exchange rate");
    expect(told.text).not.toContain("Could not be sent");
    expect(told.text).not.toContain("Still being checked");
  });

  it("names a refused transfer as not sent, and an unfinished one as still being checked", () => {
    const told = uncollectedWords({ ...nothing, sent: "$12.38", refused: "$12.38", checking: "$12.38" });
    expect(told.text).toContain("Could not be sent: $12.38. Stripe refused it. It is still yours and stays ready to collect.");
    expect(told.text).toContain("Still being checked: $12.38. We have no clear answer from Stripe for it yet.");
    expect(told.text).not.toContain("The collection charge that was taken");
  });

  it("never says anything was sent when nothing was", () => {
    const refused = uncollectedWords({ ...nothing, refused: "$24.76" });
    expect(refused.subject).toBe("We tried to send you your earnings");
    expect(refused.text).toContain("Nothing was sent, and no collection charge was taken.");
    expect(refused.text).not.toContain("Stripe pays what it received");
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
