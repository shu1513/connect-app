# Phone apps, part 10: after a call (the results, the receipt, rating, following, the note)

**Status:** a plan only. Written 20 November 2026 by the builder alone. Part of plan 45. Astra
checked the first draft ("not ready"); it was split in two (this part and 10b, refunds) and
every point is worked in (the list is at the end). Brought up to date on 27 November 2026,
after the website changed (that list is at the end too).

## For the founder: what this is

The page a person lands on when a call is over: how long they talked, what it cost or
earned, the rating, the follow box, the host's note, and the buttons that lead on.

**Left out:** the box about the host's project, and the tip box (off behind its switch).

## What is there today (read in the code)

`src/app/calls/[id]/results/page.tsx` (712 lines on 27 November), the largest page of the
website:

- **Time:** three totals (the host's time, the customer's time, time together) and the
  stretches each was connected (`loadAttendance`, `countedSeconds`).
- **Money, one receipt for each payment of the call** (the call itself, each added time):
  what was held, charged, given back, and what is paid in the end; when the money will be
  taken (`moneyTiming`, `moneyPlan`: about a day counted from the call's start, sooner if the
  hold would run out, later while a refund request is open); membership time against
  card money; a bank dispute or a payment under review; a cancellation or a safety ending.
  What the record says is owed for each payment comes from one function that every money
  step also asks (`owedFor` in `src/lib/payments/owed.ts`, plan 51).
- **A call ended with "End call now"** (plan 51): a red box says who ended it and when, and
  which rule the charge follows, in sentences that differ by role (`END_WORDS` and
  `endMoneyFor` in `src/lib/call-page/end-words.ts`). A receipt whose charge includes "the
  rest of the booking" says so (the charge's reason is `customer_ended`). The customer's page
  says when his report lowered the charge; **the host's page never says that she was
  reported.** A call ended with the earlier button, "End call and report", keeps its own
  line; no new call can end that way.
  **Both people see those amounts. The host also sees Connect's fee, her share, and whether it
  has been paid out** (`currentSplit`). The customer never sees the host's share.
- **The rating** (`rateCallAction`, `myRating`, `ratingStateOf`, `RATING`): private, final,
  one per person per call; only for a call that is closed and complete, with at least 2
  minutes together, within 7 days of the call's end (the later end, if time was added). A
  call ended with "End call now" is rated like any other, by both people; only one ended
  with the earlier button is never rated (`oldStop` in `src/lib/ratings/rules.ts`).
- **Following:** Follow, Unfollow or "Don't follow" (a call that took place makes the
  customer follow by itself, plan 30), and the offer to be told when she is online.
- **The host's private note** about the customer (`NoteForm`), **Report**, **Block**,
  **"Book another call"** (hidden only after the earlier button), and, since plan 49,
  **"Write to [name]"** (`src/components/write-to.tsx`), shown to the two people of a call
  that was not cancelled and not ended with the earlier button, while messages are switched
  on.
- The refund box (part 10b). The project ask (`askAfterCall`), left out. The tip box (plan
  44). After "End call now" the tip box, the project ask and the automatic follow stay off.
- **Already in the app** (plan 51, built by another session): the screen with "Report",
  "Block" and "Neither" (`mobile/src/app/ended.tsx`, read from `/api/app/calls/[id]/ended`),
  a step that blocks the other person of a call and names only the call, and, on the app's
  page of a call that is over, the way to those choices. Because the app has no receipt
  yet, the line on that screen that points to the settled money names the website
  (`END_WORDS.moneyDoneApp`).
- Who may see the page at all is `callForViewer`: the two people of the call (and the
  founder, on the website).

## Decisions (the builder's)

1. **One address answers with what the page shows for this person**, through a shared function
   the page also uses, built field by field: no project ask, and no tip field unless the
   apps' tips switch is on. A person of the call sees the page; nobody else; the founder's
   extra view of it stays on the website.
2. **The money is shown exactly as the website shows it to that role:** the amounts held,
   charged, given back and paid to both; the fee, her share and the payout state to the host
   only. One receipt per payment. Every figure is the server's.
3. **Small addresses, on the same functions:** rate; save the note; follow, unfollow, "don't
   follow", "tell me when she is online". **Report and Block are not built again:** this
   screen leads to plan 51's screen of three choices, which the app has, with its report
   form and its block step. "Book another call" opens the host's page.
4. **A rating cannot be changed,** so the app asks once more before sending it.
5. **Tips:** when plan 44 is merged, the shared function gains the tip box for the website.
   The app's answer includes it only if both tip switches allow it, and the tip addresses
   refuse the app otherwise. The apps' switch is born off (part 01).
6. **The receipt** is this screen; there is no file to download in this build.
7. **"End call now" is shown with the server's sentences,** by role: who ended the call, the
   rule the charge follows, the reason on a receipt, and for the customer that his report
   lowered the charge or did not. The app's answer for a host holds nothing about a report
   against her; the check script looks for that in the answer itself, not on the screen.
8. **Once this screen exists, the line after "End call now" points to it.** The app's answer
   for the screen of three choices stops replacing "see the call's page" with the website's
   name (`END_WORDS.moneyDoneApp`), in the same pull request, and the app's page of a call
   leads to the results as the website's does ("See the details").
9. **"Write to [name]"** belongs to part 17b (its decision 20: built with whichever of the
   two parts comes second). If 17b is not built yet, the app's answer has no such field and
   the screen no such button.

## How it is tried

- Check script: the answer for a finished call as customer and as host, and "not found" for a
  stranger; the host's share and the fee are in the host's answer and not in the customer's;
  no project and no tip field; one receipt per payment for a call with added time; a member's
  call; a cancelled call; a call ended for safety; rating inside and outside each of its
  conditions, and a second rating refused; a call ended with "End call now" by the host and
  one ended by the customer (the box, the reason on the receipt, both can rate, no tip
  field, no automatic follow); one where the customer's report lowered the charge (said in
  his answer, absent from hers); a call ended with the earlier button (never rated).
- `ratings-check`, `follow-check`, `extend-check`, `member-calls-check`, `tip-check` and plan
  51's `end-now-check` unchanged and green.
- On the Android test phone, with pictures: both sides of a finished call, with and without
  added time; rating; the note; follow and unfollow; block.

## Keeping the 4.9%

Nothing is sold here. The two things on the website's page that could bring a store's cut,
the project ask and the tip, are absent from the app's answer, and the server refuses them
to the app.

## Astra's check (20 November 2026): "not ready", now worked in

1. *Refunds were muddled and included a founder-only action.* Moved to part 10b and put right.
2. *What each side sees of the money* was put too loosely. Decision 2 says it role by role.
3. *Missing:* the three time totals, one receipt per payment, membership time against card
   money, disputes and reviews, "Book another call", Report, "Don't follow", the offer about
   being online, and the rating's full conditions. Added.

## Brought up to date (27 November 2026)

Read again against the code on `main` after pull request 123. What changed in this plan:

1. *"End call now" (plan 51) changed what the page says about the money and who may rate.*
   "What is there today"; decisions 7 and 8; the check script.
2. *Report and Block already exist in the app,* built with plan 51. Decision 3 no longer
   builds them.
3. *"Write to [name]" is on the website's page* (plan 49). Decision 9 leaves it to part 17b.
4. *Plan 44 (tips) is merged.* Decision 5 stands as written: the tip field only if both
   switches allow it.

Not changed, and looked at: money Connect gives back after a host has collected (plans 46
and 50) shows on the receipts as "given back" like any refund, from the same function; what
the host then owes is on her earnings screen (part 16b), not here.

This plan is read against the code once more on the day it is built.
