# Phone apps, part 19: deleting your own account (the request, and settling what is open)

**Status:** a plan only. Written 20 November 2026 by the builder alone. Part of plan 45. It
carries out plan 39, decision 10. Astra checked the first draft ("not ready"); it was split
in two (this part, and 19b: the wiping) and every point is worked in (the list is at the
end). The founder: "of course."

## For the founder: what this is

A person deletes their own account, for good, on the website and in the app. Apple and Google
both require it of any app in which an account can be made; Google also wants a page on the
website for it. Today only you can close an account, and closing is a lock that can be undone
and keeps almost everything.

This part is the first half: taking the request, stopping everything new, and settling calls
and money fairly. Part 19b is the second half: wiping the personal details. Both touch money
and people's data more than any other part, and both have points that wait for the lawyer.

## What is there today (read in the code)

- `closeAccount` in `src/lib/profiles/closing.ts`: first it marks the account closed and
  saves that; signs it out everywhere; suspends the host profile; ends memberships and
  contributions; deletes the photo (a photo the founder locked is kept). **Then,** in a
  second go that is allowed to fail and only counts what it could not do, it ends waiting
  requests and cancels coming calls **as the founder would, always free**, and takes the
  person out of a call in progress. Run a second time it refuses ("already closed"), so what
  failed is not tried again by itself. It refuses an admin's account. `reopenAccount` only
  lifts the mark; it brings back nothing that was ended.
- Ended memberships are cleaned up by the helper, which also cancels a member's coming calls
  **as the founder, free** (`src/lib/membership/ending.ts`); contributions likewise
  (`src/lib/contributions/ending.ts`). Both try again until done.
- A closed account cannot sign in at all (`src/lib/auth.ts`).
- A host's earnings are sent only by a collection. A host with exactly 25 cents ready can
  never collect it; a bank dispute, a payout account that is not ready, a transfer whose
  outcome is not known, or a refund request she has not answered can hold money with no date.
  The founder can make a final collection for a closed host (`collectForClosedHost`).

## Decisions (the builder's)

1. **A request to delete is always taken, at once, and dated.** Never "come back later":
   not when money is still waiting, and not during a call (then it takes effect when that
   call is over, and the person is told so). From that moment the account is in a state of
   its own, "being deleted", different from the founder's "closed".
2. **Before confirming, the person is shown exactly what will happen now and cannot be
   undone,** with their own numbers: which coming calls are cancelled and what each costs or
   gives back; which memberships end; what a host is still owed and how it will reach her;
   what is wiped and what is kept and for how long (part 19b); and that it usually takes a
   few days and at most a stated time. They confirm with their password (and two-step code if
   they have one); an account without a password (made with Google) confirms through a link
   sent to its email address.
3. **There is no "keep my account" afterwards.** The first draft had one. It would have been
   a false comfort: calls cancelled, memberships ended and a photo deleted cannot be brought
   back, and a closed account cannot sign in to ask. So the screen says "this cannot be
   undone" once, clearly, before the confirmation, and means it.
4. **At once:** signed out everywhere; nothing new can be started by or with this person;
   waiting requests end; her page disappears; memberships and contributions end as they do
   on closing.
5. **Coming calls are cancelled by the rules of the person who is deleting, by every piece
   of code that might do it.** A customer's call is cancelled as if they had pressed Cancel:
   a late cancellation costs what it would have cost. A member's call is cancelled as a
   member's own cancellation is. A host's calls are cancelled free for her customers. The
   request records which rule applies, and the helper's clean-up of memberships reads that
   record instead of cancelling "as the founder, free", so the two can never disagree about
   who pays.
6. **The work is written down step by step and finished by the helper.** The request, its
   date, and each step done are saved. If anything stops halfway (a crash, Stripe not
   answering), the helper carries on from the last finished step until everything is done,
   and never does a step twice. Held cards, membership months, refunds, calls and transfers
   keep what they need to be finished.
7. **Money owed to a host is sent to her without her having to sign in.** When her earnings
   become ready, the helper makes her last collection to her own payout account. The 25-cent
   charge is not taken from a last collection, so a small balance can be sent too. A refund
   request she had not answered goes to the founder to decide, as an unanswered one does
   today. Whatever truly cannot be sent (no payout account, a dispute still open) stays in
   the books under a record of what is owed and why, the founder sees it in a list, and the
   person was told beforehand how to claim it through support.
8. **Where it is:** "Delete my account" at the bottom of the account page, on the website and
   in the app. The website's page has its own plain address that says what it is, so it can
   be the page Google wants linked from the store listing; it asks the person to sign in, and
   works without the app. An admin's account is not deleted this way. The founder's own
   "close" stays as it is.

## How it is tried

- A new check script, `scripts/delete-account-check.ts`: a customer with nothing; with a call
  inside the late-cancel time (charged) and outside it (free); a member with a booked call,
  with the helper's membership clean-up running at the same moment (the outcome must be the
  member's own, both ways round); a host with coming calls (customers pay nothing), with
  earnings ready, not ready yet, with exactly 25 cents, with a refund request not answered,
  without a payout account; during a call; a stop in the middle of each step, and the helper
  finishing it once; Stripe answering after the lock; an admin (refused); a wrong password;
  an account without a password.
- Every existing check script unchanged and green, since the founder's closing is not changed.
- On the website in a browser and on the Android test phone, with pictures: the screen before
  confirming, with real numbers, and the journey to "your request was taken".

## For the lawyer (added to `docs/for-the-lawyer.md` with this part)

May a late cancellation be charged when the cancelling happens because the customer deletes
their account (already there from plan 39)? How long may money that could not be sent to a
deleted host be kept, and what must she be told? Is "at most 30 days, longer only while money
is being settled" an acceptable promise?

## Keeping the 4.9%

No purchase. Both stores require this part; without it the app would be refused whatever its
payment rules.

## Astra's check (20 November 2026): "not ready", now worked in

1. *Refusing to delete while money is waiting cannot work:* some money has no date, and 25
   cents can never be collected. The request is always taken; money is settled after.
   Decisions 1 and 7.
2. *A step that fails is never tried again today, and the helper cancels a member's calls for
   free, which could beat the customer's own rule.* Decisions 5 and 6.
3. *"Keep my account" could not keep anything, and a closed account cannot sign in to use
   it.* Decision 3: removed.
4. *Seven days was only a guess, and the stores ask for a stated time and a confirmation.*
   Decision 2 here, and part 19b.
5. *Google's page must be recognisable and work without the app.* Decision 8.
6. *The list of what is wiped missed most of the data.* Part 19b.
