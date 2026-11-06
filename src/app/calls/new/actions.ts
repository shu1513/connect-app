"use server";

import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { createPaymentForCall, priceProblem } from "@/lib/payments/hold";
import { bookedTotalCents, MIN_CHARGE_CENTS } from "@/lib/payments/pricing";
import { getHostSettings, refreshPayoutsReady } from "@/lib/payments/hosts";
import { stripeConfigured } from "@/lib/payments/stripe";
import { isAdmin } from "@/lib/payments/access";
import { requireUser } from "@/lib/session";

function fail(message: string): never {
  redirect(`/calls/new?error=${encodeURIComponent(message)}`);
}

/** Test-only way to create a call, until the calendar exists. Admins only. */
export async function createCall(formData: FormData) {
  const user = await requireUser();
  if (!(await isAdmin(user.id))) redirect("/");

  const hostId = String(formData.get("hostId") ?? "");
  const customerId = String(formData.get("customerId") ?? "");
  const startsInMinutes = Number(formData.get("startsInMinutes"));
  const durationMinutes = Number(formData.get("durationMinutes"));
  const priceDollars = Number(formData.get("pricePer15") || 0);
  const pricePer15Cents = Math.round(priceDollars * 100);

  if (!hostId || !customerId) fail("Choose a host and a customer.");
  if (hostId === customerId) fail("The host and the customer must be different people.");
  if (!Number.isFinite(startsInMinutes) || startsInMinutes < 0 || startsInMinutes > 24 * 60) {
    fail("The start must be between 0 minutes and 24 hours from now.");
  }
  if (!Number.isFinite(durationMinutes) || durationMinutes < 1 || durationMinutes > 240) {
    fail("The length must be between 1 and 240 minutes.");
  }

  const people = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(inArray(schema.user.id, [hostId, customerId]));
  if (people.length !== 2) fail("Could not find those accounts.");

  if (!Number.isFinite(priceDollars)) fail("Enter a price, or 0 for a free call.");
  const problem = priceProblem(pricePer15Cents);
  if (problem) fail(problem);
  if (pricePer15Cents > 0 && bookedTotalCents(pricePer15Cents, Math.round(durationMinutes * 60)) < MIN_CHARGE_CENTS) {
    fail("This call is too short for its price: a paid call must cost at least 50 cents in total.");
  }

  // A paid call needs Stripe, and a host whose payout account can receive money.
  const hostSettings = await getHostSettings(hostId);
  if (pricePer15Cents > 0) {
    if (!stripeConfigured()) fail("Paid calls are switched off because Stripe is not set up.");
    const ready = hostSettings.stripeAccountId ? await refreshPayoutsReady(hostId).catch(() => false) : false;
    if (!ready) fail("The host has not finished setting up payouts, so they cannot be on a paid call yet.");
  }

  // Whole seconds only, because the video service reports times in whole seconds.
  const startsAt = new Date(Math.ceil((Date.now() + startsInMinutes * 60_000) / 1000) * 1000);
  const endsAt = new Date(startsAt.getTime() + Math.round(durationMinutes * 60) * 1000);

  // The call keeps the price and the host's cancelling rule it was created with.
  const call = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(schema.calls)
      .values({
        hostId,
        customerId,
        startsAt,
        endsAt,
        roomName: `call-${randomUUID()}`,
        pricePer15Cents,
        freeCancelMinutes: hostSettings.freeCancelMinutes,
      })
      .returning();
    if (pricePer15Cents > 0) await createPaymentForCall(tx, created);
    return created;
  });

  redirect(`/calls/${call.id}`);
}
