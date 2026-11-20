# Phone apps, part 05: search, a host's page, following

**Status:** built, 20 November 2026 (see `docs/module-record.md`). Written that day by the
builder alone. Part of plan 45. Astra checked the plan once ("ready with changes"; the list is at
the end) and the code (the list is before it). What the building changed or added is under "What the building changed"; where that
list and a decision differ, the list is what was built.

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

## What the building changed (20 November 2026)

1. **The putting-together of a host's page now lives in `src/lib/profiles/host-page.ts`,** and
   the website's page and the app's address both call it. The website's page asks for the
   project box; the app's address never does, and then nothing of a project is read. The page's
   own sentences that both show (the price, the cancellation wording, "is not taking calls",
   the lengths with their prices, the membership lines) are in one place each.
2. **No account's number leaves the server.** The website's page hands the host's number to
   its Follow button; the app follows and unfollows by the page's name instead. Unfollowing a
   name that does not exist is answered exactly like one that does.
3. **The choices about emails have their address here** (decision 4), and it never touches the
   diary choice. **Their screen**, the list of followed hosts with its ticks and hours, is part
   17's, as on the website, where they are on the list and not on a host's page.
4. **Someone not signed in** gets "Look for a host first" on the first screen: the search, and
   from it any host's page, without an account.
5. **Memberships on the page follow the apps' switch** (decision 5): off, nothing about a
   membership is sent; "use only", a member's time and times are sent, an invitation is not
   (accepting one takes a monthly payment).
6. **What does not lead on yet,** each wired in by the part that builds it: choosing a time
   (part 06), "available now" (part 11), a membership's screens (part 13), "Confirm your ID"
   (part 14b), "Report" (part 09). The times are shown to read. "Share this page" works.
7. **On the home page, a followed host and a suggested host now lead to her page,** and
   opening a suggested host's page is told to the server, as on the website.
8. **Screens opened from another have a "Back" at the top.**

**Not tried here:** `verified-check` (it needs the test host to have payouts set up with
Stripe, which the checking database does not have), `photo-check` and
`membership-journey-check` (they talk to the shared server). `follow-check`,
`suggestions-check`, `journey-check` and `home-check` ran against the checking database
and pass.

## Astra's check of the code (20 November 2026): "not ready", now worked in

It found the website's page unchanged by the move, the search the same as the website's, and
nothing of a project, no account's number and no way of paying in any answer. Two points it
called "must", four smaller ones; all taken.

1. *Two answers told whether a host's name exists, hidden hosts too:* unfollowing, and saving
   the email choices. (The automatic security review of the saved code found the first as
   well.) Both are now answered to the letter the same whether or not there is such a host.
2. *"Available now" could stay on a host's page long after she had left:* the page was read
   once and never again. While it is in front it is now read again every minute and on coming
   back to the app, and the server says for how long "available now" may be believed (a
   minute and a half); past that the words are taken away until the server says so again.
3. *One host's page could stay on the screen while another's was loading in its place.* Each
   host has a screen of her own.
4. *With memberships switched off for the apps, a member could still open a hidden host's
   page; and with "use only", a month whose money is only held still showed times to book,*
   though the first booking of such a month takes the payment. Off: nobody is a member there.
   Use only: such a month shows no times.
5. *Several checks proved less than their labels said.* Rewritten; the switches for the apps
   and a confirmed social account are now in the check.
6. *On the night the clocks go back, two different times of a day read the same.* Each is then
   written with its time zone.

**Still not in the check:** a member whose month can be booked from (making such a month needs
Stripe). Part 13 builds memberships in the app and checks it there.

## Astra's check of the plan (20 November 2026): "ready with changes", worked in

1. *"A hidden, unapproved or closed host is not found" was wrong:* members and invited people
   can open more, and a blocked pair can still open a page. "What is there today", decision 1.
2. *`/photo` is the upload; photos are read from `/host-photos/[id]`.* Corrected.
3. *Missing from the page:* confirmed social links, Report, "verified customers only", the
   cancellation wording, the choice of length, the two kinds of "nothing to book", the member
   and invitation states, search's limits, and looking without an account. Added.
4. *Saving choices the website's way would erase the diary choice.* Decision 4.
