# Phone apps, part 19b: deleting your own account (settling the money)

**Status:** a plan only. Written 20 November 2026 by the builder alone. Part of plan 45. Made
when Astra's second check split part 19 again. The "Delete my account" button is still shown
to nobody after this part (see part 19).

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

## How it is tried

- `scripts/delete-account-check.ts` grows: a host with earnings ready (sent, no charge,
  the books say zero); with 25 cents (sent); with earnings not ready yet (sent later by the
  helper); a transfer refused (tried again); a transfer not known (cleared up, never twice);
  without a payout account (listed for the founder, with its reference); a refund request not
  answered (with the founder); a customer with a held call (the hold ends as agreed in part
  19); a member's month; a held contribution.
- `payments-check`, `refunds-check`, `membership-check`, `contribution-check` unchanged and
  green.

## For the lawyer (added to `docs/for-the-lawyer.md` with this part)

How long may money that could not be sent to a deleted host be kept, and what must she be
told?

## Keeping the 4.9%

A payout, not a purchase. The waived charge costs Connect at most 25 cents per deleted host.
