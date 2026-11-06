"use server";

import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/session";

function fail(message: string): never {
  redirect(`/calls/new?error=${encodeURIComponent(message)}`);
}

/** Test-only way to create a call, until the calendar exists. Requires login. */
export async function createCall(formData: FormData) {
  const user = await requireUser();

  const hostId = String(formData.get("hostId") ?? "");
  const customerId = String(formData.get("customerId") ?? "");
  const startsInMinutes = Number(formData.get("startsInMinutes"));
  const durationMinutes = Number(formData.get("durationMinutes"));

  if (!hostId || !customerId) fail("Choose a host and a customer.");
  if (hostId === customerId) fail("The host and the customer must be different people.");
  if (user.id !== hostId && user.id !== customerId) fail("You can only create a call that you are part of.");
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

  // Whole seconds only, because the video service reports times in whole seconds.
  const startsAt = new Date(Math.ceil((Date.now() + startsInMinutes * 60_000) / 1000) * 1000);
  const endsAt = new Date(startsAt.getTime() + Math.round(durationMinutes * 60) * 1000);

  const [call] = await db
    .insert(schema.calls)
    .values({ hostId, customerId, startsAt, endsAt, roomName: `call-${randomUUID()}` })
    .returning({ id: schema.calls.id });

  redirect(`/calls/${call.id}`);
}
