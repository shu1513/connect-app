import "server-only";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { db, schema } from "@/db";
import { countsAsAdminLogin } from "./admin-gate";
import { auth } from "./auth";

export { TERMS_VERSION } from "./terms";
import { generalStamp } from "@/legal/versions";

export type CurrentUser = {
  id: string;
  name: string;
  email: string;
  timeZone: string | null;
  /** Paused by the founder: may log in and look, but not book, host or join calls. */
  paused: boolean;
};

/** Anyone with a valid login, including people who have not finished signing up. */
export type SignedIn = CurrentUser & {
  emailVerified: boolean;
  /** Ticked "18 or older" and accepted the current terms. */
  welcomed: boolean;
  closed: boolean;
  twoFactorEnabled: boolean;
  sessionCreatedAt: Date;
};

/**
 * The reading itself, from the headers of any request: who is logged in, with where they stand.
 * The website's pages reach it through getSignedIn(); an address for the phone app is handed the
 * request and calls it directly (plans/45-phone-apps/01-the-door.md).
 *
 * `renew: false` reads the login without extending it. The app's own addresses read this way:
 * when the login tool extends a login it hands back a renewed cookie, and only the phone's direct
 * request to the login tool can receive that. An extension made here would never reach the phone,
 * and would then not be offered again.
 */
export async function signedInFrom(requestHeaders: Headers, options: { renew?: boolean } = {}): Promise<SignedIn | null> {
  const session = await auth.api.getSession({ headers: requestHeaders, ...(options.renew === false ? { query: { disableRefresh: true } } : {}) });
  if (!session) return null;
  // Read our own fields straight from the database, so they can never come from the browser.
  const [row] = await db.select().from(schema.user).where(eq(schema.user.id, session.user.id));
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    timeZone: row.timeZone,
    paused: Boolean(row.pausedAt),
    emailVerified: row.emailVerified,
    // The stamp on the person's line names the versions of the three general documents they hold. Asked for at
    // this moment, not when the server started: a new version can take effect while it runs, and from that
    // day everyone is asked again (plans/46-agreements-live.md, decision 5).
    welcomed: Boolean(row.adultConfirmedAt && row.termsAcceptedAt && row.termsVersion === generalStamp(new Date())),
    closed: Boolean(row.closedAt),
    twoFactorEnabled: row.twoFactorEnabled,
    sessionCreatedAt: session.session.createdAt,
  };
}

/**
 * Whoever is logged in, with where they stand, for the page being made. Only the welcome and
 * login pages use this directly. Everything else uses getUser() or requireUser().
 */
export const getSignedIn = cache(async (): Promise<SignedIn | null> => signedInFrom(await headers()));

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
  return { id: person.id, name: person.name, email: person.email, timeZone: person.timeZone, paused: person.paused };
}

/**
 * For pages and actions: sends anyone who may not use the app to the right place.
 * A page in the middle of a journey passes its own address, so the person comes back to it after logging in.
 */
export async function requireUser(backTo?: string): Promise<CurrentUser> {
  const person = await getSignedIn();
  const next = backTo ? `?next=${encodeURIComponent(backTo)}` : "";
  if (!person || person.closed || !person.emailVerified) redirect(`/login${next}`);
  if (!person.welcomed) redirect(`/welcome${next}`);
  return { id: person.id, name: person.name, email: person.email, timeZone: person.timeZone, paused: person.paused };
}

/** For actions that start or join something: a paused account may not. */
export async function requireActiveUser(backTo?: string): Promise<CurrentUser> {
  const user = await requireUser(backTo);
  if (user.paused) redirect("/paused");
  return user;
}

/**
 * Whether this login counts as an admin login: an admin account, logged in
 * with the second step set up, and logged in after it was set up. Older
 * logins (and any login that skipped the step) do not count.
 */
export async function isAdminSession(person: SignedIn | null): Promise<boolean> {
  return person ? countsAsAdminLogin(person) : false;
}

/**
 * For admin pages and actions. An admin who has not set up the second step
 * yet is sent to do that; anyone else sees "not found", like for any page
 * that does not exist for them.
 */
export async function requireAdmin(): Promise<CurrentUser> {
  const person = await getSignedIn();
  if (!person || person.closed || !person.emailVerified) redirect("/login");
  if (!person.welcomed) redirect("/welcome");
  const [admin] = await db.select().from(schema.admins).where(eq(schema.admins.userId, person.id));
  if (!admin) notFound();
  if (!(await isAdminSession(person))) redirect("/admin/secure");
  return { id: person.id, name: person.name, email: person.email, timeZone: person.timeZone, paused: person.paused };
}
