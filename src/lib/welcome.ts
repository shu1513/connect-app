/**
 * The last step of signing up: "18 or older", the terms, and the time zone. One function does
 * it, for the website's form (src/app/welcome/actions.ts) and for the phone app's address
 * (src/app/api/app/welcome/route.ts), so the two can never come to differ
 * (plans/45-phone-apps/03-signing-in.md).
 */
import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { TERMS_VERSION } from "@/lib/terms";
import { isTimeZone } from "@/lib/time-zones";

export type WelcomeResult =
  /** Written now. */
  | "done"
  /** This person had done the step already: nothing is written a second time. */
  | "already"
  /** One of the two boxes is not ticked. */
  | "boxes"
  /** The time zone is not one from the list. */
  | "zone";

/** The sentence for each thing that can be wrong, the same on the website and in the app. */
export const WELCOME_PROBLEMS = {
  boxes: "Please tick both boxes to continue.",
  zone: "Please choose your time zone from the list.",
} as const;

/**
 * Records that the person ticked "18 or older" and accepted the terms now in force. Written by
 * the server only, with the server's own clock. The caller has already made sure who the person
 * is, and that the email address is confirmed.
 */
export async function finishSigningUp(person: { id: string; welcomed: boolean }, given: { adult: boolean; terms: boolean; timeZone: string }): Promise<WelcomeResult> {
  if (person.welcomed) return "already";
  if (!given.adult || !given.terms) return "boxes";
  if (!isTimeZone(given.timeZone)) return "zone";
  const now = new Date();
  await db
    .update(schema.user)
    .set({ adultConfirmedAt: now, termsAcceptedAt: now, termsVersion: TERMS_VERSION, timeZone: given.timeZone, updatedAt: now })
    .where(eq(schema.user.id, person.id));
  return "done";
}

/** Whether this person accepted an earlier version of the terms: the step then says "we have updated the rules". */
export async function acceptedBefore(personId: string): Promise<boolean> {
  const [row] = await db.select({ termsAcceptedAt: schema.user.termsAcceptedAt }).from(schema.user).where(eq(schema.user.id, personId));
  return Boolean(row?.termsAcceptedAt);
}
