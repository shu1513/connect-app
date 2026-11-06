import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LocalTime } from "@/components/local-time";
import { db, schema } from "@/db";
import { roomClosesAt, roomOpensAt } from "@/lib/calls";
import { callForParticipant, formatMoney } from "@/lib/payments/access";
import { syncHold } from "@/lib/payments/hold";
import { cancellationOutcome, paymentBlocksJoin, payOpensAt, payWindow } from "@/lib/payments/rules";
import { requireUser } from "@/lib/session";
import { cancelCallAction } from "./actions";
import { CallRoom } from "./call-room";
import { PayPanel } from "./pay-panel";

function cancelRuleSentence(freeCancelMinutes: number, bookedPrice: string): string {
  if (freeCancelMinutes === 0) return "You can cancel for free at any time before the call starts.";
  const hours = freeCancelMinutes / 60;
  const when = hours === 1 ? "1 hour" : `${hours} hours`;
  return `You can cancel for free until ${when} before the call starts. After that, cancelling costs the full ${bookedPrice}, unless the host chooses to refund you.`;
}

export default async function CallPage(props: PageProps<"/calls/[id]">) {
  const user = await requireUser();
  const { id } = await props.params;
  const access = await callForParticipant(id, user.id);
  // A stranger sees the same "not found" whether or not the call exists.
  if (!access) notFound();
  const { call, role } = access;
  let { payment } = access;
  const now = new Date();

  // Coming back from the bank's approval step, or reloading: ask Stripe for the real state.
  if (payment?.status === "awaiting_payment" && payment.stripePaymentIntentId) {
    payment = await syncHold(payment.id, now).catch(() => payment);
  }

  const otherId = role === "host" ? call.customerId : call.hostId;
  const [other] = await db.select({ name: schema.user.name }).from(schema.user).where(eq(schema.user.id, otherId));
  const bookedPrice = payment ? formatMoney(payment.bookedCents) : null;

  const cancel = cancellationOutcome({
    by: role,
    now,
    startsAt: call.startsAt,
    freeCancelMinutes: call.freeCancelMinutes,
    held: payment?.status === "held",
  });
  const blocked = paymentBlocksJoin({ payment, callEndsAt: call.endsAt, now });

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
          <Link href={`/calls/${call.id}/results`} className="mr-4 underline underline-offset-2">
            Results
          </Link>
          <Link href="/rules" target="_blank" className="underline underline-offset-2 opacity-70">
            The rules
          </Link>
        </p>
      </header>
      <p className="mt-1 text-sm opacity-70">
        Booked: <LocalTime iso={call.startsAt.toISOString()} /> to <LocalTime iso={call.endsAt.toISOString()} />
        {payment
          ? ` · ${formatMoney(payment.pricePer15Cents)} per 15 minutes, up to ${bookedPrice}`
          : " · Free call"}
      </p>

      {call.cancelledAt ? (
        <section className="mt-10">
          <p className="text-lg">This call was cancelled.</p>
          <p className="mt-2">
            <Link href={`/calls/${call.id}/results`} className="underline underline-offset-2">
              See the details
            </Link>
          </p>
        </section>
      ) : payment && blocked === "not_paid" && payment.status === "awaiting_payment" ? (
        role === "customer" ? (
          payWindow({ now, startsAt: call.startsAt, endsAt: call.endsAt }) === "too_early" ? (
            <section className="mt-10">
              <p className="text-lg">
                You can confirm and pay for this call from <LocalTime iso={payOpensAt(call.startsAt).toISOString()} />.
              </p>
              <p className="mt-2 text-sm opacity-70">That is 2 days before it starts.</p>
            </section>
          ) : (
            <PayPanel
              callId={call.id}
              bookedPrice={bookedPrice!}
              pricePer15={formatMoney(payment.pricePer15Cents)}
              cancelRule={cancelRuleSentence(call.freeCancelMinutes, bookedPrice!)}
              billing={call.billing}
            />
          )
        ) : (
          <section className="mt-10">
            <p className="text-lg">Waiting for {other?.name ?? "the customer"} to confirm and pay.</p>
            <p className="mt-2 text-sm opacity-70">The call can only start once {bookedPrice} is held on their card.</p>
          </section>
        )
      ) : blocked ? (
        <section className="mt-10">
          <p className="text-lg">This call cannot go ahead because its payment is no longer in place.</p>
          <p className="mt-2">
            <Link href={`/calls/${call.id}/results`} className="underline underline-offset-2">
              See the details
            </Link>
          </p>
        </section>
      ) : (
        <CallRoom
          callId={call.id}
          userName={user.name}
          startsAt={call.startsAt.toISOString()}
          endsAt={call.endsAt.toISOString()}
          opensAt={roomOpensAt(call).toISOString()}
          closesAt={roomClosesAt(call).toISOString()}
          serverNow={new Date().toISOString()}
        />
      )}

      {!call.cancelledAt && cancel !== "not_allowed" && (
        <form action={cancelCallAction} className="mt-10 border-t border-neutral-400/40 pt-4 text-sm">
          <input type="hidden" name="callId" value={call.id} />
          <p className="opacity-80">
            {cancel === "free"
              ? "Cancelling now is free. Nothing is charged."
              : `Cancelling now is past the free period: the full ${bookedPrice} is charged. The host may choose to refund you.`}
          </p>
          <button type="submit" className="mt-2 rounded border border-red-600 px-3 py-1.5 text-red-600">
            Cancel this call
          </button>
        </form>
      )}
    </main>
  );
}
