# Plan 35: Uploading a photo, for hosts and for customers

**Status:** both parts are built: part one (hosts, pull request 62) and part two (customers).
Each was tried for real on 19 November 2026 (see `docs/module-record.md`). Written 19 November
2026 by the builder alone (no helper agents), from the code as it is on `main` after pull
request 58, and from what the founder said that day. Astra checked it once ("ready with changes"); every point was read against the code by
the builder and is worked in below (the list is at the end).

## For the founder: what this is

Today a host's photo can only be the profile picture of their confirmed Instagram or TikTok
account (plans 29 and 33). A host with a personal Instagram account gets nothing from Meta, and
TikTok's sign-in is not open to real hosts yet. Those hosts keep the circle with a letter.
Customers have no photo at all.

After this change:

- **A host can upload a photo** from their phone or computer, as a third choice beside "Use my
  Instagram photo" and "Use my TikTok photo".
- **A customer can upload a photo** on their Account page. It is optional.
- **Every uploaded photo is checked by an outside service before anyone sees it,** exactly as a
  photo from Instagram is today.

## What the founder said (19 November 2026)

"Should we allow hosts to upload photos other than Instagram or TikTok?" and "Customers also can
upload photos yes? I think that would be good." Then: "Yes, plan both."

This turns round one line of plan 29, which left uploading out on purpose ("That is the point"):
a picture from a confirmed account is the one fans already know. The founder now chooses reach
over that: more hosts with a face on their page.

## Decisions (the builder's; the founder can change any of them)

1. **One photo for each account, not one for hosting and one for booking.** A person who is a
   host and also books other hosts has the same photo in both places. **Said plainly, what
   that gives away:** today a host who books another host is shown there under their own name,
   and that they are a host too is theirs to tell. With one photo, the host they ask sees their
   host photo beside the request, before accepting, and could recognise them from "Find a
   host". The Hosting page says so beside the photo. Two photos for one person would avoid it
   and is not worth building for this rare case; the app has no real hosts yet, so nobody's
   existing photo is put to a use they did not choose.
2. **Who sees a customer's photo: only hosts that customer has really asked for a call.** It is
   never open to everyone, and customers never see each other's. The rule is the one that
   already decides whether a host may keep a note about a customer (plan 32), made a little
   stricter: the customer sent that host a request, or booked a call with them as a member and
   the call was really made; neither has blocked the other; and the customer's account is not
   closed. The customer and the founder see it too.
3. **A host's photo is shown as today,** whichever way it came: to everyone while their page is
   open to everyone, otherwise only to the host and the founder. On top of that comes rule 2,
   for a host who books another host.
4. **The page does not say where a photo came from.** No "from Instagram" mark beside it. The
   proof of who a host is stays what it is today: the ID check and the confirmed accounts shown
   on their page. (The host's own Hosting page and the founder's page do say where it came
   from.)
5. **A customer's photo proves nothing, and the app never says it does.** "ID confirmed" stays
   the only sign that Connect has checked who a customer is.
6. **No cropping tool.** Connect keeps a square cut from the middle of the picture, at most 512
   points on each side, and shows it in a circle. A smaller picture is not blown up: its square
   is as large as its shorter side, and the smallest allowed stays 100 points. The words beside
   the button say so: "The middle of your picture is shown, in a circle."
7. **Limits:** one photo at a time, and five tries in any 24 hours, counted together with tries
   from Instagram and TikTok (both as today). An uploaded file can be up to 10 MB, as for a
   diary picture; JPEG, PNG or WebP; no moving pictures. (Fetching from Instagram and TikTok
   keeps its own limit of 5 MB.)
8. **An uploaded photo belongs to no social account.** Removing or changing a confirmed account
   does not remove it. (A photo taken from Instagram or TikTok still goes with its account, as
   today.)
9. **Where a host sees a customer's photo:** on the list of requests, on the "Available now"
   page, and on the page of one request or booking. A small circle beside the name; the letter
   when the customer has no photo. Not on the call screen (the video is there), not in emails.
10. **Customers keep their photo if they become a host later.** It is then shown on their public
    page once that page is open to everyone. The Account page says so before they upload.

## The rules (plan 29's rules all apply; these are what changes or is new)

1. **Checked before anyone sees it.** An outside service must look at all of Connect's copy and
   find nothing. If a service flags it: "That photo was not accepted", and nothing is kept but
   the fingerprint. If no service can answer: nothing is kept, and the person is told to try
   again in a few minutes. Never shown after only Connect's own checker has looked.
2. **A refused picture stays refused,** by the fingerprint of Connect's copy, for that person.
   This also covers a picture of theirs that was refused or locked in a diary. A diary keeps
   the whole picture and a photo keeps a square, so their fingerprints differ. For an upload
   Connect therefore makes the diary's kind of copy as well, only to compare its fingerprint
   with the person's diary pictures; that second copy is not kept.
3. **The old photo stays until the new one has passed.** The exception of plan 29 stays: if a
   service refuses the very picture that is the person's photo now, that photo is taken down.
4. **Diary pictures first,** as today: no upload is sent to a service while a diary picture is
   owed its full check.
5. **Who can upload:** a person who is logged in, whose account is neither closed nor paused, and
   who has no photo that was removed and reported. No host profile and no confirmed account are
   needed.
6. **Only Connect's copy is kept.** The file as it arrived is never kept, checked or shown. The
   copy has nothing of what was hidden in the file (the place, the camera).
7. **The founder can remove any photo, and "Remove and report" works for any photo,** a
   customer's as a host's. The admin page lists customers' photos too.
8. **Closing an account deletes its photo,** as today. The code already does this for every
   account, not only for hosts.
9. **A report of a person from a call or a request says which photo they had** (its id), as a
   report of a host's page does today.

## Said plainly: what this does not protect against

- **A photo of someone else.** Nothing compares an uploaded face with anyone. A host could
  upload a famous person's picture. The founder approves every host's page, sees every photo on
  the admin page, and can remove one. That is the whole protection.
- **The child-safety tool is still not set up** (plan 23). Until now, host photos came from
  Instagram and TikTok, which check pictures themselves. An uploaded photo comes straight from a
  person's device, as a diary picture already does. The outside checking services look for
  sexual content and violence, but no picture is compared with the list of known pictures of
  child abuse. The founder decided for the diary that uploads go ahead without the tool; this
  plan follows that decision. The step "bring photos under the tool before it is switched on"
  (plan 29) now covers uploaded photos and customers' photos as well.
- **A customer's photo, once seen, has been seen.** A host who was asked can keep seeing the
  photo until the customer removes it, blocks the host, or closes the account. (A person who is
  also a host with a page open to everyone has a public photo: a block does not hide that one.)

## Two pull requests

- **Part one: hosts.** The upload itself, on the Hosting page.
- **Part two: customers.** The Account page, who sees a customer's photo, and where.

## How it is built

### Part one: a host uploads a photo

**Database (one migration, number 0044, for both parts):**

- `host_photos`: the source can now be `upload` beside `instagram` and `tiktok`. The account's
  name and number may be empty, and the database allows that only for an upload.
- `host_photo_tries`: the same: `upload` as a source, and the entry's name may be empty only for
  an upload.
- The two tables keep their names, although they will also hold customers' photos. Renaming
  them would touch every file for nothing a person sees. The comments in the code say what they
  hold.

**`src/lib/profiles/photo.ts`:**

- The step "fetch the picture" becomes "get the original": for Instagram and TikTok it fetches
  from the network's server as today; for an upload it reads the file out of the request. The
  rest of that path is untouched: one picture opened at a time, Connect's copy, the fingerprint
  compared with what was refused before, the services in their order, the refusal written
  first, the finish under the person's and the profile's locks.
- `uploadPhoto({ userId, read })`, the whole press for an upload, in the same three steps
  (`read` hands over the file, and is called only after the start has said yes):
  1. **Start.** The same locks. It says "no" for: a closed or paused account; in part one, no
     host profile; a locked photo; another try still running; five tries in 24 hours; no
     checking service; a diary picture owed its check. It does not ask for a confirmed account,
     and does not take Instagram's lock. Then the try is written, with `upload` as its source.
  2. **The outside work.** The request's body is read and the copy made while this server's one
     place for pictures is held; the place is given back before any service is asked. A body
     that is too large, too slow, not one file, or not a picture ends the try with words for
     the person.
  3. **Finish.** Written only if the try is still running, the account is neither closed nor
     paused, and no photo was locked meanwhile. No account is compared: there is none.
- The copy for an upload is a square cut from the middle, at most 512 points on each side and
  never enlarged (`makeCopy` gets one option for this; a diary picture and a network photo are
  copied as before, and the smallest side and the largest size in bytes are checked as before).
  So what is checked is exactly what is kept, and a photo is small enough to show in a list.
- "Refused before" for an upload compares two fingerprints: the square's, with the person's
  earlier photo tries; and that of the diary's kind of copy of the same file, made in the same
  hold of the place and thrown away, with the person's diary pictures (refused or locked).
- The account's name and number can now be empty in the database, so everything that reads
  them is brought along in the same change: the candidate of a try, the founder's decision,
  the two lists (`OwnPhoto`, `AdminPhoto`) and `sameAccount`. A photo from a network still must
  have both; nothing writes an empty text in their place.

**`src/lib/profiles/photo-words.ts`:** the sentences for an upload. "Your profile picture"
becomes "your picture", and nothing in them speaks of an account.

**`src/lib/profiles/photo-steps.ts`:** `dropPhotoIfSourceGone` leaves an uploaded photo and a
running upload alone. Everything else there already works for any person.

**`src/app/photo/route.ts` (new):** the address a photo is uploaded to. An upload does not fit
into the app's ordinary forms (1 MB), so it has its own address, built like the diary's
(`host/project/posts/[id]/pictures/route.ts`), in this order:

1. Only from Connect's own page (`fromThisSite`).
2. A logged-in person; a paused one is sent to `/paused`.
3. A file form that does not say it is larger than 10 MB plus the form around it.
4. `uploadPhoto`. Nothing of the body is read before the start has said yes.
5. The browser is sent back with one sentence: to the Hosting page for a person with a host
   profile, otherwise (part two) to the Account page. Where to go is decided on the server,
   never taken from the form.

The code that reads a request piece by piece and stops when it is too large or too slow
(`readWithin`) moves out of the diary's route into a small shared file, and both routes use it.

**The Hosting page, "Your photo":**

- A file field and **"Upload a photo"**, always there for a host with a profile. It no longer
  depends on a confirmed account, so the sentence "Confirm an Instagram account first" goes;
  the Instagram and TikTok buttons stay for hosts who have such an account.
- The words above the buttons say what happens to an upload: Connect makes its own copy, cuts
  the middle square, has it checked, and keeps it until the host removes it.
- From part two on, one more sentence, for every photo whatever its source: "When you ask
  another host for a call, they see this photo beside your name."
- A photo that was uploaded reads "Uploaded" with the day and time, in place of "From Instagram
  @name". "Remove" as today.

**The founder's page for people:** an uploaded photo reads "Uploaded" in place of the network
and the account's name. Nothing else changes in part one.

**The privacy page:** one more sentence in the part about a host's photo: a host can also upload
a picture; Connect keeps only its own copy, a square from the middle, checked in the same way,
until the host removes it or the account is closed.

**The rules page:** one sentence: the rules for pictures apply to a person's photo too.

### Part two: a customer uploads a photo

**`src/lib/profiles/photo.ts`:**

- The start no longer asks for a host profile when the source is an upload.
- `photoFor(viewer, id)` gets one more "yes". The whole rule is then:

  | The photo's owner | A visitor | A host the owner has asked | The owner | The founder |
  |---|---|---|---|---|
  | has a host page open to everyone | yes | yes | yes | yes |
  | anyone else (a customer; a host whose page is hidden, waiting, declined or suspended) | no | yes | yes | yes |
  | the photo is locked | no | no | no | no |

  "A host the owner has asked" is the rule of plan 32 (`mayNote` in `contacts.ts`), given a
  name both can use: the owner really sent this viewer a request (not one left at the card
  step, not a test call), neither has blocked the other, and the owner's account is not closed.
  **One thing is made stricter, for notes and photos alike:** a member's booking counts only
  once its call exists. Today such a booking is written down, with its time, before the month's
  payment has gone through (`saveAsPaying` in `membership/book.ts`), and the host cannot see it
  until the call is made. A booking the host cannot see gives them no photo and no note. The
  rule is asked afresh for every request for the photo. Only the first row of the table may be
  kept by a browser (five minutes, as today); every other answer says "do not keep".

**The Account page, a new part "Your photo":**

- For a person without a host profile: the circle, a file field, **"Upload a photo"**, and
  "Remove" when there is one. The words: "Hosts you ask for a call see your photo beside your
  name. Nobody else does. If you become a host, it is shown on your public page. The middle of
  your picture is shown, in a circle. We make our own copy and have it checked automatically
  before anyone sees it; for the check, our copy is sent to a checking service, without your
  name."
- "Remove" here is an action of the Account page's own, which comes back to the Account page.
  The sentence after a good upload is a customer's own too: "Your photo passed the check and is
  saved. Hosts you ask for a call see it beside your name." (The host's sentence speaks of
  their page and the search results.)
- For a person with a host profile: one line, "Your photo is on your Hosting page", with a link.
- A person whose photo was removed and reported sees what a host sees today: it was removed by
  Connect, and they cannot choose another.

**Where a host sees it** (the circle of `HostPhoto`, which already shows the letter when a photo
cannot be fetched):

- `host/requests`: beside each customer's name.
- `host/now`: beside each request. The list sent to that page gains the photo's id;
  `scripts/verified-check.ts`, which compares that list's exact fields, is brought up to date.
- `bookings/[id]`, for the host.

Each page looks the ids up with `photosForHost`, which asks the rule for each customer, so a
page is never told the id of a photo its host is not handed (Astra's point on the code: with a
plain lookup, a host who was blocked could have seen when the customer changed their photo).
The photo's own address decides again when the picture is fetched.

**The founder's page for people:** the list "Photos" shows every photo, with the person's name;
"(not a host)" for a person without a host profile. "Remove", "Remove and report" and "I have
made the report" work as they do now. What is kept with a locked photo already takes a person
without a host profile.

**Reports:** a report made from a call or a request also keeps the id of the reported person's
photo, when they have one. The founder's page of reports says "They had a photo when they were
reported", with what has become of it, as for a host's page.

**The privacy page:** a new paragraph for everyone's photo: who sees a customer's photo, that
Connect keeps only its own copy, how long, and that a refused picture leaves only a fingerprint.

## How it is checked

- **Unit tests:** the square copy (a wide, a tall and a small picture; a see-through PNG; a
  moving one); `dropPhotoIfSourceGone` with an uploaded photo; the rule of who gets a photo.
- **`scripts/photo-check.ts`, new journeys,** with the services pretended:
  - a host uploads a photo: shown on their page and in the search results; an upload replaces
    an Instagram photo only once it has passed; removing the Instagram account leaves an
    uploaded photo and removes an Instagram one;
  - each way an upload can end: too large, too slow, not a picture, two files, a moving
    picture, a flag, no service, every service out, the sixth try, two uploads at once, another
    website's request;
  - a start that says "no" reads nothing of the request's body;
  - a refused upload is refused again without a service being asked; a picture refused in the
    diary is refused as a photo, tried with one real file that is not square, sent through both
    ways (not with a fingerprint written in by hand);
  - while an upload is under way: the person removes their photo; the founder removes it, or
    removes and reports it; the account is closed or paused; a confirmed account is changed
    (which must not stop an upload); a try from Instagram is pressed at the same moment; a
    service's refusal arrives late. None lets a late answer write a photo it should not;
  - part two: a customer uploads; who can fetch it (nobody logged in, another customer, a host
    who was not asked, a host who was asked, the same host after a block either way, after the
    customer closes their account, the founder without and with the second login step); for a
    member's booking: while it waits for its payment, after the payment failed, once the call
    is made, and after that call was cancelled; an answer that is not open to everyone says "do
    not keep"; it shows on the three host pages; a customer who gets a host profile sees it on
    the Hosting page, and it becomes open only with the page;
  - the founder removes a customer's photo; "Remove and report" keeps it and stops a new one;
  - a report from a call and from a request keeps the id of the right person's photo.
- **`scripts/project-check.ts`:** unchanged and passing, since the diary's route now reads its
  request through the shared file.
- **Every other check script,** once more, taking turns with the other sessions on the shared
  database.
- **The real try,** on this computer, for each part: a real picture from a phone, a real
  checking service, in the browser at phone size and wide.
- Astra reviews the code of each part; then CodeRabbit.

## Left out on purpose

- A cropping tool, and choosing which part of the picture is shown.
- A mark that says where a photo came from.
- The host's photo on the customer's own pages (their bookings, the hosts they follow, emails).
- A customer's photo on the home page's list of calls, the contacts page, the list of members,
  the call screen and in emails.
- Comparing a photo with the ID check's selfie.
- A second, smaller copy for lists. One copy of 512 points.
- Renaming the tables and the address `/host-photos/`.

## Open, and whose it is

- **The founder:** the ten decisions above, above all number 1 (one photo, and what it gives
  away), number 2 (who sees a customer's photo) and number 4 (no mark for where a photo came
  from).
- **The lawyer:** the privacy page's new words; keeping a customer's photo at all.
- Before the child-safety tool is switched on: bring every photo under it (plan 29's list, now
  with uploads and customers).

## Astra's check of this plan (19 November 2026): "ready with changes"

Each point was checked against the code by the builder before it was taken.

**Had to change, all taken:**

1. *A square photo and a whole diary picture never have the same fingerprint,* so "a picture
   refused in the diary is refused as a photo" would have stopped working for uploads without
   anyone noticing (`copy.ts`, `refusedBefore` in `photo.ts`). Now the upload also makes the
   diary's kind of copy, only to compare, and the check uses one real file through both ways.
2. *The notes rule lets in a member's booking that is still waiting for its payment*
   (`saveAsPaying` in `membership/book.ts` writes the time before the payment; the booking's
   page already hides such a booking from the host). The shared rule now asks for the call.
3. *"The photo tells nothing the call does not" was wrong:* a request shows the photo before
   the host accepts, and a host photo ties a customer to their host page, which the app keeps
   apart today (`contacts.ts`). The decision stays, said plainly, with a sentence on the
   Hosting page.
4. *An empty name and number break the code that reads them as text* (`photo.ts`,
   `photo-rules.ts`). Those readers are now named in part one.
5. *The checks only tried the races through Instagram's button.* The list now runs an upload
   through each of them, and checks "do not keep", the founder's second login step, that a
   refused start reads no body, and the photo's id in reports.

**Worth considering, all taken:** which size limit is whose (10 MB for an upload, 5 MB for a
fetch); a picture smaller than 512 points is not enlarged; the customer's own "Remove" and
sentences; "never kept by a browser" holds for photos that are not open to everyone. Astra also
said to keep the two pull requests and the tables' names.
