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
  can arrive months later. For some of them the host is asked to choose the answer: her
  time is at most 24 hours from the moment she is asked, less when the bank's deadline is
  near (the server stores it, `askUntil`), and if she is asked and does not choose, Connect
  sends its proof (`src/lib/disputes/rules.ts`).
- **Debts come in more than one kind** (`src/lib/disputes/takeback.ts`). One from a refund,
  for a payment made before the host held a published Host Agreement, is only written down
  ("waiting") and settled by a person; one from a lost dispute is taken by the app after its
  notice ("told"), and only that kind can be objected to. Money can also be owed *to* the
  host, when more was taken than was owed.
- **A collection can be under way when the lock falls:** a transfer that was sent to Stripe
  before, whose answer comes after; the helper's 12-month collection among them.
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
   books as owed, with the reason. The founder sees these in a list on the admin pages.
   **Every** person who deletes an account gets a reference for it, of the same kind,
   whatever they had: it is what they name when they write to support afterwards. What
   exactly could not be sent to her, with its figures, is on the website's confirmation
   screen and in the email she is sent, never in the app's answer: there the reference and
   the general sentences are all there is, the same fields with the same shape for a host
   with unsent money and for a person with none (part 19, decision 3). Her payout account's details are kept until then, and not
   longer.
5. **Her payout account at Stripe is closed** only when Stripe allows it: nothing owed,
   nothing on its way.
6. **When everything of a deletion is settled, that is written down;** part 19c's wiping
   waits for it only for the things that need it.
7. **Decision 2 borrows the helper's own collection, with rules of its own** *(added 27
   November; rewritten after Astra's check)*. The 12-month collection waits for an age, keeps
   a day between tries and gives up for a week after a miss; none of that fits a deletion.
   So a deletion's collection has its own rule for when it runs (as soon as a share is
   ready, and again whenever another becomes ready). **First, whatever was already under way
   is cleared up:** a transfer sent before the lock, by her own press or by the 12-month
   collection, is followed to its answer and never sent again. The two differences of
   decision 2 (every ready cent, no charge) hold only for a collection that was begun for
   the deletion; one begun before it keeps the charge it had.
8. **Money she owes back does not go away with the account** *(added 27 November; rewritten
   after Astra's check; the builder's, and a point for the lawyer)*.
   - **Each debt keeps the state and the direction it has.** One that waits for a person
     stays with that person. One that the app takes goes on along its way: the notice, the
     14 days, her objection, the taking at Stripe. **Money that is owed *to her* has one way to her, and only one.** Some
     of it already has a way of its own: after a dispute is decided for her, or after too
     much was taken, a person at Connect is told to send it by hand. A status that says
     "over", or a message that told the founder to pay, is no proof that she got it. So
     before a deletion's collection takes any such amount in, it is settled which way it
     goes and whether it was already sent by hand; nothing is sent twice, and nothing is
     dropped because its debt looks finished.
   - **A case that had begun counts as hers even if its debt is written later.** A refund
     or a bank dispute that was already under way at the lock belongs to the deletion's
     open cases, whenever the helper gets round to writing the debt down. Otherwise the
     helper's timing would decide who carries it.
   - **What must be kept until the case is over, and only until then:** her email address;
     the notices still waiting to be sent; and the record that ties a delivery report to its
     notice, because the 14 days, and the 3 days after an answer, are counted from delivery
     (part 19c, decisions 3b and 5). Every later notice of that case goes to the address
     kept for it, also after the address on her emptied account has been replaced.
   - **Her objection** comes by email to support, since she can no longer sign in. It counts
     from the moment it **arrived**, not from when a person typed it in: the founder's page
     takes the day **and the time** it came (a day alone cannot tell the two sides of a
     deadline on that day apart), and the taking is put on hold at once. If the money was taken in
     between, it is given back.
   - Her payout account at Stripe is not closed while any of this is open (decision 5).
9. **A debt, or a bank dispute, that begins after the deletion** *(added 27 November; open)*.
   The payment's record is kept, so the app can still work out what she would owe. But there
   is nobody left to tell and, once her payout account is closed, nothing to take it from.
   The builder's first answer: Connect carries it, the books say so with its reason, and the
   founder sees it in the list of decision 4. So that deleting is not a way out of a refund
   that is plainly coming, the confirmation screen tells **every** host, in the same words,
   that payments made in the past can still be disputed by a customer's bank, and the
   lawyer is asked whether a payout account's closing may wait for that time. The sentence
   is general on purpose: a count of her own payments could appear only because of a
   contribution or a tip (part 19, decision 3).
10. **A customer's side** *(added 27 November; rewritten after Astra's check)*. A refund or a
    pay-back to a card can be owed and not yet sent, on its way, paid, or stuck: it can fail
    at Stripe, fall back to "owed", be frozen by a bank dispute, or need a person. None of
    those needs the account to be open, and **none may be lost with it:** each such claim is
    a named open case, kept with what is needed to finish it, until it is paid or a person
    has closed it. An open bank dispute of theirs runs on to its end.

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
  12-month collection would also be due (only this part's collection runs); a transfer the
  12-month collection had sent before the lock, answered after it (followed to its answer,
  with its charge, never sent twice); a debt that waits for a person, one the app takes,
  and money owed to her; a refund under way at the lock whose debt is written a day later
  (hers, not Connect's); an objection that arrived by email on day 13 and was entered on
  day 15 (it counts, and what was taken on day 14 is given back); a customer whose pay-back
  failed at Stripe after the wipe would have run (the claim is still there, and is paid).
- `payments-check`, `refunds-check`, `membership-check`, `contribution-check` unchanged and
  green.

## For the lawyer (added to `docs/for-the-lawyer.md` with this part)

How long may money that could not be sent to a deleted host be kept, and what must she be
told? *Added 27 November:* may Connect keep her email address, and her payout account open,
while she owes money back or while a customer's bank can still dispute a payment; and who
carries a refund or a lost dispute that begins after she has left?

## Keeping the 4.9%

A payout, not a purchase. The waived charge costs Connect at most 25 cents for each
collection made for a deletion, and there can be more than one for a host whose shares
become ready on different days.

## Brought up to date (27 November 2026)

Read again against the code on `main` after pull request 123. What changed in this plan:

1. *The helper can start a collection itself* (plan 46, part 3b). Decision 7 builds on it.
2. *A host can owe money back* (plans 46, 47, 50). Decisions 8 and 9. **Decision 9 is open:**
   what happens to a debt that begins after she has left is for the founder and the lawyer.
3. *Refunds and pay-backs can be on their way for days, or get stuck.* Decision 10.

It goes to Astra with parts 19 and 19c before any of them is built.

## Astra's check of this update (27 November 2026): "not ready", worked in

1. *A 12-month collection can be under way when the lock falls, and its rules do not fit a
   deletion.* Decision 7.
2. *Not every debt is taken after 14 days, and money can be owed to the host.* "What is there
   today"; decision 8.
3. *An objection sent in time could be entered too late, and wiping the delivery records
   would break the deadline.* Decision 8, with part 19c.
4. *A refund is not "arriving" until it has arrived.* Decision 10.
5. *A sentence with her own count of payments could appear only because of a contribution.*
   Decision 9 says it to every host alike.
6. *The time for a bank dispute's choice, and the cost of the waived charge, were put too
   simply.* "What is there today"; "Keeping the 4.9%".

## Astra's second check (27 November 2026): "not ready", worked in

1. *Money owed to a host could be sent twice, or not at all.* Decision 8: one way for each
   amount, settled before a deletion's collection takes it in.
2. *A reference promised "on the confirmation screen" would differ for a host with unsent
   contribution money.* Decision 4: everyone gets one, and the figures are not in the app.
3. *An objection needs its time, not only its day; later notices need the kept address.*
   Decision 8.
4. *The time for a bank dispute's choice is the stored one.* "What is there today".
