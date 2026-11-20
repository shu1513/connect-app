# Plan 32: A host's notes about a customer, after and before each call

**Status:** a plan, not built. Written 19 November 2026 by the builder alone, from the code as it
is on `main` after pull request 51, and from what the founder said that day. Astra checked it
twice: the first draft ("build with changes", ten findings) and the rewrite ("build with
changes", four clarifications). What was taken and what was not is at the end.

## For the founder: what this is

A host already has one private notepad per customer (plan 8). It works, but it is hidden away: on
the page of a single request and on "People you have talked to". This plan puts the same notepad
where a host needs it:

- **After a call:** on the results page, right under the rating, the host sees "About Anna" and
  can write down whatever they want to remember.
- **Before a call:** on the call page, while waiting to start, the host sees "About Anna" again,
  to read. Also when Anna asks for a call, next to Accept and Decline.

It stays **one notepad per customer**, carried from call to call. Nothing new is stored and the
database does not change.

## What the founder said (19 November 2026)

- After each call, after rating the customer, the host sees a notepad to jot down whatever they
  need about the customer and the conversation.
- It is one continuous notepad from conversation to conversation, not a new one each time.
- Before each conversation with that customer, the host sees the "About {customer name}" notepad
  as a review. Not for the first conversation, and not when the notepad is empty.

## What is there today

- One note per host and customer (`host_notes`, plan 8), at most 1,000 characters, plain text.
- Only that host can ever read it. Not the customer, not other hosts, and there is no admin
  screen. While either has blocked the other, or the customer's account is closed, the note is
  kept but cannot be read or changed. All of this is decided in one place
  (`src/lib/people/contacts.ts`), and stays as it is.
- A host may keep a note about anyone who really sent them a request: also when the call was
  cancelled, or the customer never came. Instant calls and membership calls count the same. A
  test call set up by the founder does not count by itself.
- The box to write it is on the page of one request (`/bookings/[id]`) and on the contacts page.
- It is **not** on the results page, **not** on the call page, **not** in the list of waiting
  requests (plan 8 said it would be), and **not** on the "Available now" panel.

## Decisions

1. **After a call: the notepad is on the results page, under the rating.** For the host of that
   call only. It does not depend on the rating in any way: a call can be rated only a few minutes
   after its booked end, and a cancelled or missed call cannot be rated at all, but a host may
   want to write about either ("did not show up"). It stays on the results page for good, so a
   host can come back to it.

2. **Before a call: "About {name}" on the call page, to read.** For the host only, above the
   room, while they wait for the call to start. It is shown **only when the notepad has something
   in it**. That is the whole rule, and it covers both of the founder's cases: before a first
   call the notepad is empty, so nothing is shown. (A host who wrote a note when the request came
   in does see it before the first call. That is what they would want.)

3. **While the host is in the call, the note is off the page.** The call screen has a "share
   screen" button, so a note on the page could be shown to the customer by accident. The review
   is for the wait before the call; in the room it is not there at all, not even folded. (The
   first draft folded it and let the host open it again. Astra pointed out that an opened note
   is as exposed as one never folded.) A host who leaves the room and waits to join again, or
   reloads the page, sees it again while waiting. That is fine: they are not in the room then.

4. **No writing on the call page.** Writing during a call is left out to keep this small and
   because of the same screen-share risk. The host writes after the call, on the results page.

5. **When the customer asks for a call, the host sees the note with the request.** Read-only,
   under the customer's name and rating, only when it has something in it: in the list of waiting
   requests (as plan 8 meant) and on the "Available now" panel, where the host has 2 minutes to
   answer. The page of one request keeps its box to write, as today.

6. **A long note never pushes the buttons away.** Wherever the note is shown to read, it keeps
   its line breaks, wraps long words, and sits in a box of limited height that scrolls. Accept
   and Decline stay where they are.

7. **One name everywhere: "About {name}".** With the line "Your private notes. Only you can see
   them." The same words on the results page, the call page, the request pages and the contacts
   page.

8. **The notepad gets bigger: 5,000 characters instead of 1,000.** That is about two pages. A
   notepad that grows over many calls fills 1,000 quickly. The box does not take more than that,
   and says how much room is left when it is nearly full. It is counted as today: after tidying
   line breaks and trimming the ends.

9. **A save never silently wipes newer text.** The notepad can now be open in several places (two
   results pages, a phone and a laptop). Each box remembers the note as it was when the page was
   opened. A save goes through only if the stored note is still exactly that; the check and the
   save are one single step in the database, so an out-of-date save can never replace different
   newer text. If the note was changed somewhere else, the save is refused: "This note was
   changed somewhere else. Copy what you typed, then reload the page to see the newer note." All
   three places where a note can be written take part, or an old box could still overwrite a new
   one. The exact rules:
   - "The note as the page showed it" is kept apart from what the host is typing, and is tidied
     the same way as a saved note before it is compared, so a note nobody changed always matches.
   - After a save that went through, the box remembers exactly what was stored (or "no note"
     after clearing). Otherwise its own next save would be refused.
   - After a refusal the box keeps both what was typed and what it remembered. It never quietly
     takes over the newer note, or the next click would overwrite it.
   - The page showed a note and the host clears it, but it is already gone: refused, like any
     other change made elsewhere.
   - The page showed no note and the host saves an empty box: nothing to do if there is still no
     note; refused if there is one now. A note is never deleted by a box that never showed it.

10. **Nothing typed is lost over a refusal.** The box saves without leaving the page. When a
    save is refused, for any reason, what the host typed is still in the box, the way the
    diary's post form already does it (`post-form.tsx`). When a save goes through, the box says
    "Saved" itself and stays where it is (the diary's form moves on to another page; this one
    does not). While a save is on its way, the box and its button wait. On the contacts page
    each customer's box is its own: saving one leaves what is typed in another alone.

11. **The note is never put in an email or a reminder.** Only on pages the host opens while
    logged in.

12. **Who may see and write is unchanged.** Every page asks the same shared check as today, with
    the logged-in person as the host. The note is fetched only for someone who is the host of
    that call or request; it is never loaded and then hidden. Being the founder gives no way to
    another host's notes. A founder who was the host of a call sees their own note there, like
    any host.

## What it must prove

1. After a call, the host finds "About {name}" on the results page with what they wrote before,
   and can add to it. Also after a cancelled call and a call the customer missed. The customer
   on the same page, another host, and the founder as admin get nothing of it.
2. It is the same notepad in every place: what is saved in one shows in all the others the next
   time they are loaded, and there is one stored note per host and customer.
3. Before a call the host sees it on the call page only when it has text, and never while they
   are in the room. The customer's call page never contains the note, not even hidden in the
   page.
4. A waiting request and an instant request show the note to that host only, and only with text.
   What the "Available now" page asks the server every 3 seconds carries the note only to that
   host.
5. Across a block in either direction, or with the customer's account closed, the note is not
   given out the next time any page or list asks, and cannot be saved from anywhere. This holds
   for the two lists too, even if a request of that customer is still waiting. (Closing an
   account ends its waiting requests a moment after the account is closed, and that step can
   fail.)
6. A note of 5,000 characters saves, with line breaks and emoji in it; one of 5,001 is refused
   and the old text is still there.
7. A save from an out-of-date box is refused and the newer text is still there: for a changed
   note, a note cleared elsewhere, and a first note written in two places at once. Of two saves
   at the same moment, one wins and the other is refused.

## What gets built

No new table and no database change. One pull request.

- `src/lib/people/contacts.ts`: the limit becomes 5,000. `saveHostNote` takes "the note as this
  page showed it" and writes only if the stored note is still that, in one step: change or clear
  only where the stored text matches; a first note only if there is none. A new
  `hostNotesAbout(host, customers)` answers for several customers at once, with every rule of the
  single check (really asked, no block either way, account open), for the two lists.
- `src/components/note-form.tsx`: becomes a form that answers in place, after the pattern of
  `src/app/host/project/post-form.tsx`. The heading "About {name}", room left, the refusal that
  keeps the typed text. It gets the limit handed in: a part that runs in the browser must not
  pull in `contacts.ts`, which talks to the database. A new small read-only piece,
  `AboutCustomer`, for the review.
- `src/app/contacts/actions.ts`: `saveNoteAction` answers in place instead of sending the browser
  on.
- `src/app/calls/[id]/results/page.tsx`: the notepad under the rating, for the host.
- `src/app/calls/[id]/page.tsx` and `call-room.tsx`: the review for the host, shown until they
  have joined.
- `src/app/host/requests/page.tsx`: the note under each customer.
- `src/lib/booking/now.ts` and `src/app/host/now/now-panel.tsx`: the note with each instant
  request.
- `src/app/bookings/[id]/page.tsx` and `src/app/contacts/page.tsx`: the new form and wording.

Before any code: this worktree has no installed packages yet. Install them, then read the guides
in `node_modules/next/dist/docs/` on forms that answer in place, as `AGENTS.md` asks.

## How it is checked

- **Automatic tests** for the rules that can be tested without a database.
- **The check script** `scripts/ratings-check.ts`, where the note journeys already are. It works
  on the local database without the app running, so it checks the rules: the limit (5,000 in,
  5,001 out; today it checks 1,001), the out-of-date save in each of its forms, two saves at the
  same moment, and the several-customers lookup with a mix of allowed, blocked and closed
  customers.
- **In a browser, by hand,** because only a real page shows what reaches whom: a full call
  between two test accounts. Write a note after it, book again, see the review before the second
  call, join and see it gone. On the customer's side, as another host, and as the founder looking
  at the call as admin: look at each page and at what the "Available now" page receives, for the
  note's text. Also: type a note without saving, then send the rating, and see what became of the
  typed note; if it is lost, that is fixed before this is called done.
- No outside service is touched (no Stripe, no change to the video service), so there is no
  real-money or real-service try for this plan.

## Not built now

- **Writing or reading notes during the call.** See decisions 3 and 4. A host who wants their
  notes during a call can open "People you have talked to" in another window.
- **A date stamped on each entry by itself.** The notepad is free text; a host can write the date.
- **Searching notes, or exporting them.**
- **Customers keeping notes about hosts** (as in plan 8).

## For the founder

- **The size, 5,000 characters.** Say if you want another number. It is one line to change.
- **For the lawyer's list:** a host's private note is information about a customer. In the UK
  and the EU a customer can ask a company for the information it holds about them. Whether these
  notes are covered, and what the rules page should tell hosts about writing them, is a question
  for the lawyer. It was already true for plan 8; this plan makes the notes larger and more used.

## Astra's check of the first draft (19 November 2026)

Verdict: "build with changes". The builder read the code behind each finding before taking it.

**Taken:**

- The out-of-date check must be part of the write itself, or two saves can both pass it
  (decision 9). Every place a note is written must take part, and the first draft's "new wording
  only" for the two existing pages was wrong.
- Saving in place can reuse the diary's post form; and the form must not pull in the database
  code (decision 10, and the build list).
- Folding the note during the call does not protect a note the host opens again. Show it only
  before joining (decision 3).
- The first draft said writing on the call page would drop the call. That was only true of
  today's form, not in general. The reason is now the honest one (decision 4).
- The two lists do not leave out blocked or closed customers by themselves, and a closed
  account's request can stay waiting for a moment. The lookup for several customers applies
  every rule itself (proof 5).
- Say plainly that a founder who hosted a call sees their own note, and that the note is fetched
  only for the host (decision 12).
- Notes do not depend on whether the call can be rated (decision 1).
- A long note must not push Accept and Decline off the screen (decision 6).
- The check script cannot see pages; the browser check does that part. And the unsaved note
  against sending a rating is checked by hand.
- The first draft changed where the page goes after a rating. It already comes back to the
  results page, with the notepad right under the rating. Nothing to change.

**Not taken:**

- Using the time of the last save as the mark of "the note as this page saw it", with care that
  two saves never get the same time. The builder compares the note's text instead: nothing about
  clocks can go wrong, and a note changed and changed back is rightly no conflict.
- A warning about screen sharing next to every place a note is shown. The note is off Connect's
  own call screen, which is where the share button is. Connect cannot stop a host from sharing
  some other page, and a line of warning would not either.

## Astra's second check, of the rewrite (19 November 2026)

Verdict: "build with changes": four clarifications, no new problem. Comparing the note's text in
the same step as the write is sound in the database as it is; no locks, no times and no database
change are needed. All four were taken:

- Say exactly what "the note as the page showed it" is, how it is compared, and what the box
  remembers after a save (the rules under decision 9). Without them, a box's second save could
  be refused over its own first one.
- Say what happens in the two empty cases (the last two rules under decision 9), and say "an
  out-of-date save can never replace different newer text" rather than "two saves cannot both
  win": two saves that change nothing may both go through.
- The diary's form answers in place only when it refuses; when it saves, it moves on. This form
  must also stay put when it saves, and say "Saved" itself (decision 10).
- A host who leaves the room or reloads sees the note again while waiting (decision 3).
