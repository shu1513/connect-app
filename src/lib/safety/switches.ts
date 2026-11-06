/** The founder's emergency switches: "no new requests" and "nobody can join a call". */
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";

export async function switches(): Promise<{ requestsOff: boolean; joiningOff: boolean }> {
  const [row] = await db.select().from(schema.siteSwitches).where(eq(schema.siteSwitches.id, 1));
  return { requestsOff: row?.requestsOff ?? false, joiningOff: row?.joiningOff ?? false };
}

export async function setSwitches(values: { requestsOff: boolean; joiningOff: boolean }): Promise<void> {
  await db
    .insert(schema.siteSwitches)
    .values({ id: 1, ...values, updatedAt: new Date() })
    .onConflictDoUpdate({ target: schema.siteSwitches.id, set: { ...values, updatedAt: new Date() } });
}
