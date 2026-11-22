import { describe, expect, it } from "vitest";
import { answeredWords, cancelledWords, handCountedWords, handHeldWordsForFounder, handTwiceWords, leftoverWords, loweredWords, noRoomWordsForFounder, refundFellAwayWords, shareRestoredWords, refundFellAwayWordsForFounder, settledWords, notDeliveredWords, noticeAgainWords, objectedWords, refundCancelledWords, refundOwedWords, refundOwedWordsForFounder, refundRefusedWords, refundSettledWords, refundTakenWords, refundWaitingWords, refundWaitingWordsForFounder, objectedWordsForFounder, owedWords, owedWordsForFounder, refusedWords, takenWords, type DebtFacts } from "./takeback-words";

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
    expect(told).toContain("You can also write to us at support@connect.example. An email does not stop the taking by itself: it stops only when a person at Connect has put a hold on it, which can take a working day or longer. If the day is near, use the button.");
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
    expect(founder).toContain("On its page (linked below) you can call the take-back off, or answer the host in writing and have it taken after all");
  });

  it("gives the host the founder's answer in full, and from when it is taken after all", () => {
    const told = all(answeredWords(facts, "The bank's decision stands whatever happened in the call."));
    expect(told).toContain("Our answer:\n\nThe bank's decision stands whatever happened in the call.");
    expect(told).toContain("not before 3 days after this message was sent to you by email, and not before the day the first notice named");
    expect(told).toContain("If you still think this is wrong, write to us at support@connect.example.");
  });

  it("tells the founder when the notice or the answer did not reach the host, and that nothing is taken meanwhile", () => {
    const notice = all(notDeliveredWords(facts, "notice", "the address bounces (bounced (permanent))"));
    expect(notice).toContain("A take-back is waiting: its notice is not confirmed as delivered to Ana");
    expect(notice).toContain("is not confirmed as delivered by email: the address bounces (bounced (permanent))");
    expect(notice).toContain("nothing is taken while this is so");
    expect(notice).toContain("On its page (linked below) you can send it again");
    expect(all(notDeliveredWords(facts, "answer", "it could not be sent"))).toContain("The answer to the objection against taking $12.38 back from Ana");
  });
});

describe("a notice that is sent again", () => {
  it("is the notice itself, with a line saying why it comes again", () => {
    const again = noticeAgainWords({ ...facts, dueOn: null }, null);
    expect(again.subject).toBe(owedWords(facts).subject);
    expect(again.text.startsWith("We are sending this again because we could not confirm that our first message about it reached you by email.")).toBe(true);
    expect(again.text).toContain('press "I think this is wrong"');
    expect(again.text).toContain("From 14 days after this message was sent to you by email");
  });

  it("for a take-back whose objection was already answered, repeats the answer and does not point to a button that is gone", () => {
    const again = all(noticeAgainWords({ ...facts, dueOn: null }, "The bank's decision stands."));
    expect(again).toContain("You told us this is wrong, and we answered:\n\nThe bank's decision stands.");
    expect(again).toContain("not before 14 days after this message was sent to you by email");
    expect(again).toContain("If you still think this is wrong, write to us at support@connect.example.");
    expect(again).not.toContain("I think this is wrong\"");
    expect(again).not.toContain("press");
  });
});

describe("a take-back that comes from a refund given after the host had collected", () => {
  const owed: DebtFacts = {
    ...facts,
    what: "the payment for your call with Ben on Monday",
    amount: "$40.00",
    sent: "$80.00",
    dueOn: null,
    refund: { refunded: "$50.00", shareBefore: "$80.00", shareAfter: "$40.00", reason: "The host did not join the call. Ben waited ten minutes.", cutShort: false },
  };

  it("tells the host what was refunded and why, how the amount is worked out, the 14 days, and both ways to object", () => {
    const told = all(refundOwedWords(owed));
    expect(told).toContain("Connect will ask Stripe to take back $40.00: a payment you had collected was refunded");
    expect(told).toContain("Connect has given Ben $50.00 back for the payment for your call with Ben on Monday. You had already collected your share of that payment, so the money came from Connect.");
    expect(told).toContain("Why Connect decided this refund: The host did not join the call. Ben waited ten minutes.");
    expect(told).toContain("Your share of that payment was $80.00 before this refund and is $40.00 after it. The difference is what you owe back: $40.00.");
    expect(told).toContain("From 14 days after this message was sent to you by email, Connect will ask Stripe to take $40.00 back from your Stripe balance. Until then nothing is taken.");
    expect(told).toContain('press "I think this is wrong" on this take-back\'s page in the app');
    expect(told).toContain("An email does not stop the taking by itself");
    expect(told).not.toContain("bank");
  });

  it("says so when less than the difference is asked for, because no more is left of what was sent", () => {
    const told = refundOwedWords({ ...owed, amount: "$79.75", sent: "$79.75", refund: { ...owed.refund!, shareAfter: "$0.00", cutShort: true } }).text;
    // $80.00 before, $0.00 after: the notice never calls $79.75 "the difference".
    expect(told).toContain("Your share of that payment was $80.00 before this refund and is $0.00 after it. That difference is more than is left of the $79.75 that was really sent to you for this payment, so what you owe back is less than the difference: $79.75.");
    expect(told).not.toContain("The difference is what you owe back");
  });

  it("tells a host whose debt the app will not take by itself that she owes it, and promises no date and no taking", () => {
    const told = all(refundWaitingWords(owed));
    expect(told).toContain("You owe Connect $40.00: a payment you had collected was refunded");
    expect(told).toContain("Connect does not take this amount by itself. A person at Connect will write to you about how it is settled. Until then nothing is taken.");
    expect(told).not.toContain("Stripe");
    expect(told).not.toContain("14 days");
    expect(told).not.toContain("I think this is wrong");
  });

  it("tells the founder what the app does, and when the debt is theirs to settle", () => {
    expect(all(refundOwedWordsForFounder(owed))).toContain("The app has told the host that $40.00 is owed (their share was $80.00 and is $40.00), and from 14 days after that notice arrived by email it asks Stripe");
    const waiting = all(refundWaitingWordsForFounder(owed));
    expect(waiting).toContain("To settle with a host: Ana owes $40.00 after your refund");
    expect(waiting).toContain("it takes money back only where the host had accepted a published Host Agreement before the customer's payment was held");
    expect(waiting).toContain('record what they paid back ("Settled outside the app") or call it off');
  });

  it("tells the host when it is taken, called off, or settled outside the app", () => {
    expect(all(refundTakenWords(owed))).toContain("Stripe has taken $40.00 back from your Stripe balance, for the payment for your call with Ben on Monday: Connect had refunded Ben after you had collected your share.");
    expect(all(refundCancelledWords(owed))).toContain("That is called off: Connect looked at it and decided to carry it. Nothing is taken, and nothing is owed for it.");
    expect(all(refundSettledWords(owed, "$25.00", "$15.00"))).toContain("you paid back $25.00, and Connect carries the remaining $15.00");
    expect(all(refundSettledWords(owed, "$40.00", null))).toContain("you paid back $40.00.");
    expect(all(refundRefusedWords(owed, "balance_insufficient"))).toContain("after your refund). What Stripe last said: balance_insufficient");
  });

  it("sent again, it is the refund's own notice; for an answered objection it repeats the answer and points to no button", () => {
    const again = noticeAgainWords(owed, null);
    expect(again.subject).toBe(refundOwedWords(owed).subject);
    expect(again.text).toContain("Connect has given Ben $50.00 back");
    const answered = all(noticeAgainWords(owed, "The refund stands."));
    expect(answered).toContain("You told us this is wrong, and we answered:\n\nThe refund stands.");
    expect(answered).toContain("Your share of that payment was $80.00 before this refund and is $40.00 after it.");
    expect(answered).not.toContain("press");
    expect(answered).not.toContain("bank dispute");
  });
});

describe("a lost dispute on a share that had refunds after it was sent", () => {
  it("names what was really sent, what the refunds took, and starts the sum from what was left", () => {
    // $79.75 sent; refunds took $40.00; the bank took 25 of the 50 left of the charge: half of the $39.75 that was left.
    const told = owedWords({ ...facts, amount: "$19.87", sent: "$79.75", afterRefunds: { took: "$40.00", left: "$39.75" }, part: { disputed: "$25.00", of: "$50.00" } }).text;
    expect(told).toContain("You were sent $79.75 for this payment. Refunds given after that had already taken $40.00 off your share, which left $39.75.");
    expect(told).toContain("so the same part of the $39.75 that was left of your share is owed, rounded down to the cent: $19.87.");
    expect(told).not.toContain("the $79.75 you were sent is owed");
  });

  it("says it plainly when the bank took all that was left", () => {
    const told = owedWords({ ...facts, amount: "$39.75", sent: "$79.75", afterRefunds: { took: "$40.00", left: "$39.75" } }).text;
    expect(told).toContain("which left $39.75. The bank took back all that was left of the payment, so $39.75 is owed.");
  });

  it("is unchanged where no refund came first", () => {
    expect(owedWords(facts).text).toContain("You were sent $12.38 for this payment, and the bank took the whole payment back, so $12.38 is owed.");
  });
});

describe("a reversal somebody made by hand at Stripe", () => {
  it("tells the founder why the app stops taking from that transfer, and what to do", () => {
    const told = all(handHeldWordsForFounder(facts, "$10.00"));
    expect(told).toContain("on hold");
    expect(told).toContain("$10.00 of the transfer to Ana");
    expect(told).toContain("the same money could be taken twice");
    expect(told).toContain("say for each such reversal whether it paid this take-back or had nothing to do with it");
  });

  it("tells the host what was counted, and whether anything is still owed", () => {
    expect(handCountedWords(facts, "$10.00", "$2.38").text).toContain("$2.38 of it is still owed.");
    expect(handCountedWords(facts, "$12.38", null).text).toContain("Nothing more is owed for it.");
    expect(handCountedWords(facts, "$12.38", null).subject).toBe("$12.38 was taken back from your Stripe balance");
  });
});

describe("a refund that failed after Stripe had confirmed it", () => {
  it("tells a host who had paid nothing that nothing is owed", () => {
    const told = all(refundFellAwayWords(facts, null));
    expect(told).toContain("Nothing is owed after all: $12.38");
    expect(told).toContain("That refund did not go through after all");
    expect(told).toContain("Nothing is taken for it.");
  });

  it("tells a host who had already paid that the money is hers and that a person gives it back", () => {
    const told = all(refundFellAwayWords(facts, "$12.38"));
    expect(told).toContain("Connect owes you $12.38 back");
    expect(told).toContain("A person at Connect will look at this and give the $12.38 back to you.");
  });

  it("always tells the founder that the customer got nothing, and what became of the take-back", () => {
    const base = { what: "the call of Ana (host) and Ben (customer) on Monday", customerName: "Ben", hostName: "Ana", refunded: "$50.00", reason: "lost_or_stolen_card" };
    const none = all(refundFellAwayWordsForFounder({ ...base, debt: null }));
    expect(none).toContain("A refund failed after Stripe had confirmed it: Ben, $50.00");
    expect(none).toContain("The customer did not get the money");
    expect(none).toContain("What Stripe says: lost_or_stolen_card");
    expect(none).not.toContain("owed back");
    expect(all(refundFellAwayWordsForFounder({ ...base, debt: { amount: "$40.00", paidBack: null } }))).toContain("That is called off, and nothing was taken.");
    expect(all(refundFellAwayWordsForFounder({ ...base, debt: { amount: "$40.00", paidBack: "$40.00" } }))).toContain("send $40.00 to the host in Stripe");
  });
});

describe("settled outside the app, and a dispute won afterwards", () => {
  it("uses one sentence for a refund's and a dispute's take-back", () => {
    expect(settledWords(facts, "$10.00", "$2.38").text).toContain("you paid back $10.00, and Connect carries the remaining $2.38");
  });

  it("says that she paid it back herself when that is how it was", () => {
    expect(leftoverWords("host", facts, "paid").text).toContain("You had paid $12.38 back to Connect");
    expect(leftoverWords("founder", facts, "paid").subject).toContain("was paid back by Ana");
    expect(leftoverWords("host", facts).text).toContain("Connect had taken $12.38 back from you");
  });
});

describe("what was first owed, and what a reversal made by hand has already paid of it", () => {
  it("gives the sum for what was first owed, then the part already taken and what is still owed", () => {
    const told = owedWords({ ...facts, amount: "$10.38", byHand: { assessed: "$12.38", taken: "$2.00" } }).text;
    expect(told).toContain("the bank took the whole payment back, so $12.38 is owed. Of that, $2.00 has already been taken from your Stripe balance by a person at Connect, so $10.38 is still owed.");
    // What is taken from now on is what is still owed.
    expect(told).toContain("Connect will ask Stripe to take $10.38 back");
  });

  it("does the same for a refund's take-back", () => {
    const owed: DebtFacts = { ...facts, amount: "$40.00", sent: "$80.00", dueOn: null, refund: { refunded: "$50.00", shareBefore: "$80.00", shareAfter: "$40.00", reason: "The host did not join the call.", cutShort: false } };
    const told = refundOwedWords({ ...owed, amount: "$38.00", byHand: { assessed: "$40.00", taken: "$2.00" } }).text;
    expect(told).toContain("The difference is what you owe back: $40.00. Of that, $2.00 has already been taken from your Stripe balance by a person at Connect, so $38.00 is still owed.");
  });
});

describe("a reversal by hand on a take-back that had ended, and a share that was sent too small", () => {
  it("tells the founder that the host may have paid twice", () => {
    const told = all(handHeldWordsForFounder(facts, "$1.00", true));
    expect(told).toContain("whose take-back had ended");
    expect(told).toContain("the host has paid twice");
    expect(told).not.toContain("is on hold");
  });

  it("tells the founder, for an open one, to hold before reversing by hand another time", () => {
    expect(handHeldWordsForFounder(facts, "$1.00").text).toContain("hold the take-back on its page BEFORE you reverse anything by hand");
  });

  it("tells the host that the money is hers, and the founder to send it", () => {
    expect(all(handTwiceWords("host", facts, "$1.00"))).toContain("Connect owes you $1.00 back");
    expect(all(handTwiceWords("founder", facts, "$1.00"))).toContain("send $1.00 to the host in Stripe");
  });

  it("tells a host whose share was sent smaller because of a refund that then failed", () => {
    const told = all(shareRestoredWords({ what: "the payment for your call with Ben on Monday", customerName: "Ben", underpaid: "$20.00", supportEmail: "support@connect.example" }));
    expect(told).toContain("Connect owes you $20.00");
    expect(told).toContain("So $20.00 of your share was never sent to you.");
  });

  it("adds what was never sent, and what a later take-back asked too much, to the founder's email", () => {
    const base = { what: "the call", customerName: "Ben", hostName: "Ana", refunded: "$25.00", reason: "expired_or_canceled_card", debt: null };
    const told = all(refundFellAwayWordsForFounder({ ...base, underpaid: "$20.00", excess: "$0.01" }));
    expect(told).toContain("so $20.00 of their share was never sent to them");
    expect(told).toContain("send $0.01 more to the host in Stripe");
    expect(all(refundFellAwayWordsForFounder(base))).not.toContain("never sent");
  });
});

describe("more is owed than can still be taken, a take-back that comes out lower, and money taken after a waiver", () => {
  it("tells the founder what is left to take, how that is worked out, and that the app does not try again", () => {
    const told = all(noRoomWordsForFounder(facts, "$6.38"));
    expect(told).toContain("more is owed than can still be taken");
    expect(told).toContain("only $6.38 can still be taken out of that transfer");
    expect(told).toContain("less what the host paid back outside the app");
    // It does look again: the founder is not told that the app has stopped for good.
    expect(told).toContain("So nothing is taken now. The app looks again on every pass and takes it by itself as soon as it fits");
    expect(told).not.toContain("does not try again");
  });

  it("tells the host the new, lower amount, and that everything else stays", () => {
    const told = all(loweredWords({ ...facts, amount: "$40.02" }, "$40.03", "lower"));
    expect(told).toContain("Less is owed than we wrote: $40.02 instead of $40.03");
    expect(told).toContain("did not go through after all");
    expect(told).toContain("Everything else stays as it was");
  });

  it("names what a reversal by hand already took of the lowered amount", () => {
    const told = loweredWords({ ...facts, amount: "$38.02", byHand: { assessed: "$40.02", taken: "$2.00" } }, "$40.03", "lower").text;
    expect(told).toContain("What you owe for it is now $40.02, of which $2.00 has already been taken.");
  });

  it("tells the host when nothing is left of it", () => {
    const told = all(loweredWords(facts, "$0.01", "nothing"));
    expect(told).toContain("Nothing is owed after all: $0.01");
    expect(told).toContain("nothing is taken");
  });

  it("says that what was already taken covers it, and promises no day any more", () => {
    const told = all(loweredWords(facts, "$0.83", "covered"));
    expect(told).toContain("Nothing more is owed: $0.83");
    expect(told).toContain("What has already been taken from your Stripe balance for it covers all that is owed now.");
    expect(told).not.toContain("the day");
  });

  it("says that money was taken after the take-back was called off, not that it was paid twice", () => {
    const host = all(handTwiceWords("host", facts, "$1.00", "called_off"));
    expect(host).toContain("although Connect had called that take-back off");
    expect(host).not.toContain("already been settled");
    const founder = all(handTwiceWords("founder", facts, "$1.00", "called_off"));
    expect(founder).toContain("after the take-back was called off");
    expect(founder).toContain("although nothing was owed for it any more");
    expect(founder).not.toContain("twice");
  });
});

