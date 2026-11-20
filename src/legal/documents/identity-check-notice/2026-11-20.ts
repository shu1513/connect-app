// The text of this document as it stood in this version. A version that has been shown to people is never
// edited: a change is a new file beside this one, named in ../../registry.ts (plans/46-agreements-live.md).
const text = `# Connect Identity Check Notice

This notice is shown to you right before an identity check, on the page with the button that
takes you to Stripe. Please read it before you go on. It is also our written policy on face
data, which the law of some places (among them Illinois, Texas and Washington) requires us to
publish.

## 1. What happens

Every host must pass an identity check before their page is shown. A customer does not have to,
unless a host only takes calls from people who have, or the customer wants to.

The check is done by Stripe, on Stripe's own pages. You take a photo of an identity document
and a live picture of your face. Stripe reads the document and **compares your face with the
photo on it. To do that it makes measurements of your face.** Some laws call such measurements
"biometric identifiers" or "biometric information".

## 2. Why

For two things only: to confirm that you are a real person, and that you are 18 or older.

## 3. What Connect gets, and what it never gets

Stripe tells Connect: whether the check passed, your date of birth, and the name on your
document.

- We use your date of birth only to check whether you are 18 or older. We do not keep it.
- We keep the result (passed or not), "18 or older" (yes or no), and the name on the document,
  which only our own staff can see.
- **Connect never receives, sees or stores the photo of your document, the picture of your
  face, or any measurement of your face.** They stay with Stripe.

A host can see that your ID is confirmed. A host never sees your document, your picture from
the check, or the name on your document.

## 4. What is not done with it

Neither Connect nor Stripe on our behalf uses the measurements of your face for anything but
this check. They are not used to recognise you on a call, for advertising, or to rank hosts.
**We do not sell, rent, trade or otherwise profit from them, and we do not pass them to anyone
except Stripe and the companies Stripe uses to carry out the check,** unless you agree or the
law requires it.

## 5. How long it is kept, and when it is destroyed

- **By Stripe:** the pictures and the measurements made from them are kept by Stripe for
  [VERIFIED PERIOD FROM STRIPE] and then destroyed. Stripe's own notice, shown to you before
  the check, says the same and prevails if it differs.
- **By Connect:** we hold no pictures and no measurements. If any such data ever came into our
  hands, we would destroy it as soon as the check was done, and in every case within three
  years of your last use of Connect.
- The result of the check is kept as the Privacy Policy says.

Face data is protected at least as carefully as the other confidential information we handle.

## 6. Your consent

By pressing the button below this notice you confirm that you have read it, and **you agree in
writing that Stripe, for Connect, may collect the picture of your face and your identity
document, make and use measurements of your face to compare the two, and keep them for the
time stated in section 5.**

You do not have to do the check. If you choose not to, you can still use Connect as a customer
with hosts who do not ask for it; you cannot host.

## 7. If something is wrong

- **The result is wrong** (for example, it gives an age under 18 and you are an adult, and your
  account was paused): write to [SUPPORT EMAIL]. A person looks at it.
- **You cannot or do not want to have your face compared:** write to [PRIVACY EMAIL] before you
  start, and we will tell you whether another way to confirm who you are is available.
- **You want the data deleted, or you withdraw your consent:** write to [PRIVACY EMAIL]. We ask
  Stripe to delete what it can. This does not undo a check that was already made, and we may
  have to keep the result.

Please do not email us your document or a picture of yourself.
`;

export default text;
