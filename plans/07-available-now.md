# Plan: Module 7 — "Available now" calls and extending a call

**Status: final. Astra checked the first draft on 11 November 2026 (verdict: build with changes). Taken: an unpaid instant call can be cancelled even after its start; a part 2's room does not open early; "End call and report" also ends a pending part 2; offers only while 5 minutes remain, so a part 2 always starts exactly when part 1 ends; one pending part per call, guaranteed by the database; explicit gates and daily limits for instant starts; the payout account is re-checked before money is held; a bank's approval step is handled. Simplified rather than taken: no shrinking and restoring of the host's break around an extension (part 2's reservation starts where part 1's break ends). Not taken: a separate "accept" step for a free extension (the customer can decline it with one click). From module 5 on the builder decides after Astra's check and records the decisions in `docs/module-record.md`.**

Until now every call is booked days ahead: a request, an answer, a hold two days before. This module
adds the two things people expect from a live service:

- A host can say **"I'm available now"**, and a customer who finds them can start a call within minutes.
- During a call, the two people can agree on **more time**, pay for it, and carry on, without leaving the call.

Both are built out of what exists: the same call, the same room, the same hold-then-charge, the same
"never two calls at once" rule. Nothing in the money or counting rules changes.

## What this module must prove

1. A host can switch "available now" on for a short while, it switches itself off, and only people the host could really take right now see it.
2. A customer can start a call with an available host in a few clicks. For a paid call the money is held before the call starts; if it is not, the call is cancelled for free and the host is free again within minutes.
3. "Never two calls at once" still holds: an instant call can never overlap a booked call, for either person, even when two customers press the button at the same moment.
4. During a call, more time can be agreed and paid for without leaving the call, and the extra time is counted and charged under exactly the same rules as the call itself.
5. Nothing in the existing payment, cancelling, counting or payout rules changes, and every earlier check still passes.

## Decisions (with the builder's recommendation)

1. **The "available now" switch.**
   Recommended: on the Hosting page, the host presses one of "Take calls that start in the next **30 minutes / 1 hour / 2 hours**". It switches itself off when that time is up, so a host who forgets never looks available all night; they can also stop it early. It needs an approved, visible profile, and for a paid host a payout account that is ready (the same as booking). The host's weekly hours do not matter while it is on: the host is saying they are free right now. Calls already booked still win: a length that would run into one is simply not offered, and while the host is in a call the page says so.

2. **How an instant call starts, and when.**
   Recommended: on the host's public page a customer sees "Available now", picks a length from the ones the host offers, sees a short summary (who, how long, the price, what counts, the cancelling rule), and presses the button. The call is created at once and **starts 5 minutes after the button**; the room is open right away, and as everywhere else the minutes before the start are not counted. The 5 minutes are for entering a card and for the host to notice.
   For a **paid** call the customer confirms their card on the call page, in the same form as a booked call. The money must be held **before the start** (so within the 5 minutes). The host cannot join until it is held. If it is not held in time, the always-on helper cancels the call for free, both are told, and the host is free again. Nobody can ever be inside an unpaid call, so this one kind of cancellation is allowed even after the start: if the helper was late, the call is still cleared away instead of sitting there until its end. The customer is told all of this before pressing the button.
   An instant call is **free to cancel until it starts**, whatever the host's cancelling rule says: that rule was made for calls booked days ahead. The call itself carries that rule, so every existing cancellation path applies it. The gates are checked explicitly when the call is created, under both calendar locks: approved and visible host, nobody paused or closed, no block either way, both of the founder's stop switches off, the identity check before a first free call, at most 3 free calls coming up, the 7-day cooling-off after a host declined this person, and for a paid host a payout account that Stripe confirms is ready at that moment. A customer can start at most 3 instant calls with one host and 10 in total per day (cancelled and unpaid ones count), so a host cannot be tied up by someone who starts calls and never pays; the database's overlap rule does the rest, including when two customers press the button on the same host at the same moment.

3. **Telling the host.**
   Recommended: an email at once with the link to the call ("someone wants to talk now"); the host's home page refreshes itself every half minute while they are available, so the new call appears; and the call page refreshes itself while it waits for the payment, so the host sees the moment it is held. No sounds or phone notifications (decided out in module 6).

4. **Extending a call: the extra time is a second part, not a longer first part.**
   Recommended: the host, from inside the call, offers more time (15, 30, 45 or 60 minutes, from the lengths they offer), **while at least 5 minutes of the call remain**. The customer sees the offer inside the call page, and for a paid call enters their card there and then, without leaving the room. The extra time is a **new call ("part 2")** between the same two people, at the same price per 15 minutes, that starts **exactly when the current part ends**. It has its own hold, its own charge for the host's connected time, its own receipt and its own payout, exactly like any call (so the fixed 30 cents of our fee applies to each paid part). A paid part 2 must be paid before it starts, or it is cancelled for free, as an instant call is. A free part 2 is a real call as soon as it is offered; the customer can decline it with one click. Either person can withdraw or decline a part 2 for free before it starts (it is free to cancel until it starts, like an instant call); it can itself be extended again. A call can have **one pending part 2 at a time**; the database guarantees that. "End call and report" on part 1 also cancels a pending part 2.
   When the current part's time is up, both people are taken to the next part's page and join there with one click. A part 2's room opens **at its start**, not 5 minutes early, so joining it can never pull anyone out of part 1 while it is still being counted; and once part 1's time is up, nobody can re-enter part 1 (the usual minute of grace is for finishing a sentence, not for going back). There is no break between a call and its own extension: part 2's reservation of the host's time begins where part 1's break ends, so nothing has to be shortened or put back if the part 2 is cancelled; the host's usual break follows the last part.
   Why not simply make the current call longer: the customer's money is a **hold** of the booked price, and a hold cannot be raised reliably (Stripe's "incremental authorisation" works only for some cards and kinds of business). Every money rule in module 2 assumes one hold per call. Stretching the call would mean either the host giving the extra minutes away or a second hold that none of the charging, refund and payout rules know about. A second part keeps every rule intact at the cost of one click to change rooms. Astra's check reached the same conclusion.
   One limit to say plainly: if the customer's bank wants its own approval step for the card, Stripe sends them to the bank's page and back, which interrupts the video for a moment. The call page picks the payment up again when they return.

5. **Not in this module.**
   Customers proposing an extension (they ask out loud; the host offers), a queue for a busy host, "accept automatically" for bookings, extending within the same room, sounds and phone notifications.

## Decisions already made (carried over)

- The gates are the same as for booking: approved and visible profile, nobody paused or closed, no block either way, the founder's stop switches, the identity check before a first free call, a ready payout account for paid calls.
- All money goes through module 2's paths: one hold per payment, written down before Stripe is asked, never twice; the charge after the call is for the host's connected time inside the booked window; hosts are paid on the weekly payday.
- The database itself refuses to put one person in two overlapping calls (module 4). Instant calls and extra parts get the same busy entries as any call.
- The admin test page is unchanged. A test call can be extended like any other.
- Times are stored in world time and shown in each person's own zone.

## How it works

**The host** (Hosting page): presses "Take calls that start in the next hour". Their page now shows "Available now" with the lengths that fit before their next booked call. They keep the Connect tab open; it refreshes itself.

**The customer** (the host's page): sees "Available now", picks "30 minutes, $40", reads the summary, presses "Continue to payment" (or "Start the call" for a free host). They land on the call page. Paid: the card form is there, with "confirm by 10:04". Once the money is held, the usual room screen appears: "Starts in 3:40", check camera, join. The host gets the email, opens the call, joins. At the start the counting begins; everything from here is module 1 and 2 unchanged.

**Extending** (inside the call, with 5 or more minutes left): the host presses "Offer 15 more minutes". The customer's screen shows "Host offers 15 more minutes for $20" with a card form under the video. Both screens say "15 more minutes from 10:30, confirmed". At 10:30 both are taken to part 2's page; they press "Join call" and carry on. Part 1's room closes a minute later, as always. Each part has its own results and receipt, linked to each other.

**If the customer never pays** (either case): at the start the always-on helper cancels the part for free, the busy entries go, both are told, and the host's page offers their time again.

## What gets built, in order (small steps, each checked before the next)

1. **The rules as plain logic, tested on their own:** when an instant call starts and must be paid by; which lengths fit around what the host is already busy with; when an extension may be offered.
2. **Tables:** "available until" on the host profile; "continues call" on calls, with the database rule "one pending part 2 per call"; booking sources "instant" and "extension". The handful of places that read the booking's source learn about them (the payment cut-off, cancelling unpaid calls at the cut-off, reminders, the requests list, the booking emails), and cancelling an unpaid call is allowed after its start.
3. **Starting a call now:** one function used both by "available now" and by extensions, in one database step under both calendar locks: the gates, the call, its payment, the booking, the busy entries. The host's availability switch. The room rules: no early opening for a part 2; no re-entry to a part whose time is up when a part 2 follows; "End call and report" ends a pending part 2 too.
4. **Screens for instant calls:** the Hosting page section, the "Available now" section on the public page, the summary page and its action, the email to the host, the self-refreshing home page.
5. **The call page for an instant call:** the pay-by time, the waiting text, self-refresh while waiting.
6. **Extensions:** the host's offer, the customer's accept-and-pay panel inside the call, the move to the next part, withdraw/decline, the links between parts on the results page.
7. **Journeys, README, the module record.**

## What we store

- On the host profile: **available until** (empty when not available).
- On each call: **continues call** (the part before it, for an extension). At most one part 2 that is not cancelled per call.
- Bookings: the source is "instant" (started from "available now") or "extension"; such a booking is created already accepted, with the time it was asked for (for the daily limits) and, for a paid one, the pay-by time equal to the start. Both the booking and the call carry "free to cancel until the start".
- Nothing new about money.

## How we test it

- **Automatic tests** for the rules in step 1.
- **A script of real journeys** against the local database and Stripe's test area (`scripts/instant-check.ts`): the switch turns on, is shown, and turns itself off; a free instant call starts at once and the room is open; a paid one is not joinable until held, is held through the same hold path, then joinable; not paid in time → cancelled free, both told, host free again, including when the helper only gets to it after the start; a length that would run into a booked call is not offered; two customers press the button on the same host at the same moment → one call; a customer already in a call cannot start another; limits per day; blocked, paused, hidden, switches; an extension offered, paid, part 2 starts at part 1's end with no gap and no break, host busy for part 2 plus the break; a second offer while one is pending is refused; an offer with less than 5 minutes left is refused; an extension not paid → cancelled free; withdrawn by the host; declined by the customer; "End call and report" on part 1 cancels part 2; a second extension; an extension of a free call; a part 2's room does not open early and part 1 cannot be re-entered after its time; part 2 of a paid call is charged for its own host time only.
- **All earlier journeys and tests still pass.**
- **In a browser:** an instant paid call from the host's page to a running room, and an extension from inside a call.

## What the automatic checks cannot test

- Moving from one room to the next on two real devices, and how it feels. (Closing part 1 removes people from part 1's room and cancels their passes for that room; whether LiveKit Cloud's cancellation really stays within one room is to be confirmed in the two-device test already on the list: after part 1 closes, someone in part 2 must stay connected.)
- A card whose bank asks for its own approval step while a part 2 is being paid for inside a call.
- Whether 5 minutes is the right lead time for real people entering a real card.

## Before launch

- Nothing new beyond the earlier lists (a real email service matters more here: the host's email is how they learn someone is calling).
