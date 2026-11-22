import type { Metadata } from "next";
import { inArray } from "drizzle-orm";
import Link from "next/link";
import { LocalTime } from "@/components/local-time";
import { SitePage } from "@/components/site-page";
import { db, schema } from "@/db";
import type { HostDebt } from "@/db/schema";
import { debtsForFounder } from "@/lib/disputes/takeback";
import { toGiveBackCents } from "@/lib/disputes/takeback-rules";
import { formatMoney } from "@/lib/payments/access";
import { requireAdmin } from "@/lib/session";

export const metadata: Metadata = { title: "Money hosts owe back" };
export const dynamic = "force-dynamic";

const STATE: Record<string, string> = {
  told: "the host has their notice",
  waiting: "waits for you: the app does not take it by itself",
  objected: "the host objected: waits for your decision",
  answered: "the objection was answered",
  taking: "Stripe is being asked now",
  taken: "taken back",
  settled: "settled outside the app",
  cancelled: "called off",
};

/**
 * Every share a host owes back, whatever it comes from: a lost bank dispute (plans/47) or a refund given after the
 * host had collected (plans/46-part-3-money-owed.md). Each links to the page where the founder decides about it: the
 * dispute's page, or the take-back's own.
 */
export default async function DebtsPage() {
  await requireAdmin();
  const { open, ended } = await debtsForFounder();
  const hostIds = [...new Set([...open, ...ended].map((debt) => debt.hostId))];
  const hosts = hostIds.length > 0 ? await db.select({ id: schema.user.id, name: schema.user.name }).from(schema.user).where(inArray(schema.user.id, hostIds)) : [];
  const nameOf = (id: string) => hosts.find((host) => host.id === id)?.name ?? "a host";
  const row = (debt: HostDebt & { path: string }) => (
    <li key={debt.id} data-debt={debt.id} data-debt-status={debt.status}>
      <Link href={debt.refundId ? `${debt.path}?as=founder` : debt.path} className="underline underline-offset-2">
        {formatMoney(["told", "waiting", "objected", "answered", "taking"].includes(debt.status) ? debt.amountCents : debt.amountCents + debt.byHandCents)} from {nameOf(debt.hostId)}
      </Link>
      , after {debt.refundId ? "a refund" : "a lost bank dispute"}: {STATE[debt.status] ?? debt.status}
      {debt.leftoverToldAt && toGiveBackCents(debt) > 0 ? `; it has since turned out not to be owed: ${formatMoney(toGiveBackCents(debt))} to give back to the host${debt.excessToldCents > 0 ? ` (besides the ${formatMoney(debt.excessToldCents)} you were told about earlier)` : ""}` : ""}
      {debt.overpaidCents > 0 ? `; ${formatMoney(debt.overpaidCents)} was taken on top of it by hand: to give back to the host` : ""}
      {(debt.status === "told" || debt.status === "answered") &&
        (debt.dueAt ? (
          <>
            , due from <LocalTime iso={debt.dueAt.toISOString()} />
          </>
        ) : debt.noticeProblemToldAt ? (
          ", and its email is not confirmed as delivered: nothing is taken until it is sent again"
        ) : (
          ", no day yet: its email has not arrived"
        ))}
      .
    </li>
  );

  return (
    <SitePage className="mx-auto w-full max-w-3xl px-4 py-10">
      <p className="text-sm">
        <Link href="/admin" className="inline-flex min-h-11 items-center underline underline-offset-2">
          ← Admin
        </Link>
      </p>
      <h1 className="mt-4 text-2xl font-semibold">Money hosts owe back</h1>
      <p className="mt-2 text-sm opacity-80">
        A host owes a share back when they had collected it and the payment was then taken back by the customer&apos;s bank, or refunded by you.{" "}
        <Link href="/admin/refund" className="underline underline-offset-2">
          Refund a call
        </Link>
      </p>
      <h2 className="mt-6 text-lg font-semibold">Open</h2>
      {open.length === 0 ? <p className="mt-2 text-sm opacity-70">Nothing is owed at the moment.</p> : <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">{open.map(row)}</ul>}
      <h2 className="mt-6 text-lg font-semibold">Ended (the latest)</h2>
      {ended.length === 0 ? <p className="mt-2 text-sm opacity-70">None yet.</p> : <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">{ended.map(row)}</ul>}
    </SitePage>
  );
}
