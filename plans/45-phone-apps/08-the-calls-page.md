# Phone apps, part 08: a call's page (paying, the countdown, cancelling) and past calls

**Status:** built on 20 November 2026 (not merged yet: it waits, with parts 01 to 07, behind the
tips pull request). Astra looked at the code once ("not ready"); its points are worked in, below. Written by the builder alone. Part of
plan 45. Astra checked the plan once ("ready with changes"); its points are worked in (the list
is at the end). What the building changed is listed below.

## For the founder: what this is

Everything between "the host accepted" and "the room opens": one call's page with its
countdown, the customer's confirm-and-pay step (the money is held, not taken), and
cancelling. The Join button appears here and leads to part 09. And the list of past calls.

## What is there today (read in the code)

- **Coming calls are on the home page.** `src/app/calls/page.tsx` is **Past calls** (plan 36):
  a person's calls that are over, cancelled or ended with a report, in both roles, the newest
  first, 50 at a time with Older and Newer, each leading to its results.
- **One call** (`src/app/calls/[id]/page.tsx`, `pay-panel.tsx`): who and when; for a paid call
  the payment state: too early to pay, pay now, the hold is being placed, held, the hold has
  run out; that a booked call is charged for the host's time, waiting included, and an instant
  one for time together; cancelled; ended for safety; links to the results and the rules; for
  the host, while waiting, what she may see about the customer and her own note; the
  connection check (part 09c); when the room opens (5 minutes before the start).
- **Paying:** `/api/calls/[id]/payment/start` (`startHold`) makes a hold on Stripe's side that
  takes nothing yet, cards only; it can answer "already held". `/payment/sync` asks Stripe for
  the truth. A member's call has no card step.
- **Cancelling** (`cancelCallAction`, `cancelCall`, `cancellationOutcome`): no call can be
  cancelled once it has started. Before that a host cancels free; a customer cancels free
  inside the host's free time and pays the late charge after it, which needs the money to be
  held. A member's cancellation uses or gives back membership time.
- `/api/calls/[id]/live`: where a call stands, asked every few seconds while a hold is placed.

## Decisions (the builder's)

1. **The existing call addresses get a twin under the door,** not a second copy of their
   work: the body of each (`payment/start`, `payment/sync`, `live`) moves into a function that
   is handed the person asking. New addresses: past calls (a page at a time), one call's page,
   cancel. The address that reads a call's page only reads; where the website's page also
   brings the hold up to date while loading, the app asks for that with its own "sync" step.
2. **Paying uses Stripe's sheet for phones on the hold the server already makes,** with the
   same settings as part 06 (cards only, extras off, the way back into the app after a bank's
   approval). Afterwards, and whenever the app comes back to the front on this page, it asks
   the server, and shows only what the server says: held; the bank refused; not confirmed
   yet; already held. A hold is a hold: the screen never says "paid".
3. **Cancelling shows the outcome first, from the server,** in the website's words (free; a
   late charge of so much; membership time used, given back, or held while a dispute is
   open), and asks once more. The server already works the outcome out afresh at the moment
   of cancelling. What is missing today is the comparison with what the person was shown:
   the form sends only which call. So **what was shown travels with the press; if the cost
   has risen meanwhile, nothing is cancelled and the new outcome is shown, to be confirmed
   again.** This is added where a person cancels, on the website and in the app; the
   cancellations the system makes by itself are not touched.
4. **The countdown runs on the phone's clock but the server decides.** Join is offered when
   the server says the room is open.
5. **Every state of the page above is shown,** each with the website's sentence.
6. **The Calls place at the bottom of the app** shows the coming calls and, below them, the
   past ones, so "my calls" is one place on a phone. The home page only reads the soonest
   three calls and those around the day in view, which would hide a fourth call far ahead.
   So the Calls place has its own reading of **all** coming calls, the soonest first, a page
   at a time, through the same rules about who may see what.

## How it is tried

- Check script: the twins answer exactly as the originals; a hold started from the app is the
  same hold (one payment, never two); "already held"; paying a member's call is refused;
  cancelling free, late, as host, as member, after the start; a cancellation that turned from
  free to charged between showing and confirming; a stranger gets "not found"; past calls page
  by page; coming calls page by page, with a call far ahead that the home page does not load.
- `payments-check`, `booking-check`, `member-calls-check` unchanged and green.
- On the Android test phone, with Stripe's test cards and pictures: a call too early to pay;
  a hold placed; a refused card; the bank's approval; the app closed during it; a free
  cancellation; a late one; the countdown reaching Join; past calls.

## Keeping the 4.9%

The payment here is for the one-to-one call itself. The price is the host's price, as on the
website.

## What the building changed (20 November 2026)

1. **One gathering and one set of sentences for a call's page,** for the website and the app
   (`src/lib/call-page/gather.ts`, `words.ts`). The website's page and its pay panel were moved
   onto them, word for word as before.
2. **The pay steps are one function each** (`src/lib/payments/steps.ts`), called by the
   website's two addresses and by the app's. A hold started from the app is the very hold the
   website would start: the check starts one from each and gets the same one.
3. **The addresses:** `GET /api/app/calls?kind=coming|past&page=1` (the Calls place),
   `GET /api/app/calls/[id]` (a call's page; it only reads), `POST …/pay`, `…/pay-check`
   (the server asks Stripe, and answers with the page), `…/cancel`.
4. **Cancelling compares what was shown** (decision 3), on the website and in the app: the form
   and the app both send what the page said cancelling means. If it has turned from free to
   charged meanwhile, nothing is cancelled; the website goes back to the call's page with the
   sentence, the app shows it and reads the page again. Cancelling that costs less than was
   shown always goes through. What the system cancels by itself is not touched.
5. **One function describes a call for every list** (`src/lib/home/list-calls.ts`): the home
   page, "Past calls" and the app's Calls place. Who sees what about the other person, and what
   a host earned, is still decided by the two functions the home page's plan names.
6. **The Calls place** shows every coming call (also one far ahead, which the home page does
   not load) and, below, the past ones, each 50 to a page.
7. **Not built here, each with its own part:** the Join button and the room (part 09; the page
   says "The room is open" by the server's word), the results of a call (part 10; "See the
   details" has no screen to lead to yet), the connection check (part 09c), and the address
   the call screen asks during a call (`live`, part 09, where it is used).

### How it was tried

- `scripts/app-calls-check.ts`, 74 checks (54 before Astra's looks at the code), with real holds at Stripe (test mode): coming and
  past calls (a call far ahead that the home page does not load, paging, a stranger); a call's
  page in each state, and the website's page for the same call saying the same; the hold
  (started twice and from the website: one hold; before a card, after a refused card, after a
  good one; a hold, not a charge); cancelling free, as the host with the hold let go, late,
  after the start, twice, and when it turned from free to charged while the person looked.
- The home page's checks pass unchanged after its calls were moved onto the shared function
  (`home-check` 110, `app-home-check` 75).
- On the Android test phone, with pictures: the Calls place; a paid call's page with the
  confirm-and-pay step; the hold placed in Stripe's sheet with a test card, and the page moving
  on to the countdown; the question before a late cancellation; a free call with its room
  open; a free cancellation.

### What could not be tried here

- **A member's call** (paid from membership time, cancelled with time given back): making one
  needs a whole membership with a paid month. The refusal to pay one by card is in the shared
  function; the website's own `member-calls-check` covers member calls.
- A refused card and a bank's approval **for the hold** were not walked again on the phone: it
  is the same sheet as in part 06, where both were walked, and the check script does both
  against Stripe.
- The iPhone.

## Astra's check of the code (20 November 2026): "not ready", now worked in

Five things that mattered, and seven smaller ones. Several are in code the website shares, so
the website is better for them too.

1. *What cancelling means was decided before the step that cancels.* A "free" cancellation
   that had to wait a moment (for a lock) could go through as free after the free period had
   ended, or after a hold had just been placed. **It is now decided, compared with what the
   person was shown, and written down in one step,** with the call and its payment locked and
   the clock read at that moment. A check makes a cancellation wait across the end of the
   free period: nothing is cancelled, and the person is told.
2. *The website's cancel form could be sent without saying what its page showed,* and then
   nothing was compared. Such a form now cancels nothing and goes back to the call's page. A
   check presses the website's own button both ways.
3. *The app's page of a call that was simply over kept asking the server without end.* A call
   whose booked end has passed is now "ended" for the app whatever else was open about it
   (unpaid, or its room simply empty): it says so, offers nothing, and does not ask again.
   The countdown also never asks more than once every few seconds.
4. *A card approved through a card form left open, after the call was cancelled or over,
   could be written down as held.* It no longer counts; the cancellation (or the helper) lets
   that approval go at Stripe, now at once and without waiting for the room to be closed.
   The words after a free cancellation say the hold "is being let go", not that it is gone:
   the bank decides when that shows.
5. *A member's call in a month whose payment is disputed:* the page promised that the time
   goes back (or is used), while such a month is frozen and nothing moves. The page now says
   that. And after cancelling, the sentence says what really became of the time (back in the
   membership, back to the card, used, or kept), instead of pointing at "the payment below",
   which the app's screen does not have.

Smaller:

6. A host whose page is hidden or closed is still named in one's own calls, but **without her
   photo**: before, the list gave away that she had one (the picture itself was never handed
   out). On the website's home page too. And a customer is never shown a host's account name
   in place of the name on her page.
7. In the app, an answer that arrives after the person has left the page is no longer used,
   and Stripe's sheet is only shown while the app itself is on the phone's screen.
8. The sentence that says why a cancellation was refused now stays beside the cancel button
   when the page is read again (the reason is often that the page has just changed). The
   sentence itself no longer says "the free period has just ended" when the reason may be a
   hold: "it would now be charged in full".
9. When it cannot be told what became of a step (Stripe or the database could not be asked),
   the app is no longer told "nothing was changed": it is told nothing certain, and reads the
   page again.
10. A late cancellation's charge shows in the host's past calls at once, not only after the
    booked end.
11. The website's "Past calls" describes each call through the same one function as the app
    and the home page, in the same words.
12. The check script proves more: the bank's own "declined"; a card waiting for the bank's
    approval; the amount really taken for a late cancellation; 51 past calls over two pages;
    the website's own cancel button.

## Astra's second look at the code (20 November 2026): "not ready", now worked in

Astra found the first list closed except for four rare orderings in the money code that the
website shares, and some small things.

1. *The bank says yes while the cancelling waits its turn, and our record has not heard of it
   yet.* The call was then cancelled for free and the host lost a charge that was hers.
   **Stripe is now asked in the very step that cancels,** with the payment locked. If a hold
   is found that the person was not shown, nothing is cancelled, the hold is written down,
   and the page says what cancelling means now. If Stripe cannot be asked, nothing is
   cancelled. A check makes the bank say yes while a cancellation waits.
2. *A call stopped with "End call and report":* a card the bank approved **before** the stop
   was thrown away with the ones approved after it. It is now kept, for the founder's review
   (where the stop had put that payment). Only one approved after the stop does not count.
   Both are checked.
3. *A member's call in a frozen month, cancelled late:* the page now also says what happens
   when the month is freed again, with the amount (all the booked time is used), since that
   is what the member agrees to. For a free cancellation: that the time is then given back.
4. *The helper that cancels a call "because it was not paid in time"* could cancel one whose
   money had been held a moment before. It now only cancels a call that is still unpaid at
   the moment it cancels. A check does it.
5. Smaller: a hold that Stripe has but that no longer counts is not answered as "already
   held"; a cancellation is dated by the same clock its price was decided by; the home page's
   "calls to rate" never names a host by her account name either; in the app, nothing more is
   asked for someone who has left the page, the card sheet is not shown after the app went to
   the background while it was being made ready, and "nothing was cancelled" goes away once
   the call is cancelled from somewhere else; the check script now lets the helper's own job
   close the unpaid payment of a call that is over, and looks at Stripe afterwards.

## Astra's third look at the code (20 November 2026): "not ready", now worked in

The second list was found closed except for what follows, all in the one step that cancels.

1. *A "no" could undo a hold that the cancelling step had just found.* When the step found a
   hold at Stripe and then refused for another reason (the call had started), the refusal
   undid the whole step, the hold's record with it, and the customer could be kept out of a
   call they had paid for until Stripe's own message arrived. **A refusal is now handed back
   after the step is saved,** so nothing is cancelled and what was learned about the hold is
   kept. A check does it.
2. *A card being confirmed at that very moment* counted as "not paid". It now counts as "not
   known yet": nothing is cancelled, and the person is told to look again in a moment.
3. *A hold whose time Stripe does not give* is judged by the clock at the moment it is written
   down (not by when the button was pressed), and for a call that was stopped with a report
   it is kept for the founder's review instead of thrown away.
4. Stripe gets 8 seconds to answer while a call and its payment are locked, and is not asked
   twice, so a slow answer cannot hold others up for long.
5. In the app: coming back to the call's page while a step is still under way is not lost;
   the page reads itself, hold included, when the step is through.
6. The two checks about cancellations that wait now look in the database until the
   cancellation is really seen waiting, instead of sleeping a fixed time; and the "unpaid"
   check now writes the hold down while the helper's cancellation is waiting.

## Astra's fourth look at the code (20 November 2026): "not ready", now worked in

Two orderings were left, both about the exact moment something is read.

1. *The clock was read before Stripe was asked.* If Stripe took two seconds to answer, a
   cancellation begun one second before the free period ended could still go through as free.
   The clock is now read after Stripe has answered, with everything else known.
2. *The helper that cancels an unpaid call* could cancel while the bank was still confirming
   the card (it asked Stripe, heard "being confirmed", and took that for "unpaid"). Now "being
   confirmed" means "not known yet" there too: the helper leaves the call alone and looks
   again on its next round. And the step that cancels asks Stripe itself, under lock, also
   when the reason is "unpaid".
3. Smaller: a reading of the page that was owed to one visit is not made after the person has
   left again; the two checks about waiting now make sure that the one seen waiting is the
   very cancellation under test.

**Not checked by the script, said plainly:** an answer from Stripe that arrives slowly cannot
be made to happen on purpose here, so point 1 is proven by reading the code, not by a check.

**Not done, said plainly:** coming back from a bank's approval after the app was closed is a
thing only a phone can show. It was walked in part 06 for saving a card (the same sheet and
the same way back); for the hold it is on the founder's two-phone list in part 20.

## Astra's fifth look at the code (20 November 2026): "not ready", now worked in

The four points of the fourth look were found closed. One ordering was left, older than this
part, in the helper that closes the payment of a finished call nobody paid for:

1. *The helper asked Stripe, heard "unpaid", and then closed the payment.* If a hold was
   written down in the short time between the two (by Stripe's message, or by the customer's
   own page), the helper let that hold go. On a call that was stopped for safety, that took
   the decision away from the person who reviews it. Now the helper closes the payment only
   if, under the payment's lock, it is still waiting for payment on the very card step that
   Stripe was asked about. Otherwise it changes nothing and looks again on its next round.
   Three new checks: a hold written down in between stays; an answer about another card step
   closes nothing; a payment that really is unpaid is closed (`scripts/app-calls-check.ts`,
   77 checks).
2. Two notes left as they are, on purpose. The helper that cancels an unpaid booking asks
   Stripe twice (once before, once under lock): the first question is what writes down a hold
   that is already there, so it stays. And a check script that moves the clock by hand could
   get two different answers for a hold without a date; the real helper only looks at
   bookings whose time to pay has passed on the real clock, so nothing changes for people.

This part also moved onto the newer main (the legal changes of 20 November). Nothing of the
money code met those changes.

## Astra's check (20 November 2026): "ready with changes", worked in

1. *The Calls page is past calls; coming calls are on the home page.* Corrected; decision 6.
2. *States the draft dropped:* too early to pay, hold run out, cancelled, ended for safety,
   "already held", how each kind of call is charged. "What is there today", decision 5.
3. *Cancelling:* no call after its start; the host free; a late charge needs a hold; members.
   And the cost must be checked again at the moment of confirming. Decision 3.
4. *The connection check was dropped.* It is part 09c now; the founder asked for everything.
