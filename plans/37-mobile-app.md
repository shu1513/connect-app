# Plan 37: The phone apps (iPhone and Android)

**Status:** a plan only; nothing is built. Written 19 November 2026 by the builder, from the code
as it is on `main` after pull request 58, from research the builder and Astra each did on their
own that day, and from what the founder said. This is the rulebook for the whole feature. Each
part gets its own short plan, checked by Astra, just before it is built, because the website is
still changing every day and a detailed plan written now would be out of date by then.
Astra checked this plan twice ("ready with changes" both times); the builder read every point
against the code, and all eleven are worked in below (the lists are at the end).

## For the founder: what this is

Connect is a website today. This plan is about real apps for iPhone and Android that people
install from the App Store and Google Play.

- **The app and the website are one product.** The app talks to the same server and the same
  database. One account, the same bookings, the same money, the same rules. A call can have one
  person on the website and the other in the app.
- **The fee stays 4.9%.** Apple and Google both allow a live, one-to-one, unrecorded service to
  be paid for outside their own payment systems. That is what a Connect call is.
- **The app is small on purpose.** It does what a phone is best at: find a host, book, pay, be
  told in time, take the call, and for a host, answer a request. The rest stays on the website.
- **It is a second set of screens, not a copy of the website.** That is real work: Astra's rough
  guess is 12 to 22 weeks. It is a guess, not a measurement.

## What the founder said (19 November 2026)

- "then we won't do the Project contributions for the mobile apps"
- "the mobile app would share the data base with the websites right?" (Yes.)
- About "available now": "I thought that available is just a status the host would turn on,
  then … the host can turn it off or it is automatically turned off when the host is offline."
- About ringing: "I thought that we are doing chat rooms for the 2 people."
- About people deleting their own account in the app: "of course."
- Then, about everything still open: "do what you think is the best. use your best judgement
  after research"

## Decisions (the builder's, after the research; the founder can change any of them)

1. **How it is built: React Native with Expo, written in TypeScript.** One app for both iPhone
   and Android, in the same language as the website. LiveKit (video), Stripe (payments) and
   better-auth (sign-in) each offer an official kit for it. It lives in this repository, in its
   own folder, so the rules that are plain TypeScript can be used by both.
   Not chosen: the website wrapped in an app shell (Apple refuses "a repackaged website", and
   video inside a wrapped page goes quiet when an iPhone locks); an installable website only
   (no store, weak alerts on iPhone); Flutter or separate Swift and Kotlin apps (new languages,
   nothing reused, too much for one builder).

2. **When: after the website is live.** Three reasons. The website's pages still change daily,
   and every change would then be made twice. A call can only be tried properly on real
   phones, and putting the app in the stores needs the founder's store accounts. And real
   customers will show which screens matter on a phone. The one part that does not wait is
   part 1 below.

3. **What is in the first version of the app.**
   For everyone: sign up, sign in, the account page, closing your own account, reporting and
   blocking.
   For a customer: search, a host's page, asking for a booked call, asking for a call now,
   saving a card and paying, the list of calls, the call itself, rating, asking for a refund,
   following a host, joining and using a membership.
   For a host: the list of requests with accept and decline, "available now", the calendar's
   hours, the call itself, the notes around a call, answering a refund request.

4. **What stays on the website only.**
   - **Projects, wholly:** the diary, contributing, and the ask to contribute after a call. Both
     stores would want their own payment for a contribution (15 to 30%), because Connect keeps
     a share of it. The app does not show, link to or mention contributions, anywhere in the
     world. The stores' rules on linking to another way of paying differ from region to region
     and keep changing; leaving it out everywhere keeps the app clear of all of them.
     Projects show up today inside pages the app will have: a host's page, the page after a
     call, the account page, the diary posts on the home page, and the "diary emails" choice
     under Following. The app's versions of those pages leave those pieces out.
   - A host's first set-up: applying, the ID check, the payout account at Stripe, proving social
     accounts, the photo. The app sends a new host to the website for it. A host can use the
     app once that is done and they are approved, as on the website.
   - **A customer's ID check.** It is needed before a first free call, and for any call or
     membership with a host who takes "verified customers only". The app says so and sends the
     customer to the website to do it; they then come back and carry on. An ordinary paid call
     needs no ID check and works wholly in the app.
   - Collecting earnings and the membership settings of a host. (To look at again after the
     first version.)
   - The connection check before a call. It is built for a browser; a phone version is its own
     later job, and the check only ever warned.
   - Everything for admins.

5. **Paying in the app: Stripe, the same fee, the same server rules.** The app never works out
   a price or a fee itself; it shows what the server says. The notes for the stores' reviewers
   say plainly: live, one-to-one, never recorded (Apple's rule 3.1.3(d); Google's "1:1 online
   paid service").

6. **Memberships are in the app, described as what they are: prepaid one-to-one talk time.**
   This is the one money question that is not certain: a reviewer could see the member-only
   times and instant booking as paid features, whatever Connect calls them. If Apple or Google
   objects, the steps are decided now, in this order:
   - First: joining and paying for a membership moves to the website, and a member still books
     and takes calls in the app. This only works if the store accepts that. A store that sees
     the benefits as paid features may not, even with the paying moved out.
   - If it does not: on that store, the app drops the two disputed benefits (member-only times
     and instant booking), or leaves memberships out, and a member uses them on the website.
   Ordinary one-to-one calls are not touched by any of this.

7. **Signing in on a phone: email and password, with the two-step code as today.** No Google
   sign-in in the first version. Apple's rule 4.8 says an app that offers Google sign-in must
   also offer a private one such as "Sign in with Apple", which is more to build and to keep.
   Someone who joined on the website with Google sets a password once, with the "forgot
   password" email. Instagram and TikTok are used to prove a host's accounts, not to sign in,
   so that rule does not touch them.

8. **A call is a room two people walk into; nobody phones anybody.** So the first version does
   not use the phone's real call screen. This is the builder's choice, not a ban: Apple does
   allow that screen for internet video calls. But every alert sent that way must show a call
   coming in, and a request the host has yet to accept, with the money not yet held, is not a
   call yet. Apple's own page says an app that does not use the call screen sends ordinary
   notifications. That is what Connect does:
   - Reminders before a booked call (a day, an hour, "it's time") also arrive as notifications.
     Emails go on as they are.
   - **A request for a call now** is sent as an urgent notification. It is set up to light up
     a locked phone, make it vibrate, show who is asking, for how long and for how much, and
     play Connect's own sound for just under 30 seconds (Apple's limit). It is marked "time
     sensitive", which gets it through Focus modes unless the host switched that off. If the
     request is still waiting after one minute, the phone is alerted once more. An alert
     never restarts a clock: the 2 minutes run from the moment the customer asked.
   - Tapping it opens the app on the request, with the countdown. Accept and Decline are
     pressed in the app, not on the lock screen, so the host sees what they are agreeing to.
   - While the app is open on the screen, it shows the same loud banner the website has.
   - The limits, said plainly: Connect asks for all of this, and the phone decides. A phone
     on silent only vibrates; a host can turn an app's sound or vibration off in the phone's
     settings; Android may quieten alerts that come close together; and no notification is
     promised to arrive at all. Connect is told when Apple or Google took a notification, not
     when the phone showed it.

9. **"Available now" on a phone stays on while the phone is locked.** It is a status the host
   switches on for 30, 60 or 120 minutes, as today. It goes off when the host switches it off,
   when the time is up, or when the host accepts a call now, as today. A booked call coming up
   does not switch it off; as today, only the call lengths that still fit before it are
   offered. New, for a status switched on from the phone:
   - **A request the host does not answer in the 2 minutes switches it off**, and the host is
     told why. That is how Connect notices a host who is not looking. Up to five requests can
     wait for one host, as today; the first one to run out unanswered ends that period of
     availability and the other requests waiting in it, and those customers are told at once
     that nothing was charged. (Today a request that runs out leaves the status on.)
   - **A phone that does not allow Connect's notifications follows the website's rule.** Apple
     does not let an app demand notifications before it works (its rule 4.5.4). So the host
     can still switch "available now" on, is told plainly that requests will only be seen
     while the app is open, and the status goes off when the app is left, as on the website.
   - The status also goes off when Connect learns that the phone can no longer be reached,
     for example when Apple or Google says its address is no longer valid. Connect often
     cannot know; then the unanswered request above is what switches it off.
   - The website's rule does not change: there, closing or leaving the page still switches it
     off at once.
   - **One status, started in one place.** A host has one "available now" status, as today.
     The server remembers where the current period was switched on, the website or the phone,
     and that place's rule applies to it. The other place shows the status and can switch it
     off on purpose, but cannot take it over, keep it alive, or end it just by being closed.
     (Today the website's page ends whatever status it sees when it is closed; that changes.)
     A request left over from an earlier period never switches off a newer one.
   The clocks stay as they are: 2 minutes to answer; after accepting, the call starts a minute
   later and the money must be held within 2 minutes; nobody joins before the money is held.
   Whether 2 minutes to answer is enough for a phone in a pocket is a thing to watch in the
   first real test.

10. **Anyone can delete their own account, for good, on the website and in the app.** Both
    stores require it, and they mean deleting: the account and the personal details that go
    with it, except the records the law says must be kept. What an admin's "close" does today
    is not that. It locks the account, keeps almost everything, and can be undone. So:
    - Deleting uses the clean-up that closing already has (waiting requests end, memberships
      and contributions end, the photo goes), adapted for a person doing it to themselves.
    - **It is not a way out of what was agreed.** An admin's closing cancels every coming call
      at no charge. A customer who deletes their account with a call booked is treated as
      cancelling it themselves, so a late cancellation costs what it would have cost. A host's
      coming calls are cancelled free for the customers, as when a host cancels.
    - **Money owed is still paid.** A host's earnings that are not collected yet are not lost.
    - It is not offered during a call; the call ends first.
    - Before confirming, the person is told plainly what happens, what is kept and for how
      long, and that it cannot be undone.
    - Google also wants a page on the website where someone can ask for deletion without the
      app, linked from the app's store listing. The website's own delete button is that page.
    - This is for customers and hosts. An admin's account is not deleted this way.
    The part plan settles the details: exactly which records are kept and for how long (the
    lawyer's question), how long the wiping takes, and how a host's last money is sent.

11. **The server gets a door for the app.** Today most of the server's work can only be asked
    for by the website's own pages (108 functions in 25 files; about 64 of them are for
    customers and hosts). The call already has proper addresses. For the app, each thing it
    needs is offered at an address of its own, inside the same server. The rules are not
    written twice: the website's function and the app's address both call the same shared
    code. The checks on who may do what, on doing a thing twice, and on money stay where they
    are. The app gets its own signed-in way of asking, one that another website cannot use
    through a person's browser login. The protection for browsers (the "is this our own
    page?" check) stays on, and so do the checks on a confirmed email, age and terms, a paused
    or closed account, and who may do what. How exactly is for part 3's plan.

## The parts, in order

Each part: its own plan, Astra's check, the build, Astra's review, a pull request, CodeRabbit,
green checks, merge, a note in `docs/module-record.md`.

1. **Deleting your own account.** On the website first. Needs no phone, and is right to have
   whatever happens with the app. Can be built before launch.
2. **A test app: sign in and make one video call, on a real iPhone and a real Android phone.**
   The riskiest piece first. It shows whether the newest Expo, LiveKit, Stripe and better-auth
   kits work together (better-auth's guide is written for an older Expo), and what happens to
   a call when the phone locks, a headset connects, or the network changes.
3. **The door for the app's first screens**, and the list of phones to notify.
4. **The customer's journey:** search, a host's page, book, pay, the calls list, join, rate.
5. **Notifications, "available now" on a phone, and a host answering requests.**
6. **Memberships in the app, following, refunds, notes, report and block, the account page.**
7. **The store listings and the reviews**, with test accounts and the notes for reviewers.

## What only the founder can do

- **An iPhone and an Android phone** to try calls on. The simulators on this Mac have no real
  camera. Part 2's test needs only the phones: Apple lets a free account put a test app on
  your own iPhone, and an Android phone takes one straight from this Mac.
- **An Apple developer membership** (about $99 a year) and **a Google Play developer account**
  (about $25, once), for putting the app in the stores and, as far as the builder knows, for
  notifications on an iPhone (part 5). Both cost money, so the builder asks before anything
  is signed up. To be confirmed at sign-up: Apple lists an app under a company's name only
  for a registered company; without one it is listed under the founder's own name.
- The lawyer's look at what deleting an account must wipe, and which records must be kept
  and for how long.

## Not in this plan

- Group calls. They would lose the stores' one-to-one rule and the 4.9%.
- The phone's real call screen. To look at again only if hosts miss too many requests.
- Google or Apple sign-in in the app; a tablet layout; messaging.

## What could not be checked

- Nothing was tried on a real phone.
- Whether a store's reviewer accepts memberships paid with Stripe. Only a review answers that.
- Whether Apple's free pass for a link to a website payment in the United States lasts: the
  Supreme Court hears that case on 11 January 2027. This plan does not lean on it.

## Astra's check (19 November 2026): "ready with changes"

All eight points were read against the code by the builder, found right, and taken.

1. *"Closing" must mean deleting.* Today's closing is a lock that can be undone; both stores
   require deletion, and Google a web page for it. Decision 10 now says so.
2. *Reusing the admin's closing would let a customer out of a late cancellation for free*, and
   would leave a host's uncollected money unsaid. Decision 10: agreed payments stand, money
   owed is paid, not during a call.
3. *"Available now" needed one rule for the website and the phone together, and for several
   requests at once.* Decision 9: one status, started in one place; the first unanswered
   request ends the period and the others waiting in it; the clocks do not change.
4. *The alert promised more than a notification can.* Decision 8 now says what Connect asks
   for and what the phone decides, and no longer says Apple forbids the call screen: leaving
   it out is a choice.
5. *The membership fallback was not sure to satisfy a store.* Decision 6 now has two steps.
6. *A customer who needs the ID check had no way through.* Decision 4: on the website, then
   back to the app.
7. *Sign-in alone does not tell the app from a browser.* Decision 11 reworded.
8. *Projects show inside pages the app will have, and the reason given for leaving them out
   was wrong in part* (Apple allows other ways of paying in some regions). Decision 4 names
   the places and gives the real reason: one rule everywhere.

Checked by Astra without a change: the two stores' one-to-one rules do cover Stripe for calls;
email-and-password sign-in needs no "Sign in with Apple"; the "forgot password" email does give
a password to someone who joined with Google; the order of the parts.

**The second check, the same day, of the changed plan: "ready with changes".** All eight
points had landed. Three new ones, all read against the code or Apple's page and taken:

1. *"Available now" must not demand notifications.* Apple's rule 4.5.4: an app may not need
   them to work. Decision 9: such a phone follows the website's rule. (Astra proposed only a
   warning; the builder chose the website's rule, so a customer is not shown a host who
   cannot see the request.)
2. *The plan misdescribed today's switch-off.* A booked call coming up does not switch the
   status off; it only limits which lengths are offered. Decision 9 corrected.
3. *Store accounts are not needed for every test.* Decision 2 and the founder's list corrected.

Astra also confirmed that the new rules leave no customer with held money or a request that
nothing cleans up, and that a host's last earnings need a real collection before deletion,
which part 1's plan must provide.

## Where the facts come from

- Apple, deleting an account:
  https://developer.apple.com/help/app-review/guideline-reference/5-1-1-account-deletion
- Google Play, deleting an account:
  https://support.google.com/googleplay/android-developer/answer/13327111

- Apple's App Review Guidelines, 3.1.1, 3.1.3(d), 3.2.1(vii), 4.2 and 4.8:
  https://developer.apple.com/app-store/review/guidelines/
- Google Play, "Understanding Google Play's Payments policy" (1:1 services; tips):
  https://support.google.com/googleplay/android-developer/answer/10281818
- Apple, the call screen and its notifications:
  https://developer.apple.com/documentation/pushkit/responding-to-voip-notifications-from-pushkit
- Apple, notification sounds (under 30 seconds):
  https://developer.apple.com/documentation/usernotifications/unnotificationsound
- Apple, "time sensitive" notifications:
  https://developer.apple.com/documentation/usernotifications/unnotificationinterruptionlevel/timesensitive
- Google Play, full-screen alerts only by default for calling and alarm apps:
  https://support.google.com/googleplay/android-developer/answer/13392821
- Firebase, urgent messages on Android:
  https://firebase.google.com/docs/cloud-messaging/android-message-priority
- LiveKit's kit for Expo: https://docs.livekit.io/transport/sdk-platforms/expo/
- Expo, showing web screens inside an app, and its limits:
  https://docs.expo.dev/guides/dom-components/
- better-auth's kit for Expo: https://better-auth.com/docs/integrations/expo
- In the code: "available now" in `src/app/host/now/now-panel.tsx`, `src/lib/booking/now.ts`
  and `src/app/api/host/now/route.ts`; closing an account in `src/lib/profiles/closing.ts`;
  who is signed in, in `src/lib/session.ts`; the "our own page?" check in `src/lib/same-site.ts`.
