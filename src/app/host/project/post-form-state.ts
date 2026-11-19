/**
 * What the post form holds and what its action answers with: the words of a refusal (or null),
 * and the text and links as they were typed, so they can be put back into the boxes.
 */
export type PostFormState = { error: string | null; text: string; links: string[] };
