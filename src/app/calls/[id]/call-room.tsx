"use client";

import "@livekit/components-styles";
import { LiveKitRoom, PreJoin, VideoConference, type LocalUserChoices } from "@livekit/components-react";
import { DisconnectReason } from "livekit-client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatDuration } from "@/lib/format";

type Props = {
  callId: string;
  userName: string;
  startsAt: string;
  endsAt: string;
  opensAt: string;
  closesAt: string;
  /** The server's clock when the page was made. Used to correct a wrong device clock. */
  serverNow: string;
};

type Connection = { token: string; serverUrl: string };

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

  async function join(values: LocalUserChoices) {
    setJoining(true);
    setNotice(null);
    try {
      const sentAt = Date.now();
      const response = await fetch(`/api/calls/${props.callId}/token`, { method: "POST" });
      const receivedAt = Date.now();
      const body = await response.json();
      if (!response.ok) {
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
        <p className="mt-2 text-sm opacity-70">It opens 5 minutes before the booked start. This page will update by itself.</p>
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
    </section>
  );
}
