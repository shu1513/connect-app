/**
 * The record of what admins do. Rows are only ever added; nothing here
 * changes or removes one.
 */
import { db, schema } from "@/db";

type Writer = Pick<typeof db, "insert">;

export async function recordAdminAction(
  entry: { adminId: string; action: string; targetUserId?: string | null; targetId?: string | null; detail?: string },
  writer: Writer = db,
): Promise<void> {
  await writer.insert(schema.adminActions).values({
    adminId: entry.adminId,
    action: entry.action,
    targetUserId: entry.targetUserId ?? null,
    targetId: entry.targetId ?? null,
    detail: entry.detail ?? "",
  });
}
