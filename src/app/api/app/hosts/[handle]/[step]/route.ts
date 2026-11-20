import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { answer, appRequest, refuse } from "@/lib/app-door/gate";
import type { AppFollowDone } from "@/lib/app-door/types";
import { saveChoices } from "@/lib/follows/emails";
import { follow, FollowError, unfollow } from "@/lib/follows/follows";
import { handleProblem, tidyHandle } from "@/lib/profiles/handles";

const WRONG = "Something went wrong. Nothing was changed. Please try again.";

/** The host a handle belongs to, whatever the state of her page: only ever used to end or adjust the asker's own following. */
async function hostOf(typed: string): Promise<string | null> {
  const handle = tidyHandle(typed);
  if (handleProblem(handle)) return null;
  const [found] = await db.select({ userId: schema.hostProfiles.userId }).from(schema.hostProfiles).where(eq(schema.hostProfiles.handle, handle));
  return found?.userId ?? null;
}

/**
 * Following a host, from the phone app (plans/45-phone-apps/05-search-and-a-hosts-page.md,
 * decision 4), on the very functions the website's buttons use:
 *
 *   POST /api/app/hosts/[handle]/follow     follow her (not for a paused person)
 *   POST /api/app/hosts/[handle]/unfollow   stop following, or say "don't follow" before there is a following
 *   POST /api/app/hosts/[handle]/choices    { tellOnline?: boolean, hours?: { from, to } | null }
 *                                           the email about "available now", and its hours (minutes of the day)
 *
 * Who follows comes from the sign-in, never from what is sent. **The choice about emails for new
 * diary posts is not among these, and is never touched from here:** the function underneath
 * changes only what it is handed, so the choice a person made on the website stays as it was.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/app/hosts/[handle]/[step]">) {
  const { handle, step } = await ctx.params;
  if (step !== "follow" && step !== "unfollow" && step !== "choices") {
    const anyone = await appRequest(request, "anyone");
    return anyone instanceof Response ? anyone : refuse("not_found");
  }
  // Following is for someone who may act; ending it, and switching emails off, also for a paused person (as on the website).
  const asked = await appRequest(request, step === "follow" ? "active" : "member");
  if (asked instanceof Response) return asked;
  const me = asked.person!;
  const now = new Date();

  if (step === "follow") {
    try {
      const host = await follow({ followerId: me.id, handle, now });
      const body: AppFollowDone = { words: `You follow ${host.displayName}. When they are available now, you see it on your home page.`, follow: "following" };
      return answer(body);
    } catch (error) {
      if (!(error instanceof FollowError)) console.error("[follows] could not follow", error);
      return refuse("not_valid", error instanceof FollowError ? error.message : WRONG);
    }
  }

  const hostId = await hostOf(handle);
  if (step === "unfollow") {
    try {
      // With no such host this is quietly nothing, and answered the same: nothing is given away about a handle.
      if (hostId) await unfollow({ followerId: me.id, hostId, now });
    } catch (error) {
      console.error("[follows] could not unfollow", error);
      return refuse("not_valid", WRONG);
    }
    // The very same answer whether or not there is such a host, and whatever the state of her page: the app
    // names hosts by their page's name, and an answer that differed would tell which names exist, hidden ones too.
    const body: AppFollowDone = { words: "Done. You do not follow them, and a call will not change that. You can follow them again from their page.", follow: "ended" };
    return answer(body);
  }

  // The choices.
  const sent: unknown = await request.json().catch(() => null);
  const given = (sent !== null && typeof sent === "object" ? sent : {}) as { tellOnline?: unknown; hours?: unknown };
  if (given.tellOnline !== undefined && typeof given.tellOnline !== "boolean") return refuse("not_valid");
  let hours: { from: number; to: number } | null | undefined;
  if (given.hours === undefined) hours = undefined;
  else if (given.hours === null) hours = null;
  else {
    const { from, to } = given.hours as { from?: unknown; to?: unknown };
    const whole = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0 && n < 1440 && n % 60 === 0;
    // Two different full hours, as the website's form allows.
    if (!whole(from) || !whole(to) || from === to) return refuse("not_valid", 'Choose both hours, and two different ones, or leave both on "any time". Nothing was changed.');
    hours = { from, to };
  }
  if (given.tellOnline === undefined && hours === undefined) return refuse("not_valid");
  try {
    // A name that is no host's is handed on as a host nobody can follow, so that it is answered by the very same
    // steps, in the same order and with the same sentences, as a host this person does not follow.
    // Only what was sent is handed on. The diary choice is never among it.
    await saveChoices({ followerId: me.id, hostId: hostId ?? "no-such-host", ...(given.tellOnline === undefined ? {} : { tellOnline: given.tellOnline }), ...(hours === undefined ? {} : { hours }), now });
  } catch (error) {
    if (!(error instanceof FollowError)) console.error("[follows] could not save the choice of emails", error);
    return refuse("not_valid", error instanceof FollowError ? error.message : WRONG);
  }
  return answer({ words: "Your choice of emails was saved." });
}
