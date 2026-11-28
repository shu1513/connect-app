# Phone apps, part 11: "available now"

**Status:** a plan only. Written 20 November 2026 by the builder alone. Part of plan 45. It
builds on plan 7 (the feature) and plan 39, decision 9 (how it behaves on a phone). Astra
checked it once ("ready with changes"); its points are worked in (the list is at the end).
Brought up to date on 27 November 2026, after the website changed (that list is at the end
too).

## For the founder: what this is

A host switches "available now" on in the app; a customer on her page asks for a call now,
saves a card and waits; the host accepts; a minute later they talk.

## What is there today (read in the code)

- **The host's side:** `src/app/host/now/` (`now-panel.tsx`), `/api/host/now`
  (`setAvailableNow`, `stillHere`, `liveForHost` in `src/lib/booking/now.ts`). 30, 60 or 120
  minutes. One row per host holds the end time and a "last seen". The page says "still here"
  every 5 seconds; after 15 seconds of silence the status is off. **Any open page that sees
  the status "on" keeps it alive,** and a page that closes ends the period it was showing. A
  waiting request shows the price, the customer's photo, rating, "ID confirmed", the host's
  note, a countdown, Accept, Decline, and Decline and block (`/api/bookings/[id]/answer`,
  which can report that declining worked and blocking did not, to be tried again). Accepting
  tries the saved card at once.
- **The customer's side:** `src/app/h/[handle]/now/` (`askNow`): the length, the price, the ID
  check where needed, the card consent box, then the card step and the waiting panel
  (`now-waiting.tsx`, `/api/bookings/[id]/live`), taking the request back.
- **The clocks and limits** (`now-rules.ts`): 2 minutes to answer; the call starts 60 seconds
  after accepting; the money must be held within 2 minutes of accepting; 15 minutes before the
  same customer may ask again after a decline; at most 5 waiting per host and one outstanding
  per customer; a daily limit; a pause after three refused cards in a row.
- Accepting an instant call switches the status off. A booked call coming up only limits the
  lengths offered.
- **A customer with a bank dispute cannot ask** (plan 47, decision 9): a request for a paid
  call, booked or instant, is refused with the server's sentence while their bank has an
  open dispute about a Connect payment (`whyNoNewPayment`, asked in
  `src/lib/booking/bookings.ts`).
- **"End call now"** (plan 51) leaves an instant call's rule as it is: the time both were in
  the call is charged, whoever ends it.
- **A paused account** (by a person, or since plans 52 and 53 by the app itself): its status
  goes off, its waiting requests end and its coming calls are cancelled at no charge, by the
  tidying-up that a pause already had.
- **What is loose today:** a request that runs out (`endUnanswered`) leaves the status on; a
  request is not tied to the period it was asked in, so a host who switches off and on again
  quickly can have an old request beside a fresh period. Whether a host "is available" is
  also asked by her page, by the Following list, and by the emails to followers.

## Decisions (the builder's)

1. **Two steps, so nothing is promised that cannot be kept.**
   - **Now (this part): in the app, "available now" follows the website's rule.** It is on
     while the app is open at the front. The host is told so in one line under the switch.
   - **With part 12 switched on: a phone that can receive notifications keeps the status
     while it is locked,** and the first request that runs out unanswered ends that period.
2. **Each period gets a name of its own on the server,** kept on the one row a host has:
   exactly where it was switched on (which browser tab, or which phone; "the website" alone
   could not tell two tabs apart), and by which rule it lives ("while it says still here" or
   "until its time is up"). Rows from before this change count as the
   website's rule. Every instant request remembers the period it was asked in.
   - **Only the place that started a period keeps it alive.** Another open page or phone shows
     it and can switch it off on purpose, but its "still here" and its closing change nothing.
     (Today any page does both; that changes, and the website's own page is changed with it.)
   - **A request belongs to its period** at every step: finishing the card, accepting, running
     out. A request from an earlier period cannot be accepted into, or end, a newer one.
   - **In a period that lives "until its time is up",** the first request to run out
     unanswered ends the period and the other requests waiting in it, through the same code
     that ends requests today, so their saved cards are removed and the customers are told at
     once that nothing was charged. The period counts as over from that request's deadline
     itself, even if the helper that tidies up wakes a little late: a second request cannot
     be accepted in between. Such a period is only given to a phone the server can notify; it
     ends, and the host is told why, when that phone signs out, when Connect learns that its
     notification address is dead, or when the apps' switch is turned off.
   - **Everything that asks "is she available?"** (her page, the Following list, the emails to
     followers) asks through the same one function.
3. **The phone's "still here" cannot be trusted to be on time, and its goodbye may never be
   sent** (a phone can stop an app without warning). So for a period that lives "while it
   says still here", the server's 15 seconds of silence is what decides, as today.
   When the app comes back to the front it reads the status again
   and, if it lapsed, says so and offers to switch on again; it never shows "on" from memory.
4. **The clocks and limits do not change,** and no alert restarts one.
5. **The apps' "available now" switch** (part 01) takes the host's switch and the customer's
   button out of the app together.
6. **The host's screen** shows what the website's panel shows for a waiting request, with
   Accept, Decline, and Decline and block (with "try blocking again" when only the decline
   went through). While the app is open it also sounds and vibrates for a new request.
7. **The customer's side** is the website's: the length and price, the ID check where needed
   (part 06's), the consent box, Stripe's sheet, the waiting screen that updates every 2
   seconds and moves on to the hold and the call by itself, and taking the request back.

## How it is tried

- `now-check` grows: a period started on the website is not kept alive or ended by the app,
  and the other way round, and the same between two phones; switched off on purpose from
  another place; an unanswered request ending an "until its time is up" period and its other
  requests, with their cards removed; a leftover request neither accepted into nor ending a
  newer period; the Following list and her page agreeing on "available". Everything it checks
  today still passes.
- Check script for the app's addresses: on, off, still here, silence for 15 seconds, the
  waiting requests, ask now, each refusal (too many waiting, asked too soon, the daily limit,
  refused cards, no length fits, blocked, no ID, an open bank dispute); a host whose account
  is paused cannot switch on, and a customer whose account is paused cannot ask.
- On the Android test phone with the website in a browser as the other person, with pictures:
  the whole instant call from switch to room; an unanswered request; a decline; a decline and
  block; the app left while available, and what it shows on coming back.

## Keeping the 4.9%

A "call now" is the same one-to-one call, paid the same way.

## Astra's check (20 November 2026): "ready with changes", worked in

1. *One row per host is enough, but it needs to know the period.* Today any page keeps a
   status alive and a quick off-and-on can leave an old request beside a new period.
   Decision 2.
2. *A phone's heartbeat and goodbye are not dependable.* Decision 3.
3. *Every place that asks "is she available" must ask the same way.* Decision 2.
4. *Missing from the draft:* taking a request back, the ID check and consent on the customer's
   side, the immediate hold on accepting, the daily limit, the pause after refused cards, what
   the host sees of a request, "try blocking again". Added.

## Brought up to date (27 November 2026)

Read again against the code on `main` after pull request 123. `src/lib/booking/now.ts` and
`now-rules.ts` have not changed. What changed in this plan:

1. *A customer with a bank dispute cannot ask for a paid call* (plan 47). "What is there
   today" and the check script; the app shows the server's sentence.
2. *An account can be paused by the app itself* (plans 52 and 53). Nothing new to build: it is
   the same pause, and the check script now plays it from the app's side.
3. *"End call now"* changes nothing for an instant call. Said, so that nobody looks for it.

This plan is read against the code once more on the day it is built.
