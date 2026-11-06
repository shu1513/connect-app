import { asc, eq, inArray } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LocalTime } from "@/components/local-time";
import { db, schema } from "@/db";
import { calculateAttendance, type Interval } from "@/lib/attendance/calc";
import { roleOnCall, roomClosesAt, SETTLE_SECONDS } from "@/lib/calls";
import { formatDuration } from "@/lib/format";
import { requireUser } from "@/lib/session";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const EVENT_LABEL: Record<string, string> = {
  participant_joined: "Connected",
  participant_left: "Disconnected",
  participant_connection_aborted: "Connection attempt failed",
  room_started: "Room started",
  room_finished: "Room finished",
};

const toSeconds = (date: Date) => Math.floor(date.getTime() / 1000);
const fromSeconds = (s: number) => new Date(s * 1000).toISOString();

export default async function ResultsPage(props: PageProps<"/calls/[id]/results">) {
  const user = await requireUser();
  const { id } = await props.params;
  if (!UUID.test(id)) notFound();

  const [call] = await db.select().from(schema.calls).where(eq(schema.calls.id, id));
  if (!call || !roleOnCall(call, user.id)) notFound();

  const [events, people] = await Promise.all([
    db
      .select()
      .from(schema.attendanceEvents)
      .where(eq(schema.attendanceEvents.callId, call.id))
      .orderBy(asc(schema.attendanceEvents.providerTime), asc(schema.attendanceEvents.id)),
    db
      .select({ id: schema.user.id, name: schema.user.name })
      .from(schema.user)
      .where(inArray(schema.user.id, [call.hostId, call.customerId])),
  ]);
  const nameOf = new Map(people.map((p) => [p.id, p.name]));
  const who = (identity: string | null) =>
    identity === call.hostId
      ? `${nameOf.get(identity) ?? "Host"} (host)`
      : identity === call.customerId
        ? `${nameOf.get(identity) ?? "Customer"} (customer)`
        : identity
          ? `Unknown (${identity})`
          : "—";

  const now = new Date();
  // The record is final once the room's closing time has passed and late messages
  // have had time to arrive. If the room was actually closed later than planned,
  // the wait is counted from the real closing moment.
  const settledFrom = Math.max(roomClosesAt(call).getTime(), call.closedAt?.getTime() ?? 0);
  const final = now.getTime() >= settledFrom + SETTLE_SECONDS * 1000;

  const result = calculateAttendance(
    { hostId: call.hostId, customerId: call.customerId, start: toSeconds(call.startsAt), end: toSeconds(call.endsAt) },
    events.map((e) => ({
      id: `${e.provider}:${e.providerEventId}`,
      type: e.type,
      identity: e.participantIdentity,
      sessionId: e.participantSessionId,
      time: toSeconds(e.providerTime),
    })),
    { final },
  );

  const booked = toSeconds(call.endsAt) - toSeconds(call.startsAt);
  const status = {
    complete: { label: "Complete", note: "The call is over and the record is consistent.", tone: "text-green-700" },
    in_progress: {
      label: "Not final yet",
      note: result.stillConnected
        ? "Someone is still connected. Totals appear once they disconnect. Refresh this page to update."
        : "The call is still running or has only just ended. Refresh this page to update.",
      tone: "text-amber-700",
    },
    needs_review: {
      label: "Needs review",
      note: "The record is incomplete or contradicts itself, so no totals are shown.",
      tone: "text-red-700",
    },
  }[result.status];

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-10">
      <p className="text-sm">
        <Link href="/" className="underline underline-offset-2">
          ← Your calls
        </Link>
      </p>
      <h1 className="mt-4 text-2xl font-semibold">Call results</h1>
      <p className="mt-1 text-sm opacity-70">
        {who(call.hostId)} and {who(call.customerId)}. Booked <LocalTime iso={call.startsAt.toISOString()} seconds /> to{" "}
        <LocalTime iso={call.endsAt.toISOString()} seconds /> ({formatDuration(booked)}).
      </p>

      <section className="mt-6 rounded border border-neutral-400 p-4">
        <p className={`text-lg font-semibold ${status.tone}`}>{status.label}</p>
        <p className="text-sm opacity-80">{status.note}</p>
        {result.reasons.length > 0 && (
          <ul className="mt-2 list-disc pl-5 text-sm">
            {result.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        )}
        <dl className="mt-4 grid grid-cols-3 gap-4 text-center">
          <Total label="Host time" seconds={result.totals?.hostSeconds} />
          <Total label="Customer time" seconds={result.totals?.customerSeconds} />
          <Total label="Time together" seconds={result.totals?.togetherSeconds} />
        </dl>
        <p className="mt-3 text-xs opacity-70">
          Connected time as reported by the video service, counted only inside the booked window.
          {call.closedAt ? " Room confirmed closed." : " Room not confirmed closed yet."}
        </p>
      </section>

      <h2 className="mt-8 text-lg font-semibold">Finished connected periods inside the booked window</h2>
      <div className="mt-2 grid gap-4 sm:grid-cols-3">
        <Periods title="Host" intervals={result.hostIntervals} />
        <Periods title="Customer" intervals={result.customerIntervals} />
        <Periods title="Together" intervals={result.togetherIntervals} />
      </div>

      <h2 className="mt-8 text-lg font-semibold">Messages received from the video service</h2>
      {events.length === 0 ? (
        <p className="mt-2 text-sm opacity-70">None yet.</p>
      ) : (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-neutral-400">
              <tr>
                <th className="py-2 pr-4 font-medium">Time</th>
                <th className="py-2 pr-4 font-medium">What</th>
                <th className="py-2 pr-4 font-medium">Who</th>
                <th className="py-2 font-medium">Connection</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id} className="border-b border-neutral-300/40">
                  <td className="py-1.5 pr-4 whitespace-nowrap">
                    <LocalTime iso={e.providerTime.toISOString()} seconds />
                  </td>
                  <td className="py-1.5 pr-4">{EVENT_LABEL[e.type] ?? e.type}</td>
                  <td className="py-1.5 pr-4">{who(e.participantIdentity)}</td>
                  <td className="py-1.5 font-mono text-xs">{e.participantSessionId ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

function Total({ label, seconds }: { label: string; seconds: number | undefined }) {
  return (
    <div>
      <dt className="text-sm opacity-70">{label}</dt>
      <dd className="text-2xl font-semibold tabular-nums">{seconds === undefined ? "Not known yet" : formatDuration(seconds)}</dd>
    </div>
  );
}

function Periods({ title, intervals }: { title: string; intervals: Interval[] }) {
  return (
    <div>
      <h3 className="text-sm font-medium">{title}</h3>
      {intervals.length === 0 ? (
        <p className="text-sm opacity-70">None</p>
      ) : (
        <ul className="text-sm tabular-nums">
          {intervals.map((i) => (
            <li key={i.start}>
              <LocalTime iso={fromSeconds(i.start)} seconds /> → <LocalTime iso={fromSeconds(i.end)} seconds /> (
              {formatDuration(i.end - i.start)})
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
