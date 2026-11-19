import type { Metadata } from "next";
import { inArray } from "drizzle-orm";
import Link from "next/link";
import { DiaryPicture } from "@/components/diary-picture";
import { LocalTime } from "@/components/local-time";
import { SitePage } from "@/components/site-page";
import { db, schema } from "@/db";
import { readNotice } from "@/lib/notice";
import type { ProjectPicture } from "@/db/schema";
import { mayBeFetched } from "@/lib/projects/child-safety";
import { checkerStates, picturesForAdmin, picturesOfPostForAdmin, type AdminPicture } from "@/lib/projects/moderation";
import { postForAdmin, postsForAdmin, projectPostsForAdmin, publicPostCount, type AdminPost } from "@/lib/projects/posts";
import { allProjects } from "@/lib/projects/projects";
import { firstLines, linksOf } from "@/lib/projects/rules";
import { switches } from "@/lib/safety/switches";
import { requireAdmin } from "@/lib/session";
import { hidePostAction, holdPictureAction, liftPictureAction, lockPictureAction, projectsSwitchAction, removePictureAction, reportMadeAction, showPostAction } from "./actions";

export const metadata: Metadata = { title: "Admin: projects" };

const field = "mt-1 rounded border border-neutral-400 bg-transparent px-2 py-1";
const button = "rounded border border-neutral-500 px-3 py-1.5";

/**
 * The founder's page for projects (plans/24): the switch, every project, the posts of the
 * diaries with "hide" and "show", and the pictures: how the checking stands, the pictures that
 * are waiting or were only checked for nudity, and "Remove and report". A report about a post links here with that post's id
 * (`?post=`). Every post of a project, page by page, is under `?project=`, whether or not the
 * host's page is open, so there is no post the founder cannot reach.
 */
export default async function AdminProjectsPage(props: PageProps<"/admin/projects">) {
  const admin = await requireAdmin();
  const query = await props.searchParams;
  const notice = readNotice("/admin/projects", query);
  const page = typeof query.page === "string" && /^[1-9]\d{0,3}$/.test(query.page) ? Number(query.page) : 1;
  const [current, projects, lists, one, ofProject, checking, pictures] = await Promise.all([
    switches(),
    allProjects(),
    postsForAdmin(),
    typeof query.post === "string" ? postForAdmin(query.post) : null,
    typeof query.project === "string" ? projectPostsForAdmin(query.project, page) : null,
    checkerStates(new Date()),
    picturesForAdmin(),
  ]);
  const onePictures = one ? await picturesOfPostForAdmin(one.post.id) : [];
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
          {one && (
            <div className="mt-3" data-post-pictures>
              <h3 className="font-medium">Its pictures ({onePictures.length})</h3>
              {onePictures.length === 0 ? (
                <p className="mt-1 text-sm opacity-70">This post has no pictures, or its host has removed them. A removed picture is not kept.</p>
              ) : (
                <ul className="mt-2 space-y-3">
                  {onePictures.map((picture) => (
                    <li key={picture.id}>
                      <PictureCard picture={picture} postId={one.post.id} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
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

      <h2 className="mt-10 text-lg font-semibold">Picture checking</h2>
      <p className="mt-1 text-sm opacity-70">
        Every picture is checked before anyone but its host can see it. A picture a checker flags is refused by itself and not kept; you
        do not have to decide those. The services are asked in this order; the next one is only asked when the one before is used up or
        cannot be reached.
      </p>
      <ul className="mt-2 space-y-1 text-sm" data-checkers>
        {checking.services.map((service) => (
          <li key={service.name}>
            <strong>{service.label}:</strong>{" "}
            {!service.hasKey ? (
              "not set up (no key in the settings), so it is not asked."
            ) : service.faultSince ? (
              <span className="text-red-700">
                has a fault since <LocalTime iso={service.faultSince.toISOString()} />: {service.faultDetail}. While this lasts, new pictures wait and are shown to
                nobody. The way out: put the right key into the settings, or take this service&apos;s key out, which takes it out of the queue.
              </span>
            ) : service.outUntil ? (
              <>
                used up or not reachable; it is asked again after <LocalTime iso={service.outUntil.toISOString()} />.
              </>
            ) : service.worksWithThisKey ? (
              <>
                working. Its last answer was <LocalTime iso={service.lastGoodAt!.toISOString()} />.
              </>
            ) : (
              "set up, but it has not answered yet with the key it has now."
            )}
          </li>
        ))}
        <li>
          <strong>Connect&apos;s own checker:</strong> the last in the queue. It only looks for nudity, and is only asked when every service above is out.
        </li>
        <li>
          <strong>The check against known pictures of child abuse:</strong>{" "}
          {checking.childCheckOn
            ? checking.childToolThere
              ? "switched on. Every new picture waits for its answer."
              : "switched on, but its settings are missing. Every new picture waits until they are back."
            : "not set up yet (the application for the tool is not answered). Pictures do not wait for it."}
        </li>
      </ul>

      <PictureList
        title="Shown after a check for nudity only"
        empty="None. Every picture that is shown has had its full check."
        note="Every outside service was out when these were uploaded, so only Connect's own checker has looked at them. Each gets its full check as soon as a service answers again."
        entries={pictures.nudityOnly}
      />
      <PictureList title="Waiting for a check" empty="No picture is waiting." note="Only their hosts can see these. Each is tried again by itself." entries={pictures.waiting} />
      <PictureList title="Held by you" empty="You hold no picture." note="Nobody but you can see these, and no checking service is sent them, until you lift the hold." entries={pictures.held} />

      <h2 className="mt-10 text-lg font-semibold">Removed and reported ({pictures.locked.length})</h2>
      <p className="mt-1 text-sm opacity-70">
        These pictures are kept exactly as they were and shown by nothing in the app. Report each to the authorities the way your lawyer has told you to, then write
        down here when you did. (Your lawyer&apos;s exact steps will be put on this page when you have them.)
      </p>
      {pictures.locked.length === 0 ? (
        <p className="mt-2 text-sm opacity-70">None.</p>
      ) : (
        <ul className="mt-3 space-y-3" data-locked-pictures>
          {pictures.locked.map(({ picture, projectName, hostName, handle }) => (
            <li key={picture.id} className="rounded border border-red-600 p-3 text-sm">
              <p>
                A picture in &ldquo;{projectName}&rdquo;, by {hostName}
                {handle ? ` (@${handle})` : ""}. Removed and kept <LocalTime iso={picture.lockedAt!.toISOString()} />
                {picture.lockedBy ? "" : ", by Connect itself"}.
              </p>
              {picture.reportMadeAt ? (
                <p className="mt-1">
                  You made the report <LocalTime iso={picture.reportMadeAt.toISOString()} />.
                </p>
              ) : (
                <form action={reportMadeAction} className="mt-2 flex flex-wrap items-end gap-3">
                  <input type="hidden" name="pictureId" value={picture.id} />
                  <label>
                    When you made the report ({admin.timeZone ?? "UTC"} time)
                    <input name="madeAt" type="datetime-local" required className={`${field} block`} />
                  </label>
                  <button type="submit" className={button}>
                    I have made the report
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}

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

/** One of the founder's lists of pictures. */
function PictureList({ title, empty, note, entries }: { title: string; empty: string; note: string; entries: AdminPicture[] }) {
  return (
    <>
      <h2 className="mt-10 text-lg font-semibold">
        {title} ({entries.length})
      </h2>
      {entries.length === 0 ? (
        <p className="mt-2 text-sm opacity-70">{empty}</p>
      ) : (
        <>
          <p className="mt-1 text-sm opacity-70">{note}</p>
          <ul className="mt-3 space-y-3">
            {entries.map(({ picture, projectName, hostName, handle }) => (
              <li key={picture.id}>
                <PictureCard picture={picture} where={`In "${projectName}", by ${hostName}${handle ? ` (@${handle})` : ""}`} />
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

/** One picture with where it stands and what the founder can do with it. `postId` is set when the founder is looking at one post, to come back to it. */
function PictureCard({ picture, where, postId }: { picture: ProjectPicture; where?: string; postId?: string }) {
  const hidden = (
    <>
      {postId && <input type="hidden" name="postId" value={postId} />}
      <input type="hidden" name="pictureId" value={picture.id} />
    </>
  );
  if (picture.state === "locked") {
    return <p className="rounded border border-red-600 p-3 text-sm">A picture of this post was removed and reported. It is kept and shown by nothing in the app. See &ldquo;Removed and reported&rdquo; below.</p>;
  }
  return (
    <div className="rounded border border-neutral-400 p-3 text-sm" data-admin-picture={picture.state}>
      {where && (
        <p className="opacity-70">
          {where}.{" "}
          <Link href={`/admin/projects?post=${picture.postId}`} className="underline underline-offset-2">
            Its post
          </Link>
        </p>
      )}
      {mayBeFetched(picture) ? (
        <div className="mt-2">
          <DiaryPicture id={picture.id} width={picture.width} height={picture.height} small />
        </div>
      ) : (
        <p className="mt-2 text-amber-700">Not shown to anyone, you included, until the check against known pictures of child abuse has answered for it.</p>
      )}
      <p className="mt-2">
        {picture.state === "shown" ? (picture.level === "nudity_only" ? "Shown, checked for nudity only." : "Shown, fully checked.") : "Waiting for a check; only its host sees it."} Uploaded{" "}
        <LocalTime iso={picture.uploadedAt.toISOString()} />.{picture.suspectedByFounder ? " Held by you." : ""}
        {picture.suspectedByReport ? " A report for \"someone under 18\" is open on its post, so no checking service is sent it." : ""}
      </p>
      {picture.checkDetail && <p className="mt-1 opacity-70">The last check said: {picture.checkDetail}</p>}
      <div className="mt-2 flex flex-wrap items-end gap-3">
        <form action={picture.suspectedByFounder ? liftPictureAction : holdPictureAction}>
          {hidden}
          <button type="submit" className={button}>
            {picture.suspectedByFounder ? "Lift the hold" : "Hold as suspected"}
          </button>
        </form>
        <form action={removePictureAction}>
          {hidden}
          <button type="submit" className={button}>
            Remove
          </button>
        </form>
        <form action={lockPictureAction} className="flex flex-wrap items-center gap-2">
          {hidden}
          <label className="flex items-center gap-1">
            <input type="checkbox" name="sure" /> This must be reported to the authorities
          </label>
          <button type="submit" className={`${button} border-red-600`}>
            Remove and report
          </button>
        </form>
      </div>
    </div>
  );
}
