/**
 * Where a call stands, from our own record (no call to Stripe): its end (which moves when time is
 * added), whether it was cancelled or stopped, and a request for more time. One reading for the
 * website's address (/api/calls/[id]/live) and the phone app's.
 */
import "server-only";
import { addTimeChoices, extensionView } from "@/lib/extend/extend";
import { askWindow, WATCH_SECONDS } from "@/lib/extend/rules";
import { callForParticipant } from "@/lib/payments/access";

export type CallLive = {
  paymentStatus: string | null;
  cancelled: boolean;
  safetyEnded: boolean;
  endsAt: string;
  serverNow: string;
  extension: Awaited<ReturnType<typeof extensionView>>["open"];
  lastExtension: Awaited<ReturnType<typeof extensionView>>["last"];
  addTime: Awaited<ReturnType<typeof addTimeChoices>> | null;
};

/** Null for anyone who is not one of the call's two people, whether or not the call exists. */
export async function liveFor(userId: string, callId: string): Promise<CallLive | null> {
  if (!/^[0-9a-f-]{36}$/i.test(callId)) return null;
  const access = await callForParticipant(callId, userId);
  if (!access) return null;
  const { call, payment, role } = access;

  const now = new Date();
  // Requests for more time only exist near the end of a call, so they are only looked up then.
  const running = !call.cancelledAt && !call.safetyEndedAt && now >= call.startsAt;
  const nearEnd = running && call.endsAt.getTime() - now.getTime() <= (WATCH_SECONDS + 30) * 1000;
  const requests = nearEnd ? await extensionView(call.id) : { open: null, last: null };
  // The customer's choices are only sent while this server's clock says asking is open, so the
  // buttons never show on a screen whose own clock runs a little ahead or behind.
  const addTime = nearEnd && role === "customer" && askWindow({ now, endsAt: call.endsAt }) === "open" ? await addTimeChoices(call) : null;

  return {
    paymentStatus: payment?.status ?? null,
    cancelled: call.cancelledAt !== null,
    safetyEnded: call.safetyEndedAt !== null,
    endsAt: call.endsAt.toISOString(),
    serverNow: new Date().toISOString(),
    extension: requests.open,
    lastExtension: requests.last,
    addTime,
  };
}
