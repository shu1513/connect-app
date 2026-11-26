"use client";

import { useActionState, useRef } from "react";
import { sendAction } from "./actions";
import type { ComposerState } from "./composer-state";

/**
 * The box for writing a message. It answers in place, and what was typed is never lost over a
 * refusal. Whether this person may write is decided on the server each time (sendMessage); the
 * page draws this only for someone who could write when it was drawn.
 *
 * Every message carries a once-only key made here. The key stays the same until the server has
 * said that the message with it went through, so a press that is sent twice, or pressed again
 * after a lost answer, makes one message.
 *
 * `max` is handed in by the page: this file runs in the browser and must not pull in the code
 * that knows the limit, because that code talks to the database.
 */
export function Composer({ conversationId, name, max }: { conversationId: string; name: string; max: number }) {
  const [state, formAction, pending] = useActionState<ComposerState, FormData>(sendAction, { error: null, sentKey: null, draft: "" });
  const key = useRef<string | null>(null);

  function send(formData: FormData) {
    // A new key only for a new message: the first one, and after the server confirmed the last.
    if (key.current === null || key.current === state.sentKey) key.current = crypto.randomUUID();
    formData.set("sendKey", key.current);
    formAction(formData);
  }

  return (
    <form action={send} className="mt-6 text-sm" data-composer>
      <input type="hidden" name="conversationId" value={conversationId} />
      <label className="block">
        <span className="block font-semibold">Write to {name}</span>
        <textarea name="text" rows={3} maxLength={max} required defaultValue={state.draft} readOnly={pending} className="mt-2 w-full rounded border border-neutral-400 bg-transparent px-3 py-2" />
      </label>
      {state.error && (
        <p role="alert" className="mt-1 rounded border border-red-600 p-3" data-send-error>
          {state.error}
        </p>
      )}
      <p className="mt-2">
        <button type="submit" disabled={pending} className="rounded bg-blue-600 px-4 py-2 font-medium text-white">
          {pending ? "Sending…" : "Send"}
        </button>
      </p>
    </form>
  );
}
