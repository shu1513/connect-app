# Phone apps, part 12: notifications

**Status:** a plan only. Written 20 November 2026 by the builder alone. Part of plan 45. Built
up to the point where only the founder's keys are missing, and switched on when they exist.
Astra checked it once ("ready with changes"); its points are worked in (the list is at the end).

## For the founder: what this is

The phone tells a person about their own calls: a request answered, a reminder, "the room is
open", a refund request. And the one alert that matters most: "someone wants a call now",
loud, on a locked phone (plan 39, decision 8).

**What only you can make it real with:** Apple and Google each deliver notifications only for
an app registered with them. Android needs a Google account (free); iPhone needs Apple's
developer membership (about $99 a year). Until then everything is built and tried with a
stand-in, and no notification leaves this Mac.

## What is there today (read in the code)

- **Emails** go into one outbox (an address, a subject, a body) and are sent by the helper
  (`src/lib/notifications/delivery.ts`, `worker/closer.ts`); each keeps a count of tries and
  its latest outcome; without the email service's key they simply wait. Sending twice is
  prevented with the email service's own once-only key.
- **Reminders** (`reminders.ts`, `reminder-rules.ts`): a day before, an hour before, and "it's
  time" when the room opens (up to 5 minutes before the start); a person can switch reminders
  off; none for a cancelled call. Notices a person must get (a request answered, a refund)
  are not reminders and cannot be switched off.
- **Requests:** a host gets ordinary booked requests gathered in one email from time to time;
  an instant request sends one email that expires with the request. There is no "second
  alert" of any kind today.
- Other emails exist that must never become notifications: about contributions and the
  diary, to followers, to admins, and for signing in.

## Decisions (the builder's)

1. **Notifications get their own two small tables and their own loop in the helper;** the
   rules about *when* something is told stay the ones the emails use.
   - *Phones:* one row per app installation that allowed notifications: whose it is, its
     notification address, which kind of phone, when it was last seen.
   - *The notification outbox:* one row for each event, for each phone, for each alert meant
     (so the second alert of an instant request is its own row). Written in the same database
     step as the event itself, so one cannot happen without the other.
   The email outbox is not stretched to hold them: it is built around an address, a subject
   and a body.
2. **An explicit list of what becomes a notification,** and nothing else does: a new instant
   request (and its second alert after one minute); a booked request arriving (at once, not
   gathered); a request answered; a request about to run out (host); the three reminders; a
   refund asked and answered; a membership needing the member (while memberships are on for
   the apps); a card that failed before a booked call. **Never:** anything about
   contributions, tips or the diary, emails to followers, admin and sign-in emails.
3. **Checked again at the moment of sending:** is this still that person's phone and are
   they still signed in on it; is the request still waiting, the call not cancelled; are
   reminders still wanted; is the thing still switched on. A notification about something
   that is over is not sent. For an instant request the notification is also given a
   lifetime no longer than the time left to answer.
4. **What a notification says on a locked screen gives nothing away:** no name, no amount, no
   reason, no note. "Someone is asking for a call now." "You have a call in an hour." The name
   and the rest are shown after the app is opened. (Apple's rule 4.5.4 forbids private things
   in what is sent to a phone; it does not say names are fine, so they are left out.)
5. **The instant request's alert:** urgent; Connect's own sound, just under 30 seconds;
   vibration; on iPhone asked to be "time sensitive"; on Android a channel of its own for
   urgent alerts, which the person can change afterwards in the phone's settings. A second
   alert after one minute if the request is still waiting. The app removes the alert from the
   phone when it learns the request is over, where the phone lets it; touching an alert
   always asks the server where things stand first. Accept and Decline stay in the app.
6. **Asking for permission** happens when it first matters to the person (a host switching
   "available now" on; a customer after sending a first request), with one sentence on why,
   never at first opening. Saying no is respected: the app works without notifications, and
   "available now" then follows the website's rule (part 11).
7. **Sending goes through one small piece with a key-shaped hole.** With no keys nothing is
   sent and the rows wait, as emails do. The service is Expo's, which passes messages on to
   Apple and Google. What is known about it and built for: it answers at once that it *took*
   a message, and only later whether Apple or Google accepted it, so the helper asks again
   after about a quarter of an hour; an address reported dead is dropped; a busy answer is
   tried again more slowly; its limits on how many at once are kept. **A message taken is not
   a phone that rang:** nothing in Connect may assume it. If the founder later prefers to
   talk to Apple and Google directly, the phones' addresses are of another kind and must be
   registered again; that would be its own small change.
8. **Signing out, or signing in as someone else on the same phone,** removes that phone's row
   first, so the next person never gets the last person's alerts.
9. **When this part is switched on** (keys present), part 11's second step comes alive for
   phones that allow notifications.

## How it is tried

- `notifications-check` grows: for each kind on the list, one row per phone, once; the kinds
  on the "never" list write none; reminders off means no reminder but still the notices that
  must come; a cancelled call, an answered request and a signed-out phone get nothing at the
  moment of sending; the locked-screen text of every kind is checked against what it must
  never contain (a name, an amount, an email address, a note).
- A stand-in for the outside service: taken and later accepted; taken and later refused (the
  address is dropped); busy (tried again); never sent twice.
- On the Android test phone: notifications made by the phone itself (no outside service
  needed) show how each one looks and sounds, the instant request's sound and vibration on a
  locked screen included, with pictures.

## What cannot be tried here

A notification that really travels from the server to a phone (possible on the Android test
phone as soon as there is a Google account for it). iPhone's "time sensitive" behaviour.
Whether 2 minutes is enough for a phone in a pocket.

## Keeping the 4.9%

Notifications sell nothing, never mention contributions, tips or the diary, and are only
about the person's own calls (Apple forbids using them to advertise without consent).

## Astra's check (20 November 2026): "ready with changes", worked in

1. *The email outbox does not fit notifications,* and it keeps a count, not a record per try.
   Decision 1: two small tables of their own.
2. *"Wherever an email is written" was too loose:* some emails are gathered, one expires,
   the second alert has no email at all, and some must never be notifications. Decision 2.
3. *Check again at the moment of sending.* Decision 3.
4. *Apple's rule does not bless names on a locked screen.* Decision 4: no names.
5. *Expo's service says "taken", not "delivered";* its limits and its later answers.
   Decision 7.
6. *Signing out and switching accounts.* Decision 8.
