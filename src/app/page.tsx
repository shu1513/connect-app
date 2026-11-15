import { desc, eq, inArray, or } from "drizzle-orm";
import Link from "next/link";
import { LocalTime } from "@/components/local-time";
import { db, schema } from "@/db";
import type { Payment } from "@/db/schema";
import { requestsOfCustomer, waitingForHost } from "@/lib/booking/bookings";
import { roomState } from "@/lib/calls";
import { readNotice } from "@/lib/notice";
import { callsToRate } from "@/lib/ratings/ratings";
import { formatMoney } from "@/lib/payments/access";
import { getSignedIn, requireUser } from "@/lib/session";
import { SitePage } from "@/components/site-page";

const REQUEST_LABEL: Record<string, string> = {
  card: "card details needed to send it",
  waiting: "waiting for the host's answer",
  declined: "the host could not take it",
  passed_over: "the host accepted another request for that time",
  ran_out: "ended without an answer",
  taken_back: "you took it back",
};
const STATE_LABEL = { not_open_yet: "Not open yet", open: "Open now", closed: "Ended" } as const;

/**
 * What the list says about a call's money. Whether the call is free or still unpaid is read from
 * its own payment; what is held and what was charged are added up over every payment of the call,
 * each on its own (the call's own payment can end uncharged while added time was charged).
 */
function paymentLine(all: Payment[]): string {
  const own = all.find((p) => p.extensionId === null);
  if (!own) return "Free";
  if (own.status === "awaiting_payment") return `${formatMoney(own.bookedCents)}, not paid yet`;
  const charged = all.filter((p) => p.status === "charged");
  const held = all.filter((p) => p.status === "held");
  const parts: string[] = [];
  if (charged.length > 0) parts.push(`Charged ${formatMoney(charged.reduce((sum, p) => sum + (p.chargedCents ?? 0) - p.refundedCents, 0))}`);
  if (held.length > 0) parts.push(`${formatMoney(held.reduce((sum, p) => sum + p.bookedCents, 0))} held${held.some((p) => p.needsReview) ? ", needs review" : ""}`);
  return parts.length > 0 ? parts.join(", ") : "Not charged";
}

/** What a visitor sees at the front address: what Connect is, and the ways in. */
function FrontPage() {
  const button = "rounded px-4 py-2 font-medium";
  return (
    <SitePage className="mx-auto w-full max-w-2xl px-4 py-14">
      <h1 className="text-3xl font-semibold">A private video call, one to one</h1>
      <p className="mt-3">
        On Connect you book a video call with a host: someone whose advice, company or conversation you want. Just the two of you, for the
        time you choose.
      </p>

      <ol className="mt-8 list-decimal space-y-3 pl-5 text-sm">
        <li>
          <span className="font-medium">Find a host.</span> Search by name, or by the name they use on social media.
        </li>
        <li>
          <span className="font-medium">Ask for a time.</span> The host says yes or no. Nothing is charged when you ask.
        </li>
        <li>
          <span className="font-medium">Talk.</span> You are charged after the call, and only for the time that counted. Calls are never recorded.
        </li>
      </ol>

      <form action="/search" method="get" className="mt-8 flex max-w-md gap-2">
        <label className="flex-1 text-sm">
          <span className="sr-only">Find a host by name, handle or social media name</span>
          <input name="q" type="search" maxLength={50} placeholder="Find a host: name, @handle or social media name" className="w-full rounded border border-neutral-400 bg-transparent px-3 py-2" />
        </label>
        <button type="submit" className="rounded border border-neutral-500 px-3 py-2 text-sm">
          Search
        </button>
      </form>

      <p className="mt-8 flex flex-wrap gap-3">
        <Link href="/signup" className={`${button} bg-blue-600 text-white`}>
          Create an account
        </Link>
        <Link href="/login" className={`${button} border border-neutral-500`}>
          Log in
        </Link>
      </p>
      <p className="mt-6 text-sm opacity-80">Want to take calls yourself? Create an account, then open &quot;Hosting&quot; to set up your page.</p>
    </SitePage>
  );
}

export default async function HomePage(props: PageProps<"/">) {
  // Nobody logged in: the front page. Someone part-way through signing up is still sent to their next step.
  if (!(await getSignedIn())) return <FrontPage />;
  const user = await requireUser();
  const notice = readNotice("/", await props.searchParams);

  const calls = await db
    .select()
    .from(schema.calls)
    .where(or(eq(schema.calls.hostId, user.id), eq(schema.calls.customerId, user.id)))
    .orderBy(desc(schema.calls.startsAt));

  // Only the names of the people this person has calls with.
  const otherIds = [...new Set(calls.map((c) => (c.hostId === user.id ? c.customerId : c.hostId)))];
  const people =
    otherIds.length > 0
      ? await db
          .select({ id: schema.user.id, name: schema.user.name })
          .from(schema.user)
          .where(inArray(schema.user.id, otherIds))
      : [];
  const nameOf = new Map(people.map((p) => [p.id, p.name]));
  // A customer knows their host by the display name on the host's page, never by the host's account name.
  const myHostIds = [...new Set(calls.filter((c) => c.customerId === user.id).map((c) => c.hostId))];
  const hostProfiles = myHostIds.length > 0 ? await db.select({ userId: schema.hostProfiles.userId, displayName: schema.hostProfiles.displayName }).from(schema.hostProfiles).where(inArray(schema.hostProfiles.userId, myHostIds)) : [];
  const hostNameOf = new Map(hostProfiles.map((p) => [p.userId, p.displayName]));

  const callIds = calls.map((c) => c.id);
  // Every payment of each call: its own, and one for each time more time was added during it.
  const payments = callIds.length > 0 ? await db.select().from(schema.payments).where(inArray(schema.payments.callId, callIds)) : [];
  const paymentsOf = new Map<string, Payment[]>();
  for (const p of payments) paymentsOf.set(p.callId, [...(paymentsOf.get(p.callId) ?? []), p]);
  const now = new Date();
  const [requests, toAnswer, toRate] = await Promise.all([requestsOfCustomer(user.id, now), waitingForHost(user.id), callsToRate(user.id, now)]);

  return (
    <SitePage className="mx-auto w-full max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-semibold">Your calls</h1>
      <p className="mt-2 text-sm">
        <Link href="/contacts" className="underline underline-offset-2">
          People you have talked to
        </Link>
      </p>

      <form action="/search" method="get" className="mt-6 flex max-w-md gap-2">
        <label className="flex-1 text-sm">
          <span className="sr-only">Find a host by name, handle or social media name</span>
          <input name="q" type="search" maxLength={50} placeholder="Find a host: name, @handle or social media name" className="w-full rounded border border-neutral-400 bg-transparent px-3 py-2" />
        </label>
        <button type="submit" className="rounded border border-neutral-500 px-3 py-2 text-sm">
          Search
        </button>
      </form>

      {notice && (
        <p role="status" className="mt-6 rounded border border-neutral-400 p-3 text-sm">
          {notice}
        </p>
      )}

      {toRate.length > 0 && (
        <section className="mt-6 rounded border border-blue-600 p-3 text-sm">
          <h2 className="font-semibold">Waiting for your rating</h2>
          <ul className="mt-1 space-y-1">
            {toRate.map((call) => (
              <li key={call.callId}>
                <Link href={`/calls/${call.callId}/results`} className="underline underline-offset-2">
                  Rate your call with {call.otherName}
                </Link>{" "}
                <span className="opacity-70">
                  (<LocalTime iso={call.endsAt.toISOString()} />)
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {user.paused && (
        <p className="mt-6 rounded border border-red-600 p-3 text-sm">
          Your account is paused: you can look, but not book, host or join calls.{" "}
          <Link href="/paused" className="underline underline-offset-2">
            Why, and what to do
          </Link>
        </p>
      )}

      {toAnswer.length > 0 && (
        <p className="mt-6 rounded border border-blue-600 p-3 text-sm">
          You have {toAnswer.length} {toAnswer.length === 1 ? "request" : "requests"} for a call waiting for your answer.{" "}
          <Link href="/host/requests" className="underline underline-offset-2">
            See {toAnswer.length === 1 ? "it" : "them"}
          </Link>
        </p>
      )}

      {requests.length > 0 && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold">Your requests</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {requests.map(({ booking, hostName }) => (
              <li key={booking.id}>
                <Link href={`/bookings/${booking.id}`} className="underline underline-offset-2">
                  {hostName}, <LocalTime iso={booking.startsAt.toISOString()} />
                </Link>
                : {REQUEST_LABEL[booking.stage] ?? booking.stage}
              </li>
            ))}
          </ul>
        </section>
      )}

      {calls.length === 0 ? (
        <p className="mt-8 opacity-70">
          No calls yet. To ask for one, find a host with the search box above. To take calls yourself, open{" "}
          <Link href="/host" className="underline underline-offset-2">
            Hosting
          </Link>
          .
        </p>
      ) : (
        <div className="mt-8 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-neutral-400">
              <tr>
                <th className="py-2 pr-4 font-medium">Starts</th>
                <th className="py-2 pr-4 font-medium">With</th>
                <th className="py-2 pr-4 font-medium">You are</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 pr-4 font-medium">Payment</th>
                <th className="py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {calls.map((call) => {
                const isHost = call.hostId === user.id;
                const state = roomState(call, now);
                const paymentText = paymentLine(paymentsOf.get(call.id) ?? []);
                return (
                  <tr key={call.id} className="border-b border-neutral-300/40">
                    <td className="py-2 pr-4">
                      <LocalTime iso={call.startsAt.toISOString()} />
                    </td>
                    <td className="py-2 pr-4">{(isHost ? nameOf.get(call.customerId) : (hostNameOf.get(call.hostId) ?? nameOf.get(call.hostId))) ?? "Unknown"}</td>
                    <td className="py-2 pr-4">{isHost ? "Host" : "Customer"}</td>
                    <td className="py-2 pr-4">{call.cancelledAt ? "Cancelled" : call.safetyEndedAt ? "Ended" : STATE_LABEL[state]}</td>
                    <td className="py-2 pr-4">{paymentText}</td>
                    <td className="py-2 whitespace-nowrap">
                      {state !== "closed" && !call.cancelledAt && !call.safetyEndedAt && (
                        <Link href={`/calls/${call.id}`} className="mr-4 underline underline-offset-2">
                          Open
                        </Link>
                      )}
                      <Link href={`/calls/${call.id}/results`} className="underline underline-offset-2">
                        Results
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </SitePage>
  );
}
