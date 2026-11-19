/**
 * What every picture checker has in common (plans/24, "The four checkers"). Each is given the
 * bytes of Connect's own copy, never an address to fetch it from, and gives exactly one answer.
 */

/**
 *   clean    it looked for everything it must look for, every result was there and valid, and it found nothing
 *   flagged  it found something (a flag counts even if another part of the answer is missing)
 *   out      the service is used up, too busy, cannot be reached, or did not answer in time
 *   fault    the answer was broken or incomplete, the key was refused, or the service could not read the picture
 */
export type Answer = {
  kind: "clean" | "flagged" | "out" | "fault";
  detail: string;
  /** Only with "flagged": other parts of the answer were missing or invalid. The picture is refused all the same, but such an answer does not show that the service works. */
  partial?: boolean;
};

export type ServiceName = "openai" | "azure" | "sightengine";

export type Checker = {
  name: ServiceName | "own";
  /** A fingerprint of the key in use, never the key itself. Null when the checker has no key and is not part of the queue. */
  keyMark: string | null;
  check: (jpeg: Buffer) => Promise<Answer>;
};

/** A service may take this long to answer. After that it counts as out. */
export const ANSWER_WITHIN_MS = 10_000;

/** What a service's own word for "not now" becomes: too many requests and trouble on its side are "out"; anything else is a fault. */
export function refusalOf(status: number, said: string): Answer {
  // What a service says about a refused key can repeat part of the key, so its words are not kept for those.
  const detail = status === 401 || status === 403 ? `HTTP ${status}: the key was refused` : `HTTP ${status}${said ? `: ${said.slice(0, 200)}` : ""}`;
  return status === 429 || status >= 500 ? { kind: "out", detail } : { kind: "fault", detail };
}

/**
 * Asks a service, and turns "no connection" and "no answer in time" into "out". `read` turns a
 * good answer into one of the four. A refusal is read by its HTTP code unless the service has its
 * own way of saying "used up" (`refused`).
 */
export async function askService(request: () => Promise<Response>, read: (body: unknown) => Answer, refused?: (status: number, body: unknown) => Answer | null): Promise<Answer> {
  let response: Response;
  try {
    response = await request();
  } catch (error) {
    return { kind: "out", detail: `no answer: ${error instanceof Error ? error.name : "error"}` };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    // A refusal has said what it is with its code, whatever became of the words after it: a refused key stays a fault.
    if (!response.ok) return refusalOf(response.status, "");
    // A good answer that stops arriving, or runs out of time on the way, is "no answer in time". Only one that arrived and is not what it should be is a fault.
    if (!(error instanceof SyntaxError)) return { kind: "out", detail: `the answer did not arrive: ${error instanceof Error ? error.name : "error"}` };
    return { kind: "fault", detail: "the answer could not be read" };
  }
  try {
    if (!response.ok) return refused?.(response.status, body) ?? refusalOf(response.status, saidBy(body));
    return read(body);
  } catch {
    return { kind: "fault", detail: "the answer did not have the expected shape" };
  }
}

function saidBy(body: unknown): string {
  const error = (body as { error?: { message?: unknown; type?: unknown; code?: unknown } } | null)?.error;
  return error ? [error.type, error.code, error.message].filter((part) => typeof part === "string" || typeof part === "number").join(" ") : "";
}

/** A number that is really one, between 0 and 1. */
export const isShare = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
