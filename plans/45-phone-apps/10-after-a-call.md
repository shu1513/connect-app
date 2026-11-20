# Phone apps, part 10: after a call (the results, the receipt, rating, following, the note)

**Status:** a plan only. Written 20 November 2026 by the builder alone. Part of plan 45. Astra
checked the first draft ("not ready"); it was split in two (this part and 10b, refunds) and
every point is worked in (the list is at the end).

## For the founder: what this is

The page a person lands on when a call is over: how long they talked, what it cost or
earned, the rating, the follow box, the host's note, and the buttons that lead on.

**Left out:** the box about the host's project, and the tip box (off behind its switch).

## What is there today (read in the code)

`src/app/calls/[id]/results/page.tsx` (679 lines), the largest page of the website:

- **Time:** three totals (the host's time, the customer's time, time together) and the
  stretches each was connected (`loadAttendance`, `countedSeconds`).
- **Money, one receipt for each payment of the call** (the call itself, each added time):
  what was held, charged, given back, and what is paid in the end; when the money will be
  taken (`moneyTiming`, `moneyPlan`: about a day counted from the call's start, sooner if the
  hold would run out, later while a refund request is open); membership time against
  card money; a bank dispute or a payment under review; a cancellation or a safety ending.
  **Both people see those amounts. The host also sees Connect's fee, her share, and whether it
  has been paid out** (`currentSplit`). The customer never sees the host's share.
- **The rating** (`rateCallAction`, `myRating`, `ratingStateOf`, `RATING`): private, final,
  one per person per call; only for a call that is closed and complete, with at least 2
  minutes together, within 7 days of the call's end (the later end, if time was added).
- **Following:** Follow, Unfollow or "Don't follow" (a call that took place makes the
  customer follow by itself, plan 30), and the offer to be told when she is online.
- **The host's private note** about the customer (`NoteForm`), **Report**, **Block**,
  **"Book another call"**.
- The refund box (part 10b). The project ask (`askAfterCall`), left out. After plan 44, the
  tip box.
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
   follow", "tell me when she is online"; block. Report opens part 09's form. "Book another
   call" opens the host's page.
4. **A rating cannot be changed,** so the app asks once more before sending it.
5. **Tips:** when plan 44 is merged, the shared function gains the tip box for the website.
   The app's answer includes it only if both tip switches allow it, and the tip addresses
   refuse the app otherwise. The apps' switch is born off (part 01).
6. **The receipt** is this screen; there is no file to download in this build.

## How it is tried

- Check script: the answer for a finished call as customer and as host, and "not found" for a
  stranger; the host's share and the fee are in the host's answer and not in the customer's;
  no project and no tip field; one receipt per payment for a call with added time; a member's
  call; a cancelled call; a call ended for safety; rating inside and outside each of its
  conditions, and a second rating refused.
- `ratings-check`, `follow-check`, `extend-check`, `member-calls-check` unchanged and green;
  after plan 44 is merged, its `tip-check` too.
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
