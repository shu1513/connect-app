# Phone apps, part 20: the whole journey, and getting ready for the iPhone and the stores

**Status:** a plan only. Written 20 November 2026 by the builder alone. Part of plan 45. The
last part: no new feature. Astra checked it once ("ready with changes"); its points are
worked in (the list is at the end).

## For the founder: what this is

One careful walk through everything, as a customer, as a host and as someone who is both,
with the app on one side and the website on the other. Then the list of what stands between
this build and a real app in the two stores, each item with who can do it.

## What gets done

1. **The walk.** On the Android test phone, against the website in a browser: sign up; find a
   host; follow; book; the host accepts in the app; pay; the connection check; the call; more
   time; the chat; the page after; rate; a refund; past calls, from the home page to an old
   call and its results; "available now" both ways, with a request left to run out;
   a membership from an invitation to a member's call, in each position of its switch;
   becoming a host from nothing; hours; earnings; contacts; the account page; a report; a
   block; a paused account's walk; deleting an account. Every screen in light and dark, with
   large text, and read by the screen reader. Pictures of all of it, the refused and the
   out-of-date states too.
2. **What the final pass of the website looked for** (plan 11): wording that differs between
   two screens for the same thing; a dead end; a button that does nothing while it waits; an
   error that says nothing a person can act on.
3. **The 4.9% sweep, as a check script that stays.** It does not search for words (a private
   note may say "tip", and a link to a payment may be called "Continue"). It works with real
   things that must stay out: a host with a project, a diary, contributions and, once they
   exist, tips. It then asks every app address as that host, as a contributor, as a follower,
   and reads what comes back; and it makes the things happen that send notifications (a new
   diary post, a contribution paid) and reads what is written for the phones: no field, no
   line, no link and no notification that comes from those things, except the two "Other
   earnings" amounts (part 16). And in each position of the membership switch it tries every
   way to a membership payment, the ones through booking, the calendar and Contacts
   included, with a held month, and checks that no charge and no invitation came of it. It
   runs with the other checks from then on.
4. **The switches, one by one,** with the app open: each is turned off on the admin page, and
   the thing disappears from the app and is refused by the server.
5. **An old app.** A copy of the app from before the last change is pointed at the newest
   server: it must either work or be told to update. Nothing in between.
6. **The record.** `docs/module-record.md` gets the whole build: what was decided, what was
   built, what Astra and the read-throughs found, what could not be tried.

## Where the app is not the website, and why (told to the founder plainly)

You asked for every feature. These are the differences that remain:

- **Left out to keep the 4.9%:** projects (wholly), tips (until Apple's rule is clear), and,
  if you so choose before a store's review, memberships (part 13).
- **Left out because they are the founder's tools:** the admin pages.
- **Not in this build:** signing in with Google (on iPhone it would have to come with a second
  way of signing in that keeps the email address private, such as "Sign in with Apple");
  sharing the phone's own screen in a call (the app shows a screen shared from the website).
- **Built but not switched on until keys exist:** notifications, and with them "available
  now" on a locked phone.
- **Waiting for your decision, once the store accounts exist:** Apple Pay and Google Pay.
- **Built but only proven in test mode:** proving a TikTok or Instagram account from the
  app. TikTok and Meta must each approve the real app before it works for real hosts.

## The list for the founder, in the order it unblocks things

1. **Start two slow things early:** the lawyer (what deleting an account must wipe and keep,
   the terms and privacy pages the apps show; `docs/for-the-lawyer.md`), and the decision
   which Apple and Google accounts the apps will belong to. A **new personal** Google Play
   account must first run a closed test in which at least 12 testers stay signed up for 14
   days in a row, before it may even apply to publish; a company account does not have that
   wait.
2. **A real address for the server,** with the helper and the outside companies' messages
   reaching it. A test address is enough to begin with. The outside pages (Stripe, TikTok,
   Meta) and real phones need it; they cannot reach this Mac.
3. **Upgrade this Mac** (macOS, then Xcode). Then the builder makes the iPhone build from the
   same code and walks it in the iPhone simulator. Expect some iPhone-only fixes.
4. **A Google account for Android notifications; Apple's developer membership (about $99 a
   year); a Google Play developer account (about $25, once).** With them: the apps get their
   real names and signatures, notifications are switched on (part 12), "available now" gets
   its second step (part 11), and Apple Pay and Google Pay can be decided on.
5. **Two real phones, one of each kind if possible:** the first real call between apps, with
   real cameras, headphones, a phone call coming in, a weak connection, a locked phone, a
   notification that really arrives.
6. **The store listings:** name, pictures, description, the privacy forms (they must match
   the privacy page), the page for deleting an account, a way to reach support, the age
   rating, and the notes for the reviewers: live, one-to-one, never recorded; what each switch
   can turn on, memberships named as prepaid talk time; a working test account for a customer
   and for an approved host, on a server that is up.
7. **Send them in.**

## Keeping the 4.9%

Step 3 above is the standing guard. It stays in the automatic checks after this part.

## Astra's check (20 November 2026): "ready with changes", worked in

1. *Past calls and the connection check had no owner.* They have one now (parts 08 and 09c),
   and both are in the walk.
2. *A search for words is a poor guard.* Step 3 now tests what the server answers, with real
   things that must stay out.
3. *The differences from the website must be told to the founder as such.* The new section.
4. *The order of the founder's list:* the lawyer and the account choice first; a reachable
   server before the outside pages and real phones; Google's 12 testers for 14 days.
