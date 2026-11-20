# Phone apps, part 09: the call itself (entering, talking, leaving, "end and report")

**Status:** a plan only. Written 20 November 2026 by the builder alone. Part of plan 45. Astra
checked the first draft ("not ready"); it was split in three (this part, 09b and 09c) and
every point is worked in (the list is at the end). This is the heart of the product and the
part with the most that cannot be proven without real phones.

## For the founder: what this is

Two people see and hear each other. One can be in the app and the other on the website: it is
the same room. This part is the room itself: the check before entering, talking, leaving and
coming back, the end of the call, and "End call and report" with the report form. What happens
when the phone is locked, connection grades, more time and the chat are part 09b; the
connection check before a call is part 09c.

## What is there today (read in the code)

- `src/app/calls/[id]/call-room.tsx` (561 lines) and `src/lib/calls.ts`:
  - **the check before entering:** a preview of the camera, microphone and camera on or off as
    the person chooses (they may enter muted); for the host, while waiting, her private note;
  - **the entry pass** from `/api/calls/[id]/token`: only for a person of this call, only
    while the room is open (from 5 minutes before the start to the booked or extended end),
    only while the money is held, not for a paused account, a blocked pair, or while calls are
    paused across Connect; it takes the person out of any other room first;
  - **in the room:** LiveKit's ready-made call screen, which on the website also has a text
    chat that lasts as long as the call and sharing one's screen;
  - **leaving and coming back** is ordinary; entering from a second device asks first and then
    takes over from the first;
  - **the end:** shortly before the end the screen asks the server once more whether time was
    added, tries again briefly if it cannot reach it, then ends and offers the results. The
    server also closes the room and cancels the passes on its own (`src/lib/video/closing.ts`).
    When the other person leaves, the one who stays is not put out;
  - **"End call and report"** (`/api/calls/[id]/end-for-safety`): the person is taken out of
    the room on their own device first; if ending it for both did not go through, they can try
    again; then the report form (`src/app/report/`, which asks for a signed-in browser).
- **Time is counted by the server alone,** from LiveKit's own signed messages
  (`/api/livekit/webhook`, `src/lib/attendance/`). A booked call is charged for the host's
  time, waiting included; an instant call for time together. Nothing the screen sends counts
  toward money.
- The 2 minutes after every call (plan 42) are kept free in both people's calendars; they are
  not extra time in the room.
- Calls are never recorded, by rule and by design.

## Decisions (the builder's)

1. **LiveKit's kit for phones, in the same rooms, with the same entry pass.** The pass address
   gets a twin under the door (as in part 08). No rule about who may enter is in the app.
2. **The check before entering** is the website's: a preview, the two choices, entering with
   what was chosen. Camera and microphone permission are asked for here, with one plain
   sentence each on why. If refused, the app says how to allow it in the phone's settings; it
   does not ask again and again. The host's note shows while she waits, folded.
3. **The call screen is built for a phone, from LiveKit's parts:** the other person large, me
   small in a corner; microphone, camera, turn the camera around, loudspeaker or earpiece,
   leave. The time left. "The other person has left" or "has not joined yet", without ending
   anything.
4. **The screen stays awake during a call.**
5. **Leaving, coming back, a second device** work as on the website, the question before
   taking over included.
6. **The end** is the website's: the last question to the server about added time, the short
   retry, then the results. The app also obeys the server's own closing of the room.
7. **A dropped connection:** the app tries again by itself for a short while and says so; then
   offers "Join again", which asks for a fresh pass.
8. **"End call and report":** one touch away; asks once; takes the person out at once; tries
   again if ending it for both did not go through; opens the report form.
9. **The report form is built here,** as a screen of the app on its own address (the website's
   form needs a signed-in browser), with the website's reasons and rules. It is the same form
   that parts 05, 07, 10 and 18 open.
10. **Sharing a screen:** the app shows a screen the other person shares from the website. It
    does not offer to share the phone's own screen: that needs extra system parts on both
    kinds of phone and is the easiest way to show something by mistake. A deliberate gap,
    listed in part 20.
11. **Never recorded.** The app has no recording. On Android the call screen is marked so the
    system's screenshots and screen recording show black. On iPhone the same is asked of the
    system where it allows it; this is tried on a real iPhone before anything is promised.

## How it is tried

- Check script: the twins of `token` and `end-for-safety` answer as the originals; a pass is
  refused while unpaid, before the room opens, after the end, for a blocked pair, for a paused
  account, and while calls are paused across Connect; the report address takes the website's
  reasons and refuses what the website refuses.
- `safety-check`, `payments-check` and `journey-check` unchanged and green.
- **A real call on this Mac:** the Android test phone (its camera shows a made-up moving
  picture) on one side and the website in a browser on the other: both see and hear each
  other; entering muted; mute; camera off; the other person leaving and coming back; a second
  device taking over; the end; "End call and report" and the report. Afterwards the server's
  count of time is compared with the clock, and it must be the server's own, with nothing
  sent by the app.

## What cannot be tried here

A real camera and microphone; an iPhone; two real phones in two places. These are the
founder's two-phone test, listed in part 20.

## Keeping the 4.9%

Calls stay between two people and unrecorded: both are conditions of the stores' rule, so
both are checked here.

## Astra's check (20 November 2026): "not ready", now worked in

1. *Too much for one part.* Split into 09, 09b and 09c.
2. *The room's times:* it opens 5 minutes early and closes at its end; the 2 minutes of plan
   42 are calendar time, not room time. Corrected.
3. *Things the draft dropped:* entering muted, the host's note while waiting, taking over
   from a second device, "the other person left", the last question about added time, the
   retry of "end for both". Added.
4. *The website's call screen also has a chat and screen sharing.* Decision 10 here; the chat
   is in part 09b.
5. *The report form needs a signed-in browser.* Decision 9: built here, as an app screen.
6. *iPhones can be asked to prevent screenshots and recording.* Decision 11 no longer says
   they cannot.
