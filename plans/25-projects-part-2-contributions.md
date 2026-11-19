# Plan 25: Projects, part two: contributions

**Status:** 2a and 2b are built; what building them changed is at the end ("What building 2a added to this plan", "What building 2b added to this plan"). The plan itself: Written 18 November 2026 by the builder alone (no
helper agents), from the code as it is on `main` after pull request 41 and from plan 24, which
this part is built on top of. Astra checked it three times. First: "not ready as written"; it
agreed with the way the books are built and found nine must-fix points about refunds, the $1,000
rule, stopping and recovery. Second: "ready with changes", with four corrections before 2a and
one before 2b. Third: the four confirmed as right, and the one (choice 13) corrected once more.
Every point is worked in below (the lists are at the end).

**The rulebook is `plans/23-projects.md`.** This plan builds its part two ("The three parts"). It
states no rule of its own. Where it has to choose something the rulebook leaves open, the choice
is listed under "The builder's choices in this part".

## For the founder: what this part is

Part two is the money. When it is merged, a person can contribute to a host's project, once or
every month; each payment is first held on their card for three days and then taken; they can
cancel a held payment and stop a monthly contribution; the host sees her contributors, can let a
held payment go and refund a taken one, and collects her share with the same "Collect earnings"
button, after 7 days, or 30 for large amounts from one person; and everything that must stop a
contribution stops it. The box after a call comes in part three.

**Its size, said plainly:** this is the careful part. It touches the code that moves money for
calls and memberships in about a dozen named places.

**Two pull requests,** split the way memberships were:

1. **2a, the money of a contribution that exists.** The tables, and every function that moves
   money: writing a payment down, the hold, the taking, letting a hold go, the tries after a
   failure, a refund, a bank dispute, the host's share and its wait, ending a contribution's
   money (the state and its guards), the helper's jobs, and the watch that notices when the helper
   has stopped. No pages. A check script proves it against Stripe's test mode.
2. **2b, how a contribution starts and what people do with it.** The amounts a host suggests, the
   card step and the agreement, the monthly rhythm, the buttons that stop and end, the places
   outside that end a contribution (a block, a paused or closed account, the switch), the emails,
   and the pages for the contributor, the host and the founder. The check script is extended.

## What it relies on (each read in the code by the builder)

- **"Never twice."** Every action at Stripe is written down first under a fixed label, with its
  owner locked, and only one action can be under way for an owner (`src/lib/payments/operations.ts`:
  `startOwnedOperation` `:108`, `completeOwnedOperation` `:145`). An owner today is a payment or a
  membership month (`Owner`, `:47`; the selector `ownedBy`, `:51`; the ledger, `:218`); the
  database allows exactly one of the two. This protects one owner. It does not by itself keep an
  action on a contribution's payment and an action on its share's line apart.
- **Unfinished actions** are found by the helper and handed on by owner: a month's go to the
  membership code, everything else is treated as a payment's (`src/lib/payments/jobs.ts:113`). A
  second loop there finishes refunds of calls that Stripe had accepted (`:260`).
- **How a membership's money reaches a host.** The month owns the payment at Stripe. The host's
  share is written, at the moment it becomes hers, as a line in `payments` under the month:
  `member_call`, or `member_expired`, which has no call (`src/lib/membership/months.ts:126`).
  "A month's money reaches a host through the payments under it" (`operations.ts:27`).
- **"Collect earnings" works on lines in `payments` and nothing else.** It locks the host's
  settings line first (`src/lib/payments/collect.ts:131`), finds the host of a line through its
  call or its month's membership (`hostOfPayment`, `:106`; the candidates, `:158`), locks months,
  then calls, then payments (`:166`), judges each line (`heldBackNow`, `:49`), writes every
  transfer down, and records each in `collection_items`, whose payment is required.
- **A line in `payments` is shaped like a call:** the start and end of the stretch it pays for
  and a price per 15 minutes are required, and the database allows three kinds, each with its own
  shape (`payments_kind_shape`, `src/db/schema.ts:808`).
- **The way into the code that holds, charges or refunds a call's card** refuses any line that is
  not a card payment of a call (`cardPayment`, `src/lib/payments/own.ts:21`).
- **The fee:** `splitCharge` (`src/lib/payments/pricing.ts:91`) and, after refunds,
  `splitAfterRefunds` (`:106`), which shrinks the host's share and our fee in the same proportion.
- **The moment a share can be collected is already moved in one place today:** a refund request
  moves a call's lines later (`src/lib/refunds/requests.ts:224`). The comment on the column that
  says "never moved" is out of date and is corrected with this part.
- **A month's one payment at Stripe:** made once under a claim that is never reset, found again
  after an interruption (`src/lib/membership/charge.ts`, `intentFor` `:116`). When held money is
  taken: `holdTiming` (`src/lib/membership/rules.ts:109`). The tries after a failure: days 1, 3
  and 5, giving up after 7 (`:122`, `:124`). The card step: 30 minutes (`:141`).
- **Where a membership differs from what the rulebook asks for a contribution:** it places a new
  hold after a lost one (`charge.ts:395`); its taking can be asked for early (`:619`); its
  recovery can send a taking again up to 23 hours later (`src/lib/membership/recover.ts:44`); it
  stays unpaid when the card is gone (`charge.ts:263`); and when Stripe does not say when a hold
  ends, it assumes four days (`holdExpiry`, `src/lib/payments/rules.ts:105`).
- **Cards:** a saved card at Stripe belongs to one thing only, and everything that takes or
  removes one locks it first (`src/lib/membership/cards.ts:22`, `:37`, `:66`, `:82`).
- **Stripe's messages** are nudges: the app asks Stripe for the real state. A payment's message
  is passed on by the id written into the payment at Stripe (`src/lib/payments/stripe-events.ts:26`);
  a dispute is looked up by the payment's id at Stripe (`:57`).
- **Where memberships are ended from outside:** a block (`src/lib/safety/blocks.ts:31`), a paused
  account (`src/lib/safety/reports.ts:188`), a closed account (`src/lib/profiles/closing.ts:42`),
  a suspended host page (`src/lib/profiles/profiles.ts:200`). Each ends them inside its own step
  and cleans up the money after it. The founder's switch is only saved (`setSwitches`,
  `src/lib/safety/switches.ts:34`); nothing happens at that moment.
- **The watch on the helper** (`src/lib/health.ts:97`, `/api/health`). The helper records that
  the money work is alive only when the payment and membership jobs of a round finished
  (`worker/closer.ts:95`).

## The builder's choices in this part

| # | Question | Chosen | Why |
| --- | --- | --- | --- |
| 1 | How a contribution sits in the books | **In two layers, as a membership does.** A contribution's payment has a record of its own, which owns everything at Stripe. When the money is taken, the host's share is written as one line in `payments`, of a new kind "contribution", under that record. See "Why the books are built this way". | Astra, asked to judge this against a share kept in a table of its own: "In this codebase, I would choose the proposed two-layer design." The other way would mean widening the collector, its recovery and the earnings sums to a second kind of share. |
| 2 | The clock of the monthly day | UTC, at the minute of the first hold. | No clock change can move it. |
| 3 | How many contributions | One monthly contribution for each person and project, counted from the card step on. Any number of contributions made once, also beside a monthly one. | A second monthly one would be a mistake, not a wish. |
| 4 | Who cannot contribute | The host to her own project; someone paused; someone blocked by her or blocking her. And nobody can contribute to a host who is paused, whose page is not open, whom the switch does not cover, or who offers no kind of contribution. One function, `mayContribute`, answers this; starting a contribution, the "Contribute" part of the diary and part three's two boxes all ask it. | The same lines the rest of the app draws, and the same things that end a monthly contribution. A link that leads to a refusal should not be shown. |
| 5 | The amount | Typed in dollars and cents, from $5.00 to $100,000.00, US dollars only. | The rulebook's limits. |
| 6 | The card step | 30 minutes from pressing "Contribute", as for a membership. No hold in place by then: the contribution is undone and nothing is charged. Its lines stay, so that a hold that arrives late is recognised and let go. | One clear winner between "it ran out" and "they were just paying". |
| 7 | A refund after the share was sent to the host | Only the founder, and it is Connect's own money: nothing is taken back from the host. The books record it as Connect's cost, and the host's share stays what she really received. The page says so before the founder presses. | The rulebook says only the founder can. Lowering her share in the books would claim money came back that did not. |
| 8 | The founder is told | By email, once, when one person's contributions to a host cross $1,000 in 30 days. | The founder has the hold button; this says when to look. |
| 9 | The host is told | By email when someone starts contributing (once for a monthly one, not every month), and when a monthly one ends. | She should know without opening the page. |
| 10 | When Stripe does not say when a hold ends | Stripe is asked again. If it still does not say, the hold is let go and the payment goes to the founder's list. No date is assumed. | The rulebook: "always Stripe's own answer for that card, never a guess." |
| 11 | When the money counts as taken | At the moment Connect has Stripe's answer that it was taken: right after the taking, or, after an interruption, when the helper learns of it. The clock is read after Stripe has answered, never before the question was sent. That moment is kept and never changed. | Stripe keeps no field for the moment of a taking (Astra checked: a charge only says that it was taken). Connect's moment is the real one or later, never earlier, so no wait before collecting can come out too short; learning of a taking late only makes a wait longer. Astra's other idea, to fetch the time of Stripe's own message about the taking, was not taken: Stripe keeps those messages for 30 days only, and it would add a second way for the same fact to be wrong. |
| 12 | The last moment held money may be taken | One hour before the hold ends, by Stripe's own time for that card. From the planned moment until then, a late helper still takes the money. After it, the payment is given up as "not taken in time" and the hold is let go. | The rulebook says a hold whose safe moment was missed is never taken late; this is the number for "safe". One hour keeps a taking from racing the end of the hold. Added to the rulebook with this plan. |
| 13 | A month whose day passed while the switch did not cover the host | When the switch is saved so that it no longer covers a host, that step writes the moment on each of her running monthly contributions. When it is saved so that it covers her again, that step records as skipped every month whose day fell between that moment and now, and clears the moment. Hosts the switch covered all along are not touched, and neither is a month that fell due before the switch went off. | The rulebook: a month that passed while it was off is never charged afterwards, and only such a month. Done in the steps that change the switch, it works even if the helper was not running in between. (CodeRabbit found that the earlier wording would also have skipped a month that fell due before the switch went off.) |

## Why the books are built this way

The first draft of the rulebook wanted to write a whole contribution as one more kind of call
payment. Astra showed that this does not work: such a line would have to hold, charge and refund a
card through code that only accepts a call's card payment. Reading the collector showed the other
half: the one thing that should not be built a second time is "Collect earnings". It has its own
locks, order and recovery, and it works on lines in `payments`.

Memberships met the same question and answered it in two layers. This plan uses the same two:

| Layer | For a membership | For a contribution |
| --- | --- | --- |
| The record that owns the money at Stripe | the month | the contribution's payment (new) |
| The line that is the host's share | a line in `payments` under the month | a line in `payments` under the contribution's payment (new kind) |

**What the share's line holds.** The database enforces all of it for the new kind, so no code can
write anything else:

- no call, no month, no request for more time; the contribution's payment set;
- the stretch it pays for: the moment the money was taken, as its start and its end;
- the price per 15 minutes: zero, which is true, since a contribution has none;
- the amount booked and the amount charged: what the contributor paid, before our fee;
- the fee terms, our fee and her share as they were at the taking, the currency, the moment taken,
  and the id of the charge at Stripe, which a transfer names as its source;
- no PaymentIntent: that stays on the contribution's payment alone.

**Where each sum is written, once.** What the contributor paid, and what went back to their card:
in the ledger under the contribution's payment. Our fee, her share, a transfer and the collection
charge: under the share's line, as for every other share.

## The tables (2a)

**`contributions`:** the project, the host, the contributor, once or monthly, the amount, and
where it stands: `card_step`, `running`, `ended`. For a monthly one: the moment of the first hold
(the monthly day), which month's payment was written down last, which months were skipped, the
moment the switch stopped covering its host (choice 13), and how and when it ended. The
database allows one monthly contribution that is not ended for each person and project, and one
contribution for each request (see `startContribution`).

**`contribution_agreements`:** what the contributor agreed to, written at the moment they sent
the form with the box ticked: the wording's version, the amount, once or monthly, and when. Lines
are only ever added.

**`contribution_cards`:** the card saved for a monthly contribution, as `membership_cards` is for a
membership: one in use, retired when the contribution ends, removed at Stripe when no payment of
the contribution is still open and no action is under way. The line stays after that, so the card
is always known to have been a contribution's.

**`contribution_payments`:** one line for each payment, the one made once and each month's. It
owns everything at Stripe. It holds:

- which contribution, the number of its month, and a key that makes each payment exist once;
- the amount, and the fee terms as they were when it was written down;
- the claim for its one payment at Stripe, that payment's id, and the charge's id;
- where it stands (the table below), and why it ended if it did;
- the bank's time for the hold; when the hold ends; when the money is to be taken; **the last
  moment it may still be taken**; when Stripe booked it; and what was really taken;
- the tries: which one, when the first failed, when the next is, when it is given up, and whether
  the bank wants the contributor to confirm;
- **the 30-day mark** of the $1,000 rule, set while the payment is still only held;
- what has been refunded; the state of a dispute (`none`, `open`, `won`, `lost`);
- the founder's hold on the share, or release, with who, when and why;
- a problem for the founder's list, if Stripe showed something the code does not decide.

| State | Meaning |
| --- | --- |
| `to_pay` | Written down. No hold yet. |
| `held` | The hold is in place. The contributor, the host or the founder can let it go. |
| `taken` | The money has been taken. The host's share is written. |
| `given_up` | Ended without money: cancelled while held, the card step ran out, 7 days without a hold, the hold was lost, the contribution ended, or the switch. The reason is kept. |

**`contribution_refunds`:** one line for each sum that is owed back to a contributor's card: a
refund the host or the founder decided, and the full refund owed when a cancellation lost the
race with the taking. Each has a key that makes it exist once, the amount, who decided and why,
whether it is Connect's own money (choice 7), where it stands (`owed`, `at_stripe`, `done`), which
try it is, and Stripe's id for it. Writing the line is what makes the money owed; sending it is
the helper's work and is repeated until it is done. The table of refunds for calls is not used
for contributions, so the code that finishes a call's refund never meets one.

**Changes to existing tables:**

- `money_operations` and `ledger_entries`: a third possible owner, the contribution's payment. The
  database's rule becomes "exactly one of the three", and "one action under way" holds for the
  new owner too.
- `payments`: a column for the contribution's payment, the new kind "contribution" with the shape
  above, and one share line at most for each contribution's payment.
- `projects`: the host's suggested amounts, up to three for each kind (2b). A kind for which she
  suggests no amount is not offered, as the rulebook says.

## The library: `src/lib/contributions/`

**`rules.ts`: plain rules, no database, tested.**

- The limits, and reading a typed amount.
- `monthlyDue(firstHold, n)`: the day of payment number n, counted from the first hold each time
  (31 January, 28 February, 31 March).
- `waitFor(...)`: the $1,000 rule, exactly as the rulebook's "How the $1,000 is counted" says it,
  as one function. It takes the pair's payments (what was paid before our fee, held or taken and
  when, refunded or not, collected or not) and gives back which of them carry the 30 days.
- `mayTake(payment, now)`: may this held money be taken now? Not before its planned moment, not
  after its last moment (choice 12), not once it was given up.
- The words of the agreement, with their version.

**`locks.ts`: the order of locks.** The app already has one order, written down in
`src/lib/membership/locks.ts`: the host's calendar; person and host-page lines; the host's
collection line; the membership; the month; then calls, lines in `payments`, and request and
refund records. That order stays exactly as it is. Contributions add their locks in three places:

| Existing order | Added |
| --- | --- |
| 1. the host's calendar | |
| 2. person and host-page lines | |
| 3. the host's collection line | then **the project** |
| 4. the membership | |
| 5. the month | then **the pair** (contributor and host), **the contribution**, **the contribution's payment** |
| 6. calls, lines in `payments`, request and refund records | (a contribution's refund lines belong here) |

A step takes only the locks it needs, never an earlier one after a later one, and all lines of
one kind, sorted, before the next kind. The lock on a card itself (the one `cards.ts` takes when
a card is taken or removed) comes last, as it does for a membership; marking a card's line as
retired needs only the contribution's lock.

"Collect earnings" takes 3, 5 and 6 today and gains the pair, the contribution and its payment
after 5. Ending a project takes the project and then those three. Closing or pausing an account
takes 2, then memberships as today, then those three. Starting a contribution takes the two
people's lines and reads them again (so closing or pausing an account cannot miss a contribution
that starts at the same moment), then the project (so it cannot end underneath), and then those
three. This is a small addition to the existing
order, not a new one, and nothing that exists is reordered.

**`charge.ts`** (2a). It uses the membership file's ways of working. As code it shares only the
small parts that fit without change: the fee sums, the written-down steps of `operations.ts`,
`holdTiming`, the days of the tries, the 30 minutes, the small calls to Stripe (take, cancel,
confirm with a saved card) and the lock on a card. The rest is written for contributions, because
the rules differ (see the list under "What it relies on"):

- `writeDownPayment`: a payment exists once (its key), before anything is asked of Stripe.
- `intentFor`: the payment's one PaymentIntent, with the same four cases as a month's: saved;
  claimed now; claimed and asked again under the same label; claimed too long ago, so Stripe's
  list is read. It is made to be held first and taken later. For the first payment of a monthly
  contribution it also saves the card for later; later months confirm with the saved card. The
  contribution payment's id is written into it under a name of its own, so Stripe's messages
  find their way and are never mistaken for a call's or a month's.
- `syncPayment`: reads Stripe and records what it shows. Every path ends here.
  - A hold in place: the bank's time, when the hold ends (choice 10), when the money is to be
    taken (`holdTiming`), and the last moment it may be taken. Then the $1,000 rule (below).
  - The bank wants the contributor to confirm, in either of the two ways Stripe says so: not a
    hold. The contributor is emailed the link, which opens this same payment.
  - A hold that has gone: `given_up`, "the hold was lost". Nothing is tried again for it, and a
    monthly contribution goes on with its next month.
  - The card is gone, or the bank says never to try again: the monthly contribution ends.
- `tryHold`: one try with the saved card, for a monthly payment after the first. The 7 days count
  days without a hold in place: a hold that succeeds on day six is taken three days later.
- `takePayment`: takes the held money. It asks `mayTake` with the clock read at that moment,
  right before Stripe is asked, so nothing is taken early, late, or after a stop. In the same
  step as recording the taking it writes the share's line (`splitCharge`) with its wait.
- `giveUp` and `letGo`: `giveUp` records, in one step, that a payment is ended and why; from that
  moment nothing new is asked of Stripe for it except letting it go. `letGo` cancels it at Stripe.
  If the money turns out to have been taken at that very moment, the payment is `taken`, and a
  line in `contribution_refunds` for the full amount is written in the same step.
- `refund.ts`: writes a line in `contribution_refunds`; the helper sends it as one action owned
  by the contribution's payment. The check against a transfer (below) is made at the moment the
  line is written, with both owners locked, and lines that are owed already count against what
  can still be refunded, so two requests cannot promise more than is there. Before the share is
  sent: on success the share's line is lowered by the same sum, so `splitAfterRefunds` shrinks her
  share and our fee together. After it (choice 7): the share's line is not touched; the ledger
  records the refund once under the contribution's payment, and beside it one line of its own
  kind for Connect's cost. A refund Stripe refuses is tried again at growing intervals and shown
  on the founder's list. It is never dropped: while money is owed, the share stays held back.
- `recover.ts`: what the helper does with an action of a contribution's payment whose outcome is
  not known. It always finds out what became of that action, also for a payment that was given up
  meanwhile: a taking that went through is recorded (and refunded if it should not have
  happened), and a hold that is still there is let go. What it never does is send a taking again
  once `mayTake` says no, or start anything new for a payment that was given up.

**`dispute.ts`** (2a): asks Stripe where every dispute over the payment stands and records the
worst: open or lost before won. Open or lost: the share cannot be collected or refunded, and a
monthly contribution ends. Won: the share can be collected again; the contribution stays ended.

**`ending.ts`** (2a: the state and its guards; 2b: the buttons and the hooks). One function ends
contributions, for one, for a project, for a pair, or for an account: in one step it marks the
monthly contribution ended and gives up every payment that is not taken, one made once included.
Letting the holds go at Stripe comes right after, and the helper repeats it until it is done.
`endProject` from part one calls it in its own step.

**`start.ts`, `monthly.ts`** (2b):

- The page that shows the form makes only a request's id. `startContribution` runs when the form
  is sent: it checks who may contribute (choice 4), the project, the switch, the kinds the host
  takes and the amount; and writes the agreement, the contribution in `card_step` and its first
  payment in one step. The request's id makes the same press, sent twice, one contribution, also
  for one made once.
- `stopContribution` (the contributor) and `skipPayment` (the host or the founder lets one
  month's hold go; the contribution goes on).
- `writeDuePayments`: the helper's job that writes down each running monthly contribution's next
  payment when its day has come and tries the card. The contribution remembers which month it
  wrote last, so a month that passed while the switch was off, was skipped or was given up is
  never made up for.

**`emails.ts`** (2b): the agreement's confirmation; the email for each payment at its hold, which
is the receipt; a payment that failed or needs confirming; "nothing was charged"; a refund; the
monthly contribution ended and why; the project ended; to the host, a new contributor and one
that ended; to the founder, the $1,000 notice. Contributions have their own emails; the ones for
a call's refund look for a call and would send nothing.

## A refund and a collection never meet

A refund is an action on the contribution's payment; a transfer is an action on the share's line.
The database's "one action at a time" would let both run. So each looks at the other, with the
locks of both held, and what it finds is something written down, which stays true after the locks
are let go and Stripe is still answering:

- **Collecting** leaves out a share whose contribution payment has an action under way, or any
  line in `contribution_refunds` that is not `done`.
- **Refunding from the share** is refused while a transfer of that share is written down and not
  finished. If the transfer goes through, only the founder's refund (choice 7) is left. If Stripe
  refuses it, the host can refund as before.

## The $1,000 rule in the code

`waitFor` is plain and tested. It is applied with the pair locked, at the three moments the
rulebook names:

1. **A hold is accepted** (`syncPayment`). If the pair is over the line now, the 30-day mark is
   set on every payment of the pair that is held, this one included, and the 30 days are written
   on every share line of the pair that has not been sent, each counted from its own taking. The
   mark stays on a held payment whatever happens to the others afterwards.
2. **The money is taken** (`takePayment`). The new share's line gets 30 days if its payment
   carries the mark or the pair is over the line now, and 7 otherwise.
3. **The host collects.** With the pairs of her contribution shares locked, the collector first
   makes sure no payment of those pairs has an outcome that is not known (such a pair's shares
   wait), then counts again and writes any 30 days that are due, and only then judges what is
   ready.

A share whose transfer is written down and not finished keeps its transfer exactly as it is, and
still gets the later date: if Stripe refuses that transfer, the share is not ready again under
its old date.

What is counted is what the rulebook says: what was paid before our fee, taken within the last 30
days (also if refunded or collected since), plus holds in place, each payment once, over all her
projects and whatever card. A wait never gets shorter by itself. A payment the founder has
released stays released: `waitFor` is told, and counting again does not put its 30 days back.

The founder's hold and release are two more functions on the same lines, each with a reason that
is kept. A release shortens a wait or lifts the founder's own hold. It never lifts a dispute, an
action under way, or a refund that is owed.

## What changes in existing code (2a), each a named place

| Place | Change |
| --- | --- |
| `operations.ts`: `Owner`, `ownedBy`, `addLedgerEntry` | They know the third owner. |
| `jobs.ts:113`, where unfinished actions are handed on | By owner: a payment's, a month's, or a contribution payment's. Today "not a payment's" is taken to mean "a month's"; that becomes a question with three answers. |
| `collect.ts`: `hostOfPayment`, the candidates, `unsentEarnings` | One more way to find the host: through the contribution. |
| `collect.ts`: the order of locks | Pairs, contributions and contribution payments, in their places (see `locks.ts`). |
| `collect.ts`: before judging | The $1,000 count for the pairs of her contribution shares (step 3 above). |
| `collect.ts`: `heldBackNow` | A contribution's share is held back while its payment's dispute is open or lost, the founder holds it, an action of its payment is under way, or a refund of it is owed. |
| `collect.ts`: the transfer's group | A contribution's share is grouped under its contribution's payment. Today both choices there would be empty for it. |
| `collect.ts`: `Earning`; `src/app/host/earnings.tsx:20` and `:64` | A share can be a contribution's. Today every share without a call is called "Expired member time"; the page tells the kinds apart, and says when the founder is holding a share. |
| `src/app/admin/page.tsx:307` | The table "All payments" lists calls only; it is named "Call payments". Contributions are on `/admin/projects`. |
| `stripe-events.ts:26`, `:57` | A payment's message carrying a contribution payment's id goes to `syncPayment`; a dispute is also looked up among contribution payments. |
| `membership/cards.ts`: `takeCardForMembership`, `bookingCardSeen`, `bookingMayRemoveCard` | A card that is or was a contribution's is refused, under the same lock on the card; and a contribution refuses a card that is or was a booking's or a membership's. |
| `health.ts`; `worker/closer.ts:95` | See "The watch". |
| `schema.ts`, the comment on when a share can be collected | Corrected: it can move later, and for a contribution sooner by the founder's release. |

These stay as they are, because the share's line gives them what they read: `currentSplit`,
`collectionAmounts`, `transferSteps`, `applyTransferSent`, `settleEmptyShare`, and the part of the
helper that finishes transfers. The code for a call (holding and charging its card, its refunds
and their emails, taking its money, refund requests, the page after a call) and the six places of
a membership's month never meet a contribution's line: each of them reaches `payments` through a
call, a month or a request for more time, and the new kind has none of the three.

## The helper's jobs (`runContributionJobs`), in order

1. **Stops first.** Payments that were given up and whose hold is not let go yet; and, for every
   host the switch does not cover, giving up what is only held.
2. Payments whose PaymentIntent was asked for and never saved.
3. Card steps that ran out without a hold. Stripe is asked first: a hold that arrived in time
   counts.
4. Payments to look at again, also when no message from Stripe came.
5. Held money whose moment has come.
6. Tries with the saved card, on their days.
7. Giving up after 7 days without a hold. Stripe is asked first.
8. Monthly payments that are due (2b).
9. Refunds that are owed.
10. Disputes still open (asked once an hour), and retired cards.

Every job is safe to run again, and one payment going wrong never stops the others.

**What a stop forbids, and what it does not.** Once a payment is given up, or the switch does not
cover its host, nothing new is started for it: no hold is placed (jobs 2, 6 and 8) and no money
is taken (job 5). Each of those jobs checks this for itself, right before it acts. Everything
that only finishes or tidies goes on regardless, also for a given-up payment and with the switch
off: looking at Stripe, letting a hold go, recording a taking that had already happened,
refunds, disputes, and removing cards.

**The switch** (2b): saving it to "off", or taking a host off the list, also gives up, in the
same step, every payment of the hosts it no longer covers that is not taken: one that is held,
one whose card failed and is waiting for its next try, one waiting for the bank's confirmation,
and one whose hold was just asked for. The monthly contributions themselves stay. So turning the
switch off and on again quickly cannot bring an old payment back. Saving the switch and writing a
new payment down wait for each other (one small lock, taken before any other), so a payment that
is being written at that very moment cannot slip past the step that gives up. The helper's first job is the
net behind that step, and choice 13 covers the months whose day passed meanwhile.

## The watch

The answer at `/api/health` is "not healthy" also when, for a contribution:

- held money is more than five minutes past its moment and nothing is under way for it;
- a PaymentIntent was asked for more than ten minutes ago and its id was never saved;
- a payment that was given up still has its hold after ten minutes;
- a refund has been owed for more than ten minutes with nothing under way (a refund Stripe has
  accepted and not finished, or one Stripe refused and that waits for its next try, is not this).

The check that exists today, for any action written down and not answered, covers a
contribution's actions too. And the helper records that the money work is alive only when the contribution jobs of the round
finished too.

## The pages (2b)

| Page | What is new |
| --- | --- |
| `/host/project` | The suggested amounts (a kind left empty is not offered). Her contributors: name, once or monthly, amount, since when; for each payment its state, "Let it go" while held, "Refund" once taken and until her share is sent. The total received and what is ready to collect. |
| Hosting, "Earnings" | A contribution's share appears with the others, with when it can be collected and why not yet. |
| `/h/[handle]/project` | A "Contribute" part: once or monthly (the kinds she takes), her suggested amounts, a box for another amount. Not shown for her own project, to someone blocked, or when the project has ended. |
| `/contributions/new` | The summary before paying, with every sentence the rulebook asks for, and for a monthly one the tick box. |
| `/contributions/[id]` | The card step (Stripe's form, as memberships use it, asking a contribution's own address to look at Stripe afterwards). After that, the contributor's page for this contribution: each payment with its state and its real last moment, "Cancel, nothing is charged" while held, "Stop contributing", and "Pay now" when the bank wants a confirmation or a payment failed. |
| "Your account" | "Projects you support": each with its state and a link. |
| `/admin/projects` | For each project what it has received. Contributions over the $1,000 line. "Hold back" and "Release", each with a reason. "Refund" as the founder, with the sentence from choice 7. Payments with a problem. |
| The terms and the privacy page | What the rulebook's launch list names. |

**Starting never happens by loading a page.** A page reads; only a pressed button writes a
contribution or a payment, or asks Stripe for a payment. That is the app's standing rule, and the
check script proves it by the same search the membership check uses.

**Nothing is claimed before it is known.** "Nothing was charged" is said only after Stripe has
confirmed that the hold is gone. Until then: "We are cancelling this payment."

## How it is checked

- **Tests of the plain rules:** the amounts; `monthlyDue` over the short months and a leap year;
  `mayTake` at each edge; `waitFor` with every case of the rulebook's list (two payments made
  together, held money counted, a refund not resetting, exactly $1,000, earlier payments not yet
  sent, sent money left alone, never shortening by itself, crossing the line while held and the
  other hold then cancelled).
- **`scripts/contribution-check.ts`**, against the local database and Stripe's test mode, with a
  pretended clock, as the membership checks do. In 2a it drives the functions directly; 2b adds
  starting, the monthly rhythm, the hooks and the emails.
  - a contribution made once, from the hold to the host's collection: the taking, the share, the
    7 days, the transfer, the ledger adding up to the cent;
  - one collection holding a call's share, a member's and a contribution's together;
  - cancelling while held, and the race with the taking (taken, a full refund owed and made);
  - a card that fails and then works on a later try; 7 days without a hold; a hold on day six
    taken on day nine; a bank that wants a confirmation, in both ways Stripe says so; a hold that
    is lost; Stripe not saying when a hold ends;
  - every interruption: after writing down and before Stripe, after Stripe and before recording,
    for the hold, the taking, letting go and a refund, each finished by the helper without a
    second charge; and recovery after a stop and after the last moment, where nothing may be
    taken;
  - refunds: in part and in full before the share is sent; a refund against a transfer that is
    written down; the founder's refund after it, with the books showing Connect's cost; a refund
    Stripe refuses, tried again;
  - a dispute opened, won and lost, two at once, and what each does;
  - the $1,000 rule: payments sent at the same moment; crossing while held; the count at the
    moment of collecting; a transfer that fails after the line was crossed; the founder's hold
    and release;
  - every way a contribution ends, with a payment held at that moment, one made once included;
    the switch turned off and on again;
  - cards: a contribution's card is never taken by a membership or a booking, and is removed
    when nothing needs it;
  - who can reach what: every action checks the person and that the contribution, project or
    payment is theirs;
  - the watch: each of its four cases makes the answer "not healthy".
- **All fifteen earlier check scripts still pass,** above all the payment, refund and membership
  ones, since `operations.ts`, `jobs.ts` and `collect.ts` are touched.
- **In the browser** (2b): contributing once and monthly with Stripe's test cards, including one
  that asks for the bank's confirmation; cancelling; stopping; the host's and the founder's pages.
- Astra reviews each of the two pull requests, as many rounds as needed, then CodeRabbit.

## Done when

- Every rule of the rulebook's "How it works for a contributor", "What ends a monthly
  contribution" and "The money" holds, and the check script shows it.
- The money record adds up to the cent for every journey the script walks.
- No journey charges a card twice, starts a taking after a stop, or lets a host collect a share
  that is held back. A taking that was already under way when a stop arrived is recorded and
  refunded in full.
- All earlier check scripts pass unchanged.

## Astra's check (18 November 2026): "not ready as written"

Astra agreed with the two layers, after reading the collector in full and every query over
`payments`. It named the places a contribution's line would meet (all in the table above) and
those it never meets. Its must-fix points:

| # | Astra's point | What was done |
| --- | --- | --- |
| 1 | A refund and a transfer have different owners, so "one action at a time" does not keep them apart; and a lock is gone before Stripe answers. | Taken: "A refund and a collection never meet". |
| 2 | "A full refund is owed" needs a lasting record, or a crash loses it. Reusing the table of call refunds would send contributions through the code for calls. | Taken: `contribution_refunds`. A refund after the share was sent is recorded as Connect's cost, and her share is not lowered. |
| 3 | The $1,000 rule had three gaps: no lasting mark on a held payment, no count at the moment of collecting, and a written-down transfer treated as sent money. | Taken: "The $1,000 rule in the code". |
| 4 | The order of locks was only local; with closing an account, ending a project and collecting, it could run both ways. | Taken: the full order in `locks.ts`. |
| 5 | The membership's code cannot be copied: it replaces a lost hold, takes early, repeats a taking for 23 hours, and stays unpaid when the card is gone. | Taken: what is shared as code and what is written anew; `mayTake` and the last moment. |
| 6 | The membership's code guesses four days when Stripe does not say when a hold ends; and the moment of taking must be Stripe's, also after an interruption. | Taken: choices 10 and 11. |
| 7 | Stops and the switch must come before new money work, and the switch itself does nothing when saved. A stop cannot promise that no taking ever lands after it. | Taken: the helper's first job, the switch's own step, the guards in every job, and "Done when". The state and guards of ending moved to 2a. |
| 8 | The agreement was written when the form was shown, before anyone agreed; two presses could make two contributions. | Taken: only the request's id at the form; everything written at sending; one contribution per request. |
| 9 | The watch missed unfinished work, and the helper could report "alive" while contribution jobs failed. | Taken: "The watch". |

Details Astra left to the building, all noted above where they belong: reading every dispute of a
payment and recording the worst; the three card functions; remembering which month was written
last; the kinds a host takes when she suggests no amounts; the extra journeys in the check script.

Cut, as Astra asked: the sentences "three small changes" and "nothing else in the payment code
changes". The changes are a dozen named places, and the table says which.

## Astra's second look (18 November 2026): "ready with changes"

Of its nine points Astra called five solved, three partly solved and one still open. What was
left, all taken except one idea:

| Astra's point | What was done |
| --- | --- |
| The order of locks contradicted the one the app already has (the calendar comes first, and more than the collector takes the host's collection line). | The existing order is kept exactly, and contributions are added to it in three places. |
| A guard on every job would have stopped refunds, disputes and tidying while the switch is off; finding out what became of an action must work also after a payment was given up. | "What a stop forbids, and what it does not"; `recover.ts`. |
| "The last moment money may be taken" had no number. | Choice 12: one hour before the hold ends. Added to the rulebook. |
| Stripe has no field for the moment of a taking. | Choice 11: Connect's own moment of learning it, which is never earlier than the real one. Astra's idea of fetching the time of Stripe's message was not taken (kept only 30 days, and a second way to be wrong). |
| Giving up only held payments at the switch leaves failed tries and confirmations able to come back; "the last month written" cannot see an off-and-on while the helper was not running. | The switch gives up every payment that is not taken; choice 13. |

Details Astra left to the building, noted above where they belong: refund lines that are owed
count against what is refundable; a refused refund is retried and shown, never dropped; the
ledger line for Connect's cost; the founder's release told to `waitFor`; the watch telling "owed
and idle" from "at Stripe".

## Astra's third look (18 November 2026)

Astra confirmed the order of locks, the stops, choice 12 and choice 11 as right, with two notes
taken: the clock for a taking is read after Stripe's answer, and starting a contribution takes
the two people's lines first. It found choice 13 still wrong: a time kept for the whole switch
would also have skipped months of hosts who were covered all along, and many of them if the
helper had been down. Choice 13 now works host by host, in the step that changes the switch, and
writing a payment and saving the switch wait for each other.

## What building 2a added to this plan (18 and 19 November 2026)

Found while building, by the check script against Stripe's test mode, and in Astra's reviews of
the code. All of it is built.

- **One clock for money, always read when it is needed.** The helper hands every job the moment
  its round began, which can be minutes old by the time a payment's turn comes. So everything that
  decides about a taking, or writes down when money was taken, uses the later of that moment and
  the real clock, read at that instant (`freshNow`). Before a taking the clock is looked at three
  times: before anything is written down, with the payment locked, and once more as the very last
  thing before Stripe is asked. If the last moment has passed by then, nothing is sent, the
  action is recorded like a refusal, and the payment is given up and its hold let go.
- **The count at the moment of collecting is kept.** It was first written inside the collection's
  own step, so when that press ended with "nothing to collect" the later dates were lost with it.
  A press now counts in steps of its own first, and again under its locks before it judges.
- **The pair waits while a result is not recorded.** A try with the saved card that Stripe
  accepted, and whose result is not written on the payment yet, makes the pair's shares wait,
  like an action whose outcome is not known. The earnings list uses the same test as a
  collection, so it never shows as ready what a press would refuse.
- **Recovery asks the switch.** Before the helper sends a hold or a taking again after an
  interruption, it asks whether the founder's switch still covers the host. If not, it only
  finds out what happened.
- **A release while held is kept to.** A payment the founder released while it was only held
  waits the usual 7 days once taken, mark or not.
- **A hold past its last moment** is given up at once by whoever notices (recovery, or a job of
  its own), without waiting out the hour the helper leaves after a refused taking.
- **After a stop** (the payment given up, or the switch off) a payment that was asked for and
  never saved is not asked for again: Stripe is only asked what was made, and that is cancelled,
  also when it arrives after the payment was written off. Three things make that hold when the
  app stops at a bad instant. The moment of every asking, the first and each repeat, is written
  on the payment first, with the payment locked (`intent_asked_at`, migration 0035). When
  Stripe's list shows none, that is believed only 8 minutes after the last asking (a request can
  be on its way for about four); until then the helper keeps asking. And a payment that was
  already written off when its PaymentIntent turns up is made "being given up" again in the same
  step that saves the id, so the usual written-down letting-go cancels it and the helper repeats
  that until Stripe has answered.
- **A contribution made once is marked ended when its money is taken** ("paid"), or with its
  payment when that is given up. "Running" then always means that something can still happen.
- **A taking that was not to be** (after a cancellation, or of a wrong amount) writes no share
  for the host: all of it is owed back, or the founder settles it.
- **The database's own word** about a share's line was made as strong as the plan says (the
  moment, both parts of the split adding up, the charge it comes from), and a taken payment must
  say how much was taken.
- **From CodeRabbit's review and Astra's review of it.** Every taking is counted for the pair,
  with the amount Stripe really took, also one that is paid back in full. A hold whose end Stripe
  does not say never changes the contribution's card. Right before a taking is sent, the payment
  is read once more: a stop that came since wins, and Stripe is not asked. "Not sent" is only
  recorded while the helper cannot have sent the action itself (the first 30 seconds); after
  that the action stays unanswered and the helper finds out. An answer about a dispute is only
  recorded if no other answer was recorded since it was asked for (`dispute_version`, migration
  0036). Before a collection counts, Stripe is asked about every payment of her contributors
  that may just have been paid; if it cannot be asked, that person's shares wait for that
  collection. A payment Stripe does not know at all gets a problem, for the founder.
- **Names.** The plan's `giveUp` and `letGo` are as written. The $1,000 rule is applied by
  `countPair` in `charge.ts`. The founder's hold and release are `holdBack` and `release` in
  `founder.ts`. The test people of `scripts/contribution-check.ts` have ids starting "ctb-".

**Not done in 2a, and where it goes.** The email to the founder when a pair crosses $1,000 comes
with the other emails in 2b. The check script collects contribution shares only: one collection
holding a call's share, a member's and a contribution's together is not walked yet.

## What building 2b added to this plan (19 November 2026)

Found while building, by the check script, by a security check that runs on every saved change,
and in Astra's reviews of the code. All of it is built.

- **A month that comes late.** The plan did not say what happens when the helper was down on a
  month's day. Built: a month's payment is still written, and still tried, up to 7 days after its
  day. After that the month is missed: it is recorded as skipped, never charged, and the
  contribution goes on with the next month. This holds whether or not the payment had already
  been written down. A payment that was tried and failed has its own 7 days, counted from that
  failure, as the rulebook says; so a first try made 6 days late that fails can still be paid by
  hand for 7 days after it. The rule is one function (`monthMissed`), asked on every way to a
  first hold: the helper's try, paying by hand, and a hold that arrives, which is judged by the
  bank's own time for it. A try that was started is never treated as "nobody tried"; and before a
  month is given up as missed, Stripe is asked once more, so a hold placed by hand in time is not
  lost to a look that was made too early.
- **Asked again before anything new.** Before the helper writes a month or tries a saved card,
  and before a payment is made ready to be paid by hand, the app asks again whether the two
  people may still deal with each other (no block, neither account paused or closed, the host's
  page not suspended, the project running). The steps that cause these end the contributions
  themselves; this is the net behind them.
- **Starting takes one more lock,** the host page's line, so that a suspension of her page cannot
  miss a contribution that starts at the same moment; and it asks about a block once more with
  the pair's lock held, because a block does not touch the two people's lines.
- **The switch's step** reads each contribution again under its lock and judges it as it stands
  then (one whose first hold was being accepted at that moment is marked too), and takes its
  moment once its locks are held, not when the founder pressed. A month the switch skipped is
  never written, also when its day was only just before the switch came back on. A month that
  fell due before the switch went off is left to the rule for a late month.
- **"Nothing was charged" is said in one place only:** where a payment's hold is certainly gone
  (`markGivenUp` in `charge.ts`). The sentence that says why a contribution ended says nothing
  about money. A hold that arrived too late to be accepted is still kept as a hold that was
  there, so its contributor is told when it has been let go. The same goes for a hold the app had
  not heard of when its payment was cancelled: Stripe's answer to the cancellation says whether a
  hold was in place (`cancelAtStripe` now gives that back), so nobody has to have seen it first.
- **Cancelling one payment of a monthly contribution** by the contributor skips that month, as
  it does when the host or the founder lets it go; "Stop contributing" is the button that ends
  it. At the card step, and for a contribution made once, cancelling ends the contribution.
- **The founder's page** has, beside the list of payments that need a look, every payment of
  each project, page by page: that is how an ordinary payment is reached, to refund it after the
  host has collected. A payment taken before the $1,000 line was crossed, whose share then waits
  30 days, carries the mark too and is on the list.
- **The founder's $1,000 email** is sent once for each crossing, at the payment that crosses the
  line: a hold that was just accepted (or money taken that was never held) with which the pair is
  over $1,000 and without which it is not. The count only goes up when a payment enters it, so
  that is the one moment a crossing can happen. Crossing again later is told again.
- **When a project ends,** everyone whose money it has taken is told by email, each once; a
  monthly contributor gets the email about their contribution ending instead.
- **The terms page** is still the placeholder that says a lawyer will write it. One paragraph
  about contributions was added to the privacy page.
- **Names.** `whyNotContribute` is the plan's `mayContribute`. `letPaymentGo` is the plan's
  `skipPayment`, for all three people. The switch's step is `saveProjectsSwitch` in `switch.ts`.

