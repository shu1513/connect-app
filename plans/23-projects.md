# Plan 23: Projects

**Status:** a plan only; nothing is built. Written 18 November 2026. Astra did its own research
and checked the plan against the code once. Its verdict was "not ready as written"; every point is
worked in below, and the list is at the end. After that check the founder decided four things (a
hold for three days before the money is taken; the wait for large amounts, counted per
contributor; the open-source checker stays; a daily limit on pictures), and Astra checked the
plan a second time. Its second verdict was "ready with changes"; those changes are worked in too
(the second list is at the end). The three part plans are written and checked by Astra:
plans 24, 25 and 26. Where they made a rule clearer, the rule was added here.

**Its size, said plainly:** about two modules of work. The money part is smaller than memberships,
because a contribution buys nothing: there is no talk time to count, set aside, give back or
expire. But it is not free: a contribution is a new kind of money in Connect's books, with its own
monthly charge. The other new ground is pictures. Connect has never stored a picture before.

## What this is, and why

The founder's idea: a host can run one **project**, in the way people do on Patreon. The project
is anything the host is working on. She tells its story in a **diary**: short posts with text,
pictures and links to YouTube. A customer can **contribute** to it, once or every month. After a
call that went well, the customer is shown the host's project and asked whether they would like to
contribute.

What each side gets:

- **The host:** income that does not depend on her calendar, and a way to keep the people she has
  talked to interested in what she does.
- **The contributor:** a way to support someone they like, and a diary to follow.

A contribution supports the host's project. It does not buy a call, member-only times or any
promised reward. That is the difference from a membership, and the pages say it plainly.

## What the founder decided

| Question | Decided |
| --- | --- |
| How many projects | One per host at a time. The host starts it and ends it. After ending one she can start another. |
| What a project holds | A name, a short description, and a diary of posts. A post has text, pictures and links to YouTube. |
| The two ways to contribute | Once, or every month. |
| When the customer is asked | After a call with the host has finished. |
| Who is not asked | Someone who already contributes to that project. |
| Who may contribute | Anyone with an account. A call with the host is not needed. (GoFundMe and Patreon let anyone give; the founder asked for limits that are not too strict.) |
| The smallest contribution | $5, once or monthly. |
| The largest contribution | $100,000 in one charge, once or monthly. It is the limit GoFundMe uses for a card. |
| First a hold, then the money | A contribution is first only held on the card, for three days, and taken after that (the founder, 18 November 2026, after Astra's check). Until it is taken it can be let go at no cost to anyone: by the contributor, by the host, or by the founder. (A bank can make the time shorter for a card; the contributor is always shown the real last moment.) Once money has been taken, giving it back is a refund, and Stripe keeps its own charge on a refund (about 2.9% plus 30 cents, which is $2,900 on $100,000). Three days and not four, because a card's hold can end after four and the money must be taken safely before that; memberships use the same three days. |
| Pictures are checked automatically | Every picture is checked before anyone else can see it. |
| A picture a checker flags is refused | Decided 18 November 2026, during the build of part one. It is not kept for the founder to decide: it is refused at once and deleted (kept unseen a little longer only while the child-safety tool, once switched on, still has to look at it), the host is told why, and when she uploads a picture whose copy comes out the same again (Connect's own JPEG copy is compared, byte for byte), it is refused at once. There is no list for the founder and no button to appeal; a host who thinks it was a mistake uploads another picture or writes to support. (Before this decision a flagged picture waited, hidden, for the founder's "Show" or "Remove".) |
| The child-safety tool stays | Asked again on 18 November 2026 whether it is needed in an app for adults, the founder kept it, because it is free: it is applied for and switched on when it is approved, as decided before. |
| Pictures do not wait for the child-safety tool | Decided 18 November 2026, after Astra's second check. Pictures go live with the checking queue. The tool against known pictures of child abuse is applied for and switched on when it is approved; nothing waits for that. The founder's reasons: every host has passed an ID check, has a confirmed social media account and was approved by the founder; the diary is public, under her own name; and the checkers look for sexual pictures of any kind. What stays, because the law asks for it: "Remove and report". |
| The order of the checkers | A queue. First OpenAI's free checking service. When it is used up or cannot be reached, Microsoft's. Then Sightengine's. Last, an open-source checker that runs on Connect's own server, so that a picture is not stuck when the three services are out. Astra advised leaving the last one out; the founder decided to keep it (18 November 2026), see below. |
| A daily limit on pictures | Yes (the founder's idea; the number, 20 a day for each host, is the builder's). |

## Two questions Astra's check raised, and the founder's answers

**1. The open-source checker at the end of the queue: it stays.** The three services each look
for nudity, for violence and gore, and for self-harm. The open-source checker (NSFWJS) only looks
for nudity. So a picture it passes has not been checked for violence. Astra called showing such a
picture the plan's second most serious fault and advised leaving the checker out, so that a
picture would wait whenever the three services are all out. The builder agreed. The founder
decided to keep it: a host's picture should not be stuck because three outside services are down
or used up. What that means, said plainly: in that rare case a picture is shown after a nudity
check alone, and gets its full check as soon as one of the three answers. "Pictures" below says
how this is kept as small as it can be.

**2. Large amounts: a longer wait, counted per contributor.** With a ceiling of $100,000, the seven days before a host can collect are
not enough by themselves. A bank can take a card payment back for about 120 days, and when that
happens after the host has collected, Connect pays. The rule (choice D below): seven days for
ordinary amounts, 30 days once **one person** has given a host more than $1,000 within 30 days,
and a way for the founder to hold a contribution back longer or release it sooner. No wait removes
the risk; it only makes it smaller.

The count is for each contributor, not for the host as a whole (the founder's point, 18 November
2026): a host with many small contributors passes $1,000 easily and has done nothing unusual.
Astra had proposed counting per host, which also catches one person paying from several accounts.
That case is left to the founder's hold button; the admin page shows what each host has received.

(This wait is not the card hold. The hold comes first: it only sets money aside on the card, and
lasts a few days. The wait starts when the money has been taken: the money is then with Connect,
and stays there until the host may collect it, as a call's money does today.)

## Choices the builder recommends

Each is built as written here unless the founder says otherwise.

| # | Question | Recommended | Why |
| --- | --- | --- | --- |
| A | Who can read the diary | Everyone, signed in or not. | The diary then also shows visitors who the host is, and a contribution stays plain support: nobody pays to unlock something. |
| B | Who picks the amount | The host sets up to three suggested amounts for each kind (once, monthly). The contributor picks one or types their own. | What Patreon and GoFundMe do. |
| D | When the host can collect | Seven days after the money has really been taken. Once one person's contributions to a host add up to more than $1,000 within 30 days, that person's contributions to her wait 30 days, each from its own taking ("How the $1,000 is counted" below). On the admin page the founder can hold any contribution back, or release it sooner, with a reason that is kept. | See the second question above. GoFundMe and Patreon also hold money for about five days and look at new or large payouts by hand. The count is per contributor and host, so one person cannot split a large amount into small ones to get round it, and a host with many small contributors is not slowed down. |
| E | Emails about new diary posts | None in the first version. | Fewer emails, and nothing new to unsubscribe from. Easy to add when hosts ask. |
| F | On or off at the start | On for every host, with a founder's switch that turns it off, or limits it to named hosts. While it is off for a host she cannot start a project, write or change a post, or upload a picture; what she has written stays readable; she can still remove a post or a picture and end her project; and the founder can still decide, hide and lock. (What it means for money is under "What ends a monthly contribution".) | The same as the founder chose for memberships. The founder hides a post or a picture with one click when that is what is wanted. |
| G | What a report does | It goes to the founder, who hides the post or picture with one click. A report does not hide anything by itself. Reports for the urgent reasons (someone under 18, threats) email the founder at once, as they do today. | If one report hid a post at once, anyone could switch off a host's diary by reporting every new post. Every picture has already passed the automatic check, so a report is the second net, not the first. |

## How it works for a host

**Starting.** On the Hosting page there is a new part, "Your project". A host whose page is
approved and whose payout account is ready can start one. She gives it:

- a name (up to 80 characters);
- a short description (up to 1,000 characters);
- her suggested amounts, once and monthly (choice B). She can leave the monthly ones empty if she
  only wants contributions made once, or the other way round.

**The diary.** She writes a post: text (up to 5,000 characters), up to four pictures, and up to
three YouTube links. She can edit a post and remove it. A new or changed picture is not shown to
anyone else until it has been checked (see "Pictures"). Web addresses in the text are shown as
plain text; only the YouTube links she adds in their own boxes can be clicked.

**Her contributors.** The same part shows who contributes: the person's name, once or monthly, the
amount, and since when. It also shows the total she has received and what is ready to collect.

**Collecting.** A contribution's share appears with her other earnings and is collected with the
same "Collect earnings" button, when its wait is over (choice D).

**Refunding.** The host decides refunds, as everywhere on Connect. She can give a contribution
back, in full or in part, until its share has been sent to her; our fee goes back in the same
proportion. After that only the founder can refund it. A refund does not stop a monthly
contribution; only the things under "What ends a monthly contribution" do.

**Ending.** "End this project" stops every monthly contribution at once, so nobody is charged
again. Payments that are still only held, monthly ones and ones made once, are let go. Money that
has already been taken is not returned by this; a host who wants to give it back uses the refund
button. The contributors are told by email. The diary stays readable at its address, marked
"This project has ended", and takes no contributions. Only her current project is shown on her
page. Money already paid stays with the project and the host it was paid to.

## How it works for a contributor

**Finding it.** The host's page shows her project: its name, the latest post, and a link to the
whole diary. The diary has its own page with a "Contribute" part.

**After a call.** The customer's results page of a call shows a box: "*Name* is working on
*project*", with a few lines of the description and a link to it. It is a box on the page, not a
pop-up, so there is nothing to click away. It is shown only when all of this is true, judged from
the call's final record:

- the call took place: it was not cancelled, and both were in the room together for some time;
- it was not ended with "End call and report", and neither has reported or blocked the other;
- the customer has not asked for a refund of that call;
- the host has a project that is running;
- the customer does not already contribute to it, monthly or once. Someone who gave before,
  stopped, or was refunded is not asked again for the same project either; the project's own
  page still lets them contribute;
- the customer could contribute right now (see plan 25: nobody paused, the switch on for her).

**Contributing once.** The contributor picks or types an amount and pays by card on Stripe's form.
The amount is held on the card at once and taken three days later. The page says before they pay:
what they pay; that it is first held, normally for three days, in which they can cancel it and pay
nothing; that
it supports the host's project and does not buy a call or any promised reward; that it is not a
donation to a charity and gives no charitable tax deduction; and that after the three days
refunds are the host's decision.

**Cancelling while it is held.** "Your account" shows a held contribution with its real last
moment and "Cancel, nothing is charged". The hold is let go. The server accepts it until the money
has really been taken, so a press in the last second still counts. In the rare case that the money
was being taken at that very moment and went through, the contributor gets all of it back as a
refund; the page only says "nothing was charged" once that is known.

**The email for each payment.** When a hold is in place, for a contribution made once and for
every monthly payment, the contributor gets one email: Connect, the project, the amount, the day
and time the money is taken, and a link to cancel before then. It is the receipt as well; no second
email is sent when the money is taken.

**Contributing monthly.** The same, plus what the law and the card companies ask for when a card
is charged again and again:

- beside the button: the amount, "every month", that each payment is first held and taken three
  days later, starting with a hold today, how to cancel, and the refund rule;
- a box they must tick: "I agree that Connect holds $X on my card today and every month, and
  takes it three days later each time, until I cancel";
- what they agreed to, word for word, with the amount and the moment, is kept on record, as it is
  for a membership;
- an email at once that confirms the agreement and says how to cancel;
- the email for each payment, described above.

That email reaches the contributor before each month's money is taken: normally three days
before, and less when a bank has made that card's hold shorter. The email always states the real
moment. No other reminder is sent. Where the law asks for a yearly reminder, these emails are
written to count as it; the lawyer confirms the wording, with the shorter notice for such a card
in mind, or says that a separate yearly email is needed.

**When the monthly payment is made.** The day the first hold succeeded is the contribution's day
of the month. Each later hold is placed on that day; in a shorter month on the last day, and the
month after it goes back to the usual day (31 January, 28 February, 31 March). Every date is
counted from that first day, not with the membership rule, which would stay on the 28th. A try
that succeeds late does not move the day. The money of each month is taken three days after that
month's hold.

**Cancelling.** "Your account" lists the projects a person supports, with a "Stop contributing"
button. It takes effect at once, whatever else is going on: no further month is ever held or
taken. A month's payment that is still only held is let go, so stopping before it is taken costs
nothing for that month. Money that has been taken is not returned. Stopping works also while the
founder's switch is off.

Letting one payment go is not the same as stopping. When the host or the founder lets a month's
hold go, that month is skipped and the contribution goes on next month. Only the things under
"What ends a monthly contribution" end it.

**A monthly payment that fails.** The contributor gets an email with a link to pay. Connect tries
the card again after 1, 3 and 5 days (the days memberships use), unless the bank said not to try
again or the card is gone. After 7 days without a hold in place, the monthly contribution is
stopped and they are told. Nothing is owed: a month that was not paid is simply not paid, and is
never charged later. When the bank wants the contributor to confirm, the payment is not held yet;
the link opens that same payment, and the three days start when the hold is in place.

**Changing the amount.** Not in the first version. They stop and start again with the new amount.

## What ends a monthly contribution

- The contributor stops it.
- The host ends the project.
- No hold could be placed for 7 days, the bank said not to try again, or the saved card is gone.
- Either blocks the other, or either account is paused, suspended or closed.
- The contributor's bank disputes one of its charges. Winning the dispute later does not start it
  again.

Whenever a monthly contribution ends, its payment that is still only held is let go. The same
goes for a contribution made once that is still held when the host ends the project, when either
blocks the other, or when either account is paused, suspended or closed. Money already taken
follows the rules for refunds and collecting.

The founder's switch does not end anything. While it is off, or the host is not named, no new
contributions are taken, no monthly hold is placed, and payments that are only held are let go.
When it is on again, monthly contributions go on from their next usual day. A month that passed
meanwhile, or whose hold was let go, is never charged afterwards, and no old try is picked up
again.

## The money

- **Our fee** is the usual one, on every charge: 4.9% plus 30 cents, plus 1.5% for a card from
  outside the US. On a $5 contribution the host gets $4.45; on $20, $18.72.
- **First a hold, then the money.** Every payment of a contribution, the one made once and each
  monthly one, is held on the card and taken three days and three minutes later, counted from the
  bank's own time for the hold, as a membership's month is. When Stripe reports that a card's hold
  ends sooner, the money is taken 12 hours before the hold ends, and that earlier moment is what
  the contributor is shown. The time a hold lasts is always Stripe's own answer for that card,
  never a guess. Until the money is taken the contributor, the host or the founder can let the
  hold go, which costs nothing.
- **A hold that is lost.** A hold the bank lets go by itself, or one whose safe moment was missed
  because the helper was down (the last safe moment is one hour before the hold ends), ends that
  one payment for good. It is never taken late, and no new
  hold is placed for it. A monthly contribution goes on with its next month. (A membership is
  different here: it places a new hold, because the member is owed their talk time.)
- **A very large hold** is one payment like any other. If the bank refuses it, it is refused;
  Connect never splits it into smaller ones.
- **The waits before collecting** (choice D) are counted from the moment Connect has Stripe's
  answer that the money was taken, never from the hold or from the moment it was due. (Stripe
  keeps no time of its own for a taking; Connect's moment is the real one or a little later.)
- **At Stripe** it works as a call's payment does: Connect holds and then charges the card, and the host's share
  is sent to her Stripe account when she collects. That also means Connect, not the host, answers
  for a refund or a dispute.
- **In Connect's books** a contribution is built in the two layers a membership has. Each payment
  of a contribution has a record of its own, which owns everything at Stripe: the hold, the
  taking, letting go, refunds, a dispute. When the money is taken, the host's share is written as
  one line among her earnings, under that record, the way a membership's money reaches her today.
  (The first draft wanted to write a whole contribution as one more kind of call payment. Astra
  showed that does not work: the code that holds, charges and refunds a card through such a line
  only accepts a call's card payment. Plan 25 says why the share's line is still the right place
  for the host's share, and what it holds.)
- **What is shared, not built twice:** the fee calculation, the rule that every step at Stripe is
  written down first, the ledger, and "Collect earnings", which keeps working on the lines of
  earnings it knows. Plan 25 names each place that is widened. No second payment system is built.
- **One charge per month, never two.** Each monthly charge exists once in the books, named by its
  agreement and its month, before Stripe is asked. After an interruption the same request is sent
  again under the same label, or Stripe is asked what happened. When the bank wants the
  contributor to confirm, the link in the email opens that same payment; it never makes a new one.
- **Stopping while a payment is under way.** A payment whose outcome is not known is asked of
  Stripe first. A hold that arrived after the contributor stopped is let go.
- **A refund and a collection** of the same share never run at the same moment and never spend
  the same money: they wait for each other, as they do for a call. (After a share has been
  collected, only the founder can still refund the contribution.)

**How the $1,000 is counted (choice D).**

- **Whose money:** one contributor's account paying one host, over all her projects, once and
  monthly together, whichever card. Stopping and starting again does not reset the count.
- **Which amount:** what the contributor pays, before our fee.
- **What counts:** everything taken in the last 30 days, also what has been collected or refunded
  since, plus every hold that is in place now, each payment once. A hold that was let go or failed
  no longer counts once that is certain.
- **The line:** more than $1,000. Exactly $1,000 does not cross it.
- **Who waits 30 days:** the payment that crosses the line, that person's earlier payments to her
  that have not been collected yet, and their later ones while the count is over the line. Each
  waits 30 days from its own taking. Money already sent to the host is not touched. A share
  whose sending was already accepted when the line was crossed counts as sent; if Stripe then
  refuses that sending, the share waits the 30 days after all.
- **It never gets shorter by itself.** A payment that got the 30 days keeps them. Only the founder
  can release it sooner.
- **It is counted at three moments:** when a hold is accepted, when the money is taken, and when
  the host collects. Two payments arriving at the same moment are counted one after the other, so
  they cannot both slip under the line.
- **The founder's release** shortens a wait, or lifts a hold the founder set. It never overrides a
  bank dispute, a refund or a sending that is under way, or money that has not been taken.
- **A bank dispute** holds that charge's share back while it is open or lost, and ends the monthly
  contribution.
- **A closed host account** takes no more contributions. What was already paid and is owed to her
  stays owed, and the founder can send it, as for a call today.
- **A saved card** kept for a monthly contribution is never removed by another part of the app
  while that contribution runs, and is removed when it ends.

## Pictures

**What a host can upload.** JPEG, PNG or WebP, up to 10 MB each, up to four in a post, and up to
20 pictures a day. A picture she uploads and then removes or replaces, or one that is flagged,
still counts for that day, so the limit cannot be got round. Uploads sent at the same moment are
counted one after the other. A picture that moves (an animation) is refused.

**What Connect does with a picture.** It never keeps the file as it arrived. It makes its own copy:
turned the right way up, no wider or taller than 1,600 pixels, at most 1 MB, with everything
hidden in the file removed. That matters because a phone writes the place a photo was taken into
the file. Only Connect's copy is stored, checked and shown.

**Where pictures are kept.** In Connect's own database in the first version, in a table of their
own, so that no new service has to be chosen before the hosting is. Astra agrees this is sound for
a small start. Moving them to a file store later is real work (copying, checking, switching over),
so the code that reads and writes pictures is kept in one place from the start.

**What a full check is.** A check for all three of these:

- nudity and sexual pictures;
- violence and gore;
- self-harm.

A picture is shown to others when it has passed a full check, or the founder has approved it, or
(the one exception, the founder's decision) when none of the three services could answer and
Connect's own checker found no nudity.

**The queue.**

1. **OpenAI's checking service.** Free. On the free level it takes 250 pictures a minute and
   5,000 a day.
2. **Microsoft's (Azure Content Safety).** 5,000 pictures free each month on its free level, which
   stops at the limit and does not bill.
3. **Sightengine.** Its free plan counts each kind of check, so the three kinds above cost two
   counts a picture: about 1,000 pictures a month and 250 a day. It needs no card and also stops.
4. **Connect's own checker (the open-source NSFWJS).** It runs on Connect's server, so it has no
   monthly limit and needs no outside service; what limits it is the server's own strength. It
   only looks for nudity, so it is asked only when none of the three above could answer. And only
   when at least one of the three has already given a full answer with the key it has now. With
   no service that has ever worked, nothing is "out": the checking is not set up yet, and
   pictures wait. (This is asked of the three together, not of each: once one has worked, another
   that has a key and cannot be reached counts as out like any other.)

The next one is asked only when the one before is really out: used up, too busy, or not reachable
in time. An answer that is broken or incomplete, or a picture a service cannot read, is a fault to
be fixed; the picture then waits, and is never passed on that account. The first three are asked
for the same three things, and an answer only counts when all three were really looked at, so
whichever of them answers, the picture has had the same full check. The first clear answer counts: a picture one checker flagged is never shown to another to get a
second opinion. A checker that does not look for something is never read as "clean" for it.
(OpenAI's, for instance, answers zero for hate in pictures because it does not look for it. Hate
symbols are therefore left to the "Report" link in the first version.)

**What happens with the answer.**

- **Clean:** the picture is shown.
- **Flagged:** the picture is refused. From that moment nobody gets it, and it is deleted. (Two
  things said exactly: a picture that was already shown after a check for nudity only may have
  been seen before its full check flagged it; and once the child-safety tool is switched on, the
  file of a refused picture is kept, unseen, until that tool has looked at it.) The host sees
  "This picture was not accepted. It looks like it breaks the rules on nudity, violence or
  self-harm." Nothing goes to the founder. The app remembers the copy it made of this host's picture
  (its own JPEG copy, byte for byte, not the file as it was uploaded), so when she uploads a
  picture whose copy comes out the same, it is refused at once, without asking a checker.
- **Only Connect's own checker answered, and found no nudity:** the picture is shown. It is put
  through a full check as soon as one of the three services answers, tried every few minutes, and
  before any newer picture: when a service answers again, its first answers go to these. If that
  check flags it, it is refused at once, like any flagged picture. Until then the founder's page
  lists it under "Checked for nudity only". The founder gets an email when the first picture is
  shown this way, and once a day while any is still waiting, with how many and since when.
- **Connect's own checker found nudity:** refused, like any flagged picture.
- **Nothing answered at all:** the picture waits, hidden, and is tried again every few minutes.

A checker is sometimes wrong, and a harmless picture, a beach photo for example, will now and
then be refused. That is accepted: the site's rule is "no nudity", the checkers are set strictly,
and nobody has to decide picture by picture.

The own checker does heavy work on the server. It runs apart from the helper's loop that closes
calls and makes payments, so that a picture can never make a call close late. Which way of running
it fits the server (there are three, with different speed and set-up) is tried and decided in
part one's plan.

For each picture the app keeps which checker judged it and what it looked for. A judgement belongs
to that exact picture: a changed picture is a new picture and is checked again. A picture that
was refused, removed or locked away stays gone: an answer of "clean" that arrives late never
brings it back.

**Showing and removing.** The address a picture is fetched from refuses a picture that is hidden
or removed, whatever page asks. Pictures are not kept in visitors' browsers or in between for
long, so a removed picture can no longer be fetched within minutes. (A copy someone has already
saved cannot be taken back.)

**Reporting (choice G).** Every post has a "Report" link, for anyone who is signed in. It uses
the reports Connect already has, with one difference: reporting a post does not also block the
host, as reporting a person does today. (A block would silently stop the reporter's own monthly
contribution.) The page also names the support address, for someone who has no account.

**The founder's page.** The admin area gets a "Projects" page: the pictures that have only had
the nudity check so far, reported posts with their pictures (each with "Remove" and "Remove and
report"), every project with what it has received, contributions held back (choice D), and the
switch. There are no pictures waiting for the founder's decision: a checker's flag refuses a
picture by itself.

**What the checkers are sent.** Only Connect's copy of the picture. Never who uploaded it. That is
still personal information leaving Connect, so the privacy page names the companies, and a host is
told before she uploads.

## Pictures of child abuse

This is a different job from the queue above. The everyday checkers are not built for it, and
OpenAI says not to send its ordinary checker a picture that is already suspected.

**The tool.** Image Intercept, from the Internet Watch Foundation. It compares a picture with the
official list of known pictures, at the moment of upload. It is free for small platforms and open
to companies outside the United Kingdom. It needs an application, which the foundation looks at
before it says yes; it can be sent now and does not depend on the hosting.

**Pictures do not wait for it (the founder's decision, 18 November 2026).** Astra advised that
hosts should not be able to upload pictures at all until this tool is approved, set up and tried.
The founder decided otherwise, for the reasons in "What the founder decided": pictures go live
with the checking queue, and the tool is switched on when it is approved. Said plainly, what that
means until then: no tool compares pictures with the official list. The queue still looks for
sexual pictures of any kind and refuses what it flags; no checker catches
everything.

**Once it is switched on, it comes first, and nothing gets round it.** Every picture uploaded
from then on goes through it before the queue and before anyone can see it. When it cannot be
reached, the picture waits, hidden: Connect's own checker does not stand in for it.

**Pictures from before that day** stay as they are, shown or not, and are put through the tool
afterwards, the oldest first, until every picture has had its answer. A match locks the picture
at once, like any other match. (Cloudflare's tool only looks at pictures as they are served through
Cloudflare, so it cannot hold a picture back before it is shown. It can be switched on as well if
the site runs through Cloudflare.) When this tool flags a picture, the picture does not go to the
everyday checkers at all. The same goes for a picture that is suspected for another reason: a
report that says so, or what the founder sees. A list of known pictures cannot know a new one.

**What the law asks.** A company in the United States must report such a picture to the national
centre (NCMEC) as soon as it reasonably can once it knows of one, without waiting to be certain,
and keep it and what belongs to it, locked away, for one year after the report, or longer when a
court or the police ask. The law does not ask Connect to search for them. So the founder's "Remove" has a
second form, **"Remove and report"**:

- the picture is taken out of sight for everyone, and put where only the founder's account
  reaches it;
- nothing deletes it: neither the host, nor a cleaning job;
- the page shows the founder the steps for the report, and records when the report was made.

Connect needs a way to file such reports with NCMEC before pictures go live. That, and the exact
steps, are for the lawyer.

## What is left out of the first version

- A money goal, and showing how much a project has received or who gave.
- Different levels with different rewards.
- Posts only contributors can read (choice A).
- Emails about new posts (choice E).
- Changing the monthly amount without stopping.
- Comments and likes on posts.
- Playing YouTube videos inside the page. A link opens YouTube.
- Checking the text of posts automatically, and checking pictures for hate symbols. Both are
  covered by the "Report" link.
- Video and sound files.
- Any scoring of how risky a payment is. Large amounts wait and the founder looks (choice D).
- A way for a host to appeal when a checker refuses a picture.

## The three parts

Each part gets a short plan of its own before it is built, checked by Astra, as with memberships.

| Part | What it is | What it needs from the others |
| --- | --- | --- |
| 1. The project and its diary | The host starts, edits and ends a project and writes posts. Pictures: the copy, the storing, the queue of checkers, the founder's decisions, "Remove and report". Reports of posts. The public page. The founder's switch and page. No money. | Nothing. |
| 2. Contributions | The amounts a host suggests. Once and monthly: the card step, the agreement, the monthly charge, receipts, a failed payment, stopping, refunds, disputes, the waits before collecting, collecting, "Your account", the host's list of contributors. And everything that must stop a monthly charge: the host ending the project, a block, a paused, suspended or closed account, the switch. | Part 1's project (a contribution belongs to one). |
| 3. The ask and the joining up | The box after a call and on the host's page, and a script that walks the whole journey as a host and as a contributor. | Parts 1 and 2. |

## What it reuses

- **The card step:** Stripe's form as memberships use it
  (`src/app/h/[handle]/membership/card-form.tsx`).
- **The ways of working of the monthly payment:** written down before Stripe is asked, one label
  per request, asking Stripe after an interruption (`src/lib/membership/charge.ts`,
  `src/lib/payments/operations.ts`), and its rhythm of a hold first and the money three days
  later (`holdTiming` in `src/lib/membership/rules.ts`). The membership's own charge function is
  not used as it is: it is tied to a membership's month and its talk time.
- **The tries after a failure:** `TRY_AGAIN_AFTER_DAYS` and `GIVE_UP_AFTER_DAYS` in
  `src/lib/membership/rules.ts`.
- **A saved card kept for one purpose,** as `membership_cards` does.
- **The record of what was agreed to,** as `membership_agreements` does.
- **The fee, the ledger and collecting:** `src/lib/payments`, each widened to know a
  contribution's charge.
- **Reports and the founder's actions:** `src/lib/safety/reports.ts` (a new place a report can
  come from: a post; without the block).
- **The founder's switch:** the three positions of `src/lib/safety/switches.ts`.
- **Emails:** the outbox every email goes through. The texts are written for contributions; a
  membership's receipt speaks of held money and talk time and would be wrong here.
- **The always-on helper** (`worker/closer.ts`) places the monthly holds, takes the money, makes
  the tries after a failure, and checks the pictures that are waiting.

Astra's caution, for the part plans: "widened in one place" is the aim, not a promise. The record
of steps at Stripe, the helper's recovery after an interruption, Stripe's messages and the
collecting each need their own, named path for a contribution. And only the membership's patterns
are shared, not its code for months, talk time, or a new hold after a lost one.

## How it is checked

- A check script for each part, against the local database and Stripe's test mode, as for every
  module. The picture checkers are replaced by stand-ins in the scripts: no script ever calls an
  outside checking service.
- One real try of each outside checker, by hand, with harmless pictures, once the founder has
  made the accounts.
- Astra and CodeRabbit review each part.

## Before this can go live

1. **Stripe says yes to this exact thing.** Stripe needs to approve platforms that take support
   money for creators; calling it a "contribution" does not settle it. The question to put to
   Stripe: people who host paid calls on Connect also receive support for a published project,
   once and monthly, with no promised reward; first held on the card for three days and then
   charged by Connect; up to $100,000 in one charge; and kept by Connect for 7 to 30 days, or
   longer when the founder holds it back, before it is passed on to the host.
2. **The lawyer** looks at: the wording (never "donate"); what the terms and the privacy page say
   about contributions and about pictures being sent to checking companies; the monthly agreement
   and whether a yearly reminder is needed; the duty to report and keep pictures of child abuse,
   and how Connect files a report; that a picture a checker flags is refused and deleted by the app
   alone, with nobody at Connect deciding about it (a picture shown after a check for nudity only
   may have been seen before its full check flagged it, and a refused picture's file can be kept,
   unseen, until the child-safety tool has looked at it); and whether the law on removing intimate pictures shared
   without consent within 48 hours (the Take It Down Act) applies to the diary.
3. **Accounts for the checkers,** made by the founder: OpenAI, Microsoft Azure (the free level)
   and Sightengine (the free plan). The founder puts each key into the settings file; the builder
   never sees them. At least one of them must be set up, and tried once with a real picture, before
   pictures go live: without one, every new picture waits and is shown to nobody but its host.
   (Connect's own checker is never asked alone.)
4. **Image Intercept** is applied for; the application can be sent now. Pictures do not wait for
   it (the founder's decision). It is set up and tried as soon as it is approved.
5. **The rules page** gets a line on what a diary may show.

## Astra's check (18 November 2026): "not ready as written"

Astra researched the outside facts itself and then read the plan against the code. What it found,
and what was done with each point:

| # | Astra's point | What was done |
| --- | --- | --- |
| 1 | Seven days is no protection at a $100,000 ceiling: a bank can take a payment back for about 120 days, and Connect pays. | Taken: choice D and the second question near the top. The ceiling stays as the founder set it. |
| 2 | A picture passed only by the nudity checker is shown without a check for violence. | Put to the founder, who decided to keep the checker. What was taken from Astra's point: it is asked only when all three services are out, such a picture gets its full check first of all as soon as one answers, the founder sees the list, and at least one service key is needed before going live. |
| 3 | The part on pictures of child abuse left the working steps open, and Cloudflare's tool cannot hold a picture back before it is shown. | Taken: Image Intercept at upload, "Remove and report" spelled out, the steps for the lawyer. |
| 4 | "One more kind of payment" does not fit the code: call payments need a call's dates and price, and refunds, refund emails and the host lookup go through the call. Checked in the code and true. | Taken: contributions get their own records; the fee, the ledger, the written-down steps and collecting are shared. |
| 5 | Stripe must approve this exact model; "nobody can say they did not get what they paid for" is not true. | Taken: the sentence is gone, and the question for Stripe is written out. |
| 6 | The monthly charge needs rules of its own (one charge per month, the bank's confirmation, a card that is gone, stopping while a charge is under way), and the membership's month rule stays on the 28th after February. Checked and true. | Taken: "The money" and "When the monthly charge is made". |
| 7 | What stops a monthly charge (ending, blocks, closed accounts, the switch) cannot wait for part three, and a contribution's card needs protecting. | Taken: moved to part two. |
| 8 | Refunds and disputes needed their own rules: after the share is sent, a won dispute, a refund and the monthly contribution. | Taken: "Refunding", "What ends a monthly contribution", "The money". |
| 9 | A receipt alone is not enough for a monthly charge: clear terms, a confirmation at once, easy cancelling. No reminder before each monthly charge is required. | Taken: "Contributing monthly". |
| 10 | Hiding a post on the first report lets anyone switch off a host's diary; reporting a post must not block the host. | Taken: choice G. Hiding the post for the reporter alone was not taken: more machinery than it is worth. |
| 11 | Limits on a stored picture, refusing hidden pictures at the picture's own address, no long keeping in between, and no heavy picture work in the helper that closes calls. | Taken. The open-source checker stays, so its work runs apart from the loop that closes calls. |
| Cut | Astra would also cut the queue down to one checker with one backup. | Not taken: the three services are free, the queue is the founder's decision, and asking the next one is a few lines. Each is held to the same three checks, which was Astra's condition. |

Corrections of fact from Astra's research, all worked in: OpenAI's free level has a daily limit
(5,000), not only one per minute; Sightengine counts two for each picture, so about 1,000 a month;
Azure's checker takes files up to 4 MB, which Connect's 1 MB copy always fits; Image Intercept is
open to companies outside the United Kingdom.

## Astra's second check (18 November 2026): "ready with changes"

Astra read the rewritten plan in full, with the founder's four decisions taken as final. Of its
eleven first points it called five solved and six partly solved. Its remaining must-fix points,
all taken:

| # | Astra's point | What was done |
| --- | --- | --- |
| A | Every way a contribution can stop needs a rule for money that is only held, also for a contribution made once; and a stop must always stop the months to come, even while a payment's outcome is not known. Never promise "nothing is charged" before it is known. | Taken: "Ending", "Cancelling while it is held", "Cancelling", "What ends a monthly contribution". Letting one payment go and stopping are told apart. |
| B | The $1,000 rule left gaps: two payments made together, held money, refunded money, and earlier payments not yet collected. | Taken: "How the $1,000 is counted". Still per contributor and host, as the founder decided. |
| C | Applying for Image Intercept is not enough: it must be working, and when its check cannot run, a picture must wait, whatever the other checkers say. | Taken at first. The founder then decided that pictures do not wait for the tool (18 November 2026); once it is switched on, it comes first and nothing gets round it. "Remove and report" stays as Astra asked. |
| D | "Three days" was promised without saying that a bank can make it shorter, that the clock starts when the hold is in place, or what happens to a hold that is lost. | Taken: the real last moment is shown and sent; a lost hold ends that payment and the monthly contribution goes on. One email for each payment at the hold, in place of a receipt afterwards. |
| E | "The day of the first charge" could mean the hold or the taking. | Taken: the day of the first hold. The waits before collecting count from the real taking. "Ten days after the contributor paid" is gone. |
| F | With the nudity-only exception kept: only a service that is really out allows it, every part of a full check must really have run, restored services serve the waiting pictures first, the founder is told, and a late "clean" never brings back a hidden picture. | Taken: "The queue" and "What happens with the answer". |
| G | Sentences that still said a contribution is charged at once, or that a refund and a collection can never both happen. | Taken. |

Left to the part plans, as Astra advised: the exact tables and locks, the named paths through the
payment code, how a contribution's card is cleaned up, the time zone of the monthly day, each
checker's thresholds and limits, which way the open-source checker runs, and the limits of the
picture work.

## CodeRabbit's review (pull request 42, 18 November 2026)

Six comments on the four documents. Five were right and taken; one was answered.

| # | CodeRabbit's point | What was done |
| --- | --- | --- |
| 1 | The email at the hold cannot always come three days before the money is taken: a bank can shorten a hold. | Taken: "Contributing monthly", and the lawyer's check names it. |
| 2 | Pictures uploaded before the child-safety tool is switched on would have been handed to nobody from that day, and nothing would ever have asked the tool about them. | Taken: "Pictures from before that day"; plan 24 says how. |
| 3 | Plan 24 asked that one service must have worked with its current key before Connect's own checker may pass a picture; the rulebook did not say so. | Taken: the rule is here now, under "The queue". CodeRabbit then asked about one service that has worked and another that never has, both out: the rule is asked of the three together, so that case allows the own checker, and both documents say so. |
| 2b | A picture removed before the tool is switched on has no bytes left to check, so "until every picture has had its answer" could never be reached. | Taken: plan 24 leaves such lines out of the job. |
| 4 | Plan 25's rule for skipped months would also have skipped a month that fell due before the switch went off, if the helper was down at that time. | Taken: plan 25, choice 13, now keeps the moment the switch stopped covering a host and skips only the months after it. |
| 5 | A share whose sending is under way when the $1,000 line is crossed can still go through before its 30 days. | Answered, not changed: that sending was accepted before the line was crossed, and a sending that is under way is never interfered with. The rule now says so in words ("How the $1,000 is counted"). |
| 6 | Plan 26 expected no "Contribute" line on the host's page after a closed report, although that line does not look at reports. | Taken: plan 26 tells the two kinds of report apart. |
