# Plan 42: One person who is a host and a customer

**Status:** built with this plan, 20 November 2026 (see `docs/module-record.md`). Written by the
builder from the code as it was on `main` after pull request 67. Astra checked the plan twice: the
first version, and again after the founder's 2 minutes after every call were added. Both checks
are at the end, after "What changed while building".

## For the founder: what this is

You asked: "a person can be a host and a customer at the same time. So what happens then?" and
suggested one shared schedule, so that the calls customers book with her never clash with the
calls she books with other hosts.

**That shared schedule exists already** (module 4). Each person has one list of taken times. A
call or a request goes into it whichever side she is on, and the database itself refuses two
entries of one person that overlap. Her own page stops offering a time the moment she asks
another host for it. "Available now" reads the same list.

Reading the code for this plan, five small things turned out to be missing. This plan closes
them. It is one small pull request with no change to the database.

## What the founder said (19 November 2026)

- "shouldn't there be a 2 minutes gap in between booked calls?" There was none: see gap 1.
- Asked whether 2 minutes are enough, the builder advised 5. The founder: "someone may only
  book the host for 5 minutes right? that is the minimum time the host can allow someone to
  book right? so with the 5 minutes forced pause it seems unreasonable if that is the case".
  That is right: the shortest call is 5 minutes, and a forced pause as long as the call itself
  is out of proportion.

So decided by the founder: **2 minutes after every call, for everyone.** It is the least that
always holds, not advice on how long a break should be. Who wants more leaves more: a host
with her break, a customer by the times she picks.

## What already works (read in the code, no change)

- One list of taken times per person, in either role; the database refuses any overlap
  (`drizzle/0010_busy_no_overlap.sql`).
- Her open times and her "available now" leave out everything on that list
  (`openTimes` and `instantOffer` in `src/lib/booking/bookings.ts`).
- She cannot book, follow, invite, support, block or report herself, and is never suggested to
  herself.
- A rating is stored with the role it was received in, so her rating as a customer never counts
  in her rating as a host.
- One ID check counts for both roles: it belongs to the person (`src/lib/safety/identity.ts`).
- You can suspend her hosting alone (her host profile) or pause the whole account.
- Money is separate: she pays by card and is paid to her bank.

## The five gaps

1. **No time at all after a call taken as a customer.** A customer can book one host until
   3:00 and another from 3:00. And a host can set her break to 1 minute.
2. **No break after a call she booked herself.** After a call she hosts, her break is kept
   free. After a call she takes as a customer, her page offers the very next minute.
3. **Requests to her that can no longer happen keep waiting.** Customer A asks her for 3:00.
   Then a call she booked herself for 3:00 becomes fixed. A's request can never be accepted
   now, but A waits up to 24 hours before hearing "ended without an answer".
4. **Her own pages do not say why a time is gone.** Nothing on the Hosting side shows "taken
   by your own call with X".
5. **She is not told that her own request closes her page.** The request page says "you cannot
   ask for another call that overlaps it". It does not say that nobody can book her either.

## Decisions (1 is the founder's; the others are the builder's, and the founder can change them)

1. **Two minutes after every call, for everyone (the founder's).**
   - A call taken as a customer takes that person's time until 2 minutes after its end. It is
     written into the list of taken times, so the database refuses anything inside those 2
     minutes: another call as a customer, a call she hosts, more time in the call before.
   - The shortest break a host can choose becomes 2 minutes (was 1). The other choices stay:
     5, 10, 15 and 30, and 5 for a new host.
   - A host who has 1 minute stored today (test accounts only) counts as 2 from this change
     on, for every new request and call, without having to save anything; her form shows 2.
     Calls and requests made before keep what was saved with them.
2. **Her break also follows a call she booked herself, when it is longer than 2 minutes.**
   Customers are offered no start time inside her break after such a call, and a request for
   one is refused. The break is the one on her calendar page at that moment: if she changes
   it, this changes with it. The break after a call she hosts stays the one saved with that
   call, as today.
3. **The 2 minutes hold for everyone. What goes beyond them, up to her break, limits only what
   customers can ask of her, never what she chooses herself.** With a 5-minute break and a call
   of her own until 3:00: nobody can ask her for a time before 3:05. A request for 3:02 that was
   already waiting she may still accept, and she may book another host from 3:02. Nothing can
   start before 3:02.
4. **When a call she booked herself becomes fixed, requests to her that it gets in the way of
   end at once.** "Fixed" means: the other host accepted her request, or she booked as a member
   (fixed at once), or a call she is in as a customer was given more time. "In the way" means
   the request could never be accepted: its call, or the break that would follow it, overlaps
   her own call or the 2 minutes after it. A request that only touches the rest of her break
   stays (decision 3).
5. **Those customers are told the truth without her private business:** "{Host} is no longer
   free at that time." Not that she booked a call of her own. It does not count as a decline,
   so they can ask her again without the 7-day wait, within the usual daily limits, as after
   "accepted another request".
6. **While her own request only waits, requests to her stay.** The other host may still say
   no. If she tries to accept one of them meanwhile, she is refused as today ("You already
   have a call or a request of your own at that time"). She can take her own request back
   first.
7. **An unanswered request of hers keeps closing her page for that time.** It is the only way
   to be sure of no clash, and it lasts about 24 hours at most (the answer deadline; the
   background helper then ends it). She is told so before she sends it (decision 9).
8. **Her calendar page gets a short list, "Taken by your own bookings".** One line for each
   call or waiting request she has as a customer that still closes her page: coming ones, one
   that is under way, and one that is over while her break after it still runs. Each line has
   the time, the other host's name, "waiting for an answer" where that is so, the moment she can
   be booked again, and a link. No list when there is nothing to show.
9. **The sentences where a call is asked for.**
   - For everyone, in place of "you cannot ask for another call that overlaps it": "you cannot
     ask for another call that overlaps it or starts in the 2 minutes after it."
   - Only for a person with an approved host profile, on the page for a booked call and the
     page for a call right now: "You are a host too: while this request waits, and during the
     call, nobody can book you at this time." Where she books as a member (fixed at once):
     "You are a host too: nobody can book you during this call, and requests to you for that
     time end."
10. **More time in a call leaves the 2 minutes too.** A customer who has another call right
    after can add 2 minutes less than today. A host's side already leaves her break.
11. **For a person who is only a customer, the 2 minutes are the only change. For a person who
    is only a host, the shortest break is.**

## What it relies on (each read in the code by the builder)

- `busyOf` (`src/lib/booking/bookings.ts`) returns a person's taken times. It is read **for a
  host** in six places: `instantOffer`, `openTimes` and the check of an asked start in
  `bookings.ts`, and three places in `src/lib/membership/book.ts` (the member's open times, the
  times shown to an invited person, the check of a member's start). It is read **for the
  customer** in three other places (asking for a booked call, asking for a call right now, a
  member's booking), each of which compares it with the new call's own start and end.
- A customer's entry is written without anything after the call in four places: when a request
  is sent (`sendToHost`), when `accept` sets the times of a call right now, when a member books
  (`membership/book.ts`), and when a call gets more time (`src/lib/extend/extend.ts`).
- How much more time fits is worked out by `minutesThatFit` (`src/lib/extend/`): the host's
  side takes off the break, the customer's side takes off nothing.
- The break choices are `BREAK_CHOICES_MINUTES` in `src/lib/booking/rules.ts` (1, 5, 10, 15,
  30). The calendar form and the check on saving both read that list. The shortest call is 5
  minutes (`LENGTH_STEP_MINUTES`).
- What a host offers is put together in one place, `offerOf`, which hands on her stored break
  as it is. Every new request copies its break from there.
- A room closes at the call's booked end: `CLOSE_LATE_SECONDS` in `src/lib/calls.ts` is zero
  since November 2026. So the reason `plans/04-calendar.md` gives for a 1-minute least break
  ("a call's room takes a minute to close") no longer holds. The 2 minutes are for the person,
  not for the room.
- `endRequestsInTheWay` ends a host's waiting requests that overlap a stretch of time, with the
  stage `passed_over`. It is called for the call's **host** in three places: `accept`, the
  member's booking, and more time. Never for the customer.
- The sentence for `passed_over` is in four places: `src/app/bookings/[id]/page.tsx` (one for
  the customer, one for the host), `src/app/page.tsx`, and the email in
  `src/lib/booking/emails.ts`.
- A request's answer deadline is 24 hours at most (`answerDeadline` in
  `src/lib/booking/rules.ts`); the helper ends it after that (`endUnanswered`).
- Every step that fixes a call already holds both people's calendar locks (`lockCalendars`),
  taken in a fixed order, so two hosts who book each other cannot cross.
- When a customer finishes the card step (`finishCardStep`), the host's offer is checked with
  the break **saved on that request**, not her break of today. So her break of today must not
  be taken from the offer that is passed around.
- A request for a call right now takes its customer from the moment it is sent, and `accept`
  writes new times for it. The times after that step are the ones that count.
- `passed_over` adds no 7-day wait, but the request still counts in the customer's daily limits
  (`checkMayAsk`).
- `calendarOf` creates a calendar for a person who has none. It must not be used to look up a
  break.
- The test call that only check scripts can make (`createTestCall`) writes a 1-minute break
  for the host and nothing after the call for the customer.

## The changes

- `src/lib/booking/rules.ts`: `AFTER_CALL_MINUTES = 2`, the one place the number lives.
  `BREAK_CHOICES_MINUTES` starts at 2. `offerOf` hands on the stored break or 2 minutes,
  whichever is more.
- The customer's entry ends 2 minutes after the call in the four places that write it, and in
  `createTestCall` (2 minutes for both people there). The three checks made for a customer
  before a card is entered count the 2 minutes after the new call as well, so she hears "You
  already have a request or a call at that time, or within 2 minutes of it" early, and not
  from the database at the last step.
- `minutesThatFit`: the customer's side takes off the 2 minutes.
- `src/lib/booking/bookings.ts`:
  - `takenAsHost(reader, hostId, from)`: the same list as `busyOf`. For each entry whose
    booking has her as the customer, the end becomes the call's end plus her break of today
    when that is later than the stored end. It reads her break itself, with a plain read of her
    calendar (no break without a calendar), and also reads entries that ended less than one
    break ago. It works on the entries as they are stored, so a request for a call right now
    counts from the moment it was sent. The arithmetic is plain logic with tests. The six
    places that read for a host use it; the three for a customer keep `busyOf`.
  - `endRequestsInTheWay` gets a reason. For the **customer** of a call that was just fixed it
    is called with that person's entry as stored (the call and the 2 minutes) and the reason
    "the host is no longer free at that time": in `accept` (with the times as that step wrote
    them, after the busy entries are in), in the member's booking and in more time, next to the
    call that is there for the host. The stage stays `passed_over`. The two reasons are
    constants in one place.
  - `ownBookingsTakingTime(userId, now)`: what decision 8 shows.
- The four places with the `passed_over` sentence choose by the reason: the sentence of today,
  or "{Host} is no longer free at that time." (the email's subject and its text). For the
  host's own view: "A call you booked yourself took this time."
- `src/app/host/calendar/page.tsx`: the list of decision 8; a host at 1 minute sees 2 chosen;
  the word "minute" for a choice of 1 goes (it would no longer pass the type check).
- `src/app/h/[handle]/book/page.tsx` (the request and, further down, `MemberBook`) and
  `src/app/h/[handle]/now/page.tsx`: the sentences of decision 9.
- Check scripts that say today what a customer is taken for, or how close two calls may sit,
  change with the rule: `scripts/now-check.ts` (the customer's taken time, three places),
  `scripts/member-calls-check.ts` and `scripts/extend-check.ts` (the customer's end),
  `scripts/booking-check.ts` (5-minute calls now come 7 minutes apart, not 6). In
  `scripts/extend-check.ts` the customer's next call sits 6 minutes after the first: only 4
  minutes would fit now, under the least that can be added, so that set-up moves, not only the
  number it expects. The tests of the open-times rule that pass a break of 1 stay: they test
  arithmetic, not what a host may choose.
- `plans/04-calendar.md`: a note at decision 6 (the break): 2 minutes is the least, by the
  founder's rule, and the old reason about the room is gone. `docs/module-record.md`: what was
  built. `docs/for-the-lawyer.md`: nothing new.

## How it will be checked

- Tests of the plain logic: her break is added only to her own bookings and only beyond the 2
  minutes; an entry that ended inside the break still counts; a break of 2 changes nothing;
  with the open-times rule, the first time offered after her own call is the end of her break,
  and the last one before it still leaves the new call's break; more time leaves 2 minutes
  before the customer's next call; a break of 1 can no longer be saved.
- `scripts/booking-check.ts`, new journeys:
  - a person who is only a customer has a call until 3:00: a request to another host for 3:00
    or 3:01 is refused, one for 3:02 goes through; so does a call that ends 2 minutes before
    her next one, and one that ends 1 minute before it is refused;
  - a host with a 5-minute break books 2:30 to 3:00 with another host: her page no longer
    offers 3:00, offers 3:05, and a request for 3:02 is refused;
  - a request to her for 3:02 was waiting before: it stays when her own call is fixed, and she
    can accept it;
  - requests to her for 2:45 and for 3:00 were waiting; the other host accepts hers: both end,
    their customers get the "no longer free" email, are free again at that time, and can ask
    her again the same day;
  - while her own request only waits, the 2:45 request stays, and accepting it is refused;
  - she changes her break to 15 minutes: 3:05 and 3:10 are no longer offered, and a customer
    who was entering a card for 3:05 is refused when the card step ends;
  - she asks another host for a call right now and is accepted: a request to her that the call
    overlaps ends.
- `scripts/member-calls-check.ts` and `scripts/extend-check.ts`: one journey each for the
  member's booking and for more time ending a request in the way, and more time stopping 2
  minutes before the customer's next call.
- In a browser, as a test host who books another test host: the list on the calendar page, the
  sentences on the request pages, the break choices, and the sentence a passed-over customer
  sees.
- After Astra's and CodeRabbit's points are worked in, the scripts are run again.

## Not built

- A mark on a waiting request she cannot accept right now because of her own waiting request.
  The refusal already says why.
- Bringing ended requests back when her own call is cancelled later. A host's calls work the
  same way today.
- Paying for calls out of her earnings. Connect would be holding money; that is a question for
  the lawyer and for Stripe, not a small change.
- Showing her host name when she books as a customer. Other hosts see her account name, as
  for every customer.
- The home page for hosts (plan 38, on another branch, not built). When it is built, its list
  of the day should show her own bookings too.
- Changing calls and requests that exist already (test data only): they keep what was saved
  with them, so two old calls of one person may still sit closer than 2 minutes. One more
  effect of old data: a request for a call right now that was sent in the 2 minutes before
  this change goes live can be refused when the host accepts, if its customer was booked
  again right behind it. It cannot happen to requests sent after the change, and the live
  database starts empty.

## Still open

- Decisions 2, 4 and 7 are the ones a founder may see differently: her break after her own
  bookings, ending requests at once, and her own request closing her page while it waits.

## What changed while building

- **The number.** This was written as plan 41. Another session merged its own plan 41 (suggested
  hosts) in the meantime, so this became plan 42.
- **The card step is not a journey in a script.** The plan wanted: she makes her break longer,
  and a customer who was entering a card for a time inside it is refused when the card step ends.
  That needs a paid host and Stripe's card form. Built instead: `takenAsHost` takes no break from
  outside at all, so the card step cannot hand it a saved one; and the script checks that a new
  request for a time inside the longer break is refused.
- **The call right now** is a journey in `scripts/now-check.ts`, and the request to her is
  written straight into the database there (a real request needs a day's notice, a call right
  now starts in a minute). The same in the more-time and member-calls scripts.
- **The home page line and the "ran out" reason** use the same words as the rule, from one
  place (`PASSED_OVER`, `AFTER_CALL_MINUTES`).

## Astra's check of the first version (19 November 2026)

"Build with changes." Astra read the plan against the code and confirmed the main claims: one
list per person that the database guards, the count of places that read it, the three steps
that fix a call and their locks, and that adding the break when the list is read fits the
open-times rule without a double break. Six findings.

**Taken:**

1. Two decisions contradicted each other: a request for the minute her own call ends was "hers
   to accept" in one and ended in the other. Now only requests that could never be accepted
   end; one that only touches her break stays. (With the founder's 2 minutes the line moved
   from the end of her call to 2 minutes after it.)
2. Her break of today must not come from the offer that is passed around, because the card
   step puts the request's saved break into it. `takenAsHost` reads it itself. The plan now
   says what a changed break does.
3. A request for a call right now: the stored times count, and `accept` uses the times it
   just wrote. More journeys in the checks (a changed break, a call right now, the two times
   around her own call).
4. The sentence for a host who books as a member, which is a different part of the page. The
   calendar list also shows a call under way and a break that still runs.
5. "Can ask again right away" was too much: the daily limits still count. "24 hours at most"
   is the deadline, and the helper ends the request after it. The email's subject changes too.
6. Notes on the paths left alone, and a plain read for the break, because `calendarOf` would
   create a calendar.

**Not taken:** a lock around saving the calendar's choices, so that a changed break and a
request can never cross. The worst case is one request inside a break that was made longer
that very second, and she can decline it. A journey for two hosts who book each other at the
same instant: the locks are taken in a fixed order today, and nothing in this plan changes them.

## Astra's second check (the 2 minutes, 19 November 2026)

"Build with changes." Astra confirmed: every place that writes a customer's taken time is
named; nothing reads that time as "the call's end" (more time looks at the start of the next
entry; the home page and reminders show the call's own times); the example with 3:00, 3:02 and
3:05 is right, and a request for exactly 3:02 survives and can be accepted; `takenAsHost` does
not add the 2 minutes twice; accepting a call right now only shortens the customer's taken
time, so it cannot fail for requests sent after the change. Five findings, each read in the
code by the builder.

**Taken:**

1. The calendar form's word for a choice of 1 minute would fail the type check once 1 is no
   longer a choice.
2. The list of check scripts that must change was too short, and one set-up in the more-time
   script has to move.
3. A host stored at 1 minute would have gone on handing 1 minute to new requests until she
   saved. Now the offer itself hands on at least 2.
4. The note for plan 4: its reason for a 1-minute least break is out of date, since a room now
   closes at the booked end.

**Taken as a note only:** a request for a call right now from the 2 minutes before the change
can be refused at acceptance (under "Not built"). No new wording for that refusal: it cannot
happen to new requests.
