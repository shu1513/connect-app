import { endNowResponse } from "@/lib/call-page/end-now";

/**
 * The address the call's red button had while it was "End call and report". It does exactly what
 * "End call now" does (/api/calls/[id]/end-now), so a call page that was open when the app was
 * updated still has a button that ends the call. What the press costs comes from the booking's
 * own words, not from this address: such a page belongs to a booking made under the earlier
 * words, which is charged by the host's time, and nobody can pay less by sending a press here.
 */
export async function POST(_request: Request, ctx: RouteContext<"/api/calls/[id]/end-for-safety">) {
  return endNowResponse((await ctx.params).id);
}
