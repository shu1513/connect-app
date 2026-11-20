import { stopFollowEmailsWithToken } from "@/lib/follows/emails";
import { readStops, unsubscribeWithToken } from "@/lib/notifications/unsubscribe";

/**
 * One-click unsubscribe, as mail programs send it (a POST with the token in the address). The
 * address also says which emails it stops: reminders, or with `what=follows` the emails about
 * hosts the person follows. Each stops only its own kind.
 */
export async function POST(request: Request) {
  const params = new URL(request.url).searchParams;
  const token = params.get("token") ?? "";
  const follows = readStops(params.get("what")) === "follows";
  const ok = follows ? await stopFollowEmailsWithToken(token) : await unsubscribeWithToken(token);
  return new Response(ok ? (follows ? "Emails about hosts you follow are switched off." : "Reminder emails are switched off.") : "Unknown link.", { status: ok ? 200 : 404 });
}
