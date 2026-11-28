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
**On 27 November 2026 every part that is not built yet (09b to 20) was read against the code
again,** after 26 pull requests (98 to 123) had been merged since part 09, and brought up to
date; Astra checked that update twice (the account of both checks is below). The account is in
"Brought up to date on 27 November 2026" below.
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
    and reviews (wait for the accounts), tablets, Google or Apple sign-in. (Messaging was on
    this list until the website got it, plan 49; it is now part 17b.)

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
| 09a | Before going on: what is already built, put right (added 27 November) | Plan 51's screens walked on the phone; seven small faults gone |
| 09b | During the call: a locked phone, connection grades, more time, the chat | A longer call |
| 09c | The connection check before a call | A warning when the connection is poor |
| 10 | After a call: the results, the receipt, rating, following, the note | The page after a call, both sides |
| 10b | Refunds | From asking to the money coming back |
| 11 | "Available now": the host's switch and the customer's "call now" | A call within minutes |
| 12 | Notifications | Reminders and the "call now" alert, switched on when keys exist |
| 13 | Memberships, the member's side | Join, pay monthly, book as a member |
| 13b | Memberships, the host's side | Her offer and her members |
| 13c | Cancelling a new membership within 14 days (added 26 November, after plan 46 part 3c) | The member's button, as on the website |
| 14 | Becoming a host: the profile and the photo | A new host has applied, from the app |
| 14b | The payout account, a host's ID check, proving a social account | A new host is ready |
| 15 | A host's hours and rules | The calendar settings |
| 16 | A host's earnings | "Collect earnings" |
| 16b | Money a host owes back (added 26 November, after plan 46 part 3a) | The list, one amount's screen, "I think this is wrong" |
| 17 | Contacts, invitations, the Following page | The rest of both roles' lists |
| 17b | Messages between a host and a customer (added 27 November, after plan 49) | Two people write to each other, one on a phone |
| 18 | The account page, blocking, the legal pages, paused accounts | Settings |
| 19 | Deleting your own account: the request, the lock, coming calls | Built, but shown to nobody yet |
| 19b | Deleting your own account: settling the money | A host's last earnings reach her |
| 19c | Deleting your own account: the wiping | The button can be switched on |
| 20 | The whole journey, and getting ready for the iPhone build and the stores | One walk through everything |

Thirty-one parts (13c and 16b were added later, by the builder of plan 46; 17b was added on
27 November by the builder of plan 49, and needs only parts 01 to 09; 09a was added the same
day, when the plans were brought up to date). Order: 01 to 03 first, because everything stands on them. Then the
customer's journey to a finished call (04 to 10b), then the rest. Part 11 comes before part
12 and works without it (in the app, "available now" then follows the website's rule); the
locked-phone rule comes alive only when part 12 is switched on. A part can be merged while
later parts are unbuilt: the app is on no phone but the test phone until part 20.

**Every plan written on 20 November was checked by Astra twice, and many were first found
"not ready".** What the first check found is listed at the end of each part; what the second
found is listed at the end of this plan. The parts added later were checked differently:
17b twice by its own builder's Astra; 13c, 16b and 09a only as part of the update of 27
November, and 13c and 16b once more before they are built. The website's pages hold far more states and rules
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

## Brought up to date on 27 November 2026

The build has been paused before part 09b since 20 November, on the founder's word. In that
week 26 pull requests (98 to 123) changed the website. Among other things it gained: money a
host owes back after a refund or a lost bank dispute, with her objection (plans 46, 47, 50);
Connect collecting for a host who has not collected for 12 months; cancelling a new
membership within 14 days; messages between a host and a customer (plan 49); "End call now"
with its three choices (plan 51); an account paused by the app itself, with memberships that
are paused and can be resumed at their old price (plans 52, 53, 55). The founder, 27
November: "update all the plans first, then when we do each part, check the plan once more,
update each plan right before building it if necessary."

**What was done.** Each plan from 09b to 20 was read against the code on `main` after pull
request 123 and changed where the code says otherwise. Each changed plan ends with a list,
"Brought up to date (27 November 2026)", and, where Astra's check changed it again, a second
list. Nothing was built.

- **Changed much:** 10 (the page after a call), 12 (notifications), 13 and 13b (memberships),
  14 (becoming a host: the Host Agreement, "business or private", a top price), 16
  (earnings), 18 (the account page), 19, 19b and 19c (deleting an account), 20 (the walk).
- **Changed a little:** 09b, 10b, 11, 14b, 17; and the three plans other sessions wrote (13c,
  16b, 17b), which were read and given what the newest changes added.
- **Read, nothing to change:** 09c, 15.
- **New:** part 09a, a small part that puts right what is already built (below).

**A mistake in the first pass, said plainly.** The first comparison was made against the day
part 09 was merged, not against the day the plans were written. Changes merged between
those two days (the agreements of plan 46, a top price per host, the yearly statement) were
therefore missed for parts 14 and 14b, whose notes first said "nothing changed". Astra's
check found it; both parts are corrected. The comparison for the other parts was made again
from the right day.

**Found in what is already built** (all of it is part 09a's):

- The app's screens for "End call now" were built by another session without a phone.
- A sentence that names a monthly contribution is sent to the app, in two places.
- A paused person is shown the reason as the team typed it, which can be about a project.
- The placeholder Account screen prints the switches, the word "Tips" among them.
- A refusal for a bank dispute points to "your messages", which in the app will be the
  conversations between people.
- A paused or blocked person can be offered a step that will only be refused; a paused
  customer's details still show in a host's list for a moment; and two steps can still be
  taken in that moment.
- The app's last step of signing up does not say that a new version of a document is coming
  (the website's does).

**The rule for the apps, as it stands after four checks.** The founder's rule is that the
host's project and everything about it stay out of the apps, so that the 4.9% is safe; tips
stay out while their switch for the apps is off. Put exactly:

- **Nothing in the apps is about a project, a contribution, a diary or a tip.** No screen, no
  sentence, no link, no entry, no notification, and no way to do anything with one. That
  covers things with a name and things without: money owed back for a contribution is not
  an entry "without a name", it is not there.
- **"Other earnings" is a group without a name on a host's earnings screen** (part 16,
  decision 5). Her money is counted there in full, in what is ready, what is waiting and
  what was collected; nothing says what the group is made of.
- **A thing that is about a call is shown as it truly is,** also when other earnings touched
  it: a call's receipt, money owed back for a call, a collection with a call in it. The app
  works out no "as if the other money did not exist".
- **Words that would point at a cause the app cannot name are made neutral** (a refusal
  after a bank dispute, a moment when nobody can collect).
- The website and the emails keep everything.

**Said plainly, for the founder:** in the first three checks the builder let this rule grow
into something else, that a phone must behave as if contribution money did not exist at
all. Astra followed that faithfully, and its fourth check showed where it leads: hiding a
25-cent difference on a call's payout line, or holding a notification back because a
contribution's transfer was slow. That is not needed for the 4.9% (a store looks for
something that is sold or advertised in the app, not for arithmetic), it could never be
finished, and it would have made every money screen much dearer to build. It is withdrawn.
The points of the fourth check that rested only on it were not taken (a call's receipt, a
call's debt, the timing of a notification); the rule above is the one the parts are written
to now. **If the founder wants the stricter reading after all, this is the place to say
so.**

**For the founder to decide** (nothing waits for these until the part in question is built):

0. *The rule itself* ("The rule for the apps", above): by what a thing is about, as written
   there, or the stricter reading that was withdrawn.
1. *A notification when Connect itself writes to someone* (part 12, decision 2a): the phone
   says only "Connect has written to you.", for a short list of causes (a bank dispute over a
   call that waits for the host's choice, money owed back for a call, a collection Connect
   started). The builder would have it; the other way is email only, as today.
2. *A bank dispute's own page in the apps* (proposed as part 16c; parts 16b and 20): today
   that choice is on the website only. Building it is a part of its own.
3. *Part 17b's four choices that are only its builder's:* "Messages" as a fifth place at the
   bottom; a notification that names nobody; a person's own switch for it; the apps' switch
   for messages.
4. *The legal documents in the app* (part 18, decision 5): no way of showing them keeps the
   apps' rule yet, and three places in the app already lead to them. With the lawyer.
5. *Deleting an account,* with the lawyer: a debt or a bank dispute that begins after a host
   has left (part 19b, decision 9); what, if anything, may follow a person who comes back
   with the same email address (part 19c, decision 3a); whether the other person may keep
   reading what a deleted person wrote (part 19c's table).

No longer on this list: the yearly statement. It stays on the website (part 16, decision 7).

**Astra's check of this update (27 November 2026): "not ready".** Twenty-two points that had
to be fixed and seven smaller ones; each is answered in the part it belongs to, under
"Astra's check of this update". In short: seven were ways a contribution's or a tip's money
could still reach a phone (the statement, money owed back, notifications, the screen before
deleting, two sentences and a reason in what is built); eight were about deleting an account
(today's closing would undo what was agreed, the 14-day right, a bank dispute's choice, debt
deadlines, collections and refunds under way, proof for open cases, ratings, a returning
person); the rest were statements about memberships, the page after a call, hosts and
earnings that said more or less than the code does.
**One point was not taken:** removing the tips switch for the apps altogether. That switch
is the founder's plan of 20 November (plan 44, decision 18): born off, and turned on only
after a store has said yes. What was taken from that point: nothing prints the switch on a
screen (part 09a, decision 4), and part 20 proves that with the apps' switch off the
website's own tip switch changes nothing on a phone.

**Astra's second check, the same day: "not ready" again, narrower.** Thirteen points to fix
and eight smaller ones; seven points of the first check were found fully answered, the
refusal of the tips switch among them. What it added: a refusal that says "a bank dispute"
can itself come from a contribution (part 09a, decision 5); one call share in a collection
does not show why the collection happened (part 16, decision 5); the list of booked
requests never asked about a pause, and two steps could still be taken while a pause was
being tidied up (part 09a, decision 6); the notice of a coming document version at sign-up
had no owner (part 09a, decision 7); and, for deleting an account, a member inside the 14
days whom a bank stops, money owed *to* a host, the notices and the time of an objection,
the lock that the wipe itself must not empty, proof for disputes over memberships and
contributions, and another person's block (parts 19, 19b, 19c). Each is answered in its
part under "Astra's second check".

**Astra's third check, the same day: "not ready", sixteen points and three smaller.** Twelve
points of the second check were found answered. One of the sixteen was the builder's own
slip: an edit of the second round had cut three older decisions out of part 19; they are
restored word for word. The others: on the earnings screen, how "the calls alone would have
caused it" is really asked, and three more ways a hidden collection could show (part 16,
decision 5); a request that may no longer be acted on leaves the other person's list
altogether, and two more steps had a weaker gate (part 09a, decision 6); a document
version's free-text summary must not reach the sign-up screen (part 09a, decision 7); and,
for deleting an account, the calls of a stopped 14-day case, a second look that must not
show on a phone, what is known before and after the press, which debts can be objected to
and until when, a case's closing notice, the people's real details in every kind of proof,
and what becomes of a pause (parts 19, 19b, 19c).

**Astra's fourth check, the same day: "not ready", seventeen points and one smaller.** Four
points of the third check were found fully answered, and no decision is missing from any
part any more. Three of the seventeen rested on the stricter reading of the rule and were
not taken (above). The others were taken: a 14-day request that is already on record when
a member deletes later; the address kept until nothing more can follow from a case; the
proof for a bank dispute copies exactly what it reads and no more; one list of what the
app shows before a deletion; a debt can be objected to while it is "told"; the note on a
request, and the look into a room, follow the request; part 09a names the three checks
that must stop expecting today's faults; the link of the sign-up notice follows part 18;
a typed reason in the founder's record; two expectations of the refunds check; what is
known before and after pressing "Cancel within 14 days"; the floor under a host's price
(parts 09a, 12, 13c, 14, 16b, 19, 19b, 19c).

**What stays as it was.** Each part is still read against the code on the day it is built, and
its plan put right once more if the code has moved. Parts 13c, 14b, 16b, 19, 19b and 19c go
to Astra with their code-level plan before they are built.

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

## CodeRabbit's review of these plans (pull request 75, 20 November 2026): nine points, all taken

Each was read against the code or the plans by the builder first.

1. *The lawyer's file gave a 30-day rule and a 3-year rule that contradicted each other.* The
   exceptions to the 30 days are now named.
2. *Part 08: a coming call far ahead would not show in the Calls place,* because the home page
   reads only the soonest three and the days around the one in view. The Calls place gets its
   own reading of all coming calls.
3. *Part 10b: a host giving money back without a request had no address.* Added.
4. *Part 13: a payment could slip in while the switch was being turned.* New payments are
   refused from the first moment, then the unfinished ones are ended.
5. *Part 14: a photo taken from Instagram or TikTok also goes to the checking services,* so
   the same yes is asked first.
6. *Part 19c: an email still waiting must not go out with its text erased.* It is sent first.
7. *Part 19c: today's yearly clean-up clears the texts of a refund request that is still
   open* (true: `forgetOldRequests` does not look at whether it is open). It is put right
   with that part, for the website too.
8. *Part 20: the membership sweep expected "no charge" in every position,* which would have
   failed the position in which charging is right. Now said per position.
9. *Part 20: the switch check would have required cancelling to disappear too.* The two
   things a member always keeps are named.
