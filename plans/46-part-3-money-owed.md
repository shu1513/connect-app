# Plan 46, part 3: money a host owes after a refund, and three smaller things

**Status:** a plan only. Written 21 November 2026 by the builder alone, from the code as it is on
`main` after pull request 97. It is the detailed plan that `plans/46-agreements-live.md` asks for
before its part 3 is built ("Part 3: refunds by Connect after a host has collected, and
uncollected earnings"). Astra (GPT, effort high) checked the first draft against the code: "not
ready", eight points. They are worked in here; what was taken and what was not is at the end.

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
way and not two.** If you would rather have debts taken out of later collections, say so before
part 3a is built: that is a different, larger piece of work, and plan 47's part would have to
follow it.

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

## What the founder said

- 20 November 2026: "build the 14 changes so the agreements can go live. do what you think is
  the best."
- 20 November 2026, on plan 47 (the other session's record): the founder agreed that a lost
  dispute's share is taken "from later earnings".
- 21 November 2026, asked whether to write this plan next and have Astra check it: "Yes, write
  the plan".

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

1. **One way to recover a debt: plan 47's** (see the founder's decision above). A debt from a
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
   before, her share after, Connect's fee before and after), so that its notice can always be
   shown again exactly, whatever is refunded later.

4. **The ceiling, over all causes.** From one share, the app never takes back more than:
   - what is left of the transfer at Stripe (what was sent, less what Stripe shows as reversed),
     less the debts on that share that are still open (told, waiting, objected, being taken);
     and
   - what was sent, less what she is still entitled to after every refund and every lost
     dispute so far.
   **A lost dispute after a refund** is therefore worked out from her share **as it stands
   after the refunds**, not from what was sent. (Astra's example: 100 charged, 80 sent; 50
   refunded, so she owes 40 and her share is 40; the bank then takes 25 of the 50 that are
   left: she owes half of 40, which is 20, not 25.) `owedCents` gets that number in place of
   "what was sent"; for a share with no refund after the sending the two are the same, so
   plan 47's cases do not change.
   - A share that was "sent" with nothing sent (the collection charge ate it) has no transfer:
     the refund is marked "nothing to take back" once, and is not looked at again.
   - A share that carried the collection charge got up to 25 cents less than the share: she
     can owe at most what she got. The charge stays what it was in the books.
   - While a reversal on a share is being taken, nothing new is worked out for that share.
   - When a debt is called off, the other debts on that share that had been cut short because
     of it are worked out again; one whose amount rises gets a fresh notice for the rise, with
     its own 14 days. (Today only rows that said "nothing" are looked at again.)
   - **Found on the way, in plan 47's code:** a member's month can pay for several shares, and
     two helpers working on two of them at the same moment can both count the same room under
     one dispute. Allocation under one dispute is put behind one lock for that dispute.

5. **A refund is refused while anything about a bank is on the payment** (a question, a
   dispute, a recorded loss), as today, and while a transfer of that share is under way. So a
   refund and a dispute never start at the same time; one that was already on its way when a
   loss arrives is finished, and the ceiling above covers both orders.

6. **The 14 days count from the notice really sent, and an objection stops the taking.** For
   both kinds of debt, because it is one row and one piece of code:
   - The notice is the message on her Messages page and the same text by email. The 14 days
     count from the moment the email was handed to the sending service (`sentAt` on the email).
     While that email has not gone, the debt is not due; if it failed, the founder is told and
     the debt waits.
   - Her earnings page and the message carry a button, "I think this is wrong", with a box for
     her reasons, while the debt says "told". Pressing it puts the row in a new state,
     "objected": it is not taken. The founder is told at once and decides: "Call it off", or
     "Take it after all" (she is told why, and it is then taken no earlier than its first day
     and no earlier than 3 days after that answer). The helper checks the state under the same
     lock with which it starts the taking, so an objection made a second earlier always wins.
   - An objection sent to support by email instead: the founder presses "Hold it: she
     objected" on the same page, with the same effect.
   This is a change to plan 47's behaviour (today the days count from the row, and only a
   cancellation stops it). It can only make the app slower to take, never quicker.

7. **Before the Host Agreement is published and accepted, the app never takes a refund debt by
   itself.** (Default A.) A debt is taken by the app only if the host accepted a version of the
   Host Agreement that is published (not a draft) and in effect, at or before the moment **the
   customer's money was first held** for that payment: the hold of a call's payment, of a
   contribution's or tip's payment, of a membership month. That moment is used, and not the
   moment the charge was written down, because the writing can come later than the bank's
   taking. Otherwise the row is written in a new state, "waiting", with no due day; she is told
   that she owes it and that Connect will write to her; and the founder's page offers "Call it
   off" and "Settled outside the app" (with a note of how). It is never promoted later, whatever
   she accepts afterwards. Plan 47's dispute debts are not changed by this decision; see "For
   the founder to decide".

8. **The books.** A refund after collection writes the same three lines as any refund: the
   refund, the change in the fee, the change in her share. Her share in the books is then what
   she is entitled to, and what was sent stays what was sent.
   - Taken back: one line `host_takeback` for the amount, with a note that names the cause.
   - Called off, or settled outside the app: one line `connect_cost` for the amount Connect
     carries, written once, in the same step. It explains money that stayed with her; it is not
     a second refund.
   - Example (Astra's): 100 charged, 80 hers, 20 the fee, no collection charge on this share.
     A full refund writes minus 100, minus 80, minus 20. Taken back: plus 80 `host_takeback`.
     Called off instead: plus 80 `connect_cost`.
   - **A contribution or tip refunded after collection changes to this pattern.** Today the
     whole refund is booked as Connect's cost at once. After: the refund once on the
     contribution's payment, the two changes on its share, then the reversal or the waiver. A
     tip of 5.00 is charged 5.46: a full refund takes 5.00 off her share and 0.46 off the
     payment fee, so the fee is never part of her debt. Lines that carry `connectsOwn` today,
     finished or still on their way, keep the old treatment to their end; a later refund in the
     new pattern reads the share's own refunded amount, because the payment's total also holds
     the old refunds that left the share whole.

9. **Who can refund after collection: the founder only**, with a reason and an amount.
   (Default B.) The host's own button keeps refusing after she collected. A founder who is also
   that call's host is treated as the host there, as today; a refund after collection is made
   from the founder's page, where the person always acts as the founder.

10. **The founder's form.** Shown also after a share was sent, for the kinds this plan covers
    (a call paid by card, a contribution, a tip). An amount that can be changed, and a reason
    chosen from the grounds the Host Agreement names for deciding in the host's place (8.3 and
    8.4: the call was ended with "End call and report"; the host did not join; a mistake, fraud
    or a broken rule; the host is paused, closed or cannot be reached; the law or the card
    companies require it; a legal right of a customer in the UK or Europe), plus a sentence of
    the founder's own. Before it is pressed it shows an **estimate**: "The host has collected.
    The customer is paid back from Connect's money. The host will owe about X." After Stripe has
    answered, the page says what really happened: paid back, on its way, or refused by Stripe
    with Stripe's words; and what the host owes, or that it waits (decision 7), or that nothing
    can be taken back. The page gets a way to find one payment by the call's id or the
    customer's email address.

11. **Stripe can accept a refund and still not pay it at once.** A refund can be "on its way"
    (also when Connect's own balance at Stripe is too low) or fail. The debt is written only
    when Stripe confirms the refund. One that Stripe refuses for good (a charge it will no
    longer refund) is shown to the founder as refused, and is the founder's to settle outside
    the app.

12. **Not collected for 12 months.**
    - **When:** her last collection **that went through** is more than 12 months ago, or she
      never had one and the oldest share that is ready now has been ready, by the date it
      carries, for more than 12 months. "Went through": a collection with at least one share of
      more than nothing whose transfer succeeded. (The date a share carries can have moved; it
      is the best the tables hold, and the plan says so plainly.)
    - **How:** the helper, once a day, in a loop of its own. For each such host it runs the
      whole of what her own button runs (`collectEarnings`: ask Stripe whether the payout
      account is ready, accept under her lock, send), with an id of its own for each try. Under
      her lock it asks again that the account is open, that the 12 months still hold, and that
      her 24 hours are over. So everything that holds a share back today (a bank's question or
      dispute, a refund request under way, the founder's hold on a contribution, the smallest
      amount worth sending) holds it back here too.
    - **A try that sends nothing** (the account is not ready, Stripe refuses, nothing is
      collectable) is written on a line of its own for that host, and tried again a week
      later. It does not count as a collection.
    - **The email** goes out once the outcome of that collection is known (or after a day, with
      what is known by then): what was sent, in US dollars, to her Stripe account; the charge;
      what could not be sent; and that she can collect herself whenever she likes, once in 24
      hours. For a host abroad it says that her bank turns the dollars into her own money.
    - A paused account is treated like any other open one. A closed account is not touched
      (the founder's "final collection" exists for it).
    - `collections.startedBy` becomes optional, and a new column says who started it: the
      host, the founder, or the helper. The rows that exist are filled in.

13. **The 14-day button for a new membership** (Payment Terms 12.3), on the founder's
    Memberships page.
    - **For which:** a membership in its first period, whose first month was really paid for or
      held (the moment its first month was authorised is "joined"); not one that was resumed
      or joined again later. No bank's question or dispute on it.
    - **What the founder enters:** the day the member's request reached Connect, and a tick
      that the member lives where the 14-day right applies (the card's country does not show
      where a person lives). The action refuses when that day is more than 14 days after
      joining. (Default C.)
    - **What it does:** it ends the membership as the founder, with a reason of its own
      ("cancelled within 14 days"), and cancels its coming member calls. Everything else is
      what ending a membership already does: renewal stops; a month that is only to be paid or
      held is given up and its hold let go; for a month that was taken, the free money and the
      money set aside for the cancelled calls go back to the card through the pay-back lines
      there are, and nothing of this month expires to the host. Time that was really used
      stays paid at the member price, with the host's share and the fee as they are. The plan
      adds no sum of its own ("month less used"): that could pay back twice what the lines
      already pay back.
    - **A late cancellation or a missed call that was already charged stays charged.** By
      booking, the member asked for the call to take place then. (For the lawyer.)
    - The member is told that it was cancelled within the 14 days and, as today, each amount as
      it goes back; the host is told that it ended and why.

14. **The sentence before joining** becomes: "Where a 14-day right to cancel applies to you (in
    the United Kingdom and Europe): you can cancel a new membership within 14 days of joining
    by writing to us. Time you used in those days is paid for at the member price; the rest of
    what you paid is given back." With a new wording version, as every change of that list
    gets.

15. **No change to the legal documents' texts.** A merged version is never edited. Three
    sentences have to be right in the first published version, and are added to the list in
    `docs/legal/README.md`, section 7 ("To carry into the first published version"): Host
    Agreement 9.4 should say plainly that the usual way is asking Stripe to take the amount
    back out of what was sent, and that she can object with a button; 8.2 should say that after
    she has collected only Connect can refund; 7.7's "[12]" becomes 12.

## The parts (one pull request each, in this order)

### Part 3a: refunds after collection, and the debt

**Migration** (the next free number when it is built; 0054 is the last on `main` today):
- `host_debts`: `dispute_id` optional; `refund_id` and `contribution_refund_id`, each a link;
  the check "exactly one cause"; two more "one row for a cause and a share"; `due_at`
  optional; the states "waiting", "objected" and "settled" added; `notice_email_id` (the email
  whose sending starts the days), `objected_at`, `objection` (her words), `decided_at`,
  `decided_by`, `settled_note`.
- `refunds` and the contribution's refund lines: `after_collection`; her share and the fee
  before and after (four numbers, filled when the refund is confirmed); `host_owes_cents`; and
  a mark "looked at for a debt".

**Code:**
- `refundPayment` and `applyRefundDone`: decisions 3, 5, 9. The request to Stripe does not
  change: with separate charges and transfers a refund is paid from Connect's balance and no
  transfer is touched.
- `src/lib/contributions/refund.ts`: decision 8; the old lines keep their treatment.
- `src/lib/disputes/takeback.ts`, every function that reads the dispute today, branched by
  cause: the finder gets two more (confirmed refunds of calls; of contributions and tips, found
  through the contribution's payment to its share; never a member's time given back, never an
  old line of Connect's own); writing a row checks the cause again under the lock, takes the
  ceiling of decision 4, and chooses "told" or "waiting" by decision 7; only a dispute row asks
  Stripe about the dispute; the taking and its recovery after an unknown outcome check, for a
  refund row, that the refund is still confirmed and the row still "told" and due (decision
  6), and keep the request, its label and the search of the reversals as they are; the line in
  the books and the words depend on the cause; "the bank decided the other way" stays for
  dispute rows; the telling of the founder after 30 days no longer drops rows without a
  dispute; calling off works from "told", "waiting" and "objected", and books Connect's cost
  for a refund row in the same step.
- `takeback-rules.ts`: the ceiling (decision 4), the due day from the email's sending
  (decision 6), the states. `takeback-words.ts`: the words for a refund debt (owed, waiting,
  objected, answered, taken, called off, settled, refused for 30 days).
- Pages: the founder's refund form and the search (decision 10), with its true answer
  (decision 11); a founder's list of debts of both kinds, with the buttons of decisions 6 and
  7 (today cancelling lives only on a dispute's page); the host's earnings page lists waiting
  and objected debts too, names the cause, links to the call, the project or the tip, and
  carries "I think this is wrong"; the host's project page stops calling a share that shrank
  "sent to you"; the founder's contribution form stops saying nothing will be taken back.
- The yearly statement: "Sent to you" stays what it is (already less what was taken back); a
  column "Of that, taken back" shows that part; "Of that, paid by Connect" is renamed "Carried
  by Connect", because a waiver can fall in another month, or another year, than the refund.
  Both the page and the file.

**Checked by** a new script against Stripe's test mode, `scripts/owed-check.ts`, and tests of
the rules:
- a call paid, collected, then refunded in full by the founder: the customer's refund is real
  at Stripe; one row, told once however often the look runs; the three lines; not due while
  the email has not gone; nothing taken a second before 14 days after its sending; then the
  reversal is real at Stripe for that amount of that transfer, and the line `host_takeback`;
- half refunded before collecting and half after: only the second owes; half refunded twice
  after: two rows, to the cent, together never more than was sent;
- a share that carried the collection charge; a share that was sent with nothing: "nothing to
  take back", looked at once;
- a refund, then a part dispute lost on the same share: 40 and 20 in Astra's example, in
  both orders in which the helper finds them, and when the refund debt was already taken;
  a debt called off: the other debt on that share is worked out again, with a fresh notice for
  the rise; two helpers on two shares of one disputed month: together never more than the
  bank took;
- the refund fails at Stripe: no row; still on its way: no row until confirmed; the founder's
  page says which;
- the host's own button after collection: refused; the founder without a reason: refused;
  while a transfer of that share is under way, or anything about a bank is on the payment:
  refused;
- "I think this is wrong" a moment before the day: never taken; "Take it after all": taken no
  earlier than 3 days later; pressed while it is being taken: refused;
- a host without a published Host Agreement accepted before the money was held: "waiting",
  never taken, also after she accepts one later; "Settled outside the app" and "Call it off"
  each book Connect's cost once. With one accepted in time: "told". (The check makes up a
  published version for its own run, as `agreements-check` does.)
- a tip refunded after collection: the debt is the tip she got, not the payment fee; a
  contribution likewise, also a part refund after an old refund of Connect's own; an old line
  with `connectsOwn`, finished or on its way, is left as it was;
- Stripe refuses the reversal: back to its notice, tried the next day; told to the founder
  after 30 days, for a refund row too;
- the yearly statement, page and file, for a refund in December taken back or waived in
  January;
- `disputes-check` and `contribution-check` (their own scripts) pass, the second with its one
  check of the old behaviour changed to the new.

### Part 3b: earnings not collected for 12 months

**Migration:** `collections.started_by` optional; `collections.started_as`; a small table for
the helper's tries that sent nothing (the host, when, why).

**Code:** decision 12.

**Checked by** the script: a host whose last collection that went through is 12 months and a
day old is sent everything ready, once, with the charge, and told what really went; one at 11
months is left; one whose last collection was accepted and sent nothing counts from the one
before; one who never collected counts from her oldest ready share; a refused try is written
down, is not a collection, and is tried again after a week and not before; a payout account
that Stripe says is not ready is left; a share held back by a dispute or a refund request
stays; a closed account is not touched; two helpers at once, or her own button in the same
minute, make one collection; the email names a transfer that was refused as not sent.

### Part 3c: the 14-day button for a membership, and the sentence

**Code:** decisions 13 and 14: the founder's action and its page; the reason; the sentence and
its version.

**Checked by** the membership check script, against Stripe's test mode: joined 3 days ago, the
money only held: the hold is let go, nothing is charged, the membership is ended (not
paused); taken, nothing used: the whole month goes back, no renewal; taken, one call of 30
minutes used: that call stays paid at the member price, the rest goes back, the host's share of
the call is untouched; a coming member call is cancelled and its money goes back once, through
its own line; a late cancellation that was charged stays charged; a request that reached
Connect on day 15: refused; one of day 14 handled on day 20: done; a resumed membership:
refused; anything about a bank on it: refused; pressed twice: nothing is paid back twice; the
ticked sentence is the new one and carries the new version.

## Working beside the other sessions

- **Bank disputes (plan 47)** is fully merged and its session has stopped. This plan changes
  its table, adds to `takeback.ts`, and changes two of its behaviours (decision 4's amount
  after a refund and lock; decision 6's days and objection). Its check script must still pass,
  and its memory file is told.
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
  stay charged?

## For the founder to decide (nothing here waits for it, except the first)

- **The reversal at Stripe as the one way** (at the top). Part 3a is not started until you
  have seen this.
- **One rule or two for when the app may take by itself?** Under this plan a refund debt is
  never taken by the app unless the host held a published Host Agreement in time (decision 7).
  A lost bank dispute's debt (plan 47) is taken after 14 days whatever she accepted. The
  builder would make both follow decision 7; it is left as it is because plan 47's rules were
  agreed with you in that session.
- Defaults A, B and C at the top.

## Not in this part

- Giving a member's time back after the host collected (`giveTimeBack` keeps refusing). It
  needs the same debt for a share paid from a month, and can follow once 3a is in.
- A host paying a debt by card or bank transfer, and a "request to pay" (Host Agreement 9.4's
  second step).
- Charging a host the bank's dispute fee (9.2).
- Holding back a host's uncollected earnings against a debt.
- A debt that was taken and then turns out wrong (plan 47's "leftover 2"): the founder gives it
  back by hand. Paying back by hand does not give the transfer its room back.
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
   3a's pages and statement.
5. *Stripe accepting a refund is not the customer having the money*; the form says "sent"
   whatever happened. **Taken:** decisions 10 and 11.
6. *The agreement test must look at the exact version, at whether it was published and in
   effect, and at a moment that is certain.* **Taken:** decision 7 uses the moment the money was
   first held.
7. *The 12-month helper must run the whole collection, not two of its steps; "went through" and
   "became ready" were not defined; a refused try has no row to carry its next day; the email
   must wait for the outcome.* **Taken:** decision 12.
8. *The 14-day outcome is mostly what ending a membership already does; "joined" was not
   defined; "Cancel now" pauses and works while the month is to be paid too.* **Taken:**
   decision 13, which now adds a reason and an authorised action and no sum of its own.
9. *Corrections to "What is there today" and the founder's form (part refunds, an estimate
   before and the truth after, where the action lives).* **Taken:** that section and decision
   10.

Not taken: none of its points was set aside. Two things it raised are left as they are and
named under "Not in this part": a taken debt that turns out wrong, and Stripe's own limits on
how old a charge can be for a refund (the app shows Stripe's refusal; nothing is worked out in
advance).
