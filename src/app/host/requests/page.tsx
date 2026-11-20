import type { Metadata } from "next";
import Link from "next/link";
import { SitePage } from "@/components/site-page";
import { waitingForHost } from "@/lib/booking/bookings";
import { NOW } from "@/lib/booking/now-rules";
import { readNotice } from "@/lib/notice";
import { requireUser } from "@/lib/session";
import { RequestList } from "./request-list";

export const metadata: Metadata = { title: "Requests for calls" };

/** The requests a host has to answer. Requests for the same time sit together. */
export default async function HostRequestsPage(props: PageProps<"/host/requests">) {
  const user = await requireUser("/host/requests");
  const notice = readNotice("/host/requests", await props.searchParams);
  const waiting = await waitingForHost(user.id);

  return (
    <SitePage className="mx-auto w-full max-w-2xl px-4 py-10">
      <p className="text-sm">
        <Link href="/host" className="inline-flex min-h-11 items-center underline underline-offset-2">
          ← Hosting
        </Link>
      </p>
      <h1 className="mt-4 text-2xl font-semibold">Requests for calls ({waiting.length})</h1>
      <p className="mt-2 text-sm opacity-70">
        Several people may ask for the same time. Accepting one books the call and tells everyone else whose request it gets in
        the way of. A request you do not answer in time ends by itself.
      </p>
      <p className="mt-2 text-sm opacity-70">
        A request for a call right now is listed here too, but it needs your answer within {NOW.answerMinutes} minutes. Your{" "}
        <Link href="/host/now" className="underline underline-offset-2">
          Available now
        </Link>{" "}
        page shows those the moment they arrive.
      </p>

      {notice && (
        <p role="status" className="mt-4 rounded border border-neutral-400 p-3 text-sm">
          {notice}
        </p>
      )}

      {waiting.length === 0 ? (
        <p className="mt-6 text-sm opacity-70">Nothing is waiting for your answer.</p>
      ) : (
        <div className="mt-6">
          <RequestList hostId={user.id} waiting={waiting} from="requests" />
        </div>
      )}
    </SitePage>
  );
}
