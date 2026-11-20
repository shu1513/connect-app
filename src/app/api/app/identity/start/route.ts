import { answer, appRequest, refuse } from "@/lib/app-door/gate";
import { startIdentityFor } from "@/lib/app-door/identity";
import type { AppIdentityStart } from "@/lib/app-door/types";
import { IdentityError } from "@/lib/safety/identity";
import { IDENTITY_WORDS } from "@/lib/safety/identity-words";

/**
 * Starts an identity check for the signed-in person and answers with Stripe's own page for it,
 * which the app opens in the phone's browser sheet
 * (plans/45-phone-apps/06-asking-for-a-call.md, decision 6). The limit on tries is the website's.
 * When the check is over, Stripe sends the person to one fixed page of Connect's that anyone may
 * open; the result is only ever read by GET /api/app/identity. A paused account starts no check
 * (the website sends a paused person away from its page for the check as well).
 */
export async function POST(request: Request) {
  const asked = await appRequest(request, "active");
  if (asked instanceof Response) return asked;
  try {
    const body: AppIdentityStart = { url: await startIdentityFor(asked.person!) };
    return answer(body);
  } catch (error) {
    if (!(error instanceof IdentityError)) console.error("[identity] could not start a check for the app", error);
    return refuse("not_valid", error instanceof IdentityError ? error.message : IDENTITY_WORDS.notStarted);
  }
}
