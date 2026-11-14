import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { answerExtension, ExtendError } from "@/lib/extend/extend";
import { getUser } from "@/lib/session";

/** The host accepts or declines a request for more time, from inside the call. The body is { extensionId, accept }. */
export async function POST(request: Request, ctx: RouteContext<"/api/calls/[id]/extend/answer">) {
  const user = await getUser();
  if (!user) return Response.json({ error: "Please log in." }, { status: 401 });
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => null)) as { extensionId?: unknown; accept?: unknown } | null;
  const extensionId = String(body?.extensionId ?? "");
  const uuid = /^[0-9a-f-]{36}$/i;
  if (!uuid.test(id) || !uuid.test(extensionId) || typeof body?.accept !== "boolean") return Response.json({ error: "Request not found." }, { status: 404 });
  // The request must belong to the call in the address.
  const [found] = await db.select({ callId: schema.callExtensions.callId }).from(schema.callExtensions).where(eq(schema.callExtensions.id, extensionId));
  if (!found || found.callId !== id) return Response.json({ error: "Request not found." }, { status: 404 });
  try {
    // Only the call's host can answer; anyone else gets "Request not found".
    return Response.json({ answer: await answerExtension({ extensionId, hostId: user.id, accept: body.accept }) });
  } catch (error) {
    if (error instanceof ExtendError) return Response.json({ error: error.message }, { status: error.message === "Request not found." ? 404 : 409 });
    console.error(`[more time] answering failed for request ${extensionId}`, error);
    return Response.json({ error: "Something went wrong. Nothing was changed. Please try again." }, { status: 500 });
  }
}
