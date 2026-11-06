# Connect

A web app where a customer pays for a private one-to-one video call with a host.

Built so far:

1. **Video call with trustworthy time tracking.** Plan: [plans/01-video-call.md](plans/01-video-call.md).
2. **Payments** (development only, in Stripe's test mode). Plan: [plans/02-payments.md](plans/02-payments.md).

**License:** all rights reserved. This code is published to be read, not reused. See [LICENSE](LICENSE).

## Running it on this computer

Two programs need to be running, each in its own terminal window:

```bash
npm run dev      # the website, at http://localhost:3000
npm run worker   # the helper that closes rooms at their end time
```

The database is Postgres (database name `influencer_app`). Settings and secrets live in
`.env.local`, which is never saved to version history.

Payments use a Stripe **sandbox**, so no real money moves. The app refuses to start with a live
Stripe key. For Stripe to reach the app while developing, the app needs a public https address
(a tunnel); after that address changes, run `npx tsx scripts/stripe-webhook-setup.ts https://the-address`.

## Test accounts

Anyone can sign up at `/signup`. Four ready-made test accounts also exist: a host, a customer, a
stranger and an admin. Their emails and passwords are in `test-accounts.local.md` (also kept out of
version history). To create them again on a fresh database: `npm run db:migrate` then `npm run seed`.

Emails go into an outbox. With both `RESEND_API_KEY` (a Resend account) and `EMAIL_FROM` (the sending
address, on the company's own domain set up at Resend) in `.env.local`, the helper sends them; without
either, nothing is really sent and the full text is shown on the admin "Emails" page.
`RESEND_WEBHOOK_SECRET` lets Resend tell us about bounces and complaints, so bad addresses are never
written to again.

Google sign-in is switched on by adding `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` to `.env.local`.
Without them the Google button is simply not shown.

The admin account logs in with a password plus a 6-digit code from an authenticator app. For the test
admin, `npx tsx scripts/secure-test-admin.ts` sets that up once (with the app running) and saves the
secret in `test-accounts.local.md`; `npx tsx scripts/admin-code.ts` then prints the current code.

The identity check (Stripe Identity) needs a restricted Stripe key with the "sensitive verification
results" permission in `STRIPE_IDENTITY_KEY`, so the app can read "18 or older". Without it the check
runs but nobody passes. `SUPPORT_EMAIL` is the address people are told to write to.

## Checking that it works

```bash
npm test            # the time-counting rule and the entry rules
npm run typecheck   # looks for coding mistakes
npm run lint
```

Testing tools:

- `npx tsx scripts/send-test-messages.ts <call-id>` pretends to be LiveKit and sends a realistic
  set of signed "connected / disconnected" messages for a call, so the attendance log and results
  page can be checked without two phones.
- `npx tsx scripts/room-status.ts <call-id>` asks LiveKit who is in a call's room right now.
- `npx tsx scripts/payments-check.ts` runs real payment journeys against the Stripe sandbox and checks
  every result: holds, charges, refunds, cancelling, reviews, declined and foreign cards, two helpers
  charging at once, and recovery after a crash. Add `--payouts` to also check paying hosts (the test
  host must have finished payout setup on the Hosting settings page first).
- `npx tsx scripts/booking-check.ts` runs real booking journeys against the local database and the
  Stripe sandbox: asking, several people asking for the same time, accepting, declining, time-outs,
  the limits, "never two calls at once", the saved card, the automatic hold, a card that fails, and
  the cut-off. Before running it: stop the helper (it would do some of the steps itself); have
  Stripe test keys in `.env.local`; and have `host@test.local` (from `npm run seed`) with payouts
  set up. Be aware that it **replaces the calendar and weekly hours of `host@test.local`**, and
  that it runs the booking jobs with a pretend clock set days ahead, which ends or cancels any
  other open requests and unpaid bookings in the local database. Use it only on a database whose
  bookings you do not mind losing.
- `npx tsx scripts/notifications-check.ts` runs the notification journeys with a pretend sending
  service: reminders before calls and about requests, the unsubscribe link, and sending (retries,
  failures, bounced addresses, two helpers at once). Needs the app running. Stop the helper first:
  the script runs the reminder writers with a pretend clock, which also writes reminders for any
  other calls in the local database that fall in the shifted windows, and a running helper would
  send those (and this run's emails) if sending is on.
- `npx tsx scripts/now-check.ts` runs the "available now" journeys against the local database and the
  Stripe sandbox: switching availability on and off, which lengths fit, a free call now asked and
  accepted, time-outs, declines and the 24-hour rule, a paid call now with the money held at once,
  and a refused card cancelled at the 2-minute deadline. Same cautions as `booking-check.ts`.
- `npx tsx scripts/safety-check.ts` runs the safety journeys: the admin's second login step, pausing,
  blocking, "End call and report", reports and the founder's actions, the identity check, and the
  stop switches. Needs the app running and the test admin set up as above.
- `npx tsx scripts/accounts-check.ts` runs real sign-up and profile journeys against the app running
  on this computer: confirming an email, resetting and changing a password, attempt limits, handles,
  host approval, social media names, and closing an account. It removes the accounts it made.

## How changes get in

Every major module follows the same steps:

1. A plan is written (in `plans/`), reviewed, and approved by the founder.
2. The code is built on its own branch and opened as a pull request.
3. An independent review of the code; only the valuable findings are taken.
4. CodeRabbit reviews the pull request.
5. The automatic checks (`.github/workflows/checks.yml`: lint, types, tests, build) must be green.
6. Only then is it merged into `main`.

## Where things are

| What | Where |
| --- | --- |
| The counting rule (host time, customer time, time together) | `src/lib/attendance/calc.ts` |
| When a room is open, and who may enter | `src/lib/calls.ts` |
| Everything that talks to LiveKit | `src/lib/video/livekit.ts` |
| The join check (hands out entry passes) | `src/app/api/calls/[id]/token/route.ts` |
| The attendance log (receives LiveKit's messages) | `src/app/api/livekit/webhook/route.ts` |
| The always-on helper (closes rooms, runs the payment jobs) | `worker/closer.ts` |
| The pricing rule (charge, fee split, refunds) | `src/lib/payments/pricing.ts` |
| Payment stages and timing rules (cancelling, holds, paydays) | `src/lib/payments/rules.ts` |
| How "never twice" is guaranteed | `src/lib/payments/operations.ts` |
| The four money actions (charge, release, refund, pay the host) | `src/lib/payments/actions.ts` |
| The scheduled payment work and crash recovery | `src/lib/payments/jobs.ts` |
| Stripe's message inbox | `src/app/api/stripe/webhook/route.ts` |
| Login settings (sign-up, confirmation, Google, attempt limits) | `src/lib/auth.ts` |
| The gate: who may use the app | `src/lib/session.ts` |
| Sending email (saved, not sent, while developing) | `src/lib/email.ts` |
| Handle rules and social media name rules | `src/lib/profiles/handles.ts`, `social.ts` |
| Host profiles, approval, social proof, closing accounts | `src/lib/profiles/profiles.ts` |
| A host's public page | `src/app/h/[handle]/page.tsx` |
| The rule for open times (weekly hours, breaks, clock changes) | `src/lib/booking/slots.ts` |
| Booking deadlines, limits and stages | `src/lib/booking/rules.ts` |
| Asking for a call, accepting, declining | `src/lib/booking/bookings.ts` |
| The scheduled booking work (time-outs, holds, cut-off) | `src/lib/booking/jobs.ts` |
| A host's calendar settings | `src/lib/booking/calendar.ts` |
| What counts as an admin login | `src/lib/admin-gate.ts`, `src/lib/session.ts` |
| Blocking, reports, the founder's actions, ending a call for safety | `src/lib/safety/` |
| The identity check | `src/lib/safety/identity.ts` |
| The rules of the site (one place) | `src/lib/terms.ts`, shown at `/rules` |
| Sending emails (the outbox, retries, bounces) | `src/lib/notifications/delivery.ts` |
| Reminder emails and the unsubscribe link | `src/lib/notifications/reminders.ts`, `unsubscribe.ts` |
| Database tables | `src/db/schema.ts` |
| The rule that refuses overlapping calls for one person | `drizzle/0010_busy_no_overlap.sql` |

## Not done yet

- Real-device tests of the video call on phones, and with two people on camera.
- Going live with real money: this needs the company's own Stripe account and Stripe's approval.
- Before real people sign up: a real email-sending service, real terms and privacy pages, and
  Google sign-in tried with a real Google account.
- The modules still to come: "available now" calls, messaging and search.
