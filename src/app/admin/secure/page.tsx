import { eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { db, schema } from "@/db";
import { getSignedIn, isAdminSession } from "@/lib/session";
import { SecureForm } from "./secure-form";

/** Where an admin sets up the second login step. Reachable with an ordinary login; nothing else admin is. */
export default async function SecureAdminPage() {
  const person = await getSignedIn();
  if (!person || person.closed || !person.emailVerified) redirect("/login");
  const [admin] = await db.select().from(schema.admins).where(eq(schema.admins.userId, person.id));
  if (!admin) notFound();
  if (await isAdminSession(person)) redirect("/admin");

  const [factor] = await db.select().from(schema.twoFactor).where(eq(schema.twoFactor.userId, person.id));
  const alreadySetUp = Boolean(factor?.verified && admin.securedAt);

  return (
    <main className="mx-auto w-full max-w-md px-4 py-16">
      <h1 className="text-2xl font-semibold">Protect the admin account</h1>
      {alreadySetUp ? (
        <p className="mt-4 text-sm">
          Your second step is set up, but this login was made without it. Please log out and log in again with your password and a code
          from your authenticator app.
        </p>
      ) : (
        <>
          <p className="mt-2 text-sm opacity-70">
            The admin account can close accounts and move money, so a password alone is not enough. From now on you log in with your
            password and a 6-digit code from an app on your phone.
          </p>
          <SecureForm />
        </>
      )}
    </main>
  );
}
