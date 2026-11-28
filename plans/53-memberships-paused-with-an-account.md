# Plan 53: when an account is paused, its memberships are paused, not ended

27 November 2026.

## Why

Until now a paused account lost its memberships for good: every member of a paused host, and
every membership of a paused member, ended at once, and lifting the pause did not bring them
back. Plan 52 built a pause that the app makes by itself and left it switched off for exactly
that reason. The founder: "instead of ending the memberships, maybe we should pause the
memberships", and then "Yes, build it" to "build 'memberships are paused, not ended' next, then
switch the automatic pause on".

Memberships already have a "paused" state (plans/19, "A paused membership, and resuming"): it
costs nothing, gives no member time, keeps the member in the host's list, and the member can
resume by themselves. It is used when a payment fails, after "Cancel now", and at a month's end.
This plan uses that state for a paused account too.

## What the founder decided (27 November 2026)

- A paused account's memberships are paused, not ended.
- After that is built, the pause the app makes by itself (plan 52) is switched on.

Everything else below is the builder's.

## Decisions

1. **Which memberships. (builder)** Every membership the paused person has, as a host and as a
   member, in which there is a member: active, waiting for a payment, or in the middle of
   resuming. An invitation that was not accepted yet, and a first joining that never got its
   payment, end as today: nobody is a member there, so nothing is lost.
2. **What happens at once, in the same step as the account's pause. (builder)** The membership
   is paused with the reason "one of the two accounts was paused". It does not renew, and its
   card is used for nothing new. A month that was not paid yet is given up and the hold on the
   card let go.
3. **The month that was paid for. (builder)** Exactly what an ending does today: the member's
   coming member calls are cancelled at no charge, and the time they had not used is paid back
   to their card. Nothing of it expires. Time they used stays paid for. A month a bank is
   disputing is left as it stands.
4. **What the member keeps, and what they do not. (builder)** They keep their place in the host's
   member list, and while the membership is paused their own price and time stay written on it.
   But resuming is like joining again, as from every pause: the member gets the host's
   membership **as it is on that day**, price and time included, and agrees to that. If the host
   has raised her price since they joined, they pay the new price from then on. (Their own,
   lower price is not carried over a pause today, whatever caused the pause. Whether a pause
   with an account should be an exception is a question for the founder; it is not built.)
   As with every paused membership, "who has been a member longest" counts anew from the day
   they resume.
5. **Resuming. (builder)** The member resumes by themselves, as from any pause: the page shows
   the host's offer as it is now, they tick the box, enter a card, and a new month starts.
   Nothing is charged without that. It works only once both accounts are active again (that
   rule exists), and only once the old month's tidying-up is done.
6. **Who is told. (builder)** At the pause: the member, and the host, that the membership is
   paused because one of the two accounts was paused, that unused time is paid back, and that
   resuming is possible once that is over. When the pause is lifted: every member whose
   membership was paused for this reason gets an email with the way to resume. Nobody is told
   which of the two accounts it was, or why it was paused.
7. **What still ends a membership for good. (builder)** A closed account, a block, a suspended
   host, a bank dispute, the host's own "End membership": unchanged.
8. **A pause by hand and a pause by the app are the same pause. (builder)** Both pause the
   memberships.
9. **Monthly contributions to a project still end with a pause. (builder)** The founder spoke of
   memberships. A contribution has no "paused" state, and a contributor loses nothing they paid
   for when it ends: they can start one again. Said to the founder.
10. **A pause that is lifted at once. (builder; left over from Astra's check of plan 52)** The
    tidying-up after a pause (ending waiting requests, cancelling calls) looks first whether the
    account is still paused or closed, and it only ends what was there at the moment of the
    pause. A request or a call that was made after a person lifted the pause is never ended by
    it, however late the tidying-up runs.
10a. **A late clean-up never touches a resumed membership. (builder, after Astra)** The clean-up
    after a pause keeps to the period that was paused. If the member has resumed meanwhile, the
    new month and its calls are left alone, and a later pause has a clean-up of its own.
11. **The pause by the app itself is switched on. (the founder)** The switch `AUTO_PAUSE` is taken
    out: the helper runs the round about every 10 minutes. What is still open before real people
    use Connect is in `docs/for-the-lawyer.md`, section 26.

## What stays as it is, on purpose

- **No time limit on a paused membership.** As today: it stays paused until the member resumes
  or the host ends it.
- **Resuming is never automatic.** Money is not taken again without the member's own yes.
- **The published legal documents are not changed here.** Where they say a membership ends when
  an account is paused, the lawyer file says what the app now does.

## What gets built

- `src/lib/membership/state.ts`: `pauseForAccount`, and `pauseMembershipsOf` beside
  `endMembershipsOf`.
- `src/lib/membership/ending.ts`: the clean-up, the pay-back rule and the helper's round also
  take a membership that was paused with an account.
- `src/lib/membership/join.ts`: resuming waits for that clean-up.
- `src/lib/membership/emails.ts`: the reason "account", and the email when the pause is lifted.
- `src/lib/safety/reports.ts`: `pause` pauses memberships; `liftPause` writes to the members.
- `src/lib/profiles/closing.ts`: the tidying-up looks whether the account is still paused.
- `worker/closer.ts`, `src/lib/safety/auto-pause-rules.ts`, the admin page's note: switched on,
  and the sentences say "paused" where they said "ended".

## How it is checked

- `scripts/membership-check.ts`: its journey about endings (a block, a closed account, a paused
  account, a suspended host) now expects a pause for the paused account, with the money paid
  back, a resume refused while the account is paused, the email at the lift, and a resume that
  works afterwards.
- `scripts/member-calls-check.ts`, `scripts/safety-check.ts`, `scripts/auto-pause-check.ts`:
  still pass.
- Unit tests for the new sentences.

## For the lawyer (in `docs/for-the-lawyer.md`)

- The membership terms say what happens to a membership when an account is paused: they must
  follow.
- Money paid back on a pause that is later lifted: nothing is owed either way?

## Astra's check of the build (27 November 2026): "not ready", 14 points

Taken:

- **A cut in the host's hours, in the same instant as the pause**, wrote the host's own stop onto
  the paused membership and wiped the reason of its pause, and with it the pay-back of its
  month. A cut now leaves a membership alone that was paused or ended since the cut was worked
  out (`src/lib/booking/calendar.ts`).
- **A clean-up that ran late, beside a resume**, could give up the new month or cancel a new
  call, and could mark a later pause as tidied up. It now keeps to the period that was paused
  and marks only the pause it was begun for (decision 10a).
- **A lift in the instant between "is the account still paused?" and the ending of its requests
  and calls** (decision 10: only what was there at the moment of the pause is ended).
- **The founder's list of 14-day requests** showed a request as "settle by hand" after a pause
  with an account had already paid the first month's unused money back, which invited a second
  payment. The pay-back is now read there.
- **The health check** did not see a pause's clean-up that was late. It does now.
- **Sentences**: the member's page said "you can still book like any customer" during a pause
  with an account; the email promised a pay-back also where the month was only held, and said
  "nothing is charged" where a charge already under way can still finish and is then paid back;
  the email at the lift promised that resuming would work.
- **Checks**: the wait for the clean-up before a resume, the host's own email, a second pause in
  a later period, a late clean-up after a resume.

Not taken, and why:

- **A member call that reaches its start before the tidying-up has run, and a late cancellation
  by the member in the second between the pause and the cancelling of the call.** Both were so
  before this plan (a paused account's calls are cancelled a moment after the pause, and the
  helper cancels a call "as of the moment of the pause" when it finishes late, so that nobody
  pays for waiting: `endCallsOf`). Not made worse here; a follow-up of its own if wanted.
- **Two accounts of one membership paused, and both pauses lifted in the same instant**: each
  lift may see the other account as still paused and send no email. Holding both accounts'
  rows there could leave two lifts waiting on each other. The member's page still offers
  "Resume".
- **A second "you can resume" email** when the member's own pause is lifted later: true, and
  harmless.

## CodeRabbit (27 November 2026): one point, and the automatic security check: one

- **CodeRabbit**: the plan said a paused member keeps their own price and time, and also that
  resuming shows the host's offer as it is then. The code does the second. Decision 4 now says
  so plainly, and the founder is told (the builder had said "keeps their price").
- **The automatic security check**: the moment that decides what a pause ends was taken before
  the pause's own step, which can wait; a request made during that wait would have survived the
  pause. It is taken right after the step now.

