/**
 * What people are told about a share that is taken back after a lost dispute
 * (plans/47-bank-disputes.md, decision 10 and part 3). Plain functions, so every sentence is tested.
 *
 * The rule for these: never more than is known. The app ASKS Stripe to take the amount back out of
 * the transfer that carried it. Whether Stripe does, and where Stripe then gets the money from (the
 * host's Stripe balance, later earnings, in some countries their bank account), is Stripe's.
 */
import type { Told } from "./words";

export type DebtFacts = {
  /** What the disputed payment was, worded for this reader. */
  what: string;
  /** What is taken back, written out: "$12.38". */
  amount: string;
  /** What had been sent to the host for it. */
  sent: string;
  /** The bank disputed only a part of the charge: that part, and what was left of the charge. Null when it was all of it. */
  part: { disputed: string; of: string } | null;
  /** The whole share could not be asked for: less than it is left of the transfer at Stripe. */
  capped: boolean;
  /** From when it is taken, written for this reader. */
  dueOn: string;
  hostName: string;
  customerName: string;
  supportEmail: string;
};

const how = (facts: DebtFacts): string =>
  (facts.part
    ? `The bank took back ${facts.part.disputed} of the ${facts.part.of} that was left of the charge, so the same part of the ${facts.sent} you were sent is owed, rounded down to the cent: ${facts.amount}.`
    : `You were sent ${facts.sent} for this payment, and the bank took the whole payment back, so ${facts.amount} is owed.`) + (facts.capped ? " (It is less than that part, because that is all that is left of the transfer at Stripe.)" : "");

/** To the host, when the take-back is written down: which payment, why, how much and how it is worked out, and their 14 days. */
export function owedWords(facts: DebtFacts): Told {
  return {
    subject: `Connect will take back ${facts.amount}: a bank dispute was lost`,
    text:
      `The dispute ${facts.customerName}'s bank had opened over ${facts.what} is lost: the bank decided for the customer and took the money back from Connect. You had already collected your share of that payment.\n\n` +
      `${how(facts)} The bank's own fees are not charged to you.\n\n` +
      `From ${facts.dueOn}, Connect will ask Stripe to take ${facts.amount} back from your Stripe balance. Until then nothing is taken.\n\n` +
      `If you think this is wrong, write to us at ${facts.supportEmail} before that date and a person will look at it.`,
  };
}

/** To the founder, at the same moment: what the app will do, and that it can be called off until then. */
export function owedWordsForFounder(facts: DebtFacts): Told {
  return {
    subject: `A host owes ${facts.amount} back after a lost dispute: ${facts.hostName}`,
    text:
      `The dispute over ${facts.what} is lost, and ${facts.hostName} had already collected their share (${facts.sent}).\n\n` +
      `The app has told the host that ${facts.amount} is owed${facts.part ? ` (the bank took back ${facts.part.disputed} of ${facts.part.of})` : ""}, and from ${facts.dueOn} it asks Stripe to take that amount back out of the transfer.\n\n` +
      `Nothing is needed from you. If the host objects and you agree, you can cancel the take-back on the dispute's page until the app starts it.`,
  };
}

/** To the host, when Stripe has done it. */
export function takenWords(facts: DebtFacts): Told {
  return {
    subject: `Connect has taken back ${facts.amount}`,
    text:
      `Stripe has taken ${facts.amount} back from your Stripe balance, for ${facts.what}: the dispute ${facts.customerName}'s bank had opened over it was lost, and you had already collected your share.\n\n` +
      `Nothing more is owed for this payment. If you think this is wrong, write to us at ${facts.supportEmail}.`,
  };
}

/** To the host, when a take-back is called off: by the founder, or because the bank decided the other way after all. */
export function cancelledWords(facts: DebtFacts, why: "founder" | "won"): Told {
  return {
    subject: `Nothing is taken back after all: ${facts.amount}`,
    text:
      `We had written that Connect would take ${facts.amount} back for ${facts.what}. That is called off: ` +
      (why === "won" ? "the bank looked at the dispute again and let the payment stand." : "Connect looked at it and decided not to take it.") +
      ` Nothing is taken for this payment.`,
  };
}

/** To the founder, when Stripe has refused for 30 days. It keeps being tried. */
export function refusedWords(facts: DebtFacts, lastRefusal: string | null): Told {
  return {
    subject: `A take-back has been refused for 30 days: ${facts.hostName}, ${facts.amount}`,
    text:
      `For 30 days Stripe has refused to take ${facts.amount} back from ${facts.hostName} (for ${facts.what}, after a lost dispute).` +
      (lastRefusal ? ` What Stripe last said: ${lastRefusal}` : "") +
      `\n\nThe app keeps trying once a day. If the money is not to be taken, cancel the take-back on the dispute's page; otherwise this one may need you to settle it with the host.`,
  };
}

/** A share was taken back, and then the bank decided the other way. The app does not give it back by itself. */
export function leftoverWords(role: "host" | "founder", facts: DebtFacts): Told {
  return role === "host"
    ? {
        subject: `A bank dispute was decided for you after all: ${facts.amount}`,
        text:
          `Connect had taken ${facts.amount} back from you for ${facts.what}, after the bank decided for the customer. The bank has now looked at it again and let the payment stand.\n\n` +
          `A person at Connect will look at this and give the ${facts.amount} back to you. You do not need to do anything; if you hear nothing within a few days, write to us at ${facts.supportEmail}.`,
      }
    : {
        subject: `To settle by hand: ${facts.amount} was taken back from ${facts.hostName}, and the dispute is now won`,
        text:
          `The app took ${facts.amount} back from ${facts.hostName} for ${facts.what} after the dispute was lost. The bank has now decided the other way.\n\n` +
          `The app does not give the amount back by itself. This one needs you: send ${facts.amount} to the host in Stripe. The host has been told that a person will do that.`,
      };
}
