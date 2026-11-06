import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LocalTime } from "@/components/local-time";
import { db, schema } from "@/db";
import { roleOnCall, roomClosesAt, roomOpensAt } from "@/lib/calls";
import { requireUser } from "@/lib/session";
import { CallRoom } from "./call-room";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function CallPage(props: PageProps<"/calls/[id]">) {
  const user = await requireUser();
  const { id } = await props.params;
  if (!UUID.test(id)) notFound();

  const [call] = await db.select().from(schema.calls).where(eq(schema.calls.id, id));
  const role = call ? roleOnCall(call, user.id) : null;
  // A stranger sees the same "not found" whether or not the call exists.
  if (!call || !role) notFound();

  const otherId = role === "host" ? call.customerId : call.hostId;
  const [other] = await db.select({ name: schema.user.name }).from(schema.user).where(eq(schema.user.id, otherId));

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-6">
      <header className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h1 className="text-xl font-semibold">
          Call with {other?.name ?? "Unknown"}{" "}
          <span className="text-sm font-normal opacity-70">(you are the {role})</span>
        </h1>
        <p className="text-sm">
          <Link href="/" className="mr-4 underline underline-offset-2">
            Your calls
          </Link>
          <Link href={`/calls/${call.id}/results`} className="underline underline-offset-2">
            Results
          </Link>
        </p>
      </header>
      <p className="mt-1 text-sm opacity-70">
        Booked: <LocalTime iso={call.startsAt.toISOString()} /> to <LocalTime iso={call.endsAt.toISOString()} />
      </p>

      <CallRoom
        callId={call.id}
        userName={user.name}
        startsAt={call.startsAt.toISOString()}
        endsAt={call.endsAt.toISOString()}
        opensAt={roomOpensAt(call).toISOString()}
        closesAt={roomClosesAt(call).toISOString()}
        serverNow={new Date().toISOString()}
      />
    </main>
  );
}
