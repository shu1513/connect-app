# Plan 46, part 3: money a host owes after a refund, and three smaller things

**Status:** a plan only. Written 21 November 2026 by the builder alone, from the code as it is on
`main` after pull request 97. It is the detailed plan that `plans/46-agreements-live.md` asks for
before its part 3 is built ("Part 3: refunds by Connect after a host has collected, and
uncollected earnings"). Astra (GPT, effort high) checked the first draft against the code: "not
ready", eight points. Its second check, of the second draft: "not ready" again, narrower: exact
rules for a handful of cases. Its third: "not ready" for one formula that could charge a host 25
where she owed 20, and a few smaller points. Its fourth: everything before settled, and one last
case of 20 cents, with the fix. All four are worked in here; what was taken and what was not is
at the end. This is the fifth draft; its last change was made as Astra proposed and was not
checked a fifth time. Astra reviews the code of each part when it is built.

Parts 1, 2, 4 and 5 of plan 46 are merged (pull requests 85, 89, 96, 88).

## For the founder: what this is

Four things, all from the list of 14 changes that make the agreements true:

1. **You can refund a customer after the host has already collected the money**, in full or in
   part. Today the app refuses ("has to go through support"). The customer is paid from
   Connect's money. The host then owes Connect her share of it.
2. **The host's debt is recovered the way lost bank disputes already are** (plan 47, built and
   merged): she is told in writing which payment, why and how much; she has 14 days to say it
   is wrong; then the app asks Stripe to take that amount back out of what it sent her. New
   with this plan, for both kinds of debt: she can say "this is wrong" with a button, and that
   stops the taking until you have decided.
3. **A host who has not collected for 12 months is sent what is ready**, by the app itself,
   with the usual 25-cent charge. She gets an email saying what was really sent.
4. **A new member in the UK or Europe who cancels within 14 days** gets a button of yours that
   does it properly: time already used stays paid at the member price, the rest goes back to
   the card. And one sentence people see before joining is corrected to say exactly that.

**The one decision this plan stands on, which is yours.** Plan 46 (decision 13) said a host's
debt is taken out of her next collections inside the app, and that nothing is taken any other
way. Plan 47, built since, recovers a debt by asking Stripe to reverse part of the transfer it
sent her. You agreed there to "from later earnings"; that it is done by a reversal at Stripe was
that builder's choice. **This plan uses the reversal for refund debts too, so that there is one
way and not two.** Part 3a is not started until you have said yes to that. If you would rather
have debts taken out of later collections, that is a different, larger piece of work, and plan
47's part would have to follow it.

**Also dropped from this part:** "a bank dispute lost after the host collected". Plan 47 built
it.

**Three smaller choices, each with a default** (nothing waits for them):

- **A.** A refund debt for a payment made before the host held a published Host Agreement (today
  every payment, because the agreements are still drafts) is written down and she is told, but
  **the app never takes it by itself.** You settle it with her and then mark it "settled" or
  call it off. Reason: taking money back rests on the Host Agreement, and a draft is not in
  force.
- **B.** After a host has collected, **only you** can refund, not the host herself.
- **C.** Your 14-day button asks you for **the day the member's request reached you**, and
  judges the 14 days by that day. So a request of day 14 that you handle on day 17 still counts.
  It works while the member's first month is still running; after that it refuses, and the case
  is settled by hand.

## What the founder said

- 20 November 2026: "build the 14 changes so the agreements can go live. do what you think is
  the best."
- 20 November 2026, on plan 47 (the other session's record): the founder agreed that a lost
  dispute's share is taken "from later earnings".
- 21 November 2026, asked whether to write this plan next and have Astra check it: "Yes, write
  the plan".

- 21 November 2026, after the plan was merged, asked which way a debt should be recovered and
  told the builder's recommendation (the reversal at Stripe, plan 47's way): "do what you think
  is the best". **So part 3a is built with the reversal at Stripe.**

Everything else here is the builder's.

## What is there today (read in the code)

- **A call's payment** is refunded by `refundPayment` (`src/lib/payments/actions.ts`). It
  refuses once `transferStatus` is "sent", and while a bank's question, a dispute or a recorded
  loss is on the payment. When Stripe confirms a refund, `applyRefundDone` writes three lines
  into the books: the refund, the change in Connect's fee, the change in the host's share
  (`splitAfterRefunds`, worked out from the first split and everything refunded so far). A
  refund can also stay "on its way" or fail at Stripe; the helper finishes those later.
- **The form.** The refund button is on the call's page and its action is in
  `src/app/calls/[id]/actions.ts`; it sends a member's call to `giveTimeBack`, and decides on the
  server whether the person acts as host or as admin (an admin who is also that call's host
  counts as host). The founder's page (`src/app/admin/page.tsx`) lists 200 payments by the
  call's start and offers a full refund with a fixed reason, hidden once the share was sent. Its
  notice says "The refund was sent" whatever Stripe answered.
- **A contribution or a tip** can already be refunded by the founder after collection
  (`src/lib/contributions/refund.ts`, `connectsOwn`). The whole refund is then booked as
  Connect's own cost (`connect_cost`), the host keeps her share, and the founder's form says
  nothing will be taken back from her.
- **A member's call** (`giveTimeBack`, `src/lib/membership/give-back.ts`) refuses after
  collection.
- **Debts** exist since plan 47: the table `host_debts` (migration 0054) and
  `src/lib/disputes/takeback.ts`. A row belongs to one bank dispute and one share (`disputeId`
  and `dueAt` are required). The helper finds what is owed, writes the row and queues a notice
  to the host (the Messages page and an email), and from 14 days after the row was written asks
  Stripe to reverse that amount of that transfer, as a money action of the kind "take back". A
  refusal is tried again a day later; 30 days after the first refusal the founder is told. The
  founder can cancel, on the dispute's page, while the row says "told". When it is taken the
  books get a line `host_takeback`, which the yearly statement already takes off "Sent to you".
  The amount is worked out by `owedCents` from what was **sent**.
- **Collecting** (`src/lib/payments/collect.ts`): `collectEarnings` (it first asks Stripe
  whether the payout account is ready, then `acceptCollection` under the host's lock, then
  `sendCollection`, which returns after 20 seconds whatever the transfers did) and
  `collectForClosedHost` for the founder. `collections.startedBy` is required and is a person.
  A host can collect once in 24 hours, counted from the last collection that was accepted,
  whether or not anything went through. A share can be "sent" with nothing sent and no
  transfer at Stripe, when the collection charge ate it.
- **Memberships:** "Cancel now" (`cancelNow`, `src/lib/membership/ending.ts`) works while the
  month is to be paid or held and not yet taken, and it **pauses** the membership. Ending a
  membership (`endMembership`, `cleanUpEnding`) stops renewal and owes the free money of the
  month back; `closeMonth` asks `owedAfterEnding` before anything expires;
  `cancelUpcomingMemberCalls` cancels coming calls, whose set-aside money then goes back to the
  card as pay-back lines of their own (`src/lib/membership/payback.ts`). The founder's
  Memberships page only shows things today.
- **The sentence** people see before joining (`src/lib/membership/wording.ts`) says "Time you
  booked or used in those days is paid for". The Payment Terms (12.3) say time **used**.
- **Proof of who accepted what:** `agreement_acceptances` (plan 46, part 1). Every version of
  every document is a draft today (`src/legal/versions.ts`).

## Decisions (the builder's; each can be changed)

1. **One way to recover a debt: plan 47's** (the founder's decision above). A debt from a
   refund is a row in `host_debts`, taken by the same request to Stripe, with the same daily
   retry, the same telling of the founder after 30 days of refusals, and the same "Call it off".
   No money is held back inside "Collect earnings".

2. **A debt row gets a second kind of cause.** `host_debts.disputeId` becomes optional and
   keeps its link and its "one row for a dispute and a share". Two optional columns are added,
   each a real link: `refundId` (a call's refund) and `contributionRefundId` (a contribution's
   or tip's refund line), each with "one row for this refund and this share". The database
   checks that exactly one of the three is set. The code checks, when it writes a row, that the
   cause belongs to that payment and that host.

3. **What a refund makes her owe.** With the payment locked, when a refund is confirmed and the
   share had been sent: her share before this refund less her share after it, both worked out
   from the first split and everything refunded so far (`splitAfterRefunds`). A part refund
   before she collected made what was sent smaller already and owes nothing; only refunds after
   the sending do. The numbers are written on the refund itself when it is confirmed (her share
   before and after, Connect's fee before and after), so that its notice can always be shown
   again exactly, whatever is refunded later.

4. **How much can be taken from one share, over all causes.** Three numbers, each kept apart:
   - **What her share lost to refunds after the sending** ("the reductions"): the sum, over
     every confirmed refund made after the share was sent, of her share before less her share
     after (the numbers decision 3 saves on the refund). It is read from the refunds, **never
     from the debt rows**, and counts whatever became of the debt: written as nothing, cut
     short, called off, repaid. Refunds before the sending, and the old refunds of Connect's
     own that left the share whole, are not in it.
   - **The room on the transfer:** what Stripe shows as not reversed, less the debts on that
     share that are still open (told, waiting, objected, answered, being taken), less what she
     paid back outside Stripe for that share (a bank payment to Connect). A reversal the
     founder made by hand at Stripe is not entered as paid back: Stripe already shows it, and
     it must be counted once.
   - **What the bank took**, for a dispute.
   Then:
   - **A refund debt** is what that refund adds to the reductions, where the reductions are
     never counted beyond what was really sent; then cut down to the room. (In numbers: the
     smaller of "sent" and "the reductions after this refund", less the smaller of "sent" and
     "the reductions before it".) So once refunds have used up all that was sent, a further
     refund adds nothing, whatever became of the earlier debts. (Astra's case: 100 charged, 80
     hers, 79.75 sent. A refund of 99.75 takes 79.80 off her share: a debt of 79.75, which the
     founder calls off. Refunding the last 25 cents takes another 20 cents off her share, and
     adds nothing to her debt.)
   - **A dispute debt** starts from what was really sent (`transferCents`) less the reductions,
     never below nothing. Of that, the part the bank took of what was left of the charge,
     rounded down, as `owedCents` does today; then cut down to what the bank took (over all
     shares of that dispute) and to the room. (Astra's example: 100 charged, 80 sent; 50
     refunded after, a reduction of 40; the bank then takes 25 of the 50 that are left: half of
     the 40 that remain, 20. That is 20 whether the refund's debt is open, taken, called off,
     repaid, cut short, or not yet written. With no refund after the sending the number is
     what plan 47 gives today, also for a share that carried the collection charge: half of
     79.75 is 39.87.)
   - More examples, as checks: 80 hers and 79.75 sent, half refunded after: a debt of 40; fully
     refunded: 79.75, all that was sent. Refunds of 30 and then 70 on 100 charged and 80 sent:
     24 and then 56. A member's month of 100 with shares of 40, 24 and 16, 25 lost: 10, 6
     and 4.
   - **Under one dispute**, working out its shares is put behind one lock for the dispute:
     today two helpers on two of its shares can both count the same room.
   - **Nothing is worked out on a share while money is moving on it:** not while a reversal is
     being taken, and not while a refund of that payment is with Stripe and unanswered. A
     contribution's refund that is only owed and waiting for its next try does not count as
     moving (it cannot be tried while a dispute is lost, and would block for ever). And if
     Stripe's own total of refunds on the charge is not the total the app has confirmed for
     the charge's owner (for a contribution with its old refunds; for a month with what was
     paid back), the look waits for the app's record to catch up.
   - **An amount once written never rises.** Whenever room comes free (a debt is called off, or
     is settled outside for less than it was), rows that said "nothing" for lack of room (on
     that share, and on the other shares of the same dispute) are worked out afresh. A row that was written smaller than it could have been
     stays as it is: the app forgoes the difference, and the founder's page shows it.
   - A share "sent" with nothing sent has no transfer: the refund is marked "nothing to take
     back", once.

5. **A refund is refused while anything about a bank is on the payment** (a question, a
   dispute, a recorded loss), as today, and while a transfer of that share is under way. A
   dispute that was won, or a question Stripe has closed, lets refunds through again. A bank
   event can still arrive while a refund is on its way; the "nothing is worked out while money
   is moving" rule of decision 4 covers that.

6. **The 14 days count from the notice really sent, and an objection stops the taking.** For
   both kinds of debt, because it is one row and one piece of code.
   - The notice is the message on her Messages page and the same text by email, written in one
     step under one key; the row keeps which email that is. The due day stays empty until the
     sending service has accepted that email, and is then 14 days after that moment. The
     notice itself, written before that moment is known, says "14 days after this email was
     sent"; her page shows the day once it is known. If the email fails, or the sending
     service reports later that it bounced, the due day is emptied again, the founder is told,
     and the debt waits. The debts there are today are given their email by the same key.
   - The notice explains the amount as it was worked out, with the numbers that were used: for
     a dispute after a refund, what was left of what was sent after the refund (39.75 of 79.75
     in the example above) and the part of it the bank took, not "part of what was sent".
   - Her earnings page and the message carry a button, "I think this is wrong", with a box for
     her reasons, while the debt says "told". Pressing it puts the row in a new state,
     "objected": it is not taken. The helper reads the state under the same lock with which it
     starts the taking, so an objection made a second earlier always wins. The founder is told
     at once and decides: "Call it off", or "Take it after all" with a written answer. That
     answer goes to her like a notice; the row then says "answered", and is due no earlier
     than its first due day and no earlier than 3 days after that answer was sent. She cannot
     press the button a second time on an answered debt; she can still write to support. A
     reversal Stripe refuses puts an answered row back to "answered", not to "told".
   - An objection sent to support by email: the founder presses "Hold it: she objected", with
     the same effect, from the moment it is pressed.
   - A lost dispute that is decided the other way calls off its debt by itself whether the row
     says told, objected or answered. Nothing was lost then, so no cost of Connect's is
     booked for it; a cost the founder's own waiver had booked for that debt is taken off
     again; and if she had already paid it back, outside or by a reversal, the founder and she
     are both told, as plan 47 does today for a debt that was taken.
   This changes plan 47's behaviour (today the days count from the row, and only a
   cancellation stops it); its page, which reads the due day of every "told" row, and its check
   script `scripts/dispute-takeback-check.ts`, which expects 14 days from the row and takes
   money without sending the email, change with it. The change can only make the app slower to
   take, never quicker.

7. **The app takes a refund debt by itself only where the Host Agreement was in force for that
   payment.** (Default A.) That is: a version of the Host Agreement that is published (not a
   draft) and was in effect at the moment of the bank's hold, accepted by her at or before that
   moment. **The moment is Stripe's**: the time Stripe gives for the creation of the
   charge that was held and then taken for that payment (a call's or added time's own payment;
   a contribution's or tip's payment; a membership month's payment for the shares paid from
   it), found by the charge's number the app saved, and read from Stripe when the row is
   written. It is the closest record there is of the bank's hold, to the second. The app's own
   "held at" is not used: it is the time the app learned of the hold. Her acceptance has to be
   earlier than that second. Where the charge's number is missing or does not fit the payment,
   where Stripe says for good that it has no such charge, where the acceptance falls in the
   same second, or where the version in effect then cannot be shown to have been accepted by
   then, the row is written in a new state, "waiting", with no due day. **When Stripe simply
   cannot be reached, or does not answer in time, nothing is written:** the look comes back on
   its next pass. A passing fault must never turn a debt the app may take into one it never
   takes. She is
   told that she owes it and that Connect will write to her. The founder's page offers "Call it
   off" and "Settled outside the app". It is never promoted later, whatever she accepts
   afterwards. Plan 47's dispute debts are not changed by this decision; see "For the founder
   to decide".

8. **The books.** A refund after collection writes the same three lines as any refund: the
   refund, the change in the fee, the change in her share. Her share in the books is then what
   she is entitled to, and what was sent stays what was sent.
   - Taken back: one line `host_takeback` for the amount, with a note that names the cause.
   - Called off by the founder: one line `connect_cost` for the amount Connect carries, once,
     in that step. Called off by the app because the bank decided the other way: no line.
   - Settled outside the app: the founder enters how much she paid and how. A new line,
     `host_repaid`, for what she paid; `connect_cost` only for what was let go, if anything.
   - Example (Astra's): 100 charged, 80 hers, 20 the fee, no collection charge on this share.
     A full refund writes minus 100, minus 80, minus 20. Taken back: plus 80 `host_takeback`.
     Called off instead: plus 80 `connect_cost`. Repaid 50 outside and the rest let go: plus 50
     `host_repaid`, plus 30 `connect_cost`.
   - **A contribution or tip refunded after collection changes to this pattern.** Today the
     whole refund is booked as Connect's cost at once. After: the refund once on the
     contribution's payment, the two changes on its share, then the reversal or the waiver. A
     tip of 5.00 is charged 5.46: a full refund takes 5.00 off her share and 0.46 off the
     payment fee, so the fee is never part of her debt. Lines that carry `connectsOwn` today,
     finished or still on their way, keep the old treatment to their end; a later refund in the
     new pattern reads the share's own refunded amount, because the payment's total also holds
     the old refunds that left the share whole.
   - **The yearly statement:** "Sent to you" becomes what was sent, with nothing taken off; a
     column of its own, "Taken back or paid back", holds `host_takeback` and `host_repaid`;
     "Of that, paid by Connect" is renamed "Carried by Connect". A reversal in January of money
     sent in December then no longer makes January's "Sent to you" a minus.

9. **Who can refund after collection: the founder only**, with a reason and an amount.
   (Default B.) The host's own button keeps refusing after she collected. A founder who is also
   that call's host is treated as the host on the call's page, as today; a refund after
   collection is made from the founder's page, where the person always acts as the founder.

10. **The founder's form.** Shown also after a share was sent, for the kinds this plan covers
    (a call paid by card, a contribution, a tip). An amount that can be changed, and a reason
    chosen from the grounds the Host Agreement names for deciding in the host's place (8.3 and
    8.4), plus a sentence of the founder's own. Before it is pressed it shows an **estimate**:
    "The host has collected. The customer is paid back from Connect's money. The host will owe
    about X." After Stripe has answered, the page says what really happened and what the host
    owes, or that it waits (decision 7), or that nothing can be taken back. The page gets a way
    to find one payment by the call's id or the customer's email address.

11. **Stripe can accept a refund and still not pay it at once.** The debt is written only when
    Stripe confirms the refund.
    - **A call:** the page says "paid back", "on its way" (also when Connect's own balance at
      Stripe is too low), or "refused by Stripe", with Stripe's words. A refused one is over,
      and the founder can try again from the form. The page does not tell the founder to pay
      the customer outside the app: nothing would take such a payment off what can still be
      refunded, and a later press could pay twice. A refund whose answer never came is called
      failed only after every refund Stripe holds for that payment was looked through (today
      only the first hundred are).
    - **A contribution or a tip:** a refund Stripe refuses is owed again and tried every hour,
      as today; it is never dropped. The page says so, and does not tell the founder to pay it
      outside the app, which could pay it twice.

12. **Not collected for 12 months.**
    - **When:** her last collection **that went through** is more than 12 months ago, or she
      never had one and the oldest share that is ready now has been ready, by the date it
      carries, for more than 12 months. "Went through": a collection one of whose own items,
      for more than nothing, has a transfer that succeeded (the item's own money action; a
      later try of the same share under another collection does not count for the earlier
      one). The date a share carries can have moved; it is the best the tables hold.
    - **How:** the helper, once a day, in a loop of its own. For each such host it first
      claims the try: a line in a small table of its own (the host, the week, an id), written
      under her lock, so two helpers make one try and one email. Then it runs the whole of
      what her own button runs (`collectEarnings`: ask Stripe whether the payout account is
      ready, accept under her lock, send), with that line's id, which is used again if the
      same try is repeated. Under her lock it asks again that the account is open, that the 12
      months still hold, and that her 24 hours are over. So everything that holds a share back
      today holds it back here too.
    - **A try that sends nothing** (the account is not ready, Stripe refuses, nothing is
      collectable) is noted on that line with the reason, and the next try is a week later. It
      does not count as a collection.
    - **The email** goes out once the outcome of every transfer of that collection is known,
      or after a day with what is known by then: what was sent, in US dollars, to her Stripe
      account; the charge really taken; what could not be sent; what is "still being checked";
      and that she can collect herself, once in 24 hours. For a host whose payout account is
      not in US dollars it says that Stripe turns the dollars into her own money when it pays
      her bank.
    - A collection that was accepted and whose transfers all failed starts her 24 hours, as
      today, and not the 12 months.
    - A paused account is treated like any other open one. A closed account is not touched
      (the founder's "final collection" exists for it).
    - `collections.startedBy` becomes optional, and a new column says who started it: the
      host, the founder, or the helper. The rows that exist are filled in.

13. **The 14-day button for a new membership** (Payment Terms 12.3), on the founder's
    Memberships page.
    - **For which:** the first membership this person has had with this host that was really
      joined (its agreement is of the kind "joined", not "resumed"; no earlier membership of
      the pair got as far as a month that was held or paid), and only **while its first month
      is the month that is running**. "Joined" is the moment that first month was authorised.
      A first month that was never authorised (still to be paid) can be ended too: nothing was
      paid. No bank's question or dispute on it.
    - **What the founder enters:** the day the member's request reached Connect, and a tick
      that the member lives where the 14-day right applies (the card's country does not show
      where a person lives). The action refuses when that day is more than 14 days after
      joining, when it is before the day of joining, and when it is later than today.
      (Default C.)
    - **What it does:** it ends the membership as the founder, with a reason of its own
      ("cancelled within 14 days"), and cancels its coming member calls. Everything else is
      what ending a membership already does: renewal stops; a month that is only to be paid or
      held is given up and its hold let go; for a month that was taken, the free money and the
      money set aside for the cancelled calls go back to the card through the pay-back lines
      there are, and nothing of this month expires to the host. Time that was really used
      stays paid at the member price, with the host's share and the fee as they are. The plan
      adds no sum of its own ("month less used"): that could pay back twice.
    - **After the first month has ended**, the unused money may already have gone to the host
      and a second month may have begun. The button refuses then and says so; the founder
      settles that case by hand. (Named under "Not in this part".)
    - **A late cancellation or a missed call that was already charged stays charged.** By
      booking, the member asked for the call to take place then. So does a call that takes
      place, or is charged, between the day the request reached Connect and the moment the
      founder presses the button: only calls still to come when it is pressed are cancelled.
      (For the lawyer.)
    - The member is told that it was cancelled within the 14 days and, as today, each amount as
      it goes back; the host is told that it ended and why.

14. **The sentence before joining** becomes: "Where a 14-day right to cancel applies to you (in
    the United Kingdom and Europe): you can cancel a new membership within 14 days of joining
    by writing to us. Time you used before we have dealt with your request, and a call you
    cancelled late or missed if it was charged under your booking's terms, is paid for at the
    member price; the rest of what you paid is given back." The email that confirms the
    cancellation names the calls that stayed charged. With a new wording
    version, as every change of that list gets.

15. **No change to the legal documents' texts.** A merged version is never edited. Four
    sentences have to be right in the first published version, and are added to the list in
    `docs/legal/README.md`, section 7 ("To carry into the first published version"): Host
    Agreement 9.4 should say plainly that the usual way is asking Stripe to take the amount
    back out of what was sent, that the 14 days count from our email, and that she can object
    with a button; 8.2 should say that after she has collected only Connect can refund; 7.7's
    "[12]" becomes 12; Payment Terms 12.3 should name the late cancellation and the missed
    call beside "time you used".

## The parts (one pull request each, in this order)

### Part 3a: refunds after collection, and the debt

**Built in two steps, each a pull request of its own** (decided when building began, to keep
each small enough to check well):
- **Step 1, the notice and the objection** (decision 6, and the one lock for a dispute of
  decision 4), for the debts there are today, which are all from lost bank disputes. Nothing
  about refunds yet.
- **Step 2, refunds after collection**: everything else of part 3a.

**Not started until the founder has said yes to the reversal at Stripe as the one way.**

**Migration** (the next free number when it is built; 0054 is the last on `main` today):
- `host_debts`: `dispute_id` optional; `refund_id` and `contribution_refund_id`, each a link;
  the check "exactly one cause"; two more "one row for a cause and a share"; `due_at`
  optional; the states "waiting", "objected", "answered" and "settled" added;
  `notice_email_id` (the email whose sending starts the days), `objected_at`, `objection` (her
  words), `answer` (the founder's), `answer_email_id`, `decided_at`, `decided_by`,
  `settled_note`, `repaid_cents`; `held_at_bank` (Stripe's time for the charge) and
  `agreement_version` (the version that made it takeable, or empty).
- `refunds` and the contribution's refund lines: `after_collection`; her share and the fee
  before and after (four numbers, filled when the refund is confirmed); `host_owes_cents`; and
  a mark "looked at for a debt".

**Code:**
- `refundPayment` and `applyRefundDone`: decisions 3, 5, 9. The request to Stripe does not
  change: with separate charges and transfers a refund is paid from Connect's balance and no
  transfer is touched.
- `src/lib/contributions/refund.ts`: decision 8; the old lines keep their treatment.
- `src/lib/disputes/takeback.ts`, every function that reads the dispute today, branched by
  cause. The finder gets two more (confirmed refunds of calls; of contributions and tips,
  found through the contribution's payment to its share; never a member's time given back,
  never an old line of Connect's own). Writing a row checks the cause again under the lock,
  works the amount out by decision 4, reads the bank's time and chooses "told" or "waiting" by
  decision 7; only a dispute row asks Stripe about the dispute. **Starting** a taking needs
  the row "told" or "answered" and due (decision 6), and for a refund row the refund still
  confirmed. **Finishing** one whose outcome is not known works on the row as it is, "being
  taken": the reversals at Stripe are always searched first and one that was made is booked;
  the request is sent again only under the same label and while that is safe, as today. The
  line in the books and the words depend on the cause. "The bank decided the other way"
  covers told, objected and answered rows. The telling of the founder after 30 days no longer
  drops rows without a dispute. Calling off works from "told", "waiting", "objected" and
  "answered".
- `takeback-rules.ts`: the amounts (decision 4), the due day (decision 6), the states.
  `takeback-words.ts`: the words for a refund debt (owed, waiting, objected, answered, taken,
  called off, settled, refused for 30 days).
- Pages: the founder's refund form and the search (decision 10), with its true answer
  (decision 11); a founder's list of debts of both kinds, with the buttons of decisions 6, 7
  and 8 (today cancelling lives only on a dispute's page); the host's earnings page lists
  waiting, objected and answered debts too, names the cause, links to the call, the project
  or the tip, shows a due day or "14 days after our email goes out", and carries "I think
  this is wrong"; the dispute's page no longer reads a due day that can be empty; the host's
  project page stops calling a share that shrank "sent to you"; the founder's contribution
  form stops saying nothing will be taken back.
- The yearly statement: decision 8, on the page and in the file.

**Checked by** a new script against Stripe's test mode, `scripts/owed-check.ts`, with a
stand-in for the sending service, and tests of the rules:
- a call paid, collected, then refunded in full by the founder: the customer's refund is real
  at Stripe; one row, told once however often the look runs; the three lines; no due day
  while the email has not gone, and the founder is told when it fails; nothing taken a second
  before 14 days after its sending; then the reversal is real at Stripe for that amount of
  that transfer, and the line `host_takeback`;
- half refunded before collecting and half after: only the second owes; half refunded twice
  after: two rows, to the cent, together never more than was sent;
- a share that carried the collection charge, alone and with a half dispute (39.87 of 79.75);
  a share that was sent with nothing: "nothing to take back", looked at once;
- a refund, then a part dispute lost on the same share: 40 and 20, when the refund debt is
  open, taken, called off, settled outside, cut short by an earlier debt, written as nothing,
  and not yet written at all (the dispute is found first); Astra's case of an earlier dispute
  debt of 60 called off after a win, then a refund of 50, then 25 lost: 20, not 25; its case
  of 79.75 sent, 99.75 refunded and waived, then the last 25 cents refunded: nothing more is
  owed; a debt of 80 settled outside for 50: a row that said "nothing" is worked out again; a
  reversal made by hand at Stripe is not counted twice; the
  dispute found while the refund is still with Stripe: nothing is worked out until it is
  confirmed in the app; a contribution's refund that is only owed does not hold a dispute up; three shares of one
  disputed month: 10, 6 and 4, and with two helpers at once never more than the bank took; a
  debt called off: a row that said "nothing" is worked out again, a row that was cut short
  stays;
- the refund fails at Stripe: no row; still on its way: no row until confirmed; the founder's
  page says which, and never suggests paying outside the app; a call's refund whose answer
  never came is not called failed while Stripe still holds it on a later page; a
  contribution's refund that Stripe refuses is tried again and never paid twice;
- the host's own button after collection: refused; the founder without a reason: refused;
  while a transfer of that share is under way, or anything about a bank is on the payment:
  refused; after a dispute was won: allowed;
- "I think this is wrong" a moment before the day: never taken; "Take it after all": due no
  earlier than the first day and 3 days after the answer was sent, and she cannot object
  again, also after Stripe refused the reversal once; pressed while it is being taken:
  refused; an objected dispute debt whose dispute is then won: called off by itself, with no
  cost booked; a notice email that bounces after it was accepted: the due day is emptied and
  the founder is told;
- a reversal whose answer was lost: found at Stripe and booked once, not sent twice;
- a host without a published Host Agreement accepted by the bank's time of the charge:
  "waiting", never taken, also after she accepts one later, when she accepted between the
  bank's hold and the app learning of it, and when she accepted in the same second; Stripe
  not answering when the row is to be written: nothing is written, and the next pass writes
  it "told"; "Call it off" books Connect's cost once; "Settled
  outside the app" books what she paid and only the rest as Connect's cost. With one accepted
  in time: "told". (The check makes up a published version for its own run, as
  `agreements-check` does.)
- a tip refunded after collection: the debt is the tip she got, not the payment fee; a
  contribution likewise, also a part refund after an old refund of Connect's own; an old line
  with `connectsOwn`, finished or on its way, is left as it was;
- Stripe refuses the reversal: back to its notice, tried the next day; told to the founder
  after 30 days, for a refund row too;
- the yearly statement, page and file, for a refund in December taken back, repaid or waived
  in January;
- plan 47's own scripts (`disputes-check`, `dispute-takeback-check`) and `contribution-check`
  pass, the second and third changed where this plan changes what they expect (the days from
  the email; the old booking of a refund after collection).

### Part 3b: earnings not collected for 12 months

**Migration:** `collections.started_by` optional; `collections.started_as`; the small table of
the helper's tries (the host, the week, an id, when, what came of it).

**Code:** decision 12.

**Checked by** the script: a host whose last collection that went through is 12 months and a
day old is sent everything ready, once, with the charge, and told what really went; one at 11
months is left; one whose last collection was accepted and sent nothing counts from the one
before; one who never collected counts from her oldest ready share; a refused try is written
down, is not a collection, and is tried again after a week and not before; a payout account
that Stripe says is not ready is left; a share held back by a dispute or a refund request
stays; a closed account is not touched; two helpers at once, or her own button in the same
minute, make one collection and one email; the same try run again uses its id again; the
email names a refused transfer as not sent and an unfinished one as still being checked.

### Part 3c: the 14-day button for a membership, and the sentence

**Code:** decisions 13 and 14: the founder's action and its page; the reason; the sentence and
its version.

**Checked by** the membership check script, against Stripe's test mode: joined 3 days ago, the
money only held: the hold is let go, nothing is charged, the membership is ended (not
paused); still to be paid: ended, nothing charged; taken, nothing used: the whole month goes
back, no renewal; taken, one call of 30 minutes used: that call stays paid at the member
price, the rest goes back, the host's share of the call is untouched; a coming member call is
cancelled and its money goes back once, through its own line; a late cancellation that was
charged stays charged; a request that reached Connect on day 15: refused; a day in the
future, or before joining: refused; one of day 14 handled on day 20: done; the first month already ended: refused, with the sentence that says
why; a resumed membership, and a second membership of the same pair: refused; anything about
a bank on it: refused; pressed twice: nothing is paid back twice; the ticked sentence is the
new one and carries the new version.

## Working beside the other sessions

- **Bank disputes (plan 47)** is fully merged and its session has stopped. This plan changes
  its table, adds to `takeback.ts`, and changes three of its behaviours (decision 4's lock and
  what a dispute debt starts from after a refund; decision 6's days and objection). Its two
  check scripts must pass, changed where the plan says, and its memory file is told.
- **The phone apps (plan 45)** are paused. Nothing here changes what the app's door sends. The
  Messages page can now hold a notice about a refund debt; the phone has no button to object
  yet.
- Migration numbers: whoever merges second renumbers, as before.

## Points for the lawyer (into `docs/for-the-lawyer.md` with each part)

- Is asking Stripe to reverse part of a transfer, after 14 days' written notice, covered by the
  Host Agreement's 9.4 as drafted, and by Stripe's own agreement with the host, in each country
  hosts are in? Should 9.4 name it?
- A refund Connect decides in the host's place (8.3) makes the host owe her share. Must she be
  heard before the refund, not only before the taking?
- A debt from before the agreements are published: can it be recovered at all, and how?
- Sending earnings to a host who did not ask (7.7): is 12 months right, and what about the law
  on unclaimed property where it cannot be sent?
- The 14-day cancellation of a membership: is "time used is paid at the member price" right
  where the member did not expressly ask for the service to start, and may a late cancellation
  or a missed call stay charged?

## For the founder to decide

- **The reversal at Stripe as the one way** (at the top). Part 3a waits for your yes.
- **One rule or two for when the app may take by itself?** Under this plan a refund debt is
  never taken by the app unless the Host Agreement was in force for that payment (decision 7).
  A lost bank dispute's debt (plan 47) is taken after 14 days whatever she accepted. The
  builder would make both follow decision 7; it is left as it is because plan 47's rules were
  agreed with you in that session. Nothing waits for this.
- Defaults A, B and C at the top. Nothing waits for them.

## Not in this part

- Giving a member's time back after the host collected (`giveTimeBack` keeps refusing). It
  needs the same debt for a share paid from a month, and can follow once 3a is in.
- A 14-day cancellation handled after the member's first month has ended. The founder settles
  it by hand.
- A host paying a debt by card or bank transfer through the app, and a "request to pay" (Host
  Agreement 9.4's second step). A payment she makes outside the app can be recorded.
- Charging a host the bank's dispute fee (9.2).
- Holding back a host's uncollected earnings against a debt.
- A debt that was taken and then turns out wrong (plan 47's "leftover 2"): the founder gives it
  back by hand. Paying back by hand does not give the transfer its room back.
- Raising a debt that was written smaller than it could have been (decision 4).
- Closing your own account (plan 45, parts 19 to 19c).

## What Astra found in the first draft, and what was done

"Not ready", eight points that had to be fixed, one that should be.

1. *A ceiling on the transfer alone can still take too much from the host* (a refund and then a
   part dispute; the collection charge; a share sent with nothing; two helpers under one
   dispute). **Taken:** decisions 3 and 4, with its own example as a check.
2. *The 14 days counted from the row, not from a notice really sent, and an objection by email
   stopped nothing.* **Taken:** decision 6, for both kinds of debt. *The change from "taken out
   of later collections" to a reversal needs the founder's own decision.* **Taken:** it is the
   first thing the founder reads, and part 3a waits for it. *"Start the 14 days" gave notice
   but no right to take a debt from before the agreement.* **Taken:** that button is gone
   (decision 7).
3. *What each function of `takeback.ts` needs when the cause is a refund*, the links and checks
   in the table, a due day that can be empty. **Taken:** decision 2 and part 3a.
4. *What the books and the statement mean after a take-back or a waiver*; the old lines of
   contributions; the pages that would say something untrue. **Taken:** decision 8 and part
   3a's pages.
5. *Stripe accepting a refund is not the customer having the money*; the form says "sent"
   whatever happened. **Taken:** decisions 10 and 11.
6. *The agreement test must look at the exact version, at whether it was published and in
   effect, and at a moment that is certain.* **Taken:** decision 7.
7. *The 12-month helper must run the whole collection, not two of its steps; "went through" and
   "became ready" were not defined; a refused try has no row to carry its next day; the email
   must wait for the outcome.* **Taken:** decision 12.
8. *The 14-day outcome is mostly what ending a membership already does; "joined" was not
   defined; "Cancel now" pauses and works while the month is to be paid too.* **Taken:**
   decision 13, which adds a reason and an authorised action and no sum of its own.
9. *Corrections to "What is there today" and the founder's form.* **Taken:** that section and
   decision 10.

## What Astra found in the second draft, and what was done

"Not ready" again: the worked example came out right, but several rules were not exact enough
to build from.

1. *The amount when Stripe and the app know of a refund at different moments; which of two
   numbers a share that carried the charge starts from; debts already taken; an amount that
   rises.* **Taken:** decision 4 is rewritten. Everything counts against what was sent; a
   dispute debt starts from what was sent less every refund debt ever written; nothing is
   worked out while money is moving or while Stripe's total is not the app's. **An amount that
   rises is given up:** one row cannot carry a part already taken and a later part with its own
   14 days, so the app forgoes the difference instead of building that.
2. *Part 3a should wait for the founder's yes, not for her having seen it.* **Taken.**
3. *Finishing a reversal whose outcome is unknown must work on a row that says "being taken",
   and must look at Stripe first.* **Taken:** part 3a's code.
4. *Money a host pays back outside the app is not money Connect carried.* **Taken:** decision
   8, a line of its own and an amount the founder enters. *The statement's column.* **Taken:**
   "Sent to you" is what was sent, and "Taken back or paid back" stands beside it.
5. *A contribution's refund that Stripe refuses is tried again every hour; telling the founder
   to pay it outside could pay it twice.* **Taken:** decision 11.
6. *The app's "held at" is the time the app learned of the hold, not the bank's.* **Taken:**
   decision 7 reads Stripe's own time for the charge, and leaves what cannot be shown
   "waiting".
7. *Which email is the notice; what happens when it cannot be sent; "Take it after all" needs a
   reason, a guard against objecting again, and a day; an objected dispute debt whose dispute
   is won; plan 47's page and its second check script.* **Taken:** decision 6.
8. *A first month that was never authorised; which membership counts as the first; a request
   handled after the first month ended; the sentence left out the late cancellation.*
   **Taken:** decisions 13 and 14. The late case is refused by the button and settled by hand.
9. *The 12-month helper: which item proves a collection went through, one id for each try, one
   email, the wording for a transfer still being checked, who converts the dollars.*
   **Taken:** decision 12.

## What Astra found in the third draft, and what was done

"Not ready", for one formula and a few smaller points.

1. *Measuring what is left of her share from the debt rows can charge 25 where she owes 20*
   (a debt cut short by an earlier one that was called off, a debt written as nothing, or a
   dispute found before the refund's debt is written). **Taken, as it proposed:** decision 4
   now reads the reductions from the refunds themselves, keeps the room on the transfer and the
   bank's loss as separate ceilings, counts "answered" debts as open, and does not wait for a
   contribution's refund that is merely owed.
2. *Stripe's time for a charge is the creation of the charge, to the second, not the bank's
   exact moment; use the saved charge; leave a same-second acceptance waiting.* **Taken:**
   decision 7.
3. *A refused refund of a call must not be paid outside the app, and an unanswered one must not
   be called failed after looking at only the first hundred of Stripe's refunds.* **Taken:**
   decision 11.
4. *A bounce reported after the email was accepted; an answered debt must stay answered after a
   refusal; a dispute won books no cost; the dispute's notice must explain the amount from her
   share after the refund, and speak of "14 days after this email".* **Taken:** decisions 6
   and 8.
5. *The membership sentence should say "if it was charged"; a call between the request and the
   founder's press.* **Taken:** decisions 13 and 14.
6. *A collection whose transfers all failed still starts the 24 hours; the sentence about
   currency only for an account not in US dollars.* **Taken:** decision 12.

## What Astra found in the fourth draft, and what was done

"Not ready", for one case; the five other points of its third check were settled, and its
arithmetic for the examples of decision 4 agreed with the plan's.

1. *After the founder waived a debt for all that was sent, refunding the last cents asked the
   host for 20 cents more.* **Taken, as it proposed:** a refund's debt is what it adds to the
   reductions, which are never counted beyond what was sent (decision 4).
2. *Money paid back outside must be counted once: a reversal made by hand at Stripe already
   shows at Stripe.* **Taken:** decision 4. *Rows that said "nothing" must be looked at again
   whenever room comes free, also after a settlement for less.* **Taken.**
3. *A dispute won after the debt was repaid outside, or after a waiver's cost was booked.*
   **Taken:** decision 6.
4. *The member must be told that calls stay chargeable while a request waits.* **Taken:**
   decision 14 and the confirming email.
5. *The notice should show the real basis for a share that carried the charge.* **Taken:**
   decision 6.

This last round of changes was made as Astra wrote them and was not sent back a fifth time.

## What CodeRabbit found in the plan's pull request, and what was done

Two points, both taken.
1. *A passing failure to read Stripe's time for the charge would have written the debt as
   "waiting" for ever.* Decision 7 now writes nothing when Stripe cannot be reached, and tries
   again on the next pass; only a lasting reason makes a debt wait.
2. *The day the request reached Connect could be entered as a day in the future, or before the
   member joined.* Decision 13 refuses both.

Not taken, in any of the four checks: nothing was set aside. Two things are deliberately left
small and named under "Not in this part": a debt written smaller than it could have been is not
raised, and a 14-day request handled after the first month is settled by hand.
