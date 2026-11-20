# Phone apps, part 14: becoming a host (the profile and the photo)

**Status:** a plan only. Written 20 November 2026 by the builder alone. Part of plan 45. Astra
checked the first draft ("not ready"); it was split in two (this part and 14b, the ID check,
payouts and proving a social account) and every point is worked in (the list is at the end).

## For the founder: what this is

The forms of the website's Hosting page, from the app: applying, the profile, the languages,
the price, the photo, the rules a host sets. You still approve hosts on the admin page of the
website.

## What is there today (read in the code)

`src/app/host/page.tsx` (647 lines), `src/app/host/actions.ts`, `src/lib/profiles/`:

- **Applying** (`createProfile`): the display name, the public handle (chosen once; it and the
  country cannot be changed afterwards), the country (of 33), "about", the languages (1 to
  5), the price.
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
   checks pictures by machine included.
   Taking it from Instagram or TikTok, updating and removing work as on the website. A locked
   photo is shown as locked.
4. **"What you still need" is one list at the top, from the server.** Each line leads to its
   screen (the ID check and the payout account to part 14b's).
5. **The project part of the Hosting page is not in the app,** and the app's answer is built
   without it.

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
