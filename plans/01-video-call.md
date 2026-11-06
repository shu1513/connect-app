# Plan: Step 1 — Video call with trustworthy time tracking

This is the first piece of the app. It has no payments, no calendar and no polished design.
Its only job is to prove that two people can have a video call and that our server keeps
a trustworthy record of who was connected and when.

## What this step must prove

1. Two people can join a private room and see and hear each other, on a phone browser and on a computer.
2. Our server (not the browser) records when each person was connected, using LiveKit's own reports.
3. The time count stays correct when real life gets messy: someone is late, drops and rejoins,
   opens a second tab, loses wifi, or closes the page without hanging up.
4. When the record is incomplete, the app says so. It never guesses, and "unknown" is never treated as zero.

## What the clock measures (and what it cannot)

- It measures **connected time as LiveKit sees it**. It does not prove both people could hear each other every second.
- Times are accurate to about a second in normal use.
- If someone's phone dies or the app is killed, LiveKit can take about 15 seconds to notice. That gap is expected.
- LiveKit does not promise that every join/leave message reaches us. So totals are "observed" totals,
  and any call with a missing message is marked "needs review".

## Decisions already made

- Language and framework: TypeScript with Next.js. Database: Postgres.
- Video service: LiveKit Cloud first. Daily is tested afterwards with the same checklist.
  Only three small parts touch LiveKit directly (entry passes, room control, reading its messages).
  The time calculation knows nothing about LiveKit.
- Time rules (from the original product notes):
  - Booked call: the host earns for the time the host is connected inside the booked window.
  - Instant call: both people must be connected for time to count.
  - Every call gets three numbers (host time, customer time, time together),
    so either rule can be applied later without rebuilding anything.
- The room is usable from 5 minutes before the start until 1 minute after the end.
  Only time inside the booked window counts.
- One person, one connection per call. If someone opens a second tab, it takes over and the first tab disconnects.
- No recording.

## What gets built, in order

1. **Project setup.** Next.js app, Postgres database, automated tests. Put it online early
   (or use a secure tunnel), because phone cameras need a secure address and LiveKit needs
   a public address to send its messages to.
2. **Test accounts with real login.** A few accounts created by us. No public sign-up yet.
3. **A call record.** A call has a host, a customer, a start and an end (stored in UTC), and its own
   unique room name. Host and customer are roles on the call, not on the account.
   Calls are created from a simple test page that requires login.
   The test cases for the time calculation are written here, before any calculation code.
4. **The join check.** When someone taps "Join", our server checks who they are, whether they belong
   to this call, and whether the room is open right now. Only then does it hand out an entry pass
   that lasts at most 10 minutes. No timer is needed to "open" the room.
5. **The attendance log.** LiveKit tells our server each time someone connects or disconnects.
   We check the message is genuine, save it exactly as received before replying, and never edit it.
   Repeated messages are ignored. This is built before the call screen so we see real messages early.
6. **A basic call screen.** Camera and microphone check, the call itself, and a countdown.
   The server sends the end time and each browser counts down to it. Attendance never depends on this clock.
7. **Closing the room.** A small always-on helper checks every few seconds for calls past their closing time.
   It stops handing out entry passes, removes both people (even one who is not currently connected,
   so an old pass cannot be reused), confirms the room is empty, and retries if anything fails.
8. **The time calculation.** See the rule below. Totals are always worked out from the log,
   so a late-arriving message corrects the result by itself.
9. **A results page.** A plain table per call: the messages received, each person's connected periods,
   the three totals, and whether the call needs review and why. Requires login.

## The counting rule

1. Use LiveKit's own time on each message, not the time we received it. Order of arrival does not matter.
2. Pair each "connected" with the matching "disconnected" for the same connection.
3. Keep only the part of each period that falls inside the booked window.
4. Merge each person's periods so overlapping ones count once. Gaps between drops are not filled in.
5. Host time = total of the host's periods. Customer time = total of the customer's.
   Time together = where the two overlap.
6. If a "connected" has no matching "disconnected", or the reverse, or a message comes from someone
   who is not on the call: mark the call "needs review" and show no final totals. Never fill the gap with a guess.

## What we store

- **Per call:** host, customer, start, end, room name, whether it has been closed and when.
- **Per message from LiveKit:** its unique ID, which call, which person, which connection,
  the type (connected or disconnected), LiveKit's time, our receipt time, and the original message.

## How we test it

- **Automated tests for the counting rule:** host late, customer late, host leaves early, drop and rejoin,
  second tab takes over and the old tab's "disconnected" arrives late, missing "disconnected",
  missing "connected", duplicates, out-of-order arrival, joining before the start, leaving after the end,
  nobody shows up.
- **Automated tests for access:** a fake message is rejected; a stranger cannot get an entry pass,
  create a call or see results; nobody gets in before opening or after closing.
- **Closing tests against LiveKit Cloud** (the local test server behaves differently here):
  an old entry pass cannot be reused after closing, including by someone who had already left.
- **Real devices by hand:** iPhone Safari, Android Chrome, a laptop. One 60-minute call, plus short calls
  for the messy cases: airplane mode, wifi to mobile data, locked phone, closed tab, incoming phone call,
  camera permission denied then allowed.
- **Then repeat the device checks on Daily** and choose the video service.

## This step is done when

- [ ] Two people can complete a call on phone and computer.
- [ ] For the automated test cases, the three totals are exactly right.
- [ ] For real calls, the totals match a stopwatch within a few seconds
      (up to about 15 seconds after a sudden disconnect), or the call is marked "needs review".
- [ ] Nobody can enter before the room opens, after it closes, or into someone else's call.
- [ ] The results page explains any call's totals at a glance.

## Not in this step

Payments, calendar and booking, "available now", extensions, notifications, public sign-up, ID checks,
ratings, notes, text chat, search, funding goals, phone apps.
Cross-region test calls are a later milestone, not a blocker for this step.

## Needed from the founder

- A free LiveKit Cloud account (address, API Key, API Secret). Needed by build step 5 at the latest,
  because the attendance log and the closing tests need the real service.

## Work that runs alongside this step

- Write to Stripe and LiveKit describing the exact business and ask for written approval.
- Write the money rules: lateness, no-shows, cancellations and refunds for each side.
  These decide how the three time totals turn into charges and host pay in the next step.
