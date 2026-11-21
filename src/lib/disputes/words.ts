/**
 * What the host, the customer and the founder are told about a bank dispute
 * (plans/47-bank-disputes.md, parts 1 and 2). Words only: no database, no network.
 *
 * Every sentence here must be true of the app as it is. The app records a dispute, keeps the money
 * where it is, asks the host what to do about a chargeback, answers the bank by itself, and keeps a
 * customer with an open chargeback from making a new agreement to pay. It does NOT take anything
 * back from a host (part 3 of the plan is not built): no sentence says it does. The words speak
 * only of THIS dispute and of the amount it is about: another dispute on the same payment, or
 * another reason, can still hold the money, so a host is sent to their earnings for what can be
 * collected.
 */
import type { Plan } from "./rules";
import type { Outcome, Stage, Standing } from "./status";

export type Role = "host" | "customer" | "founder";

export type Facts = {
  stage: Stage;
  /** Where it stood when this was written. A dispute can be first seen when the bank is already deciding. */
  standing: Standing;
  /** The bank takes no answer to this dispute at all. */
  noAnswer: boolean;
  /** What the app does about this stage (see planFor in rules.ts). */
  plan: Plan;
  /** A dispute about a card network's own rules, which costs 500 dollars to fight. */
  compliance: boolean;
  /** Until when the host can choose, written for this reader. Empty when nobody is asked. */
  askUntil: string | null;
  /** What the dispute is about, worded for this reader: "the payment for your call with Ana on Monday, ...". */
  what: string;
  /** The disputed amount, written out: "$13.33". */
  amount: string;
  /** The bank's reason, in words (see reasonWords). */
  reason: string;
  /** The bank's deadline for an answer, written for this reader, when Stripe gives one. */
  dueBy: string | null;
  /** That deadline is behind us, although Stripe still shows the dispute as waiting. */
  duePassed: boolean;
  /** In an appeal: the bank waits for an answer (true), or is already looking at one (false). */
  appealWaits: boolean;
  /** At the end: this dispute keeps its customer from new payments also from now on (lost after the app's own proof). */
  stopStays: boolean;
  /** The disputed payment is a membership's month: the dispute also ends that membership. */
  membership: boolean;
  hostName: string;
  customerName: string;
  supportEmail: string;
};

export type Told = { subject: string; text: string };

const WAIT = "The bank decides how it ends, which can take up to three months. We will tell you when it has.";

/** For the host of a chargeback: what Connect does next, and whether they have a say. */
function hostNext(facts: Facts): string {
  if (facts.standing !== "waiting") return "The bank is already deciding, so there is nothing to choose.";
  if (facts.noAnswer) return "The bank takes no answer to this dispute, so there is nothing to send. It decides by itself.";
  if (facts.plan === "leave") return "This is a dispute about the card network's own rules. Fighting one costs Connect 500 dollars each time, so Connect does not fight one of this size by itself.";
  if (facts.askUntil) {
    return (
      `You choose what Connect does: fight the dispute, or give the money back. Choose by ${facts.askUntil} on the dispute's page. ` +
      `If you do not choose by then, Connect fights it: it sends the bank its record of this payment.`
    );
  }
  return "There is no time left to ask you before the bank's deadline, so Connect is fighting it now: it sends the bank its record of this payment.";
}

/** For the founder: what the app does about it, and whether anything is needed from them. */
function founderNext(facts: Facts): string {
  if (facts.standing !== "waiting") return "Stripe shows it as with the bank already, so nothing can be sent to the bank now.";
  if (facts.noAnswer) return "The bank takes no answer to this one, so there is nothing to send. It decides by itself.";
  // Never an instruction that cannot be followed.
  const until = facts.dueBy ? (facts.duePassed ? `The bank's date for an answer, ${facts.dueBy}, has passed.` : `The bank wants an answer by ${facts.dueBy}.`) : "Stripe gives no date for an answer.";
  if (facts.plan === "leave") {
    return (
      `This is a compliance dispute: fighting it costs 500 dollars, returned only on a win. It is under the amount from which the app fights these, so the app sends nothing. ${until} ` +
      (facts.dueBy && facts.duePassed ? "It will be lost." : "If you want to fight this one, do it in Stripe before then. Otherwise it is lost when that date passes.")
    );
  }
  if (facts.plan === "answer") return `The app is answering the bank's question now, with its record of this payment. ${until} Nothing is needed from you.`;
  const fee = facts.compliance ? " This is a compliance dispute at or above the amount from which the app fights these: fighting it costs 500 dollars, returned only on a win." : "";
  return (
    (facts.askUntil ? `The host can choose until ${facts.askUntil}: fight it, or give the money back. Then the app answers the bank; with no choice it fights.` : "Nobody is asked: the app is sending its record of this payment to the bank now.") +
    ` ${until}${fee} Nothing is needed from you.`
  );
}

/** A stage began: the bank asked its question, or opened a chargeback (also when a question became one). */
export function beganWords(role: Role, facts: Facts): Told {
  const question = facts.stage === "question";
  if (role === "host") {
    return question
      ? {
          subject: `${facts.customerName}'s bank is asking about a payment`,
          text:
            `${facts.customerName}'s bank has asked about ${facts.what} (${facts.amount}).\n\n` +
            `This is a question from the bank, not yet a dispute. It often means the customer did not recognise the payment on their statement. ` +
            (facts.standing === "waiting" && facts.plan === "answer" ? `Connect is answering it now, with its record of this payment. ` : "") +
            `While the bank's question is open, the money for this payment cannot be collected. We will tell you how it ends.\n\n` +
            `Please do not contact the customer about it.`,
        }
      : {
          subject: `${facts.customerName}'s bank is disputing a payment`,
          text:
            `${facts.customerName}'s bank has opened a dispute over ${facts.what} (${facts.amount}). This means the customer asked their bank to take the payment back.\n\n` +
            `The bank's reason: ${facts.reason}.\n\n` +
            `${hostNext(facts)}\n\n` +
            `While the dispute is open, the money for this payment cannot be collected. ${WAIT}\n\n` +
            `Please do not contact the customer about it.`,
        };
  }
  if (role === "customer") {
    return question
      ? {
          subject: "Your bank asked us about a payment on Connect",
          text:
            `Your bank has asked us about ${facts.what} (${facts.amount}).\n\n` +
            `If you did not recognise the payment on your statement: this is what it was for. You do not need to do anything.\n\n` +
            `If something went wrong, write to us at ${facts.supportEmail} and a person will look at it.`,
        }
      : {
          subject: "Your bank opened a dispute about a payment on Connect",
          text:
            `Your bank told us that you disputed ${facts.what} (${facts.amount}).\n\n` +
            `If that was a mistake, or you did not recognise the payment on your statement, you can ask your bank to withdraw the dispute.\n\n` +
            `If something went wrong, write to us at ${facts.supportEmail} and a person will look at it.\n\n` +
            `While the dispute is open, you cannot start anything new that costs money on Connect: no new request for a call, no added time, no tip, no contribution and no new membership. ` +
            (facts.membership
              ? `This dispute also ends your membership with ${facts.hostName}, and calls booked from that membership are cancelled. Anything else you have already booked or agreed to stays as it is.\n\n`
              : `That changes nothing about calls you have already booked, or anything else you have already agreed to.\n\n`) +
            `Your bank decides how this ends, which can take up to three months. We will tell you when it has.`,
        };
  }
  return {
    subject: question ? `A bank is asking about a payment: ${facts.customerName} and ${facts.hostName}` : `A bank dispute was opened: ${facts.customerName} and ${facts.hostName}`,
    text:
      `${question ? "A bank has asked about" : "A bank has opened a dispute over"} ${facts.what} (${facts.amount}).\n\n` +
      `The bank's reason: ${facts.reason}.\n` +
      `${founderNext(facts)}\n\n` +
      `The app has recorded it, keeps the money for this payment where it is, and has told the host and the customer.`,
  };
}

/**
 * To a host only: a chargeback that was already waiting before the app could ask (it was recorded
 * while the app did not yet answer banks) can now be chosen about.
 */
export function choiceWords(facts: Facts): Told {
  return {
    subject: `You can now choose what Connect does about ${facts.customerName}'s dispute`,
    text: `${facts.customerName}'s bank has an open dispute over ${facts.what} (${facts.amount}).\n\n${hostNext(facts)}`,
  };
}

/** The bank has decided, or the dispute ended with no decision. */
export function endedWords(role: Role, facts: Facts, outcome: Outcome): Told {
  const earnings = "Your earnings on the Hosting page show when the money for this payment can be collected.";
  // Only a chargeback ever kept the customer from new payments, so only its ending says anything about them. It
  // speaks of this dispute alone: another one of theirs may still be open.
  const again = facts.stage === "chargeback" ? " This dispute no longer keeps you from starting new bookings and payments on Connect." : "";
  if (outcome === "closed") {
    // A question that stayed quiet, or a dispute that was stopped before the bank decided anything.
    const thing = facts.stage === "question" ? "question" : "dispute";
    const closed = facts.stage === "question" ? "is closed, and it did not become a dispute" : "was closed without a decision by the bank";
    const text =
      role === "host"
        ? `The ${thing} ${facts.customerName}'s bank had about ${facts.what} (${facts.amount}) ${closed}. It no longer holds the money back. ${earnings}`
        : role === "customer"
          ? `The ${thing} your bank had about ${facts.what} (${facts.amount}) ${closed}.${again || " Nothing changes for you."}`
          : `The bank's ${thing} about ${facts.what} (${facts.amount}) ${closed}. It no longer holds the money for this payment back.`;
    return { subject: role === "founder" ? `A bank's ${thing} is closed: ${facts.customerName} and ${facts.hostName}` : `The bank's ${thing} about a payment is closed`, text };
  }
  if (outcome === "won") {
    const text =
      role === "host"
        ? `The dispute ${facts.customerName}'s bank had opened over ${facts.what} (${facts.amount}) has ended: the bank let the payment stand. This dispute no longer holds the money back. ${earnings}`
        : role === "customer"
          ? `The dispute your bank had opened over ${facts.what} (${facts.amount}) has ended: your bank let the payment stand.${again}\n\nIf you think that is wrong, write to us at ${facts.supportEmail}.`
          : `The dispute over ${facts.what} (${facts.amount}) has ended in Connect's favour: the bank let the payment stand. This dispute no longer holds the money for it back.`;
    return { subject: role === "founder" ? `A bank dispute was won: ${facts.customerName} and ${facts.hostName}` : "A bank dispute has ended: the payment stands", text };
  }
  const forCustomer = facts.stopStays
    ? `\n\nConnect had sent your bank its record of this payment, which shows the charge was right. Because of that, starting new bookings and payments stays switched off for your account. ` +
      `If you think that is wrong, write to us at ${facts.supportEmail} and a person will look at it.`
    : again;
  const text =
    role === "host"
      ? `The dispute ${facts.customerName}'s bank had opened over ${facts.what} has ended: the bank decided for the customer, and the ${facts.amount} does not come back to Connect.\n\n` +
        `Your share of that money is no longer yours, and the money for this payment stays held back. If you had already collected it, Connect asks Stripe to take it back from your Stripe balance: ` +
        `you get a message with the amount first, and nothing is taken for 14 days after that.\n\n` +
        `If you think this is wrong, write to us at ${facts.supportEmail}.`
      : role === "customer"
        ? `The dispute your bank had opened over ${facts.what} has ended: your bank decided in your favour. The ${facts.amount} is yours again; your bank can tell you when it shows on your account.${forCustomer}`
        : `The dispute over ${facts.what} is lost: the bank decided for the customer, and the ${facts.amount} it had taken from Connect does not come back.\n\n` +
          `The host's share of this payment stays held back. If the host had already collected it, the app tells them the amount and, 14 days later, asks Stripe to take it back out of the transfer. ` +
          `You get an email when that is so, and can cancel it on the dispute's page until the app starts it.` +
          (facts.stopStays ? `\n\nThe customer cannot start new payments until you allow it again, on the dispute's page.` : "");
  return { subject: role === "founder" ? `A bank dispute was lost: ${facts.customerName} and ${facts.hostName}` : role === "customer" ? "A bank dispute has ended: your bank decided in your favour" : "A bank dispute has ended: the bank decided for the customer", text };
}

/** To the founder only: a dispute that was lost is being looked at by the bank once more. */
export function appealWords(facts: Facts): Told {
  return {
    subject: `A bank is looking at a lost dispute again: ${facts.customerName} and ${facts.hostName}`,
    text:
      `The dispute over ${facts.what} (${facts.amount}) is in an appeal at the bank.\n\n` +
      (!facts.appealWaits
        ? `The bank is already looking at what was sent, so nothing more can be sent now.`
        : facts.noAnswer
          ? `The bank takes no answer in this appeal, so there is nothing to send.`
          : facts.dueBy && facts.duePassed
            ? `The bank's date for an answer in this appeal, ${facts.dueBy}, has passed, so an answer may no longer be taken.`
            : `The bank waits for an answer in this appeal${facts.dueBy ? `, by ${facts.dueBy}` : ""}. The app sends nothing to the bank in an appeal: if you want to answer, that is done by hand in Stripe.`) +
      ` The app keeps the money for this payment where it is until the bank has decided.`,
  };
}

/** To the founder only: a fault. A dispute still waits for the app's answer a day before the bank's deadline. */
export function lateWords(facts: Facts, error: string | null): Told {
  return {
    subject: `A bank dispute has no answer yet and its deadline is near: ${facts.customerName} and ${facts.hostName}`,
    text:
      `The dispute over ${facts.what} (${facts.amount}) still waits for an answer, and the app has not been able to send one.` +
      `${facts.dueBy ? ` The bank's deadline is ${facts.dueBy}.` : ""}\n\n` +
      `${error ? `What Stripe last said: ${error}\n\n` : ""}` +
      `This one needs you: please answer it by hand in Stripe before the deadline. The app keeps trying.`,
  };
}
