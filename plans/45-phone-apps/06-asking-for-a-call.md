# Phone apps, part 06: asking for a booked call, saving a card, and the ID check

**Status:** built on 20 November 2026 (not merged yet: it waits, with parts 01 to 05, behind
the tips pull request). Written by the builder alone. Part of plan 45. Astra checked the plan
once ("not ready"); every point is worked in (the list is at the end). What the building
changed is listed below.

## For the founder: what this is

The customer picks a time and a length, sees the price and the rules, ticks the box that
allows the card to be used, saves a card, and sends the request. Nothing is charged: the card
is saved, and the money is held later. This is the first part in which a card is typed into
the app, and the first that needs the browser sheet (for the ID check).

## What is there today (read in the code)

- **The booking page** (`src/app/h/[handle]/book/page.tsx`, 300 lines): the time in the
  customer's zone with the host's own time beside it; the length; the price
  (`bookedTotalCents`); the cancellation rule; that the host is paid for waiting when the
  customer is late; when the money will be held, and by when a failed hold must be put right
  (`answerDeadline`, `payCutoff`); the 2 minutes kept free after every call, for both people
  (plan 42); a warning to someone who is also a host that the call takes time out of their own
  calendar; a note to the host, optional, up to 300 characters; and, for a paid call, **a box
  that must be ticked**: the card may be saved for this booking only, held without the customer
  present, charged after the call, **used again if they ask for more time during the call**,
  and is removed once the call is over.
- **Sending** (`sendRequest`, then `askForCall` in `src/lib/booking/bookings.ts`): it takes the
  time, the length, the note, the price and cancellation rule the customer was shown (if the
  host changed either since, nothing is sent), the tick, and a key that makes a request sent
  twice count once. It holds every other rule: blocks, limits, open time, nobody books
  themselves, and the ID check (always for a free call; for a host who takes verified
  customers only).
- **The request's page** (`src/app/bookings/[id]/page.tsx`, `card-step.tsx`): the card step
  (Stripe's form on a saved-card step the server made, cards only, to be finished within 30
  minutes; `/api/bookings/[id]/card-saved` asks Stripe whether it really was saved); the
  states: card to enter, waiting for the host, accepted with the link to the call, ended and
  why; "choose another time"; starting the card step again; taking the request back.
  A booked request's page does not update itself today (only an instant one's does).
- **The saved card** stays with the booking through the call, so that more time can be paid
  with it, and is removed afterwards; the cards of requests that ended are removed by the
  helper's clean-up job.
- **The ID check** (`src/app/identity/`, `startIdentityCheck`, `refreshIdentity`, a limit on
  tries): done on Stripe's own page; the page Stripe sends the person back to asks for a
  signed-in browser.

## Decisions (the builder's)

1. **The same steps, the same functions.** Addresses: what the booking page shows for a host
   and a chosen time; send the request; the request's page; start (or restart) the card step;
   "the card is saved"; take it back.
2. **For a paid call the box is ticked in the app before the request is sent,** with the
   server's own sentence, word for word, and the tick travels with the request exactly as
   from the website. Without it nothing is sent. (A free call has no card and no box; its
   request goes straight to the host.) The same goes for the note and the price and rule the
   person saw. The once-only key is made when the summary screen is shown, and the same key
   is used for a second tap and for trying again, so they are all one request.
3. **The card is typed into Stripe's own sheet for phones,** on the saved-card step the server
   already makes. Cards only, as on the website; Stripe's extras (its own wallet, pay by bank)
   stay off, and no list of earlier cards is offered, since a card belongs to one booking.
   Apple Pay and Google Pay are not switched on in this part (they need the store accounts).
4. **When the bank wants its own approval,** it can take the person out of the app and back.
   The app is registered so it can be returned to, whether it was still open or had been
   closed meanwhile. Whatever the sheet reports, the app then asks the server ("the card is
   saved"), and only the server's answer moves the request on. Given up halfway, or an answer
   that is not known yet, are shown as exactly that, with "try again".
5. **The request's page updates itself in the app** while it is waiting for the host, by
   asking its own address again; this is new compared with the website and reads only.
6. **The ID check, built here** because a customer can need it before any host does:
   - the app asks the server to start it; the server answers with Stripe's page;
   - the browser sheet opens it; Stripe sends the person back to one fixed page of Connect's
     (the function that starts the check already takes the return address it is given). That
     page needs no sign-in and can do no harm: it takes no person and no destination from
     its address, shows no result, changes nothing, and only offers "Return to Connect to
     see where your check stands";
   - the app asks the server about its own signed-in person, and the server asks Stripe,
     which names the person the check was made for. The app never believes the sheet;
   - the limit on tries and the wording are the website's. It must work whoever, if anyone,
     is signed in to Connect in that browser.
   Part 14b uses the same sheet and the same return page for hosts.
7. **Everything on the screen comes from the server:** price, deadlines, the sentences. The
   app does no sums.

## How it is tried

- Check script: a request from the app's addresses is the same row, deadlines and outbox email
  as one from the website; sent twice with one key it is one request; without the tick,
  refused; with an old price, refused with the website's sentence; each other refusal of
  `askForCall`; a free call and a verified-only host without a confirmed ID; the card step
  restarted; a request taken back, and after the clean-up job has run its card is gone; the ID
  check started from the app and finished in a browser that was never signed in.
- `booking-check`, `payments-check`, `verified-check` and `safety-check` unchanged and green.
- On the Android test phone, with Stripe's test cards and pictures: a request sent; a refused
  card; a card that needs the bank's approval; the app closed during that approval and opened
  again; taking a request back; the ID check in the sheet (Stripe's test page) and back.

## What cannot be tried here

Apple Pay and Google Pay. A real card. A real bank's approval app.

## Keeping the 4.9%

This is the payment the stores allow outside their own systems: a live, one-to-one, unrecorded
call. The screen says what is being bought in those words. The ID check is not a purchase.

## What the building changed (20 November 2026)

1. **One gathering and one set of sentences, for the website and the app.** What the booking
   page shows is now put together in `src/lib/booking/book-page.ts` and worded in
   `book-words.ts`; a request's page in `request-page.ts` and `request-words.ts`; the ID
   check's sentences in `src/lib/safety/identity-words.ts`. The website's three pages were moved
   onto them, word for word as before. So the box about the card has one wording, in one place,
   for both (the wording's version is recorded with each request, as before).
2. **Sentences travel in parts.** A sentence that stresses some words or names an exact moment
   is sent as plain words, words to stress, and moments. The website writes a moment in the
   browser's time zone, the phone in its own.
3. **The once-only key is made by the server,** as the website's page makes it, and sent with
   the summary. The app keeps the first one it was given for as long as the screen stands, so
   a second tap, and trying again after a lost connection, are the same one request. (The plan
   said the app makes it. This needs no extra kit in the app.)
4. **The addresses:** `GET` and `POST /api/app/hosts/[handle]/book` (the summary; send),
   `GET /api/app/bookings/[id]` (the request's page), `POST …/card` (what Stripe's sheet needs;
   also makes the step when making it failed the first time), `POST …/card-saved` (the server
   asks Stripe, then answers with the page as it stands), `POST …/take-back`,
   `GET /api/app/identity`, `POST /api/app/identity/start`.
   **Only the customer's side of a request is answered.** The host's side comes with part 07.
5. **Stripe's key for the card sheet comes from the server** with the card step, so a copy of
   the app can never be built with a key that does not match the server. The app only takes a
   secret for saving a card (never one for a payment) and a key that may be shown.
6. **Where the bank's approval hands back to.** The card sheet is given the address of the
   request's own screen in the app. Whether the app was still open or not, that screen asks the
   server, which asks Stripe. The same question is asked whenever the screen comes to the front
   at the card step.
7. **The return page for the ID check** is `/identity/done`: no top bar (it would show whoever
   the browser knows), no result, nothing read from its address, and one fixed link back into
   the app. The app opens only `https://verify.stripe.com/…` in the browser sheet, whatever
   the server's answer says.
8. **New, small:** someone who picks a time before signing in is taken back to that host's
   page once they are in (kept in the app's memory only, for half an hour, a host's page only).
   Taking a request back asks "are you sure" first (a tap by accident is easy on a phone).
   "Your requests" on the home page now open the request. Account has "Confirm who you are".
9. **Not wired yet, each waits for its own part:** a member's times (part 13), the call's page
   from an accepted request (part 08; it leads to the Calls place for now), the waiting screen
   of a call asked for "now" (part 11), "Report" and "Block" on a request (their own part).

### How it was tried

- `scripts/app-booking-check.ts`, 101 checks, with real test cards at Stripe (test mode): the
  summary in the website's own sentences (and the website's page for the same time saying the
  same); a request from the app is the same row, deadlines and email as one made by the
  website's own function; sent twice it is one; every refusal; the card step, where only
  Stripe's word counts (too early, a refused card, then a saved one); taking back, and after
  the helper's clean-up the card is gone at Stripe too; the ID check started from the app, the
  return page for a browser that never signed in.
- The earlier checks of the app's addresses (parts 01 to 05) pass unchanged: 119, 75, 73.
  The website's own unit tests pass (753).
- On the Android test phone, with pictures: a visitor picks a time, signs in, and is back on
  the host's page; the summary of a paid call; pressing on without the tick (nothing sent);
  Stripe's sheet closed without a card; a refused card; a card that needs the bank's approval,
  failed and then approved; **the app closed in the middle of the approval and opened again**
  (the approval itself was then given through Stripe's test tools, standing in for the bank);
  taking a request back; the ID check started, the link back into the app, and the result
  shown; a free call sent.

### What could not be tried here

- **The ID check inside the phone's browser sheet.** The test phone's browser shows Google's
  "agree to the terms" screen on first use, and that is the founder's to press, not the
  builder's. So Stripe's own page was not walked inside the sheet. What is around it was:
  the app asks the server, opens the browser at Stripe's address, comes back by the link, and
  shows what the server says. (The result itself was pretended in the database.)
- On this Mac nobody passes the ID check for real: reading "18 or older" from Stripe needs the
  separate key `STRIPE_IDENTITY_KEY`, which is not set here. This is the website's own rule.
- `booking-check`, `payments-check`, `verified-check` and `safety-check` need a test host
  with payouts set up at Stripe, which the scratch database does not have. The booking
  functions themselves were not changed (one small function was added).
- The iPhone: the link that hands back from a bank's approval must be passed on to Stripe's
  kit there (written, cannot be run on this Mac). For part 20.

### Noticed, for the founder

- **Every start of an ID check uses one of the three tries,** also when the person closes
  Stripe's page without finishing. This is the website's rule too. On a phone the page is
  closed more easily. Not changed here.

## Astra's check (20 November 2026): "not ready", now worked in

1. *The consent was put too late and the card's lifetime was wrong.* The box is ticked before
   sending, and the card stays through the call for more time. Decision 2, "What is there".
2. *What `askForCall` really takes* (the note, what the person saw, the once-only key) and the
   states of the request's page. Added.
3. *Stripe's sheet:* yes on the existing steps; cards only; the way back into the app; the
   server decides. Decisions 3 and 4.
4. *A booked request's page does not update itself today.* Decision 5.
5. *The ID check belongs here, and its return page needs a signed-in browser today.*
   Decision 6.
