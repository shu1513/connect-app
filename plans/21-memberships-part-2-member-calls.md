# Plan 21: Memberships, part two: member calls

**Status:** a plan only; nothing is built. Written 17 November 2026 by the builder alone (no
helper agents), from the code as it is on `main` after pull request 32 and from plan 20, which
this part is built on top of. Astra's check is at the end.

**The rulebook is `plans/19-memberships.md`.** This plan builds its part two ("The three parts",
"Part two: member calls, complete"). It states no rule of its own; every decision is the
rulebook's, named by section. If a rule turns out to be wrong or missing, the rulebook is changed
and checked first. If building part one changes something this plan relies on, this plan is
updated and the change checked before part two is built.

## For the founder: what this part is

Part two makes a member's time usable: member-only hours, booking with membership time, the call
itself, what the call uses and what comes back, cancelling, refund requests, extra time during a
call, and the host collecting what a call earned. The founder's switch stays **off**; the check
script plays both people.

**Two pull requests:**

1. **2a, the call.** Member-only hours, booking, joining, settling after the call, cancelling,
   reviews, refund requests and giving time back, collecting, what an ending does to calls.
2. **2b, extra time and the pages.** Added time from the membership or by card, and the changes
   the host's page, the booking page, the page after a call, the call screen and the calendar
   page need.

## What is in, and what is left out

**In:** the rulebook's "Booking" and "During and after the call" under "How it works for a
member"; "Member-only times"; steps 1 to 4 and 6 of "The money, step by step"; "What counts as
'came back because of the host'"; "The limit that stays as it is today"; "The arithmetic";
"Booking as a member" and the list under "Changes to existing code" that concerns calls; the
rows of "The awkward cases" about bookings and calls.

**Built in part one and used here** (by the names in the rulebook's "How the parts connect"): the month and its six places (`months.ts`), taking a held
month's money now (`takeNow`), paying back (`payback.ts`), the kind on every payment with its
checks, the guards that keep a member's payment out of the card code, collecting from a month's
charge, the card lock, ending a membership, and the place where an ending cancels upcoming member
calls.

**Left to part three:** offering, inviting, joining and managing a membership on a page; the
admin pages; turning the switch on.

**One line added to the rulebook with this plan.** Its list "What counts as 'came back because of
the host'" does not say which kind money is when a call under the founder's review is not decided
in time. The line added: it counts as because of the host, since the member did nothing to cause
it.

## What it relies on (each read in the code by the builder)

- **Open times.** `offerOf` (`booking/bookings.ts:80`) reads every weekly stretch and returns
  nothing for a host without any (`:91`). `openStarts` (`booking/slots.ts:97`) joins stretches
  before it looks for times, takes `earliestStart`, and does not know about an end.
- **Asking and accepting** are two steps: `askForCall` (`bookings.ts:326`) with `checkMayAsk`
  (`:193`), and `accept` (`:629`), which makes the call, its payment
  (`createPaymentForCall`), the host's busy entry and ends requests in the way
  (`endRequestsInTheWay`, `:593`). A request key makes a second press return the first booking
  (`:354`). A booking that is still at the card step is ended by the helper after a while
  (`endUnfinishedCardSteps`, `:822`).
- **Joining.** `paymentBlocksJoin` (`payments/rules.ts:135`) lets a paid call be joined only
  while its payment is `held` with a hold that outlasts the call (`:143`). The room pass
  (`api/calls/[id]/token/route.ts:68`) and the call page use it.
- **Settling.** `settleOne` (`payments/jobs.ts:334`) first asks Stripe about a payment
  (`afterCheckingRefusedCharge`), releases one whose hold ran out (`:349`), and works out a
  review's limit from the hold's end, or from the call's end when there is none (`:355`).
  `settleOrdinaryCharges` (`payments/take.ts:108`) locks the call, then its payments, returns
  without doing anything when no hold has an end (`:119`), skips a payment without one (`:131`),
  and writes a capture or a release down for each (`:160`, `:166`).
- **Timing.** `moneyTiming` and `takeDecision` (`rules.ts:181`, `:207`) need a hold's end.
- **Cancelling.** `cancelCall` (`payments/cancel.ts:18`) decides free or late from whether money
  is held (`:53`) and then captures the booked price or releases (`settleCancelledCall`, `:93`).
- **Refund requests** (`refunds/requests.ts`): who can ask and until when comes from the holds
  (`askBy`, `:173`); an answer is saved and then carried out by `settleOrdinaryCharges` (`:294`);
  a refund that went through after a request answers it, read from the `refunds` table
  (`refundedSince`, `:65`).
- **Added time** (`extend/extend.ts`): asking needs the call's own payment to be `held` and reads
  the saved card from that payment's PaymentIntent (`:208`, `savedCardOf`, `:172`); the request's
  payment copies the call's fee terms (`:259`); accepting needs a hold that outlasts the longer
  call (`:350`); a request that ends lets its hold go through `releasePayment` (`:164`). Asking
  locks the call first (`:221`). The address the call screen uses sends only the minutes.
- **Ratings** accept a call only when its booking's source is `customer` or `now`
  (`ratings/rules.ts:45`, `ratings/ratings.ts:129`). **Reminders** go to every booking but those
  made by a script or on the spot (`notifications/reminders.ts:38`). **Contacts** and the host's
  notes need `requestedAt` on the booking (`people/contacts.ts:124`,
  `app/bookings/[id]/page.tsx:55`).
- **The "accepted" email** promises a hold on the card (`booking/emails.ts:149`), and the
  cancellation emails say "You pay nothing" (`:189`, `:195`).
- **The health check** only looks at held payments whose hold has an end (`health.ts:43`).

## The database: one migration, `0028_member_calls`

- `bookings`: `month_id` (empty for every existing row). The source `member` is a new value of a
  text column and needs no change.
- `weekly_hours`: `members_only`, false.
- `call_extensions`: `paid_from` (`card` for every existing row, or `membership`), so both
  screens and the page after the call can say how added time was paid.

Nothing else: part one's migration already gave `payments` its kind, its month and the part that
came from host-caused money.

## 2a: the call

### Member-only hours (`booking/bookings.ts`, `booking/slots.ts`, `booking/calendar.ts`)

`Offer.weekly` carries `membersOnly` for each stretch. `offerOf` gets a second way of being
asked, "for a member": everyone else gets only the general stretches, filtered out before they
are joined together, and a host with none of those is not bookable by the public (the check at
`:91` counts general stretches for the public). Adding a stretch takes the tick
(`addWeeklyHours`); the tick does not change the week's total, so it never starts the step for a
cut in hours.

### Booking as a member (`src/lib/membership/book.ts`)

One step of its own, by the rulebook's "Booking as a member": what it keeps from asking, what it
keeps from accepting, what is its own and what does not apply are listed there and are not
repeated here. How it is carried out:

- **Open times for a member:** `openStarts` with the host's notice alone as the earliest start
  (the way a free call is treated today, without the lead time a card hold needs), every stretch
  of the host, and only times whose call ends before the month ends. The lengths offered are the
  host's lengths whose price fits in the month's free money, by the rulebook's "Setting aside".
- **The locks,** in part one's order: both calendars, the membership, the month. Then everything
  is read again and checked.
- **What is written, in that one step:** the booking (`source` "member", stage `accepted`,
  `month_id`, `requestedAt` and `decidedAt` now, the member price, the cancelling rule, the
  break, the request key); the busy entries of both people; the call (the member price, "the
  host's time counts", the cancelling rule); its payment (`member_call`, the month, `held`,
  `heldAt` now, no hold end, no PaymentIntent, `booked_cents` the amount set aside,
  `host_caused_cents` its host-caused part, the month's percentage fee terms and no fixed part
  yet); the move from free to set aside in `months.ts`, which takes the money that would expire
  first; other people's waiting requests for that time ended through `endRequestsInTheWay`; the
  "booked" emails.
- **A second press** with the same request key returns the booking the first one made and sets
  nothing aside again.
- **The first booking of a month whose money is only held:** the order is the rulebook's (under
  "Booking as a member"). The request is written down as a booking at the stage `card`, which
  today means "made, and the money step is not finished"; then `takeNow(month)`; then the booking
  step above turns that booking into an accepted one, checking everything again. A press with
  the same key after an interruption continues from where it stopped. A request whose taking
  never comes through is ended by the helper's existing job for unfinished card steps, and the
  month is as `syncMonth` left it. What the member is told when the money was taken and the time
  was lost is the rulebook's row "The member's first booking of a month".

### Joining the call (`payments/rules.ts`, the room pass, the call page)

`paymentBlocksJoin` is told the payment's kind: a `member_call` payment that is `held` does not
block. Nothing is stored that looks like a hold's end. The card form on the call page and its two
addresses (`payment/start`, `payment/sync`) answer with a plain sentence for a `member_call`
payment; part one's guards already keep such a payment out of the card code.

### After the call: used, and come back (`payments/jobs.ts`, `payments/take.ts`, `months.ts`)

`months.ts` gets the three movements part one left out: **set aside**, **used**, **come back**.
Each takes the month's lock in the caller's step, is safe to run twice, and none of them asks
Stripe.

- **Locks.** A month comes before a call in the order of locks, and today's settling locks the
  call first. So each step that settles a call first reads, without a lock, which months its
  `member_call` payments belong to, locks those memberships and months, then the call, then its
  payments, and reads everything again.
- **`settleOne`** for a `member_call` payment: nothing is asked of Stripe; there is no hold that
  can run out; a review's limit is the rulebook's (the row "A member's call goes to the founder's
  review"); "nothing owed" and "not decided in time" are a **come back**, not a release at
  Stripe.
- **`settleOrdinaryCharges`.** Today one shared moment comes from the earliest hold of the call.
  It becomes: the call's shared moments (until when the member can ask, until when the host's
  answer counts) come from the call's start and the request, limited by the earliest end among
  its **card** holds if it has any; and each payment is then decided by its own kind. A card
  payment keeps every rule it has, including "skip when the hold ran out". A `member_call`
  payment is never skipped for having no hold. `moneyTiming` and `takeDecision` take "no hold
  end" as a value.
- **Using.** For a `member_call` payment the amount is worked out exactly as today (the record,
  the answer to a refund request, the 50-cent rule), by the rulebook's "Using". It is applied in
  the same locked step, with no action written down for Stripe: the payment becomes `charged`
  with the fields a card payment gets from `applyCaptured` (the amount, the reason, the frozen
  totals, the marker of the record, "lowered by", the day it can be collected), the fee by the
  rulebook's "The fee" (the month's fixed part placed here if the month has not placed it yet),
  the month's charge as the charge its transfer names, and the fee and host's share on its money
  record. No "charged to the customer" line. In `months.ts`: set aside becomes used, and the
  rest comes back.
- **Coming back.** Where it goes (free again, or to the card through `payback.ts`) and whether it
  counts as because of the host are the rulebook's step 4 and its list; the pay-back's source
  key is the payment and the event (`callreturn:<payment id>:<what>`), so each return is owed
  once. A member's own cancellation in time puts each part of the booking back where it came
  from, using `host_caused_cents` on the payment.
- **A late cancellation** (`settleCancelledCall`): for a `member_call` payment the whole amount
  set aside is used; any other cancellation is a come back.
- **A record that changes after the money was used** is flagged as today (`flagChangedRecords`
  reads calls and does not ask Stripe).

### Giving time back after the money was used (`src/lib/membership/give-back.ts`)

The host's refund form and the founder's go here for a `member_call` payment, where a card
payment goes to `refundPayment`. The same limits, in the same order (`actions.ts:338-349`):
something was used; the share was not sent; no dispute on the month; nothing written down and
unfinished on this payment; not more than is left. Then, in one step with the month locked: used
becomes free or owed back, by the rulebook's step 4; the payment's `refunded_cents` and its fee
and share shrink as `splitAfterRefunds` gives; and a line is added to `refunds` that is `done` at
once, with who decided and why, so that `refundedSince` finds it and an open refund request
counts as answered. The member's email says what really happened: time back in the membership,
or money back to the card.

### Refund requests (`refunds/requests.ts`)

`askBy`, `requestViewOf`, `askForRefund` and `writeAnswerReminders` read their moments from the
call's shared timing above, so a call with no card hold at all still has its time to ask and to
answer. Saving an answer is unchanged; it is carried out by `settleOrdinaryCharges`. The sentence
about 50 cents is worded for a member's call where it names a card.

### Collecting

Part one already collects from a month's charge. A `member_call` payment that was used has what
that needs: the month's charge, the day it can be collected, and its call for the refund-request
check. One addition: `asked for a refund` moves the day of a `member_call` payment as it does for
a card payment (`requests.ts:220` works on payments of the call whatever their kind).

### What an ending does to calls (`membership/ending.ts`, the place part one left)

The clean-up of an ending cancels the membership's upcoming member calls through `cancelCall`,
as the founder's cancellation, so each one's money comes back; with the membership ended it is
owed to the card. A call under way is left alone; when it is settled, what comes back is owed to
the card. A dispute does the same and the month stays frozen: money is still moved between the
month's places, and nothing is sent to the card or to the host while it is frozen.

### Ratings, reminders, emails, the health check

- `rateState` (`ratings/rules.ts:45`) and the average (`ratings/ratings.ts:129`) accept the
  source `member`.
- Reminders already go to a member's booking; their wording is read once for anything about a
  card.
- `booking/emails.ts` gets "booked with your membership" for both people (no "accepted", no
  hold), and for a member's call the cancellation emails say that the time is back in the
  membership or will be paid back, whichever is true.
- `health.ts`: a `member_call` payment that is still set aside more than 5 minutes after the
  moment its call's money should have been used or given back.

## 2b: extra time, and the pages

### Added time (`extend/extend.ts`, `extend/rules.ts`, `api/calls/[id]/extend`)

For a call whose own payment is `member_call`, by the rulebook's "Extra time during a call that
was booked from a membership" and its list under "Added time". How:

- **What the screen sends.** The address takes, beside the minutes, how the choice was shown
  (`membership` or `card`) and, for `card`, the price shown. `addTimeChoices` returns both for
  each choice.
- **Asking.** The month is found first; then the membership, the month and the call are locked
  in that order and everything is read again. If the month's free money covers the request and
  the longer call still ends before the month ends: the request (`paid_from` "membership") and
  its `member_call` payment (the request's own minutes, the amount set aside, its host-caused
  part) are written and the money set aside in one step, and the host can be asked at once. If
  not, and the screen had shown `membership`: nothing is written, and the answer carries the
  card price for the member to press again. If the screen had shown `card` with this price: the
  request (`paid_from` "card") and a `card` payment with the ordinary fee terms
  (`DEFAULT_FEE_TERMS`, not the call's), and the hold is placed on the membership's card in use
  (`membership_cards`) through `placeHoldWithSavedCard`, as today. `savedCardOf` is not used for
  such a call.
- **Accepting** (`answerExtension`): a `member_call` payment that is `held` is "in place"; the
  check on the hold's end stays for a `card` payment.
- **A request that ends** (`endExtension`, `releaseHoldOf`, `closeFinishedExtensions`): for a
  `member_call` payment the money comes back to where it came from, once, after the request is
  marked as ended, and never for an accepted request; for a `card` payment as today.
- **Settling** is 2a's: each payment by its own stretch and its own kind.

### The pages

- **The calendar page:** the "Members only" tick on a stretch of hours.
- **The host's page and the booking page** (`app/h/[handle]/page.tsx`, `.../book/page.tsx`): for
  a member whose month is running or held, the box and the times of the rulebook's "Booking",
  and the summary with "Book". They open for a member also when the host's page is hidden.
- **The page after a call** (`app/calls/[id]/results/page.tsx`), the home page's line for a call
  (`app/page.tsx`) and the booking page (`app/bookings/[id]/page.tsx`): "paid from your
  membership", what was used and what came back, time given back, and added time by how it was
  paid.
- **The call screen** (`app/calls/[id]/call-room.tsx`): each choice for more time says how it
  would be paid, and a changed price is shown for another press.

## The order it can safely go in

Each pull request: the migration (2a), the code, the scripts. A card payment behaves exactly as
before after each. With the switch off, a member exists only where the check script made one.

## How each "done when" is proven

A new script, `scripts/member-calls-check.ts`, built like plan 20's: a membership and a month
made through part one's own functions, calls attended by writing the attendance record as
`payments-check.ts` does, a made-up `now`, interruptions played at the real place. After every
step it makes plan 20's comparisons (the six places; Stripe asked afresh, every PaymentIntent of
the test customer; the money record; work still owed; the outcome written out).

| Rulebook, part two, "done when" | Proven by |
| --- | --- |
| Test calls come out right across a month's end, with refund requests, with disputes and with early endings | "Calls", "Across the month's end", "Refund requests", "Disputes and endings" below. |
| Two bookings, or a booking and added time, can never spend the same money | "At the same moment" below, and the database's check on a month's places. |
| No call's money needs part three; months already paid for stay usable with the switch off; nobody can buy a membership | Every journey ends with the helper having nothing left to do; the journeys run with the switch off; the twelve existing scripts and plan 20's script pass unchanged. |

**Journeys in 2a**

- *Booking:* a general time and a member-only time; a member-only time asked for by someone who
  is not a member (not shown, and refused); a length longer than the time left; inside the
  host's notice; across the month's end; the same press twice; a time someone else is waiting
  for (theirs ends, with its email); an instant request at the same time (cannot meet, because
  of the notice); a blocked pair, a paused account, the host not approved, the host's ID rule.
- *The first booking:* the money taken and the call booked; the taking refused; no answer from
  Stripe, then the same press again; the time lost between the two (the month paid, nothing
  booked, the member told); the app stopping after the taking.
- *Calls:* the host there for all of it; for part of it; not at all; the member not there; a
  late cancellation; the member's cancellation in time (each part back where it came from); the
  host's cancellation (all of it host-caused); a call stopped with "End call and report"; a
  record that does not add up, decided by the founder and not decided in time.
- *Awkward prices:* at $5.00 per 15 minutes a 5-minute call sets aside $1.66 and a full call
  uses $1.66; six of them leave 4 cents, which expire; under 50 cents nothing is used.
- *Across the month's end:* a call an hour before the end, settled the next day; the same with
  a refund request answered "less" two days later; the same under review.
- *Refund requests:* asked and answered "in full", "less" and "nothing" before the money is
  used; not answered; the form after the money was used, while the month runs (time back) and
  after its end (to the card); refused once the host has collected, and while the share is
  written down for collecting; an open request answered by time given back.
- *Collecting:* a call's share with the month's fixed fee on the first amount of the month and
  not on the second; a card call and a member call in one collection; held back by a request.
- *Disputes and endings:* a membership ended with a call booked and with one under way; the
  same for a block, a closed account and a dispute; a dispute won and lost with calls settled
  before and after.
- *At the same moment:* two bookings for the last free money; a booking and the month's end; a
  booking and "Cancel now"; a booking and the timed taking.
- *Unchanged:* a card payment through every job with a member's payment beside it on the same
  host; the card form refused for a member's call.

**Journeys in 2b**

- *Added time:* from the membership, accepted, used in part (the host leaves); declined; not
  answered; failed for lack of room in the calendar; shown as "membership" when the money has
  just been booked elsewhere (a card price comes back, nothing is charged); by card, with its
  own fee and hold; across the month's end (by card); the fifth request; one call with its own
  payment from the month and added time by card, with one refund request answered for both; a
  booking and added time for the last free money at the same moment; the membership ended while
  a request is open.
- *By hand in a browser,* also at phone size, with a membership the script made: the calendar
  page's tick; the host's page and the booking page as a member and as a stranger; a booking;
  the page after the call; the call screen's choices for more time on a free test of the path.

**Broken on purpose**, one at a time, and the script must fail each time: money set aside twice
for one booking; a call's money used and also left free; a member's payment sent to the card
code.

Also: `npx tsc --noEmit -p .`, `npx eslint src scripts worker`, `npx vitest run` (new tests for
the timing with no hold end, the member's open times, and the three movements), `npm run build`.

Then, for each of the two pull requests: Astra reviews the code, CodeRabbit reviews the pull
request, and after any fix that touches a month's money the scripts are run against Stripe again
before it is called ready. Both are written into `docs/module-record.md`.

## What stays off after part two

The founder's switch. Nobody can become a member except through the check script.

## Questions for Astra's check

1. Is using the booking stage `card` for a member's first booking that waits for the taking
   sound against everything that reads that stage today?
2. Is "the call's shared moments from its card holds only, each payment decided by its own kind"
   a complete replacement for `commonExpiry` in `take.ts`, `requests.ts` and `health.ts`?
3. Is recording time given back as a `done` line in `refunds` right for everything that reads
   that table?
4. Is the cut between 2a and 2b right?
