# Plan 54: when an account is paused, its monthly contributions are paused, not ended

27 November 2026.

## Why

Plan 53 made a paused account pause its memberships instead of ending them. Monthly
contributions to a host's project still ended for good with a pause. The founder asked "should
monthly contributions be paused too instead of ended?", was told what the builder would do, and
answered "Yes, pause them too".

A contribution buys nothing (no call time, no reward), so nothing has to be paid back. And the
app already knows how to make a monthly contribution wait: when the founder's switch stops
covering a host, her contributions are marked, no month is written, and the months that pass
are skipped for good (plans/25, choice 13). A paused account uses the same idea with a mark of
its own.

## What the founder decided (27 November 2026)

- Monthly contributions are paused with an account, not ended.
- After the pause is lifted they carry on by themselves; each contributor is told, with a clear
  way to stop. (The builder's suggestion, which the founder accepted with "Yes, pause them too".)

Everything else below is the builder's.

## Decisions

1. **Which contributions. (builder)** Monthly contributions that have begun (their first payment
   was held), where the paused person is the host or the contributor. A contribution made once,
   a tip, and a monthly one still at its first card step end as today: their one payment, if it
   was not taken yet, is let go.
2. **What happens at once, in the same step as the account's pause. (builder)** The contribution
   is marked as paused with the moment the account was paused (one moment for both). A payment of it that was only held, or still to be
   tried, is given up and its hold let go. Money that was already taken is not touched. The
   saved card is kept.
3. **While it is paused. (builder)** No month's payment is written, held or taken. The
   contributor can still stop it for good ("Stop contributing").
4. **When the pause is lifted. (founder)** The mark is cleared, in the same step as the lift,
   where the other of the two accounts is in use as well. The months whose day passed during
   the pause are skipped and never collected afterwards; the moment that separates "passed"
   from "still to come" is read once the lift holds its locks. From the next month's day on it
   is charged again by itself. The contributor gets an email: it carries on, when the next
   payment is held (or that it can be held from today, or that the founder's switch still
   keeps it waiting), that a payment is only held at first and taken three days later, and how
   to stop.
5. **Who is told at the pause. (builder)** The contributor: paused because one of the two
   accounts was paused, nothing is charged meanwhile, and it carries on by itself when that is
   over unless they stop it. Never which account, or why. The host gets no separate email (as
   today, where a contribution ends for a reason nobody is told about).
6. **Both marks can stand at once. (builder)** The founder's switch and a paused account are two
   marks. A month is written only when neither stands, and each skips its own months when it
   is cleared.
7. **What still ends a contribution for good. (builder)** A closed account, a block, a suspended
   host page, the end of the project, a bank dispute, the contributor's own stop: unchanged.
8. **The helper's nets. (builder)** Where the helper finds a running monthly contribution with a
   paused account and no mark (it should not happen), it makes it wait as the pause itself
   would have: marked with the moment the account was paused, open payments given up, the
   contributor told. It used to end it. And where a contribution still waits although neither
   account is paused any more, it lets it carry on.

## What stays as it is, on purpose

- **No new yes from the contributor after a pause.** They agreed to a monthly payment until
  they stop it; a pause changes neither the amount nor the project. They are told before the
  next payment and can stop with one press. (A member must say yes again because resuming
  starts a new paid month of call time on the host's terms of that day.) In the lawyer file.
- **No time limit on the pause.**
- **The published legal documents are not changed here.**

## What gets built

- `contributions.account_paused_at` (migration).
- `src/lib/contributions/account-pause.ts`: `pauseContributionsOf`, `resumeContributionsOf`.
- `src/lib/contributions/monthly.ts`: nothing is written while the mark stands; the net.
- `src/lib/contributions/emails.ts`, `views.ts`: the two emails and the reason's words.
- `src/lib/safety/reports.ts`: `pause` and `liftPause` call them.
- The contributor's pages say "paused".
- The sentences of the pause by the app (plan 52) say "paused" where they said "end".

## How it is checked

- `scripts/contribution-check.ts`: the journey that pauses an account now expects a pause; new
  checks for no month while paused, the lift, the skipped months, the email, the next month,
  a host's pause, a payment made once, both marks together, and stopping while paused.
- `safety-check`, `auto-pause-check`, the automatic tests.

## Astra's check of the build (27 November 2026): "not ready", 12 points

Taken:

- **The helper's net marked a contribution with the moment it noticed, not the moment of the
  pause**, so a month that fell due in between could be charged after the lift; and it left an
  open payment open. It now does exactly what the pause does (decision 8).
- **The lift read its moment before it held its locks**: a month whose day fell during that wait
  was not skipped. The moment is read under the locks now, as saving the founder's switch does
  it; and the account and its contributions carry one and the same pause moment.
- **The helper's 7-day job** could end a contribution for good on a payment it had read before
  the pause gave that payment up. It looks again right before ending.
- **A lift in the instant the helper's net set a mark** left the contribution waiting for ever.
  The helper's second net lets it carry on (decision 8).
- **The emails**: a promise of a notice "before" the next payment, which nothing enforced (it now
  says that a payment is only held at first and taken three days later); a payment date that
  could lie in the past or belong to a skipped month; a promised date while the founder's switch
  still keeps the contribution waiting; "nothing is held or taken" where a payment already
  under way can still land and is then let go or paid back; and the email about a hold that was
  let go, which said the contribution "goes on as usual".
- **The project pages** said "You contribute ... a month" during the pause.
- **Checks**: the emails' words, the net followed by a real lift, both marks together.

Not taken, and why:

- **A bank's "never try this card again" that arrives for a payment the pause has just given
  up** is not kept, so a later month tries that card once more. Saving the founder's switch has
  given payments up in the same way since plans/25, with the same effect; it is a matter of
  that code, not of this plan. A follow-up of its own if wanted.
- **A new card hold that the helper sent off in the very instant of the pause** can still appear
  on the contributor's card for a moment before it is let go. The sentences no longer promise
  otherwise.
- **A pause of more than 50 years** (the sum that lists passed months stops after 600).

