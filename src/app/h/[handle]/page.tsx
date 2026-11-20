import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import Link from "next/link";
import { LocalTime } from "@/components/local-time";
import { SlotPicker } from "@/components/slot-picker";
import { FollowButton } from "@/components/follow-button";
import { readNotice } from "@/lib/notice";
import { timeWords } from "@/lib/membership/rules";
import { NOW } from "@/lib/booking/now-rules";
import { firstLength, lengthWords } from "@/lib/booking/rules";
import { formatMoney } from "@/lib/payments/access";
import { HostPhoto } from "@/components/host-photo";
import { Rating } from "@/components/rating";
import { gatherHostPage, hostProfileFor } from "@/lib/profiles/host-page";
import { ASK_WORDS, askTitle, callWords, lengthChoice, membershipStateWords, notTakingWords, priceWords } from "@/lib/profiles/host-page-words";
import { sellerLine } from "@/lib/profiles/profiles";
import { firstLines } from "@/lib/projects/rules";
import { getUser } from "@/lib/session";
import { SitePage } from "@/components/site-page";
import { warm } from "@/components/warm-ui";

// Always built fresh, so hiding or suspending a profile takes effect at once.
export const dynamic = "force-dynamic";

const lengthList = `${warm.input} mt-1 block`;

/**
 * The page title and the page itself share one lookup per request. A page that is hidden from the
 * public still opens for a member of this host, and for someone she has invited, and for nobody
 * else: that is asked of the membership's own access rules, and the public reader is not loosened.
 */
const loadProfile = cache(async (handle: string) => hostProfileFor(await getUser(), handle));

export async function generateMetadata(props: PageProps<"/h/[handle]">): Promise<Metadata> {
  const { handle } = await props.params;
  const profile = await loadProfile(handle);
  // The same title for every page that cannot be shown, so nothing is given away.
  if (!profile) return { title: "Not found" };
  return { title: `${profile.displayName} (@${profile.handle})` };
}

/** A host's public page. Anyone can open it, logged in or not. */
export default async function HostPublicPage(props: PageProps<"/h/[handle]">) {
  const { handle } = await props.params;
  const profile = await loadProfile(handle);
  if (!profile) notFound();

  // Everything the page is made of is put together in one place, shared with the phone app (src/lib/profiles/host-page.ts).
  const viewer = await getUser();
  const query = await props.searchParams;
  const notice = readNotice(`/h/${profile.handle}`, query);
  const { offer, follow, memberView, own, invitedUntil, memberChosen, memberTimes, chosen, starts, now, rating, languages, project, latestPost, mine, offerIdCheck } = await gatherHostPage(viewer, profile, query, { project: true });
  // Whether she offers calls as a business or as a private person, by her own statement (plans/46, decision 10).
  const seller = await sellerLine(profile.userId, profile.displayName);

  return (
    <SitePage className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6 sm:py-12">
      <div className="flex items-center gap-4">
        <HostPhoto photoId={profile.photoId} name={profile.displayName} />
        <div className="min-w-0">
          <h1 className={warm.title}>{profile.displayName}</h1>
          <p className="text-sm opacity-70">@{profile.handle}</p>
          <p className="text-sm">
            <Rating shown={rating} newText="New on Connect" />
          </p>
          {/* Only for a host who has chosen: nothing is guessed for the others (plans/34-host-languages.md). */}
          {languages.length > 0 && (
            <p className="text-sm" data-host-languages>
              {`Languages: ${languages.join(", ")}`}
            </p>
          )}
        </div>
      </div>

      {notice && (
        <p role="status" className="mt-4 rounded border border-neutral-400 p-3 text-sm">
          {notice}
        </p>
      )}

      {follow && (
        <div className="mt-4" data-follow={follow}>
          <FollowButton state={follow} hostId={profile.userId} handle={profile.handle} name={profile.displayName} back={`/h/${profile.handle}`} />
        </div>
      )}

      {profile.about && <p className="mt-6 whitespace-pre-line text-[#57534e]">{profile.about}</p>}
      {seller && (
        <p className="mt-3 text-sm text-[#78716c]" data-seller-kind>
          {seller}
        </p>
      )}

      {viewer && viewer.id !== profile.userId && (
        <p className="mt-4 text-sm">
          <Link href={`/report?profile=${profile.handle}`} className="inline-flex min-h-11 items-center underline underline-offset-2 opacity-70">
            Report this page
          </Link>
        </p>
      )}

      {profile.socials.length > 0 && (
        <ul className="mt-4 space-y-1 text-sm">
          {profile.socials.map((social) => (
            <li key={social.network}>
              {social.label}:{" "}
              <a href={social.url} target="_blank" rel="noopener noreferrer nofollow" className="underline underline-offset-2">
                @{social.name}
              </a>{" "}
              <span className="opacity-70">(account confirmed)</span>
            </li>
          ))}
        </ul>
      )}

      {project && (
        <section className={`${warm.card} mt-6`} data-project-box>
          <h2 className="text-lg font-semibold">{project.name}</h2>
          <p className="mt-1 text-sm opacity-70">A project {profile.displayName} is working on.</p>
          <p className="mt-2 text-sm">{firstLines(latestPost ? latestPost.text : project.description, 200)}</p>
          <p className="mt-3">
            <Link href={`/h/${profile.handle}/project`} className={warm.secondary}>
              Read the diary
            </Link>
          </p>
          {mine?.own ? (
            <p className="mt-3 text-sm" data-own-line={mine.own.is}>
              <Link href={`/contributions/${mine.own.contributionId}`} className="inline-flex min-h-11 items-center underline underline-offset-2">
                {mine.own.is === "monthly" ? `You contribute ${formatMoney(mine.own.amountCents)} a month` : "Finish contributing"}
              </Link>
            </p>
          ) : mine && mine.offered.length > 0 ? (
            <p className="mt-3 text-sm" data-own-line="contribute">
              <Link href={`/h/${profile.handle}/project#contribute`} className="inline-flex min-h-11 items-center underline underline-offset-2">
                Contribute
              </Link>
            </p>
          ) : null}
        </section>
      )}

      <section className={`${warm.card} mt-6`}>
        <p className="text-lg font-semibold">
          {priceWords(profile.pricePer15Cents)}
        </p>
        <p className="mt-1 text-sm opacity-70">{callWords(profile.freeCancelMinutes)}</p>
        {offer?.verifiedOnly && (
          <p className="mt-2 text-sm">
            {profile.displayName} only takes calls from people who have confirmed their ID.
            {offerIdCheck && (
              <>
                {" "}
                <Link href={`/identity?next=${encodeURIComponent(`/h/${profile.handle}`)}`} className="underline underline-offset-2">
                  Confirm yours
                </Link>
              </>
            )}
          </p>
        )}
      </section>

      {own && invitedUntil && (
        <section className={`${warm.card} mt-6`}>
          <h2 className="text-lg font-semibold">{profile.displayName} invites you to a membership</h2>
          <p className="mt-1 text-sm">
            A fixed amount each month, as talk time with {profile.displayName} at a lower price. The invitation is open until <LocalTime iso={invitedUntil.toISOString()} />. Nothing is charged unless you join.
          </p>
          <p className="mt-3">
            <Link href={`/h/${profile.handle}/membership?invite=${own.inviteId}`} className={warm.button}>
              See the invitation
            </Link>
          </p>
        </section>
      )}
      {own && (own.status === "joining" || own.status === "unpaid" || own.status === "paused") && (
        <section className={`${warm.card} mt-6`}>
          <h2 className="text-lg font-semibold">Your membership</h2>
          <p className="mt-1 text-sm">
            {membershipStateWords(own.status)}
          </p>
          <p className="mt-3">
            <Link href={own.status === "unpaid" ? `/memberships/${own.id}/pay` : own.status === "paused" ? `/memberships/${own.id}` : `/h/${profile.handle}/membership`} className={warm.secondary}>
              {own.status === "joining" ? "Go to the card step" : own.status === "unpaid" ? "Pay now" : "See your membership, or resume it"}
            </Link>
          </p>
        </section>
      )}

      {memberView && (
        <section id="member" className={`${warm.card} mt-6 scroll-mt-4`}>
          <h2 className="text-lg font-semibold">Your membership</h2>
          <p className="mt-1 text-sm">
            <strong>{timeWords(memberView.minutesLeft)} left</strong>, until <LocalTime iso={memberView.monthEndsAt.toISOString()} />. Your price is{" "}
            {formatMoney(memberView.month.pricePer15Cents)} per 15 minutes.
          </p>
          {own && (
            <p className="mt-1 text-sm">
              <Link href={`/memberships/${own.id}`} className="underline underline-offset-2">
                Your receipts, your next payment, and cancelling
              </Link>
            </p>
          )}
          {memberView.month.status === "held" && (
            <p className="mt-2 text-sm opacity-70">
              This month&apos;s {formatMoney(memberView.month.totalCents)} is only held on your card so far. It is taken when you make your first booking of the month.
            </p>
          )}
          {!memberChosen ? (
            <p className="mt-2 text-sm">
              The time you have left does not cover a call with {profile.displayName}. You can still ask for one the ordinary way below, at the regular price.
            </p>
          ) : (
            <>
              <p className="mt-2 text-sm">
                A call you book with your membership is booked at once: {profile.displayName} does not need to accept it. It must end before your month ends.
              </p>
              <form method="get" action={`/h/${profile.handle}#member`} className="mt-5 flex flex-wrap items-end gap-3 text-sm">
                <label className="block min-w-0 max-w-full">
                  Length
                  <select name="mlength" defaultValue={memberChosen} className={lengthList}>
                    {memberView.lengths.map((minutes) => (
                      <option key={minutes} value={minutes}>
                        {lengthWords(minutes)}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="submit" className={warm.secondary}>
                  Show times
                </button>
              </form>
              {memberTimes.length === 0 ? (
                <p className="mt-4 text-sm opacity-70">There are no open times for this length before your month ends. Please look again later.</p>
              ) : (
                <div className={warm.slots}>
                  <SlotPicker
                    starts={memberTimes.map((time) => time.startsAt.toISOString())}
                    hrefBase={`/h/${profile.handle}/book?as=member&length=${memberChosen}`}
                    marked={memberTimes.filter((time) => time.membersOnly).map((time) => time.startsAt.toISOString())}
                    markedLabel="A time for members only"
                  />
                </div>
              )}
            </>
          )}
        </section>
      )}

      {now && (
        <section className={`${warm.available} mt-6`}>
          <h2 className="text-lg font-semibold">
            <span aria-hidden className="mr-2 inline-block h-3 w-3 rounded-full bg-green-600" />
            Available now
          </h2>
          <p className="mt-1 text-sm">
            {profile.displayName} can take a call right away. Choose a length; they answer within {NOW.answerMinutes} minutes and the call starts a minute after they accept.
            {now.offer.pricePer15Cents > 0 ? " You pay for the time you are both in the call." : ""}
          </p>
          <form method="get" action={`/h/${profile.handle}/now`} className="mt-5 flex flex-wrap items-end gap-3 text-sm">
            <label className="block min-w-0 max-w-full">
              Length
              <select name="length" defaultValue={firstLength(now.lengths) ?? undefined} className={lengthList}>
                {now.lengths.map((minutes) => (
                  <option key={minutes} value={minutes}>
                    {lengthChoice(minutes, now.offer.pricePer15Cents)}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className={warm.button}>
              Call now
            </button>
          </form>
        </section>
      )}

      <section id="ask" className={`${warm.card} mt-6 scroll-mt-4`}>
        <h2 className="text-lg font-semibold">{askTitle(Boolean(memberView), Boolean(now))}</h2>
        {!offer || !chosen || !offer.canTakePaid ? (
          <p className="mt-2 text-sm opacity-70">{notTakingWords(profile.displayName, offer, chosen)}</p>
        ) : (
          <>
            <p className="mt-2 text-sm">
              {ASK_WORDS.notReserved(profile.displayName)}
            </p>
            <form method="get" action={`/h/${profile.handle}#ask`} className="mt-5 flex flex-wrap items-end gap-3 text-sm">
              <label className="block min-w-0 max-w-full">
                Length
                <select name="length" defaultValue={chosen} className={lengthList}>
                  {offer.lengths.map((minutes) => (
                    <option key={minutes} value={minutes}>
                      {lengthChoice(minutes, offer.pricePer15Cents)}
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit" className={now ? warm.secondary : warm.button}>
                Show times
              </button>
            </form>
            {starts.length === 0 ? (
              <p className="mt-4 text-sm opacity-70">{ASK_WORDS.noTimes}</p>
            ) : (
              <div className={warm.slots}>
                <SlotPicker starts={starts.map((s) => s.toISOString())} hrefBase={`/h/${profile.handle}/book?length=${chosen}`} />
              </div>
            )}
          </>
        )}
      </section>
    </SitePage>
  );
}
