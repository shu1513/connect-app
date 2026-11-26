# Plan 50: money given back after the host has collected it

**Status:** a plan only. Written 26 November 2026 by the builder of plan 46, alone, from the
code on `main` after pull request 107, and from what the founder said that day. Astra checked
the first draft that day and said **"not ready"**; this is the plan as rewritten after that
check (what Astra found is at the end). Parts 1 and 2 each get a code-level plan of their own,
shown to Astra before they are built. It finishes what plan 46, part 3, left open ("3a, step
2c", and "giving a member's time back after the host collected").

## For the founder: what this is

A host decides her own refunds. That works today, by itself, for a call paid by card, for a
member's call, for a tip and for a contribution to a project, **as long as she has not yet
collected that money.** Two things are wrong once she has:

- **A tip or a contribution** that Connect then refunds is paid entirely from Connect's money,
  and the host keeps her share. You decided: the host pays, not Connect.
- **A member's call:** nobody can give that time back any more, not even you.

After this plan, a refund that Connect gives after the host collected works the same way for
all four kinds of payment, the way it already works for a call paid by card: the customer
gets the money (or the member their time), the host is told she owes her share back, she has
14 days and a button to say it is wrong, and then the app takes it from her balance at
Stripe. A person is needed only where a call needs one today: a host who had not accepted a
published Host Agreement before that payment, and a host whose balance Stripe cannot reach
for 30 days.

**What this plan does not build:** a button for the host herself to give money back after
she has collected. The first draft had it. Astra's check showed it cannot be made safe yet;
the reasons are under "Left out, and why". A host can still refund by herself at any time
before she collects, and collecting is always her own press.

## What the founder said (26 November 2026)

- About a tip or a contribution refunded after the host collected: "the host also pays,
  connect shouldn't pay for this."
- "I thought that the host decides the refund and what to do with it, so that would include
  subscription refund. I don't want to settle any case by hand, everything should be
  automatic, so it should be the best automatic solution."
- On the host's own give-back after collecting: "is it to leave it alone for now? ... or you
  can do [it] if you think it is the best." The builder first said "build it", and after
  Astra's check says: leave it for now.

## What was looked up (26 November 2026)

- **A gift cannot be demanded back.** In law a gift that was given and accepted is the
  receiver's; it goes back only if the receiver agrees. (An open casebook on property law and
  a law firm's article; no court or statute was read, and the law differs by country.)
- **YouTube** calls its tips "voluntary, non-refundable payments" (its own help page).
- **Ko-fi:** the creator decides every refund; Ko-fi cannot refund (its own help page).
- **Buy Me a Coffee, Patreon:** a refund or a lost bank dispute comes out of the creator's
  money (their own pages).
- **Not found:** whether the 14-day right in the United Kingdom and Europe covers a tip or a
  contribution. In `docs/for-the-lawyer.md`.

So the draft Host Agreement already says the right thing (section 8.4: giving a tip or a
contribution back is the host's decision, with the named cases in which Connect decides; 8.5:
a refund comes out of her share and our fee, and if she had collected she owes it back). The
app does not do what 8.5 says for a tip or a contribution. Part 1 makes it.

## What is there today (read in the code)

- **Who can refund, and when.** The customer's time to ask counts from the call's start
  (`moneyTiming` in `src/lib/payments/rules.ts`); a share with an unanswered request cannot be
  collected (`requestHolds`). A host can also refund with no request at all, from the call's
  page (`refundAction` in `src/app/calls/[id]/actions.ts`), a tip from the same page
  (`refundTipAsHostAction` in `src/app/tips/actions.ts`), a contribution from her project's
  page.
- **A call paid by card** (`refundPlan` in `src/lib/payments/actions.ts`): once the share was
  sent, a host is refused ("has to go through support"). The founder can refund it
  (`afterCollection`): the customer is paid from Connect's money; when Stripe confirms, what
  her share lost is written on the refund (`applyRefundDone`); the helper writes a take-back
  (`writeRefundDebt` in `src/lib/disputes/takeback.ts`), which the app takes by itself only
  where the Host Agreement was in force for that payment and the notice was delivered.
- **A tip or a contribution** (`refundContribution` in `src/lib/contributions/refund.ts`): a
  refund is a line that is "owed", sent by the helper and tried again until it is done. After
  the share was sent only the founder can refund, the line is marked `connectsOwn`, the whole
  refund is booked as Connect's cost, and her share is not touched.
- **A member's call** (`giveTimeBack` in `src/lib/membership/give-back.ts`): no refund at
  Stripe. Used time becomes free in the month again, or is owed to the member's card when
  they can no longer book from that month (`giveUsedBack`). Once the share was sent it
  refuses everybody.
- **A lost bank dispute** already makes a take-back for every kind of share, a tip's and a
  contribution's included (`sharesWithoutRow`).

## Decisions

1. **A refund Connect gives after the host collected makes the host owe her share back, for
   every kind of payment** (the founder's). This is decision 8 of
   `plans/46-part-3-money-owed.md`, which Astra checked with that plan and which was then left
   unbuilt for a tip and a contribution.
2. **The customer is paid first, from Connect's money, as for a call today.** It is the
   founder's own decision against a host, in the cases the Host Agreement names, so the host
   must be told and heard before anything is taken: 14 days from the notice's arrival, "I
   think this is wrong", the founder's answer. If Stripe cannot take it back, it is tried
   again every day, and the founder is told after 30 days. So Connect can still end up
   carrying an amount a host never puts back; that is the risk a call has today.
3. **No new `connectsOwn` lines.** Lines already written keep their treatment in the books.
4. **The founder's form says what will happen** before the press: what goes back to the
   customer, what the host will owe, and that she is told and can object.
5. **A member's call:** the founder can give its time back after the host collected, and the
   host owes what her share of that call lost. A host who wants to give time back after
   collecting writes to us, and that one press does it.
6. **The phone apps** get none of this now. The take-back's screen of plan 45, part 16b,
   will show these like any other.

## The parts

| # | Part | What can be tried when it is done |
| --- | --- | --- |
| 1 | A tip and a contribution refunded by the founder after collection: the take-back for a contribution's refund line, its late failure, its room on the transfer, the pages and words | Connect's cost for it is zero once the host has put it back |
| 2 | A member's call: time given back by the founder after collection, and the take-back for it | The time is in the member's month again, or on its way to their card, and the host owes her share |

Each part: a code-level plan shown to Astra, the build, Astra's review of the code, a pull
request with CodeRabbit's review, the real check scripts against Stripe's test mode
(`contribution-check`, `tip-check`, `dispute-takeback-check`, `owed-check`,
`payments-check --payouts`, `member-calls-check`), and the pages walked through in the browser.

## Left out, and why: the host's own give-back after collecting

The first draft let a host refund by herself after collecting, with her share taken back
first and the customer paid only then. The order is right: if the customer were paid first, a
host could collect, let Stripe pay her bank, and then "refund" a friend, and Connect would
have paid. Astra's check found that it is not ready to build:

1. **It is not proven that Stripe refuses to take money a host no longer has.** Plan 47 saw
   two reversals go through with nothing available in the host's balance. If Stripe lets the
   balance go below zero and sets the amount aside from Connect's own balance, a look at her
   balance beforehand is the only guard, and a look is not a lock: Stripe can pay her bank
   between the look and the taking. This has to be tried in test mode on an account that was
   paid out, before any design is chosen.
2. **The amount must be fixed before the taking,** and today it is worked out only when
   Stripe confirms the refund. A take-back that is cut down to the room left on the transfer
   would leave Connect paying the difference.
3. **Almost every guard of a take-back assumes a refund that is done:** its due day, the look
   whether the refund still stands, what happens when Stripe says no, a reversal somebody
   made by hand, the founder's buttons to waive or settle. Each needs its own branch.
4. **Between "her share is back" and "the customer is paid" a bank dispute or a failure can
   arrive.** Sending her share back to her by itself can then meet a late confirmation or a
   second try, and money would go out twice.
5. **"Collect and give back in one press" is a trap:** a collection takes all ready shares,
   uses up her one collection of the day and its charge, and can end unanswered, with nothing
   to give back from.
6. A tip, a contribution and a member's call each end differently and need their own path.

Until a safe way is found, the app keeps refusing, and says so truthfully. A direction worth
looking at later is the one other sites use: give back from earnings she has **not** collected
yet, so that nothing has to come back from Stripe at all.

## What Connect still carries

- **Stripe keeps its own card fee on every refund.** That small part is Connect's cost today
  in every refund, before or after collecting. For a tip the customer paid that fee on top; on
  a full refund Connect gives it back and does not get it from Stripe. A question for the
  founder; not changed here.
- An amount a host never puts back (decision 2).

## For the lawyer (added to `docs/for-the-lawyer.md` with part 1)

- A tip or a contribution is a gift. In which of the cases of section 8.3 may Connect refund
  one against the host's will after she has collected it, and take her share back?
- Does the 14-day right in the United Kingdom and Europe cover a tip or a contribution?

## Astra's check of the first draft (26 November 2026): "not ready"

Every point is under "Left out, and why", which is where the first draft's idea went. Astra
also corrected the first draft's account of today's code (the customer's time counts from the
call's start; a tip is refunded from the call's page; the founder's refund of a collected
call is taken back by the app only with the agreement in force and a delivered notice; "zero
cost" is true of the refund itself, not of Stripe's fee). Those are put right above.
