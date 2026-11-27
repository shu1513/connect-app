/**
 * The call room for the phone app (plans/45-phone-apps/09-the-call.md): what its screen needs
 * before anyone enters, from the same gathering as the call's page (src/lib/call-page/gather.ts),
 * in the room's own sentences (src/lib/call-page/room-words.ts). The entry pass itself comes from
 * the one join check (src/lib/video/enter.ts).
 *
 * The answer is built field by field. No account id travels, and nothing about the other person
 * beyond the name this person already knows them by.
 */
import "server-only";
import { gatherCallPage } from "@/lib/call-page/gather";
import { END_WORDS, endCostFor } from "@/lib/call-page/end-words";
import { APP_ROOM_WORDS, ROOM_WORDS } from "@/lib/call-page/room-words";
import { CALL_WORDS } from "@/lib/call-page/words";
import { roomOpensAt, roomState } from "@/lib/calls";
import { COUNTDOWN_SECONDS, WATCH_SECONDS } from "@/lib/extend/rules";
import type { AppRoom } from "./types";

/** How often the screen asks where the call stands, near its end (the website's call screen asks as often). */
const ASK_EVERY_SECONDS = 2;

/** Null for anyone who is not one of the call's two people, whether or not the call exists. Only ever reads. */
export async function roomFor(person: { id: string }, callId: string, now: Date): Promise<AppRoom | null> {
  const page = await gatherCallPage(person.id, callId, now, { sync: false });
  if (!page) return null;
  const { call, role } = page;
  const other = page.otherName ?? (role === "host" ? "The customer" : "The host");
  return {
    id: call.id,
    role,
    other,
    startsAt: call.startsAt.toISOString(),
    endsAt: call.endsAt.toISOString(),
    opensAt: roomOpensAt(call).toISOString(),
    serverNow: now.toISOString(),
    ready: page.state === "room" && roomState(call, now) !== "closed",
    about: role === "host" && page.about?.text ? { title: CALL_WORDS.aboutTitle(page.otherName ?? "this customer"), text: page.about.text } : null,
    watchSeconds: WATCH_SECONDS,
    askEverySeconds: ASK_EVERY_SECONDS,
    countdownSeconds: COUNTDOWN_SECONDS,
    words: {
      check: ROOM_WORDS.check,
      join: ROOM_WORDS.join,
      joining: ROOM_WORDS.joining,
      startsIn: ROOM_WORDS.startsIn,
      timeLeft: ROOM_WORDS.timeLeft,
      endsIn: ROOM_WORDS.endsIn,
      ended: ROOM_WORDS.ended,
      results: ROOM_WORDS.results,
      oneMoment: ROOM_WORDS.oneMoment,
      disconnected: ROOM_WORDS.disconnected,
      takenOver: APP_ROOM_WORDS.takenOver,
      takenOverSmall: ROOM_WORDS.takenOverSmall,
      useThisPhone: APP_ROOM_WORDS.useThisPhone,
      endNow: ROOM_WORDS.endNow,
      // What the press costs this person, by their role on this call (plans/50-end-call-now.md, decision 18).
      endNowSure: END_WORDS.sure(endCostFor({ role, billing: call.billing, pricePer15Cents: call.pricePer15Cents, wholeBookingSaid: page.wholeBookingSaid })),
      endNowYes: ROOM_WORDS.endNowYes,
      endNowNo: ROOM_WORDS.endNowNo,
      ending: ROOM_WORDS.ending,
      endFailed: ROOM_WORDS.endFailed,
      tryAgain: ROOM_WORDS.tryAgain,
      notJoined: APP_ROOM_WORDS.notJoined(other),
      left: APP_ROOM_WORDS.left(other),
      otherCameraOff: APP_ROOM_WORDS.otherCameraOff(other),
      sharing: APP_ROOM_WORDS.sharing(other),
      reconnecting: APP_ROOM_WORDS.reconnecting,
      joinAgain: APP_ROOM_WORDS.joinAgain,
      cameraWhy: APP_ROOM_WORDS.cameraWhy(other),
      microphoneWhy: APP_ROOM_WORDS.microphoneWhy(other),
      cameraRefused: APP_ROOM_WORDS.cameraRefused,
      microphoneRefused: APP_ROOM_WORDS.microphoneRefused,
      openSettings: APP_ROOM_WORDS.openSettings,
      allow: APP_ROOM_WORDS.allow,
      cameraOn: APP_ROOM_WORDS.cameraOn,
      cameraOff: APP_ROOM_WORDS.cameraOff,
      microphoneOn: APP_ROOM_WORDS.microphoneOn,
      microphoneOff: APP_ROOM_WORDS.microphoneOff,
      turnCamera: APP_ROOM_WORDS.turnCamera,
      loudspeaker: APP_ROOM_WORDS.loudspeaker,
      earpiece: APP_ROOM_WORDS.earpiece,
      leave: APP_ROOM_WORDS.leave,
      youLeft: APP_ROOM_WORDS.left_,
      backToCall: APP_ROOM_WORDS.backToCall,
    },
  };
}
