import { answer, appRequest } from "@/lib/app-door/gate";
import { identityFor } from "@/lib/app-door/identity";

/**
 * Where the signed-in person's identity check stands, for the phone app
 * (plans/45-phone-apps/06-asking-for-a-call.md, decision 6). The server asks Stripe, and Stripe
 * names the person each check was made for; what happened in the phone's browser sheet is never
 * part of the answer.
 */
export async function GET(request: Request) {
  const asked = await appRequest(request, "member");
  if (asked instanceof Response) return asked;
  return answer(await identityFor(asked.person!));
}
