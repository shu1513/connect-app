# Plan 30: Following hosts: the rules, and part 1 (following itself)

**Status:** a plan, not built. Written 19 November 2026 by the builder alone (no helper agents),
from the code as it is on `main` after pull request 49, and from what the founder said that day.
Astra checked the first draft: "build with changes". What was taken and what was not is at the
end.

(Number 29 is the plan about a host's photo, pull request 50, which is open at the same time.)

## For the founder: what this is

A customer can **follow** a host. From then on:

- a followed host who is available right now is at the top of the customer's home page;
- a new page, **"Hosts you follow"**, lists them: who is available now, and when the customer's
  next call with each one is;
- after a call that really took place, the customer follows that host by itself.

Following is built in two parts, each its own pull request:

1. **Part 1, this plan: following itself.** The button, the automatic follow after a call, the
   page and the home page. No emails.
2. **Part 2, plan 31: emails to followers.** "Anna is available now" and "Anna wrote in her
   diary", each only for a follower who said yes for that host.

Three ideas are noted and **not built now**; why is said where each belongs:

- the host seeing how many people follow them (decision 9);
- "tell me when a time opens" for a host who is fully booked (plan 31);
- suggestions, "people who follow Anna also follow Bea" (the end of this plan).

## What the founder said (19 November 2026)

- Customers follow hosts. A followed host who is online shows on the customer's home page. A
  page lists the followed hosts, their online status and the next appointment with each.
- The home page shows all upcoming appointments, and the rooms that can be entered right now.
- A followed host also shows up when they post in their project. (Part 2.)
- "Notify me if a certain host is available at a certain time." (Part 2.)
- Followers are told about a new diary post and about new open times; "tell me when a time
  opens" for a host who is fully booked; the host sees how many followers will be told.
- People who follow one host are likely to follow another. (Suggestions, later.)
- **After a customer has had a conversation with a host, they follow the host automatically.**

## Said plainly: four limits

1. **"Available now" is the only kind of online there is.** A host is shown as available only
   while they have switched "Available now" on and their page is open (plan 7). Having the app
   open, being logged in, or being in a call is never shown. Nobody can be watched.
2. **What the pages show is up to a minute old.** The two pages ask again once a minute while
   they are open. A host who switched off a moment ago can still be on the list; their own page
   always shows the truth, and that is where "Call now" is.
3. **"Available" is about the host, not a promise to this customer.** It is what the host's own
   page shows to anyone: the host is there and has room for a call. Whether this customer may
   ask (some hosts want a confirmed ID first, a customer who was just declined waits 15
   minutes) is said when they press "Call now", as today.
4. **The host is told nothing about their followers**, not who and not how many (decision 9).

## What part 1 must prove

1. A logged-in person can follow a host whose page is open to everyone, and unfollow them, and
   nobody else can see or change who they follow.
2. After a call that really took place, the customer follows the host, once, without doing
   anything; and never after a call that went wrong.
3. Someone who said no (unfollowed, or pressed "Don't follow" after the call) is never made to
   follow that host by a call.
4. A followed host is shown as available only while their own page would show it, and never to
   someone they have blocked or who has blocked them.
5. Following gives nobody a new way to find out that they were blocked, and gives a host no way
   to find out who follows, who unfollowed, or who reported or blocked them.

## Decisions

1. **What following is.** One direction: a person follows a host. It is private: only the
   follower sees their list. There is no number of followers on a host's page (a small number
   makes a new host look empty). Any account can follow, also one that is a host itself. Nobody
   follows themselves.

2. **Who can be followed, and by whom.** A host whose page is open to everyone at that moment
   (approved, not hidden by the host, account open: the same rule as the page itself,
   `publicProfile`). The follower is logged in, has finished signing up, and is not paused by
   the founder. A paused person can still look at their list and unfollow. A person can follow
   at most **200** hosts; the 201st press says so. (Counted: the hosts on their list.)

3. **The button.** On the host's page, under the name: "Follow". For a follower it reads
   "Following" with "Unfollow" beside it. A visitor who is not logged in sees "Log in to
   follow", which leads to the login page and back to the host's page; they then press Follow
   themselves (opening a link never changes anything). A host looking at their own page sees no
   button. **One rule on every page that has the button** (the host's page, the results of a
   call, the list): it is missing only for someone who has themselves blocked this host; they
   chose to cut contact, and are told to unblock first if they try. Someone the host has blocked
   sees and uses the button like anyone else (decision 6).

4. **The automatic follow after a call.** When a call's record is final, Connect decides once
   whether the customer now follows the host. They do when all of this holds at that moment:
   - the call came from a request, a "call now" or a membership booking (not from a check
     script), and was not cancelled;
   - its record is final and complete, and shows the two **together for at least 2 minutes**
     (the number ratings use). A record that needs review is never guessed at;
   - it was not ended with "End call and report", neither person has ever reported the other,
     neither has blocked the other, and the customer has not asked for a refund of this call
     (the same list that decides whether a customer is shown a host's project after a call,
     plan 26);
   - the host's page is open to everyone, and neither account is closed or paused;
   - there is no line yet for this customer and this host: they never followed, never
     unfollowed, never said "Don't follow" (decision 5);
   - the customer follows fewer than 200 hosts.

   The decision is made by the always-on helper, about two minutes after the room closes (that
   is when a record becomes final). It is made **once per call** and never taken again: a call
   that did not lead to a follow does not lead to one later because a block was lifted or a
   report was closed. Calls from before this was built are not looked at.

   **Changed from what the builder first told the founder:** the builder had suggested also
   removing the follow when the customer then gives 1 or 2 stars. That is left out: the ratings
   were built so that nothing a person does can be traced back to the stars they gave (plan 8),
   and this would tie a visible change to a rating. A customer who did not like the call says
   "Don't follow" on the page they land on after it, which is one press. And part 2 sends no
   email without a yes, so an automatic follow costs the customer nothing but a line on a list.

5. **Saying no is kept for good.** "Unfollow" is on the host's page, on the list, and on the
   results page of a call. The line is kept, marked as ended. A later call never follows that
   host again by itself; the person can press "Follow" again whenever they like.
   The results page is usually opened **before** the automatic follow exists (the record needs
   its two minutes). So until the decision is made, that page says, to the customer of a call
   that could lead to a follow: "After a call you follow the host, so you see when they are
   available. **Don't follow Anna**". Pressing it writes the ended line right away, and the
   helper then finds a line and does nothing.

6. **Blocking.** When one person blocks another:
   - the **blocker's** own follow of the blocked person ends, in the same step as the block, and
     stays ended after an unblock (as in decision 5);
   - the **blocked** person's follow of the blocker is left as it is, because removing it would
     tell them. It goes quiet: the host never shows as available to them, and part 2 sends them
     nothing. A blocked person who presses "Follow" is treated the same way: it works, and
     stays quiet;
   - no automatic follow happens across a block.

   This does not make blocks invisible everywhere: "People you have talked to" already leaves
   out someone who blocked you, and says so. The promise here is only that following adds no
   new sign.

7. **Hidden, suspended, closed.** Nothing is deleted. A followed host whose page is not open to
   everyone (hidden by the host, or suspended) **stays on the follower's list by name**, without
   a link, as "Not taking calls at the moment", with "Unfollow": the follower knew the name
   already, and must be able to take them off the list. That is how "People you have talked to"
   treats such a host. A host whose account is closed is not listed and does not count toward
   the 200.

8. **The page "Hosts you follow"** (`/following`, with a link in the top bar: "Following").
   One line per host: the name, linked to their page; **"Available now"** with a "Call now" link
   to their page while their page would show it (limit 3); the person's next call with them, if
   one is booked, with its time and a link to it; and "Unfollow". Hosts who are available come
   first, then those with a call coming up (the soonest first), then the rest by name. Empty,
   it says how to follow someone and links to the search.
   "Available" is asked of the same function the host's own page asks (`instantOffer`): the
   host is available, has room for another instant request, and a call length fits before
   whatever they are taken for next. Never for a pair with a block in either direction.

9. **What the host sees: nothing, for now.** The founder liked "14 followers will be told you
   are online". The first draft showed the host a rough number ("Fewer than 10", "At least
   25"). Astra showed that even a rough number gives things away: the very first follower shows
   ("Nobody" becomes "Fewer than 10"), and a host can follow themselves from spare accounts up
   to the edge of a step and then watch one person arrive or leave. Because every customer
   follows after a real call, a missing or lost follower points at one customer: the one who
   reported them, asked for a refund, blocked them or unfollowed. Connect never tells a host who
   reported or blocked them. A number that only starts at, say, 50 would be safe enough and
   would also show nothing to any host for a long time. So it is left out now and can be added
   when hosts have followers in the hundreds.

10. **The home page.** Three changes, for everyone:
    - A box at the top, **"Talk now"**, shown only when there is something in it: the person's
      own calls whose room is open right now (not cancelled, not ended), each with "Go to the
      call" (the call's own page decides whether they can join, as today); and the hosts they
      follow who are available now, each with "Call now".
    - The list of calls is split in two: **"Coming up"** (calls that are not over, the soonest
      first) and **"Earlier calls"** (the rest, the newest first). Today it is one list with the
      furthest future call on top.
    - A link to "Hosts you follow" beside "People you have talked to".

11. **Keeping the pages fresh.** "Hosts you follow", and the home page of someone who follows a
    host or has a call coming up, ask the server again once a minute while the tab is in front,
    and when the person comes back to the tab. Nothing is asked while the tab is in the
    background.

12. **No switch for the founder.** Following touches no money, no call and no booking rule, so
    there is no on/off switch as memberships and projects have.

## Not in part 1

- Any email (plan 31).
- A number of followers, for the host or for the public; a host seeing who follows them; a host
  following a customer; a feed of posts on the home page (that comes with plan 31).
- Offering a membership to followers. A host invites people they have had a call with, by name,
  from "People you have talked to"; followers have no names for the host, on purpose.

## How it works

**What is stored.** One new table and one new column.

- `follows`: the follower, the host, how it began (`self` or `call`), the call an automatic
  follow came from, when it began, and `unfollowed_at` (empty while it lasts). One line per pair
  of follower and host, for good: unfollowing fills `unfollowed_at`, following again empties it.
  "Don't follow" writes a line that is ended from the start. The database refuses a line where
  both are the same person.
- `calls.follow_checked_at`: the moment the automatic follow was decided for that call, whatever
  the decision. Empty until then. The migration fills it for every call that exists, so nothing
  from before is looked at.

**One lock, taken last.** Everything that writes a person's follows first takes a lock named
after the **follower** (a database advisory lock, held to the end of the step): following,
unfollowing, the automatic follow, and the block's own step. So two automatic follows cannot
both be the 200th, and a block and an automatic follow cannot pass each other: whichever comes
second sees what the first did. It is always the last lock a step takes (`block()` has its
calendar locks by then, the helper has the call's line), so no two steps can wait for each
other.

**The rules that are plain logic** (`src/lib/follows/rules.ts`, with unit tests, no database):
`FOLLOW` (the limit of 200, the 2 minutes, the 7 days), `followsAfterCall(facts)` (decision 4
as one function over recorded facts, like `mayAsk` in plan 26) and `inListOrder` (decision 8).

**Reading and writing** (`src/lib/follows/follows.ts`):

- `follow({ followerId, handle, now })`. The host comes from `publicProfile(handle)`, so a page
  that cannot be opened and one that does not exist give the same answer. Refused: yourself,
  someone you have blocked, the 201st. Writes the line or reopens an ended one.
- `unfollow({ followerId, hostId, now })`: ends that person's own line, or writes an ended one
  if there is none and the other person has a host profile ("Don't follow").
- `followingOf(followerId, hostId)`: for the button. `"following"`, `"ended"` or `"none"`.
- `followedHosts(userId, now)`: the list of decisions 7 and 8. One question for the lines with
  each host's name and whether their page is open; one for the blocks between this person and
  those hosts; one for the calendars of those hosts that say "available" at this moment, and
  only for those few `instantOffer` is asked; one for the calls coming up with them.
- `endFollowInBlock(tx, blockerId, blockedId, now)`: called by `block()` inside its own step,
  after its other locks.
- `followAfterCalls(now)`: the helper's job. It takes up to 50 calls whose room is confirmed
  closed, whose `follow_checked_at` is empty and which ended in the last 7 days, the oldest
  first. Each in a step of its own: the call's line is locked (a call another helper holds is
  skipped) and read again; its record is loaded as the charge loads it (`loadAttendance`). Not
  final yet: nothing is written, it comes round again. Otherwise the follower's lock is taken,
  the facts of decision 4 are read **inside the step**, `followsAfterCall` decides, the follow
  is written if yes (never over an existing line), and `follow_checked_at` is filled, all
  together. A call whose record is still not final 7 days after its end is no longer looked at.

**Pages.**

- `src/app/h/[handle]/page.tsx`: the button (decision 3), with its actions in
  `src/app/following/actions.ts`. The actions take the host's handle from the form and the
  follower from the login, nothing else.
- `src/app/following/page.tsx`: decisions 7 and 8.
- `src/app/page.tsx`: decision 10.
- `src/app/calls/[id]/results/page.tsx`, for the customer of the call only: "You follow Anna"
  with "Unfollow"; or, before the decision, the sentence of decision 5 with "Don't follow Anna";
  or, when they do not follow and the page is open, a "Follow Anna" button. Which of these is
  shown never depends on whether the host has blocked the customer.
- `src/components/site-page.tsx`: "Following" in the top bar, for someone logged in.
- `src/components/refresh-every.tsx`: decision 11.
- `src/app/privacy/page.tsx`: what is kept (who you follow) and who sees it (only you).
- `worker/closer.ts`: `followAfterCalls` in the main round, after the booking work, with its own
  catch, so a failure there holds nothing else up.
- `src/lib/safety/blocks.ts`: one line calling `endFollowInBlock`.

## How it is checked

- Unit tests of the rules: every condition of decision 4 one at a time, and the order of the
  list.
- `scripts/follow-check.ts`, against the local database, with people, hosts and calls it makes
  itself and removes again (as `scripts/ratings-check.ts` does):
  - following and unfollowing; the limit; a page that is not open; yourself; a paused follower;
  - the automatic follow after a good call, and none after each kind of call that must not lead
    to one (each condition of decision 4 on its own);
  - once per call: the job run twice, and twice at the same moment; "Don't follow" pressed
    before the decision; never again after an unfollow;
  - **races, made to happen on purpose:** two different calls decided at the same moment for a
    customer who follows 199 hosts (one follow, not two); a block and the decision at the same
    moment, in both orders (never a follow of someone you blocked); a follow and an unfollow at
    the same moment (one clean line);
  - a block in each direction, and after the unblock; the blocked follower's list unchanged and
    the host never available on it;
  - a hidden host staying on the list by name without a link, and coming back; a closed host
    gone from it and from the count;
  - available now shown and not shown (availability over, no room, across a block); the next
    call; the order of the list.
- The actions themselves, through the running app: a form sent with someone else's ID in it
  changes nothing for that person; someone who is not on a call gets "not found" for its results
  page and cannot follow or say "Don't follow" through it; the pages a blocked follower gets
  (the host's page, the results page, the list) are the same, button for button, as the ones an
  unblocked follower gets.
- All earlier check scripts once more, since `block()` and the calls table are touched.
- In the browser, phone-sized and wide: follow from a host's page, the list, the home page with
  a host available and a room open, unfollow, and the results page before and after the
  decision.

**What the automatic checks cannot test:** two people on two real devices, one switching
"Available now" on and the other watching it appear within a minute; and whether the home page's
new order reads well to a real customer.

## Later: suggestions

"People who follow Anna also follow Bea", on a host's page and on "Hosts you follow". Not built
now: there are no followers yet to work it out from. When it is built: a pair of hosts is only
ever suggested when a large enough number of different people follow both, so that nobody's list
can be read from a suggestion (the same care as with the number in decision 9); hosts the viewer
has blocked, or who are not open to everyone, are never suggested.

## Astra's check of this plan (19 November 2026)

Verdict on the first draft: "build with changes". Its points on this plan, and what was done:

- **The rough number of followers still gives people away** (the first follower shows; a host
  can use spare accounts to sit at the edge of a step). Taken: no number at all for now
  (decision 9).
- **The results page hid the button across a block in either direction, the host's page did
  not; comparing the two told a blocked person.** Taken: one rule everywhere (decision 3). Also
  taken: the plan no longer promises that a block can never be noticed anywhere (decision 6).
- **Locking the call alone does not keep the limit, and a block could slip in between reading
  and writing.** Taken: one lock per follower, taken last (above), and the facts are read inside
  the step. Not taken: making the filing of a report wait for the decision as well. A report
  about a person already blocks them, and the block ends the follow.
- **The customer lands on the results page before the automatic follow exists, so "Unfollow"
  would not be there.** Taken: "Don't follow" (decision 5). Also taken: a host whose page is not
  open stays on the list with "Unfollow", otherwise they could never be removed and would use
  up the 200 (decision 7).
- **`instantOffer` says the host is available, not that this customer may ask.** Taken as a
  plainer promise (limit 3). Also taken: a paused account, which `publicProfile` does not look
  at, is checked for the automatic follow.
- **"Join" needs more than the room's clock.** Taken: the link says "Go to the call" and the
  call's page decides. And the home page of someone with a call coming up is kept fresh too.
- **More checks:** the races made to happen, forged forms, the pages of a blocked follower.
  Taken.
