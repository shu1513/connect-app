# Plan 51: "End call now"

**Status:** built (26 November 2026; the record is in `docs/module-record.md`). Written
26 November 2026 by the builder alone (no helper agents), from the code as it is on `main` after
pull request 106. Astra (gpt-6.2-astra, high effort) checked the first draft against the code:
"not ready", twelve must-fix points. An automatic security check of the first build made three
more, and later ones three more. Astra then checked the plan and the code together: "not ready",
fifteen points; and looked a third time at what had changed: "not ready", eight smaller points.
All are answered below; the lists are at the end.

**Its size, said plainly:** one change, one pull request. Three new columns on a call, one new page,
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
   the new button and in which role: `calls.endedNowBy`, "host", "customer" or "customer_untold"
   (decision 8a). A call that carries the mark without it was ended with the old button, and
   keeps the old rules (decision 21). No payment is marked for review.
3. **Who pressed comes from what was really written. (builder, changed after Astra's check)**
   The press takes the call's row first, the same row that adding time, cancelling and closing
   the room hold. So what it reads is true: time added a moment ago counts, a call cancelled a
   moment ago is not ended on top, and of two presses in the same moment one is written. Then the
   answer says what is true:
   - pressed again by the same person: "ended by you", as the first time;
   - the other person was a moment earlier: "ended by the other person", and the money follows
     the one who is written down;
   - the room had already closed, or the call was cancelled: nothing is written, the call is
     charged as any finished call, and the three choices are still shown for a finished call;
   - the room is not open yet: refused, as today (such a call is cancelled, not ended).
3a. **"Ended for both" is only said with proof. (builder, after Astra's check)** After the press
   the room is closed by the helper's own step, which writes down that it is closed once the
   video service has confirmed that both are out. Until then the screens say "it is being closed
   for both of you", never "nobody can come back in", and the helper keeps trying. The other
   person's screen asks the server at once when its connection drops, offers nothing until the
   answer is there, and then says that the call has ended instead of offering to join again. The
   question before the press says "nobody will be able to come back in", as what the button does.
   On the phone, too, the three choices are reachable as soon as the press is saved, whatever
   the video service answers.

### The money

4. **Everything automatic. (founder)** The button and a report after it put nothing on the
   review list. Each payment of the call is settled by the helper at the call's usual moment.
5. **Time stops counting at the press, for every call. (as today)**
6. **"Available now" calls: unchanged. (founder)** The time both were in the call, whoever ends.
7. **The host pressed: the minutes. (founder)** Her connected time up to the press, as the code
   already counts it.
8. **The customer pressed: his whole booked time. (founder; the reading is the builder's)** He
   pays for the time the host was really in the call before the press, plus the rest of the
   booking from the press on. He does not pay for minutes he waited for her. (This reading was
   put to the founder as the fair one before this plan was written. Astra's check points out
   that it is less than "his entire booking time" when she came late; that is so, on purpose.)
   Two cases need a rule of their own, and both are the builder's:
   - **The host was not in the call when he pressed.** Then the rest is not charged, only her
     time before. A customer who waits ten minutes for a host who never comes and then presses
     the red button must not pay for the twenty minutes she also would not have given. She
     counts as "in the call" when her connection reached the press or ended at most 60 seconds
     before it (a dropped connection, or the two clocks differing by a second). This is read
     from her connections around the press, from the moment the room opened: not from one
     payment's part of the call, and not from the time that is billed (a host who is in the room
     when he presses in the first second of the call was there).
   - **He pressed before the booked start** (the room opens 5 minutes early). No call time
     exists yet, so it is charged as his cancelling at that moment would be, by the cancelling
     rule saved on the call: nothing where cancelling is free then, the whole booking where it
     would be a late cancellation. Otherwise the button would be a free way round her rule.
     Where it costs nothing, a member's time comes back as it was booked, like a cancellation in
     time, and not as time returned "because of the host".
8a. **Only a customer who was told. (builder, after Astra's check)** Until today a customer
   agreed, when he booked, to pay for the host's time in the call and read that time she is not
   there is free. Charging him the whole booking needs him to have agreed to that. So:
   - **The words he agrees to when he books now say it** (a new version of them, "2026-11-d"):
     "If you end the call yourself with 'End call now', you pay for your whole booked time: the
     time the host was in the call, and the rest of your booking. If you end it before its
     booked start, that is charged as cancelling it at that moment would be." The same sentence is on the
     confirm-and-pay step and on a member's booking page, and added time is "charged in the same
     way", as before.
   - **A member's booking records the words its page showed**, sent with the form like the card
     tick of an ordinary booking. A new booking that comes without them, or with other ones, is
     refused, so nobody gets the earlier rule by leaving the field out. A request that was
     written down earlier and is finished later keeps what it recorded then.
   - **A booking made under the earlier words is never charged that way.** At the press the
     server looks at the version of the words on the call's booking. Only with the new version is
     the press written as "customer". Otherwise it is written as "customer_untold", the button's
     question says "You pay for the time the host was in the call up to now", and the call is
     charged by her time, as he was told.
   - **Only the booking's own words decide**, never the page or the address a press comes from.
     (The first build let the button's old address always write "customer_untold". An automatic
     security check pointed out that anyone could then pay less by sending the press there.) A
     page that was open when the app was updated still has the old button, and its old address
     still ends the call. Such a page belongs to a booking made under the earlier words, so it
     is charged by the host's time anyway.
9. **Each stretch of added time follows the same rule with its own payment. (builder)** Whether
   "the rest of the booking" is charged is decided once for the call (decisions 6 to 8a), and
   then holds for every payment of it. So a stretch that lies wholly after the press is charged
   in full when the customer pressed and the rest is charged, and not at all in every other
   case (the host pressed, she was not there, an "available now" call, a report lowered it).
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
    was the customer who pressed "End call now" (written as "customer"), the call is a booked or
    member call, he pressed before the booked end, and at least one payment of the call can
    still change. The first such report decides; a later one for the same call changes nothing.
    It is decided in the report's own database step, holding the call's row and then its
    payments, so it comes either before the money step or after it, never in the middle.
    - **"Can still change"** is asked of each payment under its own lock: it is a live hold
      (not run out), or a card step that was begun before the press and whose hold may yet be
      recorded; it is not under review; and no charge or release of it is written down. A
      payment whose card step was never begun cannot be paid any more, and is not counted.
    - **A hold that is only recorded after the press** counts only if Stripe gives the moment
      of the bank's approval and that moment lies in an earlier second than the press. One
      without a date does not count, since nobody looks at it any more.
    - The effect: every payment of the call not yet settled is charged by the minutes
      (decision 7), exactly as if the host had pressed. An answer to a refund request that was
      already saved stays the most he pays.
    - **A part already taken stays as it is.** When some of the call's money was taken before
      the report (time added by card on a member's call can be), the thank-you says so, and
      says that a refund can be asked for.
    - **After all the money was taken a report changes nothing by itself**, and the thank-you
      says so (he may have opened the form while it was still waiting). The refund paths that
      exist remain: the host's refund, and the founder's.
    - **When the host had pressed**, a customer's report changes nothing: it is the minutes
      either way. The same for a press before the start while cancelling was free: nothing is
      charged, so nothing is lowered and nothing is counted.
    - **A report by the host changes nothing about the money.**
    - **No path can raise a charge.** The only thing a report writes is "by the minutes" in
      place of "the whole booking"; the money step adds "the rest of the booking" only when the
      customer pressed and no report lowered it.
15. **The host is never told that she was reported. (builder)** Her page of the call says only
    which rule the charge follows. The customer's page says that his report lowered it.

### The guard (the builder's choice, on the founder's word "do what you think is the best")

16. **Three of the last five. (builder)**
    - **His last 5 calls** are this call and the 4 that came into his history last: calls he
      was the customer of, with any host, booked or from a membership, not cancelled, that carry
      a report of his that lowered the charge, or of which something was really paid and kept
      (the call itself, or time added to it, after anything given back). A call that cost
      nothing is not one of them, whatever happened in it: nobody came, a few seconds, a free
      one, a call the host gave back in full, or a report that was not lowered on a call that
      then cost nothing. Neither is an "available now" call. Counting such calls would let him
      push the others out for nothing.
    - **In what order.** A call comes into his history when his report about it is taken, or
      else when it is charged, and his calls are read in that order, newest first, not by when
      they took place. So each report he makes is the newest thing in his history for the next
      one, in whatever order he reports and whenever the calls themselves are settled. It is
      read from the calls and their payments alone, not from messages of the video service that
      may still arrive.
    - **It counts the switch, not the dollars.** A report counts when it changed the call from
      "the whole booking" to "the minutes". How much that saved is only known a day later, and
      it can be nothing (the host was not there). The sentences to the founder and to the
      customer say what happened, and claim no amount.
    - **What is counted** is written on the call when the report is taken: "lowered, and
      counts", "lowered, does not count" or "not lowered". It is never worked out again later.
    - **The rule:** if 3 or more of the 4 calls before this one carry "lowered, and counts", this
      report does not lower the charge. With 2, it lowers it and the line is crossed (3 of 5).
      With fewer, it lowers it.
    - **Not "3 in a row"**, which one cheap normal call would reset. It clears by itself as
      normal booked calls push old ones out.
    - **A report does not count when another person has also reported that host.** Asked at the
      moment the report is taken, never later: is there a report about her by a different
      person, made as her customer from a call that was really paid for, in the last 12 months,
      open or closed? Only such reports count for this. Anyone can report a public page, anyone
      can report from a call the moment it is booked, and two people can join a room for a
      moment: a second account doing any of these would switch the guard off for nothing.
    - **Past the line nothing lowers the charge**, whoever else has reported that host. So what
      a customer sees (lowered, or not) never depends on other people's reports and tells him
      nothing about them. They only decide whether his own report is counted.
    - **His report and the block always go through**, lowered or not.
    - **Two of his reports at the same moment** cannot both slip under the line: the report
      step already takes one lock per reporter, and the second waits for the first.
    - **What it can give away, said plainly:** a customer who stands at the line can see, from
      whether his next report would still be lowered, that one of his earlier reports was not
      counted, and so that somebody else has reported one of those hosts. He is not told which
      host or who. Leaving this out would mean dropping "a report about a host others reported
      does not count", which protects people who report truthfully.
    - **What it cannot stop, said plainly:** two cheap, real, booked calls push two old ones out,
      and then a report lowers a charge again. Someone set on it can keep paying less on about
      three calls in five. Each time he reaches 3 of 5 again the founder is told again, and
      pausing the account is the founder's answer.
17. **Who is told. (builder)**
    - **The founder, once, when the line is crossed** (the report that makes it 3 of 5): a
      message in the app with its email, "[name] has ended a call and then reported the host 3
      times among their last 5 calls. Each time, the report meant that the call was charged by
      its minutes instead of the whole booking. A further
      report will not lower their charge while this stays so. Their reports and blocks still go
      through, and nothing else was changed. You can look at the account and pause it if you
      think that is right." It names no detail of any report. Later reports that are not
      lowered send nothing. If he falls back under the line and crosses it again, it is said
      again.
    - **No automatic freeze.** Calls are not recorded, so a cheat and a person with three bad
      calls look the same.
    - **The customer, when his report does not lower the charge:** at once, in the thank-you
      after the report and as a message with its email, long before the money is taken: "Your
      report about [name] was saved, and we will look at it. The call you ended is still charged
      for the whole booked time. Reports made after ending a call have already changed your
      charge from the whole booking to the minutes several times lately, so this one does not.
      If you think the charge is wrong, you can ask for a refund on the call's page, or write to
      us." (As built, it says "It does not change what the call you ended is charged", and names
      no amount: the call may cost nothing, when the host was not there.) It says nothing about
      the block: the block follows the report and can fail by itself,
      and the thank-you says what became of it. The screen before the report says the same
      about the charge, so he is not promised something he will not get.

### The screens

18. **The question before the press. (builder)** One sentence that says what it does and what
    it costs. It begins "End this call for both of you? Nobody will be able to come back in."
    and goes on:
    - a customer on a booked or member call: "Your whole booked time is still charged, except
      time the host was not in the call." Before the booked start: "The call has not started
      yet. Ended before its start, it is charged as cancelling it would be; once it has started,
      your whole booked time is charged." (Both halves, because the question may be answered a
      moment after the start.) For a booking made under
      the earlier words: "You pay for the time the host was in the call up to now."
    - a host: "You are paid for your time up to now."
    - an "available now" call: "The time you were both in the call is charged."
    - a free call: nothing more.
18a. **No sentence promises an amount that is not known yet. (builder, after Astra's second
    check)** Whether the host was in the call at the press is only known when the call's record
    is final. Until then the pages say "the whole booked time is charged: ... and, if [the host]
    was in the call at that moment, the rest of the booking". A press before the start says
    exactly what it costs, because that is known at once. A report that was not lowered says
    that it "does not change what this call is charged". Once the money is settled the page
    points to the call's own page instead of "the money is taken about a day after the call".
19. **The screen after it. (founder; the words are the builder's)** A page of its own,
    `/calls/[id]/ended`, for the person who pressed. It says who ended the call and what that
    means for the money, then three buttons, each with what it does:
    - **Report [name]**: "Tell us what happened. Only our team reads it. Reporting also blocks
      [name]." For a customer who pressed, when it is so: "If you report [name], this call is
      charged only for the time it lasted." (Said openly. Hiding it would leave a person who was
      really treated badly believing they must pay for the whole booking.)
    - **Block [name]**: "[name] can no longer ask you for calls or write to you. Your other calls
      with [name] that are still to come are cancelled at no charge, and any membership or
      monthly contribution between you ends. [name] is told that those have ended, never that
      you blocked them." Once the block stands the page says "You have blocked [name]" and
      nothing more, and the button stays as "Block [name] again": whether every call still to
      come was cancelled is said when the block is made, and blocking again tries once more. The
      sentence under that button says only what blocking again does.
    - **Neither**: "Nothing else happens. You can still report or block [name] later from this
      call's page."
    The other person sees "This call has ended" and is led to the same page, which says who
    ended it and offers the same three choices. The call's results page says who ended it too,
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
    its report form, "Block" asks once and blocks, "Neither" goes to the call's page. A call
    that is over shows "Report or block [name]" on its page in the app, so the choices can be
    reached later and by the other person. The server gets one new reading (the screen after
    ending) and one new step (block the other person of this call, which names only the call).
    Ending, learning that the other person ended it, the screen after it, blocking and reporting
    all still work for a copy of the app that was declared too old while the call ran. The
    answer to the press waits at most 8 seconds for the video service; after that the person is
    told "it is being closed" and has the three choices.
    The app's step has a new name and the old one is gone: the app is not in any store, so no
    copy with the old name exists. (The website's old address is kept, decision 8a.)

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

- **Database** (`drizzle/0067_end_call_now.sql`): on `calls`, `ended_now_by` (text), and for the
  report after it `end_report_at` (time) and `end_report_effect` (text: `minutes`,
  `minutes_uncounted`, `whole`), with checks on the allowed values.
- **The words a customer agrees to when booking**: a new version, "2026-11-d", with the sentence
  about "End call now"; a member's booking now carries the version of the words its page showed.
- **The rules, plain functions with tests**: `src/lib/payments/ended.ts` (does "the rest of the
  booking" count, and the seconds charged) and `src/lib/safety/end-guard.ts` (the guard, and the
  sentences).
- **The amount in one place**: `src/lib/payments/owed.ts`, asked by `jobs.ts`, `take.ts`,
  `membership/calls.ts` and the results page.
- **The press**: `src/lib/safety/calls.ts` rewritten (`endCallNow`); the website's address
  `/api/calls/[id]/end-now`, with the old one kept for pages that were open (decision 8a); the
  app's step `end-now`.
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

## What stays as it is, on purpose (after Astra's check)

- **A call under the founder's review** (its record of who was in the room does not add up) can
  be charged at most for the time before the press, for every payment of it, also where the rule
  would have charged the rest of the booking. Nothing after the press is charged on a record
  nobody can trust.
- **The helper's first look can let a hold go as "nothing owed" outside the step that holds the
  call** (as it always could, for every call). A message of the video service that arrives after
  the record was final could then come too late for that payment. Not changed here.
- **A charge that the app recorded as failed and Stripe later reports as made** is taken over as
  made (as always). A report that arrives in between is promised the lower charge and does not
  get it for that payment. It needs a failed answer from Stripe in the very minutes of the
  report; the founder's refund is the answer.
- **The two readings behind "may these two write"** are not taken in one step. Only a call ended
  with the old button could fall between them, and nothing writes such a call any more.
- **A hold whose approval and the press fall within the same moment.** The step that records a
  hold reads the call without holding its row, so a hold recorded in the very instant of the
  press can be judged by the call as it was a moment earlier; and the time Stripe gives is when
  the charge was begun, which for a card that asks its owner to confirm can be before the bank's
  yes. Either way the call is then charged by its rule, on a card its owner was authorising for
  this call.
- **A card step that was cancelled at Stripe and not yet tidied away** still counts as "can
  change" for a report. Such a call was never paid, so its customer was never in it; a report
  from it can only count against the person who made it.
- **A record that changes after the money was taken** is flagged as before, for both kinds of
  charge. It is noticed by a change in the counted seconds; a change that moves a connection and
  keeps its length would not be noticed.
- **Old code and new code on one database.** The helper that takes the money must run the same
  version as the app: an older helper would charge a call ended by a customer by the minutes,
  and would let the hold of added time go as "nothing owed". The app and its helper are put out
  together. On the shared test database the check scripts take turns for the same reason.

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

## Astra's check of the first draft (26 November 2026): "not ready"

Twelve must-fix points, each read against the code. The call's row as the place to decide who
ended the call was found right. All twelve are answered:

1. *The reading of "his whole booked time" is less than the founder's words, and the customer
   never agreed to it when booking.* The reading stays (it was put to the founder first), and is
   now said to be the builder's in every case. The agreement was the real gap: decision 8a.
2. *A press just after the old end, while added time is being saved, could be told "too late".*
   The press now takes the call's row first (decision 3).
3. *"The press was saved" is not "both are out".* Decision 3a.
4. *The amount must take the full booking and the real attendance apart, and read "was she
   there" from the whole call.* It does (`src/lib/payments/owed.ts`), also at the helper's first
   look, which can let a hold go.
5. *A hold that lands after the press, and a report made before it lands.* Decision 14: a card
   step still open counts as "can still change"; a hold without a date from Stripe no longer
   counts after an "End call now". A member's free press before the start gives the time back
   as it was booked (decision 8).
6. *Decide per payment, under its lock; a written-down charge has its amount; say what was
   affected.* Decision 14.
7. *The founder's ceiling, and late changes of the record.* Kept, and said under "What stays as
   it is".
8. *Reports made newest first could all qualify; a report that saved nothing would count.* The
   history is the 4 other calls nearest to now, whichever is reported first, read from calls and
   payments alone; the guard counts the switch, and the sentences claim no amount (decision 16).
9. *Calls that cost nothing could push reports out; a report from a call that never took place
   could switch the guard off; the screen could give another customer's report away.* Decision
   16, and "past the line nothing lowers the charge".
10. *The customer's message said "[name] is blocked" before the block existed; "[name] is not
    told" was not quite true.* Both sentences changed (decisions 17 and 19).
11. *The phone app had no way to the choices later.* Decision 23.
12. *Old code beside new code; the old page's question.* Decision 8a for the old page (a booking
    under the earlier words is never charged the whole booking), and "What stays as it is" for
    the helper.

Smaller points taken: the results page gives the booked length, not the length up to the press;
the report form and the founder's report list tell the old button from the new one.

## The automatic security checks of the build (26 November 2026)

A later one: the button's old address must not decide the charge (decision 8a); taken. Before
that, three points, all taken: another person's report only counts from a call with that host that
really took place; calls that cost nothing are not among "his last 5"; and what a customer sees
never depends on other people's reports (first written as "also lowers past the line", which
would have told a customer past the line that somebody else had reported that host).

## Astra's check of the plan and the code together (26 November 2026): "not ready"

Fifteen points. The row lock in the press, the order of locks everywhere, and the arithmetic for
a complete record were found right. Taken, with the decision they changed:

1. *The button's two addresses charged differently.* Already closed by the security check: only
   the booking's words decide (8a).
2. *A member's booking recorded words its member may never have seen.* 8a.
3. *A host in the room at the press could be read as absent* (a press in the first second, a
   connection that ended just before the start). 8.
4. *A hold recorded after the press: our own clock proved nothing, and Stripe's is to the second.*
   14.
6. *A payment that can never be paid, and a hold that has run out, counted as "can still
   change".* 14.
7. *Reports that were not lowered, on calls that cost nothing, pushed counted ones out; time
   added to a call was not counted as paid.* 16.
8. *A second person's report from a call that cost nothing switched counting off.* 16. Its
   second half, that a customer at the line can infer something, is said under decision 16.
9. *Sentences that promised "the whole booking" before it was known.* 18a.
10. *The form's promise when a part of the money is already taken, and when all of it is taken
    before the form is sent.* 14, 19.
11. *"Nobody can come back in" before it is so; the other person offered "join again" while the
    server is asked; the phone left without the choices when the video service fails; a copy of
    the app declared too old could end a call and not report or block.* 3a, 23.
12. *A block that stands shown as proof that every call was cancelled.* 19.
14. *A member's press before the start under the earlier words counted as time returned because
    of the host; the 14-day note left out a call ended before its start.* 8, and the note now
    counts such a call as one that has begun.
15. *Checks that would pass with the protection broken.* The check script was tightened: the
    open card step, the hold on every call, "Neither", and what the block's screen says.

Not taken, and why (each is also under "What stays as it is"): 5 (the helper's first look, as it
always was), the first half of 6 (a failed answer that was a success), 13 (only the old button
could cause it), and the backlog in 7 (a customer would need newer calls settled before older
ones, which the day's wait does not allow).

Smaller points taken: the database's check on the new columns no longer lets a half-written
report through; a bank dispute's text claims only what is held (the press and the booking's
words, not that he read a sentence).

## Astra's third look, at what had changed (26 November 2026): "not ready"

Eight points, each smaller than before. Fixed as it found them: the two addresses (1 of the
second check), the history (7), a second person's report (8) and the member's press before the
start (14). Taken now:

1. *A new member booking sent without the words' version was recorded under the earlier rule.*
   A new booking must come with the version in force (8a). The security check found the same.
2. *A host who joined in the very second of the press was read as absent.* The reading runs one
   second past the press (8).
5. *The backlog: newer calls can be settled before older ones, when a refund request is answered
   at once.* True, and the reason given before was wrong. His history is now read in the order
   in which calls came into it (a report, or a charge), not by when they took place (16).
6. *Sentences.* A host's page after a report that was not lowered on a press before the start;
   "time after that is not counted" on a call charged for that time; "nothing is charged"
   followed by "the money is taken about a day after the call"; "had already been taken" for a
   charge that was only on its way; the phone's question that could be answered a moment after
   the start; and the bank dispute's text. All reworded (18, 18a).
7. *The other person's screen offered "join again" when the server did not answer; a slow video
   service left the phone without the choices; a copy of the app declared too old could not
   learn that the other person had ended the call.* 3a, 23.
8. *Under "You have blocked [name]" the page still said that the calls to come are cancelled.* 19.

Not taken, both under "What stays as it is": 3 (a hold recorded in the very instant of the
press) and 4 (a card step cancelled at Stripe and not yet tidied away).

The security check of the same commit added: a call counts as paid only for what was kept after
anything given back (16).
