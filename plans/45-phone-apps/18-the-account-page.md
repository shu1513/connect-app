# Phone apps, part 18: the account page, blocking, the legal pages, a paused account

**Status:** a plan only. Written 20 November 2026 by the builder alone. Part of plan 45. Astra
checked it once ("ready with changes"); its points are worked in (the list is at the end).
Brought up to date on 27 November 2026, after the website changed (that list is at the end
too). **Decision 5, about the legal pages, must be decided again before this part is built**
(see the list).

## For the founder: what this is

The Account place at the bottom of the app: who I am, my photo, my time zone, my reminders,
my ratings, my memberships, the people I blocked, my ID check, changing my password, the way
to Hosting, signing out; and the terms, privacy and rules pages. (The report form is part
09's.)

## What is there today (read in the code)

- `src/app/account/page.tsx` (372 lines on 27 November) and its actions: the time zone (`saveAccount`);
  reminders (`saveReminders`); emails about followed hosts (`saveFollowEmails`); the photo
  (upload, remove; plan 35: a customer's photo is shown only to hosts they asked); two
  ratings kept apart, as a host and as a customer (`averageFor`); the ID check's state and
  the way to it for a customer; the memberships (`membershipsOf`); the blocked list
  (`blockedBy`) with unblock; "change password", which signs out every other device; for an
  account made with Google, how to set a password; that the email address is changed through
  support; the way to Hosting; the list of contributions (`supportedBy`), left out; "To close
  your account, contact support" (replaced by part 19). Since plan 44 also the list of tips
  a person gave (`tipsBy`), left out like the contributions.
- **The ratings' explanation changed** (plan 52): an average appears once five people's
  ratings count, moves three people at a time, and is worked out from the most recent
  people, about fifty at most.
- **A paused account** (`src/app/paused/`): the reason, how to appeal; it can still see past
  calls and receipts, read, report and unblock, but start nothing. **Since plans 52 and 53
  the app itself can pause an account** (several different people reported it, or a very low
  average after a warning by email). It is the same pause. The reason is said in general
  words, never with a number of the person's own and never with who reported or rated them.
  A paused account's memberships are paused, not ended, and can be resumed once the pause is
  lifted (part 13). The screen after "End call now" stays open to a paused person (the
  app's address for it already lets one in).
- **The legal pages are no longer three pages.** Since plan 46 there are seven documents
  (`src/legal/`: terms of service, payment terms, community rules, host agreement, privacy
  policy, copyright policy, identity check notice), each in dated versions that are never
  edited once shown. Every version is still a draft ("Draft. Not in force yet."). What a
  person accepted, and in which version, is recorded (`agreement_acceptances`), and a coming
  version is announced. **Several of them speak about projects, contributions and tips.**
  The app already reads legal text through the website's own reader (parts 03 and 06: the
  terms step and the identity notice).
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
4. **Reports from the app are about a call, a request or a profile,** and, once part 17b is
   built, a message. The app's report address refuses a report about a diary post, since the
   app shows none.
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
   **To be decided again (27 November; put more exactly after Astra's check):** this
   decision was written for three pages of which nobody had accepted anything. Now a
   version's text is frozen and a person's acceptance names that version. **Neither way
   that comes to mind works as it stands:**
   - *Showing every document whole* puts what the documents say about projects,
     contributions and tips on a phone.
   - *Leaving out the sections that are only about those* does not reach them all: the
     frozen terms also speak of them inside paragraphs about other things (the terms of
     service and the payment terms both do).
   And the question is not only about a future screen. The app already leads to these texts
   in three places: the welcome step links to the documents, the ID check shows a document's
   text, and the report form links to the rules. So the lawyer is given those three places
   and the mixed passages themselves, and asked for a way of showing that both keeps the
   apps' rule and says truthfully which document and which version a person accepted.
   Nothing more is built on legal text until that answer is there; it comes to Astra with
   this part.
6. **A paused account** sees the website's notice with the reason and the appeal, and keeps
   exactly the things the website leaves it. **The reason is not the stored one:** a person
   on the team can type anything into it, words about a diary or a project included, so the
   app shows the sentence part 09a, decision 3, gives it (paused, what can still be done,
   that the reason is in the email and on the website, where to write). A pause made by the
   app looks no different. The ratings' explanation is the server's sentence, so its numbers
   are never written into the app.
7. **Emails' "unsubscribe" links** stay web links that need no sign-in; the same choices are
   on this screen.

## How it is tried

- `accounts-check`, `safety-check`, `photo-check` unchanged and green.
- Check script: each save and its refusals; block and unblock; the account answer holds no
  contribution field; memberships in each position of the switch; a report about a diary post
  refused; the app's legal pages hold no project section; a paused account's allowed and
  refused actions, one by one, for an account paused by a person and for one paused by the
  app (the same answers); the account answer holds no tip field; a customer's photo is not
  sent to a host they never asked.
- On the Android test phone, with pictures: the account screen; the photo; reminders; the
  blocked list; a paused account; the three legal pages.

## Keeping the 4.9%

No money. The list of contributions is absent, and the legal pages the app shows do not
describe projects.

## For the lawyer (added to `docs/for-the-lawyer.md` with this part)

*(Rewritten on 27 November; the first version assumed an apps' version with the parts about
projects left out.)* The legal documents speak about projects, contributions and tips, in
sections of their own and inside paragraphs about other things. The apps must show nothing
of those features. A person's acceptance names one document in one version. How can the
documents be shown in the apps so that both hold: the apps' rule, and a truthful account of
which document and version was accepted? The lawyer is given the three places where the app
already leads to legal text (the last step of signing up, the ID check, the report form) and
the mixed passages themselves. And: what must the apps additionally say about what an app
collects (the phone's notification address, the camera and microphone)?

## Astra's check (20 November 2026): "ready with changes", worked in

1. *Fetching the legal pages word for word would have put projects into the app.* Decision 5.
2. *A report can be about a diary post.* Decision 4.
3. *Missing:* the two ratings, the customer's way to the ID check, the way to Hosting, how an
   email address is changed, the note for accounts made with Google, what a paused account
   keeps. Added.
4. *Memberships on the account page must follow the switch.* Decision 1.

## Brought up to date (27 November 2026)

Read again against the code on `main` after pull request 123. What changed in this plan:

1. *The legal pages became seven versioned documents with recorded acceptances* (plan 46).
   "What is there today" says what exists now. **Decision 5 no longer fits as written** and is
   marked "to be decided again". After Astra's check it says plainly that neither of the two
   ways works yet, and what the lawyer is given.
2. *An account can be paused by the app itself, and its memberships are paused, not ended*
   (plans 52, 53, 55). "What is there today", decision 6, the check script.
3. *The ratings' explanation has new numbers* (plan 52). Decision 6: the server's sentence.
4. *Tips a person gave are listed on the website's account page* (plan 44). Left out, like
   contributions.
5. *A message can be reported* (plan 49). Decision 4, once part 17b is built.

This plan is read against the code once more on the day it is built.

## Astra's check of this update (27 November 2026): "not ready", worked in

1. *The website's reason for a pause can hold words about a project.* Decision 6, with part
   09a.
2. *Neither way of showing the legal documents keeps the apps' rule,* and three places in the
   app already lead to them. Decision 5.
