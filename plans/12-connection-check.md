# Plan 12: Connection check before a call

**Status:** built (branch `module/connection-check-build`); what was built, what was decided along
the way, the reviews and the checks are in `docs/module-record.md` under "Module 10". Below is the
plan as it was approved (15 November 2026). Astra has checked the plan three times; what it found each time is at the end, and every
point is worked in. A small
part was written before the build was put on hold; see "Where the build stands".

## What this is, and why

The founder's idea: hosts do their own customer service, so a call that goes badly because of
someone's internet should not turn into a complaint against the host. A short "tech check" before
the call, as tutoring apps do, tells each person whether their connection has a problem, while there
is still time to move closer to the Wi-Fi or switch networks.

Nothing has to be bought. The test is built with the video toolkit the app already uses (LiveKit's
`livekit-client`, already installed).

That toolkit also has a ready-made connection test. It is not used, for two reasons found by reading
its code: it cannot be stopped once started, and it leaves a drawing loop running in the browser
after it finishes, which would cost the device effort during the call itself. So the measuring part
is written here, about a screen of code, and it is shorter and cheaper than the ready-made one.

## What the founder decided

| Question | Decided |
| --- | --- |
| A weak or failed test: warn, or stop the person from joining? | **Warn only. Joining is never blocked.** |
| A sign during the call when someone's connection is weak? | **No: it distracts the person on the call.** The small bars icon the video toolkit shows in the corner of a person's picture when their connection is poor is hidden too. |
| Keep the result, or show it after the call? | **No.** A person already saw their own answer before the call. Nothing is kept, and nobody sees anyone else's answer. |
| When to build | **Later.** |

## What the test does

About 12 seconds, in the background, on that person's own device:

1. It connects to the video service the same way a real call does, but to a private test room.
2. For about 8 seconds it sends a made-up moving picture (not the camera) and reads the reports the
   video service sends back about what arrived: how long the round trip takes, and how much was
   lost on the way.
3. It disconnects and cleans up after itself. It can be stopped at any moment.

It does not use the camera or the microphone. The camera and microphone check that is already on the
screen before joining stays as it is.

The answer the person sees is one of four, in plain words, with a tip:

| Answer | When | What the person is told |
| --- | --- | --- |
| **No problems found** | It connected, enough reports came back, and delay and loss are fine | "No connection problems found. This was a short check from this device, on the network you are on now." |
| **Weak** | It connects, but the delay is long or a lot is lost | "Your connection is weak. The picture or sound may break up. Try moving closer to your Wi-Fi, closing other video or downloads, or using another network." |
| **Could not connect** | The device asked the video service and could not get through | "This device could not reach the video service. Check that you are online. An office, school or hotel network may be blocking video calls: try another network or mobile data." |
| **Not measured** | Anything else: the browser gave too few figures (Safari may), the browser is not supported, the limit was reached, or the check is switched off or failed on our side | "We could not measure your connection on this device. That is not a sign of a problem. You can still join." |

**The rule** (already written and tested, `src/lib/connection/answer.ts`): weak when the average
round trip over the reports is longer than 0.4 seconds, or the average share lost is more than 3%;
either one is enough. "No problems found" needs both averages fine and at least two reports that
each carried both figures. A missing or nonsense figure is never taken to be good: it gives "not
measured". The two limits are starting values, to be adjusted after real calls.

**What it does not measure: speed as such.** How much picture a connection can carry is not judged.
A few seconds are not enough for a browser to work that out dependably, and the limit could only be
set by trying it on a connection slowed down on purpose, which needs administrator rights this
computer does not give. The test is a short, made-up upload, lighter than a real call's picture, so
a connection that is clean but too slow for video can pass it. That is why the good answer says "no
problems found", not "your connection is good". A wrong "weak" would be worse than a modest answer.

## Smaller choices (the builder's)

| Question | Chosen | Why |
| --- | --- | --- |
| Who is tested? | Both the host and the customer. | Many complaints will come from the customer's own connection. Telling them before the call is what heads off the complaint. |
| When? | **(a)** On the call's page before joining, for every kind of call: it runs by itself, once. Pressing "Join" stops it at once. **(b)** Any time, on a page of its own, "Test your connection", linked from Hosting and from "Available now". "Test again" always works, within the limit below. | (a) catches everyone without asking them to do anything, and never delays joining. (b) lets a host test well before a call, and before switching on "available now". |
| The toolkit's "Reconnecting…" notice during a call | Stays. | It explains why the picture froze. It is not a grade of someone's connection. |
| When it does not start by itself | Two small notes kept in the browser tab only (its "session storage"), never on the server: the time a test last finished, and, per call, that the person has pressed "Join". No test starts by itself within 15 minutes of the last one finishing, or on a call the person has already joined (so not after dropping out and coming back, also after reloading the page). The answer itself is not kept, even there. If the browser will not keep notes, the test may simply run again; joining is never affected. | A check that restarts every time the screen comes back would be a nuisance and would use allowance for nothing. |
| A limit on tests | 10 per person per hour, and starts at least 20 seconds apart. | Each test uses a little of the video service's allowance; a limit stops anyone running it in a loop. |

## What it costs

No new service and no new fee. Each test is connected to the video service for about a quarter of a
minute. The video service counts connected minutes. According to price trackers that agree with each
other (the official page could not be read in full, so this is an estimate to confirm in the LiveKit
account): the free plan includes 5,000 minutes a month; the $50 plan includes 150,000 and then
charges $0.0005 a minute. On that basis one test costs a small fraction of a cent, and 1,000 tests
would use a few hundred of the free plan's 5,000 minutes. On mobile data a test sends a megabyte or
two.

## What gets built

**A private test room, never a call's room.** The app counts who was connected to a call's room, and
that count is what a customer is charged for. So a test must never touch it:
- The server makes up the room name (`check-` plus the test's own number) and the name the test
  connects under (`check:` plus the same number, never the person's account number). The browser
  cannot choose either.
- The room takes one participant only. The pass works for that room only, lets it send but not
  receive, and can only be used to connect in the first minute.
- Test rooms never enter the list of calls. The attendance log, the "one call at a time" rule and
  the room-closing helper all work from that list only (checked in the code, and confirmed by
  Astra), so a test cannot reach them. A check proves it.

**Starting a test** (one small server route, `POST /api/connection-test`; logged-in people only, not
a paused account, off while the founder's "stop joining" switch is on). Under a lock of its own for
that person (not the lock that joining a call uses), it counts their tests in the last hour, refuses
an 11th, and refuses one within 20 seconds of the last; then it writes a row, makes the room and
hands over the pass. The browser works out the answer itself with the one shared rule; nothing is
sent back to the server, and nothing about the answer is stored.

*One rule ties this to the tidying up below.* The route hands over a pass only if making the room
took less than 20 seconds from the moment the row was written; if it took longer, it hands over
nothing and the person sees "not measured". A pass can only be used to connect in its first minute.
So no pass can still be used later than about 80 seconds after its test started, and the tidying up
at 90 seconds always comes after the last moment anyone could connect. A room that was made but
never used closes by itself after a minute.

**Tidying up.** A pass's time limit only stops a late connection, not a long one. So the always-on
helper, in a loop of its own beside its work on calls and payments, ends every test about 90 seconds
after it started: it cancels the test's pass, deletes its room, and marks the row only once the
video service confirms the room is gone (otherwise it tries again). Because of the 20-second rule
above, the room it closes is always the last of that test: nothing can be made or joined after it
has run. Rows older than a day are
removed, but only those whose room is confirmed closed: a row still waiting is the only record of a
room left to close.

**One new table**, `connection_tests`: who started a test, when, and when its room was confirmed
closed. It exists only for the limit and the tidying up. One database change (`0021`).

**The test in the browser** (`src/lib/connection/run-test.ts`), with one "stop" that is safe to call
at any time and more than once, used when the test finishes, fails, runs past its 25-second limit,
when the person presses "Join", and when they leave the page. Stopping cancels the request to the
server, the drawing, the once-a-second readings and the time limit; stops the test picture's track;
and disconnects from the test room, without anything waiting for it. After every step that takes
time (asking for the pass, connecting, starting to send, each reading) the test first looks whether
it was stopped, so nothing can start up again late.

What it reads, once a second, from the browser's own report on the picture it is sending
(`getRTCStatsReport()` on the track):
- from the entry about the picture going out (`outbound-rtp`): which report from the far side
  belongs to it;
- from that report (`remote-inbound-rtp`, matched by its id or by the stream's number): when it
  arrived (its `timestamp`, which is what tells one report from the next), the share lost since the
  report before (`fractionLost`, from 0 to 1), and the round trip (`roundTripTime`, in seconds).

Each report is counted once, however often it is read. The picture is one stream of fixed size and
rate with a capped weight (640 by 360, 15 pictures a second, at most about 1.2 megabits a second),
not the several sizes a real call sends. Browsers differ in what they report: Safari is expected to
leave out the loss figure, and will then honestly answer "not measured". No tricks are built to
force an answer out of a browser that does not give the figures.

**The test on screen** (`src/components/connection-test.tsx`): "Testing your connection…", then the
answer and the tip, with "Test again". On the call's page it sits in one fixed place above the
countdown and the camera check, so the page's once-a-second clock and the move from "the room opens
in…" to the camera check do not restart it. Joining does not wait for anything to do with the test.

**A page of its own**, `/connection-test`, and links to it on the Hosting page and on "Available
now".

**The bars icon during a call** is hidden with one style rule (`display: none`, so it cannot come
back on hover).

## What is left out, on purpose

- **Blocking anyone from joining.**
- **Any sign or measurement during the call, and any record of a result.** So the app will not know
  whose connection was bad, before or during a call.
- **Judging speed** (see above), and a full "speed test" with download and upload numbers.
- **Testing the camera and microphone again.** The screen before joining already shows the camera
  picture and the microphone level.
- **Testing what arrives.** The test sends; it does not receive a picture. A connection that sends
  well but receives badly would not be caught.

## How it will be checked

- Automatic tests for the rule (written: 11 tests, including missing and nonsense figures).
- The check scripts that delete the people they made (accounts, ratings, notifications) must first
  end and remove those people's test rows, or the deletion will be refused. The new script does the
  same for its own.
- A new check script: the hourly limit and the 20 seconds, also when two starts arrive together; no
  pass when making the room took too long; a
  pass that only works for its own test room, under the test's own name, and cannot receive; a test
  room's comings and goings never reach a call's attendance record or its charge; the helper ends a
  test left open and removes old rows.
- The whole-journey script and the nine earlier scripts must still pass.
- By hand in a browser against the real video service: a normal connection; the video service made
  unreachable; pressing "Join" in the middle of a test; the move from the countdown to the camera
  check; coming back after dropping out of a call; at computer and phone width.

**What the checks cannot cover, and the founder's friend tests must:** a weak connection (it cannot
be made on this computer), a real iPhone, hotel Wi-Fi, mobile data on the move. The two limits may
need adjusting after them.

## Order of work, in small steps

1. The rule that turns figures into an answer, with tests. *(Done.)*
2. The table, the test room and its pass, the limit, the server route. *(Begun: the table and the
   two functions that make and end a test room are written; the limit and the route are not.)*
3. The helper ends tests left open.
4. The test in the browser, tried against the real video service.
5. The test on the call's page and on its own page; the links; the hidden icon.
6. The check script; every check; the two reviews; the pull request.

Size: small, about two to three days of building, plus the reviews.

## Where the build stands

On the branch `module/connection-check` (not merged, not on GitHub): this plan; step 1 complete; the
first half of step 2. Nothing in the app uses any of it yet, and no page has changed. The local test
database has the new, empty `connection_tests` table.

## Astra's checks of this plan (15 November 2026)

**First version: rework.** The money side was sound (a test room cannot reach a call's attendance or
charge). Thirteen points, the main ones: a pass's time limit does not end a connection; the
toolkit's ready-made test cannot be stopped and leaves a drawing loop running; closing a test from
inside the real join step could slow or fail a join; the "weak" rule claimed more than the figures
show. All were taken: the measuring part is written here instead, the helper ends tests, joining
waits for nothing, and the rule uses delay and loss only.

**Second version: approve with changes.** Six points, all taken:
1. Cancel a test's pass when closing its room, not only delete the room.
2. Say exactly which of the browser's figures are read and how reports are matched and counted.
3. One "stop" that covers every unfinished step and the picture's track.
4. A lock of its own for tests, and a clear rule for how close together tests may start (20 seconds).
5. Eight seconds cannot measure how much a connection can carry: tune on a slowed connection or drop
   it. It is dropped (see "What it does not measure").
6. A check that could not run must not be reported as a problem with someone's internet: those cases
   now all say "not measured", and the good answer says "no problems found".

**Third version** (after the founder's decisions): **approve with changes.** It confirmed that
nothing is left over from the dropped parts, that the test room's settings and pass are right, and
that a test cannot reach a call's attendance. Five points, all taken:
1. The rule could say "no problems found" from one whole report plus scraps of another. Fixed in the
   code, with tests: it now needs two reports that each carried both figures, and broken numbers can
   never pass as good.
2. Removing rows after a day could throw away the only record of a room still to be closed. Only
   rows whose room is confirmed closed are removed.
3. Say exactly what the browser remembers so the test does not restart by itself. Done (the row
   "When it does not start by itself").
4. The plan claimed the test picture was as heavy as a real call's. It is lighter, and the plan now
   says so.
5. Check scripts that delete their test people must remove those people's test rows first. Added to
   "How it will be checked".

## CodeRabbit's review of this plan (pull request 17)

One comment: the plan did not say what happens if the helper tidies up a test while the route is
still making that test's room. Checked: for that, the call to the video service would have to hang
for more than 90 seconds, far beyond its own time limit, and at worst one test connection would be
left untidied. Small, but the plan promises that every test is ended, so it is closed off. Not the
way suggested (look at the row again and delete the room, which leaves a gap of its own between
looking and answering), but with a simpler rule that needs no second look: no pass is handed over
when making the room took more than 20 seconds. It is in "Starting a test".
