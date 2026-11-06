# Connect

A web app where a customer pays for a private one-to-one video call with a host.

This is step 1 of the build: a private two-person video call with trustworthy time tracking.
The full plan for this step is in [plan.md](plan.md).

**License:** all rights reserved. This code is published to be read, not reused. See [LICENSE](LICENSE).

## Running it on this computer

Two programs need to be running, each in its own terminal window:

```bash
npm run dev      # the website, at http://localhost:3000
npm run worker   # the helper that closes rooms at their end time
```

The database is Postgres (database name `influencer_app`). Settings and secrets live in
`.env.local`, which is never saved to version history.

## Test accounts

Public sign-up is off. Three test accounts exist: a host, a customer and a stranger.
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

## How changes get in

Every major module follows the same steps:

1. A plan is written (`plan.md`), reviewed, and approved by the founder.
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
| The room closer | `worker/closer.ts` |
| Database tables | `src/db/schema.ts` |

## Not done yet

- LiveKit cannot reach this computer from the internet, so real calls are not recorded in the
  attendance log yet. That needs the app to be online, or a secure tunnel, and the address
  entered in LiveKit's webhook settings.
- Real-device tests on phones (they also need a secure public address for the camera to work).
