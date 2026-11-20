# Plan 47: Bank disputes, handled without the founder

**Status:** a plan only. Written 20 November 2026 by the builder alone (no helper agents), from
the code as it is on `main` after pull request 83 and from Stripe's own pages read that day
(listed under "What Stripe says"). Astra (gpt-6.2-astra) checked the first draft against the
code: "not ready", eight points that had to be fixed. Its second look, at the second draft: "not
ready" again, seven new points, most of them about the same two places (who answered the bank,
and the take-back). Its third look, at the third draft: "ready with changes", five points to
settle before the part they belong to is merged. They are worked in here; what was taken and
what was not is at the end.

(Number 46 is taken by another session's plan, "agreements live", which is not merged yet.)

**Its size, said plainly:** about one module, built in three parts. No second payment system is
built. The careful money code that exists (written-down money actions, the helper, "Collect
earnings") keeps doing the work; this plan adds a record of each dispute, decisions that are
made by a person or by a rule instead of by the founder, and two requests to Stripe that the app
does not make today (answer the bank, take a share back).

## For the founder: what this is

A customer can ask their bank to pull a payment back. Banks call it a chargeback; the app calls
it a bank dispute. Today the app freezes the money and waits for you to do the rest by hand in
Stripe. After this plan:

1. **Everyone is told at once.** The host, the customer and you each get a message. A new page,
   "Messages", keeps these messages inside the app, and the same text goes out by email.
2. **The host chooses, within 24 hours:** "Give the money back" or "Fight it". No answer counts
   as "Fight it".
3. **The app answers the bank by itself.** To fight, it sends the bank what it has on record
   about that payment and a short letter written for the bank's kind of claim. To give in, it
   tells the bank so.
4. **A host who already collected pays it back.** When a dispute is lost, the app tells the
   host what they owe and why, waits 14 days, and then takes that amount back at Stripe.
5. **The customer cannot start anything new that costs money while their chargeback is open.**
   If it ends well for everyone, that is over by itself. If the bank sides with them after the
   app sent its proof, it stays until you allow it again.

**What still reaches you** (each is rare, and each is said plainly here and in the app):

- One kind of dispute the app does not fight, because fighting it costs 500 dollars of your
  money each time (decision 7). You are told, with the bank's deadline, and can fight it in
  Stripe yourself. **Say so if you want the app to fight these too.**
- A fault: the app could not send its answer to the bank, or could not take a share back.
- A host or a customer who writes to support because they think a decision is wrong.
- Two leftovers named under "Not in this plan".

**One thing you should know now.** You asked for the answer to show "our agreements". Today
the app has little to show: the Terms page is a placeholder, and the app records only when a
person last accepted the terms, not what they said. So until the real agreements are live
(another session's plan 46), the letter to the bank cites what the app itself showed the
customer (the price, the cancelling rule) and what the customer did (whether they asked for a
refund in the app), and nothing it cannot prove.

## What the founder said (20 November 2026)

- "How do we handle customers asking their money back from their credit card company?"
- "for all disputes, I don't want to manually handle it. so maybe we can have an auto response
  to the bank rejecting the dispute and showing the transaction that has happened and our
  agreements and why it can't do the refund?"
- "the host would be given a choice to refund the person or dispute it, and we have an automatic
  fight the dispute if the host doesn't wants to fight it or the host didn't respond in 24
  hours."
- "yes build it. instead of just getting an email. maybe on the app there is a message center
  too where the hosts and customers could automatically see messages from us, messages like
  this."
- About the customer: "maybe we have some kind of system to give the best customer experience
  yet preventing abuse".
- "shouldn't astra review the plan too?" and "after building everything, let the mobile app
  session agent know what you have done."

So these are the founder's: no manual handling; an automatic answer to the bank with the
transaction and the agreements; the host's choice with 24 hours and "fight" as the default; a
message center; a rule for the customer that is kind and still stops abuse. How each is shaped
below is the builder's choice unless it says otherwise, and the founder can change any of it.

**Two things the builder told the founder that turned out wrong, corrected here:**

- "The app should give in by itself when the call never took place or the host did not show
  up." The app does not charge for a host who did not show up: a call's charge is worked out
  from the time the host was in the room (`src/lib/payments/jobs.ts`, `settleOne`). (A call the
  customer cancelled late is charged without having taken place; that is the cancelling rule,
  and decision 8 says how it is put to a bank.)
- "Pulling the money back at Stripe works only while it still sits in the host's balance, and
  taking it from the host's bank is possible only in some countries, so I would leave both out."
  Stripe's pages advise exactly this for our kind of charge: reverse the transfer. Our hosts'
  accounts are ones where Connect carries the losses (`losses_collector: "application"` in
  `src/lib/payments/host-account.ts`), and for those Stripe's page names no "not enough funds"
  refusal. Tried in Stripe's test area on 20 November 2026: a transfer to the test host's
  account was reversed, in two parts, while the account had nothing available (the money was
  still "pending"); the same request under the same label gave the same reversal back; one cent
  more than was sent was refused. What could not be produced there is an account whose money
  has already gone to the bank. So part 3 uses the reversal, and has an answer for a refusal.

## What is there today (each read in the code by the builder)

- **Stripe's messages.** `charge.dispute.created` and `charge.dispute.closed` arrive at
  `src/app/api/stripe/webhook/route.ts`, are saved, and handled by `handleStripeEvent`
  (`src/lib/payments/stripe-events.ts`). A message is only a nudge: Stripe is asked where the
  dispute stands and that is recorded. A message that could not be handled is tried again by
  the helper (`retrySavedStripeEvents`). While any message about a dispute is unhandled, no host
  can collect (`disputeMessageWaiting` in `src/lib/payments/collect.ts`).
- **What is recorded.** For a call's card payment: `payments.disputeOpen`, true while the
  dispute is with the bank and also after it is lost (`BLOCKING_DISPUTE` in
  `src/lib/payments/disputes.ts`). For a membership's month and for a contribution's payment
  (tips are contributions): a `dispute` field of their own (open, won, lost), and the membership
  or monthly contribution ends at once, which also cancels a member's upcoming member calls. The
  helper asks Stripe about those two kinds again every hour while a dispute is open
  (`runDisputeLooks`); it does not for a call's payment.
- **A fault that is there today** (Astra found it): a bank can dispute one charge more than
  once. For a month and for a contribution the app looks at all disputes on the charge together.
  For a call's payment it sets the flag from the one dispute the message is about, so a won
  dispute can unfreeze money that a second dispute still holds.
- **What a dispute blocks.** The host cannot collect that money (`heldBack`, "dispute"), and it
  cannot be refunded on top (`refundPayment`).
- **Who is told.** When a membership or a monthly contribution ends because of a dispute, both
  sides get an email that it ended. About a dispute on a call's payment nobody is told. The
  founder sees a line on the admin page.
- **What is never done.** No answer is sent to the bank. Nothing is taken back from a host who
  had already collected: a lost dispute is "settled by hand". The customer keeps full use of
  the app.
- **Emails.** Every email is written into `email_outbox` first (`queueEmail` in
  `src/lib/email.ts`), in the same database step as the event it reports, with a key so it is
  written once. There is no place inside the app where a person can read what Connect told them.
- **Collecting.** A host's share can be collected 24 hours after the call ends
  (`COLLECT_AFTER_MS`). A bank can open a dispute for about 120 days. So most disputes will
  arrive after the host has collected.
- **What the app can prove about a payment.** The call, its price and its cancelling rule as
  they were fixed at booking; who joined and left when (`attendance_events`); what was charged
  and why (`payments.chargeReason`: the time in the call, a late cancellation, or the founder
  after a review); a refund request and its answer; refunds; for a membership, each agreement
  with its date; for a contribution or a tip, its agreement with its date. It cannot prove from
  which device or address a payment was made (a login's address is kept, but not tied to a
  payment), nor what the terms said.
- **The check script** `scripts/payments-check.ts` (journey 28) already makes a real dispute in
  Stripe's test area with Stripe's always-disputed test card, and loses it.

## What Stripe says (read 20 November 2026, on docs.stripe.com and in the installed library)

- **We answer, and we pay.** For our kind of charge (Connect charges the customer and sends the
  host a transfer), Connect answers the dispute, and the disputed amount and the fees come out
  of Connect's balance (`/connect/disputes`).
- **One answer per stage.** Proof is sent with "update a dispute" and `submit: true`. It goes
  to the bank at once and cannot be changed or added to. The text fields together may hold
  150,000 characters. `evidence_details.submission_count` says how often proof was sent
  (`/disputes/api`, `/api/disputes/update`).
- **Giving in** is "close a dispute". It cannot be undone.
- **Where a dispute can stand:** a bank's question waiting for an answer
  (`warning_needs_response`), a question under review, a question closed (`warning_closed`,
  after 120 quiet days); a chargeback waiting for an answer (`needs_response`), under review,
  won, lost; two appeal states; and `prevented`. They do not come in one fixed order, and the
  first time the app sees a dispute it may already be past the first.
- **A question can become a chargeback on the same dispute.** It then needs a new answer.
- **Time.** A bank gives 7 to 21 days; the dispute carries the date (`evidence_details.due_by`,
  which can be empty). The bank then takes up to 3 months to decide.
- **Fees.** Stripe charges a fee when a dispute is received, and since June 2025 a second fee
  when it is fought, which comes back only if it is won (`/disputes/responding`). The amounts
  are on Stripe's pricing page; the builder remembers 15 dollars each in the United States and
  has not read that page. Answering a question well costs nothing.
- **Compliance disputes** (Visa and Mastercard; marked in `enhanced_eligibility_types`, reason
  `noncompliant`): fighting one costs 500 dollars on top, given back only on a win, and Stripe
  sends the answer only when that fee is acknowledged in the request. Closing one costs nothing.
- **Taking money back from a host.** Stripe's advice for our kind of charge: reverse the
  transfer, right away when giving in, after the outcome when fighting. A reversal can be for
  part of a transfer, several times, never for more than was sent. A balance below zero is made
  up from later payments; Stripe also debits the account's bank in the United States, Canada,
  the United Kingdom, the euro countries, Australia and New Zealand; payouts to the bank stop
  while the balance is below zero; Stripe sets aside the same amount from Connect's balance
  meanwhile, and takes it for good after 180 days (`/connect/account-balances`).
- **Stripe's own automatic answer** ("Smart Disputes"): a switch in Stripe's settings. For
  disputes it thinks it can win, Stripe sends its own proof just before the deadline if nobody
  answered, and charges a fee only on a win. It knows nothing about our calls. A dispute can
  therefore be answered by Stripe, or by a person in Stripe's dashboard, and not by the app.
- **Testing.** Test cards make a dispute at once: claimed as fraud (`pm_card_createDispute`), as
  "not received" (`pm_card_createDisputeProductNotReceived`), as a question
  (`pm_card_createDisputeInquiry`), several disputes on one charge
  (`pm_card_createMultipleDisputes`), a compliance one (card 4000008400000779). Proof whose
  free text is exactly `winning_evidence` or `losing_evidence` makes Stripe decide that way.

## Decisions

The founder's are marked. All others are the builder's own.

1. **One record per dispute, and one way of reading Stripe.** A new table `disputes`, keyed by
   Stripe's own id for the dispute, holds what the app knows and does about it. It belongs to
   exactly one of: a call's card payment, a membership's month, a contribution's payment (the
   same three owners a money action has). The fields that exist today (`payments.disputeOpen`,
   the two `dispute` fields) keep their meaning and stay the only thing the money code looks at.
   Each of the three kinds gets its fields from one read of **all** disputes on that charge,
   with the owner locked, as the month and the contribution already do; the call's payment is
   brought into line (this mends the fault named above). The same read writes the dispute rows.

2. **A message center** (the founder's idea). A new page "Messages", in the top bar for everyone
   who is logged in, with the number of unread messages beside it. A message is a short text from
   Connect with a link to where the person can act. Each message is written in the same database
   step as the email with the same words, under the same key, so the two can never differ and
   neither is written twice. In this plan only the messages about disputes and take-backs go
   there. Moving older emails (a request answered, a refund) into it is a small change of its own
   per feature, later.

3. **A dispute has stages, and each stage gets its own answer.** A stage is "the bank's
   question" or "the chargeback". The choice, its deadline, what was sent, and the label of the
   request to Stripe all belong to one stage. When a question that was answered becomes a
   chargeback, a new stage begins, with nothing carried over except the record of what happened
   before. A stage only begins when the app sees the dispute **waiting for an answer**: a
   dispute first seen under review, or already ended, asks nobody anything.

4. **The host is asked** (the founder's rule), for a chargeback. The host of that money gets a
   message and a page with two buttons. The first choice stands. The time to choose is 24 hours
   from the moment the app first sees the chargeback waiting, but never later than 3 days before
   the bank's own deadline; if that leaves no time, nobody is asked and the app fights. (Stripe
   marks a dispute the bank takes no answer to with a deadline of zero: then nobody is asked,
   nothing is sent, and the record says so. Where Stripe gives no date at all, the 24 hours
   apply.) A host whose account is closed is not asked. No answer in time counts as "fight"
   (the founder's rule). The host's press and the helper's "time
   is up" take the same lock and read the clock after they have it, so exactly one of them
   decides.

5. **"Give the money back" means giving in at the bank.** It is not a refund: the bank has
   already taken the money from Connect, and a refund on top would pay the customer twice. The
   page says so, and says what it costs the host: their share of that payment, and if they had
   already collected it, that it will be taken back (part 3).

6. **The app answers the bank, and only calls an answer its own when Stripe said so.** Once
   the choice is made or the time is up, the helper sends the proof (to fight) or closes the
   dispute (to give in). The request is written down before it is made, with a label that names
   the dispute, the stage and the kind of answer. An answer counts as the app's own only when
   Stripe's reply to that very request says it was done. When the reply is lost, the same
   request is sent again under the same label, which is safe for 23 hours (Stripe then gives
   the first reply back, or does it now); this is how every money action in the app finds out.
   If Stripe refuses because the dispute is no longer waiting, or the 23 hours are over, the
   record says what Stripe shows and "not known who answered": it may have been Stripe's own
   automatic answer or a person in the dashboard. Nothing is ever concluded from Stripe's count
   of submissions or from the status alone, and a dispute that ran out of time unanswered is
   recorded as that, not as an answer. So a bank never gets two answers from the app, and a
   lost reply from Stripe never leads to none.

7. **One kind is not fought by the app: a compliance dispute.** Fighting one costs 500 dollars
   of Connect's money, returned only on a win, and spending that is the founder's decision, not
   the app's and not a host's. This is checked first, before anything else is decided about a
   dispute (also before a bank's question is answered). The host is not asked and is told why.
   The founder is told at once, with the bank's deadline, and can fight it in Stripe. The app
   does nothing more at the bank: it does not give in early either, because that cannot be
   undone and the outcome is the same. When the deadline passes the dispute is lost, and it is
   recorded as "not answered". The founder can change this rule (see the top).
   **Asked by the founder the same day:** "that should depend on the amount of dispute right?
   if the dispute is large enough, then we fight right? what's the right amount? (given we get
   only a 2% fee)". The builder's answer: on Connect's own 2% it never pays; counting the host's
   money too it pays from about 2,000 dollars at one chance in five of winning. So part 2 builds
   the rule with an amount: a setting, "fight compliance disputes from this amount", empty to
   begin with (never). At or above it, a compliance dispute is handled like any other (the host
   is asked, the app answers) and the request acknowledges the 500 dollars. The founder had not
   yet said which amount when this was written; nothing is fought until they do.
   (A charge the app has flagged because the call's record changed after the money was taken,
   `flaggedAfterCharge`, is handled like any other: the proof gives the record as it stands
   now, beside what was charged. Decision 8.)

8. **What the proof says: only what is on record for that payment, and only what is true.**
   - It is built from why the money was taken, and read from the record at the moment of
     sending. For time in a call: who joined and left when, the time that counted, the price;
     and if the record has changed since the charge, both what was charged and what the record
     says now. For a late cancellation: when the customer cancelled, the cancelling rule that
     was fixed on the call when it was booked, and that the booked price was charged under it;
     it never says the call took place, and never says nobody joined unless the record shows
     that. For a charge Connect set after a review: that, the amount, and the record it was set
     on. For a membership month: the agreement and its date, what the month gave, what was
     used. For a contribution or a tip: the agreement and its date, and that it is a gift that
     buys nothing.
   - A refund request is mentioned as the record has it: the customer made one on that day and
     got that answer, or made none in the app. No length of time is claimed.
   - The terms are mentioned only as far as the record goes: that the person accepted them, and
     when, if that was before the payment. What they said is not quoted. The legal drafts in
     `docs/legal/` are never presented as accepted.
   - No device or internet address is given: the app cannot tie one to the payment.
   - The letter puts first what answers the bank's stated reason ("I did not make this
     payment", "I did not get it", "I cancelled", "I was charged twice", or none of these).
   - A fact that does not help (the customer never joined, and was charged for the host's
     waiting time) is said as it is.
   - A bank's question gets the same facts, shorter.
   - What is kept as "the proof that was sent" is what Stripe's reply shows the dispute's
     evidence to be, so anything a person had added in the dashboard before is in it too.

9. **The customer** (the founder asked for a system; this one is the builder's).
   - They are told at once, kindly: which payment, that their bank opened a dispute, that their
     bank can withdraw it if it was a mistake, and what it means in the app.
   - While a chargeback of theirs is open they cannot make a **new agreement to pay**. The line
     is drawn by what is written into the database: refused is whatever would write a new
     request for a paid call (booked or "now"), a new request for added time paid by card, a
     new tip, a new contribution, a new membership agreement (joining or resuming), or would
     switch a stopped membership's renewals back on. Everything that acts on a row that is
     already there runs on: paying for and holding a call that is booked, finishing a card step
     that was begun, booking from a membership they have, renewals of a membership or a monthly
     contribution with another host, the helper's own tries with a saved card. (The membership
     or monthly contribution the dispute is about ends, as it does today, and with a membership
     its upcoming member calls.) Logging in, joining calls and their own hosting are not
     touched. It is much narrower than the founder's "pause" (`user.pausedAt`).
   - It ends by itself when the chargeback is won or withdrawn, when the host chose to give the
     money back, and whenever the dispute ended without the app's own proof having gone out
     (decision 7, an answer by somebody else, no answer in time).
   - It stays only when the bank decides for the customer after the app's own proof went out
     (decision 6 says when that is certain). The message says so and where to write. The
     founder can allow paying again with one button.
   - A bank's question stops nothing customer-wide: it can stay open for 120 days with no
     decision. (It does end the membership or monthly contribution it is about, as today: the
     founder decided that when memberships were built.)
   - Nothing new is stored on the person: it is read from their disputes. A payment started in
     the same instant a dispute arrives may slip through; that is accepted.
   - The payment terms draft (section 9.7) speaks only of a pause while the dispute is open, and
     the host agreement draft (section 9.1) does not say the host is asked. Part 2 changes those
     two sentences in the drafts, so they say what the app does.

10. **Taking a share back** (the founder agreed to "from later earnings"; that it is done by
    reversing the transfer at Stripe is the builder's, see the correction above).
    - Only after a dispute is lost, never while it is open (the founder's choice of 20 November,
      when offered both).
    - What is owed: what was sent to the host for that payment. If the bank disputed only part
      of what was left of the charge, the same part of what was sent, rounded down to the cent.
      Never more than is left of that transfer after what Stripe has already reversed and what
      other take-backs on the same share are still to take (two disputes can be lost on one
      charge). A result of zero makes no take-back.
    - The host is told in writing: which payment, why, how the amount is worked out, and that
      they have 14 days to say it is wrong (host agreement draft, section 9.4).
    - After the 14 days the helper reverses that amount of that transfer. If Stripe refuses, it
      is tried again once a day; a refusal for lack of funds ends as soon as later earnings
      reach the host's Stripe balance. After 30 days of refusals the founder is told.
    - The founder can cancel a take-back until the moment the app starts it, which is how an
      objection is honoured. One that has started cannot be cancelled.
    - The bank's fees are not charged to the host (section 9.2 leaves that to a judgement).

11. **The founder is told twice per dispute:** when it opens (what it is, what the app will do,
    and by when) and when it ends (won or lost, and what follows for the money). The admin page
    gets a "Bank disputes" list.

12. **Nothing is switched on at Stripe by this plan.** Stripe's own automatic answer stays as it
    is set.

## The order of locks

No existing order is changed, and none is restated here: each step of this plan that needs an
owner locks it by calling the very function that locks it today for a dispute
(`recordMonthDispute`'s locks for a month, `lockForPayment` for a contribution's payment, the
call and then its payments for a call, as `src/lib/refunds/requests.ts` does). New rows come
last: a dispute's row is locked only after its owner, and a take-back's row only after its
share's payment (which the money action locks). The take-back steps lock nothing else: they
read the dispute without locking it. No step locks a dispute or a take-back first and then asks
for an owner or a payment.

## The parts

Each part is built, checked against Stripe's test area, read by Astra, and merged on its own.
The words people read are true after each part, not only after the last.

### Part 1: the record, the Messages page, and telling everyone

**New tables** (one migration):

- `messages`: id, the person, a subject, a text, a link inside the app (may be empty), a key
  (unique, the same key the email carries), written at, read at.
- `disputes`: Stripe's id (the key); exactly one of payment, month, contribution payment; the
  host and the customer; the disputed amount and its currency; the bank's reason; whether it is
  a compliance one; the stage it is in (question or chargeback); Stripe's status as last read;
  when Stripe opened it; the bank's deadline; how it ended (won, lost, or closed with no
  decision) and when. The fields of parts 2 and 3 are added by those parts.

**New code:**

- `src/lib/messages/messages.ts`: `tell(tx, …)` writes the message and the email (through
  `queueEmail`) in one step; `messagesOf`, `unreadCount`, `markRead`.
- `src/lib/disputes/status.ts`: plain functions, with tests: what Stripe's status means (waiting
  for an answer, with the bank, ended and how; the two appeal states and any status the app does
  not know count as "with the bank"; `prevented` and a closed question count as ended with no
  decision),
  which stage it belongs to, and whether a set of disputes blocks a charge.
- `src/lib/disputes/record.ts`: `recordDisputesOf(owner)`. With the owner locked in its own
  order, it takes all disputes Stripe has on that charge (read just before, and read again
  after, as today), writes or updates their rows, and in the same step writes the messages a
  change calls for: "a stage began" whenever a stage is first recorded for a dispute that has
  not ended (a new row, or a question that became a chargeback on a row that was there),
  "ended" when an ending is first recorded. A dispute first seen already ended is recorded
  without messages. Keys name the dispute, the stage, the event and the person.
- The three places that read disputes today (`handleStripeEvent` for a call's payment,
  `refreshMonthDispute`, `refreshDispute`) do what they do now first, and save it. What they do
  does not change, except that a call's payment gets its flag from all disputes on the charge.
  Only then, in a step of its own, the record is written. If that second step fails, the money
  is already protected and the Stripe message still counts as handled (so that no host is kept
  from collecting); the fault is logged and the catch-up below writes the record.
- **Catching up.** Once an hour the helper asks again about every dispute in the new table
  that has not ended, whatever kind of money it is about, and passes its owner to the same
  read. (The two hourly looks that exist go by "the month is open": a month already marked
  lost by one dispute is skipped although a second dispute on it is still open. Going by
  dispute closes that gap. The old looks stay as they are.) It also asks Stripe for the
  disputes of the last 7 days every hour, and for those of the last 130 days once a day. Any
  it does not have is recorded, and any it has under another status than Stripe now shows is
  read again (an appeal on a dispute that had ended, for example). So a lost message, or a
  dispute that began before this part existed, cannot stay unknown or out of date. (Stripe's
  list goes by the day a dispute was opened; a change later than 130 days after that needs its
  message to arrive.)
- `charge.dispute.updated` and `charge.dispute.funds_reinstated` are added to the list in
  `scripts/stripe-webhook-setup.ts`.

**Pages:**

- `/messages`: the person's messages, newest first, unread ones marked; they count as read once
  the page has shown them.
- The top bar (`src/components/site-page.tsx`): "Messages", with the unread number.
- `/disputes/[id]`: for the host of that money and for the founder. What is disputed, the
  amount, the bank's reason in plain words, where it stands, the bank's deadline. (The buttons
  come in part 2.) Anyone else gets "not found".
- The admin page: a "Bank disputes" list (open ones first, then the last 20 that ended), each
  linking to its page.
- The host's earnings: the existing line about a disputed payment links to the dispute's page.

**What the three are told in part 1** (short, true today):

- Host: the customer's bank is disputing this payment; the money for it cannot be collected
  while that lasts; do not contact the customer about it; the link.
- Customer: your bank told us you disputed this payment; if that was a mistake, your bank can
  withdraw it; if something went wrong, write to support.
- Founder: who, what, how much, the bank's reason and deadline; that today it still has to be
  answered in Stripe by hand (this sentence goes in part 2).
- At the end, all three: how the bank decided, and what that means for the money.

**Checked by** tests for `status.ts` (every status, a question becoming a chargeback, two
disputes on one charge in every mix) and a new script `scripts/disputes-check.ts`, against
Stripe's test area: a real dispute is recorded once however often the message is handled; two
messages at the same moment write one row and one set of messages; the email and the message
carry the same words; a person sees only their own messages, and only the host and the founder
can open the dispute's page; the hourly look records an ending when the "closed" message never
came; the catch-up finds a dispute no message announced; a charge with several disputes stays
frozen while any of them is open or lost; a dispute on a month and one on a contribution are
recorded with the right owner; a failure while writing the record leaves the Stripe message
handled; everything `payments-check`, `membership-check`, `contribution-check` and `tip-check`
check about disputes still passes.

### Part 2: the host's choice, the answer to the bank, and the customer

**Added to `disputes`**, all belonging to the stage the dispute is in: from when the stage
counts and until when the host is asked (empty when nobody is asked); how many times proof had
been sent when the stage began (kept for the record only); the choice (fight or give back), who
made it (the host, or nobody in time) and when; the answer (none yet; being sent; proof sent by
the app; given in by the app; not answered by the app, with what Stripe showed), when it was
written down, when it was confirmed, and the last error; the proof as Stripe's reply showed it. Beside them, for the whole dispute: "paying allowed
again" (when, by whom), and a short history line for each stage that is over.

**New code** in `src/lib/disputes/`:

- `choose.ts`: `chooseAnswer({disputeId, by, choice})`, in one locked step: the dispute is in
  the chargeback stage and waiting for an answer, the person is its host, no choice was made in
  this stage, and the time, read after the lock, is not over.
- `evidence.ts`: builds the proof from the record, per owner kind, per reason for the charge and
  per bank's reason (decision 8). It only reads, and is a plain function of what it read, so it
  is tested without Stripe.
- `answer.ts`: the helper's job, each pass. For each dispute whose answer is due (a choice was
  made; or the time is up; or it is a question) and that is not one of decision 7:
  1. With the dispute locked, and nothing written down for this stage yet: read Stripe. If the
     dispute is not waiting for an answer in this stage any more, record "not answered by the
     app" with what Stripe shows, and stop. Otherwise build the proof now, and write down the
     request for this stage with its label (`dispute:<id>:<stage>:<proof or give-in>`), the
     exact request, and the time.
  2. Ask Stripe (`update` with `submit: true`, or `close`), with that label.
  3. With the dispute locked: if the request written down is still the one of the stage the
     dispute is in, record Stripe's reply as the app's own answer, with the evidence the reply
     shows. A reply for a stage that is over is noted in the history and changes nothing.
  Before every sending, the first and each repeat, Stripe is read once more. If the dispute
  has moved to another stage meanwhile (a question that became a chargeback), the request
  written down is retired unsent and the new stage takes its own course; a question's shorter
  answer is never sent as a chargeback's. The stage is checked again in the dispute Stripe's
  reply returns.
  A request written down and left without a reply stays the helper's work until it is settled,
  however long the helper was away:
  - inside 23 hours, and the stage still waiting: the same request again under the same label;
  - after 23 hours, or after a "no" that says the dispute is not waiting any more: Stripe is
    read. Still waiting in this stage: the old request is closed as "not sent" and a new one is
    made, with the next number at the end of its label. Not waiting any more: the stage is
    recorded with what Stripe shows and "not known who answered" (Stripe's own mark for its
    automatic answer, `submission_method`, is noted when it says so). If Stripe cannot be read,
    nothing is concluded and it is looked at again next pass.
  - any other clear "no": noted, and a new request an hour later.
  So "not answered by the app" is said only when no request of the app was ever written down
  for that stage; with one written down and no reply to it, the record says "not known who
  answered". The customer's lasting stop follows neither. One day before the bank's deadline a
  dispute that is still waiting and has no answer is a fault: the founder is told, and the
  health address says so.
- **When this part goes live**, disputes that part 1 recorded and that are still waiting get
  their stage fields on the next look, and their hosts get the message with the choice once,
  where time is left.
- `paying.ts`: `payingStopped(reader, userId)`, as decision 9 defines it. Asked in exactly the
  steps that write a new agreement to pay, at the point where the new row is written, never in
  a shared check that later steps reuse (`checkMayAsk` in `src/lib/booking/bookings.ts` is one
  such, used again by `finishCardStep`): `askForCall` and `askNow` when the call has a price;
  `askForMoreTime` when it means a new card charge (`src/lib/extend/extend.ts`); joining a
  membership and `resume` (`src/lib/membership/join.ts`); `acceptLessTime`, which writes a new
  agreement; `undoStop` (`src/lib/membership/ending.ts`), where it is the member who is looked
  at, also when the host presses; starting a contribution (`src/lib/contributions/start.ts`)
  and `startTip` (`src/lib/contributions/tip-start.ts`). Not asked anywhere else. In
  particular not in `startHold`, `finishCardStep`, the two `payNow` and the two `secretToPay`
  (`src/lib/membership/charge.ts`, `src/lib/contributions/start.ts`: they act on a month or a
  payment that is already written, also when they make its payment at Stripe for the first
  time), `bookAsMember` (also when the first booking takes a held month's money), and the
  helper's jobs, nor in `takeBackLessTime` (the host withdraws an offer and the agreement that
  was there goes on). Each place is read before it is changed; the check script walks every one,
  both lists.

**Pages:** the two buttons on `/disputes/[id]` with what each means and costs, then what was
chosen and what was sent; for the founder the proof as sent and "Allow paying again". The words
of part 1's messages change to say what now happens (the host: "choose by …, or we fight it";
the founder: "nothing is needed from you", or, for decision 7, "the app does not fight this kind;
you can, in Stripe, until …"). The email that asks the host to choose expires when their time is up. Two
sentences in the legal drafts change (decision 9).

**Checked by** tests for `evidence.ts` (each kind of money, each reason for a charge, each
bank's reason; a late cancellation never says a call took place; terms accepted after the
payment are not mentioned; nothing of another person) and `scripts/disputes-check.ts`, with real
disputes in Stripe's test area:

- the host fights: Stripe shows one submission with our fields, and the dispute is under review;
- nobody answers: the same, at the end of the time, and not a second earlier;
- the host's press and "time is up" at the same moment: one decision;
- the host gives back: Stripe shows the dispute as lost, the customer may pay again;
- a question: answered at once, nobody asked, nothing stopped for the customer;
- a question that became a chargeback (the stage step is driven by hand in the script, since
  Stripe's test area has no card for it): the host is asked, and a second answer is sent;
- a compliance dispute: nothing is ever sent, the founder and the host are told, and the
  customer is not stopped afterwards;
- a charge flagged after it was taken: fought like any other, and the proof gives both records;
- a dispute already answered from outside (the script answers it at Stripe itself, as a person
  in the dashboard would): recorded as "not answered by the app", nothing sent, and the
  customer is not stopped after a loss;
- the request written down and never sent (the step is cut before Stripe), then answered from
  outside: never recorded as the app's own;
- the reply from Stripe is lost (the step is cut after Stripe did it): the same request again
  gives the same reply, nothing is sent twice, and it is recorded as the app's own;
- a dispute the bank takes no answer to (deadline zero, set by hand in the script): nobody is
  asked, nothing is sent;
- won, and lost after a fight (with Stripe's two magic texts, sent by the script in place of our
  letter): the messages, and paying on again or still off, and on again after the founder's
  button;
- a second choice, a choice by a stranger, a choice after the time: all refused;
- every "new" place refuses while paying is stopped, with a sentence that says why, and accepts
  again afterwards; every "carried on" place still works.

### Part 3: taking a share back

**New table** `host_debts`: the dispute, the share's payment, the host, Stripe's transfer, the
amount and its currency, told at, due at (14 days later), where it stands (told, cancelled,
being taken, taken), Stripe's id of the reversal, the last refusal and when. One row at most for
a dispute and a share.

**New code** in `src/lib/disputes/takeback.ts`:

- **Finding what is owed** is a look the helper repeats, not a single moment: for every lost
  dispute, every share under it that was sent with a real transfer (`transferStatus` "sent",
  `transferCents` above zero, a transfer id) and has no row yet gets one, in one step with the
  share's payment locked, together with the message to the host (decision 10). The amount is
  worked out in that step, with the share locked, from what Stripe says is left of the
  transfer and from the other rows on the same share that are not cancelled and not taken; a
  result of zero writes no row and no message. While another row on the same share is "being
  taken", the look leaves that share for the next pass: the amount is only worked out when
  nothing on that transfer is under way, so one reversal is never counted twice. It runs when
  a loss is recorded and on every pass after. So a transfer that was under way when the loss arrived, and finished later, is
  found too.
- **Taking it**, once a row is due: first Stripe is asked whether the dispute is still lost
  (if not, the row waits and the record is brought up to date). Then a money action of a new
  kind, "take back", on the share's
  payment, with the label `takeback:<debt id>`, through the steps every money action takes
  (`runMoneyOperation`). Its first step, with the payment locked, moves the row from "told" to
  "being taken"; a cancelled row is refused there. Stripe is asked to reverse that amount of
  that transfer, with the row's id in the reversal's notes. An outcome that is not known is
  found out by `reconcileOperations`, which gets the new kind: the same request under the same
  label while that is safe, and after that every page of the transfer's own list of reversals,
  searched for the row's id. Whatever it finds, the action and the row are finished together,
  in one step: done (the action "succeeded", the row "taken", the money record's line), or not
  done (the action "failed", the row back to "told" with the reason). The existing branch that
  marks a refused action as failed (`failOperation`) does not know the row; for the new kind
  all three ways an action can end as "not done" (Stripe's refusal when it is first asked, its
  refusal when the helper repeats the request, and a search of the reversals that finds
  nothing) go through the one "when refused" step that puts the row back. A search that could
  not be made concludes nothing. So a row can never stay "being taken" with no action behind
  it.
- **A refusal** therefore puts the row back to "told" with the refusal noted; it is tried again
  a day later. After 30 days of refusals the founder is told, and it keeps being tried.
- **Cancelling** (the founder, from the dispute's page) is possible while the row says "told".
- If a lost dispute is later decided the other way (Stripe's status says won): a row that says
  "told" is cancelled by itself. A row "being taken" is left alone until its action is
  finished, and then is either "told" (and is cancelled) or "taken". One that was taken is a
  leftover for the founder (see below), and both the founder and the host are told.
- What the host is told never promises more than is known: "we will ask Stripe to take it back
  from your Stripe balance"; not that it will succeed, and not where Stripe will get it from.
- A share that was never collected needs no row: it stays held back, as today, and its line on
  the earnings page now says that the bank returned the money to the customer.

**Pages:** the host's earnings show what is owed, why, from when, and what was taken; the
dispute's page shows the same; the founder has "Cancel" while it can still be cancelled.

**Checked by** `scripts/disputes-check.ts`: a share collected, its dispute lost: one row, told
once, however often the look runs; two lost disputes on one charge: together never more than
was sent; a loss that arrives while the transfer is written down and not yet sent: the row
appears once the transfer is through; Stripe refuses the reversal, and the helper's check finds
"it did not happen": each time the row is back at "told", never left at "being taken"; the
dispute is won while a reversal is under way: the row waits for its action; nothing is taken a second before the
14 days and it is taken at them; the reversal is real at Stripe, for the right amount of the
right transfer; a part-dispute takes the same part; a cancelled row is never taken, and a row
being taken cannot be cancelled; the request cut after Stripe did it is not sent twice; a share
that was not collected, and a share whose collection sent nothing, make no row; a refusal is
tried again and told after 30 days; the money record adds up.

## Points for the lawyer (in `docs/for-the-lawyer.md`, section 16, in the same pull request)

What is sent to a bank without a person looking; a statement written by a machine; the host
deciding whether Connect gives in; taking a share back at Stripe, which can reach the host's
bank account; a customer kept from paying after a chargeback; how long the proof and the
messages are kept.

## For the founder to decide later (nothing here waits for it)

- **Stripe's own automatic answer.** It could be switched on as a safety net for the day the
  app's helper is down: Stripe would then answer in the last hours before a deadline, with what
  it knows, and take a fee from what it wins. The builder's advice: switch it on when the app
  goes live, not before. It is a setting in Stripe, not code. The app already copes with it
  (decision 6).
- **At go-live:** Stripe's message kinds have to be registered for the live account. The setup
  script only works with a test key, so that is a step of its own in the "Before launch" list.
- **The agreements.** Once the real terms are live and the app records which version a person
  accepted at which time, the letter to the bank can cite them. That is a small change to
  `evidence.ts` then.

## Not in this plan

- Holding back a host's other earnings while a dispute is open (offered, not chosen).
- Charging a host the bank's fees.
- A refund in answer to a bank's question (it would end the question for free, but needs a way
  round "no refund while a dispute is open" for each of the three kinds of money).
- Files as proof, and the device or address a payment was made from. Both would make the proof
  stronger; the second means recording something new about people.
- The Messages page in the phone apps: the phone-app session is told what exists once this is
  built.
- Older emails in the Messages page.
- **Leftover 1:** a dispute over only part of a charge that is lost before the host collected.
  The whole share stays held back, as every lost dispute does today, and the founder settles it
  by hand. (A host who had collected owes only their part. So in this rare case the two are not
  treated alike until the founder settles it.)
- **Leftover 2:** a share that was taken back, after which the bank decides the other way. The
  founder gives it back by hand.

## What Astra found in the first draft, and what was done

"Not ready", eight points. All eight were checked against the code by the builder.

1. *One dispute can release money another still blocks* (a fault in today's code for a call's
   payment). Taken: decision 1 and part 1.
2. *An answered question can use up the chargeback's only answer.* Taken: stages (decision 3),
   and the count of submissions at the start of a stage.
3. *A transfer can finish after the loss was looked at.* Taken: finding what is owed is a
   repeated look (part 3).
4. *Part-disputes are treated differently before and after collecting.* Taken in part: what a
   host owes is worked out the same way and capped. Releasing the undisputed part of a share
   that was not collected would change how every share is worked out; it is leftover 1, said
   plainly.
5. *"Cancel until taken" promised more than it could keep.* Taken: a row is claimed as "being
   taken" in the money action's first step, and can be cancelled only before.
6. *Some of the proof would have been untrue* (a late cancellation described as a call; the 24
   hours where they did not apply; terms the app cannot show; an address not tied to the
   payment). Taken in full: decision 8, and the note to the founder at the top.
7. *The customer rule said two things, booked member calls do end, and "needs you" still left
   the founder with work.* Taken: decision 9 is one rule now and says what a membership's own
   rule does. (Decision 7 then gave in by itself; the second look changed that, see below.) Not
   taken: Astra's simpler rule, "it ends whenever
   the chargeback closes". A customer who got the call and the money back could then start
   again the same day, which is the abuse the founder asked to stop.
8. *The hourly look could not find a dispute it had no row for, and a failure while telling
   people must not block every host's collection.* Taken: the catch-up, and the record written
   beside the flags, never in their way.

Also taken: every status Stripe has, including a first sight of a dispute that is already
under review; an answer given outside the app; compliance read from Stripe's own marks, for
Mastercard too; the order of locks; the complete list of places where a payment starts, split
into "new" and "carried on"; keys that name the stage and the person; the email that asks for a
choice expires; the live registration step; that both sides are already told when a membership
ends.

Left out as more than is needed, on Astra's advice: the founder choosing in the host's place,
and a link from the call's results page.

## What Astra found in the second draft, and what was done

"Not ready" again. Of the first eight it called three fixed and five partly fixed, and it added
seven. All checked against the code and Stripe's installed library by the builder.

- *Who answered.* The second draft concluded "ours" from Stripe's count of submissions. Stripe
  only counts; it does not say who. Taken: decision 6 and the steps of `answer.ts`. An answer is
  the app's own only on Stripe's reply to the app's own request; everything else is "not
  answered by the app", and the customer's lasting stop follows only the first.
- *A question that becomes a chargeback on a row that is already there* got no message. Taken:
  messages follow stages, not rows (part 1), and a reply for a stage that is over changes
  nothing. The two appeal states: the app answers nothing in them and treats them as "with the
  bank"; the founder is told once that an appeal is open.
- *Giving in by itself was a money decision the founder had not made.* Right. Taken: decision 7
  no longer gives in. It covers only the 500-dollar kind, which the app leaves alone and the
  founder is asked about at the top of this plan. A flagged charge is fought like any other,
  with both records in the proof, which is the founder's own default. A deadline of zero is
  handled (decision 4).
- *The list of payment starts* named shared checks and functions that both begin and carry on.
  Taken: the line is "a new row is written" (decision 9 and `paying.ts`).
- *A refused or lost reversal could leave a take-back stuck at "being taken".* Taken: part 3.
- *Two losses on one transfer could each promise the same money.* Taken: decision 10, part 3.
- *The hourly look skipped an open dispute beside a lost one; 7 days of catching up is too
  short; the order of locks was restated wrongly.* Taken: part 1 and "The order of locks".
- Smaller points taken: a charge set by Connect after a review; a late cancellation where
  somebody had joined; no "24 hours" claim; what is kept as proof is what Stripe's reply shows;
  the host is promised nothing about where Stripe gets the money from; that a bank's question
  ends a membership today.
- Not taken, as before: making the two leftovers automatic. Astra is right that they are work
  for the founder. Leftover 1 would need a lost dispute to be booked like a refund in the sums
  every share is worked out from; leftover 2 a new kind of payment to a host. Both are more
  than these rare cases are worth before the app is live. They are named at the top for the
  founder.

## What Astra found in the third draft, and what was done

"Ready with changes." Of the seven it called two fixed and five partly fixed, and named five
points to settle before the part they belong to is merged. All five are taken:

1. *A request written down, never sent, and a helper away for a day* was closed as "unknown"
   while the bank still waited. Now it stays the helper's work until settled (part 2).
2. *A question's answer replayed after the question became a chargeback.* Stripe is read
   before every sending, and the stage is checked in its reply (part 2).
3. *Two more places where a membership's next charge is switched on* (`acceptLessTime`, and
   `undoStop` pressed by the host). Taken; `takeBackLessTime` is named as "carried on", with
   the reason (part 2).
4. *A second take-back sized while the first is under way.* The look waits (part 3).
5. *A known dispute whose status changes after it ended, with the message lost.* The daily
   look compares, and a take-back asks Stripe first (parts 1 and 3).

Also taken: one wording for who answered, used the same in decision 6 and in the steps; the
three ways a take-back's action can end as "not done"; the hosts of disputes already waiting
when part 2 goes live; the founder's summary no longer speaks of "24 hours".

## What was kept against Astra's advice (all looks)

Kept, with the reason: the unread number in the top bar (without it
nobody notices a message), the short "Bank disputes" list for the founder (their only view of
what the app did in their name), and the two founder's buttons, "Allow paying again" and
"Cancel" a take-back (without them a decision could only be undone in the database). Not taken:
a lock that makes a payment started in the very instant a dispute arrives impossible; an
automatic give-back for leftover 2.
