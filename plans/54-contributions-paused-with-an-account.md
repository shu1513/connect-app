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
   is marked as paused with the moment. A payment of it that was only held, or still to be
   tried, is given up and its hold let go. Money that was already taken is not touched. The
   saved card is kept.
3. **While it is paused. (builder)** No month's payment is written, held or taken. The
   contributor can still stop it for good ("Stop contributing").
4. **When the pause is lifted. (founder)** The mark is cleared, in the same step as the lift,
   where the other of the two accounts is in use as well. The months whose day passed during
   the pause are skipped and never collected afterwards. From the next month's day on it is
   charged again by itself. The contributor gets an email: it carries on, when, and how to stop.
5. **Who is told at the pause. (builder)** The contributor: paused because one of the two
   accounts was paused, nothing is charged meanwhile, and it carries on by itself when that is
   over unless they stop it. Never which account, or why. The host gets no separate email (as
   today, where a contribution ends for a reason nobody is told about).
6. **Both marks can stand at once. (builder)** The founder's switch and a paused account are two
   marks. A month is written only when neither stands, and each skips its own months when it
   is cleared.
7. **What still ends a contribution for good. (builder)** A closed account, a block, a suspended
   host page, the end of the project, a bank dispute, the contributor's own stop: unchanged.
8. **The helper's net. (builder)** Where the helper finds a running monthly contribution with a
   paused account and no mark (it should not happen), it sets the mark. It used to end it.

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
