# Plan 31: Following, part 2: emails to followers

**Status:** built on branch `module/following-2`, switched off (see "It is built switched
off"). Written 19 November 2026 by the builder alone (no helper agents), from the code as it is
on `main` after pull request 49 and from plan 30, which it builds on; built after part 1 was
merged (pull request 52). Astra checked the first draft: "not ready". It was rewritten; what was
taken and what was not is at the end, with what building changed.

## For the founder: what this is

Part 1 puts a followed host on the customer's home page. That only helps someone who is already
looking at Connect. This part reaches a follower who is not: by email, the only way Connect has
of reaching anyone today.

A follower can ask for two emails, **for each host separately**:

1. **"Tell me when Anna is available now."** One email when she switches "Available now" on.
   The follower can choose **hours** for it ("only between 6 pm and 10 pm, my time"). That is
   the founder's "notify me if a certain host is available at a certain time".
2. **"Tell me when Anna writes in her diary."** One email when she posts in her project.

And the home page gets **"New in diaries"**: the latest posts of the hosts a person follows.

Nothing is sent to anyone who has not said yes for that host and that kind of email.

**It is built switched off.** These emails stay off, and the choices for them are not shown,
until the founder has given a postal address for their last line (limit 3). "New in diaries" is
not an email and is on from the start.

## Said plainly: five limits

1. **Email is slow for "available now".** A host is available for 30, 60 or 120 minutes. The
   email is written a minute after they switch on and usually arrives within another minute,
   but nothing guarantees when a person reads it. It says until when the host is available.
   A phone notification would be better and needs the phone apps, which come after launch.
2. **Real sending is not set up yet.** Like every other email of Connect, these are written to
   the outbox and go out once the founder's sending account (Resend) is there.
3. **These are advertising emails in the eyes of the law**, unlike a reminder of a call someone
   booked. So: a yes for each host, a link in every email that stops them all with one press,
   and no text written by a host inside them. US law also asks that such an email carries the
   sender's postal address, and there is no registered company yet. That is why this part is
   built switched off: the switch **is** the address. Before switching on, the lawyer should
   also look at these emails for the UK and Europe, where hosts can now be based.
4. **Not built: "tell me when a time opens"** for a host who is fully booked, which the founder
   liked. It is the hardest of the three to get right: it needs a waiting state of its own that
   can be cancelled and asked for again, and "an open time" is not one thing (a time for a
   15-minute call is no use to someone who wants an hour). It gets its own plan once the two
   simpler emails are in use. Until then the hours in point 1 cover "at a certain time" for a
   host who goes online.
5. **The emails never carry what a host wrote.** Only the host's name. A diary email says that
   there is a new post and links to it. Otherwise a host could put any text or link into the
   inbox of every follower, under Connect's name.

## What part 2 must prove

1. Nobody gets one of these emails without a yes for that host and that kind that stands at the
   moment it is sent. Taking the yes back also drops an email that was already waiting.
2. For one follower and one host: at most one "available now" email and one diary email are
   written in 20 hours. For one follower in all: at most 5 of these emails are written in 24
   hours, and a pile of late ones is not sent on top of each other (decision 5).
3. An "available now" email is only sent inside the follower's hours and only if, at the moment
   it is sent, the host's own page would still show them as available.
4. One press on the link in any of these emails stops all of them, without logging in, and
   stops nothing else.
5. Never across a block in either direction, never to a closed or paused account, never about a
   host who is paused or whose page is not open to everyone.
6. While the switch is off, nothing is written and nothing waits to be sent later.

## Decisions

1. **Off until asked for.** A new follow, by the button or after a call, has both choices off.
   They are set on "Hosts you follow", under each host: two tick boxes, the hours, and "Save".
   On the results page of a call, a customer who follows the host and has not chosen "available
   now" emails is asked there as well: "Email you when Anna is available now?" with a button.
   (Asked on that page only, so it needs no record of having been asked.)

2. **Hours.** "Any time", or from one full hour to another, in the follower's own time zone
   (the one on their account; someone who never chose one is treated as New York, as their
   other emails are). The stretch may run past midnight (10 pm to 2 am). The hours belong to
   one host's line, so they can differ per host. They are checked when the email is written and
   again at the moment it is sent. They do not apply to diary posts.

3. **The "available now" email.**
   - When a host who was off switches on, an announcement is set for **60 seconds later**. If
     they switch off again within that minute, or accept a call (which ends being available),
     nothing is announced. Extending while already on announces nothing new.
   - When the minute is over and the host's page still shows them as available, the helper
     writes one email to every follower who: follows and has ticked this; is inside their hours;
     has not had an "available now" email about this host written in the last 20 hours; has had
     fewer than 5 of these emails written in the last 24 hours; has these emails switched on for
     their account; has an open, unpaused account; and is not blocked by, or blocking, the host.
   - It says who, since when, until about when, and links to the host's page.
   - It runs out by itself at the moment the host's availability ends.

4. **The diary email.** Thirty minutes after a host writes a post, if the post is still there
   (not removed, not hidden by the founder), the project is running, the host is not paused and
   their page is open to everyone, the helper writes one email to every follower who ticked
   this, with the same conditions as above except the hours, and at most one per host in 20
   hours: a second post the same day is not announced to someone who got the first. It runs out
   12 hours after it was written. Posts from before this was built are not announced. The
   thirty minutes give the host time to correct or remove a post, and the picture checks time
   to finish, before anyone is sent there.

5. **The last look before sending.** An email can wait in the outbox (the sending service is
   slow, or down). So right before each one is sent, everything is asked again, and if any of
   it no longer holds the email is dropped, not kept for later:
   - both kinds: the follow has not ended and the tick is still on; the account's switch is on;
     the follower's account is open and not paused; no block in either direction; the host is
     not paused and their page is open to everyone; fewer than 5 of these emails were really
     sent to this address in the last 24 hours (so that emails held up by an outage do not all
     arrive together); and the switch for the whole feature is on;
   - "available now": the follower is inside their hours at this moment, and the host's own
     page would show them as available at this moment (`instantOffer`);
   - diary: the post is still there and not hidden, and its project is running.

6. **Taking a yes back takes the waiting emails with it.** Unfollowing, clearing a tick, the
   account's switch, the stop link, and a block: each drops, at that moment, the emails that
   are still waiting for that follower: for a cleared tick the emails of that kind about that
   host, for an unfollow both kinds about that host, for a block both kinds between the two
   people in either direction, for the account's switch and the stop link all of them. A yes
   given again counts from that moment on. (If a host is still available, or a post is just
   being announced, at the moment someone says yes, they can get that email: it is what they
   have just asked for.)

7. **Stopping.** Every one of these emails ends with: how to choose per host (the page "Hosts
   you follow") and a link that stops all of them. The link works like the one in reminder
   emails: opening it shows a button, pressing the button switches off "Emails about hosts you
   follow" for the account; mail programs can do it with their own one-click button. It never
   switches anything on, and it does not touch reminder emails. The same switch is a tick box
   on the account page. The per-host ticks are kept, so switching back on brings back what was
   chosen.

8. **What the host sees: nothing.** The founder liked "14 followers will be told you are
   online". It is left out for the reason given in plan 30, decision 9: a number, even a rough
   one, lets a host work out what single followers did. No host can switch the announcement
   off: a host who is available wants calls.

9. **"New in diaries" on the home page.** Under "Talk now" and "Coming up": the latest posts of
   the hosts the person follows, at most 5, from the last 7 days, each with the host's name,
   the project's name, the first lines and a link. It is on the site, where a diary's text
   already is, so it shows text. Exactly these posts and no others: the follow has not ended;
   the post is not removed and not hidden; the host's page is open to everyone. That is what
   anyone could read by opening the diary. So it is also shown to a follower the host has
   blocked: leaving it out would be a sign of the block (plan 30, decision 6), and it tells
   them nothing a visitor could not see.

10. **Unfollowing, blocking, closing.** An ended follow gets nothing. Following again starts
    with both choices off. For a blocked pair no email is written or sent, in either direction,
    while the follow line stays as plan 30 says.

## Not in part 2

- "Tell me when a time opens" (limit 4), and an email about new weekly hours as such.
- Any number of followers for the host (decision 8).
- Phone notifications and text messages.
- A host writing a message to their followers.
- Suggestions (plan 30, at the end).

## How it works

**The switch.** One setting on the server, `FOLLOW_EMAILS_ADDRESS`: the postal address for the
last line of these emails. Empty (as it is everywhere today) means off: the choices are not
shown, the helper writes none of these emails, and the last look before sending drops any that
exist. So that switching on never sends anything about the time it was off, this is settled
where things begin, not by the helper tidying up later: a host who switches "Available now" on
while it is off gets no announcement set, and a post written while it is off is marked as dealt
with in the same step that writes it.

**What is stored.**

- `follows`, new columns: `tell_online`, `tell_posts` (yes or no, both off to begin with);
  `hours_from`, `hours_to` (minutes of the day, both empty for "any time"); `told_online_at`,
  `told_post_at` (when the last such email was written, for the 20 hours).
- `user.follow_emails`: the account's switch, on to begin with (nothing is sent without a
  per-host yes anyway).
- `host_calendars.announce_at`: when the current "available now" is to be announced. Empty when
  off, and after the announcement. Its value also names the announcement (see below).
- `project_posts.announced_at`: when a post was announced, or decided not to be. The migration
  fills it for every post that exists.
- `email_outbox.kind` gets one more value, `follow`. `queueEmail` in `src/lib/email.ts` writes
  `booking` for every email today; it gets a `kind` to pass, which every existing caller leaves
  out, so nothing else changes.

**Plain logic** (`src/lib/follows/rules.ts`, unit tests): `insideHours(moment, timeZone, from,
to)`, also past midnight and on the days the clocks change; `EMAILS` (60 seconds, 20 hours, 5 a
day, 30 minutes, 12 hours).

**Writing one email** (`src/lib/follows/emails.ts`, `tellFollower`). Every email of this part is
written by one small step for one follower, so the limits hold whatever else is running:

1. take the lock named after the **follower** (the one plan 30 uses for their follows; saving
   the ticks and the hours, and the account's switch, take it too);
2. read the follow line again, and everything else decision 3 or 4 asks, inside the step; for
   "available now" also that the host's announcement is still the one this round started with
   (a host who switched off and on again has a new one, with a minute's wait of its own);
3. count the `follow` emails written to this follower in the last 24 hours;
4. if all holds: write the email (`queueEmail`, with its key and the moment it runs out) and
   `told_online_at` or `told_post_at`, together.

Two helpers, or two hosts going online at the same second, wait for each other at step 1, so
the fifth email of a day cannot be written twice. The key of an email
(`follow-online:<host>:<follower>:<announcement>`, `follow-post:<host>:<follower>:<post>`) is
unique in the outbox, so the same event is never written twice for one follower either.

**The helper's rounds**, in a loop of their own in `worker/closer.ts`, so that writing many
emails never delays closing a room or the money work:

- `announceAvailable(now)`: every round. It reads the calendars whose `announce_at` has come,
  **without holding them** (the host's page says "still here" every 5 seconds under the
  calendar's lock, and must never wait for a list of emails). For each: if the host's page
  would no longer show them as available, nothing is written. Otherwise `tellFollower` for each
  follower who ticked this, one after the other. At the end `announce_at` is emptied **only if
  it still has the value that was read**: a host who switched off and on again meanwhile has a
  new announcement, and it is not lost. If the helper stops halfway, the next round goes
  through the followers again, and those already told are skipped by their key and by the 20
  hours.
- `setAvailableNow`, `stillHere` and `accept` (the three places that change a host's
  availability, plan 7) set and empty `announce_at` in the same step in which they change the
  availability, under the calendar lock they already take: set to "in 60 seconds" when a host
  who was off switches on, left alone when a host who is on extends, emptied whenever
  availability ends.
- `announcePosts(now)`: about once a minute. Posts with `announced_at` empty that are 30 minutes
  old. A post older than a day, removed, hidden, in an ended project, of a paused host or on a
  page that is not open is marked as decided and nobody is told. `writePost` fills
  `announced_at` itself while the switch is off. Otherwise `tellFollower` for
  each follower who ticked this, then `announced_at` is filled.
- `noLongerWanted` in `src/lib/notifications/delivery.ts` learns the two keys: the last look of
  decision 5. The 5 in 24 hours is counted there from what was really **sent**.
- `dropWaiting(follower, host?, kind?)`: decision 6. One update of the outbox, under the
  follower's lock: the `follow` emails of that follower (about that host, of that kind) that
  are still waiting are closed as "no longer wanted". Called by unfollowing, clearing a tick,
  the account's switch, the stop link, and by `block()` for each of the two people.

**Pages.**

- `src/app/following/page.tsx` and its actions: the two ticks, the hours and "Save" under each
  host, only while the switch is on. The action takes the host and the choices from the form
  and the follower from the login.
- `src/app/calls/[id]/results/page.tsx`: the question of decision 1.
- `src/app/page.tsx`: "New in diaries" (`diaryNews(userId, now)` in `src/lib/follows/follows.ts`,
  which applies the rules of decision 9 before it sorts and takes five, and gives back only
  what is shown).
- `src/app/account/page.tsx`: the tick box "Emails about hosts you follow".
- `src/app/unsubscribe/page.tsx`, `src/app/api/unsubscribe/route.ts`,
  `src/lib/notifications/unsubscribe.ts`: the link carries which emails it stops (`what=follows`);
  without it, it stops reminders as today.
- `src/app/privacy/page.tsx` and, if the lawyer wants it, the terms: that these emails exist and
  how to stop them.

## How it is checked

- Unit tests: the hours (inside, outside, past midnight, the days the clocks change, no time
  zone), and the numbers.
- `scripts/follow-emails-check.ts`, against the local database, with its own people, hosts,
  posts and calendars, reading what lands in the outbox and sending through a pretend sending
  service (as `scripts/notifications-check.ts` does):
  - the switch off: nothing written; a host who went online and a post written while it was off
    are not announced after switching on, also when the helper was not running in between;
  - no tick, no email, for each kind; the stored kind is `follow`; the hours; the minute's wait,
    switching off inside it, accepting a call inside it, extending;
  - 20 hours per host; 5 a day across both kinds, counted when written and again when sent;
  - **races, made to happen on purpose:** two hosts announced at the same moment to a follower
    who has had 4 emails (one more, not two); two posts of one host at the same moment (one
    email); the helper stopped between two followers and run again (each told once); the host's
    "still here" answered without delay while an announcement to many followers is being
    written; a host who switches off and on during an announcement (the second one is still
    made);
  - a block in each direction; a closed, a paused follower; a paused host; the account's switch;
  - the last look: an email written and then not sent because the host went, is in a call, the
    hours ended, the follower unfollowed, cleared the tick, used the stop link or was blocked,
    or the post was removed or hidden **after** it was written;
  - a yes taken back and given again: the email that was waiting is gone for good; clearing one
    tick leaves a waiting email of the other kind alone;
  - a host who blocks a follower at the moment an email to them is being written: none is sent;
  - an email delivered late, after others, does not go over the 5;
  - the stop link stops these and leaves reminders alone; the reminder link leaves these alone;
  - "New in diaries": a removed post, a hidden post, a hidden host, an ended follow never
    appear; a blocked follower sees what a visitor sees; five at most, the newest first.
- The actions through the running app: a form with someone else's ID changes nothing of theirs;
  a paused person can clear a tick and cannot set one.
- All earlier check scripts once more, since `setAvailableNow`, `stillHere`, `accept` and the
  sending of emails are touched.
- In the browser, with the switch on: choosing emails on "Hosts you follow", the question after
  a call, "New in diaries", the account switch and the stop link. With it off: none of the
  choices is there.

**What the automatic checks cannot test:** real delivery and how fast it is (no sending account
yet); how a mail program shows its one-click "unsubscribe"; and whether a real follower finds an
"available now" email useful at the speed it arrives.

## Still open, for the founder

- The postal address (the switch), and the lawyer's look at these emails (limit 3).
- The sending account, as for every other email.
- Whether to build "tell me when a time opens" next (limit 4).

## Astra's check of this plan (19 November 2026)

Verdict on the first draft: "not ready". Its points on this plan, and what was done:

- **The number of followers who will be told gives people away, like the number of followers.**
  Taken: no number (decision 8).
- **The plan does too much: cut the number, and put "tell me when a time opens" in a plan of
  its own.** Taken (limit 4). That also settles its points about that email: it needs a waiting
  state that can be cancelled and asked for again, and the shortest call length is not a useful
  "open time" for everyone.
- **`queueEmail` always writes the kind `booking`, so counting `follow` emails would count
  nothing.** Taken: it gets a `kind`.
- **Counting once per round does not keep the 5 a day or the 20 hours when two things happen at
  once, and what is written 20 hours apart can arrive minutes apart after an outage.** Taken:
  one small locked step per follower, and the 5 a day counted again from what was really sent.
  Not taken: also enforcing the 20 hours when sending. Both emails run out within hours, so
  they cannot pile up for a day.
- **Holding the calendar while writing to every follower would stop the host's "still here",
  and letting go of it loses track of which announcement is being made. `accept()` also ends
  being available.** Taken: nothing is held, the announcement is known by its moment, and it is
  emptied only if unchanged; `accept` is one of the three places.
- **The last look before sending must ask everything again, for each kind, and the hours at the
  moment of sending.** Taken (decision 5), with a moment at which each email runs out.
- **A yes taken back and given again must not bring a waiting email back.** Taken (decision 6).
- **"New in diaries" needs its rules written down.** Taken (decision 9).
- **Setting up real sending would start these emails although the address for their last line
  is missing.** Taken: built switched off, and the switch is the address.
- **`instantOffer` does not say this customer may ask.** Taken in plan 30 (limit 3); the email
  says the host is available, nothing more.
- **More checks:** the races made to happen, late delivery, a yes taken back, removal after
  writing. Taken.

**Second check, the same day**, of the rewritten plan: "not ready", seven points.

- **A block by the host and an email to the blocked follower could still pass each other.**
  Taken: a block takes both people's locks (plan 30) and drops the waiting emails in both
  directions.
- **Clearing one tick dropped the waiting emails of both kinds.** Taken: `dropWaiting` is told
  the kind.
- **After a host switches off and on, the old round could announce the new period without its
  minute's wait.** Taken: each email first checks that the announcement is still the one the
  round started with. Not taken: also remembering the period inside each waiting email, so that
  one written for a period that ended is refused at sending even if the host is available
  again. It would tell the follower something true, at most once in 20 hours.
- **Switching on could announce things from the time it was off, if the helper was not running
  then.** Taken: settled where an announcement or a post begins, not by the helper.
- **Two helpers sending at the same instant could both count 4 sent emails and both send.**
  Not taken. The 5 a day is exact where emails are written, under the follower's lock. The count
  at sending is a second look whose job is to stop a pile of late emails arriving together, and
  it does that. Making it exact too would need a booking system for sending slots; what it
  would prevent is one sixth email in a rare overlap of two helpers. Proof point 2 now says
  what is exact and what is not.
- **A follower who switches a yes off and on again while a round is running can get an email
  about something that began before the second yes.** Not taken as a problem: the host is
  available, or the post is new, at the moment they say yes, and that email is what they asked
  for. Decision 6 no longer claims otherwise. The switches do take the follower's lock.
- **Its point about reports** is answered in plan 30.

**Third check, the same day:** no must-change problems found. The changes that were taken fit the
code, with no new way for two steps to wait for each other, and the points that were not taken
are "bounded imperfections". Verdict: "build as is".

## What building changed

- **Hours are whole hours**, chosen from two lists ("6 pm" and "10 pm"), as decision 2 says;
  half hours are not offered.
- **`dropWaiting` is in `src/lib/follows/follows.ts`**, beside the lock it is called under, so
  that unfollowing and blocking can use it without the two files needing each other.
- **Astra's review of the code, three points, all taken:**
  - Taking a yes back now also closes an email a helper had already picked up, and takes the
    helper's claim on it away. Before, only emails still waiting were closed; one picked up by a
    helper that then stopped could have gone out later, after a new yes.
  - If writing to one follower fails, the announcement (or the post) is kept for the next
    round instead of being marked as done; before, that follower was never told. Those already
    told are skipped by the 20 hours and by the email's key.
  - A diary post is looked at again for each follower, inside the step. Before, a post removed
    while its round was under way was still written about for the remaining followers; those
    emails would not have been sent, but each used up that follower's one diary email about the
    host for 20 hours and one of their five for the day.
- **CodeRabbit's review of the code, nine comments, seven taken:**
  - When a round is made a second time, an email that was already written no longer starts
    that follower's 20 hours again.
  - The question after a call is not asked of someone who has switched these emails off for
    their whole account, and it says "at most one in 20 hours", which is the rule, not "once a
    day".
  - A host who extends their time while a round is under way is announced with the new end.
  - An email written to an address the follower no longer has is not sent.
  - An index for the announcements that are waiting, and the two "at the same moment" tests now
    really make the two meet.
  - Not taken: holding a lock on the outbox while the sending service is being asked, so that a
    yes taken back in that very instant could still stop the email. The gap is a few
    milliseconds; it is written down where the code is (`dropWaiting`).
  - Not taken: the 20 hours per host also at the moment of sending (Astra had raised it too).
    Each of these emails runs out within hours of being written, so two about one host can only
    arrive close together if sending was down for most of a day.

