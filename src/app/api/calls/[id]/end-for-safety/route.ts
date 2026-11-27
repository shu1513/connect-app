import { endNowResponse } from "@/lib/call-page/end-now";

/**
 * The address the call's red button had while it was "End call and report". It ends the call as
 * "End call now" does (/api/calls/[id]/end-now), so a call page that was open when the app was
 * updated still has a button that ends the call. That page asked the old question, which said
 * nothing about paying for the whole booking: a customer who presses here is charged by the
 * host's time, as he was told.
 */
export async function POST(_request: Request, ctx: RouteContext<"/api/calls/[id]/end-for-safety">) {
  return endNowResponse((await ctx.params).id, false);
}
