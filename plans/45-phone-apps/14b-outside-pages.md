# Phone apps, part 14b: the payout account, a host's ID check, and proving a social account

**Status:** a plan only. Written 20 November 2026 by the builder alone. Part of plan 45. Made
when Astra's check split the first draft of part 14 and found its way of proving a social
account unsafe. Astra's second check ("not ready") found the hand-over to the app still
open in two places (the answer was not tied to the attempt before it reached the app, and a
plain app link can be claimed by another app); decision 2 is rewritten for both. This is the
one part with new security work, and it is shown to Astra again before it is built.
Read again against the code on 27 November 2026, after pull request 123: the payout account
(`src/lib/payments/hosts.ts`), the ID check and the proof of a social account have not changed
since this was written, and nothing here had to change. It still goes to Astra, and is read
once more against the code, before it is built.

## For the founder: what this is

Three things a host does on an outside company's own page, started from the app in a browser
sheet: setting up the payout account at Stripe, the ID check at Stripe (built in part 06 for
customers, used again here), and proving a TikTok or Instagram account by signing in there.

## What is there today (read in the code)

- **The payout account** (`startPayoutSetup`, `ensurePayoutAccount`, `payoutSetupLink` in
  `src/lib/payments/hosts.ts`): Stripe gives a link that works once and runs out; it comes
  with two addresses of ours, one for "finished or left" (`/host/payouts-return`) and one for
  "the link ran out, give me a new one". Coming back does not mean it is finished: the server
  asks Stripe (`refreshPayoutsReady`). A host whose account is already ready can update it.
  Both of our pages ask for a signed-in browser.
- **The ID check:** part 06.
- **Proving an account by signing in** (`connectInstagram`, `connectTikTok`,
  `instagram-login.ts`, `tiktok-login.ts`, the two return addresses): the outside company is
  sent a random value; **the browser is given a cookie** holding a signed note of that value,
  who the person is, and until when; coming back, the server compares the two and the
  signed-in person. So only the browser that started can finish. Instagram is done through
  Meta's sign-in for businesses. TikTok's sign-in is also used for the photo (part 14), which
  is a different purpose.

## The danger, in plain words

If the app only carried a signed ticket in the address, someone could start proving an
account in *their* app, send the link to a famous person's assistant with some excuse, and
when that person signed in at TikTok, the famous account would be attached to the stranger's
Connect account. The website is protected against this by the cookie. The app has no cookie
in the sheet, so it needs its own protection.

## Decisions (the builder's)

1. **Stripe's two flows:** the app asks the server to start; the sheet opens Stripe's page;
   Stripe sends the person back to a fixed page of ours on the website's own secure address,
   one for "finished or left" and one for "the link ran out". Neither needs a sign-in, takes
   a person or a destination from its address, shows a result, or changes anything; each
   only offers "Return to Connect" with a button, and hands back to the app.
   If the sheet does not work on some phone, the phone's ordinary browser is used the same
   way. The app then asks the server, and the server asks Stripe: "not finished yet" and "the
   link ran out" are shown as that, with "Continue" (a fresh link, asked for through the
   door). It also works when the person finished on another device and comes back by hand.
2. **Proving an account, safely.** The rule: **only the signed-in app that started an attempt
   can attach the account that came back through that same attempt.**
   - The app makes a secret, keeps it, and sends the server only its fingerprint when it
     starts. The server records an attempt: this person, this phone's sign-in, this company,
     this purpose (proof, or photo), a few minutes to live, usable once.
   - The outside company sends the person back to **our own page on the website's secure
     address**. That page checks that the answer belongs to an attempt that is open (the
     random value the company sends back, as today), asks the outside company who signed in
     (with the same return address the attempt started with, and TikTok's own extra key
     where it has one), and notes the answer on the attempt. **It attaches nothing.** A
     website sign-in that happens to exist in that browser is ignored.
   - The page then hands the phone a ticket that works once, through a link that only the
     real Connect app can open (a verified link, which another app on the phone cannot claim;
     a plain "connect://" link could be claimed by any app on Android).
   - The app that started the attempt, still signed in as the same person, presents the
     ticket **and** its secret through the door. Either one alone does nothing; the app can
     never fetch the result just by asking again and again.
   - **The app shows the account's name that came back and asks "Attach @name to your
     profile?"** On yes, the server attaches exactly that account, for exactly that purpose,
     once. The attempt is used up in that one step, so two returns at once cannot both win,
     and the person's account is checked to be open and active at that moment.
   A link that was forwarded, a different person's app, an attempt used twice or too late, a
   changed value, a ticket without the secret, and "photo" used for "proof" are each
   refused. The website's own way does not change.
3. **The ID check for hosts** is part 06's, with "continue where you were".
4. **Each of these is switched on for the apps only after it has worked** in the outside
   company's test mode on the Android test phone, and stays marked "to prove on real phones"
   until it has worked on real ones. Until then the app says, for that one thing, that it is
   done on the website. (This is not a payment, so pointing to the website is allowed.)

## How it is tried

- `accounts-check`, `safety-check` and `payments-check` unchanged and green.
- Check script: the payout account started, left unfinished, the link run out, finished,
  updated; proving an account: the good path, and each attack in decision 2 by name.
- On the Android test phone, with pictures: the payout account and the ID check in the sheet
  (Stripe's test pages) and back, in a browser that never signed in to Connect; TikTok's
  sandbox if its test address is running; Meta's flow as far as its test mode allows.

## What cannot be tried here

Meta's and TikTok's real pages in a real phone's sheet; an iPhone.

## Keeping the 4.9%

Nothing is paid in any sheet.
