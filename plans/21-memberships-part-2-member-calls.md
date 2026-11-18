# Plan 21: Memberships, part two: member calls

**Status:** 2a (the call) and 2b (extra time) are built (18 November 2026; see "Built in 2a" and
"Built in 2b" at the end). Written 17 November 2026 by the builder alone (no
helper agents), from the code as it is on `main` after pull request 32 and from plan 20, which
this part is built on top of. Astra's first check gave "not ready" and its second "ready with changes", small enough to make while building; every point of both is worked in below (the lists are at the end).

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
   the founder's review, refund requests and giving time back, collecting, what an ending does
   to calls, and the pages a booked member call needs: the host's page and the booking page as a
   member sees them, the booking's own page, the page after a call, the calendar page's tick.
   Until 2b, a member's call offers no extra time.
2. **2b, extra time.** Added time from the membership or by card, and what the call screen and
   the page after a call show for it.

Each is usable and reviewable alone: 2a leaves no money that needs 2b.

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
- **Ratings** can be given, and a call is listed as waiting for one, only when its booking's
  source is `customer` or `now` (`ratings/rules.ts:45`, `ratings/ratings.ts:129`). **Reminders** go to every booking but those
  made by a script or on the spot (`notifications/reminders.ts:38`). The host's notes and the host's view of a booking need `requestedAt` on the booking (`people/contacts.ts:124`,
  `app/bookings/[id]/page.tsx:55`).
- **The "accepted" email** promises a hold on the card (`booking/emails.ts:149`), and the
  cancellation emails say "You pay nothing" (`:189`, `:195`).
- **The health check** only looks at held payments whose hold has an end (`health.ts:43`).

## The database: one migration, `0029_member_calls`

- `bookings`: `month_id` (empty for every existing row). The source `member` is a new value of a
  text column and needs no change.
- `weekly_hours`: `members_only`, false.
- `call_extensions`: `paid_from` (`card` for every existing row, or `membership`), so both
  screens and the page after the call can say how added time was paid.

Nothing else: part one's migration already gave `payments` its kind, its month and the part that
came from host-caused money.

## 2a: the call

### Member-only hours (`booking/bookings.ts`, `booking/slots.ts`, `booking/calendar.ts`)

`Offer.weekly` carries `membersOnly` for each stretch. **A member must be able to book with a
host whose page is hidden** (the rulebook's "A hidden host page"), and `offerOf` returns nothing
for a hidden host today (`bookings.ts:88`). So it gets a second way of being asked, "for a
member", which the member's open times and `bookAsMember` use, and only after part one's
`access.ts` has said that this person is a member of this host: it does not refuse a hidden
host, and refuses everything else it refuses today (a host who is not approved, closed or
paused, or has no calendar). Asked the ordinary way, `offerOf` is not narrowed and not widened: "call
now" reads it too (`instantOffer`, `bookings.ts:138`), and the rulebook leaves "call now" as it
is, also for a host whose weekly hours are all for members. The stretches are told apart where a
time for a call later is worked out and checked: `slotInput` (`:159`), used by `openTimes` and by
`checkMayAsk`, takes only the general stretches for everyone who is not booking as a member,
before they are joined together. So such a host has no times for a call later for the public,
and nothing else changes. Adding a stretch takes the tick (`addWeeklyHours`), and so does part one's `changeWeeklyHours`,
which was built before the column existed and gets it here; the tick does not change the week's
total, so it never starts the step for a cut in hours.

### Booking as a member (`src/lib/membership/book.ts`)

One step of its own, by the rulebook's "Booking as a member": what it keeps from asking, what it
keeps from accepting, what is its own and what does not apply are listed there and are not
repeated here. How it is carried out:

- **Open times for a member:** `openStarts` with the host's notice alone as the earliest start
  (the way a free call is treated today, without the lead time a card hold needs), every stretch
  of the host, and, of the times it
  returns, only those whose call ends before the month ends (the break after it may reach past
  the end); the same is checked again when the booking is made. Only this calculation is shared
  with a free call: a member's call is a paid call in every other way. The lengths offered are the
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
- **The ordinary way stays beside it.** A member whose free money does not cover what they want
  still has the ordinary form on the host's page (general times, the regular price, the host's
  answer), by the rulebook's row "When a member's time is used up". "Call now" is ordinary for
  a member too.
- **The first booking of a month whose money is only held:** the order is the rulebook's (under
  "Booking as a member"). The request is written down as a booking at a stage of its own,
  `paying` ("made by a member; the month's money is being taken"), with its request key and
  nothing reserved for either person. Then `takeNow(month)`. Then the booking step above turns
  that booking into an accepted one, checking everything again. `paying` is not `card`: the card
  step's code (`cardStepFor`, `finishCardStep`), its page text ("enter your card", "nothing is
  held") and its clean-up job (`endUnfinishedCardSteps`, which ends every old `card` booking
  with "the card was not entered in time") never see it.
  - **Continuing.** A press with the same key continues from where it stopped. The booking's own
    page (`app/bookings/[id]/page.tsx`) shows "We are taking this month's payment", then the
    booked call or the plain reason it could not be booked. The member's list of requests
    (`requestsOfCustomer`, `bookings.ts:856`, which today takes only the sources `customer` and
    `now`) includes a `paying` booking.
    - **The stage's place in the code.** `canMoveBooking` (`booking/rules.ts:116`) learns
    `paying` to `accepted` or `ran_out`. The host's list of requests keeps showing only
    `waiting`. The email for a request that ran out says "nothing was held or charged"
    (`booking/emails.ts:168`), which is not true here (the month's payment may have gone
    through); a `paying` booking that ends gets words of its own.
  - **Ending.** A small job of its own ends a `paying` booking after 30 minutes, or at once when
    its month is given up or its membership stops being bookable, with the stage `ran_out` and a
    reason that says which. An ended request is never brought back.
  - **Every place it can stop,** each with its own check: the request saved and the taking not
    written down (the same press starts it; nothing is reserved); the taking written down and
    Stripe silent (part one finishes that same action; nothing is booked from an unknown
    answer); Stripe took the money and our record is missing (found once); the month paid and
    no booking yet (everything is checked again; if the time is gone, the month stays paid and
    the member is told, by the rulebook's row "The member's first booking of a month"); the
    booking saved and the answer lost (the same key returns it); and the 30 minutes, or an
    ending, arriving during any of these.

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
- **`settleOrdinaryCharges`, and the moments of a call.** Today one shared moment for a call
  comes from the earliest of its card holds, and both the customer's time to ask and the taking
  of every charge follow it. The two are separated:
  - **A call's time to ask and to answer.** For a call whose own payment is `member_call`, they
    come from the call's start and from the request alone, by the rulebook's row on reviews and
    its "Card payments of the same call" line: a card hold on added time never shortens them.
    For every other call they are worked out exactly as today.
  - **Each payment's own moment.** A `member_call` payment is used or given back at the call's
    moment. A `card` payment of the same call keeps today's safety limit against its own hold,
    so with a short hold it can be taken before the member's time to ask is over.
  - **One request, one answer form, as today.** The form lists the charges that can still be
    lowered; a charge that was already taken is answered with the refund form or a "no". That
    is what happens today when one charge of a call was taken early after a review, and
    `answerRequest`, `declineRequest` and the form need no new case for it.
  `moneyTiming`, `takeDecision`, `moneyPlan` (which feeds the page after a call and the admin
  page) and `commonExpiry` take "no hold end" as a value. A card payment keeps every rule it
  has, including "skip when the hold ran out"; a `member_call` payment is never skipped for
  having no hold.
- **A month that is frozen** (its dispute open or lost, plan 20): none of the three movements
  runs for it. A call of that month that was cancelled, or took place and is not settled, keeps
  its money set aside until the dispute is won; the settle jobs pass over it without counting it
  as late, and the founder's short list shows it. This is plan 20's "lost: nothing moves".
- **Using.** For a `member_call` payment the amount is worked out exactly as today (the record,
  the answer to a refund request, the 50-cent rule), by the rulebook's "Using". It is applied in
  the same locked step, with no action written down for Stripe: the payment becomes `charged`
  with the fields a card payment gets from `applyCaptured` (the amount, the reason, the frozen
  totals, the marker of the record, "lowered by", the day it can be collected), the fee by the rulebook's "The fee" (the month's fixed part placed here if the
  month has not placed it yet; the month's card country copied onto the payment when it is
  made, because `actions.ts:24` reads the extra 1.5% for a card from abroad from the payment),
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

### The founder's review (`app/admin/actions.ts`, `app/admin/page.tsx`)

"End call and report" sends every unsettled payment of a call to review (`safety/calls.ts:29`),
so this must work for a member's call from 2a on. Today the founder's two buttons call
`capturePayment` and `releasePayment` (`admin/actions.ts:40`), which part one closes to a
payment that is not `card`. For a `member_call` payment they go to the month's movements
instead, with the same ceilings a card payment has in `capturePlan` (`actions.ts:153-183`): the
amount set aside, the time before the call was stopped, an answer to a refund request that was
already accepted, and an added-time request that was not accepted. The admin page works out the
last moment to decide from the hold's end, or the call's end without one (`admin/page.tsx:126`),
which would show a moment before the call is over; for a `member_call` payment it shows the
rulebook's limit.

### Giving time back after the money was used (`src/lib/membership/give-back.ts`)

The host's refund form and the founder's go here for a `member_call` payment, where a card
payment goes to `refundPayment`. The same limits, in the same order (`actions.ts:338-349`):
something was used; the share was not sent; the month is not frozen (its dispute `open` or
`lost`; a dispute that was won does not block); nothing written down and unfinished on this
payment; not more than is left. Then, in one step with the month locked: used
becomes free or owed back, by the rulebook's step 4; the payment's `refunded_cents` and its fee
and share shrink as `splitAfterRefunds` gives; and a line is added to `refunds` that is `done` at once (the person who decided, as host
or as admin, the reason, the time it was finished, and no Stripe refund id), so that
`refundedSince` finds it and an open refund request counts as answered. **The form's own id
identifies it,** as it does for a card refund today (`calls/[id]/actions.ts:67`,
`actions.ts:329`): that id is the id of the `refunds` line and part of the pay-back's source key
(`giveback:<id>`), so the same press twice gives back once, and two different partial amounts
are two. The line, the month's numbers, the payment, its money record and the email are saved
together. A `done` line here means the call's amount was adjusted; whether money has reached the
card is read from the pay-back, and the page after the call says which. The member's email says what really happened: time back in the membership,
or money back to the card.

### Refund requests (`refunds/requests.ts`)

`askBy`, `requestViewOf`, `askForRefund` and `writeAnswerReminders` read their moments from the
call's shared timing above, so a call with no card hold at all still has its time to ask and to
answer. Saving an answer is unchanged; it is carried out by `settleOrdinaryCharges`. These steps
keep their own locks (the call, then its payments) and take none on a month; the month's money
moves afterwards in the settling step, which takes its locks in the right order. The sentence
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
the card. A dispute cancels the
upcoming member calls too. Only money that belongs to the **disputed month** is frozen, as plan
20 says, and stays set aside until that dispute is won. A cancelled call that was booked from
another month (the dispute may be about an older one) gives its money back in the ordinary way,
which after an ending means to the card.

### Ratings, reminders, emails, the health check

- `rateState` (`ratings/rules.ts:45`) and the list of calls waiting for a rating
  (`callsToRate`, `ratings/ratings.ts:129`) accept the source `member`.
- Reminders already go to a member's booking; their wording is read once for anything about a
  card.
- `booking/emails.ts` gets "booked with your membership" for both people (no "accepted", no
  hold), and for a member's call the cancellation emails say that the time is back in the
  membership or will be paid back, whichever is true.
- `health.ts`: today it works out one moment for a whole call from its earliest hold
  (`health.ts:43`). It now asks, for each payment, the same question settling asks: is this
  payment past its own moment? So a card payment for added time with a short hold is reported
  when it is late, a later one is not reported early, and a `member_call` payment is reported
  when it is still set aside 5 minutes past the call's moment. A `member_call` payment of a
  frozen month is never reported; a card payment on the same call still is, because it is not
  part of the month.

### The pages of 2a

- **The calendar page:** the "Members only" tick on a stretch of hours.
- **The host's page and the booking page** (`app/h/[handle]/page.tsx`, `.../book/page.tsx`): for
  a member whose month is running or held, the box and the times of the rulebook's "Booking",
  and the summary with "Book", beside the ordinary form. Whether the person looking is a
  member of this host is asked of part one's `access.ts`, which is also how the two pages open
  for a member when the host's page is hidden; the public reader of a host's page is not
  loosened.
- **The booking's own page** (`app/bookings/[id]/page.tsx`): a member's booking while the
  month's payment is being taken, booked, or not booked and why.
- **The page after a call** (`app/calls/[id]/results/page.tsx`) and the home page's line for a
  call (`app/page.tsx`): "paid from your membership", what was used and what came back, and
  time given back, told apart from money paid back to the card.
- **No extra time yet.** For a call whose own payment is `member_call`, `addTimeChoices` offers
  nothing and `askForMoreTime` refuses with a plain sentence, until 2b.

## 2b: extra time

### Added time (`extend/extend.ts`, `extend/rules.ts`, `api/calls/[id]/extend`)

For a call whose own payment is `member_call`, by the rulebook's "Extra time during a call that
was booked from a membership" and its list under "Added time". How:

- **What the screen sends.** The address takes, beside the minutes, how the choice was shown
  (`membership` or `card`) and, for `card`, the price shown. `addTimeChoices` returns both for
  each choice.
- **Asking.** The month is found first; then the membership, the month and the call are locked
  in that order and everything is read again. First the way the request would be paid **now** is worked out
  (from the membership if the month's free money covers it and the longer call still ends
  before the month ends; otherwise by card, at its price). If that is not what the screen had
  shown, in either direction, or the card price differs, nothing is written and the answer
  carries the way and the price as they are now, for the member to press again. If it is what
  was shown and it is the membership: the request (`paid_from` "membership") and
  its `member_call` payment (the request's own minutes, the amount set aside, its host-caused
  part, the month's card country) are written and the money set aside in one step, and the host can be asked at once. If it is what was shown and it is the card: the request
  (`paid_from` "card") and a `card` payment with the
  ordinary fee terms (`DEFAULT_FEE_TERMS`, not the call's), and the hold is placed on the membership's card in use (read through part one's
  `cards.ts`) through `placeHoldWithSavedCard`, as today.
  `savedCardOf` is not used for such a call.
- **Accepting** (`answerExtension`): a `member_call` payment that is `held` is "in place"; the
  check on the hold's end stays for a `card` payment. Accepting takes no lock on a month,
  because the money was set aside when the member asked.
- **A request that ends** (`endExtension`, `releaseHoldOf`, `closeFinishedExtensions`): the
  request is marked as ended first, as today; for a `member_call` payment the money then comes
  back to where it came from in a step of its own that takes the month's locks in the right
  order, once, and never for an accepted request. If the app stops between the two, the
  helper's scan for ended requests with money still held finishes it, as it does for a card
  hold today.
- **Settling** is 2a's: each payment by its own stretch and its own kind.

### What 2b shows

- **The call screen** (`app/calls/[id]/call-room.tsx`): each choice for more time says how it
  would be paid, and a changed price is shown for another press.
- **The page after a call:** added time by how it was paid.

## The order it can safely go in

Each pull request: the migration (2a), the code, the scripts. A card payment behaves exactly as
before after each. With the switch off, a member exists only where the check script made one.

## How each "done when" is proven

A new script, `scripts/member-calls-check.ts`, built like plan 20's: a membership and a month
made through part one's own functions (inviting, joining, the hold), for which the script turns
the founder's switch on in the local database, as plan 20's script does, and off again when it
ends; calls attended by writing the attendance record as
`payments-check.ts` does, a made-up `now`, interruptions played at the real place. After every
step it makes plan 20's comparisons (the six places; Stripe asked afresh, every PaymentIntent of
the test customer; the money record; work still owed; the outcome written out).

| Rulebook, part two, "done when" | Proven by |
| --- | --- |
| Test calls come out right across a month's end, with refund requests, with disputes and with early endings | "Calls", "Across the month's end", "Refund requests", "Disputes and endings" below. |
| Two bookings, or a booking and added time, can never spend the same money | "At the same moment" below, and the database's check on a month's places. |
| No call's money needs part three; months already paid for stay usable with the switch off; nobody can buy a membership | Every journey ends with the helper having nothing left to do; a journey of its own turns the switch off with a month running and a call booked (the call takes place and is settled, another can be booked from that month, nothing renews, nobody can join); the twelve existing scripts and plan 20's script pass unchanged. |

**Journeys in 2a**

- *Booking:* a general time and a member-only time; a member-only time asked for by someone who
  is not a member (not shown, and refused); a length longer than the time left; inside the
  host's notice; across the month's end; the same press twice; a time someone else is waiting
  for (theirs ends, with its email); an instant request at the same time (cannot meet, because
  of the notice); a blocked pair, a paused account, the host not approved, the host's ID rule.
- *The first booking:* each place it can stop, as listed under "Booking as a member"; the taking
  refused; the 30 minutes running out, and the membership ending, during each.
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
- *The founder's review:* "End call and report" on a member's call, then the founder's own two
  buttons: charging within each ceiling and refused above it, releasing, and not deciding.
- *A mixed call's moments* (in 2b): a member's call with added time by card whose hold is
  short: the card charge is taken early, the member can still ask for the full 24 hours, and
  the one request is answered for the member's part and refunded for the card's.
- *A frozen month:* a call cancelled and a call not yet settled when a dispute opens (nothing
  moves, nothing counts as late); a dispute over an older month while a call is booked from
  today's month (that call is cancelled and its money paid back; only the old month is frozen); won (settled, owed back); lost (still nothing).
- *Giving back:* the same partial amount pressed twice (once); two different partial amounts
  (both); while a share is written down for collecting (refused); the first amount of the
  month, the one carrying the fixed fee, given back.
- *"Call now" and the ordinary way:* a host whose hours are all for members can still be called
  now; a member with too little time left asks the ordinary way.
- *The health check on a mixed call* (in 2b): added time by card with a short hold that is late
  (reported); a second one whose moment has not come (not reported); both beside a frozen
  month (the member's part not reported, the card's part still is).
- *Around the call:* a rating by each side; the reminders; a booking with a hidden host from
  the times shown to the moment it is booked (it works), and the same asked by someone who is
  not a member (refused as today);
  the health check answering "not healthy" for a member's money that is overdue, and not for a
  frozen month's.
- *Collecting:* a call's share with the month's fixed fee on the first amount of the month and not on the second; a card call and a member call in one collection; held back by a request.
- *Disputes and endings:* a membership ended with a call booked and with one under way; the
  same for a block, a closed account and a dispute; a dispute won and lost with calls settled
  before and after.
- *At the same moment:* two bookings for the last free money; a booking and the month's end; a
  booking and "Cancel now"; a booking and the timed taking.
- *Unchanged:* a card payment through every job with a member's payment beside it on the same
  host; the card form refused for a member's call.

**Journeys in 2b**

- *Added time:* from the membership, accepted, used in part (the host leaves); declined; not
  answered; shown as "by card" when membership money has just come back (nothing is charged,
  the membership's way is shown for another press); the app stopping after a request is ended and before its money is back; failed for lack of room in the calendar; shown as "membership" when the money has
  just been booked elsewhere (a card price comes back, nothing is charged); by card, with its
  own fee and hold; across the month's end (by card); the fifth request; one call with its own
  payment from the month and added time by card, with one refund request answered for both; a
  booking and added time for the last free money at the same moment; the membership ended while
  a request is open.
- *By hand in a browser,* also at phone size, with a membership the script made and a call
  booked through `bookAsMember` itself (the script-only `createTestCall` makes an ordinary card
  call and cannot show any of this): in 2a the calendar page's tick, the host's page and the
  booking page as a member and as a stranger, a booking, the booking's own page, the page after
  the call; in 2b the call screen's choices for more time on a real member's call.

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

## Astra's first check of this plan (17 November 2026)

Verdict: **not ready**. It found the main design sound and nothing to cut, and these points, all
worked in above:

1. **Added time by card could have cut the member's time to ask for a refund**, because one
   shared moment came from the card's hold. A call's time to ask and to answer, and each
   payment's own moment, are now two things.
2. **A disputed month:** this plan let money move inside a frozen month, against plan 20. It now
   follows plan 20: nothing moves until the dispute is won.
3. **The founder's review** of a member's call had no working buttons. They are in 2a.
4. **Giving time back** had lost the protection against the same press twice. The form's own id
   identifies it, as for a card refund.
5. **The first booking's waiting stage:** reusing the card step's stage would have let the card
   step's clean-up and page text reach it. It has a stage of its own.
6. **"Call now"** would have been switched off for a host whose hours are all for members.
   Member-only hours are now told apart only where times for a call later are worked out.

Also taken: the pages a member's call needs move into 2a and extra time is switched off until
2b; the month's card country is carried onto each member payment; a `done` line in `refunds`
means the call was adjusted, not that money reached the card; what was said about ratings and
contacts is corrected; and the proof names each place the first booking can stop.

## Astra's second check (17 November 2026)

Verdict: **ready with changes**, one small one, to be made while building; no further round on
the plan. It found all six earlier points and all its advice resolved, no remaining way to set
money aside twice, use it and leave it free, return it to a month that cannot be booked from,
lose a return, pay a host early or send a member's payment to the card code, and that 2a and 2b
can each be merged alone. The one point, written in above: the health check has to judge each
payment by its own moment, as settling now does, and must not report a frozen month's member
payment. It also listed the routine places the new stage `paying` touches, which are written in.

## Built in 2a: where the code differs from this plan

- **Cancelling a member's call moves its money in the same step as the cancellation.** There is
  nothing to ask Stripe, so the call is marked cancelled, the booking ended, both people's time
  freed and the money returned (or, when cancelled late, used) together, and the email is written
  in that step with what really happened: time back in the membership, money to the card, or
  kept while the month's dispute is open. The helper's job for cancelled calls only has work left
  for a month that was frozen at the time.
- **Files.** The money of a member's call after the booking is in `membership/calls.ts`
  (`closeMemberPayment` is the one step that closes such a payment together with the month's
  numbers; `settleMemberOne`, `settleCancelledMemberIn`, `decideMemberReview` call it), not
  spread over `payments/jobs.ts` and `take.ts`. Those two only hand a `member_call` payment over.
  `settleOrdinaryCharges` uses and returns member money in its own locked step, with the call's
  other charges.
- **One lock helper**, `lockMonthsOfCall` (`locks.ts`): every step that settles, cancels, reviews
  or gives back for a call takes the membership and the month first, then the call, then its
  payments.
- **A call's shared moments** are worked out in one place, `timingOfCall` (`take.ts`), which
  `moneyPlan`, the refund-request steps and the health check read. Each payment's own limit is
  `holdEndFor`.
- **The emails of 2a** are in `booking/emails.ts` (booked, not booked, cancelled) and
  `refunds/emails.ts` (time given back), beside the emails of the calls they are about, not in
  `membership/emails.ts`. The rulebook's table says so now.
- **`access.ts` has one more way in**, `hostForMemberByHandle`, for the two pages whose address
  carries the host's handle.
- **Member-only times are marked** with a star and the words "A time for members only" in the
  list of times and on the summary.
- **The "Members only" tick** is shown to a host who may offer a membership (the founder's
  switch covers her) or who already has such hours, and is only accepted from such a host.
- **The daily limit on requests applies as the rulebook says**: at most 3 bookings with one host
  in 24 hours, and 10 in all, also for a member. The founder is told, because a member with many
  hours may meet it.
- **Time given back is recorded at the moment of the step**, so an open refund request that was
  asked before it counts as answered.
- **A demo mode in the check script** (`--demo`, `--demo-off`) leaves one real member between the
  two seeded test accounts in the local database, for looking at the pages by hand.
- **Played by hand in a browser, at phone size:** the host's page as a member (time left, the
  held month's sentence, the times), the summary with "Book", a first booking that took the
  month's money and booked, the booking's own page, the home page's line, the call's page,
  cancelling there (the time was back at once), the page after the call for both people, and the
  calendar page's tick and labels.
- **Not played by the script, and why:** an instant request landing on a member's booking (the
  host's notice of at least a day keeps the two apart; the rule is in `slotInput`); the reminders
  (unchanged code, and they carry no words about a card); the mixed call's moments and its health
  check (they need added time, which is 2b).

## Astra's reviews of the code of 2a (18 November 2026)

**First round: not ready, ten points, all taken.** The one that mattered most: time a host gave
back after a month was already finished would have been promised to the member's card and never
sent, because the pay-back job only looks at months that are not finished. Such a month is now
open again for that pay-back and is finished again once Stripe has confirmed it. The others: a
first booking could have taken the month's money for a time the member was already taken at; an
unfinished first booking could have been continued with the money of a different month, or for a
different time; a request that ended while the money was being taken was reported as "booked";
the "Members only" tick could be shown and then silently saved as hours for everyone; the page
after a call ignored a dispute over the month; the words for a booking that ran out after the
payment went through blamed the payment. In the check script, four checks that could pass
without the thing they named were tightened, and collecting is now played with real test
transfers (two member calls' shares and a card call's share in one collection).

**Second round: not ready, five points and six checks, all taken.** The serious one: a call can be
ended with "End call and report" from 5 minutes before its start, and a cancellation sent a
moment later (from a page that was still open) would have decided the money that was waiting for
the founder's review. A call that was ended that way can no longer be cancelled, whatever paid
for it. The others: a first booking that is continued after an interruption is now checked again
before the month's money is taken, and only as it was written down (the same host, time, length
and month), also under the locks; a retry reports what the booking's own row says; and the
refund-request panel and its emails speak of membership time for a member's call, and promise
nothing while the month is disputed. Six checks in the script were made to prove what they name.

**Third round: not ready, two points worth fixing and some small ones, all taken.** The founder's
decision on a member's call is now judged by the clock when the step happens, after its locks, so
a press just before the 3-day limit that waits past it is refused like any late one. A press
that names another host than the saved request's is refused before anything is looked up, and
leaves the request as it is. Small: blocking, suspending a host, closing an account and the
unpaid-call job no longer try to cancel a call that was ended with "End call and report" (the
new refusal would have been reported as work left over); two sentences about where uncharged
time goes were made exact; two more checks in the script were tightened.

**Fourth round: the earlier fixes confirmed; two timing edges, two sentences and five labels, all
taken.** Giving time back and both booking steps now read the clock again once their locks are
held (a refund request asked while a give-back waited counts as answered by it; a press just
before the host's notice begins that only arrives after it is refused). The notice after
cancelling a member's call points to the payment instead of guessing what became of the time, and
the page after a call says where returned time went at the time, not where it is now.

**Fifth and closing check: all fixes confirmed, one sentence.** A month stays frozen when a dispute
is lost, and the pages and emails said "until the bank has decided" for that case too. They now
say that the month's payment is frozen because of a dispute, and that nothing of it moves while
that lasts. With that corrected, Astra's last open point is closed.

## CodeRabbit's review of 2a (pull request 36, 18 November 2026)

Sixteen comments: eight on the code, eight smaller ones on the check script.

**Taken.**
- **The call's record is read again inside the locked step** before a member's money comes back
  in full or is sent to the founder's review. A late message from the video service that arrives
  between the first look and the step can no longer decide the wrong thing.
- **A frozen month's payment is passed over before anything about it is decided**, also in the
  step that applies a saved answer, so it is not sent to review during the dispute and the answer
  is applied to the record as it stands once the dispute is won.
- **Cancelling a member's call judges "has it started" by the clock after its locks**, so a call
  that started while the cancellation waited is left alone.
- **A first booking in its last minute** (of its 30) is ended instead of continued, and the job
  that ends such bookings leaves one alone while its month's money is being taken. So a request
  is never ended while the money is on its way for it.
- **After the month was paid, an error while the call is written** sends the member to the saved
  booking, with words that say the payment went through and a button to finish, instead of to a
  fresh form.
- **The check script:** the demo removes only what it made (written down in a small local file)
  and refuses to start over a membership it did not make; clean-up that fails makes the run
  fail; holds are let go at Stripe before their records are deleted; `--only` without numbers is
  refused; the amount owed back is compared with the pay-backs still open; the "Cancel now" race
  must have one winner; and two smaller ones.

**Not taken.** "A record that becomes final only after the 3-day limit should give the money
back": the helper already gives the money back at the limit when the record is not final then,
so a record that turns final later finds the payment closed. The case is only reachable when the
helper was down across the limit, and telling the two apart would need a new stored moment for
"when the record became final". A card payment behaves the same way today.

## Built in 2b: where the code differs from this plan

- **"The way changed" is a refusal with details, not a new kind of answer.** `askForMoreTime`
  keeps the shape it has for every other call; when the way or the card price is no longer what
  the screen showed it throws `WayChanged`, which carries the way and the price as they are now.
  The address answers with that and the words for the member; nothing was written, nothing is
  held and the host was not asked. So the existing script for added time passes unchanged.
- **What the screen is given** is one number beside today's two: up to how many minutes the
  membership would pay for (`membershipCovers`). A request of that many minutes or fewer is shown
  as "from your membership"; a longer one as its card price "by card". The screen works out each
  choice from it and sends what it showed.
- **A press that says nothing about what was shown** (an old page) is treated as a mismatch on a
  member's call: nothing is asked, and the way comes back for another press.
- **The money of an ended request** goes back through `returnEndedRequestMoney`
  (`membership/calls.ts`), called from the same place a card hold is let go, and found again by
  the same scan of the helper if the app stopped in between.
- **A membership that ended, was paused or was frozen during the call** pays for no more added
  time: such a request is shown and paid by card, on the membership's card if it is still saved.
  Without a saved card, time cannot be added, with a plain sentence.
- **Played through the running app** (not only the script): the screen's data for a member's call
  in its last minute, a press with nothing shown, with the wrong way and with too many minutes
  (each refused with the way and the price as they are), and a matching press (the host asked at
  once, the money set aside). The call screen itself needs a camera and a second person, so its
  buttons were not pressed by hand.

## Astra's reviews of the code of 2b (18 November 2026)

**First round: not ready, three points and one check, all taken.** A membership's card that was
retired a moment ago (the membership ended while the member pressed) could still have been held
for added time: the card is now read again once the membership is locked. A request the
membership could just pay for was sent to the card because of rounding (with exactly $1.66 free
at $5.00 per 15 minutes, 5 minutes cost $1.666…, rounded down): what the money covers is now
worked out by the same rounding as a booking's price, in one function with a test. And the page
after a call showed the call's moment for a card charge that follows its own, earlier hold.

