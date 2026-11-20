import { answer, appRequest, refuse } from "@/lib/app-door/gate";
import { bookingPageFor } from "@/lib/app-door/booking";

/**
 * One request for a call, for the customer who made it
 * (plans/45-phone-apps/06-asking-for-a-call.md). Reading it changes nothing: the app asks this
 * address again while the request waits for its answer. A request that does not exist and one
 * that is somebody else's are the same "not found".
 */
export async function GET(request: Request, ctx: RouteContext<"/api/app/bookings/[id]">) {
  const asked = await appRequest(request, "member");
  if (asked instanceof Response) return asked;
  const { id } = await ctx.params;
  const page = await bookingPageFor(asked.person!, id, new Date());
  return page ? answer(page) : refuse("not_found");
}
