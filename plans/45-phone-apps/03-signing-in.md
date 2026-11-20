# Phone apps, part 03: signing up and signing in

**Status:** a plan only. Written 20 November 2026 by the builder alone. Part of plan 45. Astra
checked it once ("ready with changes"); its points are worked in (the list is at the end).

## For the founder: what this is

A person installs the app and gets to the home page: by signing in to the account they
already have, or by making one. It is the same account as on the website.

## What is there today (read in the code)

- The website's forms are in `src/components/auth-forms.tsx`: sign up (name, email, a password
  of at least 12 characters that is not in the public list of leaked passwords), sign in, the
  two-step code or a backup code, "send the confirmation again", "forgot password", "new
  password", "change password". Only admins can *set up* the two-step code, but the sign-in
  asks it of anyone who has one.
- A new account cannot sign in until its email is confirmed. The confirmation link and the
  reset link are opened in a browser and land on the website. Confirming signs in **the
  browser that opened the link**, not the app. Signing up gives no sign-in at all.
- Sign-up, reset and "send again" answer the same way whether or not the address has an
  account, so nobody can find out who has one. A closed account gets the ordinary "wrong email
  or password" sentence.
- After the first sign-in comes "18 or older" and "I accept the terms", with the time zone
  (`finishSignUp` in `src/app/welcome/actions.ts`). Only the server writes those.
- A paused account can look but not book, host or join; a closed one cannot sign in at all.
- A reset gives a password to an account that never had one (one made with Google).

## Decisions (the builder's)

1. **The same rules, the same sentences.** The app's screens use better-auth's own addresses
   through its kit, as the website's forms do, so every rule above holds without being
   written again. Where the app checks something before sending (a password shorter than 12),
   the server still decides.

2. **Three places where the app must not copy the website's forms word for word** (read in
   better-auth's own code by Astra):
   - **Signing in:** the website hands over "where to go afterwards". In an app that makes
     better-auth's kit try to open a browser. The app hands over nothing and decides itself
     where to go.
   - **Signing up and "send it again":** the link in the email must lead to the *website*.
     The app hands over the website's full address for the "18 and terms" page; a short
     address would be turned into an app link by the kit.
   - **Forgot password:** the same, with the website's full address of the new-password page.
   The website's address is part 02's one setting, and must be one the phone can reach.

3. **The screens:**
   - *First opening:* Connect's name, one line of what it is, "Sign in" and "Create account".
     Search and a host's page can be looked at without an account, as on the website (part 05).
   - *Create account:* name, email, password, with the website's hints. Then **"Check your
     email"**: the link is opened on the phone and confirms the address on the website. Back in
     the app, the person types their password again and signs in. (The app has no sign-in yet
     at that moment, so it cannot be done for them; the app only remembers on the phone that
     this step is where they were, so the screen is still there after the app was closed.) If
     the address is not confirmed yet, the app says so and offers "Send it again".
   - *Sign in:* email and password. Whenever the server answers that a two-step code is
     needed, a second screen asks for it, or for a backup code.
   - *Forgot password:* the email address; then "If that address has an account, we sent a
     link." The new password is chosen on the website page the link opens; the app then asks
     to sign in with it.
   - *"18 and terms":* the two boxes, links to the terms, privacy and rules pages, and the
     phone's own time zone sent along. A new address, `POST /api/app/welcome`, for someone who
     is signed in with a confirmed email but has not done this step (part 01's second kind of
     person). It does exactly what `finishSignUp` does, through one shared function.
   - *Paused:* the home page opens with the website's paused notice. *Closed:* sign-in is
     refused with the ordinary "wrong email or password" sentence, as on the website.
   - *Sign out,* on the Account page: ends this phone's session on the server and wipes the
     phone's secure store.

4. **No Google sign-in in the app** (plan 39, decision 7). Someone who joined the website with
   Google sets a password once with "Forgot password". The sign-in screen says so in one line.

5. **The confirmation and reset links stay web links.** They work on any device. Opening the
   app straight from such a link is a comfort for later.

6. **The terms, privacy and rules pages** are read from the server and shown in the app, not
   copied into it (part 18). Until that screen exists, the three links open the website's
   pages in the browser sheet.

7. **Changing the password** belongs to the Account page (part 18).

## What gets built, in order

1. The shared "finish signing up" function; `finishSignUp` on top of it; `POST /api/app/welcome`.
2. The app's sign-in client (better-auth's kit, the secure store), behind part 02's one way of
   asking the server, with the renewing of the sign-in from part 01, decision 2.
3. The screens above, in the order a new person meets them.
4. The app's opening logic: ask `start`; no sign-in → first opening, or "Check your email" if
   the phone remembers that step; "18 and terms" not done → that screen; otherwise Home.

## How it is tried

- **Check script** (`scripts/app-door-check.ts` grows): `welcome` refuses without both boxes,
  refuses a time zone that is not one, refuses someone whose email is not confirmed, writes
  the same fields `finishSignUp` writes, and does nothing the second time. The links in the
  sign-up and reset emails written for an app's request lead to the website.
- **The website:** `accounts-check` passes unchanged.
- **On the Android test phone,** with pictures: a new account from first opening to Home (the
  confirmation link is taken from the test outbox page and opened in the phone's browser); the
  app closed and opened again at "Check your email"; a wrong password; an unconfirmed account;
  "Send it again"; forgot password to a new sign-in; an admin's two-step code and a backup
  code; sign out, and after it the saved sign-in is gone; a paused account; a closed account;
  the too-old-version screen.
- The app's tests: the opening logic (each answer of `start` leads to the right screen).

## What cannot be tried here

A real email arriving on a real phone (emails stay on the test page until the founder's email
service is live). The iPhone.

## Keeping the 4.9%

No money. The "18 and terms" screen links to the terms; it sells nothing.

## Astra's check (20 November 2026): "ready with changes", worked in

1. *Copying the website's sign-in call would open a browser in the app,* and the emailed links
   would have become app links. Decision 2.
2. *"I have confirmed it" could not sign the person in:* confirming signs in the browser, and
   signing up gives the app nothing. Decision 3: the password is typed again, and the phone
   remembers the step.
3. *The two-step code can be asked of anyone who has one.* Decision 3.
4. *A closed account must get the ordinary sentence.* Decision 3.
5. *"18 and terms" needs its own kind of person at the door.* Decision 3, with part 01.
