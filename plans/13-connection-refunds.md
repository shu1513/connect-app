# Plan 13: When a call goes badly because of the connection

**Status:** plan, second version (16 November 2026). Not built. Astra checked the first version and
asked for a rework; its points are worked in and listed at the end. **Two decisions by the founder
are needed before this can be finished and checked again.** They are at the top.

## What this is, and why

The founder's concern: when a call goes badly because of the host's internet, the customer should
not lose money, the founder should not have to sort it out by hand, and a request that is not true
should not succeed.

Two facts about the app today make this real:
- **A customer cannot ask for a refund at all.** Only the host, or the founder, can start one.
- **On a booked call the customer pays for the time the host is in the room**, not for the time the
  two are together. So a customer who gives up on a bad call after five minutes keeps paying for as
  long as the host stays in the room, and the host is the one who decides whether to give it back.

## Decision 1 (first, because it decides how much of the rest is needed): what a booked call charges

| | **A. As today: the host's time in the room** | **B. Only the time the two are together** |
| --- | --- | --- |
| The customer leaves early | Pays for as long as the host stays in the room afterwards. | Stops paying when they leave. |
| The customer is late | Pays for the time the host waited. | Pays only from when they arrive. |
| The customer never shows up | Pays for the time the host waited. | Would pay nothing, unless the no-show rule below is kept. |
| The host leaves early, is late or does not show | Not charged. | Not charged. |
| A bad connection | The customer needs a refund to get money back. | The customer leaves and stops paying. Only the minutes together are in question. |
| Who carries the risk of unused time | The customer. | The host. |

"Available now" calls already charge by B.

**The builder's view, changed after working this plan through.** Rule A was chosen so that a host who
kept the time free is paid. It has two side effects that were not clear then. A host is only paid
for the rest of the time by sitting in an empty room after the customer has gone. And "I left after
five minutes and was charged for the hour" is exactly the complaint, and the kind of card dispute,
this plan is trying to avoid. Astra's check (below) showed that the app cannot reliably repair that
afterwards with automatic refunds.

So the recommendation is **B, with one protection kept from A: a customer who never joins at all
pays for the time the host waited**, as today. That keeps a booking from being free to ignore. Its
cost: a customer who is late, or leaves early, pays less than the host kept free, and someone could
join for a moment to avoid the no-show charge. A small minimum charge could close that later.

This is the founder's decision. It was agreed the other way in the payments module, and hosts are
the ones who lose under B.

## Decision 2: asking for a refund

Whatever is decided above, a customer needs a way to ask. Recommended, and small:

1. On a call's results page, once the charge is final, the customer gets **"Ask for a refund:
   connection problem"**. One request per call, within 3 days of the call.
2. **The request goes to the host**, by email and on the results page, together with the call's own
   record: when each person was connected, when they dropped out, and what the video service gave
   as the reason. The host refunds with the form they already have, any amount, or declines.
3. **If the host declines, or says nothing for 3 days**, the customer can pass it to Connect with
   one press. The founder sees it on the existing reports screen, with the same record and the name
   of the call's room for looking it up in LiveKit's dashboard.

The founder only sees the cases still in dispute. Under rule B there should be few, and small.

## Decision 3: should the app ever refund by itself?

The first version of this plan said yes, when the saved record shows the host dropped out. Astra's
check found that this stands on weaker ground than it looked:

- **The record says why a connection ended, not whose fault it was.** After a network failure the
  video toolkit often reconnects by itself, and that can be recorded as the person having left by
  choice. So many real failures would be missed.
- **A person can bend it.** A customer can block the host after a short stumble so the host cannot
  get back in, which would make a brief gap look long. A host can leave tidily to avoid it.
- **"Refund the whole call" is harsh on a long call that mostly worked.** The time a host is
  disconnected is already not charged.
- **It can only say yes, never no.** Nothing the app keeps can show that the host's side was fine.

**Recommended: not in the first version.** Under rule B the money at stake is small, and the host
answers first. If it is wanted later, it would be narrow and switched off until proven on real
calls: only a host connection that the video service itself reports as timed out, a real gap in
the host's presence while the customer was there, never when either person has blocked the other,
never for a charge the founder has already reviewed, and only for the part of the call after the
first drop-out.

## A record of call quality

LiveKit works out a grade for each person's connection during a call (excellent, good, poor, lost)
and sends it to both browsers. The app could save those, a few words each time one changes, with
nothing shown on screen. That would be the app's own record of call quality.

**Recommended: collect it with the first version, and only show it** to the host and the founder
when a refund is asked for. It is not proof, because it comes from the two people's browsers and
either could alter or withhold their own. So it is shown as "what each browser reported", never
used to refund or refuse by itself. After real calls it will be clear whether it is dependable
enough for more.

## What was checked about LiveKit

| Possible source of a record | What was found | Usable by the app? |
| --- | --- | --- |
| LiveKit's dashboard | Seen with the founder's login on today's plan: for every person in every call, charts over time of picture rate, sending rate and loss. | By hand only. |
| LiveKit's newer interface ("Cloud API", beta) | From its documentation: no quality per person, only one line for the whole call. It signs in as a person with a pass that runs out after about 30 days and cannot be renewed by a program. | No. |
| LiveKit's older interface ("Analytics API") | For programs, but only on the plan at about $500 a month. | Not now (founder's decision). |
| What the app already saves | Every connect and leave message from LiveKit, whole, including the reason each connection ended. Checked in the saved messages of real calls. | Yes, as a record to show. Not strong enough to refund on by itself. |
| The grade LiveKit sends during a call | Reaches both browsers for both people. LiveKit keeps no history the app can ask for. | Yes, if the app saves it (see above). |

None of this needs a paid plan.

## What gets built, if the recommendations are taken

**The charging rule** (decision 1, B): booked calls count the time together. A booked call the
customer never joined keeps today's count of the host's waiting time. The words on the booking
page, the emails, the receipt and the terms change to match. Calls already booked keep the rule
they were booked under: each call already carries its own rule.

**Refund requests** (decision 2): one small table of its own. It is not built on the safety
reports, because sending a report also blocks the other person and counts against them. The host's
existing refund form stays as it is; the request only adds "Decline". Where a request stands is
read from the real refund records, so a refund the host makes by hand also settles the request.

**The record shown with a request:** connected periods and drop-outs from the saved messages, with
the reason in plain words; and the grades, once collected.

**Collecting the grades:** one small table; the call screen sends a few words when a grade changes;
nothing on screen.

**The founder's reports screen** shows requests passed on, with the room name.

## What is left out, on purpose

- **Automatic refunds** (decision 3).
- **Refusing a request automatically.** The app cannot know enough to say no by itself.
- **Reading LiveKit's stored charts from the app.** It needs the expensive plan.
- **A refund after the host has been paid.** The existing refund tool cannot do it, for anyone.
  Requests close 3 days after the call, well before the earliest payday; a later case is handled by
  the founder outside the app, as decided in the payments module.

## What it costs

Nothing to run. One thing to know: when a card payment is refunded, the card company's fee for the
original payment is not given back. Today that falls on Connect's side of a refund, and the same
would be true here.

## What the terms must say (for the lawyer)

What a booked call charges, if it changes; that a customer can ask for a refund for a connection
problem within 3 days; that the host answers first and Connect can decide if they disagree; and
that the app keeps a grade of each person's connection during a call.

## How it will be checked

- Automatic tests for the new counting rule, including late arrival, leaving early, coming back, a
  customer who never joins, and time added during a call.
- The payments, booking and whole-journey scripts updated for the new rule; a new script for
  requests: who may ask and when, one per call, the host's answers, passing it on, the 3 days, what
  each person can see.
- By hand in a browser, and one real two-person call with a deliberately bad connection to see what
  the record and the grades show.

## Order of work, once decided

1. The charging rule and its wording (if B).
2. Refund requests: asking, the host's answer, passing it on.
3. The record shown with a request; collecting the grades.
4. The check scripts; every check; the two reviews; the pull request.

Size: about a week of building in all, plus the reviews. Decision 1 alone is about two days.

## Astra's check of the first version (16 November 2026)

Verdict: **rework.** Thirteen points. The main ones, and what was done:

| Astra's point | Done |
| --- | --- |
| The saved reason shows how a connection ended, not that the host's internet failed or whose fault it was; a reconnect after a failure can be recorded as leaving by choice. | Automatic refunds are no longer in the first version. The record is shown to people instead. |
| "Dropped out twice" must be worked out from real gaps in presence, with the customer there, inside the call's final time. | Kept as a condition for any later automatic rule. |
| A customer can stretch a short gap by blocking the host. | Named as an exclusion for any later automatic rule. |
| Refunding a whole call with time added means several payments, each with its own record; a refund can also be pending or fail. | Avoided for now: the host's existing form makes refunds, and a request's state is read from the real refund records. |
| A charge the founder already reviewed must not be overturned automatically. | Named as an exclusion. |
| An automatic refund needs an honest record of who decided. | Not needed while people decide. |
| Right after a call the charge is not final yet. | The button appears once the charge is final. |
| Three days is before payday, but a slow answer can run up to it; after payday nobody can refund in the app. | Stated in "What is left out". |
| Refunding a whole call for two short stumbles gives back money for time that worked; card fees are not returned. | Stated; the whole-call idea is dropped. |
| The record is real but can be influenced; do not call it beyond dispute. | Wording changed. |
| Do not build requests on safety reports: a report blocks the other person. | Taken: a table of its own. |
| One friend test does not settle how failures are recorded. | Taken: a real bad-connection call is in "How it will be checked", and automation waits. |
| Leaving the grades for later is right; two browsers agreeing is not proof, and silence proves nothing. | Taken: grades are collected and shown, never decide. |
