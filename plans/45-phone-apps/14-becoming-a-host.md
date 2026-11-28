# Phone apps, part 14: becoming a host (the profile and the photo)

**Status:** a plan only. Written 20 November 2026 by the builder alone. Part of plan 45. Astra
checked the first draft ("not ready"); it was split in two (this part and 14b, the ID check,
payouts and proving a social account) and every point is worked in (the list is at the end).
Brought up to date on 27 November 2026 (the list is at the end). The first note written here
that day said that nothing had changed; that was wrong, because it compared with the day
part 09 was merged and not with the day this plan was written. Astra's check found it.

## For the founder: what this is

The forms of the website's Hosting page, from the app: applying, the profile, the languages,
the price, the photo, the rules a host sets. You still approve hosts on the admin page of the
website.

## What is there today (read in the code)

`src/app/host/page.tsx` (748 lines on 27 November), `src/app/host/actions.ts`, `src/lib/profiles/`:

- **Applying** (`createProfile`): the display name, the public handle (chosen once; it and the
  country cannot be changed afterwards), the country (of 33), "about", the languages (1 to
  5), the price.
- **Two things every host must also give** (plan 46, decisions 8 and 10; merged after this
  plan was written): she **accepts the Host Agreement**, by a tick beside a link to the
  exact version the form shows, and that version is recorded with the acceptance
  (`acceptHostAgreementIn`); and she says whether she offers calls **as a business or as a
  private person** (`sellerKind`), which her page then shows. An application without either
  is refused. A host from before these existed, or one who must accept a new version of the
  agreement, is asked in a box at the top of the Hosting page (`answerHostBox`), with words
  that fit what is missing. A version whose day has not come yet is announced there ahead
  of time. Which agreement a host held when a payment was made later decides whether money
  she owes back can be taken by the app itself (part 16b).
- **A top price** (plan 48): no host can set a price above the highest allowed, which is the
  same for everyone unless the founder gave her a higher one (`topPriceOf`,
  `hostPriceProblem`). If the founder lowers her top price below her price, her price drops
  at once and she is told by email. Her own form refuses a regular price below a price a
  member of hers is paying.
- **The ordinary form for changing her profile** also carries "business or private", so an
  approved host can change that answer there at any time.
- **Changing** (`saveProfile`): a new display name on an approved profile goes for approval
  again; a declined profile can be sent again; `setHidden` hides her page.
- **Social accounts** entered by hand: `addSocial`, a code to put in the bio that runs out
  and can be replaced, `socialReady` ("Check now": by itself for Instagram and YouTube when
  their keys are set, by hand otherwise), `removeSocial`. **An approved host** must keep one
  confirmed account; before approval the last one can be removed.
- **The photo:** uploaded (`/photo`), or taken from Instagram or TikTok (`usePhoto`,
  `useTikTokPhoto`), updated, removed (`removeOwnPhoto`), each checked before it is shown; a
  photo can be locked by the founder (plans 29, 33, 35).
- **Rules she sets:** the cancellation rule (`saveCancelRule`), "verified customers only"
  (`saveVerifiedOnly`).
- **What she still needs,** shown on the page: approval, a confirmed account, the ID check,
  for paid calls the payout account, and hours.
- The page also holds her project (`runningProjectOf`, `startProblem`), which is left out.

## Decisions (the builder's)

1. **Plain app screens on the same functions,** with the same limits and sentences: apply
   (with the handle and country said to be for good before they are saved), change, send
   again after a decline, hide, the cancellation rule, verified customers only.
2. **Social accounts by hand** work as on the website: add, the code, "Check now", a new code
   when one ran out, remove, with the rule about the last confirmed one as the server has it.
   Proving an account by signing in at TikTok or Meta is part 14b.
3. **The photo** is chosen from the phone's pictures or taken with its camera, made smaller on
   the phone, and sent to a twin of the website's upload address, through the same checks.
   **Before the first photo is sent, the app says who will look at it and why** (the checking
   services the privacy page names, to keep unsuitable pictures out) and the person agrees.
   Apple asks for a plain yes before personal data goes to another company, a company that
   checks pictures by machine included. **The same yes is asked before a photo is taken from
   Instagram or TikTok,** since that picture goes to the same checking services; on the
   website there is no such step today, and the app does not copy that.
   Taking it from Instagram or TikTok (after the yes described above), updating and removing
   work as on the website. A locked photo is shown as locked.
4. **"What you still need" is one list at the top, from the server.** Each line leads to its
   screen (the ID check and the payout account to part 14b's).
5. **The project part of the Hosting page is not in the app,** and the app's answer is built
   without it.
6. **The Host Agreement and "business or private" are part of applying in the app** *(added
   27 November)*, exactly as the server asks for them: the app shows the agreement through
   the reader it already uses for legal text (parts 03 and 06), sends back the version it
   showed, and is told "these documents have changed, please read them again" when that
   version is no longer the current one. The box for a host who still owes one of the two
   answers, and the notice of a coming version, are at the top of the app's Hosting screen
   with the server's words. The app's form for changing a profile carries "business or
   private" too, as the website's does. How the agreement's own text is shown where it speaks about
   projects is part 18's open decision 5; this part is not built before that is settled.
7. **The price field takes the server's limit and the server's sentence** *(added 27
   November)*, for a price above her top price and for one below a member's price. The app
   knows no limit of its own.

## How it is tried

- `accounts-check`, `photo-check`, `abroad-check`, `verified-check` unchanged and green.
- Check script for the app's addresses: each rule of applying and changing with its sentence;
  the handle and country cannot be changed; the last confirmed account of an approved host
  cannot be removed, and of an unapproved one can; a code that ran out; an upload that is too
  big or not a picture; a locked photo; no project field in the answer.
- On the Android test phone, with pictures: a new host from nothing to "waiting for
  approval"; the photo from the phone's pictures; the rules; hide.

## Keeping the 4.9%

A host setting her own price for one-to-one calls is not a purchase. No project.

## Astra's check (20 November 2026): "not ready", now worked in

1. *Proving an account from the app, as first written, could be finished by someone else.*
   Moved to part 14b and redone.
2. *Each outside company needs a return path that really works.* Part 14b.
3. *Missing:* choosing the handle, that it and the country are for good, the rule about the
   last confirmed account being for approved hosts only, the code running out, sending again
   after a decline, updating and removing a social photo, a locked photo. Added.
4. *The project panel's reads must be left out of the answer.* Decision 5.
5. *Too big for one part.* Split.

## Brought up to date (27 November 2026)

Read again against the code on `main` after pull request 123, compared with the day this
plan was written (20 November), after Astra's check of the first update.

1. *A host accepts the Host Agreement and says "business or private"* (plan 46). "What is
   there today"; decision 6.
2. *A top price per host* (plan 48). "What is there today"; decision 7.

This plan is read against the code once more on the day it is built.

## Astra's second check (27 November 2026), worked in

1. *"Business or private" can also be changed on the ordinary form, and a price cannot go
   below a member's price.* "What is there today"; decisions 6 and 7.
