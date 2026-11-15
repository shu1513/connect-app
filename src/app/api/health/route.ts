import { healthProblems } from "@/lib/health";

const answer = (healthy: boolean) =>
  Response.json({ status: healthy ? "healthy" : "not healthy" }, { status: healthy ? 200 : 503, headers: { "cache-control": "no-store" } });

/**
 * For the outside watching service. Says "healthy" or "not healthy" and nothing
 * else: no amounts, names, numbers or error text. The reasons go to our own log.
 * No answer at all must be treated as "not healthy" by whoever asks.
 */
export async function GET() {
  try {
    const problems = await healthProblems(new Date());
    if (problems.length > 0) console.warn(`[health] not healthy: ${problems.join("; ")}`);
    return answer(problems.length === 0);
  } catch (error) {
    console.error("[health] the check itself failed", error);
    return answer(false);
  }
}
