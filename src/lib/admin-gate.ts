/**
 * The rule for what counts as an admin login: an admin account, logged in
 * with the second step set up, and logged in after it was set up. Older
 * logins (and any login that skipped the step) do not count.
 */
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";

export async function countsAsAdminLogin(person: { id: string; twoFactorEnabled: boolean; sessionCreatedAt: Date }): Promise<boolean> {
  const [admin] = await db.select().from(schema.admins).where(eq(schema.admins.userId, person.id));
  if (!admin) return false;
  return person.twoFactorEnabled && admin.securedAt !== null && person.sessionCreatedAt >= admin.securedAt;
}
