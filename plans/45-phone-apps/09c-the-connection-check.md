# Phone apps, part 09c: the connection check before a call

**Status:** a plan only. Written 20 November 2026 by the builder alone. Part of plan 45. The
first draft left this feature out; the founder asked for every feature, and Astra's check
said it needs an owner. It is its own small part.

## For the founder: what this is

Before a call, a person can check whether their connection is good enough, and is warned if
it is not. It never stops anyone from joining (your decision in plan 12).

## What is there today (read in the code)

`src/components/connection-test.tsx`, `src/lib/connection/` and `/api/connection-test`
(plan 12): on the call's page before joining, and on a page of its own, the browser joins a
test room of its own, sends a made-up moving picture for a few seconds, and reads how much
gets through; the server turns the numbers into an answer by its own rule
(`src/lib/connection/answer.ts`): fine, or a warning with what to try. It can be run again.
It stops by itself when the person presses Join. Nothing is kept or shown after the call.
The address accepts only what the website's own page sent.

## Decisions (the builder's)

1. **The same check, with the phone's kit:** the app joins the same kind of test room through
   a twin of the address under the door, sends a made-up picture (not the camera: the check is
   about the connection, and needs no permission), reads what LiveKit's kit reports, and sends
   the numbers to the server, which answers with its own rule. If the phone's kit does not
   give one of the numbers the website uses, the server's rule is handed what there is and
   says "could not tell" rather than "fine".
2. **Where it is:** on the call's page before joining, as on the website, with "Check again";
   it stops when Join is pressed. And from the Account page, on its own.
3. **It only warns.** No button is taken away because of it.
4. **On mobile data** the check uses a few megabytes; the screen says so before it starts on
   a connection that is not Wi-Fi.

## How it is tried

- `connection-check` unchanged and green; the twin answers the app's numbers with the same
  rule, refuses a stranger, and says "could not tell" for missing numbers.
- On the Android test phone, with pictures: a good result; a poor one, with the test phone's
  network made slow on purpose; "Check again"; Join pressed during a check.

## What cannot be tried here

A real mobile network; an iPhone.

## Keeping the 4.9%

No money.
