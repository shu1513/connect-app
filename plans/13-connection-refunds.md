# Plan 13: Refund requests for a connection problem, with a record of call quality

**Status:** plan, fourth version (16 November 2026). Not built. Astra has checked it twice (rework,
then approve with changes); its points are worked in and listed at the end. One decision by the
founder is still open (when hosts are paid), and that part has not been checked by Astra yet.

## What this is, and why

The founder's concern: when a call goes badly because of the host's internet, the customer should
be able to get their money back, a request that is not true should not succeed, and the founder
should not have to sort out every case by hand.

Two facts about the app today:
- **A customer cannot ask for a refund at all.** Only the host, or the founder, can start one.
- **On a booked call the customer pays for the time the host is in the room.** A customer who gives
  up on a bad call after five minutes keeps paying for as long as the host stays, and the host is
  the one who decides whether to give it back.

## What the founder decided

| Question | Decided |
| --- | --- |
| What a booked call charges | **Stays as it is**: the time the host is in the room. |
| A record of call quality | **Collect it from the first version**, and show it to whoever decides a refund. |
| Refunding automatically | **Later**, once real calls show what good and bad calls look like in that record. |
| How long a customer has to ask | **24 hours** (the founder's proposal, in place of 3 days), so hosts are not kept waiting for their money. |
| Paying LiveKit for its $500-a-month plan | **Not now.** Nothing in this plan needs it. |

## Still open: when hosts are paid

Today a host is paid on a weekly payday, for calls that ended at least 7 days earlier, so they wait
7 to 14 days. The founder wants hosts paid sooner. Two ways:

| | **Weekly payday, wait cut to 2 days** (recommended) | **Paid every day, after 24 hours** |
| --- | --- | --- |
| A host waits | 2 to 9 days | 1 to 2 days |
| The 25-cent payout charge | Once a week, as today | Up to once a day |
| What has to change | One number | The payday rule and what hosts are told about the charge |

Either way, three things hold:
- **Money for a call with an open refund request must wait** until the request is settled. Once a
  host has been paid, nobody can refund that call in the app. This is a new rule in the payout step.
- **Stripe adds its own delay.** Card money takes about two business days to become available at
  Stripe, and Stripe then pays the host's bank on its own schedule. To be confirmed in the Stripe
  account.
- **A customer's bank can dispute a charge weeks later**, whatever the payday. That risk exists
  today and is not changed.

## What gets built

### 1. A customer can ask for a refund

1. On a call's results page the customer sees **"Ask for a refund: connection problem"**, with room
   for a sentence about what went wrong. One request per call.
   - It appears once every charge of the call is final: the call's own charge, and the charge for
     any time that was added and accepted. Until then the page says the charge is still being
     worked out.
   - It can be used for **24 hours from the moment the charge became final** (not from the end of
     the call, so a charge that took longer to settle does not cost the customer their chance).
2. **The request goes to the host**, by email and on the results page, together with the call's
   record (part 3). The host has **24 hours** to refund with the form they already have, any
   amount, or to decline.
3. **If the host declines, refunds only part, or says nothing for 24 hours**, the customer has
   **24 hours** to pass it to Connect with one press. The founder sees it in a section of its own
   on the existing reports screen, with the same record, the call's room name for looking it up in
   LiveKit's dashboard, and the date the host is due to be paid.
4. The founder refunds with the tool they already have, or closes the request. The customer is told
   either way.

Nothing about who may make a refund changes: the host, or the founder. So the rule from the
payments module (the host decides refunds) stays. What is new is that the customer can ask, and
that a "no" can be passed on.

**Where a request stands.** Stored: asked, declined, passed on, closed, each with who did it and
when. A step can only follow the one before it, so a late "decline" cannot undo a request that was
already passed on. **Refunded is not stored**: it is read from the real refund records. A request
counts as fully refunded only when every charge of the call has been given back in full and those
refunds have gone through. A part refund, one still on its way, and one that failed are each shown
as what they are, and none of them settles the request.

### 2. The app keeps a record of call quality

During a call LiveKit works out a grade for each person's connection (excellent, good, poor, lost)
and sends it to both browsers, for both people. Today the app keeps no history of it.

- **Collecting.** One small invisible piece inside the call screen. When the person joins it notes
  the grades as they are; after that it notes every change; and about twice a minute it confirms
  "still reporting, grades unchanged". It sends these in small batches, no more than once every few
  seconds, and tries once more when the person leaves or closes the tab. Nothing is shown, the call
  never waits for it, and it adds only a small, bounded amount of background traffic.
- **Each note carries** who it is about, the grade, when the browser saw it (on the server's clock,
  which the call screen already follows), which connection of that person it came from, and its
  number in order. The server adds when it arrived. So notes that arrive late or twice can still be
  put in order and counted once.
- **The server accepts a note only if** it comes from a logged-in person who is on that call; it is
  about the host or the customer of that call, worked out on the server from the call itself; the
  call's room is open and the call was not cancelled or stopped; it is from this site; and that
  person has not gone over a fixed number of notes for that call. One person's limit never uses up
  the other's.
- **What it is, and is not.** It is LiveKit's grade, but it reaches the app through the two people's
  browsers. Either person could alter or hold back what their own browser sends, and a browser on a
  bad connection may fail to deliver. So it is a record of **what each browser reported**, always
  shown that way, and never treated as proof.
- **Keeping.** The notes are removed 60 days after the call. When a request is decided, a short
  summary (the figures shown in part 3) is kept with the request. This is a new rule for the
  privacy page; it is not something the app already promises.

### 3. The record shown with a request

To the host and the customer of that call, and to the founder, once a refund has been asked for.
The server works out a short summary and sends only that: names as each person already knows the
other, times, plain reasons and grades. The saved messages themselves, which also hold a person's
region, are never shown.

- **From LiveKit's own messages**, which the app already saves and neither person can change: when
  each person was connected, and each time a connection ended, with what the video service
  recorded, in words that do not say whose fault it was:
  - "The connection ended from the person's own device. This also happens when the app reconnects
    by itself after a stumble."
  - "The video service reported that the connection timed out."
  - "The video service removed the person" (with the reason, where the app knows it: the call
    ended, the account was closed, they joined another call).
  - "The video service gave no reason."
- **From the new record**, for each person, twice: as their own browser reported it and as the other
  person's browser reported it. For each: about how long at each grade, how much of the call the
  browser was reporting for, and how much is unknown. A grade is only carried forward while that
  browser kept reporting; a gap is shown as "unknown", never filled in. Where the two browsers
  differ, both are shown.

Above it, one line: "These are approximate periods put together from what each browser reported,
and from the video service's own messages. Missing reports do not show that a connection worked,
and nothing here shows whose fault a problem was or what was said or seen on the call."

### 4. Paying hosts sooner (see "Still open")

Whichever option is chosen: the shorter wait, and the rule that a call's money is not sent while a
refund request for it is open. A request is open from asking until it is fully refunded, closed by
the founder, or the customer's 24 hours to pass it on have run out.

### 5. Automatic refunds: not in this version

Left for later, as the founder decided. Every request, its summary and the decision are kept, so
real cases will show which patterns are clear. The points below are **limits for a future plan,
not an approved rule**; a future plan would need its own check, and would still have to settle how
much is refunded and how such a refund is recorded.
- Narrow: a real gap in the host's presence that the video service reports as timed out, with the
  customer there, inside the call's final time.
- Never when either person has blocked the other, the call was ended with "End call and report",
  the charge was reviewed by the founder, or it is disputed with a bank.
- It could say yes. It could never say no by itself: nothing the app keeps can show the host's side
  was fine, and two browsers agreeing is not proof.

## Smaller choices (the builder's)

| Question | Chosen | Why |
| --- | --- | --- |
| Where requests are stored | A small table of their own, one per call, not the safety reports. | Sending a safety report also blocks the other person and counts against them. |
| The 24-hour steps | Worked out from the saved times. No timer job. | The page shows the next step when the time has passed. |
| Who sees the record | The two people on the call and the founder, only once a refund was asked for, and the server checks it, not just the page. | Each should see what the other sees. |
| Emails | To the host when a request arrives; to the customer for each answer, including when the founder closes it; to the founder when one is passed on. Each is written in the same step as the change it reports. | Through the existing email queue, so none is lost or sent twice. |

## What is left out, on purpose

- **Automatic refunds, and automatic refusals** (part 5).
- **Changing what a booked call charges** (the founder's decision).
- **Reading LiveKit's stored charts from the app.** It needs the expensive plan.
- **A refund after the host has been paid.** The refund tool cannot do it, for anyone. The hold in
  part 4 is what keeps an open request from reaching that point. A case that comes up later is
  handled by the founder outside the app, as decided in the payments module.
- **Scoring whether the two browsers agree, keeping notes for later sending when offline, and
  keeping raw notes beyond 60 days.**
- **The connection check before a call** (plan 12) plays no part here.

## What it costs

It uses the services the app already has, and no paid plan. One thing to know: when a card payment
is refunded, the card company keeps its fee for the original payment. That is already true today.

## What the terms and privacy page must say (for the lawyer)

That a customer can ask for a refund for a connection problem within 24 hours of the charge; that
the host answers first and Connect can decide if they disagree; when hosts are paid, and that
payment waits while a request is open; and that the app keeps a grade of each person's connection
during a call for 60 days and shows a summary to the two people and to Connect when a refund is
asked for.

## How it will be checked

- Automatic tests: turning saved messages into connected periods and neutral reasons; turning notes
  into "about how long at each grade", with grades that never change, notes that are missing, late,
  repeated or out of order, a reporter who reconnects, and the two browsers disagreeing.
- A new check script against the Stripe sandbox: who may ask and when (not before every charge is
  final, also with time added; not after 24 hours; not twice; not for a free call; not someone
  else's call); the host's full refund, part refund and decline; a refund still on its way and one
  that failed; passing it on and closing; the order of steps cannot be broken; what each person and
  the founder can see; a call's money is not sent while its request is open and is sent afterwards;
  notes are refused from someone not on the call, outside its time, about anyone else, from another
  site, or beyond that person's limit.
- The payments, booking and whole-journey scripts must still pass, with the new payday.
- By hand, with two browsers against the real video service: grades arriving, the same on a
  deliberately limited connection, closing a tab in the middle, and a request from asking to
  refund.

**What the checks cannot cover, and a friend test must:** what the grades and the reasons look like
on a call with a truly bad connection. That call is also the first evidence for any later decision
about automatic refunds.

## Order of work, in small steps

1. Collecting the grades. Nothing visible.
2. Asking for a refund, the host's answer.
3. Passing it on, the founder's side.
4. The record shown with a request.
5. Paying hosts sooner, with the hold.
6. The check script; every check; the two reviews; the pull request.

Size: about six to seven days of building, plus the reviews.

## Astra's checks

**First version (16 November 2026): rework.** That version refunded automatically when the saved
messages showed the host had dropped out. The main points: the saved reason shows how a connection
ended, not whose fault it was, and a reconnect after a failure can be recorded as leaving by choice;
a customer can stretch a short gap by blocking the host; refunding a whole call for two short
stumbles gives back money for time that worked; a refund request must not be built on the safety
reports; two browsers agreeing about a grade is not proof. Result: automatic refunds wait, and the
record is shown to people instead of deciding.

**Third version: approve with changes.** It found the by-hand workflow sound. Thirteen points, all
taken:
1. Say exactly when the button appears, and do not let a slow charge cost the customer their
   chance. (The window now counts from when the charge is final.)
2. Asking in time does not by itself keep a refund possible: an open request did not hold back the
   host's payment. (Now it does: part 4.)
3. "Refunded" must mean every charge given back in full and gone through; part, pending and failed
   refunds are shown as such.
4. When a note arrived is not when the browser saw the grade. (Both are kept, with an order.)
5. Notes only on change cannot give durations: silence could mean anything. (A start note, changes,
   and a regular "still reporting"; gaps are shown as unknown.)
6. Spell out what the server checks before accepting a note, and give each person their own limit.
7. Do not translate "ended from the person's device" as "left the call". (Neutral wording.)
8. LiveKit sends a grade only when it changes, starting from "unknown"; how often is not promised.
9. One invisible collector; the last note is best effort; do not claim it cannot affect the call.
10. Who did each step and when, steps in order, emails in the same step, tell the customer when the
    founder closes a request, a sentence from the customer about the problem.
11. Send only a short summary to the page, never the saved messages; 60 days is a new rule, and the
    summary kept with a request must be part of it.
12. Call the limits on automatic refunds limits, not an approved rule.
13. Wording, and more cases in the checks.

**Not yet checked by Astra:** the 24-hour steps and paying hosts sooner, which came from the founder
after the last check.
