import { unsubscribeWithToken } from "@/lib/notifications/unsubscribe";

/** One-click unsubscribe, as mail programs send it (a POST with the token in the address). */
export async function POST(request: Request) {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const ok = await unsubscribeWithToken(token);
  return new Response(ok ? "Reminder emails are switched off." : "Unknown link.", { status: ok ? 200 : 404 });
}
