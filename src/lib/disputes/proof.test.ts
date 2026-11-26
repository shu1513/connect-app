import { describe, expect, it } from "vitest";
import { proofFrom, type CallFacts, type GiftFacts, type MonthFacts, type ProofFacts } from "./proof";

const at = (iso: string) => new Date(iso);

const call: CallFacts = {
  kind: "call",
  startsAt: at("2027-01-10T20:00:00Z"),
  endsAt: at("2027-01-10T20:10:00Z"),
  pricePer15Cents: 2000,
  bookedCents: 1333,
  addedTime: false,
  billing: "host",
  chargeReason: "attendance",
  endedByCustomerAt: null,
  charged: { hostSeconds: 600, customerSeconds: 540, togetherSeconds: 540 },
  recordChanged: false,
  visits: [
    { who: "host", joined: at("2027-01-10T20:00:00Z"), left: at("2027-01-10T20:10:00Z") },
    { who: "customer", joined: at("2027-01-10T20:01:00Z"), left: at("2027-01-10T20:10:00Z") },
  ],
  freeCancelMinutes: 60,
  cancelledAt: null,
  cancelledBy: null,
  loweredBy: null,
  refundRequest: null,
};

const facts: ProofFacts = {
  stage: "chargeback",
  bankReason: "fraudulent",
  customer: { name: "Ben Buyer", email: "ben@example.test", since: at("2026-06-01T09:00:00Z") },
  hostName: "Ana Host",
  chargedCents: 1333,
  refundedCents: 0,
  chargedAt: at("2027-01-11T20:03:00Z"),
  disputedCents: 1333,
  earlierPayments: 3,
  accepted: [],
  about: call,
};

const month: MonthFacts = { kind: "month", number: 2, includedMinutes: 60, pricePer15Cents: 1500, startsAt: at("2027-01-01T00:00:00Z"), endsAt: at("2027-02-01T00:00:00Z"), usedCents: 3000, agreedAt: at("2026-12-01T10:00:00Z") };
const gift: GiftFacts = { kind: "contribution", tip: false, monthly: false, number: 1, projectName: "A record", callStartsAt: null, agreedAt: at("2027-01-05T12:00:00Z") };

const text = (proof: ReturnType<typeof proofFrom>) => Object.values(proof).join("\n");

describe("the proof for a call", () => {
  it("names the customer, the call, the price and what was taken, and gives the record of who was in it", () => {
    const proof = proofFrom(facts);
    expect(proof.customer_name).toBe("Ben Buyer");
    expect(proof.customer_email_address).toBe("ben@example.test");
    expect(proof.service_date).toBe("2027-01-10");
    expect(proof.product_description).toContain("private one-to-one video call with Ana Host");
    expect(proof.uncategorized_text).toContain("$20.00 per 15 minutes ($13.33 for the booked time)");
    expect(proof.uncategorized_text).toContain("$13.33 was taken on 2027-01-11 20:03 UTC");
    expect(proof.access_activity_log).toContain("The host joined at 2027-01-10 20:00 UTC and left at 2027-01-10 20:10 UTC");
    expect(proof.access_activity_log).toContain("The customer joined at 2027-01-10 20:01 UTC");
    expect(proof.uncategorized_text).toContain("For this call that was 10 min, and $13.33 was charged for it");
  });

  it("puts first what answers the bank's reason", () => {
    expect(proofFrom(facts).uncategorized_text).toMatch(/^The cardholder says they did not make, or do not recognise, this payment/);
    expect(proofFrom(facts).uncategorized_text).toContain("The same account made 3 earlier payments on Connect for which Connect has no dispute on record");
    expect(proofFrom({ ...facts, bankReason: "product_not_received" }).uncategorized_text).toMatch(/^The cardholder says they did not get what they paid for/);
    expect(proofFrom({ ...facts, bankReason: "duplicate" }).uncategorized_text).toMatch(/^The cardholder says they were charged twice\. What this payment was for is described below\./);
    expect(proofFrom({ ...facts, bankReason: "duplicate" }).uncategorized_text).not.toMatch(/of its own/);
    expect(proofFrom({ ...facts, bankReason: "something_new" }).uncategorized_text).toMatch(/^This is what the payment was for/);
  });

  it("says so plainly when the customer never joined, and why the charge stands under the booking", () => {
    const proof = proofFrom({ ...facts, about: { ...call, visits: [call.visits[0]] } });
    expect(proof.uncategorized_text).toContain("The customer did not join");
    expect(proof.uncategorized_text).toContain("the host's time in the room during the booked time is paid for");
    // Where only time together is paid for, that sentence would be untrue.
    const together = proofFrom({ ...facts, about: { ...call, billing: "together", visits: [call.visits[0]] } });
    expect(together.uncategorized_text).toContain("The customer did not join.");
    expect(together.uncategorized_text).not.toContain("is paid for");
  });

  it("keeps a leaving that has no joining on record, and never says of that person that they did not join", () => {
    const proof = proofFrom({ ...facts, about: { ...call, visits: [call.visits[0], { who: "customer", joined: null, left: at("2027-01-10T20:09:00Z") }] } });
    expect(proof.access_activity_log).toContain("The customer left at 2027-01-10 20:09 UTC (no joining time was recorded).");
    expect(proof.uncategorized_text).not.toContain("The customer did not join");
  });

  it("stops the room's record at 60 lines and says how many more there are", () => {
    const many = Array.from({ length: 75 }, (_, i) => ({ who: "customer" as const, joined: at("2027-01-10T20:01:00Z"), left: new Date(at("2027-01-10T20:01:00Z").getTime() + i * 1000) }));
    const log = proofFrom({ ...facts, about: { ...call, visits: many } }).access_activity_log!;
    expect(log.split("\n")).toHaveLength(61);
    expect(log).toContain("(15 more entries of this kind are on record.)");
    expect(log.length).toBeLessThan(20_000);
  });

  it("gives both records when the call's record changed after the money was taken", () => {
    const proof = proofFrom({ ...facts, about: { ...call, recordChanged: true } });
    expect(proof.uncategorized_text).toContain("changed this record after the money was taken");
    expect(proof.uncategorized_text).toContain("as it stood at that time");
  });

  it("tells a refund request as the record has it, and claims no length of time", () => {
    expect(proofFrom(facts).refund_refusal_explanation).toBe("The customer made no refund request in the app for this call.");
    const asked = proofFrom({ ...facts, about: { ...call, refundRequest: { askedAt: at("2027-01-10T21:00:00Z"), reason: "other", status: "declined", decidedAt: at("2027-01-10T22:00:00Z"), decidedAs: "host", answeredByRefund: false } } });
    expect(asked.refund_refusal_explanation).toContain("asked for a refund in the app on 2027-01-10 21:00 UTC");
    expect(asked.refund_refusal_explanation).toContain("The host answered on 2027-01-10 22:00 UTC: no refund.");
    const refunded = proofFrom({ ...facts, refundedCents: 500, about: { ...call, refundRequest: { askedAt: at("2027-01-10T21:00:00Z"), reason: "other", status: "asked", decidedAt: null, decidedAs: null, answeredByRefund: true } } });
    expect(refunded.refund_refusal_explanation).toContain("A refund was given after that request.");
    expect(refunded.refund_refusal_explanation).not.toContain("had not been answered");
    // The refund that answered the request was of another payment of the call (added time): said as that, beside "nothing of it has been refunded".
    const other = proofFrom({ ...facts, about: { ...call, refundRequest: { askedAt: at("2027-01-10T21:00:00Z"), reason: "other", status: "asked", decidedAt: null, decidedAs: null, answeredByRefund: true } } });
    expect(other.refund_refusal_explanation).toContain("a refund was given for another payment of the same call, not for this one");
    expect(other.uncategorized_text).toContain("Nothing of it has been refunded.");
    const byConnect = proofFrom({ ...facts, about: { ...call, refundRequest: { askedAt: at("2027-01-10T21:00:00Z"), reason: "other", status: "declined", decidedAt: at("2027-01-10T22:00:00Z"), decidedAs: "admin", answeredByRefund: false } } });
    expect(byConnect.refund_refusal_explanation).toContain("Connect answered on 2027-01-10 22:00 UTC: no refund.");
    expect(text(proofFrom(facts))).not.toMatch(/24 hours/);
  });

  it("says what has been refunded, and claims no order of events it has no dates for", () => {
    expect(proofFrom(facts).uncategorized_text).toContain("Nothing of it has been refunded.");
    expect(proofFrom({ ...facts, refundedCents: 500 }).uncategorized_text).toContain("$5.00 of it has been refunded to the card.");
    expect(text(proofFrom({ ...facts, refundedCents: 500 }))).not.toMatch(/before this dispute/);
  });

  it("gives the stretch the payment is for, as the facts name it (a call made longer has a payment of its own for the added time)", () => {
    const added = proofFrom({ ...facts, about: { ...call, addedTime: true, startsAt: at("2027-01-10T20:10:00Z"), endsAt: at("2027-01-10T20:20:00Z") } });
    expect(added.product_description).toContain("for 2027-01-10 20:10 UTC to 2027-01-10 20:20 UTC");
    expect(added.product_description).toContain("time the customer asked to add during the call");
  });
});

describe("the proof for a late cancellation", () => {
  const late: CallFacts = { ...call, chargeReason: "late_cancel", charged: null, visits: [], cancelledAt: at("2027-01-10T19:40:00Z"), cancelledBy: "customer" };
  it("never says the call took place, and gives the cancelling rule and the moment of cancelling", () => {
    const proof = proofFrom({ ...facts, about: late });
    expect(proof.uncategorized_text).toContain("for a call the customer cancelled late");
    expect(proof.uncategorized_text).toContain("The customer cancelled at 2027-01-10 19:40 UTC");
    expect(proof.cancellation_policy_disclosure).toContain("Cancelling was free until 60 minutes before the start");
    expect(proof.cancellation_rebuttal).toContain("after the free time had ended");
    expect(proof.access_activity_log).toBeUndefined();
    // No day is given as the day the service was received: the call was not held.
    expect(proof.service_date).toBeUndefined();
    // A call cancelled late has no refund request in the app: nothing is said about one.
    expect(proof.refund_policy_disclosure).toBeUndefined();
    expect(proof.refund_refusal_explanation).toBeUndefined();
    expect(text(proof)).not.toMatch(/refund request/);
    expect(text(proof)).not.toMatch(/Connect charges only for time that took place|was charged for it\. The video service/);
  });

  it("does not say nobody joined when the record shows somebody did", () => {
    const proof = proofFrom({ ...facts, about: { ...late, visits: [call.visits[0]] } });
    expect(proof.uncategorized_text).toContain("The host joined at");
    expect(text(proof)).not.toMatch(/nobody joining/);
  });
});

describe("the proof for a charge the app has no totals for", () => {
  it("gives the amount and the room's record, and no rule as the explanation", () => {
    const proof = proofFrom({ ...facts, about: { ...call, charged: null } });
    expect(proof.uncategorized_text).toContain("$13.33 was charged for this call. The video service's record of the call:");
    expect(proof.uncategorized_text).not.toMatch(/Connect charges only for time that took place|is paid for/);
  });

  it("names no day of the service when the record shows nobody in the room", () => {
    expect(proofFrom({ ...facts, about: { ...call, charged: null, visits: [] } }).service_date).toBeUndefined();
    expect(proofFrom({ ...facts, about: { ...call, charged: null } }).service_date).toBe("2027-01-10");
  });
});

describe("the proof for a call the customer ended with \"End call now\"", () => {
  it("says the customer ended it and confirmed the charge, and never that only time that took place is charged", () => {
    const ended = { ...call, chargeReason: "customer_ended", endedByCustomerAt: at("2027-01-10T20:04:00Z"), charged: { hostSeconds: 240, customerSeconds: 240, togetherSeconds: 240 } };
    const proof = proofFrom({ ...facts, about: ended });
    expect(proof.uncategorized_text).toContain('with the "End call now" button inside the call');
    expect(proof.uncategorized_text).toContain("the whole booked time is still charged; the customer confirmed");
    expect(proof.uncategorized_text).toContain("before that moment (4 min)");
    expect(proof.uncategorized_text).toContain("$13.33 was charged under that rule");
    expect(proof.uncategorized_text).not.toContain("Connect charges only for time that took place");
    // It was held, so the day of the service and the room's record go with it.
    expect(proof.service_date).toBe("2027-01-10");
    expect(proof.access_activity_log).toBeDefined();
  });
});

describe("the proof for a charge Connect set after a review", () => {
  it("says that, and gives the record it was set on", () => {
    const proof = proofFrom({ ...facts, about: { ...call, chargeReason: "admin", charged: null } });
    expect(proof.uncategorized_text).toContain("Connect looked at the record and set the charge at $13.33");
    expect(proof.uncategorized_text).not.toContain("For this call that was");
    // Why it was held for a review is not claimed: it can be an incomplete record, or a report.
    expect(proof.uncategorized_text).not.toMatch(/incomplete/);
  });
});

describe("the proof for a membership month, a contribution and a tip", () => {
  it("gives the membership's agreement, what the month gave, and the rule for cancelling", () => {
    const proof = proofFrom({ ...facts, bankReason: "subscription_canceled", chargedCents: 6000, about: month });
    expect(proof.uncategorized_text).toMatch(/^The cardholder says they had cancelled/);
    expect(proof.product_description).toContain("month 2 of a membership with Ana Host");
    expect(proof.uncategorized_text).toContain("agreed to this membership and its monthly renewal on 2026-12-01 10:00 UTC");
    expect(proof.cancellation_policy_disclosure).toContain("renews every month until they cancel");
    expect(proof.service_date).toBeUndefined();
    expect(proof.access_activity_log).toBeUndefined();
  });

  it("says nothing about whether or when the member stopped: a dispute ends the membership and clears those marks", () => {
    const proof = proofFrom({ ...facts, bankReason: "subscription_canceled", chargedCents: 6000, about: month });
    expect(proof.cancellation_rebuttal).toBeUndefined();
    expect(text(proof)).not.toMatch(/no cancellation|stopped the membership|member since/i);
  });

  it("calls a contribution what its page called it, and a tip a gift", () => {
    const contribution = proofFrom({ ...facts, about: gift });
    expect(contribution.product_description).toContain('a contribution the customer chose to make to "A record"');
    expect(contribution.uncategorized_text).toContain("does not buy a call or any promised reward");
    const tip = proofFrom({ ...facts, about: { ...gift, tip: true, projectName: null, callStartsAt: at("2027-01-10T20:00:00Z") } });
    expect(tip.product_description).toContain("a tip the customer chose to give Ana Host on Connect after their video call of 2027-01-10 20:00 UTC");
    expect(tip.uncategorized_text).toContain("It is a gift from the customer, not a payment for goods or a service");
    expect(tip.uncategorized_text).toContain("The amount taken includes the card payment fee");
    expect(tip.uncategorized_text).toContain("The customer chose the amount");
    expect(tip.refund_refusal_explanation).toBeUndefined();
  });
});

describe("what the proof never says", () => {
  const every = [facts, { ...facts, about: month }, { ...facts, about: gift }, { ...facts, stage: "question" as const }].map((one) => text(proofFrom(one))).join("\n");
  it("has no link, no device and no internet address", () => {
    expect(every).not.toMatch(/https?:\/\/|\bIP\b|device|browser/i);
  });

  it("puts plain words in place of a name that holds a link, a web address or an email address", () => {
    const linked = proofFrom({ ...facts, hostName: "Ana https://example.com/ana", customer: { ...facts.customer, name: "Ben www.ben.example" } });
    expect(linked.product_description).toContain("video call with a host,");
    expect(linked.customer_name).toBe("the customer");
    const project = proofFrom({ ...facts, hostName: "mail me: ana@example.test", about: { ...gift, projectName: "See anasite.com" } });
    expect(project.product_description).toContain("a contribution the customer chose to make to a project, a project of a host on Connect");
    expect(text(project).replace(/ben@example\.test/g, "")).not.toMatch(/https?:|www\.|@|anasite/);
    expect(proofFrom({ ...facts, about: gift }).product_description).toContain('"A record"');
    // Any web address and any internet address, not only the common endings.
    for (const name of ["Ana example.fr", "Studio 192.0.2.1", "ana.host", "Ana 2001:db8::1"]) expect(proofFrom({ ...facts, hostName: name }).product_description).toContain("video call with a host,");
    for (const name of ["Ana Host", "Dr. Ana B. Host", "Ana & Co"]) expect(proofFrom({ ...facts, hostName: name }).product_description).toContain(`video call with ${name},`);
  });

  it("names an agreement only when the list of accepted, published ones is not empty", () => {
    expect(every).not.toMatch(/had accepted/);
    const withTerms = proofFrom({ ...facts, accepted: [{ title: "Payment Terms", version: "2027-01-01", at: at("2027-01-02T08:00:00Z") }] });
    expect(withTerms.uncategorized_text).toContain("Before this payment the customer had accepted: the Payment Terms, version 2027-01-01, on 2027-01-02 08:00 UTC.");
  });

  it("answers a bank's question with the same facts, shorter", () => {
    const short = proofFrom({ ...facts, stage: "question" }).uncategorized_text;
    const long = proofFrom(facts).uncategorized_text;
    expect(short.length).toBeLessThan(long.length);
    expect(short).toContain("What was paid for");
    expect(short).toContain("The host joined at");
    const withTerms = proofFrom({ ...facts, stage: "question", accepted: [{ title: "Payment Terms", version: "2027-01-01", at: at("2027-01-02T08:00:00Z") }] });
    expect(withTerms.uncategorized_text).toContain("the Payment Terms, version 2027-01-01");
  });
});
