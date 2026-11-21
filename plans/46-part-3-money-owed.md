# Plan 46, part 3: money a host owes after a refund, and three smaller things

**Status:** a plan only. Written 21 November 2026 by the builder alone, from the code as it is on
`main` after pull request 97. It is the detailed plan that `plans/46-agreements-live.md` asks for
before its part 3 is built ("Part 3: refunds by Connect after a host has collected, and
uncollected earnings"). Astra (GPT, effort high) checks it before anything is built; what its
check changed is at the end.

Parts 1, 2, 4 and 5 of plan 46 are merged (pull requests 85, 89, 96, 88).

## For the founder: what this is

Four things, all from the list of 14 changes that make the agreements true:

1. **You can refund a customer after the host has already collected the money.** Today the app
   refuses ("has to go through support"). After this, your refund form works then too. The
   customer gets the money from Connect at once. The host then owes Connect her share of it.
2. **The host's debt is recovered the way lost bank disputes already are** (plan 47, built and
   merged): she is told in writing which payment, why and how much; she has 14 days to say it
   is wrong; then the app asks Stripe to take that amount back out of what it sent her. You can
   call a debt off with one button, which is also how a goodwill refund works (Connect carries
   it).
3. **A host who has not collected for 12 months is sent what is ready**, by the app itself,
   with the usual 25-cent charge. She gets an email saying what was sent.
4. **A new member in the UK or Europe who cancels within 14 days** gets a button of yours that
   does it properly: time already used is paid for at the member price, the rest goes back to
   the card. And one sentence people see before joining is corrected to say exactly that.

**What changed against plan 46, and why.** Plan 46 (decision 13) said a host's debt is taken out
of her next collections inside the app, and that nothing is ever taken any other way. Since then
plan 47 was built, and it recovers a debt by asking Stripe to reverse part of the transfer. This
plan uses that one way for both kinds of debt. Two ways of taking money back from the same host
would be twice the code, twice the risk, and two different promises. The Host Agreement's
section 9.4 allows both ("from your later earnings", and "ask Stripe to take it ... where
Stripe's agreement with you allows").

**Also dropped from this part:** "a bank dispute lost after the host collected". Plan 47 built
it.

**Three things only you can decide** (the plan names a default for each, and nothing waits):

- **A.** Until the agreements are published (today they are drafts), should the app take a
  refund debt back by itself? Default here: **no.** The debt is written down and the host is
  told, but nothing is taken until you press "Start the 14 days". Reason: taking money back
  rests on the Host Agreement, and a draft is not in force. (Plan 47's dispute debts are taken
  without this condition today. That is the other session's rule; see "For the founder to
  decide".)
- **B.** Should a host be able to refund a customer herself after she collected? Default:
  **no**, only you. She would be creating a debt against herself with one click.
- **C.** How long after joining does your 14-day button work? Default: **14 days from the
  moment of joining, plus 2 days' grace** for a request that reached support on the last day.

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
  refuses once `transferStatus` is "sent": "The host has already been paid for this call. A
  refund now has to go through support." When a refund is done, `applyRefundDone` writes three
  lines into the books: the refund, the change in Connect's fee, the change in the host's share
  (`splitAfterRefunds`).
- **A contribution or a tip** can already be refunded by the founder after collection
  (`src/lib/contributions/refund.ts`, `connectsOwn`). The whole refund is then booked as
  Connect's own cost (`connect_cost`), and the host keeps her share. Nobody owes anything.
- **A member's call** (`giveTimeBack`, `src/lib/membership/give-back.ts`) refuses after
  collection, like a card payment.
- **Debts** exist since plan 47: the table `host_debts` (migration 0054) and
  `src/lib/disputes/takeback.ts`. A row belongs to one bank dispute and one share (`disputeId`
  is required). The helper finds what is owed, writes the row with a notice to the host (the
  Messages page and an email), and 14 days later asks Stripe to reverse that amount of that
  transfer, as a money action of the kind "take back". A refusal is tried again a day later;
  after 30 days of refusals the founder is told. The founder can cancel while the row says
  "told". When it is taken, the books get a line `host_takeback`.
- **Collecting** (`src/lib/payments/collect.ts`): `collectEarnings` for the host's own button,
  `collectForClosedHost` for the founder. `collections.startedBy` is required and is a person.
  A host can collect once in 24 hours.
- **Memberships:** "Cancel now" (`cancelNow`, `src/lib/membership/ending.ts`) only works while
  the month's money is held and not yet taken. Money that is owed back to a member goes through
  the month's own pay-back lines (`src/lib/membership/payback.ts`, `owedAfterEnding`).
- **The sentence** people see before joining (`src/lib/membership/wording.ts`, last line of the
  list) says "Time you booked or used in those days is paid for". The Payment Terms (12.3) say
  time **used** is paid for.
- **The founder's refund form** (`src/app/admin/page.tsx`) is hidden once a share was sent, and
  the page lists only the latest payments.
- **Proof of who accepted what:** `agreement_acceptances` (plan 46, part 1). Every version of
  every document is a draft today (`src/legal/versions.ts`).

## Decisions (the builder's; each can be changed)

1. **One way to recover a debt: plan 47's.** A debt from a refund is a row in `host_debts`,
   taken by the same steps, with the same 14 days, the same daily retry, the same telling of
   the founder after 30 days of refusals, and the same "Cancel" for the founder. No money is
   held back inside "Collect earnings". Nothing in `takeback.ts`'s way of asking Stripe changes.

2. **A debt row gets a second kind of cause.** `host_debts.disputeId` becomes optional, and two
   optional columns are added: `refundId` (a call's refund, `refunds.id`) and
   `contributionRefundId` (a contribution's or tip's refund line). Exactly one of the three is
   set (a check in the database). One row at most for a refund and a share, as for a dispute
   and a share. A new column `cause` is not needed: it is read from which of the three is set.

3. **What is owed for a refund: the change in her share, to the cent, never more than is left
   of the transfer.** When a refund after collection is done, the split is worked out as for
   any refund (`splitAfterRefunds`), and the amount by which her share shrinks is written on the
   refund itself (new column `hostOwesCents` on `refunds`, and on the contribution's refund
   line). The debt row is written from that number, capped by what Stripe says is left of the
   transfer after earlier reversals and after other debts on the same share that are still to
   take (the same reading and the same cap plan 47 uses, `owedCents`). So a share that carried
   the 25-cent collection charge owes 25 cents less than the share: that money never reached
   her.

4. **The debt is written when the refund has really gone through, not when it is started**, and
   by a look the helper repeats (as plan 47 does for lost disputes): every refund that is done,
   has `hostOwesCents` above zero and has no row yet gets one, with the share's payment locked.
   A refund that fails or is cancelled at Stripe writes nothing.

5. **The books.** A refund after collection writes the same three lines as any refund: the
   refund, the change in the fee, the change in her share. So "her share" in the books is
   always what she is entitled to, and the difference to what was sent is the debt. When the
   debt is taken, plan 47's line (`host_takeback`) is written, with a note that says "after a
   refund". When the founder calls a debt off, a line `connect_cost` is written for that
   amount: Connect carries it. **A contribution or tip refunded after collection changes to the
   same pattern** (today it books the whole refund as Connect's cost at once): the share and the
   fee shrink, the debt is written, and Connect's cost is booked only if the debt is called off.
   A tip's payment fee sits on top of the tip: it is Connect's part of the split, so it is never
   part of her debt. Lines written before this change stay as they are.

6. **Who can refund after collection: the founder only.** The host's own refund button keeps
   refusing once she has collected, with the sentence it has today. (Default B.)

7. **The founder's form says what will happen before it is pressed:** "The host has collected
   this share. The customer is paid back from Connect's money now. The host will owe $X, and is
   told with 14 days to object." The form is shown also after a share was sent, and the page
   gets a way to find one payment by the call's id or the customer's email address, so that an
   older payment can be refunded too (today only the latest are listed).

8. **Before the Host Agreement is published, a refund debt is written and told, and not taken
   by itself.** (Default A.) The rule: a debt is taken by itself only if the host accepted a
   **published** version of the Host Agreement at or before the moment the payment was charged
   (her line in `agreement_acceptances`, a version that is not a draft). Otherwise the row is
   written with a new state, "waiting", the host's notice says that she owes it and that
   Connect will write to her before anything is taken, and the founder's page shows two
   buttons: "Start the 14 days" (the row becomes "told", the usual notice goes out, and the 14
   days count from then) and "Call it off". Plan 47's dispute debts are not changed by this
   plan.

9. **The notice.** The same two places as plan 47: a message on the host's Messages page, and
   the same text by email. It says which call or contribution, when, the customer's first
   name, why Connect refunded (the founder's reason from the form, required after collection),
   how the amount is worked out (her share before, her share after, what was sent), the day
   from which it is taken, and how to object (write to support; a person reads it). The words
   are new (`src/lib/disputes/takeback-words.ts` speaks of a bank today) and are tested on
   their own.

10. **An objection** is honoured as in plan 47: the founder calls the debt off while it says
    "told" (or "waiting"). One that is being taken cannot be called off. Nothing new is built
    for objecting inside the app.

11. **Not collected for 12 months.** Once a day the helper looks for hosts with earnings that
    are ready, whose last collection **that went through** is more than 12 months ago, or who
    never collected and whose first earning became ready more than 12 months ago (Host
    Agreement 7.7). For each, if her payout account is ready, it starts the same collection her
    own button starts, for everything that is ready, with the usual charge. She gets an email:
    what was sent, for which calls, and that she can collect herself at any time. If the
    collection is refused or her payout account is not ready, it is tried again a week later;
    a try that was refused does not start the 12 months again, because they count from a
    collection that went through. A paused account is treated like any other open one. A
    closed account is not touched (the founder's "final collection" exists for it).
    `collections.startedBy` becomes optional and a new column says who started it: the host,
    the founder, or the helper.

12. **The 14-day button for a new membership** (Payment Terms 12.3), on the founder's
    Memberships page, for a membership whose first month was joined no more than 16 days ago
    (default C) and that has no bank dispute or bank's question open:
    - if the first month's money is only held: exactly what "Cancel now" does;
    - if it was taken: the membership ends now and does not renew; its coming member calls are
      cancelled and their time goes back to the month; time that was really used (calls that
      took place, and late cancellations and missed calls that were charged) stays paid at the
      member price, with the host's share and the fee as they are; everything else of what the
      member paid goes back to the card through the month's own pay-back line; unused time does
      **not** expire to the host for this month.
    - the member and the host are each told by email what happened and the amounts.
    It uses the steps that exist (`cancelUpcomingMemberCalls`, `owedAfterEnding`, the pay-back
    lines, `cleanUpEnding`); what is new is one way of ending ("cancelled within 14 days") and
    the rule that this month's unused time is paid back and not expired.

13. **The sentence before joining** becomes: "Where a 14-day right to cancel applies to you (in
    the United Kingdom and Europe): you can cancel a new membership within 14 days of joining
    by writing to us. Time you used in those days is paid for at the member price; the rest of
    what you paid is given back." With a new wording version, as every change of that list
    gets.

14. **No change to the legal documents' texts.** A merged version is never edited. Three
    sentences have to be right in the first published version, and are added to the list in
    `docs/legal/README.md`, section 7 ("To carry into the first published version"): Host
    Agreement 9.4 should say plainly that the usual way is asking Stripe to take the amount
    back out of what was sent; Host Agreement 8.2 should say that after she has collected only
    Connect can refund; Host Agreement 7.7's "[12]" becomes 12.

## The parts (one pull request each, in this order)

### Part 3a: refunds after collection, and the debt

**Migration** (the next free number when it is built; 0054 is the last on `main` today):
`host_debts.dispute_id` optional; `host_debts.refund_id`, `host_debts.contribution_refund_id`;
the check "exactly one cause"; two unique indexes (refund and share; contribution refund and
share); the state "waiting" added to the states' check; `refunds.host_owes_cents` and the same
on the contribution's refund lines, both 0 by default; `refunds.after_collection` (true when
the share had been sent at the moment the refund was asked for).

**Code:**
- `refundPayment`: after collection it is allowed when `decidedAs` is "admin" and a reason is
  given; refused otherwise with today's sentence. It is still refused while a bank dispute is
  open on the payment, and while a transfer of that share is under way (the same test
  `contributions/refund.ts` has: a started money action of the kind "transfer"). The request
  to Stripe is unchanged: with separate charges and transfers, a refund is paid from Connect's
  balance and no transfer is touched.
- `applyRefundDone`: with the payment locked, when the share was sent, writes
  `hostOwesCents` = her share before less her share after. The three lines of the books are
  written as today.
- `src/lib/contributions/refund.ts`: a line that is the founder's and after collection no
  longer books Connect's cost; it changes the share's split like any refund and writes
  `hostOwesCents`. `connectsOwn` stays in the table for the lines written before.
- `src/lib/disputes/takeback.ts`: the look that finds what is owed gets a second finder
  (refunds that are done, owe something, and have no row); the writing of a row takes the
  amount from the refund and the cap from Stripe's transfer, and decides "told" or "waiting"
  by decision 8; the words and the line in the books depend on the cause; "the bank decided
  the other way after all" stays for dispute rows only. Calling off writes `connect_cost` for
  a refund row. A new founder's action, "Start the 14 days", for a row that is "waiting".
- The telling: `takeback-words.ts` gets the words for a refund debt (owed, waiting, taken,
  called off, refused for 30 days), tested like the others.
- Pages: the founder's refund form and the search (decision 7); the founder's list of debts
  shows both kinds, with "Start the 14 days" and "Call it off"; the host's earnings page
  already lists what she owes (`debtsOfHost`) and now names the cause; a refund debt links to
  the call or the contribution, not to a dispute's page.
- The yearly statement (`src/lib/payments/statement.ts`): `host_takeback` lines get a column,
  "Taken back", and "Of that, paid by Connect" keeps meaning `connect_cost`.

**Checked by** a new script against Stripe's test mode, `scripts/owed-check.ts`, and tests of
the rules:
- a call paid, collected, then refunded in full by the founder: the customer's refund is real
  at Stripe; one debt row, for her share less nothing she did not get, told once however often
  the look runs; the three lines of the books; nothing taken a second before the 14 days; at
  them, the reversal is real at Stripe for that amount of that transfer; the line
  `host_takeback`;
- the same with half refunded, twice: two refunds, two rows, together never more than was
  sent;
- a share that carried the 25-cent charge: the debt is 25 cents less than the share;
- the refund is started and fails at Stripe: no row; started and still on its way: no row
  until it is done;
- the host's own button after collection: refused; the founder without a reason: refused;
  while a transfer of that share is under way: refused; while a dispute is open: refused;
- a host without a published Host Agreement at the time of the charge: the row says "waiting",
  nothing is taken at 14 days or ever; "Start the 14 days" makes it "told" and the days count
  from then; a host with one: "told" at once. (The check makes up a published version for its
  own run, as `agreements-check` does.)
- called off: never taken, and `connect_cost` is written once; a row being taken cannot be
  called off;
- a tip refunded after collection: the debt is the tip she received, not the payment fee; a
  contribution likewise; an old line with `connectsOwn` is left as it was;
- Stripe refuses the reversal: back to its notice, tried the next day; told to the founder
  after 30 days;
- a lost dispute and a refund on the same share: together never more than was sent;
- `disputes-check` (plan 47's own script) still passes unchanged.

### Part 3b: earnings not collected for 12 months

**Migration:** `collections.started_by` optional; `collections.started_as` ("host", "founder",
"helper"), filled for the rows there are.

**Code:** a daily helper job, in a loop that cannot hold up the money work; the finder of
decision 11; the collection itself is `acceptCollection` and `sendCollection` as the button
uses them; the email; a note on the row of the last try so that a refused try waits a week.

**Checked by** the script: a host whose last collection that went through is 12 months and a
day old is sent everything ready, once, with the charge, and told; one at 11 months is left;
one who never collected counts from her first ready earning; a refused collection does not
count as a collection and is tried again after a week, not before; a host whose payout account
is not ready is left and tried later; a closed account is not touched; two helpers at once
make one collection; her own button pressed in the same minute makes one collection.

### Part 3c: the 14-day button for a membership, and the sentence

**Code:** the founder's action and its page; the new way of ending; the sentence and its
version.

**Checked by** the membership check script, against Stripe's test mode: a membership joined 3
days ago with the money only held: the hold is let go and nothing is charged; taken, nothing
used: the whole month goes back to the card, the membership is ended, no renewal; taken, one
call of 30 minutes used: that call stays paid at the member price, the rest goes back, the
host's share of the call is untouched; a coming member call is cancelled and its time is part
of what goes back; joined 17 days ago: no button, and the action refuses; a dispute or a bank's
question open: refused; pressed twice: one pay-back; the member's and the host's emails name
the right amounts; the ticked sentence is the new one and carries the new version.

## Working beside the other sessions

- **Bank disputes (plan 47)** is fully merged. This plan changes its table and adds to its
  file `takeback.ts`. That session is told before part 3a starts, and its check script must
  still pass.
- **The phone apps (plan 45)** are paused before part 09b. Nothing here changes what the app's
  door sends. That session is told that a host's Messages page can now hold a notice about a
  refund debt.
- Migration numbers: whoever merges second renumbers, as before.

## Points for the lawyer (into `docs/for-the-lawyer.md` with each part)

- Is asking Stripe to reverse part of a transfer, after 14 days' written notice, covered by the
  Host Agreement's 9.4 as drafted, and by Stripe's own agreement with the host, in each country
  hosts are in? Should 9.4 name it?
- A refund Connect decides in the host's place (8.3) makes the host owe her share. Must the
  host be heard before the refund, not only before the taking?
- A debt from before the agreements are published: can it be taken at all, and after what
  notice?
- Sending earnings to a host who did not ask (7.7): is 12 months right, and what about the
  law on unclaimed property where it cannot be sent?
- The 14-day cancellation of a membership: is "time used is paid at the member price" right
  where the member did not expressly ask for the service to start? (The Payment Terms treat a
  booking as that request.)

## For the founder to decide (nothing here waits for it)

- **One rule or two for taking money back?** Under this plan a refund debt waits for you until
  the host holds a published Host Agreement (decision 8). A lost bank dispute's debt (plan 47)
  is taken after 14 days whatever she accepted. The builder would make both follow decision 8;
  it is not changed here because plan 47's rules were agreed with you in that session.
- Defaults A, B and C at the top.

## Not in this part

- Giving a member's time back after the host collected (`giveTimeBack` keeps refusing). It
  would need the same debt, for a share paid from a month; it can follow once 3a is in.
- A host paying a debt by card or bank transfer, and a "request to pay" (Host Agreement 9.4's
  second step).
- Charging a host the bank's dispute fee (9.2).
- Holding back a host's uncollected earnings against a debt. With plan 47's way a debt is
  taken from what was already sent; uncollected earnings are not touched.
- Closing your own account (plan 45, parts 19 to 19c).
