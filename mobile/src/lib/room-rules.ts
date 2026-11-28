/**
 * The plain logic of the call's own screen and of the report form in the app
 * (plans/45-phone-apps/09-the-call.md): checking the server's answers before a screen reads them,
 * and the clock line. Plain logic with no phone in it, so it can be tested on its own.
 */
import type { AppBlocked, AppCallLive, AppEnded, AppEndedScreen, AppPass, AppReportForm, AppReportSent, AppRoom } from "../../../src/lib/app-door/types";
import { isId } from "./book-rules";
import { clockWords } from "./home-rules";

const isThing = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === "string";
const isMoment = (value: unknown): value is string => isText(value) && !Number.isNaN(Date.parse(value));
const isCount = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;

/** Every sentence the call's screen says. A screen is only shown when all of them came. */
export const ROOM_WORD_NAMES = [
  "check", "join", "joining", "allow", "startsIn", "timeLeft", "endsIn", "ended", "results", "oneMoment", "disconnected", "takenOver", "takenOverSmall", "useThisPhone",
  "endNow", "endNowSure", "endNowSureEarly", "endNowYes", "endNowNo", "ending", "endFailed", "tryAgain", "notJoined", "left", "otherCameraOff", "sharing", "reconnecting", "joinAgain",
  "cameraWhy", "microphoneWhy", "cameraRefused", "microphoneRefused", "openSettings", "cameraOn", "cameraOff", "microphoneOn", "microphoneOff", "turnCamera", "loudspeaker", "earpiece",
  "leave", "youLeft", "backToCall",
] as const;

/** Whether an answer really is what the call's screen needs before anyone enters. */
export function isRoom(data: unknown): data is AppRoom {
  if (!isThing(data) || !isId(data.id) || !(data.role === "customer" || data.role === "host") || !isText(data.other) || data.other.trim() === "") return false;
  if (!isMoment(data.startsAt) || !isMoment(data.endsAt) || !isMoment(data.opensAt) || !isMoment(data.serverNow) || typeof data.ready !== "boolean") return false;
  if (!isCount(data.watchSeconds) || !isCount(data.askEverySeconds) || !isCount(data.countdownSeconds)) return false;
  if (data.about !== null && !(isThing(data.about) && isText(data.about.title) && isText(data.about.text))) return false;
  const words = data.words;
  return isThing(words) && ROOM_WORD_NAMES.every((name) => isText(words[name]) && words[name] !== "");
}

/**
 * Whether an answer really is an entry pass: a pass, and the address of a video service reached
 * over a locked connection (`wss://`). The app hands its camera and microphone to nothing else.
 */
export function isPass(data: unknown, options: { plain?: boolean } = {}): data is AppPass {
  if (!isThing(data) || !isText(data.token) || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(data.token)) return false;
  if (!isText(data.serverUrl) || !(options.plain ? /^wss?:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?\/?$/ : /^wss:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?\/?$/).test(data.serverUrl)) return false;
  return isMoment(data.endsAt) && isMoment(data.serverNow);
}

/** Whether an answer really says where a call stands. */
export function isLive(data: unknown): data is AppCallLive {
  return isThing(data) && isMoment(data.endsAt) && isMoment(data.serverNow) && typeof data.cancelled === "boolean" && typeof data.safetyEnded === "boolean";
}

export function isEnded(data: unknown): data is AppEnded {
  return isThing(data) && data.ended === true && typeof data.closed === "boolean";
}

/** Whether an answer really is the screen after "End call now": the lines, and the three choices with what each does. */
export function isEndedScreen(data: unknown): data is AppEndedScreen {
  const said = (value: unknown): value is string => isText(value) && value.trim() !== "";
  if (!isThing(data) || !said(data.title) || !said(data.what)) return false;
  if (!Array.isArray(data.lines) || !data.lines.every(said)) return false;
  const { report, block, neither } = data;
  if (!isThing(report) || !said(report.label) || !said(report.what) || !(report.money === null || said(report.money))) return false;
  if (!isThing(block) || !said(block.label) || !said(block.what) || typeof block.done !== "boolean" || !said(block.doneWords) || !said(block.sure) || !said(block.yes) || !said(block.no)) return false;
  return isThing(neither) && said(neither.label) && said(neither.what);
}

/** Whether an answer really says that "Block" went through. */
export function isBlocked(data: unknown): data is AppBlocked {
  return isThing(data) && isText(data.notice) && data.notice.trim() !== "";
}

/** Whether an answer really is the report form, with the parts the screen reads. */
export function isReportForm(data: unknown): data is AppReportForm {
  if (!isThing(data) || !isText(data.title) || !(data.stopped === null || isText(data.stopped)) || !isText(data.words)) return false;
  if (!isThing(data.rules) || !isText(data.rules.before) || !isText(data.rules.link) || !isText(data.rules.after)) return false;
  if (!isText(data.what) || !isText(data.choose) || !isText(data.more) || !isCount(data.textMax) || !isText(data.send) || !isText(data.danger)) return false;
  return Array.isArray(data.reasons) && data.reasons.length > 0 && data.reasons.every((reason) => isThing(reason) && isText(reason.key) && reason.key !== "" && isText(reason.label));
}

export function isReportSent(data: unknown): data is AppReportSent {
  return isThing(data) && isText(data.notice) && data.notice.trim() !== "";
}

/** The call's end as the screen knows it: a later end said by the server is taken over; the end never moves back. */
export function laterEnd(known: number, said: string): number {
  const end = Date.parse(said);
  return Number.isFinite(end) && end > known ? end : known;
}

/**
 * Whether this is not the moment for the call's own screen, so that the call's page is shown in its place (it says
 * why, and leads back here when the room is open): the room has not opened yet, or the server's newest answer about
 * the room says that something stands in the way (unpaid, cancelled, over, or the call's two people may no longer
 * act). Never for someone who holds an entry pass: they are in the call.
 *
 * `live`: what the screen has learned by asking where the call stands (near its end, after a lost connection); null
 * if it never asked. The newest "not ready" wins also then: someone who left this screen and comes back (their pass
 * is gone) is not shown the camera check and "Join" for a room nobody can enter. One thing is kept: a call that is
 * over as far as this screen knows (its time is up, or the server said it was cancelled or ended) stays here. The
 * screen says "ended" itself, with the way on to what follows an ended call.
 */
export function notTheMoment(at: { ready: boolean; opensAt: number; now: number; endsAt: number | null; inCall: boolean; live: { cancelled: boolean; safetyEnded: boolean } | null }): boolean {
  if (at.inCall) return false;
  if (at.live === null) return !at.ready || at.now < at.opensAt;
  const over = at.live.cancelled || at.live.safetyEnded || (at.endsAt !== null && at.now >= at.endsAt);
  return !at.ready && !over;
}

/**
 * The clock line of a call, by the server's clock: until the start, the time left, and in the
 * last stretch the countdown (`last`, drawn large).
 */
export function clockLine(words: { startsIn: string; timeLeft: string; endsIn: string }, at: { now: number; startsAt: number; endsAt: number; countdownSeconds: number }): { text: string; last: boolean } {
  if (at.now < at.startsAt) return { text: `${words.startsIn} ${clockWords((at.startsAt - at.now) / 1000)}`, last: false };
  const left = Math.max(0, (at.endsAt - at.now) / 1000);
  const last = left <= at.countdownSeconds;
  return { text: `${last ? words.endsIn : words.timeLeft} ${clockWords(left)}`, last };
}

/** Where the report form is opened from: exactly one of a call, a request, or a host's page. */
export function reportPlace(params: { call?: unknown; booking?: unknown; profile?: unknown }): { place: "call" | "booking" | "profile"; id: string } | null {
  // Exactly one place may be named at all (a link that names two is not guessed at); then what names it must be real.
  const named = (["call", "booking", "profile"] as const).filter((place) => params[place] !== undefined);
  if (named.length !== 1) return null;
  const place = named[0];
  const id = params[place];
  const real = place === "profile" ? typeof id === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(id) : isId(id);
  return real ? { place, id: id as string } : null;
}
