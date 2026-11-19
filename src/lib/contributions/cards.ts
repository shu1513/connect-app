/**
 * The card saved for a monthly contribution. A card at Stripe belongs to one thing only (a
 * booking, a membership or a contribution), and that has to hold when two of them act at the same
 * instant. So everything that takes or removes a card takes the one lock on the card's id first
 * (src/lib/membership/cards.ts).
 *
 * A contribution's cards are remembered in contribution_cards: the one in use, and the retired
 * ones until (and after) they are removed. A retired card is never used again.
 */
import { and, eq, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { ContributionCard } from "@/db/schema";
import { lockCard } from "@/lib/membership/cards";
import { MoneyError, type Tx } from "@/lib/payments/operations";
import { stripe } from "@/lib/payments/stripe";

const cards = schema.contributionCards;

/** The contribution's card in use, or null. */
export async function cardInUse(reader: Pick<Tx, "select">, contributionId: string): Promise<ContributionCard | null> {
  const [card] = await reader.select().from(cards).where(and(eq(cards.contributionId, contributionId), isNull(cards.retiredAt)));
  return card ?? null;
}

/**
 * A contribution takes this card as its card in use. Under the card's lock: it must not be, or
 * ever have been, a booking's or a membership's card, nor another contribution's, nor one that
 * was retired. Throws MoneyError when the card may not be taken.
 */
export async function takeCardForContribution(tx: Tx, contributionId: string, paymentMethodId: string, now: Date): Promise<ContributionCard> {
  await lockCard(tx, paymentMethodId);
  const [booked] = await tx.select({ id: schema.bookingCards.bookingId }).from(schema.bookingCards).where(eq(schema.bookingCards.stripePaymentMethodId, paymentMethodId));
  const [onBooking] = await tx.select({ id: schema.bookings.id }).from(schema.bookings).where(eq(schema.bookings.stripePaymentMethodId, paymentMethodId)).limit(1);
  const [members] = await tx.select({ id: schema.membershipCards.id }).from(schema.membershipCards).where(eq(schema.membershipCards.stripePaymentMethodId, paymentMethodId));
  if (booked || onBooking || members) throw new MoneyError("This card was saved for something else, so it cannot be a contribution's card.");
  const [known] = await tx.select().from(cards).where(eq(cards.stripePaymentMethodId, paymentMethodId));
  if (known) {
    if (known.contributionId !== contributionId || known.retiredAt) throw new MoneyError("This card can no longer be used for a contribution.");
    return known;
  }
  await tx.update(cards).set({ retiredAt: now }).where(and(eq(cards.contributionId, contributionId), isNull(cards.retiredAt)));
  const [card] = await tx.insert(cards).values({ contributionId, stripePaymentMethodId: paymentMethodId, savedAt: now }).returning();
  return card;
}

/** The contribution stops using its card for anything new (it has ended). The card is removed later, when nothing needs it. */
export async function retireCard(tx: Tx, contributionId: string, now: Date): Promise<void> {
  await tx.update(cards).set({ retiredAt: now }).where(and(eq(cards.contributionId, contributionId), isNull(cards.retiredAt)));
}

/** A payment of the contribution that is still open, or has an action under way, may be using the card. */
const stillNeeded = sql`exists (select 1 from ${schema.contributionPayments} where ${schema.contributionPayments.contributionId} = ${cards.contributionId} and ${schema.contributionPayments.status} in ('to_pay', 'held'))
  or exists (select 1 from ${schema.moneyOperations} join ${schema.contributionPayments} on ${schema.contributionPayments.id} = ${schema.moneyOperations.contributionPaymentId} where ${schema.contributionPayments.contributionId} = ${cards.contributionId} and ${schema.moneyOperations.status} = 'started')`;

/**
 * Removes retired cards at Stripe once nothing needs them: no payment of the contribution is
 * still open and no action is under way. Checked under the card's lock, as the last thing before
 * the card is detached, which cannot be undone. The line stays.
 */
export async function removeRetiredCards(now: Date): Promise<number> {
  const retired = await db
    .select()
    .from(cards)
    .where(and(isNotNull(cards.retiredAt), isNull(cards.removedAt), lte(cards.retiredAt, now), sql`not (${stillNeeded})`))
    .limit(25);
  let removed = 0;
  for (const card of retired) {
    try {
      const free = await db.transaction(async (tx) => {
        await lockCard(tx, card.stripePaymentMethodId);
        const [still] = await tx.select().from(cards).where(and(eq(cards.id, card.id), isNotNull(cards.retiredAt), isNull(cards.removedAt), sql`not (${stillNeeded})`)).for("update");
        return Boolean(still);
      });
      if (!free) continue;
      await stripe()
        .paymentMethods.detach(card.stripePaymentMethodId)
        .catch((error: { code?: string }) => {
          // Already gone at Stripe: that is what we wanted.
          if (error?.code !== "resource_missing" && error?.code !== "payment_method_unexpected_state") throw error;
        });
      await db.update(cards).set({ removedAt: new Date() }).where(eq(cards.id, card.id));
      removed++;
    } catch (error) {
      console.error(`[contributions] could not remove retired card ${card.id} yet; will retry`, error);
    }
  }
  return removed;
}
