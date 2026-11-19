/**
 * How a contribution starts, and how its payment is paid by hand (plans/23, "How it works for a
 * contributor"; plans/25, "start.ts").
 *
 * The page that shows the form makes only a request's id. Everything is written when the form is
 * sent: the agreement, the contribution at its card step and its first payment, in one step. The
 * same press, sent twice, is one contribution. Nothing here asks Stripe except `payNow`, which a
 * pressed button calls; a page that is only being loaded uses `secretToPay`, which only reads.
 */
import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Contribution, ContributionPayment, Project } from "@/db/schema";
import { lockPeople } from "@/lib/membership/join";
import { CARD_STEP_MS } from "@/lib/membership/rules";
import { stripe, stripeConfigured } from "@/lib/payments/stripe";
import { isId } from "@/lib/projects/projects";
import { isBlockedEitherWay } from "@/lib/safety/block-check";
import { projectsOnFor } from "@/lib/safety/switches";
import { intentFor, paymentById, syncPayment, writeDownPayment } from "./charge";
import { lockPair, lockSwitchForWriting } from "./locks";
import { ContributionError, kindsOffered, readAmount } from "./rules";
import { CONTRIBUTION_WORDING_VERSION } from "./wording";

type Reader = Pick<typeof db, "select">;

/** Said for everything on the host's side that stands in the way, and for a block: from here they all look the same. */
export const NOT_TAKING = "This project is not taking contributions at the moment.";
const OPEN_AGAIN = "Please open the page again. Nothing was started.";
/** What the person agrees to is the wording the page showed them, never one that changed while it was open. */
const STALE_WORDING = "The wording of this page has changed since you opened it. Please read it again before you contribute.";

const WAITING = ["requires_payment_method", "requires_confirmation", "requires_action"];

/**
 * Why this person cannot contribute to this project right now, or null when they can (plans/25,
 * choice 4). The one function that answers it: starting a contribution, the "Contribute" part of
 * the diary and the boxes after a call all ask it. With no person (a visitor who is not signed
 * in) it answers for the project and its host alone.
 */
export async function whyNotContribute(reader: Reader, input: { contributorId: string | null; project: Pick<Project, "id" | "hostId" | "status" | "suggestedOnce" | "suggestedMonthly"> }): Promise<string | null> {
  const { contributorId, project } = input;
  if (project.status !== "running") return "This project has ended and takes no contributions.";
  const [host] = await reader
    .select({ pausedAt: schema.user.pausedAt, closedAt: schema.user.closedAt, status: schema.hostProfiles.status, hidden: schema.hostProfiles.hidden })
    .from(schema.user)
    .leftJoin(schema.hostProfiles, eq(schema.hostProfiles.userId, schema.user.id))
    .where(eq(schema.user.id, project.hostId));
  // Her account active, and her page open to everyone (the same rule as her page itself: see publicProfile).
  if (!host || host.closedAt || host.pausedAt || host.status !== "approved" || host.hidden) return NOT_TAKING;
  if (!(await projectsOnFor(project.hostId, reader))) return NOT_TAKING;
  if (kindsOffered(project).length === 0) return NOT_TAKING;
  if (!stripeConfigured()) return NOT_TAKING;
  if (contributorId === null) return null;
  if (contributorId === project.hostId) return "This is your own project.";
  const [me] = await reader.select({ pausedAt: schema.user.pausedAt, closedAt: schema.user.closedAt }).from(schema.user).where(eq(schema.user.id, contributorId));
  if (!me || me.closedAt) return "Account not found.";
  if (me.pausedAt) return "Your account is paused, so you cannot contribute at the moment.";
  if (await isBlockedEitherWay(project.hostId, contributorId, reader)) return NOT_TAKING;
  return null;
}

function alreadyExists(error: unknown): boolean {
  const e = error as { code?: string; cause?: { code?: string } };
  return e?.code === "23505" || e?.cause?.code === "23505";
}

/**
 * "Contribute": the form was sent. `requestKey` was made when the form was shown, so a second
 * press gets the contribution the first one made. `amount` is as the person typed or picked it;
 * `wordingVersion` is the version of the sentences the page showed. Returns the contribution and
 * its first payment, which waits for the card step (30 minutes).
 */
export async function startContribution(input: { contributorId: string; projectId: string; kind: string; amount: string; requestKey: string; agreed: boolean; wordingVersion: string; now: Date }): Promise<{ contributionId: string; paymentId: string }> {
  const { contributorId, now } = input;
  if (!isId(input.projectId) || !isId(input.requestKey)) throw new ContributionError(OPEN_AGAIN);
  if (input.kind !== "once" && input.kind !== "monthly") throw new ContributionError(OPEN_AGAIN);
  const kind = input.kind;
  const amountCents = readAmount(input.amount);
  // Ids are compared as the database stores them.
  const projectId = input.projectId.toLowerCase();
  const requestKey = input.requestKey.toLowerCase();
  try {
    return await db.transaction(async (tx) => {
      // Before any other lock: writing a payment and saving the founder's switch wait for each other.
      await lockSwitchForWriting(tx);
      const [found] = await tx.select({ hostId: schema.projects.hostId }).from(schema.projects).where(eq(schema.projects.id, projectId));
      if (!found) throw new ContributionError(NOT_TAKING);
      // The two people's lines first, and read again below: closing or pausing an account cannot miss a contribution that starts at the same moment.
      await lockPeople(tx, [found.hostId, contributorId]);
      // And her host page's line, so that a suspension of her page cannot miss it either.
      await tx.select({ userId: schema.hostProfiles.userId }).from(schema.hostProfiles).where(eq(schema.hostProfiles.userId, found.hostId)).for("share");

      // The same press, sent twice.
      const [before] = await tx.select().from(schema.contributions).where(eq(schema.contributions.requestKey, requestKey));
      if (before) {
        if (before.contributorId !== contributorId || before.projectId !== projectId) throw new ContributionError(OPEN_AGAIN);
        const [first] = await tx.select({ id: schema.contributionPayments.id }).from(schema.contributionPayments).where(eq(schema.contributionPayments.originKey, `first:${before.id}`));
        if (!first) throw new ContributionError(OPEN_AGAIN);
        return { contributionId: before.id, paymentId: first.id };
      }

      if (input.wordingVersion !== CONTRIBUTION_WORDING_VERSION) throw new ContributionError(STALE_WORDING);
      if (kind === "monthly" && !input.agreed) throw new ContributionError("Please tick the box to agree before you contribute every month.");
      // Then the project, so it cannot end underneath.
      const [project] = await tx.select().from(schema.projects).where(eq(schema.projects.id, projectId)).for("share");
      const cannot = await whyNotContribute(tx, { contributorId, project });
      if (cannot) throw new ContributionError(cannot);
      if (!kindsOffered(project).includes(kind)) throw new ContributionError(kind === "monthly" ? "This project does not take monthly contributions at the moment." : "This project only takes monthly contributions at the moment.");
      await lockPair(tx, contributorId, project.hostId);
      // Asked once more with the pair's lock held: a block that was being saved at this very moment holds
      // that lock while it ends the contributions between the two, so it is either seen here or it sees us.
      if (await isBlockedEitherWay(project.hostId, contributorId, tx)) throw new ContributionError(NOT_TAKING);
      if (kind === "monthly") {
        const [running] = await tx
          .select({ id: schema.contributions.id })
          .from(schema.contributions)
          .where(and(eq(schema.contributions.contributorId, contributorId), eq(schema.contributions.projectId, projectId), eq(schema.contributions.kind, "monthly"), ne(schema.contributions.status, "ended")));
        if (running) throw new ContributionError('You already contribute to this project every month. You find it on "Your account", under "Projects you support".');
      }

      const [contribution] = await tx.insert(schema.contributions).values({ projectId, hostId: project.hostId, contributorId, kind, amountCents, requestKey }).returning();
      await tx.insert(schema.contributionAgreements).values({ contributionId: contribution.id, version: CONTRIBUTION_WORDING_VERSION, kind, amountCents, agreedAt: now });
      const payment = await writeDownPayment(tx, contribution, { number: 1, originKey: `first:${contribution.id}`, cardStepExpiresAt: new Date(now.getTime() + CARD_STEP_MS) }, now);
      return { contributionId: contribution.id, paymentId: payment.id };
    });
  } catch (error) {
    // Two presses at the very same moment: the database let one through. The other is told to look again.
    if (alreadyExists(error)) throw new ContributionError(OPEN_AGAIN);
    throw error;
  }
}

/** A contribution with its payments and its project, for its contributor only. Null for anyone else and for an id that does not exist: the two look the same. */
export async function contributionFor(contributorId: string, contributionId: string): Promise<{ contribution: Contribution; payments: ContributionPayment[]; project: Project } | null> {
  if (!isId(contributionId)) return null;
  const [found] = await db
    .select({ contribution: schema.contributions, project: schema.projects })
    .from(schema.contributions)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.contributions.projectId))
    .where(and(eq(schema.contributions.id, contributionId.toLowerCase()), eq(schema.contributions.contributorId, contributorId)));
  if (!found) return null;
  const payments = await db.select().from(schema.contributionPayments).where(eq(schema.contributionPayments.contributionId, found.contribution.id)).orderBy(asc(schema.contributionPayments.number));
  return { ...found, payments };
}

/** A payment with its contribution's kind and host, if it is this person's. */
async function ownPayment(paymentId: string, contributorId: string): Promise<{ payment: ContributionPayment; kind: string; hostId: string } | null> {
  if (!isId(paymentId)) return null;
  const [found] = await db
    .select({ contributorId: schema.contributions.contributorId, kind: schema.contributions.kind, hostId: schema.contributions.hostId })
    .from(schema.contributionPayments)
    .innerJoin(schema.contributions, eq(schema.contributions.id, schema.contributionPayments.contributionId))
    .where(eq(schema.contributionPayments.id, paymentId));
  if (!found || found.contributorId !== contributorId) return null;
  const payment = await paymentById(paymentId);
  return payment ? { payment, kind: found.kind, hostId: found.hostId } : null;
}

/**
 * Whether these two may still deal with each other: both accounts active, and no block either
 * way. Asked again every time a payment is to be paid by hand, not only when the contribution
 * started. (A block, a pause and a closing also end the contribution themselves; this is the net
 * behind them.)
 */
async function stillOpenBetween(hostId: string, contributorId: string): Promise<boolean> {
  const people = await db.select({ id: schema.user.id, pausedAt: schema.user.pausedAt, closedAt: schema.user.closedAt }).from(schema.user).where(inArray(schema.user.id, [hostId, contributorId]));
  if (people.length !== 2 || people.some((person) => person.pausedAt || person.closedAt)) return false;
  return !(await isBlockedEitherWay(hostId, contributorId));
}

/** Still waiting to be paid by its contributor at this moment: not given up, not set aside, and neither the card step's time nor the 7 days have run out. */
const canPay = (payment: ContributionPayment | undefined, at: Date): boolean =>
  Boolean(payment && payment.status === "to_pay" && !payment.endedHow && !payment.problem && !(payment.cardStepExpiresAt && payment.cardStepExpiresAt <= at) && !(payment.giveUpAt && payment.giveUpAt <= at));

/**
 * "Continue to the card step" and "Pay now": makes the payment's one PaymentIntent ready to be
 * paid by hand and gives back its secret, for its contributor only, while it can still be paid.
 * Null otherwise. Only a pressed button calls this.
 */
export async function payNow(input: { paymentId: string; contributorId: string; now?: Date }): Promise<{ clientSecret: string } | null> {
  const own = await ownPayment(input.paymentId, input.contributorId);
  const at = input.now ?? new Date();
  // Not after the card step's time or the 7 days have run out, also when the helper has not been by yet: a hold placed now would only be let go again.
  if (!own || !canPay(own.payment, at)) return null;
  if (!(await stillOpenBetween(own.hostId, input.contributorId))) return null;
  const intent = await intentFor(input.paymentId, at);
  if (!intent?.clientSecret) return null;
  if (!WAITING.includes(intent.status)) {
    // Stripe already has a payment on it (a hold we have not heard of yet, perhaps): there is nothing left to pay. Record how it stands.
    await syncPayment(input.paymentId, at);
    return null;
  }
  // The card a monthly contributor pays with by hand is kept for the months that follow (a try with the saved card took that mark off).
  if (own.kind === "monthly" && !intent.keepsCard) await stripe().paymentIntents.update(intent.intentId, { setup_future_usage: "off_session" });
  // Looked at once more after Stripe answered, by the real clock: the secret of a payment that was given up, or whose time ran out, meanwhile goes to nobody.
  if (!canPay(await paymentById(input.paymentId), new Date(Math.max(at.getTime(), Date.now())))) return null;
  return { clientSecret: intent.clientSecret };
}

/**
 * For a page that is only being loaded: the secret of the PaymentIntent this payment ALREADY has,
 * when it is ready to be paid by hand. It never makes one and never changes one. Null otherwise.
 */
export async function secretToPay(input: { paymentId: string; contributorId: string; now?: Date }): Promise<{ clientSecret: string } | null> {
  const own = await ownPayment(input.paymentId, input.contributorId);
  const at = input.now ?? new Date();
  if (!own?.payment.stripePaymentIntentId || !canPay(own.payment, at)) return null;
  if (!(await stillOpenBetween(own.hostId, input.contributorId))) return null;
  const intent = await stripe().paymentIntents.retrieve(own.payment.stripePaymentIntentId);
  // Only a payment that waits for the contributor; for a monthly one, with the card set to be kept for the months that follow.
  if (!intent.client_secret || !WAITING.includes(intent.status) || (own.kind === "monthly" && intent.setup_future_usage !== "off_session")) return null;
  // Looked at once more after Stripe answered, by the real clock.
  const still = await paymentById(input.paymentId);
  if (!canPay(still, new Date(Math.max(at.getTime(), Date.now()))) || still!.stripePaymentIntentId !== intent.id) return null;
  return { clientSecret: intent.client_secret };
}
