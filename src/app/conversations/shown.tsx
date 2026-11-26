"use client";

import { startTransition, useEffect } from "react";
import { conversationShownAction } from "./actions";

/**
 * Tells the server that this person's browser has shown the conversation up to this message, once
 * the page is really on their screen and in front. The page itself never writes while it is
 * drawn: a page can be drawn without anybody looking at it. Draws nothing.
 */
export function ConversationShown({ conversationId, number }: { conversationId: string; number: number }) {
  useEffect(() => {
    const tell = () => {
      if (document.visibilityState !== "visible") return;
      // A server action called from an effect goes inside a transition. If the telling fails, the messages stay new until the next visit.
      startTransition(() => {
        conversationShownAction(conversationId, number).catch(() => undefined);
      });
    };
    tell();
    // A tab that was drawn in the background says so when the person comes to it.
    document.addEventListener("visibilitychange", tell);
    return () => document.removeEventListener("visibilitychange", tell);
  }, [conversationId, number]);
  return null;
}
