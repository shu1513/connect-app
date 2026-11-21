import { describe, expect, it } from "vitest";
import { appealWords, beganWords, endedWords, type Facts } from "./words";

const facts: Facts = {
  stage: "chargeback",
  standing: "waiting",
  noAnswer: false,
  what: "the payment for the call on Monday",
  amount: "$13.33",
  reason: "the cardholder says they did not make this payment",
  dueBy: "Friday, November 27 at 6:59 PM EST",
  hostName: "Ana",
  customerName: "Ben",
  supportEmail: "support@connect.example",
};

const all = (told: { subject: string; text: string }) => `${told.subject}\n${told.text}`;

describe("what the founder is told when a dispute opens", () => {
  it("says it must be answered by hand, with the bank's date, while the bank waits for an answer", () => {
    const told = beganWords("founder", facts).text;
    expect(told).toContain("wants an answer by Friday, November 27");
    expect(told).toContain("by hand in Stripe");
  });

  it("says so without a date when Stripe gives none", () => {
    const told = beganWords("founder", { ...facts, dueBy: null }).text;
    expect(told).toContain("Stripe gives no date");
    expect(told).toContain("by hand in Stripe");
  });

  it("never asks for an answer the bank does not take", () => {
    const told = beganWords("founder", { ...facts, noAnswer: true, dueBy: null }).text;
    expect(told).toContain("takes no answer");
    expect(told).not.toContain("by hand");
  });

  it("never asks for an answer when the dispute was first seen with the bank already", () => {
    const told = beganWords("founder", { ...facts, standing: "with_bank" }).text;
    expect(told).toContain("nothing can be sent to the bank now");
    expect(told).not.toContain("by hand");
    expect(told).not.toContain("wants an answer");
  });
});

describe("what a host and a customer are told", () => {
  it("names the other person, the amount and what it was for", () => {
    expect(beganWords("host", facts).text).toContain("Ben's bank has opened a dispute over the payment for the call on Monday ($13.33)");
    expect(beganWords("customer", facts).text).toContain("you disputed the payment for the call on Monday ($13.33)");
  });

  it("calls a bank's question a question, to both", () => {
    const question = { ...facts, stage: "question" as const };
    expect(beganWords("host", question).text).toContain("not yet a dispute");
    expect(beganWords("customer", question).text).toContain("do not need to do anything");
    expect(all(beganWords("host", question))).not.toMatch(/opened a dispute/);
  });

  it("never tells a host outright that the money can be collected: another dispute or reason may still hold it", () => {
    for (const outcome of ["won", "closed"] as const) {
      const told = endedWords("host", facts, outcome).text;
      expect(told).toContain("no longer holds the money back");
      expect(told).toContain("Your earnings");
      expect(told).not.toMatch(/can be collected again/);
    }
  });

  it("speaks of the disputed amount when a dispute is lost, and promises no letter and no take-back", () => {
    const told = endedWords("host", facts, "lost").text;
    expect(told).toContain("returned $13.33 to the customer");
    expect(told).toContain("may ask you to pay it back");
    expect(told).not.toMatch(/will write|taken back|undoes the payment/);
    expect(endedWords("customer", facts, "lost").text).toContain("returned $13.33 to you");
  });

  it("does not call a dispute that was closed without a decision a question", () => {
    expect(all(endedWords("host", facts, "closed"))).toContain("was closed without a decision by the bank");
    expect(all(endedWords("host", facts, "closed"))).not.toMatch(/question/);
    expect(all(endedWords("host", { ...facts, stage: "question" }, "closed"))).toContain("did not become a dispute");
  });
});

describe("what nobody is told yet", () => {
  it("is that the app answers the bank, or takes anything back from a host (parts 2 and 3 are not built)", () => {
    const everything = [
      ...(["host", "customer", "founder"] as const).flatMap((role) => [
        beganWords(role, facts),
        beganWords(role, { ...facts, stage: "question" }),
        endedWords(role, facts, "won"),
        endedWords(role, facts, "lost"),
        endedWords(role, facts, "closed"),
      ]),
      appealWords(facts),
    ]
      .map(all)
      .join("\n");
    expect(everything).not.toMatch(/we (will )?(fight|answer the bank)|we have answered|choose by/i);
    // The only words about taking back say that the app does NOT.
    expect(everything.match(/taken back/g) ?? []).toHaveLength(1);
    expect(everything).toContain("nothing is taken back by the app");
  });
});
