import { endNowResponse } from "@/lib/call-page/end-now";

/**
 * The address the call's red button had while it was "End call and report". It does what
 * "End call now" does (/api/calls/[id]/end-now): a call page that was open when the app was
 * updated still has a button that ends the call.
 */
export async function POST(_request: Request, ctx: RouteContext<"/api/calls/[id]/end-for-safety">) {
  return endNowResponse((await ctx.params).id);
}
