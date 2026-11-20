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

## The iPhone

Building the iPhone app needs Xcode 26.4 or later. Until this Mac has it, only the Android app is
built and tried; the iPhone app comes from the same code.

## What is not decided yet

- The app's lasting identity in the stores (`app.connect.mobile` in `app.json` is a stand-in).
- The app's icon and opening picture (the template's are still in `assets/`).

Both belong to part 20 of the plan.
