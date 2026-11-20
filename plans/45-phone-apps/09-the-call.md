# Phone apps, part 09: the call itself (entering, talking, leaving, "end and report")

**Status:** built on 20 November 2026 (not merged yet: it waits, with parts 01 to 08, behind the
tips pull request). Astra looked at the code once ("not ready"); its points are worked in, below. Written by the builder alone. Part of
plan 45. Astra checked the first draft of the plan ("not ready"); it was split in three (this
part, 09b and 09c) and every point is worked in (the list is at the end). What the building
changed is listed below. This is the heart of the product and the
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
  - **leaving and coming back** is ordinary; a second device can enter, which puts the first
    one out, and the one put out is offered "Use this tab instead";
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
5. **Leaving, coming back, a second device** work as on the website: the device that was put
   out says so and offers "Use this phone instead".
6. **The end** is the website's: the last question to the server about added time, the short
   retry, then the results. The app also obeys the server's own closing of the room.
7. **A dropped connection:** the app tries again by itself for a short while and says so; then
   offers "Join again", which asks for a fresh pass.
8. **"End call and report":** one touch away; asks once; takes the person out at once; tries
   again if ending it for both did not go through; opens the report form.
9. **The report form is built here,** as a screen of the app on its own address (the website's
   form needs a signed-in browser), with the website's reasons and rules. It takes reports
   about a call, a request or a public profile, and nothing else (the website's also takes
   diary posts, which the app does not have). It says, as the website does, that reporting a
   person also blocks them. It is the same form that parts 05, 07, 10 and 18 open.
10. **Sharing a screen:** the app shows a screen the other person shares from the website. It
    does not offer to share the phone's own screen: that needs extra system parts on both
    kinds of phone and is the easiest way to show something by mistake. This is a feature of
    the website that the app does not have; it is named as such to the founder in part 20.
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

## What the building changed (20 November 2026)

1. **One join check, in one place** (`src/lib/video/enter.ts`). The website's address for the
   entry pass and the app's both call it, so the two can never differ in who may enter.
   "Where the call stands" is one reading too (`src/lib/call-page/live.ts`).
2. **The room's sentences and the report form's sentences are in one place each**
   (`src/lib/call-page/room-words.ts`, `src/lib/safety/report-words.ts`). The website's call
   screen and report page were moved onto them, word for word.
3. **The addresses:** `GET /api/app/calls/[id]/room` (what the screen needs before anyone
   enters, every sentence included), `POST …/enter` (the entry pass), `GET …/live`,
   `POST …/end-and-report`, and `GET` and `POST /api/app/report` (the form, and sending it).
4. **The app's screens:** the call's page gets a button "Go to the call" once the room is
   open; the call's own screen has the camera check, the call, and its end; the report form.
5. **Leaving the screen leaves the call.** Whatever way the person leaves the call's screen
   (the Leave button, the phone's back button, a link opened from outside), they are out of
   the room: nobody is on camera with another screen in front. What happens when the whole
   app goes behind another app is part 09b's.
6. **The entry pass is only taken for a video service on a locked address** (`wss://`). The
   app hands its camera and microphone to nothing else.
7. **After a lost connection the app asks the server where the call stands** before it says
   anything: if the call was stopped by the other person's "End call and report", it says the
   call has ended, not "you were disconnected, join again".
8. **Camera and microphone:** on Android the app asks once, after two plain sentences on why;
   if the answer is no it says how to allow it in the phone's settings and does not ask again.
   On an iPhone the phone itself asks, with the same two sentences. Either can be refused and
   the call still entered (without picture, or without sound of one's own).
9. **Screenshots during the call** show black on Android (the phone's own marking). The piece
   that does it would also have asked for permission to read the phone's photos, which the
   app has no use for: those two permissions are shut out in the app's settings file.
10. **Not built here, each with its own part:** what happens when the phone is locked or
    another app is in front, the connection grades, asking for more time, and the chat (part
    09b); the connection check before a call (part 09c); the results of a call, where "See
    the results" will lead (part 10; until then it leads to the call's page).

### How it was tried

- `scripts/app-room-check.ts`, 55 checks, against the real video service and Stripe's test
  mode: what the screen is sent (every sentence, the website's own where the website has
  them); the entry pass refused before the room opens, while unpaid, after a cancellation,
  after the end, for a blocked pair, for a paused account and while calls are paused across
  Connect, and handed out otherwise, for this person and this room only, exactly as the
  website's own address does; a paid call entered once its money is held; where the call
  stands, also after time was added; "End call and report" (not before the room opens; ended
  for both; by a paused person too; the website's own button does the same); the report form
  (the website's reasons, its refusals, who the report is about, the block that follows).
- **A real call on this Mac,** with pictures: the Android test phone as the customer, and the
  website in Chrome as the host with a real camera. The phone asked for the camera and the
  microphone once, after the two sentences; the camera check showed the phone's picture; in
  the call the host's live video filled the phone's screen and the website showed the
  phone's; muting and switching the camera off showed on the other side; leaving and joining
  again; the host leaving ("has left the call, they can come back") while the phone stayed
  in; a second device joining as the same person put the phone out, and "Use this phone
  instead" took the call back; a network cut of a few seconds did not end the call; "End
  call and report" asked once, ended the call for both (the host was put out on the
  website), opened the report form, which refused to send without a reason and then thanked
  with the report's number; a short call ran out and the screen said "This call has ended."
- With the test switch off, a picture taken of the call screen is black, as it should be. (A
  test build can be told to allow pictures, `EXPO_PUBLIC_CALL_PICTURES=1`, which is how the
  screen was looked at; a build for a store cannot.)
- Not walked: a connection lost for so long that "Join again" is offered; saying no to the
  camera or the microphone; the host's side in the app (her note folded in the camera
  check); the earpiece (the test phone has none).

### What could not be tried here

A real camera and microphone (the test phone's camera shows a made-up moving picture); an
iPhone; two real phones in two places; a call with the phone locked. These are on the
founder's two-phone list in part 20.

## Astra's check of the code (20 November 2026): "not ready", now worked in

Astra found the website unchanged by the move, and who may enter the same in both. Five
things that mattered in the app, and six smaller ones:

1. *The camera check could keep the camera on behind another screen.* With another screen in
   front, the call's screen now draws nothing at all: no camera check and no call.
2. *"End call and report" could say "ended for both" before the other person was really out*
   (the call was marked as stopped, but the video service had not confirmed that the room was
   closed). The app is now told "ended" only once the room is confirmed closed; until then it
   says "You have left, but the call could not be ended for the other person yet" with "Try
   again", and that stays in front of everything else. (The website's own button is as it
   was; the helper closes the room in any case.)
3. *There was no way to the report form from a host's page or from a request.* Both have the
   link now, shown by the website's own rules: "Report this page" for anyone signed in on
   another person's page; "Report (name)" on a request once it was sent.
4. *A report half written about one person could have been sent about another* (if a second
   link changed the screen underneath). Each place now has a form of its own.
5. *Saying no to the camera or the microphone:* the app now remembers that it has asked for
   as long as it is open, so it does not ask again each time; on an iPhone the microphone is
   looked at by itself, and both are looked at afresh after a visit to the phone's settings.
6. Smaller: an answer that arrives after the person has left the screen changes nothing on
   it, and the last question about the end stops and starts afresh with the screen; an answer
   that was long on its way cannot set the clock back; a call or a request is named by a full
   id (anything else is "not found" at once); after a lost connection nothing is offered
   until the server has said where the call stands; the room's time is looked at again in the
   moment the entry pass is made (on the website too).

**Not done, said plainly:** the check script cannot join a call as a second person, so "the
other person is put out" is proven by the walk (the host on the website was put out), not by
the script; a failed closing of the room cannot be made to happen on purpose here.

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
