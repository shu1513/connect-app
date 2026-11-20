# Plan 45: The phone apps, built now and in full

**Status:** the rulebook for the build. Written 20 November 2026 by the builder alone (no helper
agents), from the code as it is on `main` after pull request 74, and from what the founder said
that day. Astra checked it and every part twice. The first time: nine parts "not ready", the
rest "ready with changes". The second time, after the rewrite: five "not ready" (parts 01,
09c, 14b, 19 and the wiping), one "ready", the rest "ready with changes". Every point of
both rounds was read against the code and worked in. Because the two parts with the most new
security and money work changed again after the second check (14b and 19 to 19c), each of
those is shown to Astra once more, with its code-level plan, just before it is built.
It replaces two decisions of plan 39 (a small app; built after the website is live) and
keeps the rest of plan 39, which is still the place to read *why* each store rule matters.
Each part below has its own detailed plan in `plans/45-phone-apps/`, checked by Astra before it
is built.

## For the founder: what this is

Plan 39 said: a small app, after launch. On 20 November you changed that: build the iPhone and
Android apps now, with everything the website has except the things that would cost the 4.9%.

- **One product.** The apps talk to the same server and the same database as the website. Same
  accounts, same calls, same money, same rules. Nothing about money or about who may see what
  is ever worked out inside an app: the server decides and the app shows it.
- **One set of app code makes both apps** (iPhone and Android).
- **It is built in small parts**, each with its own plan, Astra's check, a pull request, and
  green checks before it is merged. The list is below. After every part the website must still
  pass all of its own checks.
- **What cannot be proven yet.** This Mac's Xcode is too old to build the iPhone app, and there
  are no store accounts. So every part is tried on the Android test phone on this Mac. The
  iPhone app is built from the same code once the Mac is upgraded. Real cameras, a call between
  two real phones, and notifications that really arrive need real phones and the accounts.

## What the founder said (20 November 2026)

- "I want you to build the mobile version for IOS and android. including all features we have
  here in the web version (minus the contribution gofundme thing which would break the 4.9%)."
- "break the plan into small pieces, as many small steps as you need, and detail plan on each
  step, like we did before, then build each one using the workflow."
- "don't worry about signing into apple or android developer yet, just build the mobile apps
  from the web app. carefully."
- The admin pages: "Yes, website only".
- "since we won't have the contribution to the gofundme equivalent thing on mobile, the homepage
  shouldn't display any diary or newsfeed from those either"
- "only reason I leave the host's project and all its related things is so we keep the 4.9%
  charge. so keep an eye on that"
- Tips: "we can let the gift 100% goes to the receiver"; and the tip feature "should be on a
  feature flag so I can turn it on and off. I hope this does it for mobile too."
- The Mac: "use the current xcode i have for now".
- "use your own best judgement ... don't ask me for anything ... be careful"

## The rule above all the others: keep the 4.9%

Every part's plan answers one question before anything is built: *could this make Apple or
Google ask for their cut?* Today's answers:

| Thing | In the apps? | Why |
| --- | --- | --- |
| A one-to-one call, booked or "now", and more time during a call | Yes, paid with Stripe | Live, between two people, never recorded: Apple 3.1.3(d), Google's "1:1 online paid service". |
| Memberships (prepaid one-to-one talk time) | Built, behind a switch with three positions; **the founder chooses its position before each store's first review** | Likely fine, not certain: member-only times and instant booking could be read as bought features. Hiding "Join" alone does not settle that (part 13). The 4.9% itself is not at risk: if a store objects, memberships leave the apps and stay on the website. |
| Projects: the diary, contributing, the ask after a call, diary posts on the home page, the "diary emails" choice | **No, nowhere** | Connect keeps a share of a contribution, so a store would want its own payment. The founder's decision. |
| Tips | **No, for now**, behind a switch that is off | Google frees a tip when 100% goes to the receiver and it unlocks nothing. Apple asks for its own payment for a gift that is tied to a service, and a tip follows a call. So tips after a call stay off. |
| Words or links that point to paying on the website | **No, anywhere** | Connect's own choice, one rule for every country. (Apple allows such links in its US store today, and Google has a US programme with its own sign-up and fees; neither is used.) |
| Group calls | Not built | They would lose the one-to-one rule. |
| Admin pages | No | The founder's own tool; "website only". |

If the stores' rules change so that projects or tips could be in the apps without the cut, the
founder is told. (The US Supreme Court hears the Apple case on 11 January 2027; a hearing is
not yet a new rule.) A payment feature that a switch can turn on is described in what is
sent to the stores' reviewers, and they are given a way to see it; nothing is slipped in
afterwards.

## Decisions (the builder's, on the founder's "use your best judgement"; any can be changed)

1. **React Native with Expo (version 58), in TypeScript**, in this repository, in its own folder
   `mobile/` with its own list of libraries. The website's own install, build and checks do not
   change. (Plan 39, decision 1, for the reasons.)

2. **Everything the server decides, the app only shows.** Prices, fees, who may see what, what a
   host earned, whether a button is offered: all of it comes from the server, each time. An app
   cannot be changed once it is on a phone, so no rule lives in it.

3. **The door for the app: one address for each thing the app needs, under `/api/app/`.** The
   website's pages and the app's addresses call the same shared code, so a rule is written once.
   Where a page works its data out inside itself today, that work moves into a shared function
   and the page calls it; the page's own checks must pass unchanged. The app never calls a
   website page or one of its form functions.

4. **Signing in from the app** uses better-auth's own kit for Expo: the phone keeps the sign-in
   in its secure store. An app address is refused unless the request comes in the app's way, so
   another website cannot use it through someone's browser. Email and password, with the
   two-step code, as plan 39 decided. No Google sign-in in the app.

5. **Switches the founder can flip without a new app version.** The app asks the server on
   opening, and again from time to time, what is on: memberships in the apps (on; on but no
   joining; off), tips in the apps (off), "available now" in the apps, and the oldest app
   version still allowed to run. A thing that is off is not shown *and* is refused by the
   server, so an old copy of the app cannot reach it. The website's own switches still rule
   first. Tips reach the apps only if the website's tip switch (plan 44) and the apps' own
   both allow it, so tips can be on for the website while Apple's rule is unsettled. One set
   of switches covers both apps.

6. **A browser sheet inside the app where an outside company needs its own page:** the ID
   check at Stripe, the payout account at Stripe, proving an Instagram or TikTok account.
   Nothing is paid for in such a sheet, so the stores' payment rules are not touched. Three
   rules, which must hold whoever, if anyone, is signed in to Connect in that browser:
   - **No sign-in to the website is needed or carried into the sheet.** Today the pages that
     Stripe sends a person back to ask for a signed-in browser; for something started in the
     app they lead instead to a fixed page that needs no sign-in, takes nothing from its
     address, shows no result, changes nothing, and only offers "Return to Connect".
   - **The app never believes the sheet.** When it comes back to the front it asks the
     server, and the server asks Stripe, TikTok or Meta itself.
   - **A social sign-in started in the app can only be finished by that same app, signed in
     as the same person.** Today the browser that started it proves that with a cookie. An
     app-started one is tied to a secret the app made and keeps; the page in the sheet
     attaches nothing and hands the phone a once-only ticket through a link only the real
     app can open; the app finishes it through the door with ticket and secret together
     (part 14b).
   The ID check is needed first by a customer who books (part 06), so the sheet and the ID
   check are built there and used again for hosts.

7. **Paying by card in the app** uses Stripe's own kit for phones, on the same server payment
   steps the website uses (the saved card, the hold, the taking, the bank's approval step).

8. **The call in the app** uses LiveKit's kit for phones, in the same rooms, with the same
   server rules on who may enter and when. Time together is counted by the server, as today.

9. **Alerts.** Plan 39's decisions 8 and 9 stand: ordinary notifications, no phone-call ring;
   "available now" on a phone stays on while it is locked; one unanswered request switches it
   off. Sending real notifications needs keys from Apple and Google that only the founder's
   accounts can make, so the notification part is built up to that point and is switched on
   when the keys exist. Until then the app shows requests while it is open, as the website does.

10. **How the app looks:** the website's warm look, rebuilt with the phone's own parts (not web
    pages inside the app). One small set of shared pieces (page, card, button, field) so every
    screen looks the same. Light and dark, large text, and screen readers are respected.

11. **How each part is tried.** For the server side: a check script per part, in the style of
    the existing ones, plus the existing scripts for the website. For the app: its own type
    check, tests of its plain logic, and a walk through the screens on the Android test phone
    with pictures taken of each. The automatic checks on GitHub get a second job for `mobile/`.

12. **Deleting your own account** (plan 39, decision 10) is part of this build, for the website
    and the apps together.

13. **Not built now:** the iPhone build itself (waits for the Mac's upgrade), the store listings
    and reviews (wait for the accounts), tablets, Google or Apple sign-in, messaging.

## The parts

Server and app are built together, part by part, so that after each part something whole can
be tried. Each part's plan is `plans/45-phone-apps/NN-name.md`.

| # | Part | What can be tried when it is done |
| --- | --- | --- |
| 01 | The door: signing in from an app, the app's addresses, the switches | A check script signs in as an app would and is refused in every wrong way |
| 02 | The app's frame: the project, the look, moving between screens | The app opens on the Android test phone |
| 03 | Signing up, signing in, the two-step code, forgotten password, "18 and terms" | A person gets from a new install to the home page |
| 04 | The home page, as a customer and as a host; photos | Next calls, the calendar, requests, suggested hosts |
| 05 | Search and a host's page, following | Find a host, read her page, follow her |
| 06 | Asking for a booked call, saving a card, the ID check | A request reaches the host |
| 07 | A host's requests: accept, decline, block | The call exists |
| 08 | A call's page: paying, the countdown, cancelling; past calls | The money is held; the room opens |
| 09 | The call: entering, talking, leaving, "end and report", the report form | Two people talk |
| 09b | During the call: a locked phone, connection grades, more time, the chat | A longer call |
| 09c | The connection check before a call | A warning when the connection is poor |
| 10 | After a call: the results, the receipt, rating, following, the note | The page after a call, both sides |
| 10b | Refunds | From asking to the money coming back |
| 11 | "Available now": the host's switch and the customer's "call now" | A call within minutes |
| 12 | Notifications | Reminders and the "call now" alert, switched on when keys exist |
| 13 | Memberships, the member's side | Join, pay monthly, book as a member |
| 13b | Memberships, the host's side | Her offer and her members |
| 14 | Becoming a host: the profile and the photo | A new host has applied, from the app |
| 14b | The payout account, a host's ID check, proving a social account | A new host is ready |
| 15 | A host's hours and rules | The calendar settings |
| 16 | A host's earnings | "Collect earnings" |
| 17 | Contacts, invitations, the Following page | The rest of both roles' lists |
| 18 | The account page, blocking, the legal pages, paused accounts | Settings |
| 19 | Deleting your own account: the request, the lock, coming calls | Built, but shown to nobody yet |
| 19b | Deleting your own account: settling the money | A host's last earnings reach her |
| 19c | Deleting your own account: the wiping | The button can be switched on |
| 20 | The whole journey, and getting ready for the iPhone build and the stores | One walk through everything |

Twenty-seven parts. Order: 01 to 03 first, because everything stands on them. Then the
customer's journey to a finished call (04 to 10b), then the rest. Part 11 comes before part
12 and works without it (in the app, "available now" then follows the website's rule); the
locked-phone rule comes alive only when part 12 is switched on. A part can be merged while
later parts are unbuilt: the app is on no phone but the test phone until part 20.

**Every plan here was checked by Astra twice, and many were first found "not ready".** What
the first check found is listed at the end of each part; what the second found is listed at
the end of this plan. The website's pages hold far more states and rules
than a first reading shows, so each part is read against the code once more, line by line,
just before it is built, and its plan is put right (and shown to Astra again) if the code
says otherwise.

## Working beside the other sessions

- One local test database is shared. Before any check script: look for another session's script
  or server, and take turns.
- The tip feature (plan 44) was being built while this was written. This plan touches none of
  its files. When it is merged, part 01's switches read its switch, and part 10 leaves the tip
  box out of the app's page after a call.
- Plan numbers: this plan's parts live in their own folder, so they cannot clash with another
  session's next plan.

## What only the founder can do, and when it starts to matter

- **Upgrade this Mac** (macOS, then Xcode 26.4 or later): before the iPhone app can be built.
- **A Google account for notifications on Android** (free; it is enough to try real
  notifications on the test phone, before any store account), **an Apple developer membership
  (about $99 a year)** for notifications on iPhone and for the App Store, **a Google Play
  account (about $25, once)** for the Play store: before part 12 can be switched on and before
  part 20's last step. All cost money or need the founder's own sign-in, so nothing is signed
  up without a yes.
- **Two real phones:** for the first real call between apps, with real cameras.
- The lawyer's points are in `docs/for-the-lawyer.md` (plan 39 added them).

## What could not be checked

- Nothing here was tried on a real phone, and the iPhone app cannot be built on this Mac yet.
- The newest Expo, LiveKit, Stripe and better-auth kits install together and build into an
  Android test app (tried on 20 November). Whether that app starts and each kit works on a
  phone, and the kind of build that goes to a store, part 02 finds out first.
- Whether a store's reviewer accepts memberships paid with Stripe: only a review answers that.

## Astra's second check (20 November 2026), part by part, all worked in

- **01:** an ordinary app request could use up the renewal the phone needs; emailed links
  must only lead to the website; a closed account on a public address is a guest.
- **02:** the exact versions tried, and what is still unknown, are written down.
- **03:** the server itself refuses any other destination for the emailed links.
- **04:** the photo address answers guests, gives no founder's view, and its keeping rules.
- **05:** open times are in the viewer's zone; the host's time is on the booking summary.
- **06:** one once-only key per summary screen, not per press; the box is for paid calls; the
  ID check's return page can do no harm.
- **07:** the list's privacy rule applies wherever a waiting request is opened; instant
  requests in the list are answered the instant way.
- **08:** the server already works the cancellation out afresh; what is added is comparing it
  with what the person saw. Reading a call's page changes nothing.
- **09:** who is put out when a second device enters; what the report form takes; sharing
  the phone's screen named as a difference.
- **09b:** which saved card pays for more time; a repeated grade is kept once.
- **09c:** the browser judges the connection itself, nothing is sent; whether a phone can do
  the same must be proven first.
- **10, 10b:** when the money is taken and until when a call can be rated; one request per
  call; what the host is shown in each state; a founder who hosts answers as a host.
- **11:** which tab or phone started a period; a period ends at the unanswered deadline
  itself.
- **12:** booked requests are told when the gathered email is made, not each at once;
  signing out ends what was waiting; a message can come twice or never.
- **13, 13b:** any new paid terms are refused in the middle position; a card sheet already
  open is ended before a stricter position counts; one setting for both stores; what a host's
  offer really consists of.
- **14, 18:** the person agrees before a photo goes to the checking services, and those
  services stay named in the apps' privacy page; the terms are the same everywhere.
- **14b:** the answer is tied to the attempt on our own page, and the ticket reaches the app
  through a link no other app can claim.
- **15:** a cut that would withdraw an invitation, and making hours members-only, are refused
  while memberships are not fully on for the apps.
- **16:** the website's amount was right and only its caption wrong; the charge is "up to" 25
  cents.
- **19, 19b, 19c:** the existing lock plus a mark that never comes off; the costs checked
  again and written down per call at the press; an emailed link deletes nothing by being
  opened; the last collection without its charge; the made-up address different each time; a
  paid contribution keeps an empty project; open cases keep their evidence; ratings follow
  today's rule; the email after the wipe.
- **20:** the sweep makes things happen and reads what is written for the phones; the list
  of differences from the website; Google's 12 testers for 14 days in a row.
