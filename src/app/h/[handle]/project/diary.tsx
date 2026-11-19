import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { DiaryPicture } from "@/components/diary-picture";
import { LocalTime } from "@/components/local-time";
import { SitePage } from "@/components/site-page";
import { warm } from "@/components/warm-ui";
import { suggestedOf } from "@/lib/contributions/rules";
import { formatMoney } from "@/lib/payments/access";
import { contributionOf } from "@/lib/projects/ask";
import { picturesOf } from "@/lib/projects/pictures";
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
  // Only the pictures everyone may see. Each is fetched from its own address, which decides again.
  const pictures = await picturesOf(posts.map((post) => post.id));
  const viewer = await getUser();
  // The "Contribute" part is shown only where it can lead somewhere: not for her own project, not to someone
  // blocked, and not when the project has ended or takes no contributions (plans/25, choice 4). Asked again when
  // the form is sent. A visitor's own contribution gets its line here as on the host's page: both ask one function.
  // (Someone who already contributes every month, or is setting that up, is not offered a second monthly contribution: it would only be refused.)
  const { offered: kinds, own } = await contributionOf(viewer?.id ?? null, project);
  // "Older" and "newer" name this very project. Her plain address shows whichever project is current, so a
  // reader in the middle of one diary would land in another if she ended it and started a new one meanwhile.
  const here = `/h/${profile.handle}/project/${project.id}`;
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

      {own && (
        <p className="mt-8 rounded border border-neutral-300 p-4 text-sm" data-own-line={own.is}>
          <Link href={`/contributions/${own.contributionId}`} className="inline-flex min-h-11 items-center underline underline-offset-2">
            {own.is === "monthly" ? `You contribute ${formatMoney(own.amountCents)} a month` : "Finish contributing"}
          </Link>
        </p>
      )}

      {kinds.length > 0 && (
        <section id="contribute" className={`${own ? "mt-4" : "mt-8"} scroll-mt-4 rounded border border-neutral-300 p-4`} data-contribute>
          <h2 className="text-lg font-semibold">Contribute</h2>
          <p className="mt-1 text-sm opacity-80">
            A contribution supports {profile.displayName}&apos;s project. It does not buy a call or any promised reward, and it is not a donation to a charity. The amount is first only held on your card and taken three days later; until then you can cancel and pay nothing.
          </p>
          <div className="mt-3 grid gap-6 sm:grid-cols-2">
            {kinds.map((kind) => (
              <form key={kind} action="/contributions/new" method="get" className="text-sm" data-kind={kind}>
                <input type="hidden" name="project" value={project.id} />
                <input type="hidden" name="kind" value={kind} />
                <p className="font-medium">{kind === "monthly" ? "Every month" : "Once"}</p>
                <ul className="mt-2 space-y-1">
                  {suggestedOf(kind === "monthly" ? project.suggestedMonthly : project.suggestedOnce).map((cents, index) => (
                    <li key={cents}>
                      <label className="inline-flex min-h-9 items-center gap-2">
                        <input type="radio" name="amount" value={(cents / 100).toFixed(2)} defaultChecked={index === 0} />
                        {formatMoney(cents)}
                        {kind === "monthly" ? " a month" : ""}
                      </label>
                    </li>
                  ))}
                </ul>
                <label className="mt-2 block">
                  Or another amount, in dollars ($5 to $100,000)
                  <input type="text" name="other" inputMode="decimal" maxLength={12} placeholder="25.00" className="mt-1 w-32 rounded border border-neutral-400 bg-transparent px-3 py-2" />
                </label>
                <button type="submit" className="mt-3 rounded bg-blue-600 px-4 py-2 font-medium text-white">
                  {kind === "monthly" ? "Contribute every month" : "Contribute once"}
                </button>
              </form>
            ))}
          </div>
          <p className="mt-3 text-sm opacity-70">The next page shows everything before you pay.</p>
        </section>
      )}

      <h2 className="mt-8 text-lg font-semibold">The diary</h2>
      {posts.length === 0 ? (
        <p className="mt-2 text-sm opacity-70">{page > 1 ? "There are no older posts." : "Nothing has been written yet."}</p>
      ) : (
        <ul className="mt-3 space-y-4" data-diary>
          {posts.map((post) => {
            const links = linksOf(post.links);
            const shown = pictures.get(post.id) ?? [];
            return (
              <li key={post.id} className={warm.card}>
                <p className="text-sm opacity-70">
                  <LocalTime iso={post.createdAt.toISOString()} />
                </p>
                {/* Shown as plain text: an address typed into a post is never made into a link. */}
                <p className="mt-2 whitespace-pre-line break-words">{post.text}</p>
                {shown.length > 0 && (
                  <ul className="mt-3 space-y-3" data-post-pictures>
                    {shown.map((picture) => (
                      <li key={picture.id}>
                        <DiaryPicture id={picture.id} width={picture.width} height={picture.height} />
                      </li>
                    ))}
                  </ul>
                )}
                {links.length > 0 && (
                  <ul className="mt-3 space-y-1 text-sm">
                    {links.map((link) => (
                      <li key={link} className="break-all">
                        <a href={link} target="_blank" rel="noopener noreferrer nofollow" className="underline underline-offset-2">
                          {/* Shown as it reads: a channel's name in another alphabet is kept in codes, and written out here. */}
                          {decodeURI(link)}
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
