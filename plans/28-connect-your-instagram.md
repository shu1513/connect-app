# Plan 28: "Connect your Instagram": a host proves an Instagram account by signing in at Meta

**Status:** a plan only; nothing is built. Written 19 November 2026 by the builder alone (no
helper agents), from the code as it is on `main` after pull request 47, from plan 16 (whose part
two this replaces), plan 17 and plan 18, and from Meta's developer pages as read that day.

(Number 27 is kept for the plan about hosts outside the United States, which is being written at
the same time.)

## For the founder: what this is

Today a host proves an Instagram account by putting a code in the account's bio and pressing
"Check now"; Connect reads the bio through Meta and confirms the account by itself (plan 17).

This adds a second way, the one TikTok already has: a button, **"Connect your Instagram"**. The
host logs in at Meta, Meta tells Connect which Instagram account that is, and the account is
confirmed at once. No code in a bio. Connect never sees the password.

**The code stays.** Unlike TikTok, Instagram keeps both ways, because the code already confirms
by itself and works for a host who cannot or does not want to go through Meta's sign-in.

## Said plainly: three limits

1. **It cannot be used by real hosts yet.** Meta lets a new app be used only by people who have a
   role on it (the founder, and Instagram accounts invited as testers). For everyone else Meta
   asks for its review of the app, the app set to "live", and, by its own overview page, a
   verified business. There is no registered company yet. So this is built and tried with the
   founder's own Instagram account, and stays switched off on the live site until Meta has
   approved the app. That is the same position TikTok's sign-in is in.
2. **Meta's sign-in is heavier than TikTok's.** Meta no longer offers the simple "log in with
   Instagram" to new apps. Its replacement ("Unified Login") has the host log in with Instagram or
   Facebook, then **choose a "business portfolio"** (a free container inside Meta), then choose
   the Instagram account to share. Meta's pages do not say whether a host who has no portfolio is
   given one on the way. This has to be seen in the real try.
3. **Only Creator and Business accounts**, as with the code. A personal account cannot be shared
   this way; Meta's own screen does not show it.

**And it is blocked today:** on 19 November 2026 Meta's developer page for the founder's account
says "Account confirmation needed. We've noticed unusual activity on this developer account", and
Meta answers every request of the Connect app with "API access blocked". Until the founder has
confirmed the account, nothing here can be tried for real, and the automatic check of a code in
an Instagram bio (plan 17) does not work either.

## What Meta's pages say (read 19 November 2026)

- **The three set-ups.** "Instagram API with Unified Login is recommended for new integrations."
  The older "Instagram Login" and the Page-linked "Facebook Login" are described as for existing
  integrations. The founder's Meta app was offered only the first and the third (plan 16).
- **What the app must have:** it is owned by a business portfolio (done on 15 November 2026), has
  a "configuration" that lists the permissions asked for, and an https return address saved in
  that configuration.
- **The sign-in address:** `https://www.facebook.com/dialog/oauth` with `client_id` (the Meta
  app's number), `config_id` (the configuration's number, not a secret), `redirect_uri` (must be
  the saved one) and `response_type=code`.
- **Coming back:** Meta sends the host to the return address with a one-time `code`.
- **The swap:** a request from our server to
  `https://graph.facebook.com/v27.0/oauth/access_token` with the app's number, the app's secret
  and the code. The answer holds a key.
- **The key** belongs to the host's business portfolio, not to the person, and can cover several
  Instagram accounts. How long it lives is set in the configuration.
- **Which accounts:** `GET https://graph.facebook.com/v27.0/me/assigned_instagram_accounts`
  with `fields=id,username` gives a list of the accounts the host shared, each with its number
  and name. It needs the permission `instagram_basic`. (`/me` is not the Instagram account.)
- **Who can use it:** with "Standard Access", which every app has, only people with a role on
  the app. For others: "Advanced Access", through Meta's App Review, with the app in Live mode.

**What those pages do not say,** and the real try has to settle: whether the value we send along
(`state`) comes back unchanged; what comes back when the host presses "Cancel"; whether the swap
is accepted when the secret travels in the body of the request, and whether it wants the return
address again; the exact shape of the list of accounts; whether the account's number is the same
one Meta's other requests use for it; and whether a key can be handed back.

## How it works for a host

On the Hosting page, under "Your social media accounts", while the sign-in is switched on:

- A button **"Connect your Instagram"**, with: "Log in at Meta and your Instagram account is
  confirmed at once, with no code. It works for Creator and Business accounts. Meta will ask you
  to pick a business portfolio and the account to share. We never see your password."
- An Instagram account that is on the page and not confirmed yet keeps its code and "Check now",
  and gains the words: "Or press 'Connect your Instagram' above."
- After coming back: "Instagram @name is confirmed." Or one sentence saying why not, and that
  nothing was changed.

**If the host shares more than one Instagram account at Meta:** Connect takes the one whose name
or number is already on the host's page. If none is, it takes nothing and says: "You shared more
than one Instagram account. Add the one you want to your page first, or share only that one, and
try again." (One account per network, as everywhere.)

**A renamed account.** A host who connected by signing in and later renames the account presses
the button again: Meta gives the same number, and the name is updated without losing the proof.

For the founder there is nothing to do for an account confirmed this way. If Meta does not accept
our own app's number, secret or configuration, the admin page already has the line "Meta did not
accept our key or our permission"; it is used for this too.

## What Connect asks Meta for, and what it keeps

One permission, `instagram_basic`. One question: which accounts were shared, by number and name.
Connect keeps the number and the name of the one account, on the host's entry for Instagram, as
it does for TikTok. The key is used for that one question and is never stored or written to a
log. After the question Connect tries to hand the key back to Meta; whether Meta accepts that for
this kind of key is not in its pages. The configuration's key is set to the shortest life Meta
offers. Until the host removes it, Meta lists "Connect" among the apps connected to their
business portfolio; the privacy page says so, and where to remove it.

## How it is built

The sign-in for TikTok (plan 18) is the model, file for file. Nothing about TikTok's behaviour
changes.

- **Three settings:** `INSTAGRAM_APP_ID` (the Meta app's number), `INSTAGRAM_APP_SECRET`,
  `INSTAGRAM_LOGIN_CONFIG_ID`. The sign-in is on only when all three are there and the site's own
  address is a plain `https` address. While it is off, the button is not shown and the server
  refuses the start and the return without asking Meta anything or saving anything. (The two
  settings of plan 17's bio check are a different key and stay as they are.)
- **`src/lib/profiles/login-note.ts` (new, small):** the signed note that remembers who started
  a sign-in, moved out of `tiktok.ts` so both networks use one piece of code. Each network signs
  with its own label, so a note written for one is never accepted for the other. `tiktok.ts`
  calls it with TikTok's label; what it writes and accepts stays exactly the same, and its tests
  stay as they are.
- **`src/lib/profiles/instagram.ts` (new):** the settings, the sign-in address, reading Meta's
  two answers, choosing the account, and the three requests to Meta. No database. The secret
  travels in the body of a request and the key in a header, never in an address.
- **`src/lib/profiles/instagram-login.ts` (new):** `startInstagramLogin` and
  `finishInstagramLogin`, the same order of checks as TikTok's: our own note, the value and the
  person first; only then anything Meta sent.
- **`src/app/api/social/instagram/return/route.ts` (new):** the one return address. Removes the
  note first, asks who is logged in, calls `finishInstagramLogin`, and sends the host to the
  Hosting page with the sentence.
- **`src/lib/profiles/profiles.ts`:** `confirmSocialByLogin` and `noteRefusedSignIn` take
  `"instagram"` as well as `"tiktok"`. The one write that covers every case stays as it is: an
  entry confirmed with the code under the same name stays confirmed and gains the number; a
  different account replaces the old one in the same step. Adding an Instagram account with a
  code (`addSocialName`) is not touched.
- **`src/app/host/actions.ts`, `src/app/host/page.tsx`:** the button and the words.
- **`src/app/privacy/page.tsx`:** one sentence, beside TikTok's.
- No change to the database: the column for a network's own number exists (migration 0025).

**The steps of one sign-in**

1. The host presses the button. The server makes a random value, writes the signed note (the
   value, who started, 10 minutes) into a cookie only the return address gets, and sends the host
   to Meta with the value.
2. Meta sends the host back with a one-time code and the value. The return address removes the
   cookie, then checks: the note is ours and in time; the value matches; the person logged in to
   Connect now is the one who started; their account is not paused or closed.
3. The server swaps the code for a key, asks once which accounts were shared, and tries to hand
   the key back, whatever happened in between.
4. The account is chosen (see above) and saved as confirmed, in one database step under the
   profile's lock. If the name or the number is confirmed for another host, the database refuses
   and the host is told the account belongs to another host's page.

## How it is checked

- **Unit tests:** the settings (each one missing, an address that is not https); the sign-in
  address; the shared note (TikTok's tests unchanged, and a note of one network refused for the
  other); reading the two answers, also broken ones; choosing among none, one and several
  accounts.
- **`scripts/accounts-check.ts`, a new part beside TikTok's, with Meta's side pretended:** a
  first sign-in confirms; one person's return cannot attach an account to another person; a
  repeated return; "Cancel"; an account already confirmed with the code gains the number; a
  rename; a different account replaces the old one; an account confirmed for another host is
  refused; several accounts shared; our own keys refused shows on the founder's page; switched
  off means nothing is asked and nothing saved; a paused or closed person; and two sign-ins at
  the same moment.
- **Every other check script,** once more on the finished code.
- **The real try, with the founder's own Instagram account as a tester,** as for TikTok: through
  a temporary https address the founder starts, the return address saved in Meta's
  configuration, the app's secret put into the settings file by the founder. It settles the
  list under "What those pages do not say", and what the sign-in is like for a host. It is
  repeated after every review round that touches this code.
- Astra reviews the plan and then the code; then CodeRabbit on the pull request.

## What only the founder can do

- **Now:** confirm the developer account at Meta ("Confirm Account").
- **For the real try:** put the Meta app's secret into the settings file; start the temporary
  address; log in at Meta as the tester.
- **Before real hosts can use it:** a registered company, Meta's business verification, Meta's
  review of the app with a short recording of the sign-in, and the app set to "live". Only then
  are the three settings put on the live site.

## Left out on purpose

- Making Instagram the way to log in to Connect (decided against in plan 16).
- Keeping Meta's key to read anything later (posts, followers, messages). Nothing is asked for
  but the number and the name.
- Taking the host's profile picture from Instagram. The founder raised it on 19 November 2026;
  it is its own small plan, and it does not need this sign-in.
- Closing the code way for Instagram while the sign-in is on.
