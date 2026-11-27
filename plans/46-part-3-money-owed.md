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
- **Step 2, refunds after collection**: everything else of part 3a. Built as two pull
  requests in turn, for the same reason: **2a**, a call's payment (the migration, the
  founder's refund, the debt, the pages); **2b**, the yearly statement only. Making a
  contribution's or a tip's refund owed back by the host was NOT built (it waits for the
  founder; see the end of this file). What 2a built, and
  where it differs from the lists below, is at the end of this file.

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

## What Astra found in the code of part 3a, step 1, and what was done

"Hold the merge": five points that had to be fixed, three that should be. All taken.

1. *An objection could move the day from 14 days to 3:* a host who objected before the day was
   ever given, and was answered at once, was due 3 days after the answer. **Fixed:** there is one
   rule for the day now (`dueDay`): 14 days after the notice really went out, never earlier
   than a day an earlier notice named, and, after an answer, also never earlier than 3 days
   after that answer went out. An objection can only make it later.
2. *A bounce could lose a race with the taking.* **Fixed:** the day is worked out with the
   share's payment locked, the taking reads the emails once more under that same lock at the
   last moment, and a request that got no answer is not sent again once its notice has failed.
3. *Whether an address bounces does not say whether this notice bounced.* **Fixed:** the bounce
   is written on the very email the sending service names (a new column, migration 0056), and a
   take-back is judged by its own emails. An emptied old email keeps that mark.
4. *A take-back from before this rule could be taken before its email went out.* **Fixed:** no
   take-back has a day unless its notice is confirmed as sent; the day its old notice named is
   kept as the earliest.
5. *The notice promised that writing to support stops the taking.* **Fixed:** it says the button
   stops it at once and an email only once a person has read it; the founder's email says to
   press "Hold it" for an objection that came by email.
6. *The warning about a failed notice was marked as given even when there was nobody to give it
   to.* **Fixed.** 7. *The pages said "sent" for an answer that was only written, and spoke of
   retries while nothing can be taken.* **Fixed.** 8. *Some checks could pass with the app
   wrong.* **Fixed:** the due days in the old checks come from the helper's real pass; the new
   ones use a fresh sent notice for the bounce, a real refusal by Stripe, an objection before
   any day was given, one while it is being taken, and a notice that bounces while a request
   is unanswered. Also: a host's objection names its dispute, so one page cannot object to
   another dispute's take-back.

**Astra's second look at that step** said to hold it once more: the rule for the day was now
right, but how reliably a bounce is known was not. Taken, with one rule that is stricter than
decision 6 as first written:

- **A take-back gets its day only once the sending service has reported its notice as
  delivered**, and loses it for good once that email is ever reported as bounced. The two marks
  are only ever set, never emptied, so the order in which the service's reports arrive cannot
  matter. The days still count from the sending. A report that arrives before the app knows the
  email is not accepted, so the service sends it again. A notice that is not reported as
  delivered within two days is told to the founder like one that failed.
- **The founder can send a notice (or an answer) again** when the first did not arrive; the days
  count from the new one arriving, never before a day an earlier notice named. This is also how
  a take-back from before these reports were kept is released: its old email has no such report.
- **A report from the sending service is written under the same lock the taking starts under**,
  so a bounce is either seen by the taking's last look or written after the taking has started.
- The notice says an email to support stops nothing until a person at Connect has put a hold on
  it. The warning to the founder is given once for each email that has something wrong, so a
  failed answer is told even after a failed notice. Talk of "tried again once a day" is shown
  only while something is being tried.
- The checks of an unanswered request now use take-backs that are really due by the real clock:
  one the helper has to send again, and one it must not because its notice bounced meanwhile.

Left as it is, and why: a bounce reported while a repeated request is already on its way to
Stripe cannot stop that request. Bounces come within hours of sending; a take-back is at least 14
days after its notice arrived.

**In production this needs the sending service's reports to be switched on** (the webhook and
its secret, `RESEND_WEBHOOK_SECRET`). Without them no notice is ever reported as delivered, and
no take-back is ever taken: the founder is told after two days that delivery was not confirmed.

**Astra's third look at that step** found the stricter rule sound and said to hold for three
narrow points. All taken:

- **The helper's repeat of a request that got no answer** now does everything that takes time
  first (asking Stripe about the dispute) and only then, with the share locked, looks at the
  emails one last time and decides. A bounce recorded before that moment stops the repeat.
- **A take-back from before this change waits for a fresh notice.** Its old email has no
  delivery history that can be trusted (a bounce was only noted against the address, or only
  logged), and a late report of delivery for it could have made it due at once. The migration
  takes away its link to that email and its day; the founder is told and sends the notice again.
- **A notice that is sent again fits where the take-back stands.** For one whose objection was
  already answered it repeats the answer and does not point to a button that is gone.
- Also: when the notice and the answer have both failed, the founder is told about each; the
  founder is not told "it keeps trying" while a day lies ahead again.

Left as it is, and why: a report about an email the app will never know (a test email, one
emptied after two years) is refused each time the sending service repeats it. The service gives
up after its own number of tries; nothing is lost by it.

**Astra's fourth look**, at those last changes only: the three points are fixed, and two small
gaps in the new code, both taken. A take-back that was being taken at the moment of the change
is made to wait for a fresh notice too; and the helper's repeat looks, under the lock, once more
at whether the dispute is still recorded as lost. Also: a missing notice and a missing answer
are told to the founder under names of their own, and a notice sent again says "we could not
confirm that our first message reached you", since it may have. These four were made as Astra
wrote them and not sent back a fifth time.

**CodeRabbit's review of that step's pull request**: five points and a smaller remark, all
taken.
- **The days count from the arrival**: the later of "sent" and "reported as delivered", for the
  notice's 14 days and for the answer's 3. So a report that comes a day after the sending gives
  the host that day too, and it is never less than 14 days after the sending, which is what the
  notice says. (Where this plan says "from the sending", this is now the rule.)
- **A report about an email the app does not know is no longer refused.** Refusing again and
  again can make the sending service switch the address off. The app looks a few times more
  (the report can come a moment before the email's number is saved) and then lets it go. What is
  lost is safe: with no report of delivery there is no day, the founder is told after two days,
  and the notice is sent again.
- The 30-day "it keeps trying" email reads the emails as they are at that moment.
- The founder is told an email is "not confirmed as delivered", never that it did not arrive: it
  may have.
- Indexes for the two lookups a report makes.

## Part 3a, step 2a, as built (refunds of a call's payment after collection)

Migrations 0060 and 0061. Against the lists above:

- **Names.** Stripe's time for the charge is `charge_at` (the list says `held_at_bank`); the
  founder's answer keeps step 1's `answered_at` and `answered_by`. `contribution_refund_id` and
  the contribution's refund lines were not built (left for the founder to decide; see the end of this file).
- **"While her share is on its way, no refund."** No rule of its own was needed: a payment has
  one money action in flight at a time, so a refund is not begun while a sending is unanswered.
  The check script keeps watch over it.
- **"Told" or "waiting"** (decision 7) is decided when the debt is written: the Host Agreement
  version in force at Stripe's time of the charge must be a published one, and she must have
  accepted that version strictly before that second. Otherwise the debt waits, and the app
  never takes it: the founder calls it off or records that it was settled outside the app.
- **A refund's debt is written by the helper's next pass**, not in the founder's click: the
  click's answer is what Stripe did with the refund (paid back, on its way, refused).
- **The founder's list of ended take-backs** is sorted by when each ended.
- **A reversal made by hand at Stripe is accounted for, not just left to Stripe's number**
  (this changes decision 4, after Astra's reviews of the code). While a transfer has a
  reversal the app did not make, or a part of one, that nobody has said anything about, the
  app takes nothing more from that transfer and tells the founder (when it would take, and at
  once when Stripe's message about a reversed transfer arrives). On the take-back's page the
  founder says, for each such reversal: "it paid this take-back" (it is counted for it up to
  what is still owed, booked as taken back, and only the rest stays owed; what is left of the
  reversal stays open, so one reversal can pay two take-backs); "it was meant for this
  take-back", for one that had already ended (the host has paid twice: she is told that the
  money is owed back to her, and the founder sends it); or "it had nothing to do with a
  take-back". Each part of a reversal is counted once. **What a take-back is written for no
  longer depends on such a reversal:** the room on a transfer is what was sent, less what the
  app took, less the parts the founder has accounted for. So a reversal made by hand before
  the take-back is written is not taken off twice, and a transfer reversed in full by hand
  still gets its take-back written, to be counted against. The founder is told to hold a
  take-back before reversing anything by hand for it. The founder names the part of a reversal
  each time (the page suggests what fits), so one reversal can pay an open take-back in part
  and be money taken on top of an ended one in part. **And a take-back is never taken for more
  than is left to take:** right before it asks Stripe, the app works out again what is left on
  the transfer by its own record (less what she paid back outside the app); if the take-back
  is larger, nothing is taken and the founder is told at once. Each request of the app's
  carries its own label, so a reversal somebody else made is never mistaken for it.
- **A refund that fails after Stripe confirmed it** (it happens: the customer's bank sends it
  back) is undone: the payment counts as not refunded again, the three lines in the books are
  written back, the take-back is called off at no cost to anyone, and the founder is told that
  the customer got nothing. Stripe is asked whether the refund still stands before a debt is
  written and again at the moment the money would be taken; Stripe's message about a failed
  refund does the same. If she had already paid (taken, by hand, or outside), the app sends
  nothing back by itself: she and the founder are told. While money is moving on the payment
  (a taking, a sending, another refund) the failure is kept on the refund's line and undone on
  the helper's next pass. A refund once marked failed is never brought back by an answer read
  earlier. If the refund had been given BEFORE she collected, the smaller share is what was
  sent: she and the founder are told what was never sent to her. The refunds that are left on
  the payment are worked out again in their order (the cents can fall differently); an open
  take-back is lowered by a difference, never raised.
- **The order of two refunds** on one payment is a number given when each is confirmed, with
  the payment held, not their times.
- **Waivers and settlements work for a lost dispute's take-back too** (decisions 6 and 8): a
  founder's waiver books Connect's cost, "Settled outside the app" is offered, and if the bank
  later decides the other way that cost is taken off again and what she had paid is flagged
  for giving back.

**What `scripts/owed-check.ts` checks at Stripe's test mode** (148 checks): a call refunded
before collection (ordinary, nothing owed) and twice after it (two debts, together exactly what
was sent, each told once; no day while the notice is only sent, a day 14 days after it is
reported as delivered; nothing a day early; then two real reversals and the lines in the
books); the refusals (the host's own button even with the founder's flag, the founder without
the special form or without a reason, a sending under way); the founder's answer read from
what was written down, also for a form sent twice with another amount; a share that paid a
collection charge (she owes what was sent, not the charge); a share sent with nothing; the
objection, the answer and its days, calling off (Connect's cost, once); Stripe's total of
refunds differing from the app's (nothing worked out until they agree); "settled outside the
app", and a later refund on that share taken for its own part only; a host with no published
agreement accepted before the charge, one who accepts afterwards, one in the very second, one
a second before, one who accepted the real draft, and a charge Stripe no longer knows; a
reversal of part of a transfer made by hand (held, told, counted once, and only the rest
taken: never more than was owed); one made after the take-back had ended (told, recorded as
paid twice, owed back to her); one made before the take-back was written, also for the whole
transfer; one reversal counted for two take-backs; Stripe refusing the reversal, tried again,
the founder told once after 30 days; no room on a transfer (a row that says nothing) and room that comes free
(worked out afresh); a refund and a lost dispute on one share in four orders; a reversal whose
answer was lost, found at Stripe and booked once; **a refund still on its way at Stripe** (no
debt until Stripe confirms it, and the founder is not told it was given back); **a refund
Stripe confirmed and then failed**: with the take-back still open (called off, the books as
before, nobody pays), already taken (flagged for giving back), with Stripe's message arriving
while it is being taken (kept, and undone on the next pass), and one whose answer the app
never recorded (the message is kept; the helper asks what the refund is now), and one given
before she collected (she and the founder are told what was never sent to her); a late "paid"
for a refund that was undone (ignored); a refund that was written down and not sent in time
(never sent); and a refund whose answer was lost, found on the second page of Stripe's list
behind 101 newer ones; a writer that hangs past its time (it sends nothing; the helper sends
it, once); a refund "on its way" that Stripe fails while an older "paid" is still about to be
written (the failure stands); more owed than is left to take after a payment outside the app
and a reversal that was something else (nothing taken, the founder told; also when the taking
was already written down); a reversal counted in parts the founder names, and the same form
sent twice (counted once); a reversal for the very same amount that only carries a take-back's
id (not taken for the app's own); two small refunds whose cents fall differently once the
first has failed (one cent to give back, and not a second time; a waiver's cost one cent
lower); and an unanswered refund at the last moment for repeats (left open an hour more).

**Two stand-ins**, each named in the script: the sending service (the script marks the notice
email as sent and as reported delivered), and, for "a refund and a dispute on one share" only,
the refund's line (it points at a real, confirmed refund of another test charge). Stripe's dispute test cards dispute a charge the moment it is taken, and a
disputed charge cannot be refunded, so in the test area a real refund can never come before a
dispute on the same payment. The charge, the transfer, the dispute and the reversals there are
real.

**Checked by the rules' own tests and not at Stripe**, because the test area cannot make a
part dispute: 40 and 20; the share with the collection charge and a half dispute (39.87 of
79.75); 79.75 sent, 99.75 refunded, then the last 25 cents; the room after a payment outside
the app and after a reversal by hand.

**Not checked:** an OPEN take-back lowered because an earlier refund of the payment was undone
(the settled and the waived case are checked; the sum is the same); Stripe not answering at the moment a debt is to be written (the code writes
nothing and the next pass asks again; it cannot be staged against the real service); two
helpers at once on one refund (the share's payment is locked, and the database allows one row
for a refund and a share); a reversal made by hand in the very second the app takes (it cannot
be staged; it is found afterwards and recorded as paid twice, which is checked); the cap
across several shares of one disputed membership month after one of them was settled or paid
by hand (the rule has its own tests). The fill-in of migration 0061 for older rows ran on the
local test database, which held 120 such refunds and 45 such take-backs; no other database has
any, because nothing of this part was merged before. The yearly statement is 2b's; contributions and tips were left for the founder to decide (see the end of this file).

## What Astra found in the code of part 3a, step 2a, and what was done

"Hold the merge": seven points that had to be fixed, seven that should be, two small. All taken.

1. *A refund that Stripe confirms and later fails could still be taken from the host.*
   **Fixed:** see "A refund that fails after Stripe confirmed it" above. Checked with Stripe's
   own test card for it.
2. *A reversal made by hand could pay a debt, and the app would take the whole debt again.*
   (80 sent, 30 paid by bank, a debt of 50, 10 reversed by hand: 90 back on 80.) **Fixed:**
   see "A reversal made by hand" above.
3. *The helper could call a real refund failed:* it looked only at the first 100 refunds of a
   charge, and took a "no" to its repeated request as proof. **Fixed:** every page is searched,
   a refused repeat is settled by Stripe's list, and the refund's line and its action end in one
   step.
4. *A refund's debt was worked out without comparing Stripe's total of refunds with the
   app's.* **Fixed:** it waits until the two agree, as a dispute's does.
5. *A charge Stripe no longer has stopped the debt from ever being written.* **Fixed:** that one
   answer means "no proof of the bank's time", so the debt is written as waiting; every other
   failure is asked again.
6. *The founder's answer could be untrue:* "Stripe has accepted it" before Stripe had answered,
   and the amount of a form sent again. **Fixed:** the answer is built from the refund's own
   line (its payment, its amount, Stripe's number, Stripe's reason), tells "accepted" from "not
   answered yet", and refuses a request that belongs to another payment.
7. *Waivers, settlements and a later win were incomplete for a lost dispute's take-back.*
   **Fixed:** see above.
8. *The order of two refunds rested on clocks.* **Fixed:** a number given with the payment held.
9. *The helper's repeat of an unanswered take-back could act on an action already answered.*
   **Fixed:** it repeats only this very action, still unanswered, with its row still "being
   taken".
10. *The estimate ignored what was really sent, and the answer promised a notice when nothing
    could be owed.* **Fixed;** the call page's older refund button is answered the same way.
11. *The notices called what was left after refunds "what was sent".* **Fixed:** they name what
    was really sent, what refunds took, and what the sum starts from; a debt cut short is no
    longer called "the difference".
12. *The form said only the host reads the reason; the customer's email carries it too.*
    **Fixed:** the form says both read it.
13. *Several checks would pass with the feature broken.* **Fixed:** the cases named above, with
    Stripe's own test cards for the two refund states.
14. *The check let the helper loose on other runs' money.* **Fixed:** the helper's look can be
    limited to named actions and refunds.
15. *A founder who is also the host could not settle their own take-back.* **Fixed:** the
    founder's view can be asked for.
16. *A customer's 51st payment could not be found.* **Fixed:** "Older payments".

## Astra's second look at the code of step 2a, and what was done

"Hold the merge" again: ten points that had to be fixed, six that should be, one small. Of its
first seven, two were closed and five only partly. All taken.

1. *A refund's failure arriving while its take-back was being taken was lost.* **Fixed:** the
   failure is kept on the refund's line and undone on the helper's next pass.
2. *An answer read earlier could bring a failed refund back as paid; a failure arriving before
   the app had recorded Stripe's answer was lost.* **Fixed:** a refund is confirmed only while
   it is on its way; the helper asks what a refund is now after a repeated request; Stripe's
   message about such a refund is kept until the answer is recorded.
3. *After a refund given before collection failed, the part it had taken off her share was
   never sent to her.* **Fixed:** she and the founder are told the amount; the app does not
   send it by itself.
4. *With one refund undone, a later refund's take-back could be a cent too high.* **Fixed:**
   the refunds that are left are worked out again in their order.
5. *A refused repeat with an empty list could still be a refund on its way.* **Fixed:** the one
   who writes a refund down sends it at once or not at all (30 seconds, half the time the
   helper leaves an action alone), so the helper's "no" plus an empty, complete list is final.
6. *Reversals by hand: one made in the same minute as the app's, and one meant for two
   take-backs.* **Fixed:** see "A reversal made by hand" above (ended take-backs, parts of a
   reversal, Stripe's message, the advice to hold first).
7. *A reversal by hand made before the take-back was written was taken off twice.* **Fixed:**
   the room no longer depends on a reversal nobody has accounted for.
8. *The cap across the shares of one dispute forgot settled and hand-paid shares, and room
   freed on one share did not reach its sister shares.* **Fixed.**
9. *Older rows got no place and no cost in migration 0061.* **Fixed:** the migration fills
   them in.
10. *The founder's answer was still untrue in places.* **Fixed:** every state of the take-back
    has its own sentence, nothing is promised that is not known, the page tells "accepted by
    Stripe" from "not answered yet", and the call page's button keeps the true outcome when the
    admin record cannot be written.
11. *Pages after a win or a failed refund showed the row's number, which can be nothing.*
    **Fixed:** they show what she really paid; a refund that failed says so on its page; a
    notice names what was first owed and what a reversal by hand already paid of it.
12. *A reversal was taken for the app's own by a note on it alone.* **Fixed:** by its number,
    and the helper's recovery also checks the amount.
13. *The estimate ignored earlier refunds.* **Fixed:** it uses the same sum as the real one.
14. *A search through Stripe's list had no limit of time.* **Fixed:** 20 seconds, then it is
    unfinished and made again.
15. *Checks missing.* **Added:** the cases listed above.
16. *The older dispute check let the helper loose on other runs' money.* **Fixed.**
17. *"Older payments" could skip a payment at the page's edge.* **Fixed:** the page ends by
    both keys of the order, in both kinds of search.

## Astra's third look at the code of step 2a, and what was done

"Hold the merge" once more: ten points that had to be fixed, three that should be. Narrower
than before; all taken.

1. *A refund "on its way" whose failure arrived between a helper's reading "paid" and its
   writing it.* **Fixed:** Stripe's failure is written with the payment held, by what the line
   says at that moment; the helper's own look does the same.
2. *The writer's deadline was read before a look into the database, and a retry could go out
   late.* **Fixed:** the clock is read as the last thing before one request with a time limit;
   both together are shorter than the helper's first look.
3. *After the founder said a reversal was "something else", a take-back already written could
   be larger than what was left.* **Fixed:** nothing is taken for more than is left; the founder
   is told at once.
4. *The amount never sent after a refund before collection was worked out with later refunds
   mixed in.* **Fixed:** it is worked out at the collection.
5. *A lower sum for a later refund was told as money to give back, also where part had been
   waived.* **Fixed:** what she paid is compared with what is owed now; a waiver's cost is
   lowered; an open take-back is lowered and she is told.
6. *One reversal could not be split between an open take-back and an ended one.* **Fixed:** the
   founder names the part.
7. *A reversal by hand carrying a take-back's id could be taken for the app's own request.*
   **Fixed:** each request carries its own label, and the amount has to fit.
8. *Room freed for the shares of one dispute could miss a share being worked out at that
   moment.* **Fixed:** both happen under the same lock.
9. *If what came of a refund could not be read, the page said "nothing was changed, try
   again".* **Fixed:** it says to look at the payment first.
10. *Pages still showed a remainder where they meant what was owed or paid.* **Fixed:** one
    label for each state; the founder's emails about reversals lead to the page with the
    controls.
11. *The migration's fill-in could bring back a cost that had been taken off.* **Fixed.**
12. *A page of a search had no time limit of its own; a message that keeps failing could hold
    others up.* **Fixed:** each page has its limit, and no message is made to fail on purpose
    any more.
13. *Checks.* **Added:** the cases named above.

## Astra's fourth look at the code of step 2a, and what was done

Asked to name only what loses money, takes it twice, makes the books wrong or tells someone
something false: "hold the merge", nine points. All taken, and the automatic security check of
the commit found one more of the same kind (the last line).

1. *The same form for a part of a reversal, sent twice, was counted twice.* **Fixed:** the form
   names what was open when it was shown; if that is no longer so, nothing is counted.
2. *The helper's repeat of a taking did not look at the room again.* **Fixed.**
3. *A reversal by hand for the very same amount, marked with the take-back's id, passed for a
   new attempt's own request.* **Fixed:** a new attempt is only known by its label.
4. *Stripe's message about a reversal could arrive in the instant the app was recording its
   own, and report it as made by hand.* **Fixed:** the app's record is read in one picture, and
   looked at once more under the lock before anyone is told.
5. *A failure could still lose to an older "paid" when the app had not recorded Stripe's
   number for the refund.* **Fixed:** the failure is final at once in that case too.
6. *At the last moment for repeats one helper could call a refund failed while another's repeat
   was on its way.* **Fixed:** "not found" is final only an hour after the last repeat could
   have been sent. The writer's time is counted from the moment the action was written down,
   and allows for the Stripe library's own second try.
7. *A waiver was not corrected when the sum fell, and the same cent could be told twice.*
   **Fixed:** what the founder was already told to give back is kept on the take-back.
8. *The email "no room" said the app would not try again; it does.* **Fixed:** the words.
9. *Three places on the pages still showed a wrong amount or day.* **Fixed.**
10. *(The security check.) A take-back that was still open, of which a reversal by hand had
    already taken more than is now owed, was lowered without telling anyone about the
    difference.* **Fixed:** it is told like any other amount paid too much.

## Astra's fifth look at the code of step 2a, and what was done

"Hold the merge", nine points, most of them amounts and words on pages. Seven are taken; one
is narrowed; one is left, on the builder's own judgment, and both are named here so that they
are not forgotten.

1. *After a take-back was settled outside the app and its refund then failed, the payment that
   goes back to her still used up room: a second refund's take-back came out as nothing.*
   **Fixed:** an outside payment counts against the room only while its cause stands. Checked
   at Stripe (the second refund's line is the script's: Stripe's test card refuses a second
   refund of a charge whose refund failed).
2. *The email said 46 cents to send, the page and the list said 47.* **Fixed:** one sum for
   emails and pages (what she paid, less what the founder was already told to give back).
3. *A refund's own number typed by hand onto another refund at Stripe could undo the wrong
   refund when that other one failed.* **Fixed:** a failed refund is matched by Stripe's number;
   by the app's own number only a line that is still on its way, has no Stripe number yet, and
   is for the same charge and amount.
4. *Two helpers with different rights at Stripe (one may list, not refund) could end a refund
   as failed while the other sends it.* **Narrowed, not closed:** a helper looks once more,
   right before it repeats a request, whether the action is still unanswered. What is left needs
   two helpers at the same refund in the same second AND different rights at Stripe during a
   change of keys. Left as it is: closing it fully would keep every refused refund "not
   confirmed" for a day, and block the payment's other money actions that long.
5. *A lost dispute's take-back, written after a refund, can be one cent too high if that refund
   fails afterwards.* **Not done.** It needs a refund after collection, then a bank dispute lost
   on the rest, then that refund failing after Stripe had confirmed it; the difference is the
   rounding of one cent. The refund's own take-backs are worked out again in that case; the
   dispute's is not. To do in a later change.
6. *The call page's refund button could say "nothing was changed, try again" after Stripe had
   paid.* **Fixed:** the answer is read from what was written down whatever the call did; when it
   cannot be known, it says to look at the payment first.
7. *The dispute's page showed a cost of Connect's that had been taken off the books.* **Fixed.**
8. *A day was shown for money a person at Connect took by hand on another day.* **Fixed:** a day
   is shown only for what the app itself took.
9. *"The app asked Stripe ... within a few minutes" was not true in two cases.* **Fixed:** the
   words say what is known.

Also taken: a reversal by hand while a take-back is being taken is told as "on hold", not as
"had ended"; a reversal that carries a label is only ever the attempt with that label.

## What CodeRabbit found in step 2a (pull request 100), and what was done

Nineteen points, none of them a stop. Seventeen are taken:

- **The set-up script for Stripe's messages did not ask for the three new kinds** (a refund
  that failed, a refund that changed, a transfer that was reversed). **Fixed.** The note for
  going live now also says what is not noticed without them.
- **The notices said "14 days after this message was sent"; the rule counts from its
  arrival.** **Fixed** in the notices, the pages and the lawyer's file.
- **When Stripe's total of refunds on a charge is not the app's** (a refund made at Stripe
  itself), the app waited without a word. **Fixed:** the founder is told, once.
- **Where room is short, refunds are now looked at in the order they were confirmed.**
- **The helper's repeat of a taking:** a dispute that cannot be asked about stops the repeat,
  not the search for a reversal that was already made.
- **A search through Stripe's list** that runs past its time proves nothing also when its last
  page is empty; and whether "not found" may be final is decided before the search begins.
- **A cause that fell away frees room also where the take-back had ended** (a settled one):
  take-backs that had got nothing are worked out again.
- **The founder's answer** says "failed after all" while the app is still undoing a refund.
- **The founder's email about reversals by hand** is sent again when another one appears.
- **The check script:** the take-backs of the refunds that fail later are written right after
  those refunds; a transfer is noted for the clean-up as soon as it is made; the clean-up ends
  every money action of the run that is still unanswered; one more thing is asserted.

Two are not taken, with the reasons:

- *"Keep the part of an outside payment that was told as too much out of the room."* It is one
  cent in one case, it would need another number kept apart on every take-back, and the room
  it concerns is only used by a third refund on the same payment.
- *"Make a hold on the transfer a condition for a reversal by hand."* A reversal by hand is
  made at Stripe, where the app cannot require anything. The founder is told to hold first;
  the app stops as soon as it sees such a reversal; and one that slipped through is found
  afterwards and recorded as paid twice.

## Part 3a, step 2b, as built: the yearly statement only (and what was left out, and why)

**Built:** decision 8's part about the yearly statement. "Sent to you" is what was sent, with
nothing taken off. A column of its own, "Taken back or paid back", holds what went back from
the host, in the month Connect wrote it into its books (`host_takeback` and the new
`host_repaid`). "Of that, paid by Connect" is now "Carried by Connect" and holds `connect_cost`
with its sign: a contribution's or a tip's refund Connect gave from its own money, and what
Connect waived of a share owed back after a call's refund or a lost bank dispute. On the page
and in the file. No migration.

**Left out, on the builder's own judgment, for the founder to decide:** decision 8's other
part, that a **contribution or a tip** refunded after the host collected changes to the same
pattern as a call (her share falls, and she owes it back). They stay as they are today: such a
refund is Connect's own cost, the host keeps her share, and the founder's form says that
nothing will be taken back from her. The reasons:

- It asks nothing of a host. But it is **not what the draft Host Agreement describes**:
  sections 6.5 and 8.5 say that a refund lowers the host's share and Connect's fee. For a
  contribution or a tip refunded after collection the app leaves both as they were and books
  the whole refund as Connect's cost. Whether the agreement should say that, or the app should
  change, is a question for the lawyer (it is in `docs/for-the-lawyer.md`).
- A contribution's refund is a different machine from a call's (a line that is "owed", tried,
  and tried again by the helper). Bringing it under the take-backs means building the late
  failure, the order of refunds and the room once more for that machine. The call's side
  alone took five rounds of review to get right.
- A tip and a contribution can both be large (the app takes a tip of up to tens of thousands
  of dollars). Until this is built, the founder decides case by case whether to refund one
  after collection at all, or settles it with the host by hand.

If the founder wants it, it is a part of its own ("3a, step 2c"), with a plan of its own.

## Part 3b, as built: earnings not collected for 12 months

**Built:** decision 12, with these differences from the text above.

- **The table of tries** (`uncollected_tries`, migration 0062) has no "week". A try is the
  host, the moment it was written down, and an id. "One try a week" is asked under her lock:
  no new try while her latest one is less than 7 days old or has no outcome yet. The database
  refuses a second try without an outcome for the same host on top of that.
- **The try's id is the collection's id.** So a try that is run again is the same collection,
  by the rule her own button already has ("the same press, sent again").
- **What decides is asked when the collection is accepted** (the writing down of the try is
  only a first look, by the dates the shares carry). In that one step, with her row locked:
  her account is open (her own row is held, so it cannot be closed in between); the try is
  still open; and the 12 months hold for the shares that are **really ready** at that moment
  (her last collection that went through, read again; if none, the oldest share that would be
  sent). The try is marked "collected" in the same step. So a host who pressed her own button,
  whose account was closed, or whose only old share is held back gets nothing from the
  helper. Her 24 hours and everything that holds a share back are asked there as for any
  collection.
- **A try whose run fails for another reason than a refusal** (Stripe does not answer) stays
  without an outcome and is run again about a minute later; after a day it is written down as
  "nothing", and the next try is a week later.
- **`collections.started_as`** is worked out by the database itself from who pressed
  (nobody: the helper; the host: the host; anybody else: the founder). So it is right for the
  rows that exist, and for one written by a server still running the older code.
- **When the 12 months count from her last collection**, any share whose date has come is
  sent, also one that became ready yesterday. That is what decision 12 says ("her last
  collection that went through is more than 12 months ago").
- **The email** is also a message on her Messages page (one pair, as every message since plan
  47), and her Hosting page says beside her last collection that Connect started it. The
  sentence about her own money is said to a host whose profile is in another country than the
  United States, with an "if": the app does not know the currency of her bank account.
- **The founder is not told** of a try that sent nothing. The lines are in the table; no page
  shows them yet.

**Rhythm:** two loops of their own in the helper, so that a long daily round never keeps the
follow-up waiting. About once a day, and when the helper starts: every host with a share whose
date has come is looked at, and one who seems due gets a try. About once a minute: a try
without an outcome is run again; and, in a loop of its own, a host whose shares all have their
answer is told. From 26 hours after the collection was accepted she is told with what is known
by then; that is when a notice with something still open may go, not a promise of when it
arrives. A daily round that could not start is tried again ten minutes later.

**Checked by** `scripts/payments-check.ts --payouts`, section 29, against Stripe's test mode
(the collections' own script, so its hosts and calls are used): the cases of the list under
"Part 3b" above, with these limits. "A share that is held back" is a bank dispute, played by a
flag on the payment (as section 22 does). "A payout account that is not ready" is a host whose
account is taken away in the database; Stripe itself answering "not ready" for a linked account
is not played here (`abroad-check` plays that for the button). The account is closed between
the writing down and the collection, not during the accepting step itself.

## What Astra found in the code of part 3b, and what was done

Astra read the first build and said "hold the merge", with nine points. All nine were taken.

1. **An account closed while the collection is being accepted** could still be sent money: the
   look at "closed" and the closing did not share a lock. The accepting step now holds the
   person's own row (shared) from the look to the end.
2. **An older weakness, in the recovery of a transfer whose answer was lost** (the button's own
   path, which the helper now uses too): with two helpers, one could repeat the request just
   before the last moment for repeats while the other, just after it, found nothing at Stripe
   and called the transfer failed; the share would then be "ready" again although Stripe sent
   it. Now "not found" is only final for a search that began 24 hours after the action was
   written down (the rule a refund's recovery already had). And a "no" to a repeat is not
   taken as final before Stripe's own list was read: a transfer that is there is recorded.
3. **The 12 months were judged by the dates the shares carry, before the shares were locked.**
   A host whose only old share was held back (or refunded in that moment) could get a share
   from yesterday sent, with the charge. What decides is now asked last, for the shares that
   are really ready, and her last collection that went through is read again there.
4. **Leap day:** counting back from today made a host due on 28 February and not due again on
   the 29th. The 12 months are now counted forward from the moment she last collected.
5. **Two helpers running one try:** one could write "nothing" while the other's collection was
   accepted, and she would never be told. The try is now marked "collected" inside the step
   that accepts the collection, and "nothing" is only written with the try's row locked and
   no collection there.
6. **A share that only carries the charge** and had no answer yet did not count as "being
   checked", so she could be told before the charge was known. Unanswered shares are counted
   now, and a charge that is still open is named.
7. **The daily round kept the minute follow-up waiting.** Two loops now.
8. **A founder's collection written by a server still running the older code** would have been
   marked "host" for good. The column is now worked out by the database.
9. **The words:** "Stripe refused it" and "it stays ready to collect" said more than the
   record holds. The message now says "Not sent", "It is still yours", and that her Hosting
   page shows how things stand and what she can collect.

New cases in the real check for 3, 5 and 6. Points 1 and 2 need two processes at the same
instant and are not played by the script; they were checked by reading.

### Astra's second look at the code of part 3b, and what was done

Astra read the fixes and held the merge once more, with five points. It found points 1, 4, 5,
6, 7 and 8 of its first list closed.

1. **The recovery of a transfer, again: a "no" to a repeated request** was taken as final at
   once when Stripe's list showed nothing, although another sender's request could still be on
   its way. Now one rule holds for every search: a transfer that is on the list is recorded;
   "not there" lets the share go only when the search began 24 hours after the action was
   written down. Until then the action stays open. That costs the host nothing: her next
   collection is 24 hours after this one at the earliest.
   **Left as it is, on the builder's own judgment:** a "no" that comes back to the *first*
   sender (the press itself, within seconds of the acceptance) still ends the transfer at
   once. For that to go wrong, two processes would have to hold different rights at Stripe in
   the same seconds, and one of them be refused what the other is granted, under one
   idempotency key. Making every refused share wait a day would also change what the host
   sees after an ordinary refusal. The same kind of point was left open in step 2a.
2. **A collection of the last days whose answer was lost** did not count as "collected", so
   the helper could start a second collection, with a second charge, on top of it. Now a
   collection of the last 12 months with an unanswered transfer (for more than nothing) stops
   the helper: no try is written, and the accepting step refuses too.
3. **The migration was rewritten in place** (same number, new content). That is only safe
   because the first 0062 was never pushed: it was applied to the one local test database,
   taken out by hand there, and the new one applied. Nothing to change.
4. **Words:** "It is still yours" can be untrue by the time she reads it (a refund can take a
   share away). The message now says "Not sent in this collection" and points to "Your
   earnings" for what is hers to collect. Her Hosting page says the same ("was not sent in
   this collection", no longer "it stays ready"), and names a charge that is still being
   checked.
5. **The documents promised a little more than the helper does.** Made exact: the next try is
   at the first daily round at least seven days later, if she still seems due; a collection
   accepted while the account was open is finished, and its message written, also if the
   account is closed afterwards; after a day she can be told amounts that are not final, and
   she is told once; the charge is 25 cents or, for very small shares, less.

A new case in the real check for point 2. No third look was asked for: the two points about
money are closed by a rule that is the same as the refund's, which had five looks.

### What CodeRabbit found in part 3b (pull request 102), and what was done

Seven points, all taken. Two of them showed a weakness of the builder's own beside them, which
is fixed with them.

1. **The day before a notice with something still open** was counted from the writing down of
   the try, not from the collection (a try can be run long after it was written down). Counted
   from the acceptance of the collection now. And made 26 hours instead of 24: a transfer
   Stripe will not make is given up 24 hours after the acceptance, so at 24 hours she would
   have been told "still being checked" minutes before it was known how it ended.
2. **The check of her 24 hours could not fail:** the host had nothing ready, so her press was
   refused anyway. It now has a share ready, asks for the 24-hour sentence, and collects it a
   day later.
3. **A failure while writing down what a "no" from Stripe means** left the whole round of
   money work unfinished. Such a failure is now kept to its own action, for every kind of
   action in that place, and the round goes on.
4. **A collection without its answer** kept the helper away by a date counted back from today,
   the mirror of the leap-day fault. It is now judged by the one rule: would she still be due
   if it had gone through?
5. **Telling waited behind the tries that are run again** (which ask Stripe). Two loops now.
6. **A daily round that could not start** was not tried again until the next day. Ten minutes
   now, and the round is timed by the clock, not by counting passes.
7. **The search for a transfer at Stripe had no limit of time**, and (the builder's own, found
   beside it) a "no" to the search itself was no longer kept apart from a "no" to the
   transfer. It has the refund search's limits now, and a search that fails or runs long is
   "could not look", never "not there".

The builder's own, found while reading for point 3: a transfer that stays open after a "no"
(up to 24 hours) was asked about again on every pass of the helper, every few seconds. Once in
ten minutes now.

## Part 3c, as built: cancelling a new membership within 14 days

**The founder changed decisions 13 and 14 on 26 November 2026**, before this part was built:

- **The member cancels themselves, with a button.** Not only the founder for a written request.
- **Every member has the 14 days, wherever they live.** Nobody is asked for their country, and
  the founder's tick ("lives where the right applies") is gone.

Everything else is as decisions 13 and 14 say. Made exact:

- **Two ways in, one action** (`src/lib/membership/fourteen-days.ts`). The member presses
  "Cancel within 14 days" on their membership's page (under "Cancel membership"). Or the member
  writes to Connect and the founder presses the button on the Memberships page, with the day
  the request arrived: a cancellation in writing counts too, so that way stays.
- **Days are counted in UTC**, for everybody the same. The day of joining is the UTC day of the
  moment the bank authorised the first month. The member's button is open through the whole of
  the 14th day after it.
- **Someone still at the card step is not a member**, and has paid nothing: there is nothing to
  cancel, and both buttons say so. (Decision 13 said such a membership "can be ended too". It
  is left out: no email would go, the page has no place for the button, and the card step runs
  out by itself.) The
  founder's day must be the day of joining or one of the 14 after it, and not later than today;
  the founder can handle it later, while the first month still runs.
- **"First membership of the two":** no other month of these two people, in this or an earlier
  membership, was ever authorised by the bank. "Newly joined": the running month's agreement
  is of the kind "joined", and the month is the first that agreement was for.
- **What it does** is `endMembership` (as "admin", or as the member's own account) with the
  reason "it was cancelled within 14 days of joining, as the member asked", and then the
  clean-up every ending has. No sum of its own. The one email the member gets about the ending
  carries a note: who cancelled (for a written request, the day it reached us), that nothing
  was charged (a month that was only held) or that what was paid goes back, the calls that
  stay paid for and why, and a line for a call that had begun and is not worked out yet.
- **It ends the membership for good**, like every ending: to come back, the person needs a new
  invitation. The member's page says so beside the button. ("Cancel now", which pauses while
  the money is only held, is still there beside it.)
- **Refusals** have a sentence for the founder (who can settle a case by hand) and one for the
  member (who is pointed to the normal way of cancelling). Beside the cases of decision 13,
  two more refuse: a month whose payment has a problem the founder must look at (Stripe took
  a part of it); and a form that was drawn for another month.
- **The order:** first the calls booked from the membership that are still to come are
  cancelled (their time goes back into the month); only then is the membership ended, and the
  month's free money goes back to the card in one line. So no call is still to come when the
  membership ends, and none can start, and be charged, between the ending and its clean-up. A
  call that had already begun is worked out as usual, and the member's email says so. If a
  coming call cannot be cancelled just then, nothing is ended and the person presses again.
- **The founder's press is on record** (`admin_actions`), with the day entered.
- **Pressed twice:** the second press finds the membership ended and refuses.
- **The sentence before joining** (decision 14) is now for everyone: "You can cancel your
  first membership with (the host) within 14 days of joining: with "Cancel within 14 days" on
  your membership's page, or by writing to us (a request in writing counts from the day it
  reaches us, and your membership ends when we have dealt with it). Your membership then ends
  at once. Time you used before it ends, and a call you cancelled late or missed if it was
  charged under your booking's terms, is paid for at the member price; the rest of what you
  paid is given back. By joining you ask for your membership to start today." The wording's version is "2026-11-26"; a page that still showed
  the old sentence cannot be agreed to.
- **The phone apps** have no such button yet: a member there uses the website or writes to us.

**Checked by** two scripts against Stripe's test mode. The action itself:
`scripts/member-calls-check.ts`, a journey of its own (38 checks), which calls the library as
the member and as the founder. The real pages and forms: `scripts/membership-journey-check.ts`
(118 checks in all), where a member's page draws the button, a stranger and a form for another
month change nothing, her own press ends the membership, and the founder's real form is posted
with another month and with a day that cannot be. The cases of the list under "Part 3c" above
are in the first. A bank's dispute is played by the month's own mark. "A late cancellation that
was charged" is the member cancelling inside the host's free hour. A call under way when the
button is pressed is not played here (the journey "Endings" plays that for every ending); the
note's sentence for it has a test of its own.

### What Astra found in the code of part 3c, and what was done

Astra said "hold the merge", with ten points. All were taken; two of them differently from
what it proposed.

1. **A month of which Stripe took only a part** still says "held", so the member would have
   been told "nothing was charged" with money taken and no pay-back written. A month whose
   payment has a problem is now refused, for the founder to settle by hand.
2. **A call that starts seconds after the cancellation** could begin before the clean-up
   cancels it, and be charged although the member was told it is cancelled. Astra proposed to
   cancel the coming calls inside the ending step. That would mean a second copy of how a call
   is cancelled; and every other ending (the host's, a block, a closed account) has the same
   moment. **Done instead**, in two steps. First: the button refused while a call started in
   less than 10 minutes. CodeRabbit then showed that this only made the moment smaller (a
   clean-up can be late by more than 10 minutes). So now: the coming calls are cancelled
   first, with the ordinary cancellation, and the membership is ended only after that; the
   10-minute refusal is gone. The same moment for the other endings is left as it was.
3. **The clock was read before the month was locked.** The month is locked first now, and
   judged as it stands under the lock.
4. and 5. **Someone at the card step** had no button, would have got no email, and an old form
   of the founder's could have ended a later joining. Such a membership is no longer cancelled
   this way at all (see above), and both forms carry the month they were drawn for, compared
   under the lock.
6. **The member's email** could name an amount that had partly been given back already, count
   a call twice, and call a missed call "the time you used". It is now one line for a call,
   with what is kept of it now, and says "charged for the call" or "charged because it was
   cancelled late". With this note, the general sentence about a pay-back email is left out.
7. **The words promised more than the action does.** The sentence before joining says "your
   first membership with (the host)" and when a request in writing takes effect. The member's
   page says that the held amount is let go only if it is still held at that moment.
8. **The lawyer's file** now says that someone who joined under the earlier sentence can use
   the button too.
9. **The checks** called only the library. The real pages and forms are now played in
   `membership-journey-check` (whose old line "the founder's page has nothing to press" was
   out of date).
10. **Two refusals named a button that may not be on the page**, or said "moved on to another
   month" for a membership that had ended. The sentences name no button now, and the ended
   state is said first.

No second look was asked for. CodeRabbit read the pull request and made two points, both
taken: the order above (its point was the same as Astra's second, and showed that the first
answer to it was not enough); and the page journey now requires the founder's form on a new
membership (Dave's) before it posts it, so a form that went missing would fail the check.

### A gap closed afterwards: a press in time that could not be finished (26 November 2026)

**The gap.** CodeRabbit found it while reading the phone apps' plan for this button (pull
request 107). The button works in steps: a look, then the coming calls are cancelled, then the
membership is ended. If the database failed for one call, nothing was ended and the member was
asked to press again. If that next press came after the last of the 14 days, it was refused as
too late and the button was gone. The member had pressed in time, and was left with cancelled
calls and a membership that ran on. Nothing recorded the first press.

**What is built now.**

- **The request is written down first.** The first press that passes every rule is saved on the
  membership, with its moment and the month it was for, before any call is cancelled (four new
  columns on `memberships`, migration 0065). For the founder's form, who entered it and the day
  the request reached Connect are saved too. It is never cleared: on an ended membership it
  says when the member asked.
- **A later press counts from it.** With a request on record, a later press is not asked
  about the 14 days again, whatever the day is by then. The founder's form has that day filled
  in. Every other rule is asked again at the later press, as things stand then: a first month
  that has ended, a bank's question, a payment with a problem, a form drawn for another month.
- **Who asked first stays who asked.** Whoever presses later only finishes the request. If the
  member pressed first, it ends as the member's own cancellation, on their day, also when the
  founder's form finishes it (the day typed into the form then changes nothing). If the
  founder entered a request in writing first, it ends as that, with its day, also when the
  member's own press finishes it. The founder's record says who finished it.
- **The helper finishes it by itself.** Each round it looks for requests on record whose
  membership is still running in the month they were asked for, and finishes them as whoever
  asked (the member's own account, or "admin" with the day entered). It leaves a press one
  minute to finish by itself first. It never makes a request up: without one on record it
  refuses. A case that a rule stops is left alone, for the founder.
- **Who can put a request on record:** only the member's own press on one of the 14 days, or
  the founder's form with a day that counts. A press that is refused leaves nothing.
- **The same for one more moment.** A press while the month's money was being taken at that
  very moment was also answered "try again in a minute", and could run out the same way. That
  press is on record now too, and is finished afterwards.
- **What the person is told** when it could not be finished: that the membership was not
  cancelled yet, that the request is on record with the moment it was first made so the 14
  days cannot run out on it, that Connect keeps trying by itself, and that they can press
  again. (The founder's page no longer adds "Nothing was changed" to this: calls may have been
  cancelled already.)
- **The member's page** keeps the button while such a request is not finished, also after the
  last day, and says from which day it counts. If a rule stops the request for now (a payment
  with a problem, a bank's question), the page has no button but still says that the request
  is on record and what stops it.
- **The founder's Memberships page** has a list "Cancelled within 14 days, not finished". It
  is normally empty. It names who asked and when, and either "the helper is finishing it" or
  the rule that stops it, which then needs the founder. A request whose first month ended
  before it could be finished stays on the list whatever becomes of the membership (a second
  month, paused, ended by the host later): that is when the founder is needed. The founder
  settles it by hand and then presses "Settled by hand", which writes it on the founder's
  record and takes it off the list; that button moves no money. Left off are only the cases
  where nothing is owed: a month given up with nothing taken, and a membership that ended
  some other way before that month's end (every ending pays the unused money back).
- **Only the first month's calls are cancelled** by this button. A call booked from a month
  that began while the cancelling was under way is never touched.
- **Two presses of one request** (the member's second press and the helper, say) can meet. The
  one that comes second finds the membership ended this very way and says nothing more.
  Nothing is paid back twice: the ending is one step, and the pay-back has one line.

**The builder's choices** (the founder's standing wish "everything automatic" decided the
helper; the rest can be changed):

1. The helper finishes it, without anybody pressing again.
2. The founder's own form is put on record too, so the helper can finish that as well.
3. A request on record stays refused after the first month has ended, like any other: the
   unused money may already have gone to the host. The founder's list says "settle this case by
   hand". The helper has the rest of the first month (two weeks or more) to finish it before.
4. A request that ran out of its month stays on the founder's list until the founder presses
   "Settled by hand". The mark is a line on the founder's record, not a new column.
5. The membership ends at the moment it is finished, not at the moment of the first press.
   Time used between the two is paid for like any time used before an ending.

**Checked by** `scripts/member-calls-check.ts`, journey 11, against Stripe's test mode. A
trigger of the script's own makes the database refuse to cancel one call. A press on the last
day is not finished and is on record; the page and the founder's list show it on day 15; a
stranger, a bank's question, a payment with a problem and a month that has ended all still
refuse; the press on day 15 ends the membership and pays the month back once, in one line;
pressed again three ways, nothing more, and one email. The helper finishes one by itself,
after leaving it a minute, and gets to it behind an older one that a rule stops. The
founder's form finishes a member's own request, which stays the member's. The founder's form,
not finished, is on record with its day; the member's press finishes it, and it stays the
request in writing, on the founder's record once. Two presses of one request at the same
moment (the form and the helper, with the first held between its two looks): no refusal, one
ending, one email, one record, one pay-back. A request on record whose month ends first: the
membership is paused and the founder's list keeps it. A press during the taking of the money
is on record and counts two minutes later, on day 15. A press on day 20 leaves nothing on
record, and the helper can make nothing up. The real pages:
`scripts/membership-journey-check.ts`, part 4c: on day 20 no button; with a press of day 10 on
record, the button and its sentence; the founder's list and the day filled in; his press ends
it.

**What Astra found in this change, and what was done.** It said "hold the merge", with eight
points. All were taken.

1. **A retry could cancel a call of the next month.** The calls were found by membership, not
   by month. A request passing its first look just before the month's end could, after a
   renewal, cancel a call booked from month two. The button now cancels the calls of its own
   month only; the clean-up after an ending still takes every coming call.
2. **Fifty requests that a rule stops could keep every later one from a try.** The helper took
   the oldest fifty and stopped. It now goes through all of them, page after page, in every
   round.
3. **A request could vanish from the founder's list just when the founder was needed:** when
   the first month ended and the membership was paused. The list now keeps every request whose
   membership has not ended, except where the month was given up with nothing taken.
4. **A later press could change who had asked and on which day,** in the email and on the
   founder's record. Now whoever asked first stays who asked (see above).
5. **The founder could still read "Nothing was changed"** after calls had been cancelled, when
   a rule stopped the second look. Such a stop now says that calls may already have been
   cancelled and that the request stays on record. And "ended meanwhile by another press" is
   now seen under the lock itself, not by a second read.
6. **The clean-up could be dated before the ending,** because it used the clock handed in
   before the wait for the locks. It reads the clock afresh now. The lawyer's note said
   "normally within a minute"; it now says what the code does.
7. **The check did not play two presses at once.** It does now (above), and counts emails,
   records and pay-backs after every press is done.
8. **The page check skipped the founder's view when the page was broken.** It skips only when
   the test admin's login is not set up; with the login, the page must open.

**What CodeRabbit found in this change, and what was done.** Seven points, all taken.

1. **The check moved the clock for everybody.** Journey 11 ran the helper's job 20 days ahead
   over the whole shared test database, so it could have finished somebody else's request.
   The job takes a list of memberships now (only a check script passes one), and the journey
   keeps it to its own.
2. **The two-presses check relied on a wait of 700 milliseconds.** The helper's press now
   starts when the form's request is on record, however long that took.
3. **If even the list of coming calls could not be read,** the person was told "we could not
   confirm what happened" although the request was on record. That is "not finished yet" now.
4. **"Not cancelled yet" could be said after another press had ended the membership** while
   this one was still at the calls. It looks once more before saying so.
5. **The founder's record named only who entered a request in writing,** not another admin
   who finished it. The line is now under whoever pressed, and names who entered it.
6. **A request that ran out of its month vanished from the founder's list when the membership
   later ended some other way,** although the first month was still not settled. It stays now,
   until "Settled by hand" (new, see above).
7. **The member's page said nothing when a rule stopped a request on record.** It now says
   that the request is on record and what stops it, without the button.
