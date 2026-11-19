"use client";

import { useActionState } from "react";
import type { PostFormState } from "./post-form-state";

const field = "mt-1 w-full rounded border border-neutral-400 bg-transparent px-3 py-2";

/**
 * The form a post is written and changed with. The one form of the project's pages that answers
 * in place when the server refuses it: a post can be long, so what was typed must never be lost
 * over a mistyped link, or because something changed while the form was open. A refusal comes
 * back with the words for the host and with everything she typed, and the boxes are filled with
 * it again. When the post is saved, the action sends the browser on, as every other form does.
 *
 * It works without any script in the browser too: the page is then drawn again with the same
 * answer in it.
 *
 * `closed` is the reason this post cannot be saved right now (the founder hid it, its project has
 * ended, projects are switched off). The form is still drawn, in the same place, with its boxes
 * to read only and no button: so if that happened while she was typing, what she typed comes
 * back here and can be copied, and is not replaced by the page being drawn again.
 */
export function PostForm(props: {
  action: (state: PostFormState, formData: FormData) => Promise<PostFormState>;
  /** The project a new post is for, or the post that is being changed. Sent back as it was given. */
  hidden: { name: "projectId" | "postId"; value: string };
  text: string;
  links: string[];
  button: string;
  closed?: string | null;
  rows: number;
  textMax: number;
  linksMax: number;
  linkMax: number;
}) {
  const [state, formAction, pending] = useActionState(props.action, { error: null, text: props.text, links: props.links });
  return (
    <form action={formAction} className="mt-3 space-y-3">
      <input type="hidden" name={props.hidden.name} value={props.hidden.value} />
      {state.error && (
        <p role="alert" className="rounded border border-red-600 p-3 text-sm">
          {state.error} Nothing was saved. What you typed is still below.
        </p>
      )}
      {props.closed && <p className="rounded border border-neutral-400 p-3 text-sm">{props.closed}</p>}
      <label className="block text-sm">
        Your post (up to {props.textMax} characters)
        <textarea name="text" rows={props.rows} required maxLength={props.textMax} defaultValue={state.text} readOnly={Boolean(props.closed)} className={field} />
      </label>
      <fieldset className="text-sm">
        <legend>YouTube links (optional, up to {props.linksMax})</legend>
        {Array.from({ length: props.linksMax }, (_, index) => (
          <input
            key={index}
            name="link"
            type="text"
            inputMode="url"
            maxLength={props.linkMax}
            defaultValue={state.links[index] ?? ""}
            readOnly={Boolean(props.closed)}
            placeholder="https://www.youtube.com/watch?v=…"
            aria-label={`YouTube link ${index + 1}`}
            autoCapitalize="none"
            className={field}
          />
        ))}
        <p className="mt-1 opacity-70">Other web addresses in your text are shown as plain text. Only these links can be clicked.</p>
      </fieldset>
      {!props.closed && (
        <button type="submit" disabled={pending} className="rounded bg-blue-600 px-4 py-2 font-medium text-white">
          {props.button}
        </button>
      )}
    </form>
  );
}
