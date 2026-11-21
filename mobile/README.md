# The Connect phone app

One set of code that makes the iPhone app and the Android app (React Native with Expo). It is a
project of its own inside the Connect repository: its own libraries, its own checks. The website
does not depend on it, and its plan is `plans/45-phone-apps-the-build.md`.

The app shows what the server says. No price, fee or rule lives in it: the server decides, each
time, through the addresses under `/api/app/` (`src/lib/app-door/` on the server).

## The checks

```bash
npm ci
npm run lint
npm run typecheck
npm test
```

The same four run on GitHub for every pull request (the job "Phone app, lint, types, tests").

## Trying it on the Android test phone on this Mac

Nothing here needs a store account. It needs Android Studio (installed) and the test phone named
`ConnectTest`.

1. The settings for a test build go in `mobile/.env.local` (never in the repository):

   ```
   EXPO_PUBLIC_SERVER_URL=http://localhost:3310
   EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_…   (the website's own test key)
   ```

   `EXPO_PUBLIC_SERVER_URL` is the website the app talks to: the one running on this Mac. A real
   app is built with the real address instead.

2. Start the test phone, and let it reach this Mac's website and the app's own code server:

   ```bash
   ~/Library/Android/sdk/emulator/emulator -avd ConnectTest
   ~/Library/Android/sdk/platform-tools/adb reverse tcp:3310 tcp:3310
   ~/Library/Android/sdk/platform-tools/adb reverse tcp:8081 tcp:8081
   ```

3. Build the test app and put it on the phone (the first build takes about eight minutes):

   ```bash
   export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
   export ANDROID_HOME=~/Library/Android/sdk
   npx expo run:android
   ```

   The folders `android/` and `ios/` are made fresh by this and are never kept in the repository.

4. The first time, Android asks whether the app may find devices on the local network. A test
   build needs that to reach this Mac: allow it. A build for the store must not ask for it.

In a test build, the Account place has two test screens: "Check the kits" (each kit the app stands
on proves it is alive on this phone) and "The look" (every shared piece of the look on one page).

A test build's tool for looking at network traffic is switched off
(`plugins/quiet-test-build.js`): it would copy every request, with the sign-in in its header, to
the code server on this Mac.

## Trying it as a store build would be made

The everyday test build above loads its code from this Mac as it runs. A store build carries its
code inside, made smaller and checked harder, and some faults only show there. To try one on the
test phone:

1. Make the Android project fresh. This throws away the folder `android/` and makes it again,
   and it applies `plugins/stripe-store-build.js` (without it a store build stops twice on parts
   of Stripe's kit that Connect does not use):

   ```bash
   npx expo prebuild --platform android --no-install --clean
   ```

2. Only for this trial, on this Mac: a store build refuses plain `http`, and the website on this
   Mac is plain `http`. Two things let the trial through, and both are for the trial only:
   in the fresh file `android/app/src/main/AndroidManifest.xml`, add
   `android:usesCleartextTraffic="true"` to the `<application` line; and build with
   `EXPO_PUBLIC_TEST_SCREENS=1`, which puts the two test screens in and lets the app itself use a
   plain address.

3. Build it and put it on the phone:

   ```bash
   (cd android && EXPO_PUBLIC_TEST_SCREENS=1 ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a)
   ```

   ```bash
   ~/Library/Android/sdk/platform-tools/adb install -r android/app/build/outputs/apk/release/app-release.apk
   ```

4. **When the trial is over, delete the folder** (`rm -rf android`). It holds the change made by
   hand and a copy of the app's code with the test screens in, and a later build in the same
   folder could reuse both.

A build for a store is always made from a fresh folder and **without**
`EXPO_PUBLIC_TEST_SCREENS`. In such a build the two test screens cannot be opened at all, by a
button or by a link, and the app sends nothing to a server whose address is not `https`.

After changing a file, the everyday test build shows the change by itself, as long as the code
server was started plainly (`npx expo start --dev-client`). Started with `CI=1` it does not watch
the files, and the phone keeps showing the old code.

## Trying a card and the ID check

Both use Stripe in test mode, with the website's own test keys. Nothing is ever charged.

- **A card.** Ask a host who charges for a call. Stripe's sheet takes Stripe's published test
  cards: `4242 4242 4242 4242` is saved at once, `4000 0025 0000 3155` asks for the bank's
  approval first (a test page with "Complete" and "Fail"), `4000 0000 0000 0002` is refused.
  Any date in the future, any three digits, any ZIP code. A host on this Mac's test database can
  only be asked for a paid call when she is marked as able to be paid (see
  `scripts/app-booking-check.ts`, which does that for its own hosts).
- **The ID check** opens Stripe's page in the phone's browser. The first time, the test
  phone's browser shows Google's own first screen; press through it once by hand.

## Trying a call

A call needs two people: the app on the test phone as one, and the website in a browser on this
Mac as the other (the same room). The test phone's camera shows a made-up moving picture.

- The first time, the app asks for the camera and the microphone: allow both.
- **Pictures of the call screen are black, on purpose** (nobody should be able to record a
  call with the phone's own tools). To look at the screen while trying it, add
  `EXPO_PUBLIC_CALL_PICTURES=1` to `mobile/.env.local` and start the code server again with
  `--clear`. Only a test build obeys this; a build for a store never does.
- A database used for checking collects old calls. If "Join call" takes very long, mark them
  as closed: the server steps out of every room a person could still be in before it lets
  them into another. **Only ever on a database made for checking.** Look first at which
  database you are on (`select current_database();` must show a name ending in `_check`),
  and only then run `update calls set closed_at = now() where closed_at is null;`. On any
  other database that statement would close every open call.

## The iPhone

Building the iPhone app needs Xcode 26.4 or later. Until this Mac has it, only the Android app is
built and tried; the iPhone app comes from the same code.

## What is not decided yet

- The app's lasting identity in the stores (`app.connect.mobile` in `app.json` is a stand-in).
- The app's icon and opening picture (the template's are still in `assets/`).

Both belong to part 20 of the plan.
