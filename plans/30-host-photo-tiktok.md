# Plan 30: A host's photo from TikTok (part two of plan 29)

**Status:** a plan; the first small step is built (TikTok can be asked for the picture's
address). Written 19 November 2026 by the builder alone (no helper agents), from the code as it
is on `main` after pull request 50 (the host photo from Instagram), and from TikTok's own page
"Get User Info" as it read that day. Astra checked it ("ready with changes"); what it found is
worked in, and listed at the end.

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
- The page carries a notice about "a migration plan". Astra opened it: it is the change of 2024
  that moved the account's name under the permission `user.info.profile`, which Connect already
  asks for. Nothing new is announced there.

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
6. **TikTok's key is used once and handed back,** as today. Nothing of it is kept. (Said exactly,
   as the code already says it: handing it back is tried every time a key was issued; if TikTok
   cannot be reached at that moment, the key runs out by itself.)

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
- **Two browser tabs at once:** both sign-ins keep their note in the same cookie, as TikTok's
  sign-in always has. If a host starts a second sign-in before finishing the first, the first
  one's return is not accepted, and the second one may have to be started again too. Nothing
  wrong is ever saved; the host presses the button once more.

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
  press that gets that far, two minutes or more after it started, as plan 29 already has it.
  Coming back later than two minutes is fine as long as no newer press has stopped the try; the
  note itself runs out after ten minutes.
- **One return owns the try.** The try's line gets one new field, the moment its return was
  taken up. The return takes the try up with one guarded change (this try, this host, TikTok,
  still running, not taken up before) and only then asks TikTok anything. A second request for
  the same return finds the try taken, does no work at all, and ends nothing. (One small
  database change: a column on `host_photo_tries`.)
- **The account must not be another host's.** Besides rule 2, TikTok's number for the account
  must not be confirmed for another host. That can only matter for an entry confirmed without a
  number, and it is the same guarantee the ordinary sign-in gets from the database.
- The photo remembers TikTok's number from the answer and the entry's name, also when the entry
  itself has no number. Plan 29's keep rule then does the right thing: by name until the entry
  gains its number through "Connect your TikTok", by number afterwards.

### 5. Start and return (`tiktok-photo.ts`, new; the return address)

- **Start:** the settings must be there; the try is started; the host is sent to TikTok with a
  `tiktok-photo` note in the same cookie as today.
- **Return** (`/api/social/tiktok/return`, the one address registered with TikTok): the cookie is
  removed first, as today. If it holds a valid `tiktok-photo` note, this is a photo's return;
  otherwise it is handled exactly as today, which checks an ordinary note by itself (a photo's
  note is never read as an ordinary one). A photo's return goes in this order:
  1. our own note, the value TikTok sent along, and the same person. If any of these does not
     fit, the return says "not finished" and **touches no try**: a note can be genuine and still
     belong to another tab's sign-in.
  2. the try named in the note is taken up (above). If it cannot be, nothing more happens.
  3. only now, as the owner of the try: the host cancelled at TikTok, a permission is missing, or
     the person is paused or closed. Each ends the try there and then, so the host need not wait
     two minutes to press again.
  4. TikTok is asked, with the picture, and the answer goes to `finishTikTokTry`.
  The photo's return never calls the function that confirms an account: that one replaces the
  entry, which a photo's sign-in must not do.
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
  minutes and after; coming back after three minutes, after eleven, and never; an Instagram
  press that takes the TikTok try's place; the same return arriving twice, with the first one
  succeeding and with it failing; an ordinary sign-in and a photo's sign-in in two tabs, in both
  orders; an entry without a number that later gains the same number, or another; an account
  whose number is another host's; an Instagram photo replaced only when the TikTok one has
  passed; a refused TikTok picture; TikTok refusing our keys.
- **`scripts/accounts-check.ts`** unchanged and passing: the ordinary sign-in is as it was.
- **Every other check script,** once more.
- **The real try,** in TikTok's test mode with the founder's own TikTok account, through a
  temporary https address: the founder starts the address, puts it into TikTok's developer page
  and signs in; the builder does the rest. What TikTok really answers is written into this plan:
  the picture's server, its size and kind, how long the whole return took, and that the picture
  can still be fetched after the key was handed back (which is the order the code works in).
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

## Astra's check of this plan (19 November 2026): "ready with changes"

It found the main shape right (the try written at the press and carried through; the try's id
inside the signed note, which it called necessary; asking for the picture only at a photo's
sign-in) and nothing over-built. Two things had to change, both taken:

1. *The same return arriving twice.* Both requests would have seen the try as running: one could
   end it while the other was finishing it, or both could do the work. Now one return takes the
   try up with a guarded change before anything is asked of TikTok.
2. *A genuine note that belongs to another tab.* With two sign-ins started, the older one's
   return carries the newer one's note. Ending "the try in the note" on any failed check would
   have stopped the newer try. Now a try is ended only after the note, the value TikTok sent
   along and the person all fit, and only by the return that took it up.

Also taken: the two-tabs behaviour said openly; the longer list of checks; the account's number
must not be another host's; what the real try has to record; the wording about TikTok's
"migration" notice and about handing the key back.

Not taken: keeping a newer note when an older return's value does not fit (the return address
has always removed the cookie first, for both kinds of sign-in; a host who overlaps two
sign-ins presses the button again).

