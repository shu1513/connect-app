/**
 * Fetching a profile picture from a network's picture server (plans/29, "Fetching the picture
 * safely"). The caller has already decided the address is allowed (`pictureAddress`). The request
 * carries no key and no cookie, follows no redirect, must answer 200, and has a fixed time in all,
 * reading included. The picture is read piece by piece and dropped the moment it is too large,
 * whatever the server said about its length. The address is never written down.
 */
import { PHOTO } from "./photo-rules";

export type PictureTransport = (address: URL, init: RequestInit) => Promise<Response>;

/** The picture's bytes, or null: no connection, a redirect, another answer than 200, too slow, too large, or empty. */
export async function fetchPicture(address: URL, options: { transport?: PictureTransport; withinMs?: number; maxBytes?: number } = {}): Promise<Buffer | null> {
  const maxBytes = options.maxBytes ?? PHOTO.fetchMaxBytes;
  const stop = new AbortController();
  const late = setTimeout(() => stop.abort(), options.withinMs ?? PHOTO.fetchWithinMs);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const answer = await (options.transport ?? fetch)(address, { redirect: "error", cache: "no-store", credentials: "omit", signal: stop.signal });
    reader = answer.body?.getReader();
    if (answer.status !== 200 || !reader) return null;
    const said = Number(answer.headers.get("content-length") ?? "0");
    if (Number.isFinite(said) && said > maxBytes) return null;
    const pieces: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maxBytes) return null;
      pieces.push(next.value);
    }
    return size > 0 ? Buffer.concat(pieces) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(late);
    // Whatever was not read is let go of.
    void reader?.cancel().catch(() => undefined);
  }
}
