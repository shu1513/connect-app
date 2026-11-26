# Plan 49: Messages between a host and a customer

**Status:** a plan only, nothing is built. Written 26 November 2026 by the builder alone (no helper
agents), from the code as it is on `main` after pull request 103. It starts from the two studies of
14 November 2026 (`docs/research/messaging/compared.md`) and from the founder's rules of
26 November 2026 (`docs/module-record.md`, module 8b). Astra (gpt-6.2-astra, high effort) checked
it against the code four times: "not ready" with fourteen must-fix points, then nine, then
three, then two. All are answered below; the lists are at the end.

**Its size, said plainly:** about one module, built in two parts, each its own pull request. No
chat service is rented and nothing new is installed. Messages live in the app's own database, and
the conversation's page asks the server again every few seconds, as the pages for "available now"
already do.

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
  agreed: a host's yes (also while the hold on the card is still being placed), a member's
  booking once its time is set aside, or an accepted "now". The moment of agreement is
  `bookings.decidedAt`. A cancelled call has `cancelledAt`; one ended with "End call and report"
  has `safetyEndedAt`. Adding time moves `endsAt`. Check scripts make calls too
  (`bookings.source` is "admin").
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
  "now"), that is not cancelled and was not ended with "End call and report". After an "End
  call and report" between the two people, whoever was the host then, fewer calls count
  (decision 21). A call made by a check script never counts.
- **Around a call:** from the moment such a call is agreed until 7 days after its booked end. Any
  one such call is enough. A call made longer moves its end. A call that is cancelled stops
  counting at that moment.
- **They have talked:** at least one such call is over, and both of them joined that same call.

5. **Around a call, both may write. (both studies)**
6. **Outside that, the host may write if they have talked. (founder)** So never a stranger: not
   after a declined request, not to a follower, not after a call that did not take place, and
   never because *she* once was *his* customer.
7. **Outside that, the customer may write only if they have talked and the host's latest message
   is less than 7 days old. (founder)** His own answers do not move that date. Otherwise the
   conversation is closed for him and shows "Book a call to write to *her name* again" with a
   button to her booking page.
8. **So a cancelled first call closes the conversation at once, for both. (builder)** The two
   have not talked, so nothing she wrote keeps it open. (If another call that counts is still
   there, that call keeps it open.) For two people who *have* talked, her message stands as her
   own invitation whatever happens to a later call. This keeps the study's promise ("a cancelled
   call closes it") and the founder's rule 4 without a record of which call allowed which
   message.
9. **The 7 days are one number in one file. (founder)**
10. **After a call that one of them did not come to, the 7 days around it still run. (builder)**
    Whoever missed it. "Sorry I missed it" is what they are for. Only writing *later* asks that
    they have talked.
11. **A host whose page is not public cannot write outside a call. (builder)** Not to wake a
    conversation and not to go on in one. Around a call she writes as before. The customer can
    still answer her latest message within its 7 days. The "Book a call" button is shown to him
    only while he can book her (a member can sometimes book a host whose page is hidden);
    otherwise the conversation just says it is closed.
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
    too late, when he has blocked her. So the refusal itself never names the reason. It cannot
    hide the difference altogether, and does not promise to: a block also cancels her calls with
    him, and with his switch on she can still write around a call.

### Limits

16. **Per person: 10 messages a minute and 100 a day, over all conversations. (Astra's study)**
17. **Per conversation: 5 messages in a row without an answer. (Astra's study)** A person's
    messages are counted from the other person's latest message, or from the moment the latest
    call that counts was agreed, whichever is later. So an answer or a newly agreed call lets a
    person write again, and nothing else does. This is also what stops a host from writing to
    someone again and again. (Two messages of the same moment are told apart by their numbers.
    Messages deleted after 12 months no longer count; by then that does no harm.)
18. **A host can wake at most 20 quiet conversations in 24 hours. (builder)** A message "wakes"
    when the host sends it outside a call and she has sent none in that conversation in the
    7 days before it. The same press sent twice counts once. This, and there being no way to
    choose more than one person, is how "never one message to many" is kept.
19. **A paused or closed account cannot write. (builder)** A paused person can still read and
    report. Nobody can write to a closed account.

### Blocking and reporting

20. **A block closes both conversations between the two, at once. (both studies)** The blocker
    still sees them, closed, with "You blocked this person". Lifting the block lets the rules
    above apply again.
21. **After "End call and report" the two are strangers again, for messages. (builder, from
    Astra's checks)** The press ends the call, but the block only comes when the form after it
    is sent, and a person can leave that form. So for messages the press, once it is recorded
    on the call, is enough: from then on a call counts, in either conversation between the two,
    only if the customer began asking for it after the press (its very first step, before the
    card) and the host said yes to it. A member's booking does not count for this, because it
    needs no yes from the host. Neither does a request that was already waiting, or already
    begun, at the press. So nobody can write until both have acted again. Until then the
    conversation only says that it is closed, without the "Book a call to write" button. (A pair
    who had another call booked before the press lose the messages around that call. That is
    the price of a rule this simple.) "End call and report" itself is not changed
    by this plan (see "Found on the way").
22. **A report can be made from a message. (both studies)** Beside each message of the other
    person there is "Report". It uses the form and the reasons that exist, and blocks, as
    everywhere else. It works while messaging is switched off and for a paused person. If the
    message has been deleted in the meantime, the form says so and nothing is written.
23. **What is kept with such a report. (builder)** The reported message, up to 100 messages before
    it and up to 50 after it, as they are at that moment, each with its number, its writer, its
    time and its exact words, and how many older ones that still exist were left out. It is
    written in the same step as the report, in a table of its own that belongs to the report,
    **not** in `reports.snapshot`. Deleting the messages later does not touch it.
24. **The founder reads what was kept only by pressing a button, and every press is written down
    first. (both studies)** The list of reports shows that messages are kept with a report and
    how many, and the reporter's own note, as for every report. The press goes to a step that
    checks the admin's login, writes the look into the record of admin actions, saves that, and
    only then gives the kept messages back. Every later look goes the same way. What was kept is
    never in the page before the press, in an email to the founder, in the record of the look,
    or in a log. No other page shows conversations to the founder.
25. **One line about contact details beside the box. (builder, from Astra's second check)**
    "Calls and payments for them stay on Connect", with a link to the rules. No message is held
    back, searched or recorded for it. (The first draft had the page look for phone numbers and
    payment names and ask before sending. A standing line does the same job with no code.)

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
    costs is said under "For the founder".

### The founder's switch

31. **One switch: on from day one, and the emergency stop. (founder)** Off means: nobody can
    send, and everyone can still read their conversations and report from them. It is off while
    part 1 is alone on `main`, also in a database that has no row of switches yet. Part 2 turns
    it on once, in its own database change, and puts it on the admin page. From then on only the
    founder moves it: a later update of the app leaves it where she put it.

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
   both, unless another call that counts is there. After a recorded "End call and report", form
   or no form, neither can write in either conversation: not because of an earlier call, a call
   already booked for later, a recent message of the host's, a member's new booking, a request
   that was waiting and is accepted afterwards, or a request begun before the press whose card
   step finished after it. A request begun after it and accepted opens the conversation of its
   own direction only, and only when no block stands between the two.
5. With the customer's switch on, the host is refused outside a call and accepted around one.
6. After a block, in either direction, neither can send in either conversation. A message sent at
   the same moment as a block either came first or is refused.
7. Two messages sent at the same moment get two different numbers, in one order both people see.
   Two people opening a new conversation at the same moment get the same one.
8. The same press sent twice makes one message, counts once against each limit it falls under,
   and gives the same answer.
9. Each limit holds when many messages arrive at once, also over several conversations. The
   five in a row hold before a booked call has started, and start again with an answer or a
   newly agreed call.
10. Nobody can open, read, write, count, mark as shown or switch in a conversation that is not
    theirs. A conversation that does not exist and one that is someone else's give the same
    answer. An attempt to open one that is refused leaves nothing behind.
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
16. Only the other person of a conversation can report a message in it, and only a message that
    is really there. Reading and reporting work with the founder's switch off.
17. The switch: off in a database with no row of switches while part 1 is alone; on after part
    2's change; and left alone by a later update once the founder has moved it.

## What gets built

### Part 1: the conversation (merged with the switch off)

- **Database** (one migration). `conversations`: the host, the customer (one row per pair, the
  database refuses a second), the number of the last message, the number each of the two has been
  shown up to, when the host last wrote, when the customer switched her off.
  `conversation_messages`: the conversation, the message's number in it, who wrote it, the
  words, the once-only key of the press, whether it woke a quiet conversation, when. The
  database refuses a second message with the same number, and a second with the same key from
  the same writer. One more field in
  `site_switches`, which starts at off.
- **The rules as plain functions with tests** (`src/lib/conversations/rules.ts`): who may write,
  with the sentence for each refusal; the limits. Plain facts in, an answer out; no database.
- **The facts for them, in one place** (`src/lib/conversations/facts.ts`), all read inside the
  caller's database step: the calls that count (the call joined to its booking; the host and the
  customer named; asked for by a customer; not cancelled; not ended with "End call and report";
  and, when there was such an ending between the two in either direction, only a call whose
  request was begun after the latest one (`bookings.createdAt`) and accepted by the host, so not
  a member's booking), "they have talked" (one of those calls, over, with a "joined" line for
  each of the two on that same call), blocks, both accounts, the host's page.
- **Opening a conversation** (`src/lib/conversations/open.ts`). The links below are small forms.
  The step works out the host and the customer itself: from the call the link names (the person
  must be one of its two), or, for a host's link beside a past customer, from the two having
  talked with her as the host. In this order: name the pair, take both calendar locks, check
  again that it is allowed, and only then make the pair's one row or find it. Then it sends the
  person to its page. A refusal makes nothing. A conversation is listed on "Messages" only once
  it holds a message, so opening one never shows up for the other person.
- **The step that sends** (`src/lib/conversations/send.ts`). One database step. It takes both
  people's calendar locks first, the same locks and the same order that blocking and booking
  take. So a send and a block happen in one order or the other, the same person's sends in other
  conversations wait their turn (which makes the per-person limits hold), and `block()` itself is
  not changed. Then the conversation's row. Only then it reads the clock, once, decides by that
  moment and everything it reads after the locks, gives the message its number, and dates it
  with that same moment.
- **What is not locked, on purpose:** a call being cancelled, the press of "End call and
  report", the founder's switch, an account being paused, a host's page being hidden. A message
  sent in the very moment one of these changes may go either way; one sent after it sees the
  change. None of them is a promise to a person the way a block is. For "End call and report"
  what counts is the press as it is recorded on the call: a press that reaches the server after
  the room has closed records nothing, and then nothing changes for messages (the report form
  that follows still blocks when it is sent).
- **The customer's switch**, and marking messages as shown, take the conversation's row and
  nothing after it; a send reads the switch again after its own locks.
- **Pages:** the conversation (`/conversations/[id]`: the latest 50 messages with "Show earlier",
  the box, the customer's switch, the sentence for each closed state, the "Book a time" button)
  and the list on "Messages". The conversation asks the server again every 5 seconds while it is
  in front; what is typed in the box stays.
- **The ways in:** "Write to *name*" on an agreed call's page, on the page after a call, and for
  a host beside each past customer on "People you have talked to". A customer sees a host by her
  host name. A conversation that already exists stays readable from "Messages" after the right
  to write in it has ended.
- **The top bar's count.**
- **The check script**, and the new pages in `scripts/journey-check.ts`'s list.

### Part 2: safety, keeping, the wording, and switching it on

- **Reporting from a message.** A kind of its own in the form's list ("message"). The form's
  one field for "what is this about" carries the conversation and the message's number
  together. Inside the report's own database step, not before it as for the other kinds: find
  that message, check that the reporter is the other
  person of its conversation, take its writer as the person reported, and write what is kept
  (decision 23) into the new table `report_conversations`.
- **When the block after a report runs into an error** (it runs after the report is saved, for
  every kind of report but a diary post's): today the reporter sees "something went wrong" and
  may report again, which makes a second report. Now the report's number is always given. The
  step then looks whether this reporter's block of this person is there (blocking saves the
  block first and can stumble afterwards). If it is: the usual thank-you. If it is not: "Your
  report was saved. This person is not blocked yet", on a small receipt page with the report's
  number and a "Block this person" button, which blocks the person of that report and works
  only for its reporter. (Not every place a report is made from has a block button; a host's
  page has none.) If even that look fails: "Your report was saved. We could not confirm the
  block." The phone app goes on reading the sentence it is given.
- **The report form's log line** no longer writes out a raw database error, which can hold what
  was sent (the pattern of the private-note form is used).
- **The founder's look** (decision 24).
- **The line about contact details.**
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
- The check scripts of what this touches, run again: safety (blocking and reports), journey,
  retention, home, and the ones that compare pages line by line.
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

## Found on the way

The Community Rules say of "End call and report": "The call ends for both of you, the other
person is blocked". The code blocks only when the form after the press is sent
(`src/lib/safety/calls.ts`, `src/lib/safety/reports.ts`). Someone who presses and then closes the
form has ended the call and blocked nobody. The Terms of Service make the same promise. This
plan does not change that: making the press itself block touches the money of other calls,
memberships and the phone app's screen, and Astra's second check showed how much has to be right
for it. It is a change of its own, with its own
check. Until then the proposed wording for the lawyer says what the code does, and decision 21
keeps messages safe either way.

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
   still open the 7 days. **Taken, differently after the second check:** such a call does not
   count, and after it no earlier call does either (decision 21). The press is not made to block
   (see "Found on the way").
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
    decided on no email for now (decision 30).
12. *The postal-address rule needs each message to remember why it was allowed.* **Overtaken**
    in the same way.
13. *New draft versions would send every account back to the welcome step.* **Taken:** proposed
    wording for the lawyer, not versions (decision 32).
14. *Part 1 could be switched on before reporting exists; and "off" must still let people read
    and report.* **Taken** (decision 31).

Also taken from the "worth considering" list: the corrections to "What is there today", and
showing the latest 50 messages with "Show earlier".

## Astra's second check (26 November 2026): "not ready"

Nine must-fix points, and three things it checked and found sound (leaving the four moments
unlocked, the rule for "new", and that nothing still depends on an email).

1. *The press of "End call and report" can stop the call and still leave the two able to write,
   and blocking there could block the wrong person on a repeated press.* and
2. *Blocking at the press moves a lot to that one press: memberships, contributions and other
   future calls end, the prompt does not say so, and the order of locks with adding time must be
   kept.* **Both answered by taking the block at the press out of this plan.** Decision 21 now
   closes messages by the press alone, with no change to the safety code. What the rules promise
   and the code does not is written under "Found on the way".
3. *Five unanswered messages could be passed before a booked call starts, and "wake" was not
   defined.* **Taken** (decisions 17 and 18).
4. *"They have talked" needs: not ended with "End call and report", and both joined that same
   call. And a paid call exists while its hold is still being placed.* **Taken** (the terms, the
   facts, "What is there today").
5. *Tighten the cancelled first call, the missed call, the hidden page and what the host's
   sentence promises.* **Taken** (decisions 8, 10, 11, 15).
6. *There must be a checked way to open a conversation before the first message.* **Taken**
   ("Opening a conversation").
7. *One clear way to name the reported message; find it inside the report's own step; say what
   happens when it is gone or the block fails.* **Taken** (decisions 22 and 23, part 2).
8. *The founder's list shows the reporter's note at once, and a reporter can quote a message
   there. The report form logs raw errors.* **Taken in part:** the log line. Not taken: hiding
   the reporter's note. It is the report itself, the reporter chose its words for the founder,
   and without it an urgent report could not be judged at a glance. Decision 24 now promises
   what is true: what was *kept* is never shown before the press.
9. *A switch that starts at off is not enough if part 1's code can still send; cover a database
   with no row, and a later update after the founder used the stop.* **Taken in part:** the
   missing row, the one-time change in part 2, and the later update (decision 31, proof 17).
   Not taken: making part 1 refuse to send whatever the switch says. Nothing is open to real
   people yet, and the check script has to send to prove the rules.

From its "worth considering": the search for contact details became one standing line
(decision 25), and the notes for a later email were cut.

## Astra's third check (26 November 2026): "not ready"

Three must-fix points, all at the edges of the second rework, and six things it checked and found
sound (how the cut after "End call and report" is worked out, decision 17, both ways of working
out who is the host when a conversation is opened, reporting a message through the form as it
is, the two points not taken, and the numbers of the decisions).

1. *After "End call and report", one person alone could open messages again:* a member by booking
   (the host is not asked), or the host by accepting a request that was already waiting.
   **Taken:** only a request sent after the press and accepted by the host counts
   (decision 21, proof 4).
2. *The press does not take the locks a send takes, so a message can be saved in the moment of
   the press; and a press just after the room closed records nothing.* **Taken as wording:**
   decision 21 goes by the press as recorded, and both cases are named under "What is not
   locked". Not taken: a lock on the call for every send, for the reason given there.
3. *The thank-you after a report could say "not blocked" when the block was saved and only the
   cleaning up after it failed.* **Taken:** the step looks for the block before it says so
   (part 2).

Also taken from its other points: a "wake" is defined by the host's own last message, the order
of steps when a conversation is opened, the "Book a call" button going by whether this customer
can book, and the Terms being named beside the Community Rules under "Found on the way".

## Astra's fourth check (26 November 2026): "not ready"

Two must-fix points, and three things found sound: the wording about the moment of the press,
the three outcomes after a report, and the order of steps when a conversation is opened.

1. *A request whose first step was pressed before "End call and report" and whose card step
   finished after it would count as asked for after the press.* **Taken:** the request must have
   been begun after the press (decision 21, the facts, proof 4).
2. *"Sent back to where the report was made, where the block button is" is not true of a host's
   page, which has none.* **Taken:** a receipt page with its own block button (part 2).

Also taken: no "Book a call to write" button after an "End call and report", and the wording of
proofs 4 and 8. Both must-fix points were corrected the way Astra said, so the builder did not
ask for a fifth check of the plan. The code of each part goes to Astra as usual.
