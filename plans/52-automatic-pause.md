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
   how they do it.) The founder asked whether 90 days is right: with the share, the builder
   thinks it is.
4. **Which reports count. (builder)** A report counts when all of this is true:
   - its reporter has had a call with the person that was really paid for (money was taken and
     kept; a member's call counts by the part of the month that was used). A stranger's report
     about a page, and a report from a call that was free or given back in full, do not count:
     they cost nothing to make;
   - the reporter's account is not closed;
   - the person it is about has not reported that reporter (when the two reported each other,
     neither report counts here; a person on the team can still read both);
   - nobody on the team has closed it. A report a person has looked at and closed is settled:
     that person could have paused the account by hand;
   - it was made after the last time a pause of the account was lifted (decision 8).
   Where a report was made from (a call, a request, a message, a page) does not matter: what
   matters is who made it.
5. **Urgent reports stay as they are. (builder)** "Someone under 18" and "threats" still email the
   team at once. One report alone never pauses anyone: that would be a weapon.

### Paused by itself because of ratings

6. **An average of 2.0 or lower from at least 10 different people. (builder)** Counted exactly as
   the shown average is (each person once, a week after the call, whole groups), for the person as
   a host and as a customer, each by itself. Only ratings of calls that ended after the last time
   a pause was lifted count (decision 8).

6a. **A warning first, once. (builder)** When an average falls to 2.5 or lower (from the 5 people
   an average needs), the person gets one email: their average as a host (or as a customer) is
   low, and an account whose average stays at 2.0 or lower from 10 or more people is paused. It
   says nothing about any one rating. Sent once per fresh start (decision 8). Uber and Lyft warn
   before they act on ratings. There is no such warning for reports (see "What stays").

### What happens

7. **The same pause as by hand. (builder)** The person is told by email and on the paused page
   why, in general words (never who reported or rated them), and where to write if they think it
   is a mistake. The founder gets an email saying that it happened and why: nothing to do unless
   the person writes in.
8. **Lifting a pause is a fresh start. (builder)** A person on the team lifted it, so a person has
   looked. Reports made before that moment, and ratings of calls that ended before it, no longer
   count toward a pause by itself. Otherwise the next round would pause the account again.
9. **Who is never paused by itself. (builder)** An admin's account; a closed account (if it is
   opened again, the next round looks at it).
10. **When it is looked at. (builder)** By the helper, about every 10 minutes. Not at the moment
    of the report: a report made right after a call counts only once that call's money is taken,
    about a day later.

## What stays as it is, on purpose

- **An appeal needs a person.** There is no automatic way back. The law in the UK and the EU
  very likely gives a person paused by a machine the right to have a human look.
- **No warning before the pause.** Telling someone "3 people have reported you" would tell them
  that they were reported, which the app never does.
- **Memberships that ended with a pause do not come back** when it is lifted (as today).
- **The published legal documents are not changed here.** What they should say is a question
  for the lawyer (`docs/for-the-lawyer.md`).

## What gets built

- `src/lib/ratings/rules.ts`: `RATING.minPeople = 5`; `shownAverage` takes the first 5, then
  groups of 3, and shows nothing under 5.
- `user.auto_pause_from` (migration): the moment a pause was last lifted.
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
  pauses; each thing that makes a report not count; a lifted pause is not made again; ratings at
  9 and at 10 people; an admin is never paused.
- `scripts/ratings-check.ts`: the averages with the new minimum.

## For the lawyer (each is in `docs/for-the-lawyer.md`)

- A decision by a machine with a serious effect (UK and EU rules on automated decisions; the
  EU's rules for platforms on telling a person why).
- What the Terms and the Community Rules must say about it.
- Ending memberships for good on a pause that a machine made.
