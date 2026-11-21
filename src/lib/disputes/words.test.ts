import { describe, expect, it } from "vitest";
import { appealWords, beganWords, choiceWords, endedWords, lateWords, type Facts } from "./words";

const facts: Facts = {
  stage: "chargeback",
  standing: "waiting",
  noAnswer: false,
  plan: "ask",
  compliance: false,
  askUntil: "Saturday, November 21 at 8:00 PM EST",
  what: "the payment for the call on Monday",
  amount: "$13.33",
  reason: "the cardholder says they did not make this payment",
  dueBy: "Friday, November 27 at 6:59 PM EST",
  duePassed: false,
  appealWaits: false,
  stopStays: false,
  membership: false,
  hostName: "Ana",
  customerName: "Ben",
  supportEmail: "support@connect.example",
};
const question: Facts = { ...facts, stage: "question", plan: "answer", askUntil: null };

const all = (told: { subject: string; text: string }) => `${told.subject}\n${told.text}`;

describe("what the host is told when a chargeback opens", () => {
  it("says they choose, by when, and that no choice means Connect fights", () => {
    const told = beganWords("host", facts).text;
    expect(told).toContain("Ben's bank has opened a dispute over the payment for the call on Monday ($13.33)");
    expect(told).toContain("You choose what Connect does: fight the dispute, or give the money back");
    expect(told).toContain("Choose by Saturday, November 21 at 8:00 PM EST");
    expect(told).toContain("If you do not choose by then, Connect fights it");
  });

  it("says Connect fights at once when there is no time to ask", () => {
    const told = beganWords("host", { ...facts, askUntil: null }).text;
    expect(told).toContain("no time left to ask you");
    expect(told).not.toContain("You choose");
  });

  it("offers no choice where there is none: a bank that takes no answer, one already deciding, a dispute the app leaves alone", () => {
    for (const none of [{ ...facts, noAnswer: true, plan: "leave" as const, askUntil: null }, { ...facts, standing: "with_bank" as const, askUntil: null }, { ...facts, plan: "leave" as const, compliance: true, askUntil: null }]) {
      expect(beganWords("host", none).text).not.toMatch(/You choose|Choose by/);
    }
    expect(beganWords("host", { ...facts, plan: "leave", compliance: true, askUntil: null }).text).toContain("costs Connect 500 dollars");
  });

  it("calls a bank's question a question, and says Connect answers it", () => {
    const told = beganWords("host", question);
    expect(told.text).toContain("not yet a dispute");
    expect(told.text).toContain("Connect is answering it now");
    expect(all(told)).not.toMatch(/opened a dispute|You choose/);
  });
});

describe("what the customer is told", () => {
  it("is kind, says how to undo it, and says what they cannot do while it is open", () => {
    const told = beganWords("customer", facts).text;
    expect(told).toContain("you disputed the payment for the call on Monday ($13.33)");
    expect(told).toContain("ask your bank to withdraw the dispute");
    expect(told).toContain("you cannot start anything new that costs money");
    expect(told).toContain("That changes nothing about calls you have already booked");
  });

  it("says that a disputed membership ends, and never that its booked calls stay", () => {
    const told = beganWords("customer", { ...facts, membership: true }).text;
    expect(told).toContain("This dispute also ends your membership with Ana, and calls booked from that membership are cancelled");
    expect(told).not.toContain("changes nothing about calls you have already booked");
  });

  it("says nothing about a stop for a bank's question, which stops nothing", () => {
    const told = beganWords("customer", question).text;
    expect(told).toContain("do not need to do anything");
    expect(told).not.toMatch(/cannot start/);
  });

  it("says this dispute no longer stops them when a chargeback ends without a lasting stop, and promises nothing about any other", () => {
    for (const outcome of ["won", "closed", "lost"] as const) {
      const told = endedWords("customer", facts, outcome).text;
      expect(told).toContain("This dispute no longer keeps you from starting new bookings and payments on Connect");
      expect(told).not.toMatch(/You can start new bookings/);
    }
  });

  it("says paying stays off, why, and where to write, after a loss that followed the app's own proof", () => {
    const told = endedWords("customer", { ...facts, stopStays: true }, "lost").text;
    expect(told).toContain("your bank decided in your favour");
    expect(told).toContain("stays switched off for your account");
    expect(told).toContain("support@connect.example");
    expect(told).not.toContain("again.");
  });

  it("says nothing about paying at the end of a bank's question", () => {
    expect(endedWords("customer", question, "closed").text).toContain("Nothing changes for you");
    expect(endedWords("customer", question, "closed").text).not.toMatch(/new bookings/);
  });
});

describe("what the founder is told when a dispute opens", () => {
  it("says the host chooses, until when, and that nothing is needed from them", () => {
    const told = beganWords("founder", facts).text;
    expect(told).toContain("The host can choose until Saturday, November 21 at 8:00 PM EST");
    expect(told).toContain("wants an answer by Friday, November 27");
    expect(told).toContain("Nothing is needed from you");
    expect(told).not.toContain("by hand");
  });

  it("says the app answers a bank's question by itself", () => {
    expect(beganWords("founder", question).text).toContain("The app is answering the bank's question now");
  });

  it("leaves a compliance dispute under the line to them, with the bank's date, and says what happens otherwise", () => {
    const told = beganWords("founder", { ...facts, plan: "leave", compliance: true, askUntil: null }).text;
    expect(told).toContain("costs 500 dollars");
    expect(told).toContain("the app sends nothing");
    expect(told).toContain("If you want to fight this one, do it in Stripe before then");
    expect(told).toContain("lost when that date passes");
    expect(told).not.toContain("Nothing is needed from you");
  });

  it("says a compliance dispute at or above the line is fought, and what that costs", () => {
    const told = beganWords("founder", { ...facts, compliance: true }).text;
    expect(told).toContain("at or above the amount from which the app fights these");
    expect(told).toContain("500 dollars");
  });

  it("never asks for an answer the bank does not take, or by a date that has passed, or when it is already with the bank", () => {
    expect(beganWords("founder", { ...facts, noAnswer: true, plan: "leave", askUntil: null }).text).toContain("takes no answer");
    expect(beganWords("founder", { ...facts, plan: "leave", compliance: true, askUntil: null, duePassed: true }).text).not.toMatch(/do it in Stripe/);
    const late = beganWords("founder", { ...facts, standing: "with_bank", askUntil: null }).text;
    expect(late).toContain("nothing can be sent to the bank now");
    expect(late).not.toMatch(/can choose|by hand/);
  });
});

describe("the other messages", () => {
  it("tells a host whose dispute was already waiting that they can now choose", () => {
    const told = choiceWords(facts);
    expect(told.subject).toContain("You can now choose");
    expect(told.text).toContain("Choose by Saturday, November 21 at 8:00 PM EST");
  });

  it("never tells a host outright that the money can be collected: another dispute or reason may still hold it", () => {
    for (const outcome of ["won", "closed"] as const) {
      const told = endedWords("host", facts, outcome).text;
      expect(told).toContain("no longer holds the money back");
      expect(told).toContain("Your earnings");
      expect(told).not.toMatch(/can be collected again/);
    }
  });

  it("says what the bank decided when a dispute is lost, never that the customer already has the money", () => {
    const told = endedWords("host", facts, "lost").text;
    expect(told).toContain("the bank decided for the customer, and the $13.33 does not come back");
    expect(told).toContain("Connect takes it back from your Stripe balance");
    expect(told).toContain("nothing is taken for 14 days after that");
    for (const role of ["host", "customer", "founder"] as const) expect(all(endedWords(role, facts, "lost"))).not.toMatch(/returned/);
  });

  it("tells the founder that a customer stays stopped, and where to change that", () => {
    expect(endedWords("founder", { ...facts, stopStays: true }, "lost").text).toContain("cannot start new payments until you allow it again");
    expect(endedWords("founder", facts, "lost").text).not.toContain("until you allow it");
  });

  it("does not call a dispute that was closed without a decision a question", () => {
    expect(all(endedWords("host", facts, "closed"))).toContain("was closed without a decision by the bank");
    expect(all(endedWords("host", facts, "closed"))).not.toMatch(/question/);
    expect(all(endedWords("host", question, "closed"))).toContain("did not become a dispute");
  });

  it("says in an appeal whether the bank waits for an answer or is already looking at one, and never asks for the impossible", () => {
    const waits = appealWords({ ...facts, appealWaits: true }).text;
    expect(waits).toContain("waits for an answer in this appeal, by Friday, November 27");
    expect(waits).toContain("by hand in Stripe");
    const looking = appealWords(facts).text;
    expect(looking).toContain("nothing more can be sent now");
    const late = appealWords({ ...facts, appealWaits: true, duePassed: true }).text;
    expect(late).toContain("has passed");
    const none = appealWords({ ...facts, appealWaits: true, noAnswer: true }).text;
    expect(none).toContain("takes no answer");
    for (const told of [looking, late, none]) expect(told).not.toContain("by hand");
    for (const told of [waits, looking, late, none]) expect(told).toContain("keeps the money for this payment where it is");
  });

  it("tells the founder plainly when no answer could be sent and the deadline is near", () => {
    const told = lateWords(facts, "No such dispute");
    expect(told.text).toContain("This one needs you");
    expect(told.text).toContain("What Stripe last said: No such dispute");
    expect(told.text).toContain("Friday, November 27");
  });
});

describe("what is said about taking a share back", () => {
  it("is said only at a loss: to the host that it is taken after a message and 14 days, to the founder that they can cancel it", () => {
    expect(endedWords("host", facts, "lost").text).toContain("you get a message with the amount first");
    expect(endedWords("founder", facts, "lost").text).toContain("asks Stripe to take it back out of the transfer");
    expect(endedWords("founder", facts, "lost").text).toContain("can cancel it on the dispute's page");
    const others = [
      ...(["host", "customer", "founder"] as const).flatMap((role) => [beganWords(role, facts), beganWords(role, question), endedWords(role, facts, "won"), endedWords(role, facts, "closed")]),
      endedWords("customer", facts, "lost"),
      appealWords(facts),
      choiceWords(facts),
      lateWords(facts, null),
    ]
      .map(all)
      .join("\n");
    expect(others).not.toMatch(/take it back|takes it back|taken back|reverse/i);
  });
});
