# Plan 28: "Connect your Instagram": a host proves an Instagram account by signing in at Meta

**Status:** a plan only; nothing is built. Written 19 November 2026 by the builder alone (no
helper agents), from the code as it is on `main` after pull request 47, from plan 16 (whose part
two this replaces), plan 17 and plan 18, and from Meta's developer pages as read that day. Astra
checked it once: "not ready", six points that had to change, all worked in (the list is at the
end).

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
2. **Meta's sign-in is heavier than TikTok's.** Meta's pages say a newly created app cannot set
   up the simple "log in with Instagram". Its replacement ("Unified Login") has the host log in
   with Instagram or Facebook, then **choose a "business portfolio"** (a free container inside
   Meta), then choose the Instagram account to share. Meta's pages say a professional account
   already has a portfolio, and that someone logging in with Facebook can make one on the way.
   What that is really like for a host has to be seen in the real try.
3. **Only Creator and Business accounts**, as with the code. A personal account cannot be shared
   this way; Meta's own screen does not show it.

**And it is blocked today:** on 19 November 2026 Meta's developer page for the founder's account
says "Account confirmation needed. We've noticed unusual activity on this developer account", and
Meta answers every request of the Connect app with "API access blocked". Until the founder has
confirmed the account, nothing here can be tried for real, and the automatic check of a code in
an Instagram bio (plan 17) does not work either.

## What this proves, said plainly

Signing in at Meta shows that the host **is allowed to share that Instagram account through
Meta**: Meta lets someone do that who has full control of the business portfolio it sits in. For
a creator that is the creator. It can also be a manager or an agency.

Connect accepts two proofs for Instagram from now on: the code was seen in the account's bio, or
the account was shared with us through Meta. They are not the same thing technically, and
either can be given by a manager. Neither alone shows that the host is the person the account is
about. Plan 16 spoke of "the person behind that account"; what the proofs really show, and what
"confirmed" means in the app, is: **this host runs this account.** This plan says so here, so
it is a choice and not an accident. What follows from it:

- The founder still looks at every profile before it is approved, with the confirmed accounts
  beside it, and that look (does the name and the page fit the account?) is what guards against
  someone passing as another person. A confirmed account is not the answer to that question.
- That look happens once, at approval. An approved host can later replace their account by
  signing in with another one they may share, as with TikTok today, and nobody looks again.
- The ID check shows who the Connect person is and that they are 18. It is not compared with
  the Instagram account.
- An account is confirmed for one host only. If a manager confirms a creator's account first,
  the creator is refused and writes to us. Sorting that out is the founder's decision and is
  done by hand in the database; there is no button for it, and suspending the manager's page
  alone does not free the account. No dispute screen is built for this.
- Two sentences in the app say more than this and are reworded with this plan: the Hosting page
  ("we use one of them to check that you are you") and the founder's list ("says they own").

## What Meta's pages say (read 19 November 2026)

- **The three set-ups.** "Instagram API with Unified Login is recommended for new integrations."
  The older "Instagram Login" and the Page-linked "Facebook Login" are described as for existing
  integrations. The founder's Meta app was offered only the first and the third (plan 16).
- **What the app must have:** it is owned by a business portfolio (done on 15 November 2026), has
  a "configuration" that lists the permissions asked for, and an https return address saved in
  that configuration.
- **The sign-in address:** `https://www.facebook.com/dialog/oauth` with `client_id` (the Meta
  app's number), `config_id` (the configuration's number, not a secret), `redirect_uri` (must be
  the saved one), `response_type=code`, and `state`, a value of ours that Meta's general guide
  says comes back unchanged.
- **Coming back:** Meta sends the host to the return address with a one-time `code` and our
  `state`. If the host pressed "Cancel", it comes back with `error=access_denied` instead.
- **The swap:** a request from our server to
  `https://graph.facebook.com/v27.0/oauth/access_token` with the app's number, the app's secret,
  the code, and the return address once more. (Meta's general guide asks for the return address
  here; its page for Unified Login leaves it out. It is sent.) The answer holds a key.
- **The key** belongs to the host's business portfolio, not to the person, and can cover several
  Instagram accounts. How long it lives is set in the configuration.
- **Which accounts:** `GET https://graph.facebook.com/v27.0/me/assigned_instagram_accounts`
  with `fields=id,username` gives a list of the accounts the host shared, each with its number
  and name. It needs the permission `instagram_basic`. (`/me` is not the Instagram account.)
- **Who can use it:** with "Standard Access", which every app has, only people with a role on
  the app. For others: "Advanced Access", through Meta's App Review, with the app in Live mode.

- **The account's number:** Meta's own guide for moving from the older login says the `id` in
  that list is the account's lasting number (the one the older login called `user_id`), not a
  number that differs from app to app. It is kept as text, exactly as it came.
- **Taking the connection away:** in Meta's own settings, under the business portfolio's
  "Integrations", "Connected apps". We have not found, in the pages read, a request by which an
  app hands back one key of this kind; the requests Meta describes for managing these keys need
  the wider permission to manage the host's business, which this plan does not ask for.

**What those pages do not say, or say in two ways,** and the real try has to settle before this
is called working:

1. Whether a configuration that asks for `instagram_basic` alone is accepted. Meta's set-up page
   makes a new configuration with the permission to read messages as well. On 15 November 2026 a
   configuration "Connect prove account" was made with `instagram_basic` only and Meta marked it
   "Instagram Login Compatible"; whether a host can really finish a sign-in with it has not been
   seen. **If Meta insists on more permissions, building stops and the founder is asked:** this
   plan does not quietly ask hosts for access to their messages.
2. Whether the swap is accepted with the secret in the body of the request. Meta's examples put
   it in the address. **If Meta refuses the body, building stops and the founder is asked:** the
   secret is not quietly moved into an address.
3. The exact shape of the list of accounts, and what the list looks like when the host shared
   several.
4. What the sign-in is like for a host, and whether `prompt=login` (which makes Meta always offer
   both the Instagram and the Facebook way in) is needed.
5. Who can be a tester: Meta's page for this kind of login asks that the tester has a role on
   the app and full control of the business portfolio that is shared, and that this portfolio
   is not the one that owns our app.
6. Whether Meta accepts the same one-time code a second time.

**Seen for real on 19 November 2026,** with the key the app already has for reading bios (a key
of the same kind, for the founder's own Instagram account): the list of accounts comes as
`{"data":[{"id":"…","username":"…"}],"paging":{"cursors":{…}}}`. The cursors are there also when
there is nothing more, so they do not mean "more"; a `next` address would. And the `id` in that
list is the same number Meta's other requests use for that account.

## How it works for a host

On the Hosting page, under "Your social media accounts", while the sign-in is switched on:

- A button **"Connect your Instagram"**, with: "Log in at Meta and your Instagram account is
  confirmed at once, with no code. It works for Creator and Business accounts. Meta will ask you
  to pick a business portfolio and the account to share. We never see your password."
- An Instagram account that is on the page and not confirmed yet keeps its code and "Check now",
  and gains the words: "Or press 'Connect your Instagram' above."
- After coming back: "Instagram @name is confirmed." Or one sentence saying why not, and that
  nothing was changed.

**Which account is taken.** Meta's list is the only source: a name the host typed is never
confirmed unless Meta's list holds it. The rule, in this order:

1. Meta shared exactly one account: that one. (As with TikTok, it replaces whatever Instagram
   entry the host had.)
2. Meta shared several, and one of them has the **number** already kept on the host's Instagram
   entry: that one, whatever the names say. (A renamed account stays the same account.)
3. Meta shared several, the host's entry has no number, and **exactly one** has the name on the
   host's entry: that one.
4. Several, and neither of those: nothing is taken. "You shared more than one Instagram account.
   Please try again and share only the one for your page."

Meta shared none: nothing is taken. "Meta did not share an Instagram account with us. Nothing
was changed. It must be a Creator or Business account."

The list is asked for up to 100 accounts. If Meta's answer says there is a further page,
whatever the number on this one, nothing is taken, with the sentence of case 4. A list in which
any line cannot be read (no number, no name, the same account twice) is not a list: nothing is
taken and nothing is written; lines are never dropped to leave "exactly one". If the account
that the rule picks is confirmed for another host, the sign-in is refused; no other shared
account is taken in its place. The number and the name always come from the same line. The
host's entry is read, and the account chosen, inside the same database step that saves it, with
the profile's lock held, so a choice is never made against an entry that has changed meanwhile.

**A renamed account.** A host who connected by signing in and later renames the account presses
the button again: Meta gives the same number, and the name is updated without losing the proof.

For the founder there is nothing to do for an account confirmed this way. If Meta's answer to the
swap says our own app's number or secret is wrong, the admin page says so ("Meta did not accept
our keys when a host signed in"). Other failures are not put down to our keys. (A wrong
configuration can stop the host at Meta before anything reaches us; then there is nothing to
show, as plan 18 says of TikTok.)

## What Connect asks Meta for, and what it keeps

One permission, `instagram_basic` (see point 1 above). One question: which accounts were shared,
by number and name. Connect keeps the number and the name of the one account, on the host's entry
for Instagram, as it does for TikTok. The key is used for that one question and is then dropped:
never stored, never written to a log. It is **not** handed back to Meta, because Meta's pages
name no request for that which fits (see above); the configuration is set to the shortest life
Meta offers for its keys, and that length is written into the record when the real try is done.

Until the host removes it, Meta lists "Connect" among the apps connected to their business
portfolio. The privacy page says so and where to remove it, and says plainly that removing the
connection at Meta does not take the account off the host's Connect page (that is "Remove" on
the Hosting page), and the other way round. The confirmation is a record that the proof was
given, like the code; it is not checked again later.

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
  keeps its own three functions with the same names and calls the shared code with TikTok's
  label ("tiktok-login:" before the same text as today), so every note it writes and accepts is
  the same, byte for byte. Its tests stay as they are, and one is added with a note written by
  today's code, which the new code must read, and whose text the new code must write.
- **`src/lib/profiles/instagram.ts` (new):** the settings, the sign-in address, reading Meta's
  two answers, the rule for which account is taken, and the two requests to Meta. No database.
  The secret travels in the body of a request and the key in a header, never in an address.
  Requests have a time limit, follow no redirect and are not tried again, as TikTok's.
- **`src/lib/profiles/instagram-login.ts` (new):** `startInstagramLogin` and
  `finishInstagramLogin`, the same order of checks as TikTok's: our own note, the value and the
  person first; only then anything Meta sent.
- **`src/app/api/social/instagram/return/route.ts` (new):** the one return address. Removes the
  note first, asks who is logged in, calls `finishInstagramLogin`, and sends the host to the
  Hosting page with the sentence.
- **`src/lib/profiles/profiles.ts`:**
  - `confirmSocialByLogin` takes `"instagram"` as well as `"tiktok"`, and for Instagram a list
    of accounts in place of one: inside its database step, after the profile's lock, it reads
    the host's Instagram entry, applies the rule above, and writes. The one write that covers
    every case stays as it is: an entry confirmed with the code under the same name stays
    confirmed and gains the number; a different account replaces the old one in the same step.
    (As for TikTok, the entry's "confirmed at" becomes the moment of the sign-in.)
  - `noteRefusedSignIn`: a refusal at an Instagram sign-in is written under a name of its own
    ("instagram_sign_in"), never as "instagram". That is the name of an event in that one table;
    it is not added to the list of networks. The limits of the bio check count the lines
    named "instagram" and "youtube" (so many an hour for one person, so many an hour for
    everyone, 30 seconds apart); a sign-in that failed read no bio and must not use any of them
    up. The founder's line counts refusals under any name, so it shows this one without a
    change to its counting, with its own words.
  - Adding an Instagram account with a code (`addSocialName`) is not touched.
- **`src/app/host/actions.ts`, `src/app/host/page.tsx`:** the button and the words. TikTok's
  switch on that page hides the code and "Check now" for TikTok; Instagram does **not** use that
  switch. An Instagram entry is drawn as today in every state (waiting for its code, code run
  out, waiting for the founder, confirmed with the code, confirmed by signing in), with the
  sign-in on or off, and only gains the one line about the button while it is not confirmed.
- **`src/app/admin/people/page.tsx`:** the founder's line for a refused sign-in gets its own
  words from start to end ("Meta did not accept our keys when a host signed in with Instagram,
  N times in the last 24 hours"), so the event's name never shows; and "says they own" becomes
  "says they run".
- **`src/app/privacy/page.tsx`:** the sentences above, beside TikTok's.
- **`next.config.ts`:** the return address for Instagram joins TikTok's in the list of addresses
  the development server does not print: it carries a one-time code. (On the live site the same
  holds for its access log, as plan 18 says.)
- No change to the database: the column for a network's own number exists (migration 0026).

**The steps of one sign-in**

1. The host presses the button. The server makes a random value, writes the signed note (the
   value, who started, 10 minutes) into a cookie only the return address gets, and sends the host
   to Meta with the value.
2. Meta sends the host back with a one-time code and the value. The return address removes the
   cookie, then checks: the note is ours and in time; the value matches; the person logged in to
   Connect now is the one who started; their account is not paused or closed. Only after that is
   anything else Meta sent looked at, a refusal included. (This is not "once only": removing the
   cookie stops an ordinary reload, and a return that is sent twice or with a cookie put back
   stays tied to the person who started. Each one that gets an answer from Meta goes through the
   rule for which account is taken and the database's one-owner rules again, as they stand at
   that moment.)
3. The server swaps the code for a key and asks once which accounts were shared. The key is then
   dropped.
4. The account is chosen (see above) and saved as confirmed, in one database step under the
   profile's lock. If the name or the number is confirmed for another host, the database refuses
   and the host is told the account belongs to another host's page.

## How it is checked

- **Unit tests:** the settings (each one missing, the signing secret missing, an address that is
  not https); the sign-in address; the shared note (TikTok's tests unchanged, the fixed note from
  today's code, and a note of one network refused for the other, both ways); reading the two
  answers, also broken ones, a list with a line that has no number or no name, the same account
  twice, a number too long for a JavaScript number kept exact, and "there are more"; the rule for
  which account is taken, each of its four cases, and a number match and a name match that point
  at two different accounts (the number wins); the requests themselves with a pretended Meta
  (method, the secret only in the body, the key only in a header, the time limit, no redirect
  followed).
- **`scripts/accounts-check.ts`, a new part beside TikTok's, with Meta's side pretended:** a
  first sign-in confirms; a name the host typed that is not in Meta's list is never confirmed;
  one person's return cannot attach an account to another person; a note of TikTok's is not
  accepted; a repeated return and two returns at the same moment; "Cancel"; an account already
  confirmed with the code gains the number; a rename; a different account replaces the old one;
  an account confirmed for another host is refused, by name and by number; several accounts
  shared, each case of the rule; the host's entry changed or removed while Meta was answering;
  our own keys refused shows on the founder's page **and uses up none of the bio check's
  limits, neither the person's nor everyone's**; switched off means nothing is asked and nothing
  saved; a paused or closed person; a sign-in while the founder's "confirm" for the same entry
  is pressed.
- **Through the running app:** the return address removes the cookie and sends the host on,
  logged in and not logged in; the Hosting page in each state of an Instagram entry, with the
  sign-in on and off.
- **Every other check script,** once more on the finished code.
- **The real try, with the founder's own Instagram account as a tester,** as for TikTok: through
  a temporary https address the founder starts, the return address saved in Meta's
  configuration, the app's secret put into the settings file by the founder. It settles the five
  points under "What those pages do not say", the first two before anything else. It is repeated
  after a review round that changes how Meta is asked, how its answers are read, the cookie, or
  the saving.
- Astra reviews the plan and then the code; then CodeRabbit on the pull request.

## What only the founder can do

- **Now:** confirm the developer account at Meta ("Confirm Account").
- **For the real try:** put the Meta app's secret into the settings file; start the temporary
  address; log in at Meta as the tester.
- **Before real hosts can use it:** Meta's business verification (the founder's understanding is
  that this needs a registered company; to be confirmed with Meta when the time comes), Meta's
  review of the app with a short recording of the sign-in, and the app set to "live". One thing
  to ask Meta then: its page for this kind of login says in one place that the app also needs
  approved access to the "public profile" permission, and in another that this kind of key
  cannot have it. Only after all that are the three settings put on the live site.

## Left out on purpose

- Making Instagram the way to log in to Connect (decided against in plan 16).
- Keeping Meta's key to read anything later (posts, followers, messages). Nothing is asked for
  but the number and the name.
- Taking the host's profile picture from Instagram. The founder raised it on 19 November 2026;
  it is its own small plan, and it does not need this sign-in.
- Closing the code way for Instagram while the sign-in is on.

## Astra's check of this plan (19 November 2026): "not ready"

Astra read the plan against the code and against Meta's pages (all but one opened). Its points,
all worked in above:

| Astra's point | What was done |
| --- | --- |
| Signing in at Meta shows that someone may manage the account, not that they are the person behind it. The plan changed what "confirmed" means without saying so. | Said plainly in "What this proves", with what is kept because of it. It is the same strength as the code in the bio. |
| Meta's set-up page makes a configuration with more than one permission; "one permission" was promised without proof. | Point 1 of the real try, before anything else, and building stops if Meta insists on more. |
| "Name or number" was not a rule: a renamed account and another with its old name could be mixed up; a list with more pages could be taken for a list of one; the choice was made against an entry read too early. | The four cases in order, the number first; more than 100 is refused; chosen and saved in one database step under the lock. |
| A refused sign-in written as "instagram" would use up the bio check's limits, for the person and for everyone. | Written under a name of its own; checked for both limits. |
| The swap left out the return address, and assumed the secret can travel in the body. | The return address is sent; the body is point 2 of the real try, and the secret is never moved into an address quietly. |
| The return address was not in the list of addresses the development server does not print. | Added. |
| Smaller: `state` and "Cancel" are in Meta's general guide; no request for handing a key back is known, so none is made up; who can be a tester; what the founder's warning can honestly cover; a fixed note to prove TikTok's notes stay the same; the Hosting page must not reuse TikTok's switch; more cases to check; the migration's number. | Each worked in where it belongs. |

Astra found nothing over-built, and advised against three things this plan does not do: keeping
or managing Meta's keys, a screen for picking an account, and a general sign-in framework.

**Astra's second check (19 November 2026): "ready with changes", nothing that must change.** It
walked the rule for which account is taken through five cases against the code and found it
right, and the same as TikTok's where one account is shared; it found every reader of the table
of checks copes with the new event name. Its wording points are worked in: the two proofs are
both accepted, not "the same strength"; the founder's look happens at approval only; a repeated
return is tied to its person, not "harmless"; an empty list has its own sentence; a list that
cannot be read or goes on is refused whole; a dispute is repaired by hand, with no button; the
tester's portfolio must not be the app's; and "no request to hand a key back" is said as "none
found".
