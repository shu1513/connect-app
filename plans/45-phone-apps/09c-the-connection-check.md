# Phone apps, part 09c: the connection check before a call

**Status:** a plan only. Written 20 November 2026 by the builder alone. Part of plan 45. The
first draft left this feature out; the founder asked for every feature, and Astra's check
said it needs an owner. It is its own small part. Read again against the code on 27 November
2026, after pull request 123: `src/lib/connection/`, `src/components/connection-test.tsx` and
`/api/connection-test` have not changed since this was written, and nothing here had to
change. It is read once more on the day it is built.

## For the founder: what this is

Before a call, a person can check whether their connection is good enough, and is warned if
it is not. It never stops anyone from joining (your decision in plan 12).

## What is there today (read in the code)

`src/components/connection-test.tsx`, `src/lib/connection/` and `/api/connection-test`
(plan 12): on the call's page before joining, and on a page of its own. The server only
hands out a pass to a private test room. **The browser does the measuring and the judging
itself:** it sends a made-up moving picture for a few seconds, reads the reports that come
back from the other end (how long a round trip takes, how much is lost), and applies a plain
rule (`src/lib/connection/answer.ts`): *good* needs two complete, different reports; *weak*
for a bad figure or an interruption; *no connection* when the room cannot be reached; *not
measured* when there is too little to go on. No measurement is sent to the server. It can be
run again, and it stops when the person presses Join. Nothing is kept or shown after the
call. The address for the pass accepts only what the website's own page sent.

## Decisions (the builder's)

1. **First prove it can be done on a phone at all.** The website makes its picture with a
   tool browsers have; whether the phone's kit can send a made-up picture without the
   camera, and hands out the same reports, is not established. The first step of this part
   is that proof, on the Android test phone. If no made-up picture can be sent, the camera's
   picture is used instead (the person is about to give that permission for the call
   anyway), and the screen says so. If the reports cannot be read, the result is "not
   measured", never "good".
2. **The judging uses the website's own rule file, read by the app, not copied,** and happens
   on the phone, as it does in the browser. The pass for the test room comes from a twin of
   the address under the door.
3. **Where it is:** on the call's page before joining, as on the website, with "Check again";
   it stops when Join is pressed. And from the Account page, on its own.
4. **It only warns.** No button is taken away because of it.
5. **On mobile data** the check uses a few megabytes; the screen says so before it starts on
   a connection that is not Wi-Fi.

## How it is tried

- `connection-check` unchanged and green; the twin hands a pass to the app's signed-in person
  and refuses a stranger; the app's tests run the shared rule on made-up reports for each of
  the four answers.
- On the Android test phone, with pictures: a good result; a poor one, with the test phone's
  network made slow on purpose; "Check again"; Join pressed during a check.

## What cannot be tried here

A real mobile network; an iPhone.

## Keeping the 4.9%

No money.

## Astra's second check (20 November 2026): "not ready", now worked in

1. *The judging was put on the server; it happens in the browser, and nothing is sent.*
   Corrected throughout.
2. *Whether a phone can send a made-up picture and read the reports is not known.* Decision 1
   makes that the first step, with a fallback.
