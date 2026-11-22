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
  /**
   * For a lost dispute on a share that had refunds after it was sent: what those refunds had already taken off her
   * share, and what was left of it for this take-back to start from. Absent when there was no such refund.
   */
  afterRefunds?: { took: string; left: string } | null;
  /** The bank disputed only a part of the charge: that part, and what was left of the charge. Null when it was all of it. */
  part: { disputed: string; of: string } | null;
  /** Less than that part is asked for, and why: no more is owed than the bank took back ("bank"), or no more can be taken out of the transfer ("transfer"). */
  capped: "bank" | "transfer" | null;
  /**
   * From when it is taken, written for this reader. Null while that day is not known yet: it is 14 days after the
   * notice email was really sent, and the notice itself is written before that moment (plans/46-part-3, decision 6).
   */
  dueOn: string | null;
  hostName: string;
  customerName: string;
  supportEmail: string;
  /**
   * Only for a take-back that comes from a refund Connect gave after the host had collected (plans/46-part-3-money-owed.md):
   * what was given back to the customer, her share of the payment before and after it, the reason the founder gave,
   * and whether less than the difference is asked for because no more is left of what was sent.
   */
  refund?: { refunded: string; shareBefore: string; shareAfter: string; reason: string; cutShort: boolean };
};

const how = (facts: DebtFacts): string => {
  // What was really sent is always named as that. Where refunds had already taken part of it, that is said, and the
  // sum starts from what was left: the same money is never asked for twice.
  const lead = facts.afterRefunds ? `You were sent ${facts.sent} for this payment. Refunds given after that had already taken ${facts.afterRefunds.took} off your share, which left ${facts.afterRefunds.left}. ` : "";
  const of = facts.afterRefunds ? `the ${facts.afterRefunds.left} that was left of your share` : `the ${facts.sent} you were sent`;
  const sum = facts.part
    ? `${lead}The bank took back ${facts.part.disputed} of the ${facts.part.of} that was left of the charge, so the same part of ${of} is owed, rounded down to the cent: ${facts.amount}.`
    : facts.afterRefunds
      ? `${lead}The bank took back all that was left of the payment, so ${facts.amount} is owed.`
      : `You were sent ${facts.sent} for this payment, and the bank took the whole payment back, so ${facts.amount} is owed.`;
  return sum + (facts.capped === "bank" ? " (It is less than that: no more is owed than the bank took back.)" : facts.capped === "transfer" ? " (It is less than that: no more than this can be taken out of that transfer.)" : "");
};

/** To the host, when the take-back is written down: which payment, why, how much and how it is worked out, and their 14 days. */
export function owedWords(facts: DebtFacts): Told {
  return {
    subject: `Connect will ask Stripe to take back ${facts.amount}: a bank dispute was lost`,
    text:
      `The dispute ${facts.customerName}'s bank had opened over ${facts.what} is lost: the bank decided for the customer and took the money back from Connect. You had already collected your share of that payment.\n\n` +
      `${how(facts)} The bank's own fees are not charged to you.\n\n` +
      `${facts.dueOn ? `From ${facts.dueOn}` : "From 14 days after this message was sent to you by email"}, Connect will ask Stripe to take ${facts.amount} back from your Stripe balance. Until then nothing is taken. "Your earnings" on your Hosting page shows the day.\n\n` +
      `If you think this is wrong, say so before that day: press "I think this is wrong" on this dispute's page in the app (it is linked from this message and from "Your earnings"). From the moment you press it, nothing is taken until a person at Connect has looked at it and answered you.\n\n` +
      `You can also write to us at ${facts.supportEmail}. An email does not stop the taking by itself: it stops only when a person at Connect has put a hold on it, which can take a working day or longer. If the day is near, use the button.`,
  };
}

/** To the founder, at the same moment: what the app will do, and that it can be called off until then. */
export function owedWordsForFounder(facts: DebtFacts): Told {
  return {
    subject: `A host owes ${facts.amount} back after a lost dispute: ${facts.hostName}`,
    text:
      `The dispute over ${facts.what} is lost, and ${facts.hostName} had already collected their share (${facts.sent}).\n\n` +
      `The app has told the host that ${facts.amount} is owed${facts.part ? ` (the bank took back ${facts.part.disputed} of ${facts.part.of})` : ""}, and ${facts.dueOn ? `from ${facts.dueOn}` : "from 14 days after that notice went out by email"} it asks Stripe to take that amount back out of the transfer.\n\n` +
      `Nothing is needed from you. The host can object with a button; you are then told, and nothing is taken until you have decided. If the host objects by email instead, press "Hold it: the host objected" on the dispute's page at once: an email alone stops nothing. You can also cancel the take-back on the dispute's page until the app starts it.`,
  };
}

/** To the host, when Stripe has done it. */
export function takenWords(facts: DebtFacts): Told {
  return {
    subject: `Connect has taken back ${facts.amount}`,
    text:
      `Stripe has taken ${facts.amount} back from your Stripe balance, for ${facts.what}: the dispute ${facts.customerName}'s bank had opened over it was lost, and you had already collected your share.\n\n` +
      `Nothing more is owed for this take-back. If you think this is wrong, write to us at ${facts.supportEmail}.`,
  };
}

/** To the host, when a take-back is called off: by the founder, or because the bank decided the other way after all. */
export function cancelledWords(facts: DebtFacts, why: "founder" | "won"): Told {
  return {
    subject: `Nothing is taken back after all: ${facts.amount}`,
    text:
      `We had written that Connect would take ${facts.amount} back for ${facts.what}. That is called off: ` +
      (why === "won" ? "the bank looked at the dispute again and let the payment stand." : "Connect looked at it and decided not to take it.") +
      ` Nothing is taken for this take-back.`,
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

/**
 * A share was taken back (or the host paid it back herself, `how` "paid"), and then the bank decided the other way.
 * The app does not give it back by itself. `facts.amount` is what she really paid back, whichever way.
 */
export function leftoverWords(role: "host" | "founder", facts: DebtFacts, how: "taken" | "paid" = "taken"): Told {
  return role === "host"
    ? {
        subject: `A bank dispute was decided for you after all: ${facts.amount}`,
        text:
          `${how === "taken" ? `Connect had taken ${facts.amount} back from you` : `You had paid ${facts.amount} back to Connect`} for ${facts.what}, after the bank decided for the customer. The bank has now looked at it again and let the payment stand.\n\n` +
          `A person at Connect will look at this and give the ${facts.amount} back to you. You do not need to do anything; if you hear nothing within a few days, write to us at ${facts.supportEmail}.`,
      }
    : {
        subject: `To settle by hand: ${facts.amount} ${how === "taken" ? "was taken back from" : "was paid back by"} ${facts.hostName}, and the dispute is now won`,
        text:
          `${how === "taken" ? `The app took ${facts.amount} back from ${facts.hostName}` : `${facts.hostName} paid ${facts.amount} back`} for ${facts.what} after the dispute was lost. The bank has now decided the other way.\n\n` +
          `The app does not give the amount back by itself. This one needs you: send ${facts.amount} to the host in Stripe. The host has been told that a person will do that.`,
      };
}

/** To the host, right after "I think this is wrong": it is with a person now, and nothing is taken meanwhile. */
export function objectedWords(facts: DebtFacts): Told {
  return {
    subject: `We have your objection: ${facts.amount} is not taken for now`,
    text:
      `You told us that taking ${facts.amount} back for ${facts.what} is wrong. A person at Connect will read what you wrote and answer you.\n\n` +
      `Until you have that answer, nothing is taken for this take-back.`,
  };
}

/** To the founder, at the same moment: the host's own words, and the two things the founder can do. */
export function objectedWordsForFounder(facts: DebtFacts, objection: string): Told {
  return {
    subject: `A host objects to a take-back: ${facts.hostName}, ${facts.amount}`,
    text:
      `${facts.hostName} says that taking ${facts.amount} back for ${facts.what} is wrong. Nothing is taken until you have decided.\n\n` +
      `What the host wrote:\n${objection}\n\n` +
      `On its page (linked below) you can call the take-back off, or answer the host in writing and have it taken after all.`,
  };
}

/** To the host, when the founder has answered the objection and it is taken after all: the answer in full, and from when. */
export function answeredWords(facts: DebtFacts, answer: string): Told {
  return {
    subject: `Our answer to your objection: ${facts.amount} is taken back after all`,
    text:
      `We have looked at what you wrote about the ${facts.amount} for ${facts.what}. Our answer:\n\n${answer}\n\n` +
      `So Connect will ask Stripe to take ${facts.amount} back from your Stripe balance after all: not before 3 days after this message was sent to you by email, and not before the day the first notice named. "Your earnings" shows the day.\n\n` +
      `If you still think this is wrong, write to us at ${facts.supportEmail}.`,
  };
}

/**
 * To the founder: the notice (or the answer to an objection) is not confirmed as having reached the host, so the
 * take-back has no due day. It may have failed or bounced, or the sending service may simply never have said that it
 * was delivered; `why` says which. So it never says that the email did not arrive, only that its arrival is not shown.
 */
export function notDeliveredWords(facts: DebtFacts, which: "notice" | "answer", why: string): Told {
  return {
    subject: `A take-back is waiting: its ${which} is not confirmed as delivered to ${facts.hostName}`,
    text:
      `The ${which === "notice" ? "notice about" : "answer to the objection against"} taking ${facts.amount} back from ${facts.hostName} (for ${facts.what}) is not confirmed as delivered by email: ${why}\n\n` +
      `The days before it is taken count from that email arriving, so nothing is taken while this is so. The message is on the host's Messages page in the app. On its page (linked below) you can send it again (after the host has corrected their address, say), or call the take-back off.`,
  };
}

/**
 * The notice once more, when the founder sends it again because the first did not arrive. For a take-back that only
 * has its notice it is the notice itself, with a line saying why it comes again. For one whose objection was already
 * answered it does not point to the button (there is none any more): it repeats the answer and says where to write.
 */
export function noticeAgainWords(facts: DebtFacts, answer: string | null): Told {
  // (The first one may have arrived all the same: what is known is only that its arrival was never confirmed.)
  const why = "We are sending this again because we could not confirm that our first message about it reached you by email.";
  const first = facts.refund ? refundOwedWords(facts) : owedWords(facts);
  if (answer === null) return { subject: first.subject, text: `${why}\n\n${first.text}` };
  return {
    subject: first.subject,
    text:
      `${why}\n\n` +
      (facts.refund
        ? `${refundStory(facts)}\n\n${refundHow(facts)}\n\n`
        : `The dispute ${facts.customerName}'s bank had opened over ${facts.what} is lost: the bank decided for the customer and took the money back from Connect. You had already collected your share of that payment.\n\n` + `${how(facts)} The bank's own fees are not charged to you.\n\n`) +
      `You told us this is wrong, and we answered:\n\n${answer}\n\n` +
      `So Connect will ask Stripe to take ${facts.amount} back from your Stripe balance: not before 14 days after this message was sent to you by email. "Your earnings" on your Hosting page shows the day.\n\n` +
      `If you still think this is wrong, write to us at ${facts.supportEmail}.`,
  };
}

// ---------------------------------------------------------------------------
// A take-back that comes from a refund Connect gave after the host had collected
// (plans/46-part-3-money-owed.md). The same rule: never more than is known.
// ---------------------------------------------------------------------------

/** What happened, for the host: Connect gave the customer money back for a payment she had already collected, and why. */
const refundStory = (facts: DebtFacts): string =>
  `Connect has given ${facts.customerName} ${facts.refund!.refunded} back for ${facts.what}. You had already collected your share of that payment, so the money came from Connect.\n\n` +
  `Why Connect decided this refund: ${facts.refund!.reason}`;

/** How the amount is worked out, with the numbers that were used. */
const refundHow = (facts: DebtFacts): string =>
  `Your share of that payment was ${facts.refund!.shareBefore} before this refund and is ${facts.refund!.shareAfter} after it. ` +
  (facts.refund!.cutShort
    ? `That difference is more than is left of the ${facts.sent} that was really sent to you for this payment, so what you owe back is less than the difference: ${facts.amount}.`
    : `The difference is what you owe back: ${facts.amount}.`);

/** To the host, when the take-back is written down and the app will take it: what, why, how much, the 14 days, and how to object. */
export function refundOwedWords(facts: DebtFacts): Told {
  return {
    subject: `Connect will ask Stripe to take back ${facts.amount}: a payment you had collected was refunded`,
    text:
      `${refundStory(facts)}\n\n${refundHow(facts)}\n\n` +
      `${facts.dueOn ? `From ${facts.dueOn}` : "From 14 days after this message was sent to you by email"}, Connect will ask Stripe to take ${facts.amount} back from your Stripe balance. Until then nothing is taken. "Your earnings" on your Hosting page shows the day.\n\n` +
      `If you think this is wrong, say so before that day: press "I think this is wrong" on this take-back's page in the app (it is linked from this message and from "Your earnings"). From the moment you press it, nothing is taken until a person at Connect has looked at it and answered you.\n\n` +
      `You can also write to us at ${facts.supportEmail}. An email does not stop the taking by itself: it stops only when a person at Connect has put a hold on it, which can take a working day or longer. If the day is near, use the button.`,
  };
}

/** To the founder, at the same moment. */
export function refundOwedWordsForFounder(facts: DebtFacts): Told {
  return {
    subject: `A host owes ${facts.amount} back after your refund: ${facts.hostName}`,
    text:
      `You refunded ${facts.refund!.refunded} for ${facts.what} after ${facts.hostName} had collected their share. The customer was paid from Connect's money.\n\n` +
      `The app has told the host that ${facts.amount} is owed (their share was ${facts.refund!.shareBefore} and is ${facts.refund!.shareAfter}), and ${facts.dueOn ? `from ${facts.dueOn}` : "from 14 days after that notice arrived by email"} it asks Stripe to take that amount back out of the transfer.\n\n` +
      `Nothing is needed from you. The host can object with a button; you are then told, and nothing is taken until you have decided. If the host objects by email instead, press "Hold it: the host objected" on the take-back's page at once: an email alone stops nothing. You can also call the take-back off there, or record that it was settled outside the app.`,
  };
}

/**
 * To the host, when the take-back is written down and the app will NOT take it by itself: the Host Agreement was not
 * in force for that payment (plans/46-part-3-money-owed.md, decision 7). Nothing is promised about a date or a taking.
 */
export function refundWaitingWords(facts: DebtFacts): Told {
  return {
    subject: `You owe Connect ${facts.amount}: a payment you had collected was refunded`,
    text:
      `${refundStory(facts)}\n\n${refundHow(facts)}\n\n` +
      `Connect does not take this amount by itself. A person at Connect will write to you about how it is settled. Until then nothing is taken.\n\n` +
      `If you think this is wrong, write to us at ${facts.supportEmail}.`,
  };
}

/** To the founder, at the same moment: this one is theirs to settle. */
export function refundWaitingWordsForFounder(facts: DebtFacts): Told {
  return {
    subject: `To settle with a host: ${facts.hostName} owes ${facts.amount} after your refund`,
    text:
      `You refunded ${facts.refund!.refunded} for ${facts.what} after ${facts.hostName} had collected their share. The customer was paid from Connect's money, and the host owes ${facts.amount} (their share was ${facts.refund!.shareBefore} and is ${facts.refund!.shareAfter}).\n\n` +
      `The app does not take this one by itself: it takes money back only where the host had accepted a published Host Agreement before the customer's payment was held, and that cannot be shown for this payment. The host has been told that they owe it and that a person at Connect will write to them.\n\n` +
      `Settle it with the host, and then, on the take-back's page, record what they paid back ("Settled outside the app") or call it off.`,
  };
}

/** To the host, when Stripe has done it. */
export function refundTakenWords(facts: DebtFacts): Told {
  return {
    subject: `Connect has taken back ${facts.amount}`,
    text:
      `Stripe has taken ${facts.amount} back from your Stripe balance, for ${facts.what}: Connect had refunded ${facts.customerName} after you had collected your share.\n\n` +
      `Nothing more is owed for this take-back. If you think this is wrong, write to us at ${facts.supportEmail}.`,
  };
}

/** To the host, when the founder calls it off. */
export function refundCancelledWords(facts: DebtFacts): Told {
  return {
    subject: `Nothing is owed after all: ${facts.amount}`,
    text: `We had written that you owe Connect ${facts.amount} for ${facts.what}, after a refund. That is called off: Connect looked at it and decided to carry it. Nothing is taken, and nothing is owed for it.`,
  };
}

/** To the host, when the founder records that it was settled outside the app: what was paid, and that it is over. */
export function refundSettledWords(facts: DebtFacts, repaid: string, letGo: string | null): Told {
  return {
    subject: `Settled: the ${facts.amount} you owed Connect`,
    text:
      `Connect has recorded that the ${facts.amount} you owed for ${facts.what} is settled: you paid back ${repaid}${letGo ? `, and Connect carries the remaining ${letGo}` : ""}.\n\n` +
      `Nothing is taken from your Stripe balance for it, and nothing more is owed. If this is not right, write to us at ${facts.supportEmail}.`,
  };
}

/** To the founder, when Stripe has refused for 30 days. It keeps being tried. */
export function refundRefusedWords(facts: DebtFacts, lastRefusal: string | null): Told {
  return {
    subject: `A take-back has been refused for 30 days: ${facts.hostName}, ${facts.amount}`,
    text:
      `For 30 days Stripe has refused to take ${facts.amount} back from ${facts.hostName} (for ${facts.what}, after your refund).` +
      (lastRefusal ? ` What Stripe last said: ${lastRefusal}` : "") +
      `\n\nThe app keeps trying once a day. If the money is not to be taken, call the take-back off on its page, or settle it with the host and record that there.`,
  };
}

/** Settled outside the app: the same sentence for a take-back after a refund and after a lost dispute. */
export const settledWords = refundSettledWords;

// ---------------------------------------------------------------------------
// A reversal somebody made by hand at Stripe
// ---------------------------------------------------------------------------

/**
 * To the founder: a transfer has a reversal the app did not make, and nobody has said what it was for. The app takes
 * nothing more from that transfer by itself until the founder has said, because the same money could be taken twice.
 */
export function handHeldWordsForFounder(facts: DebtFacts, byHand: string): Told {
  return {
    subject: `A take-back is on hold: a reversal was made by hand at Stripe (${facts.hostName}, ${facts.amount})`,
    text:
      `${byHand} of the transfer to ${facts.hostName} for ${facts.what} was reversed by hand at Stripe, not by the app. The app cannot know what that was for, so it takes nothing more from this transfer by itself: the same money could be taken twice.\n\n` +
      `On the take-back's page (linked below), say for each such reversal whether it paid this take-back or had nothing to do with it. Once each one is accounted for, the app takes what is then still owed (${facts.amount} today), by its usual rules.`,
  };
}

/** To the host, when the founder records that a reversal made by hand paid (part of) the take-back. */
export function handCountedWords(facts: DebtFacts, counted: string, left: string | null): Told {
  return {
    subject: `${counted} was taken back from your Stripe balance`,
    text:
      `${counted} was taken back from your Stripe balance for ${facts.what}, by a person at Connect. It is counted for the money you owed back for that payment.\n\n` +
      (left ? `${left} of it is still owed.` : "Nothing more is owed for it.") +
      ` If this is not right, write to us at ${facts.supportEmail}.`,
  };
}

// ---------------------------------------------------------------------------
// A refund that Stripe first confirmed and that then failed after all
// ---------------------------------------------------------------------------

/**
 * To the host, when the refund her take-back came from did not go through after all. `paidBack` is what she had
 * already paid for it (taken by the app, by hand, or paid outside), or null when nothing was.
 */
export function refundFellAwayWords(facts: DebtFacts, paidBack: string | null): Told {
  const story = `Connect had refunded ${facts.customerName} for ${facts.what} after you had collected your share. That refund did not go through after all: the customer's bank sent the money back.`;
  return paidBack === null
    ? {
        subject: `Nothing is owed after all: ${facts.amount}`,
        text: `${story}\n\nSo your share of that payment is whole again, and the ${facts.amount} we had written that you owe is not owed. Nothing is taken for it.`,
      }
    : {
        subject: `Connect owes you ${paidBack} back`,
        text:
          `${story}\n\nYou had already paid ${paidBack} back for it (taken from your Stripe balance, or paid by you). That money is yours.\n\n` +
          `A person at Connect will look at this and give the ${paidBack} back to you. You do not need to do anything; if you hear nothing within a few days, write to us at ${facts.supportEmail}.`,
      };
}

/**
 * To the founder, always, when a refund fails after Stripe had confirmed it: the customer did not get the money, the
 * app has undone its record of the refund, and what became of the host's take-back.
 */
export function refundFellAwayWordsForFounder(input: { what: string; customerName: string; hostName: string; refunded: string; reason: string; debt: { amount: string; paidBack: string | null } | null }): Told {
  return {
    subject: `A refund failed after Stripe had confirmed it: ${input.customerName}, ${input.refunded}`,
    text:
      `The refund of ${input.refunded} to ${input.customerName} for ${input.what} first went through at Stripe and then failed. What Stripe says: ${input.reason}\n\n` +
      `The customer did not get the money; it is back in Connect's Stripe balance. The app has undone its record of the refund: that payment counts as refunded by ${input.refunded} less, and the host's share and Connect's fee are as they were before it. The customer had been told by email that the refund was on its way. If they should still get the money, refund them again; if their card no longer takes refunds, ask them how they want it.` +
      (input.debt === null
        ? ""
        : input.debt.paidBack === null
          ? `\n\n${input.hostName} had been told that ${input.debt.amount} is owed back for this refund. That is called off, and nothing was taken. The host has been told.`
          : `\n\n${input.hostName} had already paid ${input.debt.paidBack} back for this refund. The app does not give it back by itself. This one needs you: send ${input.debt.paidBack} to the host in Stripe. The host has been told that a person will do that.`),
  };
}
