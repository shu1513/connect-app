/**
 * The last step of signing up: "18 or older", the terms, and the time zone. One function does
 * it, for the website's form (src/app/welcome/actions.ts) and for the phone app's address
 * (src/app/api/app/welcome/route.ts), so the two can never come to differ
 * (plans/45-phone-apps/03-signing-in.md).
 */
import "server-only";
import { and, eq, isNull, ne, or } from "drizzle-orm";
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
  | "zone"
  /** Between being let in and the writing, the account was closed or its email address stopped being confirmed: nothing is written. */
  | "gone";

/** The sentence for each thing that can be wrong, the same on the website and in the app. */
export const WELCOME_PROBLEMS = {
  boxes: "Please tick both boxes to continue.",
  zone: "Please choose your time zone from the list.",
} as const;

/**
 * Records that the person ticked "18 or older" and accepted the terms now in force. Written by
 * the server only, with the server's own clock. The caller has already made sure who the person
 * is, and that the email address is confirmed.
 *
 * The writing itself asks once more, in the same breath, that the account is still open, still
 * confirmed, and still has the step to do. So two requests at the same moment write once (the
 * second finds it done and changes nothing), and an account closed a moment ago is not written to.
 */
export async function finishSigningUp(person: { id: string; welcomed: boolean }, given: { adult: boolean; terms: boolean; timeZone: string }): Promise<WelcomeResult> {
  if (person.welcomed) return "already";
  if (!given.adult || !given.terms) return "boxes";
  if (!isTimeZone(given.timeZone)) return "zone";
  const now = new Date();
  const stillToDo = or(isNull(schema.user.adultConfirmedAt), isNull(schema.user.termsAcceptedAt), isNull(schema.user.termsVersion), ne(schema.user.termsVersion, TERMS_VERSION));
  const written = await db
    .update(schema.user)
    .set({ adultConfirmedAt: now, termsAcceptedAt: now, termsVersion: TERMS_VERSION, timeZone: given.timeZone, updatedAt: now })
    .where(and(eq(schema.user.id, person.id), isNull(schema.user.closedAt), eq(schema.user.emailVerified, true), stillToDo))
    .returning({ id: schema.user.id });
  if (written.length > 0) return "done";
  // Nothing was written. Either another request did the step a moment ago, or the account is no longer one that may.
  const [row] = await db
    .select({ closedAt: schema.user.closedAt, emailVerified: schema.user.emailVerified, adultConfirmedAt: schema.user.adultConfirmedAt, termsAcceptedAt: schema.user.termsAcceptedAt, termsVersion: schema.user.termsVersion })
    .from(schema.user)
    .where(eq(schema.user.id, person.id));
  const doneMeanwhile = Boolean(row && !row.closedAt && row.emailVerified && row.adultConfirmedAt && row.termsAcceptedAt && row.termsVersion === TERMS_VERSION);
  return doneMeanwhile ? "already" : "gone";
}

/** Whether this person accepted an earlier version of the terms: the step then says "we have updated the rules". */
export async function acceptedBefore(personId: string): Promise<boolean> {
  const [row] = await db.select({ termsAcceptedAt: schema.user.termsAcceptedAt }).from(schema.user).where(eq(schema.user.id, personId));
  return Boolean(row?.termsAcceptedAt);
}
