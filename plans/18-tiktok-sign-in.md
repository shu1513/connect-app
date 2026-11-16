# Plan 18: A host proves a TikTok account by signing in at TikTok

**Status:** plan only, not built. Written 16 November 2026. It builds on plans 16 and 17, which
are merged (pull requests 26 and 27). Astra has checked it against the code; what it found is at
the end, and every point is worked in.

## What this is, and why

Since plan 17, Connect confirms an Instagram or YouTube account by itself: the host puts a code in
the bio and Connect reads it through Meta or Google. TikTok has no free official way to read a
bio by name, so a TikTok account is still confirmed by the founder by hand. The founder does not
want to confirm anything by hand.

TikTok offers a different door: its own sign-in ("Login Kit"). The host presses "Connect your
TikTok", logs in at TikTok, and TikTok tells Connect which account that is. No code in a bio, and
nothing for the founder to do.

## What the founder decided

| Question | Decided |
| --- | --- |
| Who confirms an account? | **Connect, by itself**, wherever that is possible (15 November 2026). |
| TikTok | **Automatic through TikTok's own sign-in**, planned here (16 November 2026). |
| X | Stays confirmed by hand. Its official service costs money every month. |

## What TikTok asks for (its developer pages, read 16 November 2026)

- **To try it:** a free TikTok developer account and an app in "sandbox" state. In a sandbox the
  sign-in works at once, without any review, for up to 10 TikTok accounts that are added to it
  by name. That is enough to build this and try it for real with the founder's own account.
- **To open it to every host, TikTok must approve the app.** For that TikTok wants:
  - a real website on its own address, fully working, not a test or a page under construction
    ("apps that are still in development or testing will not be approved");
  - terms and a privacy policy on that website, with links anyone can see;
  - proof that we own the address (a small file placed on the site);
  - a short video of the whole sign-in, recorded in the sandbox;
  - the app's name, picture and description.
  TikTok says a review takes "several days to two weeks". A registered company is **not** asked
  for; TikTok recommends one but accepts a developer account in a person's own name.
- **Said plainly:** Connect is not on its own address yet, and its terms and privacy pages are
  placeholders. So TikTok's sign-in can be built and tried now, but it can only be switched on for
  real hosts after Connect is live. Until then TikTok stays confirmed by hand, as today.

What Connect asks TikTok for: the account's own number at TikTok and its name. That needs two
permissions, "basic" and "profile" (the name is in "profile"). Nothing about videos, followers or
messages.

## How it works for a host

In the section "Your social media accounts" there is one button, **"Connect your TikTok"** (only
when TikTok's sign-in is switched on).

1. The host presses it and is sent to TikTok.
2. At TikTok they log in and agree to share their name with Connect. Connect never sees the
   TikTok password.
3. TikTok sends them back to the Hosting page: "TikTok @name is confirmed." Done.

When TikTok sends the host back with a refusal, or anything goes wrong on the way, they land on
the Hosting page with a plain message and nothing is changed. (What TikTok does when a host
presses "Cancel" on its page is not written down by TikTok; it is looked at in the sandbox.)

**A renamed TikTok account:** the host presses "Connect your TikTok" again. TikTok tells us it is
the same account, and the name is updated without losing the proof. Until they do, Connect keeps
showing the old name, and whoever takes that name at TikTok is told it is already confirmed; the
founder sorts that out by hand when someone writes in.

**While the sign-in is switched on, a new TikTok account can only be proven this way.** What the
host sees for TikTok, case by case:

| The host's TikTok entry | What the page shows |
| --- | --- |
| None | The button. TikTok is not in the list for adding an account with a code. |
| Not confirmed, never sent to the founder | "Connect your TikTok to confirm this account." No code, no "I've done it". |
| Already waiting for the founder, code still good | "Waiting for us to check", as today, and the button, to finish at once instead. |
| Its code has run out | The button. Never "add the account again": the server would refuse that. |
| Confirmed by hand | "Confirmed", as today. Signing in later adds TikTok's number to it; nothing has to be proven again. |
| Confirmed by signing in | "Confirmed", without the sentence about taking the code out of the bio. |

"Remove" stays on every entry, with plan 16's rule (an approved host keeps one confirmed account).
With the sign-in switched off, everything about TikTok is as it is today.

## How it works for the founder

Nothing to do for a new TikTok account. A TikTok account confirmed by sign-in never comes to the
list of accounts to check. Requests that were already on the list stay until they are confirmed,
rejected, removed or run out.

If TikTok does not accept our own keys or the permissions we ask for, the admin page shows the
same kind of line it shows for Meta and Google. (If TikTok shows the host an error on its own page
and never sends them back, Connect cannot know; no monitoring is added for that.)

Approving a host is unchanged.

## How it is built

A sign-in of this kind was built once already, for Instagram, before Meta turned out not to offer
it to new apps. That work is on the local branch `wip/connect-instagram`. What is reused from it
is the part that does not depend on the network: the signed note of who started, the checks on
return, and the shape of the saving step. Everything that talks to TikTok is written for TikTok.

### TikTok's side, exactly

- **Sending the host:** `https://www.tiktok.com/v2/auth/authorize/` with `client_key`, `scope`
  (`user.info.basic,user.info.profile`), `response_type=code`, `redirect_uri` and `state`. Nothing
  else; the extra step some sign-ins use for phone apps is not part of TikTok's web sign-in.
- **On return:** `code`, `scopes` and `state`, or `error`.
- **Swapping the code:** a POST to `https://open.tiktokapis.com/v2/oauth/token/`, as a form, with
  `client_key`, `client_secret`, `code`, `grant_type=authorization_code` and `redirect_uri`. The
  secret is in the body of the request, never in an address.
- **Asking which account:** a GET to `https://open.tiktokapis.com/v2/user/info/` with
  `fields=open_id,username` and the key in a header.
- **Handing the key back:** a POST to `https://open.tiktokapis.com/v2/oauth/revoke/` with
  `client_key`, `client_secret` and `token`.
- Every request is fresh, has a time limit of a few seconds that covers reading the answer, never
  follows a redirect, and is not tried a second time.

**What counts as a good answer.** All of these, or nothing is confirmed: both permissions are
among those TikTok says were given, on the return and again in the token answer (more are
allowed, fewer are not); the account answer says "ok"; it holds a name that looks like a TikTok
name; and the account's number in it is the same, non-empty text as the number in the token
answer. The display name is never used in place of the name. Fields we do not need are ignored.

**Which number is kept:** `open_id`, TikTok's number for the account **for our app**. A sandbox
and the approved app may give the same account different numbers. So the sandbox's keys are only
ever used on the developer's own computer with its test data, the live site only ever gets the
approved app's keys, and the live site's app is never swapped for another. The number is kept as
text. If an answer's number differs from the one stored, it is a different account, whatever the
name says.

### Connect's side

- **Settings:** `TIKTOK_CLIENT_KEY` and `TIKTOK_CLIENT_SECRET`. The sign-in counts as switched on
  only when both are there **and** the site's own address is a plain `https` address (TikTok
  accepts nothing else). Switched off, the button is not shown **and** the server refuses both the
  start and the return, asking nothing of TikTok and saving nothing.
- **The return address** is one fixed address, the site's own address followed by
  `/api/social/tiktok/return`, built from the site's setting and never from what a browser sends.
  It is the one registered with TikTok.
- **The steps**
  1. The host presses the button (a server action). The server makes a random value and puts it,
     with who is asking and a time 10 minutes ahead, in a cookie signed by the server: not
     readable by scripts, sent only over a secure connection, only to the return address, only to
     this site, kept for 10 minutes, and of the kind that comes back on a normal return from
     another site. The host is sent to TikTok.
  2. TikTok sends the host back. The return address reads the cookie and removes it **first**,
     before logging-in checks, settings or any request. Then: the cookie is really ours and not
     out of date; the value matches; the person logged in to Connect now is the person who
     started. A person who is not logged in is sent to log in and starts again. Only after these
     checks is anything TikTok sent looked at.
  3. The server swaps the code for a short-lived key, checks the permissions, and asks which
     account it is.
  4. Whatever happened after a key was obtained, the server tries to hand the key back to TikTok.
     If that fails, a good proof still counts; the key is thrown away either way. Neither the key
     nor the longer-lived one that comes with it is ever stored.
  5. The account is saved as confirmed for this host.
- **A return that arrives twice.** Removing the cookie stops a second visit to the same address.
  It cannot stop two requests that both left the browser with the cookie. That is harmless here:
  both are from the same person for the same account, and saving the same account twice gives the
  same result. Whether TikTok takes a code only once is looked at in the sandbox; nothing depends
  on it.
- **Saving,** in one database step under the locks plan 16 introduced (the person, then the
  profile). After the locks are held it is checked again that the account is not closed or paused
  and that there is a host profile, because the person may have changed while TikTok was
  answering. Then one write for this host's TikTok entry (a host has one entry per network): the
  cleaned-up name and its link, TikTok's number, confirmed now, "confirmed by" empty, "waiting for
  the founder" cleared, and a code nobody is shown that has already run out. That one write covers
  every case:
  - none yet, or one that is not confirmed: it is now confirmed;
  - confirmed by hand under the same name: it stays confirmed and now carries TikTok's number;
  - confirmed by sign-in, same number: the name is updated (a rename);
  - confirmed, but a different account: replaced in the same step. The host is never without a
    confirmed account in between, so plan 16's rule about the last confirmed account is not
    applied here (it would wrongly refuse);
  - the name or the number is confirmed for another host: the database refuses, the whole step is
    undone, and the host is told "That account is already confirmed for another host. If it is
    yours, write to us."
- **The by-hand way is closed for new TikTok entries while the sign-in is on.** Typing a TikTok
  name is refused on the server (before anything else is looked at), and "I've done it" for a
  TikTok entry is refused too, so a form from an old page cannot put a new request on the
  founder's list. Both give the message "Connect your TikTok instead." With the sign-in off, both
  work as today, and typing a name clears TikTok's number along with the rest of the old proof.
  TikTok is not added to the "read the bio" networks of plan 17, and plan 17's confirming does
  not touch the new column.
- **The database:** one new column on `social_accounts`, `provider_account_id`: the network's own
  number for the account, as text, empty for accounts proven with a code. One new guard: a number
  can be confirmed for one host only. The guards that exist stay.
- **The founder's warning** uses plan 17's table (`bio_checks`), for one thing only: when a
  return has passed all of Connect's own checks and TikTok then refuses **our** keys or the
  permissions we ask for (TikTok's answers "invalid_client", "unauthorized_client" and
  "invalid_scope" when the code is swapped), one row is written for TikTok with the result
  "refused". Nothing is written for a missing setting, a cookie that does not match, a host who
  said no, a code TikTok will not take, an answer about the host's own permissions, a rate limit
  or an outage. Plan 17's count of a person's hourly checks is narrowed to Instagram and YouTube,
  so these rows never use up a host's checks. The admin page's line names TikTok (today it calls
  everything that is not YouTube "Meta").
- **Nothing secret is written down.**
  - What the app logs for this flow is only which step failed and one of a fixed list of short
    reasons. Never an address, a code, a key, TikTok's own message, or a raw error.
  - The return's address holds TikTok's one-time code. In development the framework prints the
    address of every request; the return address is taken out of that, with the setting the
    framework has for it. When a hosting service is chosen, its request log must not keep what
    follows the "?" for this address. (A code is useless without our secret, but it does not
    belong in a log.)
- **Pages:** the Hosting page as in the table above; one sentence on the privacy page ("When you
  connect TikTok by signing in there, we read the account's number and name, nothing else, and we
  keep no key").

## What only the founder can do, and when

1. **Now, free:** a TikTok developer account, an app named "Connect" in sandbox state with
   "Login Kit" and the two permissions, the founder's own TikTok account added to the sandbox, and
   the sandbox's two keys saved in the private settings file. The builder walks through it in
   Chrome; the founder logs in and saves the keys.
2. **When Connect is live on its own address, with real terms and privacy pages:** prove the
   address to TikTok, record the short video, send the app for review, and put the approved app's
   keys in the live site's settings. Then TikTok confirms by itself for every host.

## What is not in this plan

- X.
- Switching the sign-in on for real hosts (step 2 above; it waits for Connect to be live).
- Reading anything else from TikTok.
- Signing in to Connect with TikTok. TikTok is a proof, not the way to log in.
- Checking a confirmed account again later.
- Watching TikTok from outside the app.

## How it will be checked

- **Tests for the plain logic:** the address the host is sent to; the signed cookie value (good,
  changed, out of date, made for another person); the permissions as sets (both there, extras
  allowed, one missing); TikTok's answers (good, with extra fields; a missing or empty number; a
  number that is not text; numbers that differ between the two answers; a missing name; a name
  that does not look like a TikTok name; a display name but no name; each of TikTok's refusals,
  and which of them count for the founder's warning).
- **The requests themselves, with a pretended connection:** what is sent where (the secret only in
  a body, the key only in a header), no redirect followed, the time limit, an answer that cannot
  be read, and that the key is handed back also when a later step fails.
- **The accounts script.** The finishing step takes its dealings with TikTok, the settings and the
  time as parts that can be handed in, as plan 17's check does; the script hands in pretended
  ones. The real return address hands in nothing and takes nothing of the kind from a form or an
  address.
  - Switched off (a key missing, or the site's address not `https`): start and return refused,
    nothing asked, nothing saved.
  - The return: no cookie; a cookie out of date; a value that does not match; started as one
    person and returned as another; TikTok returns a refusal. Each changes nothing.
  - Saving: every case in the list above; a name or a number confirmed for another host leaves
    the host's own entry untouched; two hosts connecting the same account at the same moment; the
    account closed or paused while TikTok was answering.
  - With plan 16's rules: a host whose only account was confirmed by sign-in can be approved; an
    approved host whose only confirmed account is replaced by sign-in is never without one; a
    replacement at the same moment as a removal or an approval.
  - The by-hand way while the sign-in is on: typing a TikTok name is refused, also the name that
    is already confirmed; "I've done it" from an old page is refused; an entry already waiting
    stays on the founder's list and leaves it when the host connects; a founder's "confirm" or
    "the code is not there" from a page left open changes nothing after a sign-in proof. With the
    sign-in off: all as today, and typing a name clears the number.
  - The founder's line appears after TikTok refuses our keys, not after anything else, and such a
    row does not use up a host's Instagram or YouTube checks.
  - The script's existing TikTok cases (by hand) run with the sign-in switched off.
- **Through the running app,** as a browser would: the return address without logging in, without
  the cookie, and switched off; that the cookie is removed; where each ends up.
- **For real, by hand,** in the sandbox with the founder's own TikTok account, on a test host that
  is approved and visible: connect, see it confirmed and found by search; press "Cancel" at
  TikTok and see what happens; connect a second time; and whether TikTok takes a code twice. Also
  at phone size. For this to work at all: the app's test address (the secure one already used for
  Stripe) must be current in the settings and registered with TikTok exactly; and the builder logs
  in to Connect **on that address**, with a password, in the same browser, before starting.
  Starting from the plain local address, or with "Sign in with Google", does not work for this
  test.
- Then the usual: Astra reviews the code, CodeRabbit reviews the pull request, and the real check
  is repeated after each round of fixes that touches this code.

## TikTok's rules: what was read

- "Login Kit for Web": https://developers.tiktok.com/doc/login-kit-web/
- "Get a user access token" and "Revoke": https://developers.tiktok.com/doc/oauth-get-a-user-access-token/
  and https://developers.tiktok.com/doc/oauth-revoke-a-user-access-token/
- "Get user info" (which permission each field needs): https://developers.tiktok.com/doc/tiktok-api-v2-get-user-info/
- "Add a sandbox": https://developers.tiktok.com/doc/add-a-sandbox/
- "Register your app" and "App review guidelines": https://developers.tiktok.com/doc/getting-started-create-an-app/
  and https://developers.tiktok.com/doc/app-review-guidelines/

Not stated on those pages, to be found out in the sandbox: what TikTok does on "Cancel"; whether
a one-time code is accepted once only; whether the sandbox has its own keys; and whether the
"profile" permission works in a sandbox before TikTok has approved it. TikTok's page of rules for
developers could not be opened; it is to be read by hand before sending the app for review.

## Astra's check of this plan (16 November 2026)

Verdict: ready with changes. It confirmed the main design: TikTok as a proof apart from logging
in; switched off enforced on the server at both ends; one fixed return address; the signed note
tied to the person; the secret only in a request's body and the key only in a header; one new
column, one new guard and one write for every saving case; and that the test over the app's
secure test address can work. Its points, all worked in above:

1. "Reuse the Instagram work with TikTok's addresses" said too little. TikTok's side is now
   written out, with what counts as a good answer.
2. Which of TikTok's two numbers is kept, and that a sandbox's numbers never meet the live site's.
3. Removing the cookie does not by itself make a return count once. The plan now says what it
   does and does not do, and why a doubled return is harmless.
4. The framework prints every request's address in development, which would print TikTok's code.
   The return address is taken out of that, and the app logs only fixed short reasons.
5. Refusing a typed TikTok name was not enough: "I've done it" from an old page would still have
   reached the founder's list. Both are refused now.
6. What the Hosting page shows for every state of a TikTok entry.
7. The exact fields of the one write, that plan 16's last-account rule must not be applied to a
   replacement, and that the person is checked again after the locks are held.
8. Writing every return into plan 17's table would have used up hosts' Instagram and YouTube
   checks. Only a refusal of our own keys is written, and plan 17's count is narrowed.
9. Which of TikTok's answers mean "our keys or permissions are the problem", and which must never
   be blamed on them.
10. Handing the key back is tried, not promised; every request has a time limit and follows no
    redirect.
11. What must be true for the real test over the app's test address.
12. The checks, split by what each kind can prove, with more cases.
