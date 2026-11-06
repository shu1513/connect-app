# Plan: Module 7 — "Available now" calls

**Status: final. Astra checked the recommendations on 6 November 2026 and found the draft unsafe to build as written. The builder (final decider from module 5 on) adopted these changes: the money is held *before* the host is asked, so acceptance can never fail on payment and no half-state exists; instant calls get their own timing and cancellation rules instead of the booked-call deadlines; the time-together clock is applied everywhere money is worked out; "available now" needs the host's Hosting page to be open (a heartbeat) and only offers lengths that really fit; failed and withdrawn requests count against limits; and extending a call is deferred (it needs one continuous room with separately paid segments, a larger change than this module, so it is recorded as module 7b to decide later).**

Booked calls (module 4) need a day's notice. This module adds the spontaneous side: a host who is free
right now says so, and a fan who is on their page can be talking to them within minutes.

## What this module must prove

1. A host can switch "available now" on and off, it switches itself off (time up, page closed, a call accepted, a commitment coming up), and it never shows while the host is in a call or about to have one, as host or as customer.
2. A customer on the page can ask for a call now, with the money held first, and be talking within a few minutes, with the same money protections as a booked call.
3. For a call that started like this, only the time both people were connected is charged.
4. None of this can put a person in two calls at once or let money be held twice.

## Decisions (recommendation → Astra → decided)

1. **Switching "available now" on.** Recommended 30/60/120 minutes, off at 10 minutes before a booked call. Astra: 10 minutes is wrong (a host 20 minutes from a call could offer 60), require presence, hide in both roles. **Decided:** 30, 60 or 120 minutes from the Hosting page; the page sends a heartbeat every 15 seconds and availability lapses 45 seconds after the last one (closing the tab switches it off); the public page shows only the lengths whose call plus break ends before the host's next commitment in either role and before the available-until time; off when a call is accepted; never switched back on by itself.

2. **How a "now" call starts.** Recommended: card saved, host answers in 3 minutes, hold placed on acceptance. Astra: a saved card is not funds; acceptance needs a durable "authorizing" state, authentication on the waiting page, helper recovery. **Decided: hold first, then ask.** The customer confirms the payment on the spot (the same manual-capture hold as every call, with the bank's extra check if the card asks for it); only then is the host asked and the 3-minute clock starts. Acceptance is then a plain reservation (busy entries, call, start 60 seconds later) that cannot fail on money. Decline, timeout, withdrawal, or a lost reservation releases the hold at once through the usual "never twice" money operation.

3. **What is charged.** Recommended time together. Astra agreed, with the rule fixed on the call and applied everywhere. **Decided:** `calls.billing` is `host` (booked) or `together` (instant), set when the call is created and never changed; settlement, the later-records check, the review screen, receipts and reminder wording all read it. The booked-price cap, rounding and under-50-cent release stay.

4. **Cancelling.** Agreed: free until the start; after the start the call cannot be cancelled. Instant bookings carry `freeCancelMinutes = 0` and a `cancelPolicy` of `free_until_start`, so the late-cancel charge path can never apply to them.

5. **Extending a call.** Recommended a new segment with a new hold. Astra: separate rooms mean a visible reconnection and lost minutes; one room needs segment-level payments, attendance and closing, and new card-retention consent. **Decided: deferred to module 7b**, to be decided after module 8 with a design for one continuous room and separately paid segments. Nothing in this module blocks it.

6. **Limits.** Agreed, tightened: one instant request outstanding per customer (from the moment they start paying); at most 5 waiting per host; 24 hours before asking the same host again after a decline; failed, withdrawn and expired attempts count toward the existing 10-a-day request limit; three payment failures in a row pause instant requests for an hour.

7. **Notifications.** Recommended email plus a live banner. Astra: polling is the channel; emails must expire; no extension email. **Decided:** the host's Hosting page polls every 3 seconds and the customer's waiting page every 2 seconds (with jitter, one request in flight, refresh on focus, stop when settled); one email to the host per instant request that expires with the request (3 minutes), delivered by the worker's own email loop; no other emails. The existing hourly "new requests" digest ignores instant requests.

## Decisions already made

- A "now" call is a booking underneath (same table, same busy entries, same payment path), with `source = "now"`, its own deadlines (`respondBy` = asked + 3 minutes; no `payBy`) and a shorter life, so blocks, pauses, switches, free-call identity rules and reports apply to it unchanged. The hold, unpaid-cancellation and cut-off jobs are told about the new source explicitly.
- The hold for an instant call lives on the booking until acceptance creates the call and its payment; it is released on every way the request can end without a call.
- The card is not kept after an instant call: there is nothing to charge it for later.

## How it works

**Host:** presses "I am available now, for 60 minutes" on the Hosting page and keeps it open. Their public page shows "Available now" with the lengths that fit. The Hosting page polls and shows a loud banner with Accept and Decline and a countdown.

**Customer:** on the host's page, presses "Call now, 15 minutes, $20", confirms the payment (held, not charged), then waits on a page that updates itself: "Asking the host… they have 3 minutes." Accepted: "Starting in a minute" and a Join button; the room is open already. Declined or no answer: "The hold is released; nothing was charged."

## What gets built, in order

1. The billing rule per call (`host` or `together`) and the instant cancellation policy, in settlement, the later-records check, review, receipts and emails.
2. "Available now" on the Hosting page (heartbeat) and the public page (lengths that fit), with its automatic switch-off.
3. The instant request: hold first, 3-minute clock, acceptance as a reservation, start 60 seconds later, release on every other ending; the jobs that know about the new source.
4. Live updates: the host's banner and the customer's waiting page (polling).
5. The expiring email to the host.
6. Tests, journeys, browser walk-through.

## What we store

- On the host's calendar: available-now until, and the last heartbeat.
- On the call: the billing rule.
- On the booking: the new source ("now"), the hold's payment-intent reference, and the cancellation policy.

## How we test it

- Automatic tests: which lengths fit, the switch-off rules, the billing rule in pricing.
- Journeys: a "now" request held, accepted and started; not answered in 3 minutes (hold released); declined (released, 24-hour cooldown); withdrawn; two hosts accepting the same customer at once (one wins); a booked call too close (length hidden; acceptance refused); the host in a call as a customer (not available); settlement charging time together with zero overlap (nothing charged) and partial overlap; the daily limit counting failed attempts.

## Not in this module

- Extending a call (module 7b, to decide after module 8).
- Phone notifications, ringing sounds, a mobile app.
- Group calls, tips.

## What the automatic checks cannot test

- How it feels in a real browser with two phones and real network: needs the founder and a second device.
