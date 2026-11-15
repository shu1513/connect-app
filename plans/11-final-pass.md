# Plan 11: The final pass, joining everything together

**Status:** built (15 November 2026). Astra's check of this plan, and what was done with each point, is at the end. What was built, the code review and the checks are recorded in `docs/module-record.md`.

## What this is

Every module was built and checked on its own. This pass looks at the app as one thing, the way a
new customer and a new host meet it, and fixes the places where the pieces do not join. It adds no
new product feature. Messaging was researched and left out of the first version (see
`docs/module-record.md`), so this is the last piece of building before the launch list.

Every page, link, piece of wording and email was surveyed first. What was found is below, in the
order a person would notice it.

## What was found

1. **There is no way around the app.** No page has a shared top bar. Each page draws its own "back"
   link, with eight different labels, and five screens have no link out at all (the report form, the
   "confirm your ID first" screen, "this is your own page", and others).
2. **A visitor who is not logged in sees nothing that explains Connect.** The front address goes
   straight to the login form. A host's public page and the search page have no "Log in" or "Create
   an account" link.
3. **Signing up loses your place.** A visitor who picks a time on a host's page and then creates an
   account ends up on an empty home page, not back at the time they picked.
4. **A new host is not told the steps.** There are five things to do before anyone can book (profile,
   ID, approval, payouts, hours), spread over three pages, with no list and no order. Nothing says
   that hours are needed. And when the founder approves or declines a profile, the host gets no email.
5. **A test-only page is still there**: "Create a test call", which says it "stands in for the
   calendar, which comes in a later step". Admins only, but it does not belong in the finished app.
6. **The results page shows developer data to the two people on the call**: a table of raw messages
   from the video service with connection codes.
7. **The same thing has different names**: "booking" in six places where the rest of the app says
   "call" or "request"; "caller" once for "customer"; "Hosting" and "Hosting settings"; "signing in"
   once where the rest says "logging in"; four spellings of "new, not enough ratings yet".
8. **Small things**: every browser tab just says "Connect"; one date is shown in computer format
   (2026-11-21); the sign-up page says the time zone is "used to show call times", but screens use
   the device's own time zone and only emails use the saved one; after a call a customer has no link
   to book the same host again.

## Decisions (made by the builder, as from module 5 on)

| # | Question | Decided | Why |
| --- | --- | --- | --- |
| 1 | A top bar on every page | Yes: the name "Connect", then Your calls, Find a host, Hosting, Your account (and Admin for the founder), with the person's name and Log out. For a visitor: Find a host, Log in, Create an account. | One way around, the same everywhere. It also removes every dead end at once. |
| 2 | Where the bar is not shown | Inside the live call page (it keeps its one small "Your calls" link), and on the sign-up steps (login, create account, check your email, reset password, the welcome step), which show only the name "Connect". | A bar above a running video call invites leaving it by accident. Someone in the middle of signing up cannot use the other pages yet. |
| 3 | "Back" links | Top-level pages lose their "← Your calls" link (the bar does that job). A page that sits under another keeps one link to its parent, labelled with the parent's exact heading: "← Hosting", "← Admin", "← Requests for calls". | One rule instead of eight labels. |
| 4 | A front page for visitors | Yes, small: what Connect is in three short lines, the search box, and Log in / Create an account. Logged-in people still get "Your calls" at the same address. | A visitor should learn what the site is before being asked for a password. The words are a first draft for the founder to change. |
| 5 | Signing up keeps your place | Yes. The address of the page you came from travels through "Create an account", the confirmation email and the welcome step, using the same safe "come back here" check that login already uses. | It is the main path for a new customer: host's page, pick a time, create an account, ask. |
| 6 | A "Getting started" list for hosts | Yes, at the top of the Hosting page: the five steps in order, each marked done or not, each with its link. It disappears when all are done and a line with the address of the host's public page takes its place. | The steps exist already; only the list is missing. |
| 7 | Emails to a host about their profile | Three short emails: approved (with the address of their page and what to do next), declined, and suspended. Sent through the same email queue as every other email. | A host who has sent their profile for approval is otherwise never told the answer. |
| 8 | The "Create a test call" page | Removed (the page, its form and its link). The small helper behind it stays, used only by the check scripts, and says so. | It was a stand-in from module 1. The calendar replaced it in module 4. |
| 9 | Developer data on the results page | The raw message table and the "room confirmed closed" line are shown to the founder only. The totals and the list of connected periods stay for everyone, because they explain the charge. | The two people need to see why they were charged what they were, not connection codes. |
| 10 | One name for each thing | "Call" for the thing booked, "request" until the host accepts, "customer", "host", "Hosting", "log in". The word "booking" is taken out of what people read (it stays in the code and in addresses). | The words people read should match across screens and emails. |
| 11 | Time zone wording | The label is changed to say what it does: "used for the times in your emails". Screens keep using the device's time zone. | Changing how every time on every screen is shown is a risk for no gain: the device's zone is right where the person is. |
| 12 | Tab titles | Every page gets its own ("Your account — Connect"). | Costs little; helps anyone with several tabs open. |

Nothing here costs money or changes a money rule, a safety rule or what is stored about anyone.

## What gets built

**The top bar** (`src/components/site-page.tsx`, the frame each page is wrapped in: bar, page,
footer with Rules, Terms and Privacy). A server piece that reads who is logged in (the same cached
look-up the pages already do) and whether they are the founder. It is drawn with each page, not in
the one shared frame around all pages. A shared frame is not drawn again as people move between
pages, so it would have to be told to redraw at every place where the answer can change (logging in,
logging out, finishing sign-up, changing your name, and whatever is added later). Drawn with the
page, the bar is always right with nothing to remember. The whole-app check below fails if a page is
missing the bar.

**The front page.** `src/app/page.tsx` shows the visitor's page when nobody is logged in; someone who
is part-way through signing up is still sent to the right step, as now.

**Keeping your place.** `/signup` takes `next`; the login page's "Create an account" link and the
sign-up page's "Log in" link carry it; the confirmation email's link leads to `/welcome?next=…`;
"send the email again" keeps it too. Everything goes through `safeNext`, so it can only ever be a
page on this site. Also fixed: the booking page, opened without a time by someone logged out, put
"undefined" into the address it came back to.

**Getting started for hosts** (on `/host`): 1. Fill in your profile and send it. 2. Confirm who you
are. 3. We approve your page. 4. Set up payouts (only for a host who charges). 5. Set your hours.
The list reads what is already stored; nothing new is saved.

**Three emails** in `src/lib/profiles/` beside the decision itself, queued in the same database step
as the decision, so a decision and its email cannot come apart. They are "must-send" emails, like the
ones about bookings: the unsubscribe choice does not switch them off.

**Removed:** `src/app/calls/new/` and its link on the home page.

**The results page:** founder-only developer sections; a readable payout date; for a customer, "Book
another call with {host}" when the host's page is still public.

**Wording**, each a small text change: the six "booking" places (screens and three emails); "your
next caller"; "Hosting settings"; "Signing in with Google"; one helper for the "new, not enough
ratings yet" label; "← Admin: payments"; the time zone label; the heading of the founder's email
page. The Hosting requests page gets one line pointing to "Available now" requests, which appear on
their own page. The founder's "set up your second login step" page gets a Log out button, because it
tells them to log out.

**Tab titles:** a pattern in `src/app/layout.tsx` and a title on each page.

**Tidying for whoever reads the code next:** two comments in `src/lib/email.ts` that still say no
email is really sent; the README ("Not done yet", the check list, "Where things are"); the module
record.

## What is left as it is, on purpose

- **How the app looks.** It stays plain. A designed look (colours, a logo, photos) is its own piece
  of work and needs the founder's taste.
- **The terms and privacy pages** still say they are placeholders. Only a lawyer can replace them.
- **A receipt by email after a charge.** Stripe sends its own receipts and refund notices when that
  is switched on in the live account. That is a setting, not code; it goes on the launch list.
- **A page listing all of a host's earnings and payouts.** Today a host sees money one call at a
  time. It is a new feature, not a join; it is the first thing to consider after launch.
- **An email reminding people to rate a call.** The home page already shows "Waiting for your
  rating".
- **"Save", "Save profile", "Save rule".** Different buttons on one page are clearer with different
  names.
- **The founder's page of sent emails** stays, also when real sending is on: it shows what was sent
  and what bounced.

## How it will be checked

1. **A new check script, `scripts/journey-check.ts`, in two parts.**
   - *One whole story, start to finish, across every module:* a host signs up, fills in the profile,
     passes the ID step, is approved (and gets the email), sets hours; a visitor finds them by
     search, picks a time, creates an account and lands back on that time; asks with a note and a
     card; the host accepts; both join; the call ends and is charged; both rate; each appears in the
     other's contacts; the host's share is paid out. At each step the script opens the pages that
     person would see and checks the words and the links they need are there.
   - *A walk over every page* as a visitor, a customer, a host and the founder: every page loads,
     has the top bar (or is one of the named exceptions), and every link on it leads to a page that
     exists.
2. The nine existing journey scripts, the automatic tests, lint, types and the build must all still
   pass. Two existing checks change with the plan: "a visitor at the front address is sent to login"
   (now checked on another page), and the list of pages a normal user must not open (the test-call
   page is gone).
3. The whole journey once more by hand in a browser, as a new customer and as a new host, on a wide
   screen and at phone width.

**What the checks cannot cover:** a real two-person video call, the real ID check at Stripe, and
real email delivery, as before.

## Order of work

1. The top bar, back links, tab titles (every page is touched once).
2. The front page and keeping your place through sign-up.
3. Getting started for hosts, and the three emails.
4. Removing the test page; the results page.
5. Wording.
6. The journey script; all checks; the browser walk; README and the module record.

## Astra's check of this plan (15 November 2026)

Verdict: **approve with changes.** Thirteen points. What was done with each:

| # | Astra's point | Done |
| --- | --- | --- |
| 1 | The "come back here" check accepted the app's machine addresses (`/api/...`) and values of any length. | **Taken.** It now refuses both, with tests. |
| 2 | Name every branch of sign-up that must carry the page: the "Create an account" link, password sign-up, "check your email", "send again", Google (also when Google fails), an expired confirmation link, someone already logged in. | **Taken**, all of them. |
| 3 | The front page must be chosen by "nobody is logged in", not by "may not use the app", or someone part-way through sign-up would see it. One more existing check (a closed account) depended on the front address going to login. | **Taken.** |
| 4 | The profile emails: save the decision and its email together; do not email again when the same answer is given twice; the suspension email must not claim every call was cancelled. | **Taken.** The email goes out only when the answer changes. |
| 5 | Links in the emails the app already sends (a request, a call, results, "requests waiting") lose their place when the person has to log in first. | **Taken.** Those pages now return to themselves after login. |
| 6 | Say plainly what the journey script pretends (the ID check, who was connected, the passing of days) and what it leaves behind. | **Taken.** It is written at the top of the script. Its paid part uses the sandbox host whose payouts are ready, and is skipped with a note when that is not set up. A separate database just for this script was not added: the script only touches rows it made. |
| 7 | Put the bar in the one shared frame, and tell it to redraw after each change. | **Not taken.** Both ways work. Drawing it with the page needs no "remember to redraw" anywhere, so it cannot go stale when something is added later. The reason given in this plan was corrected. |
| 8 | "Set your hours" is not the whole of step 5: a calendar also needs a time zone and call lengths. Show hidden, paused and suspended apart. | **Partly taken.** Step 5 now names all three. The page already says when a profile is hidden or suspended, and the home page when an account is paused. |
| 9 | A host is not told when a booked request arrives. | **Checked, not so.** The always-on helper sends "You have a new call request" (`src/lib/booking/jobs.ts`). Nothing to add. |
| 10 | Do not follow every link blindly: check known pages for each kind of person, and only ordinary links. | **Taken.** |
| 11 | The results page also shows the detailed reasons a record "needs review" (connection messages). | **Taken.** The founder sees the reasons; the two people see one plain sentence. |
| 12 | Host pages already put "— Connect" in their title, so the new pattern would double it. The time zone is also the starting zone of a host's calendar. | **Taken.** |
| 13 | Keep the helper behind the test page, and keep a check that the old address is gone. | **Taken.** |
