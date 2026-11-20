/**
 * The emails about a contribution (plans/23, "How it works for a contributor"; plans/25,
 * "emails.ts" and choices 8 and 9). Each is written in the same database step as the thing it
 * reports (see queueEmail), so none is lost or sent twice.
 *
 * Contributions have their own emails: a call's speak of a call, and a membership's of held money
 * and talk time, and both would be wrong here. Nothing here says "donation": a contribution
 * supports a host's project and is not a gift to a charity.
 *
 * A tip after a call (plans/44) is kept as a contribution of kind "tip", with a call and no
 * project. It gets the same emails in a tip's own words: the hold (the receipt), "nothing was
 * charged", a refund, and the host's "you got a tip".
 */
import { eq, inArray } from "drizzle-orm";
import { schema } from "@/db";
import type { Contribution, ContributionPayment } from "@/db/schema";
import { whenFor } from "@/lib/booking/emails";
import { queueEmail } from "@/lib/email";
import type { Tx } from "@/lib/payments/operations";
import { tellFounders } from "@/lib/projects/picture-steps";
import { SUPPORT_EMAIL } from "@/lib/terms";

type Person = { id: string; name: string; email: string; timeZone: string | null };

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const footer = `—\nConnect · questions: ${SUPPORT_EMAIL}`;

function appUrl(): string {
  return (process.env.BETTER_AUTH_URL || "http://localhost:3000").replace(/\/$/, "");
}

const contributionPage = (contribution: Pick<Contribution, "id">) => `${appUrl()}/contributions/${contribution.id}`;

/** The two people of a contribution, the host's name as others know her, and the project's name (a tip has no project). */
async function partsOf(tx: Tx, contribution: Pick<Contribution, "hostId" | "contributorId" | "projectId">): Promise<{ host: Person; giver: Person; hostName: string; projectName: string } | null> {
  const rows = await tx
    .select({ id: schema.user.id, name: schema.user.name, email: schema.user.email, timeZone: schema.user.timeZone })
    .from(schema.user)
    .where(inArray(schema.user.id, [contribution.hostId, contribution.contributorId]));
  const host = rows.find((row) => row.id === contribution.hostId);
  const giver = rows.find((row) => row.id === contribution.contributorId);
  if (!host || !giver) return null;
  const [profile] = await tx.select({ displayName: schema.hostProfiles.displayName }).from(schema.hostProfiles).where(eq(schema.hostProfiles.userId, contribution.hostId));
  const [project] = contribution.projectId ? await tx.select({ name: schema.projects.name }).from(schema.projects).where(eq(schema.projects.id, contribution.projectId)) : [];
  return { host, giver, hostName: profile?.displayName ?? host.name, projectName: project?.name ?? "their project" };
}

/**
 * A monthly contribution has begun (its first hold is in place): what was agreed to, and how to
 * stop. Sent once.
 */
export async function queueAgreementEmail(tx: Tx, contribution: Contribution): Promise<void> {
  const parts = await partsOf(tx, contribution);
  if (!parts || contribution.kind !== "monthly") return;
  const { giver, hostName, projectName } = parts;
  await queueEmail(tx, {
    to: giver.email,
    key: `contribution-agreed:${contribution.id}`,
    subject: `Your monthly contribution to ${hostName}'s project: ${money(contribution.amountCents)} a month`,
    text:
      `Hi ${giver.name},\n\nYou agreed that Connect holds ${money(contribution.amountCents)} on your card today and every month, and takes it three days later each time, or sooner if your bank shortens the hold, until you cancel. It supports ${hostName}'s project "${projectName}".\n\n` +
      `It does not buy a call or any promised reward, and it is not a donation to a charity.\n\n` +
      `Before each month's money is taken you get an email with the exact moment, and until that moment you can cancel that month's payment and pay nothing for it.\n\n` +
      `To stop: open "Your account", "Projects you support", and choose "Stop contributing". It takes effect at once. Or use this link: ${contributionPage(contribution)}\n\n${footer}\n`,
  });
}

/**
 * A hold is in place, for a contribution made once and for every monthly payment: the amount, the
 * moment the money is taken, and the link to cancel before then. It is the receipt as well; no
 * second email is sent when the money is taken.
 */
export async function queueHoldEmail(tx: Tx, contribution: Contribution, payment: Pick<ContributionPayment, "id" | "amountCents" | "takeAt">): Promise<void> {
  const parts = await partsOf(tx, contribution);
  if (!parts || !payment.takeAt) return;
  const { giver, hostName, projectName } = parts;
  if (contribution.kind === "tip") {
    const tipCents = contribution.tipCents ?? payment.amountCents;
    await queueEmail(tx, {
      to: giver.email,
      key: `contribution-hold:${payment.id}`,
      subject: `Your tip for ${hostName}: ${money(tipCents)}`,
      text:
        `Hi ${giver.name},\n\n${money(payment.amountCents)} is held on your card, through Connect: a tip of ${money(tipCents)} for ${hostName}, and a payment fee of ${money(payment.amountCents - tipCents)}.\n\n` +
        `The money is taken on ${whenFor(giver, payment.takeAt)}. Until then you can cancel it, and nothing is charged: ${contributionPage(contribution)}\n\n` +
        `${hostName} receives the whole tip. After the money has been taken, giving it back is ${hostName}'s decision. A tip is a thank-you for a call that has taken place; it does not buy a call or any promised reward, and it is not a donation to a charity.\n\n` +
        `This email is your receipt. No other email is sent when the money is taken.\n\n${footer}\n`,
    });
    return;
  }
  await queueEmail(tx, {
    to: giver.email,
    key: `contribution-hold:${payment.id}`,
    subject: `Your contribution to ${hostName}'s project: ${money(payment.amountCents)}`,
    text:
      `Hi ${giver.name},\n\n${money(payment.amountCents)} is held on your card for your ${contribution.kind === "monthly" ? "monthly contribution" : "contribution"} to ${hostName}'s project "${projectName}", through Connect.\n\n` +
      `The money is taken on ${whenFor(giver, payment.takeAt)}. Until then you can cancel this payment, and nothing is charged: ${contributionPage(contribution)}\n\n` +
      `After the money has been taken, giving it back is ${hostName}'s decision. A contribution supports the project; it does not buy a call or any promised reward, and it is not a donation to a charity.\n\n` +
      `This email is your receipt. No other email is sent when the money is taken.\n\n${footer}\n`,
  });
}

/** A monthly payment did not go through, or the bank wants the contributor to confirm it. Sent once for each try. */
export async function queuePaymentFailedEmail(tx: Tx, contribution: Contribution, payment: Pick<ContributionPayment, "id" | "amountCents">, input: { failedTry: number; needsAction: boolean; giveUpAt: Date }): Promise<void> {
  const parts = await partsOf(tx, contribution);
  if (!parts) return;
  const { giver, hostName } = parts;
  await queueEmail(tx, {
    to: giver.email,
    key: `contribution-failed:${payment.id}:${input.failedTry}`,
    subject: input.needsAction ? `Your bank wants you to confirm your contribution to ${hostName}'s project` : `Your monthly contribution to ${hostName}'s project did not go through`,
    text:
      `Hi ${giver.name},\n\n` +
      (input.needsAction ? `Your bank wants you to confirm this month's ${money(payment.amountCents)} for ${hostName}'s project yourself. ` : `This month's ${money(payment.amountCents)} for ${hostName}'s project could not be held on your card. `) +
      `Nothing has been charged.\n\nYou can pay here, with the same card or another: ${contributionPage(contribution)}\n\n` +
      (input.needsAction ? "" : `We also try your card again by ourselves over the next days. `) +
      `If no payment is in place by ${whenFor(giver, input.giveUpAt)}, your monthly contribution is stopped. Nothing is owed: a month that was not paid is simply not paid.\n\n${footer}\n`,
  });
}

/** Why a held payment was let go, in words for its contributor. */
function whyLetGo(how: string | null, hostName: string, tip = false): string {
  switch (how) {
    case "cancelled":
    case "stopped":
      return "You cancelled it.";
    case "host_let_go":
      return `${hostName} let it go.`;
    case "project_ended":
      return `${hostName} ended the project.`;
    case "hold_lost":
      return "Your bank let the hold go by itself.";
    case "not_taken_in_time":
    case "no_hold_end":
      return "It could not be taken in time, so it was let go.";
    case "saved_card":
      return "The card is one that is saved for something else on Connect, so it was not used.";
    case "switch":
      return tip ? "Tips are paused at the moment." : "Contributions to this project are paused at the moment.";
    default:
      return "It could no longer go ahead.";
  }
}

/**
 * A hold that was in place is gone, and Stripe has confirmed it: only now is "nothing was charged"
 * said. Not sent for a payment that never had a hold: there was nothing to let go.
 */
export async function queueNothingChargedEmail(tx: Tx, contribution: Contribution, payment: Pick<ContributionPayment, "id" | "amountCents" | "authorisedAt" | "endedHow">): Promise<void> {
  if (!payment.authorisedAt) return;
  const parts = await partsOf(tx, contribution);
  if (!parts) return;
  const { giver, hostName } = parts;
  const goesOn = contribution.kind === "monthly" && contribution.status === "running";
  if (contribution.kind === "tip") {
    await queueEmail(tx, {
      to: giver.email,
      key: `contribution-let-go:${payment.id}`,
      subject: `Nothing was charged: your tip for ${hostName}`,
      text:
        `Hi ${giver.name},\n\nThe ${money(payment.amountCents)} that was held on your card for your tip to ${hostName} has been let go. Nothing was charged. ${whyLetGo(payment.endedHow, hostName, true)}\n\n` +
        `Your bank may still show the hold for a few days before it disappears.\n\n${footer}\n`,
    });
    return;
  }
  await queueEmail(tx, {
    to: giver.email,
    key: `contribution-let-go:${payment.id}`,
    subject: `Nothing was charged: your ${money(payment.amountCents)} for ${hostName}'s project`,
    text:
      `Hi ${giver.name},\n\nThe ${money(payment.amountCents)} that was held on your card for ${hostName}'s project has been let go. Nothing was charged. ${whyLetGo(payment.endedHow, hostName)}\n\n` +
      `Your bank may still show the hold for a few days before it disappears.\n\n` +
      (goesOn ? `Your monthly contribution goes on: the next payment is on its usual day. You can stop it here: ${contributionPage(contribution)}\n\n` : "") +
      `${footer}\n`,
  });
}

/** Money was given back to the contributor's card. */
export async function queueRefundEmail(tx: Tx, contribution: Contribution, refund: { id: string; amountCents: number }): Promise<void> {
  const parts = await partsOf(tx, contribution);
  if (!parts) return;
  const { giver, hostName } = parts;
  if (contribution.kind === "tip") {
    await queueEmail(tx, {
      to: giver.email,
      key: `contribution-refund:${refund.id}`,
      subject: `${money(refund.amountCents)} of your tip for ${hostName} was paid back`,
      text: `Hi ${giver.name},\n\n${money(refund.amountCents)} of what you paid for your tip to ${hostName} has been paid back to your card. Banks usually show it within 5 to 10 days.\n\nYour tip: ${contributionPage(contribution)}\n\n${footer}\n`,
    });
    return;
  }
  await queueEmail(tx, {
    to: giver.email,
    key: `contribution-refund:${refund.id}`,
    subject: `${money(refund.amountCents)} of your contribution to ${hostName}'s project was paid back`,
    text: `Hi ${giver.name},\n\n${money(refund.amountCents)} of your contribution to ${hostName}'s project has been paid back to your card. Banks usually show it within 5 to 10 days.\n\nYour contribution: ${contributionPage(contribution)}\n\n${footer}\n`,
  });
}

/** Why a monthly contribution ended, in words for its contributor. Null: nobody is told a reason beyond "it ended". */
function whyEnded(how: string, hostName: string): string {
  switch (how) {
    case "stopped":
      return "You stopped it.";
    case "project_ended":
      return `${hostName} ended the project.`;
    case "given_up":
      return "No payment could be put in place for 7 days.";
    case "never_again":
      return "Your bank told us not to try your card again.";
    case "card_gone":
      return "The card you saved for it is no longer there.";
    case "dispute":
      return "Your bank disputed one of its charges.";
    default:
      return "It can no longer go on.";
  }
}

/**
 * A monthly contribution that had begun has ended: the contributor is told, with the reason; and
 * the host is told that one of her monthly contributors is gone, unless she ended the project
 * herself or the reason is one nobody is told about (a block, an account that was paused or closed).
 */
export async function queueEndedEmails(tx: Tx, contribution: Contribution, how: string): Promise<void> {
  if (contribution.kind !== "monthly" || !contribution.firstHoldAt) return;
  const parts = await partsOf(tx, contribution);
  if (!parts) return;
  const { giver, host, hostName, projectName } = parts;
  await queueEmail(tx, {
    to: giver.email,
    key: `contribution-ended:${contribution.id}`,
    subject: `Your monthly contribution to ${hostName}'s project has ended`,
    text:
      `Hi ${giver.name},\n\nYour monthly contribution of ${money(contribution.amountCents)} to ${hostName}'s project "${projectName}" has ended. ${whyEnded(how, hostName)}\n\n` +
      `No further month is held or taken. A payment that was only held is let go, and you are told when that is done. Money that was already taken is not returned by this.\n\n${footer}\n`,
  });
  if (["stopped", "given_up", "never_again", "card_gone", "dispute"].includes(how)) {
    await queueEmail(tx, {
      to: host.email,
      key: `contribution-ended-host:${contribution.id}`,
      subject: `A monthly contribution to "${projectName}" has ended`,
      text: `Hi ${host.name},\n\n${giver.name}'s monthly contribution of ${money(contribution.amountCents)} to your project "${projectName}" has ended. ${how === "stopped" ? "They stopped it." : how === "dispute" ? "Their bank disputed one of its charges." : "Its payment could not be made."}\n\nYour project: ${appUrl()}/host/project\n\n${footer}\n`,
    });
  }
}

/**
 * A project has ended: everyone whose money it has taken is told, once (plans/23, "Ending"). A
 * monthly contributor whose contribution ends with it gets the email about that instead, which
 * says the same.
 */
export async function queueProjectEndedEmail(tx: Tx, input: { projectId: string; hostId: string; contributorId: string }): Promise<void> {
  const parts = await partsOf(tx, input);
  if (!parts) return;
  const { giver, hostName, projectName } = parts;
  await queueEmail(tx, {
    to: giver.email,
    key: `project-ended:${input.projectId}:${input.contributorId}`,
    subject: `${hostName}'s project "${projectName}" has ended`,
    text: `Hi ${giver.name},\n\n${hostName} has ended the project "${projectName}", which you contributed to. Its diary stays readable, marked as ended, and it takes no more contributions.\n\nNothing changes about what you paid: money that was taken stays with the project. Your contributions are on "Your account", under "Projects you support": ${appUrl()}/account\n\n${footer}\n`,
  });
}

/** The host is told that someone started contributing: once for a monthly contribution, not every month. */
export async function queueNewContributorEmail(tx: Tx, contribution: Contribution): Promise<void> {
  const parts = await partsOf(tx, contribution);
  if (!parts) return;
  const { giver, host, projectName } = parts;
  if (contribution.kind === "tip") {
    const tipCents = contribution.tipCents ?? contribution.amountCents;
    const [call] = contribution.callId ? await tx.select({ startsAt: schema.calls.startsAt }).from(schema.calls).where(eq(schema.calls.id, contribution.callId)) : [];
    await queueEmail(tx, {
      to: host.email,
      // Named by the call: one email for a call, however often a tip for it is cancelled and given again (plans/44, decision 9).
      key: `tip-new:${contribution.callId ?? contribution.id}`,
      subject: `${giver.name} sent you a tip of ${money(tipCents)}`,
      text:
        `Hi ${host.name},\n\n${giver.name} sent you a tip of ${money(tipCents)}${call ? ` for your call on ${whenFor(host, call.startsAt)}` : ""}. All of it is yours: Connect keeps nothing of a tip.\n\n` +
        `The amount is first only held on their card and normally taken three days later. Until then they, or you, can let it go. It appears with your earnings once the money has been taken.\n\n` +
        `${contribution.callId ? `The call: ${appUrl()}/calls/${contribution.callId}/results\n\n` : ""}${footer}\n`,
    });
    return;
  }
  await queueEmail(tx, {
    to: host.email,
    key: `contribution-new:${contribution.id}`,
    subject: `${giver.name} contributes to "${projectName}"`,
    text:
      `Hi ${host.name},\n\n${giver.name} contributes ${money(contribution.amountCents)}${contribution.kind === "monthly" ? " every month" : ""} to your project "${projectName}".\n\n` +
      `The amount is first only held on their card and normally taken three days later. Until then they, or you, can let it go. Your share appears with your earnings once the money has been taken.\n\nYour project: ${appUrl()}/host/project\n\n${footer}\n`,
  });
}

/**
 * The founder is told when one person's contributions to a host cross $1,000 in 30 days
 * (plans/25, choice 8): the founder has the hold button, and this says when to look. The caller
 * (countPair) decides when the line was crossed, and names the payment that crossed it.
 */
export async function tellFounderOfLargeTotal(tx: Tx, input: { contributorId: string; hostId: string; countedCents: number; paymentId: string }): Promise<void> {
  const people = await tx.select({ id: schema.user.id, name: schema.user.name }).from(schema.user).where(inArray(schema.user.id, [input.contributorId, input.hostId]));
  const name = (id: string) => people.find((person) => person.id === id)?.name ?? "someone";
  await tellFounders(tx, {
    // Named by the payment that crossed the line: one email for each crossing.
    key: `contribution-1000:${input.paymentId}`,
    subject: `Contributions and tips over $1,000 in 30 days: ${name(input.contributorId)} to ${name(input.hostId)}`,
    text:
      `${name(input.contributorId)} has paid ${money(input.countedCents)} to ${name(input.hostId)} in contributions and tips in the last 30 days, counting money that was taken and holds that are in place. That is over $1,000.\n\n` +
      `Each of those payments waits 30 days from its taking before the host can collect it. You can hold one back longer, or release it sooner, each with a reason: ${appUrl()}/admin/projects\n`,
  });
}
