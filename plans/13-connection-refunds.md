# Plan 13: Refund requests for a connection problem, with a record of call quality

**Status:** plan, seventh version (16 November 2026). Not built. Astra has checked earlier versions
three times; what it found is at the end. This version changes **when the money is taken**, by the
founder's decision, so that a refund agreed soon after a call costs Connect no card fee. Astra's
check of that change is at the very end.

## What this is, and why

The founder's concern: when a call goes badly because of the host's internet, the customer should
be able to get their money back, a request that is not true should not succeed, the founder should
not have to sort out every case by hand, and Connect should not lose the card fee on every refund.

Three facts about the app today:
- **A customer cannot ask for a refund at all.** Only the host, or the founder, can start one.
- **On a booked call the customer pays for the time the host is in the room.** A customer who gives
  up on a bad call after five minutes keeps paying for as long as the host stays.
- **A refund costs Connect the card fee.** The money is taken minutes after a call. Giving it back
  later returns everything to the customer, but Stripe keeps its fee for the first payment (about
  3% plus 30 cents), and Connect absorbs that.

## What the founder decided

| Question | Decided |
| --- | --- |
| What a booked call charges | **Stays as it is**: the time the host is in the room. |
| How long a customer has to ask | **24 hours** after the call. |
| Who answers a request | **The host**, asked to answer within **24 hours**. Passing a "no" on to Connect is left out for now. |
| When the money is taken | **Not until the customer's 24 hours are over**, and when a request was made, **not until the host has answered**, as long as the card's hold allows. So a refund agreed in that time costs no card fee. |
| If the host does not answer in time | The money is taken in full before the hold runs out. **The host is not paid for that call until they answer.** Nothing is refunded or refused automatically. |
| A record of call quality | **Collect it from the first version**, and show it with a refund request. |
| Refunding automatically | **Later**, once real calls show what good and bad calls look like in that record. |
| How hosts are paid | They collect their earnings themselves, from 2 days after a call. See plan 14. |
| Paying LiveKit for its $500-a-month plan | **Not now.** Nothing in this plan needs it. |

## The idea in one picture

A card payment has two steps. First the bank **holds** the money on the customer's card; nothing
has moved. Later the app **takes** what is owed and the rest of the hold is released. Stripe charges
its fee only on money that is taken. Lowering or dropping a charge before it is taken costs nothing.

Today the app takes the money a couple of minutes after the call. This plan makes it wait:

| Moment | Today | With this plan |
| --- | --- | --- |
| 2 days before a booked call | Hold placed | Hold placed |
| The call ends | | The customer sees what they will be charged, and can ask for a refund for 24 hours |
| A few minutes later | **Money taken** | |
| 24 hours after the call | | Nobody asked: **money taken**. Someone asked: the host is asked to answer |
| The host answers | (a refund, fee lost) | **Money taken**: in full, less, or not at all. No fee lost |
| The hold is about to run out | | No answer yet: **money taken in full**; the request stays open |

## How much time there really is

A hold does not last long, and for a booked call the app places it 2 days ahead. From Stripe's
documentation, for a hold the app places on a saved card: **4 days and 18 hours on Visa, 7 days on
Mastercard**. For an "available now" call the customer is present when the hold is placed, and it
lasts 7 days on both. The app records the exact time Stripe gives for each hold and never guesses.

The app already has a safety rule, which stays exactly as it is: **a held payment is always settled
at least 1 day before its hold runs out.** On a Visa card and a booked call, that leaves:

| | Time after the call starts |
| --- | --- |
| The hold was placed | 2 days before |
| The customer's 24 hours end (for a 1-hour call) | 25 hours |
| The app must have taken the money (1 day before the hold runs out) | 42 hours |
| The hold runs out | 66 hours |

So on Visa the host has between 17 and 24 hours to answer, depending on how late the customer
asked. On Mastercard, and for "available now" calls, always the full 24. The request shows the
host the exact time by which their answer still costs nothing.

## What gets built

### 1. When the money is taken

For every paid call, also one with nothing wrong:
- The amount is worked out a few minutes after the call, exactly as today, from who was connected.
  It is shown to both people as "to be charged", with the time it will be taken.
- **Nobody asked within 24 hours of the call's end:** the money is taken then.
- **The customer asked:** the money waits for the host's answer (part 2).
- **Whatever is pending, the money is taken in time**: at the latest 1 day before the hold runs
  out, the existing safety rule. A hold is never left to run out because a request was open.
- A call that goes to the founder for review ("End call and report", or a record that does not add
  up) follows today's review rules, unchanged.
- A charge for cancelling late is not a call's charge and is taken as today.
- Time added during a call has its own hold and its own charge; both wait and are taken together.

### 2. Asking, and the host's answer

1. For 24 hours after the call ends, the customer sees **"Ask for a refund: connection problem"**
   on the call's results page, with room for a sentence about what went wrong. One request per
   call. Only for a paid call that took place.
2. **The host is told** by email and on the results page, together with the call's record (part
   4), and with the time by which to answer: 24 hours, or sooner when the card's hold requires it.
   One reminder is sent halfway.
3. **The host answers** with one of three:
   - **Charge in full.** The request is declined.
   - **Charge less**, with the amount.
   - **Charge nothing.**

   With any of the three the host can add **a message to the customer**, up to 300 characters:
   why, or an apology. It is optional.

   The money is then taken as answered, at once. Nothing was taken before, so there is no refund
   and no card fee lost. The customer is told the answer, with the host's message, by email and on
   the results page.
4. **If the host has not answered when the money has to be taken**, it is taken in full and the
   request stays open. The host can still answer later, with the refund form they already have; at
   that point it is a refund, and the card fee on it is lost, as today. **Until they answer, the
   host cannot collect the money for that call** (part 3).
5. **A message with every refund, also outside a request.** A host can already give back any part
   of a charge at any time before they collect it, and can type a reason. Today that reason is
   saved and the customer never sees it. It becomes "Message to the customer (optional)" and is
   shown to the customer beside the refund, and in the email about it. So every refund, in full or
   in part, asked for or not, can carry a message.
6. **The founder sees every request that is still unanswered**, oldest first, in a section of its
   own on the existing reports screen, with the call's record and its room name for LiveKit's
   dashboard. The founder can refund with the tool they already have, or close the request, which
   lets the host's payment go ahead. This is for a host who has gone silent for good.

Who may decide does not change: the host, or the founder. The rule from the payments module (the
host decides refunds) stays.

**Where a request stands.** Stored: asked; answered by the host before the money was taken (in
full, less, nothing); declined later; closed by the founder; each with who and when. **A refund
made after the money was taken is not stored on the request**: it is read from the real refund
records. A request left open at the moment of taking is **answered** when the host declines, when a
refund of that call that was started after the request has gone through (whatever the amount: it is
the host's answer; by the host or by the founder), or when the founder closes it. A refund still on
its way, or one that failed, is shown as what it is and does not count. "Answered" and "fully
refunded" are different things on the page.

The customer is told the answer in the same step that first makes the request answered, wherever
that happens. The first answer stands; a later one cannot replace it or send a second email.

### 3. The hold on a host's payment

With the money taken only after the customer's 24 hours, a host can never collect while the
customer can still ask. One case remains: the money had to be taken with a request still open. So:

- **A host's share of a call cannot be collected while that call has a request that is not
  answered.** This covers every charge of the call, also the one for added time.
- **Checked at the moment of sending**, in the same locked step that starts the transfer, with the
  request's own records locked first. A request and a collection at the same second cannot miss
  each other.
- **After the answer, the hold for the request is gone.** Each charge can then be collected once
  its own date has come (plan 14) and nothing else holds it back. An answer does not start a
  collection.
- The host's page and the founder's page show "held, waiting for the host's answer" instead of
  "ready to collect".

### 4. The app keeps a record of call quality

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
- **Keeping.** The notes are removed 60 days after the call. A short summary (the figures shown
  below) is saved with a request when it is made, and brought up to date when it is answered. This
  is a new rule for the privacy page; it is not something the app already promises.

**The record shown with a request**, to the host and the customer of that call and to the founder.
The server works out a short summary and sends only that: names as each person already knows the
other, times, plain reasons and grades. The saved messages themselves, which also hold a person's
region, are never shown.

- **From LiveKit's own messages**, which the app already saves and neither person can change: when
  each person was connected, and each time a connection ended, with what the video service
  recorded, in words that do not say whose fault it was:
  - "The connection ended from the person's own device. This also happens when the app reconnects
    by itself after a stumble."
  - "The video service reported that the connection timed out."
  - "The video service removed the person" (with the reason, where the app knows it).
  - "The video service gave no reason."
- **From the new record**, for each person, twice: as their own browser reported it and as the other
  person's browser reported it. For each: about how long at each grade, how much of the call the
  browser was reporting for, and how much is unknown. A grade is only carried forward while that
  browser kept reporting; a gap is shown as "unknown", never filled in. Where the two browsers
  differ, both are shown.

Above it, one line: "These are approximate periods put together from what each browser reported,
and from the video service's own messages. Missing reports do not show that a connection worked,
and nothing here shows whose fault a problem was or what was said or seen on the call."

### 5. Automatic refunds: not in this version

Left for later, as the founder decided. Every request, its summary and the answer are kept, so real
cases will show which patterns are clear. The points below are **limits for a future plan, not an
approved rule**:
- Narrow: a real gap in the host's presence that the video service reports as timed out, with the
  customer there, inside the call's final time.
- Never when either person has blocked the other, the call was ended with "End call and report",
  the charge was reviewed by the founder, or it is disputed with a bank.
- It could say yes. It could never say no by itself.

## What this changes for everyone, also when nothing goes wrong

- **Customers are charged a day later.** The hold shows on their card as pending for a day longer,
  and the final charge appears about a day after the call.
- **Hosts are not kept waiting longer** than plan 14 already says: their money is ready 2 days after
  the call, and by then it has been taken.
- **The room for error is smaller.** Today the money is taken minutes after a call, and the app has
  almost two days in hand before its own safety limit. With this plan a call with nobody asking
  still has about 17 hours in hand on a Visa card, and a call with a request can go right up to the
  safety limit. The limit itself, 1 day before the hold runs out, is not touched. What it means in
  practice: the always-on helper must not be down for most of a day at the wrong moment, or a hold
  could run out and that call's whole charge would be lost. The founder's reports screen will show
  any payment that is within 6 hours of its limit and still not taken.

## Smaller choices (the builder's)

| Question | Chosen | Why |
| --- | --- | --- |
| A nudge for the host | A clear time in the email, one reminder halfway, and the hold on that call's money. No automatic bad review. | Reviews come from customers. A host who was on a plane should not be marked down by a machine. If hosts still answer late, a stronger measure can follow. |
| Where requests are stored | A small table of their own, one per call, not the safety reports. | Sending a safety report also blocks the other person and counts against them. |
| Who sees the record | The two people on the call and the founder, only once a refund was asked for, and the server checks it, not just the page. | Each should see what the other sees. |
| The two short texts | The customer's sentence when asking and the host's message when answering are plain text with a length limit, each shown only to the other person and the founder. They are one note each way about one call, not a conversation: messaging was left out of the first version on purpose. The existing "Report" link on the page covers a text that breaks the rules. | The founder asked for a message with every refund. |
| Emails | To the host when a request arrives, and the one reminder; to the customer for each answer, including when the founder closes it. Each is written in the same step as the change it reports. | Through the existing email queue, so none is lost or sent twice. |
| Switching on | The new timing, asking, the hold and the founder's list go live together. A call whose money was already taken under the old timing is not touched. | Any one without the others would leave a gap. |

## What is left out, on purpose

- **Automatic refunds, and automatic refusals.**
- **Changing what a booked call charges.**
- **Passing a "no" on to Connect** (the founder's decision, for now). A customer who disagrees can
  still write to support.
- **Waiting for the host beyond what the hold allows.** A hold cannot be made longer for this kind
  of payment.
- **A refund after the host has collected.** The refund tool cannot do it, for anyone, and the app
  has no way to take a payment back from a host.
- **Reading LiveKit's stored charts from the app.** It needs the expensive plan.
- **The connection check before a call** (plan 12) plays no part here.

## What it costs

It uses the services the app already has, and no paid plan. The card fee is no longer lost when the
host answers before the money is taken. It is still lost on a refund made after that.

## What the terms and privacy page must say (for the lawyer)

That the charge for a call is taken about a day after it; that a customer can ask for a refund for
a connection problem within 24 hours of the call; that the host decides; that a host cannot collect
the money for a call with a request they have not answered; and that the app keeps a grade of each
person's connection during a call for 60 days and shows a summary to the two people and to Connect
when a refund is asked for.

## How it will be checked

- Automatic tests for the timing rule: when the money is taken with nobody asking, with a request
  answered early, answered late, and never answered; on a hold of 4 days 18 hours and of 7 days; a
  customer who asks in the last minute; the safety limit is never passed; a hold whose end Stripe
  did not give.
- Automatic tests for the record: saved messages into connected periods and neutral reasons; notes
  into "about how long at each grade", with missing, late, repeated and out-of-order notes.
- The payments, booking, added-time and whole-journey scripts, which today expect the money to be
  taken minutes after a call: changed for the new timing.
- A new check script against the Stripe sandbox: who may ask and when; the host's three answers,
  each taking exactly that amount once, with Stripe's fee only on what was taken; no answer, then
  taken in full; a late decline, a late refund in full and in part, one on its way and one that
  failed, a refund started before the request, the founder's refund and the founder closing; two
  answers at once; a call with added time; a call in review; the hold on collecting and its
  release; what each person and the founder can see; notes refused from someone not on the call,
  outside its time, about anyone else, from another site, or beyond that person's limit.
- By hand, with two browsers against the real video service: grades arriving, a deliberately
  limited connection, closing a tab in the middle, and a request from asking to the charge.

**What the checks cannot cover, and a friend test must:** what the grades and the reasons look like
on a call with a truly bad connection, and a real Visa card's hold from start to finish.

## Order of work, in small steps

1. Collecting the grades. Nothing visible.
2. The timing rule, with tests, and the money taken by it (behind a switch that is off).
3. Asking; the host's three answers; the reminder.
4. The hold on collecting; the founder's list; the late answer.
5. The record shown with a request.
6. The check scripts; every check; switch on; the two reviews; the pull request.

Size: about eight days of building, plus the reviews.

## Astra's checks

**First version: rework.** It refunded automatically when the saved messages showed the host had
dropped out. The saved reason shows how a connection ended, not whose fault it was; a customer can
stretch a gap by blocking the host; a whole-call refund for two stumbles gives back money for time
that worked; a request must not be built on the safety reports; two browsers agreeing is not proof.
Result: automatic refunds wait, and the record is shown to people instead of deciding.

**Third version: approve with changes.** The by-hand flow was found sound. Taken: say exactly when
asking is possible; "answered" and "fully refunded" are different; keep both when a browser saw a
grade and when the note arrived; notes only on change cannot give durations; spell out what the
server checks; neutral wording for why a connection ended; only a short summary reaches the page.

**Fifth version: approve with changes.** About the payment timing of that version (money taken
minutes after a call, a refund afterwards). Taken and still true here: a hold on collecting must be
checked in the same locked step that starts a transfer; an answer must be exact; tell the customer
also when the answer comes later; the founder's list is read on its own; save the summary when the
request is made. Its point that a call with two charges could be paid out before the customer could
ask no longer arises: nothing is taken until the customer's time is over.

**Seventh version** (this one: the money is taken after the customer's 24 hours and the host's
answer): see below.
