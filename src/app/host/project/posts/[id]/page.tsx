import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LocalTime } from "@/components/local-time";
import { SitePage } from "@/components/site-page";
import { readNotice } from "@/lib/notice";
import { postForHost } from "@/lib/projects/posts";
import { linksOf, PROJECT } from "@/lib/projects/rules";
import { projectsOnFor } from "@/lib/safety/switches";
import { requireUser } from "@/lib/session";
import { changePostAction, removePostAction } from "../../actions";
import { PostForm } from "../../post-form";

export const metadata: Metadata = { title: "Your post" };

/** One post of the host's diary, to change or remove. Someone else's post, a removed one and one that does not exist are all "not found". */
export default async function HostPostPage(props: PageProps<"/host/project/posts/[id]">) {
  const { id } = await props.params;
  const user = await requireUser(`/host/project/posts/${id}`);
  const found = await postForHost(user.id, id);
  if (!found) notFound();
  const { post, project } = found;
  const notice = readNotice(`/host/project/posts/${post.id}`, await props.searchParams);
  const links = linksOf(post.links);
  // Why this post cannot be changed right now, if it cannot. Removing is always possible.
  const fixed = post.hiddenAt
    ? "This post was hidden by Connect, so it cannot be changed. You can remove it."
    : project.status !== "running"
      ? "This project has ended, so its posts can no longer be changed. You can remove this one."
      : !(await projectsOnFor(user.id))
        ? "Projects are not open at the moment, so posts cannot be changed. You can remove this one."
        : null;

  return (
    <SitePage className="mx-auto w-full max-w-2xl px-4 py-10">
      <p className="text-sm">
        <Link href="/host/project" className="inline-flex min-h-11 items-center underline underline-offset-2">
          ← Your project
        </Link>
      </p>
      <h1 className="mt-2 text-2xl font-semibold">Your post</h1>
      <p className="mt-1 text-sm opacity-70">
        In &ldquo;{project.name}&rdquo;, written <LocalTime iso={post.createdAt.toISOString()} />.
      </p>

      {notice && (
        <p role="status" className="mt-4 rounded border border-neutral-400 p-3 text-sm">
          {notice}
        </p>
      )}

      {/* Always drawn, in the same place: see `closed` in post-form.tsx. */}
      <PostForm
        action={changePostAction}
        hidden={{ name: "postId", value: post.id }}
        text={post.text}
        links={links}
        button="Save the post"
        closed={fixed ? `${fixed}${post.hiddenAt && post.hiddenNote ? ` "${post.hiddenNote}"` : ""}` : null}
        rows={10}
        textMax={PROJECT.postTextMax}
        linksMax={PROJECT.linksMax}
      />

      <form action={removePostAction} className="mt-8 border-t border-neutral-400/40 pt-4 text-sm">
        <input type="hidden" name="postId" value={post.id} />
        <button type="submit" className="underline underline-offset-2">
          Remove this post
        </button>
        <span className="ml-2 opacity-70">It disappears from the diary and cannot be brought back. If it was reported, Connect keeps what it said.</span>
      </form>
    </SitePage>
  );
}
