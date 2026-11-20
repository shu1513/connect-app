# Phone apps, part 07: a host's requests

**Status:** built on 20 November 2026 (not merged yet: it waits, with parts 01 to 06, behind the
tips pull request). Written by the builder alone. Part of plan 45. Astra checked the plan once
("not ready"); every point is worked in (the list is at the end). What the building changed is
listed below.

## For the founder: what this is

A host sees who is asking, and answers: Accept or Decline, on the home page, in the list of
requests, and on a request's own page. (The instant kind, "call now", is part 11.)

## What is there today (read in the code)

- **The list** (`src/app/host/requests/`, `request-list.tsx`, also used by the home page):
  requests grouped by their start time. For each one whose customer's account is open and not
  blocked: the customer's rating, "ID confirmed", the host's own note (folded), the photo if
  the host may see it. A request left over from a closed or blocked customer shows only who
  and when.
- **One request as the host sees it** (`src/app/bookings/[id]/page.tsx`): the same, with the
  note open and editable, Report and Block, and the customer's rating even after the answer.
  A request whose card step was never finished does not exist for the host ("not found"), and
  neither does a member's booking that never became a call.
- **Answering a booked request:** `acceptAction` and `declineAction` (`accept`, `decline` in
  `src/lib/booking/bookings.ts`). Accepting checks again the deadline, both accounts, blocks,
  that Stripe is ready for her, and that the time is still free for both people; it makes the
  call; it passes over other requests that now collide, for either person (the customer may
  be a host too). A host whose page is hidden can still accept. Declining starts 7 days in
  which that customer cannot ask her for a booked call again. A second answer to the same
  request is told it is "no longer waiting".
- **Block** is its own button on the request's page. ("Decline and block" in one step exists
  only for instant requests, on `/api/bookings/[id]/answer`, which is for those alone.)
- **A member's request** never waits for the host (plan 21); its first monthly payment can
  leave it "paying", with "Finish booking" for the customer, or end without a call.
- A request not answered in time ends by itself.

## Decisions (the builder's)

1. **What a host sees about a waiting request comes from the list's own shared code,** moved
   out of `request-list.tsx` into a function the website's list, the home page and the app's
   addresses all call. (`customerDetailsFor` is for booked calls and cannot describe a
   request; using it here was a mistake in the first draft.) For a customer whose account is
   closed or who is blocked, the list keeps the name, the start, the length, the price and
   the deadline, and nothing personal: no rating, no "ID confirmed", no photo, and not what
   they wrote when asking. Today the website's page for one request does not apply quite the
   same rule as its list. **In the app, a waiting request follows the list's rule wherever
   it is opened.**
2. **Addresses:** the list; one request as the host sees it; accept; decline; save the note;
   block. On the same functions, with the same refusals and the same sentences. The list
   holds instant requests too; answering one of those goes the instant way (part 11), which
   tries the saved card at once, and the app picks the way by the kind the server names.
3. **Accept asks once more** ("Accept a 30-minute call on Friday at 3:00 pm for $40?"), since
   a touch by mistake makes a commitment. Decline does not ask.
4. **After any answer the app reads the request again and shows what really happened,**
   whichever answer won (the website and the phone, or two taps).
5. **The payout account:** the app leads to setting it up (part 14b) only when the server's
   refusal says that is the reason, not on a guess.
6. **Block** on the request's page, as its own step, as on the website; it can be tried again
   if it did not go through. **Report** leads to the report form (part 09).

## How it is tried

- Check script: accept and decline through the app's addresses give the same call, busy time,
  passed-over requests and emails as through the website; the same request answered twice;
  accepting without a payout account, after the deadline, with the time taken meanwhile; the
  7 days after a decline; a host asking for someone else's request, an unfinished one, a
  member's booking without a call (all "not found"); a closed customer's leftover row.
- `booking-check`, `home-check` and `member-calls-check` unchanged and green.
- On the Android test phone, with pictures: the list, a request's page, Accept with its
  question, Decline, Block, a request that has run out, a request answered on the website
  while the phone was showing it.

## Keeping the 4.9%

No payment happens here. Accepting a call that a customer pays for with Stripe is the
one-to-one service the stores allow.

## What the building changed (20 November 2026)

1. **One place decides what a host may know about a waiting request**
   (`src/lib/booking/waiting-list.ts`), and the website's list (the requests page and the home
   page) is drawn from it, as before to the letter. The sentences about requests are in
   `waiting-words.ts`, the ones about blocking in `src/lib/safety/block-words.ts`; the
   website's pages and buttons use them too.
2. **The addresses:** `GET /api/app/requests` (the list); `GET /api/app/bookings/[id]` now also
   answers for the host of a request (the same address as for its customer; which of the two
   is reading comes from the sign-in); `POST …/accept`, `…/decline`, `…/note`, `…/block`.
   A step that is the other person's is "not found", like a request that is not one's own.
3. **The list's rule holds at every stage, not only while a request waits.** About a customer
   whose account is closed, or across a block, the host's page of a request says the name and
   nothing else, also after it was answered. (The website's page for one request still shows
   a rating there. Stricter in the app; say if the website should follow.)
4. **Blocking from a request is for either of the two,** as on the website's page: the customer
   can block the host from their request too. Both are asked once more first. Someone who has
   already blocked the other is not offered the button again.
5. **A call asked for "right now" is on the list, marked as that kind,** and is not answered
   with these buttons: its line says it is answered on "Available now" (part 11 builds that).
   The addresses refuse both answers for it.
6. **Accept and Decline are on the list and on the request's page.** On the home page the
   waiting requests lead to their page, and a button "Answer requests" leads to the list.
   (The plan had the buttons on the home page too. One tap further, and no button to press by
   mistake while scrolling the home page.)
7. **The note** is saved only if the stored note is still the one the screen was showing, as on
   the website. The box says so when it was changed elsewhere and offers to take the stored
   one in; what was typed is never lost.
8. **One sentence changed on the website too:** a request ended by a block said "ended because
   it was not answered in time" to the host. It now says "This request has ended."
9. **Not built here:** the payout set-up screen that a refused paid accept should lead to
   (part 14b; the refusal's own sentence says what to do), and Report (its own part).

### How it was tried

- `scripts/app-requests-check.ts`, 67 checks: the list and what may be known about each person
  (also for a closed account and across a block); one request as the host sees it; accepting
  gives the same call, busy time, passed-over request and emails as the website's own
  function; every refusal (answered twice, too late, the time taken by a request of her own,
  no payout account, paused, a call asked for now); declining and the seven days; the note
  (saved, changed, emptied, refused when out of date or too long or across a block);
  blocking by the host and by the customer; and everything that must be "not found".
- Part 06's check (122) and the website's own checks pass unchanged.
- On the Android test phone, with pictures: the home page's waiting requests, the list (two
  people asking for one time), a request's page, Accept with its question, the list after it
  (the other person passed over), a request declined elsewhere while the phone showed it, the
  note saved, Block with its question and the page after it.

## Astra's check (20 November 2026): "not ready", now worked in

1. *`customerDetailsFor` cannot describe a waiting request.* Decision 1.
2. *Booked and instant answers are different things:* "decline and block" and the existing
   answer address are for instant requests only. Split between this part and part 11.
3. *What accepting really does* (the second check of everything, passing over colliding
   requests, a hidden host can accept), the 7 days after a decline, "no longer waiting".
   "What is there today", decision 4.
4. *The request's page:* editable note, Report, Block, what does not exist for the host.
   Added.
5. *The payout hint only on the server's word.* Decision 5.
