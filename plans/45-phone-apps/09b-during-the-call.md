# Phone apps, part 09b: during the call (a locked phone, connection grades, more time, the chat)

**Status:** a plan only. Written 20 November 2026 by the builder alone. Part of plan 45. Made
when Astra's check split the first draft of part 09; its points are worked in.

## For the founder: what this is

The four things that happen inside a call beyond seeing and hearing: what the app does when
the phone is locked or another app comes to the front; the connection grades that later serve
as evidence for a refund; asking for more time; and the text chat.

## What is there today (read in the code)

- **Connection grades** (plan 13): `quality-notes.tsx` sends, for both people, on entering, on
  every change and at intervals, the grade LiveKit gives, with a number for the connection, a
  running number and a time the server corrects. They are received by
  `/api/calls/[id]/quality` (`src/lib/quality/notes.ts`), which today accepts only what the
  website's own page sent (`fromThisSite`), and which checks the person, the room's time, the
  size and repeats. They are **evidence for refunds**, not for charging.
- **More time** (plan 9; `src/lib/extend/`): the customer asks near the end, choosing minutes
  from the choices that fit (or their own number). **The server tries the saved card itself**
  (the one kept with the booking, part 06); there is no card form. The answer is a request in
  the state "checking" or "waiting". If the bank wants its own approval, the request fails and
  the call ends when it would have. A free call's extension needs no money. A member's is paid
  from the month's time if it covers all of it, and otherwise wholly by card, at the price
  shown; the screen says which, and sends what it showed; if that has changed, nothing is
  asked and the new way and price are shown to be pressed again. The host can accept only
  once the money is ready, and only inside the time allowed.
- **The chat** is LiveKit's own, in the website's ready-made call screen; nothing of it is
  kept after the call.

## Decisions (the builder's)

1. **When the app is not at the front, or the phone is locked: the sound goes on and the
   camera goes off.** This is Connect's choice, for privacy: nobody should be on camera
   without the call on their screen. The other person sees "camera off". Coming back turns
   the camera on again only if it was on before. The server goes on counting, since the
   person is still in the room and can be heard.
2. **What each kind of phone needs for that,** written down so it is not left to chance:
   - Android: an ongoing notice in the phone's top bar for as long as the call lasts ("In a
     call on Connect", with a way back), started while the app is on the screen, of the
     "microphone" kind, with the permissions that go with it;
   - iPhone: the call's sound set up as a conversation, and the app allowed to keep sound
     going in the background.
   A phone call coming in, or headphones plugged in or out, must not break the call: the
   sound moves, or the call pauses and comes back. Written for both; proven only on real
   phones.
3. **Connection grades are sent by the app as the website sends them,** to a twin of the
   address: the twin lets the app in by the door instead of by "our own page", and every other
   check (the person, the room's time, the size, repeats) is the same shared code. The
   website's own address keeps its check unchanged. A refund request about a call with one
   person in the app and one on the website must show grades for both.
4. **More time works exactly as the server already does it, with no card sheet.** The app
   shows the choices and prices the server sends, says how each would be paid, sends what it
   showed, and shows "checking", "waiting for the host", "the way or price changed, press
   again", "the bank did not allow it", or the new end. The time on the screen moves only
   when the server says the end has moved. The host's Accept appears only when the server
   says the money is ready.
5. **The chat is in the app:** a person on the website may type, and the person in the app
   must be able to read it and answer. As on the website, nothing of it is kept.
6. **The apps' switches apply here too:** with memberships off for the apps, more time for a
   member's call is offered by card only if the server offers it so; the app never decides.

## How it is tried

- Check script: grades sent the app's way are accepted and are refused for a stranger, outside
  the room's time, too large, or repeated; a refund request's summary for a mixed app and
  website call holds both people's grades; more time asked the app's way in each case (card,
  membership time, free, the bank refusing, the way changed meanwhile).
- `extend-check`, `refunds-check` and `member-calls-check` unchanged and green.
- On the Android test phone with the website as the other person, with pictures: the app sent
  to the background and brought back, with the camera off and on; the phone locked and
  unlocked; the ongoing notice; more time asked, accepted and the end moving; a refused
  extension; the chat in both directions.

## What cannot be tried here

A phone call coming in; headphones; an iPhone's behaviour in the background. Listed in
part 20 for the two-phone test.

## Keeping the 4.9%

More time is more of the same one-to-one call, paid the same way as the call.
