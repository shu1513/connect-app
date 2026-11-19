# Plan 31: Following, part 2: emails to followers

**Status:** a plan, not built. Written 19 November 2026 by the builder alone (no helper agents),
from the code as it is on `main` after pull request 49 and from plan 30, which it builds on. It
is built after part 1 is merged. Astra's check of it is recorded at the end.

## For the founder: what this is

Part 1 puts a followed host on the customer's home page. That only helps someone who is already
looking at Connect. This part reaches a follower who is not: by email, the only way Connect has
of reaching anyone today.

A follower can ask for three emails, **for each host separately**:

1. **"Tell me when Anna is available now."** One email when she switches "Available now" on.
2. **"Tell me when Anna writes in her diary."** One email when she posts in her project.
3. **"Tell me once when Anna has an open time."** One email, the first time a time can be asked
   for, and then this switches itself off.

For the first and the third the follower can choose **hours** ("only between 6 pm and 10 pm, my
time"). That is the founder's "notify me if a certain host is available at a certain time".

Nothing is sent to anyone who has not said yes for that host and that kind of email.

## Said plainly: five limits

1. **Email is slow for "available now".** A host is available for 30, 60 or 120 minutes. The
   email is written a minute after they switch on and usually arrives within another minute,
   but nothing guarantees when a person reads it. It says until when the host is available.
   A phone notification would be better and needs the phone apps, which come after launch.
2. **Real sending is not set up yet.** Like every other email of Connect, these are written to
   the outbox and go out once the founder's sending account (Resend) is there.
3. **These are advertising emails in the eyes of the law**, unlike a reminder of a call someone
   booked. So: a yes for each host, a link in every email that stops them all with one press,
   and no text written by a host inside them. One thing is open and is the founder's: US law
   asks that such an email carries the sender's postal address, and there is no registered
   company yet. Before real sending starts the footer needs that address, and the lawyer should
   look at these emails for the UK and Europe, where hosts can now be based.
4. **"An open time" means a time exists, not that it is new.** The third email goes out the
   first time the host has any open time in the follower's hours. It cannot be asked for while
   such a time already exists (the page then says "Anna has open times now").
5. **The emails never carry what a host wrote.** Only the host's name. A diary email says that
   there is a new post and links to it. Otherwise a host could put any text or link into the
   inbox of every follower, under Connect's name.

## What part 2 must prove

1. Nobody gets one of these emails without having said yes for that host and that kind.
2. For one follower and one host: at most one "available now" email and one diary email in 20
   hours. For one follower in all: at most 5 of these emails in 24 hours.
3. An "available now" email is only sent inside the follower's hours and only if, at the moment
   it is sent, a call with that host can still be asked for.
4. One press on the link in any of these emails stops all of them, without logging in.
5. Never across a block in either direction, never to a closed or paused account, never about a
   host whose page is not open to everyone.
6. The "open time" email is sent once, and then that choice is off.

## Decisions

1. **Off until asked for.** A new follow, by the button or after a call, has all three choices
   off. They are set on "Hosts you follow", under each host: three tick boxes, the hours, and
   "Save". On the results page of a call, a customer who follows the host and has not chosen
   "available now" emails is asked once more there: "Email you when Anna is available now?"
   with a button. (Asked on that page only, so it needs no record of having been asked.)

2. **Hours.** "Any time", or from one full hour to another, in the follower's own time zone
   (the one on their account; someone who never chose one is treated as New York, as their
   other emails are). The stretch may run past midnight (10 pm to 2 am). The hours belong to
   one host's line, so they can differ per host. They apply to "available now" (the moment the
   host switches on) and to "an open time" (the start of the time). Not to diary posts.

3. **The "available now" email.**
   - When a host who was off switches on, an announcement is set for **60 seconds later**. If
     they switch off again within that minute, nothing is announced. Extending while already on
     announces nothing new.
   - When the minute is over and the host is still available, the helper writes one email to
     every follower who: follows and has ticked this; is inside their hours; has not had an
     "available now" email about this host in the last 20 hours; is under the 5 a day; has
     these emails switched on for their account; has a confirmed email address and an open,
     unpaused account; and is not blocked by, or blocking, the host.
   - Right before each email is sent it is checked once more: the follow and the tick are
     still there, and a call with the host can still be asked for (`instantOffer`). If the host
     has gone or is in a call, it is not sent. It also runs out by itself at the moment the
     host's availability ends.
   - It says who, since when, until about when, and links to the host's page.

4. **The diary email.** Thirty minutes after a host writes a post, if the post is still there
   (not removed, not hidden by the founder), the project is running and the host's page is open
   to everyone, the helper writes one email to every follower who ticked this, with the same
   conditions as above except the hours, and at most one per host in 20 hours: a second post
   the same day is not announced to someone who got the first. Posts from before this was built
   are not announced. The thirty minutes give the host time to correct or remove a post, and the
   picture checks time to finish, before anyone is sent there.

5. **The "open time" email.** While a follower has this ticked, the helper looks about every
   ten minutes: does the host have an open time for their shortest call length, as anyone could
   ask for it (not the member-only times), that starts inside the follower's hours? If yes: one
   email with the first such time, and the tick is cleared. If the follower is over the 5 a day
   it waits for the next look. Ticking it while such a time already exists is refused with
   "Anna has open times in your hours right now" and a link.

6. **Stopping.** Every one of these emails ends with: how to choose per host (the page "Hosts
   you follow") and a link that stops all of them. The link works like the one in reminder
   emails: opening it shows a button, pressing the button switches off "Emails about hosts you
   follow" for the account; mail programs can do it with their own one-click button. It never
   switches anything on. The same switch is a tick box on the account page. The per-host ticks
   are kept, so switching back on brings back exactly what was chosen.

7. **What the host sees.** On their "Available now" page, beside the switch: "When you switch
   on, followers who asked for it get an email a minute later: fewer than 10 people" (the same
   steps as the number of followers, plan 30, decision 9, for the same reason). No host can
   switch the announcement off: a host who is available wants calls.

8. **The home page.** Under "Talk now" and "Coming up": **"New in diaries"**, the latest posts
   (at most 5, from the last 7 days) of the hosts the person follows, each with the host's
   name, the first lines and a link. This is the founder's "a followed host appears when they
   post". It is on the site, where a diary's text already is, so it shows the text.

9. **Unfollowing, blocking, closing.** An ended follow gets nothing. Following again starts with
   all three choices off. For a blocked pair nothing is written and nothing is sent, in either
   direction, while the follow line stays as plan 30 says.

## Not in part 2

- Phone notifications and text messages.
- An email about new weekly hours as such ("Anna added Thursdays"): the "open time" email covers
  the case that matters, a follower waiting for a time.
- A host writing a message to their followers.
- Suggestions (plan 30, at the end).

## How it works

**What is stored.**

- `follows`, new columns: `tell_online`, `tell_posts`, `tell_times` (yes or no, all off to
  begin with); `hours_from`, `hours_to` (minutes of the day, both empty for "any time");
  `told_online_at`, `told_post_at` (when the last such email was written, for the 20 hours);
  `times_checked_at` (when the helper last looked for an open time for this line, so that it
  takes the longest-waiting lines first).
- `user.follow_emails`: the account's switch, on to begin with (nothing is sent without a
  per-host yes anyway).
- `host_calendars.announce_at`: when the current "available now" is to be announced. Empty when
  off, and after the announcement.
- `project_posts.announced_at`: when a post was announced, or decided not to be. The migration
  fills it for every post that exists.
- `email_outbox.kind` gets one more value, `follow`, so that these emails can be counted.

**Plain logic** (`src/lib/follows/rules.ts`, unit tests): `insideHours(moment, timeZone, from,
to)`, also past midnight and across a change of the clocks; `EMAILS` (60 seconds, 20 hours, 5 a
day, 30 minutes, 10 minutes).

**The helper's work** (`src/lib/follows/emails.ts`), in a loop of its own in `worker/closer.ts`
so that writing many emails never delays closing a room or the money work:

- `announceAvailable(now)`: every round. Calendars whose `announce_at` has come, one at a time
  with the line locked (two helpers skip each other's). Not available any more: `announce_at`
  is cleared. Otherwise the followers are read in one question, sorted out by the rules above,
  and written in groups of 200: the emails (`queueEmail`, key
  `follow-online:<host>:<follower>:<the period's end>`, running out at the period's end) and
  `told_online_at`, in one step per group. Then `announce_at` is cleared. If the helper stops
  halfway, the next round starts again and skips whoever was already told.
- `announcePosts(now)`: about once a minute. Posts with `announced_at` empty that are 30 minutes
  old. A post older than a day, removed, hidden, in an ended project or on a page that is not
  open is marked as decided and nobody is told. Otherwise as above, key
  `follow-post:<post>:<follower>`.
- `announceOpenTimes(now)`: about every ten minutes. The lines with `tell_times`, the
  longest-unlooked first, at most 500 a round, grouped by host so that each host's open times
  are worked out once (`offerOf`, `openTimes` for the shortest length). Key
  `follow-time:<host>:<follower>:<day>`.
- `setAvailableNow` and `stillHere` (plan 7's code) set and clear `announce_at` in the same
  step in which they change the availability, under the calendar lock they already take.
- `noLongerWanted` in `src/lib/notifications/delivery.ts` learns the three keys: the check
  right before sending (decision 3).
- The 5 a day: counted from the outbox (`kind = 'follow'`, that address, the last 24 hours) in
  one question per round, and kept up to date while the round writes.

**Pages.**

- `src/app/following/page.tsx` and its actions: the three ticks, the hours and "Save" under each
  host. The action takes the host and the choices from the form and the follower from the login.
- `src/app/calls/[id]/results/page.tsx`: the question of decision 1.
- `src/app/host/now/…`: the line of decision 7.
- `src/app/page.tsx`: "New in diaries".
- `src/app/account/page.tsx`: the tick box "Emails about hosts you follow".
- `src/app/unsubscribe/page.tsx`, `src/app/api/unsubscribe/route.ts`,
  `src/lib/notifications/unsubscribe.ts`: the link carries which emails it stops (`what=follows`);
  without it, it stops reminders as today.
- `src/app/privacy/page.tsx` and, if the lawyer wants it, the terms: that these emails exist and
  how to stop them.

## How it is checked

- Unit tests: the hours (inside, outside, past midnight, the day the clocks change, no time
  zone), and the numbers.
- `scripts/follow-emails-check.ts`, against the local database, with its own people, hosts,
  posts and calendars, reading what lands in the outbox and sending through a pretend sending
  service (as `scripts/notifications-check.ts` does):
  no tick, no email, for each kind; the hours; the minute's wait and switching off inside it;
  20 hours; 5 a day across the three kinds; a block in each direction; a closed, a paused and an
  unconfirmed follower; the account's switch; the stop link, and that it stops nothing else; an
  email written and then not sent because the host went, was taken, or the follower unfollowed;
  a post removed inside the 30 minutes; an old post; the open time found, sent once, the tick
  cleared; refused while a time exists; two helpers at once writing each email once.
- All earlier check scripts once more, since `setAvailableNow`, `stillHere` and the sending of
  emails are touched.
- In the browser: choosing emails on "Hosts you follow", the question after a call, the line on
  the host's "Available now" page, "New in diaries", the account switch and the stop link.

**What the automatic checks cannot test:** real delivery and how fast it is (no sending account
yet); how a mail program shows its one-click "unsubscribe"; and whether a real follower finds an
"available now" email useful at the speed it arrives.

## Still open, for the founder

- The postal address for the footer, and the lawyer's look at these emails (limit 3).
- The sending account, as for every other email.

## Astra's check of this plan

(Filled in after the check.)
