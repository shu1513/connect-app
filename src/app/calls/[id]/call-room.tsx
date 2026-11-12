"use client";

import "@livekit/components-styles";
import { LiveKitRoom, PreJoin, VideoConference, type LocalUserChoices } from "@livekit/components-react";
import { DisconnectReason } from "livekit-client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatDuration } from "@/lib/format";
import { PayPanel } from "./pay-panel";

/** More time agreed during this call: the part 2 that starts when this one ends. */
export type NextPartView = {
  id: string;
  startsAt: string;
  lengthMinutes: number;
  /** "$20.00", or null for a free part. */
  price: string | null;
  status: "unpaid" | "ready";
};

type Props = {
  callId: string;
  userName: string;
  otherName: string;
  role: "host" | "customer";
  startsAt: string;
  endsAt: string;
  opensAt: string;
  closesAt: string;
  /** The server's clock when the page was made. Used to correct a wrong device clock. */
  serverNow: string;
  /** For the host: the lengths they can offer as more time, with the price of each (null when free). */
  offerLengths: Array<{ minutes: number; price: string | null }>;
  /** "$20.00" per 15 minutes, or null for a free call. */
  pricePer15: string | null;
  next: NextPartView | null;
};

type Connection = { token: string; serverUrl: string };

/** More time may be offered while at least this long remains (the same rule as on the server). */
const OFFER_WHILE_LEFT_MS = 5 * 60_000;

/**
 * "End call and report": ends the call for both people at once, so nobody
 * can come back in, then goes to the report form. Time after this moment is
 * not counted, and the payment goes to the founder's review list.
 */
function EndForSafety({ callId, onLeave }: { callId: string; onLeave: () => void }) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function endNow() {
    setBusy(true);
    setFailed(false);
    onLeave(); // this person leaves at once, whatever happens next
    const ok = await fetch(`/api/calls/${callId}/end-for-safety`, { method: "POST" })
      .then((r) => r.ok)
      .catch(() => false);
    if (ok) router.push(`/report?call=${callId}`);
    else {
      setFailed(true);
      setBusy(false);
    }
  }
  if (failed) {
    return (
      <span className="flex items-center gap-2 text-sm text-red-600">
        <span>You have left, but the call could not be ended for the other person yet.</span>
        <button type="button" onClick={endNow} className="rounded border border-red-600 px-3 py-1.5">
          Try again
        </button>
      </span>
    );
  }
  if (!asking) {
    return (
      <button type="button" onClick={() => setAsking(true)} className="rounded border border-red-600 px-3 py-1.5 text-sm text-red-600">
        End call and report
      </button>
    );
  }
  return (
    <span className="flex items-center gap-2 text-sm">
      <span>End this call for both of you and report what happened?</span>
      <button type="button" disabled={busy} onClick={endNow} className="rounded bg-red-600 px-3 py-1.5 font-medium text-white disabled:opacity-50">
        {busy ? "Ending…" : "Yes, end and report"}
      </button>
      <button type="button" onClick={() => setAsking(false)} className="underline underline-offset-2">
        No
      </button>
    </span>
  );
}

const clockText = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

/**
 * More time: the host offers it, the customer confirms a card for it (a paid
 * call) right here, and both are taken to the next part when this one ends.
 */
function MoreTime(props: { callId: string; role: "host" | "customer"; otherName: string; now: number; endsAt: number; offerLengths: Props["offerLengths"]; next: NextPartView | null; onChange: (next: NextPartView | null) => void }) {
  const { next, now, endsAt } = props;
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const canOffer = props.role === "host" && !next && endsAt - now >= OFFER_WHILE_LEFT_MS && props.offerLengths.length > 0;
  const partStarted = next ? now >= Date.parse(next.startsAt) : false;

  async function call(path: string, body?: unknown): Promise<{ ok: boolean; body: Record<string, unknown> }> {
    setBusy(true);
    setProblem(null);
    try {
      const response = await fetch(path, { method: "POST", headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
      const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) setProblem(typeof json.error === "string" ? json.error : "Something went wrong. Please try again.");
      return { ok: response.ok, body: json };
    } catch {
      setProblem("Could not reach the server. Check your internet connection and try again.");
      return { ok: false, body: {} };
    } finally {
      setBusy(false);
    }
  }
  async function offer(minutes: number) {
    const { ok, body } = await call(`/api/calls/${props.callId}/extend`, { lengthMinutes: minutes });
    if (ok) await refresh();
    void body;
  }
  async function refresh() {
    const response = await fetch(`/api/calls/${props.callId}/next`).catch(() => null);
    if (response?.ok) props.onChange(((await response.json()) as { next: NextPartView | null }).next);
  }
  async function cancelNext() {
    if (!next) return;
    const { ok } = await call(`/api/calls/${next.id}/cancel`);
    if (ok) props.onChange(null);
  }

  if (!next && !canOffer) return null;
  const buttons = "rounded border border-neutral-500 px-3 py-1.5 text-sm disabled:opacity-50";
  return (
    <section className="mt-3 rounded border border-neutral-400 p-3 text-sm">
      {problem && (
        <p role="alert" className="mb-2 text-red-600">
          {problem}
        </p>
      )}
      {!next ? (
        <>
          <p className="font-medium">Offer more time?</p>
          <p className="mt-1 opacity-70">A second part that starts when this one ends, at the same price. {props.otherName} confirms it on their screen.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {props.offerLengths.map(({ minutes, price }) => (
              <button key={minutes} type="button" disabled={busy} onClick={() => offer(minutes)} className={buttons}>
                {minutes} more minutes{price ? ` (${price})` : ""}
              </button>
            ))}
          </div>
        </>
      ) : props.role === "host" ? (
        <>
          <p className="font-medium">
            {next.lengthMinutes} more minutes from {clockText(next.startsAt)}
            {next.price ? ` (${next.price})` : ""}:{" "}
            {next.status === "unpaid" ? `waiting for ${props.otherName} to confirm their card.` : "confirmed. You will both be taken to the next part when this one ends."}
          </p>
          {!partStarted && (
            <button type="button" disabled={busy} onClick={cancelNext} className={`${buttons} mt-2`}>
              Withdraw the offer
            </button>
          )}
        </>
      ) : next.status === "unpaid" ? (
        <>
          <p className="font-medium">
            {props.otherName} offers {next.lengthMinutes} more minutes{next.price ? ` for ${next.price}` : ""}, starting when this part ends at {clockText(next.startsAt)}.
          </p>
          <p className="mt-1 opacity-70">
            To accept, confirm your card below: {next.price} is held, nothing is charged until after, and you pay only for the time {props.otherName} is in the
            next part. It must be held before {clockText(next.startsAt)}, or the extra time is cancelled and nothing is charged.
          </p>
          <PayPanel callId={next.id} bookedPrice={next.price ?? "$0.00"} pricePer15={next.price ?? "$0.00"} cancelRule="You can cancel the extra time for free at any time before it starts." compact />
          <button type="button" disabled={busy} onClick={cancelNext} className={`${buttons} mt-2`}>
            No thanks
          </button>
        </>
      ) : (
        <>
          <p className="font-medium">
            {next.lengthMinutes} more minutes from {clockText(next.startsAt)}, confirmed. You will both be taken to the next part when this one ends.
          </p>
          {!partStarted && (
            <button type="button" disabled={busy} onClick={cancelNext} className={`${buttons} mt-2`}>
              Cancel the extra time
            </button>
          )}
        </>
      )}
    </section>
  );
}

const alwaysValid = () => true;

/**
 * The camera and microphone check before joining. Kept apart, and given the
 * same settings every time, because the page around it redraws every second
 * for the clock: handed fresh settings each second, the video library would
 * switch the camera off and on again each time.
 */
const Lobby = memo(function Lobby(props: { userName: string; joining: boolean; onJoin: (values: LocalUserChoices) => void; onProblem: (text: string) => void }) {
  const { onJoin, onProblem } = props;
  // The newest handlers, without changing what the video library is given.
  const handlers = useRef({ onJoin, onProblem });
  useEffect(() => {
    handlers.current = { onJoin, onProblem };
  });
  const defaults = useMemo(() => ({ username: props.userName, videoEnabled: true, audioEnabled: true }), [props.userName]);
  const submit = useCallback((values: LocalUserChoices) => handlers.current.onJoin(values), []);
  const problem = useCallback((error: Error) => handlers.current.onProblem(`Camera or microphone problem: ${error.message}`), []);
  return (
    <div className="mt-4 max-w-xl" data-lk-theme="default">
      <PreJoin defaults={defaults} persistUserChoices={false} onValidate={alwaysValid} onSubmit={submit} onError={problem} joinLabel={props.joining ? "Joining…" : "Join call"} />
    </div>
  );
});

export function CallRoom(props: Props) {
  const router = useRouter();
  const startsAt = Date.parse(props.startsAt);
  const endsAt = Date.parse(props.endsAt);
  const opensAt = Date.parse(props.opensAt);
  const closesAt = Date.parse(props.closesAt);

  // "now" follows the server's clock, not the device's. Null until the page is live in the browser.
  const [now, setNow] = useState<number | null>(null);
  // How far this device's clock is from the server's. First estimated when the
  // page loads, then measured more precisely when the person joins.
  const [clockOffset, setClockOffset] = useState<number | null>(null);
  useEffect(() => {
    const offset = clockOffset ?? Date.parse(props.serverNow) - Date.now();
    const update = () => setNow(Date.now() + offset);
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [props.serverNow, clockOffset]);

  const [choices, setChoices] = useState<LocalUserChoices | null>(null);
  const [connection, setConnection] = useState<Connection | null>(null);
  const [joining, setJoining] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [takenOver, setTakenOver] = useState(false);

  // More time: kept fresh from the server every few seconds while the room is open, so both people see
  // the offer, the payment and the move to the next part without reloading.
  const [next, setNext] = useState<NextPartView | null>(props.next);
  // After the page's data is reloaded (for example once a payment went through), start from what the server says.
  const [fromServer, setFromServer] = useState(props.next);
  if (props.next !== fromServer) {
    setFromServer(props.next);
    setNext(props.next);
  }
  const live = now !== null && now < closesAt;
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(async () => {
      const response = await fetch(`/api/calls/${props.callId}/next`).catch(() => null);
      if (response?.ok) setNext(((await response.json()) as { next: NextPartView | null }).next);
    }, 10_000);
    return () => clearInterval(timer);
  }, [props.callId, live]);
  // When this part's time is up and the next part is ready, both people move on to it (once).
  const moved = useRef(false);
  useEffect(() => {
    if (moved.current || now === null || !next || next.status !== "ready" || now < endsAt) return;
    moved.current = true;
    router.push(`/calls/${next.id}`);
  }, [now, next, endsAt, router]);

  async function join(values: LocalUserChoices) {
    setJoining(true);
    setNotice(null);
    try {
      const sentAt = Date.now();
      const response = await fetch(`/api/calls/${props.callId}/token`, { method: "POST" });
      const receivedAt = Date.now();
      const body = await response.json();
      if (!response.ok) {
        // This part is over and more time follows: go there.
        if (typeof body.nextCallId === "string") return router.push(`/calls/${body.nextCallId}`);
        setNotice(body.error ?? "Could not join the call.");
        return;
      }
      // The server's answer carries its clock. Assume it was read halfway through the round trip.
      setClockOffset(Date.parse(body.serverNow) - (sentAt + receivedAt) / 2);
      setChoices(values);
      setConnection({ token: body.token, serverUrl: body.serverUrl });
    } catch {
      setNotice("Could not reach the server. Check your internet connection and try again.");
    } finally {
      setJoining(false);
    }
  }

  function onDisconnected(reason?: DisconnectReason) {
    setConnection(null);
    if (reason === DisconnectReason.DUPLICATE_IDENTITY) {
      setTakenOver(true);
    } else if (reason !== DisconnectReason.CLIENT_INITIATED) {
      setNotice("You were disconnected. You can join again while the room is open.");
    }
  }

  if (now === null) return <p className="mt-10 opacity-70">Loading…</p>;

  const resultsLink = (
    <Link href={`/calls/${props.callId}/results`} className="underline underline-offset-2">
      See the results
    </Link>
  );
  const moreTime = <MoreTime callId={props.callId} role={props.role} otherName={props.otherName} now={now} endsAt={endsAt} offerLengths={props.offerLengths} next={next} onChange={setNext} />;

  if (next && next.status === "ready" && now >= endsAt) {
    return (
      <section className="mt-10">
        <p className="text-lg">This part is over. Taking you to the next part…</p>
        <p className="mt-2">
          <Link href={`/calls/${next.id}`} className="underline underline-offset-2">
            Open it now
          </Link>
        </p>
      </section>
    );
  }

  if (now >= closesAt) {
    return (
      <section className="mt-10">
        <p className="text-lg">This call has ended.</p>
        <p className="mt-2">{resultsLink}</p>
      </section>
    );
  }

  if (now < opensAt) {
    return (
      <section className="mt-10">
        <p className="text-lg">The room opens in {formatDuration((opensAt - now) / 1000)}.</p>
        <p className="mt-2 text-sm opacity-70">
          {props.opensAt === props.startsAt ? "This part opens at its start, when the part before it ends." : "It opens 5 minutes before the booked start."} This page will
          update by itself.
        </p>
      </section>
    );
  }

  const clock =
    now < startsAt
      ? `Starts in ${formatDuration((startsAt - now) / 1000)}`
      : now < endsAt
        ? `Time left ${formatDuration((endsAt - now) / 1000)}`
        : `Time is up. The room closes in ${formatDuration((closesAt - now) / 1000)}`;

  if (takenOver) {
    return (
      <section className="mt-10">
        <p className="text-lg">This call is now open in another tab or device.</p>
        <p className="mt-2 text-sm opacity-70">Only one connection per person is allowed, so this one was disconnected.</p>
        <button
          type="button"
          className="mt-4 rounded bg-blue-600 px-4 py-2 font-medium text-white"
          onClick={() => setTakenOver(false)}
        >
          Use this tab instead
        </button>
      </section>
    );
  }

  if (!connection || !choices) {
    return (
      <section className="mt-6">
        <p className="text-lg font-medium" aria-live="polite">
          {clock}
        </p>
        {notice && (
          <p role="alert" className="mt-2 text-sm text-red-600">
            {notice}
          </p>
        )}
        {moreTime}
        <p className="mt-2 text-sm opacity-70">Check your camera and microphone, then join.</p>
        <Lobby userName={props.userName} joining={joining} onJoin={join} onProblem={setNotice} />
      </section>
    );
  }

  return (
    <section className="mt-4 flex flex-1 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-lg font-medium" aria-live="polite">
          {clock}
        </p>
        <EndForSafety callId={props.callId} onLeave={() => setConnection(null)} />
      </div>
      <div className="mt-3 h-[72vh] min-h-[320px] overflow-hidden rounded" data-lk-theme="default">
        <LiveKitRoom
          token={connection.token}
          serverUrl={connection.serverUrl}
          connect
          video={choices.videoEnabled}
          audio={choices.audioEnabled}
          options={{
            videoCaptureDefaults: { deviceId: choices.videoDeviceId || undefined },
            audioCaptureDefaults: { deviceId: choices.audioDeviceId || undefined },
          }}
          onDisconnected={onDisconnected}
          onError={(error) => setNotice(error.message)}
          style={{ height: "100%" }}
        >
          <VideoConference />
        </LiveKitRoom>
      </div>
      {moreTime}
    </section>
  );
}
