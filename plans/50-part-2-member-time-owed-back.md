# Plan 50, part 2: a member's time given back by Connect after the host collected

**Status:** a code-level plan, written 27 November 2026 by the builder alone from the code on
`main` after pull request 111. To be checked by Astra before it is merged. The rulebook is
`plans/50-giving-back-after-collecting.md`; part 1 (`plans/50-part-1-gifts-owed-back.md`) is
merged.

## For the founder: what this is

A member's call is paid from the month the member already paid for. If the call went badly,
its time can be given back: it is in the member's membership again, or, when they can no
longer book from that month, its money goes back to their card. A host can do that herself
until she has collected her share of that call. After that, today, nobody can, not even you.

After this part you can, from your refund page, with a reason, exactly as for a call paid by
card. The member gets the time (or the money) back at once. The host is told that she owes
what her share of that call lost, has 14 days and "I think this is wrong", and then the app
takes it from her balance at Stripe.

A host still cannot do it herself after collecting (the rulebook says why).

## What is there today (read in the code)

- `giveTimeBack` (`src/lib/membership/give-back.ts`): no refund at Stripe. In one database
  step, with the month, the call and the payment locked: the used cents become free again,
  or owed to the member's card (`giveUsedBack` in `months.ts`; the month's own job then sends
  that); the payment's `refundedCents` grows, and its fee and host's share shrink (two lines
  in the books); a line is written in `refunds`, done at once. It refuses when the share was
  sent, when the month has a bank dispute, and while a money action of the payment is
  unanswered. A share left with nothing is marked "not owed".
- A member call's payment is a row in `payments` (`kind` "member_call", with the call and the
  month). When the call is worked out it is given the **month's** charge number
  (`stripeChargeId`); it has no PaymentIntent of its own.
- The founder's refund page (`/admin/refund`, `src/lib/payments/founder-refund.ts`) finds
  charged **card** payments of a call or a customer, shows what the host would owe, takes a
  ground and a sentence, and reads its answer back from the refund's line (`refundOutcome`,
  `refundAnswer`). The form on a call's own page lets the founder give time back too, with no
  ground, and only before collection.
- The take-back for a refund (`src/lib/disputes/takeback.ts`) reads a `refunds` line that is
  `afterCollection` and done. `writeRefundDebt` proves the Host Agreement by the time of the
  charge, which it accepts only if the charge's PaymentIntent is the payment's own: for a
  member's call it never is, so such a take-back would always be "waiting".
  `refundStands` (asked before every taking) wants Stripe's number of the refund, which a
  member's time never has.

## Decisions (the builder's)

1. **Only the founder, from the founder's refund page, with a ground and a sentence.** The
   page also finds a member's calls. The form on the call's own page keeps refusing after
   collection, for the host and for the founder (it has no ground to give).
2. **`giveTimeBack` takes "after collection" from that page alone.** With it, for a share
   that was sent and a reason: the time goes back as before (free again, or to the card);
   the payment's fee and share shrink; the share stays "sent" (it is never marked "not
   owed"); and the line in `refunds` carries what a call's carries: `afterCollection`, the
   share and the fee before and after, what the share lost, and its place among the payment's
   refunds after the sending. Everything in the one step that exists.
3. **From that line the take-back that exists does the rest,** with two branches for a
   member's call:
   - `writeRefundDebt`: the charge is the month's, so the PaymentIntent it must belong to is
     the month's. Stripe's total of refunds on that charge is **not** compared with the
     payment's: no refund at Stripe is part of giving time back, and what Stripe has refunded
     on a month's charge is the month's own pay-backs, a different thing.
   - `refundStands`: a member's time given back has no refund at Stripe that could fail
     later. Its line stands while it is done.
4. **The words say "time".** The host's notice and the take-back's page say "Connect has
   given NAME membership time worth $X back for (the call)", not "$X back ... the money came
   from Connect". The founder's answer says where the time went (into the membership, or its
   money to the member's card).
5. **Nothing else changes:** a month with a bank dispute is refused; while a taking or a
   sending of that share is unanswered, nothing is given back; the same press twice gives
   back once; time that is free again can be booked again, and that new call earns the host a
   new share.
6. **No migration.** The phone apps get nothing now.

## Known, and left as it is

- The member has the time back at once, and the host's share comes back only after her 14
  days, if Stripe can take it. Until then Connect has in effect paid twice for that time (the
  same risk a call paid by card has).
- Without a published Host Agreement accepted before the month was paid, the take-back is
  written and told, and waits for the founder.

## How it is tried

- Type check, lint, the automatic tests (the founder's answer for a member's call; the words).
- `scripts/member-calls-check.ts --payouts`, in its journey with a real collection: after
  collecting, the host is still refused; the founder without the page's mark is refused; with
  it and a reason, time is given back: the member's month has it again, the share stays
  "sent" and is smaller, the line has its numbers; the helper writes the take-back ("told",
  with a published Host Agreement made up for the run and accepted before the month's
  charge), it gets its day, and is taken out of the transfer at Stripe; the same press again
  changes nothing; the founder's page finds the call and its answer says "time".
- Unchanged and green: `owed-check`, `payments-check --payouts`, `membership-check`,
  `dispute-takeback-check`.
