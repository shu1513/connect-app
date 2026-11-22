/**
 * What a host is told when Connect sent her earnings without being asked, because she had not
 * collected for 12 months (plans/46-part-3-money-owed.md, decision 12). Plain functions, so every
 * sentence is tested.
 *
 * The rule for these: only what really happened. What was sent is what Stripe confirmed; a share
 * Stripe refused is named as not sent; a share with no clear answer yet is named as still being
 * checked, and never as sent.
 */

export type UncollectedFacts = {
  /** Confirmed as sent to her Stripe payout account, written out: "$79.75". Null when nothing was. */
  sent: string | null;
  /** The collection charge that was really taken. Null when none was. */
  charge: string | null;
  /** What Stripe refused. Null when nothing was. */
  refused: string | null;
  /** What has no clear answer from Stripe yet. Null when nothing is. */
  checking: string | null;
  /** Her host profile is in another country than the United States, so her bank is probably not paid in US dollars. */
  abroad: boolean;
};

export function uncollectedWords(facts: UncollectedFacts): { subject: string; text: string } {
  const lines: string[] = [];
  lines.push(
    "You had not collected your earnings on Connect for more than 12 months. When that happens, Connect starts the collection for you, so that your money does not stay with us. It is the same collection your own button makes, under the same rules.",
    "",
  );
  if (facts.sent) {
    lines.push(`Sent to your Stripe payout account: ${facts.sent}, in US dollars.`);
    if (facts.charge) lines.push(`The collection charge that was taken: ${facts.charge}. The amount above is what was sent after it.`);
  } else if (facts.checking) lines.push("Nothing is confirmed as sent yet.");
  else lines.push("Nothing was sent, and no collection charge was taken.");
  if (facts.refused) lines.push(`Could not be sent: ${facts.refused}. Stripe refused it. It is still yours and stays ready to collect.`);
  if (facts.checking) lines.push(`Still being checked: ${facts.checking}. We have no clear answer from Stripe for it yet. If it went through, it is in your Stripe payout account; if it did not, it is ready to collect again. Your Hosting page shows which.`);
  if (facts.sent || facts.checking) {
    lines.push(
      "",
      facts.abroad
        ? "Stripe pays what it received to your bank account. If your bank account is not in US dollars, Stripe turns the dollars into your own money when it pays your bank, at its exchange rate of that moment."
        : "Stripe pays what it received to your bank account.",
    );
  }
  lines.push("", 'You can collect your earnings yourself at any time, once in 24 hours, with "Collect earnings" on your Hosting page.');
  return {
    subject: facts.sent ? `We sent you your earnings: ${facts.sent}` : facts.checking ? "We are sending you your earnings" : "We tried to send you your earnings",
    text: lines.join("\n"),
  };
}

/** On her Hosting page, beside a collection the helper started. */
export const STARTED_BY_CONNECT = "Connect started this one for you, because you had not collected for more than 12 months.";
