# Plan 50, part 1: a tip or a contribution refunded after collection is owed back by the host

**Status:** a code-level plan, written 26 November 2026 by the builder alone from the code on
`main` after pull request 108. Astra checked the first draft that day: **"not ready"**, with
the core idea found sound. This is the plan as rewritten after that check (the list is at the
end). The rulebook is `plans/50-giving-back-after-collecting.md`; the design it finishes is
decision 8 of `plans/46-part-3-money-owed.md`.

## For the founder: what this is

Today, when you refund a tip or a contribution after its host has collected it, Connect pays
all of it and the host keeps her share. After this part it works as a call does: the customer
is paid back, the host is told that she owes her share of it, she has 14 days and "I think
this is wrong", and then the app takes it from her balance at Stripe. For a tip of 5.00 that
was charged 5.46, what she owes is what she got of it (5.00, or 4.75 where that tip's
transfer carried the 25 cents for collecting), never the payment fee.

Nothing changes for a refund given before she collected, and nothing changes for a host: she
still cannot refund after collecting.

## What is there today (read in the code)

- `refundContribution` (`src/lib/contributions/refund.ts`) writes a line in
  `contribution_refunds` ("owed"). After the share was sent only the founder can, and the
  line is marked `connectsOwn`. The only other writer (`charge.ts`, "late:", decided by the
  app) is for money taken after a cancellation: it has no share.
- `sendRefund` and `runRefunds` send it: a money action of the **contribution's payment**,
  tried again an hour after a refusal. `applyRefundOutcome` records the answer with the
  contribution and its payment locked (`lockForPayment`), the line, then the share
  (`lockShare`): for a `connectsOwn` line the whole amount is booked as `connect_cost` and the
  share is not touched; otherwise the share's `refundedCents` grows and its fee and host's
  share shrink (two lines in the books, on the share). Unanswered tries are followed by
  `recoverContributionOperation` (`src/lib/contributions/recover.ts`).
- The **share** of a contribution or a tip is a row in `payments` (`contributionPaymentId`
  set, no call) with its own transfer; `chargedCents` is what was taken, and the charge's
  number is copied onto it. The PaymentIntent and the total refunded are on the
  contribution's payment.
- A take-back that comes from a refund (`src/lib/disputes/takeback.ts`) is built on a line in
  **`refunds`**: `refundsWithoutRow` finds lines that are `afterCollection`, "done" and not
  looked at; `writeRefundDebt` works the amount out from the numbers on that line, reads the
  charge's time from Stripe for the Host Agreement, and tells the host. `takePlan`,
  `refundStands`, `refundChangedAtStripe`, `undoFailedRefund` and `reworkRefundsLeft` all read
  that line and the share's payment. A lost bank dispute's take-back (`writeDebt`) already
  takes off what refunds after the sending took (`reductionsOn`).
- `refunds` already holds lines that are not card refunds (a member's time given back). Its
  call readers reach it through a call or a card payment, so a line on a contribution's share
  is not seen by them (Astra went through them).
- A refund of a contribution that Stripe confirms and that fails afterwards is not noticed
  today.

## Decisions (the builder's)

1. **The share gets its own refund line.** When Stripe confirms a contribution's or tip's
   refund line that is marked "after collection" (decision 2), the same database step also
   writes one line in `refunds` for the share's payment, **written as done at once** (never
   through `applyRefundDone`, which would book the customer's money a second time and send a
   call's email): `afterCollection`, Stripe's number for the refund, the founder as
   `decidedBy` and "admin" as `decidedAs`, the reason, the share and the fee before and after,
   what the share lost, and its place among the share's refunds after the sending (the next
   number after the highest on that share, failed ones counted). It is linked to the
   contribution's line by a new column. **From that line on, the take-back that exists does
   the rest, as for a call.** No second kind of cause is added to `host_debts`.
2. **The line itself says which way it goes.** A new mark on a contribution's refund line,
   "after collection", is set when the line is written and the share had been sent. Only the
   founder can write such a line, with a reason, and never one decided by the app. No new
   line gets `connectsOwn`; a line that already carries it, finished or on its way, is
   treated as today to its end. A later refund in the new way reads the share's own
   `refundedCents`, which the old lines never touched; Stripe's total is always compared with
   the contribution payment's total.
3. **What counts on the share** is the line's amount (with the writer's own limits it is
   never more than is left of the share's charge). What she owes is what her share lost by
   it, never more than was sent and never more than is left on the transfer (`refundOwes`,
   unchanged).
4. **One helper says what a share belongs to:** a call, or a contribution's payment. Used
   wherever the take-back asks about "the payment":
   - `writeRefundDebt`: a share without a call is no longer "nothing to do"; the host comes
     from the contribution; the PaymentIntent and the total of refunds compared with Stripe's
     are the contribution payment's. The transfer, the amount, the currency and the
     take-back's payment stay the share's.
   - `writeDebt` (a lost dispute): the same comparison of totals for a contribution's share,
     which today is made only for a call's own payment. Without it a dispute could be worked
     out from Stripe's lowered charge and the app's unlowered share.
   - `refundUnderWay`: money is moving on a share also while a line of its contribution is
     with Stripe ("at_stripe") **or a refund try of that contribution's payment is written
     down and unanswered**. A line that is only owed does not count.
   - `takePlan` and the recovery of a taking: not while the share's line is waiting to be
     undone (`undoPendingAt`), and not while money is moving as above.
   - the words and pages (`tellingFor`, `tellOfRefundTotals`, `debtForPage`,
     `undoFailedRefund`): owner "contribution" with the contribution payment's number, so the
     notice exists and the take-back's page is found. The founder's links lead to the project
     or the tip.
5. **A refund that fails after Stripe confirmed it is ended, as a call's is. It is not tried
   again by itself.** Found the two ways a call's is (Stripe's message, by Stripe's number of
   the refund; and the look before a taking). Then, in one step, under the locks of
   decision 6:
   - the share's side is undone as today (`undoFailedRefund`: the share's refunded amount,
     the two lines in the books, the take-back called off or "fell away", the refunds left
     worked out again), except that "refunded to the customer" is written back **under the
     contribution's payment**, once, and never on the share;
   - the contribution payment's refunded amount is lowered, and the contribution's line gets
     a new last state, "failed", with the day. It keeps Stripe's number, so a late answer
     about it can be recognised and ignored;
   - the founder is told, in the words a call's has: the customer did not get the money, and
     a new refund is a new press. What the host had already paid for it is hers, as for a
     call (the same words, the same known limit: the app does not send it back by itself).
   This is simpler than "owed again, next try": a second try by itself could meet the first
   one's late answer, and a second take-back could meet the first one's reversal.
6. **One order of locks wherever both machines are held:** the contribution's pair lock, the
   contribution, its payment, **the share, then the contribution's line**, then the share's
   line, then the take-back. `applyRefundOutcome` locks the line before the share today; it
   is put in this order. `undoFailedRefund` takes the contribution's locks first when the
   line belongs to one. Looking up names for a page locks nothing.
7. **The founder's form** (`src/app/admin/projects/page.tsx`, for a tip and a contribution):
   for a share that was sent it shows what the host will owe at most (her share's part of
   the amount, "less if less was sent"), says that she is told, and that the app takes it by
   itself only where she had accepted a published Host Agreement, with 14 days and her
   objection. The form carries whether the share was sent when it was drawn; if that has
   changed at the press, nothing is refunded and the founder is asked to look again.
8. **The host's pages.** Where they say "only Connect can refund it now" (the tip box, her
   project's page, the refusal) they add that she would then owe her share of it back. Her
   project's page shows what was really sent (`transferCents`) beside her share as it now
   stands, and links to what she owes. The yearly statement's page no longer says that a
   refund of a collected gift never lowers her share.
9. **Migration 0066** (0065 is the 14-day session's; whoever merges second renumbers):
   `contribution_refunds.after_collection` and `failed_at`, and "failed" among its states;
   `refunds.contribution_refund_id`, a link, with at most one share's line for a
   contribution's line. Nothing else.
10. **Putting it live:** the website and the helper are put live together, and no refund of
    a collected gift is pressed while that happens. (An old helper would mark the share's
    line "nothing to do", and Connect would carry it as today.)

## Known, and left as it is

- **The contribution machine's own recovery** (`recoverContributionOperation`) is weaker than
  a call's: a repeated request is believed without asking Stripe for the refund's state now,
  a refusal of a repeat moves on to the next try without a look whether the first went
  through, and "not on Stripe's list" is taken as final at once. On a part refund that could
  pay a customer twice. It is so today, for every contribution refund, and this part adds no
  new try. It is a fix of its own, proposed right after this part. **Fixed on 27 November
  2026: see "The refund's follow-up, hardened" at the end.**
- What a host had already paid for a refund that then failed is not sent back by the app,
  and a replacement refund's take-back may find no room left on a transfer that was already
  reversed. Both are so for a call today.
- (A contribution's refund given before collection that fails late was first left out; it
  is built after all, see "As built" at the end.)
- No periodic look finds a late failure whose message from Stripe was missed, once its
  take-back is waiting, ended or nothing (so for a call today).

## How it is tried

- Type check, lint, the automatic tests (what a share belongs to; the words for a tip and a
  contribution; the form's sentence).
- `scripts/contribution-check.ts`, against Stripe's test mode, with a share really sent
  through "Collect earnings" (its old case fakes "sent" without a transfer, which cannot be
  reversed): the founder's line is "after collection" and not `connectsOwn`; when Stripe
  confirms, the share shrinks, no `connect_cost` is written, the share has its own line with
  the right numbers; the take-back is "waiting" without a published Host Agreement and
  "told" with one made up for the run; after its day the reversal is taken and the books add
  up; a part refund after an old `connectsOwn` refund, and the other way round; pressed
  twice; a form drawn before the collection and pressed after it. The old case stays as a
  fixture of its own for a line that already carries `connectsOwn`.
- `scripts/tip-check.ts`: a tip of 5.00 charged 5.46, alone in its collection (4.75 sent),
  refunded in full after it: her share lost 5.00, she owes 4.75; half of it: 2.50.
- The late failure (as `owed-check` makes a call's refund fail): the share is whole again,
  the take-back is called off, "refunded" is written back once under the contribution's
  payment, the line is "failed", nothing is sent again, and a late answer about the old
  refund changes nothing.
- A bank dispute on a part of what is left after such a refund: the two take-backs together
  are what her share lost and no more (100 charged, 80 sent, 50 refunded, 25 lost: 40 and
  20), also when the dispute is worked out before the refund's take-back is written.
- Unchanged and green: `owed-check`, `dispute-takeback-check`, `disputes-check`,
  `payments-check --payouts`, `refunds-check`, `statement-check`.
- The founder's form and the host's pages are looked at in the browser.

## Astra's check of the first draft (26 November 2026): "not ready", worked in

1. *A late failure followed by a new try could pay a part refund twice, and the replacement
   take-back had no clear rule.* Decision 5: no new try by itself; the weak recovery is named
   under "Known".
2. *A lost dispute must compare the same totals, and "money moving" must see a try that is
   written down.* Decision 4.
3. *The words told the founder to refund again while the first draft retried by itself.*
   Decision 5 makes those words true.
4. *The order of locks.* Decision 6.
5. *The tip's example was wrong for a tip alone in its collection.* 4.75, above and in the
   check.
6. *Readers:* the call readers are safe; the share's line must be written done at once; the
   statement's sentence, the project page's "sent to you", the form's amount and a form
   drawn before collection; the check must send a real transfer; going live together.
   Decisions 1, 7, 8, 10 and "How it is tried".

## As built, and what Astra found in the code (26 November 2026)

Built as decided above, with migration 0066. Astra read the code and said **"merge after
fixes"**, with seven points. Six were taken; one was written down and left.

1. *A lost dispute's take-back can be a few dollars too high after a refund failed late.*
   **Left, and named here.** It needs four things at once: a refund written the old way
   ("Connect's own money"), a new refund after collection, a bank dispute lost on a part of
   what is left, and then the new refund failing late. Lines written the old way exist only
   in test databases: the app is not live, and the new code writes none. Without such a line
   the two sums come out the same, to the cent or one cent apart. A call has the same today.
2. *A refund with no line on its share that fails late was never noticed, and would then hold
   up every later take-back on that payment,* because Stripe's total and the app's no longer
   agree. **Built:** `undoFailedContributionRefund`. Stripe's message about a refund that is
   in neither `refunds` nor a share's line is looked up among the contributions' lines. The
   line is over ("failed"), the payment counts as refunded by that much less, what went back
   is written back, the share is whole again (or, for a line written the old way, Connect's
   cost is taken off the books), and the founder is told, with what the host was sent too
   little if she had collected the smaller share. While money is moving it throws, and Stripe
   delivers its message again. This replaces "still not noticed" under "Known" above.
3. *A take-back and another refund of the same gift could each start while the other was
   unanswered.* A refund is no longer started while the share is being taken back; a repeat
   of a taking is not sent while a refund of that contribution is unanswered; and a failed
   refund is not undone while another refund of it is still with Stripe.
4. *If the two records of a failed refund did not fit, one side was undone and the other
   left.* The contribution's line is now locked and judged first, before the share's line,
   and nothing is changed unless it fits.
5. *The founder's form could be sent without saying what it had shown, and its answer always
   said "on its way".* It must say "sent" or "not sent" now, and the answer is read from the
   line (failed, paid back, or on its way).
6. *Amounts and places:* the form's "at most" now stops at what was sent (4.75 for a tip
   alone in its collection); the statement's "Your share" sentence is put right; the
   founder's emails about a contribution lead to the projects page, not the page for calls.
7. *The checks:* only the script's own line is tried "hours later" (a pass over every refund
   could have sent another run's refunds), and that no second request is written down is
   now looked at; added: half a tip and then the other half (2.50, then 2.25), a new refund
   after a line written the old way with its take-back, a refund with no line on its share
   failing late (the old way, and one given before collection). **Not added:** a bank dispute
   together with such a refund. The sum is `writeDebt`'s, which `dispute-takeback-check`
   covers; only the comparison of totals is new there.

Astra also confirmed: no way for the two machines to wait on each other was found; on the
ordinary path the customer's money is booked once under the contribution's payment and the
share's changes once on the share; calls behave as before, except that a refund waiting to
be undone now also stops its take-back from being taken.

## What CodeRabbit found (27 November 2026)

Three points on the pull request, all taken.

1. *The form promised a smaller take-back for every part refund.* A part can reach the same
   limit as the whole (5.45 of a 5.46 tip also comes to the 4.75 that was sent). The sentence
   now says a part refund "may come to less".
2. *Refunds held up by a take-back could fill the helper's batch.* The helper tries the 50
   oldest refunds that are owed; one whose share is being taken back is refused under the
   lock and stays where it was, so fifty of those would keep a newer refund of another
   payment waiting. Such lines are now left out before the 50 are picked.
3. *A take-back that was already written was still taken while Stripe's total of refunds was
   not the app's,* although the founder's notice says the app "takes nothing" then. Before a
   taking, and before a repeat of one, Stripe's total on the charge is now compared with the
   app's (for a tip or a contribution: with its contribution payment's). While they differ
   nothing is taken and the founder is told once for that pair of totals. **This holds for a
   call's refund too,** where the same gap was: the notice was always meant for both. A
   reversal Stripe already made is still found and booked. The check now has that case: a
   take-back told before the totals came apart is not taken when its day comes.

## The refund's follow-up, hardened (27 November 2026)

The weak recovery named under "Known, and left as it is" is closed. A tip's or a
contribution's refund whose answer from Stripe never arrived is now followed up exactly as a
call's refund is (`reconcileOperations` in `src/lib/payments/jobs.ts`). Why it matters: a
refund that is called "not made" is sent again as a new try an hour later, and on a part
refund enough of the charge is left for that new try to pay the contributor a second time.

What changed, in `src/lib/contributions/refund.ts` and `recover.ts`:

1. **The first request has a last moment.** Whoever writes a try down sends it at once: no
   later than 30 seconds after it was written down (by the database's clock, read last of
   all), and each sending is given up after 10 seconds (the Stripe library sends once more
   by itself when the connection was closed under it, so two are allowed for). Together
   that is shorter than the minute the helper waits before it looks. So when the helper looks, the first request has either
   reached Stripe or will never be sent. A writer that is too late sends nothing and leaves
   the try to the helper, which sends it under the same label.
2. **A repeat is not believed as it comes back.** Under the same label Stripe returns its
   first answer, as it was then. The refund is now asked about by its own number, and booked
   as it stands now: paid, still on its way, or failed since.
3. **A "no" to a repeat is not the end.** Stripe's complete list of the charge's refunds is
   searched for this line and this attempt first. A refund that is there is booked, once.
   Only when it is not there did the try not happen: owed again, a new try in an hour, as
   before.
4. **"Not on Stripe's list" has to wait.** Once a try is too old to repeat (23 hours), a
   search that finds nothing is final only if it began 24 hours after the try was written
   down, the same wait a call uses. Until then the try stays open and is looked at again.
   A search that takes longer than 20 seconds counts as not made.
5. **Before any new try, a look for the old one** (added after Astra's check, below).
   A new try only exists because the try before it was recorded as "not made". Before a try
   after the first is sent, by whoever sends it, Stripe's list is searched for a refund of
   an earlier try of the same line that is not over. If one is there, it is the line's
   refund: it is booked as the new try's outcome and nothing is sent.
6. **The hour before a new try starts when the "no" is written down,** not at the start of
   the helper's round, which may have begun long before.

The two waiting times and "a look is not the action" are now one definition for calls and
contributions (`SEARCH_WITHIN_MS`, `SETTLED_AFTER_MS`, `lookUp`), so they cannot drift apart.

**Not changed:** a line that is "done" or "failed" stays so; a line "at Stripe" is asked
about by its own number; nothing new is sent while the charge is disputed; the share's own
refund line for a refund given after collection is written in the step that confirms it,
also when that step is this follow-up.

**How it was tried.** `scripts/contribution-check.ts` has a new journey (19) against
Stripe's test mode, answering in Stripe's place only where test mode cannot be made to
refuse or fail a refund: a part refund that went through unheard and whose repeat is refused
is booked once and not sent again (on the old code the same case paid the contributor
twice: 5.00 and 5.00); a refused repeat with nothing on the list is owed again and sent once
after its hour; a repeat that returns an old "succeeded" for a refund that has failed since
is not booked as paid; after 23 hours a missing refund stays open, and after 24 it is final;
after 23 hours a refund on the list is booked, with the share's own line for a refund given
after collection; a writer that is too late sends nothing, and the helper sends it once,
under the same label; a line that was moved on although its earlier try was paid is not sent
again, by the sender and by the helper alike: the earlier refund is booked; a "no" to a mere
look at Stripe decides nothing.

## Astra's check of the follow-up (27 November 2026): "merge after fixes"

Eight points. The two most serious were ways the same refund could still be paid twice.

1. *Two helpers at the same moment:* both repeat the request; one is refused and finds
   nothing on the list yet, the other is paid a moment later; the line moves on and is paid
   again an hour later. Astra proposed to wait 24 hours after every "no". **Solved another
   way, by rule 5 above.** Waiting 24 hours would have delayed every refund that Stripe
   refuses for a passing reason by a day instead of an hour. The look before a new try
   closes the same gap at the one place where a second payment can be made, and keeps the
   hour. This is my choice, not Astra's wording.
2. *The Stripe library sends a request a second time by itself after a closed connection,*
   also when told not to retry. If the first went through and the second were refused, the
   first sender would record "not made". **Rule 5 covers it too;** the comment that said
   "one request" is put right.
3. *A refund that fails at Stripe in the instant between the helper reading "paid" and
   writing it down,* with Stripe's message about the failure arriving in that same instant,
   is booked as paid and the message finds no line. **Left, and named.** It was so before
   (and wider); it needs a refund to turn from paid to failed within a fraction of a second,
   which in practice takes days; and its fix is in the code for Stripe's messages
   (`src/lib/disputes/takeback.ts`), which another change is working on right now.
4. *If the database's clock and the helper's were hours apart,* a repeat could be sent
   after Stripe has forgotten the label. **Left:** it is so for every follow-up in the app
   (calls, memberships, transfers), and there is an hour's margin.
5. *A list of refunds that always takes longer than 20 seconds to read would keep the try
   open for ever.* **Left:** so for a call too; one charge of a tip or a contribution has a
   handful of refunds, not thousands.
6. *A try that was written down and never sent can still be sent for the first time by the
   helper after a bank dispute has opened.* **Left, as it was:** a dispute stops new steps,
   and a try written down before it is followed to its answer. Stripe refuses a refund of a
   disputed charge itself.
7. *The hour before a new try could have started before the refusal.* **Taken:** rule 6.
8. *The checks:* the decisive case was missing, and two checks proved less than they said.
   **Taken:** the line that was moved on although its earlier try was paid (for the sender
   and for the helper); requests to Stripe are now counted and their labels read, not only
   the refunds that exist afterwards; a clear "no" to a look (by number, and to the list)
   leaves the try open.

Astra also confirmed: calls behave as before; two helpers cannot book the same try twice; a
line "at Stripe" is still asked about by its own number; the share's own line is still
written in the step that confirms the refund.

**Known, and left.** A membership's pay-back (`src/lib/membership/recover.ts`) has the same
three gaps and is not touched here: it is a fix of its own.
