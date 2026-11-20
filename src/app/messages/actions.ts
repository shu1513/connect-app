"use server";

import { markReadUpTo } from "@/lib/messages/messages";
import { getUser } from "@/lib/session";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Called by the person's own browser once it has really shown their Messages page: the newest
 * message on it, and every older one of theirs, count as read. A message that is not theirs
 * changes nothing.
 */
export async function messagesShownAction(newestId: string): Promise<void> {
  if (typeof newestId !== "string" || !UUID.test(newestId)) return;
  const user = await getUser();
  if (!user) return;
  await markReadUpTo(user.id, newestId);
}
