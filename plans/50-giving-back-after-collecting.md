# Plan 50: giving money back after the host has collected it

**Status:** a plan only. Written 26 November 2026 by the builder of plan 46, alone, from the
code on `main` after pull request 107, and from what the founder said that day. To be checked
by Astra before anything is built. It finishes what plan 46, part 3, left open ("3a, step 2c",
and "giving a member's time back after the host collected").

## For the founder: what this is

A host decides her own refunds. That works today, by itself, for a call paid by card, for a
member's call, for a tip and for a contribution to a project, **as long as she has not yet
collected that money.** Once she has pressed "Collect earnings" for it, the app says "this has
to go through support". For a tip or a contribution you can then refund it yourself, and
Connect pays all of it.

After this plan:

- **A host can give money back herself after collecting, too.** The app first takes her share
  of it back from the money she has at Stripe. Only when that has worked does the customer get
  the money (or the member their time). If she does not have enough at Stripe, nothing
  happens and the app tells her so.
- **Connect never pays for a tip or a contribution.** Your own "refund" for one that was
  already collected is closed. A gift that was collected goes back only if its host gives it
  back, or if a bank orders it (and then the host owes it, which plan 47 already built).
- Nobody at Connect has to do anything in any of these cases.

## What the founder said (26 November 2026)

- About a tip or a contribution refunded after the host collected: "the host also pays,
  connect shouldn't pay for this."
- "I thought that the host decides the refund and what to do with it, so that would include
  subscription refund. I don't want to settle any case by hand, everything should be
  automatic, so it should be the best automatic solution."
- Shown the outline of this plan: do it "if you think it is the best".

## What was looked up (26 November 2026)

- **A gift cannot be demanded back.** In law a gift that was given and accepted is the
  receiver's; it goes back only if the receiver agrees. (An open casebook on property law and
  a law firm's article; no court or statute was read, and the law differs by country.)
- **YouTube** calls its tips "voluntary, non-refundable payments" (its own help page).
- **Ko-fi:** the creator decides every refund; Ko-fi cannot refund (its own help page).
- **Buy Me a Coffee, Patreon:** a refund or a lost bank dispute comes out of the creator's
  money, and Patreon refunds only if the creator's balance covers it (their own pages).
- **Not found:** whether the 14-day right in the United Kingdom and Europe covers a tip or a
  contribution. In `docs/for-the-lawyer.md`.

## What is there today (read in the code)

- **Who can refund, and when.** After a call the customer has one day to ask (`ASK_WINDOW_MS`)
  and the host one day to answer; her share cannot be collected before she has answered
  (`COLLECT_AFTER_REQUEST_MS`). A host can also refund with no request at all, from the call's
  page (`refundAction` in `src/app/calls/[id]/actions.ts`).
- **A call paid by card** (`refundPlan` in `src/lib/payments/actions.ts`): once the share was
  sent (`transferStatus === "sent"`), a host is refused: "The host has already been paid for
  this call. A refund now has to go through support." The founder can refund it
  (`afterCollection`): the customer is paid from Connect's money, and the helper writes a
  take-back for what her share lost (`writeRefundDebt` in `src/lib/disputes/takeback.ts`),
  with 14 days' notice and "I think this is wrong".
- **A member's call** (`giveTimeBack` in `src/lib/membership/give-back.ts`): no refund at
  Stripe. The used time becomes free in the month again, or is owed to the member's card when
  they can no longer book from that month. Once the share was sent it refuses everybody, the
  founder included.
- **A tip or a contribution** (`refundContribution` in `src/lib/contributions/refund.ts`):
  before the share is sent, the host or the founder refunds and her share shrinks. After it,
  only the founder can, and the line is marked `connectsOwn`: the whole refund is booked as
  Connect's cost and the host keeps her share.
- **Taking money back from a host** exists: a take-back (`host_debts`) is taken by reversing a
  part of the transfer that carried her share (`takePlan`, `reverseAtStripe`), as a money
  action of its own kind, with recovery when Stripe's answer is not known. A lost bank dispute
  makes one for every kind of share: a call's, a membership month's, a contribution's and a
  tip's (`sharesWithoutRow`).
- **A host's account at Stripe** only receives transfers (`payoutAccountRequest`), Connect
  carries its losses, and Stripe pays its balance out to her bank on Stripe's own schedule.
  So money she collected sits at Stripe for a short while and is then gone to her bank.
  Plan 47 read on Stripe's pages that a balance below zero is made up from later payments and,
  in some countries, from her bank, while Stripe sets the same amount aside from Connect's
  balance and takes it for good after 180 days.

## Decisions (the builder's, on the founder's word; any can be changed)

1. **Her share first, then the customer.** The order is the whole point. If the customer were
   paid first, a host could collect, let Stripe pay her bank, and then "refund" a friend: the
   friend has the money back, she has it too, and Connect has paid. So for a refund the host
   herself decides after collecting, nothing leaves Connect before her share is back.
2. **Never below zero.** Before taking, the app asks Stripe what is available in her balance.
   If that is less than what she must put back, nothing is taken and nothing is refunded. The
   page says how much is there and how much is needed. (Whether Stripe would let the balance
   go below zero for our kind of account is tried in test mode in part 1 and written down;
   the rule holds either way.)
3. **What she puts back** is what her share loses by this refund, worked out as today
   (`splitAfterRefunds`, and `refundOwes` for what was really sent and what is left on the
   transfer). Connect gives its own fee for that part back, as in every refund. If the
   transfer has less room left than she owes, it is refused.
4. **It is built on the take-back that exists,** not beside it: a take-back row that the host
   herself asked for (a new mark on `host_debts`). It has no 14 days, no notice to wait for
   and no "I think this is wrong": she pressed it. It is taken at once, by the same money
   action as every take-back, so everything that guards a reversal today guards this one.
5. **The refund waits for it.** Its line is written in the same step as the take-back, in a
   new state "waiting for the host's share". When the take-back is taken, the line goes on as
   an ordinary refund from there. When Stripe refuses the take-back, both end there: nothing
   was taken, nothing is refunded, and the page says why. When Stripe's answer is not known,
   both wait, the page says "being worked out", and the helper finds out, as for every money
   action.
6. **If her share is back and the customer's refund then fails,** the app keeps trying. A
   contribution's refund is already tried again every hour and never dropped. A call's refund
   gets the same. If Stripe says for good that it cannot pay that card, the app sends her
   share back to her by itself (a new, small money action: a transfer for a take-back that
   fell away) and tells both. Nobody settles it by hand.
7. **The same button, where it is today.** The host's refund form on a call's page, and her
   refund of a tip or a contribution on the project's pages, stop refusing after collection
   and say instead what will happen: "You have collected this money. $X will first be taken
   back from your balance at Stripe; then $Y goes back to (name)." She confirms once more.
8. **Not while a bank is asking.** A payment with an open or lost bank dispute cannot be given
   back this way, as today.
9. **How long after the payment:** up to 90 days after the money was taken from the customer.
   (The builder's number. Card refunds get less reliable with age.)
10. **A tip or a contribution that was collected is no longer refunded from Connect's
    money.** The founder's form for it is closed for a share that was sent, and says who can
    give it back. Old lines marked `connectsOwn` stay as they are in the books. The pages and
    emails that say "only Connect can refund it now" are put right.
11. **The founder's refund of a collected call stays as plan 46 built it** (the customer first,
    from Connect's money; the host owes, with notice and her objection). It is the founder's
    own decision against a host, so the host must be heard first. It is not widened to member
    time, tips or contributions in this plan.
12. **The yearly statement and the books** need no new column: what she puts back is "Taken
    back or paid back" (`host_takeback`), as for every take-back.
13. **The phone apps** get none of this now. A line goes to the phone-apps session.

## The parts

Each part has its own detailed plan, Astra's check, a pull request, and green checks, as usual.

| # | Part | What can be tried when it is done |
| --- | --- | --- |
| 1 | A call paid by card: the host's own refund after collecting. The new mark on a take-back, the waiting refund line, the balance look, the page | A host gives back a collected call; with too little at Stripe nothing happens |
| 2 | A tip and a contribution: the host's own after collecting; the founder's Connect-pays path closed | Connect's cost stays zero |
| 3 | A member's call: time given back after collecting | The time is in the member's month again, or on its way to their card |
| 4 | The failed refund after a share came back: tried again, and the share sent back by itself when it cannot be done | Nothing is left for a person |
| 5 | "Collect and give back": when she has nothing at Stripe but has earnings ready in Connect, one press collects them and gives back from them | It works on most days, not only just after a collection |

Part 2 comes early because it carries the founder's decision. Its first half (closing the
Connect-pays path) is small and could be merged before part 1 if that is wanted.

## What this does not solve, said plainly

- **A host with nothing at Stripe and nothing ready in Connect cannot give back through the
  app.** She no longer has the money with us. The page says so. She and the customer can
  settle it between themselves; Connect is not part of that.
- **Stripe keeps its own card fee on every refund.** That small part is Connect's cost today
  in every refund, before or after collecting, and stays so. For a tip the customer paid that
  fee on top; on a full refund Connect gives it back and does not get it from Stripe. A
  question for the founder, not changed here.
- Between the look at her balance and the taking, Stripe could pay her balance out. Then
  Stripe either refuses the taking (nothing happens) or her balance goes below zero for the
  time Stripe needs to make it up. Part 1 finds out which, and the plan of part 1 says what
  follows.

## How it is tried

- Every existing check stays green: `payments-check --payouts`, `owed-check`,
  `dispute-takeback-check`, `disputes-check`, `contribution-check`, `membership-check`,
  `member-calls-check`, the automatic tests.
- Each part adds cases to the real check scripts, against Stripe's test mode: enough at Stripe
  (taken, then refunded, the books add up); too little (nothing happens, and the sentence);
  pressed twice (once); Stripe's answer lost at each step (the helper finishes it); a refund
  that fails after the share is back (part 4); a part refund, twice; a bank dispute open.
- The pages are walked through in the browser for each part.

## For the lawyer (added to `docs/for-the-lawyer.md` with part 1)

- A collected tip or contribution is final unless its host gives it back or a bank orders it.
  Is that allowed everywhere we have customers, and what must the customer be told before
  paying?
- A host who gives back after collecting agrees on the page to her share being taken from
  her Stripe balance at once, with no 14 days. Is that agreement enough beside the Host
  Agreement, section 9.4?
