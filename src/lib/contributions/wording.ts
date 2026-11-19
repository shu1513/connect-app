/**
 * The sentences a person sees before they contribute, the box they tick for a monthly
 * contribution, and their version (plans/23, "Contributing once", "Contributing monthly"). One
 * place: the page shows them from here and `start.ts` records the version, so the two can never
 * differ. Change a sentence, change the version.
 */
export const CONTRIBUTION_WORDING_VERSION = "2026-11-19";

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/** What the page says before they pay, with this contribution's numbers in it. */
export function summarySentences(input: { kind: "once" | "monthly"; amountCents: number; hostName: string; projectName: string }): string[] {
  const { kind, amountCents, hostName, projectName } = input;
  const amount = money(amountCents);
  return [
    kind === "monthly" ? `You pay ${amount} every month, starting with a hold today, until you stop.` : `You pay ${amount}, once.`,
    kind === "monthly"
      ? `Each month the amount is first only held on your card, and taken three days later. Until it is taken you can cancel that month's payment and pay nothing for it.`
      : `The amount is first only held on your card, normally for three days, and taken after that. Until it is taken you can cancel and pay nothing.`,
    `A bank can make that time shorter for a card. You are always shown, and sent by email, the real moment your money is taken.`,
    `Your contribution supports ${hostName}'s project "${projectName}". It does not buy a call or any promised reward.`,
    `It is not a donation to a charity, and it gives you no charitable tax deduction.`,
    `Once money has been taken, giving it back is ${hostName}'s decision.`,
    ...(kind === "monthly" ? [`You can stop at any time on "Your account", under "Projects you support". It takes effect at once: no further month is held or taken. Money that was already taken is not returned by stopping.`] : []),
  ];
}

/** The box a person ticks for a monthly contribution. What they agreed to, word for word, is kept. */
export function agreementBox(amountCents: number): string {
  return `I agree that Connect holds ${money(amountCents)} on my card today and every month, and takes it three days later each time, until I cancel.`;
}
