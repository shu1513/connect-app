# Plan 50, part 2: a member's time given back by Connect after the host collected

**Status:** a code-level plan, written 27 November 2026 by the builder alone from the code on
`main` after pull request 111. Astra checked the first draft that day: **"not ready"**, with
the reuse of the take-back found sound. This is the plan as rewritten after that check (the
list is at the end). The rulebook is `plans/50-giving-back-after-collecting.md`; part 1
(`plans/50-part-1-gifts-owed-back.md`) is merged.

## For the founder: what this is

A member's call is paid from the month the member already paid for. If the call went badly,
its time can be given back. A host can do that herself until she has collected her share of
that call. After that, today, nobody can, not even you.

After this part you can, from your refund page, with a reason, exactly as for a call paid by
card. **The money for that time then goes back to the member's card.** (Before the host has
collected, time that is given back goes into the membership again, as today.) The host is
told that she owes what her share of that call lost, has 14 days and "I think this is wrong",
and then the app takes it from her balance at Stripe.

A host still cannot do it herself after collecting (the rulebook says why).

## What is there today (read in the code)

- `giveTimeBack` (`src/lib/membership/give-back.ts`): no refund at Stripe. In one database
  step, with the month, the call and the payment locked: the used cents become free again,
  or owed to the member's card when the member can no longer book from that month
  (`giveUsedBack` in `months.ts`; the month's own job, `payback.ts`, then sends that, for a
  month that is running or closed); the payment's `refundedCents` grows, and its fee and
  host's share shrink (two lines in the books); a line is written in `refunds`, done at once.
  It refuses when the share was sent, when the month has a bank dispute, and while a money
  action of the payment is unanswered. A share left with nothing is marked "not owed".
- A member call's payment is a row in `payments` (`kind` "member_call", with the call and the
  month). When the call is worked out it is given the **month's** charge number
  (`stripeChargeId`); it has no PaymentIntent of its own. Its transfer names the month's
  charge as its source, and Stripe lets no more be sent from one charge than was charged.
- The founder's refund page (`/admin/refund`, `src/lib/payments/founder-refund.ts`) finds
  charged **card** payments of a call or a customer, shows what the host would owe, takes a
  ground and a sentence, and reads its answer back from the refund's line (`refundOutcome`,
  `refundAnswer`). The founder's older button on `/admin` gives a full refund with a fixed
  reason, before collection only.
- The take-back for a refund (`src/lib/disputes/takeback.ts`) reads a `refunds` line that is
  `afterCollection` and done. `writeRefundDebt` proves the Host Agreement by the time of the
  charge, which it accepts only if the charge's PaymentIntent is the payment's own: for a
  member's call it never is. `refundStands` is asked **before the take-back is even written**
  and before every taking, and wants Stripe's number of the refund, which a member's time
  never has: such a line would be passed over for ever.

## Decisions (the builder's)

1. **Only the founder, from the founder's refund page, with a ground and a sentence.** The
   page also finds a member's calls. Everywhere else the refusal after collection stays, for
   the host and for the founder.
2. **After collection the money always goes back to the member's card, never into the
   membership again.** If the time were free again, the member could book it a second time,
   and the host's share of that new call would have to come from the same month's charge,
   from which her share of the first call was already sent. Stripe sends no more from a
   charge than was charged, so that second share could be refused for as long as the first
   was not taken back. To the card, the month's money is simply used up once and paid back
   once. (`giveUsedBack` gets a "to the card" mark; nothing changes for a give-back before
   collection.)
3. **`giveTimeBack` takes "after collection" from that page alone.** With it, for a share
   that was sent and a reason: the cents go from "used" to "to be paid back" in the month;
   the payment's fee and share shrink; the share stays "sent", with what was sent, also when
   nothing is left of it; and the line in `refunds` carries what a call's carries:
   `afterCollection`, the share and the fee before and after, what the share lost (not cut
   down to anything), and its place among the payment's refunds after the sending. The form
   says whether the host had collected when it was drawn; if that has changed, a new press
   gives nothing back. The same press again answers with what the first one did.
4. **From that line the take-back that exists does the rest,** with these branches for a
   member's call:
   - `writeRefundDebt`: the charge is the month's, so the PaymentIntent it must belong to is
     the month's (read, never locked: the month's locks come before the payment's). Stripe's
     total of refunds on that charge is not compared with the call's: the call's "refunded"
     is time given back, and what Stripe has refunded on a month's charge is the month's own
     pay-backs.
   - `refundStands`: a member's time given back is no refund at Stripe that could fail later.
     Its line stands while it is done. Only for a member's call: for every other payment a
     line without Stripe's number still proves nothing.
   - `refundTotalsApart`: nothing to compare for a member's call, said outright.
   - `undoFailedRefund`: never for a member's call (it would make the share whole and write
     money back that never moved).
5. **The words.** With decision 2 the host's notice and the take-back's page stay true as
   they are ("Connect has given NAME $X back for the payment for your call ... the money came
   from Connect"). The founder's answer says that it was the member's time, and that its
   money is owed to the member's card and sent there by itself.
6. **Nothing else changes:** a month with a bank dispute is refused; while a taking or a
   sending of that share is unanswered, nothing is given back; a refund request of that call
   counts as answered by the give-back, as today.
7. **No migration.** The phone apps get nothing now.

## Known, and left as it is

- The member's money is owed at once and sent by the month's own job; the host's share comes
  back only after her 14 days, if Stripe can take it. Until then Connect carries it (the same
  risk a call paid by card has).
- Without a published Host Agreement accepted before the month was paid, the take-back is
  written and told, and waits for the founder.
- **A bank dispute lost on a part of the month:** the dispute's take-back is worked out from
  what is left of the month's charge at Stripe at that moment. If a pay-back of the month is
  on its way just then (after a give-back like this one, or any other), it can come out a
  little differently than it would a moment later. That is so today for every pay-back of a
  month; it is not changed here.
- The founder's refund page shows a member's call with the same numbers as a card call
  ("charged", "refunded so far"), with a line that says it is paid from a membership and
  where what is given back goes.

## How it is tried

- Type check, lint, the automatic tests (the founder's answer for a member's call).
- `scripts/member-calls-check.ts --payouts`, in its journey with a real collection: after
  collecting, the host is still refused; the founder is refused without the page's mark,
  without a reason, and from a form drawn before the collection; with all three, it is given
  back: its money is owed to the member's card although the member could still book, once
  however often it is pressed; the share stays "sent" and is smaller, the line has its
  numbers and no refund at Stripe; the helper writes the take-back ("told", with a published
  Host Agreement made up for the run and accepted before the month's charge), it gets its
  day, nothing is taken a second before, and then it is taken out of that call's transfer at
  Stripe; the founder's page finds the call and its answer says time and the member's card;
  the month's six places still add up.
- Unchanged and green: `owed-check`, `membership-check`, `dispute-takeback-check`, the rest
  of `member-calls-check`.

## Astra's check of the first draft (27 November 2026): "not ready", worked in

1. *Time that is free again could be booked again, and the month's one charge could not
   carry the host's share twice.* Decision 2: to the card, always.
2. *`refundStands` is asked before the take-back is written, so the line would never be
   reached; the member's exemption must be by the payment's kind, not by a missing number;
   `refundTotalsApart` and `undoFailedRefund` need it too.* Decision 4.
3. *The month's six places balance; "the money back at once" was wrong for the card.* The
   wording above; the check audits the six places.
4. *A lost dispute on the month uses another denominator, and a pay-back on its way can move
   it.* Under "Known".
5. *The order of locks holds; a form drawn before the collection must not be good for a
   press after it.* Decision 3.
6. *Refund requests keep their meaning.* Decision 6.
7. *The founder's page:* member calls found, the month's bank question read, the kind of
   payment decides the way, the answer says where the time went. Built so; the page's numbers
   keep a card call's words (under "Known").
8. *The first draft named the wrong old form.* Put right under "What is there today".
9. *The checks:* as above. **Not added:** a month's charge nearly used up and booked again
   (decision 2 takes that case away), and a part dispute on the month in both orders (under
   "Known").
