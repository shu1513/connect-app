# Plan 50, part 1: a tip or a contribution refunded after collection is owed back by the host

**Status:** a code-level plan, written 26 November 2026 by the builder alone from the code on
`main` after pull request 108. To be checked by Astra before it is built. The rulebook is
`plans/50-giving-back-after-collecting.md`; the design it finishes is decision 8 of
`plans/46-part-3-money-owed.md`.

## For the founder: what this is

Today, when you refund a tip or a contribution after its host has collected it, Connect pays
all of it and the host keeps her share. After this part it works as a call does: the customer
is paid back, the host is told that she owes her share of it, she has 14 days and "I think
this is wrong", and then the app takes it from her balance at Stripe. For a tip of 5.00 that
was charged 5.46, what she owes is the 5.00 she got, never the payment fee.

Nothing changes for a refund given before she collected, and nothing changes for a host: she
still cannot refund after collecting.

## What is there today (read in the code)

- `refundContribution` (`src/lib/contributions/refund.ts`) writes a line in
  `contribution_refunds` ("owed"). After the share was sent only the founder can, and the
  line is marked `connectsOwn`.
- `sendRefund` and `runRefunds` send it: a money action of the **contribution's payment**
  (`paymentOwner`), tried again an hour after a refusal, never dropped. `applyRefundOutcome`
  records the answer with the contribution and its payment locked (`lockForPayment`), then
  the share (`lockShare`): for a `connectsOwn` line the whole amount is booked as
  `connect_cost` and the share is not touched; otherwise the share's `refundedCents` grows and
  its fee and host's share shrink (two lines in the books, on the share).
- The **share** of a contribution or a tip is a row in `payments` (`contributionPaymentId`
  set, no call), with its own transfer. The charge at Stripe belongs to the contribution's
  payment (`stripePaymentIntentId`, `stripeChargeId`, `refundedCents` there).
- A take-back that comes from a refund (`src/lib/disputes/takeback.ts`) is built on a line in
  **`refunds`**: `refundsWithoutRow` finds lines that are `afterCollection`, "done" and not
  looked at; `writeRefundDebt` works the amount out from the numbers written on that line
  (`shareBeforeCents`, `shareAfterCents`, `hostOwesCents`, `afterCollectionNo`), reads the
  charge's time from Stripe for the Host Agreement, and tells the host. `takePlan`,
  `refundStands`, `refundChangedAtStripe`, `undoFailedRefund` and `reworkRefundsLeft` all read
  that line and the share's payment.
- `refunds` already holds lines that are not card refunds: a member's time given back
  (`giveTimeBack`) writes one that is "done" at once.
- A refund of a contribution that Stripe confirms and that fails afterwards is not noticed
  today: `refundChangedAtStripe` looks only in `refunds`.

## Decisions (the builder's)

1. **The share gets its own refund line.** When Stripe confirms a contribution's or tip's
   refund line and the share had been sent, the same database step also writes one line in
   `refunds` for the share's payment: done, `afterCollection`, with Stripe's number for the
   refund, the founder as decider, the founder's reason, the share and the fee before and
   after, what the share lost, and its place among the share's refunds after the sending.
   It is linked to the contribution's line by two new columns (the line and its try).
   **From that line on, the take-back that exists does the rest, as for a call.** No second
   kind of cause is added to `host_debts`.
2. **No new `connectsOwn` lines.** `refundContribution` stops setting it. A line that already
   carries it, finished or on its way, is treated as today to its end. A later refund in the
   new way reads the share's own `refundedCents`, which the old lines never touched.
3. **What counts on the share** is the line's amount, never more than is left of the share's
   charge (as `applyRefundOutcome` caps it today). What she owes is what her share lost by
   it, never more than was sent and never more than is left on the transfer (`refundOwes`,
   unchanged).
4. **Where the take-back's code asks about the payment, a share of a contribution answers
   through its contribution.** One helper says what a share belongs to (a call, or a
   contribution's payment). Used by:
   - `writeRefundDebt`: the host comes from the contribution; the charge and Stripe's total of
     refunds are the contribution payment's (`stripeChargeId`, `stripePaymentIntentId`,
     `refundedCents`), so "Stripe's total is the app's" compares like with like.
   - `refundUnderWay`: a contribution's line that is with Stripe ("at_stripe") counts as money
     moving on its share. One that is only owed does not.
   - the words and the pages (`tellingFor`, `debtForPage`, `tellOfRefundTotals`,
     `undoFailedRefund`): "a tip for the call on ... from NAME", "a contribution to "X" from
     NAME", with the contributor's own page for the customer.
5. **A refund that fails after Stripe confirmed it.** Found the two ways a call's is: by
   Stripe's message (`refundChangedAtStripe` finds the share's line by Stripe's number) and by
   the look before a taking (`refundStands`). `undoFailedRefund` then, for a share's line that
   belongs to a contribution's line:
   - takes the contribution machine's locks first (the contribution and its payment, then the
     share), so the two machines never wait on each other the wrong way round;
   - undoes the share's side as today (the share's refunded amount, the two lines in the
     books, the take-back called off or "fell away", the refunds left worked out again);
   - writes "refunded to the customer" back under the contribution's payment, lowers that
     payment's refunded amount, and puts the contribution's line back to "owed" with its next
     try, so the helper sends it again, as that machine promises ("never dropped");
   - tells the founder, and the host if she had it before her or had paid for it.
   When the next try is confirmed, it gets a new share's line and a new take-back.
6. **The founder's form says what will happen** (`src/app/admin/projects/page.tsx`): "Her
   share has already been sent to her. The contributor is paid back from Connect's money now.
   The host then owes her share of it back: she is told, has 14 days, and can object." Its
   answer after the press stays "on its way to the contributor's card".
7. **The host's pages say it too.** Where they say "only Connect can refund it now" (the tip
   box, her project's page, `refundContribution`'s refusal) they add "and you would then owe
   your share of it back". Her project's page stops calling a share that shrank after the
   sending simply "sent to you": it says what was sent and links to what she owes back.
8. **Migration 0066** (0065 is taken by the 14-day session; whoever merges second renumbers):
   `refunds.contribution_refund_id` (a link to `contribution_refunds`) and
   `refunds.contribution_attempt`, both empty for every other line, with "one share's line for
   a contribution's line and its try". Nothing else changes in the database.
9. **The yearly statement and the books** need nothing new: `host_takeback`, `host_repaid`
   and `connect_cost` are written by the take-back as for a call. New lines no longer write
   `connect_cost` at the refund.

## What is not in this part

- A member's time given back after collection (part 2).
- A contribution's refund given **before** collection that fails late at Stripe: not noticed
  today, and not here. (Named so that it is not forgotten.)
- The host's own give-back after collecting (left out of plan 50, with the reasons there).
- The phone apps.

## How it is tried

- Type check, lint, the automatic tests (the words for a tip and a contribution; what the
  helper says a share belongs to).
- `scripts/contribution-check.ts`, against Stripe's test mode. The old case "the founder's
  refund after that is Connect's own money" becomes: the line is not `connectsOwn`; when
  Stripe confirms, the share shrinks, no `connect_cost` is written, the share has its own
  line with the right numbers; the helper writes the take-back ("waiting" without a published
  Host Agreement; "told" with one made up for the run, as `dispute-takeback-check` does);
  after its day the reversal is taken and the books add up; a part refund after an old
  `connectsOwn` refund; pressed twice; an old `connectsOwn` line on its way finishes the old
  way.
- `scripts/tip-check.ts`: a tip of 5.00 charged 5.46, refunded in full after collection: she
  owes 5.00; the host's sentence.
- The late failure: a confirmed line whose refund is then made to fail (as `owed-check` does
  for a call's): the share is whole again, the take-back is called off, the contribution's
  line is owed again and its next try, once confirmed, makes a new take-back.
- Unchanged and green: `owed-check`, `dispute-takeback-check`, `disputes-check`,
  `payments-check --payouts`, `refunds-check`.
- The founder's form and the host's pages are looked at in the browser.
