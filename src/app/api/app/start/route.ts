import { answer, refuse } from "@/lib/app-door/gate";
import { comesTheAppsWay } from "@/lib/app-door/rules";
import { startFor } from "@/lib/app-door/start";
import { switches } from "@/lib/safety/switches";
import { signedInFrom } from "@/lib/session";

/**
 * The phone app's first question, on opening and whenever it comes back to the front: must this
 * copy update, what is switched on, and who is logged in (plans/45-phone-apps/01-the-door.md).
 *
 * For anyone, logged in or not. A copy that is too old is not refused here, as it is everywhere
 * else: this is the one address that must still answer it, to say "please update".
 * Reading only: it changes nothing, and does not extend the login.
 */
export async function GET(request: Request) {
  const client = comesTheAppsWay(request.headers);
  if (!client) return refuse("not_the_app");
  const found = await signedInFrom(request.headers, { renew: false });
  // Someone whose email is not confirmed has no login at all, and a closed account has none left;
  // should either ever show up here, it is answered as nobody.
  const person = found && !found.closed && found.emailVerified ? found : null;
  return answer(await startFor(client, person, await switches()));
}
