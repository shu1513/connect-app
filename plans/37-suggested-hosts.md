# Plan 37: Suggested hosts

**Status:** built, 19 November 2026 (pull request 63; see `docs/module-record.md`). Written
19 November 2026 by the builder alone, from the code as it is on `main` after pull request 58. It is part two of the home page (`plans/36`). Before it was
written, the builder and Astra each researched, separately, how TikTok, Instagram, YouTube and
Facebook choose what to suggest, and how marketplaces closer to Connect do it (Airbnb, Etsy,
Fiverr). What was taken from that is under "Where the rule comes from". Astra checked this plan
once ("ready with changes"); every point was read against the code by the builder and is worked
in below (the list is at the end).

## For the founder: what this is

A row on the home page, "Suggested hosts": up to six hosts the person does not know yet, each
with photo, name, rating, price, languages and their next open time. An X hides a suggestion.
Under the row a short "Why these hosts?" says in plain words how they were chosen.

The order comes from one rule with four parts:

1. **Only hosts who have open times**, and being free sooner adds points.
2. **Your idea:** hosts chosen by people who follow the same hosts as this customer. (A call
   that really took place makes the customer follow the host by itself, so this covers the
   people who called.)
3. **Ratings count a little**, and a new host gets a fair start.
4. **Two of the six places are kept for hosts who have been shown the least**, so new hosts are
   seen.

## What the founder said (19 November 2026)

"the suggestions should have an algorithm, not sure what's the best algorithm for that, maybe if
other people who also talk with the hosts existing user talked to, some other hosts these other
users talk to, we can use those as a suggestion?"

Astra advised leaving that idea switched off until ten different people link two hosts. The
builder advised building it in from the first day with a bar of three. The founder: "Yes. I agree
with you. I would build this idea from day one."

## Decisions (the builder's, except where it says the founder's)

1. **Who can be suggested at all.** A host whose page is open to everyone (approved, not hidden,
   account neither closed nor paused), with no block in either direction: the same test as
   search. And who **has an open time**, as their own page would show it for their shortest call
   length, or is available now.
2. **Who is left out, because the person knows them already or has said no:** a host they follow
   or have unfollowed, a host they have had or have a call or a request with, a host they are or
   were a member of, a host they have reported, a host they hid with the X, and themselves.
3. **Your idea** (the founder's decision), built on the list of who follows whom. In the app, a
   call that really took place (the two were in the room together for at least two minutes) and
   did not go wrong makes the customer follow the host by itself (plan 30). So that one list
   holds the people who pressed Follow and, with few exceptions, the people who called and did
   not say no.
   - "Your hosts" are the hosts you follow whose page is open.
   - "People like you" are the other people who follow at least one of your hosts.
   - A host you do not know gets **3 points for each of those people** who follows them too.
   - **Nothing counts until three different people** point at the same host. Below three the
     host gets no points from this part. So the idea is built in from the first day and starts to
     work by itself as the app fills.
   - At most 20 points come from this part.
   - Each person counts once for a host, however often they called.
   - A person only counts while their account is open and not paused, and a follow only counts
     while there is no block between that person and that host.
   - **Changed after Astra's check:** the first draft gave 4 points for a person who had also
     had a call with the host and 2 for one who only follows. That is dropped. Telling "a call
     that really took place" from a booking nobody came to needs the full attendance record of
     every call, and with it one person's call could move a host up or down, which would say
     something about that one person. Every person now counts the same.
4. **Open times.** 20 points for a host who is available now, 10 for a host whose next open time
   is within seven days, 0 otherwise.
5. **Ratings.** Between 1 and 5 points: `(n × r + 5 × 4) / (n + 5)`, where `r` is the host's
   rating as the site shows it and `n` the number of ratings behind it. In words: every host
   starts as if they had five ratings of four stars, and real ratings slowly take over. A host
   with no shown rating gets 4, and their card says "New on Connect", never a number.
6. **The score** is the sum of the three. The numbers are starting values, in one file, and are
   not proven; they are there to be adjusted once there is something to learn from.
7. **Six places.** Places 1, 2, 4 and 5 go to the highest scores. Places 3 and 6 go to the hosts
   whose suggestion was seen by the fewest different people in the last seven days (among those
   who pass decisions 1 and 2). Equal scores are put in an order that changes from day to day and
   from person to person.
8. **A person's suggestions are made once a day** (the day changes at midnight UTC) and stay the
   same that day. They are made when the person first opens the home page that day, a moment
   after the page appears. When the page next refreshes, a host is gone from the row if the
   person follows them, if their page closed, if a block appeared, or if they have no open time
   left; hiding with the X takes effect at once. The open time on each card is worked out fresh
   each time. An empty place is not filled again that day.
9. **Fewer than six** fitting hosts: fewer are shown. None: the row is not shown.
10. **The X** hides that host from this person's suggestions for good. The host is not told and
    nothing else changes: they can still be found by search and followed. Only a host who was
    really suggested to the person can be hidden by them. (Bringing a hidden suggestion back is
    not built.)
11. **Never shown or said:** who else follows or called anyone, how many people point at a host,
    follower numbers (your earlier rule), or why one host was suggested. The row says only
    "Suggested hosts".
12. **"Why these hosts?"** under the row, always the same text: "These are hosts you do not
    follow and have not called, who have open times. Being free sooner adds points. Hosts
    followed by people who follow the same hosts as you get points too. Good ratings count a
    little. Two places are kept for hosts who have been shown less often. You get new
    suggestions each day, and the X hides one."
13. **Not counted, on purpose:** money spent, the length of calls, how many calls or followers a
    host has in total, contributions, memberships, and a host's social media audience. They
    would push up hosts who are already big, or people who spend more. **Languages** are shown
    on each card and do not change the order: the app knows which languages a host speaks, not
    which the customer speaks, and it does not guess.
14. **What is written down.** For each person and day: which hosts were suggested, in which
    place, whether the place was one of the two kept ones, and for each host whether its card
    really came into view on the screen. And each X. With the follows, requests and calls the
    app already keeps, this is enough to see later whether a call followed a suggestion, without
    recording clicks. (It can show that a call came after a suggestion, not that the suggestion
    caused it.) The lines about what was suggested are deleted after 90 days. An X is kept as
    long as the account, because it is the person's choice.
15. **A paused account** gets no suggestions.

## An example

You follow Anna. Ben, Carla and Dan follow Anna too. All three also follow David. Only Ben
follows Emma. Nobody you share a host with follows Frank.

- Frank: 0 from people. He is available now: 20. He is new: 4. **Total 24.**
- David: three people, so it counts: 9. His next open time is Friday: 10. His rating is 4.8
  from 6 ratings: about 4.4. **Total 23.4.**
- Emma: one person, below three: 0. Her next open time is Saturday: 10. She is new: 4.
  **Total 14.**

Frank comes first because you can talk to him right now. Between David and Emma, who are both
free this week, the people who share your hosts decide: David is well ahead. A fourth person
pointing at David would put him ahead of Frank as well. Place 3 goes to whoever was seen the
least this week.

## Where the rule comes from

- **The same three steps everywhere:** gather who can be shown, give each a score, then apply
  rules for safety and variety. TikTok, Instagram and Facebook describe their systems this way.
- **"People like you also chose this"** is YouTube's and TikTok's own description of their
  starting point, and Instagram builds its suggested accounts from the followers of accounts you
  follow. This is the founder's idea (decision 3).
- **Score what shows a good experience, not clicks.** YouTube moved from clicks to watch time to
  star ratings from surveys. Here: follows (which a good call brings by itself) and ratings; no
  clicks.
- **Something that can really happen.** Airbnb, Etsy and Fiverr put availability first: a video
  can be watched by millions at once, a host has a few free hours. Decisions 1 and 4.
- **A fair start for newcomers.** Airbnb found that giving new listings a fair estimated score
  instead of none raised their bookings. Etsy gives new listings a short lift. Decisions 5 and 7.
- **Variety and control:** TikTok avoids repeating a creator; all four let a person dismiss a
  suggestion. Decisions 7 and 10.
- **What does not carry over:** their learning systems need billions of signals; suggestions
  from uploaded phone contacts are what Facebook was criticised for.

## What it relies on (each read in the code by the builder)

- **Who can be found:** the condition `canBeFound` in `src/lib/profiles/search.ts`: approved,
  not hidden, account not closed or paused, no block either way. The same condition is used here.
- **Follows:** the table `follows` (`src/db/schema.ts:668`): one line per person and host,
  `unfollowedAt` set while it is ended. `how` says how the follow began ("self" or "call"), not
  whether the two ever had a call, so it is not used. A call leads to a follow by itself only
  under `followsAfterCall` (`src/lib/follows/rules.ts:55`): a real request, a complete
  attendance record, two minutes together, no report, block or refund request by the customer,
  the host's page open, both accounts in order, and fewer than 200 hosts followed. A follow stays
  when an account is closed, and when the host blocks the follower
  (`src/lib/follows/follows.ts:144`); decision 3 leaves both out.
- **Open times:** `offerOf` and `openTimes` in `src/lib/booking/bookings.ts` (the host's hours,
  time off, notice, breaks, what the host is already taken for, and whether they can be paid),
  and `instantOffer` for "available now". These are what the host's page asks. They look at the
  host only. What stands in the way for one customer (their own calls at that time, the ID
  check, how many requests they may send) is decided by `checkMayAsk` (`bookings.ts:204`) when
  they ask, as today.
- **Ratings as shown:** `averagesFor` in `src/lib/ratings/ratings.ts`. It counts each rater once
  and only in whole groups of three, so a shown average never moves because of one person.
- **The card:** the search results show the same things (`src/app/search/page.tsx`): `HostPhoto`,
  `Rating`, price, `languageNames`.
- **Writing while a page is drawn:** this version of Next.js may draw a page ahead of time, for
  a link that is only in view, and its guide says to move anything that writes into an action
  called from the browser (`node_modules/next/dist/docs/01-app/02-guides/prefetching.md`,
  "Triggering unwanted side-effects during prefetching"). So drawing the home page never writes.
- **The always-on helper** (`worker/closer.ts`) runs the cleaning jobs (for example
  `removeOldNotes`, every 720th pass).
- **The newest database change** on `main` is `drizzle/0043_host_languages.sql`; this plan's is
  0044, unless another session takes that number first.

## The changes

**The database** (`drizzle/0044_suggestions.sql`, `src/db/schema.ts`), three small tables. Each
is removed with the account it belongs to (the person's, or the host's).

- `suggestion_days`: one line per person and day (UTC): that suggestions were made, with which
  version of the rule, and when. It is written also when no host fitted, so the work is done
  once a day and not on every look.
- `suggestion_shows`: the hosts of that day: person, day, place (1 to 6), host, whether the
  place was a kept one, and when that card first came into view (empty until it does). One host
  at most once a day per person, one host per place.
- `suggestion_hides`: person, host, when. One line per pair.

**The rule** (`src/lib/suggestions/rules.ts`, plain logic with tests): the numbers; the points
for people, open times and ratings; the six places; the order for equal scores.

**Reading and writing** (`src/lib/suggestions/suggestions.ts`):

- `todaysSuggestions(viewerId, now)`: only reads. It returns whether today's line exists, and
  today's hosts that still pass decisions 1 and 2, each with a freshly worked out open time (at
  most six hosts, a few queries each).
- `makeSuggestions(viewerId, now)`: if today's line is there, nothing. Otherwise it first works
  the day's suggestions out, with ordinary reads and outside any database step. Then, in one
  short database step under a database lock named after the person, it looks again: if today's
  line is still not there, it writes the day's line and all its hosts together, so the day is
  either complete or not there. Two looks at the same moment both work it out, the first one
  writes, and the second finds the line and writes nothing: one result. (The working out is kept
  out of the locked step on purpose: it asks many questions through helpers that use the shared
  connections, `openTimes` among them, and the app has ten connections in all, `src/db/index.ts`.
  A locked step that waits for a free connection while other locked steps hold them all would
  never finish.)
- Working out, in order: (a) one query for everyone who passes decisions 1 and 2 except the
  open time; (b) one query for the points from people, with the rules of decision 3; (c) the
  shown ratings; (d) the open time, which costs several queries per host, is asked for **at most
  30 hosts**: the 20 with the most points so far and the 10 seen by the fewest people; (e) the
  score and the places.
- `markSeen(viewerId, day, places)`: sets "seen" on those of the person's own lines of that day
  that are not marked yet. It can touch nothing else.
- `hideSuggestion(viewerId, handle, now)`: writes the X, for a host who was suggested to that
  person.
- `removeOldSuggestions(now)`: deletes day and show lines older than 90 days; called by the
  helper with its other cleaning jobs.
- Two openings for the check script only, because the test database is shared with other work:
  `makeSuggestions` can be told which hosts to look at, and `removeOldSuggestions` whose lines to
  delete. The two counts the order is made from (`peopleBehind`, `seenBy`) can be read by it;
  no page reads them.

**The page:** `src/app/page.tsx` reads `todaysSuggestions` and draws the row with
`src/components/suggested-hosts.tsx` (the cards and the "Why these hosts?" text). A small part
that runs in the browser (`src/components/suggestions-watch.tsx`) does two things through the
actions in `src/app/suggestions/actions.ts`: when today's line does not exist yet, it asks for it
to be made and then for the page again (if that fails, again a minute later, three tries in
all); and it reports each card of which at least half has really come into view. The X is a form
with an action, as the follow button is.

**The lawyer's file** (`docs/for-the-lawyer.md`, sections 4 and 7) holds the points this plan
raises. `docs/module-record.md` gets what was built.

## How it will be checked

- **Tests of the plain rules:** the points for two, three and many people; the cap of 20; the
  rating formula and "new" as 4; the three steps of open time; the six places with fewer than
  six, exactly six and many hosts; kept places never repeating a host; the same order for the
  same person on the same day and a different one the next day.
- **`scripts/suggestions-check.ts`**, against the running app and the test database. It builds
  the example above and checks: the order; that two people pointing at a host count for nothing
  and a third switches it on; that one person counts once; that an ended follow, a follow of a
  closed or paused account, and a follow with a block between that person and the host do not
  count; that a host with no open time, a hidden page, a paused or closed account, or a block in
  either direction is never suggested; that every host of decision 2 is left out; that the X
  removes a host for good and only for that person; that drawing the page writes nothing; that
  the row is the same on a second look the same day, and that two requests arriving together
  make one complete day; that a day with no fitting host is written and not worked out again;
  that a host who is followed during the day is gone on the next look; that "seen" can be set
  only by the person themselves, only on their own lines of the named day, and counts different
  people, not looks; that lines older than 90 days are deleted and an X is not; that deleting an
  account deletes its lines; that the page never names the people behind a suggestion or says
  how many they are, and shows no follower number (a host's own name and the number of their
  ratings are meant to be there).
- **A real try in the browser:** a new customer with no history, and a customer who follows two
  hosts; the X; the row on a phone-sized window; the row appearing on the first look of a day.
- **The other check scripts**, run again, because the home page is read by three of them.

**What the automatic checks cannot test:** whether the suggestions feel right to real people.
That needs real hosts and customers, and then a look at what was shown and what led to calls.

## Limits to know about

- **With few people the row is mostly open times, ratings and the kept places.** Your idea
  needs three people pointing at the same host before it shows.
- **"Has an open time" is about the host.** The time on a card is the host's next open time for
  their shortest call. Whether this customer can take it (they may have a call of their own
  then, or the host may ask for a confirmed ID) is decided when they ask, as on the host's page
  today.
- **A host could make accounts that follow them and popular hosts** to collect points. The part
  is capped at 20 points and reaches only people who follow those popular hosts; the founder's
  admin pages show accounts. Not solved further in this version.
- **A host everyone follows is suggested to everyone.** With many hosts this would favour the
  big ones; the two kept places work against it. A correction for very popular hosts is a later
  step, when there are numbers to set it by.
- **The six are an approximation once there are many hosts.** The open time is looked up for at
  most 30 hosts when a day's suggestions are made. If those 30 have no open time, a 31st who has
  one is missed that day. When there are regularly more fitting hosts than that, each host's
  next open time should be kept in the database and refreshed by the helper. Not needed at the
  start.
- **Three people is a low bar.** In a very small community, a person who knows exactly who else
  follows their host could guess something from a suggestion. The row never says why a host is
  there, and the other parts of the score and the daily order blur it, but it is not proof
  against a determined guess. Astra advised ten. The founder chose the first day; the bar is one
  number and can be raised.
- **Made-up accounts lower the bar, and this risk is accepted for now.** Someone who makes two
  accounts of their own, lets both follow one of their hosts and a second host, and then watches
  whether that second host moves up in their own suggestions, can learn that at least one more
  person follows both hosts. Not who it is. They would have to look day after day (suggestions
  are made once a day), and open times, ratings and the daily order move the row too. An
  automatic security review of the code raised this on 19 November 2026. It stays as it is with
  the bar of three, which is the founder's decision. Two ways to tighten it later, each a small
  change to the rule: count only people whose account is some days old, or raise the bar.
- **On the first look of a day the row appears a moment after the rest of the page.**

## Not built

- Suggestions by language, topic or price, and filters on the row.
- Bringing back a hidden suggestion.
- Recording clicks or time spent.
- A switch to turn personal suggestions off (on the lawyer's list, section 4).
- Suggestions anywhere but the home page (for example in emails, or "similar hosts" on a host's
  page).
- A call counting for more than a follow (decision 3).

## Still open

- **For the founder:** the numbers of decisions 3 to 7 are starting values. The bar of three is
  yours to raise. And one change from what the builder first told you: a call no longer counts
  for more than a follow (decision 3, last point).
- **For the lawyer** (`docs/for-the-lawyer.md`, sections 4 and 7): the two EU rules about
  explaining suggestions and ranking, and using follows for suggestions.

## Astra's check of this plan (19 November 2026)

"Ready with changes." Each point was read against the code by the builder.

| # | What Astra found | What was done |
|---|---|---|
| 1 | "The room closed" does not mean a call took place: a booking nobody came to fits too. And `how` says how a follow began, not whether there was a call. | Taken, by removing the need: every person counts the same (decision 3). The sentence that follows hold "everyone who called" is corrected. |
| 2 | An open time of the host is not always usable by this customer. | Taken as wording: the plan promises the host's open time, as their page shows it, for their shortest call. The customer's own limits stay where they are, at asking. Not taken: checking each customer's limits for every suggested host; that is more than a row of suggestions needs. |
| 4 | Making the day's suggestions needs one complete database step, and a page must not write while it is drawn. | Taken: drawing only reads; an action called from the browser makes the day in one step under a database lock; an empty day is written too; the day is a UTC day. |
| 5 | One "seen" mark for the whole row cannot say which hosts were seen. | Taken: "seen" is kept per host, for the day the browser names, and "shown the least" counts different people. |
| 7 | Follows of closed accounts and of people the host blocked would still count. | Taken (decision 3). |
| 8 | Once three people follow a host, one person's call would change the order. | Taken: equal points for everyone. |
| 10 | The cap of 30 makes the result an approximation, and "sooner comes first" is not what the example shows. | Taken: said under "Limits"; the text now says "being free sooner adds points"; the rating formula is written out. |
| 11 | The new tables must go when an account is deleted, or a check script's clean-up breaks. | Taken. |

Points 3, 6 and 9 are about the home page and are in `plans/36`. Point 12 is in the lawyer's file.

**Second check, the same day,** of the plan as changed: "ready with changes", ten of the twelve
points resolved and one new must-fix. Taken: the working out of a day's suggestions is done
before the locked database step, not inside it (Astra proposed handing the step's own connection
to every helper; doing the reads first needs no change to the booking code and keeps the locked
step short). Taken: the check of what the page must never show is worded to mean the people
behind a suggestion, not hosts' names or rating counts.
