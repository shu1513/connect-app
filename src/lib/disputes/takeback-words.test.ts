import { describe, expect, it } from "vitest";
import { cancelledWords, leftoverWords, owedWords, owedWordsForFounder, refusedWords, takenWords, type DebtFacts } from "./takeback-words";

const facts: DebtFacts = {
  what: "the payment for your call with Ben on Monday",
  amount: "$12.38",
  sent: "$12.38",
  part: null,
  capped: false,
  dueOn: "Saturday, December 5",
  hostName: "Ana",
  customerName: "Ben",
  supportEmail: "support@connect.example",
};
const all = (told: { subject: string; text: string }) => `${told.subject}\n${told.text}`;

describe("what a host is told when a share is owed back", () => {
  it("says which payment, why, how much, that nothing is taken before the date, and where to object", () => {
    const told = owedWords(facts).text;
    expect(told).toContain("Ben's bank had opened over the payment for your call with Ben on Monday is lost");
    expect(told).toContain("You had already collected your share");
    expect(told).toContain("the bank took the whole payment back, so $12.38 is owed");
    expect(told).toContain("From Saturday, December 5, Connect will ask Stripe to take $12.38 back from your Stripe balance. Until then nothing is taken.");
    expect(told).toContain("write to us at support@connect.example before that date");
  });

  it("says how a part is worked out", () => {
    const told = owedWords({ ...facts, amount: "$4.64", part: { disputed: "$5.00", of: "$13.33" } }).text;
    expect(told).toContain("The bank took back $5.00 of the $13.33 that was left of the charge");
    expect(told).toContain("the same part of the $12.38 you were sent is owed, rounded down to the cent: $4.64");
  });

  it("says so when less than that is asked for, because no more is left of the transfer", () => {
    expect(owedWords({ ...facts, amount: "$4.00", capped: true }).text).toContain("no more than this can be taken out of that transfer");
  });

  it("says the bank's fees are not charged to the host", () => {
    expect(owedWords(facts).text).toContain("The bank's own fees are not charged to you.");
  });
});

describe("what is never promised", () => {
  const everything = [owedWords(facts), owedWordsForFounder(facts), takenWords(facts), cancelledWords(facts, "founder"), cancelledWords(facts, "won"), refusedWords(facts, "Insufficient funds"), leftoverWords("host", facts), leftoverWords("founder", facts)].map(all).join("\n");
  it("is that Stripe will succeed, or where Stripe gets the money from beyond the host's Stripe balance", () => {
    expect(everything).not.toMatch(/bank account|will be debited|guarantee/i);
    expect(owedWords(facts).text).toContain("will ask Stripe");
    expect(owedWords(facts).subject).toContain("will ask Stripe to take back");
    // What is said to be settled is this take-back, never the whole payment: another dispute on the same charge can have one of its own.
    expect(everything).not.toMatch(/owed for this payment|taken for this payment/);
  });

  it("is that the app gives back by itself what it took and the bank later reversed", () => {
    expect(leftoverWords("founder", facts).text).toContain("The app does not give the amount back by itself");
    expect(leftoverWords("host", facts).text).toContain("A person at Connect will look at this");
  });
});

describe("the other messages", () => {
  it("tells the founder what the app will do and that it can be cancelled until then", () => {
    const told = owedWordsForFounder(facts).text;
    expect(told).toContain("Ana had already collected their share ($12.38)");
    expect(told).toContain("from Saturday, December 5 it asks Stripe");
    expect(told).toContain("you can cancel the take-back on the dispute's page");
  });

  it("tells the host when it is done, and when it is called off and why", () => {
    expect(takenWords(facts).text).toContain("Stripe has taken $12.38 back from your Stripe balance");
    expect(cancelledWords(facts, "won").text).toContain("let the payment stand");
    expect(cancelledWords(facts, "founder").text).toContain("decided not to take it");
    for (const why of ["won", "founder"] as const) expect(cancelledWords(facts, why).text).toContain("Nothing is taken for this take-back");
  });

  it("tells the founder after 30 days of refusals, with what Stripe last said", () => {
    const told = refusedWords(facts, "Insufficient funds").text;
    expect(told).toContain("For 30 days Stripe has refused to take $12.38 back from Ana");
    expect(told).toContain("What Stripe last said: Insufficient funds");
    expect(told).toContain("keeps trying once a day");
  });
});
