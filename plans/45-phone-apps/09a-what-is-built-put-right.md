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
those screens on the test phone and puts seven small things right. Nothing new is added.

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
5. **A refusal because of a bank dispute says so, and points to "your messages".**
   `STOPPED_WHILE_OPEN` in `src/lib/disputes/paying.ts` reads "Your bank has an open dispute
   about a payment on Connect ... Your messages say more." The app's booking address already
   passes it on. Two things are wrong with that on a phone. On the website "messages" is the
   page where Connect's own message is; in the app, "Messages" will be the conversations
   between two people (part 17b). And the stop looks at a customer's disputes whatever the payment
   was for (those that are open, and those the customer won although Connect had sent its
   proof, until the founder allows paying again; a bank's mere question stops nothing): a customer whose only dispute is about a contribution or a
   tip is told about "a dispute" when he tries to book an ordinary call.
6. **What a paused or blocked person is still offered, and can still do, while the
   tidying-up runs.** A pause ends a person's waiting requests and coming calls a moment
   later, not in the same step. Until then:
   - the app's answer for a booking offers the steps that fit its stage, and the answer for
     a call offers the card step and the way in, without asking whether the two may still
     act (`src/lib/app-door/booking.ts`, `calls.ts`);
   - the list of requests a host sees, and one request's own screen, show a customer's
     name, rating, ID mark and note after asking only whether that customer's account is
     *closed* and whether there is a block (`openAndUnblocked` in
     `src/lib/people/contacts.ts`): a *paused* customer still shows, and a paused host can
     still open the list;
   - most addresses that do something refuse a paused person, **but not all:** a customer
     can still reach the step that saves a card for a request while the host's pause waits
     for its tidying-up (`src/lib/booking/bookings.ts`), and the check before a call's money
     is held asks about pauses and blocks but not whether the other account was closed
     (`src/lib/payments/hold.ts`).
7. **The last step of signing up does not say that a new version of a document is coming.**
   The website's page does, above the button: from which day, what changes, and a link to
   read it, also for the two documents a person is told about and does not accept
   (`src/app/welcome/page.tsx`). The app's address sends only the documents in force today
   (`src/app/api/app/welcome/route.ts`). Plan 46 left this to the phone build by name.

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
5. **In the app, the refusal names no bank and no dispute.** *(Rewritten after Astra's second
   check.)* Whatever the dispute was about, the app's sentence is the same: "You cannot
   start anything new that costs money on Connect right now. Connect has written to you
   about it: the message is in your email, and on your Messages page on the website." The
   website keeps its own sentence. One function gives both. **The stop itself is not
   changed:** it is the website's rule (plan 47) and holds for the whole account, so a
   customer who disputed a contribution cannot book a call in the app either; the app only
   does not say why. The sentence a *host* is shown when her customer is the one who is
   stopped stays neutral, as it is.
6. **One rule for "may these two still act", asked wherever it matters.** *(Widened after
   Astra's second check.)* Both accounts open, neither paused, no block between them. It is
   asked:
   - before a list of requests is counted, grouped or filled: a request whose two people
     may no longer act is **not in the other person's list at all**, nor in its number, as
     if the tidying-up had already run (today the list writes the customer's name straight
     from the row, whatever the check says);
   - before one request's own screen is answered: if it is asked for directly in that
     moment, the other person gets "This request is no longer available.", with "Report"
     and "Block" still there under labels that name nobody;
   - before the app's answers for a booking and for a call offer a step;
   - **in the steps themselves where their own gate is weaker:** saving a card for a
     request; the check before a call's money is held (which also learns to refuse when the
     other account was closed); and going into a call's room, which today asks about the
     person coming in and about a block, not about the other person's pause or closure.
     (The one call a deleting person may finish, part 19, decision 2, is the stated
     exception at the room's door.)
   - **A host's private note about a customer is hers,** and the website lets a paused host
     go on editing it on purpose. That stays; in the app she reaches it from Contacts (part
     17), not from a request whose details are being withheld.
   What the paused person may still do with their own things stays as the website has it
   (take a request back, cancel, look at past calls and receipts, "Report", "Block"), and so
   do the steps that only read or tidy up.
7. **The app's last step of signing up says what is coming, in words of its own.** Its answer
   gains the announced versions: which document, from which day, whether it is one the
   person accepts or one they are only told about, and a link to read it. **Not the
   summary:** on the website that is free text written for each version, and a version that
   changes the terms about contributions or tips would put those on the sign-up screen. The
   app's sentence is fixed ("From 12 January a new version of the Payment Terms applies.
   Read it."); the summary is on the website's page behind the link. What is accepted today is still today's version and
   nothing else. The link opens the website, as the step's other document links do. (How
   legal text is shown inside the app is part 18's open decision 5; a link out does not wait
   for it.)

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
  - a booking refused because of a bank dispute, once for a dispute about a call and once
    for one about a contribution: the app's answer is the same in both, word for word and
    field for field, and holds neither "bank" nor "dispute"; the website's own page keeps
    its sentence;
  - a customer paused a moment ago, before the tidying-up: his request is not in the
    host's list or its number, and asked for directly it answers "no longer available"
    with no name in any field; a paused host's list holds no customer's details; nobody
    goes into a room whose other person was paused or closed a moment ago; a customer whose host was paused a moment ago cannot save a card
    for that request; a call's money is not held when the other account was closed;
  - the app's last step of signing up while a new version of a document is announced, with
    a summary that speaks of contributions: the notice is in the answer, the summary's
    words are not, and accepting records today's version.
- The app's own tests and types; the placeholder screen's test no longer expects the line.
- On the Android test phone, with pictures: the walk of decision 1; a paused account's home
  screen; a blocked pair's booking.

## What cannot be tried here

A real call between two phones, and an iPhone. Listed in part 20.

## Keeping the 4.9%

This part exists for it: three of the seven points are words about a project, or because of
one, that reached a phone. From here on part 20's sweep reads every answer of every app address for such words,
with real things behind them, so the next one is caught by a check and not by a reader.

## Astra's second check (27 November 2026): "not ready", worked in

1. *A refusal that says "a bank dispute" can itself come from a contribution.* Decision 5: the
   app's sentence names no cause.
2. *The list of booked requests did not have the protection this plan meant to copy,* and two
   steps could still be taken during the tidying-up. "What is there today", point 6;
   decision 6.
3. *Nobody owned the notice of a coming document version at sign-up.* Point 7; decision 7.

## Astra's third check (27 November 2026): "not ready", worked in

1. *Two parts said two things about a request that may no longer be acted on.* Decision 6: it
   leaves the other person's list and count; its own screen answers "no longer available".
2. *Two more steps had a weaker gate:* going into a room, and a host's note. Decision 6.
3. *A version's summary is free text and can speak of contributions.* Decision 7: the app's
   notice has fixed words.
4. *Which disputes stop new payments* was put too widely. "What is there today", point 5.
