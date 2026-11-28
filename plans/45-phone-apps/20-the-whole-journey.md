# Phone apps, part 20: the whole journey, and getting ready for the iPhone and the stores

**Status:** a plan only. Written 20 November 2026 by the builder alone. Part of plan 45. The
last part: no new feature. Astra checked it once ("ready with changes"); its points are
worked in (the list is at the end). Brought up to date on 27 November 2026, after the
website changed (that list is at the end too).

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
   block; a paused account's walk; deleting an account. *Added 27 November:* "End call now"
   as the host and as the customer, with each of the three choices, and the other person's
   screen; a conversation between a host and a customer, a report of a message and a block
   from it (part 17b); cancelling a new membership within 14 days (part 13c); a membership
   paused with an account and resumed on its old terms; money owed back, with "I think this
   is wrong" (part 16b); the line that says where the yearly statement is; a customer with
   a bank dispute being refused a new booking. **Where the founder has not decided, or said
   no, the walk proves the thing is absent:** for the notification "Connect has written to
   you." (part 12, decision 2a) either the row written for the phone is read (without the
   store keys nothing travels to a phone, so only the row can be checked) or, if the
   founder leaves it out, that no such row is written. Every screen in light and dark, with
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
   line, no link and no notification that comes from those things, except what part 16, decision 5, allows on a host's
   earnings screen: "Other earnings" as a nameless group, counted in what is ready, what is
   waiting and what each collection sent, whoever started it. The sweep plays a collection
   she pressed herself, one Connect started and one the founder made, each with a
   contribution in it, and one of nothing but other earnings: each is in the history with
   its true amounts and who started it, none says what the group is made of, and the last
   one makes no notification. *Added 27 November, and made stricter after Astra's check:*
   it also makes the newer things that could carry a project's or a tip's money to a phone,
   and checks that **nothing at all** comes of them there, not even without a name: a tip
   and a contribution that Connect refunded after the host collected (no take-back in any
   list or count, "not found" by its number, no notification; part 16b); a bank dispute over
   a contribution (no notification; part 12); a host whose only earnings are tips (no
   statement; the earnings screen says "Other earnings" and never "tips"; the same deletion
   screen as a host with nothing; parts 16 and 19); a block between two people who have a monthly contribution (neither sentence
   under "Block" says so; part 09a); a person paused with a reason the team typed about a
   diary (the typed words are in no answer; part 09a). And a customer whose only bank dispute is about a
   contribution, trying to book a call: refused, in the same words and fields as for a
   dispute about a call, with no cause named (part 09a). **What the sweep does not ask
   for:** that a call's own figures look as they would if no other money existed. A call's
   receipt, a debt about a call and a collection with a call in it show their true figures
   (the build plan, "The rule for the apps"). And it turns the
   website's own tip switch on and off while the apps' tip switch is off: nothing a phone is sent changes.
   And in each position of the membership switch it tries every
   way to a membership payment, the ones through booking, the calendar and Contacts
   included, with a held month, and checks the result for that position: with the switch
   *on*, the invitation is made and the booking takes the held month, as they should; in the
   two stricter positions, no charge and no invitation came of it. It runs with the other
   checks from then on.
4. **The switches, one by one,** with the app open: each is turned off on the admin page, and
   the thing disappears from the app and is refused by the server. For memberships, "off"
   keeps what part 13 says it must: a member still sees their own membership and can cancel
   it; the check looks for exactly that.
5. **An old app.** A copy of the app from before the last change is pointed at the newest
   server: it must either work or be told to update. Nothing in between.
6. **The record.** `docs/module-record.md` gets the whole build: what was decided, what was
   built, what Astra and the read-throughs found, what could not be tried.

## Where the app is not the website, and why (told to the founder plainly)

You asked for every feature. These are the differences that remain:

- **Left out to keep the 4.9%:** projects (wholly), tips (until Apple's rule is clear), and,
  if you so choose before a store's review, memberships (part 13).
- **Left out because they are the founder's tools:** the admin pages, among them the refund
  after a host has collected, the founder's form for cancelling within 14 days, and
  everything about pauses and reports.
- **On the website and in email only** *(added 27 November)*: a bank dispute's own page, with
  the host's choice ("Fight it" or "Give the money back", in at most 24 hours), and the messages
  "From Connect". If the founder decides for it, the phone says "Connect has written to you." for
  a few kinds of them (part 12, decision 2a); if not, the phone says nothing. A part of its own for these was proposed (16c) and is not decided. Also the yearly
  statement, whole (on the website it can be printed and taken as a file), and everything
  about money owed back for a contribution or a tip.
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

## Left for this part by the parts before it

Things found while building that are not a fault in Connect's own code, or that only matter
once a real person has the app. Each is looked at again here, before anything is sent to a store.

- **From part 02:** changing the phone's text size while the app is open restarts the screen,
  and the test build then prints a warning about "multiple navigation containers". The app
  carries on correctly; look once more in a store-style build.
- **From part 02:** with a keyboard plugged into an Android phone, the page that has the
  keyboard's attention is drawn with a grey veil (Android's own mark for it). Decide whether to
  restyle it.
- **From part 03 (Astra's fifth look):** on Android, the library that keeps things in the
  phone's secure store does not report when the phone failed to write to its storage. If that
  happens at the very moment someone presses "Sign out" and the app is closed in the same
  second, the person could be signed in again when the app is next opened (the server is told
  about the sign-out all the same). Mend the library, or take its makers' fix if there is one.
- **From part 06 (Astra's second look):** until a copy of the app is in a store, the app and
  the server change together, and an answer's shape may change freely. **From the first copy
  in a store on, an answer may only grow** (a part an older copy reads must stay, and a new
  part must be one an older copy can do without), or the oldest version still let in must be
  raised in the same step. Write this rule into the app's README, and add a check that reads
  each answer with the checks of the oldest copy still let in.
- **From part 06:** on an iPhone, the link that hands back from a bank's approval page must
  reach Stripe's kit (`useCardReturns` in `mobile/src/lib/card.ts`): written, never run. And
  Stripe's own ID page inside the phone's browser sheet was not walked on Android either (the
  test phone's browser first shows Google's terms screen): walk it on both.
- **From part 06 (after the agreements were merged):** the Identity Check Notice above the
  button of "Confirm who you are" (its text, its link to the website, the sentence, the button
  "I agree, continue to Stripe"), and a host's "business or private person" line on her page
  and before asking, were added after the walk on the test phone: look at both on a phone.

- **From plan 51 (built by another session while this build was paused):** the app's screens
  for "End call now" were typed and unit-tested and never run on a phone. Part 09a walks
  them; if it could not, they are walked here.
- **From bringing the plans up to date (27 November):** how legal documents are shown in the
  app is open (part 18, decision 5): no way found so far keeps the apps' rule and still
  says truthfully which document and version a person accepted. Nothing goes to a store
  before the lawyer has answered; the walk then checks every place that leads to legal text (the three that exist today,
  and those later parts add: the Host Agreement in part 14, "Read the rules" in part 17b)
  against that answer. The three of today lead to legal
  text (the last step of signing up, the ID check, the report form) against that answer.

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

## Brought up to date (27 November 2026)

Read again after pull request 123. Plan 45 has thirty-one parts now (13c, 16b and 17b were
added after this was written, and 09a on 27 November). What changed in this plan:

1. *The walk* has the new things in it: "End call now", messages, the 14 days, a pause with
   an account, money owed back, a bank dispute's refusal; and for what the founder has not
   decided, a proof of presence or of absence, whichever is decided.
2. *The 4.9% sweep* also covers the newer ways a project's or a tip's money could reach a
   phone, and after Astra's check asks for nothing at all there, not only for no name.
3. *"Where the app is not the website"* names what stays on the website and in email.
4. *Two more things left for this part:* plan 51's screens on a phone, and the legal pages.

This plan is read against the code once more on the day it is built.
