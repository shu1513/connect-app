import type { Metadata } from "next";
import Link from "next/link";
import { HostPhoto } from "@/components/host-photo";
import { Rating } from "@/components/rating";
import { languageNames } from "@/lib/profiles/languages";
import { formatMoney } from "@/lib/payments/access";
import { searchHosts } from "@/lib/profiles/search";
import { SEARCH, searchTerms } from "@/lib/profiles/search-rules";
import { getUser } from "@/lib/session";
import { SitePage } from "@/components/site-page";
import { warm } from "@/components/warm-ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Find a host" };

/** Finding a host by name, handle or confirmed social media name. Open to anyone, like the host pages. */
export default async function SearchPage(props: PageProps<"/search">) {
  const { q } = await props.searchParams;
  const typed = typeof q === "string" ? q.slice(0, 200) : "";
  const viewer = await getUser();
  const searched = searchTerms(typed) !== null;
  const results = searched ? await searchHosts(typed, viewer?.id ?? null, new Date()) : [];

  return (
    <SitePage className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6 sm:py-12">
      <h1 className={warm.title}>Find a host</h1>
      <form action="/search" method="get" className={`${warm.searchPill} mt-6`}>
        <label className="min-w-0 flex-1">
          <span className="sr-only">Name, handle, or social media name</span>
          <input
            name="q"
            type="search"
            defaultValue={typed}
            maxLength={SEARCH.max}
            placeholder="Name, @handle, or Instagram, TikTok, YouTube or X name"
            className={`${warm.searchInput} w-full`}
          />
        </label>
        <button type="submit" className={warm.button}>
          Search
        </button>
      </form>

      {typed !== "" && !searched && <p className="mt-6 text-sm opacity-70">Type at least {SEARCH.min} letters or numbers.</p>}
      {searched && results.length === 0 && <p className="mt-6 text-sm opacity-70">Nobody found. Check the spelling, or try their handle or social media name.</p>}

      {results.length > 0 && (
        <ul className="mt-8 space-y-4">
          {results.map((host) => (
            <li key={host.handle} className={`${warm.card} text-sm`}>
              <div className="flex items-center gap-3">
                <HostPhoto photoId={host.photoId} name={host.displayName} small />
                <p className="flex min-w-0 flex-wrap items-center gap-x-3 text-lg font-bold">
                  <Link href={`/h/${host.handle}`} className="inline-flex min-h-11 items-center underline decoration-[#c2410c] underline-offset-4">
                    {host.displayName}
                  </Link>{" "}
                  <span className="text-sm font-normal text-[#57534e]">@{host.handle}</span>
                </p>
              </div>
              <p className="mt-1">
                <Rating shown={host.rating} newText="New on Connect" /> · {host.pricePer15Cents === 0 ? "Free calls" : `${formatMoney(host.pricePer15Cents)} per 15 minutes`}
              </p>
              {languageNames(host.languages).length > 0 && <p className="mt-1">{`Languages: ${languageNames(host.languages).join(", ")}`}</p>}
              {host.socials.length > 0 && (
                <p className="mt-3 text-[#57534e]">
                  {host.socials.map((s) => `${s.label}: @${s.name}`).join(" · ")} <span>(confirmed)</span>
                </p>
              )}
              {host.about && <p className="mt-3 text-[#57534e]">{host.about}</p>}
            </li>
          ))}
        </ul>
      )}
      {results.length === SEARCH.results && <p className="mt-4 text-sm opacity-70">Showing the {SEARCH.results} best matches. Type more to narrow it down.</p>}
    </SitePage>
  );
}
