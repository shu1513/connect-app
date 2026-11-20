import { describe, expect, it } from "vitest";
import { splitCharge } from "@/lib/payments/pricing";
import { CONTRIBUTION, ContributionError } from "./rules";
import { chargeFor, feeFor, MAX_TIP_CENTS, mayTip, readTip, TIP, TIP_FEE_TERMS, tipSentences, whyNoTip, type TipFacts } from "./tip-rules";

const share = (chargeCents: number) => splitCharge(chargeCents, TIP_FEE_TERMS, false).hostShareCents;

describe("what the customer pays for a tip", () => {
  it("is the plan's three examples", () => {
    expect(chargeFor(200)).toBe(237);
    expect(chargeFor(500)).toBe(546);
    expect(chargeFor(1000)).toBe(1061);
    expect(feeFor(500)).toBe(46);
  });
  it("leaves the host exactly the tip, for every tip from $2.00 to $3,000.00, and is the smallest amount that does", () => {
    for (let tip = TIP.minCents; tip <= 300_000; tip++) {
      const charge = chargeFor(tip);
      if (share(charge) !== tip || share(charge - 1) >= tip) throw new Error(`a tip of ${tip} cents: ${charge} is paid, ${share(charge)} reaches the host, ${share(charge - 1)} would with one cent less`);
    }
  });
  it("does so for large tips too, up to the largest", () => {
    for (const tip of [1_000_000, 2_500_001, 5_000_000, 9_000_000, MAX_TIP_CENTS - 1, MAX_TIP_CENTS]) expect(share(chargeFor(tip)), String(tip)).toBe(tip);
  });
  it("takes nothing extra from the host for a card from outside the United States", () => {
    expect(splitCharge(546, TIP_FEE_TERMS, true).hostShareCents).toBe(500);
  });
  it("has a largest tip whose payment is within the ceiling of a card payment, and the next cent is not", () => {
    expect(MAX_TIP_CENTS).toBe(9_709_970);
    expect(chargeFor(MAX_TIP_CENTS)).toBeLessThanOrEqual(CONTRIBUTION.maxCents);
    expect(chargeFor(MAX_TIP_CENTS + 1)).toBeGreaterThan(CONTRIBUTION.maxCents);
  });
});

describe("reading a typed tip", () => {
  it("takes dollars, with or without cents", () => {
    expect(readTip("2")).toBe(200);
    expect(readTip(" 7.5 ")).toBe(750);
    expect(readTip("$1,000.00")).toBe(100_000);
    expect(readTip("97,099.70")).toBe(MAX_TIP_CENTS);
  });
  it("refuses less than $2 and more than the largest, in words for the person", () => {
    expect(() => readTip("1.99")).toThrow(/smallest tip is \$2/);
    expect(() => readTip("0")).toThrow(ContributionError);
    expect(() => readTip("97099.71")).toThrow(/largest tip is \$97,099\.70/);
    expect(() => readTip("99999999999")).toThrow(/largest tip/);
  });
  it("refuses what is not an amount", () => {
    for (const typed of ["", "ten", "5.555", "-5", "5,00", "5 dollars", "1e3", "5.", ".50", "$"]) expect(() => readTip(typed), typed).toThrow(ContributionError);
  });
});

describe("who may give a tip", () => {
  const good: TipFacts = { role: "customer", rating: "open", reported: false, blocked: false, refundAsked: false, stars: null, tipThere: false, hostCanReceive: true, customerActive: true, tipsOn: true, stripeReady: true, projectBoxShown: false };
  it("the customer of a call that took place, with no rating yet", () => {
    expect(mayTip(good)).toBe(true);
  });
  it("also after 4 or 5 stars, and not after 1, 2 or 3", () => {
    expect(mayTip({ ...good, stars: 5 })).toBe(true);
    expect(mayTip({ ...good, stars: 4 })).toBe(true);
    for (const stars of [1, 2, 3]) expect(whyNoTip({ ...good, stars }), String(stars)).toBe("stars");
  });
  it("never the host, the founder looking on, or someone who was not on the call", () => {
    for (const role of ["host", "admin", null] as const) expect(whyNoTip({ ...good, role }), String(role)).toBe("not_the_customer");
  });
  it("only for a call that can be rated: not before its record is final, not after its 7 days, never a call that did not take place", () => {
    for (const rating of ["not_yet", "too_late", "never"] as const) expect(whyNoTip({ ...good, rating }), rating).toBe("call");
  });
  it("not after a report, a block or a refund request", () => {
    expect(whyNoTip({ ...good, reported: true })).toBe("trouble");
    expect(whyNoTip({ ...good, blocked: true })).toBe("trouble");
    expect(whyNoTip({ ...good, refundAsked: true })).toBe("trouble");
  });
  it("not while there is a tip for the call", () => {
    expect(whyNoTip({ ...good, tipThere: true })).toBe("tip_there");
  });
  it("not while tips are off, Stripe is not set up, the host cannot receive one, or the customer is paused", () => {
    expect(whyNoTip({ ...good, tipsOn: false })).toBe("off");
    expect(whyNoTip({ ...good, stripeReady: false })).toBe("off");
    expect(whyNoTip({ ...good, hostCanReceive: false })).toBe("host");
    expect(whyNoTip({ ...good, customerActive: false })).toBe("paused");
  });
  it("not when the box about the host's project is shown", () => {
    expect(whyNoTip({ ...good, projectBoxShown: true })).toBe("project");
  });
});

describe("the sentences before paying", () => {
  it("say the total, the tip, the fee, and that the host gets the whole tip", () => {
    const [first, second] = tipSentences({ tipCents: 500, hostName: "Hana", callOn: "3 November" });
    expect(first).toBe("You pay $5.46, once: a tip of $5.00 for your call with Hana on 3 November, and a payment fee of 46 cents.");
    expect(second).toContain("Hana receives the whole $5.00. Connect keeps nothing of it");
  });
  it("write a fee of a dollar or more as dollars", () => {
    expect(tipSentences({ tipCents: 5000, hostName: "Hana", callOn: "3 November" })[0]).toContain("a payment fee of $1.80.");
  });
});
