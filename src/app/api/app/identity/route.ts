import { answer, appRequest, refuse } from "@/lib/app-door/gate";
import { identityFor } from "@/lib/app-door/identity";

/**
 * Where the signed-in person's identity check stands, for the phone app
 * (plans/45-phone-apps/06-asking-for-a-call.md, decision 6). The server asks Stripe, and Stripe
 * names the person each check was made for; what happened in the phone's browser sheet is never
 * part of the answer. A paused account is told that it is paused, as on the website: also when it
 * is this very question that read an "under 18" result, which pauses the account.
 */
export async function GET(request: Request) {
  const asked = await appRequest(request, "member");
  if (asked instanceof Response) return asked;
  const stands = await identityFor(asked.person!);
  return stands ? answer(stands) : refuse("paused");
}
