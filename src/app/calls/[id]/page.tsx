import { ConnectionTest } from "@/components/connection-test";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AboutCustomer } from "@/components/about-customer";
import { LocalTime } from "@/components/local-time";
import { gatherCallPage } from "@/lib/call-page/gather";
import { CALL_WORDS, cancelRuleSentence, cancelWords, paidHowWords, payPoints } from "@/lib/call-page/words";
import { roomOpensAt } from "@/lib/calls";
import { readNotice } from "@/lib/notice";
import { payOpensAt } from "@/lib/payments/rules";
import { requireUser } from "@/lib/session";
import { cancelCallAction } from "./actions";
import { CallRoom } from "./call-room";
import { PayPanel } from "./pay-panel";
import { RefreshWhenPaid } from "./refresh-when-paid";

export const metadata: Metadata = { title: "Call" };

/**
 * The connection check starts by itself only when the call is this close: a check a day ahead
 * says nothing about the connection at call time. Earlier, the person can start it with a click.
 */
const TEST_BY_ITSELF_WITHIN_MS = 30 * 60_000;

export default async function CallPage(props: PageProps<"/calls/[id]">) {
  const { id } = await props.params;
  // Reminders link here: someone who has to log in first comes back to this call.
  const user = await requireUser(`/calls/${id}`);
  const now = new Date();
  // What this page shows is gathered in one place, for this page and for the phone app (src/lib/call-page/gather.ts).
  // Coming back from the bank's approval step, or reloading: Stripe is asked for the real state of a waiting hold.
  const page = await gatherCallPage(user.id, id, now, { sync: true });
  // A stranger sees the same "not found" whether or not the call exists.
  if (!page) notFound();
  const { call, role, payment, about, bookedPrice, upTo, cancel, state } = page;
  const other = page.otherName ? { name: page.otherName } : undefined;
  // Only a message this site made for this page is shown (what cancelling means changed while the page was open).
  const notice = readNotice(`/calls/${id}`, await props.searchParams);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-6">
      <header className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h1 className="text-xl font-semibold">
          {CALL_WORDS.title(other?.name ?? "Unknown")}{" "}
          <span className="text-sm font-normal opacity-70">{CALL_WORDS.role(role)}</span>
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
        {` · ${paidHowWords({ kind: payment?.kind ?? null, role, pricePer15: page.pricePer15, upTo })}`}
      </p>
      {notice && (
        <p role="alert" className="mt-4 rounded border border-red-600 p-3 text-sm">
          {notice}
        </p>
      )}

      {state === "cancelled" || state === "ended" ? (
        <section className="mt-10">
          <p className="text-lg">{state === "cancelled" ? CALL_WORDS.cancelled : CALL_WORDS.ended}</p>
          <p className="mt-2">
            <Link href={`/calls/${call.id}/results`} className="underline underline-offset-2">
              {CALL_WORDS.details}
            </Link>
          </p>
        </section>
      ) : payment && (state === "too_early" || state === "pay" || state === "host_waits") ? (
        <>
          {/* The hold may land any second (an instant call's saved card, a booked call about to start): follow it. */}
          {page.follows && <RefreshWhenPaid callId={call.id} paymentStatus={payment.status} until={call.endsAt.toISOString()} />}
          {state === "too_early" ? (
            <section className="mt-10">
              <p className="text-lg">
                {CALL_WORDS.tooEarlyBefore}
                <LocalTime iso={payOpensAt(call.startsAt).toISOString()} />
                {CALL_WORDS.tooEarlyAfter}
              </p>
              <p className="mt-2 text-sm opacity-70">{CALL_WORDS.tooEarlySmall}</p>
            </section>
          ) : state === "pay" ? (
            <PayPanel
              callId={call.id}
              title={CALL_WORDS.payTitle}
              points={payPoints({ pricePer15: page.pricePer15!, bookedPrice: bookedPrice!, billing: call.billing, cancelRule: cancelRuleSentence(call.freeCancelMinutes, bookedPrice!) })}
              button={CALL_WORDS.payButton(bookedPrice!)}
              busyWords={CALL_WORDS.payBusy}
              notHeld={CALL_WORDS.payNotHeld}
              notConfirmed={`${CALL_WORDS.payNotConfirmed} Please reload the page in a moment.`}
              notStarted={CALL_WORDS.payNotStarted}
            />
          ) : (
            <section className="mt-10">
              <p className="text-lg">{CALL_WORDS.hostWaits(other?.name ?? "the customer")}</p>
              <p className="mt-2 text-sm opacity-70">
                {CALL_WORDS.hostWaitsSmall(bookedPrice!)}
                {call.billing === "together" ? CALL_WORDS.updatesByItself : ""}
              </p>
            </section>
          )}
        </>
      ) : state === "blocked" ? (
        <section className="mt-10">
          <p className="text-lg">{CALL_WORDS.blocked}</p>
          <p className="mt-2">
            <Link href={`/calls/${call.id}/results`} className="underline underline-offset-2">
              {CALL_WORDS.details}
            </Link>
          </p>
        </section>
      ) : (
        <>
        {/* Kept outside the call screen, which redraws every second and changes from the countdown to the camera
            check: here the test is never restarted by that. It starts by itself only close to the call. */}
        <ConnectionTest callId={call.id} autoInMs={call.startsAt.getTime() - TEST_BY_ITSELF_WITHIN_MS - now.getTime()} />
        <CallRoom
          callId={call.id}
          userName={user.name}
          startsAt={call.startsAt.toISOString()}
          endsAt={call.endsAt.toISOString()}
          opensAt={roomOpensAt(call).toISOString()}
          serverNow={new Date().toISOString()}
          role={role}
          otherName={other?.name ?? (role === "host" ? "The customer" : "The host")}
          pricePer15Cents={call.pricePer15Cents}
          billing={call.billing}
          whileWaiting={about?.text ? <AboutCustomer name={other?.name ?? "this customer"} text={about.text} /> : null}
        />
        </>
      )}

      {!call.cancelledAt && !call.safetyEndedAt && cancel !== "not_allowed" && (
        <form action={cancelCallAction} className="mt-10 border-t border-neutral-400/40 pt-4 text-sm">
          <input type="hidden" name="callId" value={call.id} />
          {/* What this page says cancelling means. If it has turned from free to charged by the time the button is pressed, nothing is cancelled. */}
          <input type="hidden" name="shown" value={cancel} />
          <p className="opacity-80">{cancelWords({ member: payment?.kind === "member_call", outcome: cancel, bookedPrice, frozen: page.memberFrozen })}</p>
          <button type="submit" className="mt-2 rounded border border-red-600 px-3 py-1.5 text-red-600">
            {CALL_WORDS.cancelButton}
          </button>
        </form>
      )}
    </main>
  );
}
