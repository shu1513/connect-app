import Link from "next/link";
import { db, schema } from "@/db";
import { requireAdmin } from "@/lib/session";
import { createCall } from "./actions";

export default async function NewCallPage(props: PageProps<"/calls/new">) {
  // A testing tool: it lists every account and can pair any two people. Admins only.
  const user = await requireAdmin();
  const { error } = await props.searchParams;
  const people = await db
    .select({ id: schema.user.id, name: schema.user.name })
    .from(schema.user)
    .orderBy(schema.user.name);

  const field = "mt-1 w-full rounded border border-neutral-400 bg-transparent px-3 py-2";

  return (
    <main className="mx-auto w-full max-w-md px-4 py-10">
      <p className="text-sm">
        <Link href="/" className="underline underline-offset-2">
          ← Your calls
        </Link>
      </p>
      <h1 className="mt-4 text-2xl font-semibold">Create a test call</h1>
      <p className="mt-2 text-sm opacity-70">
        This page stands in for the calendar, which comes in a later step.
      </p>

      {typeof error === "string" && (
        <p role="alert" className="mt-4 text-sm text-red-600">
          {error}
        </p>
      )}

      <form action={createCall} className="mt-6 space-y-4">
        <label className="block text-sm">
          Host
          <select name="hostId" defaultValue={user.id} className={field}>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          Customer
          <select name="customerId" defaultValue="" required className={field}>
            <option value="" disabled>
              Choose…
            </option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          Starts in (minutes from now)
          <input name="startsInMinutes" type="number" min={0} max={1440} step="any" defaultValue={2} required className={field} />
        </label>
        <label className="block text-sm">
          Length (minutes)
          <input name="durationMinutes" type="number" min={1} max={240} step="any" defaultValue={15} required className={field} />
        </label>
        <label className="block text-sm">
          Price per 15 minutes, in US dollars (0 for a free call, otherwise at least 5)
          <input name="pricePer15" type="number" min={0} step="0.01" defaultValue={0} required className={field} />
        </label>
        <p className="text-sm opacity-70">
          The room opens 5 minutes before the start and closes 1 minute after the end. A paid call needs a host
          who has set up payouts, and the customer confirms and pays on the call&apos;s page.
        </p>
        <button type="submit" className="rounded bg-blue-600 px-4 py-2 font-medium text-white">
          Create call
        </button>
      </form>
    </main>
  );
}
