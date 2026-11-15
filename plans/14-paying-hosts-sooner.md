# Plan 14: Hosts collect their money when they want

**Status:** plan, second version (16 November 2026). Not built. The first version kept a weekly
payday; the founder then decided that hosts start the payment themselves. Astra's check of this
version is at the end.

## What this is, and why

Today a host's share of a call is sent automatically on the first Monday that is at least 7 days
after the call, so a host waits 7 to 14 days. The founder wants hosts to get their money sooner,
and to decide themselves when to take it.

## What the founder decided

| Question | Decided |
| --- | --- |
| How long before a call's money can be collected | **2 days** after the charge, down from 7 days after the call. |
| Who starts the payment | **The host**, with a button. There is no automatic weekly payday any more. |
| How often | **Once every 24 hours.** |

"Once every 24 hours" is counted from the last time the host pressed, not by calendar day. A
calendar day would raise the question of whose midnight; 24 hours from the last press needs no
clock but the app's own.

## What a host sees

On the Hosting page, under "Getting paid":

- **Ready to collect: $84.20** (from 3 calls), with a button **"Send it to my bank account"**.
  Before confirming, the host sees what will arrive: "$84.20, less the 25-cent payout charge:
  $83.95."
- **Not ready yet: $40.00**, with the reason beside each call: "ready on Thursday" (inside the 2
  days), "the customer can still ask for a refund", "waiting for your answer to a refund request",
  "the customer's bank is disputing this charge".
- After pressing: "Sent on 16 November. You can collect again from 17 November, 3:10 PM."
- A line that is always there: "After we send it, Stripe and your bank usually need a few business
  days before it shows in your bank account. Your very first payout takes longer: Stripe holds it
  for about a week."

Beside each call's payment, a host already sees whether it was sent. That stays; "on the weekly
payday of …" becomes "ready to collect from …".

## What changes in the app

**When a charge becomes ready.** Each charge is ready 2 days after the moment the app records that
it went through. There is no rounding to a Monday any more. One moment is used for both "charged
at" and the date, so the two cannot drift apart.
- A charge for time added during a call has its own date.
- A charge the founder makes later, after a review, is ready 2 days from then.
- **Charges recorded before this change** keep the date they were given, and from that date on they
  are collected with the button like any other.

**Pressing the button** sends, in one go, every charge of that host that is ready and not held
back. What holds a charge back is what holds it back today (a bank dispute, a refund on its way, a
payout account that is not ready), plus the hold in plan 13 once that is built.
- Nothing is sent by itself any more. The always-on helper still finishes a payment that was
  started and whose answer from Stripe was lost, as it does today.
- The 24 hours and the press are recorded in one locked step for that host, so two presses at the
  same moment cannot both go through.
- If one charge cannot be sent (Stripe refuses it, or its answer is lost), the others still go, and
  that one stays "ready" or "being checked". The page says so.

**The 25-cent payout charge** is taken once for each press, from the money sent, and is never more
than what is sent. If only 25 cents or less is ready, the button is not offered. (Today it is taken
once for each host for each weekly payday; the record of it is keyed by that date, and will be
keyed by the press instead.)

**The record.** The payments decision "weekly, for calls that ended at least 7 days earlier" in
`docs/module-record.md` is updated, with the date and the reason. The terms and the Hosting page
wording change with it.

## What this gives up, and the one thing the builder would add

**Money that nobody collects.** With no automatic payday, the share of a host who forgets, or who
has left, stays with Connect. Uber, which the founder had in mind, pays everyone weekly by itself
and offers the button on top. Holding other people's money for a long time is also something the
lawyer and Stripe's rules may have a view on.

*The builder's recommendation, for the founder to decide:* a safety net, not a payday. Anything
still uncollected 30 days after it became ready is sent by itself, with the usual charge. A host
who uses the button never notices it. Until the founder decides, this plan follows the decision as
given: nothing is sent unless the host presses.

**What the shorter wait gives up.** Seven days gave more time to notice three things before the
money left: a call's record changing after it was charged, a customer's bank disputing a charge,
and a host deciding to refund. It never guaranteed any of them. Two days is an accepted risk, not a
safety guarantee:
- Once a host's share is sent, the app cannot refund that charge, and has no way to take the money
  back from the host.
- Stripe's own delay is not extra time for refunds: the app sends the money before Stripe has
  finished collecting it.
- The usual fraud on marketplaces is a fake host booking their own calls with a stolen card and
  cashing out before the card's owner complains. Hosts here are ID-checked and approved by the
  founder, which covers most of it. A button that pays within 2 days makes this a little easier
  than a weekly payday did.

**A safeguard worth knowing, not built:** a longer wait, 7 days, for a new host's first collection
only.

**Not in this plan:** money on a debit card within minutes. That is a separate Stripe feature with
its own price and rules.

## What Stripe adds, whatever the app does

Stripe's own help pages say a new account's first payout is typically 7 days after its first
payment, up to 14 in some cases, and that this cannot be shortened. For later payouts, "a few
business days" is to be confirmed in the founder's Stripe account before the wording goes live.

## How it will be checked

- Automatic tests for the date: just before and exactly at the 2 days; a recorded date is never
  changed by a retry; old dates stay.
- The payments and added-time check scripts, which today pretend a clock 15 days ahead and expect
  the helper to pay by itself: rewritten around the button. Nothing is sent without a press; a
  press sends everything ready and nothing else; a charge inside its 2 days, in dispute, or with a
  refund on its way stays; the charge is taken once per press and never exceeds the payout; a
  second press inside 24 hours is refused; two presses at once send once; one refused charge does
  not stop the others; a payment started and interrupted is finished by the helper without a
  second charge; old and new dates in one call.
- By hand in a browser: the Hosting page with money ready, not ready and just sent; the wording
  beside a call's payment.

## Order of work

1. The date rule, with tests.
2. The press: what is ready, the 24 hours, the charge, sending. The helper stops paying by itself
   in the same step, so there is never a moment with both or neither.
3. The Hosting page and the wording beside each call.
4. The check scripts; every check; the two reviews; the pull request.

Size: about three to four days of building, plus the reviews.

## Astra's checks

**First version (weekly payday kept, 2 days), as part of plan 13's third check: approve with
changes.** Still relevant here, and taken: count the date from the moment the charge is recorded,
with one moment for both fields, and never move a recorded date; the existing tests and check
scripts assume 7 days and must change with the rule; two days is an accepted risk, not a guarantee;
say what the app cannot do once money is sent; a longer wait for a first payment is worth naming,
not building.

**Second version** (this one, hosts start the payment): see below.
