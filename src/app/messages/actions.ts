"use server";

import { markShown, MESSAGES_SHOWN } from "@/lib/messages/messages";
import { getUser } from "@/lib/session";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Called by the person's own browser once it has really shown their Messages page: the messages
 * that were on it count as read, and, when the page was full, every older one too. A message that
 * is not theirs changes nothing.
 */
export async function messagesShownAction(shownIds: string[], pageWasFull: boolean): Promise<void> {
  if (!Array.isArray(shownIds) || shownIds.length === 0 || shownIds.length > MESSAGES_SHOWN || !shownIds.every((id) => typeof id === "string" && UUID.test(id))) return;
  const user = await getUser();
  if (!user) return;
  // The page lists newest first, so the last one is the oldest on it.
  await markShown(user.id, shownIds, pageWasFull === true ? shownIds[shownIds.length - 1] : null);
}
