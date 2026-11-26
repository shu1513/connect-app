"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { conversationFor, markShownUpTo, setMuted, shownRefusalFor, viewOf } from "@/lib/conversations/read";
import { isConversationId, openConversation, sendMessage, type SendResult } from "@/lib/conversations/send";
import { CONVERSATION_WORDS, limitWords, refusalWords } from "@/lib/conversations/words";
import { withNotice } from "@/lib/notice";
import { safeNext } from "@/lib/safe-next";
import { getUser, requireUser } from "@/lib/session";
import type { ComposerState } from "./composer-state";

/** Why a message was not sent, in words for the person who pressed. Asked only after a refusal. */
async function refusedWords(userId: string, conversationId: string, result: Extract<SendResult, { ok: false }>): Promise<string> {
  if (result.kind === "not_found") return CONVERSATION_WORDS.notFound;
  if (result.kind === "text") return result.which === "too_long" ? CONVERSATION_WORDS.tooLong : result.which === "empty" ? CONVERSATION_WORDS.empty : CONVERSATION_WORDS.wrong;
  const conversation = await conversationFor(userId, conversationId);
  if (!conversation) return CONVERSATION_WORDS.notFound;
  const view = await viewOf(conversation, userId, new Date());
  if (result.kind === "limit") return limitWords(result.problem, view.other.name);
  // The same sentence the page itself shows for this state: a form sent a moment too late gives nothing else away.
  return refusalWords(shownRefusalFor(result.why, view.bookHref !== null, result.stopped), view.other.name);
}

/**
 * Sends a message from the box on a conversation's page. It answers in place: after a message
 * that went through the box is empty and the page is drawn again with it; after a refusal what
 * was typed is still in the box, with the reason. Who may write is decided in `sendMessage`.
 */
export async function sendAction(_state: ComposerState, formData: FormData): Promise<ComposerState> {
  // A form sends line breaks as CRLF and the box shows them as LF: the draft goes back the way the box shows it.
  const draft = String(formData.get("text") ?? "").replace(/\r\n?/g, "\n");
  const refused = (error: string): ComposerState => ({ error, sentKey: null, draft });
  // Asked without sending the browser to the login page: someone whose login ran out while typing keeps their draft.
  const user = await getUser();
  if (!user) return refused("You are not logged in any more. Copy what you typed, log in again, and then send it.");
  const conversationId = String(formData.get("conversationId") ?? "");
  const sendKey = String(formData.get("sendKey") ?? "");
  try {
    const result = await sendMessage({ conversationId, senderId: user.id, text: draft, sendKey });
    // The page is drawn again in the same answer: with the new message, or with what has changed since it was drawn.
    refresh();
    if (result.ok) return { error: null, sentKey: sendKey, draft: "" };
    return refused(await refusedWords(user.id, conversationId, result));
  } catch (error) {
    // Never the error itself: a database error carries the statement's values, which here are the message that was typed.
    const code = (error as { cause?: { code?: unknown } } | null)?.cause?.code;
    console.error(`[conversations] could not send a message (${error instanceof Error ? error.name : "unknown error"}${typeof code === "string" ? `, database code ${code}` : ""})`);
    return refused(CONVERSATION_WORDS.wrong);
  }
}

/**
 * Called by the person's own browser once it has really shown a conversation: the messages up to
 * this number count as shown. Never while the page is drawn. Someone else's conversation changes
 * nothing.
 */
export async function conversationShownAction(conversationId: string, number: number): Promise<void> {
  if (typeof conversationId !== "string" || !isConversationId(conversationId) || !Number.isInteger(number) || number < 1) return;
  const user = await getUser();
  if (!user) return;
  await markShownUpTo(user.id, conversationId, number);
}

/** The customer's switch for one host. Only the customer of that conversation can move it (`setMuted`). */
export async function muteAction(formData: FormData) {
  const user = await requireUser();
  const conversationId = String(formData.get("conversationId") ?? "");
  const on = formData.get("on") === "1";
  const mine = await setMuted(user.id, conversationId, on, new Date());
  if (!mine) redirect("/messages");
  redirect(withNotice(`/conversations/${conversationId}`, on ? "Done. They can write to you only around a call you booked with them." : "Done. They can write to you again."));
}

/**
 * "Write to …": opens the conversation of a pair and goes to it. Who the two are is worked out on
 * the server from the call or the customer the form names (`openConversation`); a refusal makes
 * nothing and says so on the page the person came from.
 */
export async function openConversationAction(formData: FormData) {
  const user = await requireUser();
  const callId = String(formData.get("callId") ?? "");
  const customerId = String(formData.get("customerId") ?? "");
  const back = safeNext(String(formData.get("back") ?? "/messages"));
  const id = await openConversation({ userId: user.id, ...(callId ? { callId } : { customerId }) });
  if (!id) redirect(withNotice(back, "You cannot write to this person right now."));
  redirect(`/conversations/${id}`);
}
