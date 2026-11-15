/**
 * The connection check in the browser. About 12 seconds, in the background:
 *   1. it asks our server for a private test room (never a call's room),
 *   2. connects to the video service the same way a real call does,
 *   3. sends a made-up moving picture (not the camera) for about 8 seconds and
 *      reads, once a second, the report the video service sends back about what
 *      arrived: the round trip and the share lost,
 *   4. disconnects and cleans up after itself.
 * The readings become an answer with the one shared rule (answer.ts). Nothing
 * about the answer is sent to the server.
 *
 * `stop` is safe to call at any moment and more than once. It cancels the
 * request to the server, the drawing, the readings and the time limit, stops
 * the test picture and disconnects, without anything waiting for it. After
 * every step that takes time the test first looks whether it was stopped, so
 * nothing can start up again late.
 */
import { ConnectionError, ConnectionErrorReason, Room, Track, type LocalTrack } from "livekit-client";
import { answerFor, figuresFrom, type Answer, type Reading } from "./answer";

/** How long the made-up picture is sent. */
const SEND_MS = 8_000;
/** The whole test is given up after this long, whatever it is waiting for. */
const LIMIT_MS = 25_000;
/** One stream of fixed size and rate, lighter than a real call's picture. */
const WIDTH = 640;
const HEIGHT = 360;
const PER_SECOND = 15;
const MAX_BITS_PER_SECOND = 1_200_000;

export type RunningTest = {
  stop: () => void;
  /** The answer, or null when the test was stopped before it had one. */
  result: Promise<Answer | null>;
};

/** One reading: the newest report from the far side about the picture this browser is sending. */
async function readOnce(track: LocalTrack | undefined): Promise<Reading> {
  const stats = await track?.getRTCStatsReport();
  if (!stats) return { report: null };
  // The entry about the picture going out says which report from the far side belongs to it.
  let remoteId: unknown;
  let stream: unknown;
  stats.forEach((entry) => {
    if (entry.type === "outbound-rtp" && (entry.kind === "video" || entry.mediaType === "video")) {
      remoteId = entry.remoteId;
      stream = entry.ssrc;
    }
  });
  let report: Reading["report"] = null;
  stats.forEach((entry) => {
    if (entry.type !== "remote-inbound-rtp" || !(entry.id === remoteId || (stream !== undefined && entry.ssrc === stream))) return;
    report = {
      // When the report arrived: this is what tells one report from the next.
      madeAt: entry.timestamp,
      lossShare: typeof entry.fractionLost === "number" ? entry.fractionLost : null,
      roundTripSeconds: typeof entry.roundTripTime === "number" ? entry.roundTripTime : null,
    };
  });
  return { report };
}

/**
 * Whether a failed attempt to connect means this device could not get through to the video service. Only
 * then is the person told so. A refusal or a failure on the video service's own side is not a problem with
 * anyone's internet, and gives "not measured".
 */
function couldNotReach(error: unknown): boolean {
  return (
    error instanceof ConnectionError &&
    (error.reason === ConnectionErrorReason.ServerUnreachable || error.reason === ConnectionErrorReason.Timeout || error.reason === ConnectionErrorReason.WebSocket)
  );
}

export function runConnectionTest(): RunningTest {
  let over = false;
  let connected = false;
  let asked = false;
  let room: Room | null = null;
  let picture: MediaStreamTrack | null = null;
  const readings: Reading[] = [];
  const request = new AbortController();
  const timers: Array<ReturnType<typeof setTimeout>> = [];
  let settle!: (answer: Answer | null) => void;
  const result = new Promise<Answer | null>((resolve) => (settle = resolve));

  /** The one way a test ends: with an answer, or with null when it was stopped. */
  function end(answer: Answer | null) {
    if (over) return;
    over = true;
    request.abort();
    for (const timer of timers) clearTimeout(timer); // clears the repeating ones too
    document.removeEventListener("visibilitychange", onHidden);
    picture?.stop();
    void room?.disconnect().catch(() => undefined);
    settle(answer);
  }

  // A tab in the background is slowed down by the browser: its timers run late and the made-up picture stutters.
  // What would be measured then is the browser's thrift, not the connection, so the test ends without an answer.
  function onHidden() {
    if (document.hidden) end("not_measured");
  }
  document.addEventListener("visibilitychange", onHidden);

  // Past the limit: say what is known. Connected with readings gives the rule's answer; a video service
  // that was asked and never answered is "no connection"; anything earlier is simply not measured.
  timers.push(setTimeout(() => end(connected ? answerFor(figuresFrom(true, readings)) : asked ? "no_connection" : "not_measured"), LIMIT_MS));

  void (async () => {
    try {
      if (typeof RTCPeerConnection === "undefined" || typeof HTMLCanvasElement === "undefined" || !("captureStream" in HTMLCanvasElement.prototype)) return end("not_measured");
      if (document.hidden) return end("not_measured");

      // 1. A private test room, from our server. Refused (the limit, switched off, not logged in): not measured.
      const response = await fetch("/api/connection-test", { method: "POST", signal: request.signal });
      if (over) return;
      if (!response.ok) return end("not_measured");
      const pass = (await response.json()) as { token: string; serverUrl: string };
      if (over) return;

      // 2. Connect the way a real call does.
      room = new Room({ adaptiveStream: false, dynacast: false });
      asked = true;
      try {
        await room.connect(pass.serverUrl, pass.token, { autoSubscribe: false });
      } catch (error) {
        return end(couldNotReach(error) ? "no_connection" : "not_measured");
      }
      if (over) return void room.disconnect().catch(() => undefined);
      connected = true;

      // 3. A made-up moving picture: a bar sliding over changing colours, so there is always something new to send.
      const canvas = document.createElement("canvas");
      canvas.width = WIDTH;
      canvas.height = HEIGHT;
      const context = canvas.getContext("2d");
      if (!context) return end("not_measured");
      let frame = 0;
      const draw = () => {
        frame++;
        context.fillStyle = `hsl(${(frame * 7) % 360} 60% 45%)`;
        context.fillRect(0, 0, WIDTH, HEIGHT);
        context.fillStyle = "#ffffff";
        context.fillRect((frame * 11) % WIDTH, 0, 40, HEIGHT);
        context.fillRect(0, (frame * 5) % HEIGHT, WIDTH, 12);
      };
      draw();
      timers.push(setInterval(draw, 1000 / PER_SECOND));
      picture = canvas.captureStream(PER_SECOND).getVideoTracks()[0] ?? null;
      if (!picture) return end("not_measured");
      const publication = await room.localParticipant.publishTrack(picture, {
        source: Track.Source.Camera,
        simulcast: false,
        videoEncoding: { maxBitrate: MAX_BITS_PER_SECOND, maxFramerate: PER_SECOND },
      });
      if (over) return;

      // 4. A reading every second while the picture is sent.
      const sendingSince = Date.now();
      timers.push(
        setInterval(() => {
          void readOnce(publication.track)
            .catch((): Reading => ({ report: null }))
            .then((reading) => {
              if (over) return;
              readings.push(reading);
              if (Date.now() - sendingSince >= SEND_MS) end(answerFor(figuresFrom(true, readings)));
            });
        }, 1000),
      );
    } catch {
      // Anything unexpected on our side is never reported as a problem with someone's internet.
      end(connected ? answerFor(figuresFrom(true, readings)) : "not_measured");
    }
  })();

  return { stop: () => end(null), result };
}
