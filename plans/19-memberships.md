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
| One membership per host | A host sets up one standard membership (a member price and a time) and chooses whom to invite to it. It is not set per customer. |
| Who can become a member | Only someone the host invites. An invitation lasts 24 hours. |
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
| Who can end it | The member cancels: the membership runs to the end of the paid month and is then **paused**. The host ends it: the unused time is paid back, and the person is no longer a member. |
| A paused membership | Costs nothing and gives no member time. The member can come back by themselves whenever the host has room, without a new invitation, for example after money trouble. Only the host, a block, a paused, suspended or closed account, or a dispute over a payment end a membership for good; after that, coming back needs a new invitation. |
| Cancelling right after a payment | For the first 72 hours of each month the amount is only held on the card, not taken. A member who cancels in that time, with nothing booked from that month, pays nothing: the hold is let go, which costs Connect nothing either. |
| Switching back on | A member who has cancelled can switch their membership back on until the paid month ends. |
| Changing the price or the time | Never during a month that is already paid for. |
| When the host changes the membership | New invitations get the new price and time. People who are already members keep their time (unless they accept an offer of less time, see below), and their price only ever goes down: if the new member price is higher, they keep their own; if it is lower, they get the lower one from the next month that is written down for them. The host is shown this before she saves the change. |
| How the host sets the membership | The host types a member price per 15 minutes (the same way they set their regular price) and picks the time included each month. The app shows the monthly amount: "Members pay $60.00 a month for 2 hours." |
| Our fee on a membership | The usual fee, counted once a month: 4.9% of each amount that is used or expires, and the fixed 30 cents once per month instead of once per call (plus 1.5% for a card from outside the US). |
| Who a host can invite | People the host has already had a call with, from the host's "People you have talked to" page. |
| A limit on the monthly amount | None. There is a limit on the time included (see the builder's choices). |
| More time than the host offers | Not allowed. The time of **all of a host's members together** can never be more than the host's weekly hours offer in four weeks. Five members with 2 hours each need a host with at least 10 hours a month. |
| When a host cuts their hours and not everyone fits any more | The host chooses, in the same step as cutting the hours, what happens to each member: keep them, offer them less time, or pause them after this month. The page shows her first who is affected, and which open invitations will be taken back. |
| Less time instead of a pause | The host can offer a member a smaller time at that member's own price per 15 minutes, so they pay less. The member accepts or says no. If they say no, or do not answer before their month ends, they are paused. |
| The founder's switch | A switch on the admin page, "Memberships", with three positions: **off**, **on for the hosts the founder names**, and **on for everyone**. It is off until the whole feature is built and tried, and "on for the hosts the founder names" is how the friend test is run while nobody else can use memberships. A host who is not named, or who is taken off the list, is treated exactly as if the switch were off for her; with nobody named, memberships are on for nobody. While it is off nobody can invite, join or resume, no membership can be switched on, no renewal can be switched back on, and no month is renewed. A host can still look after what exists: lower her member price, switch her membership off, pause and end members. Months that have already started (held or paid) keep working to their end, and all settling, paying back and collecting goes on. It stays afterwards as the founder's way to stop selling memberships without breaking the ones that exist. |
| How the work is planned | This plan is the rulebook for the whole feature. It is built in three parts, and each part gets a short plan of its own just before it is built (see "The three parts"). |
| How the monthly payment is taken | Connect charges the member's saved card itself each month, first as a hold and then for real (see "The monthly payment"). Stripe's subscription tool is not used (it costs an extra 0.7%). Stripe allows this when the member clearly agrees to the monthly charge at sign-up. |

## The builder's choices

The founder left these to the builder ("do what you think is the best").

| # | Question | Chosen | Why |
| --- | --- | --- | --- |
| 1 | What "a month" is | It starts the minute the hold on the card is in place (the bank's own time for it) and ends **one calendar month later** (on the last day when the next month is shorter: 31 January to 28 February, and then 28 March). Not the calendar month. | Every member gets a full month from the day they pay. |
| 2 | A monthly payment that fails | The member gets an email with a link to pay. Connect tries the card again after 1, 3 and 5 days. **No time is given until a hold is in place**, and the new month starts when it is. The same applies when a bank lets a hold go before the money was taken. After 7 days the payment is cancelled and the membership is paused, so the member can come back when they are able to pay. | Nobody gets time they have not paid for, and nobody pays for days they could not use. |
| 3 | What "the price only ever goes down" means exactly | It is the member price per 15 minutes. Every member has a price of their own, kept on their membership. Each time the host saves a lower member price, the own price of every member whose membership has not ended or paused is lowered to it at once and for good, also for a member whose renewal is stopped; a later rise does not bring it back. A month that is already written down (running, held, or being paid for) keeps the price it was written down with; the lower price is used for the next month that is written down. (A month that replaces one whose hold was lost keeps that month's price.) A member's time changes only if they accept the host's offer of less time. A member who comes back after a pause gets the host's membership as it is then, price and time, and agrees to it again. A host who wants a higher price or more time for a member ends that membership and invites the person again. | A lower charge for the same time needs no new step from the member, and the agreement they tick says so. A higher charge would need emails, an "Agree" step and rules for who has not agreed yet. |
| 4 | The limit on the time included | From 30 minutes to **100 hours a month**, in steps of 30 minutes. | The founder asked for a reasonable limit, and found 20 hours too tight. 100 hours is more than 3 hours on every day of the month, so it should stand in nobody's way, and it is one number in the code. |
| 5 | The other limits | Member price from $5.00 per 15 minutes (the app's minimum) up to the regular price. One membership offer per host. | The lowest price is the one the app already has. One offer keeps the host's page and the member's choice simple. |
| 6 | The two ways to cancel inside the 72 hours | While the month's amount is only held, the member is offered both: "Cancel now, nothing is charged" (the membership is paused today) and "Cancel at the end of the month" (only the renewal is stopped; the amount is taken at its usual moment and they keep the time). Once the money has been taken, only the second. | Someone who joined for one month only should not be made to give the month up just to stop the next payment. |
| 7 | When the held money is taken | At the member's first booking of the month, or **72 hours and 3 minutes** after the hold, whichever comes first. Both times count from the bank's own time for the hold. The page offers "Cancel now" for the 72 hours; the server accepts it until the money has really been taken, so a press in the last second, or in the 3 minutes after, still counts. | The founder asked for a cushion. The app already uses 3 minutes in the same way for a last-second refund request. Not longer (80 hours was the other idea): the app counts on a card hold lasting 4 days at worst, and taking the money at 72 hours leaves almost a day (23 hours 57 minutes) for a helper that was down. When Stripe reports that a card's hold ends sooner than that needs, the money is taken 12 hours before the hold ends, and the member's page and receipt show that earlier moment as the last one for "Cancel now". |
| 8 | How often "Cancel now" can be used | No limit. | It was limited to once per member and host while it cost Connect a card fee each time. Letting a hold go carries no card fee. Someone who joins and cancels again and again ties up money on their own card (a bank may show a hold like a charge, and it can take days to disappear), cannot take a time in the host's calendar without the money being taken, and the host can end the membership. Stripe's optional fraud checks can cost a few cents per card. |
| 9 | How the host's hours are counted | All weekly hours on the calendar page, general and member-only: for each weekday the stretches are joined (two that overlap are not counted twice), measured by the clock, and the week's total is taken times four. Time off, breaks, ordinary bookings and the hour lost or gained when the clocks change are not counted. No calendar or no weekly hours means no room. | A plain number a host can see on their own page: "Your weekly hours offer 40 hours a month." |
| 10 | Room for someone new (an invitation, joining, resuming) | The host's hours, less everything already promised: every month that is running or held, also one whose renewal is stopped; every membership whose payment is being tried; every open invitation. Each is counted with its own agreed time, since members who joined under an older offer can have a different time. Saving an offer only needs the offer to fit once. | Strict, because this is the moment a new promise is made. |
| 11 | Who keeps their place at a renewal when the host's own choice has not settled it | The host chooses when she cuts her hours. This is only the safety net behind that, for the rare case that two things happened at the same moment. It never goes against what she saved: a member she paused is out, and a member with an open or an accepted offer of less time counts with the smaller time. One calculation, the same whoever's renewal comes first. Take every member who wants a next month (not paused, not ended, renewal not stopped by the member or the host; a member whose payment is being tried keeps their turn). Go through them from the longest-standing to the newest, counted from their last joining or resuming. Each one whose own time still fits in the host's hours as they are now gets a place and uses that room; one whose time does not fit gets none and uses none, so a newer member with a smaller time can still fit. A member's new month starts only if this gives them a place. | "The longest-standing members who fit keep their place." Asking only "does everyone older than me fit" gave different answers depending on whose renewal came first: with room for 4 hours, an older member at 6 hours and a newer one at 2, the newer one must stay and the older one be paused, in either order. |
| 12 | Months that have started | Never touched by a cut in hours. For a while a host can therefore owe more than the hours hold, until the months that no longer fit have run out. Open invitations give way first: after a cut, invitations that no longer fit are taken back, and existing members come before them. | Nobody loses a month they paid for. |
| 13 | Invitations and a changed membership | An invitation is for the membership as it stood. When the host changes it, open invitations are taken back, and the host invites again. The page tells her so before she saves. | An invitation holds a place of a known size, and nobody joins under terms the host no longer offers. |
| 14 | An invitation that runs out | After 24 hours it ends by itself, its place is free again, and both are told. The 24 hours are checked at every step that uses the invitation, so a late helper never lets an old one through. To accept in time means: the invited person pressed "Join" with the box ticked before the 24 hours were over. From that moment the place is theirs for the card step, which has the same short time limit the card step of a booking has today. If no hold is in place by then, the joining is undone, the payment cancelled and the place freed; a hold that arrives after that is let go. | The founder's 24 hours, the same time a host has to answer a request for a call. One clear winner between "it ran out" and "they were just paying". |
| 15 | Inviting the same person again | One invitation per host and person at a time. Inviting again makes a new one for the membership as it is then, with a new 24 hours, and the old link stops working. At most 3 invitations to the same person in 30 days. Time a person needs to confirm their ID does not extend the 24 hours; the host invites again afterwards. | Keeps invitations from being used to pester someone, and from holding a place for long. |
| 16 | Offering less time: the details | **Who and when.** Only in the step where the host cuts her hours, and only to a member whose month has started (running, or held). A member whose payment is still being tried can be kept or paused, and pausing cancels that payment at once. **The time.** At least 30 minutes, in steps of 30 minutes, and less than the member's time now. The member's own price per 15 minutes as it is at that moment stays, so the monthly amount falls. **One at a time.** A member has at most one open offer. In a later cut, a member with an open offer can be left with it or paused (which takes the offer back); a new offer is possible only after the first is closed. **Room.** While an offer is open, the smaller time is what is kept for that member's next month; accepting keeps it; "No thanks", running out, or the host taking it back and pausing frees it. For someone new (row 10) the member's running month still counts in full. **Answering.** The member has until their running month ends, strictly before it. The email's button opens the same page as "Your account"; there is one way to accept. Accepting needs the offer to be open and unchanged, charges nothing, is recorded as a new agreement and takes effect with the next month that is written down. **Before a renewal.** The offer is settled before the next month is written down or any payment asked for: unanswered means paused, and nothing is held. The 72 hours and the 3 minutes belong to the next month's payment and give no extra time to answer. **What closes an offer.** Accepting; "No thanks"; the month's end; the host taking it back; the member's own "Cancel" (either kind); the membership ending; the host switching her membership off; a dispute; and the month losing its hold (the member is then paused, and no new payment is tried). **What accepting does not do.** It clears only the stop that came with the offer, never the member's own cancellation. **The host's change of mind.** She can take an unanswered offer back, which leaves the member paused after this month, or kept with their old time if there is room again. | The member gets less than they signed up for, so it is their choice, and what they chose is on record. Outside a cut in hours a host has no reason to shrink one member's time. One offer at a time and one way to accept keep it small. |

## How it works for a host

**Setting it up.** On the Hosting page there is a new part, "Membership":

- a switch, "Offer a membership";
- "Member price per 15 minutes" (the page shows the regular price beside it and refuses anything
  higher);
- "Time included each month";
- the result in plain words: "Members pay $60.00 a month for 2 hours. Your regular price for
  2 hours is $80.00."

A host with free calls, or whose payout account is not ready, cannot offer a membership. **Room for members.** A host cannot promise more time than they have. The time of all members
together can never be more than the host's weekly hours offer in four weeks: a host with 10 hours
a week has 40 hours, which is room for twenty members at 2 hours, or four at 10 hours. The
"Membership" part shows it: "Your weekly hours offer 40 hours a month. Your members and
invitations use 34. Room for 3 more members." An offer that does not fit even once is refused.

**When a host later offers fewer hours** and not everyone fits any more, she decides what happens
to each member, in the same step. The calendar page gets a way to change a stretch of hours in
one go, so that moving hours to another time is not a removal followed by an addition, and every
change that makes the week's total smaller goes through this step. (Ticking "members only" does
not change the total and never starts it.) Before the change is saved the page shows:

- **What she offers after the change, and what her members need for their next months:** "Your
  members need 34 hours a month from their next payment on. With these hours you offer 24."
- **What she still owes this month.** Months that have already started go on whatever she
  chooses, so for a while she can owe more than her new hours hold. The page says so.
- **Which open invitations will be taken back.** Invitations give way before members. The ones
  that still fit beside everything she already owes stay, the oldest first.
- **The list of her members who would get a next month**, each with their time, and three
  choices for each: **keep**; **offer less time**, with the new time; or **pause after this
  month**. ("Offer less time" is there for a member whose month has started. A member who
  already has an open offer from an earlier cut is shown with it, and can be left with it or
  paused.) To
  start with, the newest members are set to "pause" until the others fit. She changes it as she
  likes. A member whose renewal is already stopped is shown as leaving anyway and needs no choice.

The change is saved only when the members she keeps, with the smaller times she offers, fit in
the new hours. So a host who has to drop all her hours at once can do it, by pausing everyone. The
choices and the new hours are saved in one step. If something about her members changed while the
page was open, nothing is saved and she is shown the page again.

What then happens:

- Months that have already started are not touched. Nobody loses anything in the middle of a
  month they paid for.
- **A member she paused** is told by email, keeps the month they paid for, and is paused when it
  ends. They can resume as soon as there is room.
- **A member she offered less time** gets an email and sees it on "Your account": "Hana is
  cutting her hours. She offers you 1 hour a month instead of 2, at your same price. You would pay
  $30.00 a month instead of $60.00, from your next month on 14 December. Answer before then. The
  smaller time stays, also if Hana adds hours again later; to get more time you would need a new
  invitation from her, or to come back after a pause on her terms at that time." with two
  buttons, "Accept 1 hour a month for $30.00" and "No thanks". Accepting charges nothing; from
  their next month they have the smaller time and pay less. With "No thanks", or no answer before
  their month ends, they are paused when it ends. Both are told the outcome by email.
- She can change her mind in the member list for as long as that member's month runs: undo a
  pause, or take back an offer. Undoing needs room. Adding hours back later does not undo
  anything by itself; she undoes it.
- Behind her choices stands a safety net (see 11 under "The builder's choices"), so that even in
  an odd case no new month starts without room.

**Member-only times.** On the calendar page, each stretch of weekly hours gets a tick box,
"Members only". Customers who are not members never see those times.

**Inviting.** On "People you have talked to", each person the host was a host for gets "Invite to
membership". The person gets an email and sees the invitation on the host's page. An invitation can
be taken back until it is accepted. An invitation needs room, and holds its place until it is
accepted or taken back. It is for the membership as it stands that day: when the host changes
it, open invitations are taken back. **An invitation lasts 24 hours.** After that it ends by
itself and its place is free again; the host can invite the same person again with one press
(the old link then stops working; at most 3 invitations to one person in 30 days).

**The member list.** Under "Membership": each member's name, since when, how much time they have
left this month, and when the month ends or renews. Two buttons per member: "Pause after this month", which stops that member's renewal (the member
keeps the month they paid for, is then paused, and can resume when there is room; the host can
undo it until the month ends; on a member who has no running month because a payment failed, it
pauses at once and cancels the open payment), and "End membership", which ends it at once and
for good.

**Changing the membership.** A host has one membership, and can change its member price and its
time. Before the change is saved the page says what it does:

- **New invitations** get the new price and time. Open invitations are taken back, because they
  were for the old ones.
- **People who are already members** keep their time. Their price only ever goes down. If the new
  member price is higher than theirs, nothing changes for them. If it is lower, their price is
  lowered for good, they pay it from the next month that is written down for them (a payment that
  is already being tried keeps its price), and they are told by email. The page shows it with numbers, and says which number is which: "3 members pay $7.50 per
  15 minutes now. From their next month they will pay $6.00, like new members. Together they will
  pay $18.00 less a month. After our fee that is about $17.00 less for you."
- A month that is already running, held or being paid for never changes.
- A lower price can always be saved, also when the membership's time no longer fits in the host's
  hours: lowering a price promises nobody a new place.

To keep "never more expensive than the regular price" true at every moment, the regular price
cannot be set below the member price of a membership that is switched on, or below the price of
any month that is running, held or still being paid for, and a host who offers a membership or
still has such a month cannot make their calls free. A host who wants a lower regular price lowers
the member price first; her members follow with their next month, and when the months that were
written down at the old price have ended, the regular price can follow. That is at most a month,
or a little longer for a member whose payment came in late. (A paused membership has no month and
so no price, and a membership that is switched off has no price that counts; neither stands in
the way.)

**Switching the offer off** takes back every open invitation and stops the renewal of each
membership, which is then paused when its month ends. A month that has already started, also one
whose money is still only held, goes on to its end as usual. A membership whose payment was being
tried again has that payment cancelled and is paused at once. Nobody can resume while the offer
is off. Switching it on again charges nobody by itself: a member whose month is still running can
switch their own membership back on, and a paused member can resume.

**Paused members** stay in the member list, marked "paused", with the same "End membership"
button. A host who does not want someone to come back ends that membership.

**A hidden host page.** A host who hides their page from the public keeps their members: members
can still open the page and book. While a host's page is waiting to be approved again (after a
change of name, for example), members cannot make new bookings until it is approved.

## How it works for a member

**Joining.** The invitation page shows: the host, the monthly amount, the time included, the
member price beside the regular price, the host's open times for the coming weeks, and these
sentences:

> You pay $60.00 a month, starting today, until you cancel. If Hana Host lowers her member price,
> you pay less from your next month; your time stays the same. Each month gives you 2 hours of
> calls with Hana Host. Time you have not used when a month ends expires and is not paid back.
> You can cancel at any time on "Your account"; your membership then runs to the end of the month
> you paid for. At the start of each month the amount is first only held on your card. It is
> taken when you make your first booking of that month, or after 72 hours, whichever comes first
> (sooner if your card's hold ends sooner; "Your account" shows the exact time). If you cancel
> before it is taken, nothing is charged.

The member ticks a box agreeing to this and to their card being kept for the monthly payment (and
for extra time during a call that their membership time does not cover), enters a card, and the first month's amount is held on it. The membership
starts at that moment. What was agreed (which version of the offer, which wording about the card, and when) is
kept on record.

A person who has blocked the host or is blocked by them, or whose account is paused or closed,
cannot join. If the host only takes calls from people who have confirmed their ID, the same applies
to joining. Joining also needs room (see "Room for members"); an invitation holds its place.
Time needed to confirm an ID does not extend an invitation's 24 hours; the host invites again.

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
"Cancel membership". It asks for no reason. Before the member confirms, the page says what they
would give up: "Your price of $7.50 per 15 minutes and your 2 hours a month are yours while your
membership goes on. If it is paused and you come back later, you get Hana's membership as it is
then." What the button does depends on when it is pressed:

- **Normally** it stops the renewal. The membership then shows "Ends on 14 December". Until that
  day nothing else changes: bookings stay, and the time left can still be booked and used. No new
  month is charged. On that day the membership is paused.
- **In the first 72 hours of a month, when nothing has been booked from it**, the month's amount
  is still only held on the card. The member is offered two things: "Cancel now, nothing is
  charged", which lets the hold go and pauses the membership today, or "Cancel at the end of the
  month", which is the normal way. This covers "I forgot to cancel" and "I changed my mind right
  after joining". A member who chose "at the end of the month" can still press "Cancel now" while
  the amount is only held.

The 72 hours count from the bank's own time for the hold, for the first month, for every renewal
and for a month that was paid late. The page and the receipt show the exact last moment. The page
stops offering "Cancel now" then; the server still accepts it until the money has really been
taken, 3 minutes later, so nobody loses by a second. Letting a hold go carries no card fee. A
bank may still show the hold like a charge for some days before it disappears.

**Switching back on.** A membership whose renewal is stopped has a button, "Keep my membership",
until the paid month ends. It brings the membership back with the member's own price and time. Nothing is charged at
that moment; the page shows the amount of the next payment (lower than before, if the host has
lowered her price) and its date.

**A paused membership, and resuming.** A paused membership costs nothing and gives no member time: the person books like any customer, and time added to a call cannot be paid from a membership. It is listed on "Your account" with a button, "Resume
membership". Resuming is like joining, without needing an invitation: the page shows the host's
offer as it is now, the member ticks the box again, enters a card, and a new month starts. A
membership is paused when the member cancelled and the paid month has ended, after "Cancel now",
when a failed payment was given up after 7 days, when the host switched the offer off, when the
host chose "Pause after this month", and when there was no room for the member at a renewal.

"Keep my membership" and "Resume membership" work only when everything that joining needs is
true: both accounts active, no block either way, the host approved and able to be paid, the host's
"confirmed ID only" rule met, the host offering a membership, the founder's switch on, and room: for resuming, room for one more
member now; for switching a renewal back on, by the member or by the host, room for that member's
next month. Without room it is refused with a plain sentence. A renewal can be stopped by the member ("Cancel") and by the host ("Pause after this month"),
and each can only undo their own: the membership renews only when neither stop is left. Once
the host has ended a membership, or it ended through a block, a closed or paused account or a
dispute, coming back needs a new invitation from the host.

**The monthly receipt** is an email at the start of each month. It says that the amount is held
now, when it will be taken, and that cancelling before then, with nothing booked, costs nothing.

**The reminder.** Three days before each month ends the member gets one email: how much time is
left, the moment it expires, the date and amount of the next payment, and how to cancel. For a
member with an open offer of less time it says instead: "Accept by 14 December, 3:10 pm, to go on
with 1 hour a month for $30.00. Otherwise your membership is paused then." A member who is going
to be paused is told that, and not promised a payment. This email is sent whatever the person
chose for reminder emails, like a receipt, because it is the notice of a payment.

## The money

An example: Hana's regular price is $10.00 per 15 minutes. Her member price is $7.50 per
15 minutes, with 2 hours included. A member pays **$60.00 a month**.

### Where a month's money can be

### First a hold, then the money

At the start of each month the $60.00 is **held** on the member's card, the way the money for a
call is held today. The month starts at that moment: the member sees their 2 hours and can book.
The money is taken for real at the first of these two moments:

- the member's **first booking** of the month. The money is taken first, and the call is booked
  only once Stripe has confirmed it. Nothing is ever set aside from money Connect does not have;
- **72 hours and 3 minutes** after the hold.

Until then the member can press "Cancel now": the hold is let go, nothing was ever charged, and
there is no card fee. If a bank lets a hold go by itself before the money is taken (rare), that
month is closed as not paid: the member has no time, and a new month with the same price and time
is tried as a failed payment. (One exception: a member with an open offer of less time is paused instead, and nothing new is tried.)

While a month is only held, none of its money is in any of the places below: there is nothing to
set aside, use or pay back. The places are filled only when Stripe has confirmed that the **whole**
monthly amount was taken. If Stripe ever reports a different amount, the month gives no time and
goes to the founder to settle by hand.

### Where a month's money can be

Once the $60.00 has been taken it stays with Connect. From then on every
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
     early (by the host, a block, a closed or paused account, or a dispute).
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
- The founder lowered or dropped the charge after a review, or did not decide a review in time.

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
return all of it). The membership ends, and the member's upcoming member calls are cancelled. This holds
whichever month is disputed: a dispute over an older month, from before a pause or from an
earlier membership with the same host, ends the membership the two have now. It is the one case
where an old month changes a membership; someone who takes a charge back through their bank is
not charged by that host again without a new invitation. If
Connect wins, the month goes on from where it stood: money that is still free is paid back,
because the membership has ended, and money that was already used or had already expired stays as
it is. If Connect loses, the month stays frozen and the founder settles it by hand, as for a
disputed call today.

Freezing stops new steps. A transfer or a pay-back that was already written down before the
freeze, whether or not it had reached Stripe yet, is still carried out or checked under the name
it was written down with, until its outcome is known. "Frozen" means the dispute is open or
lost; a month whose dispute was won is not frozen.

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
  for it. The hold and the taking are two steps of that one payment. Every try (the first, the
  automatic ones after 1, 3 and 5 days, and the member's own "Pay now") is a try at that same
  payment, and it can only go through once. So a month can never be charged twice, also when an
  automatic try and the member's own press happen together.
- **An answer that never arrived** is checked with Stripe before anything else is tried. A payment
  whose outcome is not known is never replaced by another.
- **A bank that wants its own approval** is treated like a refusal: the member gets the email and
  pays by hand on the page. (The app already places holds on saved cards this way for calls.)
- **A payment that fails:** the member is told by email at once, with a link to pay, and has no
  member time and cannot book as a member until a hold is in place.
- **The month starts** at the bank's own time for the hold. That time, and the end of the hold as
  Stripe reports it, are stored; the 72 hours, the 3 minutes and the month's end all count from
  it.
- **Taking the money** happens at the member's first booking or 72 hours and 3 minutes after the
  hold (see "First a hold, then the money"). Like every money action it is written down first.
  The timed taking skips a month whose money was already taken, and a second try at a month that
  is already paid never turns it into "not paid". After the helper was down, the money is taken
  as soon as it is back, as long as the hold still stands.
- **A hold that is gone** before the money was taken (the bank let it go, or it ran out): Stripe
  cannot take or hold that payment again. That month is closed as not paid, and a new month with
  the same price and time gets a payment of its own and goes the failed-payment way (but for a
  member with an open offer of less time, who is paused instead), with the
  7 days counted from the moment the hold was found to be gone. No booking was made from the old
  month, so nothing has to be undone.
- **"Cancel now"** lets the hold go and gives the month up. It, the taking and a first booking
  all take the membership's lock, so exactly one of them wins.
- **Giving up.** When the 7 days are over, the open payment is cancelled at Stripe so that it can
  no longer go through, and the membership is paused. When a membership is ended while a payment
  is still open, the same is done. If a payment went through in that very moment, a hold is let
  go and money already taken is paid back in full.
- **The month before** is not touched by any of this. Its bookings all lie before its own end, and
  it closes on its own date.
- **Which price a new month gets:** the time the member agreed to, at the lower of two prices:
  the member's own, and the membership's member price at that moment. When a member resumes
  after a pause, it is the host's membership as it is then, price and time, agreed to again.
- **No month starts** without room for it (see "Room for members"). At a renewal without room
  nothing is charged and the membership is paused. Room is kept for a payment while it is being
  tried. When a hold comes back from Stripe it is checked once more: if the host's hours or the
  founder's switch no longer allow a new month, the hold is let go and nothing starts. A month
  that has already started is never undone this way.

## The awkward cases

| Case | What happens |
| --- | --- |
| The member cancels the membership | Nothing changes until the paid month ends: bookings stay, time can still be booked and used, and money that comes back can be booked again. No new month is charged. Until that day the member can switch it back on; after it the membership is paused and can be resumed. |
| The member presses "Cancel now" in the first 72 hours, with nothing booked from that month | The hold is let go, nothing is charged, and the membership is paused. It is only offered while the month's money has not been taken, and the first booking takes the money, so "nothing booked" is true by itself. |
| The member's first booking of a month | Everything about the booking is checked first. Then the month's money is taken, and then the call is booked. If Stripe refuses, or its answer does not arrive, nothing is booked and the member is told to try again in a moment. If the money was taken but the time was lost in that moment (someone else got it), the month stays paid, and the member is told plainly: "Your month's payment went through, but that time is no longer open. Please choose another." |
| A bank lets the hold go before the money is taken | That month is closed as not paid. The member has no member time and gets the "payment failed" email; a new month with the same terms is tried. A member with an open offer of less time is paused instead. |
| The host cuts their weekly hours so that not all members fit | She cannot save the cut until she has chosen, for each member who would get a next month, to keep them, offer them less time or pause them, so that those she keeps fit. Months that have started go on. Nobody can be invited, join or resume while there is no room. |
| A member is offered less time | Accept: the smaller time and the lower amount from the next month that is written down, at their own price. "No thanks" or no answer before their month ends: paused when it ends. The running month is the same either way. |
| A member who stopped their own renewal wants it back after the host cut her hours | Only if there is room for their next month. Otherwise it is refused, and they are paused when the month ends, as they had chosen. |
| Five members at 2 hours each, and the host offers 2 hours a month | Cannot happen: the fifth, fourth, third and second invitation are refused for lack of room, and a host with five such members cannot cut her hours to 2 a month without a mix of pauses and smaller times that adds up to no more than 2 hours. |
| A paused member wants to book | They book like any customer. To book as a member they resume first. |
| The member cancels a booking in time (by the host's cancelling rule) | The time comes back. It can be booked again before the month ends. |
| The member cancels late, or does not show up | The time is used, as for a regular booking. Until the host has collected, the host may still give it back with the refund form. |
| The host cancels a member's booking | Always free. The time comes back, and if the member does not use it again that month, its price is paid back to the card. |
| The host does not show up, or comes late | Only the host's time in the room counts, so the rest comes back in the same way. |
| A call in the last hours of a month | It is settled a day later, as always. What it uses goes to the host; what comes back goes to the card. |
| Someone else has asked for the same time and is waiting for the host's answer | The member's booking takes the time. The other request ends with the usual "the host accepted another request" email. A call that is already accepted is never touched. |
| The member asks for a refund after a call | As today: the host answers "in full", "less" or "nothing". What is not charged comes back to the member's month, or to the card once the month has ended or the membership was ended early (and waits while the month is frozen by a dispute). |
| A member's call goes to the founder's review | The money stays set aside until the founder decides. There is no card hold that could run out, so the limit is the founder's own: 3 days after the call, as today. With no decision by then, the money comes back. |
| A pay-back that Stripe refuses | The money stays "to be paid back". The helper tries again, and the founder sees it on the admin page until it has gone through. |
| The host ends one membership | It ends at once. The member's upcoming member calls are cancelled and all free money of the month is paid back to the card. A call that is under way is left to finish and is settled as usual; whatever comes back from it later goes to the card. |
| One of the two blocks the other; either account is paused or closed; the host is suspended | The same as the host ending it, with one difference that exists today and stays: a person whose account is paused or closed is put out of a call that is under way. Lifting a block or a pause later does not start the membership again. |
| The host lowers the member price | Members pay the lower price from the next month that is written down for them, with their time unchanged. Months that are running, held or being paid for stay as they are. |
| The host raises the member price, or changes the time | Only new invitations get it. Members keep their price and time. |
| An invitation is not answered in 24 hours | It ends, the place is free, and both are told. |
| The host changes the regular price | Bookings already made keep their price. The regular price can never go below the member price (see "Changing the offer"). |

## Said plainly: what this does not protect against

- **A member who cannot find a time that suits them loses that month's money**, unless the host
  cancelled. The invitation page shows the host's open times before anyone pays, and a member can
  cancel at any time. The app does not let a host promise more member time than their weekly
  hours hold. But it counts weekly hours only: time off, and times taken by ordinary bookings or
  by other members, are not taken away, and the hours may not suit a particular member.
- **After a host has collected**, the app cannot pay that call's money back (see "The limit that
  stays as it is today").
- **A refund costs Connect Stripe's card fee** on the amount paid back (about 2.9%), as refunds do
  today. Memberships will bring more refunds than calls do, because of the month-end rule.
- **A bank dispute over a monthly charge after the host has collected** is Connect's loss, as with
  calls today, up to the whole amount of each charge that is disputed. A member can dispute more
  than one month.
- **There is no limit on the monthly amount.** At the highest price a host can set ($1,000 per
  15 minutes) and the most time (100 hours) a month is $400,000. The app and Stripe can carry
  such a number; a bank may well refuse to hold that much, and the larger a month is, the larger
  Connect's loss if it is disputed after the host has collected.
- **For up to 72 hours a month's money is only promised.** A member can use nothing of it in that
  time without the money being taken first, so nothing can be lost. But a bank can let a hold go
  early, and then the member has to pay again.
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
step. The order of locks is the same everywhere: the two calendars, the person and
profile rows, the host's collection, the membership, the month, the call, its payments, then
request and refund records (plan 20, "The order of locks", has it in full). Stopping a
renewal, switching back on, a renewal coming due, "Cancel now" and ending early all take the
membership's lock, so only one of them can win. Everything that reads or changes room (an
invitation, joining, resuming, a renewal, a change of the offer, a change of weekly hours) takes
the host's calendar lock first, the same lock bookings take, so two people cannot both get the
last place and a place cannot be given while the hours are being cut. A request to Stripe is always
written down first and sent after that step, never inside it.

**The monthly charge is recorded once**, when it goes through, as the month's own line in the
money record. A member call that uses money writes "used", never a second "charged to the
customer".

**New in the database**

- `membership_offers`: one per host. On or off, the member price per 15 minutes, the minutes
  included, and a version number that goes up with every change.
- `memberships`: one live one per host and customer. A pause keeps it; after an ending, a new
  invitation starts a new one, so an ended membership keeps its months, its cards and its
  unfinished clean-up to itself. Where it stands (invited, active, renewal stopped,
  unpaid, paused, ended), whether the member stopped the renewal and whether the host did (two separate marks,
  each cleared only by its own side; and a third mark for a renewal that stopped because the host switched her membership off during the month, which only the member takes back, with "Keep my membership", once it is on again), who or
  what paused or ended it and when, since when it has run without a break, the member's own price per 15 minutes and own time
  for the next month that is written down, an open offer of less time (the time offered and when
  it runs out), the saved card, and the agreement that applies now. An open invitation records the version and the time of the
  offer it was made for, and when it runs out.
- `membership_agreements`: one per time the member agreed, at joining and at every resuming. The
  version, price and time of the offer, the version of the card wording, and when. Nothing in it
  is ever changed, and each month points to the agreement it was started under, so what a member
  agreed to for an old month can always be shown. A price the host lowered is written down as a
  line of its own: which membership, which version of the host's membership, the new price, and
  the first month it applies to. It needs no new agreement, because the agreement a member ticks
  already allows a lower price for the same time. An accepted offer of less time is a new
  agreement. Each month stores the
  price it was started at. (The card wording of a membership is its own; it
  never changes what an ordinary booking's card may be used for.)
- The saved card: from the moment a membership is paused or ended it is used for nothing new. It
  is removed at Stripe only when nothing that still needs it is open, such as a hold for added
  time on an earlier call.
- `membership_months`: one per month, **written down before its payment is tried**, and one at
  most per membership and running number. The agreement it belongs to, the price and time fixed
  for it, the fee terms, its one payment at Stripe, the card's country, the bank's time for the
  hold and the hold's end as Stripe reports it, its start and end, the free money and the part of
  it that came back because of the host, whether its fixed 30 cents has been placed, and whether
  its charge is disputed. Where it stands:
  - *to pay*: written down, no hold yet (the first try, or tries after a failure);
  - *held*: the hold is in place, the member has their time, no money is in any place;
  - *running*: the whole amount is confirmed taken and the six places are filled;
  - *closed for bookings*, then *finished*: as under "The money";
  - *given up*: it never became money: "Cancel now", a hold that was gone, or 7 days without a
    payment.
  Taking the money and letting a hold go are money actions like any other: written down first,
  and "being taken" or "being let go" until Stripe's answer is known.
- `membership_refunds`: one per pay-back to the card from a month. The amount, why (month end, membership ended, came back after the month's end, a payment that went through
  too late), the
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

- `rules.ts`: the plain rules, with tests. Limits on price and time; room in the host's weekly hours, who counts, and who keeps their place; when a month ends; when
  "Cancel now" is offered and until when it is accepted; when held money is taken; what a
  booking sets aside and from which kind of money; what comes back and how it is marked; how a
  month's free money is split at its end; the days a failed payment is tried again.
- `months.ts`: the only code that changes a month's numbers. One small function per movement of
  money, each taking the month's lock and each safe to run twice.
- `offers.ts`, `join.ts`: the offer; inviting (the server itself checks that the two have really
  had a call), taking an invitation back, joining.
- `charge.ts`: the monthly payment, as described under "The monthly payment": the hold, the
  taking, the tries, giving up. It uses the app's existing way of holding money on a card and
  taking it later, with a month as the owner instead of a call's payment.
- `book.ts`: booking as a member.
- `ending.ts`: the three ways a membership stops, which must never be mixed.
  - **The renewal is stopped** (the member cancels the normal way, the host presses "Pause after
    this month", or the host switches the offer off). The member's stop and the host's stop are kept apart, and each side can only
    undo its own. Nothing else changes: the paid month, its bookings and booking from it all go on, and
    nothing is paid back. It can be switched back on, strictly before the paid month ends;
    switching back on is recorded. When the paid month ends, the membership is paused.
  - **Paused** (the month ended after the renewal was stopped; "Cancel now"; a failed payment
    given up; no room at a renewal). There is no current month and no new monthly payment. Whatever is still open from
    earlier months (a call being settled, a pay-back, added time paid by card) is finished as usual. Resuming is joining again without an invitation: every check that joining
    makes, the host's offer as it is then, a new agreement, a card, a new month.
  - **Ended at once** (the host ends it, a block, a pause of an account, a suspension, a closed
    account, a dispute). In one step it is marked as ended, so that no payment and no booking can
    start any more, and the clean-up is written down as work to do: cancel the upcoming member
    calls, cancel an open payment or let its hold go, pay back the free money. The helper repeats
    that work until all of it is done. When something else causes the ending, the instruction to
    end is saved in the same database step as that action, so it cannot be lost between the two.
    Only a new invitation brings an ended membership back.
  - A payment that was cancelled at Stripe is never brought back to life; a new month always gets
    a new payment.
- `jobs.ts`: what the always-on helper does: invitations that have run out, renewals, new tries, reminders, closing months,
  pay-backs, endings, and finishing anything that was written down and not confirmed.
- `emails.ts`: invitation; joined (to both); the monthly receipt; payment failed; a pay-back; paused, with the reason (the member's own choice, the host's, no
  room, a payment given up); an invitation taken back or run out; a lower price from the next month; an offer of less time,
  and what became of it; ended (to both). The reminder before a month's end is written and timed
  by part three's `notifications/membership-reminders.ts`, which is added to the helper's
  reminder loop.

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

When the month's money is still only held, the order is: check everything about the booking,
write down the member's request and the taking, take the money at Stripe (in `charge.ts`), and
only then run the booking step, which checks everything again. If the money was taken and the
booking can then no longer be made, the month stays paid and the member is told (see "The awkward
cases"); if the app stops in between, the helper finishes the taking and the member books again.

It does not apply: the limits on waiting requests and the wait after a decline (nothing waits, and
the host invited this person), and the rules for free calls (a member call is a paid call with a
price, never a call for $0). It leaves "available now" alone. Because of the host's notice a
member booking cannot land on an instant request; the check script proves it.

**Changes to existing code**

- Open times (`bookings.ts`, `slots.ts`): member-only hours are left out for everyone else before
  hours are joined together; a host with only member-only hours has no times for a
  call later for the public ("call now" is not affected).
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
- Ending at once is called from: blocking (`safety/blocks.ts`, also when a report blocks), an
  account paused by the founder (`safety/reports.ts`), suspending a host (`booking/moderation.ts`,
  the admin's action), closing an account (`profiles/closing.ts`), the host's "End membership",
  and a dispute. Pausing a membership is called from: the end of a month whose renewal was
  stopped, "Cancel now", a payment given up after 7 days, the offer or the founder's switch being off when a renewal comes due, and no room in the host's
  hours at a renewal. (An account paused by the founder and a paused membership are two different things.)
- The host's price (`profiles/profiles.ts`): the checks under "Changing the offer", made in the
  same locked step that writes down and starts a monthly payment, so a month can never start at a
  price above the regular one. A month whose payment could still go through counts.
- `src/lib/health.ts`: also "not healthy" when a renewal, a month's closing, a pay-back or an
  ending is overdue, or a member call's money has stayed set aside too long after its call.
- `worker/closer.ts` runs the membership jobs.
- Pages: Hosting (the "Membership" part), the calendar page (the tick box, changing a
  stretch of hours in one go, and the step in which the host decides about her members before
  hours are cut), "People you have
  talked to" (invite), the host's page and the booking page (the member's view, also when the
  host's page is hidden), the invitation page and the "Pay now" page (new), "Your account" (memberships, their monthly receipts, and an offer of less time),  the page after a call ("paid from your membership"), and the admin page (the switch,
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
  card payment. A member call's payment never passes through the code for card holds; the
  monthly payment itself does use the app's way of holding and taking money, with a month as its
  owner.
- The monthly payment: the hold, taking the money, the tries, giving up; paying back; the end of a
  month, with expired money; disputes; the helper's recovery; the health check.
- Collecting, as far as a month needs it without any call: a host can collect expired money, a
  share on its way to a host cannot be paid back, and the earnings and admin lists show a payment
  that has no call.
- The ways a membership stops, as far as money goes. Stopping the renewal (by the member, or by the host with "Pause after this month") and switching
  back on.
  Pausing and resuming. Ending at once: no further charge, an open payment cancelled, free money
  paid back, and the instruction to end saved together with whatever causes it. "Cancel now",
  which lets a hold go.
- The rules that protect money wherever they are enforced: the terms a member agreed to, the price rule against the regular price, the rule that a month
  starts only when there is room for it in the host's weekly hours, and the membership's saved card
  being safe from the job that removes cards.
- The emails that report an event of this part, each written in the same step as its event.
  Among them is the monthly receipt, which reports the hold. (The list of receipts on "Your
  account" is part three.)
- A short list for the founder of months that went wrong, pay-backs that failed and months under
  dispute. (The full admin page is part three.)
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

- Member-only hours, booking as a member (with the month's money taken first when it is still
  only held), joining the call, settling it, cancelling, reviews,
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
  payment, cancelling, resuming, the member list, the list of monthly receipts on "Your account", the
  reminder, and the full admin page.
- Every remaining page, connected to what parts one and two built. It adds no money rule.

Done when:

- The whole journey passes in a browser, also at phone size, including a failed payment, a
  cancellation, and the founder's switch turned off while months are running.
- Merging this part does not turn anything on. The founder turns the switch on twice over: once
  for the friend test, for the one host who takes part, and for everyone only
  after the lawyer's and Stripe's points under "Before this can go live".

### How the parts connect

Each part's own plan (`plans/20`, `21` and `22`) says how it is built. This table is the one
place that says what each part hands to the next, by name. A part's plan may not rename or move
anything here without this table being changed first.

| Handed over | Built in | Used in |
| --- | --- | --- |
| The tables `membership_offers`, `memberships`, `membership_invitations`, `membership_agreements`, `membership_cards`, `booking_cards`, `membership_months`, `membership_refunds`; on `payments` the `kind`, `month_id` and `host_caused_cents`; a month as a second owner of money actions and of the money record; the switch's position `memberships` (`off`, `named`, `everyone`) and its list `memberships_hosts` (migration `0027_memberships`) | 1a | every later part |
| On a membership, `offer_stopped_at`: the host switched her membership off while this member's month was running, so the renewal is stopped until the member keeps it. A third mark beside the member's own stop and the host's pause (migration `0028_membership_offer_stop`) | 1b | every later part |
| `bookings.month_id`, `weekly_hours.members_only`, `call_extensions.paid_from` (migration `0029_member_calls`) | 2a | 2b, 3a, 3b |
| No database change | | 3a, 3b |
| `months.ts`: the month's lock, and the movements open, expire, owe a pay-back, a pay-back done, the dispute's state | 1a | 2a adds set aside, used and come back **to this same file** |
| `charge.ts`: `intentFor(month)`, `syncMonth(monthId, now)`, `takeNow(monthId)`, `payNow` | 1a | 2a (the first booking calls `takeNow`); 3b ("Pay now" calls `payNow`; only an action may call `intentFor`, and a page load reads the secret of a PaymentIntent the month already has; the card form then asks `syncMonth`) |
| `payback.ts`: owing a pay-back once under a `source_key` | 1a | 2a: `callreturn:<payment id>:<what>` for what a call gives back, and `giveback:<the refund form's id>` from `membership/give-back.ts` for time a host or the founder gives back |
| `room.ts`: the host's hours, room for someone new, who keeps their place | 1a | 1b, 3a (the numbers on the "Membership" part) |
| `room.ts`: working out what a cut in hours would need without saving it; saving is `changeWeeklyHours` in `booking/calendar.ts`. Like the preview in `offers.ts`, it returns a short mark of the state it was worked out from, which saving checks | 1b | 3a (the step for a cut in hours) |
| On a membership, `period` and `current_month_id`: only the current month of the current period may change the membership's state (the one exception is a dispute, which ends the pair's live membership whichever month it is about); an older month still settles its own money and must never be skipped by a job or left off a page | 1a | every later part |
| What "frozen" means: a month whose dispute is `open` or `lost`. Nothing of it is booked, used, given back, paid back or collected; `won` is not frozen | 1a | 2a, 2b, 3a |
| `cards.ts`: the lock on a card, the membership's card in use, the record of every card a membership ever had, and the rule that a booking's card is never a membership's | 1a | 2b (added time by card) |
| Ending at once and pausing, with the clean-up; **the one place in the clean-up that cancels a membership's upcoming member calls**, which does nothing in part one | 1a | 2a fills that place |
| Collecting from a month's charge: the host found through the month, the month's group on the transfer, a disputed month held back | 1a | 2a (a member call's share needs nothing more) |
| The guards that keep a payment that is not `card` out of the card code | 1a | 2a, 2b rely on them |
| `offers.ts` (saving the membership, **and working out what a change would do without saving it**), `join.ts` (inviting, taking back, "Join", resuming), `ending.ts` (the two stops and their undoing, "Cancel now", ending, the offer of less time), `changeWeeklyHours`, `wording.ts` (the sentences a member agrees to, and their version) | 1b | 3a and 3b: every button for managing a membership calls one of these and nothing else (paying is `charge.ts`, above) |
| The emails that report an event, with links to the pages below (`membership/emails.ts`) | 1a, 1b, 2a | the pages exist from 3a and 3b on |
| The reminder before a month's end: `notifications/membership-reminders.ts`, in the helper's reminder loop, under the key `month-reminder:<month id>` | 3b | |
| The booking stage `paying` for a member's first booking of a month: nothing reserved, continued by the same request key, ended by a job of its own after 30 minutes or when the month or membership can no longer be booked from, never touched by the card step's clean-up | 2a | 3b's journey |
| Booking as a member, the member's view of the host's page and of the booking page, the page after a call, the call screen's choices for more time, the "Members only" tick | 2a, 2b | 3b's journey walks through them |
| `access.ts`: who may see an invitation, a membership, a payment, a host's members; and the way a member or an invited person reaches a host whose page is hidden | 1b | 2a (the host's page and the booking page as a member sees them); 3a, 3b (before every page and in every action) |
| The check scripts `membership-check.ts`, `member-calls-check.ts`, `membership-journey-check.ts`, each making its members through the functions of the parts before it (but 1a's, which puts its test memberships straight into the database, since nothing that makes one exists yet) | 1a/1b, 2a/2b, 3b | each later part runs all the earlier ones unchanged |

**What a link or a form carries.** An invitation's link carries its `invite_id`, an offer of less
time its `offer_id`, and a "Join" or "Resume" form a `request_id` made when the page was drawn;
all three are part one's, and part three's pages only pass them on.

**The founder's switch in the check scripts.** Each script sets it (its position and its list) in the local database
for the journeys that start or renew a membership and off again at its end, and has a journey
of its own for what goes on working while it is off.

**The addresses of the new pages**, fixed here because emails written in part one link to pages
built in part three:

| Page | Address |
| --- | --- |
| The invitation, joining and resuming | `/h/<host's handle>/membership` (an invitation's link adds `?invite=<invite id>`) |
| One membership, for its member | `/memberships/<membership id>` (an offer of less time links here with `?offer=<offer id>`) |
| Paying after a failed payment | `/memberships/<membership id>/pay` |
| The address the card form asks after Stripe answered | `/api/memberships/<membership id>/sync` |
| The host's "Membership" part | `/host#membership` |
| The step for a cut in hours | `/host/calendar/cut` |
| The founder's page | `/admin/memberships` |

Until part three is built, those links lead nowhere, and only the check scripts receive such
emails.

### For every part

The existing twelve check scripts pass, with only the few lines 1a has to adjust in them (named
in plan 20) and with everything they test kept; later parts run them unchanged. The part's own
checks pass, both reviews are
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
- More than one offer per host, yearly memberships, free trials, gifts.

- Carrying unused time into the next month.
- Inviting someone who has never had a call with the host.
- Moving a member's booking to another time (as for all bookings: cancel and book again).
- A higher price or more time for people who are already members. A member gets those by a new
  invitation after the host ended their membership, or by resuming after a pause.
- Any change of price for a month that is already running.

## How it will be checked

- **Tests for the rules:** the limits; when a month ends (31 January, a leap year, a clock
  change); what a booking sets aside at awkward prices (at $5.00 per 15 minutes a 5-minute call
  sets aside $1.66, six of them leave 4 cents, and those 4 cents expire); that a member can
  always book every minute they are shown; which money a booking takes first; the split of a
  month's free money; the days a failed payment is tried again.
- **One rule checked after every step of every journey:** the six places of each month add up to
  exactly what was paid.
- **New scripts against Stripe's test area.** The journeys below are one list for the whole
  feature. They are shared out among three scripts, each part's plan saying which are its own:
  `membership-check.ts` (part one), `member-calls-check.ts` (part two) and
  `membership-journey-check.ts` (part three). Journeys for:
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
  - "Cancel now" while the money is only held (the hold is let go, nothing is charged, no fee,
    the membership paused); a second before and a second after 72 hours; the money taken at
    72 hours and 3 minutes; after a renewal and after a month paid late; pressed twice; pressed at
    the same moment as a first booking, as the taking and as the host ending the membership (one
    outcome each time);
  - a first booking that takes the money and then books; one where the time is lost between the
    two (the month stays paid, the member is told); a hold that Stripe reports as shorter than
    usual (taken 12 hours before its end, "Cancel now" shown until then); "Cancel now" in the
    3 minutes after the 72 hours (accepted); a timed taking that runs twice; a different amount
    reported by Stripe (no time given, the founder is shown it);
  - room: an offer that does not fit once (refused); invitations up to the last place and one
    more (refused); an invitation holding its place; five members at 2 hours with a host who
    then wants to offer 2 hours (the cut is refused until her pauses and smaller times add up to no more than 2 hours; she can
    keep any one of the five, not only the oldest); the host choosing with "Pause after
    this month" and undoing it; a member who cannot undo the host's
    pause; joining and resuming without room (refused); two people joining for the last place
    at the same moment (one gets it); a paused member resuming when a place frees up; months
    that have started untouched by any cut; members with different times: room for 4 hours, an
    older member at 6 and a newer one at 2, renewing in both orders (the newer one stays each
    time); two members at 2 hours, room for 2, the host pausing the older one (the newer one
    renews); a cut that takes back an open invitation; a changed offer that takes back open
    invitations; two people resuming for one place at the same moment; hours cut while a payment
    is at Stripe (the hold is let go); hours added back before a renewal (her saved pauses stay until she undoes them; the safety net
    pauses nobody); all
    weekly hours removed; two overlapping stretches on one day counted once; the host stops a
    renewal, the member cancels too, the host undoes theirs (still stopped); the host switching the offer off with one month only
    held and one payment being tried again;
  - a member resuming twice, with each month showing the agreement it was started under; a card
    kept after pausing while added time by card from an earlier call is still open;
  - a first booking that takes the money and then books (the plain case); one where Stripe refuses the taking and
    one where its answer does not arrive (nothing booked); a hold the bank let go early;
  - a paused member: books only like any customer; resumes at a changed offer with a new
    agreement; cannot resume with the offer off, the founder's switch off or a block; is ended by
    the host while paused; a failed payment given up after 7 days (paused, not ended);
  - switching back on with a block, a paused account, a host no longer approved, and in the
    same moment as the month's end; the host ending a membership with a call still
    booked, and with a call under way; a block; a pause; a closed account while a renewal goes
    through; the offer switched off and on again; the founder's switch off with months running;
  - a changed membership: the price lowered (members pay less from their next month, the running
    month unchanged, their time unchanged), raised (members keep theirs, a new member pays more),
    lowered and raised again (members stay at the lowest), the time changed (only new members);
    what the host is shown before saving; open invitations taken back;
  - an invitation accepted after 23 hours, and one that runs out at 24 (its place free again,
    inviting again);
  - less time: offered and accepted (the smaller time and lower amount from the next month, at
    the member's own price, the running month unchanged, a new agreement on record); "No thanks";
    no answer by the month's end (paused); the host taking the offer back; accepted at the same moment as the month ends, as the host
    takes it back, and as the member cancels (one outcome each time); an open offer counted with
    the smaller time by the safety net; a member whose payment is being tried (no offer possible);
    a held month with an open offer that loses its hold (paused, nothing tried); a second cut
    with an offer still open (left or paused, no second offer); an old email button after the
    offer was taken back (says it is no longer open); accepting after the price was lowered (the
    lower price);
  - a price lowered, then raised again before a member's renewal (the member renews at the lowest);
    lowered while a renewal's payment is being tried (that month keeps its price, the next one is
    lower); a member with a stopped renewal who switches back on after a lowering (the lower
    price); the cancel page naming what pausing gives up;
  - an invitation: "Join" pressed at 23 hours 59 minutes with the hold arriving after 24 (joined);
    the card step left unfinished (undone, place freed, a late hold let go); a fourth invitation
    to one person in 30 days (refused); an old link after inviting again (does not work);
  - a stretch of hours moved to another time in one go (no cut, no step); a member who stopped
    their own renewal switching back on without room (refused);
  - cutting hours: the page refusing to save until the ticked members make room; the newest
    ticked first; the host changing the ticks; an invitation named and taken back; undoing a
    choice when there is room again; the regular price set below the
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
  month, including a real renewal on a real card, with the founder's switch on for that one host only. The
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
   rule is now one: back to the month while it runs, to the card after (later made exact: also
   to the card once a membership was ended early, and nowhere while a dispute freezes the month). It also promised refunds
   the app cannot make after a host has collected; that limit is now stated. A dispute is kept on
   the month, so it also covers a month with no calls yet.
4. **Never charged twice.** The draft wrote a month down only once it was paid. It is now written
   down before the first try, with one payment at Stripe that every try uses; a payment still open
   when the membership ends is cancelled; a month starts when Stripe says it was paid (since changed: when the hold is in place, see "The
   founder's later decisions"); and how a month's end date is worked out is said (31 January,
   28 February, 28 March).
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

Taken from its list of cuts: the warning to hosts about promising too much time (since replaced
by the founder's rule that members' time must fit in the host's hours), and any change to a
running month. Kept, on its advice: the month-end rules, disputes kept on the month, pay-backs
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
existing members, no "Agree" step; since changed by the founder: a price that only goes down, and
an offer of less time that the member accepts), a cancelled membership cannot be switched back on (a new
invitation instead; since reversed by the founder, who also added pausing), and no notices on the home page (the emails and "Your account" do that job).
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
  changed terms for people who are already members. All three stay as recommended. (The third was
  later replaced by the founder's rule of a price that only goes down.)
- **Changed:** no limit on the monthly amount (the plan had $2,000); a higher limit on the time
  included than 20 hours (the builder chose 100 hours a month); and a cancelled membership can be
  switched back on, which Astra had advised leaving out and the builder had cut.
- **Added:** a member who cancels within 3 days of a monthly payment, with nothing booked from
  that month, can have the month back in full (since replaced by the hold: nothing is taken in
  the first 72 hours, so nothing has to be paid back). The founder had first asked whether a member who
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
   cost of one such pay-back is written out, up to the largest possible month. (Superseded: with a
   hold there is no pay-back and no limit; see "The founder's later decisions".)
3. **Switching back on** now lists what it checks, charges nothing, and shows the amount and the
   next payment date.
4. **Things that can happen at the same moment** (cancelling, switching back on, a renewal, an
   ending) now take one lock on the membership, and a payment cancelled at Stripe is never
   revived.
5. **"3 days"** is now exact: less than 72 hours after Stripe says the payment went through, for
   every month, checked inside the locked step. (Superseded in its details by the hold; see "The
   founder's later decisions".)

Also taken: a disputed month can cost Connect the whole of each disputed charge, and a member can
dispute more than one; Stripe is asked about large charges before going live; the friend test
comes before the public launch.

## The founder's later decisions (17 November 2026)

- **A hold first.** The founder pointed out that letting a card hold go costs nothing, while the
  plan took the month's money at once and would have paid a card fee on every "Cancel now". The
  month's amount is now held for the first 72 hours and taken at the first booking or after 72
  hours and 3 minutes. The founder asked for a cushion; the 3 minutes are the app's existing one.
- **Pausing.** The founder's rule: when the host ends a membership, the person is no longer a
  member; when the member stops, for example because money is short, the membership is paused and
  they can come back by themselves. So a membership that the member cancelled, or whose payment
  was given up, is paused and not ended.
- **Left to the builder:** "Cancel now" is no longer limited to once per member and host, since it
  costs nothing now.
- **Confirmed:** while a payment has failed the member cannot book as a member, and is told at
  once.
- **More time than the host offers.** The founder asked what happens when a host offers 100 hours
  to a member and their calendar does not hold 100 hours in a month. That is now refused: the time
  included can never be more than the host's weekly hours offer in four weeks (a lower price can
  always be saved, see "Changing the membership"), checked when the
  offer is saved and whenever a month is about to start.
- **Room is counted for all members together.** The founder's example: five members at 2 hours
  each, and a host with 2 hours a month. Comparing each member alone with the host's hours would
  have allowed that. The time of all members together now has to fit in the host's weekly hours.
  The builder had argued for counting each member alone, since members seldom use all their time;
  the founder's point was stronger, because unused time expires and the host would be paid for
  time nobody could book. When hours are cut, the host can choose who is paused, as the founder
  suggested, and otherwise the longest-standing members keep their place. (Since made the main
  way: she chooses in the same step as the cut.)
- **One standard membership, and a price that only goes down.** The founder's rule for a changed
  membership: new invitations get the new price; people who are already members keep their own
  price when the new one is higher, and get the new one when it is lower; and the host is told
  before she saves. The plan had every member keep the price they joined with, whichever way the
  host moved it.
- **An invitation lasts 24 hours.** The plan had no end for an invitation.
- **The host chooses who is paused.** The plan let her choose and otherwise used a rule; the
  founder asked why she does not simply choose. She now does, in the same step as cutting her
  hours, with the newest members ticked to start with. The rule stays only as a safety net.
- **The host is told which invitations a cut in hours takes back**, before she saves.
- **Less time instead of a pause.** The founder asked whether a host who cuts her hours could
  offer particular members a smaller time at their old price, instead of pausing them. She can:
  it is the third choice in that step, and the member accepts or says no.

## Astra's check of the hold and of pausing (17 November 2026)

Verdict: **ready with changes**. It confirmed that letting a hold go carries no card fee, that
the app already places holds on saved cards in the background for calls, and that the price rule
and the checks for resuming hold. Its points, all worked in above:

1. **A hold that is gone cannot be tried again on the same payment.** That month is closed as not
   paid and a new month with the same terms gets its own payment.
2. **"Paused, nothing owed" was too strong.** Calls being settled, pay-backs and added time by
   card from earlier months are still finished, and the card is removed only when nothing needs
   it.
3. **The money can be taken and the booking still fail.** The order is now written out, and what
   the member is told when the time was lost in between.
4. **Times count from the bank's time for the hold**, the hold's real end is stored, and the
   "almost a day" of room is stated as it is (23 hours 57 minutes).
5. **One cut-off for "Cancel now":** accepted until the money is really taken. Cancelling the
   normal way never takes money by itself.
6. **What a member agreed to is kept for every joining and resuming**, not overwritten.
7. **Switching the offer off** leaves a month that is only held to go on, and pauses at once a
   membership whose payment was being tried again.
8. **The states of a month are spelled out**, and no money is put in any of the six places, or
   set aside for a call, before the whole amount is confirmed taken. (A month that is only held
   does give its time to book; the first booking takes the money.)
9. **"Costs nothing" was too absolute.** There is no card fee, but a bank may show a hold like a
   charge for days, and Stripe's optional checks can cost a few cents.

## Astra's check of the rule on room (17 November 2026)

Verdict: **ready with changes**. It advised keeping the count as it is: all weekly hours, times
four, with open invitations counted. Its points, all worked in above:

1. **Who keeps their place must not depend on whose renewal comes first.** It is now one
   calculation, from the longest-standing member to the newest, in which only a member who fits
   uses room.
2. **What is already owed and who gets a next month are two questions.** Months that have started
   always go on, so for a while a host can owe more than the hours hold. Invitations give way
   before members.
3. **One lock for everything that touches room**, the host's calendar lock, so the last place
   cannot be given twice and not during a cut in hours. A hold that comes back after the hours
   were cut is let go.
4. **The member's stop and the host's stop are kept apart**, and each side undoes only its own.
5. **An invitation is for one version of the offer** and is taken back when the offer changes.
   Members are counted with their own agreed time.
6. **How weekly hours are added up** is now exact: overlapping stretches once, by the clock, no
   calendar meaning no room.

## Astra's check of the changed membership, invitations and the host's choice (17 November 2026)

Verdict: **ready with changes**. Its points, all worked in above:

1. **A lowered price must not vanish** when the host raises it again before a member's renewal.
   The member's own price is now lowered at once and for good each time the host saves a lower
   one; months already written down keep their price.
2. **Switching a renewal back on could undo the host's choice.** It now needs room for that
   member's next month, and the safety net never goes against what the host saved.
3. **An invitation running out while someone is paying** has one winner: "Join" pressed in time
   keeps the place for the card step; after that the joining is undone and a late hold let go.
4. **A cut in hours has two totals:** what members need for their next months, which the host's
   choices must fit, and what she still owes this month, which stays.
5. **Moving hours** is now one change, not a removal and an addition, so it cannot count as a cut.
6. **The agreement a member ticks** now says that the amount can go down with the host's price.
7. **The regular price** follows a lowered member price only when the months written down at the
   old price have ended; a lower member price can always be saved.
8. **Members are told what pausing gives up** before they cancel, and the host's preview says
   which number is what members pay and which is what she earns.
9. **Inviting again:** one invitation per person at a time, the old link dead, at most 3 in
   30 days, and no extra time for an ID check.

## Astra's check of the offer of less time (17 November 2026)

Verdict: **ready with changes**. It found all nine of its earlier points resolved, one of them
only once this rule was complete. Its points on the new rule, all worked in above:

1. **An open offer counts with the smaller time** for the member's next month, also in the safety
   net, and frees that room when it is refused, runs out or is taken back.
2. **One rule for accepting, the renewal and the stops:** an offer is settled before the next
   month is written down; unanswered means paused, with nothing held; accepting never clears the
   member's own cancellation.
3. **Only a member whose month has started** can be offered less time. One whose payment is still
   being tried is kept or paused.
4. **One open offer per member.** A later cut can leave it or pause the member, not add a second.
5. **The member is told what lasts:** the smaller time stays even if the host adds hours again,
   with the amount, the month it starts and the exact time to answer by.
6. **The reminder** no longer promises a payment to someone who is about to be paused.

Taken from its two optional cuts: one offer at a time, and the email's button opening the same
page as "Your account", so there is one way to accept.

## Astra's check of how the parts connect (18 November 2026)

Astra read this rulebook and the three part plans side by side, for hand-overs only. Verdict:
**sound with changes**. It found no function a later part needs and an earlier one does not
build, no job that needs a later database change, no page a real person could reach that leads
nowhere while the switch is off, and no money a later pull request has to repair. Its points,
all worked in, were places where two documents said slightly different things: when a payment's
outcome may still be read; what "frozen" means; what the founder's switch stops; when the switch
is on for the friend test; which script holds which journeys; and which emails are written in
which part. The builder's own name-by-name read before it had found six more, also fixed: the
wording, the "who may see what" check and the two previews belong in part one; the check scripts
need the switch on locally; the "Members only" tick reaches the hours function in part two; and
part three names what it calls.

## CodeRabbit's review of the plans (pull request 33, 18 November 2026)

Seven comments. Each was checked against the four documents and the code. All seven held up and
all were taken, each as a small change:

1. **The sentences a member agrees to** said the amount is "only held for the first 72 hours".
   That is not so once the member books. They now say when the money is taken.
2. **A membership ended after its month had already ended** (plan 20) would have had that
   month's ordinary unused money paid back instead of expiring, if the closing job ran late.
   Paying back now needs the ending to be earlier than the month's end.
3. **A dispute over an old month** met two rules that disagreed: "a dispute ends the membership"
   and "only the current month changes a membership". The rulebook now says which wins.
4. **Booking with a hidden host** (plan 21) would have failed: today's reader of what a host
   offers refuses a hidden host. A member's booking now has its own way to read it.
5. **Extra time** (plan 21) could have been taken from the membership when the screen had shown
   "by card". What is done is now always what was shown, in both directions.
6. **The reminder** (plan 22) could still announce a payment after the renewal was stopped in
   the moment before it was sent. It is looked at again when it is sent.
7. **"Only the two friends"** during the friend test had no way to be enforced: the switch was
   on or off for everyone. It now has a middle position, for the hosts the founder names.
