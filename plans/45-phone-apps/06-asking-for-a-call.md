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

- `scripts/app-booking-check.ts`, 122 checks, with real test cards at Stripe (test mode): the
  summary in the website's own sentences (and the website's page for the same time saying the
  same); a request from the app is the same row, deadlines and email as one made by the
  website's own function; sent twice it is one; every refusal; the card step, where only
  Stripe's word counts (too early, a refused card, then a saved one); taking back, and after
  the helper's clean-up the card is gone at Stripe too; the ID check started from the app, the
  return page for a browser that never signed in.
- The earlier checks of the app's addresses (parts 01 to 05) pass unchanged: 119, 75, 73.
  The website's own unit tests pass (753).
- The website's own checks the plan names pass on the scratch database, after the changes to
  the booking functions: `booking-check` (144), `verified-check` (30), `payments-check` (77),
  `safety-check` (60), and, since they also pass through the card step, `extend-check` (115),
  `now-check` (76) and `journey-check` (63). (For this the scratch database's test host was pointed at the same
  Stripe test account the test host has on the shared database.)
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
- The iPhone: the link that hands back from a bank's approval must be passed on to Stripe's
  kit there (written, cannot be run on this Mac). For part 20.

### Noticed, for the founder

- **Every start of an ID check uses one of the three tries,** also when the person closes
  Stripe's page without finishing. This is the website's rule too. On a phone the page is
  closed more easily. Not changed here.
- **Two new limits, the builder's numbers, on the website too:** a customer can have at most
  5 paid requests standing at the card step at one time, and can start at most 20 paid
  requests in 24 hours (sent or not). Before, these were not limited at all. Say if you want
  other numbers (`cardStepsOpen` and `cardStepsPerDay` in `src/lib/booking/rules.ts`).

## Astra's check of the code (20 November 2026): "not ready", now worked in

It found the website's two moved pages unchanged in wording and behaviour, the card secret
only ever handed to the request's own customer, and nothing sent on a mere say-so of the app.
Its thirteen points, all taken:

1. *A tick could outlive a change of price.* The tick now belongs to exactly what was on the
   screen when it was given (the box's words, the price, the cancelling rule, the time, the
   length). When any of them changes, the box is empty again. Tried on the phone.
2. *An answer arriving late could act for somebody who had left.* Before the app opens the
   browser, shows the card sheet, or moves to another screen, it checks that the screen that
   asked is still there and in front (`mobile/src/lib/here.ts`). After another person signs in
   every screen is made anew, so nothing of the first person's is acted on.
3. *Paid requests at the card step were not counted by any limit,* on the website either, and
   each one makes a saved-card step at Stripe. New limits in the booking function itself, for
   both: at most 5 standing at the card step at one time, and 20 started in 24 hours.
4. *An older reading could put back what a step had changed* (the number of a question was
   taken after its answer came). Each question now takes its number before it is sent, and a
   step takes one as it begins.
5. *A request whose answer was lost could come back on other terms.* The app now sends the
   very same request again while it does not know what became of the first. The server first
   looks for a request this person already made with that key and answers with it as it was
   made, before it looks at the host's page as it stands now (she may have hidden it since).
6. *The check script.* It now refuses anything but Stripe's test key before it makes anything,
   prints no secret and no address of Stripe's, and removes the test customers it made there.
7. *A call asked for "now" (begun on the website) could have its card entered from the app
   while "available now" is switched off for the apps.* Its page can still be read and it can
   be taken back, but there is no card step, and both card addresses answer "switched off".
8. *The 30 minutes for the card were shown but not enforced until the helper came by.* Now
   enforced where it counts: no card step is handed out past the time, and a card saved after
   it sends nothing (the request ends in the helper's own words; the helper removes the card).
   This is in the website's function too.
9. *A sentence about the card could stand under a request that had moved on.* What the app
   says about a step now belongs to the stage it was said at, and is shown only while the
   request is at that stage. After a card answer that brought no page, the page is read again.
10. *The ID screen could ask again before the last answer was in, and two readings at Stripe
    could cross.* The screen asks one question at a time, the next a few seconds after the
    last answer. On the server, a check written down as passed is never written over by an
    older reading (the website's function).
11. *Thirty-six characters that only looked like an id reached the database* and came back as
    an error. Only a real id is ever asked for now, on the server and in the app, and an id
    written in capitals opens the same request.
12. *A free call's summary named the host's rule for paid calls beside "cancel any time".* It
    now names the rule that holds for this call. It also says what is asked for in the words
    the stores' rules turn on: "A live, private one-to-one video call. It is not recorded."
13. *Two sentences promised too much.* Before taking a request back the app now says "The
    host will no longer be able to accept it" (she can still see that it was asked and taken
    back). The line about paying by hand or cancelling on the call's page is left out until
    the app has that page.

## Astra's second look at the code (20 November 2026): "not ready", now worked in

Five of the thirteen were fixed outright (4, 10, 11, 12, 13). Ten further points, mostly about
what happens around a lost answer:

1. *After a sending whose answer was lost, the form could still be changed, and "try again"
   sent the old tick and note.* Until the server has said what became of a sending, the screen
   now shows exactly what was sent, read-only, with one button, "Try again". Tried on the
   phone with the connection cut: one request, as shown.
2. *The card sheet could still come up after the person had left,* during the moment Stripe's
   kit gets it ready. The check is now made again at the very last step before the sheet is
   shown, and it says no for anyone who left the screen, even if they came back since.
3. *The tick was recorded with whatever wording was in force when it arrived.* The summary now
   says which wording its box stands beside, and that goes back with the tick. If the wording
   has changed since, nothing is sent (the website's form does the same now). A tick also no
   longer comes back when a price goes away and returns.
4. *The 30 minutes were judged by the clock at the start of the question,* not at the moment
   of deciding. Now by the later of the two, with the calendars locked. **Not taken:** judging
   the apps' own "available now" switch again at that same moment. A request let in a blink
   before the founder flips the switch is no different from one that finished a blink earlier;
   the switch stops everything after it.
5. *An answer that came while another screen was in front left a live form whose key was
   spent.* The screen now remembers that its request was made, opens it when it comes to the
   front again, and never shows the form again.
6. *Requests past their card time still counted as "standing at the card step", and the
   website still offered them a card form.* They no longer count (they still count toward the
   20 a day); the website's page and the app both say the time has passed, with no card form,
   and the app's page asks again by itself until the helper has ended the request.
7. *After the sheet finished and the server could not be asked, the only way on was to enter
   the card again.* There is now a "Check again" button that asks the server without opening
   the sheet.
8. *The check script.* The app it talks to makes the first things at Stripe, so the script now
   says to start that app with the same test key, and stops at once if the app hands out any
   other kind. (The app itself refuses a key that is not a test key unless it was started with
   ALLOW_LIVE_STRIPE=yes.) A test customer that cannot be removed at Stripe now fails the
   check and is named.
9. *An older copy of the app would not read the newer answer, and the other way round.*
   **Not taken now, noted for part 20:** no copy of the app is in anyone's hands yet, and all
   parts go out together. From the first copy in a store on, an answer may only ever grow,
   and the oldest version still let in must be raised when it cannot.
10. *A cancelled ID check could be written back to "being looked at" by an older reading.* A
    cancelled check is now left alone, like a passed one.

## Astra's third look at the code (20 November 2026): "not ready", now worked in

It found points 2, 5 and 10 of its second look fixed, accepted the two that were not taken,
and named nine narrower ones:

1. *A paid request could exist after the app had said "nothing was sent"* (the request is
   written down first, its card step is made at Stripe after; if only the second failed, the
   answer was a refusal). The address now looks for the request before it answers a failure,
   and answers it as made.
2. *A retry turned away at the door (paused, signed out) threw away the copy of what was
   sent.* It is kept: what became of the first sending is still not known then. And when the
   answer is "not found", nothing of the page stays on the screen to be sent again.
3. *The website still took a paid tick that did not say which wording it was for.* Refused
   now; only code that leaves the field out altogether (the check scripts) is not asked.
4. *The check script learns which Stripe account the app uses only from the app's first
   answer about a card.* It now stops there unless the app hands out this tool's own test key
   (the same key means the same account), so what it confirms and removes is what the app
   made. **Not closed further:** the app's first test customer and card step exist by then.
   The app itself refuses any key that is not a test key unless it was started with
   ALLOW_LIVE_STRIPE=yes.
5. *Sending on after the card used the clock from when the question came in* for the host's
   time to answer and for "is she still there" (a call asked for now). One clock now, taken
   when the calendars are locked, for everything decided at that moment.
6. *A request's page left open across the 30 minutes kept offering the card.* The page now
   asks again every half minute while it stands at the card step. The count of requests
   standing there is also taken by the clock after the lock.
7. *The website's page said "enter your card" above "the time has passed".* It says the second
   in place of the first, once.
8. *"Check again" was only offered after the sheet had been open in the same sitting.* It is
   also offered when the app is opened again and the server could not be asked, and a refused
   check reads the page again.
9. *The read-only view of what was sent left out the rules the tick refers to, and the form
   could be changed while the first sending was on its way.* The view now shows everything
   (the points included), and it replaces the form from the moment the button is pressed.

## Astra's fourth look at the code (20 November 2026): "not ready", now worked in

It found the wording's version, the read-only view, the retry, the expired page and the open
card page fixed, and named six points; two it wanted before merging:

1. *(Before merging.) A made request could still be answered as refused* when the failure after
   it was written down was of another kind, or when the server could not look. The address now
   looks for the request after any failure. If it cannot look, it answers "not reached" rather
   than a refusal, so the app keeps what was sent and sends the same again.
2. *(Before merging.) The deciding clock was read just before the last lock was taken.* It is
   read after every lock now. **And one thing changed back, for the website's older check
   scripts:** those work with a clock of their own, and judging them by the real clock would
   have broken two of them. So only the two addresses that people's browsers and phones call
   are judged by the clock at the moment of deciding; a caller with its own clock is judged
   by the clock it hands in. Whether the card step's 30 minutes are up is measured by the real
   clock for everyone (a request is always made at a real moment).
3. *The check script cannot prove which Stripe account the app it talks to used.* **Carried as
   a note, not closed:** it stops unless the app hands out this tool's own test key and a card
   step, but an app started with another account's secret key and this key would pass. Start
   the app from the same `.env.local` as the script (as the README says).
4. *A new request could show "Check again" before anyone had entered a card* (the page asked
   twice when it learned how often to ask, and took an overtaken answer for a failed one).
   The two are separated now, and an overtaken answer says nothing.
5. *After a first sending was refused because the person is paused or signed out, the old
   form could stay on the screen* if the page could not be read again. It is cleared at once.
6. *Two of the website's check scripts would have failed* under the stricter clock. See 2.
   All seven that pass through the card step were run and pass.

## Astra's fifth look at the code (20 November 2026): one blocker left, now worked in

It found the clock, the false "Check again" and the leftover form fixed, accepted the split
between live callers and the check scripts, and named one blocker and four notes. All taken:

1. *(Blocker.) After an unforeseen fault (the database, say), the server looked for the
   request, saw none, and answered "nothing was sent", while an earlier sending with the same
   key could still be on its way to being written down.* Only one of the booking's own
   refusals now counts as "nothing was sent". After any other fault the answer is "it cannot
   be told", and the app keeps what was sent and sends the same again.
2. *A key could make a request that the look-up by key would not find* (two different tests
   of what a key looks like). One test now.
3. *The timer's plain reading could cut in on the fuller one made when the app comes back to
   the front,* and drop its question about the card. The timer now stands back meanwhile.
4. *"Your account is paused" could stay on the screen after the page was readable again.*
   It is said in the place of the page only.
5. *Two moments were still dated by the clock from when the question came in.* Both use the
   clock of the moment now.

## Astra's sixth look at the code (20 November 2026): one more race, now worked in

It found all five points of its fifth look fixed, and one race left of the same family:

1. *A retry could be told "not found" (or "this host cannot be booked right now") while the
   first sending was still being written down,* when the host hid her page in that very
   moment. Before any such answer the server now looks for the request **with the customer's
   calendar locked**. A request is made with that lock held, so one that is on its way is
   waited for and then found. If the look cannot be made, the answer is "it cannot be told".

## Astra's seventh look at the code (20 November 2026): the same family once more, now closed as a whole

It found the sixth look's race fixed, and one more of its kind: a sending tried again could
still get ahead of a first one that was waiting its turn for the host's calendar, and be
refused while the first went on to be made.

1. *Closed as a whole, not case by case:* **two sendings with the same key never decide side
   by side.** The step that makes a request first takes that key's place in a queue, before it
   looks at anything as it stands now; a second sending with the same key waits there (a few
   seconds at most) until the first is through, and then finds what the first made. Before a
   refusal is answered, the request is looked for through the same queue. If the first is
   still not through, the answer is "it cannot be told", and the app keeps what was sent. A
   check sends the same request twice at the very same moment: one request, both told so.
   This is in the website's own function, so a form sent twice there is covered too.
2. Everything about what the host offers (the length, whether she can be paid, the price, the
   cancelling rule) is now read once, with the calendars locked, and judged there.
3. *The wait had no limit of its own.* It has one now (8 seconds).
4. *(Found by the automatic security review of the saved code.)* A first version of this held
   one database connection open while the work inside took a second one, which a burst of
   sendings could have used up. The queue is now taken inside the one step that makes the
   request: one connection for each sending.

(The one thing a queue alone cannot close, a first sending still stuck on its way while its
second try is refused, is closed by the eighth look below.)

## Astra's eighth look at the code (20 November 2026): two gaps left, now worked in

1. *A first sending held up before it had taken its place in the queue.* Its second try could
   be refused for good ("that time has passed", say), and the first could still go on to make
   the request afterwards: the app would have said "nothing was sent" about a request that
   then exists. **A "no" for good now uses the key up.** It is written down in the key's own
   place in the queue (a small new table, `spent_request_keys`: the person, the key, when),
   and a sending with a used-up key makes nothing, however late it arrives and whatever has
   changed back. The app takes a new key for whatever the person sends next. A failure that
   is not a "no" (the database, Stripe, the wait running out) uses nothing up: the app keeps
   its key and tries again, as before. Checks: refused, then sent again with all in order:
   nothing is made; the same after "not found"; another person's key is not touched.
2. *The website said "Nothing was sent" when it had only given up waiting.* The 8-second limit
   on the wait for a key is now for the app alone, which can be told "it cannot be told" and
   keep its key. The website's form waits until the other sending is through and then finds
   what it made, as it always did. And when something else fails after the request was
   written down (the card step at Stripe, say), the website now opens that request instead of
   saying nothing was sent. A check holds a key for longer than the limit: the app's sending
   gives up and is told nothing certain, its key still good; the website's waits and goes
   through.
3. *(Note.)* The queue for keys and the calendars' locks shared one space of numbers, so by
   rare chance a key could have been the same lock as somebody's calendar. The keys now have a
   space of their own.
4. *(Note.)* After the wait for a key, the database's wait limit was set to "none" instead of
   to what it had been. It is now put back as it was. A check does it.

Also from the walk of part 08: the question before a request is taken back stays up when
another screen comes to the front beneath it (a link opened meanwhile). A "yes" now only
counts while that request is still the page in front.

## Astra's ninth look at the code (20 November 2026): the app's gap is closed; four website and tidying points, worked in

Astra found the app's retry gap closed in every ordering. What was left:

1. *The website could still say "Nothing was sent" when it could not tell* (a form sent twice
   while the database had a wait limit of its own). After a failure that is not one of the
   booking's own refusals, the website now says that it could not tell whether the request
   was sent, and to look at the home page before trying again. And after any failure, a
   request that was written down is opened instead of denied.
2. *(Note.)* A paid request written down without its card step (Stripe could not be reached
   at that moment) showed "reload this page" for ever. Its page now makes the card step when
   it is opened.
3. *(Note.)* Used-up keys could pile up without end. They are kept for a day (far longer than
   any sending can be on its way) and limited to 200 for one person. With the list full, a
   "no" cannot be written down, so it is not said for good: the answer is "it cannot be told".
4. *(Note.)* The check of the wait limit depended on timing. It now holds both places until
   the app's sending has given up, then lets go.

## Astra's tenth look at the code (20 November 2026): one gap reopened by the tidying, now closed for good

1. *Forgetting a used-up key after a day let it come back to life* (a call a week ahead: the
   "no" forgotten, then a held-up copy of the first sending arriving). **A key for the app now
   carries the moment it was made, and makes a request for half a day and no longer.** A
   used-up key is remembered for a whole day. So by the time a "no" is forgotten, its key is
   too old to make anything. The app takes the newest key each time it reads the summary; a
   page left open longer than half a day says "This page has been open for a long time.
   Please check the details and send again." A request that was made is still found by its
   key however old the key is. The website's form is as it was (it has no "used-up" keys).
2. *(Note.)* Two refusals at the very same moment could both take the last place in a
   person's list of 200. They now take turns. A check does it.
3. *(Note.)* On the website, a lookup that itself failed was read as "no request found". It
   now leads to "we could not tell whether your request was sent".
4. *(Note.)* The check of the wait limit could hang if the limit were ever lost. It now gives
   up after 40 seconds and lets go either way.

## Astra's eleventh look at the code (20 November 2026): "ready with changes", worked in

Astra found the gap closed for an honest app. Three small points, all taken:

1. A key that names a moment still to come (only a tampered app could send one) could be
   refused, forgotten after a day, and then be used when its moment came. A used-up key is
   now kept for as long as it could still make a request.
2. The day after which a used-up key is forgotten is now counted by the database's own clock,
   the clock that dated it, so two servers whose clocks differ cannot disagree about it.
3. The website's form no longer makes a new request with a key of the app's kind, so an app
   key that has grown too old cannot get in through the form.

**The database gets one small new table with this part** (`spent_request_keys`). Its change
file is made when this part's pull request is opened, so its number comes after whatever has
been merged by then.

## What the newer main brought (20 November 2026), taken into this part

Two changes of the legal work were merged while this part waited (#78 and #80, then the
agreements, #85). They changed pages this part had moved into shared files, so the app follows
them here and not in a later part:

1. *New sentences.* The note to the host, the box about the card (with the 14-day sentence),
   and what the ID check tells us are now the shared files' wording, so the website and the app
   say the same.
2. *The Identity Check Notice (plan 46, decision 9).* The app's "Confirm who you are" screen
   shows the notice in full above its button, as the website does, with a link to that exact
   version on the website. The button reads "I agree, continue to Stripe". The app sends back
   which version it showed; the server writes the agreement down first (the website's own
   function) and only then asks Stripe for a check. A request that names no notice, an older
   version, or another document starts nothing and writes nothing; the app then shows the
   notice again. The app draws the text from the same pieces the website's reader gives, and
   draws nothing if one piece is not known to it, so no part of a legal text can go missing
   silently.
3. *Business or private person (plan 46, decision 10).* A host's own statement is shown in the
   app where the website shows it: on her page and before asking. Nothing until she has said.
4. *An account paused by an "under 18" result (#78)* is told that it is paused at the app's
   two ID-check addresses, and starts no check.
5. The table for used-up keys is `drizzle/0050_spent_request_keys.sql` (the agreements took
   0049 first, as the two sessions had agreed).

**Astra's look at this change (20 November 2026): "ready with changes", five notes, all taken.**
Every heading of the notice is drawn (the document's own title too); a table without rows
still shows the names of its columns; the app takes the notice only if it is the identity
notice and its link is the address of exactly the version it names; a mail link is one mailbox
and nothing else; the check script compares the whole text piece for piece with the website's.

**Walked on the Android test phone:** the notice on "Confirm who you are" (headings, bold, lists,
the blanks of the draft standing out, the sentence and the button under it). **Not walked:**
pressing the button from the phone (it uses up one of three tries; the check script does it),
and a host's "business or private person" line (no test host has said yet; the check script
sets it and reads it back). Both are on the list for the walk of the whole journey (part 20).

## Astra's check of the plan (20 November 2026): "not ready", now worked in

1. *The consent was put too late and the card's lifetime was wrong.* The box is ticked before
   sending, and the card stays through the call for more time. Decision 2, "What is there".
2. *What `askForCall` really takes* (the note, what the person saw, the once-only key) and the
   states of the request's page. Added.
3. *Stripe's sheet:* yes on the existing steps; cards only; the way back into the app; the
   server decides. Decisions 3 and 4.
4. *A booked request's page does not update itself today.* Decision 5.
5. *The ID check belongs here, and its return page needs a signed-in browser today.*
   Decision 6.
