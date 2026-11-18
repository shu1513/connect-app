# Plan 19: Memberships

**Status:** a plan only; nothing is built. Written 17 November 2026. Astra has checked it against
the code twice. Its first verdict was "not ready" and its second "ready with changes"; every point
from both is worked in below (the lists are at the end).

**When it is built: before launch.** The builder and Astra both advised building it after launch.
The founder decided on 17 November 2026 that Connect launches with memberships, so the three parts
below are built first and the points under "Before this can go live" join the launch list.

**Its size, said plainly:** this is the largest change since payments, about three modules of
work. Most of it is not the pages. It is keeping a month's money right while calls are booked,
cancelled, charged, refunded and collected.

## What this is, and why

The founder's idea: a host can invite a customer to become a **member**. A member pays the host a
fixed amount every month, and that money is talk time with the host. Members can book any open
time, including times the host keeps for members only, and their bookings are confirmed at once,
without waiting for the host to accept. Time that is not used by the end of the month expires.

What each side gets:

- **The host:** steady monthly income, and a reason for their regulars to stay on Connect.
- **The member:** a better price if the host gives one, times nobody else can book, and no waiting
  for an answer.

## What the founder decided

| Question | Decided |
| --- | --- |
| Who can become a member | Only someone the host invites. |
| What the member pays | A monthly amount set by the host. It becomes talk time with that host. |
| The member price | The host sets a price for members. It can never be more expensive than the host's regular price. |
| Which times a member can book | The host's general times and the host's member-only times. |
| The host's answer | Not needed. A member's booking is confirmed at once. The host can still cancel it. |
| When a member's time is used up | Skipping the host's approval only works with membership time. For more calls that month the member books like any customer: general times only, the regular price, and the host's approval. So a member can never hold more of a host's calendar than the time they paid for. |
| Unused time | Expires at the end of the month. This is said clearly before joining, and an email reminds the member a few days before the month ends. |
| Time the host cancels | Comes back to the member, who can still use it until the month ends. If they do not, its price is paid back to their card in full when the month ends. It is not carried into the next month. The same applies to time a host did not show up for. |
| How a member's call is counted | Exactly like a regular booking: the time the host is in the room counts. A member who does not show up still uses that time. |
| A call that should run longer | The existing "add time" feature. The extra time is taken first from the membership time the member has left; when that is not enough, it is paid by card. |
| When the host gets the money | Not before the time is delivered: as time is used, and the unused rest when the month ends. |
| Who can end it | The member cancels: the membership runs to the end of the paid month. The host ends it: the unused time is paid back. |
| Cancelling right after a payment | A member who cancels within 3 days of a monthly payment, and has not booked anything from that month, can have that month paid back in full. |
| Switching back on | A member who has cancelled can switch their membership back on until the paid month ends. |
| Changing the price or the time | Never during a month that is already paid for. |
| How the host sets the membership | The host types a member price per 15 minutes (the same way they set their regular price) and picks the time included each month. The app shows the monthly amount: "Members pay $60.00 a month for 2 hours." |
| Our fee on a membership | The usual fee, counted once a month: 4.9% of each amount that is used or expires, and the fixed 30 cents once per month instead of once per call (plus 1.5% for a card from outside the US). |
| Who a host can invite | People the host has already had a call with, from the host's "People you have talked to" page. |
| A limit on the monthly amount | None. There is a limit on the time included (see the builder's choices). |
| The founder's switch | A switch on the admin page, "Memberships", off until the whole feature is built and tried. While it is off nobody can invite or join and no month is renewed. Months already paid for keep working to their end, and all settling, paying back and collecting goes on. It stays afterwards as the founder's way to stop selling memberships without breaking the ones that exist. |
| How the work is planned | This plan is the rulebook for the whole feature. It is built in three parts, and each part gets a short plan of its own just before it is built (see "The three parts"). |
| How the monthly payment is taken | Connect charges the member's saved card itself each month. Stripe's subscription tool is not used (it costs an extra 0.7%). Stripe allows this when the member clearly agrees to the monthly charge at sign-up. |

## The builder's choices

The founder left these to the builder ("do what you think is the best").

| # | Question | Chosen | Why |
| --- | --- | --- | --- |
| 1 | What "a month" is | It starts the minute the payment goes through and ends **one calendar month later** (on the last day when the next month is shorter: 31 January to 28 February, and then 28 March). Not the calendar month. | Every member gets a full month from the day they pay. |
| 2 | A monthly payment that fails | The member gets an email with a link to pay. Connect tries the card again after 1, 3 and 5 days. **No time is given until the payment goes through**, and the new month starts when it does. After 7 days the payment is cancelled and the membership ends. | Nobody gets time they have not paid for, and nobody pays for days they could not use. |
| 3 | Changing the offer for people who are already members | **Not in the first version.** A member keeps the price and time they agreed to for as long as their membership lasts, also when they cancel and switch it back on. A changed offer applies to people who join after the change. A host who wants new terms for a member ends that membership and invites the person again. | A different charge on a saved card needs the member's clear yes, which means emails, an "Agree" step and rules for who has not agreed yet. Astra advised leaving all of that out of a first version. |
| 4 | The limit on the time included | From 30 minutes to **100 hours a month**, in steps of 30 minutes. | The founder asked for a reasonable limit, and found 20 hours too tight. 100 hours is more than 3 hours on every day of the month, so it should stand in nobody's way, and it is one number in the code. |
| 5 | The other limits | Member price from $5.00 per 15 minutes (the app's minimum) up to the regular price. One membership offer per host. | The lowest price is the one the app already has. One offer keeps the host's page and the member's choice simple. |
| 6 | The two ways to cancel inside the 3 days | In the first 3 days after a payment, with nothing booked from that month, the member is offered both: "Cancel now and get $60.00 back" (the membership ends today) and "Cancel at the end of the month" (they keep the time). After that, or once anything was booked, only the second. | Someone who joined for one month only should not be made to give the month up just to stop the next payment. |

## How it works for a host

**Setting it up.** On the Hosting page there is a new part, "Membership":

- a switch, "Offer a membership";
- "Member price per 15 minutes" (the page shows the regular price beside it and refuses anything
  higher);
- "Time included each month";
- the result in plain words: "Members pay $60.00 a month for 2 hours. Your regular price for
  2 hours is $80.00."

A host with free calls, or whose payout account is not ready, cannot offer a membership.

**Member-only times.** On the calendar page, each stretch of weekly hours gets a tick box,
"Members only". Customers who are not members never see those times.

**Inviting.** On "People you have talked to", each person the host was a host for gets "Invite to
membership". The person gets an email and sees the invitation on the host's page. An invitation can
be taken back until it is accepted.

**The member list.** Under "Membership": each member's name, since when, how much time they have
left this month, and when the month ends or renews. One button per member: "End membership".

**Changing the offer.** A changed price or time applies to people who join after the change. A
member keeps the price and time they agreed to for as long as their membership lasts (see 3 under "The builder's choices"). To keep "never more expensive than the regular price" true at every moment:

- the regular price cannot be set below the member price of the offer, or below the member price
  of any membership that has not ended (also one whose monthly payment is still being tried);
- a host who offers a membership, or still has a member, cannot make their calls free.

A host who wants a regular price below a member's price ends that membership first, and can invite
the person again at a new member price.

**Switching the offer off** takes back every open invitation, stops every payment that was being
tried again, and stops the renewal of each membership, which then ends with its paid month. Switching it on again later does
not bring anyone back by itself: a member whose month is still running can switch their own
membership back on, and anyone else needs a new invitation.

**A hidden host page.** A host who hides their page from the public keeps their members: members
can still open the page and book. While a host's page is waiting to be approved again (after a
change of name, for example), members cannot make new bookings until it is approved.

## How it works for a member

**Joining.** The invitation page shows: the host, the monthly amount, the time included, the
member price beside the regular price, the host's open times for the coming weeks, and these
sentences:

> You pay $60.00 today and then every month, until you cancel. Each month gives you 2 hours of
> calls with Hana Host. Time you have not used when a month ends expires and is not paid back.
> You can cancel at any time on "Your account"; your membership then runs to the end of the month
> you paid for. If you cancel within 3 days of a payment and have not booked anything from that
> month, you can have that payment back.

The member ticks a box agreeing to this and to their card being kept for the monthly payment (and
for extra time during a call that their membership time does not cover), enters a card, and pays the first month. The membership
starts at that moment. What was agreed (which version of the offer, which wording about the card, and when) is
kept on record.

A person who has blocked the host or is blocked by them, or whose account is paused or closed,
cannot join. If the host only takes calls from people who have confirmed their ID, the same applies
to joining.

**Booking.** On the host's page a member sees a box, "Your membership: 1 hour 30 minutes left,
until 14 December", and the open times, with member-only times marked. The lengths offered are the
host's lengths that still fit in the time left. The member picks a time, checks the summary
("Uses 30 minutes of your membership"), and presses "Book". The call is booked at once. Both
people get an email that says so, and the usual reminders.

A member's booking must start after the host's usual notice and **end before the paid month
ends**. (The extra hours a card booking needs, so that its money can be held in time, do not
apply.) The host's cancelling rule applies as it does to everyone.

**During and after the call** everything is as for a regular booking: the same call screen, the
same counting (the host's time in the room), the same page afterwards, the same "Ask for a refund"
for 24 hours, the same rating. **Extra time** asked for in the last minute and a half is taken
from the membership time the member has left; when that is not enough, the member is shown the
price and it is paid by card.

**Cancelling the membership.** On "Your account" there is a list, "Memberships", with one button:
"Cancel membership". It asks for no reason. What it does depends on when it is pressed:

- **Normally** it stops the renewal. The membership then shows "Ends on 14 December". Until that
  day nothing else changes: bookings stay, and the time left can still be booked and used. No new
  month is charged.
- **Within 3 days of a monthly payment, when nothing has been booked from that month**, the member
  is offered two things: "Cancel now and get $60.00 back", which ends the membership today and
  pays the whole month back to the card, or "Cancel at the end of the month", which is the normal
  way. This covers "I forgot to cancel" and "I changed my mind right after joining".

The 3 days, exactly: less than 72 hours since the moment Stripe says the payment went through.
That holds for the first month, for every renewal, and for a month that was paid late. A member
who chose "at the end of the month" can still press "Cancel now" while both conditions hold.
"Cancel now" is offered **once per member and host**: someone who has had a month paid back this
way and joins the same host again later does not get it a second time. Otherwise a person could
join, look at the member-only times, take the money back, and do it again with every new
invitation, each time at Connect's cost.

**Switching back on.** A membership whose renewal is stopped has a button, "Keep my membership",
until the paid month ends. It brings the membership back exactly as it was. Nothing is charged at
that moment; the page shows the unchanged monthly amount and the date of the next payment. It
works only when everything that joining needs is still true: both accounts active, no block
either way, the host approved and able to be paid, the host's "confirmed ID only" rule met, the
host still offering a membership, and the founder's switch on. If the saved card is gone, a card
is asked for first. After the paid month has ended, or after "Cancel now", or once a membership
was ended early, coming back needs a new invitation from the host.

**The monthly receipt** is an email on the day of each payment. It also says that the payment can
be had back within 3 days if nothing is booked from the month.

**The reminder.** Three days before each month ends the member gets one email: how much time is
left, the moment it expires, the date and amount of the next payment, and how to cancel.

## The money

An example: Hana's regular price is $10.00 per 15 minutes. Her member price is $7.50 per
15 minutes, with 2 hours included. A member pays **$60.00 a month**.

### Where a month's money can be

The $60.00 is taken from the member's card at once and stays with Connect. From then on every
cent of it is in exactly one of these places, and it only ever moves from one to another in a
single step that cannot half happen:

| Place | Meaning |
| --- | --- |
| Free | Can be booked. Part of it may be marked "came back because of the host". |
| Set aside | Kept for a call that is booked and not yet settled. |
| Used | A call took it. The host's share of it can be collected. |
| Expired | The month ended with it unused. The host's share of it can be collected. |
| To be paid back | Owed to the member's card; Stripe has not confirmed the refund yet. |
| Paid back | The refund has gone through. |

So at any moment, not only at the end, the six places add up to exactly what the member paid.
(A month whose charge the bank is disputing is frozen as it stands; see "Disputes".)

### Step by step

1. **Booking.** A 30-minute member call sets aside $15.00. The member now has $45.00 free, shown
   as "1 hour 30 minutes". Money that would expire is used first; money that came back because of
   the host is used last. Each booking remembers how much of each kind it took.
2. **After the call** the amount is worked out by the usual rule and at the usual time (about
   24 hours after the call's start, or when the host answers a refund request). If the host was
   there for the whole call, the $15.00 is used. If the host was there for 20 of the 30 minutes,
   $10.00 is used and $5.00 comes back.
3. **The host's share** of what was used is ready to collect at the same time as for any other
   call: 24 hours after the call when nobody asked for a refund, otherwise 2 days and never
   before the host has answered. On $15.00 the fee is 74 cents, plus the month's 30 cents on the
   first amount of the month, so the host gets $13.96 for the first call and $14.26 for the next.
4. **Money that comes back** goes to one of two places:
   - back to **Free**, to be booked again, for as long as the member can still book from that
     month;
   - to the member's **card** once they cannot: the month has ended, or the membership was ended
     early (by the host, a block, a pause, a closed account or a dispute, or by the member's own
     "Cancel now" in the first 3 days).
5. **When the month ends** it is closed for new bookings, and its free money is split:
   - the part marked "came back because of the host" is **paid back to the member's card**;
   - the rest has **expired**, and the host's share of it is ready to collect 24 hours later.
   Money still set aside for a call that has just taken place stays where it is until that call
   is settled in the usual way, also when that takes days (a refund request, a call under the
   founder's review). What that call uses goes to the host; what comes back goes to the card.
6. **A month is finished** only when nothing is set aside any more and every pay-back has been
   confirmed by Stripe.

### What counts as "came back because of the host"

- The host cancelled the call.
- The host was not in the room for all of the booked time.
- The host answered a refund request with "less" or "nothing", or gave money back with the refund
  form.
- The founder lowered or dropped the charge after a review.

It does not count when the member cancels in time: then each part of the booking goes back to
where it came from, and the plain part can expire like any unused time.

### The limit that stays as it is today

Once a host has **collected** their share of a call, the app cannot take it back, for member calls
as for every call today. So after that moment nothing of that call can come back through the app,
neither as time nor to the card. If Connect decides the member should still get money back, the
founder does it by hand at Connect's cost, as today. The same holds for expired money a host has
collected. And it holds from the moment a share is written down for collecting, also while
Stripe's answer is still awaited: such a share can neither become free again nor be paid back.

### Disputes

When a member's bank disputes a monthly charge, the whole month is frozen at once: no new member
bookings from it, nothing of it can be collected, and nothing is paid back from it (the bank may
return all of it). The membership ends, and the member's upcoming member calls are cancelled. If
Connect wins, the month goes on from where it stood: money that is still free is paid back,
because the membership has ended, and money that was already used or had already expired stays as
it is. If Connect loses, the month stays frozen and the founder settles it by hand, as for a
disputed call today.

Freezing stops new steps. A transfer or a pay-back that had already been sent to Stripe is still
followed up until its outcome is known.

### The arithmetic

- **Setting aside:** the member price for the call's length, rounded down to a whole cent. So a
  member can always book every minute they are shown.
- **Using:** the usual rule for a call's charge, and never more than was set aside. When the host
  was there for all of the booked time, exactly what was set aside is used. The same ceiling
  applies to a late cancellation, to the founder's decision after a review and to the host's
  answer to a refund request.
- **The 50 cents:** as for card calls, an amount under 50 cents is not used at all and comes back.
- **Small leftovers:** rounding can leave a few cents free at the end of a month. They expire with
  the rest, whatever their size.
- **The fee** is worked out on each amount as it is used or expires, as today's fee is worked out
  on each charge. The month's fixed 30 cents is put on the first amount of the month that is used
  or expires. If that amount is later paid back, its fee goes back in the same proportion, as
  today.
- **Extra time during a call that was booked from a membership** is taken from the month's free
  money when it covers the whole request and the longer call still ends before the month ends. It
  is then set aside, used or given back like the call's own money, with no extra 30 cents.
  Otherwise the whole request is paid by card, as an ordinary card payment: the member price, the
  usual 4.9% plus 30 cents, its own hold. A card payment is not part of the month's money and may
  run past the month's end. One request is never split between the two. Each request pays only for
  its own added minutes: the time the host was there is counted, the 50-cent rule applied and the
  ceiling kept for those minutes alone, as for added time today. (A call a member booked the
  ordinary way, by card, keeps the ordinary rules for added time.)
- What goes to the host from a month can never be more than the month's charge, because every
  share comes from money that is "used" or "expired".

## The monthly payment

- **One payment per month, written down first.** Before Stripe is asked for anything, the month is
  written down with the price and time that apply to it, and Stripe is given exactly one payment
  for it. Every try (the first, the automatic ones after 1, 3 and 5 days, and the member's own
  "Pay now") is a try at that same payment, and a payment can only go through once. So a month can
  never be charged twice, also when an automatic try and the member's own press happen together.
- **An answer that never arrived** is checked with Stripe before anything else is tried.
- **A bank that wants its own approval** is treated like a refusal: the member gets the email and
  pays by hand on the page.
- **The month starts** at the moment Stripe says the payment went through.
- **Giving up.** When the 7 days are over, or the membership ends for any reason while a payment
  is still open, that payment is cancelled at Stripe so that it can no longer go through. If it
  went through in that very moment, it is paid back in full.
- **The month before** is not touched by any of this. Its bookings all lie before its own end, and
  it closes on its own date.
- **Which price a new month gets:** the price and time the member agreed to when they joined.

## The awkward cases

| Case | What happens |
| --- | --- |
| The member cancels the membership | Nothing changes until the paid month ends: bookings stay, time can still be booked and used, and money that comes back can be booked again. No new month is charged. Until that day the member can switch it back on. |
| The member presses "Cancel now" within 3 days of a payment, with nothing booked from that month | The membership ends at once and the whole month is paid back to the card. "Nothing booked" means no money of that month was ever set aside, also not for a booking that was cancelled again. Offered once per member and host. |
| The member cancels a booking in time (by the host's cancelling rule) | The time comes back. It can be booked again before the month ends. |
| The member cancels late, or does not show up | The time is used, as for a regular booking. Until the host has collected, the host may still give it back with the refund form. |
| The host cancels a member's booking | Always free. The time comes back, and if the member does not use it again that month, its price is paid back to the card. |
| The host does not show up, or comes late | Only the host's time in the room counts, so the rest comes back in the same way. |
| A call in the last hours of a month | It is settled a day later, as always. What it uses goes to the host; what comes back goes to the card. |
| Someone else has asked for the same time and is waiting for the host's answer | The member's booking takes the time. The other request ends with the usual "the host accepted another request" email. A call that is already accepted is never touched. |
| The member asks for a refund after a call | As today: the host answers "in full", "less" or "nothing". What is not charged comes back to the member's month, or to the card once the month has ended. |
| A member's call goes to the founder's review | The money stays set aside until the founder decides. There is no card hold that could run out, so the limit is the founder's own: 3 days after the call, as today. With no decision by then, the money comes back. |
| A pay-back that Stripe refuses | The money stays "to be paid back". The helper tries again, and the founder sees it on the admin page until it has gone through. |
| The host ends one membership | It ends at once. The member's upcoming member calls are cancelled and all free money of the month is paid back to the card. A call that is under way is left to finish and is settled as usual; whatever comes back from it later goes to the card. |
| One of the two blocks the other; either account is paused or closed; the host is suspended | The same as the host ending it, with one difference that exists today and stays: a person whose account is paused or closed is put out of a call that is under way. Lifting a block or a pause later does not start the membership again. |
| The host changes the regular price | Bookings already made keep their price. The regular price can never go below the member price (see "Changing the offer"). |

## Said plainly: what this does not protect against

- **A member who cannot find a time that suits them loses that month's money**, unless the host
  cancelled. The invitation page shows the host's open times before anyone pays, and a member can
  cancel at any time. But the app does not force a host to offer enough hours.
- **After a host has collected**, the app cannot pay that call's money back (see "The limit that
  stays as it is today").
- **A refund costs Connect Stripe's card fee** on the amount paid back (about 2.9%), as refunds do
  today. Memberships will bring more refunds than calls do, because of the month-end rule.
- **A bank dispute over a monthly charge after the host has collected** is Connect's loss, as with
  calls today, up to the whole amount of each charge that is disputed. A member can dispute more
  than one month.
- **There is no limit on the monthly amount.** The whole month is charged in one go, with no hold
  first. At the highest price a host can set ($1,000 per 15 minutes) and the most time (100 hours)
  that is $400,000. The app and Stripe can carry such a number; a bank may well refuse a large
  charge, and the larger a month is, the larger Connect's loss if it is disputed after the host
  has collected.
- **A month paid back within the 3 days costs Connect Stripe's card fee** on the whole amount, and
  the host earns nothing from it. Stripe keeps about 2.9% plus 30 cents of a charge when it is
  refunded: about $2 on $60, about $29 on $1,000, and about $11,600 on the largest possible month
  of $400,000 (about $17,600 with a card from outside the US). With no limit on the monthly
  amount, this is the largest single cost one press of a button can cause Connect.
- **Connect holds a member's money for up to about five weeks** before the last of it reaches the
  host. Stripe's guides give no time limit for this; it should be confirmed with Stripe before
  going live.
- **A card whose bank wants its own approval for a monthly charge** (common in Europe, rare in the
  US) cannot be charged in the background. The member pays by hand each time.

## How it is built

**The guiding choice.** A member's call gets a row in `payments`, like every paid call today. That
keeps the things that hang on a call's payment in one place: the page after the call, the refund
request and the host's answer, and the call's line in the host's earnings. But such a row is not a
card payment, and the code must never treat it as one. So every payment gets a **kind**:

- `card`: today's payment, with its own hold and charge at Stripe;
- `member_call`: a part of a month that is set aside for one call, and then used or given back;
- `member_expired`: the expired part of a month. It has no call.

The other way, separate tables for all membership money, would keep the two kinds further apart,
but the page after a call, refund answers and the earnings lists would each have to learn about a
second source. Either way the same "Collect earnings" code pays the host. The choice here is the
kind on each payment, with the month as the one place that owns the money.

**The month owns the money.** Every step that moves a month's money (set aside, used, come back,
expired, to be paid back, paid back, frozen by a dispute, a share written down for collecting)
takes the month's lock first and changes the month's numbers and the payment in the same database
step. The order of locks is the same everywhere: the two calendars, the host's collection, the
membership, the month, the call, its payments, then request and refund records. Stopping a
renewal, switching back on, a renewal coming due, "Cancel now" and ending early all take the
membership's lock, so only one of them can win. A request to Stripe is always
written down first and sent after that step, never inside it.

**The monthly charge is recorded once**, when it goes through, as the month's own line in the
money record. A member call that uses money writes "used", never a second "charged to the
customer".

**New in the database**

- `membership_offers`: one per host. On or off, the member price per 15 minutes, the minutes
  included, and a version number that goes up with every change.
- `memberships`: one per host and customer. Where it stands (invited, active, renewal stopped, unpaid,
  ended), who or what stopped its renewal or ended it and when, whether a month was ever paid back
  by "Cancel now", the saved card, the version, price and time of the offer the member
  agreed to, the version of the card wording they agreed to, and when. (The card wording of a
  membership is its own; it never changes what an ordinary booking's card may be used for.) The
  saved card is removed at Stripe once the membership has ended and nothing of it is still open.
- `membership_months`: one per month, **written down before its payment is tried**, and one at
  most per membership and running number. The price and time fixed for it, the fee terms, its one
  payment at Stripe, the card's country, where it stands (to pay, running, closed for bookings,
  finished, given up), its start and end, the free money and the part of it that came back because
  of the host, whether its fixed 30 cents has been placed, and whether its charge is disputed.
- `membership_refunds`: one per pay-back to the card from a month. The amount, why (month end, membership ended, cancelled within the 3 days, came back after the month's end,
  a payment that went through too late), the
  call it came from if any, and whether it is in progress, done or failed.
- `payments` gets the kind, a link to a month, and "how much of this came from money that came
  back because of the host". The database makes sure a `card` or `member_call` payment has a call,
  a `member_expired` payment has none, and a month has at most one `member_expired` payment.
- `bookings` gets a link to a month, and a new source, "member".
- `weekly_hours` gets "members only".
- `site_switches` gets the founder's "Memberships" switch.
- The table of money actions and the money record each get a second possible owner, a month (for
  the monthly charge and for pay-backs), with the database making sure every line has exactly one
  owner.

**New code**, in `src/lib/membership/`:

- `rules.ts`: the plain rules, with tests. Limits on price and time; when a month ends; when "Cancel now" is offered; what a
  booking sets aside and from which kind of money; what comes back and how it is marked; how a
  month's free money is split at its end; the days a failed payment is tried again.
- `months.ts`: the only code that changes a month's numbers. One small function per movement of
  money, each taking the month's lock and each safe to run twice.
- `offers.ts`, `join.ts`: the offer; inviting (the server itself checks that the two have really
  had a call), taking an invitation back, joining.
- `charge.ts`: the monthly payment, as described under "The monthly payment".
- `book.ts`: booking as a member.
- `ending.ts`: the two ways a membership stops, which must never be mixed.
  - **The renewal is stopped** (the member cancels the normal way, or the host switches the offer
    off). Nothing else changes: the paid month, its bookings and booking from it all go on, and
    nothing is paid back. Only this can be switched back on, strictly before the paid month ends,
    with the checks listed under "Switching back on"; switching back on is recorded.
  - **Ended at once** (the host ends it, a block, a pause, a suspension, a closed account, a
    dispute, a payment given up, the member's "Cancel now"). In one step it is marked as ended, so
    that no payment and no booking can start any more, and the clean-up is written down as work to
    do: cancel the upcoming member calls, cancel an open payment, pay back the free money. The
    helper repeats that work until all of it is done. When something else causes the ending, the
    instruction to end is saved in the same database step as that action, so it cannot be lost
    between the two. A payment that was cancelled at Stripe is never brought back to life, and the
    saved card is removed only after an ending at once.
  - "Cancel now" checks its two conditions inside the locked step, so a booking, added time or
    the host's ending at the same moment gives exactly one outcome and one pay-back.
- `jobs.ts`: what the always-on helper does: renewals, new tries, reminders, closing months,
  pay-backs, endings, and finishing anything that was written down and not confirmed.
- `emails.ts`: invitation; joined (to both); the monthly receipt; the reminder; payment failed; a pay-back; ended (to both).

**Booking as a member** (`book.ts`, using the pieces of `src/lib/booking/bookings.ts`) is one step
of its own, not "ask" followed by "accept". It keeps, from today's two steps:

- from asking: no booking with yourself; one booking per press of the button (a second press gets
  the booking the first one made, and sets nothing aside again); the price and cancelling rule the
  member saw must still be the ones in force; both accounts active; Connect taking requests; no
  block either way; the host's "confirmed ID only" switch; the daily limit on requests;
- from accepting: the host approved and their payout account ready, read inside the step; the
  member price, the cancelling rule and "the host's time counts" fixed on the call; the host taken
  for the call and its break and the member for the call, with the database refusing any overlap
  (a host can also be busy as someone else's customer); other people's waiting requests for that
  time ended through the existing step;
- of its own: the membership active or with its renewal stopped (never ended), the month
  running and not disputed, the call ending before
  the month ends, enough free money, the time open for a member (general or member-only hours,
  the host's notice, how far ahead, time off).

It does not apply: the limits on waiting requests and the wait after a decline (nothing waits, and
the host invited this person), and the rules for free calls (a member call is a paid call with a
price, never a call for $0). It leaves "available now" alone. Because of the host's notice a
member booking cannot land on an instant request; the check script proves it.

**Changes to existing code**

- Open times (`bookings.ts`, `slots.ts`): member-only hours are left out for everyone else before
  hours are joined together; a host with only member-only hours is not bookable by the public.
  Saving weekly hours takes the host's calendar lock (today not every calendar edit does), so a
  time cannot change kind while it is being booked.
- Joining a call (`payments/rules.ts`, the pass for the room, the call page): today a paid call
  can be joined only when its card hold is in place and has not run out. A `member_call` payment
  that is set aside counts as paid. No made-up hold date is stored.
- The card form and its check on the call page refuse a `member_call` payment.
- When a call's money is taken (`payments/rules.ts`, `take.ts`, `jobs.ts`): the moments stay the
  same. The safety limit "never later than 12 hours before the card's hold ends" has no meaning
  for a `member_call` payment and does not apply to it; a call under review gets the 3-day limit
  named above. Card payments of the same call (extra time) keep every rule they have. So on one
  call each payment follows the limits of its own kind, while the call still has one refund
  request, one answer form, one reminder and one page; today's code takes one shared limit from
  the card holds of a call and skips a payment that has none, and that has to change.
- Taking and letting go (`payments/actions.ts`, `cancel.ts`): for a `member_call` payment these
  call `months.ts` and nothing at Stripe. They never go through the code that creates or checks a
  card hold.
- Refunds (`payments/actions.ts`, `src/lib/refunds/`): for a `member_call` payment the host's
  refund form and the answers to a refund request move money back to the month or, after its end,
  write a pay-back. The limits per payment stay: never more than was used, nothing after
  the share was sent, and nothing while any money action on that payment is written down and not
  confirmed. Time given back is recorded as a finished refund of its own kind, so that an open
  refund request counts as answered by it, as it does by a card refund today. Emails say "time back in your membership" or "paid back to your card", whichever
  happened.
- Collecting (`payments/collect.ts`, `host/earnings.tsx`, the admin lists): a payment's host is
  found through its call or its month; a share of a disputed month is held back; the transfer
  names the month's charge. Lists that show a call beside each payment show "Expired member time"
  for the one kind that has none.
- The helper's recovery (`payments/jobs.ts`): what it checks at Stripe depends on the owner and
  the kind. A month with many transfers and refunds on one charge is read in full, not only its
  first 100 lines.
- Stripe's messages (`payments/stripe-events.ts`): messages about a monthly payment go to
  `charge.ts`; a dispute on a month's charge sets the dispute on the month, where booking,
  settling, paying back and collecting all look.
- Booking jobs (`booking/jobs.ts`): the card jobs leave member bookings alone, and the job that
  removes saved cards can never remove a membership's card.
- Added time (`src/lib/extend/extend.ts`, `src/lib/extend/rules.ts`, the call screen and its
  address for asking), for a call that was booked from a membership:
  - Each choice shows how it would be paid: "from your membership", or the price "by card". The
    screen sends what it showed. The server decides again; if the membership no longer covers the
    request, nothing is asked of the host and the member is shown the card price to press again. A
    request shown as paid from the membership never turns into a card payment by itself.
  - How it is paid is decided before a saved card is looked for. Today every paid request first
    needs the call's own card hold and reads the saved card from it; a call paid from a month has
    neither. From the membership: the money is set aside in one database step, as a `member_call`
    payment for that request, and the host can be asked at once. By card: the membership's saved
    card, checked to be this member's, and a `card` payment with the usual fee, not a copy of the
    call's own terms. Once set, the way a request is paid never changes.
  - A request that is declined, runs out or fails gives its money back exactly once, to where it
    came from, after the request is marked as ended. An accepted request is never given back that
    way, and only an accepted request can ever be used. This is today's rule for a card hold.
  - Each request's payment covers only its own added minutes, from the old end to the new one;
    the call's own payment never grows.
  - The locks: asking locks the call first today. The month is found first and then locked in
    the plan's order, with everything checked again, and the clock read, after the last lock.
  - Unchanged, however a request is paid: the last 90 seconds, asking until 15 seconds before the
    end, the host's yes until 5 seconds before it, 5 to 60 minutes per request, 5 requests per
    call, one open at a time, what fits before each person's next appointment, 6 hours in all.
- Ratings (`src/lib/ratings/`) accept a call booked as a member. The booked-call emails and the
  reminders get wording for members (no "the host accepted", no card hold). A member booking
  records the moment it was made, which the host's notes and the booking page rely on.
- Endings call `ending.ts` from: blocking (`safety/blocks.ts`, also when a report blocks),
  pausing (`safety/reports.ts`), suspending a host (`booking/moderation.ts`, the admin's action),
  closing an account (`profiles/closing.ts`), the host's "End membership", the offer switched off
  (at the month's end), a dispute, and a payment given up after 7 days.
- The host's price (`profiles/profiles.ts`): the checks under "Changing the offer", made in the
  same locked step that writes down and starts a monthly payment, so a month can never start at a
  price above the regular one. A month whose payment could still go through counts.
- `src/lib/health.ts`: also "not healthy" when a renewal, a month's closing, a pay-back or an
  ending is overdue, or a member call's money has stayed set aside too long after its call.
- `worker/closer.ts` runs the membership jobs.
- Pages: Hosting (the "Membership" part), the calendar page (the tick box), "People you have
  talked to" (invite), the host's page and the booking page (the member's view, also when the
  host's page is hidden), the invitation page and the "Pay now" page (new), "Your account"
  (memberships and their monthly receipts),  the page after a call ("paid from your membership"), and the admin page (the switch,
  memberships, failed payments, pay-backs, months not finished, disputed months).

## The three parts

This plan is the **rulebook**: the rules about money run through all three parts, so they stay in
one place where they can be read together. The feature is built in three parts, in this order.
Each part gets a short plan of its own just before it is built, and then goes the usual way: Astra
checks the short plan, the part is built, Astra and CodeRabbit review it, it is merged, and it is
written into the record. What each part delivers, and when it counts as done, is fixed here and
now, so the short plans cannot drift.

The cut between the parts follows one rule: **no part may leave money in a state that a later
part has to repair.**

### Part one: the money, complete

Delivers:

- The database changes and the shared money functions. Every payment that exists today stays a
  card payment, and membership money never passes through the code for card holds.
- The monthly payment with its tries; paying back; the end of a month, with expired money; disputes;
  the helper's recovery; the health check.
- Collecting, as far as a month needs it without any call: a host can collect expired money, a
  share on its way to a host cannot be paid back, and the earnings and admin lists show a payment
  that has no call.
- The ways a membership stops, as far as money goes. Stopping the renewal and switching back on.
  Ending at once: no further charge, an open payment cancelled, free money paid back, and the
  instruction to end saved together with whatever causes it. "Cancel now" with its two conditions.
- The rules that protect money wherever they are enforced: the terms a member agreed to, the price
  rule against the regular price, and the membership's saved card being safe from the job that
  removes cards.
- The founder's switch, enforced on the server, and off.

Done when:

- A test month can be charged, renewed, ended, paid back or left to expire, and collected, with
  nothing left over for part two to put right.
- Every cent is in one of the six places after the same request sent twice, two things at the
  same moment, and the app stopping at any step; whatever is unfinished has a next step written
  down, and the helper finishes it.
- The existing payment jobs and lists handle the new records safely. Nobody can buy a membership.

### Part two: member calls, complete

Delivers:

- Member-only hours, booking as a member, joining the call, settling it, cancelling, reviews,
  refund requests and refunds, collecting a call's share, ratings, and the emails about calls.
- Added time, from the membership or by card, each with its own rules, and never a card charge the
  member did not see and press.
- What an ending means for calls: upcoming member calls cancelled, a call under way settled and
  its unused money sent to the right place, for every kind of ending and for a dispute.
- The changes the call screen, the page after a call and the booking pages need for all this.

Done when:

- Test calls come out right across a month's end, with refund requests, with disputes and with
  early endings.
- Two bookings, or a booking and added time, can never spend the same money.
- No call's money needs part three to be handled. Months already paid for stay usable with the
  founder's switch off. Nobody can buy a membership yet.

### Part three: the pages, and switching it on

Delivers:

- The host's offer, inviting, joining with the recorded agreement, the "Pay now" page for a failed
  payment, cancelling, the member list, monthly receipts, the reminder, and the admin page.
- Every remaining page, connected to what parts one and two built. It adds no money rule.

Done when:

- The whole journey passes in a browser, also at phone size, including a failed payment, a
  cancellation, and the founder's switch turned off while months are running.
- Merging this part does not turn anything on. The founder turns the switch on, after the points
  under "Before this can go live".

### For every part

The existing twelve check scripts pass unchanged, the part's own checks pass, both reviews are
dealt with, and the record is updated.

### What a short plan for a part holds

- Which sections of this rulebook it builds, what is in the part and what is left out, and what it
  relies on from the part before.
- The exact files and database changes, and the order in which they can safely go live.
- The checks that prove each "done when" point above.
- What stays switched off after it.

A short plan never changes a money rule, never leaves recovery of its own steps to a later part,
and never repeats a rule in its own words. If a rule or a cut between parts has to change, the
rulebook is changed and checked first.

## What does not change

Regular bookings, instant "call now" calls, prices, the fee on calls, card holds, when a call's
money is taken, refund requests, collecting, ratings, reports, the call screen and the video
service. A member is still an ordinary customer everywhere else, with every host, including the
one they are a member of.

## Not in the first version

- "Call now" paid from a membership (instant calls stay as they are, by card).
- More than one offer per host, yearly memberships, free trials, pausing, gifts.
- Carrying unused time into the next month.
- Inviting someone who has never had a call with the host.
- Moving a member's booking to another time (as for all bookings: cancel and book again).
- A new price or time for people who are already members. That goes through ending the
  membership and a new invitation.
- A warning to hosts who promise more member time than their weekly hours hold, and any change of
  price for a month that is already running.

## How it will be checked

- **Tests for the rules:** the limits; when a month ends (31 January, a leap year, a clock
  change); what a booking sets aside at awkward prices (at $5.00 per 15 minutes a 5-minute call
  sets aside $1.66, six of them leave 4 cents, and those 4 cents expire); that a member can
  always book every minute they are shown; which money a booking takes first; the split of a
  month's free money; the days a failed payment is tried again.
- **One rule checked after every step of every journey:** the six places of each month add up to
  exactly what was paid.
- **A new script, `scripts/membership-check.ts`**, against Stripe's test area, with journeys for:
  - joining; a refused card at joining; two presses at once;
  - a month in which everything is used; one in which nothing is used;
  - a call the host cancels that is booked again, and one that is not; money that came back
    because of the host, booked again, and then cancelled by the member in time;
  - a host who does not show up; a member who does not show up; a late cancellation;
  - a call an hour before the month's end, settled the day after; the same with a refund request
    answered "less" two days later; the same under the founder's review, decided and not decided;
  - a refund through the host's form before and after the month's end; one refused because the
    host has already collected; a pay-back Stripe refuses, tried again; the first amount of a
    month (the one carrying the 30 cents) paid back;
  - the host collecting while money of the same month comes back at the same moment;
  - a renewal; one that fails and is paid by hand; an automatic try and "Pay now" at the same
    moment (one charge); an answer from Stripe that never arrived, found a day later; a payment
    given up after 7 days; a payment that goes through just as the membership ends;
  - the member cancelling, with a booking made afterwards inside the paid month, and switching
    back on; switching back on after the host has switched the offer off (refused) and after the
    month has ended (refused);
  - "Cancel now" within 3 days with nothing booked (the whole month paid back, ended at once);
    with a booking made and cancelled again (not offered); a second before and a second after
    72 hours; after a renewal and after a month paid late; pressed twice; pressed at the same
    moment as a booking, as added time and as the host ending the membership (one outcome, one
    pay-back each time); a second time with the same host after a new invitation (not offered);
  - switching back on with a block, a paused account, a host no longer approved, the card gone
    (a card is asked for), and in the same moment as the month's end; the host ending a membership with a call still
    booked, and with a call under way; a block; a pause; a closed account while a renewal goes
    through; the offer switched off and on again; the founder's switch off with months running;
  - a changed offer (a member keeps their terms, a new member gets the new ones); the regular price set below the
    member price (refused), and calls set to free (refused);
  - a member booking that takes a time someone else was waiting for; one across the month's end
    (refused); one inside the host's notice (refused); an instant request at the same time;
  - added time on a member call: paid from the membership; declined by the host (the money goes
    back where it came from); not enough left, so paid by card with its own fee; across the
    month's end (by card); the last free money asked for by a booking and by added time at the
    same moment;
  - a dispute before any call was booked, during a month, and after the expired part was written
    down; a dispute won and lost;
  - a membership ended early while a call is under way, whose unused money comes back the next
    day (to the card); the app stopping right after a pause or a closed account is saved (the
    membership still ends); money coming back while a share of the same call is written down for
    collecting and not confirmed (refused);
  - a monthly payment still being tried while the host tries to lower the regular price below it
    (refused);
  - added time shown as "from your membership" when the money has just been booked elsewhere (a
    card price is shown, nothing is charged); a host who leaves during added time paid from the
    membership; a request that fails or runs out; one call with its own payment from the month
    and added time by card, with one refund request answered for both;
  - a dispute won after the expired part was collected (nothing more is paid back);
  - a hidden host page; the host collecting a month's money in parts, with one 25-cent charge per
    collection; the app stopping at each moment money moves, finished by the helper.
- **To prove the script notices mistakes**, three rules are switched off on purpose (the month-end
  pay-back, "nothing to the host before time is used", and "one payment per month") and the
  script must fail each time.
- **The existing twelve scripts** must pass unchanged after each of the three parts, above all
  payments, refunds, added time, booking and the whole journey.
- **By hand in a browser**, also at phone size: the host's set-up and member list, the
  invitation, joining with a test card, a member's booking, the page after the call, cancelling.
- Then the usual: Astra reviews the code of each part, and CodeRabbit reviews each pull request.
  After fixes that touch the monthly payment or pay-backs, the script is run against Stripe again
  before a part is called ready.

## Before this can go live

- **The lawyer:** monthly charges that renew by themselves (the wording before joining, the
  agreement, cancelling, the reminder), and paid time that expires. Some places treat prepaid
  value like a gift card, with their own rules on expiry. The terms and the privacy page need
  matching words.
- **Stripe:** confirm that Connect may hold a member's money for up to about five weeks, that
  charging saved cards monthly is covered by the live account's agreement, and what the live
  account allows for one large charge and for the transfers made from it.
- **A friend test, before the public launch:** one real host and one real member through a whole
  month, including a real renewal on a real card, with the founder's switch on for the test. The
  lawyer's and Stripe's points above have to be settled before memberships are sold to anyone
  else.

## Astra's check of this plan (17 November 2026)

Verdict: **not ready**. It agreed with giving a member's call its own payment record, but only if
that record is plainly a part of a month the member already paid for and never looks like a card
payment, and if the month itself owns the money. It found the first draft too thin on exactly
that. Its points, all worked in above:

1. **One set of books per month.** The draft only promised that a month adds up at its end. It now
   names the six places a cent can be at any moment, makes the month the owner, fixes the order of
   locks, records the monthly charge once, and says which money a booking takes first and how each
   part goes back.
2. **The end of a month.** "Closed" was one moment in the draft. It is now two: closed for new
   bookings, and finished. Money set aside for a call that is not settled yet (a late call, an
   open refund request, a review) waits for that call. A pay-back Stripe refuses is still owed.
3. **Refunds and disputes.** The draft said two different things about where a refund goes. The
   rule is now one: back to the month while it runs, to the card after. It also promised refunds
   the app cannot make after a host has collected; that limit is now stated. A dispute is kept on
   the month, so it also covers a month with no calls yet.
4. **Never charged twice.** The draft wrote a month down only once it was paid. It is now written
   down before the first try, with one payment at Stripe that every try uses; a payment still open
   when the membership ends is cancelled; a month starts when Stripe says it was paid; and how a
   month's end date is worked out is said (31 January, 28 February, 28 March).
5. **Rounding.** Setting aside rounds down, but today's charge rounds to the nearest cent, so a
   full 5-minute call at $5.00 would have cost a cent more than was set aside. The charge is now
   the usual one, never more than was set aside; the 50-cent rule is kept; a few cents left at the
   end expire.
6. **The fee.** The percentage is on each amount, not on "what reaches the host". The 30 cents are
   placed once and go back in proportion like any fee. Added time by card carries its own usual
   fee.
7. **Booking as a member.** The draft said "what asking and accepting do today". The plan now
   lists what is kept, what is dropped and what is new, and the places that would have broken:
   joining a call needed a card hold with an end date; ratings refused a call booked as a member;
   the emails promised a card hold; the saved-card job could have removed a membership's card.
8. **Endings and offer changes.** Every place that must end a membership is named, and ending is
   now something written down and repeated until done. The draft's "a lower member price applies
   to running months at once" went against "no change during a paid month" and is gone: a running
   month never changes, and the regular price cannot go below it.
9. **The order of the three parts.** Astra advised building the money first and the pages last,
   with a switch on the server and not only a hidden section. Taken, as the founder's switch.

Taken from its list of cuts: the warning to hosts about promising too much time, and any change
to a running month. Kept, on its advice: the month-end rules, disputes kept on the month, pay-backs
tried again, endings that cannot be lost, and the switch.

**The founder's decision after this check (17 November 2026):** extra time during a member's
call is taken first from the membership time that is left, and paid by card only when that is not
enough. The draft Astra read had it always paid by card. Worked in above.

**A second decision by the founder the same day:** skipping the host's approval only works with
membership time; once it is used up the member books like any customer. The plan already worked
this way as a recommendation; it is now in the table of decisions.

Two points where the builder chose the simpler of the options Astra gave: the 50-cent rule stays
the same for member calls as for card calls, and the 30 cents are placed on the first amount and
are refundable in proportion, which reuses today's fee arithmetic.

## Astra's second check, of the plan as it is now (17 November 2026)

Verdict: **ready with changes**. Of the nine groups from the first check it found six resolved
(the end of a month, the monthly payment, rounding, the fee, booking as a member, the order of
the parts) and three partly resolved. It kept the design. Its points, all worked in above:

1. **Two kinds of ending were mixed.** A member who cancels keeps the paid month; a membership
   ended early loses access at once. Money that comes back after an early ending now always goes
   to the card, also from a call that was still under way.
2. **Added time paid from the membership** needed its rules written out: each request pays only
   for its own minutes; a request that is declined, runs out or fails gives its money back once;
   how it is paid is decided before a saved card is looked for and never changes; and on a call
   with both kinds of payment, each follows the limits of its own kind.
3. **An ending must not get lost.** The instruction to end a membership is now saved in the same
   step as the block, pause, suspension or closing that causes it. A paused or closed person is
   still put out of a call under way, as today.
4. **Money on its way to a host** cannot become free again or be paid back, also while Stripe's
   answer is still awaited. Time given back counts as a finished refund, so an open refund request
   is answered by it.
5. **A month that is not paid yet** could have started at a price above a regular price the host
   had lowered in the meantime. Such a month now counts for the price rule.
6. **Added time must not change from "membership" to "card" by itself.** The screen sends what it
   showed, and the member presses again when the price has changed.
7. **A dispute Connect wins** does not bring back money that had already expired or been
   collected. Only money still free is paid back.

Taken from its list of cuts: a member keeps the terms they joined with (no changed terms for
existing members, no "Agree" step), a cancelled membership cannot be switched back on (a new
invitation instead), and no notices on the home page (the emails and "Your account" do that job).
Kept on its advice: the month's books, pay-backs that are tried again, endings that cannot be
lost, disputes, the health check and the founder's switch.

## Astra on how the plan is organised (17 November 2026)

Asked whether the plan should be broken up, Astra agreed with the builder's proposal: one rulebook,
and a short plan for each of the three parts just before it is built. It added that the cuts
between the parts, and when each part counts as done, should be fixed now, and wrote those lists;
they are in "The three parts", in the plan's own words. It moved four things: collecting expired
money, the money side of ending a membership, and the rules that protect money all belong in part
one, and the changes existing pages need belong with the behaviour they show, not in part three.
The founder decided to organise the work this way.

## The founder's decisions on the open points (17 November 2026)

The plan had a table of ten points "still to confirm". The founder's answers, all worked in above:

- **Agreed as recommended:** how the host sets the membership (a member price per 15 minutes and
  the time included); time the host cancelled is usable until the month ends and otherwise paid
  back in full; the fee; inviting only people the host has had a call with; the founder's switch;
  the plan as the rulebook with three parts.
- **Left to the builder:** what a month is, what happens when a monthly payment fails, and no
  changed terms for people who are already members. All three stay as recommended.
- **Changed:** no limit on the monthly amount (the plan had $2,000); a higher limit on the time
  included than 20 hours (the builder chose 100 hours a month); and a cancelled membership can be
  switched back on, which Astra had advised leaving out and the builder had cut.
- **Added:** a member who cancels within 3 days of a monthly payment, with nothing booked from
  that month, can have the month back in full. The founder had first asked whether a member who
  cancels should get back whatever they had not spent. The builder advised against that as a
  general rule, because nobody would then ever let time expire, and proposed the 3 days instead.
- **When it is built:** before launch, so that Connect launches with memberships.

## Astra's check of the changed rules (17 November 2026)

Verdict: **ready with changes**. It found no number in the code that breaks with a month of
$400,000 or 100 hours, and nothing in "Cancel now" that goes against the month's books, the fee or
the dispute rules. Its points, all worked in above:

1. **Stopping a renewal and ending at once were still written as one thing** in the builder's
   part of the plan. They are now two, with only the first able to be switched back on.
2. **"Cancel now" could be used again and again**, with a new invitation each time, to look at
   member-only times for free at Connect's cost. It is now offered once per member and host. The
   cost of one such pay-back is written out, up to the largest possible month.
3. **Switching back on** now lists what it checks, charges nothing, and shows the amount and the
   next payment date.
4. **Things that can happen at the same moment** (cancelling, switching back on, a renewal, an
   ending) now take one lock on the membership, and a payment cancelled at Stripe is never
   revived.
5. **"3 days"** is now exact: less than 72 hours after Stripe says the payment went through, for
   every month, checked inside the locked step.

Also taken: a disputed month can cost Connect the whole of each disputed charge, and a member can
dispute more than one; Stripe is asked about large charges before going live; the friend test
comes before the public launch.
