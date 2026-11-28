# Plan 52: an account is paused by itself, and an average needs 5 people

27 November 2026.

## Why

Today a report punishes nobody by itself: a person on the team reads it and pauses the account by
hand, or does not. The founder: "maybe we should have a best automatic way this way we don't take
up time from the team." And about ratings: "if someone only got 2 ratings and they are all low, we
shouldn't use that just yet because the sample size is small ... is 3 way to low a number? how
about 5".

## What the founder said (27 November 2026)

- An automatic way to pause, so the team's time is not used.
- The builder's first proposal (3 different people within 90 days) was too easy to reach: "i
  meant to make the automatic pause harder to trigger".
- "also maybe if someone's rating is way too low?", and "people can only rate other people after
  a call" (so a rating is hard to fake).
- An average is shown from 5 different people on, not from 3.

Every number and every detail below is the builder's, and the founder may change any of it.

## What a pause does (as today, and why this must be hard to reach)

A paused account can log in and read, but cannot book, host or join calls. Its waiting requests
end and its calls that have not started are cancelled at no charge. Its memberships and its
monthly contributions end at once **and for good**: lifting the pause does not bring them back.
So a pause made by mistake costs a host her members. That is the reason for the high numbers.

## Decisions

### Ratings

1. **An average appears once 5 different people's ratings count. (founder)** Before that the
   person is "New". After the first 5 it moves three people at a time, as before (builder): the
   founder's worry is a sample that is too small, and three people at a time still keeps one
   person's stars from being read off.
2. **A group left out can take the average away again. (builder)** A group with a closed account
   in it is left out, as today. If fewer than 5 people's ratings are left, nothing is shown.

2a. **The average is a rolling one: the most recent 50 people or so. (the founder asked "should
   we also use a rolling average? ... what's the best way"; the answer and the number are the
   builder's)** Before, an average was over all time, so a bad start could never be repaired and
   a good past hid a bad present. Now only the most recent whole groups count, as many as hold
   at most 50 people. People, not days: a window in days would take the average away from
   anyone who takes few calls (Uber counts the last 500 trips, not a time). Each person still
   counts once, with their first rating, and still nobody's stars can be read off: a group
   comes in as a whole and an old one leaves as a whole. What it costs: a host with thousands of
   calls shows "from 48 ratings".

### Paused by itself because of reports

3. **5 different people within 90 days, and at least 1 in 10 of the people they had calls with.
   (builder)** The account is paused when, in the last 90 days, 5 different people have made a
   report about it that counts (decision 4), and those people are at least one tenth of all the
   different people the account had a really paid call with in those 90 days. The share is there
   for a busy account: 5 reports out of 500 customers say little, 5 out of 10 say a lot. (Uber
   and Lyft judge a driver against their recent trips, not by a bare count; the founder asked
   how they do it.) The founder asked whether 90 days is right, or 60: the builder would keep 90.
   A shorter time mostly helps an account with few calls, which could then never gather five.
4. **Which reports count. (builder)** A report counts when all of this is true:
   - it was made in the last 90 days, and after the last time a pause of the account was lifted
     (decision 8);
   - its reporter has had a call with the account, in those 90 days, that was really paid for
     (decision 4a). A stranger's report about a page and a report after a free call do not
     count: they cost nothing to make;
   - the reporter's account is not closed;
   - the account has no open report of its own about that reporter from those 90 days (when the
     two reported each other, neither report counts here; a person on the team can still read
     both). A report of the account's that the team closed, or an old one, takes nothing out;
   - nobody on the team has closed it. A report a person has looked at and closed is settled:
     that person could have paused the account by hand.
   Where a report was made from (a call, a request, a message, a page) does not matter: what
   matters is who made it.
4a. **"Really paid for". (builder, after the automatic security check and Astra)** Money was taken
   for the call (a member's call: a part of the month was used for it), and no bank took it
   back: a call with a bank dispute that is open or lost on any of its payments (its own, or
   one for time that was added) does not count. Money that the host
   or Connect gave back afterwards does **not** undo it. Otherwise a host could give their money
   back to the people who complained, or who rated low, and make it all disappear.
5. **Urgent reports stay as they are. (builder)** "Someone under 18" and "threats" still email the
   team at once. One report alone never pauses anyone: that would be a weapon.

### Paused by itself because of ratings

6. **An average of 2.0 or lower from 11 or more people, counting paid calls only. (builder)**
   (Ratings count in whole groups, the first 5 people and then 3 at a time, so an average is
   from 5, 8, 11, 14, ... people. The builder first said "at least 10"; 11 is the first such
   number above 10, and the rule and every sentence now say 11.) Counted as the shown average is (each person once, a week after the call, whole
   groups, the most recent 50), for the person as a host and as a customer, each by itself, but
   only from ratings of calls that were really paid for (decision 4a): a free call costs nothing
   to make. Only ratings of calls that started after the last time a pause was lifted count
   (decision 8). So this average can differ from the one a page shows.
6a. **A warning first, and then at least 14 days. (builder; Uber and Lyft warn first)** When this
   average is 2.5 or lower, the person gets one email: their average is low, and an account at
   2.0 or lower from 11 or more people is paused, no sooner than 14 days from now. Nobody is
   paused for ratings without that email, and not before 14 days have passed since it: also not
   an account that is already at the line when it is first looked at. One warning per fresh
   start (decision 8) for each role: a warning about someone's ratings as a host never stands
   in for one about their ratings as a customer. A warning whose email can no longer be found
   (emails are emptied two years after they were sent) is taken back, and a new one is sent.
   There is no such warning for reports (see "What stays").

### What happens

7. **The same pause as by hand. (builder)** The person is told by email and on the paused page
   why, in general words, and where to write if they think it is a mistake. The founder gets an
   email saying that it happened and why: nothing to decide unless the person writes in.
7a. **The person is given the rule, never a number of their own. (builder, after Astra)** Not who
   reported or rated them, not how many people reported them ("several different people"), and
   not their average or how many people it is from ("2.0 or lower from 11 or more people"). An
   average counted for the pause is not the one their pages show, and the two side by side could
   give one person's stars away. The founder's email has the numbers.
8. **Lifting a pause is a fresh start. (builder)** A person on the team lifted it, so a person has
   looked. Reports made before that moment, and ratings of calls that started before it, no
   longer count toward a pause by itself, and a new warning must come before a pause for
   ratings. Otherwise the next round would pause the account again. Only lifting a pause that
   is there does this: a second press of the button changes nothing. A pause that was lifted
   before this was built counts as a fresh start too (the migration reads the admins' record).
8a. **Counted twice. (builder, after the automatic security check and Astra)** A round counts
   first and acts after. In the step that pauses (or warns) the account's row is held, its
   fresh start is read again, and what was counted is counted again there. If a person lifted a
   pause or closed a report in between, nothing is done.
9. **Who is never paused by itself. (builder)** An admin's account; a closed account (if it is
   opened again, the next round looks at it).
10. **When it is looked at. (builder)** By the helper, about every 10 minutes, beside its other
    work and never holding it up. Not at the moment of the report: a report made right after a
    call counts only once that call's money is taken, about a day later.

11. **Switched off for now. (the founder, 27 November 2026)** Told that a pause ends a host's
    memberships for good, the founder wrote: "instead of ending the memberships, maybe we should
    pause the memberships". That is a piece of work of its own (members must not be charged
    while the host is paused, their unused time must be kept, and all of it must pick up again
    when the pause is lifted). Until it is built, the round does not run: the helper starts it
    only where `AUTO_PAUSE=on` is set. Everything else here is in use: the average from 5
    people, the rolling average, and the fresh start that lifting a pause writes down.

## What stays as it is, on purpose

- **An appeal needs a person.** There is no automatic way back. The law in the UK and the EU
  very likely gives a person paused by a machine the right to have a human look.
- **No warning before a pause for reports.** Telling someone "3 people have reported you" would
  tell them that they were reported, which the app never does.
- **Memberships that ended with a pause do not come back** when it is lifted (as today).
- **The published legal documents are not changed here.** What they should say is a question
  for the lawyer (`docs/for-the-lawyer.md`, section 26).
- **One person with several accounts.** "Different people" are different accounts. Someone who
  opens five accounts and pays for a call with each can pause a host, and her memberships are
  gone even if the pause is lifted. Each of those calls costs real money and the host must
  accept each request, but it remains possible. A customer does not have to prove who they
  are for a paid call, so the app cannot tell. Said to the founder; in the lawyer file.
- **A paid call where the customer never came** counts as "a call with" the host: he paid.
- **With exactly five customers, "several people reported you" names them all.** The words give
  no number, but someone who knows the rule and has had only five paying customers can work it
  out. In the lawyer file.
- **The first day of the new average.** Ratings that were shown from 3 people are grouped anew
  (first 5, then 3s), and someone who compared an old number with the new one could work out
  one person's stars. There are no real ratings yet: Connect is not open.
- **The results page of a call** does not say whether a rating will count toward a pause.

## What gets built

- `src/lib/ratings/rules.ts`: `RATING.minPeople = 5`; `shownAverage` takes the first 5, then
  groups of 3, and shows nothing under 5.
- `user.auto_pause_from` (migration 0068): the moment a pause was last lifted. `user.rating_warned_at`
  (migration 0069, which also gives accounts whose pause was lifted in the past their fresh start).
- `src/lib/safety/auto-pause-rules.ts`: the numbers and the plain logic.
- `src/lib/safety/auto-pause.ts`: `runAutoPauses(now)`: who has reached a line, read from reports,
  calls, payments and ratings.
- `src/lib/safety/reports.ts`: `pauseByItself` beside `pauseUnderage`; `liftPause` writes the
  fresh start.
- `worker/closer.ts`: the round, about every 10 minutes.
- The account page's sentence about ratings.

## How it is checked

- Unit tests for `shownAverage` (5, then 3s; under 5 nothing) and the pause rules.
- `scripts/auto-pause-check.ts` against the local database: 4 reporters do nothing, the 5th
  pauses; each thing that makes a report not count, and two that must not; the share; a lifted
  pause is a fresh start and the rule works again after it; ratings warn first and pause no
  sooner than 14 days later; a count that no longer holds at the moment of the pause; an admin
  is never paused.
- `scripts/ratings-check.ts`: the averages with the new minimum.

## For the lawyer (each is in `docs/for-the-lawyer.md`)

- A decision by a machine with a serious effect (UK and EU rules on automated decisions; the
  EU's rules for platforms on telling a person why).
- What the Terms and the Community Rules must say about it.
- Ending memberships for good on a pause that a machine made.

## The automatic security checks and Astra's check of the build (27 November 2026)

**The automatic security check of the first commit** found two things, both taken: ratings of
free calls counted toward a pause though reports from free calls did not (decision 6), and a
pause could be made from a count that a lifted pause had just made out of date (decision 8a).
**On the second commit** it found that a host could give money back to the people who complained
and so take their reports and stars out of the count (decision 4a).

**Astra (Codex, effort high): "not ready", 22 points.** Taken: accounts whose pause was lifted
in the past had no fresh start; the step that pauses did not look again at what had changed; an
account already at the line was paused with no warning; a payment a bank took back counted as
paid; the emails gave the person an average that, beside the one on their page, could give one
person's stars away; any old report by the account about a reporter took that reporter out for
good; the people with older calls were mixed into the share; the fresh start went by a call's
booked end; a second press of "Lift the pause" moved the fresh start; one warning per role, kept
only in the emails; a warning written from an old look; the round held up the helper's money
work; "5 or more people reported you" named them all for someone with five customers; an empty
"only this account" looked at every account; the founder's email said calls "are ended" before
they were; the page's note spoke of customers only; three checks that would pass with wrong
code. Not taken, and why: see the last five points of "What stays as it is".

**Astra's second look, at the fixes: "not ready", 18 points (3 high).** Taken: the 14 days now
run from the moment the warning email was really sent, and an email that never left leads to no
pause; a bank's dispute is read from the payment's and the month's own marks, which are written
first, and a dispute that was "prevented" no longer takes a call out; "Lift the pause" lifts
only the pause the page showed; the account's row is held no harder than the pause's own change
holds it (a member's booking could otherwise wait on the pause while the pause waits on it);
the two numbers of the report rule are read in one question to the database, at the moment of
the decision, and the founder's email gives those numbers; an admin is not warned; the helper
waits for a round under way before it exits; "nobody at Connect has judged those reports" and
"the only email of this kind" were not always true and are gone; the checks were made to tell
right from wrong (a report closed between the count and the pause, an empty name with an
account over the line beside it, an old report with a recent call, a call across the fresh
start, an old report of the host's own). Not taken, and why: a pause that is lifted in the
moment before its own tidying-up can end a booking made after the lift (this is how every pause
has worked, by hand too; it belongs to the work on pauses and memberships that comes next); the
warning says "2.5 or lower", which beside the shown average can tell a person with very few
ratings more than the pages alone do (the words promise nothing else now); a "pause lifted"
line that the old button wrote for an account that was not paused can make a fresh start later
than it was (the safe side); no check with a dispute on a membership month or with two rounds
at the same instant.

**CodeRabbit: 10 points and one more in its summary.** Taken: a dispute on a payment for added
time left the call counting when its own payment was fine (now any dispute on any of the call's
payments takes it out); a warning about ratings as a host could be followed by a pause for
ratings as a customer (each role has its own warning now, `user.customer_rating_warned_at`,
migration 0070); "at least 10 people" did not match the groups ratings count in (11 everywhere
now); a warning whose email was emptied after two years would have stopped the rule for that
account for good (it is taken back and sent anew); a report closed in the instant between the
second count and the pause (closing a report now holds the account's row as the pause does);
the pause email said "had calls with you" where the rule says paid calls; the lawyer's section
did not say that the round is switched off; two checks that could pass with wrong code (three
calls across the fresh start where five are needed; reports whose moment depended on two
clocks). Changed in words only: the note on `pauseByItself` said the founder is told when the
account was paused already, which cannot happen there. Not taken: if the email "a paused
account still has calls" cannot be written after the pause, nothing tries again (the pause by
hand and the pause for an age under 18 work the same way; it is written to the log).

