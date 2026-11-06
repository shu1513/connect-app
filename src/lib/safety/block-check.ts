/** Whether either of two people has blocked the other. Kept tiny so any code can ask without pulling in the rest. */
import { and, eq, or } from "drizzle-orm";
import { db, schema } from "@/db";

type Reader = Pick<typeof db, "select">;

export async function isBlockedEitherWay(a: string, b: string, reader: Reader = db): Promise<boolean> {
  const [row] = await reader
    .select({ blockerId: schema.blocks.blockerId })
    .from(schema.blocks)
    .where(or(and(eq(schema.blocks.blockerId, a), eq(schema.blocks.blockedId, b)), and(eq(schema.blocks.blockerId, b), eq(schema.blocks.blockedId, a))))
    .limit(1);
  return Boolean(row);
}
