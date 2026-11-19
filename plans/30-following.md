# Plan 30: Following hosts: the rules, and part 1 (following itself)

**Status:** a plan, not built. Written 19 November 2026 by the builder alone (no helper agents),
from the code as it is on `main` after pull request 49, and from what the founder said that day.
Astra's check of it is recorded at the end.

(Number 29 is the plan about a host's photo, pull request 50, which is open at the same time.)

## For the founder: what this is

A customer can **follow** a host. From then on:

- a followed host who can take a call right now is at the top of the customer's home page;
- a new page, **"Hosts you follow"**, lists them: who is available now, and when the customer's
  next call with each one is;
- after a call that really took place, the customer follows that host by itself.

Following is built in two parts, each its own pull request:

1. **Part 1, this plan: following itself.** The button, the automatic follow after a call, the
   page, the home page, and the one line a host sees about their followers. No emails.
2. **Part 2, plan 31: emails to followers.** "Anna is available now", "Anna wrote in her diary",
   "Anna has an open time", each only for a follower who said yes for that host, and only in the
   hours they chose.

One idea is noted and not built now: **suggestions** ("people who follow Anna also follow Bea").
It needs real followers before it can say anything. The rule it will follow is at the end.

## What the founder said (19 November 2026)

- Customers follow hosts. A followed host who is online shows on the customer's home page. A
  page lists the followed hosts, their online status and the next appointment with each.
- The home page shows all upcoming appointments, and the rooms that can be entered right now.
- A followed host also shows up when they post in their project. (Part 2.)
- "Notify me if a certain host is available at a certain time." (Part 2.)
- Followers are told about a new diary post and about new open times; "tell me when a time
  opens" for a host who is fully booked; the host sees how many followers will be told. (Part 2.)
- People who follow one host are likely to follow another. (Suggestions, later.)
- **After a customer has had a conversation with a host, they follow the host automatically.**

## Said plainly: four limits

1. **"Available now" is the only kind of online there is.** A host is shown as available only
   while they have switched "Available now" on and their page is open (plan 7). Having the app
   open, being logged in, or being in a call is never shown. Nobody can be watched.
2. **What the pages show is up to a minute old.** The two pages ask again once a minute while
   they are open. A host who switched off a moment ago can still be on the list; their own page
   always shows the truth, and that is where "Call now" is.
3. **The host sees a rough number, never names.** "Fewer than 10 people follow you", "At least
   25 people follow you". The reason is below (decision 9).
4. **A person who was blocked is not told, here either.** If a host blocks a follower, the
   follower's list still shows the host; the host just never shows as available to them.

## What part 1 must prove

1. A logged-in person can follow a host whose page is open to everyone, and unfollow them, and
   nobody else can see or change who they follow.
2. After a call that really took place, the customer follows the host, once, without doing
   anything; and never after a call that went wrong.
3. Someone who unfollowed a host is never made to follow them again by a later call.
4. A followed host is shown as available only when a call with them could really be asked for
   right now, and never across a block in either direction.
5. A host learns roughly how many people follow them and nothing about who.

## Decisions

1. **What following is.** One direction: a person follows a host. It is private: only the
   follower sees their list. The host is not told who follows, and there is no public number on
   a host's page (a small number makes a new host look empty). Any account can follow, also one
   that is a host itself. Nobody follows themselves.

2. **Who can be followed, and by whom.** A host whose page is open to everyone at that moment
   (approved, not hidden by the host, account open: the same rule as the page itself,
   `publicProfile`). The follower is logged in, has finished signing up, and is not paused by
   the founder. A paused person can still look at their list and unfollow. A person can follow
   at most **200** hosts; the 201st press says so.

3. **The button.** On the host's page, under the name: "Follow". For a follower it reads
   "Following" with "Unfollow" beside it. A visitor who is not logged in sees "Log in to
   follow", which leads to the login page and back to the host's page; they then press Follow
   themselves (opening a link never changes anything). A host looking at their own page sees no
   button. Someone who has blocked this host sees no button: they chose to cut contact.

4. **The automatic follow after a call.** When a call's record is final, Connect decides once
   whether the customer now follows the host. They do when all of this holds:
   - the call came from a request, a "call now" or a membership booking (not from the admin test
     page), and was not cancelled;
   - its record is final and complete, and shows the two **together for at least 2 minutes**
     (the number ratings use). A record that needs review is never guessed at;
   - it was not ended with "End call and report", neither person has ever reported the other,
     neither has blocked the other, and the customer has not asked for a refund of this call
     (the same list that decides whether a customer is shown a host's project after a call,
     plan 26);
   - the host's page is open to everyone, and both accounts are open;
   - the customer has never followed this host before (see decision 5) and follows fewer than
     200 hosts.

   The decision is made by the always-on helper, a few seconds after the record is final. It is
   made **once per call** and is never taken again: a call that did not lead to a follow does not
   lead to one later because a block was lifted or a report was closed. Calls from before this
   was built are not looked at.

   **Changed from what the builder first told the founder:** the builder had suggested also
   removing the follow when the customer then gives 1 or 2 stars. That is left out. A host can
   see their number of followers; a follow that disappears right after a call would hint at the
   rating that customer gave, and the ratings were built so that no single rating can ever be
   read (plan 8). A customer who did not like the call presses "Unfollow" on the page they land
   on after it, which is one press and tells the host nothing more than any unfollow does. And
   part 2 sends no email without a yes, so an automatic follow costs the customer nothing but a
   line on a list.

5. **Unfollowing is kept for good.** "Unfollow" is on the host's page, on the list, and on the
   results page of a call. The line is kept, marked as ended. A later call never follows that
   host again by itself; the person can press "Follow" again whenever they like.

6. **Blocking.** When one person blocks another:
   - the **blocker's** own follow of the blocked person ends, in the same step as the block, and
     stays ended after an unblock (as in decision 5);
   - the **blocked** person's follow of the blocker is left as it is, because removing it would
     tell them. It goes quiet: the host never shows as available to them, they are not counted
     among the host's followers, and part 2 sends them nothing. A blocked person who presses
     "Follow" is treated the same way: it appears to work and stays quiet.
   - no automatic follow happens across a block.

7. **Closed and hidden.** Nothing is deleted. A host whose page is not open to everyone (hidden,
   suspended, account closed) is left out of every follower's list while that lasts and comes
   back with the page. A follower whose account is closed is not counted.

8. **The page "Hosts you follow"** (`/following`, with a link in the top bar: "Following").
   One line per host: the name, linked to their page; **"Available now"** with a "Call now" link
   to their page when a call with them could be asked for right now; the customer's next call
   with them, if one is booked, with its time and a link to it; and "Unfollow". Hosts who are
   available come first, then those with a call coming up (the soonest first), then the rest by
   name. Empty, it says how to follow someone and links to the search.
   "Could be asked for right now" is asked of the same function the host's own page asks
   (`instantOffer`): the host is available, has room for another instant request, and a call
   length fits before whatever they are taken for next.

9. **What the host sees.** One line on the Hosting page, in steps, so that one person coming or
   going is not visible: "Nobody follows you yet", "Fewer than 10 people follow you", then "At
   least 10", 25, 50, 100, 250, 500, 1,000 and so on. Counted: follows that have not ended, by
   accounts that are open, without anyone blocked in either direction.
   Why steps and not the exact number: every customer follows after a real call, so with an
   exact number a host could watch it not go up after a call (the customer reported them or
   asked for a refund) or go down (a customer unfollowed or blocked them). Connect never tells a
   host who reported or blocked them. A known limit, as with the ratings: at the edge of a step
   (10 becoming 9) one person's leaving shows.

10. **The home page.** Three changes, for everyone:
    - A box at the top, **"Talk now"**, shown only when there is something in it: the person's
      own calls whose room is open right now, each with "Join"; and the hosts they follow who
      are available now, each with "Call now".
    - The list of calls is split in two: **"Coming up"** (calls that are not over, the soonest
      first) and **"Earlier calls"** (the rest, the newest first). Today it is one list with the
      furthest future call on top.
    - A link to "Hosts you follow" beside "People you have talked to".

11. **Keeping the pages fresh.** "Hosts you follow", and the home page of someone who follows at
    least one host, ask the server again once a minute while the tab is in front, and when the
    person comes back to the tab. Nothing is asked while the tab is in the background.

12. **No switch for the founder.** Following touches no money, no call and no booking rule, so
    there is no on/off switch as memberships and projects have.

## Not in part 1

- Any email (plan 31).
- Suggestions, a public number of followers, a host seeing who follows them, a host following a
  customer, a feed of posts on the home page (the last comes with plan 31).
- Offering a membership to followers. A host invites people they have had a call with, by name,
  from "People you have talked to"; followers have no names for the host, on purpose.

## How it works

**What is stored.** One new table and one new column.

- `follows`: the follower, the host, how it began (`self` or `call`), the call an automatic
  follow came from, when it began, and `unfollowed_at` (empty while it lasts). One line per pair
  of follower and host, for good: unfollowing fills `unfollowed_at`, following again empties it.
  The database refuses a line where both are the same person. An index by host, over the lines
  that have not ended, serves the host's count.
- `calls.follow_checked_at`: the moment the automatic follow was decided for that call, whatever
  the decision. Empty until then. The migration fills it for every call that exists, so nothing
  from before is looked at.

**The rules that are plain logic** (`src/lib/follows/rules.ts`, with unit tests, no database):
`FOLLOW` (the limit of 200, the 2 minutes, the 7 days), `followsAfterCall(facts)` (decision 4
as one function over recorded facts, like `mayAsk` in plan 26), `followerWords(count)` (the
steps of decision 9) and `inListOrder` (decision 8).

**Reading and writing** (`src/lib/follows/follows.ts`):

- `follow({ followerId, handle, now })`. The host comes from `publicProfile(handle)`, so a page
  that cannot be opened and one that does not exist give the same answer. Refused: yourself,
  someone you have blocked, the 201st. One follower at a time (a lock on the follower), so two
  presses at once cannot pass the limit together. Writes the line or reopens an ended one.
- `unfollow({ followerId, hostId, now })`: fills `unfollowed_at` on that person's own line.
- `followingOf(followerId, hostId)`: for the button.
- `followedHosts(userId, now)`: the list of decision 8. One question for the lines with the
  host's public page; one for the blocks between this person and those hosts; one for the
  calendars of those hosts that say "available" at this moment, and only for those few
  `instantOffer` is asked; one for the calls coming up with them.
- `followerCount(hostId)`: decision 9.
- `endFollowInBlock(tx, blockerId, blockedId, now)`: called by `block()` inside its own step.
- `followAfterCalls(now)`: the helper's job. It takes up to 50 calls whose room is confirmed
  closed, whose `follow_checked_at` is empty and which ended in the last 7 days, the oldest
  first. For each it loads the record the charge uses (`loadAttendance`). Not final yet: left
  for the next round. Otherwise, in one step with the call's line locked: decide with
  `followsAfterCall`, write the follow if yes (never over an existing line), and fill
  `follow_checked_at`. Two helpers at once cannot both decide a call. A call whose record is
  still not final 7 days after its end is no longer looked at.

**Pages.**

- `src/app/h/[handle]/page.tsx`: the button (decision 3), with its two actions in
  `src/app/following/actions.ts`. The actions take the host's handle from the form and the
  follower from the login, nothing else.
- `src/app/following/page.tsx`: decision 8.
- `src/app/page.tsx`: decision 10.
- `src/app/calls/[id]/results/page.tsx`: for the customer of the call, one line: "You follow
  Anna. She is on your home page when she is available now." with "Unfollow"; or, when they do
  not follow and the page is open and nobody is blocked, a "Follow Anna" button.
- `src/app/host/page.tsx`: the line of decision 9, for a host with an approved profile.
- `src/components/site-page.tsx`: "Following" in the top bar, for someone logged in.
- `src/components/refresh-every.tsx`: decision 11.
- `src/app/privacy/page.tsx`: what is kept (who you follow) and who sees it (you; the host only
  a rough number).
- `worker/closer.ts`: `followAfterCalls` in the main round, after the booking work, with its own
  catch, so a failure there holds nothing else up.
- `src/lib/safety/blocks.ts`: one line calling `endFollowInBlock`.

## How it is checked

- Unit tests of the rules: every condition of decision 4 one at a time, the steps of decision 9
  at each edge, the order of the list.
- `scripts/follow-check.ts`, against the local database, with people, hosts and calls it makes
  itself and removes again (as `scripts/ratings-check.ts` does):
  following and unfollowing; the limit; a page that is not open; yourself; the automatic follow
  after a good call and after each kind of call that must not lead to one; once per call, also
  when the job runs twice at the same time; never again after an unfollow; a block in each
  direction, and after the unblock; a hidden host leaving the list and coming back; a closed
  follower not counted; available now shown and not shown (availability over, no room, across
  a block); the next call; the order of the list.
- All earlier check scripts once more, since `block()` and the calls table are touched.
- In the browser, phone-sized and wide: follow from a host's page, the list, the home page with
  a host available and a room open, unfollow, the line on the Hosting page, and the results page.

**What the automatic checks cannot test:** two people on two real devices, one switching
"Available now" on and the other watching it appear within a minute; and whether the home page's
new order reads well to a real customer.

## Later: suggestions

"People who follow Anna also follow Bea", on a host's page and on "Hosts you follow". Not built
now: there are no followers yet to work it out from. When it is built: a pair of hosts is only
ever suggested when at least 10 different people follow both, so that nobody's list can be read
from a suggestion; automatic follows count like any other; hosts the viewer has blocked, or who
are not open to everyone, are never suggested.

## Astra's check of this plan

(Filled in after the check.)
