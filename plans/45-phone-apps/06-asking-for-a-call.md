# Phone apps, part 06: asking for a booked call, saving a card, and the ID check

**Status:** a plan only. Written 20 November 2026 by the builder alone. Part of plan 45. Astra
checked it once ("not ready"); every point is worked in (the list is at the end).

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
2. **The box is ticked in the app before the request is sent,** with the server's own
   sentence, word for word, and the tick travels with the request exactly as from the website.
   Without it nothing is sent. The same goes for the note, the price and rule the person saw,
   and the once-only key (the app makes one per press, so a double tap is one request).
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
   - the browser sheet opens it; Stripe sends the person back to a small page of Connect's
     that needs no sign-in, says "Done, return to Connect", and hands back to the app;
   - the app asks the server, and the server asks Stripe. The app never believes the sheet;
   - the limit on tries and the wording are the website's. A browser that has never signed in
     to Connect must be enough.
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
