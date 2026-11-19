import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DiaryPicture } from "@/components/diary-picture";
import { LocalTime } from "@/components/local-time";
import { SitePage } from "@/components/site-page";
import { readNotice } from "@/lib/notice";
import { picturesOf } from "@/lib/projects/pictures";
import { postForHost } from "@/lib/projects/posts";
import { linksOf, PICTURE, PROJECT } from "@/lib/projects/rules";
import { projectsOnFor } from "@/lib/safety/switches";
import { requireUser } from "@/lib/session";
import { changePostAction, removePictureAction, removePostAction } from "../../actions";
import { PostForm } from "../../post-form";

export const metadata: Metadata = { title: "Your post" };

/** One post of the host's diary, to change or remove, and its pictures. Someone else's post, a removed one and one that does not exist are all "not found". */
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
  const pictures = (await picturesOf([post.id], { forHost: true })).get(post.id) ?? [];
  // A picture that was not accepted is not one of the post's four.
  const counted = pictures.filter((picture) => picture.state !== "refused").length;

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
        linkMax={PROJECT.linkMax}
      />

      <section className="mt-8 border-t border-neutral-400/40 pt-4" data-pictures>
        <h2 className="text-lg font-semibold">Pictures</h2>
        <p className="mt-1 text-sm opacity-70">
          Up to {PICTURE.perPost} in a post. Connect makes its own copy of your picture and checks it automatically before anyone else can see it. The copy is
          usually sent to an outside checking service for that.
        </p>
        {pictures.length > 0 && (
          <ul className="mt-3 space-y-3">
            {pictures.map((picture) => (
              <li key={picture.id} className="rounded border border-neutral-400 p-3 text-sm" data-picture={picture.state}>
                {picture.state === "refused" ? (
                  <>
                    <p className="text-amber-700">This picture was not accepted. A diary may not show nudity, violence or self-harm. Nobody can see it.</p>
                    {picture.checkDetail && <p className="mt-1 opacity-70">What the automatic check said: {picture.checkDetail}</p>}
                  </>
                ) : picture.held ? (
                  <p className="text-amber-700">Connect is looking at this picture. Nobody can see it for now.</p>
                ) : (
                  <>
                    <DiaryPicture id={picture.id} width={picture.width} height={picture.height} small />
                    <p className="mt-2">{picture.state === "shown" ? "Shown in your diary." : "Being checked. This usually takes a few seconds; reload the page to see when it is done. Only you can see it until then."}</p>
                  </>
                )}
                <form action={removePictureAction} className="mt-2">
                  <input type="hidden" name="postId" value={post.id} />
                  <input type="hidden" name="pictureId" value={picture.id} />
                  <button type="submit" className="underline underline-offset-2">
                    {picture.state === "refused" ? "Clear this away" : "Remove this picture"}
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
        {fixed ? (
          <p className="mt-3 text-sm opacity-70">No pictures can be added to this post.</p>
        ) : counted >= PICTURE.perPost ? (
          <p className="mt-3 text-sm opacity-70">This post has its {PICTURE.perPost} pictures. Remove one to add another.</p>
        ) : (
          // A plain form to an address of its own: a picture does not fit into the app's ordinary forms.
          <form method="post" action={`/host/project/posts/${post.id}/pictures`} encType="multipart/form-data" className="mt-3 text-sm">
            <label className="block">
              Add a picture (JPEG, PNG or WebP, up to 10 MB)
              <input name="picture" type="file" accept="image/jpeg,image/png,image/webp" required className="mt-1 block w-full" />
            </label>
            <button type="submit" className="mt-2 rounded border border-neutral-500 px-3 py-1.5">
              Add this picture
            </button>
          </form>
        )}
      </section>

      <form action={removePostAction} className="mt-8 border-t border-neutral-400/40 pt-4 text-sm">
        <input type="hidden" name="postId" value={post.id} />
        <button type="submit" className="underline underline-offset-2">
          Remove this post
        </button>
        <span className="ml-2 opacity-70">It disappears from the diary with its pictures and cannot be brought back. If it was reported, Connect keeps what it said.</span>
      </form>
    </SitePage>
  );
}
