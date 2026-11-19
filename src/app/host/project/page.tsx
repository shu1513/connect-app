import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import Link from "next/link";
import { LocalTime } from "@/components/local-time";
import { SitePage } from "@/components/site-page";
import { db, schema } from "@/db";
import type { ProjectPost } from "@/db/schema";
import { readNotice } from "@/lib/notice";
import { postsOf } from "@/lib/projects/posts";
import { projectsOf, startProblem } from "@/lib/projects/projects";
import { firstLines, PROJECT } from "@/lib/projects/rules";
import { publicProfile } from "@/lib/profiles/profiles";
import { projectsOnFor } from "@/lib/safety/switches";
import { requireUser } from "@/lib/session";
import { changeProjectAction, endProjectAction, removePostAction, startProjectAction, writePostAction } from "./actions";
import { PostForm } from "./post-form";

export const metadata: Metadata = { title: "Your project" };

const field = "mt-1 w-full rounded border border-neutral-400 bg-transparent px-3 py-2";
const smallButton = "rounded border border-neutral-500 px-3 py-1.5 text-sm";

/**
 * The host's own page for her project (plans/23, "How it works for a host"; plans/24): starting
 * one, its name and description, the diary's posts, and ending it. It reads only; every button
 * posts to an action, and the library decides again.
 *
 * Every form that changes the project carries the id of the project it was drawn for, so a form
 * left open in an old tab can never act on a project she started later.
 *
 * With `?project=<id>` it shows the posts of one of her earlier projects, to remove one: that is
 * the only thing left to do in a project that has ended.
 */
export default async function HostProjectPage(props: PageProps<"/host/project">) {
  const user = await requireUser("/host/project");
  const query = await props.searchParams;
  const notice = readNotice("/host/project", query);
  const page = typeof query.page === "string" && /^[1-9]\d{0,3}$/.test(query.page) ? Number(query.page) : 1;

  const all = await projectsOf(user.id);
  const running = all.find((project) => project.status === "running") ?? null;
  const past = all.filter((project) => project.status === "ended");
  // One of her own earlier projects, if the address names one. Anything else in the address is ignored.
  const earlier = typeof query.project === "string" ? (past.find((project) => project.id === query.project) ?? null) : null;
  const [profile] = await db.select({ handle: schema.hostProfiles.handle }).from(schema.hostProfiles).where(eq(schema.hostProfiles.userId, user.id));
  // Whether anyone else can read the diary is the same question as whether her page is open.
  const open = profile ? Boolean(await publicProfile(profile.handle)) : false;
  const switchOn = await projectsOnFor(user.id);
  const cannotStart = running ? null : await startProblem(user.id);
  const shown = earlier ?? running;
  const { posts, older } = shown ? await postsOf(shown.id, { page, forHost: true }) : { posts: [], older: false };
  const pageLink = (n: number) => {
    const parts = [...(earlier ? [`project=${earlier.id}`] : []), ...(n > 1 ? [`page=${n}`] : [])];
    return parts.length > 0 ? `/host/project?${parts.join("&")}` : "/host/project";
  };

  return (
    <SitePage className="mx-auto w-full max-w-2xl px-4 py-10">
      <p className="text-sm">
        <Link href={earlier ? "/host/project" : "/host"} className="inline-flex min-h-11 items-center underline underline-offset-2">
          {earlier ? "← Your project" : "← Hosting"}
        </Link>
      </p>
      <h1 className="mt-2 text-2xl font-semibold">Your project</h1>
      <p className="mt-2 text-sm opacity-70">
        A project is anything you are working on. You tell its story in a diary, and anyone can read it on your page. You can have one project at a time.
      </p>

      {notice && (
        <p role="status" className="mt-4 rounded border border-neutral-400 p-3 text-sm">
          {notice}
        </p>
      )}

      {earlier ? (
        <section className="mt-8" data-earlier>
          <h2 className="text-lg font-semibold">{earlier.name}</h2>
          <p className="mt-1 text-sm">
            This project has ended{earlier.endedAt ? <> (<LocalTime iso={earlier.endedAt.toISOString()} />)</> : null}. Its posts can no longer be changed. You can remove a post from its diary.
          </p>
          <PostList posts={posts} page={page} earlierId={earlier.id} canChange={false} />
          <Paging page={page} older={older} link={pageLink} />
        </section>
      ) : (
        <>
          {running && !switchOn && (
            <p className="mt-4 rounded border border-neutral-400 p-3 text-sm">
              Projects are not open at the moment. What you have written stays readable. You cannot write or change anything until they are open again; you can still remove a post and end your project.
            </p>
          )}

          {!running ? (
            <section className="mt-8" data-start>
              <h2 className="text-lg font-semibold">Start a project</h2>
              {cannotStart ? (
                <p className="mt-2 text-sm">{cannotStart}</p>
              ) : (
                <form action={startProjectAction} className="mt-3 max-w-md space-y-3">
                  <label className="block text-sm">
                    Name
                    <input name="name" type="text" required minLength={PROJECT.nameMin} maxLength={PROJECT.nameMax} className={field} />
                  </label>
                  <label className="block text-sm">
                    What it is about (up to {PROJECT.descriptionMax} characters)
                    <textarea name="description" rows={4} maxLength={PROJECT.descriptionMax} className={field} />
                  </label>
                  <button type="submit" className="rounded bg-blue-600 px-4 py-2 font-medium text-white">
                    Start the project
                  </button>
                </form>
              )}
            </section>
          ) : (
            <>
              <section className="mt-8" data-project>
                <h2 className="text-lg font-semibold">{running.name}</h2>
                <p className="mt-1 text-sm">
                  Started <LocalTime iso={running.startedAt.toISOString()} />.{" "}
                  {open && profile ? (
                    <>
                      Its diary:{" "}
                      <Link href={`/h/${profile.handle}/project`} className="underline underline-offset-2">
                        /h/{profile.handle}/project
                      </Link>
                    </>
                  ) : (
                    "Your host page is not public at the moment, so nobody else can read the diary."
                  )}
                </p>
                <form action={changeProjectAction} className="mt-3 max-w-md space-y-3">
                  <input type="hidden" name="projectId" value={running.id} />
                  <label className="block text-sm">
                    Name
                    <input name="name" type="text" defaultValue={running.name} required minLength={PROJECT.nameMin} maxLength={PROJECT.nameMax} className={field} />
                  </label>
                  <label className="block text-sm">
                    What it is about (up to {PROJECT.descriptionMax} characters)
                    <textarea name="description" rows={4} maxLength={PROJECT.descriptionMax} defaultValue={running.description} className={field} />
                  </label>
                  <button type="submit" className={smallButton}>
                    Save
                  </button>
                </form>
              </section>

              <section id="write" className="mt-10 scroll-mt-4">
                <h2 className="text-lg font-semibold">Write a post</h2>
                <PostForm action={writePostAction} hidden={{ name: "projectId", value: running.id }} text="" links={[]} button="Add to the diary" rows={6} textMax={PROJECT.postTextMax} linksMax={PROJECT.linksMax} linkMax={PROJECT.linkMax} />
              </section>

              <section className="mt-10" data-posts>
                <h2 className="text-lg font-semibold">Your posts</h2>
                <PostList posts={posts} page={page} earlierId={null} canChange />
                <Paging page={page} older={older} link={pageLink} />
              </section>

              <section className="mt-10">
                <h2 className="text-lg font-semibold">End this project</h2>
                <p className="mt-2 text-sm opacity-70">
                  The diary stays readable at its address, marked as ended, and you can then start a new project. Ending cannot be undone.
                </p>
                <form action={endProjectAction} className="mt-3 space-y-2 text-sm">
                  <input type="hidden" name="projectId" value={running.id} />
                  <label className="flex items-start gap-2">
                    <input type="checkbox" name="sure" required className="mt-1" />
                    <span>Yes, end &ldquo;{running.name}&rdquo;.</span>
                  </label>
                  <button type="submit" className={smallButton}>
                    End this project
                  </button>
                </form>
              </section>
            </>
          )}

          {past.length > 0 && (
            <section className="mt-10" data-past>
              <h2 className="text-lg font-semibold">Earlier projects</h2>
              <ul className="mt-2 space-y-1 text-sm">
                {past.map((project) => (
                  <li key={project.id}>
                    {project.name}
                    {project.endedAt && (
                      <>
                        , ended <LocalTime iso={project.endedAt.toISOString()} />
                      </>
                    )}
                    .{" "}
                    <Link href={`/host/project?project=${project.id}`} className="underline underline-offset-2">
                      Its posts
                    </Link>
                    {open && profile && (
                      <>
                        {" · "}
                        <Link href={`/h/${profile.handle}/project/${project.id}`} className="underline underline-offset-2">
                          Its diary, as others see it
                        </Link>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </SitePage>
  );
}

/** The posts of a project as its host sees them: also the ones Connect has hidden, each with what she can still do. */
function PostList({ posts, page, earlierId, canChange }: { posts: ProjectPost[]; page: number; earlierId: string | null; canChange: boolean }) {
  if (posts.length === 0) return <p className="mt-2 text-sm opacity-70">{page > 1 ? "There are no older posts." : earlierId ? "No posts are left in this diary." : "Nothing yet. Your first post appears here."}</p>;
  return (
    <ul className="mt-3 space-y-3">
      {posts.map((post) => (
        <li key={post.id} className="rounded border border-neutral-400 p-3 text-sm">
          <p className="opacity-70">
            <LocalTime iso={post.createdAt.toISOString()} />
          </p>
          <p className="mt-1">{firstLines(post.text, 200)}</p>
          {post.hiddenAt && (
            <p className="mt-1 text-amber-700">
              Hidden by Connect: nobody else can see this post.{post.hiddenNote ? ` "${post.hiddenNote}"` : ""} You can remove it.
            </p>
          )}
          <div className="mt-2 flex items-center gap-4">
            {/* Always there: a single picture can be removed also when the post itself can no longer be changed. */}
            <Link href={`/host/project/posts/${post.id}`} className="underline underline-offset-2">
              {canChange && !post.hiddenAt ? "Change, or add pictures" : "Its pictures"}
            </Link>
            <form action={removePostAction}>
              <input type="hidden" name="postId" value={post.id} />
              {earlierId && <input type="hidden" name="earlier" value={earlierId} />}
              <button type="submit" className="underline underline-offset-2">
                Remove
              </button>
            </form>
          </div>
        </li>
      ))}
    </ul>
  );
}

function Paging({ page, older, link }: { page: number; older: boolean; link: (n: number) => string }) {
  if (page === 1 && !older) return null;
  return (
    <p className="mt-3 flex gap-4 text-sm">
      {page > 1 && (
        <Link href={link(page - 1) as "/host/project"} className="underline underline-offset-2">
          Newer posts
        </Link>
      )}
      {older && (
        <Link href={link(page + 1) as "/host/project"} className="underline underline-offset-2">
          Older posts
        </Link>
      )}
    </p>
  );
}
