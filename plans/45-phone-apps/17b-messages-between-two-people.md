# Phone apps, part 17b: messages between a host and a customer

**Status:** a plan only. Written 27 November 2026 by the builder alone, on the founder's word
("build the plan for now"). Part of plan 45. Nothing here is built, and the phone build stays
paused (the founder's word of 20 November) until the founder says otherwise.

## For the founder: what this is

On the website a host and a customer can write to each other (plan 49, built and switched on
26 November). The phone apps cannot yet. This part brings it to the apps:

- a fifth place at the bottom of the app, **Messages**, with the list of a person's
  conversations and a number on it when something new is waiting;
- **one conversation's screen:** the messages, the box to write in, "Report" beside each
  message of the other person, "Block", the customer's switch for that one host, and the two
  booking buttons;
- **"Write to …"** on a request that was accepted;
- and, when notifications exist (part 12), **the phone tells a person "You have a new
  message."** That is the nudge the website does not have: on the website nobody is told about
  a new message until they look (your decision: no email for each message).

**Every rule stays exactly as you decided it for the website.** An example. Hana is a host,
Cory her customer. Around a call both can write. Afterwards Hana can write to Cory any time;
Cory can answer for 7 days after her latest message, and after that he reads "Book a call to
write to Hana again". Cory can stop Hana's messages between calls. All of that is decided by
the server, by the same code, whether Cory holds a phone or sits at a computer. The app only
shows what the server says.

**What only you can decide** is in "Whose decision each point is", near the end. The three you
may most want to change: a fifth place at the bottom (instead of four); the notification's
text names nobody; Connect's own notices to a person ("From Connect" on the website) are not
in this part.

## What is there today (read in the code)

**The website (plan 49, as changed by plan 51).**

- The rules are in `src/lib/conversations/rules.ts` (`mayWrite`, `limitProblem`,
  `tidyMessage`, `isSendKey`), the facts they decide by in `facts.ts` (`factsFor`,
  `callFacts`), sending in `send.ts` (`openConversation`, `sendMessage`), reading in `read.ts`
  (`conversationsOf`, `viewFor`, `mayMarkShown`, `markShownUpTo`, `setMuted`,
  `newConversationCount`, `topBarCount`), and the sentences in `words.ts` (`refusalWords`,
  `limitWords`, `CONVERSATION_WORDS`).
- **Sending** takes the two people's calendar locks, then the conversation's row, then reads
  the clock once. Every message carries a once-only key made by the browser; the key is bound
  to its words. The same press sent twice makes one message and gets the first answer again.
- **The page** (`src/app/conversations/[id]/page.tsx`) asks the server again every 5 seconds
  while it is in front. It shows every message the person has not been shown yet and at least
  the latest 50, never more than 500; "Show earlier messages" asks for an older stretch
  (`?from=`). The person's own browser tells the server what it has shown
  (`conversationShownAction`), and only when no unshown message lies before the first one on
  the page (`mayMarkShown`). A web address inside a message is plain text, never a link.
- **The box** (`composer.tsx`) is always there. What was typed is never lost: not over a
  refusal, not when the conversation closes while someone types, not when the server's answer
  never arrives ("We could not confirm that this was sent. Press Send again: it will not be
  sent twice.").
- **"Write to …"** (`src/components/write-to.tsx`, `openConversationAction`) is on an accepted
  request's page, on the page after a call, and, for a host, beside a past customer on
  Contacts. Who the two people are is worked out on the server from the call or the customer.
- **Report** beside a message leads to the report form with the place
  `message=<conversation>/<number>`; the report keeps a copy of the messages around it
  (`src/lib/safety/kept-messages.ts`) and blocks the person. **Block** is the ordinary block
  (`src/lib/safety/blocks.ts`).
- **The list** is on `/messages`, above "From Connect" (what Connect itself wrote to the
  person, plan 47). The number in the top bar counts both.
- Two founder's switches: messages off for everyone (`conversationsOff`: writing stops,
  reading and reporting stay), and nothing else.
- Nobody is emailed about a message.

**The apps (plan 45, parts 01 to 09 built).**

- Every request goes through one gate (`src/lib/app-door/gate.ts`, `appRequest`) and is
  answered with shapes written down in `src/lib/app-door/types.ts`, which the app reads as
  types. Sentences come from the server.
- Four places at the bottom: Home, Search, Calls, Account
  (`mobile/src/app/(tabs)/_layout.tsx`).
- The report form is a screen of the app (`mobile/src/app/report.tsx`,
  `/api/app/report`), for three places: a call, a request, a host's page
  (`APP_REPORT_PLACES`). The app never names a person: the server works out who a report or a
  block is about from the place.
- Blocking from a request exists (`POST /api/app/bookings/[id]/block`, `BLOCK_WORDS`).
- A request's screen (part 06/07) and a call's page (part 08) exist; the page after a call
  (part 10), Contacts (part 17), the account page (part 18) and notifications (part 12) do
  not.
- The apps have their own switches (`switchesForApps`): memberships, tips, "available now".
- The app keeps nothing to send later (part 02): a request that cannot be sent now is told to
  the person as such.
- The app has no Messages screen of any kind, and no code about conversations.

## Decisions (the builder's)

### The frame

1. **No rule lives in the app.** Who may write, the limits, what is shown, which sentence is
   said: all of it is asked of the server each time, from the very functions the website
   uses. The app holds no copy of a rule and no sentence of its own, with one exception that
   cannot be otherwise (decision 9: the sentence for an answer that never came, which the
   server hands over beforehand).

2. **A fifth place at the bottom: "Messages",** between Calls and Account, with a number on it:
   in how many conversations the other person wrote something this person has not been shown
   (`newConversationCount`). Both kinds of phone show five places without folding any away.
   The number is asked when the app opens or comes to the front, when any of the five places
   comes in front, and after a conversation's screen is left. If the kit the app uses for the
   bottom bar cannot show a number on both kinds of phone (checked first when this is built),
   the place shows a dot instead, and the number is said in the list's heading.
   *The number counts conversations only.* On the website the same number also counts what
   Connect itself wrote; the apps do not show that list (see "Not in this part").

3. **The apps get their own switch, "messages in the apps", born on.** Not because of money
   (decision 21) but because a store may object to messages between users (see "What a store
   may ask"). With it off: the Messages place is gone, "Write to …" is gone, every address of
   this part answers "This is not available in the app right now", and no phone is told about
   a new message. The website is untouched. It is a new line in the founder's switches and a
   new field in what the app is told on opening. The founder's other switch (messages off for
   everyone) works in the apps as on the website, through the rules themselves: writing
   stops, reading and reporting stay.

4. **Who may ask.** Every address here is for someone signed in, with a confirmed email
   address and the terms accepted (the gate's "member"). A paused person may read, report,
   block and move the customer's switch, and is refused writing by the rules' own sentence
   ("Your account is paused, so you cannot write. You can still read this conversation."),
   exactly as on the website. Someone else's conversation and one that does not exist get the
   same answer: not found.

### The list

5. **The Messages screen is the list of conversations,** as `conversationsOf` gives it: the
   name of the other person (a customer sees his host under her host name, a host sees her
   customer under his own name), the time of the latest message, and "New". Those with
   something new come first. At most 200. A conversation that was only opened, with no
   message in it, is not listed, as on the website. With none: "You have no conversations
   yet." and one sentence on where they begin ("You can write to someone from a call you have
   with them."). The list is asked again when the screen comes in front, when the app comes
   back to the front, and when the person pulls it down.

### One conversation

6. **The screen shows what the website's page shows,** from one answer of the server
   (`viewFor`): the other person's name; the messages, oldest first, each with "You" or the
   name, its time, and its words exactly as written, line ends included; "Show earlier
   messages" and "These are older messages. Back to the latest" where the website has them;
   "No messages yet." or "No messages remain. Messages are deleted 12 months after they were
   sent."; then the box, or the sentence why this person cannot write; the booking buttons
   (decision 13); the customer's switch (decision 12); "Block" (decision 11). The answer
   names no person by an id: a message says "mine" or not, and blocking and reporting name
   the conversation, from which the server works out the other person.

7. **It stays fresh the website's way:** the screen asks again every 5 seconds, **only while
   it is the screen in front and the app is in front.** A locked phone, another app in front,
   or another screen over it: no asking. Coming back asks at once. Only the newest question
   counts: a slow answer to an older one never overwrites a newer one. When the server cannot
   be reached, what is on the screen stays, with one quiet line saying it may be old.
   *Known and accepted:* each asking sends the whole stretch again (usually the latest 50
   messages), as the website's page does. It is small next to a video call. Sending only what
   is new would be a second way of reading, with its own mistakes to make; it is not built.

8. **"Shown" means what it means on the website.** With each answer the server says up to
   which message number the app may report "shown" (the highest on the screen, and only when
   `mayMarkShown` allows it), or that it may not. The app reports it once it has really drawn
   those messages while the screen was in front and the app in front, never before, and never
   for a screen in the background. The server's mark only ever goes up and never past the
   last message there is. So a message that arrived while the phone lay locked stays "New".

9. **Writing.** The box is always there while the screen is, open or not, as on the website.
   - Each message carries a once-only key made on the phone. The key stays the same until the
     server has said the message went through, or until the words are changed. A press sent
     twice, or pressed again after an answer that never came, makes one message.
   - **An answer that never came** (no connection, the time limit, an answer that cannot be
     read): the message may or may not have been saved. The words stay in the box, the key is
     kept, and the app says the website's sentence: "We could not confirm that this was sent.
     Press Send again: it will not be sent twice." That sentence arrives with the
     conversation, before it can be needed.
   - **A refusal the server could say** (the rules, a limit, too long): the words stay in the
     box, with the server's sentence, the same one the website gives. The screen then asks
     for the conversation again, so it shows what has changed (for example that the other
     person has blocked meanwhile). If the conversation is then closed, the words stay to be
     copied, under "What you wrote was not sent. You can still copy it."
   - **The sign-in ran out while typing:** the app does not jump to the sign-in screen and
     throw the words away. It says so, the words stay to be copied, and a "Log in" button
     takes the person there when they choose.
   - **After a message went through** the box is emptied and the conversation is asked again
     at once.
   - The key needs no secret randomness. It only has to differ from this person's other keys
     in this conversation, and if two ever were alike the server would refuse the second as
     "not sent" (a key is bound to its words), never call something sent that was not. So the
     phone makes it from its own random numbers; no new building block is added to the app
     for it.
   - The server counts a message's length (2,000 characters) and refuses a longer one with
     its sentence. The app stops typing at about that length as the website's box does; the
     server's count is the one that decides.
   - **Nothing is sent later.** A message that could not be sent is not kept to be sent when
     the connection is back (part 02's rule). The person presses Send.

10. **"Write to …"** appears where the website has it and the app has the screen: on a
    request that was accepted (part 06/07's screen). The server says whether to show it and
    with which words, by the website's own condition. Pressing it asks the server to open the
    conversation of that call's two people (`openConversation`) and goes to its screen; a
    refusal says "You cannot write to this person right now." and makes nothing. The page
    after a call (part 10) and Contacts (part 17) get the same button when they are built;
    the address takes both ways of naming the pair (a call, or, for a host, a past customer)
    from the start, and both are checked now.

11. **Block** on the conversation's screen, with the question the app asks first, in the
    words blocking already has in the app (`BLOCK_WORDS`). The server blocks the other person
    of that conversation and answers with the conversation as it now stands. Where a call
    between the two could not be cancelled, the sentence says so and the button stays, as on
    a request's screen. A host's list of requests held by the app is told to read itself
    afresh (`blockSent`, part 07).

12. **The customer's switch for one host** ("Stop messages from Hana between calls" / "Allow
    messages from Hana again"), shown on the website's condition, moved through `setMuted`.
    The answer is the conversation again with what was done. The two "Done." sentences move
    from the website's page code into the shared sentences, so both say the same.

13. **The booking buttons lead into the app.** "Book a time with Hana" and "Book a call to
    write to Hana again" open the app's own page of that host (part 05). The server offers a
    button only when the app's host page would let this customer book there; it asks that
    page's own function, it does not work it out a second time. Where the website would offer
    a way that the app does not have yet (a member's way to a host whose page is hidden from
    the public: part 13), the app shows the sentence "Book a call to write to Hana again."
    without a button. It never says "on the website".

14. **A report from a message.** "Report" beside each message of the other person opens the
    app's report form with a fourth place, a message (`<conversation>/<number>`), on the very
    function the website uses. So the report keeps its copy of the messages around it, and it
    blocks the person. It works while messages are switched off and for a paused person, and,
    like every report from the app, from a copy of the app that has become too old. After it,
    the app goes back to the conversation, which is asked again. If the report was saved but
    the block was not, the notice says so in the website's sentence, and the conversation's
    own "Block" button is there.

15. **On the phone itself.**
    - **Nothing of a conversation is written to the phone's storage:** no messages, no draft.
      Everything on the screen is what the server just said, and it is gone when the screen
      is. When somebody else signs in, every screen is made anew (as now).
    - A web address or a phone number inside a message is plain text. The app switches off
      the phone's habit of turning them into links.
    - Words can be selected and copied.
    - Screenshots are not blocked (they are blocked in a call; a person may need a picture of
      a message for a report to the police).

### The server's side

16. **New addresses, all through the gate, all answering with shapes written down in
    `types.ts`:**

    | Address | What it does | On which function |
    | --- | --- | --- |
    | `GET /api/app/conversations` | the list | `conversationsOf` |
    | `GET /api/app/conversations/count` | the number for the bottom bar | `newConversationCount` |
    | `POST /api/app/conversations` | "Write to …": opens the pair's conversation, answers its id | `openConversation` |
    | `GET /api/app/conversations/[id]` (with `from`) | one conversation | `viewFor` |
    | `POST /api/app/conversations/[id]/send` | sends a message | `sendMessage` |
    | `POST /api/app/conversations/[id]/shown` | "shown up to this number" | `markShownUpTo` |
    | `POST /api/app/conversations/[id]/mute` | the customer's switch | `setMuted` |
    | `POST /api/app/conversations/[id]/block` | blocks the other person | `block` |
    | `/api/app/report` (there already) | a fourth place: a message | `sendReportFor` |

    Nothing an answer holds is kept by anything on the way (the door's rule).

17. **What changes on the server besides.** Small, and none of it changes what the website
    does:
    - The sentence for a message that was refused is put together in one shared function
      (today inside the website's page code), so the website and the app cannot drift apart.
    - The few sentences that today live inside the website's page and box (the two "Done."
      sentences of the switch, "We could not confirm…", "What you wrote was not sent…",
      "Show earlier messages", the two "No messages" lines) move into `words.ts`.
    - The server tells where a customer can book as the host's handle, not only as a website
      address.
    - The report's place check accepts a message's place.
    - The founder's switches get the new line (one migration), and the founder's page its
      button.
    `sendMessage`, `mayWrite` and the rest of the rules are not touched.

18. **If the server fails in the middle of a send** in a way it did not foresee, the app's
    address answers without saying "not sent" (the report address does the same today). The
    app then treats it as an answer that never came: the words and the key are kept, and
    pressing Send again is safe.

### The notification

19. **"A new message" joins part 12's list of what becomes a notification.** It is built
    with part 12 or with this part, whichever is built second; until then the apps have
    messages without it, as the website does.
    - **What it says:** "You have a new message." Nothing else: no name, no words of the
      message (part 12, decision 4). The name and the message are shown after the app is
      opened.
    - **Who gets it:** the other person of the conversation, on every phone of theirs that
      allows notifications. The row is written in the same database step as the message, so
      one cannot exist without the other; the same press sent twice writes one.
    - **Checked again at the moment of sending** (part 12, decision 3): is it still that
      person's phone and are they signed in on it; is the message still there; has the person
      not been shown it meanwhile (on the website or in the app); have they not blocked the
      writer meanwhile; is their account still open; are messages still on for the apps; do
      they still want to be told. If any answer is no, nothing is sent.
    - **Not a pile:** while one notification about a conversation is still waiting to be
      sent to a person, a further message in that conversation writes no second one. And the
      phone is asked to show one line per conversation, a newer one taking the older one's
      place. The limits of plan 49 already cap it (five messages in a row without an answer).
    - **An ordinary notification,** not the urgent kind of a "call now" request: the phone's
      usual sound, no "time sensitive". On Android a channel of its own, "Messages", so a
      person can quieten it by itself in the phone's settings.
    - **A person's own switch,** "Tell me about new messages on my phone", on at first, at
      the foot of the Messages list. On an iPhone there is no way to quieten one kind of
      notification of an app; without this switch a person tired of messages would switch off
      all of Connect's notifications, the "call now" alert included.
    - **While the app is in front** the phone shows no banner for a message. The number on
      Messages is asked again instead, and a conversation that is in front is asked again at
      once.
    - **Touching it** asks the server first, as every notification does. The conversation
      opens only if the person now signed in is one of its two; otherwise the app opens as
      usual.
    - **Asking for permission** (part 12, decision 6) gets one more moment: after a person
      sends their first message from the app, if they were never asked.
    - A notification is not promised to arrive (part 12, decision 7). Nothing here depends on
      it: it is a nudge, and the message waits in the list either way.
    - Reading a message on the website does not take an already delivered notification off
      the phone. It is taken off when the app is opened on that conversation.

### Building it

20. **Order.** This part needs only parts 01 to 09, which are built. It can be built as soon
    as the pause ends, before or after any later part. What it shares with later parts is
    said above: the button on the page after a call (part 10) and on Contacts (part 17), and
    the notification (part 12), each built with whichever part comes second.

## Keeping the 4.9%

21. Messages take no money and lead to none that a store could claim. Checked point by point:
    - The booking buttons lead to the app's own host page, where a one-to-one call is booked
      as everywhere in the app (the kind of sale both stores leave to the app's own payment,
      plan 39). Nothing leads to the website.
    - The line beside the box, "Calls and payments for them stay on Connect.", tells people
      not to pay each other outside Connect. It names no website and no price.
    - A host can write "I have a project" or a web address to a customer. That is her
      message, not the app's: the app turns nothing in a message into a link, and nothing in
      the app's own words mentions projects, tips or contributions.
    - The notification says "You have a new message." and sells nothing.

## What a store may ask

Read on 27 November 2026 (sources at the end).

- **Apple (rule 1.2)** asks an app with content written by its users for four things: a way
  to report, a way to block, contact information, and "a method for filtering objectionable
  material from being posted". Connect has the first three in the app. **It has no filter on
  what is written in a message.** Reports, blocks, the limits and the founder's look at
  reported messages are what Connect has. Whether Apple accepts that for messages between
  two people who have a call together is not known until Apple reviews the app. If Apple
  says no, the switch of decision 3 takes messages out of the apps without a new version
  while it is settled. Building a filter is not planned here; it would be a plan of its own.
- **Google** asks that people accept the terms before they can write (they do: "18 or older
  and the terms" comes before everything), that the terms say what is not allowed (the
  rules page does), and that reporting and blocking are inside the app, easy to find and
  clearly named, wherever one person can write to another. This part has both on the
  conversation's screen, as two separate, named buttons.
- **Apple (rule 4.5.4)** allows no advertising by notification without a person's consent
  and a way out, and nothing private in a notification. The notification here carries no
  words of the message; a person can switch it off (decision 19); a customer can stop a
  host's messages between calls altogether.
- **The stores' forms** (part 20) ask whether people can write to each other in the app. With
  this part the answer is yes, and the age rating and the privacy form must say so.

## How it is tried

- **The website's own checks stay green and untouched:** `conversation-check` (163 checks),
  `journey-check`, `safety-check`.
- **A new check script, `app-conversations-check`,** asking as the app does (signed in the
  app's way, through the gate). It runs the same people through the app's addresses and
  through the website's functions and compares:
  - the gate: no app header, nobody signed in, email not confirmed, terms not accepted, a
    copy too old (refused everywhere here, the report excepted), the apps' switch off
    (everything refused, and the website unchanged), someone else's conversation and one
    that does not exist (the same answer);
  - the list and the number: in the website's order, with the website's names for each role,
    a conversation with no message not listed, the number equal to `newConversationCount`;
  - one conversation, for every state the rules know (around a call; a host waking a quiet
    one; a customer inside and outside the 7 days; switched off by the customer; blocked
    each way; paused; closed accounts; the host's page not public; messages off for
    everyone; an old "End call and report" between the two): the app's answer says the same
    sentence as the website's page, offers the box exactly when the website does, and offers
    a booking button only when the app's host page would let him book;
  - sending: goes through; the same key twice makes one message and one answer; the same key
    with other words is refused; every limit; too long; empty; a refusal's sentence equals
    the website's;
  - "shown": only up to what the answer allowed, never down, never past the last message;
    "Show earlier" and the stretch that does not reach the latest;
  - the switch: only the customer of that conversation can move it;
  - block from a conversation: the block is there, the calls between the two are cancelled,
    the conversation reads "You blocked this person.";
  - report from a message: the report exists with its kept copy, the person is blocked; a
    message of one's own, one that is gone and someone else's conversation are refused
    alike; it works for a paused person and with messages off for everyone;
  - "Write to …": from a call of one's own; from someone else's call (refused); a host to a
    past customer and to a stranger (refused); nothing is made by a refusal;
  - no answer holds a person's id, an email address, or a host's account name where her
    host name belongs.
- **Tests in the app** for what the app decides by itself: when a key is kept and when a new
  one is made; that only the newest answer counts; that "shown" is not reported for a screen
  in the background; that an unreadable answer is treated as "not known", never as "not
  sent" and never as "sent".
- **On the Android test phone, with pictures,** two people (one on the phone, one on the
  website): the list and its number; writing both ways and seeing the other's message arrive
  within a few seconds; the 7 days running out (with the test clock) and the booking button
  leading to the host's page; the customer's switch; block; a report from a message, then
  the founder's page showing the kept copy; the phone put into flight mode in the middle of
  a send, then Send again, and one message on the website; the screen left open while the
  phone is locked, and the message still "New" afterwards.
- **The notification** (when part 12 exists): `notifications-check` grows by this kind: one
  row per phone, once per press; none after the person was shown the message, blocked the
  writer, switched the alert off, signed out, or with the apps' switch off; the text holds
  no name and no word of the message. On the test phone a notification made by the phone
  itself shows how it looks.

## What cannot be tried here

- A notification that really travels from the server to a phone (needs the founder's Google
  account; an iPhone needs Apple's membership).
- An iPhone at all, until the iPhone build exists (part 20): the keyboard over the box, the
  bottom bar's number, the banner while the app is in front.
- What Apple and Google say to messages in the app. Only their review shows it.
- Many people writing at once on real mobile networks.

## Not in this part

- **"From Connect": what Connect itself wrote to a person** (plan 47's notices about a bank
  dispute, money owed back, and the like). On the website it shares the Messages page. In the
  apps most of those notices point to pages the apps do not have (a dispute's page, part 16c
  as proposed). It is proposed as a small part of its own once those pages are decided. Each
  such notice is also emailed, so nobody misses one meanwhile.
- **A filter on what is written** (see "What a store may ask").
- **A number on the app's icon** on the phone's home screen.
- **Pictures, voice messages, "is typing", "read by the other person":** not on the website
  either.
- **An email for a new message:** the founder's decision of 26 November stands.

## Whose decision each point is

- **The founder's, from plan 49, and unchanged here:** every rule about who may write when;
  7 days; the customer's switch per host; the limits; report and block; messages on from day
  one; no email for each message; "phone apps later".
- **The builder's, in this part, each open to change:**
  1. A fifth place at the bottom, "Messages" (decision 2). The other way: four places stay,
     and Messages is a line on Home and on Account.
  2. The notification names nobody: "You have a new message." (decision 19). The other way:
     "New message from Hana". Part 12 leaves names out of every notification, because a
     locked phone can be read by whoever picks it up.
  3. A person's own switch for message notifications, on at first (decision 19).
  4. The apps' own switch for messages, born on (decision 3).
  5. "From Connect" is not in this part.
  6. Nothing of a conversation is kept on the phone, and screenshots are allowed
     (decision 15).

## Astra's check

Not yet checked.

## Sources

- Apple, App Review Guidelines (rules 1.2 and 4.5.4):
  https://developer.apple.com/app-store/review/guidelines/
- Google Play, User Generated Content:
  https://support.google.com/googleplay/android-developer/answer/9876937
