# Phone apps, part 19: deleting your own account (the request, the lock, and coming calls)

**Status:** a plan only. Written 20 November 2026 by the builder alone. Part of plan 45. It
carries out plan 39, decision 10. Astra checked it twice ("not ready" both times); after the
second check it is three parts (this one; 19b, settling money; 19c, the wiping) and every
point is worked in (the lists are at the end). The founder: "of course."

## For the founder: what this is

A person deletes their own account, for good, on the website and in the app. Apple and Google
both require it of any app in which an account can be made; Google also wants a page on the
website for it. Today only you can close an account, and closing is a lock that can be undone
and keeps almost everything.

It is built in three parts, and **the "Delete my account" button is shown to nobody until all
three are merged** (it sits behind a switch of yours that is born off). This part is the
first: taking the request, locking the account, and deciding what happens to coming calls.

## What is there today (read in the code)

- `closeAccount` in `src/lib/profiles/closing.ts`: first it marks the account closed and
  saves that; signs it out everywhere; suspends the host profile; ends memberships and
  contributions; deletes the photo (a photo the founder locked is kept). **Then,** in a
  second go that is allowed to fail and only counts what it could not do, it ends waiting
  requests and cancels coming calls **as the founder would, always free**, and takes the
  person out of a call in progress. Run a second time it refuses ("already closed"), so what
  failed is not tried again by itself. It refuses an admin's account. `reopenAccount` only
  lifts the mark.
- Many places already refuse a closed account: signing in (`src/lib/auth.ts`), the gate of
  every page (`src/lib/session.ts`), asking for and accepting a call
  (`src/lib/booking/bookings.ts`).
- Ended memberships are cleaned up by the helper, which also cancels a member's coming calls
  **as the founder, free** (`src/lib/membership/ending.ts`). What a cancellation costs depends
  on the moment it happens (`src/lib/payments/cancel.ts`): free now can be a late charge some
  minutes later, and a call that has started cannot be cancelled at all.

## Decisions (the builder's)

1. **A request to delete is always taken, at once, and dated.** Never "come back later": not
   when money is still waiting, and not during a call.
2. **The lock is the one that exists.** A deleting account is marked closed, so every gate
   that already refuses a closed account refuses it, with no new gate to forget; and it
   carries a second mark, "deleted by its owner", with the date, that never comes off. The
   founder's "reopen" refuses an account with that mark. If the person is in a call at that
   moment, that one call is allowed to finish, and nothing else.
3. **Before confirming, the person is shown what will happen now and cannot be undone,** with
   their own numbers: which coming calls are cancelled and what each costs or gives back;
   which memberships end; what a host is still owed and how it will reach her (part 19b);
   what is wiped and what is kept and for how long (part 19c); and how long it takes.
4. **Confirming:** with the password (and the two-step code if there is one). An account
   without a password (made with Google) is sent a link that works once and for a short
   time; opening it only shows the same final screen, and the deletion needs a deliberate
   press there. Opening the link by itself deletes nothing.
5. **At the moment of confirming, the costs are worked out again.** If any has changed since
   the screen was shown (a free cancellation has become a late one), nothing is done and the
   new numbers are shown, to be confirmed again. **What was agreed is then written down for
   each coming call, as of that moment:** free, or a late charge of so much, or membership
   time used or given back. Whoever carries the cancellation out, the helper minutes later
   included, carries out what was written down, not what the clock says by then.
6. **By whose rules:** a customer's call as if they had pressed Cancel; a member's call as a
   member's own cancellation; a host's calls free for her customers. The helper's clean-up of
   memberships reads what was written down instead of cancelling "as the founder, free".
7. **There is no "keep my account" afterwards.** Calls cancelled, memberships ended and a
   photo deleted cannot be brought back. The screen says "this cannot be undone" once,
   clearly, before the confirmation, and means it.
8. **The work is written down step by step and finished by the helper.** If anything stops
   halfway, the helper carries on from the last finished step until everything is done, and
   never does a step twice.
9. **Where it is:** "Delete my account" at the bottom of the account page, on the website and
   in the app. The website's page has a plain address of its own that says what it is, so it
   can be the page Google wants linked from the store listing; it asks the person to sign
   in, and works without the app. An admin's account is not deleted this way. The founder's
   own "close" stays as it is.

## How it is tried

- A new check script, `scripts/delete-account-check.ts`: a customer with nothing; with a call
  inside the late-cancel time and outside it; a cancellation that turned from free to charged
  between the screen and the press (shown again), and between the press and the helper (the
  written outcome holds); a member with a booked call while the membership clean-up runs at
  the same moment, both ways round; a host with coming calls; during a call (that call
  finishes, nothing else can start); a stop in the middle of each step; an admin (refused);
  a wrong password; an account without a password, the link opened twice and after its time;
  the founder's "reopen" refused; every gate that refuses a closed account also refuses this
  one (signing in, asking, accepting, joining another call).
- Every existing check script unchanged and green, since the founder's closing is not changed.
- On the website in a browser and on the Android test phone, with pictures (with the switch
  on in the test database only): the screen before confirming, with real numbers.

## For the lawyer (added to `docs/for-the-lawyer.md` with this part)

May a late cancellation be charged when the cancelling happens because the customer deletes
their account (already there from plan 39)?

## Keeping the 4.9%

No purchase. Both stores require this; without it the app would be refused whatever its
payment rules.

## Astra's first check (20 November 2026): "not ready", worked in

1. *Refusing to delete while money is waiting cannot work.* The request is always taken.
2. *A step that fails is never tried again today, and the helper cancels a member's calls for
   free.* Decisions 6 and 8.
3. *"Keep my account" could not keep anything.* Removed.
4. *Google's page must be recognisable and work without the app.* Decision 9.

## Astra's second check, the same day: "not ready", worked in

1. *A mark of its own would have left the existing gates treating the person as open.*
   Decision 2: the existing lock, plus a mark that never comes off.
2. *The helper, running minutes later, could turn a free cancellation into a late charge.*
   Decision 5: checked again at the press, and written down per call.
3. *An emailed link must not delete by being opened.* Decision 4.
4. *Still too big for one pull request.* Settling money is now part 19b, and nobody sees the
   button until all three parts are in.
