# Plan 13: Refund requests for a connection problem, with a record of call quality

**Status:** plan, third version (16 November 2026). Not built. Astra checked the first version and
asked for a rework. This version follows the founder's decisions made since; Astra's checks are at
the end.

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
| What a booked call charges | **Stays as it is**: the time the host is in the room. (Charging only the time together was considered and not chosen.) |
| A record of call quality | **Collect it from the first version**, and show it to whoever decides a refund. |
| Refunding automatically | **Later**, once real calls show what good and bad calls look like in that record. |
| Paying LiveKit for its $500-a-month plan | **Not now.** Nothing in this plan needs it. |

## What gets built

### 1. A customer can ask for a refund

1. On a call's results page, once the charge is final, the customer sees **"Ask for a refund:
   connection problem"**. One request per call, within 3 days of the call, only for a call that was
   charged.
2. **The request goes to the host**, by email and on the results page, together with the call's
   record (part 3 below). The host refunds with the form they already have, any amount, or declines.
3. **If the host declines, or says nothing for 3 days**, the customer can pass it to Connect with
   one press. The founder sees it on the existing reports screen with the same record, and the name
   of the call's room for looking it up in LiveKit's dashboard. The founder refunds with the tool
   they already have, or closes it.

Nothing about who may make a refund changes: the host, or the founder. So the rule the founder set
in the payments module (the host decides refunds) stays. What is new is that the customer can ask,
and that a "no" can be passed on.

### 2. The app keeps a record of call quality

During a call LiveKit works out a grade for each person's connection (excellent, good, poor, lost)
and sends it to both browsers, for both people. Today the app throws it away.

- **Collecting.** While a person is in a call, their browser tells the app each time a grade
  changes: who it is about, and the grade. A few words each time, sent no more than once every few
  seconds. Nothing is shown on screen, and nothing extra travels over the video connection, so it
  does not slow the call and fits the founder's "no sign during a call".
- **Keeping.** One new table: the call, whose browser said it, who it is about, the grade, and when
  the app received it. The app accepts a report only from a person who is on that call, only while
  the call's room is open, only about the two people on it, and no more than a fixed number per
  call. Rows are removed 60 days after the call.
- **What it is, and is not.** It is LiveKit's own grade, but it reaches the app through the two
  people's browsers. Either person could alter or hold back what their own browser sends. So it is
  a record of **what each browser reported**, always shown that way, and never treated as proof.

### 3. The record shown with a request

To the host and the customer of that call, and to the founder, once a refund has been asked for:

- **From what the app already saves** (LiveKit's own messages, which neither person can change):
  when each person was connected, each time someone's connection ended, and the reason LiveKit gave,
  in plain words ("left the call", "connection timed out", "removed when the call ended").
- **From the new record:** for each person, how long their connection was graded good, poor or
  lost, shown twice: as their own browser reported it and as the other person's browser reported
  it. Where the two agree it says so; where one is missing it says "no reports".

One line says what the record is: "Drop-outs come from the video service. Grades are what each
person's browser reported. Neither shows what was said or seen on the call."

### 4. Automatic refunds: not in this version

Left for later on purpose, as the founder decided. This version is built so that it can be added:
every request, the record at the time, and what the host or founder decided are kept. After real
calls, those cases show which patterns were clear, and whether the grades can be trusted enough.

What Astra's first check already settled about any later automatic rule:
- It must be narrow: a real gap in the host's presence that LiveKit reports as a timed-out
  connection, with the customer there at the time, inside the call's final time.
- Never when either person has blocked the other, or the call was ended with "End call and report",
  or the charge was already reviewed by the founder, or is disputed with a bank.
- It can say yes. It can never say no by itself: nothing the app keeps can show that the host's side
  was fine, and two browsers agreeing is not proof.
- A refund of a whole call with time added is several payments, each with its own record.

## Smaller choices (the builder's)

| Question | Chosen | Why |
| --- | --- | --- |
| Where requests are stored | A small table of their own, not the safety reports. | Sending a safety report also blocks the other person and counts against them. Asking for a refund must do neither. |
| How a request's state is known | Asked, declined, passed on and closed are stored. "Refunded" is read from the real refund records. | A refund the host makes by hand, of any amount, then settles the request without a second record that could disagree. A part refund does not close a request: the customer can still pass it on. |
| When the button appears | Only once every charge of the call is final. Before that the page says the charge is still being worked out. | Right after a call the charge takes a couple of minutes, longer if time was added. A request must not be used up before there is anything to refund. |
| The 3 days for the host | Worked out from when the request was made. No timer job. | Nothing has to run for it; the page just shows the next step when the time has passed. |
| Who sees the quality record | The two people on the call and the founder, and only once a refund was asked for. | The customer should see what the host sees about them, and the other way round. Showing it on every call would be a new feature nobody asked for. |
| Emails | To the host when a request arrives; to the customer when the host answers; to the founder when one is passed on. | Through the existing email queue. |
| A limit | One request per call. | Requests cost the customer nothing and refund nothing by themselves, so no more is needed yet. |

## What is left out, on purpose

- **Automatic refunds, and automatic refusals** (part 4).
- **Changing what a booked call charges** (the founder's decision).
- **Reading LiveKit's stored charts from the app.** It needs the expensive plan. The founder can
  still look at them by hand in LiveKit's dashboard.
- **A refund after the host has been paid.** The existing refund tool cannot do it, for anyone.
  Requests close 3 days after the call, and the earliest payday is 7 days after it. A host's 3 days
  of silence can use that up to day 6, so the page shows the customer the date by which Connect
  must be asked. A later case is handled by the founder outside the app, as decided in the payments
  module.
- **The connection check before a call** (plan 12) plays no part here.

## What it costs

Nothing to run, and no paid plan. One thing to know: when a card payment is refunded, the card
company keeps its fee for the original payment. That is already true of every refund today.

## What the terms and privacy page must say (for the lawyer)

That a customer can ask for a refund for a connection problem within 3 days; that the host answers
first and Connect can decide if they disagree; and that the app keeps a grade of each person's
connection during a call for 60 days and shows it to the two people and to Connect when a refund is
asked for.

## How it will be checked

- Automatic tests: turning saved messages into drop-outs with plain reasons; turning grade reports
  into "how long at each grade" for each person as each browser reported it, including missing,
  repeated and out-of-order reports.
- A new check script: who may ask and when (not before the charge is final, not after 3 days, not
  twice, not for a free or uncharged call, not someone else's call); the host's refund and decline;
  passing it on; what each person and the founder can see; a refund made by hand settles the
  request; grade reports are refused from someone not on the call, outside the call's time, about
  anyone else, or beyond the limit.
- The whole-journey script and the other check scripts must still pass.
- By hand in a browser against the real video service: grades arriving from a real call in two
  browsers, and the request from asking to refund.

**What the checks cannot cover, and a friend test must:** what the grades and the drop-out reasons
look like on a call with a truly bad connection. That call is also the first piece of evidence for
deciding about automatic refunds later.

## Order of work, in small steps

1. Collecting the grades: the table, the route, the listener in the call screen. Nothing visible.
2. Asking for a refund: the table, the button, the email to the host, the host's "Decline".
3. Passing it on, and the founder's side.
4. The record shown with a request.
5. The check script; every check; the two reviews; the pull request.

Size: about four to five days of building, plus the reviews.

## Astra's checks

**First version (16 November 2026): rework.** That version refunded automatically when the saved
messages showed the host had dropped out. Thirteen points; the main ones:
- The saved reason shows how a connection ended, not whose fault it was. After a network failure the
  video toolkit often reconnects by itself, which can be recorded as leaving by choice.
- A customer can stretch a short gap by blocking the host; a host can leave tidily to avoid it.
- Refunding a whole call for two short stumbles gives back money for time that worked.
- A refund request must not be built on the safety reports: a report blocks the other person.
- Right after a call the charge is not final; after payday nobody can refund in the app.
- Two browsers agreeing about a grade is not proof, and silence proves nothing.

All are worked in: automatic refunds wait, the record is shown to people instead of deciding, and
the conditions for any later automatic rule are written down in part 4.

**Third version** (this one): see below.
