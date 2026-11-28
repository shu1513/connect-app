# Plan 20: Memberships, part one: the money

**Status:** both halves are built. Where the code differs from this plan is written at the end, for 1a and for 1b. Written 17 November 2026 by the builder alone (no
helper agents), from the code as it is on `main` after pull request 32. Astra has checked it three times: "not ready" twice, then "ready with
changes", with the changes small enough to make while building. Every point of all three checks
is worked in below (the lists are at the end).

**The rulebook is `plans/19-memberships.md`.** This plan builds its part one ("The three parts",
"Part one: the money, complete"). It states no rule of its own: every decision about money or
about what a member or host gets is the rulebook's, named by section. What this plan adds is how:
files, tables, the order of steps, what is written down before Stripe is asked, and how each
interrupted step is finished. If a rule turns out to be wrong or missing, the rulebook is changed
and checked first.

## For the founder: what this part is

Part one builds everything about memberships that is not a call and not a page: a month's
payment and its books, paying back, the end of a month, renewals, disputes, a host collecting
expired money, and a membership's whole life from the invitation to its end. The founder's switch
stays **off**. Nobody can see or buy anything; a check script plays the host and the member
against Stripe's test area.

**It is built as two pull requests:**

1. **1a, the money of a membership that exists, and its safety.** Given a membership, every month
   of it: the hold, the taking, tries after a failure, giving up, a renewal, the end of a month,
   paying back, a dispute, the host collecting, pausing and ending. And every place in the app as
   it is today that must know a membership exists: closing or pausing an account, a block, a
   suspension, the regular price, and weekly hours.
2. **1b, how a membership comes to exist and what people do with it.** The host's membership,
   invitations, joining, cancelling, "Cancel now", switching back on, resuming, an offer of less
   time, the price that only goes down, and the host's choices at a cut in hours.

1a is mergeable alone: a membership put into the database by the check script is safe against
everything the app can already do. Part one counts as done when both are merged and every "Done
when" of the rulebook's part one is proven.

## What is in, and what is left out

**In:** the rulebook's "The money" (all of it that a month can reach without a call), "The
monthly payment", "Room for members", "Changing the membership", "When a host later offers fewer
hours" (the rules and the saving step, not the page), "Inviting", "Joining", "Cancelling the
membership", "Switching back on", "A paused membership, and resuming", every ending, the founder's
switch, and "How it is built" as far as it concerns these.

**Left to part two:** a member call's payment and everything about calls (see the rulebook's part
two). Part one builds two things part two will call and tests them on their own: taking a held
month's money now (for the first booking), and cancelling a membership's upcoming member calls
(a function that finds none in part one).

**Left to part three:** every page and form, the reminder three days before a month ends, the
full admin pages, and turning the switch on.

**A change to the rulebook that goes with this plan.** The rulebook's part three lists "monthly
receipts". The receipt *email* reports the hold, so it is written in the same database step as
the hold, in part one, as every email about money in this app is written with its event. The list
of receipts on "Your account" stays in part three. The rulebook's part one and part three lists
are amended to say so, in the same commit as this plan.

## What it relies on (each read in the code by the builder)

- `src/lib/payments/operations.ts`: an action is written into `money_operations` under a label
  before Stripe is asked (`startMoneyOperation`, `:74`), only one can be in flight per payment
  (`:86`), and a finished one of the same name is never repeated (`:84`). Everything is keyed on a
  payment: `lockPayment` (`:30`), `money_operations.payment_id` and `ledger_entries.payment_id`
  are required columns.
- `src/lib/payments/jobs.ts`: `reconcileOperations` (`:86`) repeats an unanswered request under
  the same label only inside 23 hours, measured on the real clock (`:102`), and after that asks
  Stripe how things stand. Its handling of a refusal (`:213`) does not run an action's own
  `onRefused`. Refunds Stripe accepted but had not finished are polled separately (`:227`), from
  the `refunds` table only.
- `src/lib/payments/hold.ts`: a call's PaymentIntent is created **outside** the written-down
  actions (`:126`) and saved afterwards (`:142`); its idempotency key is what stops a second one.
  A cancelled PaymentIntent is never reused (`:122`). A saved card is confirmed `off_session`
  (`:278`): a refusal is thrown and recorded as a failed action (`operations.ts:113`), while an
  answer that is neither held nor refused comes back as a status and is recorded as "tried,
  nothing held" (`:260`). The bank's time and the hold's real end are read from the charge
  (`:187`), with 4 days assumed when Stripe gives no end (`rules.ts:84`).
- `src/lib/payments/actions.ts`: taking (`:114`), letting go (`:239`), refunding by
  `payment_intent` (`:366`, refused once a share was sent or a dispute is open, `:339`), sending a
  share with `source_transaction` and `transfer_group` (`:418`). `applyCaptured` (`:58`) writes
  the "charged to the customer" line and looks up a refund request by the payment's call.
  `currentSplit` (`:27`) needs `chargedCents` and `originalHostShareCents`.
- `src/lib/payments/stripe-events.ts`: a message only nudges; the handler asks Stripe for the
  real state. A payment is found by `metadata.paymentId`, a disputed charge by its PaymentIntent,
  and a lost dispute stays blocking (`:18`). `scripts/stripe-webhook-setup.ts` subscribes to five
  events; `payment_intent.succeeded` and `payment_intent.requires_action` are not among them.
- `src/lib/payments/collect.ts`: a host's money is found by joining `payments` to `calls`
  (`:147`, `:286`); refund requests are looked up by each payment's call (`:62`); calls are locked
  by id (`:156`); a transfer's group is the call's id (`:180`).
- `src/lib/booking/calendar.ts`: weekly hours are changed without the calendar lock and one
  stretch at a time (`:55`, `:68`). The lock is `lockCalendars` (`bookings.ts:43`).
- `src/lib/profiles/profiles.ts`: the regular price is saved with only the profile row locked
  (`:113`); `decideProfile` locks the person and the profile (`:164`).
- `src/lib/safety/blocks.ts:25`, `src/lib/safety/reports.ts:183`, `src/lib/profiles/closing.ts:24`:
  each saves its own change in one step and cleans up calls after it.
- `src/lib/booking/jobs.ts:247`: the job that removes saved cards takes each finished booking's
  own card set-up and detaches that card at Stripe. It does not ask whether anything else uses
  the card.
- `src/lib/health.ts`: reports a stale helper, an action without an answer for 6 minutes (any
  row of `money_operations`), and a call's money that is overdue.

## The order of locks

One order for every step in this part, also for the steps that finish, refuse or recover an
action, not only the step that starts it:

1. the calendar locks of the hosts concerned (`lockCalendars`, sorted);
2. the person and profile rows (as `lockedProfile` takes them);
3. the host's collection row (`host_settings`);
4. memberships, by id;
5. months, by id;
6. calls, then payments, then request and refund records, as today.

A step takes only the locks it needs, but never an earlier one after a later one. So:

- **A money action owned by a month** finds its membership and host first without a lock, then
  takes the host's calendar lock when the step can give or need room (a hold being accepted, a
  month being written down), then the membership, then the month, and reads all three again. The
  owner-aware runner in `operations.ts` does this in its start, finish, refusal and recovery
  paths alike.
- **An ending that covers many memberships** (a block, a paused or closed account, a suspension)
  takes its own locks as today (a block already takes both calendar locks, and keeps them), then
  every membership concerned in id order, then their months. It needs no calendar lock for the
  memberships: an ending only frees room.
- **Making a membership** (an invitation in 1b; the check script in 1a) locks both people's
  person rows after the calendar lock and looks again that neither is paused or closed and
  neither has blocked the other. The steps that pause or close an account, or block, change those
  same rows or hold those same calendar locks before they look for memberships to end, so a
  membership being made at that instant is either seen by the ending or refused.
- **Saving the regular price** takes the host's calendar lock, then the profile row. Writing a
  month down holds the same calendar lock while it reads the price, so the two cannot cross.

## The database: one migration, `0027_memberships`

Made with `npm run db:generate`. Checks and partial indexes are written in `schema.ts`, as
`ratings` and `call_extensions` do today; nothing in this migration needs hand-written SQL except
comments. Every balance and every other quantity that can never be negative is a whole number, required,
zero by default and checked to be zero or more. (Lines of the money record stay signed, as today.) Every existing row satisfies every new check. It all goes in with 1a.

**`membership_offers`** (the host's one membership): `host_id` (key), `on`, `price_per_15_cents`,
`included_minutes`, `version`, `updated_at`. Checks for the rulebook's limits.

**`memberships`**: `id`, `host_id`, `customer_id`, `status` (`invited`, `joining`, `active`,
`unpaid`, `paused`, `ended`), `period`, `current_month_id`, `since`, `own_price_per_15_cents`,
`own_minutes`, `agreement_id`, `member_stopped_at`, `host_stopped_at`, `paused_at`,
`paused_reason`, `ended_at`, `ended_by`, `ended_reason`, `cleanup_done_at`, and for the open
invitation `invite_id`, `invited_at`, `invite_expires_at`, `invite_offer_version`,
`invite_minutes`, and for the open offer of less time `offer_id`, `offer_month_id`,
`offered_minutes`, `offered_at`; `created_at`, `updated_at`.
- **One live membership per host and customer:** a unique index over the pair for every status
  but `ended`. A pause keeps the row. A new invitation after an ending makes a new row, so an
  ended membership keeps its months, its cards and its unfinished clean-up to itself. (The
  rulebook's "one per host and customer" is amended to say this.)
- **`period` and `current_month_id` keep old work away from a resumed membership.** `period`
  goes up by one at every joining and resuming, and every month carries the period it belongs
  to. `current_month_id` is the one month that may change the membership's state. Every step
  that would make a membership `active`, `unpaid` or `paused` because of a month, or write a
  renewal or a replacement for a month, first checks under the membership's lock that this month
  is `current_month_id` and of the membership's `period`. A month that is not may still finish its own money, and nothing else, with
  the one exception the rulebook's "Disputes" makes: a dispute over any month ends the pair's
  live membership.
  `current_month_id` is set in the same step that writes down a first month, a renewal or a
  replacement; it is cleared when the membership is really paused or ended; it stays when a
  renewal is merely stopped. `period` is raised once per joining or resuming request, however
  often that request is repeated.
- `invite_id` and `offer_id` are fresh ids for each invitation and each offer. A link or a button
  carries the id, so one that is out of date is refused.
- Indexes: by customer; by host and status.

**`membership_invitations`**: one line per invitation sent: `id`, `host_id`, `customer_id`,
`membership_id`, `invite_id`, `sent_at`, `outcome`. The limit on inviting the same person is
counted from here by host and customer, across every membership row the pair ever had, so ending
and inviting again does not reset it. Index by host, customer and time.

**`membership_agreements`**: `id`, `membership_id`, `request_id` (unique), `kind` (`joined`,
`resumed`, `less_time`, `price_lowered`), `offer_version`, `price_per_15_cents`, `minutes`,
`card_wording_version`, `first_month_number`, `at`. Lines are only ever added. `request_id` is
made when the form is shown, as a booking's request key is today, so a joining or resuming
pressed twice makes one agreement and one first month.

**`membership_cards`**: every card ever saved for a membership: `id`, `membership_id`,
`stripe_payment_method_id` (unique), `saved_at`, `retired_at`, `removed_at`. The card in use is
the one not retired, and the database allows one such card per membership. A retired card is
detached at Stripe by the helper once nothing open needs it, and only then marked removed. A card
id that was ever retired is never taken into use again; a new save is a new line.

**`membership_months`**: `id`, `membership_id`, `period`, `number` (unique per membership),
`agreement_id`, `origin_key` (unique), `price_per_15_cents`, `included_minutes`, `total_cents`,
the three fee numbers, `status`, `ended_how`, `problem`, `card_step_expires_at`,
`intent_requested_at`, `intent_request`, `stripe_payment_intent_id` (unique), `stripe_charge_id`,
`card_id`, `card_country`, `authorised_at`, `hold_expires_at`, `starts_at`, `ends_at`, `take_at`,
`taken_at`, `taken_cents`, `try`, `first_failed_at`, `next_try_at`, `give_up_at`, `needs_action`,
the six places (`free_cents`, `set_aside_cents`, `used_cents`, `expired_cents`,
`to_pay_back_cents`, `paid_back_cents`), `host_caused_cents`, `fixed_fee_placed`, `dispute`
(`none`, `open`, `won`, `lost`), `created_at`, `updated_at`.
- `status`: `to_pay`, `held`, `running`, `closed`, `finished`, `given_up`, as the rulebook
  defines them.
- `origin_key` says which month this is, and makes each exist once: `agreement:<agreement id>`
  for the first month of a joining or resuming, `renewal:<id of the month before>`,
  `replacement:<id of the month whose hold was lost>`.
- `ended_how` is written **before** a PaymentIntent is cancelled (the database refuses a
  `given_up` month without it), and says why: `cancel_now`,
  `given_up`, `ending`, `card_step`, `no_room`, or, when Stripe ended something we did not
  cancel, `hold_lost` or `cancelled_at_stripe`.
- `intent_requested_at` and `intent_request` are the one claim to create this month's
  PaymentIntent; see "One PaymentIntent per month".
- `try` numbers the saved-card tries of this month; see "The saved-card try".
- **Checks:** the six places add up to `total_cents` when the status is `running`, `closed` or
  `finished`, and are all zero otherwise; `host_caused_cents` is at most `free_cents`. Two places
  of one month that change together are changed in one SQL statement, because the database
  checks each statement on its own.
- **Three states that are not the usual ones**, each with its own assertion in the check script:
  a month whose bank dispute is lost keeps its places as they stood and stays frozen; a month
  with `problem` set after the whole amount was taken keeps its places; and a month where Stripe
  reports a different amount than the whole stays out of the six places altogether (all zero),
  with `taken_cents` holding what Stripe really took, `problem` set and the real amount on the
  month's money record, and waits for the founder.
- Indexes: by membership; by status with each of `take_at`, `next_try_at`, `give_up_at`,
  `ends_at`, `card_step_expires_at`.

**`booking_cards`**: `stripe_payment_method_id` (unique), `booking_id`, `seen_at`, `removed_at`. See
"Cards".

**`membership_refunds`**: one line per pay-back **owed**: `id`, `month_id`, `source_key`
(unique), `amount_cents`, `reason`, `payment_id` (the call's payment it came from; empty in part
one), `status` (`owed`, `at_stripe`, `done`), `attempt`, `stripe_refund_id`, `last_failed_at`,
`created_at`, `finished_at`. `source_key` names the one event that owes it (`monthend:<month>`,
`ending:<month>`, `late:<month>`, `won:<month>`), so the same event can never owe twice. Index by
status; by month.

**Changes to existing tables**

- `payments`: `kind` (`card` for every existing row, `member_call`, `member_expired`),
  `month_id`, `host_caused_cents`, and `call_id` no longer required. Checks: `card` has a call
  and no month; `member_call` has both; `member_expired` has a month and no call. Unique: one
  `member_expired` payment per month. The two uniqueness rules of `0019_more_time.sql` stay as
  they are. Index on `month_id`.
- `money_operations` and `ledger_entries`: `month_id`, and `payment_id` no longer required.
  Check: exactly one of the two is set. Indexes on `month_id`. New: two unique indexes for actions still `started`, one over
  `payment_id` and one over `month_id`, so "one in flight per owner" is also the database's rule.
  A host's collection starts one transfer for each of several payments in one step today
  (`collect.ts:178`); transfers stay owned by their payment, so this still works, also for
  several payments of one month.
- `site_switches`: `memberships`, one of `off` (every existing row), `named` and `everyone`; and
  `memberships_hosts`, the hosts the founder names. The three positions are stored as three
  words on purpose: with `named` and nobody on the list, memberships are on for nobody, so
  taking the last host off the list can never open memberships to everyone.

## 1a: the money of a membership that exists

### `src/lib/payments/operations.ts`: a second owner

`OperationPlan` and its functions take an owner: a payment (today's behaviour, labels and lock,
unchanged, and `lockPayment` stays for its callers) or a month (locks as under "The order of
locks"; one action in flight per month). The kinds stay `hold`, `capture`, `release`, `refund`
and `transfer`; `transfer` is only ever owned by a payment. `reconcileOperations` loads the owner
of each unfinished action and hands a month's to `src/lib/membership/recover.ts`. No second copy
of the retry code is written.

### `src/lib/membership/charge.ts`: one PaymentIntent per month, also after an interruption

Creating a call's PaymentIntent is not a written-down action today. For a month it is made one,
with **one claim that is written once and never changed**. Everyone who needs the month's
PaymentIntent (the joining step, `payNow`, the helper's try) calls the same function,
`intentFor(month)`, and it does exactly one of these:

1. **The id is saved:** use it.
2. **No claim yet:** with the month locked, and only if `intent_requested_at` is still empty,
   save `intent_requested_at` (the real clock) and `intent_request` (the exact request: the
   customer, the amount of the month, card only, `capture_method: "manual"`,
   `setup_future_usage: "off_session"`, `transfer_group` the month's id, `metadata.monthId`).
   Then send it with the idempotency key `monthintent:<month id>`, and save the id with the month
   locked again.
3. **A claim, no id, younger than 23 hours** by the real clock: send the saved request again
   under the same key. Stripe returns the same PaymentIntent.
4. **A claim, no id, 23 hours or older:** the key can no longer be trusted, so nothing is
   created. The customer's PaymentIntents created since five minutes before the claim are listed,
   every page, and matched on `metadata.monthId`. Exactly one: its id is saved. More than one:
   `problem`, and none is used. None: none was ever made; the month is `given_up`
   (`cancelled_at_stripe`), and its membership, its room and its card are settled as for any
   month that ends without a hold, if it is the membership's current month. A new PaymentIntent is never made for this month.

Saving an id always looks again, under the lock. If the month already has **this** id saved
(another caller got the same PaymentIntent a moment earlier), there is nothing to do, whatever
state the month is in by now: a hold that was accepted meanwhile is never cancelled from here, as
`hold.ts:146` protects a call's hold today. If the month has no id and may still be paid
(`to_pay`, no `ended_how`), the id is saved. If the month has been abandoned (`ended_how` is
written), the id is saved and the letting-go that was written down takes care of it: it cancels a
PaymentIntent that can still be cancelled, and `syncMonth` handles one that Stripe already
cancelled or charged. The secret of an abandoned month is given to nobody. The claim is never
reset by anyone.

### `syncMonth(monthId, now)`: what each state at Stripe means

One function reads the PaymentIntent and records what it shows. It is called by the direct
answer of every step, by Stripe's messages and by the helper, and it never moves a month
backwards. The decisions are the rulebook's ("First a hold, then the money", "The monthly
payment"); this is how each is carried out. It looks first at where **our** month stands, then at
Stripe.

Anything it does to the **membership** (making it `active`, `unpaid` or `paused`, or writing a
replacement) happens only when the month is the membership's `current_month_id` and of its
`period`. A membership having ended never by itself makes this function pay anything back: what
an ending pays back is decided by the ending's own clean-up.

**Our month is `to_pay`, and `ended_how` is empty**

| At Stripe | What is recorded |
| --- | --- |
| `requires_payment_method`, never tried | Nothing. |
| `requires_payment_method`, after a try that failed | Once for that try (see "The saved-card try"): `first_failed_at` if empty, `give_up_at` from it, `next_try_at`, the membership `unpaid`, the "payment failed" email. The PaymentIntent is kept. |
| `requires_confirmation` | Nothing. Only a recorded try confirms it. |
| `requires_action` | As a failed try, with `needs_action` set, so the email and `payNow` say the bank wants the member's own approval. The PaymentIntent is kept. |
| `processing` | Nothing is decided. The month is looked at again on the next pass. |
| `requires_capture` | With the calendar, membership and month locked: the PaymentIntent is this month's and for its amount; `ended_how` is still empty; the bank's time is not past `card_step_expires_at`; the membership may still start this month; there is room; the switch allows it; the card may be the membership's (see "Cards"). Then the month is `held`: the bank's time, the hold's real end, the card's country, the charge, the card record, the month's start and end, `take_at`, the membership `active`, and the receipt email, all in one step. If any of those fails, `ended_how` is written (`no_room`, `ending` or `card_step`) and the hold is let go as a written-down action. |
| `succeeded` | Cannot come from our code, which only takes a held month. Recorded as a charge first found after the fact, below. |
| `canceled` | Stripe cancelled it (for example after its own time limit). `ended_how` becomes `cancelled_at_stripe`, the month is `given_up`, and its membership, room and card are settled as for any month that ends without a hold. |

**Our month is `held`, and `ended_how` is empty**

| At Stripe | What is recorded |
| --- | --- |
| `requires_capture` | Nothing. |
| `processing` | The taking is on its way. Nothing is decided; looked at again on the next pass. |
| `requires_payment_method`, `requires_confirmation`, `requires_action` | Should not happen to a hold we accepted. `problem` is set, and nothing new is paid, tried or written down. |
| `succeeded` | The taking, once, as in "Taking the money" below, whichever way we learn of it. |
| `canceled` | The bank dropped the hold. `ended_how` becomes `hold_lost`, the month is `given_up`, and what follows is the rulebook's "A hold that is gone", with its exception for an open offer of less time. A replacement month, where the rulebook gives one, is written in this same step under `replacement:<month>`; run again, it finds the replacement already there. |

**`ended_how` is written (we are letting it go, or already have: `to_pay`, `held` or `given_up`)**

| At Stripe | What is recorded |
| --- | --- |
| `requires_payment_method`, `requires_confirmation`, `requires_action`, `processing` | Nothing here; the letting-go that was written down is finished by its own action. |
| `requires_capture` | Never accepted. The letting-go continues, or is written down now if a hold arrived for a month already `given_up`. |
| `canceled` | The cancellation is finished: the month is `given_up`. Nothing new is written down. |
| `succeeded` | A charge first found after the month was abandoned, below. |

**Our month is `running`, `closed` or `finished`**: nothing, whatever Stripe shows. Its money is
already in the books; the same message arriving again changes nothing.

**A charge first found after the fact** (the two `succeeded` rows that say "below"): recorded
once, in one step. If Stripe took exactly the month's amount, the month becomes `closed` with all
of it "to be paid back" under `late:<month>`, and one "charged to the customer" line on the
month's money record, so the six places hold. If Stripe took a different amount, it is the third
of the "states that are not the usual ones" above. Either way the month gives no time, and it never leads to a renewal or a replacement. If it is
still the membership's current month (a `to_pay` month that was charged), the membership is
settled as for a payment that was abandoned: paused unless it is already ended, its current month
cleared, its card retired. If it is an old month, only that month's money changes.

### The saved-card try

A money action owned by the month, named `monthhold:<month id>:<try>`. `try` is the month's own
counter: it goes up by one, in the same step that records a try as failed and sets `next_try_at`.
So each failed try has a name of its own and the next try is a new action, whether Stripe
**threw** a refusal (a declined card, or "authentication required" for a card used in the
background) or the answer came **back** without a hold. A try whose answer is not known yet, or
that is still `processing`, keeps its number, and no new one starts beside it. Whichever path
notices a failure (the direct answer, recovery, or a message), it ends in `syncMonth`, which
records it once for that try number.

### Taking the money, and letting a hold go

- **Taking** is a money action (`monthcapture:<month id>`) for the whole amount. Its outcome is
  applied by one function, used by the direct answer, by recovery and by `syncMonth`: when Stripe
  shows exactly the month's amount, the month becomes `running`, all of it free, with one
  "charged to the customer" line on the month's money record. Any other amount is recorded as
  under `membership_months` above. The timed taking and `takeNow(monthId)` are the same action,
  so the helper and a first booking in part two cannot both take.
- **Letting go** is a money action (`monthrelease:<month id>`). `ended_how` is saved in the step
  that writes it down. If Stripe says the PaymentIntent was taken instead, `syncMonth` records
  that and the money is owed back.

### `src/lib/membership/payback.ts`: owed once, tried as often as needed

A pay-back is two things, kept apart: the line that says it is **owed**, and the **tries** to
send it.

- *Owing* happens once: the `membership_refunds` line with its `source_key`, and the move into
  "to be paid back" in `months.ts`, in one step. A second request with the same key changes
  nothing.
- *A try* is a money action owned by the month, named `monthrefund:<refund id>:<attempt>`. Its
  refund at Stripe is made against the month's PaymentIntent, with the refund's id **and the
  attempt number** in the metadata.
- One function applies an outcome, whoever learned it, and only to the try it belongs to: with
  the month locked it does nothing unless the line's `attempt` is the outcome's and the line is
  not `done`. **Done** moves the money into "paid back" once and writes the email. **Still on its
  way** stores Stripe's refund id (`at_stripe`), and the helper asks about that refund by id.
  **Failed or cancelled at Stripe, or refused** puts the line back to `owed`, clears the stored
  refund id, raises `attempt` by one and sets `last_failed_at`. A late answer about an older try
  can therefore neither undo a newer one nor reopen a pay-back that is done.
- The helper starts a try for every line that is `owed` with no try in flight, at once the first
  time and an hour after a failure. It never starts one while an earlier try has no answer or is
  still on its way.
- A try too old to repeat is looked for among **all** refunds of the PaymentIntent, every page,
  by refund id and attempt number together.
- How a try whose answer never arrived is followed up was hardened on 27 November 2026: see
  "The pay-back's follow-up, hardened" at the end.
- Nothing is paid back from a month whose dispute is open or lost (the rulebook's "Disputes").

### `src/lib/membership/months.ts`: the only code that changes a month's numbers

In 1a: open a month; expire free money; owe a pay-back; a pay-back done; the dispute's state.
Part two adds set aside, used and come back here.

**Expiring** makes the month's one `member_expired` payment in the same step as the move, with
every field the collecting code reads: `month_id`; no call; `covers_from` and `covers_until` the
month's start and end; the month's price; `booked_cents` and `charged_cents` the expired amount;
`charge_reason` "expired"; `charged_at`; the fee numbers by the rulebook's "The arithmetic" (the
fixed part only if the month has not placed it, which is then marked); `original_fee_cents` and
`original_host_share_cents` from `splitCharge`; `card_country` and `stripe_charge_id` from the
month; **no** PaymentIntent id (that stays on the month); `status` "charged"; the transfer
status, and the day it can be collected by the rulebook's step 5. On the payment's money record:
the fee and the host's share. **No** "charged to the customer" line: the month has the only one.
`applyCaptured` is not used for it.

### The end of a month, and the renewal (`close.ts`, `renew.ts`)

A month past its end is closed and its free money split by `rules.ts`, as the rulebook's step 5
says; it is `finished` by the rulebook's step 6. **An ending comes before the month's end:** with
the membership and the month locked, closing first looks whether the membership was ended **before this month's end** (its
`ended_at` earlier than the month's `ends_at`) and its clean-up is not done. If so, the month's
free money is owed back under `ending:<month>` in that same step and nothing of it expires. A
membership that was ended only after the month's end changes nothing for that month: its
ordinary unused money expired at its end and its host-caused part is paid back, both by the
rulebook's step 5. The ending's clean-up applies the same test to each month of the membership
on its own, older ones too (being the current month or not plays no part in this), so the result
is the same whichever of the two jobs gets there first. A month that is only `held` has no free
money: its hold is let go. A frozen month stays frozen through all of this, and if its dispute is
won, what is still free is paid back under `won:<month>`, also after the month's end. (A month whose
dispute is open or lost stays frozen.) A month that was closed only to pay back a charge found
after the fact renews nothing. A renewal is written down under
`renewal:<month>` when the rulebook's "The monthly payment" and "Room for members" allow one, and
only for the month that is the membership's `current_month_id` and of its `period`, checked with
the calendar, the membership and the old month locked; its saved-card try follows. A month from
before a pause is closed like any other and renews nothing.
Where they do not allow one, the membership is paused in that same step.

### Pausing and ending, as far as money goes (`ending.ts`, first half)

1a builds the two state changes and their clean-up; 1b adds the people who ask for them.

- **Pausing** (a payment given up, no room or no permission at a renewal, a lost hold with an
  offer of less time open): the membership is `paused` and its card retired, in the step that
  decides it.
- **Ending at once**: in one step the membership is `ended` with who and why, `cleanup_done_at`
  empty, its card retired, and `ended_how` written on an open month. The clean-up is then done
  and repeated by the helper until `cleanup_done_at` is set: an open PaymentIntent cancelled or
  its hold let go; free money owed back (`ending:<month>`); upcoming member calls cancelled (none
  in part one). A call under way and money still set aside are left to settle.

### Disputes (`stripe-events.ts`, `ending.ts`)

A dispute message is also looked up among months by its PaymentIntent, and the dispute's present
state is read from Stripe, as today. In one step with the month: `dispute` becomes `open`, `won`
or `lost`, and **whenever this is the first we record of a dispute on this month, whatever its
state already is**, the membership is ended at once (so a dispute that was opened and won before we handled a
single message still ends it). By the rulebook's "Disputes" this is the one exception to "only
the current month changes a membership": the membership that is ended is the live one of that
host and customer, also when the disputed month belongs to an earlier period or to an earlier,
ended membership of the same two people. What each state then means for the month's money is
the rulebook's "Disputes": open and lost freeze; won lets the clean-up pay back what is still
free under `won:<month>`. A transfer or a pay-back that was already written down before the
freeze is still followed to its answer; the freeze only stops new ones being started.

### Collecting (`collect.ts`, `host/earnings.tsx`, `admin/`)

- The host of a payment is its call's host or, without a call, its month's host.
- Refund requests are looked up only for payments that have a call; calls are locked only where
  there is one; months are locked before calls.
- A share of a month whose dispute is open or lost is held back.
- A transfer from a month's charge is grouped under the month's id, the same group the monthly
  PaymentIntent carries. (This will also hold for a member call's payment in part two; an
  ordinary card payment keeps its call's id.) `TransferParams` gets `group`; a transfer written
  down before this carries `callId` and is read as before. Recovery of an old transfer reads
  every page of the group.
- `earnings.tsx` counts calls only among lines that have one, and shows "Expired member time,
  month to 14 December" for a line that has none; the admin lists do the same.
- A small list for the founder on the admin page: months with `problem`; pay-backs owed for more
  than an hour, with their last failure; months under dispute.

### Everything else that reads `payments`

- **Guards before Stripe is asked.** Every way into a card action refuses a payment that is not
  `card` before anything is sent: `holdIntentFor` (`hold.ts:88`) before it creates a
  PaymentIntent, since that step has no `prepare`; `capturePlan`, `releasePlan` and
  `releasePayment`, and `refundPayment`, in `prepare`. `syncHold` and `recordLateCharge` return
  at once for one.
- **Types.** With `call_id` optional, the functions that take a payment and read its call get
  one small helper that asserts "this is a card payment with a call" and returns it with the call
  required: `applyCaptured` (`actions.ts:73`), `tooLateToHold` (`hold.ts:69`), `recordLateCharge`
  (`hold.ts:347`). A guard in an earlier step does not tell the compiler anything about a later
  one, so each asserts for itself. Also: `src/app/page.tsx:138` gets a reader that returns only
  payments with a call; `collect.ts:62`, `:72`, `:156`, `:180` as above; `Earning.call` may be
  empty (`earnings.tsx:18`, `admin/page.tsx:45`, `:52`); `scripts/payments-check.ts:859` and
  `:866` read the call of an earning and are adjusted without changing what they test.
- Code that looks payments up by a call (`own.ts`, `take.ts`, `cancel.ts`, refund requests, the
  booking jobs, reminders, the safety clean-ups) never meets a payment without one and is not
  rewritten.

### Cards (`cards.ts`, `booking/jobs.ts`, `booking/bookings.ts`)

A card at Stripe belongs to a membership or to a booking, never both, and that has to hold when
both sides act at the same instant. So both sides go through one small function in `cards.ts`
that takes a lock of its own on the card's id (`pg_advisory_xact_lock` on `card:<id>`, the way
`lockCalendars` locks a calendar):

- **A booking's cards are remembered.** Today a booking forgets its card when the card is
  removed (`booking/jobs.ts:287` clears it), so a membership could no longer tell that a card
  was a booking's and is gone for good. A new small table, `booking_cards` (the card's id,
  unique; the booking; when it was removed), gets a line under the card's lock from every place
  a booking learns its card's id: `finishCardStep` (`bookings.ts:518`, also on its two paths
  that end the request, `:530` and `:552`) and `removeSavedCards` when it reads the card from
  the card set-up, before it detaches it. Lines are never deleted.
- **A membership taking a card** (when a hold is accepted): the card is read from Stripe and
  must belong to the member's Stripe customer; under the card's lock it must not be in
  `booking_cards` at all, must not be the card of a booking's card set-up that is not finished
  yet, and must not be a card `membership_cards` ever retired. Otherwise the month
  is not accepted and its hold is let go.
- **A booking taking a card** (`finishCardStep`, `bookings.ts:512`): under the same lock, a card
  that `membership_cards` knows and has not removed is refused.
- **The booking job removing a card** (`removeSavedCards`, which reads the card from the
  booking's card set-up, `booking/jobs.ts:276`): under the same lock, a card that
  `membership_cards` knows and has not removed is skipped.
- **The helper removing a retired card**: under the same lock, only when the line is still
  retired and nothing open needs it. Detaching cannot be undone at Stripe, so this check is the
  last thing before it.

### The helper, Stripe's messages, the health check, the switch

- `runMembershipJobs(now)` runs right after `runPaymentJobs(now)`, before the helper notes that
  the round finished, in this order: PaymentIntents asked for and not saved; card steps that ran
  out; holds to look at again; timed takings; new tries; giving up; months to close; renewals;
  pay-backs; endings to clean up; retired cards to remove.
- `stripe-events.ts`: a `payment_intent` message with `metadata.monthId` goes to `syncMonth`.
  `scripts/stripe-webhook-setup.ts` adds `payment_intent.succeeded` and
  `payment_intent.requires_action`. Messages stay a nudge: every state is also reached by the
  helper asking Stripe.
- `health.ts` also reports, each on its own: a PaymentIntent asked for and not saved for
  6 minutes; a held month 5 minutes past `take_at`; a try 5 minutes past `next_try_at`; a month
  5 minutes past `give_up_at` not given up; a running month 5 minutes past its end not closed; a renewal not written 5 minutes after its month closed, when one was really due (not for a
  membership whose host the switch does not cover, which is paused instead); a pay-back owed for 2 hours; an ending
  not cleaned up after 10 minutes; a month with `problem`.
- The switch: its position and the named hosts in `switches()`, and one function that answers
  "are memberships on for this host?" (`everyone`, or `named` and this host is on the list), which
  every place that checks the switch calls, so nothing can check the plain switch by mistake;
  `setSwitches` takes only what changes; the form on `admin/reports`, where the founder names
  hosts by their handle; one line in `scripts/safety-check.ts`, which compares all switches word
  for word. What the switch stops and what it never stops is the rulebook's row "The founder's
  switch".

### `src/lib/membership/room.ts` (with `room.test.ts`)

Written in 1a, because accepting a hold, writing a renewal and refusing a cut in hours all need
it: the host's hours, what is promised to whom, room for someone new, and the one calculation of
who keeps their place, all by the rulebook's "Room for members" and "The builder's choices".
Every caller holds the host's calendar lock.

### Emails written in 1a (`src/lib/membership/emails.ts`)

Their links use the addresses fixed in the rulebook's "How the parts connect"; those pages are
built in part three, and until then only the check script receives these emails. Each in the
step of its event: the monthly receipt; payment failed (with or without "your bank
wants your approval"); a payment given up and the membership paused; paused for lack of room or
because memberships are not being renewed; a pay-back; ended, with the reason, for every ending 1a can cause (a dispute, a block, a paused
or closed account, a suspension).

### The places in today's app that must know about a membership (in 1a)

A membership made by the check script must already be safe against what the app can do today.

- **Ending.** Each of these calls ending-at-once inside the step that saves its own change, so
  the two cannot come apart, and the clean-up runs after it and again from the helper: `block`
  (`safety/blocks.ts:25`), `pauseAccount` (`safety/reports.ts:183`), `closeAccount`
  (`profiles/closing.ts:24`), and a suspension in `decideProfile` (`profiles.ts:164`).
- **The regular price.** `updateHostProfile` takes the host's calendar lock and applies the
  rulebook's price rule against months that are running, held or being paid for.
- **Weekly hours.** Every change of weekly hours in `booking/calendar.ts` runs in one step under
  `lockCalendars`. A change that would leave less than the host's members need is refused with a
  plain sentence. (The step in which the host chooses, and so can make such a cut, is 1b.)
  Existing behaviour for a host without members does not change.

## 1b: how a membership comes to exist and what people do with it

What this part hands to parts two and three, and the addresses its emails link to, are fixed by
name in the rulebook's "How the parts connect".

- **`booking/calendar.ts`**: `changeWeeklyHours(hostId, change, choices)` replaces a stretch in
  one go and carries the host's choices for her members; removing and shortening go through it.
  A cut that needs choices and has none stays refused, which is what the calendar page shows
  until part three. `room.ts` gets what a cut in hours needs, as a function that works it out
  **without saving anything** (what members need, what is still owed this month, which
  invitations give way, who would have to be paused or offered less), for the step in part
  three. It returns a mark in the same way, and saving refuses if the mark no longer fits.
- **`offers.ts`**: saving the host's membership, under the calendar lock, by the rulebook's
  "Changing the membership". And a second function that works out what a change would do (who
  pays less and by how much, which invitations are taken back) **without saving anything**, for
  the page in part three that shows it before the host confirms. It returns, with the answer, a short mark of the state it was
  worked out from, as a refund request's `seen` does today (`refunds/requests.ts:46`). Saving
  takes that mark, works the answer out again and refuses if the mark no longer fits.
- **`access.ts`**: who may see an invitation, a membership, a payment and a host's members, and
  the way a member or an invited person reaches a host whose page is hidden, without loosening
  the public reader of a host's page (`publicProfile`, `profiles/profiles.ts:203`). It is here,
  and not with the pages, because part two's pages are the first to need it. Each function answers "not found" in the same way for someone else's and for something that
  does not exist. For a payment it answers two different questions: **may this person start or
  confirm this month's payment, or be given its secret** (the member, and only while the month
  may still be paid), and **may this person see or refresh this month's outcome** (the member,
  always, also after the payment step has closed).
- **`wording.ts`**: the sentences a member agrees to and their version, in one place. `join.ts`
  records the version; the page in part three shows the sentences from here, so the two can
  never differ.
- **`join.ts`**: inviting, taking back, running out; "Join" (the invitation's place becomes the
  membership's; the agreement under its `request_id`; `period` raised; the first month under
  `agreement:<id>` with `card_step_expires_at`); the card step ending without a hold (`ended_how`
  `card_step`); resuming, which is the same path with a `resumed` agreement.
- **`ending.ts`, second half**: the member's stop and the host's stop; "Cancel now"; switching
  back on; the host's own "End membership"; the offer of less time, each action carrying the
  `offer_id` it was shown.
- **`jobs.ts`** grows: invitations that ran out; offers of less time settled at the month's end.
- **Emails written in 1b** (the same `emails.ts`): invited, taken back, run out; joined; "Cancel now"; renewal stopped
  and switched back on; paused by the member's or the host's choice; resumed; a lower price from
  the next month; an offer of less time and its outcome; ended by the host's own choice.

## The order it can safely go in

Nothing is live, so each pull request is merged in one go: the migration, then the code, then
the scripts. The check script sets the founder's switch (both its position and its list) in the local
database for the journeys that start or renew a membership, sets it back to `off` when it ends, and has journeys of
its own for what happens while it is off. The old code works on the new tables. After 1a the switch exists and is off, and no
code path can start a membership: only the check script makes one, directly in the database.

## How each "done when" is proven

A new script, `scripts/membership-check.ts`, built like `scripts/payments-check.ts`: the seeded
host and customer, a local database only, Stripe's test area only, a made-up `now` handed to the
jobs. Where the code measures age on the real clock (`jobs.ts:102`), the script makes the written
record old, as `payments-check.ts:778` does. An interruption is played at the real place it can
happen: the step before is run, the step after is not, and the helper is then run until it has
nothing left to do.

**What is compared after every step of every journey**, each read on its own, not worked out
from the others:

- the month's six places, and that they add up to what was paid (but for the three "states that
  are not the usual ones", which have their own assertions against `taken_cents` and the money
  record);
- Stripe, asked afresh: **every** PaymentIntent of the test customer, listed in full, so that
  each month has exactly one and none exists that the database does not know; for each, its
  state and the amount it really took; every refund on it; every transfer in its group;
- the money record: one "charged to the customer" line per month, and the lines of each payment;
- work still owed: actions without an answer, pay-backs not done, endings not cleaned up;
- what the journey must have produced, written out in the script. For example, a $60.00 month on
  a US card that expires whole: fee $2.94 plus $0.30, so $56.76 earned, and $56.51 sent after
  the 25-cent collection charge.

| Rulebook, part one, "done when" | Proven by |
| --- | --- |
| A test month can be charged, renewed, ended, paid back or left to expire, and collected, with nothing left for part two to put right | The journeys under "Payments", "Tries", "Months", "Pay-backs", "Disputes" and "Collecting" below, each ending with the helper having nothing left to do. |
| Every cent is in one of the six places after the same request twice, two things at once, and the app stopping at any step | "Interruptions" and "At the same moment" below, and the database refusing a month whose places do not add up, or with a negative place, tried on purpose. |
| The existing payment jobs and lists handle the new records safely; nobody can buy a membership | The twelve existing scripts pass, with only the adjustments named above (`safety-check.ts`, `payments-check.ts:859` and `:866`); "Collecting" below; a card action tried on a payment that is not `card`; closing an account, pausing one, a block, a suspension, a lower regular price and a cut in hours, each against a seeded membership; in 1b, every way to invite, join or resume tried with the switch off, and a search of the app for a page or address that could start one. |

**Journeys in 1a**

- *Payments:* a hold by the member's own confirmation; a saved-card try that succeeds; one
  refused; one refused with "authentication required"; one that comes back wanting approval; one
  still processing; a hold with a short end reported by Stripe; the timed taking; `takeNow`; a
  different amount reported as taken; `payNow` at the same moment as an automatic try (one hold);
  tries on the rulebook's days and giving up.
- *Cancellations:* each kind of cancellation we ask for is never followed by a new month; a
  hold arriving for a month already given up (let go, never accepted); a normal month whose
  membership ended later, with every payment message sent again (nothing paid back that was
  used or expired); a hold
  the bank dropped is replaced once; the same with an offer of less time open (paused, nothing
  tried); a payment that goes through while it is being given up, while its membership is being
  ended, and after room was lost (owed back in full each time).
- *Old work after a resume:* a month from before a pause closing, failing, losing its hold and
  getting a late message after the membership was resumed (the new period untouched, nothing renewed from the old month). These use memberships and
  months put into the database by the script; the joining and resuming that really raise a
  period are 1b's.
- *Tries:* a try that comes back without a hold, then the next days' tries (each runs); a try
  with no answer (no new one beside it).
- *Months:* everything expires; a renewal; a renewal without room and one with the switch off
  (paused, nothing charged, the old month finishes normally); host-caused free money put on a
  test month and paid back at its end while the rest expires.
- *Pay-backs:* owed with no try started, then sent by the helper; on its way, then done; on its
  way, then failed, then sent again an hour later; refused, then sent again; a late answer about the first try arriving after the second was sent
  (the second untouched) and after the pay-back was done (still done); a lost answer found
  again after 23 hours on a PaymentIntent with more than 100 refunds; the same event owing twice
  (once).
- *Disputes:* opened during a month; first handled when already won; first handled when already
  lost; after the expired money was collected; while a pay-back and while a transfer were
  already written down (both reach their answers; nothing new starts); won (free money paid
  back) and lost (nothing moves).
- *Collecting:* nothing can be collected from a month before its expired payment exists, and not
  before the day the rulebook gives; the transfer names the month's charge and group; one
  collection with a call's share and expired member time; the 25-cent charge carried by a share
  too small to send; a transfer refused and one with no answer; an old one found again in a
  group with more than 100 transfers; the founder's collection for a closed host.
- *Cards:* a booking's saved card offered as a membership's (refused), also one whose card step
  is not finished, and one the booking job removed a moment before (refused, because the
  booking's line remains); a membership's card offered to a booking (refused); both at the same moment,
  in each order (one wins); the booking job running beside a membership's card (untouched); a card replaced through `payNow`, the old one removed
  only when nothing needs it; an old removal answering after a new card was saved.
- *An ending across a month's end:* a membership ended a minute before its month ends, the app
  stopped, the helper back after the end (the free money paid back, nothing expired, in either
  order of the two jobs); and one ended a minute **after** its month's end with the closing job
  late (the money expired, nothing paid back, in either order).
- *A dispute over an old month:* a member pauses, resumes, and their bank then disputes a month
  from before the pause (the membership of today is ended; the new month's free money is paid
  back; the old month is frozen).
- *The named hosts:* with the switch on for one named host, that host's membership works from
  end to end, and for another host every step the off switch forbids is refused; a host taken
  off the list is treated as if the switch had gone off for her (her members' months go on, and
  are paused at their end without a renewal); with `named` and an empty list nobody can start
  anything.
- *A charge found after the fact:* on the current month (the membership paused, the card
  retired, everything owed back, nothing renewed) and on an old month (only its money changes).
- *Two callers, one PaymentIntent:* the second saves its id after the first's hold was accepted
  (the hold stays).
- *Interruptions:* stopping before the PaymentIntent is asked for; after it is made and before
  its id is saved, found again inside 23 hours and after, also when none was made (the month
  given up, nothing created) and when the month was abandoned meanwhile (cancelled, its secret
  given to nobody); two callers of `intentFor` at once (one claim); after the hold; after the taking;
  after a pay-back is owed; after an ending is saved. The same Stripe message twice, and two
  messages in the wrong order.
- *At the same moment:* the timed taking and `takeNow`; a taking and a letting go; two renewals
  of one month; two helpers closing one month.
- *The switch and the health check:* with the switch off, no renewal and no new month, while
  holds, takings, pay-backs, endings and collecting go on; each of the health check's new
  conditions on its own makes it answer "not healthy".

**Journeys added in 1b:** the rulebook's list under "How it will be checked" for room, the price
that only goes down, invitations, the two stops, "Cancel now", an offer of less time, a cut in
hours, pausing and resuming, and each of the four places that end a membership with the app
stopped right after its change is saved; a joining pressed twice (one agreement, one month); an
abandoned joining; a new invitation while the old membership's clean-up is still running;
resuming twice.

**Broken on purpose**, one at a time, and the script must fail each time. The rulebook's three:
the month-end pay-back; nothing to the host before time is used (in part one: collecting from a
month before its money has expired); one payment per month (caught by the list of the customer's
PaymentIntents).

Also: `npx tsc --noEmit -p .`, `npx eslint src scripts worker`, `npx vitest run`, `npm run
build`, and the earnings list and the admin page looked at in a browser with a payment that has
no call.

Then, for each of the two pull requests: Astra reviews the code, CodeRabbit reviews the pull
request, and after any fix that touches the monthly payment or pay-backs the script is run
against Stripe again before it is called ready. Both are written into `docs/module-record.md`.

## What stays off after part one

The founder's switch. No page offers a membership. Months made by the check script are finished
or cleaned up by it.

## Astra's first check of this plan (17 November 2026)

Verdict: **not ready as written**. It agreed with a second owner in `operations.ts` rather than a
copy of it, with two pull requests, with the whole migration in the first, with the two database
checks on a month (adding "never negative"), and it confirmed the plan's statements about the
code but one. Its points, all worked in above:

1. **The month's id as a key does not stop a second PaymentIntent for ever**: Stripe keeps a key
   for a day. Creating it is now a written-down step with its own recovery.
2. **"A cancelled payment gets a new month" was unsafe.** `syncMonth` now has a table for every
   state, and the reason for a cancellation is saved before it is sent.
3. **A pay-back that is still on its way, or fails later, would not have been tried again.**
   What is owed and the tries to send it are now two things.
4. **The expired payment** needed every field named, the month's group on its transfer, and no
   second "charged to the customer" line.
5. **Disputes had to be complete in 1a**, also one first seen when already won.
6. **Locks:** one order for every step, also the ones that finish and recover.
7. **Cards:** saving before the taking is right, but a membership's card must be kept apart from
   a booking's, and old cards need a record of their own.
8. **The database** lacked the identities of a card step, an offer, a renewal and a replacement,
   the real amount of an odd charge, and named indexes.
9. **The health check and the founder's view** lacked overdue renewals, endings, and a list of
   months that went wrong.
10. **The proof** compared the books with themselves, and had swapped two of the rulebook's
    three deliberate breakages.

Also taken: the two pull requests are cut differently, so that 1a needs nothing from 1b;
`payment_intent.succeeded` and `payment_intent.requires_action` are subscribed; card actions
refuse a member's payment before Stripe is asked; and the plan no longer repeats rules in its
own words. The one statement about the code it corrected: a membership's card is not kept safe
from the booking job just by being stored elsewhere.

## Astra's second check (17 November 2026)

Verdict: **not ready**. It found the expired payment, disputes, the health check and the
founder's list, and the two extra Stripe messages resolved, and the rest partly. Its points, all
worked in above:

1. **"The membership ended" must never by itself mean "pay the charge back".** `syncMonth` is now
   written by where our month stands first, a month that is already in the books is never
   touched by a repeated message, and only a charge first found after the fact is owed back.
2. **A try that comes back without a hold** would have blocked the later tries. Each try now has
   a number of its own.
3. **Pay-backs:** each try carries its attempt number to Stripe, and an outcome is applied only
   to the try it belongs to.
4. **Old work after a pause and resume:** a membership has a `period` and a current month, and a
   month that is not the current one can only finish its own money. Joining and resuming carry a
   request id. A month's number is unique in its membership.
5. **Creating the PaymentIntent:** one claim, written once, with the exact request; every caller
   follows the same four cases; nothing is created blind after 23 hours.
6. **1a was not safe alone.** Endings from today's app, the regular price and weekly hours move
   into 1a.
7. **Cards:** one lock per card, taken by a membership taking a card, a booking taking one, and
   both removals.
8. **The database:** invitations carry host and customer, so the limit survives an ending; one
   card in use per membership; three more places where a payment's call is read.
9. **The proof:** every PaymentIntent of the test customer is listed, so a second one cannot
   hide; the example's numbers are corrected.

It confirmed that the unique rule "one action in flight per owner" fits today's collecting.
Taken from its cuts: the two extra deliberate breakages are dropped (their ordinary journeys
stay).

## Astra's third check (17 November 2026)

Verdict: **ready with changes**, the changes small enough to make while building 1a, with its
review of the code afterwards; no further round on the plan. It found the tries, the pay-backs'
attempts, the database, the proof, the lock order and the content of 1a resolved, and four
behaviours to fix, all written in above so they are not left to memory:

1. **An ending interrupted across a month's end** could have had its pay-back expire to the host.
   Closing now pays back an ended membership's free money first.
2. **A charge found after the fact on the current month** left the membership unsettled. It is
   now paused and its card retired, and such a month never renews.
3. **A second caller saving the same PaymentIntent** could have cancelled a hold that was already
   accepted. An id the month already has is left alone.
4. **A card the booking job had just removed** could have been taken by a membership, because the
   booking forgets it. A booking's cards are now remembered.

It also asked for the missing rows of `syncMonth` for a held month, which are added, and said
that nothing substantial should be cut.

## Built in 1a: where the code differs from this plan

Found while building and while testing against Stripe. None changes a rule of the rulebook.

- **A try with the saved card and "keep this card".** Stripe refuses a try in the background on a
  payment that is still marked "keep this card for later". So a saved-card try takes that mark
  off in its own request, and `payNow` puts it back before the member pays by hand. A card is
  taken as the membership's card in use only if Stripe really kept it for the member.
- **Files.** The renewal is in `close.ts`, in the same database step as the closing; there is no
  `renew.ts`. Pausing and ending at once are in `state.ts` (which never talks to Stripe, so
  today's app can call it from inside its own steps) and are handed over by `ending.ts` as well.
  The lock on a month is in `locks.ts` and handed over by `months.ts`; owing a pay-back is in
  `months.ts` and handed over by `payback.ts`.
- **Room when a hold comes back.** A renewal is judged by the one calculation of who keeps their
  place, the same that allowed it to be written down; a joining or resuming by the room for
  someone new; a month that replaces one whose hold the bank let go keeps that month's place.
- **A booking's card whose card step is not finished** is recognised by asking Stripe for the
  card set-up the card came from, since our database has not heard of the card yet.
- **What Stripe showed is recorded only if the month has not moved on since it was read.**
  Otherwise Stripe is asked again. A dispute's state is read once more after it is recorded.
- **The database.** `membership_months` has one index by status, not one per deadline (the table
  is small; they can be added when a query needs them). The six places, the host-caused part and
  a refund's amount are checked to be zero or more; counters (`period`, `number`, `try`,
  `attempt`) and the copied fee terms are not. A line of `booking_cards` goes with its booking
  if a booking is ever deleted, which only the check scripts do.
- **The health check** has no line of its own for a renewal that was not written: closing and
  renewing are one step, so "a month past its end that is not closed" covers both.
- **Weekly hours.** A cut is refused when it would leave less than the members who want a next
  month need (a member with an open offer of less time counts with the smaller time).
- **Not proven here, and why.** "An old transfer found again in a group with more than 100
  transfers": in part one a month has one payment at most, so one transfer; part two can make
  it. A refund that Stripe first reports as gone through and later as failed is not handled, for
  memberships as for calls today.

## Astra's reviews of the code of 1a (18 November 2026)

Three rounds: not ready, not ready, ready for CodeRabbit.

**First round, nine defects, all fixed.** The one that mattered most: when a host's hours had
been cut, closing the older member's month first could pause the older member and keep the newer
one, the opposite of the rulebook, because a renewal's hold was judged like a new member's. The
others were things happening in the same instant: an old answer from Stripe recorded over a newer
one; an old "dispute open" written over "won"; a refused card tried twice in a row; three places
that took locks in a different order; a card from a booking's unfinished card step; the secret
of a payment given out for a month that had just been given up; a month set aside for the founder
looked up again every round; and the clean-up after an ending running before the safety work and
over every ending in the app.

**Second round.** Six of the nine confirmed fixed, three narrowed further (a false "payment
failed" email; a month that could stay frozen if one look at Stripe failed; one more place that
could give out a secret), and three new scheduling points (many pay-backs waiting at Stripe; a
bank that is slow to answer a try; two helpers sending a pay-back again within the hour). All
fixed. The helper now asks Stripe itself, once an hour, about every dispute that is open.

**Third round: ready.** Two last points, both closed: one more look before "Pay now" gives out
the secret, and a second dispute on a charge whose first dispute was won ends the membership the
two have by then.

**Left open on purpose**
- **A bank's question that never becomes a dispute** (Stripe calls it an inquiry). Today the
  first sign of one ends the membership like a dispute, although no money was taken back. Whether
  that is wanted is the founder's to decide before the switch goes on.
- **Proof of things happening in the same instant.** The script proves the outcomes (a stale
  answer is thrown away, a frozen month is put right, a refused try is not repeated). It cannot
  hold one of Stripe's answers back in the middle of a step, and the app has no test set-up that
  could. Astra agreed that building one is not needed for this merge.

## CodeRabbit's review of 1a (pull request 34, 18 November 2026)

About 47 comments: 13 marked major, 4 more outside the changed lines, about 30 smaller. Each was
checked against the code.

**Taken**
- A hold placed after the 7 days is not accepted (it counted before, if the helper had been down
  when the 7 days ran out). A hold placed in time still counts when it is found late.
- Asking Stripe what it has is not the action itself. If the asking fails, the action stays
  unanswered instead of being recorded as refused. This was also true of the existing recovery of
  transfers and refunds for calls, and is fixed there too.
- A month that is waiting out a refusal no longer takes a place in the helper's batch, so it can
  never keep others from their turn (takings, lettings-go, retired cards, dispute looks).
- Collecting looks for a waiting dispute message again once it holds its locks.
- The moment of an ending is taken once the locks are held, so the same ending cannot fall on
  different sides of a month's end depending on which job is first.
- A failure in the membership work never holds up the booking work of the same round.
- A refusal can no longer overwrite an action the helper has already recorded.
- The "payment failed" email no longer promises a new try when there is none. For a short hold the
  receipt shows the moment the money is taken as the last one for "Cancel now" (the rulebook's
  row 7). The health check reports a payment that was given up and is still open at Stripe.
- The founder's switch: "off" is saved at once, whatever is typed in the list of hosts.
- The check scripts: the script refuses to run when the switch is not off, gives the test payout
  account back after an interrupted run, and checks that each month's payment at Stripe is the
  one the month has saved; the safety script no longer assumes the memberships switch is off.

**Not taken, and why**
- *A second dispute on the same charge that is opened and won before any message is handled*
  would not end a later membership. Telling disputes apart needs their Stripe ids stored. It is
  very rare, and it is an open point for the founder's page in part three.
- *An old answer about a dispute arriving in the same instant as a newer one.* The window is a few
  thousandths of a second; Stripe is read again after recording, and once an hour by the helper.
- *"Never made" after one look, more than 23 hours later.* This is the app's standing rule for
  every money action since the payments module, not something this part introduces.
- *A person at the card step should keep their place against a renewal.* By the rulebook's row
  12, members come before invitations, and a joining is an invitation being taken up. If the
  hours no longer hold both, the joining is undone and nothing is charged.
- *A card used by two bookings.* Unchanged from today: each booking's card step makes a card of
  its own.
- *A test database that can be thrown away.* All check scripts share the local database, which
  holds only test data before launch.
- *An admin row for each expired-time payment in "All payments".* The founder's membership page is
  part three's.
- Smaller timing points that correct themselves within the hour, or that belong to 1b (an offer of
  less time that has just run out).

## Built in 1b: where the code differs from this plan

- **One small migration after all**, `0028_membership_offer_stop`: a third mark on a membership,
  `offer_stopped_at`, for a renewal that stopped because the host switched her membership off
  while the member's month was running. Only the member takes it back, with "Keep my membership",
  once the membership is on again. It was first stored as the member's own stop, and Astra showed
  that people were then told the wrong reason. The member calls' migration (part two) becomes
  `0029`; the rulebook's table and plan 21 say so.
- **Files.** `join.ts` also holds the one check of everything a new promise needs (`mustBeOpen`)
  and the lock on the two people. The answers to an offer of less time are in `ending.ts`; the
  offer itself is made in the step that cuts the hours, `changeWeeklyHours` in
  `booking/calendar.ts`.
- **An invitation is a membership row** with the status `invited`. Inviting the same person again
  while it is open keeps that row and gives it a new invitation id (the old link stops working).
  One that is taken back or runs out is closed as ended with nothing to clean up, and inviting
  after that makes a new row.
- **When the host changes the price or the time, or switches her membership off,** a joining or
  resuming that is still at the card step is undone in the same step, like an open invitation.
- **Room for bringing someone back** (a stopped renewal switched back on, an offer of less time
  taken back) is stricter than the safety net: the member must fit beside everyone who wants a
  next month, so that bringing one member back never costs another their place.
- **"Resume" names the version of the membership the page showed**, and is refused if the host
  changed it meanwhile, so nobody agrees to terms they did not see.
- **A month that replaces one whose hold the bank let go** is accepted whatever the switches and
  the room say: it stands for a month that had started.
- **A stop on a month that has not started** (a payment being tried, or a renewal only just
  written down) pauses at once and cancels the open payment, whoever stops it.
- **"No thanks" to an offer of less time** is the host's stop with its reason kept, so the pause
  at the month's end says why.
- **Decided while building:** when the host switches her membership off, a payment that is still
  open in our books is cancelled even if a hold was placed at Stripe a moment before. What we
  have not recorded as held has not started; the hold is let go and nothing is charged.
- **The preview of a change of hours** makes the change inside a step that is then thrown away.
  It uses the same checks and the same room calculation as saving, so the two cannot drift apart.
- **Not possible, so not proven:** "two people joining for the last place at the same moment".
  Every invitation already holds a place of its own. The script proves it for two paused members
  resuming for one place.

## Astra's reviews of the code of 1b (18 November 2026)

Three rounds: not ready, ready with defects listed, ready.

**First round, twelve defects, all fixed.** The ones that mattered most: switching the membership
off and on again within a month would have let members renew without being asked; "Resume" from
a page that was out of date could have recorded a price and time the member never saw; taking an
offer of less time back could have revived a renewal after its deadline, or withdrawn a different
offer than the one the button was shown for; and undoing a stop took its locks in an order that
could have collided with pausing or closing an account.

**Second round.** Most fixes confirmed. What was left came from one shortcut (the member's own
mark reused for the host's switch) and is why the third mark exists now. Also fixed: a month that
had started was refused its replacement while the membership was off; a stop on a renewal only
just written down did not cancel its payment; an offer of less time could be made for a month
that was already over; a "Join" that was never finished kept a hidden page open.

**Third round: ready.** Two small points, both fixed: the clock is read again once the lock is
held when a cut in hours is saved, and the "paused" email says that the host switched the
membership off, not that it is off now.

## CodeRabbit's review of 1b (pull request 35, 18 November 2026)

About 31 comments: 8 marked major, 2 outside the changed lines, about 21 smaller.

**Taken**
- **Deadlines are judged when a step really happens**, not when it was asked for. A request can
  arrive just before a deadline and wait for a lock until after it. "Join" (the 24 hours), "Keep
  my membership" and the answers to an offer of less time (the month's end), and "Pay now" (the
  card step's time and the 7 days) now read the clock again once they hold their locks.
- **"Cancel now" promises nothing while the money is being taken at that very moment.** The member
  is asked to try again in a minute, instead of being told "nothing was charged" and then charged
  and paid back.
- **The wording a person agrees to is the wording the page showed**: "Join" and "Resume" name its
  version and are refused if it changed while the page was open.
- **A confirmation belongs to the terms it was worked out for**: the mark of a membership preview
  now includes the switch, price and time the host is confirming.
- **The sentences a member agrees to** now tell "Cancel now" apart from cancelling the normal way,
  which does not let the hold go. (One for the lawyer's reading before launch, like the rest.)
- Invitations that ran out are ended last in the helper's round, and a failure there never stops
  the money work. An invitation email is never delivered after the invitation ran out. An
  invitation's own record says "open" again when a "Join" is undone. A link typed in capitals
  works. A price is only lowered for someone who is still a paying member. A stretch of hours
  that is no longer there cannot be "moved". At the card step, a hidden page is open for the
  card step's time, not the invitation's.
- The rulebook now names all three stops, lists the stored statuses correctly, and says that the
  host can undo the pause after a "No thanks" while the month runs.

**Not taken, and why**
- *Invitations kept when the same cut pauses a member whose payment was open.* By the rulebook's
  row 12, invitations give way before members; the host invites again.
- *The record of a lowered price naming month 5 when a lost hold makes month 5 a replacement at
  the old price.* The months themselves are right; the line records when the price was lowered.
- *Following imports to prove no page can start a membership.* The check looks for direct use,
  and there are no membership pages yet; part three's own review covers its pages.
- *A time limit on waiting for a host's calendar lock in the helper.* Every job that touches a
  host's calendar waits for that lock in the same way; the invitations now run last.

## The pay-back's follow-up, hardened (27 November 2026)

Not a new feature and no decision of the founder's: a weakness named at the end of
`plans/50-part-1-gifts-owed-back.md` ("Known, and left") and fixed here. A pay-back whose
answer from Stripe never arrived is now followed up exactly as a call's refund is
(`reconcileOperations` in `src/lib/payments/jobs.ts`), and as a tip's or a contribution's
refund is since pull request 113. Why it matters: a pay-back that is called "not made" is
sent again as a new try an hour later. A pay-back is nearly always a part of the month's
charge, so enough of the charge is left for that new try to pay the member a second time.

What changed, in `src/lib/membership/payback.ts` and `recover.ts`:

1. **The first request has a last moment.** Whoever writes a try down sends it at once: no
   later than 30 seconds after it was written down (by the database's clock, read last of
   all), and each sending is given up after 10 seconds (the Stripe library sends once more
   by itself when the connection was closed under it, so two are allowed for). Together
   that is shorter than the minute the helper waits before it looks. So when the helper
   looks, the first request has either reached Stripe or will never be sent. A writer that
   is too late sends nothing and leaves the try to the helper, which sends it under the same
   label.
2. **A repeat is not believed as it comes back.** Under the same label Stripe returns its
   first answer, as it was then. The refund is now asked about by its own number, and booked
   as it stands now: paid, still on its way, or failed since.
3. **A "no" to a repeat is not the end.** Stripe's complete list of the charge's refunds is
   searched for this line and this attempt first. A refund that is there is booked, once.
   Only when it is not there did the try not happen: owed again, a new try in an hour, as
   before.
4. **"Not on Stripe's list" has to wait.** Once a try is too old to repeat (23 hours), a
   search that finds nothing is final only if it began 24 hours after the try was written
   down. Until then the try stays open and is looked at again. A search that takes longer
   than 20 seconds counts as not made.
5. **Before any new try, a look for the old one.** A new try only exists because the try
   before it was recorded as "not made". Before a try after the first is sent, by whoever
   sends it (the sender and the helper alike), Stripe's list is searched for a refund of an
   earlier try of the same line that is not over. If one is there, it is the line's refund:
   it is booked as the new try's outcome and nothing is sent. If Stripe has not finished
   that refund yet, the line waits "at Stripe" with it, and the helper's asking about it by
   its number now books the answer for the try the line is on, not for the try the refund
   itself names (it used to read the try from the refund, and would have thrown the answer
   away for ever).
6. **The hour before a new try starts when the "no" is written down,** not at the start of
   the helper's round, which may have begun long before.

The search of Stripe's list (`refundOnStripesList`, `isTry`, `earlierTryAtStripe`) is now
one piece of code for contributions and memberships, in `src/lib/payments/refund-tries.ts`:
both tell Stripe the line and the try with every request. The waiting times and "a look is
not the action" were already one definition (`SEARCH_WITHIN_MS`, `SETTLED_AFTER_MS`,
`REFUND_SEND_WITHIN_MS`, `REFUND_SEND_TIMEOUT_MS`, `lookUp`).

**Not changed:** a line that is "done" stays done; a line "at Stripe" is asked about by its
own number; nothing new is sent while the month's charge is disputed, and a try written down
before a dispute is still followed to its answer; the email to the member is written in the
step that confirms the pay-back, also when that step is this follow-up. A contribution's
refund behaves as before: its three search functions only moved.

**How it was tried.** `scripts/membership-check.ts` has a new journey (29) against Stripe's
test mode, answering in Stripe's place only where test mode cannot be made to refuse or fail
a refund. Requests to Stripe are counted and their labels read, not only the refunds that
exist afterwards. A part pay-back that went through unheard and whose repeat is refused is
booked once and not sent again (on the old code the same case paid the member twice: 5.00
and 5.00); a refused repeat with nothing on the list is owed again, the hour counted from
the refusal although the helper's round began 50 minutes earlier, and sent once after it,
with 10 seconds and no repeats by the library; a repeat that returns an old "succeeded" for
a refund that has failed since is not booked as paid; a line that was moved on although its
earlier try was paid is not sent again, by the sender and by the helper alike: the earlier
refund is booked, also when Stripe had not finished it yet; after 23 hours a missing refund
stays open, and after 24 it is final; after 23 hours a refund on the list is booked without
a second request; a writer that is too late sends nothing, and the helper sends it once,
under the same label; a "no" to a mere look at Stripe decides nothing. After Astra's check
(below) the journey also proves the order of things with a search that is made slow: a
search begun before the 24 hours were over is not final, a sender whose last moment passes
during its look for an earlier try sends nothing, and the hour is counted from after the
search; a refund of the same line and another try is not taken for this try; an earlier
try's refund that fails while the line waits on it makes the line owed again; and a "no" to
the look for an earlier try stops the sender and the helper alike.
Each of these was also run once against code broken on purpose in the matching place (the
last moment looked at before the search, "final" decided after it, the hour taken from the
round's start, the try read from the refund, the attempt left out of the search): every one
failed its check, and the code was put back.

Plan 50, part 2 was merged while this was being built. Its check in
`scripts/member-calls-check.ts` only says that a confirmed pay-back failed (Stripe's test
mode really paid it), and then sends the next try. That try now finds the refund alive on
Stripe's list and books it, where it used to pay a second time; the check says so now. A
refund that really failed is passed over, and the next try goes out as plan 50 means it to.

## Astra's check of the pay-back's follow-up (27 November 2026): "merge after fixes"

Five points. Three were taken, two are left and named.

1. *A helper that stands still for more than an hour at one exact step* (after it has read
   that a try is open, before its repeat leaves), while a second helper is refused on the
   same try and nothing is on Stripe's list: the line moves on, is paid as a new try, and
   the first helper then wakes up and sends the old try, which Stripe pays too. **Left, and
   named.** It is the same for a call's refund and a contribution's, so it should be decided
   for all three at once, not for memberships alone. Astra's fix (a short life for the
   helper's look) makes the moment smaller and cannot close it: the Stripe library can still
   send a request once more by itself after such a standstill. It needs two helpers, a
   refusal, and a standstill of over an hour in a step that takes a fraction of a second.
   Proposed as a follow-up of its own.
2. *A pay-back that Stripe confirmed and that fails days later stays booked as paid.*
   **Not here:** it was so before, it is in the code for Stripe's messages
   (`src/lib/disputes/takeback.ts`, `months.ts`), and plan 50, part 2 is building exactly
   that right now (a confirmed pay-back that fails is owed again as a new try). This
   change fits it: a failed refund on Stripe's list is passed over by the look for an
   earlier try, so the new try goes out.
3. *Pay-backs that cannot be sent could keep others waiting.* The helper tries the 50 oldest
   pay-backs that are owed; one whose month has an action without an answer is refused under
   the lock and stays where it was, so fifty of those would keep a newer pay-back of another
   month waiting. A try that now stays open until its 24 hours are over makes that a little
   more likely. **Taken:** such lines are left out before the 50 are picked, as a
   contribution's refunds already are.
4. *The checks did not pin the order of things:* a sender that looked at its last moment
   before its search, or a helper that decided "final" after its search, would have passed.
   **Taken:** the three cases with a slow search, above.
5. *Some checks proved less than they said.* **Taken:** the 10 seconds and "no repeats" are
   now read from a first try too; the search for this try is shown a refund of the same line
   and another try; the refund a line waits on is made to fail as well as to succeed, and
   how often it is asked about is counted; the refused looks are counted, and the look
   before a new try is refused too.

Astra also confirmed: the six rules stand in the same order as for a contribution; two
helpers cannot book the same try twice; closing a month keeps what is owed, and a finished
month is reopened when time is given back; a dispute still stops new tries; moving the three
search functions changed nothing for contributions; holds, takings and letting go are
followed up as before. For going live: the app and its helper are put out together, because
an older sender has no last moment for sending (rule 5 covers a try it left behind, not a
request it still holds).

## A helper that stood still (27 November 2026): point 1 above, decided for all three refunds

Point 1 of Astra's check above is decided and built, for a call's refund, a tip's or a
contribution's refund and a membership's pay-back together. The whole reasoning, with an
example, is at the end of `plans/50-part-1-gifts-owed-back.md` ("A helper that stood
still"). In short, for a pay-back:

- **Before a repeat leaves, the helper looks at the try once more, and the look has a short
  life.** The look waits for anybody who is writing the try's outcome down at that moment.
  If more than 5 seconds pass between that look and the sending, the helper stood still,
  and it sends nothing; the next pass looks afresh. The repeat itself is given up after 10
  seconds, and the Stripe library is told not to send it again. One piece of code for all
  three: `repeatFromFreshLook` in `src/lib/payments/refund-tries.ts`.
- **What that cannot close** is the instant between the helper's last look at the clock
  and the request leaving, and the Stripe library's own second sending after a closed
  connection. Nothing of ours runs after our last check, so this is named and left.
- **So what is left is at least said out loud.** A helper that holds a refund Stripe has
  paid, for a try that is written down as "not made", changes nothing and tells the
  founders by email, once (`sayIfPaidAlthoughNotMade`). If the pay-back is still waiting
  to go out again, its next try finds that refund on Stripe's list and counts it (rule 5
  above), and the member is paid once. If a later try had already gone out, the member has
  the money twice, it is Connect's cost, and the email is how it is known.
- **Not built:** a regular comparison of every charge's refunds at Stripe with the app's
  lines. It would cost a request to Stripe per refunded charge, again and again, for a
  path that needs two helpers, a refusal, enough money left on the charge and a standstill
  of over an hour beginning inside an instant.

Tried in `scripts/membership-check.ts`, journey 29, part 11.
