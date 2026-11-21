/**
 * The one gate every address for the phone app goes through (plans/45-phone-apps/01-the-door.md).
 *
 * In this order: the request must come in the app's way; the copy of the app must not be too
 * old; and the person must be someone this address is for. Who may ask is decided per address,
 * as its page on the website decides it, from the same reading of who is logged in that the
 * website's pages use.
 *
 * The sign-in is read from the app's own header and from nowhere else: a browser's cookie is
 * never looked at here (see SIGN_IN_HEADER).
 */
import "server-only";
import { switches, type Switches } from "@/lib/safety/switches";
import { signedInFrom, type SignedIn } from "@/lib/session";
import { comesTheAppsWay, isTooOld, signInFrom, whyNot, type AppClient, type Who } from "./rules";
import type { Refusal, RefusalCode } from "./types";

/** The sentence that goes with each refusal of the gate, in the website's words. */
const SENTENCES: Record<RefusalCode, string> = {
  not_the_app: "This address is for the Connect app.",
  update_needed: "This version of the Connect app is too old. Please update the app to carry on.",
  not_signed_in: "Please log in.",
  confirm_email: "Please confirm your email address first. Open the link in the email we sent you.",
  welcome_needed: "Please confirm that you are 18 or older and accept the terms first.",
  paused: "Your account is paused.",
  switched_off: "This is not available in the app right now.",
  not_found: "Not found.",
  not_valid: "That could not be used. Please try again.",
};

const STATUS: Record<RefusalCode, number> = {
  not_the_app: 403,
  update_needed: 426,
  not_signed_in: 401,
  confirm_email: 403,
  welcome_needed: 403,
  paused: 403,
  switched_off: 403,
  not_found: 404,
  not_valid: 400,
};

/**
 * Nothing the door answers may be kept by anything between the phone and the server: an answer
 * is about one person at one moment.
 */
const NOT_KEPT = { "cache-control": "private, no-store" };

/** A refusal the app can read: a fixed code, and the sentence to show. */
export function refuse(code: RefusalCode, message?: string): Response {
  const body: Refusal = { error: { code, message: message ?? SENTENCES[code] } };
  return Response.json(body, { status: STATUS[code], headers: NOT_KEPT });
}

/** An answer of the door. */
export function answer<T>(data: T, status = 200): Response {
  return Response.json(data, { status, headers: NOT_KEPT });
}

export type AppRequest = {
  /** What the app says about itself. Only its word: never used to decide what somebody may do. */
  client: AppClient;
  /** Who is logged in; null only at an address for anyone. A closed account counts as nobody. */
  person: SignedIn | null;
  /** The founder's switches, as read for this request, so an address does not read them twice. */
  switches: Switches;
  /** Whether this copy is older than the oldest allowed. Only ever true at the opening address, which says so instead of refusing. */
  updateNeeded: boolean;
};

/**
 * The gate. Gives back who is asking, or the refusal to send. An address calls it first:
 *
 *   const asked = await appRequest(request, "member");
 *   if (asked instanceof Response) return asked;
 *
 * `safety` is for the one step that must work from any copy of the app, also one the founder has
 * since declared too old: "End call and report", pressed by someone who is in a call. A person is
 * never left unable to end a call because the oldest allowed version was raised while it ran.
 * Everything else about that step is checked as always (the sign-in, whose call it is).
 *
 * `opening` is for the one address the app asks when it opens: a copy that is too old is not
 * refused there, since that address is the one that must still answer it, to say "please update".
 *
 * It reads the login without extending it (only the phone's own request to the login tool does
 * that, or the renewed login would never reach the phone) and changes nothing of Connect's own. A
 * login that has run out is still tidied away by the login tool as it is read.
 */
export async function appRequest(request: Request, who: Who, options: { opening?: boolean; safety?: boolean } = {}): Promise<AppRequest | Response> {
  const client = comesTheAppsWay(request.headers);
  if (!client) return refuse("not_the_app");

  const all = await switches();
  const updateNeeded = isTooOld(client.version, all.appOldestVersion);
  if (updateNeeded && !options.opening && !options.safety) return refuse("update_needed");

  // The sign-in the app handed over, and only that: whatever cookie came along is not read.
  const signIn = signInFrom(request.headers);
  const found = signIn ? await signedInFrom(new Headers({ cookie: signIn }), { renew: false }) : null;
  // A closed account has no login left; should one ever turn up it is nobody. So is a login whose
  // email address is not confirmed, at an address for anyone.
  const person = found && !found.closed && (who !== "anyone" || found.emailVerified) ? found : null;
  const refusal = whyNot(who, person);
  if (refusal) return refuse(refusal);
  return { client, person, switches: all, updateNeeded };
}
