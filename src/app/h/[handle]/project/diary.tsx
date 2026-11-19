import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { LocalTime } from "@/components/local-time";
import { SitePage } from "@/components/site-page";
import { warm } from "@/components/warm-ui";
import { postsOf } from "@/lib/projects/posts";
import { diaryFor } from "@/lib/projects/projects";
import { linksOf } from "@/lib/projects/rules";
import { getUser } from "@/lib/session";
import { SUPPORT_EMAIL } from "@/lib/terms";

/** The title and the page share one look-up per request. */
const load = cache((handle: string, projectId: string | undefined) => diaryFor(handle, projectId));

export async function diaryMetadata(handle: string, projectId?: string): Promise<Metadata> {
  const diary = await load(handle, projectId);
  // The same title for every page that cannot be shown, so nothing is given away.
  if (!diary) return { title: "Not found" };
  return { title: `${diary.project.name}, a project by ${diary.profile.displayName}` };
}

/**
 * A project's diary, for anyone, logged in or not (plans/23, choice A). It is there exactly when
 * the host's page is: a page that is not approved, hidden or closed has no diary either. Posts the
 * host removed and posts the founder hid are not in it.
 *
 * Without a project id this is the host's running project, or the one that ended last. With an
 * id it is exactly that project, which must be hers.
 */
export async function Diary(props: { handle: string; projectId?: string; query: Record<string, string | string[] | undefined> }) {
  const diary = await load(props.handle, props.projectId);
  if (!diary) notFound();
  const { profile, project } = diary;
  const page = typeof props.query.page === "string" && /^[1-9]\d{0,3}$/.test(props.query.page) ? Number(props.query.page) : 1;
  const { posts, older } = await postsOf(project.id, { page });
  const viewer = await getUser();
  // The address of this diary as it was asked for, so "older" and "newer" stay on the same one.
  const here = props.projectId ? `/h/${profile.handle}/project/${project.id}` : `/h/${profile.handle}/project`;
  const pageLink = (n: number) => (n === 1 ? here : `${here}?page=${n}`);

  return (
    <SitePage className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6 sm:py-12">
      <p className="text-sm">
        <Link href={`/h/${profile.handle}`} className="inline-flex min-h-11 items-center underline underline-offset-2">
          ← {profile.displayName}
        </Link>
      </p>
      <h1 className={`${warm.title} mt-2`}>{project.name}</h1>
      <p className="mt-1 text-sm opacity-70">
        A project by {profile.displayName}, started <LocalTime iso={project.startedAt.toISOString()} />.
      </p>
      {project.status === "ended" && (
        <p className="mt-4 rounded border border-neutral-400 p-3 text-sm" data-ended>
          This project has ended.
        </p>
      )}
      {project.description && <p className="mt-4 whitespace-pre-line text-[#57534e]">{project.description}</p>}

      <h2 className="mt-8 text-lg font-semibold">The diary</h2>
      {posts.length === 0 ? (
        <p className="mt-2 text-sm opacity-70">{page > 1 ? "There are no older posts." : "Nothing has been written yet."}</p>
      ) : (
        <ul className="mt-3 space-y-4" data-diary>
          {posts.map((post) => {
            const links = linksOf(post.links);
            return (
              <li key={post.id} className={warm.card}>
                <p className="text-sm opacity-70">
                  <LocalTime iso={post.createdAt.toISOString()} />
                </p>
                {/* Shown as plain text: an address typed into a post is never made into a link. */}
                <p className="mt-2 whitespace-pre-line break-words">{post.text}</p>
                {links.length > 0 && (
                  <ul className="mt-3 space-y-1 text-sm">
                    {links.map((link) => (
                      <li key={link} className="break-all">
                        <a href={link} target="_blank" rel="noopener noreferrer nofollow" className="underline underline-offset-2">
                          {link}
                        </a>{" "}
                        <span className="opacity-70">(opens YouTube)</span>
                      </li>
                    ))}
                  </ul>
                )}
                {viewer && viewer.id !== profile.userId && (
                  <p className="mt-2 text-sm">
                    <Link href={`/report?post=${post.id}`} className="inline-flex min-h-11 items-center underline underline-offset-2 opacity-70">
                      Report this post
                    </Link>
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-4 flex gap-4 text-sm">
        {page > 1 && (
          <Link href={pageLink(page - 1)} className="inline-flex min-h-11 items-center underline underline-offset-2">
            Newer posts
          </Link>
        )}
        {older && (
          <Link href={pageLink(page + 1)} className="inline-flex min-h-11 items-center underline underline-offset-2">
            Older posts
          </Link>
        )}
      </p>

      <p className="mt-8 text-sm opacity-70">
        Something here that should not be? {viewer && viewer.id !== profile.userId ? "Use \"Report this post\", or write" : "Write"} to {SUPPORT_EMAIL}.
      </p>
    </SitePage>
  );
}
