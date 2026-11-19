/**
 * Microsoft's checking service (Azure AI Content Safety), the second in the queue. Its free level
 * takes 5,000 pictures a month and stops there. It is asked for sexual content, violence and
 * self-harm, each answered with a level of 0, 2, 4 or 6.
 */
import { createHash } from "node:crypto";
import { ANSWER_WITHIN_MS, askService, type Answer, type Checker } from "./types";

/**
 * From which level each is flagged. Sexual from 2, because the site's rule is "no nudity" and 2
 * is where Microsoft puts mild and artistic nudity. Violence and self-harm from 4.
 */
const FLAG_FROM = { Sexual: 2, Violence: 4, SelfHarm: 4 } as const;
const NEEDED = Object.keys(FLAG_FROM) as Array<keyof typeof FLAG_FROM>;
const LEVELS = [0, 2, 4, 6];

/** Its answer, read strictly: each of the three by its name, never by its place in the list. Exported for the tests. */
export function readAzure(body: unknown): Answer {
  const list = (body as { categoriesAnalysis?: Array<{ category?: unknown; severity?: unknown }> }).categoriesAnalysis;
  if (!Array.isArray(list)) return { kind: "fault", detail: "no analysis in the answer" };
  const levelOf = (name: string) => list.find((entry) => entry?.category === name)?.severity;
  const found = NEEDED.filter((name) => {
    const level = levelOf(name);
    return typeof level === "number" && LEVELS.includes(level) && level >= FLAG_FROM[name];
  });
  if (found.length > 0) return { kind: "flagged", detail: `Microsoft flagged: ${found.map((name) => `${name} at level ${levelOf(name)}`).join(", ")}` };
  for (const name of NEEDED) {
    const level = levelOf(name);
    if (typeof level !== "number" || !LEVELS.includes(level)) return { kind: "fault", detail: `the answer has no valid level for "${name}"` };
  }
  return { kind: "clean", detail: `Microsoft looked at the picture for: ${NEEDED.join(", ")}` };
}

/**
 * Microsoft's own words for "not now", whatever the HTTP code. A free level that is used up for
 * the month is, on Microsoft's other services of this family, answered with 403 and the word
 * "quota"; its guide for this one does not say, so this is confirmed in the real try. Exported for the tests.
 */
export function azureRefusal(status: number, body: unknown): Answer | null {
  const error = (body as { error?: { code?: unknown; message?: unknown } } | null)?.error;
  const code = String(error?.code ?? "");
  const message = String(error?.message ?? "");
  const detail = `HTTP ${status}: ${code} ${message}`.slice(0, 220);
  if (["TooManyRequests", "ServerBusy", "InternalError"].includes(code)) return { kind: "out", detail };
  if (status === 403 && /quota/i.test(message)) return { kind: "out", detail };
  return null;
}

export function azureChecker(endpoint = process.env.AZURE_CONTENT_SAFETY_ENDPOINT, key = process.env.AZURE_CONTENT_SAFETY_KEY): Checker {
  // Only a plain https address is ever asked. Anything else in the setting means "not set up".
  let base: string | null = null;
  try {
    const url = endpoint ? new URL(endpoint) : null;
    if (url && url.protocol === "https:") base = url.origin;
  } catch {
    base = null;
  }
  return {
    name: "azure",
    keyMark: base && key ? createHash("sha256").update(`${base}\n${key}`).digest("hex").slice(0, 16) : null,
    check: (jpeg) =>
      askService(
        () =>
          fetch(`${base}/contentsafety/image:analyze?api-version=2024-09-01`, {
            method: "POST",
            headers: { "content-type": "application/json", "Ocp-Apim-Subscription-Key": key ?? "" },
            body: JSON.stringify({ image: { content: jpeg.toString("base64") }, categories: NEEDED, outputType: "FourSeverityLevels" }),
            signal: AbortSignal.timeout(ANSWER_WITHIN_MS),
          }),
        readAzure,
        azureRefusal,
      ),
  };
}
