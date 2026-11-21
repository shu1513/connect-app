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

- `scripts/app-room-check.ts`, 57 checks, against the real video service and Stripe's test
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

## Astra's second look at the code (20 November 2026): "not ready", now worked in

Four points of the first list were found closed (nothing of the call behind another screen,
the report links, a form of its own for each place, the clock). What was left:

1. *"Ended for both" still without proof in two places:* pressing "Try again" after the
   call's booked end (the clock was taken as proof), and the report form's first sentence
   (it went by the mark alone). **Proof is now one thing only: the room written down as
   closed,** which the helper's own closing step writes once the video service has confirmed
   it. "End call and report" runs that step and answers "ended" only with it. Until then the
   report form says "The call is being ended for both of you", not "has been ended".
2. *The join check read the call before a wait and judged it after.* The call is now read
   last, after the person has been taken out of other rooms, and held as it is until the pass
   is made: a call that was stopped meanwhile gives no pass, and one that was made longer
   meanwhile is not turned away (on the website too).
3. *A paused person who had pressed "End call and report" could lose "Try again"* when the
   screen was read again. The app keeps that step's sentences from the moment it is pressed
   and shows them before anything else.
4. Smaller: a second press of "Try again" does not send twice; on an iPhone the camera is
   tried afresh each time the app comes back to the front; a wait that began during an
   earlier visit to the screen is not used in a later one; a report link that names two
   places is not guessed at; after a lost connection, if the server cannot be asked, the
   camera check is not offered, only "Try again"; the check script puts the switch for all
   calls back whatever happens.

**Not done, said plainly:** the check script cannot join a call as a second person, so "the
other person is put out" is proven by the walk (the host on the website was put out), not by
the script; a failed closing of the room cannot be made to happen on purpose here.

## Astra's third look at the code (20 November 2026): "not ready", now worked in

1. *A sentence promised too much.* While the video service has not yet confirmed that the
   room is closed, the report form said "Nobody can join it again". No new entry pass is
   handed out from that moment, but one handed out just before stays good until the closing
   is confirmed. The sentence now says only what is known: "The call is being ended for both
   of you. The charge for it will be looked at by a person." A check holds it to that.
2. *A block between the two people during the wait to enter.* The join check looked for a
   block only at its start. It now looks again as the very last thing before the pass is
   made. What stays, on purpose: a block does not put anyone out of a call that is already
   under way (that is what "End call and report" is for, and reporting someone blocks them
   as well), so a pass made in the instant before a block is the same as having entered just
   before it. The two do not wait for each other with a lock: the block's own step holds
   other locks, and making the two wait in a fixed order would touch the shared safety code
   for no gain a person could see.
3. *The camera could be switched off while "Joining…" was shown, and the person still entered
   with it on.* The person now enters with what is chosen at the moment the pass arrives.
4. *From the newer main (the legal change of 20 November), carried into the one join check:*
   the person's own account is read again while their line is held, so an account paused or
   closed in that very moment gets no pass; and the list of other rooms is read on the join
   step's own connection, so many joins at once cannot wait for each other.
5. Smaller: before anyone is taken out of another room, the call they want to enter is looked
   at once (if it was stopped meanwhile, they stay where they are; the look that counts still
   comes last); a call that is not there is never taken for "the room is closed"; an old
   answer to "where does the call stand?" that arrives after the person has left the screen
   changes nothing, and the question is put again when they are back.

**Not checked by the script, said plainly:** points 2, 4 and the first half of 5 are about two
things happening in the same instant. The script cannot make that happen on purpose (the
door turns a paused or blocked person away before the join check is reached), so they are
proven by reading the code, and by the website's own safety check, which pauses an account
and tries to join.

## Astra's fourth look at the code (20 November 2026): "not ready", now worked in

Five of the six points of the third look were found closed. What was left:

1. *The camera choice could still lag by one redraw.* The camera-check screen told the call
   screen about a switched-off camera only after it had drawn itself again; a pass arriving in
   that instant still entered with the camera on. Now the choice is said at the press itself,
   and so is the phone's answer about a permission. And while an enabled camera's picture is
   still starting, the box says "One moment…", not "Camera off".
2. Smaller, in the one join check: the clock is looked at as the very last thing before the
   pass is made (after the look for a block, which takes a moment); a block written down while
   the step waited is found before the person is taken out of another room; a call whose time
   looks up at the first look is read once more, waiting for a step that may be adding time
   at that moment, before anyone is told it has ended.
3. Left as it is, said plainly: while the video service is slow to take someone out of
   another room, a pause or the closing of that person's account waits for it (it wants the
   same line). The newer main does the same; changing the order is not this part's work.

## Astra's fifth look at the code (21 November 2026): "not ready", now worked in

1. *An old camera check could overwrite the new one.* If the person left the call's screen
   while the phone was still answering about a permission, and came back, that late answer
   could put "camera on" back over what they saw and chose on the new screen. Now only the
   camera check that is on the screen has a say; a late answer for one that is gone is
   dropped. And there is one way the choice reaches the call screen (said at each press and
   once more at "Join", always as it is at that moment); "Join" no longer carries a copy of
   its own.
2. *A call whose time looks up,* at any of the first looks, is asked about for sure (waiting
   for a step that may be adding time) before anyone is told it has ended; if time was
   added, the join starts afresh, once. This is done in a step of its own that holds nothing
   afterwards, so "End call and report" waits at most for that one short reading, never
   while someone is being taken out of another room.
3. *The look for a block comes first* among the early looks, so the clock is read right
   before anyone is taken out of another room.
4. Left as it is, as before: a pause of an account waits while the video service takes that
   person out of another room.

## Astra's sixth look at the code (21 November 2026): "not ready", now worked in

The points of the fifth look were found closed. Two more orderings of the camera choice were
left, both in the instant the camera check hands over to the call. They are closed by
changing how the choice is kept, not by one more patch:

1. *The choice lives in one place.* What the camera check on the screen says is kept by the
   call's screen itself, and the call enters with exactly that. Nothing is copied when the
   pass arrives any more, so a switch pressed "off" at any moment the camera check can still
   be pressed is off in the call. Until a camera check has spoken, both are off.
2. *A "Join" belongs to the camera check it was pressed on.* If that camera check is gone
   when the pass arrives (the screen was left; or near the call's end the screen showed "One
   moment…" and then a new camera check), the pass is not used: entering takes a fresh press.
   So a new camera check, whose switches start "on", can never be entered with unasked.
3. A camera check says that it has left in the very step that takes it off the screen, so no
   late answer of the phone's about a permission can slip in between.
4. Smaller: if the call cannot be read when its time looks up, the answer is "could not
   connect, try again", not "this call has ended".

**Astra's seventh look (21 November 2026): the camera question is closed.** It found no
ordering left in which a switch shown "off" on the camera check enters the call as "on", and
the four points of the sixth look closed. One thing it added, now worked in: a pass that is
not used (its camera check was gone) still brought the call's newer end with it, and that was
thrown away with the pass; near the old end the screen could then take a call that had been
made longer for over. Now a later end is kept, and only entering is refused.

**Astra's eighth look (21 November 2026): "ready with changes", two notes, both taken.** An
answer to a "Join" whose camera check is gone is not shown on the camera check that replaced
it (not its refusal, not its failure), and its clock is not taken, since it was read before
the moment the screen has already reached; only a later end of the call is kept.

**Walked again on the Android test phone after this change (21 November 2026):** the camera
switched off on the camera check, then "Join call": the call opened with the camera off and
the microphone on. Left, and joined again with the camera on and the microphone off: the
call opened exactly so.

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
