/**
 * What the host, the customer and the founder are told about a bank dispute
 * (plans/47-bank-disputes.md, part 1). Words only: no database, no network.
 *
 * Every sentence here must be true of the app as it is. Today the app records a dispute, keeps
 * the money where it is, and tells people. It does not answer the bank yet, and it does not take
 * anything back from a host: the words say neither.
 */
import type { Outcome, Stage } from "./status";

export type Role = "host" | "customer" | "founder";

export type Facts = {
  stage: Stage;
  /** What the dispute is about, worded for this reader: "the payment for your call with Ana on Monday, ...". */
  what: string;
  /** The disputed amount, written out: "$13.33". */
  amount: string;
  /** The bank's reason, in words (see reasonWords). */
  reason: string;
  /** The bank's deadline for an answer, written for this reader, when Stripe gives one. */
  dueBy: string | null;
  hostName: string;
  customerName: string;
  supportEmail: string;
};

export type Told = { subject: string; text: string };

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
            `While the bank's question is open, the money for this payment cannot be collected. We will tell you how it ends.\n\n` +
            `Please do not contact the customer about it.`,
        }
      : {
          subject: `${facts.customerName}'s bank is disputing a payment`,
          text:
            `${facts.customerName}'s bank has opened a dispute over ${facts.what} (${facts.amount}). This means the customer asked their bank to take the payment back.\n\n` +
            `The bank's reason: ${facts.reason}.\n\n` +
            `While the dispute is open, the money for this payment cannot be collected. The bank decides how it ends, which can take up to three months. We will tell you when it has.\n\n` +
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
            `Your bank decides how this ends, which can take up to three months. We will tell you when it has.`,
        };
  }
  return {
    subject: question ? `A bank is asking about a payment: ${facts.customerName} and ${facts.hostName}` : `A bank dispute was opened: ${facts.customerName} and ${facts.hostName}`,
    text:
      `${question ? "A bank has asked about" : "A bank has opened a dispute over"} ${facts.what} (${facts.amount}).\n\n` +
      `The bank's reason: ${facts.reason}.\n` +
      `${facts.dueBy ? `The bank wants an answer by ${facts.dueBy}.` : "Stripe gives no date for an answer."}\n\n` +
      `The app has recorded it, keeps the money for this payment where it is, and has told the host and the customer. ` +
      `It does not answer the bank yet: for now that still has to be done by hand in Stripe.`,
  };
}

/** The bank has decided, or the dispute ended with no decision. */
export function endedWords(role: Role, facts: Facts, outcome: Outcome): Told {
  if (outcome === "closed") {
    const text =
      role === "host"
        ? `The question ${facts.customerName}'s bank had about ${facts.what} (${facts.amount}) is closed, and it did not become a dispute. The money for this payment can be collected again.`
        : role === "customer"
          ? `The question your bank had about ${facts.what} (${facts.amount}) is closed. Nothing changes for you.`
          : `The bank's question about ${facts.what} (${facts.amount}) is closed and did not become a dispute. The money for this payment can move again.`;
    return { subject: role === "founder" ? `A bank's question is closed: ${facts.customerName} and ${facts.hostName}` : "The bank's question about a payment is closed", text };
  }
  if (outcome === "won") {
    const text =
      role === "host"
        ? `The dispute ${facts.customerName}'s bank had opened over ${facts.what} (${facts.amount}) has ended: the payment stands. The money for it can be collected again.`
        : role === "customer"
          ? `The dispute your bank had opened over ${facts.what} (${facts.amount}) has ended: the payment stands.\n\nIf you think that is wrong, write to us at ${facts.supportEmail}.`
          : `The dispute over ${facts.what} (${facts.amount}) has ended in Connect's favour: the payment stands, and the money for it can move again.`;
    return { subject: role === "founder" ? `A bank dispute was won: ${facts.customerName} and ${facts.hostName}` : "A bank dispute has ended: the payment stands", text };
  }
  const text =
    role === "host"
      ? `The dispute ${facts.customerName}'s bank had opened over ${facts.what} (${facts.amount}) has ended: the bank returned the money to the customer.\n\n` +
        `That undoes the payment, so your share of it is no longer yours. It stays out of what you can collect. If you had already collected it, Connect will write to you about that.\n\n` +
        `If you think this is wrong, write to us at ${facts.supportEmail}.`
      : role === "customer"
        ? `The dispute your bank had opened over ${facts.what} has ended: your bank returned ${facts.amount} to you.`
        : `The dispute over ${facts.what} (${facts.amount}) is lost: the bank returned the money to the customer.\n\n` +
          `The host's share of this payment stays held back. If the host had already collected it, nothing is taken back by the app: that still has to be settled by hand.`;
  return { subject: role === "founder" ? `A bank dispute was lost: ${facts.customerName} and ${facts.hostName}` : "A bank dispute has ended: the bank returned the money", text };
}
