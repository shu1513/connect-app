# Phone apps, part 05: search, a host's page, following

**Status:** a plan only. Written 20 November 2026 by the builder alone. Part of plan 45. Astra
checked it once ("ready with changes"); its points are worked in (the list is at the end).

## For the founder: what this is

A customer finds a host and reads her page: photo, name, what she says about herself, her
confirmed social accounts, the languages she speaks, her rating, her price, her cancellation
rule, her open times, whether she is available now, and what a member or an invited person
sees. From there they follow her or start booking (part 06). As on the website, search and a
host's page can be looked at without an account.

**Left out:** her project box and diary.

## What is there today (read in the code)

- **Search** (`src/app/search/page.tsx`, `searchHosts`, `searchTerms`): by name, Connect handle
  or social handle; at least two characters; at most 20 results, with a line asking to narrow
  the search when there are more; the exact match first; a pair with a block in either
  direction never find each other; open to someone not signed in.
- **A host's page** (`src/app/h/[handle]/page.tsx`, 371 lines):
  - who may open it is not one rule. Anyone may open an approved, visible host. A member, or
    someone she invited, may also open her page while it is hidden or waiting for approval
    again, without her photo and social accounts; while waiting for approval nobody can book.
    A blocked pair can still open the page by its address, with booking left out, and the
    follow button behaves so that it does not give away that the host blocked the person;
  - what it shows: the profile (`publicProfile`), the photo, confirmed social links, languages,
    the rating (`averageFor`), the price, the cancellation wording, the choice of length and
    the open times (`offerOf`, `openTimes`, with the slot picker), "verified customers only"
    with "Confirm yours", "not available" against "no open times", "available now"
    (`instantOffer`), Report;
  - for a member or an invited person, many states (plan 22): invited, joining, not paid,
    paused, time left, a held month, member-only times, not enough time left. There is no
    general "Join" for the public on this page;
  - for projects: `diaryFor`, `postsOf`, `contributionOf` (left out).
- **Following:** `follow`, `unfollow`, per-host choices with the hours for "tell me when she
  is available" (`saveChoices`), and "tell me when she is online" (`askOnlineAction`). The
  website's form turns a box that is not sent into "no"; the function underneath changes only
  what it is given.
- **Photos** are read by ID from `/host-photos/[id]` (`photoFor` decides each time);
  `/photo` is only for uploading.

## Decisions (the builder's)

1. **`GET /api/app/search?q=…`** and **`GET /api/app/hosts/[handle]`**, open to anyone as their
   pages are, each through one shared "what this page shows for this person" function that the
   website's page also uses. Every rule above about who may open what, and what is left out
   for whom, lives in that function, once. The answers are built field by field and hold no
   project, diary or contribution field.
2. **Photos** as part 04 built them.
3. **Open times are shown in the phone's time zone,** as the website shows them in the
   viewer's. (The host's own time appears beside the chosen time on the booking summary, part
   06.) The server sends the open times; the phone only groups them by its days.
4. **Follow, unfollow, the choices (with their hours), "tell me when she is online":** small
   addresses on the same functions. **The diary choice is not shown and is never sent:** the
   app's address hands the function only the fields the app has, so the choice a person made
   on the website stays exactly as it was. (Copying the website's form would have erased it.)
5. **"Available now"** shows as on the website; its button arrives with part 11. **Everything
   about memberships on this page** follows the apps' membership switch (part 01): with it off
   the app shows the page as to a non-member; its buttons arrive with part 13.
6. **Report** leads to the report form (built in part 09, where it is first needed; until then
   the button is not shown).
7. **Sharing a host** uses the phone's own share sheet with her public web address, and only
   for a host whose page anyone may open. It is a link to a profile, not to a way of paying.

## How it is tried

- Check script: search with one character, two, more than 20 results, each kind of handle,
  signed out, a blocked pair both ways; a host's page for a stranger, a signed-out person, a
  member of a hidden host, an invited person, a blocked pair both ways, a host waiting for
  approval; no project field in any answer; following with choices saved from the app leaves
  the diary choice as it was.
- `follow-check`, `photo-check`, `verified-check`, `suggestions-check` and
  `membership-journey-check` unchanged and green.
- On the Android test phone, with pictures: a search with results, with none, with too many; a
  host's page with and without a photo, available now and not, as a member, as an invited
  person, signed out.

## Keeping the 4.9%

The page shows a price and leads to booking a one-to-one call. Memberships are behind their
switch. No project box, no "contribute", no tip, and the share link is a profile.

## Astra's check (20 November 2026): "ready with changes", worked in

1. *"A hidden, unapproved or closed host is not found" was wrong:* members and invited people
   can open more, and a blocked pair can still open a page. "What is there today", decision 1.
2. *`/photo` is the upload; photos are read from `/host-photos/[id]`.* Corrected.
3. *Missing from the page:* confirmed social links, Report, "verified customers only", the
   cancellation wording, the choice of length, the two kinds of "nothing to book", the member
   and invitation states, search's limits, and looking without an account. Added.
4. *Saving choices the website's way would erase the diary choice.* Decision 4.
