# Plan 47: Bank disputes, handled without the founder

**Status:** a plan only. Written 20 November 2026 by the builder alone (no helper agents), from
the code as it is on `main` after pull request 83 and from Stripe's own pages read that day
(listed under "What Stripe says"). Not yet checked by Astra.

(Number 46 is taken by another session's plan, "agreements live", which is not merged yet.)

**Its size, said plainly:** about one module, built in three parts. No second payment system is
built. The careful money code that exists (written-down money actions, the helper, "Collect
earnings") keeps doing the work; this plan adds a record of each dispute, three decisions that
are made by a person or by a rule instead of by the founder, and two requests to Stripe that the
app does not make today (send the proof, take a share back).

## For the founder: what this is

A customer can ask their bank to pull a payment back. Banks call it a chargeback; the app calls
it a bank dispute. Today the app freezes the money and waits for you to do the rest by hand in
Stripe. After this plan nothing waits for you:

1. **Everyone is told at once.** The host, the customer and you each get a message. A new page,
   "Messages", keeps these messages inside the app, and the same text goes out by email.
2. **The host chooses, within 24 hours:** "Give the money back" or "Fight it". No answer counts
   as "Fight it".
3. **The app answers the bank by itself.** To fight, it sends the bank the booking, the record
   of the call, the customer's account details, the terms they accepted and a short letter
   written for the bank's kind of claim. To give in, it tells the bank so.
4. **A host who already collected pays it back.** When a dispute is lost, the app tells the
   host what they owe and why, waits 14 days, and then takes that amount back at Stripe. Stripe
   keeps it from the host's next payouts.
5. **The customer cannot start new payments while their dispute is open.** If it ends well for
   everyone, paying is on again by itself. If the bank sides with them although the call took
   place, paying stays off until you allow it again.

What stays yours: two rare kinds of dispute the app must not answer by itself (named in decision
6), and anything a host or customer writes to support about.

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
  up." The app never charges for those: a call's charge is worked out from the time the host was
  in the room (`src/lib/payments/jobs.ts`, `settleOne`). So there is no such case to give in on.
  What is left is decision 6.
- "Pulling the money back at Stripe works only while it still sits in the host's balance, and
  taking it from the host's bank is possible only in some countries, so I would leave both out."
  Stripe's pages say otherwise for accounts like ours, where Connect carries the losses
  (`losses_collector: "application"` in `src/lib/payments/host-account.ts`): Connect can reverse
  a transfer, the host's Stripe balance may then go below zero, and Stripe makes it up from the
  host's later payments and, in the countries where it can, from their bank account. This is
  Stripe's own recommended way, and it is what part 3 uses. It still has to be proven in
  Stripe's test area before part 3 is built (see there).

## What is there today (each read in the code by the builder)

- **Stripe's messages.** `charge.dispute.created` and `charge.dispute.closed` arrive at
  `src/app/api/stripe/webhook/route.ts`, are saved, and handled by `handleStripeEvent`
  (`src/lib/payments/stripe-events.ts`). A message is only a nudge: Stripe is asked where the
  dispute stands and that is recorded. A message that could not be handled is tried again by
  the helper (`retrySavedStripeEvents`).
- **What is recorded.** For a call's card payment: `payments.disputeOpen`, true while the
  dispute is with the bank and also after it is lost (`BLOCKING_DISPUTE` in
  `src/lib/payments/disputes.ts`). For a membership's month and for a contribution's payment
  (tips are contributions): a `dispute` field of their own (open, won, lost), and the membership
  or monthly contribution ends at once. The helper asks Stripe about those two kinds again every
  hour while a dispute is open (`runDisputeLooks`); it does not for a call's payment.
- **What a dispute blocks.** The host cannot collect that money (`heldBack`, "dispute"), and it
  cannot be refunded on top (`refundPayment`).
- **Who is told.** The host of a membership or a monthly contribution gets an email that it
  ended. Nobody else is told anything. The founder sees a line on the admin page.
- **What is never done.** No proof is sent to the bank. Nothing is taken back from a host who
  had already collected: a lost dispute is "settled by hand". The customer keeps full use of
  the app.
- **Emails.** Every email is written into `email_outbox` first (`queueEmail` in
  `src/lib/email.ts`), in the same database step as the event it reports, with a key so it is
  written once. There is no place inside the app where a person can read what Connect told them.
- **Collecting.** A host's share can be collected 24 hours after the call ends
  (`COLLECT_AFTER_MS`). A bank can open a dispute for about 120 days. So most disputes will
  arrive after the host has collected.
- **The check script** `scripts/payments-check.ts` (journey 28) already makes a real dispute in
  Stripe's test area with Stripe's always-disputed test card, and loses it.

## What Stripe says (read 20 November 2026, on docs.stripe.com)

- **We answer, and we pay.** For our kind of charge (Connect charges the customer and sends the
  host a transfer), Connect answers the dispute, and the disputed amount and the fees come out
  of Connect's balance (`/connect/disputes`).
- **One answer.** Proof is sent with "update a dispute" and `submit: true`. It goes to the bank
  at once and cannot be changed or added to. The text fields together may hold 150,000
  characters. `evidence_details.submission_count` says how often proof was sent
  (`/disputes/api`, `/api/disputes/update`).
- **Giving in** is "close a dispute". It cannot be undone.
- **Time.** A bank gives 7 to 21 days; the dispute carries the date (`evidence_details.due_by`).
  The bank then takes up to 3 months to decide.
- **Fees.** Stripe charges a fee when a dispute is received, and since June 2025 a second fee
  when it is fought, which comes back only if it is won (`/disputes/responding`). The amounts
  are on Stripe's pricing page; the builder remembers 15 dollars each in the United States and
  has not read that page.
- **A bank's question** (Stripe: "inquiry", status `warning_…`) comes before a chargeback, mostly
  from American Express and Discover. Answering it well ends it without a fee. Not answering
  can turn it into a chargeback that cannot be won. "Closing" a question does not end it. If it
  becomes a chargeback anyway, a new answer is needed. A question that stays quiet for 120 days
  is closed by Stripe.
- **Compliance disputes** (reason `noncompliant`): fighting one costs 500 dollars on top, given
  back only on a win, and Stripe sends the answer only when the fee is acknowledged in the
  request (`/disputes/api/visa-compliance`). Closing one costs nothing.
- **Taking money back from a host.** Stripe's advice for our kind of charge: reverse the
  transfer, right away when giving in, after the outcome when fighting. A reversal can be for
  part of a transfer. When Stripe carries an account's losses a reversal can fail for lack of
  funds; ours are carried by Connect. A balance below zero is made up from later payments;
  Stripe also debits the account's bank in the United States, Canada, the United Kingdom, the
  euro countries, Australia and New Zealand; payouts to the bank stop while the balance is below
  zero; Stripe sets aside the same amount from Connect's balance meanwhile, and takes it for good
  after 180 days (`/connect/disputes`, `/connect/account-balances`).
- **Stripe's own automatic answer** ("Smart Disputes"): a switch in Stripe's settings. For
  disputes it thinks it can win, Stripe sends its own proof just before the deadline if nobody
  answered, and charges a fee only on a win. It knows nothing about our calls. See "For the
  founder to decide later".
- **Testing.** Test cards make a dispute at once: claimed as fraud (`pm_card_createDispute`), as
  "not received" (`pm_card_createDisputeProductNotReceived`), as a question
  (`pm_card_createDisputeInquiry`), a compliance one (card 4000008400000779). Proof whose
  free text is exactly `winning_evidence` or `losing_evidence` makes Stripe decide that way.

## Decisions

The founder's are marked. All others are the builder's own.

1. **One record per dispute.** A new table `disputes`, keyed by Stripe's own id for the dispute,
   holds what the app knows and does about it. It belongs to exactly one of: a call's card
   payment, a membership's month, a contribution's payment (the same three owners a money action
   has). The fields that exist today (`payments.disputeOpen`, the two `dispute` fields) keep
   their meaning and stay the only thing the money code looks at. The new record is for the
   people, the answer to the bank and the take-back.

2. **A message center** (the founder's idea). A new page "Messages", in the top bar for everyone
   who is logged in, with the number of unread messages beside it. A message is a short text from
   Connect with a link to where the person can act. Each message is written in the same database
   step as the email with the same words, under the same key, so the two can never differ and
   neither is written twice. In this plan only the messages about disputes and take-backs go
   there. Moving older emails (a request answered, a refund) into it is a small change of its own
   per feature, later.

3. **The host is asked** (the founder's rule). For a chargeback, the host of that money gets a
   message and a page with two buttons. The first choice stands. The founder can choose in the
   host's place while the host has not. The time to choose is 24 hours from the moment the app
   learns of the dispute, but never later than 3 days before the bank's own deadline; if that
   leaves no time, nobody is asked and the app fights. A host whose account is closed is not
   asked. No answer in time counts as "fight" (the founder's rule).

4. **"Give the money back" means giving in at the bank.** It is not a refund: the bank has
   already taken the money from Connect, and a refund on top would pay the customer twice. The
   page says so, and says what it costs the host: their share of that payment, and if they had
   already collected it, that it will be taken back (part 3).

5. **The app answers the bank.** At the end of the host's time, or at once after their choice,
   the helper sends the proof (to fight) or closes the dispute (to give in). The request is
   written down first and carries a fixed label, as every money action does; if the answer from
   Stripe is lost, the helper asks Stripe whether proof was sent before trying again, so the
   bank never gets two answers and never gets none.

6. **Two kinds are left to the founder, and say so.** (a) A compliance dispute: fighting costs
   500 dollars, so the app never does. (b) A dispute on a charge the app itself has flagged
   because the call's record changed after the money was taken (`flaggedAfterCharge`): the app
   does not send a bank a record it doubts. For these, the founder's email says "this one needs
   you", the admin page lists it with the bank's deadline, and the host is told that Connect is
   looking at it. If the founder does nothing, the bank's deadline passes and the dispute is
   lost, which is the same as giving in.

7. **A bank's question is answered at once, without asking the host.** It is a question, not a
   claim, and a fast good answer is what ends it for free. The host and the founder are told.
   If it turns into a chargeback, the host is asked then, as in decision 3.

8. **What the proof says.** Only what the app has on record, and only what is true. The same
   facts for every claim, and a letter that puts first what answers the bank's stated reason:
   - "I did not make this payment" or "I do not recognise it": the account that paid, when it
     was made, that it was logged in from the customer's own device and address, that this
     person joined the call and for how long, earlier payments of the same account that were
     never disputed.
   - "I did not get it" or "it was not as described": the call's record (when each of the two
     joined and left, the time that counted), and that the customer had 24 hours to ask for a
     refund in the app and did not, or did and what the host answered.
   - "I cancelled": the cancelling rule the customer was shown and when they cancelled; for a
     membership, when they joined, what they agreed to, and that it had not been stopped.
   - "I was charged twice": that each charge is for a different call or stretch of a call.
   - Anything else: the general account.
   If a fact does not help (the customer never joined the call, and was charged for the host's
   waiting time as the terms say), the letter says it as it is. Nothing is left out to look
   better.

9. **The customer** (the founder asked for a system; this one is the builder's).
   - They are told at once, kindly: which payment, that their bank opened a dispute, that they
     can tell their bank to withdraw it if it was a mistake, and what it means in the app.
   - While a chargeback is open they cannot start a new payment: no new request for a call, no
     added time, no tip, no contribution, no new membership. Everything else stays: logging in,
     calls that are already booked, their own hosting if they are a host too. It is narrower
     than the founder's "pause" (`user.pausedAt`), which would also cancel their calls and stop
     their hosting.
   - It ends by itself when the dispute is withdrawn or won, when the host chose to give the
     money back, or when the dispute was one of decision 6.
   - It stays when the bank decides for the customer after the app sent proof that the call
     took place. The founder can switch paying back on from the dispute's page.
   - A bank's question does not stop paying: it can stay open for 120 days with no decision.
   - Nothing new is stored on the person: whether they may pay is read from their disputes.

10. **Taking a share back** (the founder agreed to "from later earnings"; that it is done by
    reversing the transfer at Stripe is the builder's, see the correction above).
    - Only after a dispute is lost, never while it is open (the founder's choice of 20 November,
      when offered both).
    - What is owed: what was sent to the host for that payment. If the bank disputed only part
      of the charge, the same part of what was sent.
    - The host is told in writing: which payment, why, how the amount is worked out, and that
      they have 14 days to say it is wrong (host agreement draft, section 9.4).
    - After the 14 days the helper reverses that amount of the transfer. From then on it is
      between Stripe and the host's Stripe balance.
    - The founder can cancel a take-back before it happens. One that has happened can only be
      given back by hand.
    - The bank's fees are not charged to the host (section 9.2 leaves that to a judgement).

11. **The founder is told twice per dispute:** when it opens (what it is, what the app will do,
    and by when) and when it ends (won or lost, and what follows for the money). Both say plainly
    whether anything is needed from them. The admin page gets a "Bank disputes" list.

12. **Nothing is switched on at Stripe by this plan.** Stripe's own automatic answer stays as it
    is set.

## The parts

Each part is built, checked against Stripe's test area, read by Astra, and merged on its own.
The words people read are true after each part, not only after the last.

### Part 1: the record, the Messages page, and telling everyone

**New tables** (one migration):

- `messages`: id, the person, a subject, a text, a link inside the app (may be empty), a key
  (unique, the same key the email carries), written at, read at.
- `disputes`: Stripe's id (the key); exactly one of payment, month, contribution payment; the
  host and the customer; the disputed amount; the bank's reason; whether it is a question;
  Stripe's status as last read; opened at; the bank's deadline; how it ended (won or lost) and
  when. The fields of parts 2 and 3 are added by those parts.

**New code:**

- `src/lib/messages/messages.ts`: `tell(tx, …)` writes the email (through `queueEmail`) and the
  message in one step; `messagesOf`, `unreadCount`, `markRead`.
- `src/lib/disputes/record.ts`: `recordDispute(disputeId)`. It asks Stripe for the dispute,
  finds the owner by the payment at Stripe (the same three look-ups `handleStripeEvent` makes
  today), and writes or updates the row in one step with the owner's lock. Writing a row for
  the first time writes the three "opened" messages in the same step; recording an ending for
  the first time writes the three "ended" messages. So each is written exactly once however
  often Stripe's messages repeat.
- `handleStripeEvent` calls it after what it does today. The existing behaviour is not changed.
- The helper asks Stripe again, once an hour, about every dispute in the new table that has not
  ended (so a call's payment gets the hourly look the other two kinds already have). It goes
  through the same function the messages use.
- `charge.dispute.updated` and `charge.dispute.funds_reinstated` are added to the list in
  `scripts/stripe-webhook-setup.ts` (a question that becomes a chargeback arrives as an update).

**Pages:**

- `/messages`: the person's messages, newest first, unread ones marked; they count as read once
  the page has shown them.
- The top bar (`src/components/site-page.tsx`): "Messages", with the unread number.
- `/disputes/[id]`: for the host of that money and for the founder. What is disputed, the
  amount, the bank's reason in plain words, where it stands, the bank's deadline. (The buttons
  come in part 2.) Anyone else gets "not found".
- The admin page: a "Bank disputes" list (open ones first, then the last 20 that ended), each
  linking to its page. The existing "Flagged" line about a dispute links there too.
- The call's results page and the host's earnings: the existing line about a dispute becomes a
  link to the dispute's page, for the host.

**What the three are told in part 1** (short, true today):

- Host: the customer's bank is disputing this payment; the money for it cannot be collected
  while that lasts; do not contact the customer about it; the link.
- Customer: your bank told us you disputed this payment; if that was a mistake, your bank can
  withdraw it; if something went wrong with the call, write to support.
- Founder: who, what, how much, the bank's reason and deadline; that today it still needs to be
  answered in Stripe by hand (this sentence goes in part 2).
- At the end, all three: how the bank decided, and what that means for the money.

**Checked by** a new script `scripts/disputes-check.ts`, against Stripe's test area: a real
dispute is recorded once however often the message is handled; two messages at the same moment
write one row and one set of messages; the email and the message carry the same words; a person
sees only their own messages and only the host and the founder can open the dispute's page; the
hourly look records an ending when the "closed" message never came; a dispute on a month and one
on a contribution are recorded with the right owner; everything `payments-check`,
`membership-check`, `contribution-check` and `tip-check` check about disputes still passes.

### Part 2: the host's choice, the answer to the bank, and the customer

**Added to `disputes`:** until when the host is asked (empty when nobody is asked); the choice
(fight or give back), who made it (the host, the founder, or nobody in time) and when; what was
done at Stripe (nothing yet, proof sent, given in), when the request was written down, when it
was confirmed, and the last error; the proof that was sent, as it was sent; "left to the
founder" and why; "paying allowed again" (when, by whom).

**New code** in `src/lib/disputes/`:

- `choose.ts`: `chooseAnswer({disputeId, by, as, choice})`, in one locked step: the dispute is a
  chargeback still waiting for an answer, the person is its host (or the founder), no choice was
  made yet, the time is not over. The first choice stands.
- `evidence.ts`: builds the proof from the record, per owner kind and per reason (decision 8).
  It only reads. It is a plain function of what it read, so it can be tested without Stripe.
- `answer.ts`: the helper's job. For each dispute whose answer is due (a choice was made, or the
  time is over, or it is a question): write down "sending", ask Stripe with the fixed label
  `dispute-answer:<id>`, record the result. Before any repeat, Stripe is asked where the dispute
  stands: if proof was already sent or the dispute is no longer waiting, that is recorded and
  nothing is sent again. A clear "no" from Stripe is recorded and tried again an hour later; one
  day before the bank's deadline a dispute still without an answer goes on the founder's list
  with "this one needs you".
- `paying.ts`: `payingStopped(reader, userId)`: this person has a chargeback that is open, or one
  that was lost after proof was sent, and the founder has not allowed paying again. Asked in the
  places where a customer starts a payment, beside the existing check of a paused account: a
  request for a call (`src/lib/booking/bookings.ts`), added time (`src/lib/extend/extend.ts`),
  joining a membership and booking from one (`src/lib/membership/join.ts`, `book.ts`), a
  contribution and a tip (`src/lib/contributions/start.ts`, `tips.ts`). Each place is read
  first; the list is completed while building, and the check script walks every one.

**Pages:** the two buttons on `/disputes/[id]` with what each means and costs, then what was
chosen and what was sent; for the founder the same buttons "in the host's place", the proof as
sent, and "Allow paying again". The words of part 1's messages change to say what now happens
(the host: "choose by …, or we fight it"; the founder: "nothing is needed from you", or "this
one needs you").

**Checked by** `scripts/disputes-check.ts`, with real disputes in Stripe's test area:

- the host fights: Stripe shows one submission with our fields, and the dispute is under review;
- nobody answers: the same, at the end of the time, and not a second earlier;
- the host gives back: Stripe shows the dispute as lost, the customer may pay again;
- a question: answered at once, nobody asked;
- a compliance dispute and a flagged charge: nothing is sent, the founder is told;
- the answer from Stripe is lost (the step is cut after Stripe did it): nothing is sent twice;
- won, and lost after a fight (with Stripe's two magic texts, sent by the script in place of our
  letter): the messages, and paying on again or still off;
- a second choice, a choice by a stranger, a choice after the time: all refused;
- every place where a customer starts a payment refuses while paying is stopped, with a sentence
  that says why, and accepts again afterwards;
- the proof for each reason, built from a real call, a membership month and a tip, read as a
  whole: nothing untrue, nothing of another person.

### Part 3: taking a share back

**First, before any code:** in Stripe's test area, send a transfer to the test host's account,
empty that account's balance with a payout, and reverse the transfer. If Stripe refuses a
reversal on an empty balance for our kind of account, this part is stopped and the founder is
asked: the other way (keeping the amount from the host's next collections inside the app) is
more code in the most delicate place, and it is their choice whether that is worth it.

**New table** `host_debts`: the dispute, the share's payment, the host, Stripe's transfer, the
amount, told at, due at (14 days later), where it stands (told, cancelled, taken, could not be
taken), Stripe's id of the reversal, the last error.

**New code** in `src/lib/disputes/takeback.ts`:

- When a dispute is recorded as lost, in the same step: for every share under it that was sent
  to the host, one line in `host_debts` and one message to the host (decision 10). A share that
  was never collected needs none: it stays held back, as today, and its line on the earnings
  page now says that the bank returned the money to the customer.
- The helper, once a debt is due: a money action of a new kind, "take back", on that share's
  payment, with the label `takeback:<debt id>`, through the same steps every money action takes
  (`runMoneyOperation`), so it can never happen twice and an unknown outcome is checked with
  Stripe (`reconcileOperations` gets the new kind). Stripe is asked to reverse that amount of
  that transfer. The money record gets its line.
- If Stripe refuses: tried again once a day for 30 days, then left on the founder's list.
- If a dispute that was lost is later decided the other way (Stripe: funds reinstated): a debt
  not yet taken is cancelled by itself; one already taken goes on the founder's list.

**Pages:** the host's earnings show what is owed, why, from when, and what was taken; the
dispute's page shows the same; the founder gets "Cancel" until it is taken.

**Checked by** `scripts/disputes-check.ts`: a share collected, its dispute lost: one debt, told
once; nothing is taken a second before the 14 days and it is taken at them; the reversal is real
at Stripe, for the right amount of the right transfer; a part-dispute takes the same part; a
cancelled debt is never taken; the request cut after Stripe did it is not sent twice; a share
that was not collected makes no debt; the money record adds up.

## Points for the lawyer (added to `docs/for-the-lawyer.md` in the same pull request)

1. The app sends a bank, through Stripe, a customer's name, email address, internet address,
   and the times they were in a call, without a person looking first. Does the privacy policy
   say so clearly enough, and is anything in that list too much?
2. A machine writes a statement of facts to a bank in Connect's name. Who answers if a fact in
   it is wrong?
3. The host decides whether Connect gives in. Does that fit "Connect is only the host's agent
   for taking payment", and must the host agreement say that silence means Connect fights?
4. Taking a share back by reversing a transfer, which can lead Stripe to debit the host's bank
   account: is section 9.4 of the host agreement draft enough, in each of the 33 countries? Are
   14 days enough notice under the European rules for platforms?
5. A customer who used a right their card gives them is afterwards kept from paying on Connect.
   Allowed everywhere? Must the payment terms say it (section 9.7 only speaks of the time the
   dispute is open)?
6. How long may the proof that was sent, and the messages, be kept?

## For the founder to decide later (nothing here waits for it)

- **Stripe's own automatic answer.** It could be switched on as a safety net for the day the
  app's helper is down: Stripe would then answer in the last hours before a deadline, with what
  it knows, and take a fee from what it wins. The builder's advice: switch it on when the app
  goes live, not before. It is a setting in Stripe, not code.
- **At go-live:** Stripe's two new message kinds have to be registered for the live account
  (the setup script does it), like the others.

## Not in this plan

- Holding back a host's other earnings while a dispute is open (offered, not chosen).
- Charging a host the bank's fees.
- A refund in answer to a bank's question (it would end the question for free, but needs a way
  round "no refund while a dispute is open" for each of the three kinds of money).
- Files as proof (a page from the booking as a picture or a PDF). The text fields carry the same
  facts; a file can be added if lost disputes show it is needed.
- The Messages page in the phone apps: the phone-app session is told what exists once this is
  built.
- Older emails in the Messages page.
- A dispute that is lost before the host collected, where the bank disputed only part of the
  charge: the whole share stays held back, as today.
