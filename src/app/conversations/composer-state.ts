/**
 * What the box for writing a message holds, and what its action answers with (composer.tsx).
 *
 * `draft` is what the box shows after the answer: empty after a message that went through, what
 * was typed after a refusal. `sentKey` is the once-only key of the message that went through; the
 * box makes a new key for the next message only when it sees its own key here.
 */
export type ComposerState = { error: string | null; sentKey: string | null; draft: string };
