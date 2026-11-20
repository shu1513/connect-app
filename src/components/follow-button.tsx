import Link from "next/link";
import { followAction, unfollowAction } from "@/app/following/actions";
import { warm } from "@/components/warm-ui";

/**
 * The Follow button, the same on every page that has it (plans/30, decision 3). `state` is the
 * viewer's own: "visitor" for someone who is not logged in. Whether to draw it at all (never on
 * one's own page, never for someone who has blocked this host) is the page's decision; it never
 * depends on whether the host has blocked the viewer.
 */
export function FollowButton(props: { state: "following" | "ended" | "none" | "visitor"; hostId: string; handle: string; name: string; back: string }) {
  if (props.state === "visitor") {
    return (
      <Link href={`/login?next=${encodeURIComponent(props.back)}`} className={warm.secondary}>
        Log in to follow
      </Link>
    );
  }
  if (props.state === "following") {
    return (
      <form action={unfollowAction} className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <input type="hidden" name="hostId" value={props.hostId} />
        <input type="hidden" name="back" value={props.back} />
        <span className="font-semibold">Following</span>
        <button type="submit" className="inline-flex min-h-11 items-center underline underline-offset-2 opacity-70" title={`Stop following ${props.name}`}>
          Unfollow
        </button>
      </form>
    );
  }
  return (
    <form action={followAction}>
      <input type="hidden" name="handle" value={props.handle} />
      <input type="hidden" name="back" value={props.back} />
      <button type="submit" className={warm.secondary} title={`See on your home page when ${props.name} is available now`}>
        Follow
      </button>
    </form>
  );
}
