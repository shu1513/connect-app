# Plan 14: Hosts collect their earnings when they want

**Status:** built (branch `module/collect-earnings`); what was built, the reviews and the checks
are in `docs/module-record.md` under "Module 12". The plan below is the third version (16 November
2026). Astra checked the second version (approve with changes); its twelve points are worked in and
listed at the end. One choice is left for the founder: the safety net for money nobody collects.

## What this is, and why

Today a host's share of a call is sent automatically on the first Monday that is at least 7 days
after the call, so a host waits 7 to 14 days. The founder wants hosts to get their money sooner,
and to decide themselves when to take it.

## What the founder decided

| Question | Decided |
| --- | --- |
| How long before a call's money can be collected | **2 days** after the call, down from 7. |
| Who starts the payment | **The host**, with a button. There is no automatic weekly payday any more. |
| How often | **Once every 24 hours**, counted from the last time the host collected, not by calendar day. |

## What a host sees

On the Hosting page, under "Getting paid":

- **Ready to collect: $84.20** (from 3 calls), with a button **"Collect earnings"**. Before
  confirming, the host sees: "$84.20, less the 25-cent collection charge: $83.95 will be sent to
  your Stripe payout account. Stripe then pays your bank."
- **Not ready yet: $40.00**, with the reason beside each call: "ready on Thursday at 3:10 PM"
  (inside the 2 days), "the customer can still ask for a refund", "waiting for your answer to a
  refund request", "the customer's bank is disputing this charge".
- After collecting, what really happened, never just "Sent": "$60.00 sent to your Stripe payout
  account. $20.00 is being checked. $4.00 could not be sent; it stays ready." Reloading shows the
  same collection with its results brought up to date. And: "You can collect again from 17
  November, 3:10 PM."
- A line that is always there: "After we send it, Stripe pays your bank on its own schedule.
  Your first payout from Stripe typically takes 7 to 14 days; Stripe shows you its own estimate."

The button is honest about what it does: it moves the money to the host's Stripe payout account.
Paying the bank is Stripe's step, which the app does not control. Beside each call's payment,
"on the weekly payday of …" becomes "ready to collect from …", with the time as well as the day.

## What changes in the app

**When a charge becomes ready.** 2 days after the call ends, and never before the app has recorded
that the charge went through. No rounding to a Monday. Under plan 13 the money is taken about a
day after a call when nobody asked for a refund, so that charge is recorded well inside the 2 days.
With a request that runs its full time, the charge is only taken about 48 hours after the call,
and the money is ready once it is recorded and the host has answered. A charge for added time
counts its 2 days from the same end of the call. The date is fixed when the charge is recorded and is
never moved by a retry.
- A charge for time added during a call has its own date.
- A charge the founder makes later, after a review, is ready as soon as it is recorded, if the 2
  days since the call have already passed.
- **Charges recorded before this change** keep the date they were given, and from that date on are
  collected with the button like any other.

**One collection** is a record of its own: its number, the host, when it was accepted, and the
payments it took. That record is what makes everything below hold.
- **Who and where to.** The host is the logged-in person and the destination is their own payout
  account, both read by the server. Nothing about them is taken from the page.
- **What it takes.** Every charge of that host that is charged, not yet sent, past its date, and not
  held back. What holds a charge back: a bank dispute, a message from Stripe about a dispute that
  has not been handled yet, a refund on its way, a payment already being sent, and the hold in plan
  13 once that is built. The host's payout account is checked with Stripe at that moment, not from
  what the page last showed.
- **Accepted in one locked step.** Under a lock for that host, the app looks for this same
  collection first (a retry of the same press gets the same collection back, also days later), then
  checks the 24 hours, then writes down the collection and exactly which payments it will send,
  all before it talks to Stripe. So two presses at once make one collection, and a crash in the
  middle never leaves a press that half happened.
- **What "writes down" means for each payment.** In that same step the app locks each payment in
  turn, checks once more that it is not disputed and has no refund on its way, and records its
  transfer as **started**, with the exact amounts, the way every money action is already recorded.
  From that moment the app's existing rule applies: one money action at a time on a payment. A
  refund asked for while a transfer is started is refused until that transfer's outcome is known,
  and once it is sent no refund is possible in the app, as today. So a refund and a transfer of
  the same charge can never run side by side, no further check is needed at the moment of sending,
  and the refund step needs no new lock. (A bank dispute that arrives after this point can still
  lose the race; that risk is named below.)
- **When nothing can be sent** (everything is held, the payout account is not ready, or 25 cents or
  less is ready), there is no collection: no charge, and the 24 hours are not used up.
- **Once a collection is accepted, the 24 hours stand**, even if Stripe then refuses every payment
  in it. Otherwise a failing press would be a way round the limit.
- **Sending** is one payment after another, outside the locked step. One that Stripe refuses stays
  ready for a later collection. One whose answer is lost is "being checked": the always-on helper
  finishes exactly that payment, with the same amounts, and does not count as another press.
- **If the app stops after accepting, before Stripe was asked at all,** nothing is lost and the host
  does not have to press again. Every transfer of the collection is already recorded as started.
  After a minute the helper finds each one that is not yet confirmed and sends it under the same
  name, which Stripe treats as one and the same request however often it arrives. After 23 hours
  the helper no longer repeats a request; it asks Stripe whether the transfer exists, and if it
  does not, that payment is simply ready again for a later collection. This is how the helper
  already finishes every interrupted money action today.

**The 25-cent collection charge** is Connect's charge for a collection, once per collection.
- It is taken from the largest payment of the collection.
- It is 25 cents, or that payment's whole share when the share is smaller. (Two payments of 20
  cents each: the charge is 20 cents, taken from one, and the host receives the other 20.) The
  charge is never spread over several payments, and the app never keeps track of a remainder.
  This is the rule the app already has: the charge is never more than the payment it is taken from.
- If that payment fails, the charge is **waived** for that collection. The app does not move it to
  another payment afterwards or keep track of 25 cents owed.
- A collection in which nothing went through carries no charge.
- **Recorded per collection, for every payment**, whether its date is old or new. The old records,
  kept per weekly payday, stay only as the history of payments already sent under that rule; no
  new collection reads or writes them. (Otherwise two old charges with the same payday, collected
  on different days, would share one record and the second collection's charge could not be
  written down.)

**The always-on helper** no longer begins any collection: nothing goes to a host unless the host
pressed. It keeps doing everything else it does for payments, and it still completes every
transfer that an accepted collection recorded and that is not yet confirmed, whether Stripe's
answer was lost or the request never left.
While this change is put live, the old helper is stopped first, so the two rules never run side by
side.

**Hosts who cannot press the button.**
- *A closed account* cannot log in. The founder can run a final collection for that host from the
  admin page, under the same rules and with the same record.
- *A paused account* can still collect. Pausing stops new requests and calls; it does not keep back
  money already earned.

**The founder's view.** A total and a list of everything earned and not yet collected, read on its
own (today's admin page only lists the latest 200 payments), including hosts who can no longer
log in.

**The record.** The payments decision "weekly, for calls that ended at least 7 days earlier" in
`docs/module-record.md` is updated, with the date and the reason. The terms and the Hosting page
wording change with it.

## Left for the founder: money nobody collects

With no automatic payday, the share of a host who forgets, or who has left, stays with Connect. A
payment that was never sent also stays refundable in the app for as long as it sits there. Two
answers, smallest first:

1. **The list above and a habit**: the founder looks at uncollected money from time to time and
   settles old amounts by hand. This is in the plan.
2. **A safety net**: anything still uncollected 30 days after it became ready is sent by itself,
   under the same rules. Recommended by the builder, not built unless the founder says so.

Two things to ask outside the app: the lawyer, about holding hosts' money for a long time; and
Stripe, about how long money earned by hosts may stay in Connect's balance before it is sent on.

## What the shorter wait and the button give up

Seven days gave more time to notice three things before the money left: a call's record changing
after it was charged, a customer's bank disputing a charge, and a host deciding to refund. It never
guaranteed any of them. Two days is an accepted risk, not a safety guarantee:
- Once a host's share is sent, **the app** cannot refund that charge and has no way to take the
  money back from the host. (Stripe can do both; the app has not been built to.)
- A host now chooses the moment. They can collect as soon as the 2 days are over, and after that
  cannot give a refund through the app. Plan 13 stops this while a customer can still ask or is
  waiting for an answer, and no longer.
- Stripe's own delay is not extra time for refunds: the app sends the money before Stripe has
  finished collecting it.
- A dispute that arrives in the same moment as a collection can lose the race. That is a risk
  Connect carries, as today.
- The usual fraud on marketplaces is a fake host booking their own calls with a stolen card and
  cashing out before the card's owner complains. Checking hosts' ID and approving them by hand
  reduces that risk; it does not prevent it.

**A safeguard worth knowing, not built:** a longer wait, 7 days, for a new host's first collection.

**Not in this plan:** paying the bank directly from the app, money on a debit card within minutes,
a balance a host can owe, and taking sent money back.

## How it will be checked

- Automatic tests for the date: just before and exactly at the 48 hours after the call; a charge
  recorded after the 48 hours; a recorded date never moves; old dates stay.
- The payments check script, rewritten around collections: nothing is sent without a press; a press
  sends everything ready and nothing else; a charge inside its 2 days, in dispute, or with a refund
  on its way stays; the collection charge once, on a payment large enough, waived when that payment
  fails, never on a collection where nothing went through; a second press inside 24 hours is
  refused and exactly at 24 hours is accepted; two presses at once; a retry of the same press; a
  press with nothing to send uses up nothing; some payments through, one refused, one with a lost
  answer; a crash before anything reached Stripe, finished by the helper without the host pressing
  again; the helper finishing a lost one without a second charge or a second press; a refund asked
  for while its charge is being sent is refused, and one asked for just before is not collected;
  two payments each smaller than 25 cents; two old charges with the same weekly payday collected
  on different days, each with its own charge; only the host's own money; a payment that was already being sent under
  the old rule; a final collection by the founder for a closed account.
- The added-time script: the two charges of a call need not be ready at the same moment; one
  collection takes both once both are.
- The whole-journey script: the host collects; nothing was sent before.
- By hand in a browser: the Hosting page with money ready, not ready, just collected with a mixed
  result, and inside the 24 hours; the wording beside a call's payment; the founder's list.

## Order of work

1. The date rule, with tests.
2. The collection: the record, what it takes, the 24 hours, the charge, sending and finishing. The
   helper stops paying by itself in the same step.
3. The Hosting page, the wording beside each call, the founder's list and the final collection for
   a closed account.
4. The check scripts; every check; the two reviews; the pull request.

Size: about five days of building, plus the reviews.

## Astra's checks

**First version (weekly payday kept), as part of plan 13's third check: approve with changes.**
Taken: one moment for "charged at" and the date; recorded dates never move; the tests and scripts
that assume 7 days change with the rule; two days is a risk accepted, not a guarantee.

**Second version (hosts start the payment): approve with changes.** Twelve points, all taken:
1. A press must be a record of its own, accepted in one locked step before Stripe is asked; a retry
   returns the same one; nothing to send means no press, no charge and no 24 hours used; once
   accepted, the 24 hours stand.
2. Keying the charge by collection is not enough: say which payment carries it and what happens if
   that payment fails. (Waived; never moved; never on a collection where nothing went through.)
3. Show what really happened, not "Sent": sent, being checked, could not be sent.
4. Two protections lived only in the automatic payday: waiting for unhandled dispute messages, and
   asking Stripe whether the payout account is ready. They move into the collection.
5. Stop only the automatic start. The helper's other payment work and its finishing of lost
   payments stay; a finished one is not another press.
6. The button sends money to the host's Stripe account, not to the bank: name it for what it does,
   and do not promise "about a week".
7. Three sentences in plan 13 were wrong for a button. Corrected there.
8. Hosts who cannot log in need a route. (The founder's final collection; paused hosts may collect.)
9. The list of what must change was too short: tests, three check scripts, the Hosting, results and
   admin pages.
10. Uncollected money needs to be visible; an automatic sweep is reasonable but is the founder's
    choice; ask Stripe how long such money may sit.
11. Say plainly that a host can collect at the earliest moment and end the refund route, and that
    ID checks reduce fraud without preventing it.
12. Keep it narrow: one transfer per charge, one after another; no bank payout, wallet or reversal.

## CodeRabbit's review (pull request 18)

Four comments on this plan. Each was checked against the money code before anything was changed.
All four pointed at something the plan had left unsaid; all are taken, as wording that makes the
rule exact, not as new machinery.
1. *A refund could run alongside the transfer of the same charge.* Not possible in the app as it
   is: every money action on a payment is recorded as started under that payment's lock, and a
   second one is refused while the first is unfinished (`src/lib/payments/operations.ts`). The plan
   had not said that a collection records each transfer in that same way. It does now. The
   suggested extra lock on refunds is not needed.
2. *No payment of a collection is large enough to carry 25 cents.* The charge is taken from the
   largest payment and is never more than that payment's share, as the app's rule already is.
3. *Old charges keep a record per weekly payday, so two of them collected on different days would
   share one.* Correct. The charge is now recorded per collection for every payment.
4. *A crash after accepting and before Stripe was asked: who finishes it?* The helper, as it does
   for every interrupted money action today (checked in `reconcileOperations`): it repeats the
   recorded request under the same name. The plan's wording ("whose answer was lost") was too
   narrow and is corrected.

