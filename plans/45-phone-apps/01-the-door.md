# Phone apps, part 01: the door for the app

**Status:** a plan only. Written 20 November 2026 by the builder alone, from the code on `main`
after pull request 74. Part of plan 45. Astra checked it once ("not ready"); every point was
read against the code and is worked in (the list is at the end). Nothing here shows on any
screen: it is the server's side, on which every later part stands.

## For the founder: what this is

Today almost everything the server does can only be asked for by the website's own pages. A
phone app is not a page; it needs addresses of its own. This part builds the first one, and
the rules every later address follows:

- an app can **sign in** and stay signed in;
- the server can tell **a request from the app** from one that a strange website sent through
  someone's browser, and refuses the second;
- the app can ask **"who am I, and what is switched on?"** when it opens;
- you get **switches for the apps** on the admin page.

## What is there today (read in the code)

- Sign-in is better-auth, version 1.7.18 (`src/lib/auth.ts`), with its addresses under
  `/api/auth/`. Email and password, the email must be confirmed, Google if its keys are set, a
  two-step code that only admins can set up (`/admin/secure`) but that the sign-in asks of
  anyone who has one. Some of its addresses are switched off on purpose (`UNUSED_LOGIN_PATHS`
  in `src/lib/auth-rules.ts`). Its sign-in cookie belongs to this site only, cannot be read by
  a page's code, and is not sent with a form posted from another site.
- "Who is signed in" is `getSignedIn()` in `src/lib/session.ts`: it reads the request through
  the framework (`headers()`), then our own fields from the database, and remembers the answer
  for the rest of that page (`cache`). On top of it: `getUser()` (email confirmed, "18 and
  terms" done, not closed), `requireUser()` and `requireActiveUser()` (which send a browser to
  another page). The website's pages do not all ask for the same thing: search and a host's
  page are open to someone who is not signed in; the "18 and terms" step is for someone who is
  signed in but has not done it yet.
- The check "did one of our own pages send this?" is `fromThisSite()` in `src/lib/same-site.ts`.
  It stays as it is.
- The founder's switches are one row, `site_switches`, read by `switches()` and saved by
  `setSwitches()` in `src/lib/safety/switches.ts` (which changes only the fields it is given),
  on `/admin/reports`. The newest database change on `main` is `0046`. The tip feature
  (plan 44) adds `0047` with a switch of its own, `tips_off`.

## Decisions (the builder's)

1. **better-auth's own kit for Expo is added to the server,** `@better-auth/expo` at exactly
   the version of `better-auth` in use (1.7.18), and the app's own name (`connect://`) is added
   to the origins better-auth trusts, beside the ones already there. This is the one change to
   the website's list of libraries. What the kit does on the server: when a request has no
   "where from" of its own, it takes the app's; a browser's own "where from" is never
   replaced. It also adds one address of its own (for outside sign-ins like Google, which the
   app does not use). The switched-off addresses stay switched off. **Trusting the app's name
   must not let an emailed link lead into an app:** the links for confirming an email address
   and for a new password carry a sign-in or a reset key to wherever they point, so the
   server accepts only Connect's own website as their destination, both when the email is
   asked for and when the link is opened. All of this is checked by the script below, not
   assumed.

2. **The phone keeps the sign-in in its secure store** and sends it only to Connect's own
   server, never to any other address. A sign-in from the app is one more session in the same
   table. **Thirty days from last use must really hold on a phone:** when the server renews a
   session it hands back a renewed sign-in, and an app that asked through its own addresses
   would never receive it; worse, the renewal would then count as done and not be offered
   again. So **the app's own addresses read the sign-in without renewing it,** and only the
   phone's direct request to better-auth's own address renews it, which its kit understands;
   the app makes that request each time it opens and at least once a day while open. The
   check script proves it the hard way round: after more than a day an ordinary app request
   comes first, then the renewal, and the phone must then hold the later date.

3. **Every app address lives under `/api/app/`** and goes through one gate, `appRequest()`, in
   a new folder `src/lib/app-door/`:
   - **It must come in the app's way.** Every request, reading or changing, must carry the
     header `x-connect-app` (the kind of phone and the app's version). That header is the
     protection: a form or a link on another website cannot add a header, and a script on
     another website may only add one if this server says so first, which it never does for
     these addresses. As a second lock, a request that carries a browser's own mark
     (`sec-fetch-site`) is refused. What the header *says* is only the app's word about
     itself, so it is used for "please update", never to decide what someone may do.
   - **Reading never changes anything.** An address that changes something is never a plain
     "get".
   - **The app must not be too old** (see the switches).
   - **Who may ask is decided per address, as its website page decides it,** from one shared
     reading of who is signed in. Four kinds:
     - *anyone*, signed in or not (`start`; later: search and a host's public page);
     - *signed in, email confirmed, account open*, even if "18 and terms" is not done (only the
       "18 and terms" address);
     - *the full gate* of `getUser()`: everything private;
     - *the full gate and not paused*: anything that starts or joins something.
   - The shared reading: the working part of `getSignedIn()` moves into a function that is
     handed a request's headers. `getSignedIn()` keeps its place, its memory for one page and
     its "server only" mark, and calls that function; an app address calls it directly.

4. **Answers an app can read.** Every refusal is a small fixed code plus the sentence to show,
   written on the server in the website's words. The gate's codes: `not_the_app`,
   `update_needed`, `not_signed_in`, `confirm_email`, `welcome_needed`, `paused`,
   `switched_off`. A closed account has no sign-in left (closing removes them): on a private
   address it is simply `not_signed_in`, on an address for anyone it gets what any guest
   gets, and only an attempt to sign in gets the website's "wrong email or password"
   sentence. So nobody learns from the app that an account was closed. A stranger
   gets the same answer whether or not a thing exists. Anything about a person is marked "do
   not keep a copy" for whatever sits between the phone and the server.

5. **The first address: `GET /api/app/start`.** For anyone. It answers: whether this version
   must update; what is switched on for the apps; and, if signed in, who this is (name, email,
   time zone, whether she is a host and in which state, paused or not) and what stands between
   her and the home page ("18 and terms"). A new person who has not confirmed their email has
   no sign-in at all yet, so `start` cannot know them; the app remembers that step itself
   (part 03).

6. **Switches for the apps,** new fields on the one row, saved the way the others are (only
   what is given changes), with the same safe position in the database and in `switches()`
   before the founder has saved anything:
   - **memberships in the apps:** *on*, *on, but nothing is bought in the app*, or *off* (born
     *on*). In the middle position members may spend time they have already paid for, and
     nothing in the app can take a monthly payment, a member's booking that would take one
     included (part 13);
   - **tips in the apps:** on or off (born **off**). Tips reach the app only if the website's
     own tip switch (plan 44) allows them *and* this one does;
   - **"available now" in the apps:** on or off (born on);
   - **the oldest allowed version** (born: none).
   The website's own switches still rule first: memberships named for certain hosts only,
   "no new requests" and "nobody can join a call" apply to the app as they do to the website.
   One set of switches covers both the iPhone and the Android app; if one store ever objects
   to something the other accepts, the stricter position is used for both.
   A thing that is off is left out of what `start` says is on **and** every address that
   belongs to it refuses with `switched_off`, so an old copy of the app cannot reach it.
   The fields sit on `/admin/reports` under their own heading, "The phone apps".

7. **The database change is made after plan 44 is merged,** from the state `main` then has, so
   the two changes cannot collide; it takes the next free number.

8. **No list of addresses is published and none is guessed.** Each later part adds the
   addresses its screens need, and no more.

## What gets built, in order

1. The shared reading of "who is signed in" from given headers; `getSignedIn()` on top of it.
2. `src/lib/app-door/`: "is this the app's way" (plain logic), the version comparison (plain
   logic), which of the four kinds of person an address asks for (plain logic), `appRequest()`,
   the answer helpers, and the one file of shared shapes for the app (no imports in it).
3. The Expo kit in `auth.ts`.
4. The switch fields: the database change, `switches()`, `setSwitches()`, the admin form.
5. `GET /api/app/start`.
6. The check script and the tests. The website's `tsconfig.json` and lint settings are told to
   leave the coming `mobile/` folder alone (it has its own checks, part 02).

## How it is tried

- **Tests of plain logic:** the app's-way rule (with and without the header; with each mark of
  a browser); the version comparison (older, equal, newer, nonsense); the four kinds of person
  against every state an account can be in, a paused one included.
- **A new check script, `scripts/app-door-check.ts`,** against the running website, talking as
  the app's kit talks: sign up; be refused until the email is confirmed; sign in; ask `start`
  signed out and signed in; then each refusal by its code: no app header; a browser's mark;
  too old a version; a closed account (and that its answer does not say "closed"); after a
  password reset the old sign-in no longer works. Each switched-off sign-in address, asked the
  app's way and well-formed, is still "not found". A session older than a day is renewed. The
  switches: tips off by default; each switch turned off disappears from `start`; saving one
  leaves the others as they were.
- **The website must be untouched:** `accounts-check`, `journey-check` and `safety-check` pass
  as before, and the type check, lint, tests and build are green.

## What could go wrong, and what is done about it

- *The Expo kit opens a way in that was closed.* Checked address by address, as above.
- *A rule is copied instead of shared, and the two drift apart.* One reading of who is signed
  in; one gate.
- *An old copy of the app keeps asking for something that was switched off.* The server
  refuses by the switch, not by what the app shows.

## Not in this part

Any screen; any address beyond `start`; notifications (part 12).

## Keeping the 4.9%

Nothing here takes or shows money. The tips switch for the apps is born off, and needs the
website's own tip switch as well.

## Astra's check (20 November 2026): "not ready", now worked in

1. *One gate for every address made signing up impossible* (the "18 and terms" step sits
   behind the gate it opens) and shut out the pages that are public on the website. Decision 3
   now has four kinds of person, per address.
2. *The protection was credited to the wrong thing.* A browser's mark can be missing; the
   required header on every request is what protects. Decision 3 says so.
3. *The kit's exact version and what it really does on the server* (its extra address, how it
   treats "where from"). Decision 1.
4. *Thirty days from last use would not hold:* the renewed sign-in never reached the phone.
   Decision 2.
5. *The switches:* the tip feature's own switch and database change; the membership switch
   needs a middle position to keep plan 39's promise; partial saving. Decisions 6 and 7.
6. *A closed account must not be told apart by its answer.* Decision 4.
7. *The website's own checks would have picked up the app's files.* "What gets built", step 6.

## Astra's second check, the same day: "not ready" on one point, now worked in

1. *An ordinary app request could use up the renewal the phone needs.* Decision 2: the app's
   addresses read without renewing.
2. *Trusting the app's name also affects where emailed links may lead.* Decision 1.
3. *A closed account on an address for anyone is just a guest.* Decision 4.
4. *The middle position of the membership switch, said exactly.* Decision 6.
