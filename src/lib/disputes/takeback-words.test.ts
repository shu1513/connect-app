import { describe, expect, it } from "vitest";
import { answeredWords, cancelledWords, leftoverWords, notDeliveredWords, objectedWords, objectedWordsForFounder, owedWords, owedWordsForFounder, refusedWords, takenWords, type DebtFacts } from "./takeback-words";

const facts: DebtFacts = {
  what: "the payment for your call with Ben on Monday",
  amount: "$12.38",
  sent: "$12.38",
  part: null,
  capped: null,
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
    expect(told).toContain('press "I think this is wrong" on this dispute\'s page in the app');
    expect(told).toContain("From the moment you press it, nothing is taken until a person at Connect has looked at it and answered you.");
    // Writing to support is not promised to stop it by itself: only once a person has read it.
    expect(told).toContain("You can also write to us at support@connect.example. An email stops the taking only once a person at Connect has read it, so if the day is near, use the button.");
  });

  it("names no day while the day is not known: it counts from the email really going out", () => {
    const told = owedWords({ ...facts, dueOn: null }).text;
    expect(told).toContain("From 14 days after this message was sent to you by email, Connect will ask Stripe to take $12.38 back from your Stripe balance. Until then nothing is taken.");
    expect(told).toContain('"Your earnings" on your Hosting page shows the day.');
    expect(owedWordsForFounder({ ...facts, dueOn: null }).text).toContain("from 14 days after that notice went out by email it asks Stripe");
  });

  it("says how a part is worked out", () => {
    const told = owedWords({ ...facts, amount: "$4.64", part: { disputed: "$5.00", of: "$13.33" } }).text;
    expect(told).toContain("The bank took back $5.00 of the $13.33 that was left of the charge");
    expect(told).toContain("the same part of the $12.38 you were sent is owed, rounded down to the cent: $4.64");
  });

  it("says so when less than that is asked for, because no more is left of the transfer", () => {
    expect(owedWords({ ...facts, amount: "$4.00", capped: "transfer" }).text).toContain("no more than this can be taken out of that transfer");
    expect(owedWords({ ...facts, amount: "$4.00", capped: "bank" }).text).toContain("no more is owed than the bank took back");
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
    expect(told).toContain("The host can object with a button; you are then told, and nothing is taken until you have decided.");
    expect(told).toContain('If the host objects by email instead, press "Hold it: the host objected" on the dispute\'s page at once: an email alone stops nothing.');
    expect(told).toContain("You can also cancel the take-back on the dispute's page until the app starts it.");
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

describe("an objection", () => {
  it("tells the host that nothing is taken until they are answered, and the founder what the host wrote and what can be done", () => {
    expect(all(objectedWords(facts))).toContain("Until you have that answer, nothing is taken for this take-back.");
    const founder = all(objectedWordsForFounder(facts, "The call took place. I have the recording of my calendar."));
    expect(founder).toContain("A host objects to a take-back: Ana, $12.38");
    expect(founder).toContain("What the host wrote:\nThe call took place. I have the recording of my calendar.");
    expect(founder).toContain("you can call the take-back off, or answer the host in writing and have it taken after all");
  });

  it("gives the host the founder's answer in full, and from when it is taken after all", () => {
    const told = all(answeredWords(facts, "The bank's decision stands whatever happened in the call."));
    expect(told).toContain("Our answer:\n\nThe bank's decision stands whatever happened in the call.");
    expect(told).toContain("not before 3 days after this message was sent to you by email, and not before the day the first notice named");
    expect(told).toContain("If you still think this is wrong, write to us at support@connect.example.");
  });

  it("tells the founder when the notice or the answer did not reach the host, and that nothing is taken meanwhile", () => {
    const notice = all(notDeliveredWords(facts, "notice", "the address bounces (bounced (permanent))"));
    expect(notice).toContain("A take-back is waiting: its notice did not reach Ana");
    expect(notice).toContain("could not be delivered by email: the address bounces (bounced (permanent))");
    expect(notice).toContain("nothing is taken while this is so");
    expect(all(notDeliveredWords(facts, "answer", "it could not be sent"))).toContain("The answer to the objection against taking $12.38 back from Ana");
  });
});

