"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { recordAdminAction } from "@/lib/safety/audit";
import { getSignedIn } from "@/lib/session";

/**
 * The admin has set up and checked their second step. From now on only logins
 * made with it count, so every existing login (including this one) is ended.
 */
export async function finishSecuring() {
  const person = await getSignedIn();
  if (!person) redirect("/login");
  const [admin] = await db.select().from(schema.admins).where(eq(schema.admins.userId, person.id));
  const [factor] = await db.select().from(schema.twoFactor).where(eq(schema.twoFactor.userId, person.id));
  if (!admin || !factor || !factor.verified || !person.twoFactorEnabled) redirect("/admin/secure");
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.update(schema.admins).set({ securedAt: now }).where(eq(schema.admins.userId, person.id));
    await tx.delete(schema.session).where(eq(schema.session.userId, person.id));
    await recordAdminAction({ adminId: person.id, action: "second login step set up", targetUserId: person.id }, tx);
  });
  redirect("/login?notice=secured");
}
