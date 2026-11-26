# Plan 49: Messages between a host and a customer

**Status:** a plan only, nothing is built. Written 26 November 2026 by the builder alone (no helper
agents), from the code as it is on `main` after pull request 103. It starts from the two studies of
14 November 2026 (`docs/research/messaging/compared.md`) and from the founder's rules of
26 November 2026 (`docs/module-record.md`, module 8b). Astra's check of this plan is at the end.

**Its size, said plainly:** about one and a half modules, built in three parts, each its own pull
request. No chat service is rented and nothing new is installed. Messages live in the app's own
database, and the pages ask the server again every few seconds, as the pages for "available now"
already do.

**It ships switched off.** The founder gets one switch, "Messages between hosts and customers",
and it starts at off. Storing private messages brings duties that only the founder can meet (the
list is under "For the founder"). Until the switch is on, nobody sees anything new.

## For the founder: what this is

Once a host has said yes to a call, the two of them can write to each other: short text messages,
nothing else. "I'm running five minutes late." "Here is what I'd like to talk about." "Thank you,
that helped." The conversation stays open until 7 days after the call.

After that it goes quiet, and then the two sides are treated differently, on purpose:

- **The host can wake it up at any time**, with any customer she has really had a call with. "I
  have Thursday free." Her message gives the customer 7 days to answer.
- **The customer cannot wake it up.** To write to her again he books another call, and the booking
  opens the conversation. A quiet conversation shows him a button: "Book a call to write to her
  again."
- **The customer can switch one host off.** Then that host can only write to him around a call he
  booked with her.

Nobody can ever write to a stranger, and no message can go to many people at once.

## What the founder said

14 November 2026, after the two studies: messaging was left out of the first version. No ID check
is needed to write (the same rule as for a call). The note that travels with a request stays as
it is.

26 November 2026, in conversation with the builder (all in the record, module 8b):

1. A host can write at any time to a customer she has had a call with, and the customer can then
   answer for 7 days.
2. A customer cannot open a quiet conversation again himself. He books another call.
3. The time is 7 days, kept as one number that is easy to change.
4. Only the host's messages start the 7 days again (and a call does). A customer's answer does not.
5. A "Book a time" button inside the conversation and in the email about a waiting message.
6. A closed conversation says "Book a call to write to her again".
7. Never to a stranger: not someone whose request she declined, who only follows her, or whose
   call never took place.
8. One person at a time, never one message to many customers.
9. The customer's switch is per host only. No second switch for all hosts.
10. "shall we make a build plan and have astra check it? and then build it? both using the work
    flows we have established."

Decisions marked **(founder)** below are these. Every other decision is the builder's own choice
and is marked **(builder)**. The founder can change any of them.

## What is there today (each read in the code by the builder)

- **A page called "Messages" already exists**, with a count in the top bar
  (`src/app/messages`, `src/lib/messages/messages.ts`, table `messages`, plan 47). It holds what
  *Connect* has written to a person, each also sent by email. It is not a conversation and nobody
  can answer on it. So the new tables and code need another name: **conversations**.
- **Blocking** (`src/lib/safety/blocks.ts`): one step that takes both people's calendar locks,
  writes the block, ends requests, memberships and contributions between the two and cancels
  their future calls. `isBlockedEitherWay` (`block-check.ts`) is the one question every feature
  asks. The blocked person is never told.
- **Reports** (`src/lib/safety/reports.ts`): made from a call, a request, a host's page or a diary
  post. The person reported is worked out on the server. A copy of what was there at that moment
  is kept as text in `reports.snapshot`. Reporting a person also blocks them. "Someone under 18"
  and "Harassment or threats" are urgent: top of the founder's list and an email at once. Ten
  reports a day per person. The app never deletes a report.
- **The founder's page for reports** (`src/app/admin/reports/page.tsx`) and the record of every
  admin action (`src/lib/safety/audit.ts`, rows are only ever added).
- **The founder's switches** (`src/lib/safety/switches.ts`, one row in `site_switches`), read
  inside a database step by passing that step as the reader.
- **"They have talked"** is one rule, written once (`talked` in `src/lib/people/contacts.ts`): the
  call is over, was not cancelled, was not made by a check script, and each of the two joined it.
  `talkedBefore` answers it for one person and many others in one question.
- **A call's row exists from the moment the host accepts** (`calls`, joined to its booking by
  `bookings.callId`); a cancelled call has `cancelledAt`. A call booked as a member or asked for
  "now" has the same row. Adding time moves `endsAt`.
- **Emails** go through one outbox (`src/lib/email.ts`, `queueEmail` with a key, so each is written
  once), sent by the helper. Reminder emails have their own on/off setting on the account and a
  stop link that needs no login (`src/lib/notifications/unsubscribe.ts`). Emails to followers are
  off altogether until a postal address is set (`FOLLOW_EMAILS_ADDRESS`, `followEmailsOn` in
  `src/lib/follows/rules.ts`), because they are advertising in the eyes of the law.
- **Old records are removed by the helper about once an hour** (`src/lib/retention.ts`,
  `runRetention`).
- **The legal documents** are files with versions (`src/legal`, plan 46). All seven are still
  drafts for the lawyer (version `2026-11-20`). A change is a new version, never an edit.
- **A page that keeps itself fresh**: `RefreshEvery` (`src/components/refresh-every.tsx`) asks the
  server for the page again every so many seconds while the tab is in front.
- **A person can be a host and a customer** (plan 42). Bookings, memberships and blocks are all
  kept per pair of "this host, this customer".
- **The phone apps** (plan 45) are built up to part 09 and paused. They reach the server through
  their own door (`src/lib/app-door`). Nothing in this plan touches it.
- **Free calls are gone** (plan 40). The only thing that asks a customer for an ID check is a
  host's own "verified customers only" switch.

## Decisions

### What a conversation is

1. **One conversation per pair of "this host, this customer". (builder)** Like bookings and
   memberships. Two people who are each other's hosts have two conversations, one for each
   direction, because the rules differ by who is the host.
2. **Text only, up to 2,000 characters. (both studies)** No pictures, files, link previews,
   typing dots, editing or deleting, search, or paid messages. A web address in a message is
   shown as plain text, never as a link.
3. **Stored as plain text in our own database, not end-to-end encrypted. (both studies)** With
   end-to-end encryption we could only ever see what a reporter's own device hands over, could not
   keep a reported conversation as evidence ourselves, and the build would be far larger.
4. **No ID check to write. (founder, 14 November)**

### When each of the two may write

One sentence each, and everything else follows from them:

- **The conversation is "around a call"** from the moment the host accepts a call until 7 days
  after that call's booked end. A call that is cancelled stops counting at once.
- **The host woke it** when her latest message is less than 7 days old.

5. **Around a call, both may write. (both studies)** This is the part that was researched on
   14 November: arranging the call and a short follow-up.
6. **Outside that, the host may write if the two have talked before. (founder)** "Talked" is the
   rule the app already has: a call that is over, was not cancelled, and that both joined. So
   never a stranger, never after a declined request, never to a follower, never after a call that
   did not take place.
7. **Outside that, the customer may write only while the host's latest message is less than
   7 days old. (founder)** His own answers do not move that date. When it has passed, the
   conversation is closed for him and shows "Book a call to write to *her name* again" with a
   button to her booking page.
8. **The 7 days are one number in one file. (founder)**
9. **After a call that the customer did not come to, the 7 days still run. (builder)** The window
   around a call does not ask who joined: "sorry I missed it" is exactly what it is for. Only the
   host's power to write *later* asks for a call that really took place.
10. **A host whose page is not public cannot wake a conversation. (builder)** A host who is
    suspended, hidden or not approved keeps the conversations around calls she still has, and
    nothing more.

### The customer's switch

11. **Per host only. (founder)** Inside the conversation the customer has "Stop messages from
    *her name* between calls". While it is on, decision 6 does not apply to her: she can write to
    him only around a call. Decision 7 falls away with it. He can switch it back at any time.
12. **It does not reach into a call he booked. (builder)** Around a call both still write, switch
    or no switch. He asked for that call, and "I'm running late" has to arrive. If she misuses
    that, blocking and reporting are there.
13. **What the host is shown. (builder)** In place of her box for writing: "*His name* is not
    taking messages right now." The same sentence is shown when he has blocked her, so the
    sentence never tells her which of the two it is. (Blocking has always been hidden from the
    person blocked.)

### Limits

14. **Per person: 10 messages a minute and 100 a day. (Astra's study)**
15. **Per conversation: 5 messages in a row without an answer. (Astra's study)** After five the
    box says so. This is also what stops a host from writing to someone again and again: after
    five unanswered messages she waits for his answer or for the next call.
16. **A host can wake at most 20 quiet conversations in 24 hours. (builder)** This, and there
    being no way to choose more than one person, is how "never one message to many" is kept.
17. **A paused or closed account cannot write. (builder)** A paused person can still read.

### Blocking and reporting

18. **A block closes the conversation both ways, at once. (both studies)** The blocker still sees
    it, closed, with "You blocked this person". The blocked person sees decision 13's sentence
    (a host) or a plain "This conversation is closed" (a customer). Lifting the block lets the
    rules above apply again.
19. **A report can be made from a conversation. (both studies)** It uses the form and the reasons
    that exist. A copy of the conversation as it is at that moment is kept with the report, the
    way a request's note is today. Reporting blocks, as everywhere else.
20. **The founder reads a conversation only through a report, and every look is written down.
    (both studies)** The founder's page shows that a conversation is kept with a report and how
    many messages it has. Reading it takes a press of a button, and that press is recorded in the
    record of admin actions before anything is shown. There is no other page that shows
    conversations to the founder.
21. **A reminder about contact details, never a refusal. (builder, 14 November)** When a message
    holds an email address, a phone number, a web address or the name of a payment app, it is not
    sent at once. The sender is shown the rule ("calls and payments for them stay on Connect") and
    two buttons: change it, or send it as it is. Nothing is recorded and nobody reviews it.

### What is kept, and for how long

22. **A message is deleted 12 months after it was sent. (Astra's study; a lawyer to confirm)**
    The helper does it. The conversation's own row stays (it holds the customer's switch).
23. **The copy kept with a report is not touched by that. (builder)** The app never deletes a
    report today. How long it must and may be kept is a question for the lawyer.

### Being told about a message

24. **The top bar's "Messages" counts both. (builder)** What Connect wrote that is new, plus
    conversations with something new. The page "Messages" shows two lists: "Conversations" first,
    then "From Connect".
25. **A person's own message never counts as new for them. (Astra's study)**
26. **One email about waiting messages, without their text. (both studies)** "You have a new
    message from *name*", with a link. Written when a message has waited unread for 5 minutes. At
    most one such email an hour and three a day per person, whatever the number of conversations.
    Its own on/off setting on the account page, and a stop link in the email.
27. **The customer's email carries "Book a time with *her name*". (founder)**
28. **An email about a message with which a host woke a quiet conversation is advertising in the
    eyes of the law until a lawyer says otherwise. (builder)** So it follows the rule the emails
    to followers already follow: it carries the postal address and the stop link, and it is only
    written when the postal address is set. Until then the customer finds such a message in the
    app only. Emails about messages around a call are not touched by this.

### The founder's switch

29. **One switch, off to begin with. (builder)** Off: nobody can send, the links to conversations
    are not shown, and existing conversations can still be read. It is also the emergency stop.

### The written rules

30. **New draft versions of three documents. (Astra's study)** The Community Rules (the rules for
    calls hold for messages too), the Terms of Service (messages are stored by Connect, are not
    end-to-end encrypted, can be read by Connect's staff when one of the two reports them, and can
    be handed to the authorities where the law requires it; a host may write to a customer she
    has talked with, and how he stops that) and the Privacy Policy (what is kept and for how
    long). They stay drafts for the lawyer, like the versions before them.

## What it must prove

Each of these gets checks in the new script (`scripts/conversation-check.ts`) or in tests.

1. Nobody can write to someone they have no accepted call with, in either direction.
2. A host can wake a conversation only with someone she has talked with, by the app's one rule.
3. A customer cannot write once the 7 days after the call and after the host's latest message
   have passed, and his own messages never move that date.
4. A cancelled call stops counting at the moment it is cancelled.
5. With the customer's switch on, the host is refused outside a call and accepted around one.
6. After a block, in either direction, neither can send, whatever was true before, and a message
   sent at the same moment as a block either came first or is refused.
7. Two messages sent at the same moment get two different numbers, in one order that both people
   see.
8. The same press sent twice (a flaky connection) makes one message.
9. Each limit holds when many messages arrive at once.
10. Nobody can read or write a conversation that is not theirs by changing the address.
11. With the founder's switch off, nothing can be sent and no page offers it.
12. The founder's look at a kept conversation is in the record of admin actions before the
    conversation is shown.
13. A message is gone 12 months after it was sent, and the copy with a report is not.
14. No email holds the text of a message. No person gets more than one such email an hour or
    three a day. Nobody gets one for their own message, or with the setting off.

## What gets built

### Part 1: the conversation

- **Database** (one migration): `conversations` (the host, the customer, the number of the last
  message, the number each of the two has read up to, when the host last wrote, when the customer
  switched her off; one row per pair) and `conversation_messages` (the conversation, the
  message's number in it, who wrote it, the text, the once-only key of the press, when). The
  founder's switch is one more field in `site_switches`.
- **The rules as plain functions with tests** (`src/lib/conversations/rules.ts`): "around a
  call", "the host woke it", who may write, the limits. They take plain facts in and give an
  answer with its sentence out; no database.
- **The step that sends** (`src/lib/conversations/send.ts`): one database step. It takes the
  conversation's lock first, and only then reads everything it decides by (the switch, a block,
  both accounts, the calls between the two, the limits) and gives the message its number. The
  number, not the time, is what "new" is measured by.
- **Blocking takes the same lock.** `block()` gets one more line: after writing the block it
  locks the conversations between the two. So a send and a block at the same moment happen in one
  order or the other.
- **Pages:** the conversation (`/conversations/[id]`: the messages, the box, the customer's
  switch, the sentences for every closed state, the "Book a time" button) and the list on
  "Messages". The conversation asks the server again every 5 seconds while it is in front.
- **The ways in:** a link "Write to *name*" on an accepted call's page, on the page after a call,
  and for a host beside each past customer on "People you have talked to".
- **The top bar's count.**
- **The founder's switch** on the admin page, with the others.
- **The check script**, and a line in `scripts/journey-check.ts`'s list of pages.

### Part 2: safety, keeping and the written rules

- **Reporting from a conversation:** one more place in `reportedPersonFor`, with the copy.
- **The founder's reading of a kept conversation**, with its record.
- **The reminder about contact details.**
- **Deleting after 12 months**, as a fourth job in `runRetention`.
- **The three new draft versions**, and their questions in `docs/for-the-lawyer.md`.
- **A draft of the one-page procedure** for the founder: what to do when a report suggests a
  child or exploitation (`docs/legal/`), for the lawyer to correct.

### Part 3: the email about a waiting message

- The helper's job, the limits, the setting on the account page, the stop link (a third kind
  beside reminders and followers), the "Book a time" line, and the postal-address rule of
  decision 28.

## How it is checked

- Tests for the rule functions: every row of the table "who may write" at its edges (one second
  before and after each date).
- `scripts/conversation-check.ts` against the local database: the fourteen proofs above, as each
  role, with real pages asked over the network. It takes `--app=<address>`, as `home-check` does.
- The check scripts of what this touches, run again: safety (blocking and reports), journey,
  retention, notifications, home, and the ones that compare pages line by line.
- By hand in a browser, as the test host and the test customer side by side, at phone width too.
- Lint, types, build, and all automatic tests.

## Not built now

- **The phone apps.** They get conversations in a later part of plan 45. Until then the email's
  link opens the website.
- Deleting or editing one's own message. Pictures and files. Paid messages. A question before
  booking. A "seen" mark. Push to the browser.
- A queue of messages for the founder to review.
- A second switch for the customer that covers all hosts (the founder said no).

## For the founder

Before the switch goes on. None of this is code, and all of it is yours or a lawyer's:

1. **Register with NCMEC** (the US centre that takes reports of child exploitation) so there is
   an account to report through.
2. **Have the lawyer read** the three new drafts, the one-page procedure, and section 8 of
   `docs/for-the-lawyer.md`: the duty to report and to keep evidence for a year, the law on
   removing intimate pictures within 48 hours, how long messages may be kept, whether a host's
   first message is advertising, and the rules for customers in the UK and the EU.
3. **Choose a contact address for the police.**
4. **Set the postal address**, if hosts' first messages are to reach customers by email too.

What the automatic checks cannot cover: real email delivery, and how the pages feel on a real
phone.

## Astra's check of this plan

(To be filled in.)
