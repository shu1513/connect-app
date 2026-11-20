/**
 * The last step of signing up: "18 or older", the three general documents, and the time zone. One
 * function does it, for the website's form (src/app/welcome/actions.ts) and for the phone app's
 * address (src/app/api/app/welcome/route.ts), so the two can never come to differ
 * (plans/45-phone-apps/03-signing-in.md; plans/46-agreements-live.md, decisions 4 to 7).
 *
 * Since plan 46 the documents are accepted by finishing the step, and the step says which
 * versions it showed. Nothing is written for a request that does not name them: a tick or a
 * `true` alone is not proof of what a person was shown.
 */
import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { acceptGeneralAgreements, type Shown } from "@/legal/accept";
import { agreementsToAccept, type AgreementToAccept } from "@/legal/versions";
import { isTimeZone } from "@/lib/time-zones";

export type WelcomeResult =
  /** Written now. */
  | "done"
  /** This person had done the step already: nothing is written a second time. */
  | "already"
  /** The box "18 or older" is not ticked. */
  | "boxes"
  /** The time zone is not one from the list. */
  | "zone"
  /** The versions the step showed are not the ones in effect (or it named none): the step has to be shown again. */
  | "changed"
  /** Between being let in and the writing, the account was closed or its email address stopped being confirmed: nothing is written. */
  | "gone";

/** The sentence for each thing that can be wrong, the same on the website and in the app. */
export const WELCOME_PROBLEMS = {
  boxes: "Please tick the box to continue.",
  zone: "Please choose your time zone from the list.",
  changed: "The documents changed while this page was open. Please read them again.",
} as const;

/** The documents the step shows and accepts at this moment, each with the address of its exact version. For the website and the app alike. */
export function welcomeAgreements(now: Date): AgreementToAccept[] {
  return agreementsToAccept("sign_up", now);
}

/**
 * Records that the person ticked "18 or older" and, by finishing the step, accepted the general
 * documents in the versions the step showed (`shown`). Written by the server only, with the
 * server's own clock. The caller has already made sure who the person is, and that the email
 * address is confirmed.
 *
 * The writing itself asks once more, with the person's line locked, that the account is still
 * open, still confirmed, and still has the step to do. So two requests at the same moment write
 * once (the second finds it done and changes nothing), and an account closed a moment ago is not
 * written to.
 */
export async function finishSigningUp(person: { id: string; welcomed: boolean }, given: { adult: boolean; shown: Shown; timeZone: string }): Promise<WelcomeResult> {
  if (person.welcomed) return "already";
  if (!given.adult) return "boxes";
  if (!isTimeZone(given.timeZone)) return "zone";
  return acceptGeneralAgreements({ userId: person.id, shown: given.shown, timeZone: given.timeZone, now: new Date() });
}

/** Whether this person accepted an earlier version of the terms: the step then says "we have updated our terms". */
export async function acceptedBefore(personId: string): Promise<boolean> {
  const [row] = await db.select({ termsAcceptedAt: schema.user.termsAcceptedAt }).from(schema.user).where(eq(schema.user.id, personId));
  return Boolean(row?.termsAcceptedAt);
}
