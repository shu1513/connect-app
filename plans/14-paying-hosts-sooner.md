# Plan 14: Paying hosts sooner

**Status:** plan (16 November 2026). Not built. The 2-day wait was checked by Astra as part of plan
13's third check; its points are worked in and listed at the end. The "Pay me now" button is the
builder's proposal: **not yet decided by the founder, and not yet checked by Astra.**

## What this is, and why

Today a host's share of a call becomes payable on the first Monday that is at least 7 days after
the call, so a host waits 7 to 14 days. The founder wants hosts to get their money sooner.

## Decided by the founder

**A host's share becomes payable 2 days after the charge**, instead of 7 days after the call. The
weekly payday is kept, so a host waits 2 to 9 days.

## Proposed, not yet decided: "Pay me now"

A button on the Hosting page that sends a host everything whose 2 days have passed, without waiting
for Monday. The weekly payday stays for hosts who do nothing.
- The 25-cent payout charge applies each time it is pressed, and is shown before the host confirms.
- At most once a day.
- It sends only what the weekly payday would also send. Every rule that holds a payment back
  applies in the same way, including the hold in plan 13.

It ends the wait for payday. It does not shorten Stripe's own delay (below). Getting money onto a
debit card within minutes, as some apps do, is a separate Stripe feature with its own price and
rules; it is not part of this plan.

## What changes in the app

**The date.** Each charge gets its date from the moment the app records that the charge went
through, plus 2 days, rounded forward to the next Monday. One moment is used for both "charged at"
and the date, so the two cannot drift apart.
- A charge for time added during a call gets its own date.
- A charge the founder makes later, after a review, gets a fresh 2 days from then.
- **Charges already recorded keep the date they were given.** This is per charge: a call can have
  an old charge and a new one.
- "When the app records it" is the honest wording: after an outage the app may record a charge a
  little later than Stripe made it.

**What "payday" means in the code, kept as it is.** The date is rounded to a Monday, and the
always-on helper sends whatever is past its date whenever it runs. So a payment that was held back
for some reason and is released on a Wednesday goes out on Wednesday.

**The 25-cent payout charge, kept as it is.** It is taken once for each host for each payday date.
If payments from several weeks are released together, each week's date carries its own charge. The
words for hosts must say "once for each weekly payday", not "once a week".

**What hosts are told**, on the Hosting page and beside each call's payment. The app sends the
money by itself. The words separate what Connect does from what Stripe and the bank do, and promise
only the first:
- "You are paid once a week. Your share of a call is sent on the first payday that is at least 2
  days after the charge."
- "After we send it, Stripe and your bank usually need a few business days before it shows in your
  bank account. Your very first payout takes longer: Stripe holds it for about a week."

Stripe's own help pages say a new account's first payout is typically 7 days after its first
payment, up to 14 in some cases, and that this cannot be shortened. The "few business days" for
later payouts is to be confirmed in the founder's Stripe account before the wording goes live.

**The record.** The payments decision "weekly, for calls that ended at least 7 days earlier" in
`docs/module-record.md` is updated, with the date and the reason.

## What the shorter wait gives up

Seven days gave more time to notice three things before the money left: a call's record changing
after it was charged, a customer's bank disputing a charge, and a host deciding to refund. It never
guaranteed any of them, and none of them is tied to 7 days in the code. Two days is an accepted
risk, not a safety guarantee:
- Once a host's share is sent, the app cannot refund that charge, and has no way to take the money
  back from the host.
- Stripe's own delay is not extra time for refunds: the app sends the money before Stripe has
  finished collecting it.
- The usual fraud on marketplaces is a fake host booking their own calls with a stolen card and
  cashing out before the card's owner complains. Hosts here are ID-checked and approved by the
  founder, which covers most of it.

**A safeguard worth knowing, not built:** keeping the 7-day wait for a new host's first payment
only. It is a small rule if the founder wants it.

## How it will be checked

- Automatic tests for the date: just before and exactly at the 2 days, across a Monday, and that a
  recorded date is never changed by a retry.
- The payments and added-time check scripts, which today pretend a clock 15 days ahead and expect
  both charges of a call to share a payday: updated for 2 days and for charges with different
  dates; a founder's later charge; old and new dates in one call; the payout charge when several
  weeks go out together.
- "Pay me now", if chosen: sends only what is due; the charge once per press; once a day; pressing
  twice at once; every hold still applies.
- By hand in a browser: the wording on the Hosting page and beside a call's payment.

## Order of work

1. The date rule, with tests. 2. The wording and the record. 3. The check scripts. 4. "Pay me now",
if chosen. 5. Every check; the two reviews; the pull request.

Size: about two days, or three with "Pay me now".

## Astra's check (as part of plan 13's third check, 16 November 2026)

Approve with changes. The points about the payday itself, all taken:
1. "Change 7 to 2" is not the whole change: the date must count from the moment the charge is
   recorded, with one moment used for both fields, and recorded dates must not move.
2. The helper sends whatever is past its date whenever it runs; there is no "only on Monday". The
   plan now says so.
3. The payout charge follows each payment's own payday date, so several held weeks carry several
   charges. Kept and described.
4. The existing tests and check scripts assume 7 days and a shared payday; they must change with
   the rule.
5. Two days is an accepted risk, not a guarantee; say what the app cannot do once money is sent.
6. Weekly payday is decided; "paying every day is one number" was wrong and is removed.
7. A longer wait for a first payment is worth naming, not building.
