# Phone apps, part 02: the app's frame

**Status:** built, 20 November 2026 (see `docs/module-record.md`). Written that day by the
builder alone. Part of plan 45. Astra checked the plan once and the code once; every point was
worked in. What the building changed or added is listed under "What the building changed" near
the end; where that list and a decision differ, the list is what was built.

**Tried already, while this plan was being checked** (20 November, in a throwaway folder
outside the repository): Expo 58.0.26 (React Native 0.88.1, React 19.3.0) with
`@livekit/react-native` 3.2.0, `@livekit/react-native-webrtc` 150.2.0,
`@livekit/react-native-expo-plugin` 1.2.0, `@config-plugins/react-native-webrtc` 15.0.2,
`livekit-client` 2.24.1, `@stripe/stripe-react-native` 0.81.0, and `better-auth` with
`@better-auth/expo` 1.7.18 installed together without a conflict, passed Expo's own health
check 18 of 18, and built into an Android test app. **Still not known:** whether that app
starts and each kit works on a phone, the kind of build that goes to a store, and anything
about the iPhone. Those are this part's first step.

## For the founder: what this is

The empty app: it opens on the Android test phone, shows Connect's look, can move between
screens, and can talk to the server through part 01's door. No real screen yet. It is also
where the biggest unknown is settled first: **do the four kits the app depends on work
together** in today's versions? If one does not, it is far cheaper to learn it now than after
twenty screens are built on it.

## Decisions (the builder's)

1. **Where it lives:** `mobile/`, a project of its own inside this repository: its own
   `package.json` and lock file, its own installed libraries, its own type check, lint and
   tests. The website's `package.json` and lock file stay as part 01 left them, so the
   website's install, build and checks, and the other sessions' folders, are not affected.
   (Part 01 already told the website's type check and lint to leave `mobile/` alone; without
   that they would pick up the app's files and fail.) The folders that the tools generate for
   each kind of phone (`mobile/android`, `mobile/ios`) are made fresh by the tools and are
   not kept in the repository.

2. **The kits, proven before anything is built on them.** Expo 58 with its own way of moving
   between screens (Expo Router); LiveKit's kit for phones; Stripe's kit for phones;
   better-auth's kit for Expo; the phone's secure store; the browser sheet. The very first step
   is a build of the app with all of them installed and a plain test screen that makes each one
   prove it is alive (the video kit starts, Stripe's kit accepts the test key, the sign-in kit
   reaches the server, the secure store keeps a value across a restart). The versions to
   start from, each pinned exactly: LiveKit's kit 3.2.0 with its Expo part 1.2.0 and its
   video part 150.2.0 (LiveKit says the older Expo part cannot build with that video part),
   the same `livekit-client` line the website uses, Stripe's kit as Expo pins it for 58, and
   better-auth's kit 1.7.18 to match the server. Nobody has published a proof of exactly this
   set together, so the test is done twice: as the everyday test build, and as the kind of
   build that would go to a store (Stripe's notes describe a fault that only shows there).
   **If a kit does not work with Expo 58,** the builder steps down to Expo 57, then 56 (this
   plan's fallbacks; all three need the same newer Xcode), and writes down which one and why.
   If none works, this part stops and says so, before any screen is built.

3. **Which server the app talks to** is a setting, not written into the code: the test phone
   on this Mac talks to the website running on this Mac; a real app will talk to the real
   address. Plain (unlocked) connections are allowed only in the test build.

4. **One way to ask the server.** A single small piece of code sends every request: it adds
   the app's name and version and the sign-in, **and it sends the sign-in to Connect's own
   server address only**, whatever address a screen hands it. It understands the door's
   answers. "Not
   signed in" leads to the sign-in screen, "please update" to a screen that says so and
   nothing else, "18 and terms" to that step. No screen talks to the server on its own.

5. **The shapes of the answers are shared with the server**, from part 01's one file, as types
   only. If the server changes an answer and the app is not changed with it, the type check
   fails. The app copies no rule from the server.

6. **The look.** The warm look of the website (`src/components/warm-ui.css`): the same colours,
   the same rounded cards, the same button shapes, as a small set of shared pieces: a page, a
   card, a button (main, plain, danger), a field with its label and its problem line, a notice,
   "loading", "something went wrong, try again". Light and dark follow the phone. Text grows
   with the phone's text size. Every button and field has a name a screen reader can say, and
   is at least as tall as the website's (44 points).

7. **Moving around.** Four places at the bottom: Home, Search, Calls, Account. This is a
   choice for phones; the website's top line also has Following and Hosting, and both are one
   touch from Home and from Account in the app. Calls holds the coming calls and the past
   ones. Each later part adds its screens under these.

8. **What the app does when the server cannot be reached:** it says so plainly and offers
   "Try again". It keeps nothing to send later: a booking or a payment is never made "when the
   connection is back".

9. **The checks on GitHub get a second job** for `mobile/`: install, type check, lint, tests.
   It builds no app. An Android build could run there too, but it would add many minutes to
   every pull request; building is done on this Mac, and the pictures go with the pull request.

## The Android test phone on this Mac

Android Studio and its tools are installed. A test phone named `ConnectTest` (a recent
Android, with a made-up camera picture) was set up on 20 November. This part writes the two
commands that start it and put the app on it into `mobile/README.md`, so any later session
can do the same.

## What gets built, in order

1. The project, with the kits, and the test screen that proves them. The decision on the Expo
   version is made here.
2. The setting for the server's address; the one way to ask the server; reading part 01's
   `start` and acting on its answers.
3. The shared pieces of the look, and one screen that shows them all.
4. The four places at the bottom, each an empty page with its name.
5. The second job on GitHub; `mobile/README.md`.

## How it is tried

- The app's own type check, lint and tests (the answer-handling code is plain logic and is
  tested alone: each of the door's codes leads where it should).
- On the Android test phone: the app opens; the test screen shows each kit alive; the app
  asks `start` on this Mac's website and shows the answer; with the website stopped it says
  "cannot reach Connect" and "Try again" works once it is back. A picture of each is kept with
  the pull request.
- The website's own checks stay green, and its `package.json` and lock file are unchanged.

## What cannot be tried here

The iPhone build (this Mac's Xcode is too old). The camera in a real call (part 09).

## Keeping the 4.9%

No money, nothing sold. Stripe's kit is only installed and woken with the test key.

## What the building changed (20 November 2026)

1. **Expo 58 was kept.** Every kit works with it on the Android test phone, in the everyday test
   build and in a build made the way a store build is made. No step down was needed.
2. **A store build stopped twice on Stripe's kit,** both times on its feature for adding a card
   to Google Wallet, which Connect does not use: once on a Google library that is not published
   openly, once in the step that makes the app smaller. `mobile/plugins/stripe-store-build.js`
   deals with both; nothing the app does changes. This is the fault decision 2 expected to find
   only there.
3. **The sign-in cannot follow a redirect.** Decision 4 said the sign-in goes to Connect's own
   server only, and the code checked the address it was given. Astra's review found the gap: if
   the server, or something on the way, answered "go to this other address", the phone would
   have gone there with the sign-in. A request now stops instead of following.
4. **A locked connection, always, outside a test build** (decision 3 said "plain connections
   only in the test build" of the phone; now the app itself refuses too). With a plain `http`
   address in its settings, a store build sends nothing at all. The server's address must be a
   bare one: no name and password in it, nothing after it.
5. **An answer is checked before the app opens on it.** Half an answer, a list, or another
   site's page counts as "cannot reach Connect". A refusal is a refusal whatever number came
   with it.
6. **Coming back to the app with no connection keeps the screen the person was on** (decision 8
   only spoke of opening). The app says "cannot reach Connect" when it opens without a
   connection, and when something the person does cannot be sent. Whatever Connect itself
   answers still counts at once: signed out elsewhere, or "this copy is too old".
7. **The two test screens exist only in a test build.** In any other copy they cannot be opened
   by a button or by a link. Expo Router's own list of screens and its own "no such screen"
   page are switched off: both sat outside the app's frame, where a too-old copy could have
   shown them. A link to no screen now leads to the front page.
8. **Camera and microphone: the app says why it asks** ("so the person you are talking to can
   see you"). The permission to draw over other apps, a leftover of the tools, is removed.
9. **The outline of a field is darker than the website's,** so that an empty field can be seen
   on a white card (3 to 1; the website's grey gave 2.5 to 1).

Seen on the test phone and left for part 20: changing the phone's text size while the app is
open restarts the screen, and the test build then prints a warning about "multiple navigation
containers". The app carries on correctly.

## Astra's check of the code (20 November 2026): "not ready", now worked in

1. *A redirect could carry the sign-in to another address.* Point 3 above.
2. *Any 2xx answer with a body opened the app,* even an empty one, and a refusal sent with 200
   was taken for an answer. Point 5.
3. *Plain `http`, and a server address with a name and password in it, were accepted in every
   build;* a "%" in a path could change its meaning on the way. Point 4.
4. *Expo Router's own list of screens and "no such screen" page sat outside the frame.* Point 7.
5. *A refusal on coming back kept the old signed-in screens; and if the phone could not read
   its kept sign-in, the app asked as nobody* and would have taken the person for signed out.
   Point 6; and in that case nothing is sent now.
6. *The trial of a store build left its hand-made change and its code in the folder.* The
   README now ends the trial by deleting the folder.
7. *The test screen called the sign-in kit alive without asking the server anything.* It now
   asks the server's login tool who is signed in. LiveKit's parts are put in place when the
   check runs, not when the file is read.
8. *The camera and microphone questions gave no reason; an unused permission.* Point 8.
9. *The field outline was too faint.* Point 9.

## Astra's check of the plan (20 November 2026): "ready with changes", worked in

1. *The website's checks would have found the app's files.* Decision 1, with part 01.
2. *Which versions, and that nobody has proven them together.* Decision 2: exact pins, and the
   test done as both kinds of build.
3. *The sign-in must only ever go to Connect's server.* Decision 4.
4. *The four places at the bottom are a new choice, not the website's line,* and Calls needs
   the past calls. Decision 7.
5. *An Android build could run on GitHub.* Decision 9 says why it does not.
