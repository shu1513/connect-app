# Plan: Module 7 — "Available now" calls

**The founder's changes of 12 November 2026 (after comparing this build with a second one):** the host has **2 minutes** to accept or decline (was 3); after a decline the customer can ask that host again after **15 minutes** (was 24 hours); the host can **decline and block** in one click; and closing, reloading or leaving the "Available now" page switches availability off **at once** (the page says so as it goes), with a sign of life every 5 seconds and a 15-second limit as the fallback for a page that could not say so (was every 15 seconds, 45-second limit). When a host goes, requests still waiting for them end at once. The numbers below are updated to match.

**Status: final. Astra checked the recommendations on 6 November 2026 and found the draft unsafe to build as written. The builder (final decider from module 5 on) adopted these changes: acceptance reserves both people first and only then asks the bank, with a 2-minute payment deadline and the usual recovery for a lost answer; instant calls get their own timing and cancellation rules instead of the booked-call deadlines; the time-together clock is applied everywhere money is worked out; "available now" needs the host's Hosting page to be open (a heartbeat) and only offers lengths that really fit; failed and withdrawn requests count against limits; and extending a call is deferred (it needs one continuous room with separately paid segments, a larger change than this module, so it is recorded as module 7b to decide later).**

Booked calls (module 4) need a day's notice. This module adds the spontaneous side: a host who is free
right now says so, and a fan who is on their page can be talking to them within minutes.

## What this module must prove

1. A host can switch "available now" on and off, it switches itself off (time up, page closed, a call accepted, a commitment coming up), and it never shows while the host is in a call or about to have one, as host or as customer.
2. A customer on the page can ask for a call now, with the money held first, and be talking within a few minutes, with the same money protections as a booked call.
3. For a call that started like this, only the time both people were connected is charged.
4. None of this can put a person in two calls at once or let money be held twice.

## Decisions (recommendation → Astra → decided)

1. **Switching "available now" on.** Recommended 30/60/120 minutes, off at 10 minutes before a booked call. Astra: 10 minutes is wrong (a host 20 minutes from a call could offer 60), require presence, hide in both roles. **Decided:** 30, 60 or 120 minutes from the Hosting page; closing, reloading or leaving the page switches it off at once; as the fallback, the page sends a heartbeat every 5 seconds and availability lapses 15 seconds after the last one; the public page shows only the lengths whose call is over before the availability ends and, with the break, before the host's next commitment in either role; a lapse of the sign of life is final until the host switches on again; off when a call is accepted; never switched back on by itself.

2. **How a "now" call starts.** Recommended: card saved, host answers in 2 minutes, hold placed on acceptance, start 1 minute later. Astra: a saved card is not funds; acceptance must first reserve both people in a durable state, then ask Stripe outside that step, with a bounded payment deadline and recovery for an unknown answer. **Decided (Astra's shape, on the existing parts):** the customer saves a card and sends the request; the host has 2 minutes, and can accept, decline, or decline and block. Accepting reserves both people and creates the call and its payment in one step (the existing acceptance), with the start **60 seconds** after acceptance and a payment deadline **2 minutes** after it. The saved card is tried at once through the "never twice" money path; if the bank wants the customer's approval, the call page shows the usual card form on the same hold (the customer is there, waiting); an unknown answer is settled by the helper as for any hold. Nobody can enter the room until the money is held. If the money is not held by the deadline, the call is cancelled for free and nothing is charged; a hold that lands after the deadline is ignored and let go, as today.

3. **What is charged.** Recommended time together. Astra agreed, with the rule fixed on the call and applied everywhere. **Decided:** `calls.billing` is `host` (booked) or `together` (instant), set when the call is created and never changed; settlement, the later-records check, the review screen, receipts and reminder wording all read it. The booked-price cap, rounding and under-50-cent release stay.

4. **Cancelling.** Agreed: free until the start; after the start the call cannot be cancelled. Instant bookings carry `freeCancelMinutes = 0` and a `cancelPolicy` of `free_until_start`, so the late-cancel charge path can never apply to them.

5. **Extending a call.** Recommended a new segment with a new hold. Astra: separate rooms mean a visible reconnection and lost minutes; one room needs segment-level payments, attendance and closing, and new card-retention consent. **Decided: deferred to module 7b**, to be decided after module 8 with a design for one continuous room and separately paid segments. Nothing in this module blocks it.

6. **Limits.** Agreed, tightened: one instant request outstanding per customer (from the moment they start paying); at most 5 waiting per host; 15 minutes before asking the same host again after a decline; failed, withdrawn and expired attempts count toward the existing 10-a-day request limit; three payment failures in a row pause instant requests for an hour.

7. **Notifications.** Recommended email plus a live banner. Astra: polling is the channel; emails must expire; no extension email. **Decided:** the host's Hosting page polls every 3 seconds and the customer's waiting page every 2 seconds (with jitter, one request in flight, refresh on focus, stop when settled); one email to the host per instant request that expires with the request (2 minutes), delivered by the worker's own email loop; no other emails. The existing hourly "new requests" digest ignores instant requests.

## Decisions already made

- A "now" call is a booking underneath (same table, same busy entries, same payment path), with `source = "now"` and its own deadlines (`respondBy` = asked + 2 minutes; `payBy` = accepted + 2 minutes), so blocks, pauses, switches, free-call identity rules and reports apply to it unchanged. The hold, unpaid-cancellation and cut-off jobs are told about the new source explicitly.
- The saved card is removed as soon as the money is held or the request ends, as for booked calls.

## How it works

**Host:** presses "I am available now, for 60 minutes" on the Hosting page and keeps it open. Their public page shows "Available now" with the lengths that fit. The Hosting page polls and shows a loud banner with Accept and Decline and a countdown.

**Customer:** on the host's page, presses "Call now, 15 minutes, $20", saves the card, then waits on a page that updates itself: "Asking the host… they have 2 minutes." Accepted: "Holding the money… starting in a minute", then the Join button (the room is open already); if the bank wants their approval, the card form appears on the same hold. Declined or no answer: "Nothing was charged."

## What gets built, in order

1. The billing rule per call (`host` or `together`) and the instant cancellation policy, in settlement, the later-records check, review, receipts and emails.
2. "Available now" on the Hosting page (heartbeat) and the public page (lengths that fit), with its automatic switch-off.
3. The instant request: saved card, 2-minute clock, acceptance as a reservation with the hold tried at once, start 60 seconds later, a 2-minute payment deadline; the jobs that know about the new source.
4. Live updates: the host's banner and the customer's waiting page (polling).
5. The expiring email to the host.
6. Tests, journeys, browser walk-through.

## What we store

- On the host's calendar: available-now until, and the last heartbeat.
- On the call: the billing rule.
- On the booking: the new source ("now") and its own deadlines.

## How we test it

- Automatic tests: which lengths fit, the switch-off rules, the billing rule in pricing.
- Journeys: a "now" request accepted, held and started; not answered in 2 minutes; declined (15-minute wait); withdrawn; the card refused on acceptance (cancelled free at the deadline, nothing charged); two hosts accepting the same customer at once (one wins); a booked call too close (length hidden; acceptance refused); the host in a call as a customer (not available); settlement charging time together with zero overlap (nothing charged) and partial overlap; the daily limit counting failed attempts.

## Not in this module

- Extending a call (module 7b, to decide after module 8).
- Phone notifications, ringing sounds, a mobile app.
- Group calls, tips.

## What the automatic checks cannot test

- How it feels in a real browser with two phones and real network: needs the founder and a second device.
