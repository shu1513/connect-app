import { answer, appRequest, refuse } from "@/lib/app-door/gate";
import type { AppEndedScreen } from "@/lib/app-door/types";
import { endedScreenFor } from "@/lib/call-page/ended";
import { BLOCK_WORDS } from "@/lib/safety/block-words";

/**
 * GET /api/app/calls/[id]/ended: the screen after "End call now" (plans/50-end-call-now.md,
 * decision 19), the same reading as the website's page /calls/[id]/ended: who ended the call, what
 * that means for the money, and the three choices with what each does.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/app/calls/[id]/ended">) {
  // Also for a paused person and for a copy of the app that has become too old meanwhile: it follows "End call now", which both can press.
  const asked = await appRequest(request, "member", { safety: true });
  if (asked instanceof Response) return asked;
  const { id } = await ctx.params;
  const screen = await endedScreenFor(asked.person!.id, id, new Date());
  // A call that is not this person's, and one that has not ended: there is no such screen.
  if (!screen || screen === "not_ended") return refuse("not_found");
  const body: AppEndedScreen = {
    title: screen.title,
    lines: screen.lines,
    what: screen.what,
    report: screen.report,
    block: { ...screen.block, sure: screen.block.what, yes: BLOCK_WORDS.yes, no: BLOCK_WORDS.no },
    neither: screen.neither,
  };
  return answer(body);
}
