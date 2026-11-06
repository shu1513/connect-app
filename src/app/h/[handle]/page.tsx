import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { formatMoney } from "@/lib/payments/access";
import { publicProfile } from "@/lib/profiles/profiles";

// Always built fresh, so hiding or suspending a profile takes effect at once.
export const dynamic = "force-dynamic";

const CANCEL_RULE: Record<number, string> = {
  0: "Free to cancel any time before the call starts.",
  60: "Free to cancel until 1 hour before the call starts.",
  720: "Free to cancel until 12 hours before the call starts.",
  1440: "Free to cancel until 24 hours before the call starts.",
};

export async function generateMetadata(props: PageProps<"/h/[handle]">): Promise<Metadata> {
  const { handle } = await props.params;
  const profile = await publicProfile(handle);
  // The same title for every page that cannot be shown, so nothing is given away.
  if (!profile) return { title: "Not found — Connect" };
  return { title: `${profile.displayName} (@${profile.handle}) — Connect` };
}

/** A host's public page. Anyone can open it, logged in or not. */
export default async function HostPublicPage(props: PageProps<"/h/[handle]">) {
  const { handle } = await props.params;
  const profile = await publicProfile(handle);
  if (!profile) notFound();

  return (
    <main className="mx-auto w-full max-w-xl px-4 py-12">
      <div className="flex items-center gap-4">
        <div
          aria-hidden
          className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-neutral-300 text-2xl font-semibold text-neutral-800"
        >
          {profile.displayName.charAt(0).toUpperCase()}
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
        <button type="button" disabled className="mt-4 rounded bg-blue-600 px-4 py-2 font-medium text-white opacity-50">
          Book a call (coming soon)
        </button>
      </section>
    </main>
  );
}
