/**
 * What a host is told when Connect sent her earnings without being asked, because she had not
 * collected for 12 months (plans/46-part-3-money-owed.md, decision 12). Plain functions, so every
 * sentence is tested.
 *
 * The rule for these: only what is known, about this collection. What was sent is what Stripe
 * confirmed. A share that did not go is named as not sent in this collection, without a reason the
 * record may not hold (Stripe may have refused it, or the request may never have left). A share
 * with no clear answer yet is named as still being checked, and never as sent. Nothing is said
 * about what is hers afterwards: a refund or a bank dispute can change a share by the time she
 * reads this, and her Hosting page shows how it stands.
 */

export type UncollectedFacts = {
  /** Confirmed as sent to her Stripe payout account, written out: "$79.75". Null when nothing was. */
  sent: string | null;
  /** The collection charge that was really taken. Null when none was. */
  charge: string | null;
  /** What was not sent. Null when nothing was. */
  notSent: string | null;
  /** What has no clear answer from Stripe yet. Null when nothing is. */
  checking: string | null;
  /** The collection charge carried by what has no clear answer yet: not known to be taken or not. Null when none is. */
  checkingCharge: string | null;
  /** Her host profile is in another country than the United States, so her bank is probably not paid in US dollars. */
  abroad: boolean;
};

export function uncollectedWords(facts: UncollectedFacts): { subject: string; text: string } {
  const open = Boolean(facts.checking || facts.checkingCharge);
  const lines: string[] = [];
  lines.push(
    "You had not collected your earnings on Connect for more than 12 months. When that happens, Connect starts the collection for you, so that your money does not stay with us. It is the same collection your own button makes, under the same rules.",
    "",
  );
  if (facts.sent) {
    lines.push(`Sent to your Stripe payout account: ${facts.sent}, in US dollars.`);
    if (facts.charge) lines.push(`The collection charge that was taken: ${facts.charge}. The amount above is what was sent after it.`);
  } else if (open) lines.push("Nothing is confirmed as sent yet.");
  else lines.push("Nothing was sent, and no collection charge was taken.");
  if (facts.notSent) lines.push(`Not sent in this collection: ${facts.notSent}.`);
  if (facts.checking) {
    lines.push(
      `Still being checked: ${facts.checking}${facts.checkingCharge ? `, with a collection charge of ${facts.checkingCharge}` : ""}. We have no clear answer from Stripe for it yet. If it went through, it is in your Stripe payout account.`,
    );
  } else if (facts.checkingCharge) {
    lines.push(`Still being checked: a collection charge of ${facts.checkingCharge}. We do not know yet whether it is taken.`);
  }
  if (facts.notSent || open) lines.push('"Your earnings" on your Hosting page shows what is yours to collect now.');
  if (facts.sent || facts.checking) {
    lines.push(
      "",
      facts.abroad
        ? "Stripe pays what it received to your bank account. If your bank account is not in US dollars, Stripe turns the dollars into your own money when it pays your bank, at its exchange rate of that moment."
        : "Stripe pays what it received to your bank account.",
    );
  }
  lines.push("", 'You can collect your earnings yourself, once in 24 hours, with "Collect earnings" on your Hosting page.');
  return {
    subject: facts.sent ? `We sent you your earnings: ${facts.sent}` : open ? "We are sending you your earnings" : "We tried to send you your earnings",
    text: lines.join("\n"),
  };
}

/** On her Hosting page, beside a collection the helper started. */
export const STARTED_BY_CONNECT = "Connect started this one for you, because you had not collected for more than 12 months.";
