# Plan 49: Messages between a host and a customer

**Status:** a plan only, nothing is built. Written 26 November 2026 by the builder alone (no helper
agents), from the code as it is on `main` after pull request 103. It starts from the two studies of
14 November 2026 (`docs/research/messaging/compared.md`) and from the founder's rules of
26 November 2026 (`docs/module-record.md`, module 8b). Astra (gpt-6.2-astra, high effort) checked
the first draft against the code: "not ready", fourteen must-fix points. All are answered below;
the list is at the end.

**Its size, said plainly:** about one module, built in two parts, each its own pull request. No chat service is rented and nothing new is installed. Messages live in the app's own
database, and the conversation's page asks the server again every few seconds, as the pages for
"available now" already do.

**On from day one (the founder's decision).** When both parts are merged, messaging is on for
everyone. The founder keeps one switch on the admin page, as an emergency stop. While part 1 is
alone on `main` the switch is off, so that nothing is live before reporting exists (part 2 turns
it on).

**No email about messages, for now (the founder's decision).** A person learns of a new message
from the count beside "Messages" in the top bar, the next time they open Connect.

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

26 November 2026, in conversation with the builder:

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
11. "messaging should be turned on from day one."
12. The phone apps get it later.
13. About an email for each waiting message, which both studies and the builder had planned: "when
    the host sends a customer a message, we don't need to do the email to the customer right?
    facebook doesn't do that", then "even if we do the email, we still don't need the postal
    address since we don't know if the message is about promotion", and last: "for now I think we
    don't need to do send the email notification with each message." So no such email is built.
    The builder said once what that costs: Facebook's app buzzes on the phone, and Connect has no
    such thing yet, so a message is only seen when the person next opens Connect.

Decisions marked **(founder)** below are these. Every other decision is the builder's own choice
and is marked **(builder)**. The founder can change any of them.

## What is there today (each read in the code by the builder)

- **A page called "Messages" already exists**, with a count in the top bar
  (`src/app/messages`, `src/lib/messages/messages.ts`, table `messages`, plan 47). It holds what
  *Connect* has written to a person, each also sent by email. Nobody can answer on it. A message
  there counts as read only when the person's own browser says it has shown it, never while the
  page is drawn. The new tables and code need another name: **conversations**.
- **Blocking** (`src/lib/safety/blocks.ts`). One database step takes both people's calendar locks
  (`lockCalendars`, sorted, so two steps can never wait for each other), writes the block, and
  ends waiting requests, memberships, contributions and the blocker's follow. Future calls are
  cancelled after that step. A block is kept per "who blocked whom", whatever their roles.
  `isBlockedEitherWay` is the question features ask. The blocked person is never told.
- **Reports** (`src/lib/safety/reports.ts`). Made from a call, a request, a host's page or a diary
  post. The person reported is worked out on the server. A copy of what was there is put together
  first, then the report is written in one step with the daily limit (ten), and the block follows
  after that step (a diary post's report does not block). The copy is text in
  `reports.snapshot`. The app never deletes a report.
- **The founder's page for reports** reads every open report whole (`openReports`), copy included,
  and prints the parts of the copy it knows. So a conversation kept in `reports.snapshot` would
  reach the founder's browser with the list, unasked.
- **"End call and report"** (`src/lib/safety/calls.ts`) marks the call as stopped and ends the
  room. It does **not** block. The block comes only when the form that follows is sent. The
  Community Rules say otherwise: "The call ends for both of you, the other person is blocked".
- **"They have talked"** (`talked` in `src/lib/people/contacts.ts`): the call is over, was not
  cancelled, was not made by a check script, and each of the two joined it. `talkedBefore` asks it
  in **either direction** and says nothing about blocks, so it cannot be used as it is to decide
  what a *host* may do.
- **A call's row** (`calls`, joined to its booking by `bookings.callId`) exists once a call is
  agreed: a host's yes, a member's booking, or an accepted "now". A booking still waiting for its
  money has none. A cancelled call has `cancelledAt`. Adding time moves `endsAt`. Check scripts
  make calls too (`bookings.source` is "admin").
- **The founder's switches** (`src/lib/safety/switches.ts`, one row in `site_switches`), read
  inside a database step by passing that step as the reader.
- **Emails** go through one outbox (`src/lib/email.ts`; `queueEmail` writes one email per key and
  knows the kinds "booking" and "follow"). Nothing there limits a person to one email an hour.
  The stop link (`src/lib/notifications/unsubscribe.ts`, the page and `api/unsubscribe`) knows
  reminders and "follows"; anything else is read as reminders. The founder's "Emails" page shows
  each email's subject and address.
- **Emails to followers** are off until a postal address is set (`followEmailsOn` in
  `src/lib/follows/rules.ts`).
- **Old records are removed by the helper about once an hour** (`src/lib/retention.ts`).
- **The legal documents** are files with versions (`src/legal`, plan 46). All seven are drafts
  (version `2026-11-20`). The newest version whose day has come is the one in force, drafts
  included, and a new version of the Terms or the Community Rules sends **every** account back to
  the welcome step to accept again.
- **A page that keeps itself fresh**: `RefreshEvery` (`src/components/refresh-every.tsx`).
- **A person can be a host and a customer** (plan 42). Bookings and memberships are kept per pair
  of "this host, this customer".
- **The phone apps** (plan 45) are built up to part 09 and paused. Nothing here touches them.
- **Free calls are gone for new calls** (plan 40). The only thing that asks a customer for an ID
  check is a host's own "verified customers only" switch.

## Decisions

### What a conversation is

1. **One conversation per pair of "this host, this customer". (builder)** Two people who are each
   other's hosts have two conversations, one for each direction, because the rules differ by who
   is the host. Who is the host is read from the conversation's own row at every step, never from
   what a browser sends.
2. **Text only, up to 2,000 characters. (both studies)** No pictures, files, link previews,
   typing dots, editing or deleting, search, or paid messages. A web address in a message is
   shown as plain text, never as a link.
3. **Stored as plain text in our own database, not end-to-end encrypted. (both studies)**
4. **No ID check to write. (founder, 14 November)**

### When each of the two may write

Three plain terms, each about *this host and this customer, in these roles*:

- **A call that counts:** a call between them that a customer asked for (booked, as a member, or
  "now"), that is not cancelled and was not ended with "End call and report". A call made by a
  check script never counts.
- **Around a call:** from the moment such a call exists until 7 days after its booked end. A call
  made longer moves that end. A call that is cancelled stops counting at that moment.
- **They have talked:** at least one such call is over and both of them joined it.

5. **Around a call, both may write. (both studies)**
6. **Outside that, the host may write if they have talked. (founder)** So never a stranger: not
   after a declined request, not to a follower, not after a call that did not take place, and
   never because *she* once was *his* customer.
7. **Outside that, the customer may write only if they have talked and the host's latest message
   is less than 7 days old. (founder)** His own answers do not move that date. Otherwise the
   conversation is closed for him and shows "Book a call to write to *her name* again" with a
   button to her booking page.
8. **So a cancelled first call closes the conversation at once, for both. (builder)** The two
   have not talked, so nothing she wrote keeps it open. For two people who *have* talked, her
   message stands as her own invitation whatever happens to a later call. This keeps the study's
   promise ("a cancelled call closes it") and the founder's rule 4 without a record of which call
   allowed which message.
9. **The 7 days are one number in one file. (founder)**
10. **After a call that the customer did not come to, the 7 days around it still run. (builder)**
    "Sorry I missed it" is what they are for. Only writing *later* asks that they have talked.
11. **A host whose page is not public cannot wake a conversation. (builder)** She keeps the
    conversations around the calls she still has.
12. **"At any time" means: whenever the rules allow it, within the limits below. (builder)**

### The customer's switch

13. **Per host only. (founder)** Inside the conversation the customer has "Stop messages from
    *her name* between calls". While it is on, decisions 6 and 7 do not apply: the two can write
    only around a call. He can switch it back at any time. Only the customer of that conversation
    can change it.
14. **It does not reach into a call he booked. (builder)** Around a call both still write. He
    asked for that call, and "I'm running late" has to arrive. Blocking and reporting are there
    if she misuses it.
15. **What the host is shown. (builder)** In place of her box for writing: "*His name* is not
    taking messages right now." The same sentence, and the same answer to a form sent a moment
    too late, when he has blocked her. So nothing in a conversation tells her which of the two it
    is. (Elsewhere a block shows in other ways: her calls with him are cancelled. That has always
    been so.)

### Limits

16. **Per person: 10 messages a minute and 100 a day, over all conversations. (Astra's study)**
17. **Per conversation: 5 messages in a row without an answer. (Astra's study)** Counted from the
    start of the latest call that counts, so a new call lets a person write again and nothing
    else does. This is also what stops a host from writing to someone again and again.
18. **A host can wake at most 20 quiet conversations in 24 hours. (builder)** This, and there
    being no way to choose more than one person, is how "never one message to many" is kept.
19. **A paused or closed account cannot write. (builder)** A paused person can still read and
    report. Nobody can write to a closed account.

### Blocking and reporting

20. **A block closes both conversations between the two, at once. (both studies)** The blocker
    still sees them, closed, with "You blocked this person". Lifting the block lets the rules
    above apply again.
21. **"End call and report" blocks at the press. (builder, from Astra's check)** Today the block
    waits for the form, and someone who leaves the form is not blocked, although the written
    rules say they are. The press itself now blocks. The form stays as it is.
22. **A report can be made from a message. (both studies)** Beside each message of the other
    person there is "Report". It uses the form and the reasons that exist, and blocks, as
    everywhere else. It works while messaging is switched off and for a paused person.
23. **What is kept with such a report. (builder)** The reported message, up to 100 messages before
    it and up to 50 after it, each with its number, its writer, its time and its exact words, and
    how many older ones were left out. It is written in the same step as the report and kept in a
    table of its own, **not** in `reports.snapshot`.
24. **The founder reads a kept conversation only by pressing a button, and every press is written
    down first. (both studies)** The list of reports shows only that a conversation is kept and
    how many messages. The press goes to a step that writes the look into the record of admin
    actions, saves that, and only then gives the messages back. Every later look goes the same
    way. The words of a message are never in the page before the press, in an email to the
    founder, in the record of the look, or in a log. No other page shows conversations to the
    founder.
25. **A reminder about contact details, never a refusal. (builder, 14 November)** When a message
    holds an email address, a phone number, a web address or the name of a payment app, the page
    asks before sending: the rule ("calls and payments for them stay on Connect") and two
    buttons, change it or send it as it is. It is done in the browser. Nothing is recorded and
    nobody reviews it.

### What is kept, and for how long

26. **A message is deleted 12 months after it was sent. (Astra's study; a lawyer to confirm)**
    The helper does it, in the hourly round. The conversation's own row stays: it holds the
    customer's switch and the number of the last message, so a number is never used twice.
27. **What is kept with a report is not touched by that. (builder)** How long it must and may be
    kept is a question for the lawyer.

### Being told about a message

28. **The top bar's "Messages" counts both. (builder)** What Connect wrote that is new, plus
    conversations in which the *other* person wrote something this person has not been shown.
    The page "Messages" shows two lists: "Conversations" first, then "From Connect".
29. **"Shown" is said by the person's own browser, as on the Messages page today. (Astra's
    check)** Sending a message does not mark anything as read. A person's own message never
    counts as new for them.
30. **No email about a waiting message, for now. (founder)** Both studies had one ("You have a new
    message", without the message's words, at most one an hour). It is left out, and with it the
    setting, the stop link and the question of a postal address. The "Book a time" button of the
    founder's rule 5 is in the conversation; its place in an email waits for the email. What this
    costs is said under "For the founder". If it is built later, the first draft's points are in
    Astra's check at the end (points 11 and 12).

### The founder's switch

31. **One switch: on from day one, and the emergency stop. (founder)** Off means: nobody can
    send, and everyone can still read their conversations and report from them. It is off while
    part 1 is alone on `main`; part 2 turns it on and puts it on the admin page.

### The written rules

32. **The new wording is written for the lawyer, and not put in force by this plan. (builder,
    from Astra's check)** A new version of the Terms or the Community Rules would send every
    account back to the welcome step. So the three texts (the rules for calls hold for messages;
    messages are stored by Connect, are not end-to-end encrypted, can be read by Connect's staff
    when one of the two reports them, and can be handed to the authorities where the law requires
    it; a host may write to a customer she has talked with, and how he stops that; what is kept
    and for how long) go into `docs/legal/` as proposed wording. They become versions when the
    lawyer has read them, together with the other changes waiting there.

## What it must prove

Each gets checks in the new script (`scripts/conversation-check.ts`) or in tests. The part that
delivers it is named.

Part 1:

1. Nobody can write to someone they have no call that counts with, in either direction.
2. A host can wake a conversation only when the two have talked *in those roles*. Tried with two
   people who have a call in one direction only, and then in both.
3. A customer cannot write once the 7 days after the call and after the host's latest message
   have passed. His own messages never move that date. A message sent just before the end that
   had to wait is judged by the clock after the wait.
4. A cancelled call stops counting at once; a first call cancelled closes the conversation for
   both; a call ended with "End call and report" opens nothing and blocks, form or no form.
5. With the customer's switch on, the host is refused outside a call and accepted around one.
6. After a block, in either direction, neither can send in either conversation. A message sent at
   the same moment as a block either came first or is refused.
7. Two messages sent at the same moment get two different numbers, in one order both people see.
   Two people opening a new conversation at the same moment get the same one.
8. The same press sent twice makes one message, uses up one of each limit, and gives the same
   answer.
9. Each limit holds when many messages arrive at once, also over several conversations.
10. Nobody can read, write, count, mark as shown, switch or report in a conversation that is not
    theirs. A conversation that does not exist and one that is someone else's give the same
    answer.
11. With the founder's switch off, nothing can be sent, and reading still works.
12. "New" is right: not for one's own message, not lost when a message is sent while another
    arrives, and gone when the last unread message is deleted.

Part 2:

13. What is kept with a report is exactly decision 23, and is not in the list of reports that
    reaches the founder's browser.
14. The founder's look is in the record of admin actions before the messages are given back, and
    when that record cannot be written nothing is given back.
15. A message is gone 12 months after it was sent. What is kept with a report is not. The first
    message after that gets the next number, not an old one.

## What gets built

### Part 1: the conversation (merged with the switch off)

- **Database** (one migration). `conversations`: the host, the customer (one row per pair, the
  database refuses a second), the number of the last message, the number each of the two has been
  shown up to, when the host last wrote, when the customer switched her off.
  `conversation_messages`: the
  conversation, the message's number in it, who wrote it, the words, the once-only key of the
  press, whether it woke a quiet conversation, when. The database refuses a second message with
  the same number, and a second with the same key from the same writer. One more field in
  `site_switches`, which starts at off.
- **The rules as plain functions with tests** (`src/lib/conversations/rules.ts`): who may write,
  with the sentence for each refusal; the limits. Plain facts in, an answer out; no database.
- **The facts for them, in one place** (`src/lib/conversations/facts.ts`): the calls that count,
  "they have talked" (the existing rule, asked with the host and the customer named and inside
  the caller's database step), blocks, both accounts, the host's page.
- **The step that sends** (`src/lib/conversations/send.ts`). One database step. It takes both
  people's calendar locks first, the same locks and the same order that blocking and booking
  take. So a send and a block happen in one order or the other, the same person's sends in other
  conversations wait their turn (which makes the per-person limits hold), and `block()` itself is
  not changed. Then the conversation's row, made here if it is not there yet. Only then it reads
  the clock and everything it decides by, and gives the message its number.
- **What is not locked, on purpose:** a call being cancelled, the founder's switch, an account
  being paused, a host's page being hidden. A message sent in the very moment one of these
  changes may go either way. None of them is a promise to a person the way a block is.
- **The customer's switch** takes the conversation's row; a send reads it again after its own
  lock.
- **The block at the press** of "End call and report" (decision 21): after the call is marked, in
  the website's step and the phone app's alike. If the block fails the call is still ended, and
  the helper is not needed: the form's own block is the second try.
- **Pages:** the conversation (`/conversations/[id]`: the latest 50 messages with "Show earlier",
  the box, the customer's switch, the sentence for each closed state, the "Book a time" button)
  and the list on "Messages". The conversation asks the server again every 5 seconds while it is
  in front; what is typed in the box stays.
- **The ways in:** "Write to *name*" on an agreed call's page, on the page after a call, and for
  a host beside each past customer on "People you have talked to". A customer sees a host by her
  host name.
- **The top bar's count.**
- **The check script**, and the new pages in `scripts/journey-check.ts`'s list.

### Part 2: safety, keeping, the wording, and switching it on

- **Reporting from a message:** one more place in `reportedPersonFor` and in the form's list,
  with what is kept (decision 23) written in the report's own step, in the new table
  `report_conversations`.
- **The founder's look** (decision 24).
- **The reminder about contact details.**
- **Deleting after 12 months**, as a fourth job in `runRetention`.
- **The proposed wording** in `docs/legal/`, a draft of the one-page procedure for the founder
  (what to do when a report suggests a child or exploitation), and the questions in
  `docs/for-the-lawyer.md`.
- **The switch** on the admin page, and switched on.

## How it is checked

- Tests for the rule functions: every case of "who may write" at its edges (one second before
  and after each date), each limit, each sentence.
- `scripts/conversation-check.ts` against the local database, with real pages asked over the
  network and with two database steps at once where the order matters. It takes
  `--app=<address>`, as `home-check` does.
- The check scripts of what this touches, run again: safety (blocking, reports, "End call and
  report"), journey, retention, home, the phone app's call script, and the ones
  that compare pages line by line.
- By hand in a browser, as the test host and the test customer side by side, at phone width too.
- Lint, types, build, and all automatic tests.

## Not built now

- **The phone apps (founder: later).** A later part of plan 45.
- **An email about a waiting message (founder: not for now).**
- Deleting or editing one's own message. Pictures and files. Paid messages. A question before
  booking. A "seen" mark. Push to the browser.
- A queue of messages for the founder to review.
- A second switch for the customer that covers all hosts (the founder said no).
- New versions of the legal documents (decision 32).

## For the founder

Messaging is on from day one. So these belong on the list of things to do before Connect opens
to real people. None of them is code:

1. **Register with NCMEC** (the US centre that takes reports of child exploitation), so there is
   an account to report through.
2. **Have the lawyer read** the proposed wording, the one-page procedure, and section 8 of
   `docs/for-the-lawyer.md`: the duty to report and to keep evidence for a year, the law on
   removing intimate pictures within 48 hours, how long messages may be kept, whether a host's
   first message to a past customer is advertising, and the rules for customers in the UK and
   the EU.
3. **Choose a contact address for the police.**

**What leaving out the email costs.** Nobody is told outside Connect that a message is waiting.
"I'm running five minutes late" is only read if the other person has Connect open, and a host's
"I have Thursday free" only when the customer next comes by, which may be after its 7 days. The
phone apps can later do what an email would: make the phone buzz.

What the automatic checks cannot cover: how the pages feel on a real phone.

## Astra's check of the first draft (26 November 2026): "not ready"

Fourteen must-fix points. What each said, and what was done:

1. *A customer who is also a host could claim the host's right to write*, because "they have
   talked" is asked in either direction. **Taken:** every term is now about the pair in its
   roles (decisions 1 and 6, proof 2).
2. *"End call and report" leaves a gap:* no block until the form is sent, and the call would
   still open the 7 days. **Taken:** such a call does not count, and the press blocks
   (decision 21).
3. *Take the calendar locks first and leave `block()` alone:* a lock on the conversation alone
   cannot order a block against a conversation that does not exist yet. **Taken.**
4. *A cancelled call, the founder's switch, a pause and a hidden page can each change between the
   check and the saving.* **Taken in part:** the clock is read after the locks. Not taken: locks
   on those four. A message in that very moment harms nobody, and each extra lock is a new way
   for two steps to wait on each other. Said plainly under "What gets built".
5. *Say which event opens the 7 days, and what a cancelled first call does to a message the host
   already wrote.* **Taken:** "a call that counts" is defined, and decision 8 settles the edge
   with one rule in place of a record of which call allowed which message.
6. *Only the two people at every way in, and refusals that do not give the reason away.*
   **Taken** (decision 15, proof 10).
7. *The list of reports would carry a kept conversation to the founder's browser.* **Taken:** a
   table of its own and a step that records the look first (decisions 23 and 24).
8. *Say what is kept, and how much.* **Taken:** a report is made from one message and keeps a
   fixed stretch around it. Not taken: writing the report and the block in one step. Every
   report in the app blocks after its own step today, and changing that is not this plan's work.
9. *A lock on one conversation cannot hold a per-person limit; say what "woke" means and when the
   count of unanswered messages starts again.* **Taken** (decisions 16 to 18, the calendar
   locks).
10. *"New" must not count one's own message, must not be lost when sending, and must survive
    deleting.* **Taken** (decisions 26, 28, 29, proof 12).
11. *The outbox does not limit a person to one email an hour.* **Overtaken:** the founder
    decided on no email for now (decision 30). For a later build: an email kind of its own; one
    step per person under that person's lock; a note on each conversation of the message it
    covers; and an email that runs out after an hour in place of checking again when sending.
12. *The postal-address rule needs each message to remember why it was allowed.* **Overtaken**
    in the same way. For a later build: the stop link reads anything it does not know as
    "reminders", so a third kind must be added in the link, the page, the one-click address and
    the headers.
13. *New draft versions would send every account back to the welcome step.* **Taken:** proposed
    wording for the lawyer, not versions (decision 32).
14. *Part 1 could be switched on before reporting exists; and "off" must still let people read
    and report.* **Taken** (decision 31).

Also taken from the "worth considering" list: the corrections to "What is there today", showing
the latest 50 messages with "Show earlier", and doing the contact-details reminder in the
browser.
