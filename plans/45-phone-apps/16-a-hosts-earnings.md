# Phone apps, part 16: a host's earnings

**Status:** a plan only. Written 20 November 2026 by the builder alone. Part of plan 45. Astra
checked it once ("ready with changes"); its points are worked in (the list is at the end).
Brought up to date on 27 November 2026, after the website changed (that list is at the end
too).

## For the founder: what this is

A host sees what she has earned, what is ready, and presses "Collect earnings", as on the
website (plan 14).

## What is there today (read in the code)

`src/app/host/earnings.tsx`, `collectEarningsAction`, and `collectEarnings`, `unsentEarnings`
in `src/lib/payments/collect.ts`:

- A host's share of a call is ready 24 hours after the call ends; with a refund request, 2
  days **at the earliest**, and not before she has answered it. Collecting is possible once
  every 24 hours, costs 25 cents, and needs more than 25 cents to be ready. Nothing is sent
  automatically. Not possible while the payout account is not ready, or while a bank dispute
  is waiting for her.
- The box shows what is ready and what is still waiting, line by line, and the amount she
  will receive beside one button. A collection has a number of its own, so pressing twice is
  one collection; it can go through in part, be refused, or be not known yet. Money for a
  host abroad has its own wording (plan 27).
- **A collection Connect starts itself** (plan 46, part 3b; `src/lib/payments/uncollected.ts`):
  when a host has had no collection go through for 12 months, the helper runs the very
  collection her button runs, with the usual charge, and she is told what was really sent
  (a message "From Connect" and its email). The box marks such a collection with its own
  sentence (`STARTED_BY_CONNECT`) and does not say "You do not need to press again" for it.
- **What the last collection says** has more cases than before: nothing answered yet, an
  amount still being checked, only the collection charge still being checked, and an amount
  that "was not sent in this collection".
- **In the same box: "Money you owe back, or that was taken back"** (plans 46, 47 and 50).
  That list and its screens are part 16b. A debt does not hold a collection back: nothing is
  kept from "Collect earnings" because of it.
- **The yearly statement** (`/host/statement`, `src/lib/payments/statement.ts`; plan 46, part
  5): for one calendar year, month by month, what customers paid, what was given back, what
  Connect carried itself, Connect's fees, her share, and what was sent to her; then "What
  customers paid for" split into calls, memberships, contributions and tips; and what each
  column means. A summary for her own records, not a tax form. **No part of plan 45 had it.**
- The lines are calls, membership months, and, from the website, contributions and tips
  (plan 44 is merged). **The function that reads them hands back whole records, a
  project's name among them.** The website's "ready" amount is right, but its caption calls
  every line without a call "expired member time", a contribution included.

## Decisions (the builder's)

1. **One address for what the box shows, one for "Collect earnings",** on the same functions.
   Every amount, what is ready, and when the next collection is possible come from the
   server.
2. **The app's answer is built field by field.** Money from calls is shown as calls. Money
   from memberships is shown as memberships while memberships are on for the apps, and inside
   "Other earnings" when they are not. **Money from contributions and tips is always inside
   "Other earnings":** one line in "ready" and one in "waiting", an amount each, no name, no
   project, no word about what it was, and no way to it. This is the one place where the app
   shows something that came from a project, and the reason is an honest total: it is her
   money, and she collects it with the rest. The server puts each line in its right group
   itself; the website's wrong caption is put right too (the caption only; its amounts are
   correct).
3. **"Collect earnings" asks once more,** with the amount she will receive and the charge as
   the server worked it out (up to 25 cents; less when what is ready is made of very small
   shares). The website has one button; on a phone a touch by mistake is easier. Pressing twice is
   one collection. "In part", "refused" and "not known yet" are shown as that.
4. **Not possible?** The app says which reason the server gave and leads to the payout
   account (part 14b) only when that is the reason.
5. **A collection Connect started** is shown with the server's sentence, as the website shows
   it. Nothing in the app starts, stops or delays one.
6. **Money owed back is part 16b,** built in the same pull request as this part or in the
   next. If this part is merged first, the app's earnings answer says one plain sentence
   whenever such a list would not be empty, "You owe money back, or money was taken back.
   The details are in your email, and on your earnings page on the website.", so that the
   screen never shows a host less than the truth.
7. **The yearly statement is in the app,** as one screen for a year with the years she can
   choose, every figure the server's. Built field by field, by decision 2's rule: calls as
   calls; memberships as memberships while they are on for the apps; contributions and tips
   inside "Other earnings", in the monthly figures, in "What customers paid for" and in the
   explanations, with no word about what they were. The totals are the website's totals.
   There is no printing and no file in this build; one line says that a copy for printing is
   on the website.

## How it is tried

- `payments-check`, `contribution-check` and `abroad-check` unchanged and green.
- Check script: a host with nothing; with money waiting; with money ready; with exactly 25
  cents; twice within 24 hours; the same collection sent twice; without a payout account;
  with a refund request not answered; a host with contribution money ready and waiting: the
  totals are right, both lines say only "Other earnings", and no project name is anywhere in
  the answer; memberships on and off for the apps; a collection the helper started (its
  sentence, and no "press again"); a host with money owed back while part 16b is not built
  (the plain sentence, and nothing more); the statement for a year with calls, a membership,
  a contribution and a tip: the totals equal the website's, and the words "contribution",
  "tip" and every project's name are absent from the answer; a year with nothing; another
  host's statement (refused).
- On the Android test phone, with pictures: each of those states.

## Keeping the 4.9%

A host collecting her own earnings is a payout, not a purchase. Decision 2 is the point to
watch: the line names nothing and leads nowhere.

## Astra's check (20 November 2026): "ready with changes", worked in

1. *The earnings function carries the project's name and whole records.* Decision 2: field by
   field.
2. *A ready contribution would be called membership time.* Decision 2 puts it right, for the
   website too.
3. *"Other earnings" must cover both ready and waiting, and memberships when they are off.*
   Decision 2.
4. *The real rules:* more than 25 cents, 2 days at the earliest, one collection per number,
   the other outcomes, a dispute waiting. "What is there today"; decision 3.

## Brought up to date (27 November 2026)

Read again against the code on `main` after pull request 123. What changed in this plan:

1. *Connect collects for a host who has not collected for 12 months* (plan 46, part 3b). "What
   is there today"; decision 5.
2. *The box lists money owed back* (plans 46, 47, 50). Decision 6 ties this part to part 16b.
3. *The yearly statement was in no part.* Decision 7 puts it here, with contributions and tips
   inside "Other earnings". **The builder's choice; the founder can leave it on the website.**
4. *Tips are merged* (plan 44). They were already planned for, inside "Other earnings".

This plan is read against the code once more on the day it is built.
