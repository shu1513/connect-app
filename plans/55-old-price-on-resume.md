# Plan 55: after a pause with an account, a member comes back at their old price

27 November 2026.

## Why

Plan 53 pauses a membership when one of its two accounts is paused, and lets the member resume
after the pause is lifted. But resuming has always meant "the host's membership as it is on that
day" (plans/19, "A paused membership, and resuming"): if the host raised her member price in the
meantime, the returning member paid the new price. The builder had told the founder that the
member "keeps their price"; that was wrong, and CodeRabbit's reading of plan 53 brought it out.
The founder: "members keep their old prices when they resume yes?"

A member did not choose a pause that came from an account. They should not pay more because of
it.

## What the founder decided (27 November 2026)

- A member keeps their old price when they resume.

The builder's reading, said to the founder: this is for a pause **with an account**. After any
other pause (the member cancelled, a payment failed, the host paused them) resuming stays as the
founder's earlier rule has it: the host's membership as it is then. The rest below is the
builder's.

## Decisions

1. **The price. (founder; the "or lower" is the builder's)** After a pause with an account the
   member comes back at the lower of two prices: the one they had, and the host's member price
   on the day they resume. That is the same sum a renewal does every month ("a member's price
   only ever goes down").
2. **The time. (builder)** They come back with the time they had, also if the host's membership
   now includes less or more. A renewal would have kept it too.
3. **Room. (builder)** Resuming still needs room in the host's hours, now for the time they had.
   Without room it is refused with the usual sentence, and nothing changes.
4. **What the member sees and agrees to. (builder)** The resume page shows exactly these terms
   (one rule, `resumeTerms`, is used by the page and by the resuming step), and the agreement
   that is written down carries that price and that time. The page sends the price and the
   time it showed, and the resuming step refuses when they are not what the member would get
   at that moment: a page left open from before must not record a yes to other terms.
5. **Everything else about resuming is unchanged. (builder)** The box to tick, the card, a new
   month from that day, "member since" counted anew, and that a host who has switched her
   membership off cannot be resumed with.

## What gets built

- `src/lib/membership/rules.ts`: `resumeTerms`.
- `src/lib/membership/join.ts`: `resume` and `agreeAndStart` use it.
- `src/app/h/[handle]/membership/page.tsx`, `src/app/memberships/[id]/page.tsx`, the two
  emails of plan 53: the sentences.

## How it is checked

- Unit tests for `resumeTerms`.
- `scripts/membership-check.ts`, journey 27: the host raises her price and halves the time
  during the pause, and the member comes back as they were; she lowers it, and the next member
  gets the lower price with the time he had. Journey 26 (an ordinary pause) still gets the
  host's membership as it is then.

## Astra's check (27 November 2026): "not ready", 6 points

Taken: a Resume page left open could record a yes to other terms than the ones it showed,
because the terms no longer follow from the host's offer alone (decision 4); the member's page
said of every pause "you get the host's membership as it is then"; the pause email's "you keep
your place" read like a promise of room in the host's hours; the journey did not tie the new
month to the agreement with the kept terms.

Not taken, and why:

- **A resume that was begun and not finished** has already written its terms on the membership.
  If the host's price was lower at that moment and rises again, the member later comes back at
  that lower price, not at the one they had before. It can only make the price lower, never
  higher, and needs an abandoned card step at exactly such a moment.
- **The agreement's sentence "If the host lowers the member price, you pay less from your next
  month"** is not true for a member whose own price is already lower than the host's new one.
  That was so before this plan for anyone whose host had raised her price; the sentence is part
  of the versioned agreement wording, and changing it is a matter for the lawyer
  (`docs/for-the-lawyer.md`, section 27).

## CodeRabbit (27 November 2026)

Its review limit was reached (36 minutes to wait), so, as the standing rule says, the builder
read the whole change again instead. Found: a comment that had ended up above the wrong
function. Nothing else.

