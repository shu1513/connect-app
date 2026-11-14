# Plan: Module 7b — Adding time during a call

**Status: built, 13 November 2026 (pull request open). Astra checked the plan twice and then the code; what was found and decided is in `docs/module-record.md`.**

**History.** The first draft paid for extra time by replacing the call's hold with a bigger one. Astra checked that draft (verdict: build with changes; 8 findings). The founder then decided two things: the option to add time appears when **1 minute 30 seconds** are left (the draft said 5 minutes), and each extension gets **its own hold** instead of a replaced one, so the customer's bank never shows more than what they agreed to. This draft follows the founder. What still applies from Astra's first check is kept: the host can accept until 5 seconds before the end and a screen with an open request asks the server once more before it ends the call; asking and accepting re-check paused and closed accounts, blocks and the founder's stop switch; closing rooms gets its own loop in the helper; the card is kept until the call is over only for bookings made under the new wording; the break is the one fixed on the booking; the card used is the one on the call's own hold. The changed money design is to be checked by Astra again.

The founder's brief (13 November 2026): a call should end at its booked end, not a minute later.
In the last minute both people see a countdown. The customer can ask for more time (5, 10 or 15
minutes, or a number they type), at the same price. The host accepts or declines right there. The
customer can never ask for more than the host has free before their next appointment.

An earlier build of "more time" exists (pull request 10, closed). It made the extra time a second
call in a second room, so both people had to change rooms. This plan keeps one call and one room.

## What this module must prove

1. A call ends at its booked end, and nothing after it is counted.
2. In the last minute both people see a clear countdown.
3. A customer can ask for more time without leaving the call, and the host can accept or decline without leaving it. When the host accepts, the same call simply runs longer.
4. Extra time is paid for at the same price and by the same rules as the rest of the call, and the host's time is never committed before the money for it is held.
5. The customer's card never shows more held than what they agreed to: the booked price, plus the price of each extension they asked for.
6. Extra time can never run into the host's next call or its break, or into the customer's next call.
7. Nothing in how a normal call is paid for, counted, cancelled or paid out changes, and every earlier check still passes.

## The money: each extension is its own small payment

A paid call is a **hold** of the booked price on the customer's card, charged after the call for
the time that counted. A hold cannot be made bigger.

So each extension gets **a payment of its own**, of exactly the same kind as the call's payment:
its own hold for the price of the extra minutes, its own charge after the call, its own line on the
receipt, its own refund button for the host, its own part of the host's payout. It goes through the
same code the call's payment goes through, which is already built, tested and safe against doing
anything twice. Very little new money code is needed.

What the customer sees at their bank: the booked price held (say $40.00), and then $13.33 held when
they ask for 10 more minutes. After the call, two charges that add up to what they agreed to (or
less, if the host was late). Never a second copy of the whole amount.

**Which time each payment pays for.** Each payment covers its own stretch of the call: the call's
payment covers the start to the booked end; each extension's payment covers its own extra minutes.
After the call, each is charged for the time that counted inside its own stretch, by the call's
usual rule (the host's time for a booked call, the time both were in for an instant call), and
never more than its own hold. Two new fields on a payment say which stretch it covers.

**What follows from "a payment like any other":**
- Our fee is worked out per payment, as today: 4.9% plus 30 cents, from the host's share. The 30 cents is what Stripe charges us for each card charge, so an extension carries it too. On a 5-minute extension at $20 per 15 minutes ($6.67) the fee is 63 cents. **Confirmed by the founder on 13 November 2026: the usual fee applies to each extension.**
- The smallest extension is **5 minutes** (the founder's decision, 13 November 2026). At the lowest price a host can set ($5 per 15 minutes) that is $1.67, well above the 50 cents Stripe needs to make a charge.
- A refund is given per payment: the host sees the call and each extension as separate lines.

**Which card.** The customer is in a call with about a minute to go. There is no time to type a
card. The hold is placed on **the card that already holds the money for this call**, if that card
is still saved with Stripe. Today the saved card is removed as soon as the first hold lands; that
changes to "removed when the call is over" (ended, cancelled or stopped). The wording the customer
agrees to when saving the card changes to say so, and only bookings made under the new wording keep
their card that long.

Two known limits of this first version:
- If the money for the call was held some other way (the saved card failed and the customer typed a different card on the call page, or it is an admin test call), there is no saved card, and more time cannot be added to that **paid** call. The customer is told plainly. Free calls can always be extended.
- If the customer's bank wants its own approval step for the new hold, that cannot be done inside the call in this version. The request fails with a clear message and the call ends as booked. (Rare for US cards; common for European ones. To be decided before launch.)

**The one real danger, and how it is closed.** Until now a call had exactly one payment, and about
twenty places in the code look up "the payment of this call". With a second payment on the same
call, any of those that is not told "the call's own payment only" could pick up an extension's
payment by mistake. The worst case: the job that cancels calls whose money was not held in time
could see an extension's payment that is still being placed, and cancel a call that is under way.
So: every one of those places is listed and changed to mean the call's own payment (or, where it
should, all of them); the database itself still refuses a second "own" payment for a call; and the
journey script runs every helper job while an extension is in each of its states and checks that
nothing happens to the call.

## Rules from Astra's second check (all taken)

1. **"The call's own payment" is said in the join itself.** The booking jobs build their questions from one shared piece and then replace its conditions, so a filter added there would silently vanish. The filter goes where the payment is joined, which every job keeps. And the one path that may cancel a call after its start ("never paid") only ever works for the call's own payment.
2. **Only an accepted extension can ever be charged**, by the helper or by the founder. This is checked at the moment of charging, with the payment locked. An extension that was declined or ran out can only be released. (Otherwise a declined request whose hold was slow to let go could be charged for time that a later, accepted request also covers.)
3. **A request changes state only with the call locked.** Declining or running out first marks the request as ended, and only then lets the hold go. Accepting needs a request that is still open, the call's end unchanged since the request was made, the time checked after the locks are taken, and no release under way. A request that has ended can never become accepted.
4. **The pay-by time is the payment's own.** The existing hold code refuses a hold after the booking's pay-by time, which for every call is before it starts. For an extension's payment the limit is the request's own (it must still be open).
5. **A refund names its payment.** The refund forms send the payment, and the server checks that it belongs to a call this person hosts (or that this is the founder).
6. **Rejoining after time was added.** The "is the money in place" check at the door compares the call's own hold with its own stretch, not with the new end.
7. **A request is ready for the host as soon as its hold is on record**, however that record got there (the answer from Stripe, Stripe's own message, or the helper's check). The screen never waits for a separate "now ready" step. The request to Stripe for an extension's hold gives up after 10 seconds instead of the usual 80.
8. **The booking's new total is the old total plus the extension's price**, never worked out again from the whole length (the two can differ by a cent).

Astra also listed every place that looks up a call's payment and what each must mean; that list goes into the record. It advised keeping one plain link from each payment to its call, with the explicit filter and the tests, over hiding extension payments from the old code.

## Decisions (with the builder's recommendation)

1. **The call ends at its booked end.**
   The minute of grace after the end goes. Counting stops exactly at the booked end (as it always has), both screens leave the call at that moment, and the always-on helper then removes anyone still connected. Closing rooms gets its own loop in the helper, so slow money work can never delay it. Everything that was "a minute after the end" (the join check, "End call and report", when the record becomes final) moves with it, because they all read one number.

2. **The countdown.**
   In the last 60 seconds both people see a large "This call ends in 0:42" above the video. Before that, the usual small "Time left" clock.

3. **When the customer can ask (the founder's decision).**
   The option appears when **1 minute 30 seconds** are left. Asking stops 15 seconds before the end (the bank needs a moment). The host can accept until 5 seconds before the end. A screen that still shows an open request when its clock reaches zero asks the server one more time before ending the call, so a slow connection does not cut anyone off from a call that was just made longer.

4. **What the customer can ask for.**
   Buttons for **5, 10 and 15 more minutes**, and a box for another whole number of minutes, from 5 up. Each shows its price ("10 more minutes, $13.33"). At most **60 minutes per request**; a call can be extended again later. Choices longer than what fits are not offered, and the screen says "up to N more minutes". If fewer than 5 minutes fit, no time can be added and the screen says so.
   What fits: the new end plus the break fixed on this booking must come before the next thing either person is taken for, and the new end must come before the customer's next call or waiting request. This is checked again, by the database itself, at the moment the host accepts. The host's weekly hours and time off do not limit it: the host is there and says yes themselves.
   The price is the call's own price per 15 minutes, for the extra minutes.
   Asking and accepting are both refused if either account is paused or closed, if either person has blocked the other, if the founder has switched joining off, or if the call was cancelled, stopped or closed.

5. **The order of steps: money first, then the host.**
   When the customer presses a button, the hold for the extra minutes is placed **at once**, before the host is asked. Then the host sees "Cory asks for 10 more minutes ($13.33 more). Accept / Decline". Accepting is then one instant step in our own database with nothing left that can fail at the bank.
   The other order (ask the host first, hold the money after they accept) would mean the host says yes and then the card fails, or the bank takes 3 seconds and the call ends in between.
   The cost: a declined or unanswered request leaves a small pending amount on the customer's card until the bank drops it.
   One request can be open per call at a time (the database guarantees it), and at most 5 requests per call, so a card is not hammered.

6. **When the host accepts.** In one database step, under both people's calendar locks and with the call itself locked: the extension's hold must be in place and last long enough; the call's end moves; both people's reserved time moves with it (the host's includes the break); the database refuses if that would overlap anything; other waiting requests for the host that the longer call gets in the way of end, as they do when the host accepts any call. Both screens then show the new time left. Nobody is disconnected.

7. **When the host declines, or does not answer in time, or the call is stopped.** The request ends and its hold is let go through the usual "release" path (the helper repeats it until Stripe confirms). The call ends as booked.

8. **"End call and report" during an extended call.** As today, but for every payment of the call: none is charged automatically, each goes to the founder's review list, and each can be charged at most for the time before the call was stopped inside its own stretch.

9. **Not in this module.** The host offering more time (the customer asks; the host answers). Typing a new card inside a call. The bank's own approval step inside a call. Sounds. Shortening the host's break to fit more time.

## How it works for the two people

**Cory (customer), 1 minute 30 before the end:** under the clock a row appears: "Add time: +5 min $6.67 · +10 min $13.33 · +15 min $20.00 · Other". Under it, in small print: "The price is held on your card when you ask, and let go if the host says no." Cory presses "+10 min". "Checking your card…", then "Asked. Waiting for Hana."

**Hana (host):** a box appears above the video: "Cory asks for 10 more minutes ($13.33 more). Accept / Decline". Hana presses Accept. Both clocks jump from "Time left 0:48" to "Time left 10:48". A line says "10 minutes added."

**If Hana declines:** Cory sees "Hana cannot add time now. The call ends as booked." The hold is let go.

**The last minute:** both see "This call ends in 0:59 … 0:00". At 0:00 both see "This call has ended" with the link to the results.

**Afterwards:** the results page shows the call and each extension as its own line: the time that counted, what was charged, and for the host a refund button on each.

## What gets built, in order (small steps, each checked before the next)

1. **The rules as plain logic, tested on their own** (`src/lib/extend/rules.ts`): when asking and accepting are open, how many minutes fit, the price of N more minutes, what a typed number may be.
2. **The call ends at its booked end:** the one number changes from 60 seconds to 0; the screens and wording that mention the extra minute are updated; closing rooms gets its own loop; the closer locks the call before closing it and looks at its end again, so it can never close a call that was extended a moment ago.
3. **Tables.** `call_extensions`: the call, the minutes, the old and new end, the price, where it stands (open, accepted, declined, ran out, failed), its payment; one open request per call. An open request is shown to the host once its hold is on record (a free one at once). On `payments`: which extension it belongs to (empty for the call's own payment), and the stretch of time it covers (filled in for every existing payment from its call). The rule "one payment per call" becomes "one own payment per call, and one per extension".
4. **Every place that looks up a call's payment** is changed to mean the call's own payment, or all of them where that is right (see the list in the record). The charge after the call, the "record changed" check and the founder's charge after a stopped call use each payment's own stretch.
5. **The saved card stays until the call is over** for bookings under the new wording, and the wording says so (new wording version).
6. **Asking** (customer): checks, the request and its payment in one step, then the hold on the saved card through the existing saved-card path.
7. **Answering** (host): accept as one database step; decline; letting the hold go.
8. **The helper:** requests that ran out, or whose call ended or was stopped, are closed and their holds let go.
9. **The call screen:** it asks the server every 2 seconds in the last 2 minutes (the existing "live" address, which now also gives the call's end and the open request); the countdown; the customer's buttons; the host's box; the new end without reconnecting.
10. **The results page and the admin review list** show each payment of a call. The record, the README and the journey script.

## What we store

- `call_extensions`, as in step 3. It is also the lasting record of who asked for what and when.
- On `payments`: the extension it belongs to, and the stretch it covers.
- On the call and the booking nothing new: their end and length are updated when an extension is accepted.

## How we test it

- **Automatic tests** for the rules in step 1, the changed closing time, and charging by stretch (a late host, a host who leaves during the extension, a call stopped during the extension).
- **A script of real journeys** against the local database and Stripe's test area (`scripts/extend-check.ts`): a free call extended; a paid call extended, with two holds at Stripe, then two charges that each match their own stretch, one payout line each; declined, with the hold cancelled at Stripe and the call's own hold untouched; not answered in time; asked too early and too late; more minutes than fit before the host's next call (with its break) and before the customer's next call; two requests at once; a sixth request; accepted at the same moment a booking for that time is accepted (one of the two is refused); a card the bank refuses; a call with no saved card; "End call and report" while a request waits and after one was accepted; a paused customer; the closer not closing a call that was just extended; a second extension of the same call; the room closing at the booked end; **every helper job run while an extension is being paid for, is waiting, and is accepted, with the call untouched each time**; a refund of the extension only; a declined request and an accepted one for the same minutes, with only the accepted one charged; accepting at the same moment the request runs out; a hold that lands after its request has ended (it is let go); rejoining after time was added; one host trying to refund another host's payment.
- **All seven earlier journey scripts and all automatic tests still pass.**
- **In a browser, with two accounts:** a paid instant call, the countdown, asking, accepting, the clocks moving on both sides without anyone being disconnected.

## What the automatic checks cannot test

- Two real devices: that nobody is disconnected when time is added, and how the last 90 seconds feel.
- How a real bank shows the two holds.
- A card whose bank wants its own approval step.

## Before launch

- The lawyer's list already has the wording customers agree to when saving a card; it now also covers keeping the card until the call is over and using it when the customer asks for more time.
- Decide whether the bank's own approval step inside a call is needed (customers outside the US).
