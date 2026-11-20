# Phone apps, part 18: the account page, blocking, the legal pages, a paused account

**Status:** a plan only. Written 20 November 2026 by the builder alone. Part of plan 45. Astra
checked it once ("ready with changes"); its points are worked in (the list is at the end).

## For the founder: what this is

The Account place at the bottom of the app: who I am, my photo, my time zone, my reminders,
my ratings, my memberships, the people I blocked, my ID check, changing my password, the way
to Hosting, signing out; and the terms, privacy and rules pages. (The report form is part
09's.)

## What is there today (read in the code)

- `src/app/account/page.tsx` (319 lines) and its actions: the time zone (`saveAccount`);
  reminders (`saveReminders`); emails about followed hosts (`saveFollowEmails`); the photo
  (upload, remove; plan 35: a customer's photo is shown only to hosts they asked); two
  ratings kept apart, as a host and as a customer (`averageFor`); the ID check's state and
  the way to it for a customer; the memberships (`membershipsOf`); the blocked list
  (`blockedBy`) with unblock; "change password", which signs out every other device; for an
  account made with Google, how to set a password; that the email address is changed through
  support; the way to Hosting; the list of contributions (`supportedBy`), left out; "To close
  your account, contact support" (replaced by part 19).
- **A paused account** (`src/app/paused/`): the reason, how to appeal; it can still see past
  calls and receipts, read, report and unblock, but start nothing.
- **The legal pages.** The terms are a placeholder. The privacy page and the rules page have
  real text, **and both speak about projects** (contribution payments, diary emails, what may
  be posted in a diary).
- **Reports** (`createReport` in `src/lib/safety/reports.ts`) can be about a call, a request,
  a profile, and a diary post; a report about a person blocks them automatically and has a
  reference number.

## Decisions (the builder's)

1. **The account screen is the website's page** on the same functions, built field by field:
   no contributions; memberships listed only as part 13's switch allows (a renewing
   membership is always listed, so it can always be cancelled).
2. **The photo:** the phone's pictures or camera, as in part 14, through the same checks.
3. **Blocking and unblocking** on the same functions. A blocked pair sees, everywhere in the
   app, what the website shows a blocked pair (checked in each part's script).
4. **Reports from the app are about a call, a request or a profile.** The app's report
   address refuses a report about a diary post, since the app shows none.
5. **The legal pages are fetched from the server each time,** so there is one version, **but
   not word for word:** the sections that are only about projects are marked as such in the
   one source, and the app's version leaves them out; a short part about what the apps
   themselves collect (the phone's notification address, the camera and microphone) is added
   for the apps. **What must stay:** the privacy page names the services that check pictures
   inside its part about diaries, and later parts point back to it; those same services
   check profile photos, so their names and purpose stay in the apps' version. **The terms a
   person accepts are the same on the website and in the app** (there is one acceptance per
   account today), so nothing is left out of the terms themselves.
   Until the lawyer has written the real pages this is done on the placeholder
   text, and it is a point for the lawyer that the two versions must stay one document.
   When the terms change, the app's "18 and terms" step asks again, because the server says
   so.
6. **A paused account** sees the website's notice with the reason and the appeal, and keeps
   exactly the things the website leaves it.
7. **Emails' "unsubscribe" links** stay web links that need no sign-in; the same choices are
   on this screen.

## How it is tried

- `accounts-check`, `safety-check`, `photo-check` unchanged and green.
- Check script: each save and its refusals; block and unblock; the account answer holds no
  contribution field; memberships in each position of the switch; a report about a diary post
  refused; the app's legal pages hold no project section; a paused account's allowed and
  refused actions, one by one; a customer's photo is not sent to a host they never asked.
- On the Android test phone, with pictures: the account screen; the photo; reminders; the
  blocked list; a paused account; the three legal pages.

## Keeping the 4.9%

No money. The list of contributions is absent, and the legal pages the app shows do not
describe projects.

## For the lawyer (added to `docs/for-the-lawyer.md` with this part)

The privacy and rules pages will exist in a website version and an apps version from one
source; the apps' version leaves out the parts about projects and adds what an app collects.
Is that acceptable, and what must the apps' version say?

## Astra's check (20 November 2026): "ready with changes", worked in

1. *Fetching the legal pages word for word would have put projects into the app.* Decision 5.
2. *A report can be about a diary post.* Decision 4.
3. *Missing:* the two ratings, the customer's way to the ID check, the way to Hosting, how an
   email address is changed, the note for accounts made with Google, what a paused account
   keeps. Added.
4. *Memberships on the account page must follow the switch.* Decision 1.
