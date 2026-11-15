# Plan 13: Refund requests, taking the money later, and a record of call quality

**Status:** plan, ninth version (16 November 2026). Not built. Astra has checked earlier versions
five times; what it found is at the end. This version follows the founder's decision on timing (24
hours, or up to 48 with a request, and never later than 12 hours before a card's hold ends) and
works in Astra's fifth check, which found the design reasonable and asked for the rules below to be
made exact before anything is built.

## What this is, and why

The founder's concern: when a call goes badly, the customer should be able to ask for their money
back, a request that is not true should not succeed, the founder should not have to sort out every
case by hand, and Connect should not lose the card fee on every refund.

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
| How long a customer has to ask | **24 hours** after the call ends. |
| The reason | The customer picks one: **"The connection was bad"** or **"Something else"**. |
| Who answers | **The host**, within **24 hours**, with a message if they like. They can charge in full, less, or nothing. Passing a "no" on to Connect is left out for now. |
| When the money is taken | **24 hours after the call** when nobody asked. With a request: **when the host answers, and at the latest 24 hours after the request**, so up to 48 hours after the call. |
| The safety limit | **Never later than 12 hours before the card's hold ends.** |
| If the host has not answered by then | The money is taken in full. **The host cannot collect that call's money until they answer.** Nothing is refunded or refused automatically. |
| A record of call quality | **Collected for every call.** Shown only for a request about the connection: to the customer before they confirm, then to the host. The founder can see it for any request. |
| Refunding automatically | **Later**, once real calls show what good and bad calls look like in that record. |
| How hosts are paid | They collect their earnings themselves, from 2 days after a call. See plan 14. |
| Paying LiveKit for its $500-a-month plan | **Not now.** Nothing in this plan needs it. |

## The idea in one picture

A card payment has two steps. First the bank **holds** the money on the customer's card; nothing
has moved. Later the app **takes** what is owed and the rest of the hold is released. Stripe charges
its fee only on money that is taken. Lowering or dropping a charge before it is taken costs nothing;
Stripe's own guidance recommends exactly this to cut the cost of refunds.

| Moment | Today | With this plan |
| --- | --- | --- |
| 2 days before a booked call | Hold placed | Hold placed |
| The call ends | | The customer sees what they will be charged, and can ask for a refund for 24 hours |
| A few minutes later | **Money taken** | |
| 24 hours after the call | | Nobody asked: **money taken** |
| The customer asked | | The host is told at once and has 24 hours |
| The host answers | (a refund, fee lost) | **Money taken at once**: in full, less, or not at all. No fee lost on what is not taken |
| 24 hours after the request, no answer | | **Money taken in full**; the request stays open |

## How much time there is

The clock that matters is the hold's. For a booked call the app places the hold itself, on the saved
card, 2 days before the call starts, and from Stripe's documentation such a hold lasts **4 days and
18 hours on Visa, and 7 days on Mastercard, American Express and Discover**. So when a call starts,
2 days of a Visa hold are already used. A call can also grow: time can be added during it, up to six
hours in all, and the hold's clock does not stop for that.

On a Visa card, hours of hold left:

| Moment | A one-hour call | A call extended to six hours |
| --- | --- | --- |
| The call ends | 65 | 60 |
| 24 hours later (no request: money taken) | 41 | 36 |
| 48 hours later (the host's time is up: money taken) | 17 | 12 |
| The 12-hour safety limit | reached 5 hours later | reached at that moment |

So the plan fits on every card and every length of call Stripe documents. The 12-hour limit is
only reached by the very longest calls on Visa, when the customer also asked at the last moment;
the host then has a few minutes less than 24 hours. On the other three cards there are days to
spare.

**When Stripe does not say when a hold ends.** This is rare. The app then assumes 4 days, to be
safe, counted from when the hold was placed. The customer's 24 hours still fit in full. What gets
shorter is the host's time to answer before the money has to be taken: about 11 hours after a
one-hour call, about 6 after a six-hour call, when the customer asked at the last moment. An answer
after that is a refund, as today. The page always shows the host the real time by which their
answer still costs nothing; it never promises 24 hours it cannot give.

## What gets built

### 1. When the money is taken

For every paid call that took place, also one with nothing wrong:
- **The amount** is worked out a few minutes after the call, as today, from who was connected. It
  is shown to both people as "to be charged", with the time it will be taken. It is worked out
  again at the moment of taking, from the record as it then stands.
- **No request within 24 hours of the call's end:** the money is taken 10 minutes after that.
- **A request:** the money waits for the host's answer (part 2). The host can answer until 24
  hours after the request; the money is taken 10 minutes after that.
- **Never later than 12 hours before the hold ends.** In full: the money is taken at the planned
  moment above or 12 hours before the hold ends, whichever comes first, and the host's deadline is
  always 10 minutes before the money is taken. If that moment is missed (the helper was down,
  Stripe did not answer), the app keeps trying for as long as the hold lasts. An attempt whose
  answer was lost is checked with Stripe before anything is tried again, as today.
- **The 10 minutes** (the founder's point) are so that a request or an answer sent in the last
  seconds, on a slow connection, still arrives before anything is taken. Each person is shown
  their own deadline, on the app's clock.
- "The call's end" is the end after any added time. A room that closed late, or a record that
  arrived late, does not move it.
- **Time added during a call** has its own hold and its own charge. The ordinary charges of a call
  share one planned moment, decided by the earliest limit among them, and each is then carried out
  as its own payment.

**What comes first when a call is not ordinary.** These rules are per charge, and none of them is
new: they are today's rules, which the later timing must not bend.
- **Before any money is taken, the record is looked at again.** A record that was fine after the
  call but no longer adds up goes to the founder for review. A host's answer that was already
  given cannot override that.
- **A charge under the founder's review is never taken automatically.** The founder decides within
  today's limit (3 days after the call, and a full day before the hold ends); if nobody decides,
  the hold is released and nothing is charged. A refund request does not change that limit or
  start a new one.
- **A record that is not complete** (the room not confirmed closed, messages still missing) is
  never charged on a guess. If it is still not complete at today's limit, the hold is released, as
  today.
- **Each charge on its own.** A call's own charge can be ordinary and follow the timing above while
  the charge for added time waits for review.
- When a hold is released while a request is open, the request shows "nothing was charged" for
  that charge, once the release is confirmed. It is not shown as the host's answer.
- **A charge for cancelling late** is not a call's charge and is taken at once, as today.

### 2. Asking, and the host's answer

1. For 24 hours after the call ends, the customer sees **"Ask for a refund"** on the call's results
   page. One request per call. For a paid call that took place; it does not depend on the record
   being final or on anything having been taken yet. The customer picks a reason:
   - **"The connection was bad."** Before anything is sent, the page shows the customer the call's
     quality record (part 4), with its plain warning about what the record is and is not. Only
     then can they press "Send request", with room for a sentence about what went wrong. A
     customer who sees that the trouble was on their own side may decide not to ask.
   - **"Something else."** A sentence saying what is required. No record is shown.
2. **The host is told at once**, by email and on the results page, with the customer's reason and
   sentence, and the exact time by which their answer still costs nothing: 24 hours after the
   request, or sooner if the hold requires it. **The quality record is shown to the host only when
   the reason is the connection**, and it is the same record the customer saw. One reminder is
   sent halfway.
3. **The host answers** for each charge of the call. Most calls have one; a call with time added has
   one more for each addition, and the page lists them. For each: **charge in full**, **charge
   less**, or **charge nothing**. With the answer the host can add **a message to the customer**,
   up to 300 characters. What each means exactly:
   - *In full* is the amount the call's record gives when the money is taken, never the larger
     amount that was held.
   - *Less* is the most the customer will pay for that charge. If the record, looked at again,
     gives a lower amount, the lower one is taken.
   - A card cannot be charged under 50 cents. An amount from 1 to 49 cents is not accepted; the
     page offers "charge nothing" instead. It is never rounded up.
   - A charge whose record already gives nothing is simply released; the host is not asked about
     it.
4. **The answer is saved first, then carried out.** In one locked step for that call, the app
   writes down the answer, who gave it, the message and the amounts, together with the exact
   instruction for each payment, and only then asks Stripe. The automatic taking of money goes
   through the same locked step and reads what is there.
   - **Who wins when both arrive together** is decided by which instruction was written down
     first. If the automatic taking was written first, it is carried out as written, also when
     Stripe has not answered yet; the host's answer then counts as a late answer and becomes a
     refund once the charge is confirmed. If the host's answer was written first, that is what is
     carried out, also after a crash, and the app never falls back to "in full".
   - **The order of locks** is the same everywhere, so two steps can never block each other for
     good: the host's collection (plan 14) first, then the call, then its payments, then the
     request and refund records. A step that does not need one of them skips it; none takes them
     in another order. Stripe is only ever asked after the locked step has ended.
   - Until the money has moved, the page says the answer is "being applied", and **the whole call
     stays held from collection**, so that one charge cannot be collected while another is still
     being adjusted.
   - The customer is told the answer, with the message, by email and on the page, in the step that
     completes it, also when that happens later while the helper finishes a payment.
5. **If the host has not answered in time**, the money is taken in full and the request stays open.
   The host can still answer later with the refund form they already have; that is then a refund,
   and the card fee on it is lost, as today. **Until they answer, the host cannot collect the money
   for that call** (part 3).
6. **A message with every refund, also outside a request.** A host can already give back any part
   of a charge before they collect it, and can type a reason. Today that reason is saved and the
   customer never sees it. It becomes "Message to the customer (optional)" and is shown to the
   customer beside the refund, and in the email about it.
7. **The founder** sees every request that is still unanswered, oldest first, in a section of its
   own on the existing reports screen, with the reason, the record and the call's room name for
   LiveKit's dashboard. The founder can give the answer in the host's place before the money is
   taken (a step of its own: the founder's existing tool for charging is only for calls under
   review and keeps its rules), refund with the existing tool afterwards, or close the request, which lets the host's
   payment go ahead. This is for a host who has gone silent for good.

Who may decide does not change: the host, or the founder.

**Where a request stands.** Stored: asked (with the reason); answered before the money was taken
(with the amounts); declined later; closed by the founder; each with who and when. **A refund made
after the money was taken is not stored on the request**: it is read from the real refund records.
A request left open at the moment of taking is **answered** when the host declines, when a refund
of that call that was started after the request has gone through (whatever the amount; by the host
or by the founder), or when the founder closes it. A refund still on its way, or one that failed,
is shown as what it is and does not count. "Answered" and "fully refunded" are different things on
the page. The first answer stands; a later one cannot replace it or send a second email.

### 3. The hold on a host's payment

- **A host's share of a call cannot be collected while that call has a request that is not
  answered.** This covers every charge of the call.
- **Checked at the moment of sending**, in the same locked step that starts the transfer.
- **After the answer, the hold for the request is gone.** Each charge can then be collected once it
  is 48 hours since the call ended, the charge has been recorded, and nothing else holds it back
  (plan 14). With a request that ran its full time, the charge is only taken about 48 hours after
  the call, so that money is ready a little later than 2 days, and not before the host has
  answered.
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
  below) is saved with a request when it is made, brought up to date when it is answered, and
  kept for one year. This
  is a new rule for the privacy page; it is not something the app already promises.

**The record of one call**, and exactly who may open it. The server enforces this; hiding it on the
page is not enough.
- **The customer of that call**, while they can still ask (inside their 24 hours, no request made
  yet), when they choose "the connection was bad": they see it before they confirm.
- **After a request is made:** the customer and the host of that call, only if the saved reason is
  the connection. With "something else", neither sees it.
- **The founder**, with the full admin login, for any call that has a request.
- **Nobody else, and nobody for a call without a request**, apart from the customer's look before
  asking.

The founder decided this after first choosing "host and founder only": letting the customer see it
first is meant to stop requests that the record does not support. One consequence is accepted, not
built around: a customer can open the form after any call, look at the record, and not send. The
record holds only grades, times and neutral reasons, so this shows them nothing sensitive.

The server works out a short summary and sends only that: names as each person already knows the
other (a host by their page name), times, plain reasons and grades. It is never stored by a browser
or a network in between. The saved messages themselves, which also hold a person's region, are
never shown. When no notes arrived at all, the page says "No connection reports; quality unknown",
still shows what the video service's own messages say, and still lets the customer ask.

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

- **Customers are charged a day later.** The hold shows on their card as pending for a day longer.
- **Hosts** can still collect 2 days after a call. With a request that the host answers late, a
  little later.
- **The room for error is smaller, and this is the price of the plan.** Hours of hold left on a Visa
  card, one-hour call, when the money is taken:

  | | Hours left |
  | --- | --- |
  | Today, minutes after the call | 65 |
  | With this plan, nobody asked | 41 |
  | With this plan, a request the host did not answer | 17 (12 after a six-hour call) |

  If the money is not taken before a hold ends, that call's whole charge is lost, and under the
  payments decisions Connect then pays the host. So two things are part of this plan, not extras:
  - **The app keeps trying** from the planned moment until the hold ends.
  - **An alarm that does not depend on the helper.** The helper notes the time each time it
    finishes its round of payment work. The app has a fixed address that answers "healthy" or "not
    healthy" and nothing else: no amounts, names, numbers or error text, and it is never stored by
    a browser or a network in between. It answers "not healthy" when:
    - the helper's last finished round of payment work is more than 10 minutes old;
    - an ordinary charge is more than 5 minutes past the moment it should have been taken or
      released;
    - a payment that was started has had no answer for more than 5 minutes after the app's usual
      check with Stripe;
    - an answer was accepted and nothing was started for it within 5 minutes.

    A charge waiting for the founder's review does not count as late, and neither does an answer
    that has only just begun to be applied. An outside watching service, chosen with the hosting,
    calls that address every few minutes, treats no reply as "not healthy", and alerts the founder
    by email or text. It must be running before the new timing is switched on. A warning on the
    admin page alone would not be seen in time.

## Smaller choices (the builder's)

| Question | Chosen | Why |
| --- | --- | --- |
| A nudge for the host | The exact time in the email, one reminder halfway, and the hold on that call's money. No automatic bad review. | Reviews come from customers. A host who was on a plane should not be marked down by a machine. |
| One answer or one per charge | One per charge, listed on the page. | Each charge is its own payment at Stripe. An answer for each needs no rule for splitting an amount, and most calls have only one. |
| A reduced charge and the fees | Worked out as for any charge of that size: Connect's fee and the host's share follow the amount taken. | It is the rule every charge already uses. |
| Where requests are stored | A small table of their own, one per call, not the safety reports. | Sending a safety report also blocks the other person and counts against them. |
| Who sees the record | For a request about the connection: the customer before confirming, then the host. The founder for any request. Nobody otherwise. The server checks this, not just the page. | The founder's decision. |
| The two short texts | The customer's sentence and the host's message are plain text with a length limit, each shown only to the other person and the founder. One note each way about one call, not a conversation. The existing "Report" link covers a text that breaks the rules. | The founder asked for a message with every refund. |
| Emails | To the host when a request arrives, and the one reminder; to the customer for each answer, including when the founder closes it. Each is written in the same step that completes the change it reports, also when that happens later while the helper finishes a payment. | Through the existing email queue, so none is lost or sent twice. |
| Switching on | The new timing, asking, the hold and the founder's list go live together. A call whose money was already taken under the old timing is not touched. | Any one without the others would leave a gap. |

## What is left out, on purpose

- **Automatic refunds, and automatic refusals.**
- **Changing what a booked call charges.**
- **Passing a "no" on to Connect** (the founder's decision, for now).
- **Waiting for the host beyond 24 hours, or past the safety limit.**
- **A refund after the host has collected.** The refund tool cannot do it, for anyone, and the app
  has no way to take a payment back from a host.
- **Reading LiveKit's stored charts from the app.** It needs the expensive plan.
- **The connection check before a call** (plan 12) plays no part here.

## What people are shown about the money

- **The receipt** on the results page says what happened in plain words: "to be charged" with the
  time, then "charged". A charge the host lowered says so ("charged $10.00 of $20.00, lowered by
  the host"), so it is never mistaken for what the call's record gave.
- **The founder's page** lists, on its own and not only among the latest payments: requests waiting
  for an answer, and money still on hold with the time it is due to be taken.

## What it saves and what it costs

On Stripe's standard US price (2.9% plus 30 cents, to be confirmed in the founder's account): a
$20 charge not taken at all saves 88 cents; a $100 charge not taken saves $3.20; taking $50 where
$100 was worked out saves $1.45. Nothing is saved on a refund made after the money was taken.

It uses the services the app already has, and no paid plan. The price is the smaller room for
error described above, and about ten days of building.

## What the terms and privacy page must say (for the lawyer)

That the charge for a call is taken one to two days after it; that a customer can ask for a refund
within 24 hours of the call; that the host decides; that a host cannot collect the money for a call
with a request they have not answered; and that the app keeps a grade of each person's connection
during a call for 60 days, shows a summary to a customer who asks for a refund because of the
connection, to the host of that call and to Connect, and keeps that summary for a year.

## How it will be checked

- Automatic tests for the timing rule: when the money is taken with nobody asking, with a request
  answered early, answered late, and never answered; on a hold of 4 days 18 hours, of 7 days, and
  one whose end Stripe did not give; a one-hour and a six-hour call; a customer who asks in the
  last minute; the 12-hour limit is never passed by plan, and the retries stop when the hold ends.
- Automatic tests for the record: saved messages into connected periods and neutral reasons; notes
  into "about how long at each grade", with missing, late, repeated and out-of-order notes.
- The payments, booking, added-time and whole-journey scripts, which today expect the money to be
  taken minutes after a call, changed for the new timing. Not by moving every clock a day: with the
  cases that are new. Late cancellations must still be charged at once.
- A new check script against the Stripe sandbox: who may ask and when; the two reasons; the host's
  three answers on a call with one charge and on a call with added time, each taking exactly that
  amount once; an answer and the 24-hour moment at the same instant; a crash after the answer was
  saved; one charge through and one whose answer from Stripe was lost; no answer, then taken in
  full; a late decline, a late refund in full and in part, one on its way and one that failed, a
  refund started before the request, the founder answering in the host's place, refunding and
  closing; a call under review with a request open, released when nobody decides; the hold on
  collecting and its release; who can see the record; the "not healthy" answer when the helper has
  stopped and when a payment is overdue; notes refused from someone not on the call, outside its
  time, about anyone else, from another site, or beyond that person's limit.
- By hand, with two browsers against the real video service: grades arriving, a deliberately
  limited connection, closing a tab in the middle, and a request from asking to the charge.

**What the checks cannot cover, and a friend test must:** what the grades and the reasons look like
on a call with a truly bad connection, and a real Visa card's hold from start to finish. Stripe's
sandbox shows amounts and steps; it does not show the real fee or a real bank's behaviour.

## Order of work, in small steps

0. Before any of it: a dated entry in `docs/module-record.md` for the changed decisions (when the
   money is taken; the 12-hour limit for ordinary charges; a customer can ask).
1. Collecting the grades. Nothing visible.
2. The helper's heartbeat and the "not healthy" address.
3. The timing rule, with tests, and the money taken by it (behind a switch that is off).
4. Asking; the host's answers; the saved answer carried out; the reminder.
5. The hold on collecting; the founder's list and the founder's answer; the late answer.
6. The record shown with a request.
7. The check scripts; every check; switch on; the two reviews; the pull request.

Size: about ten days of building, plus the reviews.

## Astra's checks

**First version: rework.** It refunded automatically when the saved messages showed the host had
dropped out. The saved reason shows how a connection ended, not whose fault it was; a customer can
stretch a gap by blocking the host; a request must not be built on the safety reports; two browsers
agreeing is not proof. Result: automatic refunds wait, and the record is shown to people.

**Third version: approve with changes.** The by-hand flow was found sound. Taken: "answered" and
"fully refunded" are different; keep both when a browser saw a grade and when the note arrived;
notes only on change cannot give durations; what the server checks; neutral wording for why a
connection ended; only a short summary reaches the page.

**Fifth version: approve with changes.** Taken and still true: the hold on collecting is checked
in the same locked step that starts a transfer; an answer must be exact; tell the customer also
when the answer comes later; the founder's list is read on its own; save the summary when the
request is made.

**Seventh version (the money taken later): rework.** The saving was confirmed as real. Twelve
points; what was done:
1. "The existing safety rule is untouched" was not accurate, and a call under review must never be
   charged automatically. (Calls under review keep today's rules exactly. For ordinary calls the
   founder then chose a limit of 12 hours.)
2. The hours were right for a one-hour call only: added time shortens them, and when Stripe gives no
   end for a hold the customer's 24 hours did not fit. (The table now shows both lengths; the case
   without an end is named, with what happens.)
3. Say honestly how much smaller the margin is, and what happens after a missed moment. (The table
   under "What this changes"; the app keeps trying; an alarm that does not depend on the helper.)
4. "Charge less" was not exact for a call with several charges. (One answer per charge; at least 50
   cents or nothing.)
5. An answer must survive a crash and a race with the automatic taking. (Saved first under one
   lock, then carried out; never replaced by "in full".) The founder needs a way to answer before
   the money is taken. (Added.)
6. The timing promises contradicted each other. (The host is told at once; an early answer takes
   the money at once; the times are stated once.)
7. The amount shown after the call must be worked out again when the money is taken. (Stated.)
8. "Ready after 2 days" needed qualifying. (Stated in part 3 and in plan 14.)
9. Say exactly what is saved. ("What it saves and what it costs".)
10. Ratings, late cancellations and the booking rules do not depend on when the money is taken;
    the admin page, the emails and the check scripts do. (In the checks.)
11. Its judgment: worth doing for the customer's sake; the fee alone would not justify it. It
    offered a smaller version, always taking the money 24 hours after the call. (The founder chose
    to give the host the full 24 hours instead, with the 12-hour limit and the alarm.)
12. The quality record is reasonable. It was checked when only the host and founder could see it;
    the founder has since decided the customer sees it first for a connection request. Say how
    long the saved summary is kept. (One year.)

**Eighth version (the founder's timing): rework, with the closing judgment "safe enough to build
after the must items are incorporated", and nothing to remove as over-built.** Ten points; what
was done in this ninth version:
1. The 10 minutes after a deadline pushed the longest Visa call 9 minutes past the 12-hour limit.
   (The money is taken at the planned moment or 12 hours before the hold ends, whichever is first;
   the host's deadline is 10 minutes before that.)
2. "Calls under review are unchanged" needed exact rules for a record that changes before the money
   is taken, one that is not complete, and a call whose charges differ. (The list "What comes
   first when a call is not ordinary".)
3. Saving an answer under one lock was a promise without the mechanics. (Who wins is the
   instruction written down first; one fixed order of locks; the whole call stays held from
   collection while an answer is being applied.)
4. What "in full" and "less" mean when the record is looked at again; under 50 cents; a charge that
   is already nothing. (Stated in part 2, step 3. The founder's answer is a step of its own.)
5. The alarm needed an exact meaning of "late" that does not fire for calls under review or for an
   answer just being applied. (The four conditions; the address says only healthy or not.)
6. Letting the customer look first contradicted "nobody without a request". (Who may open the
   record is now a list; that a customer can look and not send is stated and accepted.)
7. When Stripe gives no end for a hold, the customer's 24 hours still fit; only the host's time
   shrinks. (Corrected.)
8. Plan 14 understated how late a charge can be recorded; the receipt and the founder's page need
   words for a lowered charge. (Both added.)
9. The table of hours was confirmed correct, as were the savings.
10. Nothing over-built.
