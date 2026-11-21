/**
 * The proof the app sends to a bank (plans/47-bank-disputes.md, decision 8).
 *
 * Two halves. `gatherFacts` (evidence.ts) reads what the app has on record about the disputed payment,
 * at the moment of sending. `proofFrom`, here, turns those facts into the fields Stripe passes on to
 * the bank; it is a plain function of the facts, with no database and no network, so every sentence
 * it can write is tested without Stripe.
 *
 * The rule for every sentence: only what is on record for THIS payment, and only what is true.
 *   - It is built from why the money was taken: time in a call, a late cancellation, a charge Connect
 *     set after a review, a membership's month, a contribution, a tip.
 *   - A late cancellation never says the call took place, and never says nobody joined unless the
 *     record shows that.
 *   - A refund request is told as the record has it. No length of time is claimed.
 *   - Agreements are named only where the person accepted a PUBLISHED version before the payment.
 *     A draft is never presented as accepted, and no text of an agreement is quoted.
 *   - No device and no internet address: the app cannot tie one to a payment.
 *   - A name a person typed (a host's display name, a project's name) goes in only if it holds no link and no
 *     address of any kind; otherwise plain words stand in for it.
 *   - A fact that does not help is said as it is. Nothing is left out to look better.
 * A bank does not open links, so there are none.
 */
import type { Stage } from "./status";

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
/** Every time is written in UTC and says so: a bank's reader may be anywhere. */
const at = (moment: Date) => `${moment.toISOString().slice(0, 16).replace("T", " ")} UTC`;
const day = (moment: Date) => moment.toISOString().slice(0, 10);
const minutes = (seconds: number) => {
  const whole = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${whole} min` : `${whole} min ${rest} s`;
};

/** One stay in the call room. `joined` is null when the video service recorded a leaving with no joining before it. */
export type Visit = { who: "host" | "customer"; joined: Date | null; left: Date | null };

export type CallFacts = {
  kind: "call";
  startsAt: Date;
  endsAt: Date;
  pricePer15Cents: number;
  bookedCents: number;
  /** The stretch of the call this payment is for is time added during the call. */
  addedTime: boolean;
  /** What is paid for: the host's time in the room ("host") or the time both were in it ("together"). */
  billing: string;
  /** attendance, late_cancel or admin. */
  chargeReason: string | null;
  /** The seconds the charge was worked out from, as they were at that moment. Null when the app has no such record of this charge: then no rule is given as its explanation. */
  charged: { hostSeconds: number; customerSeconds: number; togetherSeconds: number } | null;
  /** The call's record was changed by a late message after the money was taken (and the amount was worked out from the record before it). */
  recordChanged: boolean;
  visits: Visit[];
  /** Minutes before the start that cancelling was free, fixed when the call was booked. */
  freeCancelMinutes: number;
  cancelledAt: Date | null;
  cancelledBy: string | null;
  /** The charge was lowered by an answer to a refund request before the money was taken. */
  loweredBy: string | null;
  /** `decidedAs`: who answered it, "host" or "admin". `answeredByRefund`: still marked "asked", but a refund given after it went through, which answers it. */
  refundRequest: { askedAt: Date; reason: string; status: string; decidedAt: Date | null; decidedAs: string | null; answeredByRefund: boolean } | null;
};

export type MonthFacts = {
  kind: "month";
  number: number;
  includedMinutes: number;
  pricePer15Cents: number;
  startsAt: Date | null;
  endsAt: Date | null;
  usedCents: number;
  /**
   * The agreement this month was charged under, and when the member made it. Nothing is said about when a member
   * joined or stopped: a dispute ends the membership, and the ending clears those marks.
   */
  agreedAt: Date | null;
};

export type GiftFacts = {
  kind: "contribution";
  tip: boolean;
  monthly: boolean;
  /** The number of this payment: 1, or the month of a monthly contribution. */
  number: number;
  projectName: string | null;
  /** For a tip: the call it says thank you for. */
  callStartsAt: Date | null;
  agreedAt: Date | null;
};

export type ProofFacts = {
  stage: Stage;
  /** The bank's reason, in Stripe's word. */
  bankReason: string;
  customer: { name: string; email: string; since: Date };
  hostName: string;
  /** What was taken, what of it has been refunded, and when it was taken. */
  chargedCents: number;
  refundedCents: number;
  chargedAt: Date | null;
  disputedCents: number;
  /** Other payments of this customer on Connect, taken before this one, for which Connect has no dispute on record. */
  earlierPayments: number;
  /** Published agreements this person accepted before the payment. Drafts are never in this list. */
  accepted: Array<{ title: string; version: string; at: Date }>;
  about: CallFacts | MonthFacts | GiftFacts;
};

/** What Stripe passes on to the bank. Only text: the fields that fit a service delivered over the internet. */
export type Proof = {
  product_description: string;
  customer_name: string;
  customer_email_address: string;
  service_date?: string;
  access_activity_log?: string;
  refund_policy_disclosure?: string;
  refund_refusal_explanation?: string;
  cancellation_policy_disclosure?: string;
  cancellation_rebuttal?: string;
  uncategorized_text: string;
};

// ---------------------------------------------------------------------------
// The words
// ---------------------------------------------------------------------------

const who = (visit: Visit) => (visit.who === "host" ? "The host" : "The customer");

/** A name somebody typed, if it is plain: with a link, an email address or a web address in it, plain words stand in. */
const LINKISH = /https?:|www\.|@|[a-z0-9-]\.[a-z]{2,}(?![a-z])|\d+\.\d+\.\d+|[0-9a-f]{0,4}(:[0-9a-f]{0,4}){2,}/i;
const plain = (name: string | null | undefined, instead: string): string => {
  const clean = (name ?? "").replace(/\s+/g, " ").trim();
  return clean && !LINKISH.test(clean) ? clean.slice(0, 120) : instead;
};

/** As many lines of the room's record as a bank will read (and as Stripe's field holds). */
const MOST_VISITS = 60;

function activity(visits: Visit[]): string {
  if (visits.length === 0) return "The video service's record shows nobody joining this call.";
  const lines = visits.slice(0, MOST_VISITS).map((visit) =>
    visit.joined
      ? `${who(visit)} joined at ${at(visit.joined)}${visit.left ? ` and left at ${at(visit.left)}` : " (no leaving time was recorded)"}.`
      : `${who(visit)} left at ${at(visit.left!)} (no joining time was recorded).`,
  );
  if (visits.length > MOST_VISITS) lines.push(`(${visits.length - MOST_VISITS} more entries of this kind are on record.)`);
  return lines.join("\n");
}

function callSentences(facts: ProofFacts, call: CallFacts): { what: string; service: string; cancel?: { rule: string; rebuttal?: string }; refund?: string } {
  const booked = `a private one-to-one video call with ${plain(facts.hostName, "a host")}, booked on Connect for ${at(call.startsAt)} to ${at(call.endsAt)} at ${money(call.pricePer15Cents)} per 15 minutes (${money(call.bookedCents)} for the booked time)`;
  const customerJoined = call.visits.some((visit) => visit.who === "customer");
  const hostJoined = call.visits.some((visit) => visit.who === "host");
  const paysFor = call.billing === "together" ? "the time the host and the customer were in the call together" : "the time the host was in the call room during the booked time";
  let service: string;
  let cancel: { rule: string; rebuttal: string } | undefined;
  if (call.chargeReason === "late_cancel") {
    const rule = `Cancelling was free until ${call.freeCancelMinutes} minutes before the start. After that the booked price is charged.`;
    service =
      `This charge is for a call the customer cancelled late. ${call.cancelledAt ? `The customer cancelled at ${at(call.cancelledAt)}; the call was to start at ${at(call.startsAt)}.` : "The call was cancelled by the customer after the time in which cancelling is free."} ` +
      `The cancelling rule of this call was fixed and shown when it was booked. ${rule} ${money(facts.chargedCents)} was charged under that rule.` +
      (call.visits.length > 0 ? ` The video service's record of the call room:\n${activity(call.visits)}` : "");
    cancel = {
      rule: `The cancelling rule was shown on the booking page before the customer booked, and fixed on the booking: ${rule}`,
      rebuttal: call.cancelledAt ? `The customer cancelled at ${at(call.cancelledAt)}, after the free time had ended, for a call starting at ${at(call.startsAt)}.` : "The customer cancelled after the free time had ended.",
    };
  } else if (call.chargeReason === "admin") {
    service =
      `Nothing was charged automatically for this call: it was held for a review by Connect. Connect looked at the record and set the charge at ${money(facts.chargedCents)}. The video service's record of the call:\n${activity(call.visits)}`;
  } else {
    const counted = call.charged ? (call.billing === "together" ? call.charged.togetherSeconds : call.charged.hostSeconds) : null;
    service =
      counted !== null
        ? `Connect charges only for time that took place: ${paysFor}, at the booked price. For this call that was ${minutes(counted)}, and ${money(facts.chargedCents)} was charged for it. ` +
          `The video service's record of the call:\n${activity(call.visits)}` +
          (!customerJoined && hostJoined ? `\nThe customer did not join.${call.billing === "together" ? "" : " Under the booking's terms the host's time in the room during the booked time is paid for."}` : "") +
          (call.recordChanged ? "\nA later message from the video service changed this record after the money was taken. The record above is as it stands now; the amount charged was worked out from the record as it stood at that time." : "")
        : // No record of what the amount was worked out from: the amount and the room's record are given, and nothing more is claimed.
          `${money(facts.chargedCents)} was charged for this call. The video service's record of the call:\n${activity(call.visits)}`;
  }
  const request = call.refundRequest;
  const refund = request
    ? `The customer asked for a refund in the app on ${at(request.askedAt)}. ` +
      (request.status === "asked"
        ? request.answeredByRefund
          ? // The request is the call's; the refund that answered it can be of this payment or of another one of the same call.
            facts.refundedCents > 0
            ? "A refund was given after that request."
            : "After that request a refund was given for another payment of the same call, not for this one."
          : "The request had not been answered when this was written."
        : request.status === "closed"
          ? "Connect closed the request."
          : request.status === "declined"
            ? `${request.decidedAs === "admin" ? "Connect" : "The host"} answered${request.decidedAt ? ` on ${at(request.decidedAt)}` : ""}: no refund.`
            : `The request was answered${request.decidedAt ? ` on ${at(request.decidedAt)}` : ""}${call.loweredBy ? ", and the charge was lowered by that answer before the money was taken" : ""}.`)
    : // A call cancelled late has no refund request in the app, so nothing is said about one.
      call.chargeReason === "late_cancel"
      ? undefined
      : "The customer made no refund request in the app for this call.";
  return { what: booked + (call.addedTime ? ". This payment is for time the customer asked to add during the call" : ""), service, cancel, refund };
}

function monthSentences(facts: ProofFacts, month: MonthFacts): { what: string; service: string; cancel: { rule: string; rebuttal?: string } } {
  const period = month.startsAt && month.endsAt ? ` for ${day(month.startsAt)} to ${day(month.endsAt)}` : "";
  const what = `month ${month.number} of a membership with ${plain(facts.hostName, "a host")} on Connect: ${month.includedMinutes} minutes of private video calls with this host${period}, at ${money(month.pricePer15Cents)} per 15 minutes`;
  const service =
    `A membership is a monthly payment for call time with one host. ` +
    (month.agreedAt ? `The customer agreed to this membership and its monthly renewal on ${at(month.agreedAt)}. ` : "") +
    `Of this month's ${money(facts.chargedCents)}, ${money(month.usedCents)} had been used for calls when this was written.`;
  // The rule only. Whether and when this member stopped is not said: the app's marks for it do not outlast a dispute.
  return { what, service, cancel: { rule: "When joining, the customer ticked a box whose words say that the membership renews every month until they cancel. Their membership's page in the app has the button that stops it." } };
}

function giftSentences(facts: ProofFacts, gift: GiftFacts): { what: string; service: string } {
  const host = plain(facts.hostName, "a host");
  const what = gift.tip
    ? `a tip the customer chose to give ${host} on Connect${gift.callStartsAt ? ` after their video call of ${at(gift.callStartsAt)}` : ""}`
    : `a contribution the customer chose to make to ${gift.projectName && plain(gift.projectName, "") ? `"${plain(gift.projectName, "")}"` : "a project"}, a project of ${host} on Connect${gift.monthly ? ` (payment ${gift.number} of a monthly contribution)` : ""}`;
  const service =
    (gift.tip
      ? `A tip is a thank-you to a host after a call. It is a gift from the customer, not a payment for goods or a service. The amount taken includes the card payment fee, which the page showed before the customer confirmed. `
      : `A contribution supports a host's project. The page on which the customer made it said that it does not buy a call or any promised reward. `) +
    (gift.agreedAt ? `The customer chose the amount and confirmed it on ${at(gift.agreedAt)}.` : "The customer chose the amount themselves.");
  return { what, service };
}

/** The opening of the letter: what answers the bank's stated reason, said first. */
function opening(facts: ProofFacts): string {
  const account = `The payment was made from the Connect account of ${plain(facts.customer.name, "the customer")} (${facts.customer.email}), which was opened on ${day(facts.customer.since)}.`;
  const earlier = facts.earlierPayments > 0 ? ` The same account made ${facts.earlierPayments} earlier payment${facts.earlierPayments === 1 ? "" : "s"} on Connect for which Connect has no dispute on record.` : "";
  switch (facts.bankReason) {
    case "fraudulent":
    case "unrecognized":
      return `The cardholder says they did not make, or do not recognise, this payment. ${account}${earlier}`;
    case "product_not_received":
      return `The cardholder says they did not get what they paid for. What was paid for, and what the record shows of it, follows. ${account}`;
    case "product_unacceptable":
      return `The cardholder says what they got was not as promised. What was paid for, and what the record shows of it, follows. ${account}`;
    case "subscription_canceled":
      return `The cardholder says they had cancelled. What was paid for, and the rule for cancelling it, follows. ${account}`;
    case "duplicate":
      return `The cardholder says they were charged twice. What this payment was for is described below. ${account}`;
    case "credit_not_processed":
      return `The cardholder says a refund they were promised did not arrive. What the app's record shows about refunds for this payment follows. ${account}`;
    default:
      return `This is what the payment was for, and what Connect's record shows of it. ${account}`;
  }
}

/** The proof, from the facts. Every sentence here is one the facts support. */
export function proofFrom(facts: ProofFacts): Proof {
  const about = facts.about;
  const parts = about.kind === "call" ? callSentences(facts, about) : about.kind === "month" ? { ...monthSentences(facts, about), refund: undefined } : { ...giftSentences(facts, about), cancel: undefined, refund: undefined };
  const charged = `${money(facts.chargedCents)} was taken${facts.chargedAt ? ` on ${at(facts.chargedAt)}` : ""}.`;
  const refunded = facts.refundedCents > 0 ? ` ${money(facts.refundedCents)} of it has been refunded to the card.` : " Nothing of it has been refunded.";
  const agreements =
    facts.accepted.length > 0
      ? `Before this payment the customer had accepted: ${facts.accepted.map((one) => `the ${one.title}, version ${one.version}, on ${at(one.at)}`).join("; ")}.`
      : "";
  const letter = [
    opening(facts),
    `What was paid for: ${parts.what}. ${charged}${refunded}`,
    parts.service,
    parts.refund ?? "",
    agreements,
    // A bank's question gets the same facts, shorter: the long form is for a chargeback.
  ]
    .filter(Boolean)
    .join("\n\n");
  const proof: Proof = {
    product_description: `Connect is a website for private, paid, one-to-one video calls with hosts. This payment: ${parts.what}.`,
    customer_name: plain(facts.customer.name, "the customer"),
    customer_email_address: facts.customer.email,
    uncategorized_text: facts.stage === "question" ? [opening(facts), `What was paid for: ${parts.what}. ${charged}${refunded}`, parts.service, agreements].filter(Boolean).join("\n\n") : letter,
  };
  if (about.kind === "call") {
    // The day of the service and the record of who was in the call, only where the charge is for time in the call: a
    // call cancelled late was not held, and no day is given as the day it was.
    if (about.chargeReason !== "late_cancel") {
      // A day is given as the day of the service only when the record shows somebody in the room.
      if (about.visits.length > 0) proof.service_date = day(about.startsAt);
      proof.access_activity_log = activity(about.visits);
    }
    // Only where it held for this call: a call cancelled late has no refund request in the app.
    if (about.chargeReason !== "late_cancel") proof.refund_policy_disclosure = "After a call, the customer's page for that call in the app offers a refund request to the host for a limited time, and shows until when.";
    if (parts.refund) proof.refund_refusal_explanation = parts.refund;
  }
  if (parts.cancel) {
    proof.cancellation_policy_disclosure = parts.cancel.rule;
    if (parts.cancel.rebuttal) proof.cancellation_rebuttal = parts.cancel.rebuttal;
  }
  return proof;
}
