/**
 * The sentences of the call room: the check before entering, the clock, the end, a connection
 * that was taken over or lost, and "End call now" (its own sentences are in end-words.ts). One set for the website's call screen
 * (src/app/calls/[id]/call-room.tsx) and for the phone app, which is sent them
 * (plans/45-phone-apps/09-the-call.md). Plain words, nothing of the server in them.
 */
import { END_WORDS } from "./end-words";

export const ROOM_WORDS = {
  check: "Check your camera and microphone, then join.",
  join: "Join call",
  joining: "Joining…",
  startsIn: "Starts in",
  timeLeft: "Time left",
  endsIn: "This call ends in",
  ended: "This call has ended.",
  results: "See the results",
  oneMoment: "One moment…",
  disconnected: "You were disconnected. You can join again while the room is open.",
  notReached: "Could not reach the server. Check your internet connection and try again.",
  couldNotJoin: "Could not join the call.",
  takenOver: "This call is now open in another tab or device.",
  takenOverSmall: "Only one connection per person is allowed, so this one was disconnected.",
  useThisTab: "Use this tab instead",
  endNow: END_WORDS.button,
  endNowYes: END_WORDS.yes,
  endNowNo: END_WORDS.no,
  ending: "Ending the call…",
  endFailed: "You have left, but the call could not be ended for the other person yet.",
  tryAgain: "Try again",
} as const;

/**
 * What only the phone app says: its call screen is built for a phone from the video kit's parts,
 * where the website uses the kit's ready-made screen.
 */
export const APP_ROOM_WORDS = {
  /** On the call's page, once the room is open. */
  goToCall: "Go to the call",
  takenOver: "This call is now open on another device.",
  useThisPhone: "Use this phone instead",
  notJoined: (other: string) => `${other} has not joined yet.`,
  left: (other: string) => `${other} has left the call. They can come back until the call ends.`,
  otherCameraOff: (other: string) => `${other} has their camera off.`,
  sharing: (other: string) => `${other} is showing their screen.`,
  reconnecting: "The connection was lost. Trying to connect again…",
  joinAgain: "Join again",
  cameraWhy: (other: string) => `Connect uses the camera only during the call, so that ${other} can see you.`,
  microphoneWhy: (other: string) => `Connect uses the microphone only during the call, so that ${other} can hear you.`,
  cameraRefused: "Connect is not allowed to use the camera on this phone. To be seen, allow it in the phone's settings. You can also join without it.",
  microphoneRefused: "Connect is not allowed to use the microphone on this phone. To be heard, allow it in the phone's settings. You can also join without it.",
  openSettings: "Open the phone's settings",
  /** Android: the button under the two sentences on why. The phone then asks, once. */
  allow: "Allow the camera and the microphone",
  cameraOn: "Camera on",
  cameraOff: "Camera off",
  microphoneOn: "Microphone on",
  microphoneOff: "Microphone off",
  // Under a small round button: short.
  turnCamera: "Turn camera",
  loudspeaker: "Speaker",
  earpiece: "Earpiece",
  leave: "Leave",
  left_: "You have left the call. You can join again while the room is open.",
  backToCall: "Back to the call's page",
} as const;
