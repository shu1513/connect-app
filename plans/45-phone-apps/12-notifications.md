# Phone apps, part 12: notifications

**Status:** a plan only. Written 20 November 2026 by the builder alone. Part of plan 45. Built
up to the point where only the founder's keys are missing, and switched on when they exist.
Astra checked it once ("ready with changes"); its points are worked in (the list is at the end).
Brought up to date on 27 November 2026, after the website changed (that list is at the end
too).

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
- **Messages "From Connect"** (plan 47, `tell` in `src/lib/messages/messages.ts`): when Connect
  itself writes to a person, one message on their Messages page and one email with the same
  words are written in one database step. Today these are: a bank dispute, among them the one
  a host is asked to choose an answer for (her time is at most 24 hours, less when the
  bank's deadline is near; without a choice Connect sends its proof); money a host owes back
  and the answer to her objection (plans 46 and 50); a collection Connect started after 12
  months without one; and the two messages of plan 51's guard, one of which goes to the
  team and leads to the admin pages. **The same writer is used whatever the money was for:**
  a dispute or a debt about a contribution or a tip is written through it too.
- **Whether an email really arrived** is now recorded for the notices where the law needs it
  (`src/lib/notifications/provider-events.ts`, plan 46, part 3a): the 14 days before anything
  is taken back from a host run from the day the email service reports the notice
  delivered.
- **Emails that came with plans 52 and 53:** a warning about low ratings; "your account is
  paused"; "your membership is paused because one of the two accounts was paused"; and, when
  that pause is lifted, the way to resume.

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
   request (and its second alert after one minute); booked requests waiting, as one alert at
   the moment the host's gathered email about them is made (the same rule as today, so a
   host is not told more often by phone than by email); a request answered;
   a request about to run out (host); the three reminders; a
   refund asked and answered; a membership needing the member (while memberships are on for
   the apps); a card that failed before a booked call. *Added 27 November:* a new message
   from the other person of a conversation, by the rules of part 17b, decision 19 (its own
   switch, one line per conversation, never urgent). **Never:** anything about
   contributions, tips or the diary, emails to followers, admin and sign-in emails.
2a. **"Connect has written to you."** *(added 27 November, rewritten after Astra's check; the
   builder's proposal, **confirmed by the founder the same day: yes**)* Some messages "From Connect" also make
   one notification for each of the person's phones, written in the same database step as
   the message and its email. It says only that sentence.
   - **Which ones: a short list of causes, each for one kind of receiver, and nothing else.**
     For a host: a bank dispute over a call's payment that waits for her choice; the notice
     of money she owes back for a call, and our answer to her objection; a collection Connect
     started for her, unless it held nothing but other earnings (part 16, decision 5). A
     collection the founder made for a closed host makes none: she cannot sign in. For a customer: that his report after ending a call did not change its
     charge (plan 51's guard). A membership counts as a call here only while memberships
     are on for the apps.
   - **Never:** anything that is *about* a contribution or a tip, even though the sentence
     names nothing: a bank dispute over one, money owed back for one, a collection of
     nothing else. (The test is what the message is about. A message about a call stays one
     when a contribution happened to be collected in the same collection.) and anything written to the team (the founder's own messages, which lead to
     the admin pages).
   - **The cause is looked at before the row is written, and again when it is sent and when
     it is touched:** is this still that person, is the thing still theirs and still of an
     allowed kind. One bank dispute can stand behind several amounts; touching the
     notification leads only to what is the signed-in person's own.
   - **Touching it** opens the app, which says "Connect has written to you. The message is
     in your email, and on your Messages page on the website." The apps have no screen for
     these messages (part 17b, "Not in this part"). Two exceptions: once part 16b is
     built, a message about money owed back for a call opens that part's screen; and once
     part 16c is built, one about a bank dispute that waits for her choice opens the
     dispute's screen, after the server has said that it is still hers, still one the app
     shows, and still waiting.
   - *Why at all:* two of these have a deadline. A host's time to choose how a bank dispute
     is answered is short (at most 24 hours from the moment she is asked, less when the
     bank's own deadline is near, and sometimes she is not asked at all; if she is asked and
     does not choose, Connect sends its proof), and nothing is
     taken back before 14 days after its notice arrived (she can object while the debt is
     in the state its notice puts it in, "told"; the 14 days are the earliest taking, not
     an end of that right).
   - **A notification never counts as "the notice arrived".** Only the email's delivery
     report starts the 14 days, as today; the time for a bank dispute's choice is the one
     the server has stored for it (`askUntil`), which starts when she is asked, can start
     afresh when the bank's question turns into a dispute, and does not wait for anything to
     be delivered.
2b. **Emails that stay emails only** *(added 27 November; the builder's)*: an account paused,
   by a person or by the app, and the warning about low ratings. The app shows the paused
   screen as soon as it is opened, in the words part 09a, decision 3, gives it (never the
   stored reason; part 18), and a locked screen is no place
   for either. Of the emails about a membership paused with an account, only the one that
   asks something of the member (the way to resume, sent when both accounts are open again)
   belongs to the kind "a membership needing the member" above, and only while memberships
   are fully on for the apps: in the middle position nothing in the app may say where to
   start paying again. The email that only says "it was paused" makes no notification.
   Cancelling within 14 days makes no notification (part 13c, decision 9).
3. **Checked again at the moment of sending:** is this still that person's phone and are
   they still signed in on it; for the host's own prompts about a request (it is waiting,
   it is about to run out), is the request still waiting; the call not cancelled; are
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
   tried again more slowly; its limits on how many at once are kept. An address is dropped
   only when the service says that address is dead, not for any other failure. **A message
   taken is not a phone that rang,** and a message can arrive twice or never: nothing in
   Connect may assume otherwise. If the founder later prefers to
   talk to Apple and Google directly, the phones' addresses are of another kind and must be
   registered again; that would be its own small change.
8. **Signing out, or signing in as someone else on the same phone,** ends that phone's
   registration and whatever was still waiting to be sent to it, together with the sign-in.
   An alert already handed to Apple or Google can still arrive afterwards; that is one more
   reason every alert says nothing private, and the app checks who is signed in before it
   shows anything when an alert is touched.
9. **When this part is switched on** (keys present), part 11's second step comes alive for
   phones that allow notifications.

## How it is tried

- `notifications-check` grows: one "Connect has written to you" row per phone for each cause
  on decision 2a's list, written with its message or not at all, and none when the same
  message is written a second time under its key; **no row** for the same kinds of message
  about a contribution or a tip, for a message to the team, for a pause or a rating warning;
  a row whose cause is no longer allowed at the moment of sending is not sent; for each kind
  on the list, one row per phone, once; the kinds
  on the "never" list write none; reminders off means no reminder but still the notices that
  must come; a cancelled call and a signed-out phone get nothing at the moment of sending;
  a request that was answered while the host's prompt about it was still queued: the prompt
  is not sent, and the customer's "your request was answered" is; the locked-screen text of every kind is checked against what it must
  never contain (a name, an amount, an email address, a note).
- A stand-in for the outside service: taken and later accepted; taken and later reported
  as a dead address (the address is dropped); taken and later refused for any other reason
  (the address is kept); busy (tried again); never sent twice.
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

## Brought up to date (27 November 2026)

Read again against the code on `main` after pull request 123. What changed in this plan:

1. *Connect now writes to people itself, with deadlines attached* (plans 46, 47, 50, 51).
   Decision 2a: one sentence that names nothing, for a short list of causes. Confirmed by the
   founder on 27 November.
2. *New emails about pauses and warnings* (plans 52 and 53). Decision 2b: emails only.
3. *An email's arrival is recorded for legal notices.* Decision 2a says a notification never
   stands in for it.
4. The line about messages between two people was added earlier the same day by the builder
   of part 17b; it stands.

This plan is read against the code once more on the day it is built.

## Astra's check of this update (27 November 2026): "not ready", worked in

1. *"Every message From Connect" took in messages about contributions and tips, and the
   team's own.* Decision 2a is now a list of causes and receivers, checked three times.
2. *Two clocks were mixed up:* the time for a bank dispute's choice (short, with a default;
   first written here as running "from the dispute's arrival", which the second check
   corrected: it runs from the moment she is asked, and the server stores it) and the 14 days before anything is taken (from the email's
   arrival; first written here as "14 days for an objection", which was wrong: she can
   object while the debt is "told"). Decision 2a says each.
3. *An email that only informs is not "a membership needing the member",* and the middle
   position of the switch must stay silent about paying. Decision 2b.

## Astra's second check (27 November 2026), worked in

1. *A collection can contain a call and still happen only because of a contribution.* First
   answered with "only when the calls alone would have caused it". **Withdrawn after the
   fourth check** (see the build plan, "The rule for the apps"): decision 2a now says simply
   that a collection of nothing but other earnings makes no notification.
2. *The time for a bank dispute's choice starts when she is asked, and is stored.* Decision 2a.
3. *"The paused screen with its reason"* said the opposite of part 09a. Decision 2b.
