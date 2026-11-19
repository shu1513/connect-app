# Plan 24: Projects, part one: the project and its diary

**Status:** built. 1a is pull request 43; what building 1b changed is at the end ("What building
1b added to this plan"). The plan itself was written 18 November 2026 by the builder alone (no
helper agents), from the code as it is on `main` after pull request 41. Astra checked it twice.
Both verdicts were "ready with changes"; after the second, 1a can be built as it stands and the
corrections for 1b are worked in below (the two lists are at the end).

**The rulebook is `plans/23-projects.md`.** This plan builds its part one ("The three parts").
It states no rule of its own. Where it has to choose something the rulebook leaves open (a
threshold, an address, a table), the choice is listed under "The builder's choices in this part".

## For the founder: what this part is

Part one is the project without any money. When it is merged:

- a host can start a project, write diary posts with text, YouTube links and pictures, edit them,
  remove them, and end the project;
- anyone can read the diary on the host's page;
- every picture is made into Connect's own copy and goes through the checking queue;
- anyone signed in can report a post, and the founder has a page to decide about pictures and
  posts, with "Remove and report";
- the founder has the switch.

Nobody can contribute yet. That, and the amounts a host suggests, are part two.

**Two pull requests:**

1. **1a, the project and its posts.** Text and YouTube links only. The host's pages, the public
   diary, reports of posts, the switch, the founder's page (posts and projects).
2. **1b, pictures.** Uploading, Connect's copy, the store, the queue of checkers, the address
   pictures are fetched from, the founder's decisions, "Remove and report".

**The founder's decision of 18 November 2026:** pictures do not wait for the tool against
pictures of child abuse (Image Intercept). They go live with the checking queue, and the tool is
switched on when it is approved. "Remove and report" stays. The rulebook says so now, and this
plan follows it. The rule lives in one small file (`child-safety.ts`, below), which the upload,
the queue and the founder's "Show" all ask.

## What it relies on (each read in the code by the builder)

- **How a page changes something.** A form posts to a function in an `actions.ts` beside the page
  (`"use server"`), which calls the library and ends with `redirect(withNotice(path, text))`
  (`src/app/report/actions.ts:11`). The new pages are built the same way and need no script in the
  browser.
- **A form sent to a server function may be 1 MB at most, everything in it counted** (the
  framework's own limit, `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/serverActions.md:59`).
  Raising it would raise it for every such form in the app. So a picture is uploaded to an address
  of its own (a route), guarded the way the app's other small addresses are: `fromThisSite`
  (`src/lib/same-site.ts:20`), which stops another website from sending the upload through a
  logged-in person's browser, and the full gate for an active user.
- **Who may see a host's page:** `publicProfile(handle)` (`src/lib/profiles/profiles.ts:221`)
  returns nothing for a page that is not approved, is hidden, or whose account is closed. The
  diary asks the same function, so it disappears and comes back with the host's page. It does not
  look at a pause; a paused host's page stays up today, and so does her diary.
- **Who may write:** `requireActiveUser` (`src/lib/session.ts:85`): logged in, email confirmed,
  terms accepted, not paused. The founder: `requireAdmin` (`:105`), which includes the second
  login step.
- **Reports:** `createReport` (`src/lib/safety/reports.ts:67`) finds the reported person from
  where the report was made (`reportedPersonFor`, `:36`: a call, a request or a profile), limits a
  person to 10 reports a day, queues an email to every admin for an urgent reason, and then blocks
  the reported person (`:102`). The report page takes the place from the address
  (`src/app/report/page.tsx:17`), the sentence after sending promises "you will not hear from this
  person through Connect again" (`src/app/report/actions.ts:25`), and the founder's page draws
  what was saved with the report (`src/app/admin/reports/page.tsx:116`).
- **The founder's switch for memberships:** three words in `site_switches`, read strictly
  (`src/lib/safety/switches.ts:15`), with the form on the reports page
  (`src/app/admin/reports/page.tsx:255`).
- **The always-on helper** runs several loops beside each other, each caught on its own
  (`worker/closer.ts:163`). They share one process, so heavy work in one can still slow the
  others; that is why the open-source checker gets a thread of its own.
- **Closing an account deletes nothing a person wrote** (`src/lib/profiles/closing.ts:23`: it
  marks the account closed, suspends the page and ends the logins), and no cleaning job touches
  tables like the new ones.
- **Pictures:** nobody can upload a picture anywhere in the app today. `sharp`, the library that
  reads and writes pictures, is on the machine only because the framework brings it along; it is
  not among the app's own packages (`package.json`).
- **The rules of the site already say "No nudity"** (`src/lib/terms.ts:13`). The thresholds below
  are set to that.

## The builder's choices in this part

| # | Question | Chosen | Why |
| --- | --- | --- | --- |
| 1 | Where the host's project pages live | A page of its own, `/host/project`, with a short part "Your project" on Hosting that links to it. A post is edited on `/host/project/posts/[id]`. | Hosting is already a long page. |
| 2 | The diary's address | `/h/[handle]/project` shows the running project, or the one that ended last when none is running. `/h/[handle]/project/[id]` shows exactly that project, and only if it belongs to the host in the address. | "The diary stays readable at its address", also after she starts a new one. |
| 3 | How a picture is added | One at a time, on the post's own page, with a plain form. The post exists first; pictures are added to it. | No script needed, and a failed upload loses one picture, not a whole post. |
| 4 | The form Connect's copy takes | Always JPEG, at a quality that keeps it under 1 MB. A see-through picture gets a white background. | Every browser shows it and each of the four checkers takes it. One form means one thing to test. |
| 5 | Where the checking runs | In the always-on helper, in a loop of its own. The upload only stores the picture as "waiting". The host sees "Being checked", usually for a few seconds. | The web pages never wait for an outside service, and the keys are used in one place. |
| 6 | How the open-source checker runs | NSFWJS 4.3.0 (MIT, with its model built in) with TensorFlow's WASM engine and only the small "MobileNetV2" model, inside one thread of its own in the helper. The thread starts the first time it is needed and stops after ten idle minutes. | Tried on this machine on 18 November 2026, outside a thread: 50 ms a picture after 140 ms to load, about 250 MB of memory, nothing to compile. (The plain engine took 680 ms a picture; the larger model 290 ms and 650 MB.) A thread keeps the helper's loops moving; it does not give the picture work memory or a processor of its own, so it does one picture at a time. The numbers are measured again in the thread when 1b is built. |
| 7 | The thresholds | Starting values, see "The four checkers". The real try shows whether each service answers in the shape the plan expects and how the starting values behave on a small set of harmless and borderline pictures; what comes out is written into the record. It is not a proof that the checkers are equally strict. | No checker's numbers mean the same as another's. |
| 8 | Paging | Ten posts a page, newest first, with "Older posts". | Simple, and no long page of pictures. |
| 9 | One picture is worked on at a time | Uploads are read, and Connect's copy made, one after the other. An upload that would have to wait more than a few seconds is told "Please try again in a moment". | A phone photo of 50 million points takes about 200 MB while it is open. One at a time is a limit the server can keep. |

**One line added to the rulebook with this plan** (it was missing there): what the founder's
switch means for the diary. While it is off for a host, she cannot start a project, write or
change a post, or upload. What she has written stays readable. She can still remove a post or a
picture and end her project, and the founder can still decide, hide and lock.

## The tables (one migration for 1a, one for 1b)

**`projects`** (1a): the host, the name, the description, running or ended, when it started and
ended, and who ended it. The database itself allows one running project per host. (The host's
suggested amounts are money and come with part two's migration.)

**`project_posts`** (1a): the project, the text, up to three YouTube links, when it was written
and changed; removed by the host (with the moment), or hidden by the founder (with the moment,
who, and a note).

**`project_pictures`** (1b): the post, the host, its place in the post, width, height, size, a
fingerprint of the exact bytes, the moment of upload, and where it stands:

| State | Meaning |
| --- | --- |
| `waiting` | Stored; no answer that counts yet. |
| `shown` | Passed (see `level`: `full` or `nudity_only`). |
| `flagged` | A checker flagged it. Waits for the founder. |
| `removed` | Removed by the host or the founder. Nobody can fetch it from that moment. The bytes are deleted at once, or as soon as a check that is still out has come back; the line stays, with what the checkers said, so the day's count and the rule for uploading again stay true. |
| `locked` | "Remove and report". The bytes and everything about the picture are kept and never deleted. |

With it:

- the child-safety check's outcome: `not_set_up`, `waiting`, `clear` or `match`;
- two marks for "suspected", kept apart: one the founder sets and only the founder lifts, and one
  that is on while a report with the reason "someone under 18" is open on its post. Closing the
  report never lifts the founder's mark;
- which checker gave the answer that counts (`openai`, `azure`, `sightengine`, `own`, `founder`),
  the level of that answer, the version of the plan's rules it was judged by, and what it looked
  at and found, as text;
- **a claim and a counter**, so that only one check of a picture runs at a time and an old answer
  can never overwrite a newer decision (see "Never two answers for one picture");
- how often it was tried and when it is tried next;
- for a locked picture: when, by whom, when the report was made, and the post as it was then.

**`project_picture_files`** (1b): the picture's id and its bytes, and nothing else. Kept apart so
that no list of posts or pictures can fetch bytes by accident.

Nothing in these tables deletes along with something else: removing a project, a post or an
account never removes a picture's line.

**`picture_checkers`** (1b): one line for each service: when it last gave a complete, valid
answer with the key it has now, until when it counts as out, and since when it has a fault.

**`site_switches`** (1a): two more columns, `projects` ("off", "named", "everyone"; on for
everyone unless the founder says otherwise) and `projects_hosts`. With 1b a third: the moment the
child-safety tool first answered correctly. From that moment the tool counts as switched on,
whether or not its settings are still there.

**`reports`** (1a): no new column. A report can now come from a post: `context` "post".

## The library: `src/lib/projects/`

**`rules.ts`: plain rules, no database, tested.**

- The limits: name 80, description 1,000, text 5,000, three links, four pictures a post, 20 a
  day, 10 MB in, 1 MB and 1,600 pixels out.
- `youtubeLink(text)`: gives back a clean `https://www.youtube.com/watch?v=...` or
  `https://youtu.be/...` address, or nothing. Only `youtube.com`, `www.youtube.com`,
  `m.youtube.com` and `youtu.be`, only `https`, and only a video's or a channel's address.
- `decide(answers)`: the heart of the queue, as one plain function. It takes what each checker
  answered and gives back what happens to the picture (see "How the queue decides").

**`projects.ts`, `posts.ts`** (1a): start, change and end a project; write, change and remove a
post; the lists a page shows. Every function that writes takes the host's id from the login, never
from the form, and checks that the project or post is hers.

- `startProject` checks on the server what the rulebook asks: her page is approved and her payout
  account is ready.
- `runningProjectOf(hostId)` is the one way to find a host's running project.
- `endProject` is the one way a project ends. Part two adds to this same function what ending
  does to contributions, in the same step.
- `projectsOnFor(hostId)` sits beside `membershipsOnFor` in `switches.ts`.

**`child-safety.ts`** (1b): the one place that knows the rule for the child-safety check. Four
questions, asked by the upload, the queue, the founder's "Show" and the picture's address:

- `mayUpload()`: may pictures be uploaded at all? Yes, with or without the tool (the founder's
  decision).
- `mayGoOn(picture)`: may this picture go to the everyday checkers, or be shown by the founder?
  Never when it carries either "suspected" mark or is a `match`. Before the tool is switched on, a
  picture is marked `not_set_up` at upload and goes on. From the moment the tool is switched on
  (the moment kept in `site_switches`), every picture uploaded goes on only when the tool's answer
  is `clear`, and keeps waiting for that answer even if the tool's settings later go missing.
- `mayBeFetched(picture)`: a picture uploaded after the tool was switched on, and that it has not
  answered for, is handed to nobody, not to the host and not to the founder. The picture's
  address asks this before its own table. A picture from before the switch-on (`not_set_up`) is
  not held back by this.
- **Pictures from before the switch-on** (the rulebook's "Pictures from before that day"): they
  keep the state they have. A job of the helper asks the tool about each of them, the oldest
  first, a few in each round, and writes `clear` or `match` in place of `not_set_up`. A match
  locks the picture at once. The job only takes pictures whose bytes are still kept. A picture
  that was removed before the switch-on has no bytes left to ask about; its line keeps
  `not_set_up`, which then only says the tool never saw it. The job is done when no picture
  that still has its bytes is marked `not_set_up`.
- `ask(picture)`: asks the tool. Its answers are kept apart: not set up, could not be reached,
  clear, match.

If the rule changes again, only this file changes.

**`pictures.ts`** (1b): `acceptUpload`, `pictureFor`, `removePicture`, and the founder's
`showPicture`, `removePictureAsFounder`, `lockAndReport`, `recordReportMade`. Each is described in
its own section below.

**`checks/`** (1b): one small file for each checker, all with the same shape: they are given the
bytes of Connect's copy (never an address to fetch it from) and give back exactly one of four
answers.

| Answer | Meaning | What the queue does |
| --- | --- | --- |
| `clean` | It looked for everything it must look for, every result was there and valid, and it found nothing. | The picture is shown. |
| `flagged` | It found something. A flag counts even if another part of the answer is missing. | Hidden, to the founder. No other checker is asked. |
| `out` | The service is used up, too busy, cannot be reached, or did not answer in 10 seconds. | The next checker is asked. |
| `fault` | The answer was broken or incomplete, the key was refused, or the service could not read the picture. | The picture waits and is tried again later, as the rulebook says. A fault is never read as "out". The fault is recorded and shown on the founder's page, and the founder is emailed at once when a service first has one, then once a day while it lasts. |

A checker without a key is not part of the queue.

## The four checkers

The exact requests are taken from each service's current guide when 1b is built, and each is tried
once by hand with real pictures before the pull request is opened.

| Checker | Settings | `clean` only when | `flagged` when (starting values) |
| --- | --- | --- | --- |
| OpenAI, model `omni-moderation-latest` | `OPENAI_API_KEY` | the answer says, for each of sexual, violence, graphic violence, self-harm, self-harm intent and self-harm instructions, that the check was applied to the *image*, and holds a valid result for each | the service marks any of those as flagged |
| Microsoft, asked for Sexual, Violence and SelfHarm on its four-level scale | `AZURE_CONTENT_SAFETY_ENDPOINT`, `AZURE_CONTENT_SAFETY_KEY` | the answer holds an entry by name for each of the three, with a level of 0, 2, 4 or 6 (never read by position; a missing entry is not zero) | Sexual at 2 or above (the site's rule is "no nudity", and level 2 is where Microsoft puts mild and artistic nudity); Violence or SelfHarm at 4 or above |
| Sightengine, models `nudity-2.1`, `gore-2.0`, `violence`, `self-harm` (two counts a picture) | `SIGHTENGINE_USER`, `SIGHTENGINE_SECRET` | the answer says "success" and holds each model's own result | sexual activity, sexual display or erotica above 0.5; gore, violence or self-harm above 0.5 |
| Connect's own | none | all five of its classes are there with valid numbers (it only looks for nudity) | "Porn" plus "Hentai" at 0.5 or more, or "Sexy" at 0.8 or more |

`out` is what each service says with its own code for "too many" (429), a server error (5xx), no
connection, or no answer in 10 seconds. A service that was out is not asked for new pictures for
five minutes, and counts as `out` for every try in that time. The first time it is asked again, it
is asked for a picture that is waiting for its full check, if there is one.

**A fault that lasts holds every picture,** and that is meant: a wrong key at the first service is
a fault, not an outage. The way out is the founder's: put the right key in, or take that
service's key out of the settings, which takes it out of the queue. The founder's page says so
beside the fault.

The stricter level for nudity will sometimes flag a harmless picture, a beach photo for example.
It then waits for the founder's "Show". That is the side the site's rules ask for.

## How the queue decides

For each waiting picture, the oldest first:

1. **The child-safety rule** (`child-safety.ts`). A match locks the picture at once and emails the
   founder; nothing else is asked. A picture that may not go on waits.
2. **The three services, in order.** `clean` or `flagged` ends it. `out` moves to the next.
   `fault` ends this try: the picture waits.
3. **Connect's own checker, only when all of this is true:** at least one service has given a
   complete, valid answer with the key it has now (`picture_checkers`); and every service with a
   key is `out` in this try, just answered or still in its five minutes. The first condition is
   asked of the services together: a service that has a key, has never yet answered, and cannot
   be reached counts as `out` like the others, as long as another one has worked. Found nothing: shown, marked `nudity_only`. Found nudity: `flagged`. If the own checker
   itself fails or takes too long, the picture waits.
4. **Otherwise the picture waits** and is tried again: after 1 minute, then 5, then every 15.

Pictures marked `nudity_only` come first in every round: each is sent to the services again.
`clean` makes it `full`. `flagged` hides it at once. `out` or `fault` leaves it as it is, shown
and still marked `nudity_only`, and the fault is recorded.

**A picture she uploads again.** If the copy is byte for byte the same as one of her pictures
that a checker flagged, also one she has removed since, the new one is flagged at once and no
checker is asked, unless the founder has shown that picture in the meantime. If it is the same as
a locked one, the new one is locked in the full sense: its post is hidden and kept as it is, and
the founder is emailed. An upload is not a second try at a clean answer. It still counts for the
day.

**Never two answers for one picture.** Before a picture is checked, the round claims it: it
writes its own mark and a time limit on the picture's line. A second round leaves a claimed
picture alone until the time limit has passed; after that the picture can be claimed afresh, so a
round that died holds nothing up. An everyday checker's answer is written only if the mark is
still that round's, the time limit has not passed, and the picture's counter has not moved. Every
decision by the founder or the host moves the counter, and so does a "suspected" mark going on or
off. So an everyday answer that comes back late, after the founder decided or after the host
removed the picture, changes nothing.

**The one exception: a match from the child-safety tool always counts,** however late, for the
exact bytes it was asked about. It locks the picture, whatever happened in between.

**Removing while a check is out.** The picture disappears for everyone at once. Its bytes are
deleted when no claim on it is still running. Once the child-safety tool is switched on, the
bytes of a picture it has not answered for are kept until it has, also across a round that died:
the check is asked again like any other, and only its answer frees the bytes or locks them.

**The founder is told by email** when a picture is flagged (at most one email an hour, with the
count), when the first picture is shown as `nudity_only`, once a day while any is, and once a day
for each service with a fault.

## Making Connect's copy (`acceptUpload`)

1. The upload must be one of her posts' and within the limits: counted under a lock for the host
   (20 in the last 24 hours, every upload counted, also a flagged, removed or replaced one) and
   again under a lock for the post (four pictures, the post not removed, hidden or locked). These
   counts are made at the moment the picture is stored, so uploads sent together cannot slip
   past. The heavy work below happens before that moment, not inside it.
2. **The kind of file is read from its first bytes,** never from its name or from what the
   browser says: JPEG, PNG or WebP. Everything else is refused with "Please use a JPEG, PNG or
   WebP picture", including a phone's HEIC, and SVG, GIF and AVIF.
3. **A picture that moves is refused:** a WebP with more than one frame, and a PNG that carries
   the mark of an animated one.
4. `sharp` opens it with its own limit of 50 million points, so a file that unpacks into something
   enormous is refused before it is unpacked. A file that cannot be read, or whose kind turns out
   different from its first bytes, is refused.
5. It is turned the right way up, shrunk to at most 1,600 pixels, given a white background where
   it is see-through, and written as a JPEG in standard colours. The file's own colour
   description is used for that step and then left out, like everything else hidden in the file.
   Quality 82; if the result is over 1 MB, 70, then 60; refused if it still is.
6. Nothing of the original file is kept.

## Uploading a picture

`POST /host/project/posts/[id]/pictures` (a route). The post is named in the address, so
everything that can be checked is checked before anything is read. It refuses, in this order:

1. a request that did not come from Connect's own page (`fromThisSite`);
2. someone who does not pass the full gate for an active user;
3. the switch off for her (and `mayUpload`, which says yes today);
4. a post that is not hers, is removed, hidden or locked, or already has four pictures;
5. anything that is not a file form, or that says it is larger than 10 MB plus 64 KB for the
   form around the file;
6. another upload already being worked on (choice 9). The place is held from the first byte read
   until Connect's copy is made, and given back whatever happens. A second upload is told to try
   again; it is not kept waiting in memory. (This counts for each running copy of the web server;
   with more than one, the hosting needs memory for one picture each.)

Then it reads the request itself, piece by piece, and stops the moment it has more than that
size, whatever the request said about its length, or after 30 seconds. Only what was read within
the limit is taken apart: exactly one file, itself no more than 10 MB, and no other fields. Then
`acceptUpload`. It runs on
the server's ordinary Node engine and ends by sending the browser back to the post's page with a
sentence (answer 303).

## Showing a picture

Pictures are fetched from `/pictures/[id]`, as the plain file: nothing in between makes or keeps
another copy. `pictureFor` is the only function that hands out bytes, and this is the whole rule:

| The picture | Visitor | The host herself | The founder (admin login) |
| --- | --- | --- | --- |
| `shown`, its post up, her page open, the project hers | yes | yes | yes |
| `shown`, but its post is hidden by Connect or her page is not open | no | yes | yes |
| any picture of a post she has removed | no | no | yes, while its bytes are kept |
| `waiting` or `flagged`, its post not removed | no | yes | yes |
| `removed` | no | no | no (there are no bytes) |
| `locked` | no | no | no |

The rows are read from the top, and `mayBeFetched` in `child-safety.ts` is asked before any of
them. A locked picture is shown by nothing in the app. It is kept for the authorities; if they ask for
it, the builder takes it out of the database by hand.

Every "no" is the same "not found". The answer always says it is a JPEG, tells the browser not to
guess otherwise, and allows nothing to run. Only an answer in the first row, to someone who could
see the picture without being logged in, may be kept: by the visitor's own browser, for five
minutes, and by nobody in between. Every other answer, and every "not found", is not kept at all.
The address never answers "you already have it": it sends the picture or nothing, so every fetch
is checked afresh.

The box on the host's page and the diary use the same lists as each other, so a hidden or removed
post appears in neither.

## Reports of a post

- The report page takes `?post=<id>` and says, for a post: "Tell us what is wrong with this post.
  Only our team reads this." It does not say that reporting blocks, because for a post it does not.
- `reportedPersonFor` learns "post": the post must be one the reporter can see; the reported
  person is the host; nobody reports their own post. The report keeps the post's text and links
  and the ids of its pictures as they were.
- `createReport` blocks only when the report is about a person (a call, a request or a profile).
- The sentence after sending is, for a post: "Thank you. Your report is R-…. We will look at it."
- The founder's reports page shows a report about a post with the saved text and links (so the
  founder sees what was written even if the host has changed or removed it since), its pictures
  where they are still kept, and a link to that post on the projects page. A picture the host
  has removed is gone; an ordinary report does not keep it.
- A report with the reason "someone under 18" puts the report's "suspected" mark on the post's
  pictures while it is open. Reading any other report, the founder can set the founder's own mark
  by hand.
- The diary page names the support address for someone who has no account.

## The founder's page: `/admin/projects`

- **Pictures to decide:** every `flagged` picture, with what the checker found. **Show**
  (`founder`, `full`), **Remove**, **Hold as suspected**, or **Remove and report**.
- **Checked for nudity only:** the list, with how long each has waited.
- **Waiting:** pictures no checker has answered for, with **Show** by hand where
  `child-safety.ts` allows it.
- **Posts:** hide and show a post, with a note. The host sees "Hidden by Connect".
- **Locked pictures:** when each was locked, and **"I have made the report"**, with a box for the
  day and time the report was really made. The page states the steps the lawyer gives.
- **Every project,** with its host, state and number of posts.
- **The switch,** in the same form as the one for memberships.

Every decision is written to the founder's record of actions (`recordAdminAction`).

**What "locked" protects.** Locking is one step that also hides the post and keeps the post as it
was then, with the checkers' answers. After it:

- neither the host's "Remove" nor the founder's ordinary "Remove" works on that picture;
- the post cannot be changed, removed or shown again;
- ending the project and closing the account leave it alone, and nothing deletes it with
  something else.

## The pages

| Page | What is new |
| --- | --- |
| Hosting (`/host`) | A part "Your project": start one, or its name with a link to `/host/project`. |
| `/host/project` | Start; change the name and description; the posts with their state; "Write a post"; "End this project" behind a tick box. |
| `/host/project/posts/[id]` | The text, the three link boxes, the pictures with their state ("Being checked", "Shown", "Waiting for a check by Connect", "Hidden by Connect"), "Add a picture", "Remove". |
| `/h/[handle]` | A box: the project's name, the first lines of the latest post, "Read the diary". |
| `/h/[handle]/project`, `/h/[handle]/project/[id]` | The diary: name, description, posts, pictures, YouTube links, "Report" on each post, "This project has ended" when it has. |
| `/report` | Takes a post. |
| `/admin/projects` | As above. A link on `/admin`. |
| The rules page | A line on what a diary may show. |
| The privacy page | Names the checking companies, and says pictures are sent to them without the host's name. |

Before a host uploads her first picture the page says: "Connect makes its own copy of your
picture and checks it automatically before anyone else can see it. The copy is usually sent to an
outside checking service for that."

## The open-source checker's thread

- One thread, one picture at a time; other pictures wait their turn in the queue.
- It reads the JPEG and prepares it inside the thread, so none of that work is done in the
  helper's own loops.
- A time limit for starting (30 seconds) and for one picture (10 seconds). If it fails to start,
  stops by itself or runs over, the picture waits and the thread is started fresh next time.
- What it needs is loaded from the app's own files, never from the internet, and it is checked at
  the start that the WASM engine is really the one in use.
- It is started from a small plain file that loads the checker's code, so that it starts the same
  way when the helper runs under `tsx` and when it is built.
- Only the helper loads these packages. No page ever does.

## The settings

`OPENAI_API_KEY`, `AZURE_CONTENT_SAFETY_ENDPOINT`, `AZURE_CONTENT_SAFETY_KEY`,
`SIGHTENGINE_USER`, `SIGHTENGINE_SECRET`, and the child-safety tool's own, named when its guide is
in hand. The founder puts them into the settings file; the builder never sees them. New packages:
`sharp` (as the app's own), `nsfwjs`, `@tensorflow/tfjs`, `@tensorflow/tfjs-backend-wasm`, with
their versions fixed.

## How it is checked

- **Tests of the plain rules:** the edges of each limit, `youtubeLink`, and `decide` with every
  case the rulebook names: a flag stops the queue; a flag with a missing part still counts; `out`
  moves on; a `fault` makes the picture wait and never leads to the own checker; no key at all; a
  service that never answered correctly; nothing answering; a `nudity_only` picture with each
  answer.
- **Tests of each checker's reading of an answer,** with saved example answers: a missing check,
  a number that is not a number, a missing violence result, a refused key.
- **Tests with pictures made in the test:** a photo with a place written into it comes out
  without it; a sideways photo comes out upright; a photo in a printer's colours and one in a
  wide-colour profile come out in standard colours; a huge one, an animated WebP, an animated
  PNG, a broken file and a file that only claims to be a picture are refused; the copy is never
  over 1 MB or 1,600 pixels.
- **`scripts/project-check.ts`**, one script, extended in 1b, against the local database, with
  stand-in checkers whose answers the script controls:
  - the whole life of a project and its posts, the gate for starting, and the switch;
  - uploads: a request without a stated length, one that lies about it, one a little over the
    limit, two files in one form, and five uploads to one post sent at the same moment;
  - the daily limit with uploads sent at the same moment;
  - the queue from "waiting" to each outcome, and the nudity-only pictures going first;
  - two rounds at once; a time limit followed by a late answer; the founder deciding during a
    check; a removal racing with a lock; the same picture uploaded again after a flag;
  - who gets a picture at its address in every row of the table above, also right after logging
    out;
  - the founder's decisions, and that nothing removes or shows a locked picture;
  - switching the child-safety tool on with pictures already there: they stay as they were, each
    gets its answer afterwards, and a match among them is locked; a picture removed before that
    day is left alone, and the job still comes to its end;
  - one service that has worked and one that never has, both out: the own checker may pass a
    picture; no service that has ever worked: it may not;
  - reports of a post: what is saved, the sentence, and no block.
- **The open-source checker for real:** in its thread, with the network switched off, a hundred
  pictures in a row (memory does not grow), a failed start, and a fresh start after idling.
- **The real try,** by hand, once the founder has made the accounts: each service with a few
  harmless and borderline pictures, and its answer when the key is wrong. No script ever calls an
  outside service by itself.
- **In the browser:** the host's pages and the diary, on a phone-sized and a wide window.
- Astra reviews each of the two pull requests, then CodeRabbit.

## Done when

- A host can run a project and its diary end to end, and every rule of the rulebook's "How it
  works for a host" that is not about money holds. (Her suggested amounts come with part two.)
- No picture can be fetched by anyone who may not see it, in any state.
- The queue behaves as the rulebook's "Pictures" says in every case the tests name.
- The founder can decide every flagged picture, hide every post, and lock and report.
- All earlier check scripts still pass.

## Astra's check (18 November 2026): "ready with changes"

| # | Astra's point | What was done |
| --- | --- | --- |
| 1 | The plan let a broken answer move on to the next service; the rulebook says the picture waits. An empty list of services must never count as "all out". | Taken: `fault` waits. The own checker needs at least one service that has worked before. |
| 2 | Sightengine was not asked for violence, only gore; each service's "looked at everything" test was too loose; Microsoft's level 4 would let mild nudity through, against the site's "no nudity". | Taken: "The four checkers". Sexual is flagged from level 2. |
| 3 | Comparing only the picture's state does not stop an old answer from overwriting a new decision. | Taken: "Never two answers for one picture", and the same picture uploaded again. |
| 4 | The child-safety question was spread over five places, and a picture could skip the check if the tool's settings went missing. Suspicion from a report or the founder must also keep a picture from the everyday checkers. | Taken: `child-safety.ts`, and `suspected`. |
| 5 | A 10 MB file does not fit in a 10 MB request; the upload must be cut off while reading, not measured afterwards; the post belongs in the address; the four-picture limit must be counted at the moment of storing. | Taken: "Uploading a picture" and step 1 of "Making Connect's copy". |
| 6 | The picture work needed precision: the kind of file from its bytes, animated PNGs, the limit set on the reader itself, colours. | Taken: "Making Connect's copy". One picture at a time (choice 9), because of the memory a large photo needs. |
| 7 | The table of states, the address and the founder's page disagreed about who sees what. | Taken: one table in "Showing a picture". |
| 8 | "Locked" was a promise, not yet a design. | Taken: "What locked protects"; the time of the report is typed in, not taken from the click. |
| 9 | The sentence after a report still promised a block, and the founder's page could not draw a post. | Taken: "Reports of a post". |
| 10 | A thread does not make heavy work harmless, and needs time limits and a sure way to start. | Taken: "The open-source checker's thread"; the wording of choice 6. |
| 11 | The gate for starting (approved page, payouts ready) was missing; the suggested amounts were in no part; the switch's meaning for the diary was a rule made here. | Taken: `startProject`; the amounts named as part two's; the switch added to the rulebook. |
| 12 | Wrong or too strong sentences under "What it relies on". | Taken. |
| 13 | The checks missed the real failure points. | Taken: "How it is checked". |

Not taken: nothing. Astra asked for no new machinery, and said plainly what not to add: no file
store, no separate queue service, no general framework for checking, no money tables in this part.

## Astra's second look (18 November 2026): "ready with changes; 1a can start"

Astra found no blocker left for 1a, and five corrections for 1b, all taken:

| Astra's point | What was done |
| --- | --- |
| "A late answer changes nothing" and "a late child-safety match still locks" contradicted each other; a round that died could hold a removed picture's bytes for ever, or free them too soon. | The exception is stated; a claim has a time limit; a child-safety check that has not answered keeps the bytes until it has. |
| A flagged picture, removed and uploaded again, escaped the rule; copying "locked" is not the same as locking. | The checker's verdict stays on a removed picture's line; the same bytes are flagged again; a locked match is locked in full. |
| The tool could count as "not set up" again if its settings went missing, and the host and the founder could still fetch a picture it had not answered for. | The moment it was switched on is kept; `mayBeFetched`. The founder's "suspected" mark and a report's are kept apart. |
| A wrong key holds every picture, and one email a day is too quiet for that. | An email at once, then daily; the fault and the way out on the founder's page. "Worked before" means with the key it has now; a service in its five minutes counts as out. |
| The founder cannot see a reported picture the host has since removed. | Said plainly; ordinary reports do not keep pictures. |

Left to the building, as Astra advised: the exact fields each service answers with, and the small
upload details (the place is held through the conversion; the file itself is measured).

## What building 1a added to this plan (18 November 2026)

Four things were found while building and in Astra's reviews of the code, and are built:

- **Every form that changes a project names the project it was drawn for.** A form left open in
  an old tab could otherwise have renamed, written into or ended a project the host started
  later. The server refuses a form whose project is not her running one.
- **The posts of an ended project** have a list of their own on the host's page
  (`/host/project?project=<id>`), where she can remove one. Without it "she can still remove a
  post" had no way to be done.
- **The founder reaches every post of any project,** page by page (`/admin/projects?project=<id>`),
  whether or not the host's page is open. The newest thirty alone would have left older posts
  out of reach.
- **The post form answers in place.** It is the one form here that does not send the browser on
  when the server refuses: it comes back with the reason and with everything that was typed, also
  without any script in the browser. A post can be 5,000 characters, and none of it may be lost
  over a mistyped link.

## The founder's decisions during the build of 1b (18 November 2026)

**A picture a checker flags is refused, by itself.** The rulebook says so now. What that changes
in this plan, everywhere it is mentioned above:

- The state `flagged` is called `refused`. A refused picture is seen by nobody; its bytes are
  deleted at once; its line stays, so the same bytes uploaded again are refused again without
  asking a checker, and so the day's count stays true. It does not count toward a post's four
  pictures. The host sees it on her post's page as "This picture was not accepted", with the
  reason, until she clears it away.
- The founder has no pictures to decide: no **Show** for a refused or a waiting picture, and no
  email about flagged pictures. A picture that no checker can answer for simply waits.
- What the founder still does with a picture: **Remove** and **Remove and report**, for one that
  is shown (a reported post, most likely), and **Hold as suspected** with **Lift**, which takes a
  picture out of sight while the founder looks into it.

**The child-safety tool stays as planned.** `child-safety.ts` is built as described.

## What building 1b added to this plan (18 November 2026)

Found while building, in Astra's four reviews of the code and in the automatic security check of
the commits. All of it is built.

- **The framework's own address for smaller pictures is closed.** Next.js has an address
  (`/_next/image`) that fetches a picture of the site, makes a smaller copy and keeps it for
  hours. A picture that was once shown could have been fetched there after it was removed or
  locked. The app uses that address for nothing, so no path of the app is allowed to it.
- **A picture is sent to nobody else once something is decided about it.** Before every single
  request to a checker the queue asks again whether the picture is still as it was claimed. If
  the founder held or locked it, or a report marked it, while the first service was being asked,
  the next service is not asked.
- **A report for "someone under 18" also covers pictures added afterwards.** A picture uploaded
  to a post while such a report is open carries the mark from the start. Making such a report,
  closing one and uploading to the post all hold the post's lock, so the mark always says what
  the open reports say.
- **Removing a post removes its pictures.** So the row "any picture of a post she has removed"
  in the table under "Showing a picture" is: nobody.
- **How a service stands is what its last answer said.** "Out" starts its five minutes and ends
  a fault; a fault ends any five minutes that were running, so the service is asked again for
  the next picture and the picture waits; a complete answer clears both. A flag that came with
  parts of the answer missing refuses the picture but does not count as the service having
  worked.
- **What "out" is for each service.** Sightengine answers a reached limit with the HTTP code for
  a bad request, so its own error numbers are read (30, 32 and 33 are "out"; a refused key or an
  unpaid bill is a fault). Microsoft's used-up free level is read as code 403 with the word
  "quota"; its guide does not say, and it is not tried (below). A refusal keeps what its HTTP
  code says even when the words after it never arrive. What a service says about a refused key is
  not kept, because it can repeat part of the key.
- **The first answer of a service that is back.** Before a waiting picture is sent anywhere in a
  round, one picture that is shown after a check for nudity only is tried first, whatever its own
  time says. If a service answers it properly, the others like it are due at once.
- **The child-safety tool and deleting.** Once the tool is switched on, the bytes of a picture it
  has not answered for are kept until it has, also when a checker has refused the picture, and
  also for a picture refused on the spot because it is the same as an earlier one. The queue
  waits fifteen seconds for the tool and then goes on with other work; an answer that comes
  later is still written, and a match is kept together with the bytes the tool was asked about.
  The tool's own file, when it is written, must give up by itself well inside the two minutes
  for which the queue holds a picture.
- **The founder's page** says in red when no checking service has a key, because then every
  picture waits. A post with a removed-and-reported picture has no "Show it again". The time of
  "I have made the report" is typed in the founder's own time zone.
- **Names.** The plan's `decide(answers)` is `askInOrder` in `checks/order.ts`. The founder's
  functions are in `moderation.ts` (`removePictureAsFounder`, `lockAndReport`, `setSuspected`,
  `recordReportMade`); there is no `showPicture`, by the founder's decision above. The steps
  several files share are in `picture-steps.ts`.

**What was tried for real, and what was not.** OpenAI and Sightengine were tried by hand on 18
November 2026 with harmless pictures made for the purpose, and each with a wrong key: the answers
have the shape the code expects, Sightengine counts two operations a picture, and a wrong key
reads as a fault. Borderline pictures were not tried; the starting thresholds are as planned.
The founder decided to skip Microsoft for now: it has no key, is not in the queue, and its part
of the code is untried against the real service. Connect's own checker was measured in its
thread: ready and answering in under a second, about 40 ms a picture after that, no growth of
memory over a hundred pictures, and it works with the network switched off. The child-safety
tool does not exist yet; its rule is tried with a stand-in.

