# Phone apps, part 07: a host's requests

**Status:** a plan only. Written 20 November 2026 by the builder alone. Part of plan 45. Astra
checked it once ("not ready"); every point is worked in (the list is at the end).

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
   request; using it here was a mistake in the first draft.) The same person-by-person rules:
   nothing beyond who and when for a closed or blocked customer.
2. **Addresses:** the list; one request as the host sees it; accept; decline; save the note;
   block. On the same functions, with the same refusals and the same sentences.
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
