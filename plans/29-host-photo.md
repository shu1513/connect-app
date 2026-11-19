# Plan 29: A host's photo, taken from their Instagram or TikTok

**Status:** a plan only; nothing is built. Written 19 November 2026 by the builder alone (no
helper agents), from the code as it is on `main` after pull request 48, and from what Meta really
answered that day. Astra checked the plan twice ("ready with changes" both times); what it found
is worked in, and listed at the end.

## For the founder: what this is

Today a host's page shows a circle with the first letter of their name. This puts a real photo
there, and beside each host in the "Find a host" results (the founder, 19 November 2026): the
profile picture of a social media account the host has confirmed.

Hosts never upload a photo. On the Hosting page there is a new part, **"Your photo"**:

- **"Use my Instagram photo"**, when the host has a confirmed Instagram account.
- **"Use my TikTok photo"**, when the host has a confirmed TikTok account (part two, see below).
- Once there is a photo: the photo itself, where it came from, **"Update"** (fetch it again, for
  a host who has changed their picture) and **"Remove"**.

**The founder's two questions (19 November 2026), answered:**

1. *Can the host choose between Instagram and TikTok?* **Yes.** One button for each account that
   can give a photo. The host has one photo at a time: the last one they chose. Nothing happens
   by itself; a host who presses nothing keeps the letter.
2. *Do we even need to save the photo?* **Yes, a small copy.** The link Meta gives to a picture
   stops working. Seen for real on 19 November: the link for the founder's own account carried
   an end date four and a half days ahead. A host's page that only pointed at Meta's link would
   show a broken picture within a week. So Connect fetches the picture once, makes its own copy
   (as it does for diary pictures), and shows that.

## Said plainly: how the two networks differ

- **Instagram needs no second sign-in.** Connect can read the profile picture of a Creator or
  Business account by its name, with the key it already uses to read bios. It does not need
  "Connect your Instagram": an account confirmed with the code in the bio works just the same.
  It still depends on Meta answering, and Meta does not show every account this way (a personal
  account, or one Meta has limited by age, gives nothing).
- **TikTok only works at the moment the host signs in at TikTok.** Connect keeps no key from
  TikTok after a sign-in, so later it has no way to ask TikTok for a picture. "Use my TikTok
  photo" therefore sends the host through TikTok's sign-in once more, and "Update" does the
  same. And TikTok's sign-in is not open to real hosts yet (it waits for TikTok's approval of
  the live site, plan 18). So at launch the photo will in practice come from Instagram.
- YouTube could give a channel's picture just as easily as Instagram. It is not in this plan;
  it can be added later with little work.

**Two pull requests:** part one, Instagram; part two, TikTok.

## What Meta really answered (19 November 2026, read-only requests with the key the app has)

For three accounts, asked by name for `id`, `username` and `profile_picture_url`:

- All three came back with all three fields.
- The pictures were JPEGs of 729, 1,080 and 400 points on each side, 8 to 74 KB, all on servers
  whose name ends in `.fbcdn.net`, by https.
- **The number Meta gives here is the same number the sign-in gives.** For the founder's own
  account both are 17841401929457335 (the sign-in's answer is in plan 28). So a photo can be
  tied to the account by its number, not only by its name. (Seen for one account. It is the only
  account for which Connect has both numbers.)

## The rules

1. **Only from a confirmed account of that host.** The photo is fetched for the account that is
   confirmed on the host's page, and remembered with that account's name and number. If that
   account is later removed from the page or replaced by another, the photo goes in the same
   step. The exact rule is under "Which account a photo belongs to".
2. **Checked before anyone sees it,** by the same outside services, in the same order, as a diary
   picture (plan 24). It is shown only when one of them has looked at all of it and found
   nothing. If a service flags it, it is not kept and the host is told: "That photo was not
   accepted." If no service can answer (none is set up, all are used up, one has a fault),
   nothing is kept and the host is told to try again in a few minutes. A host photo is **never**
   shown after only Connect's own checker has looked (that checker only looks for nudity), which
   a diary picture can be for a while.
3. **A photo that was refused stays refused.** Connect remembers the fingerprint of its copy (not
   the picture). The same picture from the same host is refused at once the next time, without
   asking a service again. The same goes for a picture that is the same as one of that host's
   diary pictures that was refused, or removed and reported.
4. **The old photo stays until the new one has passed.** "Update" that fails changes nothing.
5. **Five tries in any 24 hours for each host,** and one at a time. A try counts from the moment
   it starts, however it ends.
6. **Who sees it.**
   - The page is open to everyone (approved, not hidden, account not closed): everyone, on the
     host's page and in the "Find a host" results. (The results only ever list such hosts.)
   - The page is hidden, waiting, declined or suspended: only the host and the founder. A member
     or an invited person, who can open a hidden page, sees the letter there.
   - A paused account: as its page. (Today a paused host's page stays open and the host is left
     out of the search results; the photo follows both.)
   - A closed account: the photo is deleted (rule 9).
7. **The founder can remove a host's photo,** on the admin page for people. The host sees that
   their photo is gone and can choose one again.
8. **"Remove and report", as for a diary picture** (plan 23, "What the law asks"). For a photo
   the founder suspects of showing child abuse: it is taken out of sight for everyone, kept
   exactly as it is, and nothing deletes it afterwards: not the host, not a changed or removed
   account, not closing the account. The host's page and confirmed accounts as they were at that
   moment are kept with it (as a locked diary picture keeps its post), since the host can change
   them afterwards. The page records when the founder made the report. While a host has such a
   photo, they can take no other. (Said plainly, as for the diary: a photo the
   host removes or replaces before the founder has pressed this is gone.)
9. **When an account is closed, its photo is deleted.** Opening the account again does not bring
   it back.

## Which account a photo belongs to

A photo remembers the network, the account's name, and the number Meta gave for the account in
the same answer as the picture.

- **Taking one.** Meta's answer must be about the name asked for, as for a bio. When the host's
  confirmed entry has a number (proven by signing in), Meta's number must be that number: a name
  that now belongs to another account gives no photo.
- **Keeping one.** The photo stays while the host has a confirmed entry on that network that is
  the same account: by number when the entry has one, otherwise by name. So an account renamed
  and proven again by signing in keeps its photo; an entry confirmed with the code that is later
  proven by signing in keeps its photo if the sign-in brings the same number, and loses it if
  it brings another; typing another name, removing the account, or a sign-in that brings a
  different account all remove the photo in the same step.
- **The honest limit:** an entry confirmed with the code proves a name, not a number. For such
  an entry the photo is tied to the name, as the confirmation itself is.

## What is kept

Connect's own copy of the picture (a JPEG, made as a diary picture's copy is, with nothing hidden
in the file), which network and account it came from, when, and which service passed it. Every
try keeps one line: who, when, from which network, how it ended, and, when a copy was made, the
copy's fingerprint. The picture of a try that failed is not kept.

**The privacy page** says: when you choose a photo from Instagram or TikTok, we fetch your public
profile picture, send our copy of it to the checking services the page already names, and keep
our copy until you remove it (a photo that had to be removed and reported is kept as long as the
law asks). The same is said beside the button, before the host presses it. In part two, the
page's sentence about TikTok ("the account's number and name, nothing else") is rewritten: it
then also says that the picture's address is read at a sign-in, and that the picture is fetched
and kept only when the host asked for the photo.

**A report of a host's page** now says which photo was showing (its id; the picture is not
copied, so one the host removes or replaces afterwards is gone, as with a diary picture). A
photo that is shown is never sent to a checking service again, so nothing needs to hold it back
from them while a report is open.

**For the lawyer and for Meta's review, later:** Connect keeps a copy of a host's profile picture
at the host's own request. Meta's terms for reading a profile this way should be read with that
use in mind before the app is reviewed.

## The child-safety tool, said plainly

The tool against known pictures of child abuse is not set up (plan 23: applied for, switched on
when approved), so no picture is compared with that list today, a diary picture no more than a
host photo. What does not wait for the tool is in rule 8: the founder can remove and report a
photo, and it is then kept.

**Before that tool is switched on, host photos have to be brought under it.** This is a step of
switching the tool on, and it is written where that happens (a note at `childTool()` in
`child-safety.ts`, and in "Open" below). It is done when all of this is true:

- a new host photo waits for the tool's answer before a checking service is asked and before
  anyone can fetch it;
- the photos that are there from before that day are put through the tool;
- a match keeps the exact picture, takes it out of sight, and tells the founder, as "Remove and
  report" does;
- removing, replacing and closing never delete a picture the tool still has to see.

The diary's queue only reads diary pictures. It does not find host photos by itself.

## How it is built

### Part one: Instagram

**Database (one migration):**

- `host_photos`: the photo's own id (used in its address; a new photo gets a new id, so an old
  address stops working), the host, the network, the account's name and number, the copy's bytes
  with its size, width, height and fingerprint, when it was taken, which service passed it by
  which version of the rules, and for "Remove and report": when, by whom, and when the report
  was made, and what belonged to it then. The database allows one photo that is not locked for
  each host. Every list reads the facts without the bytes; only `photoFor` reads the bytes.
- `host_photo_tries`: one line for each try: the host, the network, when it started, the name
  and number of the confirmed entry at that moment, how it ended (empty while it runs), the
  copy's fingerprint, and which service answered.

**`src/lib/profiles/photo.ts` (new). One press is three steps:**

1. **Start,** one short database step under a lock for that host, then with the person's and
   the profile's locks, in the app's order, and last (for Instagram) the lock that already
   guards everyone's requests to Instagram, which is so held only for a few reads. Everything that removes a photo or changes an account
   holds those two locks as well, so it either sees this try and stops it, or has finished
   before the try is written. Read with the locks held: the account is neither closed nor
   paused and has a host profile; the host has no locked photo; there is a confirmed entry on
   that network; no other try of this host started in the last two minutes and is still
   running (an older one that never ended is marked as stopped); fewer than five tries in the
   last 24 hours; the hour's limit for Instagram (below); a checking service is set up; and no
   diary picture is owed its full check (below). Then the try is written down, with the
   entry's name and number. Each "no" has its own sentence for the host and writes no try.
2. **The outside work,** with no database step held open: Meta is asked; the picture is fetched;
   Connect's copy is made; the fingerprint is compared with what was refused before (rule 3);
   the services are asked in their order (`askInOrder` with no own checker; only "shown after a
   full check" counts). Before each service is asked, the try is read again: if it was stopped
   meanwhile, or a diary picture has come to be owed its full check, nobody is sent the picture.
   (Both are asked in one read, right before the request. A request that is already on its way
   cannot be called back.) A service's refusal is written to the try before anything else, so
   that nothing that fails afterwards can lose it. What each service's answer means for the service
   itself (its five minutes, the founder's email about a fault) is written down whatever becomes
   of the try.
3. **Finish,** one short database step with the person's and the profile's locks, in the app's
   order. The photo is written only if all of this is still true: the try is still running
   (nothing stopped it); the account is neither closed nor paused; the confirmed entry on that
   network still has the name and the number it had at the start; the host has no locked photo.
   Then the old photo is deleted and the new one written, in that one step. A refusal by a
   service is always written to the try, with the fingerprint, also when the try was stopped.

**What stops a running try:** the host's "Remove", the founder's "Remove" and "Remove and
report", closing the account, and every step that changes the confirmed account the try started
from (removing it, typing another name, a sign-in that brings another account or another name).
Step 3 compares the account once more by itself; the stopping is what catches an account that
was changed and changed back in between. So an answer that comes late never brings a photo back.
Every try that fails in an ordinary way is ended at once with how it failed. The two minutes are
for a try whose server stopped under it, or whose last line could not be written because the
database could not be reached: such a try counts as stopped at the host's next press, two
minutes or more after it started. Whether the account may do this (not closed, not
paused) is asked at the start and at the finish; a pause that was lifted again in between stops
nothing.

**Diary pictures first.** A diary picture that is shown after a check for nudity only is owed
a service's next answers (plan 23). "Owed" means what the queue would really send: not a picture
the founder or a report holds back. While one is owed, no photo try starts, and a try that is
under way sends its picture to no service. (This orders the requests Connect sends. It cannot
order the answers of two requests that are already on their way.)

**Instagram's hour.** A photo try does not start when bio checks and photo tries on Instagram
together, for everyone, have reached the bio check's own hourly limit (100). The bio check
itself still counts only bio checks. So the two together can reach 200 starts in an hour at
most, which is what the code already assumes Meta allows; Meta's real allowance was not looked
up.

**Other functions there:** `removePhoto`, `removePhotoAsFounder`, `lockPhotoAsFounder`,
`recordPhotoReportMade` (the founder's three name the very photo the founder was looking at, so a
photo that has replaced it since is not touched), `photoFor(viewer, id)` (the only function that hands out the bytes,
with whether the answer may be kept by a browser), `photoOf(hostId)` and `photosOf(hostIds)`
(the id only, for a page or the search results that has already decided the host is public).
The founder's three are written to the record of the founder's actions in the same step.

**`src/lib/profiles/photo-steps.ts` (new, small):** `dropPhotoIfSourceGone(tx, userId)`, the rule
of "Keeping one" above together with the stopping of tries whose account changed, and
`deletePhotoInStep` and `stopTriesInStep`. It is called inside the existing database step,
after the write, of everything that changes a confirmed account: typing another name
(`addSocialName`), removing an account (`removeSocialName`), and the one write both sign-ins use
(`writeConfirmed`). Closing an account calls `deletePhotoInStep` in its own step. A locked photo
is never touched by either. (The founder's "not found" for a code only acts on entries that are
not confirmed, so it needs nothing.)

**Asking Instagram** (`bio-check.ts` already asks Meta for a bio by name): the same request with
`id` and `profile_picture_url` instead of the bio, read by its own small function. It keeps the
bio reader's five results apart: a picture, no such account (or one Meta does not show us), asked
too often, our own key refused, anything else. A refused key is written down for the founder's
page, under a name of its own, as a refused sign-in is.

**Fetching the picture safely:** the address must be `https`, with no name and password in it
and no port, on a server whose name ends in `.fbcdn.net` at a full stop (the only servers seen).
The request carries no key and no cookie, follows no redirect, must answer 200, and has eight
seconds in all, reading included. It is read piece by piece and dropped past 5 MB. `makeCopy`
then does what it does for an upload: the kind of file by its first bytes and again as decoded,
no moving picture, the limit on points, at least 100 points on each side, a fresh JPEG. The
address is never shown, stored or logged. (If Meta ever names another server, the try ends as
"could not be fetched" and only the last two parts of that server's name are logged.)

**One picture is opened at a time, for the whole server.** Fetching and copying a host photo
takes the same one place a diary upload takes (`takePlace` in `pictures.ts`), gives it back in
every case before a checking service is asked, and tells the host to try again in a moment when
it is taken. The place is kept on the server's one shared object, not in a file: the framework
builds one copy of a file for pages and their actions and another for addresses like the
upload's (read in its own guide, and seen in what it had built), and each copy would otherwise
have a place of its own. As for the diary, this counts for each running copy of the server.

**The checking services:** `askInOrder` (`checks/order.ts`) is used as it is. Three small pieces
of `queue.ts` move into a new `src/lib/projects/checks/services.ts`, which the queue and the
photo both use: the list of services, the turns built from it (a failing checker is a fault,
whether a service's five minutes are running is read when its turn comes), and `recordAnswers`.
Claiming a picture, writing its result, the waiting times and the child-safety step stay in
`queue.ts`. Its checks (`scripts/project-check.ts`) must pass unchanged.

**`src/app/host-photos/[id]/route.ts` (new):** the photo as a plain JPEG, with the same headers
as a diary picture, the same single "not found", and the founder counted only with the second
login step. `photoFor` decides afresh for every request. Only an answer anyone could get without
logging in may be kept by the viewer's own browser, for five minutes; so a removed photo can
still show for up to five minutes in a browser that had it, as a diary picture can.

**Pages:**

- The Hosting page: "Your photo", with the buttons and the sentence about checking. Every
  action checks on the server that the person is logged in and not paused, takes the host from
  the login and never from the form, and checks the network's name.
- The host's page: the photo in place of the letter, when the page is open to everyone and
  there is one.
- "Find a host" (`searchHosts` and `src/app/search/page.tsx`): a small round photo beside each
  host who has one, the letter in a circle for the others, so the list lines up. The ids are
  read for all results in one request; who is found, and in which order, does not change.
- The admin page for people: the photo beside a profile, with "Remove photo" and "Remove and
  report"; for a locked one, when it was locked and "I have made the report".
- The privacy page.

Photos are plain `<img>` tags pointing at Connect's own address, as diary pictures are; the
site's picture resizing stays switched off.

### Part two: TikTok

- At a sign-in, TikTok is also asked for the account's large picture address, in the same
  request that asks for its name (the permission "basic", which is already asked for; TikTok's
  own page lists the picture under it). A missing picture never makes an ordinary "Connect your
  TikTok" fail.
- "Use my TikTok photo" starts the same sign-in, with a mark inside the signed note Connect
  keeps for the way back (never a plain value in the address) that says "this is for the photo",
  together with the number of the try that was started.
- **A sign-in for the photo never changes the entry at all.** It must come back with the account
  that is confirmed on the host's page: the same number, or, for an entry that has no number
  yet, the same name. The entry is left exactly as it was (an entry without a number does not
  gain one here; that is what "Connect your TikTok" is for), so the try's own comparison at the
  finish still holds. A different account changes nothing, and the host is told to press
  "Connect your TikTok" if they want to change their account. So "the old photo stays until the
  new one has passed" also holds here.
- The picture then goes the same way as an Instagram one, from step 2.
- The picture servers TikTok really uses are read from a real answer before the list of
  allowed addresses is written.
- It needs its own real try in TikTok's test mode, with the founder's TikTok account.

## How it is checked

- **Unit tests:** the allowed addresses (a look-alike server name, a port, a name and password,
  http); reading Meta's answer (another name, no number, no picture, each kind of error); the
  rule of which account a photo belongs to.
- **`scripts/photo-check.ts` (new),** with Meta, the picture and the services pretended. It is a
  script of its own, not a part of `accounts-check.ts`: like the diary's script it has to set
  the lines about the checking services, and put them back as they were.
  - a photo is taken, shown on the host's page and in the "Find a host" results, and fetched;
    the old address stops working after an update;
  - each way a try can end: no picture, another account's number, a picture that is too small,
    moving, or not a picture, too large, a redirect, a slow answer, a flag, a flag with parts
    missing, no service set up, every service out, a fault (nobody else asked), a checker that
    throws;
  - the old photo survives a failed update; the same refused picture is refused again without
    a service being asked, also after "Remove" and on another day; a picture refused in the
    host's diary is refused as a photo;
  - the sixth try in 24 hours; two presses at the same moment; a try that never ended;
  - while a try is under way: the account is removed, replaced, renamed by sign-in, or replaced
    and confirmed again; the host removes the photo; the founder removes it; the account is
    closed or paused. None of them lets the late answer write a photo. A press waits while
    another step holds the host's locks;
  - the photo goes when its account is removed or replaced (also a same-name account with
    another number), stays through a rename by sign-in and when a code-confirmed entry gains
    the same number;
  - who can fetch it: nobody logged in, the host, another person, the founder without and with
    the second login step, for an open, a hidden and a suspended page; a member on a hidden page
    gets the letter;
  - the founder removes it; "Remove and report" keeps it through removal of the account and
    through closing, hands it to nobody, and stops a new photo; closing deletes an ordinary one
    and reopening does not bring it back;
  - what a service's answer to a photo means for the diary's queue and the other way round: its
    five minutes, a fault's email sent once; a photo try refused while a diary picture is owed
    its full check, not held up by one the founder holds, and sent to no service when one comes
    to be owed meanwhile.
- **`scripts/project-check.ts`** unchanged and passing: the queue behaves as before.
- **Every other check script,** once more.
- **The real try,** on this computer: the test host's confirmed Instagram account, the real
  request to Meta, a real checking service. Then in the browser, phone-sized and wide.
- Astra reviews the code; then CodeRabbit.

## Left out on purpose

- Uploading a photo. (That is the point.)
- Fetching a newer photo by itself. The host presses "Update".
- The photo on call pages, booking pages and in emails. First the host's own page and the
  "Find a host" results.
- YouTube and X as sources.
- Showing a photo after only Connect's own checker has looked.
- "Hold as suspected" for a photo. The founder has "Remove" and "Remove and report"; a photo
  taken out of sight for a while and then put back is not worth a third state.
- A smaller second copy for the search results. One copy, shown small.

## Open, and whose it is

- Before the child-safety tool is switched on: bring host photos under it (the list above).
- The lawyer and Meta's review: keeping a copy of a profile picture at the host's request.

## Astra's check of this plan (19 November 2026): "ready with changes"

Each point was checked against the code by the builder before it was taken.

**Had to change, all taken:**

1. *What "under a lock" and "reads the account again" mean.* Now three steps (start, outside
   work, finish), with what stops a running try and what the finish compares. No database step
   is held open while Meta or a service is asked.
2. *Which account a photo belongs to.* Its own section; the number Meta gives was compared with
   the sign-in's for real.
3. *Many photos opened at once.* The one place a diary upload takes is shared.
4. *A refused photo could be tried again for a better answer.* Rule 3.
5. *"Remove" destroyed a suspected photo.* Rule 8, "Remove and report".
6. *TikTok: a sign-in for the photo could replace the account and lose the old photo.* A
   sign-in for the photo never changes the account.

**Should change, taken:** the narrow piece moved out of the queue, with checks across the two
users of it; diary pictures waiting for their full check come before a photo; the rule of who
sees a photo written out, with paused, declined and suspended; what "bring host photos under the
tool" means; the longer list of checks; the privacy text and the sentence beside the button;
Meta's failures kept apart and Instagram's hourly limit shared; who may press what.

**Not taken:** `*.cdninstagram.com` in the allowed servers (never seen; left out until it is);
"Hold as suspected" (see "Left out").

## Astra's second check (19 November 2026): "ready with changes"

It found the main shape right and nothing over-built. Four things had to change, all taken:

1. *An account changed and changed back during a try, and a "Remove" that slips in between a
   try's start and its being written down.* Every step that changes the account stops the tries
   that started from it, and the start takes the person's and the profile's locks.
2. *TikTok: an entry gaining its number during a sign-in for the photo would fail the try's own
   comparison.* A sign-in for the photo leaves the entry as it was.
3. *"No photo while a diary picture is owed its full check" could block every host for ever on
   a picture the founder holds, and did not look again later.* It now asks what the queue would
   really send, and asks again before each service.
4. *A locked photo kept nothing of the page around it.* The host's page and confirmed accounts
   are kept with it.

Also taken: the hourly limit described as what it is; the founder's buttons act on the very
photo that was shown; a pause lifted in between; the privacy wording; a report of a page says
which photo was showing; the one place kept on the server's shared object (Astra read the
framework's guide and found two built copies of the file).

## The real try (19 November 2026)

On this computer, as the test host, whose Instagram entry was confirmed by signing in at Meta
earlier that day:

- **"Use my Instagram photo":** the real request to Meta, the real fetch from a server ending in
  `.fbcdn.net`, the real check by OpenAI. "Shown" after 3.3 seconds. The copy is 729 by 729
  points, 55 KB. Meta's number for the account in this answer is the number the sign-in gave, so
  the comparison of the two was made on real numbers.
- **"Update":** a new photo with a new address.
- **The host's page and "Find a host":** the photo in place of the letter, phone-sized (375
  points wide, nothing wider than the screen) and wide.
- **The founder's page:** the photo is listed with where it came from. "Remove and report"
  without the tick changed nothing and said so. "Remove" deleted the photo, the host's page
  showed the letter again, and the record of the founder's actions has the line.

Not seen for real: a personal account, an account Meta does not show, a picture a service
refuses, and "Remove and report" with the tick (it cannot be undone; the script checks it).

