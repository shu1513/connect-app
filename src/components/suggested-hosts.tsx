import { hideSuggestionAction } from "@/app/suggestions/actions";
import { HostPhoto } from "@/components/host-photo";
import { LocalTime } from "@/components/local-time";
import { Rating } from "@/components/rating";
import { SeenSuggestions, SuggestedLink } from "@/components/suggestions-watch";
import { warm } from "@/components/warm-ui";
import { formatMoney } from "@/lib/payments/access";
import { languageNames } from "@/lib/profiles/languages";
import { SUGGEST } from "@/lib/suggestions/rules";
import type { SuggestedHost } from "@/lib/suggestions/suggestions";

/** One suggested host: what a search result shows, the next open time, and the X. */
function Card({ day, host }: { day: string; host: SuggestedHost }) {
  return (
    <li className="flex items-start gap-3 border-t border-[#e7e5e4] py-3 first:border-t-0" data-suggested-place={host.place} data-suggested-host={host.handle}>
      <HostPhoto photoId={host.photoId} name={host.displayName} small />
      <div className="min-w-0 flex-1 text-sm">
        <p className="flex flex-wrap items-center gap-x-2">
          {/* Opening a host's page from here is remembered: it keeps a host the person is interested in coming back (plans/41). */}
          <SuggestedLink key={`${day}:${host.place}`} day={day} place={host.place} href={`/h/${host.handle}`} className="inline-flex min-h-11 items-center text-base font-bold underline decoration-[#c2410c] underline-offset-4">
            {host.displayName}
          </SuggestedLink>
          <span className="text-[#57534e]">@{host.handle}</span>
        </p>
        <p>
          <Rating shown={host.rating} newText="New on Connect" /> · {host.pricePer15Cents === 0 ? "Free calls" : `${formatMoney(host.pricePer15Cents)} per 15 minutes`}
        </p>
        {languageNames(host.languages).length > 0 && <p className="text-[#57534e]">{`Languages: ${languageNames(host.languages).join(", ")}`}</p>}
        <p className="mt-1" data-suggested-open={host.open.availableNow ? "now" : "later"}>
          {host.open.availableNow ? (
            <span className="font-semibold">
              <span aria-hidden className="mr-2 inline-block h-3 w-3 rounded-full bg-green-600" />
              Available now
            </span>
          ) : (
            host.open.nextOpen && (
              <>
                Next open time: <LocalTime iso={host.open.nextOpen.toISOString()} />
              </>
            )
          )}
        </p>
      </div>
      <form action={hideSuggestionAction} className="shrink-0">
        <input type="hidden" name="handle" value={host.handle} />
        <button type="submit" className="inline-flex size-11 items-center justify-center rounded-full text-xl text-[#78716c] hover:bg-[#fff7ed] hover:text-[#9a3412]" aria-label={`Hide ${host.displayName} from your suggestions`} title="Hide this suggestion">
          <span aria-hidden>×</span>
        </button>
      </form>
    </li>
  );
}

/**
 * "Suggested hosts" on the home page (plans/37, plans/41): up to six hosts the person does not
 * know yet. The first three are shown; the others are behind "Show more", so the page stays calm.
 * The row never says why a host is there, who else follows them, or how many do (plans/37,
 * decision 11); the text under it is the same for everyone.
 */
export function SuggestedHosts({ day, hosts }: { day: string; hosts: SuggestedHost[] }) {
  if (hosts.length === 0) return null;
  const first = hosts.slice(0, SUGGEST.shown);
  const more = hosts.slice(SUGGEST.shown);
  return (
    <section className={`${warm.card} mt-6`} data-suggested={day}>
      <h2 className="text-lg font-bold">Suggested hosts</h2>
      <ul className="mt-2">
        {first.map((host) => (
          <Card key={host.hostId} day={day} host={host} />
        ))}
      </ul>
      {more.length > 0 && (
        // Closed, its cards are not on the screen, so they are not counted as seen until the person opens it.
        <details className="border-t border-[#e7e5e4]" data-suggested-more={more.length}>
          <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm underline underline-offset-2">Show {more.length} more</summary>
          <ul>
            {more.map((host) => (
              <Card key={host.hostId} day={day} host={host} />
            ))}
          </ul>
        </details>
      )}
      <details className="mt-2 text-sm text-[#57534e]" data-suggested-why>
        <summary className="inline-flex min-h-11 cursor-pointer items-center underline underline-offset-2">Why these hosts?</summary>
        <p className="mt-1">
          These are hosts you do not follow and have not called, who have open times. Being free sooner adds points. Hosts followed by people who follow the same hosts as you get points too, more for more people. Good ratings count
          a little. Two places are kept for hosts who have been shown less often. You get new suggestions each day. A host you have seen on two days without opening their page rests for about two weeks; one whose page you opened can be
          suggested again. The X hides a host for good.
        </p>
      </details>
      <SeenSuggestions key={day} day={day} places={hosts.filter((host) => !host.seen).map((host) => host.place)} />
    </section>
  );
}
