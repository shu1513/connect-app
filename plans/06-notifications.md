# Plan: Module 6 — Notifications

**Status: built and merged (module record in `docs/module-record.md`). Astra checked the recommendations on 6 November 2026; the builder adopted them with these changes: delivery is tracked per attempt (claimed in batches, retried with limits, never resent blindly after Resend's 24-hour window); bounce and complaint messages from Resend are handled and bad addresses are not written to again; the "It's time" email says the room is open and that waiting counts only inside the booked time; unsubscribing works by a safe link and by the one-click header, and only for reminders; text messages and phone notifications stay out.**

The app already writes an email for every important event (a request, an answer, a cancelled call,
a card problem, a report). But nothing is ever really sent: emails sit on a test page. This module
makes them arrive, adds the reminders people expect before a call, and lets people choose what they get.

## What this module must prove

1. Every email the app writes is delivered, once, and a failure is retried, not lost.
2. Both people are reminded before a call, and get a "it's time" message with a link that takes them straight to the call.
3. A host is reminded before a request runs out unanswered.
4. People can switch reminders off, and never receive anything they did not ask for.
5. Nothing in an email lets someone else into an account.

## Decisions (with the builder's recommendation)

1. **How emails are sent.**
   Recommended: **Resend** (an email-sending service): free for the first 3,000 emails a month, then about $20 a month; a few lines to connect; good at landing in the inbox. The app keeps writing emails to its outbox; a helper job sends what is in it and records the result. Without a key, nothing is sent (as now), so development stays free and silent.
   Needs the founder: a Resend account and, before launch, the company's own web address added there so emails are trusted. This is listed under "Before launch" already.

2. **Reminders before a call.**
   Recommended: two emails to both people: **24 hours before** and **1 hour before**, and a third **"It's time"** email when the room opens (5 minutes before the start) with a link that opens the call page. Each is sent once per call per person; cancelled calls get none.

3. **Reminders for hosts about requests.**
   Recommended: a host whose waiting request will run out in **2 hours** gets one reminder email (on top of the "new requests" email). Nothing else is sent about requests.

4. **Text messages (SMS).**
   Recommended: **not now.** Sending texts in the United States needs a registered company and carrier approval (weeks), and costs per message. The hooks are left in place so it can be added when the company exists.

5. **Phone or browser notifications.**
   Recommended: **not now.** They need an installed app or a browser permission flow that works badly on iPhones. Email reminders with a direct link cover the need for launch.

6. **Choices for people.**
   Recommended: one page, "Notifications", with a switch for **reminder emails** (on by default) and a note that emails about things that happened (a request, an answer, a cancellation, money, a report) are always sent. Every reminder email has an "unsubscribe from reminders" link at the bottom that works without logging in, as the law requires.

7. **Login links in emails.**
   Recommended: **no "one-tap sign-in" links.** The link in an email goes to the call page; someone who is logged out logs in and is sent on (already built). A link that logs you in would let anyone who sees the email (a shared inbox, a forwarded message) into the account.

8. **What the "It's time" email says.**
   Recommended: who, when, how long, the link, and a line about what counts for money (for paid calls): the customer is reminded that time the host spends waiting is charged.

## Decisions already made

- Emails are plain text, from "Connect", with the support address and (for reminders) the unsubscribe link at the bottom.
- The outbox stays the single record of every email, with when it was sent or why it failed.
- Reminders are worked out by the always-on helper, with one key per call, person and reminder, so none is ever sent twice.
- Time zones: every time in an email is written in the recipient's own time zone, as now.

## What gets built, in order

1. The sender: delivery through Resend when a key is set; the outbox records sent/failed; retries with a limit; the helper job.
2. Reminders before calls, and the "It's time" email, with the join link.
3. The request-running-out reminder for hosts.
4. The Notifications page and the unsubscribe link.
5. Emails get a consistent footer.
6. Tests and journeys (with the sender switched off, as in development).

## What we store

- On each outbox row: when it was sent, how many tries, the last error, and the sending service's reference.
- On each account: reminder emails on or off; a secret token for the unsubscribe link.

## How we test it

- Automatic tests for the reminder timing rule.
- Journeys against the local database: reminders are written once per call and person at the right moments; none for cancelled calls or for people who switched them off; the running-out reminder; the unsubscribe link switches reminders off for that person only and cannot be guessed; delivery is recorded (with a pretend sender) and a failed send is retried then given up.

## Not in this module

- Text messages, phone and browser notifications, messaging between people (its own module).

## What the automatic checks cannot test

- Real delivery and spam placement. That needs the Resend account and the company's web address.

## Before launch

- The Resend account and the company's domain set up there (the founder).
