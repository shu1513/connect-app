# Phone apps, part 08: a call's page (paying, the countdown, cancelling) and past calls

**Status:** a plan only. Written 20 November 2026 by the builder alone. Part of plan 45. Astra
checked it once ("ready with changes"); its points are worked in (the list is at the end).

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

## Astra's check (20 November 2026): "ready with changes", worked in

1. *The Calls page is past calls; coming calls are on the home page.* Corrected; decision 6.
2. *States the draft dropped:* too early to pay, hold run out, cancelled, ended for safety,
   "already held", how each kind of call is charged. "What is there today", decision 5.
3. *Cancelling:* no call after its start; the host free; a late charge needs a hold; members.
   And the cost must be checked again at the moment of confirming. Decision 3.
4. *The connection check was dropped.* It is part 09c now; the founder asked for everything.
