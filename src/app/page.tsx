import Link from "next/link";
import { CallsCalendar } from "@/components/calls-calendar";
import { Countdown } from "@/components/countdown";
import { CustomerDetailsLines } from "@/components/customer-details";
import { DiaryPicture } from "@/components/diary-picture";
import { HostPhoto } from "@/components/host-photo";
import { LocalTime } from "@/components/local-time";
import { RefreshEvery } from "@/components/refresh-every";
import { SitePage } from "@/components/site-page";
import { SuggestedHosts } from "@/components/suggested-hosts";
import { MakeSuggestions } from "@/components/suggestions-watch";
import { warm, warmFont } from "@/components/warm-ui";
import { roomOpensAt, roomState } from "@/lib/calls";
import { FOLLOW } from "@/lib/follows/rules";
import { gatherHome } from "@/lib/home/gather";
import { notPaidYet } from "@/lib/home/payment-line";
import { HOME } from "@/lib/home/rules";
import { noCallWords, requestWords } from "@/lib/home/words";
import { readNotice } from "@/lib/notice";
import { firstLines } from "@/lib/projects/rules";
import { getSignedIn, requireUser } from "@/lib/session";
import { RequestList, timesAskedFor } from "./host/requests/request-list";

/** What a visitor sees at the front address: what Connect is, and the ways in. */
function FrontPage() {
  const focus = warm.focus;
  const footerLink = `inline-flex min-h-11 min-w-11 items-center justify-center underline underline-offset-2 hover:text-[#9a3412] ${focus}`;
  return (
    <div className={`${warmFont.className} ${warm.root}`}>
      <header data-site-header="visitor" className="mx-auto flex max-w-[1040px] flex-wrap items-center justify-between gap-4 p-6">
        <Link href="/" className={`inline-flex min-h-11 items-center text-[22px] font-extrabold ${focus}`}>
          Connect
        </Link>
        <nav aria-label="Main" className="flex flex-wrap items-center gap-5 text-[15px]">
          <Link href="/login" className={`inline-flex min-h-11 min-w-11 items-center text-[#44403c] hover:underline ${focus}`}>
            Log in
          </Link>
          <Link href="/signup" className={`inline-flex min-h-11 items-center rounded-full bg-[#1c1917] px-[18px] py-2.5 font-semibold text-white hover:bg-[#44403c] ${focus}`}>
            Sign up
          </Link>
        </nav>
      </header>

      <main className="mx-auto max-w-[760px] px-6 pt-12 pb-10 text-center sm:pt-[72px]">
        <div aria-hidden="true" className="mb-7 flex justify-center">
          <div className="size-16 rounded-full border-4 border-[#fffbf7] bg-[#fdba74]" />
          <div className="-ml-4 size-16 rounded-full border-4 border-[#fffbf7] bg-[#c2410c]" />
        </div>
        <h1 className="text-[36px] leading-[1.1] font-extrabold tracking-[-0.02em] sm:text-[52px]">Go from following to talking.</h1>
        <p className="mx-auto mt-5 max-w-[560px] text-[19px] leading-[1.6] text-[#57534e]">
          A private video call, just the two of you. You choose who, when and for how long.
        </p>

        <form action="/search" method="get" className={`${warm.searchPill} mx-auto mt-9 max-w-[560px]`}>
          <label htmlFor="front-search" className="sr-only">Who would you like to talk to?</label>
          <input
            id="front-search"
            name="q"
            type="search"
            maxLength={50}
            placeholder="Who would you like to talk to?"
            aria-describedby="front-search-hint"
            className={`${warm.searchInput} ${focus}`}
          />
          <button type="submit" className={`${warm.button} ${focus}`}>
            Search
          </button>
        </form>
        <p id="front-search-hint" className="mt-3.5 text-sm text-[#78716c]">Type a name or their @handle from Instagram, TikTok or YouTube.</p>
        <p className="mt-10 flex flex-wrap items-center justify-center gap-2 text-[15px] text-[#57534e]">
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#c2410c" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6z" />
            <path d="M9 12l2 2 4-4" />
          </svg>
          <span>Every host&apos;s ID is checked. Nothing is charged when you ask.</span>
        </p>
      </main>

      <footer className="mx-auto flex max-w-[1040px] flex-wrap justify-center gap-x-5 px-6 pt-6 pb-12 text-sm text-[#57534e]">
        <Link href="/host" className={`${footerLink} font-semibold text-[#9a3412]`}>Become a host</Link>
        <Link href="/rules" className={footerLink}>Rules</Link>
        <Link href="/terms" className={footerLink}>Terms</Link>
        <Link href="/privacy" className={footerLink}>Privacy</Link>
      </footer>
    </div>
  );
}

/**
 * The home page of someone who is logged in (plans/36-customer-home-page.md), from top to bottom:
 * the next call with its countdown, what is waiting for them, their calendar (plans/43), the hosts
 * they follow, news from those hosts, and suggested hosts (plans/37). Calls that are over are on /calls.
 *
 * One page for everyone: a person can be a customer and a host with the same account, so the
 * calls they host and the requests waiting for their answer are here too. A host sees more on it
 * (plans/38-host-home-page.md): what she should know about the customer of each call she hosts,
 * the requests themselves with Accept and Decline, and a line of shortcuts. Those parts appear
 * when there is something to show; someone who only books calls sees the page of plan 36.
 *
 * Drawing this page only reads. It never opens a room: every way into a call is a link to the
 * call's own page, which decides who may enter.
 */
export default async function HomePage(props: PageProps<"/">) {
  // Nobody logged in: the front page. Someone part-way through signing up is still sent to their next step.
  if (!(await getSignedIn())) return <FrontPage />;
  const user = await requireUser();
  const query = await props.searchParams;
  const notice = readNotice("/", query);
  // Everything the page is made of is put together in one place, shared with the phone app (src/lib/home/gather.ts).
  const { drawn, day, cut, hasCalls, soonest, next, nextListed, listed, asks, paymentsOf, requests, toAnswer, toRate, followed, shownHosts, news, photos, pictures, suggested, ownProfile, hosts } = await gatherHome(user, query.day, { diary: true });
  const requestTimes = timesAskedFor(toAnswer);
  const firstName = user.name.trim().split(/\s+/)[0] ?? "";
  const sectionTitle = "text-lg font-bold";
  const plainLink = "inline-flex min-h-11 items-center underline underline-offset-2";

  return (
    <SitePage className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6 sm:py-12">
      {/*
        Who is available, which room is open, a follow that comes by itself after a call and a call that is to be
        rated all appear without a reload: the page asks the server again every minute while it is in front.
      */}
      <RefreshEvery seconds={FOLLOW.refreshSeconds} />
      <h1 className={warm.title}>{firstName ? `Hello, ${firstName}` : "Hello"}</h1>

      {hosts && (
        <nav aria-label="Hosting" className="mt-2 text-sm" data-host-shortcuts>
          <p className="flex flex-wrap items-center gap-x-5">
            <span className="font-bold text-[#9a3412]">Hosting</span>
            <Link href="/host/now" className={plainLink}>
              Available now
            </Link>
            <Link href="/host/calendar" className={plainLink}>
              Your calendar
            </Link>
            <Link href="/host#paid" className={plainLink}>
              Earnings
            </Link>
            <Link href="/host" className={plainLink}>
              Settings
            </Link>
          </p>
          {ownProfile?.status === "approved" && !ownProfile.hidden && (
            <p className="text-[#57534e]">
              Your page:{" "}
              <Link href={`/h/${ownProfile.handle}`} className={plainLink}>
                /h/{ownProfile.handle}
              </Link>
            </p>
          )}
        </nav>
      )}

      {user.paused && (
        <p className="mt-6 rounded border border-red-600 p-3 text-sm">
          Your account is paused: you can look, but not book, host or join calls.{" "}
          <Link href="/paused" className="underline underline-offset-2">
            Why, and what to do
          </Link>
        </p>
      )}

      {notice && (
        <p role="status" className="mt-6 rounded border border-neutral-400 p-3 text-sm">
          {notice}
        </p>
      )}

      {next && nextListed ? (
        <section className={`${roomState(next, drawn) === "open" ? warm.available : warm.card} mt-6`} data-next-call={next.id}>
          <h2 className="text-sm font-bold text-[#9a3412]">Your next call</h2>
          <div className="mt-3 flex items-center gap-3">
            <HostPhoto photoId={nextListed.photoId} name={nextListed.name} />
            <div className="min-w-0">
              <p className="text-xl font-extrabold">{nextListed.name}</p>
              <p className="text-sm text-[#57534e]">
                <LocalTime iso={nextListed.startsAt} /> · {nextListed.minutes} minutes
              </p>
              <p className="text-sm text-[#57534e]">
                {nextListed.payment}
                {nextListed.hosting && " · You host this call"}
              </p>
            </div>
          </div>
          {nextListed.about && (
            <div className="mt-3 text-sm">
              <CustomerDetailsLines callId={next.id} name={nextListed.name} about={nextListed.about} />
            </div>
          )}
          <Countdown
            callId={next.id}
            serverNow={drawn.toISOString()}
            opensAt={roomOpensAt(next).toISOString()}
            startsAt={next.startsAt.toISOString()}
            endsAt={next.endsAt.toISOString()}
            open={roomState(next, drawn) === "open"}
            notPaid={notPaidYet(paymentsOf.get(next.id) ?? [])}
          />
        </section>
      ) : (
        <section className={`${warm.card} mt-6`} data-next-call="none">
          <h2 className="text-sm font-bold text-[#9a3412]">Your next call</h2>
          <p className="mt-2 text-[#57534e]">
            {noCallWords(followed.length === 0 && requests.length === 0)}
          </p>
          <form action="/search" method="get" className={`${warm.searchPill} mt-4`}>
            <label className="min-w-0 flex-1">
              <span className="sr-only">Find a host by name, handle or social media name</span>
              <input name="q" type="search" maxLength={50} placeholder="Name, @handle or social media name" className={`${warm.searchInput} w-full`} />
            </label>
            <button type="submit" className={warm.button}>
              Search
            </button>
          </form>
        </section>
      )}

      {(toRate.length > 0 || toAnswer.length > 0) && (
        <section className="mt-6 rounded-3xl border border-[#fed7aa] bg-[#fff7ed] p-5 text-sm" data-waiting>
          <h2 className={sectionTitle}>Waiting for you</h2>
          {toAnswer.length > 0 && (
            <div data-requests-to-answer>
              <p className="mt-1">
                You have {toAnswer.length} {toAnswer.length === 1 ? "request" : "requests"} for a call waiting for your answer.
              </p>
              {/* The requests themselves, to answer here (plans/38): the list of the requests page, its first few times. */}
              <div className="mt-3">
                <RequestList hostId={user.id} waiting={toAnswer} from="home" times={HOME.requestTimesShown} />
              </div>
              <p>
                <Link href="/host/requests" className={plainLink}>
                  {requestTimes > HOME.requestTimesShown ? `See all ${toAnswer.length} requests` : "The requests page"}
                </Link>
              </p>
            </div>
          )}
          {toRate.length > 0 && (
            <>
              <h3 className="mt-2 font-semibold">Waiting for your rating</h3>
              <ul>
                {toRate.map((call) => (
                  <li key={call.callId}>
                    <Link href={`/calls/${call.callId}/results`} className={plainLink}>
                      Rate your call with {call.otherName}
                    </Link>{" "}
                    <span className="text-[#57534e]">
                      (<LocalTime iso={call.endsAt.toISOString()} />)
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      {/* The calendar (plans/43): the calls of the days in view, also the ones that are over. Not for someone who never had a call. */}
      {/* Also for a host whose first requests wait before she has had any call: they are on the calendar too. */}
      {(hasCalls || toAnswer.length > 0) && (
        <section className={`${warm.card} mt-6`} data-calendar>
          <h2 className={sectionTitle}>Your calendar</h2>
          <div className="mt-2">
            <CallsCalendar calls={listed} asks={asks} serverNow={drawn.toISOString()} day={day} nextId={next?.id ?? null} cut={cut} />
          </div>
        </section>
      )}

      {requests.length > 0 && (
        <section className={`${warm.card} mt-6`} data-requests>
          <h2 className={sectionTitle}>Your requests</h2>
          <ul className="mt-1 text-sm">
            {requests.map(({ booking, hostName }) => (
              <li key={booking.id}>
                <Link href={`/bookings/${booking.id}`} className={plainLink}>
                  {hostName}, <LocalTime iso={booking.startsAt.toISOString()} />
                </Link>
                : {requestWords(booking)}
              </li>
            ))}
          </ul>
        </section>
      )}

      {followed.length > 0 && (
        <section className={`${warm.card} mt-6`} data-followed-hosts>
          <h2 className={sectionTitle}>Hosts you follow</h2>
          <ul className="mt-2">
            {shownHosts.map((host) => (
              <li key={host.hostId} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-[#e7e5e4] py-2 first:border-t-0" data-followed={host.available ? "available" : "not"}>
                <HostPhoto photoId={host.handle ? (photos.get(host.hostId) ?? null) : null} name={host.name} small />
                <div className="min-w-0 flex-1">
                  {host.handle ? (
                    <Link href={`/h/${host.handle}`} className="inline-flex min-h-11 items-center font-bold underline decoration-[#c2410c] underline-offset-4">
                      {host.name}
                    </Link>
                  ) : (
                    <span className="font-bold">{host.name}</span>
                  )}
                  {host.available && host.handle && (
                    <p className="text-sm font-semibold">
                      <span aria-hidden className="mr-2 inline-block h-3 w-3 rounded-full bg-green-600" />
                      Available now
                    </p>
                  )}
                </div>
                {host.available && host.handle && (
                  <Link href={`/h/${host.handle}`} className={warm.button}>
                    Call now
                  </Link>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-sm">
            <Link href="/following" className={plainLink}>
              {followed.length > shownHosts.length ? `See all ${followed.length}` : "See all"}
            </Link>
          </p>
        </section>
      )}

      {news.length > 0 && (
        <section className={`${warm.card} mt-6`} data-diary-news>
          <h2 className={sectionTitle}>News from your hosts</h2>
          <ul className="mt-2">
            {news.map((post) => {
              const picture = (pictures.get(post.postId) ?? [])[0];
              return (
                <li key={post.postId} className="border-t border-[#e7e5e4] py-4 first:border-t-0" data-news-post={post.postId}>
                  <div className="flex items-center gap-3">
                    <HostPhoto photoId={photos.get(post.hostId) ?? null} name={post.hostName} small />
                    <p className="min-w-0 text-sm">
                      <span className="font-bold">{post.hostName}</span> in {post.projectName}
                      <br />
                      <span className="text-[#57534e]">
                        <LocalTime iso={post.writtenAt.toISOString()} />
                      </span>
                    </p>
                  </div>
                  {picture && (
                    <p className="mt-3">
                      <DiaryPicture id={picture.id} width={picture.width} height={picture.height} />
                    </p>
                  )}
                  <p className="mt-3 text-[#44403c]" data-news-text>{firstLines(post.text, HOME.newsLetters)}</p>
                  <p className="text-sm">
                    <Link href={`/h/${post.handle}/project/${post.projectId}`} className={plainLink}>
                      Read the diary
                    </Link>
                  </p>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Today's suggestions are made by the browser's own request, a moment after the page is there; drawing the page never writes. */}
      {suggested && !suggested.made && <MakeSuggestions key={suggested.day} />}
      {suggested && <SuggestedHosts day={suggested.day} hosts={suggested.hosts} />}

      <p className="mt-8 flex flex-wrap gap-x-6 text-sm">
        <Link href="/calls" className={plainLink}>
          Past calls
        </Link>
        <Link href="/contacts" className={plainLink}>
          People you have talked to
        </Link>
        {soonest.length === 0 && (
          <Link href="/host" className={plainLink}>
            Take calls yourself
          </Link>
        )}
      </p>
    </SitePage>
  );
}
