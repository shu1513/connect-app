# Plan 13: Refunds for a connection problem

**Status:** plan (16 November 2026). Not built. Astra's check is at the end.

## What this is, and why

The founder's idea: when a call goes badly because of the host's internet, the customer should get
their money back, and it should not need the founder. But a refund request can be untrue. So the app
should look at a record that neither person can change, and refund by itself only when the record
shows the problem was on the host's side.

Two things make this worth doing:
- **Today a customer cannot ask for a refund at all.** Only the host (or the founder) can start one.
- **The host is the judge of their own connection.** On a booked call the customer pays for the time
  the host is in the room. A customer who gives up on a broken call after five minutes is still
  charged for as long as the host stays, unless the host agrees to refund.

## What was checked first: where a trustworthy record can come from

| Possible source | What was found | Usable? |
| --- | --- | --- |
| **LiveKit's dashboard** | Looked at with the founder's login, on the plan in use today. For every person in every call it keeps charts over time of picture rate, sending rate and loss, and how they connected. | **By hand, yes.** The founder can look up any call. Not from the app. |
| **LiveKit's newer interface** ("Cloud API", marked beta) | Read in LiveKit's documentation. It gives, per call, who joined and left and how they connected, the list of events, and one quality line for the call as a whole. It does **not** give quality per person. And it signs in as a person, with a pass made in a browser that runs out after about 30 days and cannot be renewed by a program. LiveKit's own words: automation that runs without a person present cannot renew it. It may also change without notice. | **No.** An app cannot depend on it. |
| **LiveKit's older interface** ("Analytics API") | A program can use it, but only on the Scale plan (about $500 a month). Whether it gives quality per person could not be confirmed. | **Not now** (founder's decision on the price). |
| **What the app already keeps** | Every time someone connects to or leaves a call, LiveKit tells the app, and the app saves the whole message. Checked in the saved messages: each "left" message says **why** the connection ended, for example the person chose to leave, the app removed them at the end, or the connection timed out. | **Yes.** It comes from LiveKit's side, neither person can change it, it is already stored, and it costs nothing. |
| **The grade LiveKit sends during a call** | During a call LiveKit works out a grade for each person's connection (excellent, good, poor, lost) and sends it to both browsers. It keeps no history the app can ask for later. The app could collect it from the two browsers. | **Later, with care**: a browser's own report can be altered by its owner. |

So an automatic refund can stand on firm ground for one kind of trouble today: **the host's
connection dropping out.** A host whose picture is frozen or choppy while they stay connected leaves
no trace in what the app keeps, and that needs the second stage below.

## The proposal, in two stages

### Stage 1: ask for a refund; automatic when the host dropped out

1. On a call's results page the customer gets a button, **"Ask for a refund: connection problem"**.
2. The app reads the call's own record and decides:
   - **The host dropped out, and not by choice** (the rule is below): the whole call is refunded at
     once. Nobody has to do anything. Both people are told, with the reason.
   - **Anything else: the request goes to the host**, who can refund with the form they already
     have, or decline. The host is emailed, and the request shows on the call's results page.
   - **If the host declines or does not answer in 3 days,** the customer is told and can pass it to
     Connect with one press. It then appears on the founder's list of reports, with the name of the
     call's room so it can be looked up in LiveKit's dashboard.

This does not make every case automatic. It makes the clear ones automatic, sends the rest to the
host first, and only the ones still in dispute reach the founder.

**The rule for "the host dropped out"** (starting values, in one small file with tests):
- Only connections that ended **without the host choosing to leave** count. Leaving by pressing
  "Leave", being taken out by the app at the end, or opening the call in another tab does not count.
- Within the booked time, the host dropped out **at least twice**, or **once and stayed away for a
  minute or more**.
- The customer did not drop out at the same moments. If both vanished together, the trouble was not
  the host's alone, and the request goes to a person.

### Stage 2 (later): the grade during the call

Both browsers send the app the grade LiveKit gives each person, a few words each time it changes.
Nothing is shown on screen, so this fits the founder's "no sign during a call". A grade is believed
only where the two browsers agree. That allows two more automatic answers:
- the host's connection was poor for a good part of the call, and the customer's was not: refund;
- the host's connection was good throughout, and the customer's own was poor: no refund, and the
  customer is told what the record shows. This is what protects hosts from requests that are not
  true.

Stage 2 is left for later on purpose. It is the part with real unknowns: how quickly LiveKit's grade
follows a bad connection, and what to do when one browser says nothing. Those are best answered
after real calls. Stage 1 does not depend on it.

## Decisions for the founder

| # | Question | Recommended | Why |
| --- | --- | --- | --- |
| 1 | May the app refund a call without asking the host? | **Yes, but only when the record shows the host dropped out.** | This changes a rule the founder set (the host decides refunds). It is the point of the idea, and it is limited to evidence the host cannot dispute. |
| 2 | How much is refunded automatically? | **The whole call**, including any time added during it. | Simple, and a call broken by drop-outs was not what the customer paid for. The refund comes out of the host's share as any refund does, and Connect's fee is returned in the same proportion. |
| 3 | How long can a customer ask? | **3 days after the call.** | A refund is only possible before the host's share is paid out, which is at the earliest 7 days after the call. Three days leaves time for the host and then the founder. |
| 4 | Where do unclear requests go? | **To the host first; to the founder only if the customer passes it on.** | It keeps the founder's work to real disputes. |
| 5 | A limit against misuse | **One request per call. A customer with 3 automatic refunds in 30 days gets no more automatic ones; theirs go to a person.** | Cheap protection while the rule is new. |
| 6 | Stage 2 | **Not now.** Decide after Stage 1 has run on real calls. | It is bigger and less certain. |
| 7 | Free calls | **Nothing to do**: there is nothing to refund. | |

Nothing here costs money to run. It does change who can take money from a host's share, so **the
terms must say it, and hosts must be told**: "If your connection drops out during a call, Connect
may refund the customer." That wording is for the lawyer.

## What gets built (Stage 1)

**The rule** (`src/lib/refunds/dropouts.ts`, with tests). It takes the call's saved connect and leave
messages and answers one of: "the host dropped out", "no", or "cannot tell" (for example an old call
whose messages carry no reason). It reads the reason from the saved message itself. Only "the host
dropped out" refunds automatically.

**One new table**, `refund_requests`: the call, who asked and when, what the record showed (kept as
it was read, so the decision can be explained later), and where the request stands: refunded
automatically, waiting for the host, refunded by the host, declined, passed to Connect, closed. One
per call.

**Asking** (one server action on the results page; only the customer of that call; only a charged
call whose payment is not in review, not disputed with a bank, and not yet paid out; only within 3
days). It reads the record, saves the request, and either refunds or emails the host, all through
the code that already makes refunds, so a refund can never be made twice.

**The refund record** gets a third kind beside "host" and "admin": "automatic", with the request it
came from.

**The results page**: the button for the customer; for both people, where the request stands and,
after an automatic refund, the reason in plain words ("The host's connection dropped out 3 times
during this call"); for the host, "Decline" beside the refund form they already have; for the
customer after a decline or 3 days of silence, "Ask Connect to look at it".

**The founder's side**: such a request appears in the existing list of reports, with the call's
room name. The founder's existing refund tool does the rest.

**Emails** (through the existing queue): to the host when a request is waiting for them, and when
their call was refunded automatically; to the customer for each answer.

**The always-on helper**: after 3 days without an answer from the host, marks the request so the
customer can pass it on.

## What is left out, on purpose

- **Refunding automatically for a frozen or choppy picture.** The app has no trustworthy record of
  it yet. That is Stage 2.
- **Refusing a request automatically.** Without Stage 2 the app cannot know the host's side was
  fine, so it never says no by itself.
- **Part refunds worked out from the minutes lost.** The host can still refund any amount by hand.
- **Paying LiveKit for its older interface.** Not needed for Stage 1.
- **The connection check before a call** (plan 12) plays no part here. It is taken before the call,
  on the person's own device, and keeps nothing.

## How it will be checked

- Automatic tests for the rule: left by choice, removed by the app, another tab, timed out once
  briefly, timed out twice, away for a minute, both people gone at once, messages with no reason.
- A new check script against the Stripe sandbox: an automatic refund happens once and for the full
  amount, also when asked twice at the same moment; a request that is not clear goes to the host
  and refunds nothing; a host's refund, a decline, and passing it on; the 3 days; no request after
  the host was paid, for a free call, or by someone who was not the customer; the limit of 3.
- The whole-journey script and the other check scripts must still pass.
- By hand in a browser: the button, each state of the request, the emails.

**What must be confirmed with a real call before the rule is trusted:** which reason LiveKit
reports when a connection really fails (Wi-Fi switched off, a laptop lid closed, a phone leaving
coverage). The rule is written from LiveKit's list of reasons and from the saved messages of normal
calls; no saved call so far had a failed connection in it. One friend test with the Wi-Fi switched
off for a moment settles it. Until then the rule stays switched off.

## Order of work, in small steps

1. The rule, with tests.
2. The table; asking; the automatic refund (behind a switch that is off).
3. The host's side and the founder's side; the emails; the 3 days.
4. The check script; every check; the friend test with a real dropped connection; switch on.
5. The two reviews; the pull request.

Size: about three to four days of building, plus the reviews and the friend test.

## Questions still open

1. Which reasons a truly failed connection gives (see above).
2. Whether a short stumble that LiveKit repairs by itself, without the person leaving the room,
   appears in the saved messages at all. If not, the rule only sees longer drop-outs, which is
   acceptable for Stage 1.
3. How long LiveKit keeps its dashboard charts on the plan in use, since the founder's by-hand
   check depends on them.
