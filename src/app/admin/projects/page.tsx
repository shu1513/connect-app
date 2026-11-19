import type { Metadata } from "next";
import { inArray } from "drizzle-orm";
import Link from "next/link";
import { LocalTime } from "@/components/local-time";
import { SitePage } from "@/components/site-page";
import { db, schema } from "@/db";
import { readNotice } from "@/lib/notice";
import { postForAdmin, postsForAdmin, projectPostsForAdmin, publicPostCount, type AdminPost } from "@/lib/projects/posts";
import { allProjects } from "@/lib/projects/projects";
import { firstLines, linksOf } from "@/lib/projects/rules";
import { switches } from "@/lib/safety/switches";
import { requireAdmin } from "@/lib/session";
import { hidePostAction, projectsSwitchAction, showPostAction } from "./actions";

export const metadata: Metadata = { title: "Admin: projects" };

const field = "mt-1 rounded border border-neutral-400 bg-transparent px-2 py-1";
const button = "rounded border border-neutral-500 px-3 py-1.5";

/**
 * The founder's page for projects (plans/24): the switch, every project, and the posts of the
 * diaries with "hide" and "show". A report about a post links here with that post's id
 * (`?post=`). Every post of a project, page by page, is under `?project=`, whether or not the
 * host's page is open, so there is no post the founder cannot reach.
 */
export default async function AdminProjectsPage(props: PageProps<"/admin/projects">) {
  await requireAdmin();
  const query = await props.searchParams;
  const notice = readNotice("/admin/projects", query);
  const page = typeof query.page === "string" && /^[1-9]\d{0,3}$/.test(query.page) ? Number(query.page) : 1;
  const [current, projects, lists, one, ofProject] = await Promise.all([
    switches(),
    allProjects(),
    postsForAdmin(),
    typeof query.post === "string" ? postForAdmin(query.post) : null,
    typeof query.project === "string" ? projectPostsForAdmin(query.project, page) : null,
  ]);
  const chosen = ofProject ? projects.find(({ project }) => project.id === query.project) : undefined;
  const namedHosts = current.projectsHosts.length
    ? await db.select({ handle: schema.hostProfiles.handle }).from(schema.hostProfiles).where(inArray(schema.hostProfiles.userId, current.projectsHosts))
    : [];
  const counts = new Map(await Promise.all(projects.map(async ({ project }) => [project.id, await publicPostCount(project.id)] as const)));

  return (
    <SitePage className="mx-auto w-full max-w-4xl px-4 py-10">
      <p className="text-sm">
        <Link href="/admin" className="underline underline-offset-2">
          ← Admin
        </Link>
        <Link href="/admin/reports" className="ml-4 underline underline-offset-2">
          Reports and safety
        </Link>
      </p>
      <h1 className="mt-4 text-2xl font-semibold">Admin: projects</h1>

      {notice && (
        <p role="status" className="mt-4 rounded border border-neutral-400 p-3 text-sm">
          {notice}
        </p>
      )}

      {typeof query.post === "string" && (
        <section className="mt-8" data-one-post>
          <h2 className="text-lg font-semibold">The post you asked for</h2>
          {one ? <PostCard entry={one} full /> : <p className="mt-2 text-sm opacity-70">There is no such post.</p>}
        </section>
      )}

      {typeof query.project === "string" && (
        <section className="mt-8" data-project-posts>
          <h2 className="text-lg font-semibold">{chosen ? `Every post of "${chosen.project.name}", by ${chosen.hostName}` : "The project you asked for"}</h2>
          {!ofProject || !chosen ? (
            <p className="mt-2 text-sm opacity-70">There is no such project.</p>
          ) : ofProject.posts.length === 0 ? (
            <p className="mt-2 text-sm opacity-70">{page > 1 ? "There are no older posts." : "This diary has no posts."}</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {ofProject.posts.map((entry) => (
                <li key={entry.post.id}>
                  <PostCard entry={entry} />
                </li>
              ))}
            </ul>
          )}
          {ofProject && chosen && (
            <p className="mt-3 flex gap-4 text-sm">
              {page > 1 && (
                <Link href={`/admin/projects?project=${chosen.project.id}${page > 2 ? `&page=${page - 1}` : ""}`} className="underline underline-offset-2">
                  Newer posts
                </Link>
              )}
              {ofProject.older && (
                <Link href={`/admin/projects?project=${chosen.project.id}&page=${page + 1}`} className="underline underline-offset-2">
                  Older posts
                </Link>
              )}
            </p>
          )}
        </section>
      )}

      <h2 className="mt-10 text-lg font-semibold">The switch</h2>
      <p className="mt-1 text-sm opacity-70">
        Off: no host can start a project, write or change a post. What is written stays readable; a host can still remove a post
        and end her project, and you can still hide a post. A host who is not named is treated as if this were off.
      </p>
      <form action={projectsSwitchAction} className="mt-2 space-y-2 text-sm">
        <label className="block">
          Projects are
          <select name="projects" defaultValue={current.projects} className={`${field} ml-2`}>
            <option value="off">off</option>
            <option value="named">on for the hosts named below</option>
            <option value="everyone">on for everyone</option>
          </select>
        </label>
        <label className="block">
          Named hosts, by their handle, with commas between
          <input name="hosts" defaultValue={namedHosts.map((host) => host.handle).join(", ")} className={`${field} block w-full max-w-md`} />
        </label>
        <button type="submit" className={button}>
          Save projects switch
        </button>
      </form>

      <h2 className="mt-10 text-lg font-semibold">Posts hidden by you ({lists.hidden.length})</h2>
      {lists.hidden.length === 0 ? (
        <p className="mt-2 text-sm opacity-70">No post is hidden.</p>
      ) : (
        <ul className="mt-3 space-y-3" data-hidden-posts>
          {lists.hidden.map((entry) => (
            <li key={entry.post.id}>
              <PostCard entry={entry} />
            </li>
          ))}
        </ul>
      )}

      <h2 className="mt-10 text-lg font-semibold">Every project ({projects.length})</h2>
      {projects.length === 0 ? (
        <p className="mt-2 text-sm opacity-70">No host has started a project yet.</p>
      ) : (
        <ul className="mt-3 space-y-1 text-sm" data-projects>
          {projects.map(({ project, hostName, handle }) => (
            <li key={project.id}>
              <strong>{project.name}</strong>, by {hostName}
              {handle ? ` (@${handle})` : ""}: {project.status === "running" ? "running" : "ended"}, started <LocalTime iso={project.startedAt.toISOString()} />, {counts.get(project.id) ?? 0}{" "}
              {counts.get(project.id) === 1 ? "post" : "posts"} shown.{" "}
              <Link href={`/admin/projects?project=${project.id}`} className="underline underline-offset-2">
                Every post
              </Link>
              {handle && (
                <>
                  {" · "}
                  <Link href={`/h/${handle}/project/${project.id}`} className="underline underline-offset-2">
                    The diary as visitors see it
                  </Link>{" "}
                  <span className="opacity-70">(opens only while the host&apos;s page is public)</span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <h2 className="mt-10 text-lg font-semibold">The newest posts</h2>
      {lists.latest.length === 0 ? (
        <p className="mt-2 text-sm opacity-70">Nothing has been written yet.</p>
      ) : (
        <ul className="mt-3 space-y-3" data-latest-posts>
          {lists.latest.map((entry) => (
            <li key={entry.post.id}>
              <PostCard entry={entry} />
            </li>
          ))}
        </ul>
      )}
    </SitePage>
  );
}

/** One post with what the founder can do with it. `full` shows the whole text; otherwise its first lines. */
function PostCard({ entry, full = false }: { entry: AdminPost; full?: boolean }) {
  const { post } = entry;
  const links = linksOf(post.links);
  return (
    <div className="rounded border border-neutral-400 p-3 text-sm">
      <p className="opacity-70">
        In &ldquo;{entry.projectName}&rdquo;, by {entry.hostName}
        {entry.handle ? ` (@${entry.handle})` : ""}, <LocalTime iso={post.createdAt.toISOString()} />
        {post.removedAt ? ". Removed by the host." : ""}
      </p>
      <p className="mt-1 whitespace-pre-line break-words">{full ? post.text : firstLines(post.text, 300)}</p>
      {links.length > 0 && <p className="mt-1 break-all opacity-70">Links: {links.join(", ")}</p>}
      {!full && (
        <p className="mt-1">
          <Link href={`/admin/projects?post=${post.id}`} className="underline underline-offset-2">
            The whole post
          </Link>
        </p>
      )}
      {post.removedAt ? (
        // Removed by its host: nobody sees it any more, so there is nothing to hide or show.
        <p className="mt-2 opacity-70">The host removed this post. Nobody else can see it.</p>
      ) : post.hiddenAt ? (
        <form action={showPostAction} className="mt-2 flex flex-wrap items-center gap-3">
          <input type="hidden" name="postId" value={post.id} />
          <span className="text-amber-700">
            Hidden <LocalTime iso={post.hiddenAt.toISOString()} />
            {post.hiddenNote ? `: "${post.hiddenNote}"` : ""}
          </span>
          <button type="submit" className={button}>
            Show it again
          </button>
        </form>
      ) : (
        <form action={hidePostAction} className="mt-2 flex flex-wrap items-end gap-3">
          <input type="hidden" name="postId" value={post.id} />
          <label>
            Note for the host (optional)
            <input name="note" type="text" maxLength={500} className={`${field} block w-72 max-w-full`} />
          </label>
          <button type="submit" className={button}>
            Hide this post
          </button>
        </form>
      )}
    </div>
  );
}
