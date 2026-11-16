# Plan 15: A customer picks the length of the call

**Status:** plan only, not built. Written 15 November 2026. Astra has checked it against the code
twice; what it found each time is at the end, and every point is worked in. The two changes it
builds on are merged (calls as short as 5 minutes, pull request 24; the customer's 24 hours counted
from the call's start, pull request 23).

## What this is, and why

Today a host ticks the call lengths they offer from a fixed list (5, 10, 15, 30, 45 and
60 minutes), and a customer picks one of the ticked lengths. The founder's
point: a customer should be able to choose how many minutes they want, and 60 minutes should not be
the most that can be booked.

After this change a host sets two things, their shortest and their longest call, and a customer
picks any length in between.

## What the founder decided

| Question | Decided |
| --- | --- |
| Who sets the range a customer can pick from? | **Each host**, on the calendar page: a shortest and a longest call. |
| In what steps can a customer pick? | **Steps of 5 minutes** (5, 10, 15, 20 and so on). |
| The longest call that can be booked | **Each host decides for themselves**, anywhere from 5 minutes to 6 hours. No short list of fixed lengths any more. |
| A host who sets nothing | **Their longest call is 2 hours.** (Their shortest stays 30 minutes, the one length a new calendar has today.) |

## Where the host's list ends: 6 hours

The founder's decision is that the host sets their longest call. Hosts choose within a ceiling of
**6 hours**, which keeps the longest possible call what it is today. The ceiling is a choice, not
something the code forces; these are the reasons for putting it there:

1. **Six hours is the longest a call can be today** (60 minutes booked, plus added time), so no
   call becomes longer than calls can already be. A few things were sized for exactly that: the
   notes about connection quality allow for a 6-hour call, and the payment tests model one.
2. **The customer's time to ask for a refund** is 24 hours counted from the call's start, and a
   customer can only ask once the call is over. After a 6-hour call 18 hours are normally left.
   (When a card's hold ends unusually early, that time can be a good deal shorter, as it already
   can today.) A call of a whole day would leave none, so going far past 6 hours would need that
   rule to change first.

Said plainly, because it follows from the host deciding: the whole price is held on the customer's
card at once, up to 2 days before the call. At the highest price a host can set ($1,000 per
15 minutes) a 6-hour call is a hold of $24,000. The app and Stripe can carry that amount; whether a
bank allows it is another matter, and a bank dispute over such a call would be a large loss for
Connect.

The 6 hours are one number in the code. The shortest call stays 5 minutes: the rule that a host can
never collect while a refund request could still come in depends on it.

**Adding time during a call stays, with one new limit:** a call can never be made longer than
6 hours in total, which keeps the longest possible call what it is today. Today that is true by
accident (60 minutes booked, plus at most 5 requests of at most 60 minutes). With longer calls
booked up front it would no longer be, so the rule is written down: the minutes that can
still be added are never more than 6 hours less the call's length so far. Added time keeps its own
choices and can still be any whole number of minutes, as today.

**Instant calls keep the limit they have.** A host can switch "available now" on for at most
2 hours at a time, and 3 minutes of that are kept for answering and starting. So the longest call
that can be asked for on the spot is 1 hour 55 minutes, whatever the host's longest call is, and a
host whose shortest call is 2 hours or more is not offered for instant calls. That is left as it
is; longer instant calls would be a change of their own.

## How it works for a host

On the calendar page the tick boxes "Call lengths you offer" are replaced by two drop-down lists:
**Shortest call** and **Longest call**, each in steps of 5 minutes from 5 minutes to 6 hours. The
shortest cannot be longer than the longest. A host who wants exactly one length sets both to it.
A newly created calendar starts with 30 minutes to 2 hours.
The note about the price and the fixed 30 cents per paid call stays.

## How it works for a customer

On a host's page the row of buttons, one per length, would become far too long (5 minutes to
6 hours is 72 lengths). It becomes a drop-down list, in two separate small forms:

- **Ask for a call later:** "Length" lists every length the host offers, each with its price
  ("25 minutes, $33.33"). Choosing one and pressing "Show times" shows the open times for that
  length, as today. A length the customer has already chosen stays chosen. Before any choice, the
  length shown is the one closest to 30 minutes that the host offers (the shorter one if two are
  equally close).
- **Call now** (when the host is available right away): the same kind of list, holding only the
  lengths that still fit in the time the host has, and a "Call now" button. Its first length is
  chosen from those that fit, by the same rule.

Both work without any script in the browser, like the links they replace. Everything after that is
unchanged: the booking page, the request, the host's answer, the hold on the card, the call. The
booking page and the instant-call page keep refusing a length the host does not offer.

In the two drop-down lists (the host's and the customer's), lengths of an hour or more are shown in
hours ("1 hour 30 minutes", "2 hours"). Everywhere else a length keeps being shown in minutes, as
now ("a 90-minute call").

## How it is built: as little as possible

**Nothing changes in the database.** A host's lengths are stored today as a list ("15,30,60") and
every part of the app that checks a length asks "is it in the host's list?". That stays. The list
simply holds every step between the host's shortest and longest call ("10,15,20,25,30").

- `src/lib/booking/rules.ts`: the list of lengths a host can offer, `LENGTH_CHOICES_MINUTES`, keeps
  its name and becomes every step of 5 from 5 to 360 minutes. Everything that reads it keeps
  working as it is. Added: the length to show first, and the words for a length.
- `src/app/host/calendar/page.tsx` and `actions.ts`: the two drop-down lists. The action checks
  both values first (whole numbers, steps of 5, from 5 to 360, shortest not longer than longest),
  refuses anything else with a plain message, and only then builds the list. The saving step
  itself still takes a list, so the check scripts keep working as they are.
- `src/lib/booking/calendar.ts`: the place where a host's calendar is first created (when they
  first open the calendar page) writes the starting list, 30 minutes to 2 hours, itself. Today it
  leaves that to the database, which fills in "30". Calendars that already exist are not touched.
  (A host is only offered to customers once they have a calendar and weekly hours, so there is no
  host "without a setting" to give a default to.)
- `src/app/h/[handle]/page.tsx`: the two drop-down lists for the customer.
- `src/lib/extend/rules.ts` and `src/lib/extend/extend.ts`: the 6-hour limit. The rule that works
  out how many minutes still fit is given the call's start as well as its end. A request for more
  time is checked against that rule under the call's lock. Accepting does not work it out again;
  it refuses when the call's end is no longer the one the request was made for. So a request that
  fitted when it was made cannot take the call past 6 hours, and one place is enough.
- `src/lib/notifications/reminders.ts`: a small repair that longer calls make matter. The email
  "the room for your call is open now" is dropped if it could not be sent by the call's **end**.
  With a long call it could arrive hours late and still say the call "starts at" a time long
  past. It will be dropped a few minutes after the call's start.

**Hosts who already ticked lengths** (only test accounts exist before launch) keep exactly their
list until they next save the calendar page. The page shows their shortest and longest ticked
length; saving fills in the steps between.

## What does not change

Open times (they are already worked out for the one length that is asked for, so 72 lengths cost
nothing extra), breaks, notice, the price (it already follows the length to the second), our fee,
holds, taking the money, refund requests, collecting, ratings, the record of who was there, and the
call screen. The video service needs no change: a person's pass into the room is only needed to
get in (it is renewed while they are connected), and a room has no time limit while people are in
it.

## How it will be checked

- Tests for the rules: the lengths that can be offered (7, 0, 365 and 3.5 are not among them; the
  old tests that expected 20 and 90 minutes to be refused are changed), the length shown first
  (also when two are equally close), the words for a length, and the 6-hour limit on added time
  (a 4-hour call can go to 5 and then to 6 hours and no further; with less than 5 minutes left to
  the limit nothing is offered; a 6-hour call cannot be made longer at all). Open times for a
  6-hour call: hours that cross midnight, weekly hours shorter than the call (no open times), and a
  day on which the clocks change. A hold that ends unusually early, and the earliest hold a card
  can have, with a 6-hour call.
- The booking script: a host with a range of 10 minutes to 2 hours; a 25-minute and a 90-minute
  call are asked for, accepted and priced right; a length outside the range and a length that is
  not a step of 5 are refused, whatever the browser sends. Saving a calendar with a shortest call
  longer than the longest, or with values that are not steps of 5, is refused. A 6-hour call at
  the highest price is asked for and accepted through booking itself, and its total is exactly
  $24,000. A new calendar starts with 30 minutes to 2 hours, and a calendar that already exists
  keeps its list when it is opened.
- The instant-call script: only the lengths that still fit are offered, and never more than
  1 hour 55 minutes.
- The added-time script: a long call cannot be taken past 6 hours.
- A 6-hour call at a high price through the payment script's hold and charge, in Stripe's test
  mode.
- The reminder: a "room is open" email that could not be sent in time is really dropped a few
  minutes after the call's start.
- By hand in a browser: the calendar page, a host's page with the two lists, a 25-minute booking
  from start to request, and the same on a phone-sized screen.
- Then the usual: Astra reviews the code, and CodeRabbit reviews the pull request.

## Astra's check of this plan (15 November 2026)

Verdict: ready with changes. It confirmed the main idea: no change to the database is needed, the
list of every step is enough, every reader of a host's lengths is covered, and nothing becomes
slow. It also confirmed that the card-hold rules, the pay cut-off, cancelling, the record of who
was there, the quality notes, ratings, the video room and its pass, and the helper that closes
rooms all work for calls of up to 6 hours (the plan it read had a top of 4 hours booked and 6 with
added time). Its points, all worked in above:

1. The 6-hour limit needs the call's start, which the added-time rule did not get; the caller is
   now in the list of files, with the cases to test.
2. The host's shortest and longest values must be checked before the list is built, not after.
3. Instant calls already have a ceiling of 1 hour 55 minutes; the plan now says so and leaves it.
4. The top is a choice and not forced by the card-hold rules, and the hours left to ask are the
   normal case, not a promise; the reasons are now worded that way.
5. Lengths in hours only in the two drop-down lists; elsewhere minutes stay. Two old tests change.
6. The "room is open" email could arrive hours late for a long call; it is now dropped soon after
   the call's start.

Astra also suggested keeping the name `LENGTH_CHOICES_MINUTES` for the new, longer list, which
makes the change smaller still. Taken.

## The founder's answer on the top (15 November 2026)

The plan first proposed a top of 4 hours chosen by Connect. The founder's answer: the host decides
how long their longest call is, and a host who sets nothing gets 2 hours; the host chooses between
5 minutes and 6 hours. Worked in above.

## Astra's second check, of the plan as it is now (15 November 2026)

Verdict: ready with changes. It found nothing that breaks when a 6-hour call is booked up front:
the hold on the card still has 18 hours to spare in the worst case, the customer normally has
18 hours to ask for a refund, open times work for a 6-hour call (also across midnight and when the
clocks change), $24,000 fits the database and Stripe, and a list of 72 lengths is small and not
slow. Its points, all worked in above:

1. Where the 2-hour default comes from: the code that first creates a host's calendar writes it.
   No change to the database is needed, and existing calendars keep their lists.
2. How the 6 hours are enforced when time is added, described as the code really works.
3. "A little less" understated how much an early end of a card's hold can shorten the time to ask.
4. More cases to check: a 6-hour call through booking itself, open times across midnight and a
   clock change, early holds, existing calendars, and the dropped reminder.
5. Six hours is a chosen ceiling that keeps today's longest call, not a limit the code forces; the
   plan now says so.
6. The two changes this builds on are merged; the opening now says so.
