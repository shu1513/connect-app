import type { Metadata } from "next";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import Link from "next/link";
import { LocalTime } from "@/components/local-time";
import { SitePage } from "@/components/site-page";
import { db, schema } from "@/db";
import type { Project, ProjectPost } from "@/db/schema";
import { suggestedOf } from "@/lib/contributions/rules";
import { contributorsOf, stateOf } from "@/lib/contributions/views";
import { readNotice } from "@/lib/notice";
import { formatMoney } from "@/lib/payments/access";
import { currentSplit } from "@/lib/payments/actions";
import { postsOf } from "@/lib/projects/posts";
import { projectsOf, startProblem } from "@/lib/projects/projects";
import { firstLines, PROJECT } from "@/lib/projects/rules";
import { publicProfile } from "@/lib/profiles/profiles";
import { projectsOnFor } from "@/lib/safety/switches";
import { requireUser } from "@/lib/session";
import { changeProjectAction, endProjectAction, removePostAction, startProjectAction, writePostAction } from "./actions";
import { letGoAsHostAction, refundAsHostAction, saveSuggestedAction } from "./contribution-actions";
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
          <ContributionsPart hostId={user.id} project={earlier} earlierId={earlier.id} canChange={false} />
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

              <ContributionsPart hostId={user.id} project={running} earlierId={null} canChange={switchOn} />

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

const amountBox = "w-24 rounded border border-neutral-400 bg-transparent px-2 py-1.5";

/**
 * The contributions to one of her projects (plans/23, "Her contributors", "Refunding"): the
 * amounts she suggests, who contributes, each payment with where it stands, "Let it go" while a
 * payment is only held, and "Refund" once its money was taken and until her share has been sent.
 * For a project that has ended only the list is left, with its buttons: money that was taken
 * stays with the project, and she can still give it back.
 */
async function ContributionsPart({ hostId, project, earlierId, canChange }: { hostId: string; project: Project; earlierId: string | null; canChange: boolean }) {
  const { contributors, paidCents, shareCents, readyCents } = await contributorsOf(hostId, project.id, new Date());
  const boxes = (kept: string) => {
    const amounts = suggestedOf(kept).map((cents) => (cents / 100).toFixed(2));
    return [0, 1, 2].map((index) => amounts[index] ?? "");
  };
  const earlier = earlierId ? <input type="hidden" name="earlier" value={earlierId} /> : null;
  return (
    <section className="mt-10" data-contributions>
      <h2 className="text-lg font-semibold">Contributions</h2>
      {!earlierId && (
        <>
          <p className="mt-2 text-sm opacity-70">
            People can support this project with money, once or every month. A contribution buys nothing: no call and no promised reward. You suggest up to three amounts for each kind, and a contributor can also type their own ($5 to $100,000). A kind you leave empty is not
            offered; with no amount at all, your project takes no contributions.
          </p>
          {canChange && (
            <form action={saveSuggestedAction} className="mt-3 space-y-3 text-sm" data-amounts>
              <input type="hidden" name="projectId" value={project.id} />
              <fieldset>
                <legend>Once, in dollars</legend>
                <div className="mt-1 flex gap-2">
                  {boxes(project.suggestedOnce).map((value, index) => (
                    <input key={index} name="once" type="text" inputMode="decimal" maxLength={12} defaultValue={value} aria-label={`Suggested amount ${index + 1}, once`} className={amountBox} />
                  ))}
                </div>
              </fieldset>
              <fieldset>
                <legend>Every month, in dollars</legend>
                <div className="mt-1 flex gap-2">
                  {boxes(project.suggestedMonthly).map((value, index) => (
                    <input key={index} name="monthly" type="text" inputMode="decimal" maxLength={12} defaultValue={value} aria-label={`Suggested amount ${index + 1}, every month`} className={amountBox} />
                  ))}
                </div>
              </fieldset>
              <button type="submit" className={smallButton}>
                Save the amounts
              </button>
            </form>
          )}
        </>
      )}

      <p className="mt-4 text-sm" data-totals>
        Contributors have paid {formatMoney(paidCents)} in all, after refunds. Your share of it is {formatMoney(shareCents)}.{" "}
        {readyCents > 0 ? (
          <>
            {formatMoney(readyCents)} is ready to collect on{" "}
            <Link href="/host" className="underline underline-offset-2">
              Hosting, under Earnings
            </Link>
            .
          </>
        ) : (
          "Nothing is ready to collect right now: a share can be collected 7 days after its money was taken, or 30 days for large amounts from one person."
        )}
      </p>

      {contributors.length === 0 ? (
        <p className="mt-2 text-sm opacity-70">Nobody has contributed yet.</p>
      ) : (
        <ul className="mt-3 space-y-3" data-contributors>
          {contributors.map(({ contribution, name, payments }) => (
            <li key={contribution.id} className="rounded border border-neutral-400 p-3 text-sm">
              <p>
                <strong>{name}</strong>: {formatMoney(contribution.amountCents)}
                {contribution.kind === "monthly" ? " every month" : ", once"}, since <LocalTime iso={contribution.createdAt.toISOString()} />.
                {contribution.kind === "monthly" && contribution.status === "ended" ? " This monthly contribution has ended." : ""}
                {contribution.kind === "monthly" && contribution.status === "running" && contribution.accountPausedAt ? " Paused, because one of the two accounts was paused; it carries on when that is over." : ""}
              </p>
              <ul className="mt-2 space-y-2">
                {[...payments].reverse().map((row) => {
                  const { payment, share } = row;
                  const state = stateOf(payment);
                  const sent = share?.transferStatus === "sent";
                  return (
                    <li key={payment.id} className="border-t border-neutral-300 pt-2" data-payment={state}>
                      {contribution.kind === "monthly" && <span className="opacity-70">Month {payment.number}: </span>}
                      {state === "held" && payment.takeAt && (
                        <>
                          {formatMoney(payment.amountCents)} is held on their card and taken on <LocalTime iso={payment.takeAt.toISOString()} />. Until then you can let it go, at no cost to anyone.
                          <form action={letGoAsHostAction} className="mt-1">
                            {earlier}
                            <input type="hidden" name="payment" value={payment.id} />
                            <button type="submit" className={smallButton}>
                              Let it go
                            </button>
                          </form>
                        </>
                      )}
                      {(state === "to_pay" || state === "failed" || state === "confirm") && "Not paid yet."}
                      {state === "cancelling" && "Being let go."}
                      {state === "cancelled" && "Let go. Nothing was charged."}
                      {state === "problem" && "Connect is looking at this payment."}
                      {state === "taken" && payment.takenAt && (
                        <>
                          {formatMoney(payment.takenCents ?? payment.amountCents)} was taken on <LocalTime iso={payment.takenAt.toISOString()} />.
                          {share && (
                            <>
                              {" "}
                              Your share: {formatMoney(currentSplit(share).hostShareCents)}.
                              {/* What was really sent is said by itself: a refund after the sending makes the share smaller than that. */}
                              {sent && <> {formatMoney(share.transferCents ?? 0)} was sent to you{(share.payoutFeeCents ?? 0) > 0 ? `, after ${formatMoney(share.payoutFeeCents ?? 0)} of the collection charge` : ""}.</>}
                            </>
                          )}
                          {payment.refundedCents > 0 && <> {formatMoney(payment.refundedCents)} was paid back.</>}
                          {row.refundUnderWayCents > 0 && <> {formatMoney(row.refundUnderWayCents)} is on its way back.</>}
                          {payment.dispute === "open" || payment.dispute === "lost" ? (
                            <> The contributor&apos;s bank has disputed this charge, so nothing can be collected or refunded from it now.</>
                          ) : sent ? (
                            <> Your share has been sent to you, so only Connect can refund this now. If Connect does, you owe your share of it back: you are told, and it is listed under your earnings.</>
                          ) : (
                            row.refundableCents > 0 && (
                              <form action={refundAsHostAction} className="mt-1 flex flex-wrap items-end gap-2">
                                {earlier}
                                <input type="hidden" name="payment" value={payment.id} />
                                {/* Made when this page was drawn: the same press, sent twice, is one refund. */}
                                <input type="hidden" name="request" value={randomUUID()} />
                                <label>
                                  Give back, in dollars
                                  <input name="amount" type="text" inputMode="decimal" maxLength={12} defaultValue={(row.refundableCents / 100).toFixed(2)} className={`${amountBox} ml-2`} />
                                </label>
                                <button type="submit" className={smallButton}>
                                  Refund
                                </button>
                              </form>
                            )
                          )}
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
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
