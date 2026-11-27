/**
 * The website's "End call now" step, for its address and for the address the button had before
 * (plans/50-end-call-now.md, decision 23): a page that was open when the app was updated still
 * presses a button that ends the call.
 */
import "server-only";
import { callForParticipant } from "@/lib/payments/access";
import { endCallNow } from "@/lib/safety/calls";
import { getUser } from "@/lib/session";

/**
 * What the press costs a customer comes from his booking's own words (src/lib/safety/calls.ts),
 * never from which of the two addresses the press arrived at.
 */
export async function endNowResponse(callId: string): Promise<Response> {
  const user = await getUser();
  if (!user) return Response.json({ error: "Please log in." }, { status: 401 });
  const access = await callForParticipant(callId, user.id);
  if (!access) return Response.json({ error: "Call not found." }, { status: 404 });
  const outcome = await endCallNow({ call: access.call, by: user.id, now: new Date() });
  // A call that has not opened yet cannot be ended this way (it can be cancelled). One that is already
  // over needs no ending: the person goes on to the three choices as usual.
  if (outcome.state === "not_open_yet") return Response.json({ error: "This call has not started yet." }, { status: 409 });
  // Who really ended it, from what is written on the call: this person, the other one a moment earlier, or nobody
  // (it was over). `closed`: the video service has confirmed that both are out; until then the helper keeps trying.
  return Response.json({ ok: true, ended: outcome.state === "over" ? "over" : outcome.byMe ? "you" : "other", closed: outcome.closed });
}
