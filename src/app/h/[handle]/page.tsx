import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import Link from "next/link";
import { SlotPicker } from "@/components/slot-picker";
import { offerOf, openTimes } from "@/lib/booking/bookings";
import { formatMoney } from "@/lib/payments/access";
import { bookedTotalCents } from "@/lib/payments/pricing";
import { publicProfile } from "@/lib/profiles/profiles";

// Always built fresh, so hiding or suspending a profile takes effect at once.
export const dynamic = "force-dynamic";

const CANCEL_RULE: Record<number, string> = {
  0: "Free to cancel any time before the call starts.",
  60: "Free to cancel until 1 hour before the call starts.",
  720: "Free to cancel until 12 hours before the call starts.",
  1440: "Free to cancel until 24 hours before the call starts.",
};

/** The page title and the page itself share one lookup per request. */
const loadProfile = cache(publicProfile);

export async function generateMetadata(props: PageProps<"/h/[handle]">): Promise<Metadata> {
  const { handle } = await props.params;
  const profile = await loadProfile(handle);
  // The same title for every page that cannot be shown, so nothing is given away.
  if (!profile) return { title: "Not found — Connect" };
  return { title: `${profile.displayName} (@${profile.handle}) — Connect` };
}

/** A host's public page. Anyone can open it, logged in or not. */
export default async function HostPublicPage(props: PageProps<"/h/[handle]">) {
  const { handle } = await props.params;
  const profile = await loadProfile(handle);
  if (!profile) notFound();

  // What can be booked. Worked out fresh on every visit; nothing here says why a time is closed.
  const offer = await offerOf(profile.userId);
  const { length } = await props.searchParams;
  const chosen = offer && typeof length === "string" && offer.lengths.includes(Number(length)) ? Number(length) : (offer?.lengths[0] ?? null);
  const starts = offer && chosen ? await openTimes(offer, chosen, new Date()) : [];

  return (
    <main className="mx-auto w-full max-w-xl px-4 py-12">
      <div className="flex items-center gap-4">
        <div
          aria-hidden
          className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-neutral-300 text-2xl font-semibold text-neutral-800"
        >
          {(Array.from(profile.displayName)[0] ?? "").toUpperCase()}
        </div>
        <div>
          <h1 className="text-2xl font-semibold">{profile.displayName}</h1>
          <p className="text-sm opacity-70">@{profile.handle}</p>
        </div>
      </div>

      {profile.about && <p className="mt-6 whitespace-pre-line">{profile.about}</p>}

      {profile.socials.length > 0 && (
        <ul className="mt-6 space-y-1 text-sm">
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

      <section className="mt-8 rounded border border-neutral-400 p-4">
        <p className="text-lg font-semibold">
          {profile.pricePer15Cents === 0 ? "Free private video call" : `${formatMoney(profile.pricePer15Cents)} per 15 minutes`}
        </p>
        <p className="mt-1 text-sm opacity-70">A private one-to-one video call. {CANCEL_RULE[profile.freeCancelMinutes] ?? ""}</p>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">Ask for a call</h2>
        {!offer || !chosen ? (
          <p className="mt-2 text-sm opacity-70">{profile.displayName} is not taking bookings at the moment.</p>
        ) : !offer.canTakePaid ? (
          <p className="mt-2 text-sm opacity-70">{profile.displayName} is not taking bookings yet.</p>
        ) : (
          <>
            <p className="mt-2 text-sm">
              This sends a request. It does not reserve the time: others may ask for it too, and {profile.displayName} chooses.
            </p>
            <div className="mt-3 flex flex-wrap gap-2 text-sm">
              {offer.lengths.map((minutes) => (
                <Link
                  key={minutes}
                  href={`/h/${profile.handle}?length=${minutes}`}
                  className={`rounded border px-3 py-1.5 ${minutes === chosen ? "border-blue-600 bg-blue-600 text-white" : "border-neutral-500"}`}
                >
                  {minutes} minutes
                  {offer.pricePer15Cents > 0 ? `, ${formatMoney(bookedTotalCents(offer.pricePer15Cents, minutes * 60))}` : ""}
                </Link>
              ))}
            </div>
            {starts.length === 0 ? (
              <p className="mt-4 text-sm opacity-70">There are no open times for this length right now. Please look again later.</p>
            ) : (
              <SlotPicker starts={starts.map((s) => s.toISOString())} hrefBase={`/h/${profile.handle}/book?length=${chosen}`} />
            )}
          </>
        )}
      </section>
    </main>
  );
}
