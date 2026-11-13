import type { Metadata } from "next";
import Link from "next/link";
import { Rating } from "@/components/rating";
import { formatMoney } from "@/lib/payments/access";
import { searchHosts } from "@/lib/profiles/search";
import { SEARCH, searchTerms } from "@/lib/profiles/search-rules";
import { getUser } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Find a host — Connect" };

/** Finding a host by name, handle or confirmed social media name. Open to anyone, like the host pages. */
export default async function SearchPage(props: PageProps<"/search">) {
  const { q } = await props.searchParams;
  const typed = typeof q === "string" ? q.slice(0, 200) : "";
  const viewer = await getUser();
  const searched = searchTerms(typed) !== null;
  const results = searched ? await searchHosts(typed, viewer?.id ?? null, new Date()) : [];

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10">
      {viewer && (
        <p className="text-sm">
          <Link href="/" className="underline underline-offset-2">
            ← Your calls
          </Link>
        </p>
      )}
      <h1 className="mt-4 text-2xl font-semibold">Find a host</h1>
      <form action="/search" method="get" className="mt-4 flex gap-2">
        <label className="flex-1 text-sm">
          <span className="sr-only">Name, handle, or social media name</span>
          <input
            name="q"
            type="search"
            defaultValue={typed}
            maxLength={SEARCH.max}
            placeholder="Name, @handle, or Instagram, TikTok, YouTube or X name"
            className="w-full rounded border border-neutral-400 bg-transparent px-3 py-2"
          />
        </label>
        <button type="submit" className="rounded bg-blue-600 px-4 py-2 font-medium text-white">
          Search
        </button>
      </form>

      {typed !== "" && !searched && <p className="mt-6 text-sm opacity-70">Type at least {SEARCH.min} letters or numbers.</p>}
      {searched && results.length === 0 && <p className="mt-6 text-sm opacity-70">Nobody found. Check the spelling, or try their handle or social media name.</p>}

      {results.length > 0 && (
        <ul className="mt-6 space-y-4">
          {results.map((host) => (
            <li key={host.handle} className="rounded border border-neutral-400 p-4 text-sm">
              <p className="text-base font-medium">
                <Link href={`/h/${host.handle}`} className="underline underline-offset-2">
                  {host.displayName}
                </Link>{" "}
                <span className="font-normal opacity-70">@{host.handle}</span>
              </p>
              <p className="mt-1">
                <Rating shown={host.rating} newText="New on Connect" /> · {host.pricePer15Cents === 0 ? "Free calls" : `${formatMoney(host.pricePer15Cents)} per 15 minutes`}
              </p>
              {host.socials.length > 0 && (
                <p className="mt-1 opacity-70">
                  {host.socials.map((s) => `${s.label}: @${s.name}`).join(" · ")} <span>(confirmed)</span>
                </p>
              )}
              {host.about && <p className="mt-2 opacity-80">{host.about}</p>}
            </li>
          ))}
        </ul>
      )}
      {results.length === SEARCH.results && <p className="mt-4 text-sm opacity-70">Showing the {SEARCH.results} best matches. Type more to narrow it down.</p>}
    </main>
  );
}
