# Plan 17: Connect confirms a host's account by itself

**Status:** built (branch `plan/automatic-confirming`); what was built, the reviews and the checks are in `docs/module-record.md` under "A later change: Connect confirms a host's account by itself". One thing differs from the plan below: the keys travel in a header of each request, not in its address (Astra's review of the code). Below is the plan as it was approved. Written 15 November 2026. It builds on plan 16, part 1 (pull
request 26: a host needs one confirmed social media account before approval). Astra has checked it
against the code twice; what it found each time is at the end, and every point is worked in.

## What this is, and why

Today a host proves an account by putting a short code in that account's bio. Then the founder
opens the bio, looks for the code and presses "confirm". The founder's instruction: confirming
must happen by itself; nothing should wait for the founder to press a button.

After this change, for Instagram and YouTube, Connect reads the bio itself and confirms at once.

## What the founder decided (15 November 2026)

| Question | Decided |
| --- | --- |
| Who confirms an account? | **Connect, by itself**, wherever that is possible. |
| TikTok and X, which have no free official way to read a bio | **Confirmed by hand for now**, as today. TikTok's own sign-in is planned next, so TikTok becomes automatic too. |

## What was tried, and what Meta allows

Tried on 15 November 2026 with the founder's Meta app ("Connect") and the founder's own Instagram
account:

- Meta's simple "log in with Instagram" is "not available for newer apps" (Meta's own words on the
  app's set-up page). Its replacement works for people who have a role on our app; for everyone
  else Meta asks for its review and a verified business first. So a "Connect your Instagram"
  button cannot serve real hosts yet.
- **Reading a bio works today.** Meta has an official way, called "Business Discovery", for an app
  to read the public details of a professional Instagram account by its name. With a key for our
  own account, Meta returned the bio of an account that is not ours. It needed two read-only
  permissions (`instagram_basic` and `instagram_manage_insights`); with the first alone Meta
  refused.

Said plainly:

- **Only "Creator" and "Business" accounts can be read.** Meta does not show a personal account
  this way. Nearly every influencer has a Creator account, and switching is free.
- **Meta allows this today for an app that has not been through its review.** Meta's pages do not
  promise it. If Meta closes it, hosts are told the check is not available, nothing is confirmed
  wrongly, the founder sees it on the admin page (below), and the choice then is Meta's review or
  confirming by hand again.
- **Meta counts our requests.** How many it allows is Meta's to change; the plan assumes about 200
  an hour for the whole app, and keeps well under it.

YouTube has an official address for the same thing (the YouTube Data API): given a channel's
handle, it returns the channel's description. It is free and needs a key from Google.

## How it works for a host

Nothing new to learn, one step less to wait for.

1. Add the account's name. Connect shows the code, as today.
2. Put the code in the bio (Instagram) or the channel description (YouTube).
3. Press **"Check now"** (today the button says "I've done it").
   - **Found:** "Account confirmed. You can remove the code." Done, at once.
   - **Not found:** "We looked at @name and did not find the code. Save it, wait a minute, and
     press Check now again."
   - **The account cannot be read** (the name is wrong, or it is a personal Instagram account):
     "We could not read @name. Check the name. On Instagram it must be a Creator or Business
     account, which is free to switch to in Instagram's settings."
   - **Meta or Google cannot be reached, or refuses us:** "We could not check right now. Please
     try again in a few minutes." Nothing is confirmed.
   - **Too many checks:** "Please wait a moment before checking again", or, after 10 checks in an
     hour, "You have checked many times. Please try again in an hour."
4. Once confirmed, the code can be taken out.

Next to an Instagram entry the page says, before the host starts: "This works for Creator and
Business accounts." For YouTube the page says "channel description" where it says "bio" for the
others.

**Which button a host sees** is decided by the server, from the network and the settings. The
first line that fits is the one that counts:

| The entry | What the host sees |
| --- | --- |
| 1. Confirmed | "Confirmed", as today. |
| 2. Code run out | "Add the account again", as today. |
| 3. Instagram or YouTube, and its settings are there | The code and **"Check now"**. Also for an entry that was already waiting for the founder. |
| 4. Any other, after "I've done it" | "Waiting for us to check", as today. |
| 5. Any other | The code and **"I've done it"**, as today. |

The one action behind both buttons looks at the entry and the settings itself and takes the right
path, whichever button was pressed.

A form from an old page cannot push an Instagram or YouTube entry onto the founder's list when its
setting is there: the server looks at the entry, not at which button was pressed. And a key that
is there but refused by Meta does not quietly fall back to the founder's list; the host is told
the check is not available.

## How it works for the founder

New Instagram and YouTube requests no longer come to "Social media accounts to check". TikTok and
X do, and so does anything that was already waiting there, or a network whose setting is missing.
Nothing on that list changes.

**So that a broken key does not go unnoticed:** the admin page gets one line when it applies:
"Automatic Instagram checks have been failing: Meta did not accept our key or our permission in
3 checks in the last 24 hours." (The same for YouTube and Google.) It says what happened, not
that the check is down right now. Only answers that are about our own key or permission are
counted, never one that is about the host's account. The founder does not read logs, so this is
where it shows.

Approving a host is unchanged: the founder still looks at each profile, with its confirmed
accounts next to it.

## How it is built

- **A new file, `src/lib/profiles/bio-check.ts`.**
  - Plain logic, testable on its own: is the code in this text (capital letters do not matter);
    and reading Meta's and Google's answers into one of five results:
    the text of the bio; "no account we can read"; "asked too often"; "our key or permission was
    refused"; "not available". Anything not recognised is "not available".
  - Meta's answers are told apart by Meta's own numbers, not by the kind of failure: 190 and 102
    (the key), 10 and 200 to 299 (permission), 4, 17, 32, 613, 341 and 80002 (asked too often).
    Which number Meta gives for a name that does not exist, and for a personal account, is not
    documented; both are looked up for real before the code is written, and until a number is
    known for sure such an answer counts as "not available", never as "no account". Google's are
    told apart by its reasons ("quotaExceeded", "keyInvalid", "accessNotConfigured"); a good
    answer with no channel in it is "no account we can read".
  - The requests, always fresh (nothing kept from an earlier answer), each with a time limit of a
    few seconds that covers waiting for the answer and reading it, and no second try.
    - Instagram: Meta's Graph address, version v27.0 as tested: one request for the host's account
      by name, asked as our own account. Our own account's number is a setting (below), so a check
      is always exactly one request to Meta and nothing has to be looked up or remembered first.
    - YouTube: `channels` with `part=snippet` and `forHandle=@name`; the code is looked for in the
      channel's description. (Tried for real on 15 November 2026: a channel that exists comes back
      with its description and its handle; a handle that does not exist comes back as a good
      answer with no channel in it.)
  - The name put into a request is the cleaned-up name the app already stores (small letters,
    numbers, dots, underscores and, on YouTube, hyphens), built into the address with the
    platform's own tool for that, so nothing a host types can change the request.
  - The answer must be for the same name. Instagram: the name Meta returns is compared with ours,
    capital letters aside. YouTube: the one channel the exact handle leads to is trusted; if the
    answer carries a handle and it differs, it is not used. The channel's title is never compared
    (it is a display name).
  - Everything that can go wrong inside this file (no connection, time limit, an answer that
    cannot be read) comes out as one of the five results. Nothing from the request, its address or
    the answer is ever passed on in an error, because the key is in the address. What is written
    to the log is only: which network, which of the five results, and Meta's number.
- **Three settings.** For Instagram, `INSTAGRAM_CHECK_TOKEN` (the key from Meta) and
  `INSTAGRAM_CHECK_ACCOUNT_ID` (the number of our own Instagram account, which is not a secret;
  both must be there). For YouTube, `YOUTUBE_API_KEY` (from Google). The two keys are on the
  founder's computer already. A network whose settings are missing works as today, by hand. So
  the app runs without any of them.
- **The database: one small new table, `bio_checks`.** One row per automatic check: who, which
  network, when it started, and how it ended. How it ended is empty while the check is under way,
  and then one of: "found", "not found", "no account we can read", "asked too often", "our key or
  permission was refused", "not available". The bio's text is never stored. Two indexes, by person
  and time and by network and time. Rows are kept; at launch size nothing needs to clear them.
  The table does three jobs that one more column on the account could not, because an entry can be
  removed and added again:
  1. no more than one check every 30 seconds per person and network (a double press);
  2. no more than 10 checks an hour per person, and no more than 100 an hour for all of Instagram
     together (half of what Meta is assumed to allow). A check counts from the moment it starts,
     whether or not it has ended and however it ended;
  3. the line on the admin page.
  A person with several logins cannot be recognised as one person; the shared limit is what keeps
  them from using up Meta's allowance.
- **`src/lib/profiles/profiles.ts`: one new function, "check now".**
  1. One short step in the database, under the same kind of one-at-a-time lock the email and
     connection-test limits use. Two locks, always taken in this order: for Instagram, one for all
     of Instagram (`bio-check:instagram:global`); then one for the person, for both networks
     (`bio-check:user:<id>`). The time is read after the locks are held. Then: find this person's
     own entry (not confirmed, code not run out), check the three limits, and write the row for
     this check, all before the step ends. It hands back the exact name and code it is about to
     check. Only when this step succeeds is anything asked of Meta or Google.
  2. Ask Meta or Google. This happens outside any database step, so nothing is held locked while
     waiting for another company's server.
  3. Write how it ended onto the check's row ("found" when the code was in the bio, whatever
     happens in the next step).
  4. Code found: confirm, with one guarded change that only applies if the entry is still this
     person's, on this network, with this name and this code, still not confirmed, and its code
     still not run out at that moment. It leaves "confirmed by" empty and clears "waiting for the
     founder". If nothing was changed, the entry was altered, removed, run out or confirmed in the
     meantime: nothing is confirmed. If the name has meanwhile been confirmed for another host,
     the database refuses, and the host is told so.
  The locks of plan 16 are not needed here: confirming only ever adds a confirmed account, and
  everything that takes one away or approves a profile already waits its turn.
- **`src/app/host/actions.ts` and `page.tsx`:** the button, its messages, and the note after
  adding an account (it says "I've done it" for every network today).
- **`src/app/admin/people/page.tsx`:** the one line about a refused key.
- **The privacy page:** one sentence. "To confirm an Instagram or YouTube account, we read its
  public bio (on YouTube, the channel's description) through Instagram's or YouTube's own service
  and look for the code." The page stays the placeholder it is until a lawyer writes it.

**What a wrong answer cannot do.** The check can only ever confirm an entry whose bio really
showed the code a moment ago. A failure of any kind confirms nothing. A confirmed account is not
checked again later.

## What only the founder can do

1. **Meta:** done on 15 November 2026 (the app, the two permissions, the key in the private
   settings file). When the app goes live, the same key goes into the hosting service's settings.
2. **Google, for YouTube:** set up on 15 November 2026 in the founder's Google account: a project
   named "Connect app", "YouTube Data API v3" switched on, and a key that may use that service
   only. The founder presses "Create" and saves the key. Until it is saved, YouTube is confirmed
   by hand.

## What is not in this plan

- TikTok's own sign-in (planned next, its own plan: TikTok must approve our app first).
- X. Its official service costs money every month.
- A "Connect your Instagram" button through Meta's sign-in. It needs Meta's review and a verified
  business. The set-up for it exists at Meta for later.
- Checking a confirmed account again from time to time.
- Reading anything else from Instagram or YouTube (followers, pictures, posts).
- Watching the keys from outside the app. The line on the admin page is what there is for now.

## How it will be checked

- **Tests for the plain logic:** the code in a bio (in the middle of other text, in capitals, with
  an emoji next to it; a code that is only half there; another host's code); Meta's answers (a
  bio; an empty bio; each group of Meta's numbers; an answer for a different name; an answer that
  cannot be read); Google's answers (a description; no channel; each reason; a handle that
  differs; an answer that cannot be read).
- **The accounts script.** "Check now" takes the asking of Meta and Google as a part that can be
  handed in, the way the connection test already does; the script hands in pretended answers. The
  real action hands in nothing and takes nothing of the kind from a form or an address, so there
  is no test switch in the running app.
  - Not found first, then found: confirmed at once, never in the founder's list, "confirmed by"
    empty.
  - Not found, no account, asked too often, key refused, not available, an answer that takes too
    long: the entry and its code are unchanged (the check itself is noted), and each gives its own
    message.
  - A second check within 30 seconds makes no request; many at the same moment make one; the
    eleventh in an hour is refused; removing the entry and adding it again does not reset any of
    this; the shared Instagram limit stops everyone.
  - While a check is under way (the pretended answer is held back): the name is replaced; the
    entry is removed and added again; the code runs out; the founder confirms it; the founder says
    "the code is not there". In each case the outcome is the right one and nothing is confirmed
    that should not be.
  - The name confirmed for another host in the meantime: refused, the other host keeps it.
  - Someone else's entry cannot be checked. A code that has run out is not checked.
  - An entry that was already waiting for the founder can be checked, and leaves the list when
    confirmed.
  - With a setting missing, Instagram and YouTube go to the founder's list as today, each on its
    own. TikTok and X always do.
  - With plan 16's rules: a host whose only account was just confirmed by a check can be approved,
    and then cannot remove that account.
  - The admin page's line appears after a refused key and not otherwise.
- **For real, by hand:** with the founder's own Instagram account: add the name, press "Check now"
  before the code is there and see "not found"; put the code in the bio, press again and see it
  confirmed. A name that does not exist and a personal account's name, to see what Meta really
  answers (those answers, with nothing secret in them, become test cases). The same on YouTube
  once the key is saved. Also at phone size.
- Then the usual: Astra reviews the code, and CodeRabbit reviews the pull request.

## Astra's check of this plan (15 November 2026)

Verdict: ready with changes. It confirmed that today's flow is described correctly, that nothing a
host can type can alter either request, that the YouTube request and the channel description are
the right ones, that confirming needs none of plan 16's locks, and that the admin list needs no
change. Its points, all worked in above:

1. A 30-second wait alone did not keep one person from using up Meta's allowance, and removing and
   adding an entry would have reset it. There are now limits per person and for all of Instagram,
   kept in their own small table.
2. The exact guards of the first step and of the confirming step, including that the code has not
   run out at the moment of confirming.
3. What happens between the automatic and the by-hand way: which button shows when, that an entry
   already waiting can be checked, that the server decides, and that a refused key does not fall
   back to the founder's list.
4. How Meta's and Google's answers are told apart, by their own numbers and reasons, with anything
   unknown counted as "not available". Nothing secret in errors or the log.
5. On YouTube there is no returned name to compare the way Instagram has one; the plan now says
   what is trusted.
6. Always fresh requests, a time limit that covers reading the answer, and our own account's
   number remembered in a way that recovers from a failure.
7. A key that stops working would have gone unnoticed. The admin page now says so.
8. How the script can pretend answers without a test switch in the running app; two checks that
   could not have worked as first written; more cases.
9. "Shown on your page" was not true for a host who is not approved yet; the message now says
   "Account confirmed". The privacy sentence names the channel description.

## Astra's second check, of the plan as it is now (15 November 2026)

Verdict: ready with changes. It found the confirming steps sound, the table and its three limits
reasonable, and the one line on the admin page enough. Its points, all worked in above:

1. The two locks are now named, with their order.
2. A check could have been two requests to Meta (one to look up our own account's number) while
   being counted as one. Astra's fix was to count requests; the smaller fix taken here is to make
   that number a setting, so a check is always one request.
3. The admin page's line said more than is known. It now says what Meta answered and how often,
   and counts only answers about our own key or permission.
4. What a check's row holds while it is under way and after a good read; the bio's text is never
   stored.
5. The order in which the page decides what a host sees, and that one action serves both buttons.
