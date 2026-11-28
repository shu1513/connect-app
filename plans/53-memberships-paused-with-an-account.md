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
4. **What the member keeps. (builder)** Their place in the host's member list, their own price
   and their own time. (As with every paused membership, "who has been a member longest" counts
   anew from the day they resume.)
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
    account is still paused or closed. If a person has lifted the pause in between, it does
    nothing: it must not end a booking that was made after the lift.
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
