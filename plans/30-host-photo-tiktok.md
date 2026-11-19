# Plan 30: A host's photo from TikTok (part two of plan 29)

**Status:** a plan only; nothing of this part is built. Written 19 November 2026 by the builder
alone (no helper agents), from the code as it is on `main` after pull request 50 (the host photo
from Instagram), and from TikTok's own page "Get User Info" as it read that day.

## For the founder: what this is

Plan 29 gave hosts a photo taken from their confirmed Instagram account. This adds the second
source it promised: **"Use my TikTok photo"**, for a host who has a confirmed TikTok account.

It works a little differently from Instagram, for one reason: Connect keeps no key from TikTok.
So it cannot ask TikTok for a picture later by itself. Pressing the button sends the host through
TikTok's sign-in once more (the same screen as "Connect your TikTok"), and the picture comes back
with that sign-in. "Update" does the same.

**Said plainly: at launch nobody but the founder can use it.** TikTok's sign-in is still in
TikTok's test mode and waits for TikTok's approval of the live site (plan 18). Until then the
photo will in practice come from Instagram. This part is built and tried now so that it is there
the day TikTok says yes.

## What TikTok's own page says (read 19 November 2026)

"Get User Info" (`https://open.tiktokapis.com/v2/user/info/`):

- The account's pictures (`avatar_url`, `avatar_url_100`, `avatar_large_url`) come under the
  permission `user.info.basic`. Connect already asks for that one, to read the account's number.
  So **no new permission**: the host sees the same TikTok screen as today.
- The page's own example of a picture address is on a server called
  `p19-sign.tiktokcdn-us.com`.
- The page says a change to this part of TikTok's service is planned ("a migration plan"). It
  does not say what changes. Worth a look before the live site is approved.

## The rules (on top of plan 29's, which all apply)

1. **A sign-in for the photo never changes the account on the host's page.** It only fetches a
   picture. To change the account there is "Connect your TikTok", as today.
2. **It must be the confirmed account.** The account the host signs in with at TikTok must be the
   one confirmed on their page: by TikTok's number for it when the page's entry has one, otherwise
   by its name. A different account gives no photo, changes nothing, and the host is told why.
3. **One photo at a time, as before.** Choosing TikTok while having an Instagram photo replaces it
   once the new picture has passed its check, and not before.
4. **The same checking, the same limits.** An outside service must pass the picture; a refused
   picture stays refused; five tries in any 24 hours, one at a time. A try counts from the press,
   also when the host then cancels at TikTok.
5. **The picture is asked for only when the host pressed the photo button.** An ordinary "Connect
   your TikTok" reads the account's number and name and nothing else, exactly as today.
6. **TikTok's key is used once and handed back,** as today. Nothing of it is kept.

## What the host sees

On the Hosting page, under "Your photo":

- A button for each confirmed account that can give a photo: "Use my Instagram photo" and "Use my
  TikTok photo". The TikTok one is there only while TikTok's sign-in is switched on and the host
  has a confirmed TikTok account. The button of the network the photo came from reads "Update".
- After TikTok's screen the host lands back on "Your photo" with one sentence: the photo was
  saved; or it was not accepted; or they signed in with a different account; or they did not
  finish at TikTok; and so on.
- A second press within two minutes of the first says: "You started this a moment ago. Finish at
  TikTok, or wait two minutes and try again." (Plan 29's "one at a time" rule.)

## How it is built

A try is written down **at the press**, before the host leaves for TikTok, and carried through
the sign-in. That is what plan 29's rules hang on: whatever removes the photo or changes the
account while the host is away stops that try, and what comes back writes nothing.

### 1. The signed note (`login-note.ts`)

The note that remembers who started a sign-in gets a third label, `tiktok-photo`, and for that
label one more signed part: the id of the try. A note for an ordinary sign-in is written exactly
as before, byte for byte (the existing test with a fixed note must pass unchanged), and a note
of one label is never accepted for another.

### 2. Asking TikTok for the picture too (`tiktok.ts`)

`tiktokAccountFor` gets one option, "with the picture". With it, the one question asked with the
key is `fields=open_id,username,avatar_large_url`; without it, the question is exactly today's.
`readAccountAnswer` hands on the picture's address when TikTok sent one as text, and says nothing
of it otherwise: a missing picture is not a failed sign-in. The key is handed back in every case,
as today.

### 3. Which servers a TikTok picture may come from (`photo-rules.ts`)

`tiktokcdn.com` and `tiktokcdn-us.com`, with the same guard as for Instagram (https, no name and
password, no port, the name ending in one of these after a full stop). The first is the family
TikTok's pictures are commonly served from; the second is the one in TikTok's own example.
**The real try decides:** a server that is not on the list ends the try as "could not be
fetched" and writes the server's family (never the address) to the log, and the list is then
corrected to what TikTok really answered.

### 4. The try (`photo.ts`)

- The start that Instagram's press uses is opened to this part as it is (`startPhotoTry`): the
  same locks and the same refusals (closed, paused, no profile, a locked photo, no confirmed
  account, a try under way, five in 24 hours, no checking service, a diary picture owed its full
  check). Nothing of it changes for Instagram.
- New, `finishTikTokTry`: given the try and what TikTok answered. The try must still be running,
  be this host's and be a TikTok try. The account TikTok named must be the entry the try started
  from (rule 2). There must be a picture address, on an allowed server. Then the very same path
  as Instagram's: fetch, Connect's copy, the look for an earlier refusal, the services, the
  finish that compares the entry once more. The entry itself is never written to.
- A try that never comes back from TikTok stays open and is marked as stopped at the host's next
  press, two minutes or more after it started, as plan 29 already has it.

### 5. Start and return (`tiktok-photo.ts`, new; the return address)

- **Start:** the settings must be there; the try is started; the host is sent to TikTok with a
  `tiktok-photo` note in the same cookie as today.
- **Return** (`/api/social/tiktok/return`, the one address registered with TikTok): the cookie is
  removed first, as today. If it holds a valid `tiktok-photo` note, this is a photo's return;
  otherwise it is handled exactly as today. A photo's return makes the same checks in the same
  order as an ordinary one before anything TikTok sent is used (our own note, the value sent
  along, the same person, not refused, both permissions given, the person neither paused nor
  closed). Those checks are one piece of code used by both. Then TikTok is asked, with the
  picture, and the answer goes to `finishTikTokTry`.
- When the host cancels at TikTok, or the checks fail after the note was accepted, the try is
  ended there and then, so the host need not wait two minutes to press again.
- TikTok refusing our own keys is written down for the founder's page as it is for an ordinary
  sign-in.

### 6. The pages

- The Hosting page: the buttons and sentences above. The action behind "Use my TikTok photo"
  checks on the server that the person is logged in and not paused, and takes the host from the
  login, never from the form.
- The privacy page: the sentence about the host's photo names TikTok too, and says that for
  TikTok the picture is read when the host signs in there for the photo. The sentence about
  connecting TikTok stays true as it is (rule 5), and stays.
- The founder's page and the host's page need nothing: they already show a photo's network.

## How it is checked

- **Unit tests:** the note with its extra part (written, read, changed, another label's note,
  the fixed old note still the same); TikTok's account answer with and without a picture; the
  request with and without "with the picture"; the allowed TikTok servers and their look-alikes.
- **`scripts/photo-check.ts`, a new journey,** with TikTok pretended (as `accounts-check.ts`
  pretends it): the photo is taken and shown; a different account, by number and by name; no
  picture; a server that is not allowed; the host cancels at TikTok; a note that was changed, is
  out of date, or belongs to an ordinary sign-in; started as one person and returned as another;
  the entry untouched in every case (compared field by field); the photo, the account or the
  whole Connect account changed while the host is away at TikTok; a second press within two
  minutes and after; an Instagram photo replaced only when the TikTok one has passed; a refused
  TikTok picture; TikTok refusing our keys.
- **`scripts/accounts-check.ts`** unchanged and passing: the ordinary sign-in is as it was.
- **Every other check script,** once more.
- **The real try,** in TikTok's test mode with the founder's own TikTok account, through a
  temporary https address: the founder starts the address, puts it into TikTok's developer page
  and signs in; the builder does the rest. What TikTok really answers (the picture's server, its
  size and kind) is written into this plan.
- Astra checks this plan and reviews the code; then CodeRabbit, both the comments on lines and
  the body of its review.

## Left out on purpose

- Keeping TikTok's key to fetch a picture later without a sign-in. Connect keeps no key.
- Asking for the picture at an ordinary "Connect your TikTok".
- Letting a sign-in for the photo also confirm or change the account.
- YouTube and X as sources.

## Open, and whose it is

- TikTok's approval of the live site (plan 18): the founder's, as before.
- TikTok's planned change to "Get User Info": to be read before the live site is approved.
- Everything plan 29 left open stays open (the child-safety tool; the lawyer).
