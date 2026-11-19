/**
 * OpenAI's checking service, the first in the queue. Free; it looks at a picture for sexual
 * content, violence, graphic violence and self-harm. (Its other checks are for text only: for a
 * picture it answers zero there, which is never read as "clean" for them.)
 */
import { createHash } from "node:crypto";
import { ANSWER_WITHIN_MS, askService, isShare, type Answer, type Checker } from "./types";

/** Everything it must have looked at, in the picture, for its answer to count as a full check. */
const NEEDED = ["sexual", "violence", "violence/graphic", "self-harm", "self-harm/intent", "self-harm/instructions"] as const;

/** Its answer, read strictly. Exported for the tests. */
export function readOpenAi(body: unknown): Answer {
  const result = (body as { results?: Array<{ categories?: Record<string, unknown>; category_scores?: Record<string, unknown>; category_applied_input_types?: Record<string, unknown> }> }).results?.[0];
  if (!result || typeof result !== "object") return { kind: "fault", detail: "no result in the answer" };
  const { categories, category_scores: scores, category_applied_input_types: applied } = result;
  const found = NEEDED.filter((name) => categories?.[name] === true);
  const missing = NEEDED.find((name) => {
    const looked = applied?.[name];
    return typeof categories?.[name] !== "boolean" || !isShare(scores?.[name]) || !Array.isArray(looked) || !looked.includes("image");
  });
  if (found.length > 0) return { kind: "flagged", detail: `OpenAI flagged: ${found.join(", ")}`, partial: missing !== undefined };
  if (missing) return { kind: "fault", detail: `the answer does not show that "${missing}" was checked in the picture` };
  return { kind: "clean", detail: `OpenAI looked at the picture for: ${NEEDED.join(", ")}` };
}

export function openAiChecker(key = process.env.OPENAI_API_KEY): Checker {
  return {
    name: "openai",
    keyMark: key ? createHash("sha256").update(key).digest("hex").slice(0, 16) : null,
    check: (jpeg) =>
      askService(
        () =>
          fetch("https://api.openai.com/v1/moderations", {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
            body: JSON.stringify({ model: "omni-moderation-latest", input: [{ type: "image_url", image_url: { url: `data:image/jpeg;base64,${jpeg.toString("base64")}` } }] }),
            signal: AbortSignal.timeout(ANSWER_WITHIN_MS),
          }),
        readOpenAi,
      ),
  };
}
