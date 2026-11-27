"use client";

import "@livekit/components-styles";
import { LiveKitRoom, PreJoin, VideoConference, type LocalUserChoices } from "@livekit/components-react";
import { DisconnectReason } from "livekit-client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { END_WORDS, endCostFor } from "@/lib/call-page/end-words";
import { ROOM_WORDS } from "@/lib/call-page/room-words";
import { CLOSE_LATE_SECONDS } from "@/lib/calls";
import { ACCEPT_CLOSES_SECONDS, ASK_CLOSES_SECONDS, ASK_OPENS_SECONDS, choicesThatFit, COUNTDOWN_SECONDS, extensionPriceCents, MAX_EXTENSION_MINUTES, MIN_EXTENSION_MINUTES, WATCH_SECONDS } from "@/lib/extend/rules";
import { JOINING_EVENT } from "@/components/connection-test";
import { formatDuration } from "@/lib/format";
import { QualityNotes } from "./quality-notes";

type Props = {
  callId: string;
  userName: string;
  startsAt: string;
  /** The call's end when the page was made. It moves when time is added; the screen follows it. */
  endsAt: string;
  opensAt: string;
  /** The server's clock when the page was made. Used to correct a wrong device clock. */
  serverNow: string;
  role: "host" | "customer";
  /** The other person, as this person knows them. */
  otherName: string;
  /** Zero for a free call. */
  pricePer15Cents: number;
  /** What the call charges: the host's time ("host", a booked call) or the time both were in ("together", an "available now" call). */
  billing: string;
  /** This call's booking was made under words that say "End call now" costs a customer his whole booked time. The button's question follows it, and so does the charge. */
  wholeBookingSaid: boolean;
  /**
   * Shown only while this person waits to join: before the room opens, and in the camera check.
   * For a host it is their private note about the customer (plans/32). It is never drawn next to
   * the call itself: the call screen can share the screen, and the note must not be on it.
   */
  whileWaiting?: ReactNode;
};

type Connection = { token: string; serverUrl: string };

/** What the server says about the call near its end (see /api/calls/[id]/live). */
type Live = {
  endsAt: string;
  serverNow: string;
  cancelled: boolean;
  safetyEnded: boolean;
  /** The request for more time that is waiting. Not `ready` while its money is still being held. */
  extension: { id: string; minutes: number; priceCents: number; ready: boolean } | null;
  lastExtension: { id: string; minutes: number; status: string } | null;
  /** For the customer, while the server's clock says asking is open: how many more minutes fit. */
  addTime: { fits: number; pricePer15Cents: number; membershipCovers?: number } | null;
};

/** What the screen showed for a request on a member's call, sent along so the server never charges a way or a price that was not shown. */
type Shown = { paidFrom: "membership" } | { paidFrom: "card"; priceCents: number };

const POLL_MS = 2_000;
const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const minutesText = (minutes: number) => `${minutes} more minute${minutes === 1 ? "" : "s"}`;

/**
 * The customer's side of adding time: the choices that fit, each with its
 * price, and a box for another number of minutes.
 */
function AddTime(props: { fits: number; pricePer15Cents: number; membershipCovers?: number; busy: boolean; onAsk: (minutes: number, shown?: Shown) => void }) {
  const [other, setOther] = useState(false);
  const [typed, setTyped] = useState("");
  const paid = props.pricePer15Cents > 0;
  // A call booked with a membership: a request the membership covers is paid from it; a longer one by card, all of it.
  const member = props.membershipCovers !== undefined;
  const fromMembership = (minutes: number) => member && minutes <= (props.membershipCovers ?? 0);
  const shownFor = (minutes: number): Shown | undefined =>
    !member ? undefined : fromMembership(minutes) ? { paidFrom: "membership" } : { paidFrom: "card", priceCents: extensionPriceCents(props.pricePer15Cents, minutes) };
  const priceWords = (minutes: number) =>
    !paid ? "" : fromMembership(minutes) ? "from your membership" : `${dollars(extensionPriceCents(props.pricePer15Cents, minutes))}${member ? " by card" : ""}`;
  const label = (minutes: number) => `+${minutes} min${paid ? ` ${member ? "· " : ""}${priceWords(minutes)}` : ""}`;
  const button = "rounded border border-blue-600 px-3 py-1.5 text-sm font-medium text-blue-600 disabled:opacity-50";
  if (props.fits < MIN_EXTENSION_MINUTES) {
    return <p className="text-sm opacity-80">Time cannot be added to this call: one of you has something else right after it.</p>;
  }
  const typedMinutes = Number(typed);
  const typedOk = Number.isInteger(typedMinutes) && typedMinutes >= MIN_EXTENSION_MINUTES && typedMinutes <= props.fits;
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">Add time:</span>
        {choicesThatFit(props.fits).map((minutes) => (
          <button key={minutes} type="button" disabled={props.busy} onClick={() => props.onAsk(minutes, shownFor(minutes))} className={button}>
            {label(minutes)}
          </button>
        ))}
        {!other ? (
          <button type="button" disabled={props.busy} onClick={() => setOther(true)} className={button}>
            Other
          </button>
        ) : (
          <span className="flex items-center gap-2 text-sm">
            <input
              type="number"
              inputMode="numeric"
              min={MIN_EXTENSION_MINUTES}
              max={props.fits}
              step={1}
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              aria-label="Minutes to add"
              className="w-20 rounded border border-neutral-400 bg-transparent px-2 py-1"
            />
            <span>minutes{paid && typedOk ? ` (${priceWords(typedMinutes)})` : ""}</span>
            <button type="button" disabled={props.busy || !typedOk} onClick={() => props.onAsk(typedMinutes, shownFor(typedMinutes))} className={button}>
              Ask
            </button>
          </span>
        )}
      </div>
      <p className="mt-1 text-xs opacity-70">
        {props.fits < MAX_EXTENSION_MINUTES ? `You can add up to ${props.fits} more minutes. ` : ""}
        {member
          ? (props.membershipCovers ?? 0) >= MIN_EXTENSION_MINUTES
            ? `Up to ${props.membershipCovers} more minutes are taken from your membership time, and are back if the host says no. A longer request is paid by card, all of it: the price is held on your membership's card when you ask, and let go if the host says no.`
            : "Your membership time does not cover more time on this call, so it is paid by card: the price is held on your membership's card when you ask, and let go if the host says no."
          : paid
            ? "The price is held on your card when you ask, and let go if the host says no."
            : "The host is asked right away."}
      </p>
    </div>
  );
}

/**
 * "End call now": ends the call for both people at once, so nobody can come back in, then goes to
 * the screen with the three choices ("Report", "Block", "Neither"). Time after this moment is not
 * counted. The question before it says what the press costs the person who presses.
 */
function EndNow({ sure, onEnd }: { sure: string; onEnd: () => void }) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <button type="button" onClick={() => setAsking(true)} className="rounded border border-red-600 px-3 py-1.5 text-sm text-red-600">
        {ROOM_WORDS.endNow}
      </button>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-2 text-sm" role="alertdialog" aria-label={ROOM_WORDS.endNow}>
      <span>{sure}</span>
      <button type="button" onClick={onEnd} className="rounded bg-red-600 px-3 py-1.5 font-medium text-white">
        {ROOM_WORDS.endNowYes}
      </button>
      <button type="button" onClick={() => setAsking(false)} className="underline underline-offset-2">
        {ROOM_WORDS.endNowNo}
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
      <PreJoin defaults={defaults} persistUserChoices={false} onValidate={alwaysValid} onSubmit={submit} onError={problem} joinLabel={props.joining ? ROOM_WORDS.joining : ROOM_WORDS.join} />
    </div>
  );
});

export function CallRoom(props: Props) {
  const startsAt = Date.parse(props.startsAt);
  const opensAt = Date.parse(props.opensAt);
  // The call's end as far as this screen knows. It only ever moves later (when time is added).
  const [endsAt, setEndsAt] = useState(() => Date.parse(props.endsAt));
  const knownEnd = useRef(Date.parse(props.endsAt));
  const [added, setAdded] = useState<string | null>(null);
  /** Takes over a later end from the server. The end never moves back. */
  const followEnd = useCallback((serverEnd: number) => {
    if (!(serverEnd > knownEnd.current)) return;
    setAdded(`${Math.round((serverEnd - knownEnd.current) / 60_000)} minutes added.`);
    knownEnd.current = serverEnd;
    setEndsAt(serverEnd);
  }, []);
  const closesAt = endsAt + CLOSE_LATE_SECONDS * 1000;

  // "now" follows the server's clock, not the device's. Null until the page is live in the browser.
  const [now, setNow] = useState<number | null>(null);
  // How far this device's clock is from the server's. First estimated when the
  // page loads, then measured more precisely when the person joins.
  const [clockOffset, setClockOffset] = useState<number | null>(null);
  // The same reading of the server's clock, for the background notes about connection quality.
  const offsetNow = useRef(0);
  const serverNow = useCallback(() => Date.now() + offsetNow.current, []);
  useEffect(() => {
    const offset = clockOffset ?? Date.parse(props.serverNow) - Date.now();
    offsetNow.current = offset;
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
  // "End call now": this person leaves at once, whatever happens next. Kept here, not inside the
  // call screen, so that if the call could not be ended for the other person, that is still shown (with
  // a way to try again) after this person is out of the room.
  const router = useRouter();
  const [ending, setEnding] = useState<"no" | "busy" | "failed">("no");
  async function endNow() {
    setEnding("busy");
    setConnection(null);
    const ok = await fetch(`/api/calls/${props.callId}/end-now`, { method: "POST" })
      .then((r) => r.ok)
      .catch(() => false);
    // On to the three choices. That page says who really ended the call, from what the server wrote down.
    if (ok) router.push(`/calls/${props.callId}/ended`);
    else setEnding("failed");
  }

  // --- Near the end: the countdown, and adding time -------------------------------------------
  const [live, setLive] = useState<Live | null>(null);
  /** The end this screen has asked the server about one last time. The call only ends on screen once that is done. */
  const [checkedEnd, setCheckedEnd] = useState<number | null>(null);
  const [asking, setAsking] = useState(false);
  const [answering, setAnswering] = useState(false);
  const [myRequest, setMyRequest] = useState<string | null>(null);
  const [extendNotice, setExtendNotice] = useState<string | null>(null);
  // Whether the request being sent is paid by card (so the wait is for the bank), or from a membership or free (nothing to wait for).
  const [askingByCard, setAskingByCard] = useState(false);

  // Answers can arrive out of order. One that was asked for before an answer already on screen is
  // dropped: otherwise a slow, older answer could put a request back on screen after it was accepted,
  // and it would stay there, because the screen stops asking once the end has moved.
  const asked = useRef(0);
  const shown = useRef(0);

  /** Asks the server where the call stands. A later end is taken over; the end never moves back. Returns the server's answer, or null when there was none. */
  const refresh = useCallback(async (): Promise<Live | null> => {
    const order = ++asked.current;
    const control = new AbortController();
    const giveUp = setTimeout(() => control.abort(), 4_000);
    try {
      const sentAt = Date.now();
      const response = await fetch(`/api/calls/${props.callId}/live`, { cache: "no-store", signal: control.signal });
      const receivedAt = Date.now();
      if (!response.ok) return null;
      const body = (await response.json()) as Live;
      if (order < shown.current) return body;
      shown.current = order;
      // A quick answer is also the best reading of the server's clock there is: keep this screen's clock on it,
      // so the countdown and the last seconds for asking and accepting match what the server will allow.
      if (receivedAt - sentAt < 1_000) {
        const measured = Date.parse(body.serverNow) - receivedAt;
        setClockOffset((known) => (known !== null && Math.abs(known - measured) < 300 ? known : measured));
      }
      setLive(body);
      followEnd(Date.parse(body.endsAt));
      return body;
    } catch {
      // The next ask tries again.
      return null;
    } finally {
      clearTimeout(giveUp);
    }
  }, [props.callId, followEnd]);

  const roomOpen = now !== null && now >= opensAt;
  const watching = roomOpen && now < closesAt && endsAt - now <= WATCH_SECONDS * 1000;
  useEffect(() => {
    if (!watching) return;
    const first = setTimeout(() => void refresh(), 0);
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [watching, refresh]);

  // When the clock reaches the end, ask the server once more before ending the call on screen: the
  // host may have added time a moment ago, and a slow connection must not cut anyone off from that.
  const lastCheck = useRef<number | null>(null);
  const timeUp = now !== null && now >= closesAt;
  useEffect(() => {
    if (!timeUp || lastCheck.current === endsAt) return;
    lastCheck.current = endsAt;
    const checking = endsAt;
    // Asked once per end, and never cancelled: without an answer the call would not end on screen.
    // The call only ends on screen when the server has answered (a later end in that answer is taken
    // over above, and the call goes on). A server that cannot be reached is asked again for half a
    // minute by the clock (however long each try takes to give up); only then is the call taken to be over.
    const settle = async () => {
      const giveUpAt = Date.now() + 30_000;
      while (!(await refresh()) && Date.now() < giveUpAt) await new Promise((resolve) => setTimeout(resolve, 1_500));
      setCheckedEnd(checking);
    };
    setTimeout(() => void settle(), 0);
  }, [timeUp, endsAt, refresh]);

  // "10 minutes added." is news for a moment, not for the rest of the call.
  useEffect(() => {
    if (!added) return;
    const timer = setTimeout(() => setAdded(null), 20_000);
    return () => clearTimeout(timer);
  }, [added]);

  async function askFor(minutes: number, shown?: Shown) {
    setAsking(true);
    setAskingByCard(props.pricePer15Cents > 0 && shown?.paidFrom !== "membership");
    setExtendNotice(null);
    try {
      const response = await fetch(`/api/calls/${props.callId}/extend`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ minutes, shown }) });
      const body = await response.json().catch(() => ({}));
      if (response.ok) setMyRequest(body.extensionId);
      else setExtendNotice(body.error ?? "Time could not be added.");
    } catch {
      setExtendNotice("Could not reach the server. Nothing was added.");
    } finally {
      await refresh();
      setAsking(false);
    }
  }

  async function answer(extensionId: string, accept: boolean) {
    setAnswering(true);
    setExtendNotice(null);
    try {
      const response = await fetch(`/api/calls/${props.callId}/extend/answer`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ extensionId, accept }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) setExtendNotice(body.error ?? "That did not work.");
    } catch {
      setExtendNotice("Could not reach the server. Nothing was changed.");
    } finally {
      await refresh();
      setAnswering(false);
    }
  }

  async function join(values: LocalUserChoices) {
    // A connection check that is still running stops at once. Joining does not wait for anything to do with it.
    window.dispatchEvent(new Event(JOINING_EVENT));
    setJoining(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/calls/${props.callId}/token`, { method: "POST" });
      const receivedAt = Date.now();
      const body = await response.json();
      if (!response.ok) {
        setNotice(body.error ?? ROOM_WORDS.couldNotJoin);
        return;
      }
      // The server's answer carries its clock, read just before the answer was sent. (Not "halfway through
      // the round trip": the join check can take many seconds, and the clock would then run that much ahead.)
      setClockOffset(Date.parse(body.serverNow) - receivedAt);
      // The join check knows the call's end as it is now (time may have been added since the page was made).
      followEnd(Date.parse(body.endsAt));
      setChoices(values);
      setConnection({ token: body.token, serverUrl: body.serverUrl });
    } catch {
      setNotice(ROOM_WORDS.notReached);
    } finally {
      setJoining(false);
    }
  }

  function onDisconnected(reason?: DisconnectReason) {
    setConnection(null);
    if (reason === DisconnectReason.DUPLICATE_IDENTITY) {
      setTakenOver(true);
    } else if (reason !== DisconnectReason.CLIENT_INITIATED) {
      setNotice(ROOM_WORDS.disconnected);
      // The other person may have ended the call for both ("End call now"), or it may have been cancelled: the
      // server is asked at once, so this screen says that the call has ended instead of offering to join again.
      void refresh();
    }
  }

  if (now === null) return <p className="mt-10 opacity-70">Loading…</p>;

  // After "End call now" (by either person) the way on is the screen that says who ended it and offers "Report",
  // "Block" and "Neither"; after a call that simply ran out or was cancelled, its results.
  const resultsLink = (
    <Link href={live?.safetyEnded && !live.cancelled ? `/calls/${props.callId}/ended` : `/calls/${props.callId}/results`} className="underline underline-offset-2">
      {ROOM_WORDS.results}
    </Link>
  );

  // Over on screen only once the server has confirmed this end (see the last check above), or said the call was stopped.
  if ((now >= closesAt && checkedEnd === endsAt) || live?.cancelled || live?.safetyEnded) {
    return (
      <section className="mt-10">
        <p className="text-lg">{ROOM_WORDS.ended}</p>
        <p className="mt-2">{resultsLink}</p>
      </section>
    );
  }

  // The clock has reached the end and the server is being asked one last time. Someone who is in the
  // call stays in it for that moment; anyone else just waits for the answer.
  if (now >= closesAt && !connection) return <p className="mt-10 opacity-70">{ROOM_WORDS.oneMoment}</p>;

  if (now < opensAt) {
    return (
      <section className="mt-10">
        <p className="text-lg">The room opens in {formatDuration((opensAt - now) / 1000)}.</p>
        <p className="mt-2 text-sm opacity-70">It opens 5 minutes before the booked start. This page will update by itself.</p>
        {props.whileWaiting}
      </section>
    );
  }

  const secondsLeft = Math.max(0, (endsAt - now) / 1000);
  const lastMinute = now >= startsAt && secondsLeft <= COUNTDOWN_SECONDS;
  const clock = now < startsAt ? `${ROOM_WORDS.startsIn} ${formatDuration((startsAt - now) / 1000)}` : lastMinute ? `${ROOM_WORDS.endsIn} ${formatDuration(secondsLeft)}` : `${ROOM_WORDS.timeLeft} ${formatDuration(secondsLeft)}`;
  const clockLine = (
    <p className={lastMinute ? "text-2xl font-semibold text-red-600" : "text-lg font-medium"} aria-live={lastMinute ? "off" : "polite"} role={lastMinute ? "timer" : undefined}>
      {clock}
    </p>
  );

  // Adding time. The customer may ask from 1 minute 30 before the end until 15 seconds before it;
  // the host may accept until 5 seconds before it. The server checks all of this again.
  const request = live?.extension ?? null;
  const mine = live?.lastExtension && live.lastExtension.id === myRequest ? live.lastExtension : null;
  const canAsk = props.role === "customer" && now >= startsAt && secondsLeft <= ASK_OPENS_SECONDS && secondsLeft > ASK_CLOSES_SECONDS && !request && live?.addTime;
  const addTimePanel = (
    <>
      {added && <p className="mt-2 text-sm font-medium text-green-700">{added}</p>}
      {props.role === "customer" && request && (
        <p className="mt-2 text-sm" aria-live="polite">
          {request.ready ? `Asked for ${minutesText(request.minutes)}. Waiting for ${props.otherName}.` : "Checking your card…"}
        </p>
      )}
      {props.role === "customer" && !request && mine && mine.status !== "accepted" && !extendNotice && (
        <p className="mt-2 text-sm" aria-live="polite">
          {mine.status === "declined"
            ? `${props.otherName} cannot add time now. The call ends as booked.`
            : mine.status === "ran_out"
              ? `${props.otherName} did not answer in time. The call ends as booked.`
              : "The time could not be added. The call ends as booked."}
        </p>
      )}
      {canAsk && live?.addTime && (
        <div className="mt-2">
          <AddTime fits={live.addTime.fits} pricePer15Cents={live.addTime.pricePer15Cents} membershipCovers={live.addTime.membershipCovers} busy={asking} onAsk={askFor} />
        </div>
      )}
      {props.role === "customer" && asking && !request && <p className="mt-2 text-sm">{askingByCard ? "Checking your card…" : "Asking…"}</p>}
      {props.role === "host" && request?.ready && (
        <div className="mt-2 flex flex-wrap items-center gap-3 rounded border border-blue-600 px-3 py-2" role="alert">
          <span className="font-medium">
            {props.otherName} asks for {minutesText(request.minutes)}
            {request.priceCents > 0 ? ` (${dollars(request.priceCents)} more)` : ""}.
          </span>
          <button
            type="button"
            disabled={answering || secondsLeft <= ACCEPT_CLOSES_SECONDS}
            onClick={() => answer(request.id, true)}
            className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            Accept
          </button>
          <button type="button" disabled={answering} onClick={() => answer(request.id, false)} className="rounded border border-neutral-500 px-3 py-1.5 text-sm disabled:opacity-50">
            Decline
          </button>
        </div>
      )}
      {extendNotice && (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {extendNotice}
        </p>
      )}
    </>
  );

  if (takenOver) {
    return (
      <section className="mt-10">
        <p className="text-lg">{ROOM_WORDS.takenOver}</p>
        <p className="mt-2 text-sm opacity-70">{ROOM_WORDS.takenOverSmall}</p>
        <button
          type="button"
          className="mt-4 rounded bg-blue-600 px-4 py-2 font-medium text-white"
          onClick={() => setTakenOver(false)}
        >
          {ROOM_WORDS.useThisTab}
        </button>
      </section>
    );
  }

  if (ending !== "no") {
    return (
      <section className="mt-10">
        {ending === "busy" ? (
          <p className="text-lg">{ROOM_WORDS.ending}</p>
        ) : (
          <p role="alert" className="text-red-600">
            {ROOM_WORDS.endFailed}{" "}
            <button type="button" onClick={endNow} className="ml-2 rounded border border-red-600 px-3 py-1.5 text-sm">
              {ROOM_WORDS.tryAgain}
            </button>
          </p>
        )}
      </section>
    );
  }

  if (!connection || !choices) {
    return (
      <section className="mt-6">
        {clockLine}
        {added && <p className="mt-2 text-sm font-medium text-green-700">{added}</p>}
        {notice && (
          <p role="alert" className="mt-2 text-sm text-red-600">
            {notice}
          </p>
        )}
        {props.whileWaiting}
        <p className="mt-2 text-sm opacity-70">{ROOM_WORDS.check}</p>
        <Lobby userName={props.userName} joining={joining} onJoin={join} onProblem={setNotice} />
      </section>
    );
  }

  return (
    <section className="mt-4 flex flex-1 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {clockLine}
        <EndNow sure={END_WORDS.sure(endCostFor({ role: props.role, billing: props.billing, pricePer15Cents: props.pricePer15Cents, wholeBookingSaid: props.wholeBookingSaid }))} onEnd={endNow} />
      </div>
      {addTimePanel}
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
          <QualityNotes callId={props.callId} serverNow={serverNow} />
        </LiveKitRoom>
      </div>
    </section>
  );
}
