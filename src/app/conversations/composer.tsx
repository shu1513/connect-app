"use client";

import { useActionState, useRef, useState } from "react";
import { sendAction } from "./actions";
import type { ComposerState } from "./composer-state";

/**
 * The box for writing a message. It answers in place, and what was typed is never lost: not over
 * a refusal, not when the conversation closes while someone is typing (the page asks the server
 * again every few seconds, and the other person may have blocked or switched off in the
 * meantime), and not when the server's answer never arrives. So the page always draws this, open
 * or not. While the conversation is closed it shows nothing, unless something was typed or
 * refused: then the words stay, to be copied.
 *
 * Whether this person may write is decided on the server each time (sendMessage); `open` only
 * says what was true when the page was drawn.
 *
 * Every message carries a once-only key made here. The key belongs to its words: it stays the
 * same until the server has said that the message with it went through, or until the words are
 * changed. So a press that is sent twice, or pressed again after an answer that was lost on the
 * way, makes one message; and words that were changed after a lost answer are sent as a message
 * of their own, never mistaken for the one before.
 *
 * `max` is handed in by the page: this file runs in the browser and must not pull in the code
 * that knows the limit, because that code talks to the database.
 */
export function Composer({ conversationId, name, max, open }: { conversationId: string; name: string; max: number; open: boolean }) {
  const [state, formAction, pending] = useActionState<ComposerState, FormData>(send, { error: null, sentKey: null, draft: "" });
  const key = useRef<{ key: string; words: string } | null>(null);
  // How long the text in the box is, once the person has typed since the server's last answer.
  const [typed, setTyped] = useState<{ since: ComposerState; length: number } | null>(null);
  const hasText = (typed?.since === state ? typed.length : state.draft.length) > 0;

  /**
   * Asks the server, and catches an answer that never came (the connection dropped): the message
   * may or may not have been saved. The words go back into the box and the key is kept, so
   * pressing Send again sends those words under the same key, and they are saved once.
   */
  async function send(previous: ComposerState, formData: FormData): Promise<ComposerState> {
    const words = String(formData.get("text") ?? "").replace(/\r\n?/g, "\n");
    // A new key for a new message: the first one, after the server confirmed the last, and when the words changed.
    if (key.current === null || key.current.key === previous.sentKey || key.current.words !== words) key.current = { key: crypto.randomUUID(), words };
    formData.set("sendKey", key.current.key);
    try {
      return await sendAction(previous, formData);
    } catch {
      return { error: "We could not confirm that this was sent. Press Send again: it will not be sent twice.", sentKey: null, draft: words };
    }
  }

  if (!open && !hasText && !state.error) return null;

  return (
    <form action={formAction} className="mt-6 text-sm" data-composer={open ? "open" : "kept"}>
      <input type="hidden" name="conversationId" value={conversationId} />
      <label className="block">
        <span className="block font-semibold">{open ? `Write to ${name}` : "What you wrote was not sent. You can still copy it."}</span>
        <textarea
          name="text"
          rows={3}
          maxLength={max}
          required
          defaultValue={state.draft}
          readOnly={pending || !open}
          onChange={(event) => setTyped({ since: state, length: event.target.value.length })}
          className="mt-2 w-full rounded border border-neutral-400 bg-transparent px-3 py-2"
        />
      </label>
      {state.error && (
        <p role="alert" className="mt-1 rounded border border-red-600 p-3" data-send-error>
          {state.error}
        </p>
      )}
      {open && (
        <p className="mt-2">
          <button type="submit" disabled={pending} className="rounded bg-blue-600 px-4 py-2 font-medium text-white">
            {pending ? "Sending…" : "Send"}
          </button>
        </p>
      )}
    </form>
  );
}
