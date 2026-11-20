# Plan 38: The home page, as a host sees it

**Status:** a plan, being built. Written 19 November 2026 by the builder alone, from the code as
it is on `main` after pull request 68 (the home page of plan 36 is merged), and from what the
founder said that day. It went through three shapes; the founder's words that changed it are
below. Astra gave its own view before any plan and checked the first two shapes; what was taken
from each check is at the end. This last shape was not sent to Astra as a plan: it is the first
shape again, with Astra's points from both checks worked in. Astra checks the code.

## For the founder: what this is

You asked: "the host's home page would see all her upcoming schedules and customers' information
yes?" Until now the answer was no. A host saw her calls with the customer's name and nothing
else about them, and had to open another page to answer a request.

After this change there is still **one home page, and a host sees a host's version of it**:

```
 Hello, Anna
 Hosting:  Available now · Your calendar · Earnings · Settings
           Your page: /h/anna
+----------------------------------------------+
| YOUR NEXT CALL                               |
| (photo) Ben Ortiz        Today, 3:00 PM · 30 min
|  $40.00 held · You host this call            |
|  "I would like advice on my first video."     |
|  ID confirmed · Your member · 3 calls before, |
|  the last on Nov 12                           |
|  > Your notes about Ben         (tap to open) |
|  You can enter in  12:34                      |
+----------------------------------------------+
  WAITING FOR YOU
   Friday 6:30 PM
    David Kim, 15 minutes, $20.00 · 4.8 · ID confirmed
    "Quick question about sponsors"
    Answer by Thursday 6:30 PM   [Accept] [Decline]
  YOUR NEXT CALLS
   Today
    5:00 PM · Carla Diaz   15 min · You host this call
     First call with you
    8:00 PM · Emma (a host you booked)   30 min
  HOSTS YOU FOLLOW · NEWS FROM YOUR HOSTS · SUGGESTED HOSTS
```

A host is often a customer too, so the page is a combination: her host things first, in among
her own calls, and her customer things below. Someone who only books calls sees the page exactly
as before. Nothing new is stored, the database does not change, and no rule about money or calls
changes.

## What the founder said (19 November 2026)

- "the host's home page would see all her upcoming schedules and customers' information yes?
  what's the best homepage for hosts in your opinion? also see what astra thinks"
- "Yes, plan it" (the small first step: the customer's details on the page everyone lands on).
- "I think hosts should have different home pages than the customers don't you think?" The
  second shape was a page of the host's own, at its own address.
- "do what you think is the best. of course after a host logs in, she should see something
  different, the host's home page, not the customer's home page. but my question is that since
  a host can also be a customer, so the home page should probably have a combination of both?"

The builder's answer to the last: yes. A second page would show a host-and-customer the same
calls in two places and make her choose between them. One page that shows more to a host gives
her "something different" when she logs in, and the combination, with nothing changed about
logging in.

## Decisions (the builder's, except where it says the founder's)

1. **One home page; a host sees more on it (the founder's: different for a host, and a
   combination of both).** The parts for a host appear by themselves when there is something to
   show. Nobody chooses a "mode".

2. **What she sees about the customer of a call she hosts,** on the next-call card and in the
   list. Each only when there is something to show:
   - **The customer's photo,** when they have one this host may see (the rule of plan 35).
   - **What they want to talk about:** the words the customer wrote when asking. (A call right
     now and a call booked with membership time have none.)
   - **"ID confirmed"**, when the customer has passed the ID check. Never the ID or the name on
     it.
   - **"Your member"**, while the customer has a membership with her that is active: a month is
     held or running. Not for one that is only invited, paused or unpaid.
   - **How often they have talked:** "First call with you", "1 call before, on Nov 12",
     "3 calls before, the last on Nov 12". The same count as "People you have talked to".
   - **Her own private note about them** (plan 32), folded: "Your notes about Ben".

3. **In a list, the private note is folded; the rest is open.** A note can hold frank words, can
   be 5,000 characters long, and creators often show their screen. Folded, it is one line; a
   tap opens it in the usual box, which scrolls. This holds on the home page and in the list of
   requests wherever it is shown. On the page of one call or one request, and on the "Available
   now" panel, the note stays open as today. A note she opened stays open while the page
   refreshes, closes when the card moves on to another call, and is gone when it may no longer
   be read. Folding makes an accident less likely; it cannot take back what was on a screen.

4. **No star rating next to a booked call.** The rating helps a host decide on a request, and
   stays with the requests. After she has accepted, it could only colour the call. (Astra's
   point.)

5. **Requests are answered on the home page.** "Waiting for you" no longer only says how many
   requests there are: it shows them, with the customer's photo, rating, "ID confirmed", their
   words, her note, the deadline, and Accept and Decline. It is the same list as on the requests
   page, drawn by the same code. The home page shows the first five times asked for (a time
   three people asked for counts as one); "See all" leads to the requests page. After Accept or
   Decline she is back on the home page with the usual message. A request for a call right now
   is in the list too, as on the requests page today; the "Available now" page stays the place
   that shows it the moment it arrives. Decision 7 holds in this list as well, on both pages: a
   request that is still waiting from a closed account, or across a block, shows its time,
   length and price only.

6. **A line of shortcuts for a host,** under the greeting: Available now, Your calendar,
   Earnings, Settings, and the address of her public page. Shown to anyone who has hosting to
   do: an approved profile (also a hidden one), or a call she hosts that is not over, or a
   request waiting. (A host who changes her display name waits for approval again, and a
   declined or suspended host can still have booked calls.)

7. **With a block either way, or the customer's account closed: no details at all.** Not the
   photo, the words, the labels, the count or the note. Such a call can still be on the list (a
   block cancels only calls that have not started, and a cancelling can fail). It is then shown
   as before this plan: name, time, money.

8. **A test call set up by a check script shows no details,** also when that customer has real
   calls with her.

9. **Only for the host of that call, decided on the server.** The details are fetched with the
   logged-in person's id as the host, for the calls where the database says she is the host.
   They are attached to those calls only, before anything is sent to the browser. The label
   "You host this call" is how a row looks; it is never what decides who gets details. A
   customer's own page carries nothing of this about themselves, on the first page and on every
   refresh.

10. **Never shown:** the customer's email, the name from their ID check, anything about their
    card, other hosts' notes about them, their calls with other hosts. The code names each field
    it reads about a customer.

11. **A fixed number of questions to the database,** whatever the number of calls. A person who
    hosts nothing costs one small question more than before (whether they have a host profile,
    for the shortcuts), and none for the details. The page asks Stripe nothing, as before.

12. **Where a host lands after logging in does not change:** the home page, which now is hers.

## What it must prove

1. On the card and in the list, each fact of decision 2 appears exactly when it applies: a
   first-time customer; a returning one with a note, a confirmed ID and an active membership; a
   membership that is paused (no label); a call right now (no words).
2. The count is the number the "People you have talked to" page shows. Not counted: a cancelled
   call, a call the customer never joined, a call that is still running.
3. The customer of the same call, on their own home page, gets none of it, on the first page and
   on the refresh. The same for a person who is host of one call and customer of another: details
   on the first only.
4. With a block in either direction, or the customer's account closed, a call that is still on
   the list shows no details. Tried with calls that survived. The check for several customers at
   once gives the same answer as the single check for each: also for a request abandoned at the
   card step, a test call, and the two people the other way round.
5. A test call shows no details.
6. Accept and Decline on the home page do what they do on the requests page and come back to the
   home page with the message, also when the answer is a refusal. A made-up return page gets
   nowhere.
7. The shortcuts appear for a host, also one whose profile waits for approval but who has a
   booked call, and never for someone who only books calls.
8. For a person who hosts nothing, the details ask the database nothing. For a host, the number
   of questions is the same with one hosted call and with several. (Read in the code, not
   counted by a check.)
9. The home page of someone who only books calls is unchanged, and the requests page works as
   before (with the note folded).

## What it relies on (each read in the code by the builder)

- **The home page:** `src/app/page.tsx` (plan 36, merged in pull request 61, with the suggested
  hosts of plans 37 and 41). It loads this person's calls that are not over, in either role, and
  already has the requests waiting (`waitingForHost`) for its one line. The card and
  `src/components/calls-by-day.tsx` draw a call from a `ListedCall`, which has `hosting`.
- **It refreshes every minute** (`RefreshEvery`), for everyone who is logged in.
- **The list of requests:** `src/app/host/requests/page.tsx`. It includes requests for a call
  right now and shows the note open. Accept and Decline go back to one of two pages, chosen from
  a fixed list by a hidden field named `from` (`src/app/bookings/[id]/actions.ts:16`). Messages
  are signed for the page they are shown on (`src/lib/notice.ts`); the home page already reads
  its own.
- **A customer's photo for a host:** `photosForHost` (`src/lib/profiles/photo.ts:737`), which
  asks its own rule for each customer.
- **What the customer wrote:** `bookings.note` (`src/db/schema.ts`), found through
  `bookings.callId`. Empty for a call right now (`src/lib/booking/bookings.ts:478`) and for a
  member's call. The founder's page of reports also shows it for a reported call.
- **ID confirmed:** `verifiedAmong` (`src/lib/safety/identity.ts`), one question for many.
- **Member:** `memberships.status`; `active` means a month is held or running. A stopped renewal
  is not a status.
- **Calls before:** the rule in `contactsOf` (`src/lib/people/contacts.ts`): both roles, over by
  its booked end, not cancelled, not made by a check script, each of the two joined.
- **The private note:** `hostNotesAbout` (same file) asks the single check once for each note,
  with up to three questions each. Shown with `AboutCustomer`.
- **Blocks and closed accounts:** a block cancels only calls that start in the future, and a
  failure is caught (`src/lib/safety/blocks.ts:57`); closing an account can leave a call too
  (`src/lib/profiles/closing.ts:103`).
- **A profile that is not approved can still have calls:** a new display name sends an approved
  profile back to "pending" (`src/lib/profiles/profiles.ts:164`); declining or suspending does
  not cancel booked calls.

## What gets built

No new table and no database change. One pull request.

- `src/lib/people/contacts.ts`: the rule for "a call that counts" is written once and used by
  `contactsOf` and by a new count for several people at once. The check for the note gets a form
  for several customers at once, in three questions, with every condition of the single check;
  `hostNotesAbout` uses it.
- `src/lib/home/briefing.ts` (new, server only): for the calls a person hosts, the details of
  decision 2, with decisions 7 and 8 applied.
- `src/lib/home/rules.ts`: the words for the calls before, with tests.
- `src/components/about-customer.tsx`: can be drawn folded.
- `src/components/customer-details.tsx` (new): the details of one hosted call, used by the card
  and by `src/components/calls-by-day.tsx`, whose row can now carry them.
- `src/app/host/requests/request-list.tsx` (new): the list of requests, moved out of the requests
  page, with the note folded; used by both pages.
- `src/app/bookings/[id]/actions.ts`: the fixed list of pages Accept and Decline may go back to
  gets a third, the home page.
- `src/app/page.tsx`: the shortcuts, the details on the card and in the list, the requests.
- `scripts/home-check.ts`: the proofs above.
- `docs/module-record.md`: what was built.
- `docs/for-the-lawyer.md`: nothing new. A host's notes about a customer are already there (plan
  32); this plan shows them in one more place, to the same host only.

## How it is checked

- **Automatic tests** for the words of the calls before.
- **`scripts/home-check.ts`**, against the running app and the test database: the proofs above.
- **The other check scripts that read the home page or the requests page,** run again. The local
  test database is shared with other sessions, so the scripts take turns.
- **In a browser, by hand,** on a phone-sized window: a host a few minutes before a call, a long
  note opened, through a refresh; Accept on a request from the home page.
- The change touches no outside service (no Stripe, no video service), so there is no real-money
  or real-service try for this plan.

**What the automatic checks cannot test:** how it reads on a real phone, and whether these are the
right details for a real host. Both are for the browser try and for you.

## Not built now

- **A page of the host's own, and landing on it after logging in** (the second shape). See the
  founder's last words above.
- **The sums of her earnings on the home page.** Working them out asks the database once for
  each contributor and each refund request, too much for a page that refreshes every minute. The
  shortcut leads to them.
- **A week or month calendar of booked calls.** The list by day, as plan 36 chose.
- **Writing the note from the home page.**
- **The customer's rating next to a booked call.** See decision 4.

## Still open, for the founder

- **The details** (decision 2), **the note folded, also in the list of requests** (decision 3;
  plan 32 showed it open there) and **no rating on booked calls** (decision 4) are the builder's
  choices. Each is a small change after you have seen the page.

## Astra's own view, before any plan

Asked the founder's question with the files to read, and not told what the builder thought. It
advised: no page gives a host her calls with anything useful about the customer; start on the
page people land on and do not make host and customer two kinds of account; show the calls
before; keep the rating for the moment of deciding; never the email or the ID name, which are
both stored; keep the rules about blocks and closed accounts; do not wait for Stripe. All taken.

## Astra's check of the first shape (details on the shared page): "ready with changes"

Taken, each read in the code first: the label "You host this call" is how a row looks and must
never decide who gets details (decision 9, proof 3); a block or a closed account does not always
cancel the call, so say what is shown then (decision 7, proof 4); "Your member" needs an exact
meaning (decision 2); do not promise a number of questions the note's check cannot keep (the
check for several at once, decision 11); one shared rule for "calls before" must stay exact
(proof 2); no words for calls right now and member calls, test calls left out by where the
booking came from (decisions 2 and 8); an opened note is not sure to stay open over a refresh
(decision 3).

## Astra's check of the second shape (a page of the host's own): "ready with changes"

That shape was dropped after the founder's last words, but these points still apply and were
taken: the sums of the earnings and the calls to rate are not cheap, so the home page links to
the earnings (under "Not built now"); an approved profile is not the same as having hosting to
do (decision 6); the check for several customers must keep every condition of the single one
(proof 4); the hidden field is named `from`, and the list shows five times, not five requests
(decision 5). Its advice on landing after logging in is no longer needed (decision 12).
