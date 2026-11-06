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

Public sign-up is off. Four test accounts exist: a host, a customer, a stranger and an admin.
Their emails and passwords are in `test-accounts.local.md` (also kept out of version history).
To create them again on a fresh database: `npm run db:migrate` then `npm run seed`.

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
  charging at once, and recovery after a crash.

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
| Database tables | `src/db/schema.ts` |

## Not done yet

- Real-device tests of the video call on phones, and with two people on camera.
- Going live with real money: this needs the company's own Stripe account and Stripe's approval.
- The modules after payments: accounts and profiles, calendar and booking, safety, notifications,
  "available now" calls, messaging and search.
