# Plan 50: "End call now"

**Status:** a plan, not built yet. Written 26 November 2026 by the builder alone (no helper
agents), from the code as it is on `main` after pull request 106. Astra's checks and what they
changed are listed at the end.

**Its size, said plainly:** one change, one pull request. Four new columns on a call, one new page,
the charging rule in one new place that every money step asks, and the phone app's call screen
changed in the same pull request. Nothing new is installed.

## For the founder: what this is

Inside a call each person has one red button. Today it says "End call and report". It ends the
call, puts the money on your review list, and opens a report form.

After this change it says **"End call now"**. It ends the call for both people at once, and
nobody can come back in. Then one screen asks what else the person wants, with three choices:

- **Report [name]**: the report form that exists. Reporting also blocks, as everywhere on Connect.
- **Block [name]**: the block that exists, with a sentence that says what it ends.
- **Neither**: nothing else happens.

The money settles by itself, about a day after the call, as for every call. You never have to
decide anything:

- **The host ended it:** the customer pays for the host's time up to that moment.
- **The customer ended it:** he pays for his whole booked time.
- **The customer ended it and then reports the host:** he pays only for the time the call
  lasted, as if the host had ended it.
- **"Available now" calls** keep their rule, whoever ends: the time both were in the call.

A customer who ends calls and reports again and again stops getting the lower price (decision 16),
and you get one message when that happens.

## What the founder said (26 November 2026)

"ending call and report should be 2 separate things. instead of 'End call and report', it should
probably be 'End call now' then the options for report and block"

The founder's decisions, all fixed:

1. One button in the call, "End call now". It ends the call for both at once and nobody can
   rejoin.
2. Right after it, one screen with "Report [name]", "Block [name]" and "Neither". Reporting still
   blocks.
3. The money, for a booked call: "if host pressed the end ... charged based on the minutes ... if
   customer pressed it, his entire booking time is still charged".
4. "Available now" calls keep their own rule. The rule of point 3 also holds for calls paid from a
   membership (customer ends: the whole booked time is used from his month; host ends: only the
   minutes, and the rest goes back to his month).
5. No deciding by hand: "a better automatic way ... instead of me manually deciding it". If the
   customer reports the host after the call ended, he is charged only for the minutes that
   happened. A report by the host changes nothing about the money. A report can only lower a
   charge, never raise anyone's pay. Nothing goes on the review list because of the button or a
   report.
6. A plain "End call now", with no report and no block, does not close the messages between the
   two.
7. A guard against a customer who reports again and again to save money: "maybe after 3
   consecutive times or something like that we freeze his account? not sure what's the best
   algorithm", someone who does it once in a while must not be caught, and then "do what you
   think is the best". So the guard itself (decision 16 below) is **the builder's choice**.

Decisions marked **(founder)** below are these. Every other one is the builder's own and is marked
**(builder)**. The founder can change any of them.

## What is there today (each read in the code by the builder)

- **The button** (`src/lib/safety/calls.ts`, `stopCall`) writes `calls.safetyEndedAt` and
  `safetyEndedBy`, marks every held payment of the call `needsReview`, and closes the room. It
  answers "open" even when its update changed nothing (a second press, or the other person a
  moment earlier), so the caller cannot tell who really ended the call.
- **About 60 places read `safetyEndedAt`** as "this call is over": entering, cancelling, adding
  time, reminders, the home page, the room's closing, ratings, following, tips, the project box.
  None of them cares which button it was.
- **The charge** is worked out in four places with the same two lines
  (`attendanceChargeCents` with `countedSeconds`): the helper's first look
  (`src/lib/payments/jobs.ts`), the taking of the money (`src/lib/payments/take.ts`), the member's
  call (`src/lib/membership/calls.ts`) and the results page. Time stops counting at the stop
  (`countedWindow` in `src/lib/attendance/calc.ts`). A booked call charges the host's connected
  time (`calls.billing = "host"`), an "available now" call the time both were in ("together").
  Each stretch of added time has its own payment. Under 50 cents nothing is charged.
- **The money is taken about a day after the call's start**, or sooner when a refund request was
  answered (`src/lib/payments/take.ts`), in one step that holds the call's row.
- **A report** (`createReport` in `src/lib/safety/reports.ts`) is written in one database step
  that first takes a lock for the reporter, so two reports of one person never run side by side.
  The block follows after that step.
- **Messages** (plan 49, decision 21): after a recorded "End call and report" no call between the
  two counts until both have acted again (`callFacts`, `callsThatCount`).
- **The phone app** (`mobile/`, paused before part 09b, never released) has the same button with
  the server's words, calls the step `end-and-report`, and then opens its report form.
- **The legal documents** (`src/legal/documents/`, all drafts, "not in force yet") describe the
  old button in four places: Community Rules, Terms of Service 7.5, Payment Terms 8, Host
  Agreement 8.3.
- **A bank dispute's evidence** (`src/lib/disputes/proof.ts`) explains a charge from its reason
  (`payments.chargeReason`): for "attendance" it says "Connect charges only for time that took
  place". That would be untrue of a whole booking charged after the customer ended the call.

## Decisions

### The press

1. **One button, "End call now". (founder)** It ends the call for both at once; nobody can enter
   again. The question before it says what it costs the person who presses (decision 18).
2. **What is written. (builder)** The two columns that exist keep their names and their meaning
   for every reader: `safetyEndedAt` (when) and `safetyEndedBy` (who). One new column says it was
   the new button and in which role: `calls.endedNowBy`, "host" or "customer". A call that
   carries the mark without it was ended with the old button, and keeps the old rules
   (decision 21). No payment is marked for review.
3. **Who pressed comes from what was really written. (builder)** The press is one update that
   only succeeds while the call is neither ended nor cancelled and its room is open, with the
   room's times read from the row itself (so time added a moment ago counts). If it changed
   nothing, the call is read again and the answer says what is true:
   - pressed again by the same person: "ended by you", as the first time;
   - the other person was a moment earlier: "ended by the other person", and the money follows
     the one who is written down;
   - the room had already closed: nothing is written, the call is charged as any finished call,
     and the three choices are still shown;
   - the room is not open yet: refused, as today (such a call is cancelled, not ended).

### The money

4. **Everything automatic. (founder)** The button and a report after it put nothing on the
   review list. Each payment of the call is settled by the helper at the call's usual moment.
5. **Time stops counting at the press, for every call. (as today)**
6. **"Available now" calls: unchanged. (founder)** The time both were in the call, whoever ends.
7. **The host pressed: the minutes. (founder)** Her connected time up to the press, as the code
   already counts it.
8. **The customer pressed: his whole booked time. (founder; the reading is the builder's)** He
   pays for the time the host was really in the call before the press, plus the rest of the
   booking from the press on. He does not pay for minutes he waited for her. Two cases need a
   rule of their own:
   - **The host was not in the call when he pressed.** Then the rest is not charged, only her
     time before. A customer who waits ten minutes for a host who never comes and then presses
     the red button must not pay for the twenty minutes she also would not have given. She
     counts as "in the call" when her connection reached the press or ended at most 60 seconds
     before it (a dropped connection, or the two clocks differing by a second).
   - **He pressed before the booked start** (the room opens 5 minutes early). No call time
     exists yet, so it is charged as his cancelling at that moment would be: nothing where the
     host's rule makes cancelling free then, the whole booking where it would be a late
     cancellation. Otherwise the button would be a free way round her cancelling rule.
9. **Each stretch of added time follows the same rule with its own payment. (builder)** A
   stretch that lies wholly after the press is charged in full when the customer pressed (he
   asked for that time and then ended the call), and not at all when the host pressed.
10. **A call paid from a membership. (founder)** The same amounts, used from the month and never
    more than was set aside; what is not used comes back to the month as it does today.
11. **Nothing under 50 cents. (as today)**
12. **One place works the amount out. (builder)** A new function gives, for one payment of one
    call, what the record says is owed. The helper's first look, the taking of the money, the
    member's call and the results page all ask it, so they can never disagree.
13. **The charge says which rule made it. (builder)** A charge that includes "the rest of the
    booking" is written with the reason `customer_ended` (beside "attendance", "late_cancel" and
    "admin"). The receipt says so, and a bank dispute's evidence says "the customer ended this
    call himself; under the booking's terms the whole booked time is charged" instead of "only
    time that took place".

### The customer's report

14. **Which report lowers the charge. (founder; the edges are the builder's)** A report made
    from that call (the form reached from the call), by its customer, about its host, when it
    was the customer who pressed "End call now", the call is a booked or member call, he pressed
    before the booked end, and at least one payment of the call is still waiting (held, not under
    review, no money step started). The first such report decides; a later one for the same call
    changes nothing. It is decided in the report's own database step, holding the call's row, so
    it comes either before the money step or after it, never in the middle.
    - The effect: every payment of the call not yet settled is charged by the minutes
      (decision 7), exactly as if the host had pressed.
    - **After the money was taken a report changes nothing by itself.** The refund paths that
      exist remain: the host's refund, and the founder's.
    - **When the host had pressed**, a customer's report changes nothing: it is the minutes
      either way.
    - **A report by the host changes nothing about the money.**
    - **No path can raise a charge.** The only thing a report writes is "by the minutes" in
      place of "the whole booking"; the money step adds "the rest of the booking" only when the
      customer pressed and no report lowered it.
15. **The host is never told that she was reported. (builder)** Her page of the call says only
    which rule the charge follows. The customer's page says that his report lowered it.

### The guard (the builder's choice, on the founder's word "do what you think is the best")

16. **Three of the last five. (builder)**
    - **His last 5 calls** are this call and the 4 before it: calls he was the customer of, with
      any host, booked or from a membership, paid, not cancelled, over, and in which both he and
      the host joined. "Available now" calls and free calls are left out: a report never lowers
      their charge, and they cost little or nothing, so counting them would only let him push
      the others out for free.
    - **What is counted** is written on the call when the report is taken: "lowered, and
      counts", "lowered, does not count" or "not lowered". It is never worked out again later.
    - **The rule:** if 3 or more of the 4 calls before this one carry "lowered, and counts", this
      report does not lower the charge. With 2, it lowers it and the line is crossed (3 of 5).
      With fewer, it lowers it.
    - **Not "3 in a row"**, which one cheap normal call would reset. It clears by itself as
      normal booked calls push old ones out.
    - **A report does not count when another person has also reported that host.** Asked at the
      moment the report is taken, never later: is there a report about her by a different
      person, made from a call she hosted that really took place (paid, not cancelled, both
      joined), in the last 12 months, open or closed? Only such reports count for this. Anyone
      can report a public page, and anyone can report from a call the moment it is booked: a
      second account doing either would switch the guard off for nothing.
    - **Past the line nothing lowers the charge**, whoever else has reported that host. So what
      a customer sees (lowered, or not) never depends on other people's reports and tells him
      nothing about them. They only decide whether his own report is counted.
    - **His report and the block always go through**, lowered or not.
    - **Two of his reports at the same moment** cannot both slip under the line: the report
      step already takes one lock per reporter, and the second waits for the first.
    - **What it cannot stop, said plainly:** two cheap, real, booked calls push two old ones out,
      and then a report lowers a charge again. Someone set on it can keep paying less on about
      three calls in five. Each time he reaches 3 of 5 again the founder is told again, and
      pausing the account is the founder's answer.
17. **Who is told. (builder)**
    - **The founder, once, when the line is crossed** (the report that makes it 3 of 5): a
      message in the app with its email, "[name] has ended a call and then reported the host 3
      times among their last 5 calls. Each time the report lowered what they paid. A further
      report will not lower their charge while this stays so. Their reports and blocks still go
      through, and nothing else was changed. You can look at the account and pause it if you
      think that is right." It names no detail of any report. Later reports that are not
      lowered send nothing. If he falls back under the line and crosses it again, it is said
      again.
    - **No automatic freeze.** Calls are not recorded, so a cheat and a person with three bad
      calls look the same.
    - **The customer, when his report does not lower the charge:** at once, in the thank-you
      after the report and as a message with its email, long before the money is taken: "Your
      report was saved and [name] is blocked. This call is still charged for the whole booked
      time: reports made after ending a call have lowered your charge several times lately, so
      this one does not. If you think the charge is wrong, ask for a refund on the call's page
      or write to us." The screen before the report says the same, so he is not promised
      something he will not get.

### The screens

18. **The question before the press. (builder)** One sentence that says what it costs:
    - a customer on a booked or member call: "End this call for both of you? Nobody can come
      back in. Your whole booked time is still charged."
    - a host: "End this call for both of you? Nobody can come back in. You are paid for your
      time up to now."
    - an "available now" call: "End this call for both of you? Nobody can come back in. The
      time you were both in the call is charged."
    - a free call: only the first two sentences.
19. **The screen after it. (founder; the words are the builder's)** A page of its own,
    `/calls/[id]/ended`, for the person who pressed. It says who ended the call and what that
    means for the money, then three buttons, each with what it does:
    - **Report [name]**: "Tell us what happened. Only our team reads it. Reporting also blocks
      [name]." For a customer who pressed, when it is so: "If you report [name], this call is
      charged only for the time it lasted." (Said openly. Hiding it would leave a person who was
      really treated badly believing they must pay for the whole booking.)
    - **Block [name]**: "[name] can no longer ask you for calls or write to you. Your other calls
      with [name] that are still to come are cancelled at no charge, and any membership or
      monthly contribution between you ends. [name] is not told."
    - **Neither**: "Nothing else happens. You can still report or block [name] later from this
      call's page."
    The other person sees "This call has ended" and the results page, which says who ended it
    and has "Report" and "Block" as before.
20. **After a plain end the two are not strangers. (builder, from decision 6)** "Book another
    call" and "Write to" stay on the results page unless there is a block. Ratings, the automatic
    follow, the tip box and the project box stay off for a call ended this way, as today: a call
    that was cut short is no moment to ask for stars or money.

### Calls ended with the old button

21. **They keep everything as it is. (builder)** Their payments stay on the review list with the
    same reason and ceiling, the founder decides them as before, and for messages they keep the
    old cut (decision 22). They are told apart by the missing `endedNowBy`. A copy of the app
    running the old code against the shared test database writes such calls too, and they are
    then handled by the old rules, which is what that code expects.

### Messages

22. **Plan 49's decision 21, rewritten. (founder's decision 6)** A call ended with "End call
    now" counts for messages like any other call that was not cancelled: around it the two can
    write, and if both joined they "have talked". A block or a report closes the conversation,
    as they already do. Only a call ended with the old button still cuts the two off until both
    have acted again. The code keeps that one branch for old calls and nothing else changes.

### The phone app

23. **Its screen changes in the same pull request. (builder)** The button and its question use
    the new words, by role. After the press the app shows the same three choices: "Report" opens
    its report form, "Block" asks once and blocks, "Neither" goes to the call's page. The server
    gets one new reading (the screen after ending) and one new step (block the other person of
    this call). The old step's address keeps working under both names, so nothing can press a
    button that leads nowhere. The app is not in any store, so no older copy exists.

### The written rules

24. **Proposed wording, not new versions. (builder, as in plan 49)** The four passages are
    rewritten in `docs/legal/end-call-now-proposed-wording.md` for a lawyer; the sentence in
    `docs/legal/messages-proposed-wording.md` points there. The documents in the app are drafts
    and stay as they are until the lawyer's words go in, once, with the other waiting changes.
    The questions go into `docs/for-the-lawyer.md`.

## What it must prove

1. Who pressed is what was written: a second press, the other person in the same moment, a press
   after the room closed and one before it opened each give the true answer and write nothing
   they should not.
2. Each charging case, with a real hold and a real charge in Stripe's test mode where money
   moves: host ends (minutes), customer ends (whole booking), customer ends while the host is
   not there (her minutes only), customer ends before the start under both cancelling rules,
   added time under both, a member's call both ways, an "available now" call (unchanged), under
   50 cents (nothing).
3. A customer's report after his own press lowers the charge; one after the host's press, one by
   the host, and one after the money was taken change nothing. No case ends with a charge above
   the rule without a report.
4. The guard: 2 of 5 lowers and tells nobody; 3 of 5 lowers and tells the founder once; the next
   is not lowered, tells the customer and not the founder again; a sixth call pushes one out; a
   report about a host someone else reported from a call does not count and still lowers; two
   reports at once.
5. Nothing reaches the review list from the button or a report. A call ended with the old button
   keeps its review and its ceiling.
6. The three choices: the page shows them with the right sentences for each role, the block does
   what its sentence says, "Neither" changes nothing.
7. Messages stay open after a plain end and close after a block or report; a call with the old
   mark still cuts them.
8. The phone app's server steps answer as its new screen expects, under both addresses.
9. A bank dispute's evidence for a `customer_ended` charge says what is true.

## What gets built

- **Database** (`drizzle/0065_end_call_now.sql`): on `calls`, `ended_now_by` (text), and for the
  report after it `end_report_id` (uuid), `end_report_at` (time) and `end_report_effect` (text:
  `minutes`, `minutes_uncounted`, `whole`), with checks on the allowed values.
- **The rules, plain functions with tests**: `src/lib/payments/ended.ts` (does "the rest of the
  booking" count, and the seconds charged) and `src/lib/safety/end-guard.ts` (the guard, and the
  sentences).
- **The amount in one place**: `src/lib/payments/owed.ts`, asked by `jobs.ts`, `take.ts`,
  `membership/calls.ts` and the results page.
- **The press**: `src/lib/safety/calls.ts` rewritten (`endCallNow`, `endCallNowConfirmed`); the
  website's address `/api/calls/[id]/end-now` with the old one kept as a second name; the app's
  step `end-now` with `end-and-report` kept as a second name.
- **The report**: `src/lib/safety/end-report.ts`, called inside `createReport`'s own step.
- **The screens**: the call room's button and question, `/calls/[id]/ended`, the results page's
  lines, the report form's sentence, the founder's report list.
- **Messages**: `callFacts` and the comments and tests of `callsThatCount`.
- **Disputes**: the `customer_ended` sentence in `proof.ts`, and the facts it needs.
- **The phone app**: `mobile/src/app/room/[id].tsx`, `mobile/src/room/in-call.tsx`, its rules
  and tests, the words in `src/lib/app-door/room.ts`, a new reading and a new step under
  `/api/app/calls/[id]/`.
- **The words**: "End call and report" taken out of every page; comments that describe the
  button brought up to date.

## How it is checked

- Tests for the rule functions at their edges.
- A new script, `scripts/end-now-check.ts`, for proofs 1 to 7 and 9, against the local database,
  the running app and Stripe's test mode.
- The scripts that cover a stopped call, changed to the new rules and run again: `safety-check`,
  `extend-check`, `member-calls-check`, `app-calls-check`, `app-room-check`,
  `conversation-check`, and `payments-check` and `refunds-check` to see nothing else moved.
- By hand in a browser as the test host and the test customer.
- Lint, types, build, all automatic tests, and the phone app's own tests and types.

## What the checks cannot cover

- A real call between two people on two devices: that the room really empties for the other
  person at the press is the video service's work, checked here only through its answer.
- The phone app's new screen on a phone. It is typed, linted and unit-tested; the app is paused
  and was not started.
- Whether "the host was in the call when he pressed" reads right on a bad connection: it rests
  on the video service's messages, with 60 seconds of leeway.

## Not built now

- New versions of the legal documents (decision 24).
- An automatic pause for a customer past the line (decision 17).
- Changing what happens when a customer simply leaves a call: he still pays for the host's time
  while she stays, as before.

## For the lawyer (each is in `docs/for-the-lawyer.md`)

Charging a customer his whole booking when he ends a call; lowering a host's pay on a customer's
report that nobody examines; treating a customer differently after several reports, and what he
must be told; whether telling customers that a report lowers the charge invites false reports in
a way that matters legally; what the four documents must say about all of it.
