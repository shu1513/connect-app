import { endNowResponse } from "@/lib/call-page/end-now";

/** "End call now", pressed inside the call by either person. */
export async function POST(_request: Request, ctx: RouteContext<"/api/calls/[id]/end-now">) {
  return endNowResponse((await ctx.params).id, true);
}
