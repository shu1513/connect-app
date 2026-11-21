import { answer, appRequest } from "@/lib/app-door/gate";
import { requestsFor } from "@/lib/app-door/requests";

/**
 * The requests waiting for the signed-in host's answer, for the phone app
 * (plans/45-phone-apps/07-a-hosts-requests.md). Whose list it is comes from the sign-in. Reading
 * it changes nothing: the app asks this address again while the list is in front.
 */
export async function GET(request: Request) {
  const asked = await appRequest(request, "member");
  if (asked instanceof Response) return asked;
  return answer(await requestsFor(asked.person!, new Date()));
}
