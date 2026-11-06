import Link from "next/link";
import { offerOf } from "@/lib/booking/bookings";
import { liveForHost } from "@/lib/booking/now";
import { NOW } from "@/lib/booking/now-rules";
import { requireActiveUser } from "@/lib/session";
import { NowPanel } from "./now-panel";

export const dynamic = "force-dynamic";

/** The host's live page: switch "available now" on, and answer people asking for a call right away. */
export default async function HostNowPage() {
  const user = await requireActiveUser();
  const offer = await offerOf(user.id);
  const initial = await liveForHost(user.id, new Date());

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10">
      <p className="text-sm">
        <Link href="/host" className="underline underline-offset-2">
          ← Hosting
        </Link>
      </p>
      <h1 className="mt-4 text-2xl font-semibold">Available now</h1>
      <p className="mt-2 text-sm opacity-80">
        For calls right away, outside your calendar. People on your page see &quot;Available now&quot; and can ask for a call that starts a
        minute after you accept. You have {NOW.answerMinutes} minutes to answer each request. You are charged nothing; the customer pays for
        the time you are both in the call.
      </p>
      {!offer ? (
        <p className="mt-6 rounded border border-neutral-400 p-3 text-sm">
          To be available now, your profile must be approved and your calendar set up (at least one call length and some hours).
        </p>
      ) : !offer.canTakePaid ? (
        <p className="mt-6 rounded border border-neutral-400 p-3 text-sm">Finish your payout setup on the Hosting page first.</p>
      ) : (
        <NowPanel initial={initial} durations={NOW.durations} />
      )}
    </main>
  );
}
