/**
 * Reading one uploaded picture out of a request (plans/24, "Uploading a picture"; plans/35). Used
 * by the two addresses a picture can be uploaded to: a diary post's, and a person's photo's. The
 * caller holds the one place for working on a picture while this runs.
 */
import { PICTURE } from "./rules";

/** The whole request may be this large: the picture, and a little for the form around it. */
export const REQUEST_MAX = PICTURE.uploadMaxBytes + PICTURE.formOverheadBytes;
const READ_WITHIN_MS = 30_000;

/**
 * Reads the request piece by piece and stops the moment it is larger than allowed, whatever it
 * said about its own length, or when it takes too long. Null means: too large or too slow.
 */
async function readWithin(request: Request, limit: number, withinMs: number): Promise<Buffer | null> {
  const reader = request.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const pieces: Uint8Array[] = [];
  let size = 0;
  let late: NodeJS.Timeout | undefined;
  const tooLate = new Promise<"late">((resolve) => (late = setTimeout(() => resolve("late"), withinMs)));
  try {
    for (;;) {
      const next = await Promise.race([reader.read(), tooLate]);
      if (next === "late") return null;
      if (next.done) return Buffer.concat(pieces);
      size += next.value.byteLength;
      if (size > limit) return null;
      pieces.push(next.value);
    }
  } finally {
    clearTimeout(late);
    // Whatever was not read is let go of.
    void reader.cancel().catch(() => undefined);
  }
}

/** Why no picture could be taken out of a request: too large or too slow; not a form that can be read; not exactly one file. */
export type UploadProblem = "too_large" | "unreadable" | "not_one";

/**
 * The one file of a file form, from the field called "picture", or why there is none. Only what
 * was read within the limit is taken apart: exactly one file, and nothing else. `kind` is the
 * request's own content type, which the caller has already seen to be a file form. (`withinMs` is
 * only ever given by a check script, which cannot wait half a minute for a request that stalls.)
 */
export async function readOnePicture(request: Request, kind: string, withinMs: number = READ_WITHIN_MS): Promise<Buffer | UploadProblem> {
  const body = await readWithin(request, REQUEST_MAX, withinMs);
  if (!body) return "too_large";
  let parts: Array<[string, FormDataEntryValue]>;
  try {
    parts = [...(await new Response(new Uint8Array(body), { headers: { "content-type": kind } }).formData()).entries()];
  } catch {
    return "unreadable";
  }
  const file = parts.length === 1 && parts[0][0] === "picture" && typeof parts[0][1] !== "string" ? parts[0][1] : null;
  if (!file || file.size === 0) return "not_one";
  if (file.size > PICTURE.uploadMaxBytes) return "too_large";
  return Buffer.from(await file.arrayBuffer());
}
