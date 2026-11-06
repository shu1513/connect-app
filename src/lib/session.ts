import "server-only";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db, schema } from "@/db";
import { auth } from "./auth";

/** The version of the terms a person accepts on the welcome page. Change it when the terms change. */
export const TERMS_VERSION = "2026-11-draft";

export type CurrentUser = { id: string; name: string; email: string; timeZone: string | null };

/** Anyone with a valid login, including people who have not finished signing up. */
export type SignedIn = CurrentUser & {
  emailVerified: boolean;
  /** Ticked "18 or older" and accepted the terms. */
  welcomed: boolean;
  closed: boolean;
};

/**
 * Whoever is logged in, with where they stand. Only the welcome and login
 * pages use this directly. Everything else uses getUser() or requireUser().
 */
export const getSignedIn = cache(async (): Promise<SignedIn | null> => {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  // Read our own fields straight from the database, so they can never come from the browser.
  const [row] = await db.select().from(schema.user).where(eq(schema.user.id, session.user.id));
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    timeZone: row.timeZone,
    emailVerified: row.emailVerified,
    welcomed: Boolean(row.adultConfirmedAt && row.termsAcceptedAt),
    closed: Boolean(row.closedAt),
  };
});

/** The gate: logged in, email confirmed, 18-and-terms ticked, account not closed. */
function mayUseTheApp(person: SignedIn): boolean {
  return person.emailVerified && person.welcomed && !person.closed;
}

/**
 * The logged-in person, or null. Null also for someone who is logged in but
 * may not use the app yet (or any more). Always checked on the server.
 */
export async function getUser(): Promise<CurrentUser | null> {
  const person = await getSignedIn();
  if (!person || !mayUseTheApp(person)) return null;
  return { id: person.id, name: person.name, email: person.email, timeZone: person.timeZone };
}

/** For pages and actions: sends anyone who may not use the app to the right place. */
export async function requireUser(): Promise<CurrentUser> {
  const person = await getSignedIn();
  if (!person || person.closed || !person.emailVerified) redirect("/login");
  if (!person.welcomed) redirect("/welcome");
  return { id: person.id, name: person.name, email: person.email, timeZone: person.timeZone };
}
