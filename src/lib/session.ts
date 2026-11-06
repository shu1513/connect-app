import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "./auth";

export type CurrentUser = { id: string; name: string; email: string };

/** The logged-in person, or null. Always checked on the server. */
export async function getUser(): Promise<CurrentUser | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  return { id: session.user.id, name: session.user.name, email: session.user.email };
}

/** For pages: sends anyone who is not logged in to the login page. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getUser();
  if (!user) redirect("/login");
  return user;
}
