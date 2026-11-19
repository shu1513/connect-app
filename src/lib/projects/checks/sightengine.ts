/**
 * Sightengine, the third in the queue. Its free plan counts each kind of check, so these four
 * models cost two counts a picture: about 1,000 pictures a month and 250 a day, and then it stops.
 */
import { createHash } from "node:crypto";
import { ANSWER_WITHIN_MS, askService, isShare, type Answer, type Checker } from "./types";

/** The models asked for in one request. Nudity in three strengths, gore, violence, self-harm. */
const MODELS = "nudity-2.1,gore-2.0,violence,self-harm";
const FLAG_ABOVE = 0.5;

/**
 * Its own words for a request it did not do. It answers most of them with HTTP 400, so the code
 * says little: its error type and number are read instead. "Out" is a limit reached (30), the free
 * plan's day used up (32), too many at once (33), and trouble on its side. Everything else, a
 * refused key or an unpaid bill among it, is a fault. Exported for the tests.
 */
export function sightengineRefusal(status: number, body: unknown): Answer | null {
  const error = (body as { error?: { type?: unknown; code?: unknown; message?: unknown } } | null)?.error;
  if (!error || typeof error.type !== "string") return null;
  const detail = `${error.type} ${String(error.code ?? "")} ${String(error.message ?? "")}`.trim().slice(0, 220);
  const out = (error.type === "usage_limit" && [30, 32, 33].includes(Number(error.code))) || error.type === "server_error" || error.type === "api_error";
  return { kind: out ? "out" : "fault", detail };
}

/** Its answer, read strictly. Exported for the tests. */
export function readSightengine(body: unknown): Answer {
  const answer = body as { status?: unknown; nudity?: Record<string, unknown>; gore?: { prob?: unknown }; violence?: { prob?: unknown }; "self-harm"?: { prob?: unknown } };
  // A refusal can also come with HTTP 200.
  if (answer.status !== "success") return sightengineRefusal(200, body) ?? { kind: "fault", detail: "the service did not say success" };
  const scores: Record<string, unknown> = {
    "sexual activity": answer.nudity?.sexual_activity,
    "sexual display": answer.nudity?.sexual_display,
    erotica: answer.nudity?.erotica,
    gore: answer.gore?.prob,
    violence: answer.violence?.prob,
    "self-harm": answer["self-harm"]?.prob,
  };
  const found = Object.entries(scores).filter(([, score]) => isShare(score) && score > FLAG_ABOVE);
  if (found.length > 0) return { kind: "flagged", detail: `Sightengine flagged: ${found.map(([name, score]) => `${name} ${Number(score).toFixed(2)}`).join(", ")}` };
  const missing = Object.entries(scores).find(([, score]) => !isShare(score));
  if (missing) return { kind: "fault", detail: `the answer has no valid number for "${missing[0]}"` };
  return { kind: "clean", detail: `Sightengine looked at the picture for: ${Object.keys(scores).join(", ")}` };
}

export function sightengineChecker(user = process.env.SIGHTENGINE_USER, secret = process.env.SIGHTENGINE_SECRET): Checker {
  return {
    name: "sightengine",
    keyMark: user && secret ? createHash("sha256").update(`${user}\n${secret}`).digest("hex").slice(0, 16) : null,
    check: (jpeg) =>
      askService(() => {
        const form = new FormData();
        form.set("media", new Blob([new Uint8Array(jpeg)], { type: "image/jpeg" }), "picture.jpg");
        form.set("models", MODELS);
        form.set("api_user", user ?? "");
        form.set("api_secret", secret ?? "");
        return fetch("https://api.sightengine.com/1.0/check.json", { method: "POST", body: form, signal: AbortSignal.timeout(ANSWER_WITHIN_MS) });
      }, readSightengine, sightengineRefusal),
  };
}
