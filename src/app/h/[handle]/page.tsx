import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import Link from "next/link";
import { LocalTime } from "@/components/local-time";
import { SlotPicker } from "@/components/slot-picker";
import { instantOffer, offerOf, openTimes } from "@/lib/booking/bookings";
import { hostForMemberByHandle } from "@/lib/membership/access";
import { memberBookingView, memberOpenTimes } from "@/lib/membership/book";
import { timeWords } from "@/lib/membership/rules";
import { NOW } from "@/lib/booking/now-rules";
import { firstLength, lengthWords } from "@/lib/booking/rules";
import { formatMoney } from "@/lib/payments/access";
import { bookedTotalCents } from "@/lib/payments/pricing";
import { Rating } from "@/components/rating";
import { publicProfile } from "@/lib/profiles/profiles";
import { averageFor } from "@/lib/ratings/ratings";
import { isBlockedEitherWay } from "@/lib/safety/block-check";
import { identityState } from "@/lib/safety/identity";
import { getUser } from "@/lib/session";
import { SitePage } from "@/components/site-page";
import { warm } from "@/components/warm-ui";

// Always built fresh, so hiding or suspending a profile takes effect at once.
export const dynamic = "force-dynamic";

const lengthList = `${warm.input} mt-1 block`;

const CANCEL_RULE: Record<number, string> = {
  0: "Free to cancel any time before the call starts.",
  60: "Free to cancel until 1 hour before the call starts.",
  720: "Free to cancel until 12 hours before the call starts.",
  1440: "Free to cancel until 24 hours before the call starts.",
};

/**
 * The page title and the page itself share one lookup per request. A page that is hidden from the
 * public still opens for a member of this host, and for someone she has invited, and for nobody
 * else: that is asked of the membership's own access rules, and the public reader is not loosened.
 */
const loadProfile = cache(async (handle: string) => {
  const open = await publicProfile(handle);
  if (open) return open;
  const viewer = await getUser();
  const forMember = viewer ? await hostForMemberByHandle(viewer.id, handle) : null;
  return forMember ? { ...forMember, socials: [] } : null;
});

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

  // What can be booked. Worked out fresh on every visit; nothing here says why a time is closed.
  const viewer = await getUser();
  const blocked = viewer ? await isBlockedEitherWay(viewer.id, profile.userId) : false;
  const offer = blocked ? null : await offerOf(profile.userId);
  const { length, mlength } = await props.searchParams;
  // A member of this host: their time left and the times they can book with it, beside the ordinary way.
  const memberView = viewer && viewer.id !== profile.userId && !blocked ? await memberBookingView(viewer.id, profile.userId, new Date()) : null;
  const memberChosen = !memberView || memberView.lengths.length === 0 ? null : typeof mlength === "string" && memberView.lengths.includes(Number(mlength)) ? Number(mlength) : firstLength(memberView.lengths);
  const memberTimes = memberView && memberChosen ? await memberOpenTimes(memberView, memberChosen, new Date()) : [];
  // The length the customer chose stays chosen; before any choice, the offered length closest to 30 minutes is shown.
  const chosen = offer && typeof length === "string" && offer.lengths.includes(Number(length)) ? Number(length) : offer ? firstLength(offer.lengths) : null;
  const starts = offer && chosen ? await openTimes(offer, chosen, new Date()) : [];
  const now = offer ? await instantOffer(profile.userId, new Date()) : null;
  const rating = await averageFor(profile.userId, "host", new Date());
  // A signed-in visitor who would be stopped at the booking page is offered the ID check here already.
  const offerIdCheck = Boolean(offer?.verifiedOnly && viewer && viewer.id !== profile.userId && !(await identityState(viewer.id)).passed);

  return (
    <SitePage className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6 sm:py-12">
      <div className="flex items-center gap-4">
        <div
          aria-hidden
          className="flex size-16 shrink-0 items-center justify-center rounded-full bg-[#ffedd5] text-2xl font-bold text-[#9a3412]"
        >
          {(Array.from(profile.displayName)[0] ?? "").toUpperCase()}
        </div>
        <div className="min-w-0">
          <h1 className={warm.title}>{profile.displayName}</h1>
          <p className="text-sm opacity-70">@{profile.handle}</p>
          <p className="text-sm">
            <Rating shown={rating} newText="New on Connect" />
          </p>
        </div>
      </div>

      {profile.about && <p className="mt-6 whitespace-pre-line text-[#57534e]">{profile.about}</p>}

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

      <section className={`${warm.card} mt-6`}>
        <p className="text-lg font-semibold">
          {profile.pricePer15Cents === 0 ? "Free private video call" : `${formatMoney(profile.pricePer15Cents)} per 15 minutes`}
        </p>
        <p className="mt-1 text-sm opacity-70">A private one-to-one video call. {CANCEL_RULE[profile.freeCancelMinutes] ?? ""}</p>
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

      {memberView && (
        <section id="member" className={`${warm.card} mt-6 scroll-mt-4`}>
          <h2 className="text-lg font-semibold">Your membership</h2>
          <p className="mt-1 text-sm">
            <strong>{timeWords(memberView.minutesLeft)} left</strong>, until <LocalTime iso={memberView.monthEndsAt.toISOString()} />. Your price is{" "}
            {formatMoney(memberView.month.pricePer15Cents)} per 15 minutes.
          </p>
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
                    {lengthWords(minutes)}
                    {now.offer.pricePer15Cents > 0 ? `, ${formatMoney(bookedTotalCents(now.offer.pricePer15Cents, minutes * 60))}` : ""}
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
        <h2 className="text-lg font-semibold">{memberView ? "Or ask the ordinary way, at the regular price" : now ? "Or ask for a call later" : "Ask for a call"}</h2>
        {!offer || !chosen ? (
          <p className="mt-2 text-sm opacity-70">{profile.displayName} is not taking calls at the moment.</p>
        ) : !offer.canTakePaid ? (
          <p className="mt-2 text-sm opacity-70">{profile.displayName} is not taking calls yet.</p>
        ) : (
          <>
            <p className="mt-2 text-sm">
              This sends a request. It does not reserve the time: others may ask for it too, and {profile.displayName} chooses.
            </p>
            <form method="get" action={`/h/${profile.handle}#ask`} className="mt-5 flex flex-wrap items-end gap-3 text-sm">
              <label className="block min-w-0 max-w-full">
                Length
                <select name="length" defaultValue={chosen} className={lengthList}>
                  {offer.lengths.map((minutes) => (
                    <option key={minutes} value={minutes}>
                      {lengthWords(minutes)}
                      {offer.pricePer15Cents > 0 ? `, ${formatMoney(bookedTotalCents(offer.pricePer15Cents, minutes * 60))}` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit" className={now ? warm.secondary : warm.button}>
                Show times
              </button>
            </form>
            {starts.length === 0 ? (
              <p className="mt-4 text-sm opacity-70">There are no open times for this length right now. Please look again later.</p>
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
