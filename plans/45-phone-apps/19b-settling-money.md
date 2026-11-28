# Phone apps, part 19b: deleting your own account (settling the money)

**Status:** a plan only. Written 20 November 2026 by the builder alone. Part of plan 45. Made
when Astra's second check split part 19 again. The "Delete my account" button is still shown
to nobody after this part (see part 19). Brought up to date on 27 November 2026, after the
website changed (the list is at the end); it goes to Astra again, with parts 19 and 19c,
before it is built.

## For the founder: what this is

After a person has asked to delete their account (part 19), whatever money is still open is
finished properly: holds, refunds, a host's last earnings. Nobody loses money because someone
left, and a host does not have to sign in again to get hers.

## What is there today (read in the code)

- A host's earnings are sent only by a collection (`collectEarnings` in
  `src/lib/payments/collect.ts`): not more often than every 24 hours, and
  `collectionAmounts` (`src/lib/payments/pricing.ts`) refuses any total of 25 cents or less,
  since the collection charge would eat it. The charge is up to 25 cents and is written into
  the books with each transfer. A transfer can be refused or its outcome not known yet.
- The founder can make a final collection for a closed host (`collectForClosedHost`), to her
  own payout account.
- Money can be held with no date: a bank dispute, a payout account that is not ready, a
  refund request the host has not answered (the founder can close one that is never
  answered).
- A cancelled call's hold or charge is finished by the helper (`src/lib/payments/jobs.ts`),
  as are membership months and held contributions.
- **The helper can already start a collection itself** (plan 46, part 3b;
  `src/lib/payments/uncollected.ts`): for a host with no collection in 12 months it runs the
  whole of what her button runs, written down as started by the helper, with the usual
  charge. It never touches a closed account.
- **Money a host owes back** (`host_debts`; plans 46, 47 and 50): after Connect refunds a
  payment she had collected, or a bank dispute over it is lost. She is told by an email whose
  arrival is recorded; nothing is taken before 14 days after that; she can object; then
  Connect asks Stripe to take the amount back out of what it sent her. Such a debt can
  **begin after she has left**: a refund or a lost dispute over an old payment.
- **A bank dispute** (plan 47) can be open on a payment of a deleting customer or host, and
  can arrive months later. A host has 24 hours to choose how to answer one.
- **Refunds and pay-backs to a card** can be "on its way" for days; the helper finishes them
  and never sends an old request again after standing still too long (pull requests 113,
  116 and 121).
- **Tips** (plan 44) are collected with the rest of a host's earnings.

## Decisions (the builder's)

1. **Holds, charges and refunds of a deleting person's calls are finished by the code that
   finishes them today.** Nothing new is built for them; the check script proves each one
   ends.
2. **A host's last earnings are sent to her without her signing in.** Whenever some become
   ready, the helper makes a collection to her own payout account, written into the record
   as started by the helper for a deletion. **For such a collection only:** every ready cent
   is sent, even 25 cents or less, and no collection charge is taken; the books show a charge
   of zero on each transfer. Shares that become ready later, or were refused, are tried again;
   a transfer whose outcome is not known is cleared up first, never sent a second time.
3. **A refund request she had not answered** goes to the founder, as one that is never
   answered does today.
4. **What truly cannot be sent** (no working payout account, an open dispute) stays in the
   books as owed, with the reason. The founder sees these in a list on the admin pages. The
   person was told beforehand, on the confirmation screen, and has a reference number to
   claim it through support. Her payout account's details are kept until then, and not
   longer.
5. **Her payout account at Stripe is closed** only when Stripe allows it: nothing owed,
   nothing on its way.
6. **When everything of a deletion is settled, that is written down;** part 19c's wiping
   waits for it only for the things that need it.
7. **Decision 2 is built on the helper's own collection that now exists** *(added 27
   November)*, with its two differences for a deletion: every ready cent, and no charge.
   The 12-month collection keeps leaving closed accounts alone; a deleting host's money is
   this part's, and the two never run for the same host.
8. **Money she owes back does not go away with the account** *(added 27 November; the
   builder's, and a point for the lawyer)*. A debt that is open at the deletion stays open
   and takes the way it has: the notice, the 14 days, her objection, the taking at Stripe.
   Three things follow. Her email address is kept for it, and only for it, until it is over
   (part 19c counts an open debt as "a named open case"): the notice and our answers have to
   reach her, and she can no longer sign in. Her objection comes by email to support and is
   entered by a person at Connect, on the founder's pages. And her payout account at Stripe
   is not closed while a debt is open (decision 5 already waits for "nothing owed").
9. **A debt, or a bank dispute, that begins after the deletion** *(added 27 November; open)*.
   The payment's record is kept, so the app can still work out what she would owe. But there
   is nobody left to tell and, once her payout account is closed, nothing to take it from.
   The builder's first answer: Connect carries it, the books say so with its reason, and the
   founder sees it in the list of decision 4. A host must not be able to delete her account
   to walk away from a refund that is plainly coming, so the confirmation screen names every
   payment of hers that is still inside a bank's dispute time only as a number ("some of your
   past payments can still be disputed by a customer's bank"), and the lawyer is asked
   whether her payout account's closing may wait for that time.
10. **A customer's side** *(added 27 November)*: a refund or pay-back on its way to their
    card is finished by the helper as today, and needs nothing from the account. An open
    bank dispute of theirs runs on to its end.

## How it is tried

- `scripts/delete-account-check.ts` grows: a host with earnings ready (sent, no charge,
  the books say zero); with 25 cents (sent); with earnings not ready yet (sent later by the
  helper); a transfer refused (tried again); a transfer not known (cleared up, never twice);
  without a payout account (listed for the founder, with its reference); a refund request not
  answered (with the founder); a customer with a held call (the hold ends as agreed in part
  19); a member's month; a held contribution; a host with a debt in each state it can have
  at the deletion (told, objected, answered, being taken, waiting): each stays open, her
  address is kept for it and removed when it is over, and her payout account is not closed
  before; a refund of an old payment after the deletion (carried by Connect, in the
  founder's list); a customer with a pay-back on its way (it arrives); a host for whom the
  12-month collection would also be due (only this part's collection runs).
- `payments-check`, `refunds-check`, `membership-check`, `contribution-check` unchanged and
  green.

## For the lawyer (added to `docs/for-the-lawyer.md` with this part)

How long may money that could not be sent to a deleted host be kept, and what must she be
told? *Added 27 November:* may Connect keep her email address, and her payout account open,
while she owes money back or while a customer's bank can still dispute a payment; and who
carries a refund or a lost dispute that begins after she has left?

## Keeping the 4.9%

A payout, not a purchase. The waived charge costs Connect at most 25 cents per deleted host.

## Brought up to date (27 November 2026)

Read again against the code on `main` after pull request 123. What changed in this plan:

1. *The helper can start a collection itself* (plan 46, part 3b). Decision 7 builds on it.
2. *A host can owe money back* (plans 46, 47, 50). Decisions 8 and 9. **Decision 9 is open:**
   what happens to a debt that begins after she has left is for the founder and the lawyer.
3. *Refunds and pay-backs can be on their way for days.* Decision 10.

It goes to Astra with parts 19 and 19c before any of them is built.
