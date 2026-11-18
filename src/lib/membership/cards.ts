/**
 * Cards. A card at Stripe belongs to a membership or to a booking, never both, and that has to
 * hold when both sides act at the same instant. So everything that takes or removes a card takes
 * one lock on the card's id first:
 *   - a membership taking a card (when its hold is accepted),
 *   - a booking learning its card (bookings.ts, and the booking job before it removes one),
 *   - the helper removing a membership's retired card.
 *
 * A booking forgets its card when the card is removed, so booking_cards remembers every card a
 * booking ever had. A membership's cards are remembered in membership_cards: the one in use, and
 * the retired ones until (and after) they are removed. A retired card is never used again.
 */
import { and, eq, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { MembershipCard } from "@/db/schema";
import { MoneyError, type Tx } from "@/lib/payments/operations";
import { stripe } from "@/lib/payments/stripe";

type Reader = Pick<Tx, "select">;

/** One lock per card, held to the end of the caller's database step. */
export async function lockCard(tx: Tx, paymentMethodId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`card:${paymentMethodId}`}))`);
}

/** The membership's card in use, or null. */
export async function cardInUse(reader: Reader, membershipId: string): Promise<MembershipCard | null> {
  const [card] = await reader.select().from(schema.membershipCards).where(and(eq(schema.membershipCards.membershipId, membershipId), isNull(schema.membershipCards.retiredAt)));
  return card ?? null;
}

/**
 * A membership takes this card as its card in use. Under the card's lock: it must not be, or ever
 * have been, a booking's card, and must not be a card that was retired. Taking a different card
 * than the one in use retires the old one. Throws MoneyError when the card may not be taken.
 */
export async function takeCardForMembership(tx: Tx, membershipId: string, paymentMethodId: string, now: Date): Promise<MembershipCard> {
  await lockCard(tx, paymentMethodId);
  const [booked] = await tx.select({ id: schema.bookingCards.bookingId }).from(schema.bookingCards).where(eq(schema.bookingCards.stripePaymentMethodId, paymentMethodId));
  const [onBooking] = await tx.select({ id: schema.bookings.id }).from(schema.bookings).where(eq(schema.bookings.stripePaymentMethodId, paymentMethodId)).limit(1);
  if (booked || onBooking) throw new MoneyError("This card was saved for a booking, so it cannot be a membership's card.");
  const [known] = await tx.select().from(schema.membershipCards).where(eq(schema.membershipCards.stripePaymentMethodId, paymentMethodId));
  if (known) {
    if (known.membershipId !== membershipId || known.retiredAt) throw new MoneyError("This card can no longer be used for a membership.");
    return known;
  }
  await tx.update(schema.membershipCards).set({ retiredAt: now }).where(and(eq(schema.membershipCards.membershipId, membershipId), isNull(schema.membershipCards.retiredAt)));
  const [card] = await tx.insert(schema.membershipCards).values({ membershipId, stripePaymentMethodId: paymentMethodId, savedAt: now }).returning();
  return card;
}

/** The membership stops using its card for anything new (it is paused or ended). The card is removed later, when nothing needs it. */
export async function retireCard(tx: Tx, membershipId: string, now: Date): Promise<void> {
  await tx.update(schema.membershipCards).set({ retiredAt: now }).where(and(eq(schema.membershipCards.membershipId, membershipId), isNull(schema.membershipCards.retiredAt)));
}

/**
 * A booking has learned which card it has. Under the card's lock: a card a membership has, and has
 * not removed, is refused (returns false, and nothing is recorded); otherwise the card is
 * remembered as a booking's for good.
 */
export async function bookingCardSeen(tx: Tx, bookingId: string, paymentMethodId: string): Promise<boolean> {
  await lockCard(tx, paymentMethodId);
  const [members] = await tx.select({ id: schema.membershipCards.id }).from(schema.membershipCards).where(and(eq(schema.membershipCards.stripePaymentMethodId, paymentMethodId), isNull(schema.membershipCards.removedAt)));
  if (members) return false;
  await tx.insert(schema.bookingCards).values({ stripePaymentMethodId: paymentMethodId, bookingId }).onConflictDoNothing();
  return true;
}

/** The booking job is about to remove this card at Stripe. False means: leave it, a membership has it. */
export async function bookingMayRemoveCard(tx: Tx, bookingId: string, paymentMethodId: string, now: Date): Promise<boolean> {
  if (!(await bookingCardSeen(tx, bookingId, paymentMethodId))) return false;
  await tx.update(schema.bookingCards).set({ removedAt: now }).where(eq(schema.bookingCards.stripePaymentMethodId, paymentMethodId));
  return true;
}

/**
 * Removes retired cards at Stripe once nothing open needs them: no month of the membership is
 * still to be paid or held. Checked under the card's lock, as the last thing before
 * the card is detached, which cannot be undone.
 */
export async function removeRetiredCards(now: Date): Promise<number> {
  const retired = await db
    .select()
    .from(schema.membershipCards)
    .where(
      and(
        isNotNull(schema.membershipCards.retiredAt),
        isNull(schema.membershipCards.removedAt),
        lte(schema.membershipCards.retiredAt, now),
        // Cards that are still needed are left out here already, so they never fill the batch. (Checked again under the lock below.)
        sql`not exists (select 1 from ${schema.membershipMonths} where ${schema.membershipMonths.membershipId} = ${schema.membershipCards.membershipId} and ${schema.membershipMonths.status} in ('to_pay', 'held'))`,
      ),
    )
    .limit(25);
  let removed = 0;
  for (const card of retired) {
    try {
      const free = await db.transaction(async (tx) => {
        await lockCard(tx, card.stripePaymentMethodId);
        const [still] = await tx.select().from(schema.membershipCards).where(eq(schema.membershipCards.id, card.id)).for("update");
        if (!still || !still.retiredAt || still.removedAt) return false;
        const [open] = await tx
          .select({ id: schema.membershipMonths.id })
          .from(schema.membershipMonths)
          // Any month of that membership that is still to be paid or held may be using it (a try in
          // flight has not written the card onto its month yet).
          .where(and(eq(schema.membershipMonths.membershipId, card.membershipId), inArray(schema.membershipMonths.status, ["to_pay", "held"])))
          .limit(1);
        return !open;
      });
      if (!free) continue;
      await stripe()
        .paymentMethods.detach(card.stripePaymentMethodId)
        .catch((error: { code?: string }) => {
          // Already gone at Stripe: that is what we wanted.
          if (error?.code !== "resource_missing" && error?.code !== "payment_method_unexpected_state") throw error;
        });
      await db.update(schema.membershipCards).set({ removedAt: new Date() }).where(eq(schema.membershipCards.id, card.id));
      removed++;
    } catch (error) {
      console.error(`[membership] could not remove retired card ${card.id} yet; will retry`, error);
    }
  }
  return removed;
}
