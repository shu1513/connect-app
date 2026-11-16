# Plan 16: A host proves a social media account

**Status:** plan only, not built. Written 15 November 2026. Astra has checked it against the code;
what it found is at the end, and every point is worked in.

## What this is, and why

The founder's question: how do we make sure an influencer is who they say they are? Should a host
connect their Instagram, so that only the person who owns that account can be that host, and
customers can find the host by that name?

A good part of this exists already (module 3, accounts, and module 8, search):

- A host can add a name on Instagram, TikTok, YouTube or X. Connect gives them a short code, they
  put it in that account's bio (on YouTube, the channel description), and the founder looks and
  confirms it on the admin page.
- Only confirmed names are shown on a host's page, and a name can be confirmed for one host only.
- Search already finds a host by a confirmed social media name.
- Every host profile waits for the founder's approval before it is public.

What is missing:

1. Proving an account is **optional**. A host can be approved without any.
2. The proof is **by hand**. The founder has to open each bio and look.

Approval already asks for an **ID check** (a photo of an ID and a selfie). That stays.

## What the founder decided (15 November 2026)

| Question | Decided |
| --- | --- |
| Must a host prove a social media account before approval? | **Yes, at least one**, on any of the four networks. A creator who is only on YouTube or only on TikTok can be a host. |
| Must a host still pass the ID check? | **Yes.** The founder first chose to drop it for hosts, then decided to keep it the same day: it is the only thing that shows a host is at least 18 years old. |
| Is Instagram the way to sign in? | **No.** Signing in stays as it is (email and password, or Google). Instagram is a proof a host adds to their account. The builder's reasons: a host whose Instagram is hacked or suspended would lose their Connect account and their money with it, and Meta could switch the login off for everyone. |
| Is there a registered company yet? | **Not yet.** Meta only lets an app be used by the public when it belongs to a verified business. So "Connect your Instagram" is built now and switched on later; until then every network is proven with the code. |

## Why both are needed

They answer two different questions. The ID check answers "is this a real person, 18 or older?".
Instagram lets people in from age 13, so an account proves nothing about age. The proven account
answers "is this the person behind that account?", which an ID cannot say. A host needs both
before the founder can approve them. Nothing about the ID check changes in this plan.

## How it works for a host

"Getting started" on the Hosting page becomes:

1. Fill in your profile and send it for approval.
2. Confirm who you are, with a photo of your ID and a selfie (as today).
3. **Prove one social media account** (new).
4. We approve your page.
5. Set up payouts (hosts who charge).
6. Set up your calendar.

The section for social media accounts on the Hosting page says what it is for: "People find you by
these names, and we use one of them to check that you are you." Until both steps 2 and 3 are done,
the note under "We approve your page" says which of them is still missing.

**Two ways to prove an account:**

- **The code (all four networks, works from day one).** As today: add the name, put the code in
  the bio, press "I've done it", and the founder confirms it.
- **"Connect your Instagram" (once switched on).** One button. The host is sent to Instagram, logs
  in there, and agrees to share their account's name with Connect. They come back, and the account
  is confirmed at once, with no waiting for the founder. Connect never sees the Instagram password.
  As far as Meta's pages say, this works for Instagram accounts set to "Creator" or "Business"
  (free to switch in Instagram's settings; nearly every influencer has one). The page says so, and
  that the code is there for everyone else.

**Keeping one proven account.** An **approved** host cannot remove or replace their last proven
account. The page says: "Your page needs one confirmed account. Confirm another one first, or
write to us." A host who is not approved (waiting, declined or suspended) can change their accounts
freely, because approval looks again.

**A renamed Instagram account.** A host who proved Instagram by logging in, and later renames
that account, presses "Connect your Instagram" again. Instagram tells us it is the same account,
and the name is updated without losing the proof (unless the new name is already confirmed for
another host). A host who used the code, and has no other proven account, writes to us.

## How it works for the founder

On the admin page, each profile that waits for approval shows its confirmed accounts as links,
under the line about the identity check:

- With one or more: "Confirmed accounts: Instagram @name, YouTube @name". The founder's job at this
  point is what it always was, now with something to compare: does the display name and the page
  address fit the account, or is a small account trying to pass as someone famous?
- With none: "No confirmed social media account yet: this profile cannot be approved until there
  is one."

Pressing "Approve" for a profile with no confirmed account is refused with that message, also from
the list "All other host profiles" (where a declined or suspended profile can be approved again).

Accounts proven with the code keep coming to "Social media accounts to check". Accounts proven by
logging in at Instagram do not, because there is nothing to look at.

## How it works for a customer

Nothing new to learn. A host's page and the search results already show the confirmed names, and
search already finds a host by them. The difference is that every host approved from now on has
at least one.

## How it is built

### Part 1: a proven account is needed for approval

- `src/lib/profiles/profiles.ts`
  - `decideProfile`: approving asks for at least one confirmed social account, as well as the
    passed identity check it asks for today. The confirmed accounts are counted inside the same
    database step, after the profile's lock is taken.
  - `removeSocialName` and `addSocialName` (which replaces the name on a network, and so takes the
    proof away): each takes the profile's lock first, then reads the accounts, then refuses to
    take away the last confirmed account of an approved host, all in one database step. Because
    approving, removing and replacing all wait for the same lock, two of them at the same moment
    happen one after the other.
  - Where a step also needs the person's account, the order is always: the person, then the
    profile, then the social account. Closing an account already works in that order.
  - **A small repair found on the way:** today a profile can be approved after its account was
    closed, and would be public the moment the account is opened again. Approving a closed
    account is refused.
- `src/app/host/actions.ts`: the "Remove" action today says "removed" whatever happened. It shows
  the refusal when there is one.
- `src/app/host/page.tsx`: the steps, the section, the wording.
- `src/app/admin/people/page.tsx`: the confirmed accounts on each waiting profile.
- Hosts who are approved today (only test accounts exist before launch) stay approved. The rule
  applies when a profile is approved from now on.

Left out on purpose: making the founder's approval name the exact accounts they were looking at
(as it does for the name and the text). A host can add another proven account after approval
anyway, so it would guard a few seconds only.

### Part 2: "Connect your Instagram"

Meta's name for this is "Instagram API with Instagram Login". We ask for the smallest permission
there is (`instagram_business_basic`). Connect asks for and keeps only two things: the account's
own number and its name.

- **Two settings**, `INSTAGRAM_APP_ID` and `INSTAGRAM_APP_SECRET`. While either is missing, the
  button is not shown, **and** the server refuses both the start and the return without asking
  Meta anything or saving anything. That is the "switched off" state; no other switch is needed.
- **The return address** is one fixed address, the site's own address followed by
  `/api/social/instagram/return`. It is built from the site's setting, never from what a browser
  sends, and is the same when the host is sent out and when the code is swapped. It is the one
  registered with Meta.
- **The steps**
  1. The host presses the button (a server action in `src/app/host/actions.ts`). The server makes
     a random value and puts it, with who is asking and a time 10 minutes ahead, in a cookie
     signed by the server. The cookie cannot be read by scripts, is sent only over a secure
     connection on the live site, and comes back when Instagram returns the host (a "Lax" cookie
     does that for a normal return to the page). The host is sent to Instagram with the random
     value.
  2. Instagram sends the host back with a one-time code and that value. The route checks: the
     cookie is there, is really ours and is not out of date; the value matches; the person logged
     in to Connect now is the person who started; they are allowed to act (not closed or paused)
     and have a host profile. Then it removes the cookie, before anything else. A person who is
     not logged in is sent to log in and has to start again; nothing is saved.
  3. The server swaps the one-time code for a short-lived key (this uses the secret, which never
     leaves the server), asks Instagram once "which account is this?", and reads the account's
     number and name. Instagram accepts a one-time code once, which is what makes a repeated
     return harmless.
  4. The key is thrown away. It is never stored. Errors from this step are written to the log
     without the code, the key or the secret, and Instagram's own error text is never shown to the
     host.
  5. The account is saved as confirmed for this host, and the host lands on the Hosting page with
     a message.
- **Saving** (`confirmSocialByLogin` in `src/lib/profiles/profiles.ts`), in one database step
  under the profile's lock. The proof and the confirmation are written together, so there is never
  a half-saved entry. For this host's Instagram entry (a host has one entry per network):
  - none yet, or one that is not confirmed: it is written as confirmed;
  - confirmed with the code, under the same name: it stays confirmed and now also carries the
    account's number;
  - confirmed by login, same number: the name is updated (a rename);
  - confirmed, but a different account: it is replaced by the new one in the same step, so the
    host is never without a confirmed account in between. The old name becomes free.
  - If the name or the number is confirmed for another host: refused, "That account is already
    confirmed for another host. If it is yours, write to us." Nothing of the host's own entry
    changes.
- **The database:** one new column on `social_accounts`, `provider_account_id`: Instagram's own
  number for the account, kept as text, empty for an account proven with the code. One new guard:
  a number can be confirmed for one host only. The guard on names that exists today stays and
  keeps doing its job for both ways of proving. The columns for the code stay as they are; an
  entry confirmed by login gets a code nobody is shown, already out of date. When a host later
  types a different name for that network, the number is cleared with the rest.
- **The two ways do not get in each other's way.** The founder's list, "I've done it", "confirm"
  and "the code is not there" all act only on entries that are not confirmed, so none of them can
  touch an entry confirmed by login, also from an admin page left open.
- **New files:** `src/lib/profiles/instagram.ts` (plain logic: the address to send the host to,
  signing and reading the cookie's value, and reading Instagram's two answers: the fields we need
  must be there and of the right kind, anything else in the answer is ignored, and the number is
  kept as text) and `src/app/api/social/instagram/return/route.ts`.
- **When something goes wrong** (the host pressed "Cancel" at Instagram, the value does not match,
  Instagram is down, the account is a personal one): the host lands back on the Hosting page with
  a plain message and nothing is changed.
- **The Hosting page** words an entry confirmed by login without the sentence about removing the
  code from the bio.
- **The privacy page** gets two sentences: what we read from Instagram (the account's number and
  name, nothing else, no key kept) and how to remove it (the "Remove" button, or write to us).

Not stored: the key, the host's Instagram posts, followers, messages or email.

**A name that has gone stale.** If a host renames their Instagram account and does not connect
again, Connect keeps showing the old name, and whoever takes that name on Instagram is told it is
already confirmed. This will be rare. For now the founder sorts it out by hand when someone
writes in; no tool or automatic check is built for it.

## What only the founder can do, and when

1. **Now, free:** make a Meta developer account and an app in "development" state, and add the
   founder's own Instagram account as a tester. With that, the whole login can be tried for real
   before any company exists. The builder can walk through the screens; the founder signs in.
2. **Later:** register the company; have Meta verify the business; send the app for Meta's review
   with a short screen recording of the login. Guides speak of 2 to 4 weeks for the review, which
   is an estimate and not a promise. Then set the two settings on the live site.

Until step 2 is done, hosts prove Instagram with the code, like the other networks.

## What is not in this plan

- Signing in with Instagram (decided against, above).
- Automatic proof for TikTok, YouTube and X. Each has its own login that could be added the same
  way later. The code works for all of them now.
- Checking again later that a host still owns the account. A host who loses their account can be
  suspended by the founder, as today.
- Showing follower numbers or pictures from Instagram.
- Tying the page address (`/h/name`) to the Instagram name. The founder's look at each profile
  covers a page address that does not fit.

## How it will be checked

- **Tests for the plain logic:** the address the host is sent to (the permission, the return
  address, the random value); the cookie's value (a good one; one that was changed; one that is
  out of date; one made for another person); reading Instagram's answers (a good one, also with
  extra fields; a missing number or name; a name that does not look like an Instagram name; an
  error answer).
- **The accounts script** (`scripts/accounts-check.ts`), new checks:
  - A profile with a passed ID check but no confirmed account cannot be approved; one with a
    confirmed account but no ID check cannot either; with both it can. The same refusal from the
    "approve again" path of a declined profile.
  - A closed account's profile cannot be approved.
  - An approved host cannot remove or replace their last confirmed account, and is told why; with
    two confirmed, one can go. A waiting or declined host can remove theirs, and then cannot be
    approved.
  - At the same moment: an approval and the removal of the only confirmed account (never an
    approved host without one); two removals with two confirmed accounts (one is refused).
  - Confirming by login: a new account is confirmed at once; an entry confirmed with the code
    under the same name stays confirmed and gets the number; the same account again under a new
    name keeps the proof and updates the name; a different account replaces the old one in one
    step; a name or a number confirmed for another host is refused and the host's own entry is
    left exactly as it was.
  - An entry confirmed by login is not in the founder's list, and an old "confirm" or "the code is
    not there" for it changes nothing. Typing a different name afterwards starts the code way
    afresh, with the number cleared.
  - The script's existing test host gets a confirmed account on another network before its first
    approval, so the Instagram checks that follow stay as they are.
- **The other scripts:** the journey script proves an account between "ID done" and "ready to be
  approved", and its checks of the "Getting started" words cover the new step. The safety script
  gives its new host a confirmed account before it checks that a missing ID still refuses
  approval. Scripts that write an approved host straight into the database need no change.
- **The start and the return, with pretended answers from Instagram:** either setting missing
  (refused, nothing asked of Meta, nothing saved); not logged in (sent to log in, nothing saved);
  a value that does not match; no cookie; a cookie out of date; started as one person and returned
  as another; "Cancel" at Instagram; the same return a second time. Each changes nothing.
- **By hand in a browser:** the Hosting page and the admin page, also at phone size. And, once the
  founder has made the Meta app in development state, one real "Connect your Instagram" from start
  to finish with the founder's own account. That real run is also the only proof that the cookie
  really comes back from Instagram, and it must start and end on the same site address.
- Then the usual: Astra reviews the code, and CodeRabbit reviews the pull request.

## Meta's rules: what was read, and what must be confirmed when building

Read on 15 November 2026:

- Meta, "Business Login for Instagram":
  https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/business-login
- Meta, "App Review for Instagram API" (serving accounts that are not our own needs Advanced
  Access, which needs App Review and Business Verification):
  https://developers.facebook.com/docs/instagram-platform/app-review
- Meta, "Get started" (the request for the account's number and name; the key lasts 1 hour):
  https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/get-started

Meta changes these pages often, and Astra could not read them. To confirm against Meta's own pages
before writing the code: the exact addresses of the login and of the two requests and the fields
in their answers; which of the numbers Meta returns is the lasting one for an account; that a
one-time code is accepted once; that the return address must be `https`; what a personal account
sees; how testers are added; and what Meta asks for about deleting data before it approves an
app. The two settings stay unset on the live site until Meta has approved the app.

## Astra's check of this plan (15 November 2026)

Verdict: ready with changes. It confirmed that what the plan says exists today is right (the code
in the bio, the founder's confirmation, only confirmed names shown, search by confirmed name,
approval needing the ID check), that Instagram can stay apart from signing in without getting in
the way of the login system, that the app has nothing in front of its pages that would block
Instagram's return, and that a button plus a return address fits this version of Next.js. Its
points, all worked in above:

1. The return was not tied to the person who started. The cookie now carries who started, and the
   return checks it is the same person. What makes a return count only once is Instagram's
   one-time code, not the cookie; the plan now says so.
2. The locks: the profile's lock is taken before the accounts are read, in the same database
   step, and the order is always person, profile, account. An existing gap is closed on the way:
   a closed account's profile could be approved.
3. Simpler rules. The last proven account is protected for approved hosts only (a waiting host is
   looked at again anyway). The founder's approval does not need to name the exact accounts seen.
4. Saving after a login said nothing about an entry already confirmed with the code, or a
   different confirmed account. Both are now spelled out.
5. The database: the code's columns stay and get an unused, out-of-date code; one new column is
   enough (how an account was proven follows from whether it has a number); the guard on numbers
   applies to confirmed entries; typing a new name clears the number.
6. A renamed account's old name stays blocked until the host connects again. Said plainly, with
   the founder sorting it out by hand.
7. The "Remove" action reported success whatever happened, and there is a second place where the
   founder can approve. Both covered.
8. Switched off must be enforced on the server, not only by hiding the button; one fixed return
   address; a person who is not logged in goes to log in; nothing secret in the log.
9. The founder's list and its buttons only act on entries that are not confirmed, so the two ways
   of proving cannot disturb each other. Now stated and checked.
10. More checks: things happening at the same moment, the changes from one kind of proof to the
    other, and the right place to add a confirmed account in each script.
11. Meta's rules are worded as what Meta's pages say, with a list of what to confirm when
    building. Instagram's answers are read for the fields we need and nothing more.
12. "Every host has one" became "every host approved from now on".
