# Plan: Module 4 — Calendar and booking

**Status: final. The founder gave two changes on 6 November 2026 (short breaks; several customers may ask for the same time and the host chooses), asked for the recommendations to be checked with Astra once more, and left the final decisions to the builder. Astra's second check is folded in below; the decisions as written here are the ones being built.**

Until now a call could only be created from an admin-only test page. This module is the real way in:
a host says when they are free, a customer picks a time on the host's page and asks for it, the host
accepts, and the call and its payment are set up automatically.

It joins the three earlier modules together. The host's page and price come from module 3, the call
room and time counting from module 1, and the hold, charge, cancelling rule and payout from module 2.

## What this module must prove

1. A host can say when they are free, in their own time zone, and it stays right when the clocks change.
2. A customer sees only times that are really open, in their own time zone, and can ask for one.
3. Nobody can be in two calls at once: the same time can never be given to two people, even if two customers press the button at the same moment.
4. The host accepts or declines within a set time. If they do nothing, the request ends by itself and the customer is told.
5. An accepted booking becomes a real call with the right price, the right cancelling rule, and (for paid calls) money held before it starts, without the customer having to come back and pay.
6. Nobody is charged for a call that did not get accepted, and no hold is ever placed twice.

## The decisions

1. **Ask first.**
   Recommended: the customer sends a request and the host accepts or declines (the Airbnb way you asked for). "Accept automatically" is left for later: it makes it easier for someone to fill a host's calendar with bookings they do not mean.

2. **How long the host has to answer.**
   24 hours, or less when the call is soon, so there is always time left to sort out the payment: for a paid call the answer must come at least 6 hours before the payment cut-off in decision 3; for a free call at least 2 hours before the start. If the host does not answer in time, the request ends, the time is free again, the customer is told, and nothing is held or charged. A customer can take back a request any time before it is answered, for free.

3. **The customer's card: when is it asked for, and when is money held?**
   A hold on a card only lasts a few days, so module 2 only allows a hold from 2 days before the call. People will often book further ahead than that.
   Recommended: the customer enters their card **when they send the request**. Nothing is held or charged at that moment; Stripe keeps the card safely. The full booked price is then held **automatically** 2 days before the call (or at acceptance, if the call is sooner than that). The customer agrees to exactly this, in plain words, before they confirm.
   If the hold does not work (the card is refused, or the bank wants the customer to approve it), the customer gets an email and can fix it on the call page. **It must be fixed before the host's free-cancelling period ends, and at the latest 12 hours before the call** (the "payment cut-off"). A paid time can only be asked for while there are still at least 8 hours left before that cut-off. If it is not, the booking is cancelled for free and the host is told. This way a failed card can never be used to get out of the host's cancelling rule.
   The saved card is used for that one booking only, and is removed from Stripe when the booking is over.
   Alternative: no saved card; the customer must come back and pay when the 2-day window opens. Simpler to build, but many will forget, and hosts will see bookings fall through.

4. **Call lengths.**
   Recommended: the host chooses which lengths they offer from 15, 30, 45 and 60 minutes. The price is the host's price per 15 minutes times the length. The customer sees the total before sending the request.

5. **How soon and how far ahead.**
   Recommended: the host chooses the shortest notice (1, 2 or 3 days; default 1 day) and how far ahead they can be booked (2, 4 or 8 weeks; default 4). Same-day paid bookings are not possible in this module, because the host needs time to answer and the card needs time to be sorted. Calls "right now" come in module 7.

6. **A break between calls.** *(founder's change)*
   The host chooses: 1, 5, 10, 15 or 30 minutes (default 5). One minute is the least, because a call's room takes a minute to close. Open times are laid out one after another from the start of the host's hours: with 30-minute calls and a 5-minute break, a host free from 6:00 is offered at 6:00, 6:35, 7:10 and so on. When the host already has a call, the time right after it (call plus break) is offered too, so no time is wasted when a host offers several lengths. (The next call's room opens 5 minutes early, so with a short break the next customer may already be waiting in their own room while the host finishes. That is fine: waiting before the start is never counted or charged. Joining one call puts a person out of any other call they are still in, so nobody can be on camera in two calls at once.)

7. **Several customers can ask for the same time, and the host chooses.** *(founder's change)*
   A request does not reserve the time. The time stays open on the host's page until the host accepts someone. The host sees all the requests for a time together and picks one; the others are told at once that the host chose another request, and their saved cards are removed unused. Customers are told this clearly before they send a request.
   Because a waiting request no longer blocks anything, nobody can block a host's calendar by asking. To keep requests meaningful, recommended: a customer can have at most 3 waiting requests with the same host and 5 in total, cannot have two requests or calls of their own at overlapping times, and can have at most 3 upcoming free calls. After a host declines a person outright, that person cannot ask the same host again for 7 days. Being passed over for another request, or a request running out of time, does not count as a decline. To protect popular hosts: at most 20 waiting requests for one start time and 100 per host; when full, the page says the host is not taking more requests for now. A customer can send at most 3 requests to one host and 10 in total per day, counting ones they took back.

8. **Changing a booked time.**
   Recommended: not in this module. To move a call, cancel it and book again; the host's cancelling rule applies, and we say so on the cancel button. Moving a call by agreement is added later, with messaging.

9. **What the host sees about the customer.**
   Recommended: the customer's name and a short note (up to 300 characters) saying what they want to talk about. Never their email address. Only the host sees the note.

10. **Emails.**
    Recommended: this module sends the emails a booking cannot work without: "you have new requests" (host; at most one such email an hour, covering everything new); "request sent", "accepted", "declined", "the host chose another request", "not answered in time" (customer); "your card did not work, please fix it" (customer); "the call was cancelled" (the other person). While developing they go to the test "sent emails" page like the others. Reminders before a call, text messages and notification settings come in the notifications module.

11. **When you suspend a host or close an account.**
    Recommended: their waiting requests end and their future bookings are cancelled for free, and the other person is told. A host who only *hides* their own profile keeps the bookings they already have (as decided in module 3).

## Decisions already made

- **Times are stored in one world time and shown to each person in their own time zone**, with the zone named. A host's weekly hours belong to a "calendar time zone" the host sets, so "Mondays 6 to 9 in the evening" stays 6 to 9 for the host when the clocks change. Changing that zone later changes future open times only; bookings already made do not move.
- **Only approved, visible hosts can be booked**, and a paid booking needs the host's payout account to be ready (modules 2 and 3). This is checked again when the host accepts and again before money is held.
- **The price, the cancelling rule and the break are fixed when the request is sent.** If the host changes them later, existing requests and bookings keep theirs.
- **The cancelling rules are module 2's.** Cancelling before the money is held is always free. Once it is held, the host's rule decides. A host can always cancel for free; the customer then pays nothing.
- **The database itself refuses to put one person in two overlapping calls**, whether they are the host or the customer in each. This does not depend on our code getting the timing right.
- **A customer never sees why a time is closed**, only which times are open.
- **Hosts cannot book themselves.**
- **The admin test page stays** for testing, but creates its calls through the same booking path, so it cannot break the no-overlap rule.

## How it works

**The host sets up their calendar** (on the Hosting page)
1. Their calendar time zone.
2. Weekly hours: for each day of the week, none, one or several time ranges.
3. Time off: any stretch of time they are not available (a holiday, an afternoon).
4. Their choices from decisions 4, 5 and 6.

**The customer books** (on the host's public page)
1. They choose a length. The page shows the open start times, day by day, in their own time zone.
2. They pick a time and log in or sign up if needed.
3. They see a summary: who, when (in both time zones if different), how long, the total price, the cancelling rule, and exactly when money will be held and charged.
4. Paid call: they agree to the card wording and enter their card in Stripe's form. Free call: they just confirm.
5. The request is sent and the host's time to answer starts. The time is not reserved: others may ask for it too, and the host chooses.

**The host answers**
- They get an email and see the request on their Hosting page with the deadline.
- Requests for the same time are shown together, so the host can compare and pick.
- Accept: the request becomes a call. Both see it under "Your calls". For a paid call the money side is set up, and the hold is placed now or 2 days before the start. Every other waiting request that overlaps that call (including the break) ends in the same step, and those customers are told the host chose another request.
- Decline, or no answer in time: the request ends, the customer is told, and the saved card is removed unused.

**Before the call**
- Two days before (or at acceptance if sooner), the helper places the hold on the saved card. If that does not work, the customer is emailed and can pay on the call page until the cut-off in decision 3. After that, an unpaid booking is cancelled for free.
- Either person can cancel under module 2's rules. Cancelling frees the time in the same step.

**The call itself** is modules 1 and 2, unchanged.

## The rule for open times

- The times are worked out in the host's calendar time zone, from the weekly hours. Within each stretch of hours they are laid out one after another: the first at the start, the next after one call length plus the break, and so on.
- A time is open only if the whole call fits inside the host's hours, does not touch time off, and leaves the break before the host's next confirmed call and after the previous one. Waiting requests do not close a time.
- On the day the clocks go forward, times that do not exist are skipped. On the day they go back, the hour that happens twice is offered once (the first time).
- Weekly hours may run past midnight; they are treated as one stretch.
- Notice and deadlines are counted in real elapsed hours. "How far ahead" is counted in the host's calendar days.
- A paid time is offered only if everything still fits before the call: time for the host to answer, and time to sort the payment before the cut-off.
- The page works the times out fresh on each visit, a few weeks at a time, and checks again when the request is sent. It never trusts a time the browser sends.

## How "never two calls at once" is guaranteed

- A "busy" entry says that a person is taken for a stretch of time. A customer gets one for their own request as soon as they send it (a person cannot ask for two things at the same time). A host gets one only when they accept (the call plus the break after it).
- The database has one rule: no person may have two busy entries that overlap. A second attempt is refused by the database, whichever server or browser it came from, and whichever role the person has in each call. So a host can never accept two requests that overlap, even by pressing both buttons at once.
- A request that ends (declined, passed over, not answered, taken back, cancelled) removes its busy entries in the same step.
- Accepting a request, ending the other requests for that time, and creating the call and its payment happen in one step: either all of it happens or none of it.
- Each change of a booking's stage only succeeds from the right stage and before its deadline, so "accept" and "ran out of time" can never both win, and a late helper can never let a host accept after the deadline.

## How the money is kept safe

- Saving a card uses Stripe's own form; we never see the number. Nothing is held or charged when a card is saved. We check with Stripe ourselves that the card really was saved, and record what the customer agreed to, with its wording and the time.
- There is one hold per payment, ever. It is created and written down first; only then is the saved card tried on it. If the customer later has to fix it by hand, they fix **that same hold**, never a second one.
- Trying the card goes through module 2's "never twice" path: written down first under one label, one at a time per payment, checked with Stripe if the outcome is unknown.
- A clear "no" from the bank is tried once only; the customer fixes it themselves. A lost connection is not a "no": the helper checks with Stripe until it knows.
- Before a booking is cancelled for not being paid, the helper asks Stripe one last time, so a hold that did go through is never thrown away.
- A call can still never start without the money held (module 2).

## What gets built, in order

1. **The open-times rule** (plain logic, heavily tested), using the standard time-zone library for JavaScript.
2. **Tables**, the busy entries and the database's no-overlap rule.
3. **Host calendar settings** on the Hosting page.
4. **Booking flow** on the public page: lengths, open times, summary, request, the limits.
5. **Saved card** for paid requests, and the agreement record.
6. **Host's requests**: accept, decline; the run-out job.
7. **Turning an accepted request into a call and payment**; cancelling frees the time in the same step; the admin test page goes through the same path.
8. **The hold**: one recorded hold per payment, the automatic try, the "card did not work" path, the cut-off, removing the saved card afterwards.
9. **Emails** for each step, written down in the same step as the change so none is lost or sent twice.
10. **Suspension and account closing** end requests and cancel future bookings.
11. **"Your bookings"** on the home page; requests and calls with their state; the admin page shows anything overdue that the helper has not handled.
12. **Tests, journeys and a browser walk-through.**

## What we store

- **Calendar settings** (per host): calendar time zone, lengths offered, shortest notice, how far ahead, break.
- **Weekly hours:** host, day of the week, from, to.
- **Time off:** host, from, to.
- **Bookings:** host, customer, start, end, length, the break, price per 15 minutes and total, cancelling rule, the note, the stage, the answer deadline, the payment cut-off, what the customer agreed to about their card, Stripe's reference to the saved card, the call it became, who ended it and why, and the time of each step.
- **Busy entries:** booking, person, from, to. This is where the no-overlap rule lives.
- **Emails:** each booking email carries a key (which booking, which event) so it can only be written once.

## Stages of a booking

`card being entered` → `waiting` → `accepted` → `cancelled`
`waiting` → `declined` | `passed over` (the host accepted another request for that time) | `ran out` | `taken back`
`card being entered` → `ran out` (after 30 minutes without a card)

Only `accepted` closes the time on the host's page.

## How we test it

- **Automatic tests for the open-times rule:** weekly hours in several time zones; both clock-change days; hours past midnight; notice, horizon and "does the payment timeline fit" edges; breaks of 1, 5 and 30 minutes and how the times are laid out; time off; existing bookings; a customer in a different time zone, including across the date line; the host changing their calendar time zone.
- **A script of real journeys** against the local app, database and Stripe's test area: request → accept → call and payment exist; decline; run out; take back; several customers asking for the same time (all wait; the host accepts one and the others are told at once); the host pressing accept on two overlapping requests at the same moment (exactly one becomes a call); a customer asking for two overlapping times (refused); one person as host in one call and customer in another at the same time (refused); every limit in decision 7; a host who became hidden, suspended or lost payout readiness; accept racing with run-out; accepting after the deadline; the automatic hold at the right moment; a refused card and a card that needs approval → email → fixed on the call page with the same hold; a duplicate automatic try and a browser try at the same moment → one hold; not fixed → cancelled free at the cut-off; a late cancellation with the money held → charged as in module 2; cancelling frees the time; a price change after the request does not change the booking; suspending and closing end requests and bookings.
- **All earlier checks still pass** (payments, accounts).
- **In a browser:** a full booking from a host's page to a finished, charged call.

## This module is done when

- A host can set hours and time off, and the open times shown are right in the host's and the customer's time zones.
- A customer can request, the host can accept, and the call and its money follow without anyone touching the admin test page.
- Double booking is impossible in every test we can think of.
- Unanswered requests and unpaid bookings end by themselves and everyone is told.

## Not in this module

- "Accept automatically", and saving a card for future bookings.
- Reminders, text messages, "add to my calendar" files (notifications, module 6).
- Showing a host's Google Calendar or blocking times from it.
- "Available now" calls and extending a call (module 7).
- Moving a booked call, repeat bookings, group calls, packages, discount codes, tips.
- Ratings, and acting on hosts who cancel often or customers who do not show up (module 8). The facts needed for that are recorded from now on.
- Blocking a particular customer (safety, module 5).

## What the automatic checks cannot test

- Real cards that need the bank's approval when the hold is placed later; Stripe's test cards imitate this, but real banks vary.
- How long a real hold lasts on each kind of card.
- Whether hosts understand the calendar settings; that needs real people trying it.

## Before launch

- The wording customers agree to when saving a card must be checked by a lawyer (Stripe requires clear consent for placing a hold later).
- A real email service (already on the list from module 3): without it hosts will not know they have a request.
