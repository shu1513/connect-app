import { answer, appRequest } from "@/lib/app-door/gate";
import { startFor } from "@/lib/app-door/start";

/**
 * The phone app's first question, on opening and whenever it comes back to the front: must this
 * copy update, what is switched on, and who is logged in (plans/45-phone-apps/01-the-door.md).
 *
 * For anyone, logged in or not. It goes through the same gate as every other address for the app,
 * with one difference: a copy that is too old is told so here instead of being refused.
 * Reading only: it changes nothing of Connect's own, and does not extend the login.
 */
export async function GET(request: Request) {
  const asked = await appRequest(request, "anyone", { opening: true });
  if (asked instanceof Response) return asked;
  return answer(await startFor(asked));
}
