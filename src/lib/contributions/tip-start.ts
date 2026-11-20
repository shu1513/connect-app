/**
 * How a tip starts (plans/44, "Starting a tip"). The page that shows the summary makes only a
 * request's id. Everything is written when the summary is sent: the tip (a contribution of kind
 * "tip"), what was agreed to, and its one payment at the card step. From there on it is paid,
 * held, taken, cancelled and refunded by the contribution's own code (start.ts `payNow`,
 * charge.ts, monthly.ts `letPaymentGo`, refund.ts).
 *
 * The moment the summary is sent is the moment that counts (decision 1): everything the box asks
 * is asked again here, by the server, from the call and the login alone.
 */
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { lockPeople } from "@/lib/membership/join";
import { CARD_STEP_MS } from "@/lib/membership/rules";
import { isId } from "@/lib/projects/projects";
import { writeDownPayment } from "./charge";
import { lockPair, lockSwitchForWriting } from "./locks";
import { ContributionError } from "./rules";
import { chargeFor, NO_TIP, readTip, refusal, TIP_FEE_TERMS, TIP_WORDING_VERSION, whyNoTip } from "./tip-rules";
import { tipFacts } from "./tips";

const OPEN_AGAIN = "Please open the page again. Nothing was started.";
/** What the person agrees to is the wording the page showed them, never one that changed while it was open. */
const STALE_WORDING = "The wording of this page has changed since you opened it. Please read it again before you give a tip.";

function alreadyExists(error: unknown): boolean {
  const e = error as { code?: string; cause?: { code?: string } };
  return e?.code === "23505" || e?.cause?.code === "23505";
}

/**
 * "Continue to the card step" on a tip's summary. `requestKey` was made when the summary was
 * shown, so a second press gets the tip the first one made. `amount` is the tip as the person
 * picked or typed it; what they pay for it is worked out here. Returns the tip and its payment,
 * which waits for the card step (30 minutes).
 *
 * The order of locks is the app's one order (locks.ts): the switch (shared, as for a
 * contribution), the two people's lines, the host page's line, the pair, and the call's line last.
 */
export async function startTip(input: { customerId: string; callId: string; amount: string; requestKey: string; wordingVersion: string; now: Date }): Promise<{ contributionId: string; paymentId: string }> {
  const { customerId, now } = input;
  if (!isId(input.callId) || !isId(input.requestKey)) throw new ContributionError(OPEN_AGAIN);
  const tipCents = readTip(input.amount);
  // Ids are compared as the database stores them.
  const callId = input.callId.toLowerCase();
  const requestKey = input.requestKey.toLowerCase();
  // Looked up first, without a lock. The two people come from the call and the login, never from the form;
  // someone else's call and one that does not exist look the same.
  const [seen] = await db.select({ hostId: schema.calls.hostId, customerId: schema.calls.customerId }).from(schema.calls).where(eq(schema.calls.id, callId));
  if (!seen || seen.customerId !== customerId) throw new ContributionError(NO_TIP);
  try {
    return await db.transaction(async (tx) => {
      // Before any other lock: writing a payment and saving the founder's switch wait for each other.
      await lockSwitchForWriting(tx);
      // The two people's lines, read again below: closing or pausing an account cannot miss a tip that starts at the same moment.
      await lockPeople(tx, [seen.hostId, customerId]);
      // And her host page's line, so that a suspension of her page cannot miss it either.
      await tx.select({ userId: schema.hostProfiles.userId }).from(schema.hostProfiles).where(eq(schema.hostProfiles.userId, seen.hostId)).for("share");

      // The same press, sent twice: the first tip, but only if it is this customer's tip for this very call.
      const [before] = await tx.select().from(schema.contributions).where(eq(schema.contributions.requestKey, requestKey));
      if (before) {
        if (before.contributorId !== customerId || before.kind !== "tip" || before.callId !== callId) throw new ContributionError(OPEN_AGAIN);
        const [first] = await tx.select({ id: schema.contributionPayments.id }).from(schema.contributionPayments).where(eq(schema.contributionPayments.originKey, `first:${before.id}`));
        if (!first) throw new ContributionError(OPEN_AGAIN);
        return { contributionId: before.id, paymentId: first.id };
      }

      if (input.wordingVersion !== TIP_WORDING_VERSION) throw new ContributionError(STALE_WORDING);
      // The pair: a block that is being saved at this very moment holds this lock while it ends what is between
      // the two, so it is either seen below or it sees this tip. Two tips for one call started at the same moment
      // also come through here one after the other.
      await lockPair(tx, customerId, seen.hostId);
      // The call's line last. A refund request for this call takes the same line first, so it is seen below or it waits for us.
      const [call] = await tx.select().from(schema.calls).where(eq(schema.calls.id, callId)).for("share");
      // Everything the box asks, asked again with every lock held and read through this step.
      const why = whyNoTip(await tipFacts(tx, customerId, call, now));
      if (why) throw new ContributionError(refusal(why));

      const amountCents = chargeFor(tipCents);
      const [tip] = await tx.insert(schema.contributions).values({ callId, hostId: call.hostId, contributorId: customerId, kind: "tip", amountCents, tipCents, requestKey }).returning();
      await tx.insert(schema.contributionAgreements).values({ contributionId: tip.id, version: TIP_WORDING_VERSION, kind: "tip", amountCents, agreedAt: now });
      const payment = await writeDownPayment(tx, tip, { number: 1, originKey: `first:${tip.id}`, cardStepExpiresAt: new Date(now.getTime() + CARD_STEP_MS), terms: TIP_FEE_TERMS }, now);
      return { contributionId: tip.id, paymentId: payment.id };
    });
  } catch (error) {
    // Two presses at the very same moment that got past each other: the database let one through (its last net).
    if (alreadyExists(error)) throw new ContributionError(OPEN_AGAIN);
    throw error;
  }
}
