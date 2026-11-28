# Phone apps, part 09a: before going on (what is already built, put right)

**Status:** a plan only. Written 27 November 2026 by the builder alone. Part of plan 45. It
was made when the plans were brought up to date after a week's pause: reading the code, and
then Astra's check of the updated plans ("not ready"), found faults in what the apps already
have. They are gathered here so that they are put right first, in one small pull request,
before part 09b builds anything new. Like every part it is read against the code once more
on the day it is built.

## For the founder: what this is

Parts 01 to 09 are built. While the build was paused, the website changed, and one of those
changes ("End call now") also changed the app, without a phone to try it on. This part walks
those screens on the test phone and puts six small things right. Nothing new is added.

## What is there today (read in the code)

1. **The screens after "End call now"** (plan 51: `mobile/src/app/ended.tsx`,
   `mobile/src/app/room/[id].tsx`, `mobile/src/room/in-call.tsx`, and the server's
   `/api/app/calls/[id]/ended` and its steps) were typed and unit-tested and never run on a
   phone.
2. **A sentence that names a monthly contribution reaches the app.** `END_WORDS.blockWhat`
   (`src/lib/call-page/end-words.ts`) says "any membership or monthly contribution between you
   ends". The app's address sends it twice: as the explanation under "Block" and as the
   question the app asks before blocking (`block.what` and `block.sure` in
   `src/app/api/app/calls/[id]/ended/route.ts`).
3. **A paused person is shown the founder's own words.** `startFor`
   (`src/lib/app-door/start.ts`) sends the stored reason of a pause as it was typed, and the
   home screen shows it (`mobile/src/app/(tabs)/index.tsx`). A person on the team can write
   anything there, a sentence about a diary post or a project included.
4. **The Account screen is still the placeholder of part 02,** and prints what the server
   said when the app opened: "Memberships: ... Tips: off. Available now: ..."
   (`mobile/src/app/(tabs)/account.tsx`). The word "Tips" is on every phone, signed in or
   not.
5. **A refusal because of a bank dispute ends "Your messages say more."**
   (`STOPPED_WHILE_OPEN` in `src/lib/disputes/paying.ts`). The app's booking address already
   passes it on. On the website "messages" is the page where Connect's own message is. In
   the app, "Messages" will be the conversations between two people (part 17b), where that
   message is not.
6. **What a paused or blocked person is still offered while the tidying-up runs** (Astra's
   reading, to be read again before it is touched): the app's answer for a booking offers the
   steps that fit its stage, and the answer for a call offers the card step and the way in,
   without asking once more whether the two may still act (`src/lib/app-door/booking.ts`,
   `calls.ts`). The addresses that *do* something have the stronger gate, so nothing wrong
   can be done; but a button can be shown that will only be refused.

## Decisions (the builder's)

1. **Walk first.** On the Android test phone, with the website as the other person: the
   question before the press as customer and as host, the press, the three choices, "Block"
   with its question, "Neither", the other person's screen going to the choices by itself,
   and the way back to the choices from the call's page later. What is wrong is put right in
   this part and said in its pull request.
2. **The app gets its own sentence about blocking, in both places.** It says what blocking
   ends between the two: calls, and "membership" only while memberships are on for the apps.
   It never says "contribution". The website keeps its sentence. One function gives both, so
   the two cannot drift apart unnoticed.
3. **A paused person reads a sentence that is safe on a phone, not the stored reason.** The
   app's answer no longer carries the founder's text. The screen says that the account is
   paused, what a paused account can still do, that the reason is in the email sent at the
   pause and on the website, and where to write if it is a mistake. The website's own page
   is not changed.
4. **The placeholder's line of switches is taken off the screen.** The server still tells
   the app its switches; the app needs them. Nothing prints them.
   *Not taken from Astra's check:* removing the tips switch for the apps altogether. That
   switch is the founder's plan of 20 November (plan 44, decision 18, and part 01): born
   off, and turned on only after a store has said that a tip after a one-to-one call may be
   paid outside its own payment. While it is off, nothing about a tip is shown or accepted,
   and that is what part 20's sweep checks.
5. **The bank-dispute refusal names the right place in the app.** For the apps the last
   sentence reads "The message about it is in your email, and on your Messages page on the
   website." The website keeps "Your messages say more." Both come from one function. The
   sentence a *host* is shown when her customer is the one who is stopped stays neutral, as
   it is.
6. **What is offered follows what may be done.** After reading the code again: the app's
   answers for a booking and for a call offer a step only if the address behind it would
   take it from this person now (not paused, not closed, no block between the two). Past
   calls, receipts, "Report" and "Block" stay, as the website leaves them to a paused person.

## How it is tried

- `app-calls-check`, `app-room-check`, `app-booking-check`, `app-door-check` and
  `end-now-check` grow, and everything they check today still passes:
  - the answers of `/api/app/calls/[id]/ended` for a pair with a membership and a monthly
    contribution between them, with memberships on and off for the apps: neither the
    explanation nor the question holds "contribution", and "membership" only when on;
  - the app's opening answer for a person paused with a reason the founder typed about a
    diary post: the typed words are nowhere in the answer;
  - a booking and a call read by a paused person, and by each of a blocked pair: no step is
    offered that the address behind it would refuse; "Report" and "Block" are still there;
  - a booking refused because of a bank dispute: the app's sentence names email and the
    website; the website's own page keeps its sentence.
- The app's own tests and types; the placeholder screen's test no longer expects the line.
- On the Android test phone, with pictures: the walk of decision 1; a paused account's home
  screen; a blocked pair's booking.

## What cannot be tried here

A real call between two phones, and an iPhone. Listed in part 20.

## Keeping the 4.9%

This part exists for it: two of the six points are words about a project that reached a
phone. From here on part 20's sweep reads every answer of every app address for such words,
with real things behind them, so the next one is caught by a check and not by a reader.
