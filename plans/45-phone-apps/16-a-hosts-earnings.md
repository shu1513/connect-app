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
  without her press, except by the 12-month collection described below. Not possible while the payout account is not ready. Also not, for a few
  minutes, while a message from Stripe about any bank dispute has arrived and is not yet
  handled: until the helper has read it, nobody collects (`disputeMessageWaiting` in
  `src/lib/payments/collect.ts`); that says nothing about this host owing an answer.
- The box shows what is ready and what is still waiting, line by line, and the amount she
  will receive beside one button. A collection has a number of its own, so pressing twice is
  one collection; it can go through in part, be refused, or be not known yet. Money for a
  host abroad has its own wording (plan 27).
- **A collection Connect starts itself** (plan 46, part 3b; `src/lib/payments/uncollected.ts`):
  when 12 months have passed without a collection of hers going through, counted as that
  file counts them (from her last collection that went through, or from her oldest share
  that is ready), the helper runs the very collection her button runs, with the usual charge, and she is told what was really sent
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
  project's name among them.** (The website's caption names each kind: calls, tips,
  contributions, expired member time. An earlier version of this plan said it called a
  contribution "expired member time"; that is no longer so, and nothing on the website
  needs changing.)

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
   itself.
3. **"Collect earnings" asks once more,** with the amount she will receive and the charge as
   the server worked it out (up to 25 cents; less when what is ready is made of very small
   shares). The website has one button; on a phone a touch by mistake is easier. Pressing twice is
   one collection. "In part", "refused" and "not known yet" are shown as that.
4. **Not possible?** The app says which reason the server gave and leads to the payout
   account (part 14b) only when that is the reason.
5. **Where the exception for "Other earnings" ends** *(added 27 November; put exactly after
   Astra's three checks)*. It covers three things and no more: the two amounts (ready and
   waiting), the one button that collects everything that is ready, and what became of **her
   own press** of that button (sent, in part, refused, not known yet, with its amount),
   because a button whose outcome is hidden is a broken button. "Her own press" means a
   collection she started herself. One Connect started for her after 12 months, and the
   final one the founder can make for a closed host, are not hers in this sense (the record
   names who started each). Everything else on this screen is worked out as if only her
   calls existed (and her memberships, while they are on for the apps):
   - **A collection she did not start** has a sentence in the app, and a notification (part
     12, decision 2a), only when her calls alone would have caused it. That is asked with
     the helper's real rule, applied to the calls' own history as it stood when the
     collection was made: 12 months since her last collection *of call earnings* that went
     through, or, if there was none, since her oldest call share became ready; and call
     shares that reach the least amount by themselves. A call share that became ready
     yesterday beside a contribution a year old does not pass; neither does a small call
     share that only a tip lifts over the least amount.
   - **A figure about such a collection is shown only if it is both true of what was really
     sent and what the calls alone would have given.** The charge of a collection is taken
     from its largest share, so with a contribution in it even the call's own line can
     differ from what it would have been alone; then the figure is left out, not corrected.
   - **"You can collect again from ..."** follows the last collection of any kind, and that
     stays the rule for the button. But the app does not name a moment, or give a reason,
     that exists only because of a collection it does not show: the button is simply not
     offered, with "Collecting is not possible right now. Please try again later."
   - **The same neutral sentence** is used while a message from Stripe about a bank dispute
     is waiting to be read (it stops everyone's collecting for some minutes, and can be about
     anyone's payment of any kind): the app does not say "a disputed charge".
   - Reasons that are hers to act on are still said plainly: her payout account is not
     ready, or a refund request for a call waits for her answer.
   Nothing in the app starts, stops or delays a collection by Connect.
6. **Money owed back is part 16b,** built in the same pull request as this part or in the
   next. If this part is merged first, the app's earnings answer says one plain sentence
   whenever such a list would not be empty **for calls** (and for memberships while they are
   on for the apps): "You owe money back, or money was taken back. The details are in your
   email, and on your earnings page on the website." A debt about a contribution or a tip
   makes no sentence and no entry (part 16b, decision 9).
7. **The yearly statement stays on the website** *(changed after Astra's check; the first
   update of 27 November had put it into the app)*. Its monthly figures, its fees column for
   tips and its split by kind cannot be shown without showing what came from projects and
   tips, and "Other earnings" is allowed in two amounts only (decision 2). The app's
   earnings screen has one line that every host sees, whatever she earned: "Your yearly
   statement is on the website." A statement in the app made only of calls would be possible
   later; it would need its own years, sums and fees worked out from calls alone, and is not
   in this build.

## How it is tried

- `payments-check`, `contribution-check` and `abroad-check` unchanged and green.
- Check script: a host with nothing; with money waiting; with money ready; with exactly 25
  cents; twice within 24 hours; the same collection sent twice; without a payout account;
  with a refund request not answered; a host with contribution money ready and waiting: the
  totals are right, both lines say only "Other earnings", and no project name is anywhere in
  the answer; memberships on and off for the apps; a collection the helper started that
  her calls alone would have caused (its sentence, and no "press again"); one made only of
  tips, one where a contribution a year old made it due beside a call share from yesterday,
  and one where a tip lifted a small call share over the least amount (no sentence, no
  figure, no "collect again from", the two amounts changed); a collection she pressed
  herself with a contribution in it, sent in part (its true outcome and amount are shown);
  a collection the founder made for her while her account was closed, after it was opened
  again (treated as one she did not start); a waiting message about someone else's bank
  dispute (the neutral sentence); a host with money owed back for a call while part 16b
  is not built (the plain sentence, and nothing more), and a host whose only debt is about
  a contribution (no sentence); no address of the app answers with a statement, and the
  line about the statement is the same for a host with only calls and a host with only tips.
- On the Android test phone, with pictures: each of those states.

## Keeping the 4.9%

A host collecting her own earnings is a payout, not a purchase. Decision 2 is the point to
watch: the line names nothing and leads nowhere.

## Astra's check (20 November 2026): "ready with changes", worked in

1. *The earnings function carries the project's name and whole records.* Decision 2: field by
   field.
2. *A ready contribution would be called membership time.* Decision 2 puts it right. (On 27
   November: the website's caption has since been put right there; nothing of it is left
   for this part.)
3. *"Other earnings" must cover both ready and waiting, and memberships when they are off.*
   Decision 2.
4. *The real rules:* more than 25 cents, 2 days at the earliest, one collection per number,
   the other outcomes, a dispute waiting. "What is there today"; decision 3.

## Brought up to date (27 November 2026)

Read again against the code on `main` after pull request 123. What changed in this plan:

1. *Connect collects for a host who has not collected for 12 months* (plan 46, part 3b). "What
   is there today"; decision 5.
2. *The box lists money owed back* (plans 46, 47, 50). Decision 6 ties this part to part 16b.
3. *The yearly statement was in no part.* Decision 7: it stays on the website, and the app
   says so in one line.
4. *Tips are merged* (plan 44). They were already planned for, inside "Other earnings".

This plan is read against the code once more on the day it is built.

## Astra's check of this update (27 November 2026): "not ready", worked in

1. *A statement with months, a tips-fee column and a split by kind is far more than two
   amounts.* Decision 7 now leaves it on the website.
2. *A debt, and a collection, can exist only because of a tip or a contribution.* Decisions 5
   and 6 show nothing for those.
3. *Three descriptions were wrong:* the website's caption (it is right already), what stops a
   collection while a bank dispute's message waits, and how the 12 months are counted. "What
   is there today"; decision 2 no longer changes the website.

## Astra's second check (27 November 2026): "not ready", worked in

1. *One call share in a collection does not show why the collection happened.* Decision 5 now
   asks whether the calls alone would have caused it, and says where the exception ends.
2. *Two summaries still said the opposite of the decisions* ("nothing is sent automatically",
   and the website's caption). Corrected.

## Astra's third check (27 November 2026): "not ready", worked in

1. *"The calls alone" was tested the wrong way:* the helper counts from her last collection
   that went through, and from her oldest ready share only if there was none. Decision 5
   applies that rule to the calls' own history.
2. *Three more ways a hidden collection could show:* a charge carried by a larger share, the
   moment she may collect again, and the sentence about a disputed charge. Decision 5.
3. *"Her own press" needed a meaning,* since Connect and the founder can start a collection
   too. Decision 5.
