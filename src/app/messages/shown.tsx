"use client";

import { startTransition, useEffect } from "react";
import { messagesShownAction } from "./actions";

/**
 * Tells the server that this person's browser has shown their messages, once the page is really
 * on their screen. The page itself never writes while it is drawn: a page can be drawn without
 * anybody looking at it (when a browser fetches it ahead of a click), and that must not count as
 * having read anything. Draws nothing.
 */
export function MessagesShown({ newestId }: { newestId: string }) {
  useEffect(() => {
    // A server action called from an effect goes inside a transition (this Next.js version's guide on server actions).
    // If the telling fails, the messages simply stay marked as new until the next visit.
    startTransition(() => {
      messagesShownAction(newestId).catch(() => undefined);
    });
  }, [newestId]);
  return null;
}
