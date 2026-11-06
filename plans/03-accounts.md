# Plan: Module 3 — Accounts and profiles

**Status: approved by the founder on 6 November 2026 ("use your recommendations"), after Astra's review of the plan.**

Until now the app has only four made-up test accounts. This module lets real people sign up, log in
(with an email and password, or with Google), and lets people who want to host set up a public profile
with a name, a short address, a price and their social media names.

It builds on modules 1 and 2: a call still has one host and one customer, and a host still needs a
payout account at Stripe before taking paid calls. Booking a time on a host's calendar comes in module 4.

## What this module must prove

1. A stranger can create an account and log in, by email and password or with Google, and we know the email address really is theirs.
2. One email address means one account, however the person logs in.
3. A person can apply to host by filling in a profile, and an approved profile has its own public page that anyone can open without logging in.
4. Nobody can take over someone else's account, and nobody can pose as a well-known person on our site.
5. A forgotten password can be reset safely.

## The founder's decisions (the recommendation was approved for each)

1. **Who can be a host?**
   Recommended: anyone with an account can fill in a host profile, but **it only goes public after you approve it** with one click on the admin page. Until we have reporting and identity checks (module 5), this is the only thing that stops someone publishing a profile in a famous person's name the minute they sign up.
   Alternative: profiles go public at once. No waiting for hosts, but fakes can appear before anyone looks.

2. **Social media names: how do we stop fakes?**
   A host types in their Instagram, TikTok, YouTube or X name. Anyone could type a famous person's name.
   Recommended: the host proves it with a code. We show them a short code, they put it in that account's bio, and press "I've done it". You open the link we show on the admin page, see the code in the bio, and press "confirm". **Only confirmed names are shown on the public profile**, with the label "account confirmed". The code runs out after 7 days, and changing the name means proving it again. It costs nothing and needs no permission from Instagram or TikTok.
   Later (after launch): "Log in with Instagram/TikTok" buttons that prove it automatically. Each needs that company's review, which takes weeks.

3. **Must people confirm their email address?**
   Recommended: yes. After signing up with a password they get an email with a link, and they cannot log in until they click it. (People who sign up with Google are already confirmed by Google.)

4. **Sending emails.**
   Confirming an address and resetting a password need the app to send email, which needs an email-sending service.
   Recommended: while developing, no real email is sent. The app saves each email to a "sent emails" page that only admins can open and that does not exist in the live app. We pick the real service when the app goes online (for example Resend: free up to 3,000 emails a month, then about $20 a month). Switching is one small file.

5. **Google sign-in.**
   Needs a free "project" in your Google account (Google Cloud) so Google knows which app is asking. I can set it up in the browser if you log in to Google there, the same way we did Stripe. It costs nothing.

6. **Age and terms.**
   Recommended: at sign-up, two required boxes: "I am 18 or older" and "I accept the terms". No date of birth collected now. A real age and identity check for hosts comes in the safety module. The terms and privacy pages will be placeholders until real ones are written (a lawyer should do those before launch).

7. **The host's short address (handle).**
   Each host picks a handle, and their page is `…/h/their-handle`.
   Recommended: 3 to 30 characters; plain English letters, numbers and underscores only. First come, first served, with blocked words (admin, support, and so on). Two handles that differ only by underscores count as the same, so `kim_k` cannot sit next to `kimk`. **Changing a handle is done by you on request for now**, not by the host, so nobody can swap names around to pose as someone.

8. **What a host profile shows.**
   Recommended: display name, handle, a short "about" text (up to 300 characters), price per 15 minutes (at least $5, or free), their cancelling rule, and their confirmed social media names. Never their email. Customers have no public profile at all; the host sees only the customer's name on a call.

9. **Profile photos.**
   Storing uploaded photos needs a file-storage service, which we choose with the hosting.
   Recommended: not in this module. Profiles show a circle with the person's initial. Photo upload is added with hosting.

10. **Hiding, suspending and closing.**
    Recommended:
    - A host can hide their own profile. That stops new people finding it; **calls already booked still happen**.
    - You can suspend a profile or close an account from the admin page (for fakes and abuse). A closed account is logged out everywhere and cannot log in.
    - A person who wants their account closed asks by email and you press the button. Records of paid calls are kept, as tax and dispute rules require. A self-service "close my account" button is added before launch.

## Decisions already made

- **One account per email address; host and customer are not separate account types.** Anyone can book, and anyone can apply to host. This is how modules 1 and 2 already work (the role belongs to the call).
- **The same login tool as today** (Better Auth, already installed; checked against the installed version).
- **Same email, same account, safely.** If someone has a confirmed password account and presses "Continue with Google" with the same address, they land in the same account. If the password account was never confirmed, Google sign-in is refused and the person uses "forgot password" instead, which proves the address is theirs, replaces the password and logs out everyone else. This stops the trick of registering someone's address first and waiting for them to arrive.
- **Passwords:** at least 12 characters (as today), stored only as a scrambled value, and refused if they appear in the public list of leaked passwords.
- **Repeated attempts are slowed down:** logging in, signing up and asking for emails are limited per network address (kept in the database so it works with more than one server), and emails are limited per email address as well.
- **We never say whether an email address has an account.** Sign-up, reset and "send again" always answer the same way.
- **Sessions:** logged in for 30 days from last use on a device. A password reset logs out every device; a password change logs out all the others.
- **Changing your email address is not in this module.** It is a favourite route for stealing accounts and needs care; until then it is done by the founder on request.
- **Times:** each person's time zone is saved at sign-up (taken from their browser, changeable in settings). The calendar in module 4 needs it.
- **Hosts are in the United States** (from module 2). The host form asks them to confirm it; Stripe enforces it when the payout account is made.
- **The test accounts stay**, for development only. The script that creates them refuses to run in the live app.

## How it works

**Signing up with email**
1. The person enters their name, email and a password.
2. We create the account as "not confirmed" and email a link that works for one hour.
3. They click the link, the account is confirmed, and they are logged in.
4. They land on one short "last step" page with the two boxes (18 or older, the terms) and their time zone. Nothing else can be used until it is done. People who sign up with Google see the same page, so there is one place where the boxes are recorded, and it is the server that records them.
5. Until the address is confirmed they cannot log in. Trying to log in shows "check your email" and sends the link again.

**Signing up or logging in with Google**
1. They press "Continue with Google" and choose their Google account on Google's own page.
2. Google sends them back with their name and confirmed email. We create the account, or log them in to the confirmed one that already has that email.
3. The first time, they see one short page with the two boxes before they can do anything else.

**Forgotten password**
1. They enter their email. We always answer "if that address has an account, we sent a link".
2. The link works once and for one hour. Setting the new password logs out every device.

**Becoming a host**
1. From their account page, they press "Become a host" and fill in display name, handle, about, price and cancelling rule, and confirm they are in the United States.
2. The profile is saved as "waiting for approval". The founder sees it on the admin page and approves or declines it.
3. Once approved it is public. A banner tells the host that paid calls need the payout setup (module 2's page).
4. They can add social media names and prove each one (decision 2).

**Public profile page** (`/h/handle`)
- Anyone can open it, logged in or not. It shows only the public details from decision 8.
- A "Book a call" button is there but leads to "coming soon" until module 4.
- A handle that does not exist, or a profile that is waiting, hidden or suspended, all show the same "not found" page.
- The page is always built fresh, so hiding or suspending takes effect at once.

**Account settings**
- Change name, time zone, password. Hosts: edit profile, hide or show it, add or remove social names.

## What gets built, in order

1. **Close the test doors first.** The "new call" test page and its action become admin-only (today any logged-in person could create a call with anyone). The test-account script refuses to run in the live app.
2. **Email outbox.** One small `sendEmail` function with a per-address limit. In development it saves the message; the outbox page is admin-only and absent from the live app.
3. **Login tool settings.** Public sign-up, required email confirmation, password reset, leaked-password check, attempt limits in the database, 30-day sessions, Google, and the safe same-email rule above.
4. **Screens:** sign up, log in (with the Google button), check your email, forgot password, new password, the first-time Google page.
5. **The gate.** One shared check used by every page, action and data address that matters: logged in, email confirmed, boxes ticked, account not closed. Calls, payments and hosting all go through it.
6. **Profiles.** Tables, handle rules, the "become a host" form, admin approval, the public page, settings.
7. **Social media names.** Add, the proof code, the admin confirm button.
8. **Admin tools:** approve or decline a profile, suspend a profile, close an account.
9. **Tests and a browser walk-through.**

## What we store

- **On the account:** time zone, when the 18-or-older box was ticked, when the terms were accepted and which version, when the account was closed (if it was). These are written only by the server, never taken from what the browser sends.
- **Host profile** (one per account): owner, handle (and its form without underscores, which must be unique), display name, about text, price per 15 minutes in cents, the host's own "hidden" switch, and separately the founder's status: waiting, approved, declined or suspended, with who decided and when. (The cancelling rule and payout account stay where module 2 put them.)
- **Social media names:** owner, which network, the name as typed, its cleaned-up form, the link to that account, the proof code and when it runs out, when it was confirmed and by whom. The database itself guarantees one confirmed owner per name per network.
- **Email outbox** (development): to, subject, text, time.
- **Attempt limits:** kept by the login tool in its own table.

Bookings, messages and everything later will point to the account, never to the handle, so a handle can be changed without breaking anything.

## How we test it

- **Automatic tests** for the rules that are plain logic: handle rules, blocked words and underscore look-alikes; cleaning up typed social names (`@Name`, full links, spaces); the gate.
- **A script of real journeys against the local app and database**, like the payments one: sign up → cannot log in → confirm → can; wrong and expired links; reset password and every device logged out; too many attempts get slowed; signing up with an address that already exists reveals nothing; Google sign-in onto an unconfirmed password account is refused; a handle that is taken, blocked or a look-alike; two people grabbing the same handle at the same moment; a profile is invisible until approved and again after suspension; a social name confirmed for one host cannot be confirmed for another; a normal user cannot open the test-call page, the outbox or the admin tools; a closed account is logged out and cannot get back in.
- **In a browser:** the full sign-up and host set-up by hand, and Google sign-in with a real Google account.

## This module is done when

- A new person can sign up both ways, confirm, log in, log out and reset their password.
- An unconfirmed account cannot log in or use anything.
- A host profile can be created, approved, edited, hidden, suspended, and seen publicly at its handle only when it should be.
- Social names appear publicly only after the proof step.
- All earlier tests and the payments journeys still pass.

## Not in this module

- Booking a time (module 4), identity and face checks, blocking and reporting (module 5), emails about calls (module 6), search (module 8).
- Photo upload, changing your own email or handle, a self-service close-account button, logging in with Instagram or TikTok, Apple sign-in, two-step login codes.
- Languages other than English.

## What the automatic checks cannot test

- Google sign-in end to end (it needs a real Google account in a real browser; I will do it by hand once).
- Whether real emails arrive and do not land in spam. That can only be checked once a real sending service and the app's own web address exist.

## Before launch (not needed for development)

- Real terms of service and privacy policy.
- A real email-sending service, with the app's own web address set up so emails are trusted.
- Switching the Google sign-in screen from "testing" to "live" in Google's console.
- A protection against robots signing up in bulk (an "are you human" check), switched on if it becomes a problem.
- The self-service "close my account" button.
