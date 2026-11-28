# Phone apps, part 17b: messages between a host and a customer

**Status:** a plan only. Written 27 November 2026 by the builder alone, on the founder's word
("build the plan for now"). Part of plan 45. Nothing here is built, and the phone build stays
paused (the founder's word of 20 November) until the founder says otherwise. Astra checked it
twice (first "not ready", 16 points; then "ready with changes", 8 points); all are worked in
or answered, and listed at the end. Read on 27 November 2026 by the builder of the phone
apps, after pull request 123: nothing in it had to change. Two things were added elsewhere
that touch it. Part 12, decision 2a, proposes one notification, "Connect has written to
you.", for a few kinds of message "From Connect" (see "Not in this part" here, which leaves those
messages out of the apps). And parts 10 and 17 now name their "Write to" buttons from their
side, as decision 20 here asks.

## For the founder: what this is

On the website a host and a customer can write to each other (plan 49, built and switched on
26 November). The phone apps cannot yet. This part brings it to the apps:

- a fifth place at the bottom of the app, **Messages**, with the list of a person's
  conversations and a number on it when something new is waiting;
- **one conversation's screen:** the messages, the box to write in, "Report" beside each
  message of the other person, "Block", the customer's switch for that one host, and a
  button to book the host;
- **"Write to …"** on a request that was accepted;
- and, when notifications exist (part 12), **the phone tells a person "You have a new
  message."** That is the nudge the website does not have: on the website nobody is told about
  a new message until they look (your decision: no email for each message).

**Every rule stays exactly as you decided it for the website.** An example. Hana is a host,
Cory her customer. Around a call both can write. Afterwards Hana can write to Cory any time;
Cory can answer for 7 days after her latest message, and after that he cannot until he has
another call with her. Cory can stop Hana's messages between calls. All of that is decided by
the server, by the same code, whether Cory holds a phone or sits at a computer. The app only
shows what the server says.

**What only you can decide** is in "Whose decision each point is", near the end. The three
you may most want to look at: a fifth place at the bottom (instead of four); the
notification's text names nobody; Connect's own notices to a person ("From Connect" on the
website) are not in this part. One point is settled: a sentence is worded differently in
the app than on the website (decision 13). Asked on 27 November, you left it to the builder
("do what you think is the best"), and the neutral words stay.

## What is there today (read in the code)

**The website (plan 49, as changed by plan 51).**

- The rules are in `src/lib/conversations/rules.ts` (`mayWrite`, `limitProblem`,
  `tidyMessage`, `isSendKey`), the facts they decide by in `facts.ts` (`factsFor`,
  `callFacts`), sending in `send.ts` (`openConversation`, `sendMessage`), reading in `read.ts`
  (`conversationsOf`, `viewFor`, `mayMarkShown`, `markShownUpTo`, `setMuted`,
  `newConversationCount`, `topBarCount`), and the sentences in `words.ts` (`refusalWords`,
  `limitWords`, `CONVERSATION_WORDS`).
- **Sending** takes the two people's calendar locks, then the conversation's row, then reads
  the clock once. Every message carries a once-only key made by the browser. Under the
  locks, before anything else is looked at, the server looks for a message of this person in
  this conversation with that key: if it is there with the same words, the answer is the
  first answer again ("sent", its number), whatever has happened to the conversation since;
  with other words it is refused.
- **The page** (`src/app/conversations/[id]/page.tsx`) asks the server again every 5 seconds
  while it is in front. It shows every message the person has not been shown yet and at least
  the latest 50, never more than 500; "Show earlier messages" asks for an older stretch
  (`?from=`), and a stretch that holds nothing leads back to the latest. The person's own
  browser tells the server what it has shown (`conversationShownAction`), and the page lets
  it do so only when no unshown message lies before the first one on the page
  (`mayMarkShown`). The server takes the browser's number as it comes: it only makes sure the
  mark goes up and not past the last message. A web address inside a message is plain text,
  never a link.
- **The box** (`composer.tsx`) stays in the page whether the conversation is open or not, and
  shows nothing while it is closed and nothing was typed or refused. What was typed is not
  lost over a refusal, or when the conversation closes while someone types, or when the
  server's answer never arrives ("We could not confirm that this was sent. Press Send again:
  it will not be sent twice."). The sentence for a refused message is put together in
  `src/app/conversations/actions.ts`.
- **"Write to …"** (`src/components/write-to.tsx`, `openConversationAction`) is on an accepted
  request's page, on the page after a call, and, for a host, beside a past customer on
  Contacts. Who the two people are is worked out on the server.
- **Report** beside a message leads to the report form with the place
  `message=<conversation>/<number>`; the report keeps a copy of the messages around it
  (`src/lib/safety/kept-messages.ts`) and then blocks the person. When that block did not go
  through cleanly, the reporter lands on a receipt (`/report/saved/[reference]`) with the
  truth and a "Block" button. **Block** is the ordinary block (`src/lib/safety/blocks.ts`).
- **The list** is on `/messages`, above "From Connect" (what Connect itself wrote to the
  person, plan 47). The number in the top bar counts both.
- One founder's switch: messages off for everyone (`conversationsOff`: writing stops,
  reading and reporting stay).
- Nobody is emailed about a message.

**The apps (plan 45, parts 01 to 09 built).**

- Every request goes through one gate (`src/lib/app-door/gate.ts`, `appRequest`) and is
  answered with shapes written down in `src/lib/app-door/types.ts`, which the app reads as
  types. Sentences that depend on rules come from the server; the names of the four places at
  the bottom are written in the app.
- Four places at the bottom: Home, Search, Calls, Account
  (`mobile/src/app/(tabs)/_layout.tsx`). All screens are made anew when the signed-in person
  changes (`mobile/src/app/_layout.tsx`), and the app asks who is signed in each time it
  comes to the front (`opening.tsx`).
- The report form is a screen of the app (`mobile/src/app/report.tsx`, `/api/app/report`),
  for three places: a call, a request, a host's page (`APP_REPORT_PLACES`). It works from a
  copy of the app that has become too old. Its answer is one sentence, and "Done" leads Home;
  the app has no receipt with a "Block" button. The app never names a person: the server
  works out who a report or a block is about from the place.
- Blocking from a request exists (`POST /api/app/bookings/[id]/block`, `BLOCK_WORDS`). The
  button comes back, on every reading, for as long as a call between the two still stands
  that blocking could not cancel (`bookingPageFor`).
- A host's page in the app (`hostPageFor`) leads to booking through ordinary times. Times for
  members are shown but cannot be chosen yet (part 13).
- The apps have their own switches (`switchesForApps`): memberships, tips, "available now".
- The app keeps nothing to send later (part 02).
- The app's support address is shown only to a paused person, and is a placeholder until a
  real one is set (`src/lib/terms.ts`).
- The app has no Messages screen of any kind, and no code about conversations.

## Decisions (the builder's)

### The frame

1. **No rule lives in the app.** Who may write, the limits, what is shown, which sentence is
   said: all of it is asked of the server each time, from the very functions the website
   uses. Every sentence about a conversation arrives from the server, those the app can only
   need when the server cannot be reached included (they arrive with the conversation,
   beforehand). Only the name of the place at the bottom, "Messages", is written in the app,
   like the other four.

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
   but because a store may object to messages between users (see "What a store may ask").
   What it covers, exactly:

   | With the apps' switch off | |
   | --- | --- |
   | The place "Messages", "Write to …", the number | gone |
   | Every address under `/api/app/conversations` | "This is not available in the app right now." |
   | The report form's address (`/api/app/report`), all four places, and the receipt | **works as before** |
   | Telling a phone about a new message | not sent |
   | The website | untouched |

   So a report that someone was writing about a message when the switch moved still goes
   through. The app is told the switch on opening, in a new field; a copy of the app that
   finds no such field shows no Messages (so the app and the server can be brought out in
   either order). The founder's other switch (messages off for everyone) works in the apps as
   on the website, through the rules themselves: writing stops, reading and reporting stay.

4. **Who may ask.** Every address under `/api/app/conversations` is for someone signed in,
   with a confirmed email address and the terms accepted (the gate's "member"), from a copy
   of the app that is not too old. The gate comes first, always. Then:
   - A paused person may read, report, block and move the customer's switch, and is refused
     writing by the rules' own sentence, exactly as on the website.
   - Someone else's conversation and one that does not exist get the same answer: not found.
   - A person whose own account is closed is nobody to the gate ("Please log in."). A person
     looking at a conversation whose *other* person's account is closed gets the
     conversation, with whatever sentence the rules give in their own order (usually "This
     conversation is closed."; a block, the switch for everyone or the person's own pause
     come first, as on the website).

### The list

5. **The Messages screen is the list of conversations,** as `conversationsOf` gives it: the
   name of the other person (a customer sees his host under her host name, a host sees her
   customer under his own name), the time of the latest message, and "New". Those with
   something new come first. At most 200. A conversation that was only opened, with no
   message in it, is not listed, as on the website. With none: "You have no conversations
   yet. You can write to someone from a call you have with them." At the foot: how to reach
   Connect (the support address), because a store asks that an app with messages shows one.
   The list is asked again when the screen comes in front, when the app comes back to the
   front, and when the person pulls it down.

### One conversation

6. **The screen shows what the website's page shows,** from one answer of the server.
   **What that answer holds, field by field, and nothing else:**
   - the conversation's id, and the other person's name as this person knows them;
   - the messages on this stretch, oldest first: for each its number, whether it is this
     person's own, its time, and its words exactly as written;
   - whether earlier messages exist and which number "Show earlier messages" asks for;
     whether this stretch stops short of the latest;
   - when there are no messages, the sentence for that ("No messages yet." / "No messages
     remain. Messages are deleted 12 months after they were sent.");
   - the box: either that it is open (with its label, the longest length, the line "Calls and
     payments for them stay on Connect." and "Read the rules"), or the sentence why this
     person cannot write;
   - the booking button, when there is one (decision 13);
   - for a customer only, and only on the website's condition: his switch for this host, as
     the button's words, its explanation, and the position a press would put it in (on or
     off), which the app sends back as it is (decision 12);
   - the "Block" button with its question, when it is offered (decision 11);
   - "Report", the word beside each message of the other person;
   - what the app may report as shown (decision 8);
   - the sentences the app needs when the server cannot be reached (decisions 7 and 9);
   - a notice about what was just done, in the answer to a press.

   **Never in an answer:** an id of a person; the other person's "shown" mark; whether the
   other person switched this one off or blocked them; the facts the rules decided by; the
   rules' own name for a refusal; a message's once-only key. A host whom the customer blocked
   and a host whom he switched off outside a call get answers that are alike field for field
   (the same sentence, the same buttons), also in the answer to a message sent a moment too
   late, and also when the host's own account is paused.
   **Two shapes, not one.** The switch and block answer with the conversation, held to the
   list above. Sending answers with a small shape of its own: "sent", the key the sender
   himself just sent, and the message's number; or the refusal's sentence. That is the only
   place a key appears, and only ever the sender's own, back to him.
   "Read the rules" opens the rules page the way the app's report form does today; when
   part 18 gives the apps their own rules page, it opens that. *(27 November: the rules
   page speaks about projects, contributions, tips and diary posts, and how the apps may
   lead to legal text at all is part 18's open decision 5. This link is one more such
   place and waits for that answer like the others; until then the screen names the rules
   without a link.)*

7. **It stays fresh the website's way: the screen asks again 5 seconds after the last answer
   came,** only while it is the screen in front and the app is in front.
   - **One question at a time.** The next is asked 5 seconds after the last one ended (with
     an answer, or with none). So a slow connection gets its answers; they are not thrown
     away because a newer question has already gone out.
   - **A press has its own answer.** Send, the switch and block each wait for their own
     answer, which no reading can replace. A reading that was begun before a press was
     answered is thrown away, and a fresh one is asked after the press.
   - A locked phone, another app in front, another screen over it: no asking. Coming back
     asks at once. An answer that arrives after the screen was left, the app went to the
     back, or someone else signed in, is thrown away.
   - **The server cannot be reached:** what is on the screen stays, with one quiet line
     saying it may be old (the line came with the conversation).
   - **The server says no** (nobody signed in, the copy too old, messages off for the apps,
     not found): the messages and the buttons are taken off the screen at once, and the app
     does what it does everywhere for that answer.
   - A stretch asked for with "Show earlier" that holds nothing is answered with the latest
     stretch, as the website does.
   *Known and accepted:* each asking sends the whole stretch again (usually the latest 50
   messages), as the website's page does. It is small next to a video call. Sending only what
   is new would be a second way of reading, with its own mistakes to make; it is not built.

8. **"Shown" means what it means on the website: the stretch was put on a screen that was in
   front.** With each answer the server says either "you may report this stretch as shown:
   from number A to number B", or that the app may not (an unshown message lies before the
   stretch).
   - The app reports A and B back once it has put that stretch on the screen, opened at its
     newest message, while the screen and the app were in front. Not for a screen in the
     background, not for an answer that arrived after the phone was locked. As on the
     website, it is not asked whether the person scrolled up to every older line of the
     stretch.
   - **What the server checks when the report arrives:** A and B are whole numbers with
     1 ≤ A ≤ B, and B is not higher than the conversation's last message (a higher B is
     refused, not cut down to a newer message); and the website's question again: is there a
     message this person has not been shown that lies before A? If so, nothing is marked.
     Only the signed-in person's own mark is ever moved, and only up.
   - A message that arrives after the answer has a higher number than B, so it stays "New".
   - **What is trusted, said plainly:** that the phone reports the stretch the server gave
     it. The server does not keep a record of which stretch it sent to which phone, so it
     cannot prove that. The mark is a person's own: it decides which of their own
     conversations say "New" to them and whether their own phones are still told about a
     message (decision 19); nobody else gains or loses by it. The website trusts the
     browser's number in the same way. *Not taken from Astra's first check:* a signed slip
     from the server that would prove the stretch; Astra's second check agreed that it can
     be left out if the trust is said openly.

9. **Writing.** The box is always there while the screen is, open or not.
   - **One key for one message.** The phone makes a once-only key from its secure random
     numbers (if the app has no such source yet, Expo's own small building block for it is
     added; checked first when this is built). A weak source will not do: the server answers
     "sent" when a key and its words are both already there, so two messages with the same
     words must never share a key by accident. The key stays the same until the server has
     confirmed that very key, or until the words are changed.
   - **One send at a time.** While a send waits for its answer the button cannot be pressed
     and the words cannot be changed.
   - **"Sent" is believed only from an answer that names the same key** and the message's
     number. Then, and only then, the box is emptied, and the conversation is read afresh.
   - **Not known.** No connection, the time limit, an answer that cannot be read, or the
     server stumbling in a way it did not foresee: the message may or may not have been
     saved. The app says so ("We could not confirm that this was sent. Press Send again: it
     will not be sent twice."), keeps the words and the key, and keeps the "Send again"
     button **also when the conversation has closed meanwhile**. Pressing it can never make
     a second message: for the same person, conversation, key and words, the server looks
     for the saved message before it looks at the rules, and answers "sent" again if it is
     there.
   - **Only "sent" with the same key ends "not known".** A refusal of a later try says why
     *that* try was not taken. It does not prove that the first try failed: the first try
     can still be on its way and be saved a moment later (for example when the later try
     ran into "wait a minute" and the first one did not). So after "not known" the app never
     says "not sent". A refusal's sentence is shown beside the standing "could not confirm"
     line, and the messages above, read afresh, show whether it arrived. "Not known" also
     ends when the person changes the words (a new message with a new key) or leaves.
   - **When the gate says no to a try or a reading** (signed out, the copy too old, messages
     off for the apps, not found): the screen is taken away as decision 7 says. Nothing is
     said about sent or not sent.
   - **Refused by the rules on a first try** (who may write, a limit, too long, empty), with
     no "not known" before it: it is known that it was not sent. The words stay, with the
     server's sentence, the same one the website gives (except the one sentence of
     decision 13). The conversation is read afresh, so the screen shows how it now stands.
     If it is closed, the words stay to be copied, under "What you wrote was not sent. You
     can still copy it."
   - **Nothing is sent later, and nothing is sent by itself.** Every try is a press.
   - **Leaving the screen, signing out, or the sign-in running out** loses what was typed.
     The app makes every screen anew when the signed-in person changes, and it keeps nothing
     of a conversation on the phone (decision 15). The website keeps a draft over a sign-in
     that ran out; the app does not. On a phone the sign-in is kept alive while the app is
     open, so this is rare.
   - The server counts a message's length (2,000 characters) and refuses a longer one with
     its sentence. The app stops typing at about that length as the website's box does; the
     server's count is the one that decides.

10. **"Write to …"** appears on a request that was accepted (part 06/07's screen), by the
    website's own condition, in a new field the server adds to that screen's answer. Pressing
    it names the call; the server works out the two people from it (`openConversation`),
    answers the conversation's id, and the app goes to its screen. A refusal says "You cannot
    write to this person right now." and makes nothing. As on the website, a conversation
    that already exists is opened for its two people whatever has happened since: reading is
    never taken away, and whether one may write is the rules' business.
    **Not built here:** the host's way from Contacts, which names a customer. It has nothing
    in the app to press until part 17, and part 17 will say how the app names a contact. It
    is built with part 17, and the button on the page after a call with part 10; or with this
    part, for whichever of them is built before this part is (decision 20: the later of the
    two builds what joins them).

11. **Block** on the conversation's screen, with the question the app asks first, in the
    words blocking already has in the app (`BLOCK_WORDS`). The server blocks the other person
    of that conversation and answers with the conversation as it now stands and what was
    done. **The button is offered** to someone who has not blocked the other person, and
    again, on every reading, for as long as a call between the two still stands that
    blocking could not cancel: the same question the request's screen asks today, moved into
    one shared function. A host's list of requests held by the app is told to read itself
    afresh whenever a block or a report was sent from the app, whatever became of the answer
    (`blockSent`, part 07).

12. **The customer's switch for one host** ("Stop messages from Hana between calls" / "Allow
    messages from Hana again"), shown on the website's condition, moved through `setMuted`.
    The press sends the position the server named (on or off), never "the other one", so
    the same press sent twice ends in the same place. The answer is the conversation again
    with what was done. Only the customer of the conversation is ever told that the switch
    exists.

13. **The way to book leads into the app, in neutral words.**
    - *When there is a button.* The server offers "Book a time with Hana" to the customer of
      a conversation exactly when she has an **ordinary offer** (her page is approved and
      not hidden, her account open and not paused, lengths and weekly hours set: the
      website's `offerOf`, the first half of its `bookHrefFor`), and, as `viewFor` asks
      today, no block stands between the two and no old "End call and report".
    - *What the button promises:* it opens her page in the app (part 05). It does not promise
      a free time. As when he finds her through Search, the page may say that there are no
      times right now or that she is not taking calls, and a paused customer is refused when
      he tries to book. The website's button promises no more.
    - *The member's way does not count yet.* A member of a host whose page is hidden from the
      public can book on the website. In the app a member's times cannot be chosen until
      part 13, so until then there is no button for that case. **Only where the rules'
      answer is "book again"** (the customer's 7 days are over) does that turn the sentence
      into "This conversation is closed.": plan 49's own rule for a customer with no way to
      book (its decision 11). Everything else is untouched: while he may still write to her
      the box is open, and a block, a pause or a switch is said first, as always. Part 13
      changes this one function when it is built.
    - *The same answer for a message sent too late:* the one function decides both.
    - *One sentence is worded differently in the app.* On the website a customer whose
      7 days are over reads a big button, "Book a call to write to Hana again". In the app he
      reads the sentence "You can write to Hana again around your next call." and the
      ordinary button "Book a time with Hana". The reason is in "Keeping the 4.9%": the
      website's words can be read as "pay to unlock messages", which is the kind of sale a
      store claims its cut on. The rule is the same; only the words differ.

14. **A report from a message, and what comes after any report.**
    - "Report" beside each message of the other person opens the app's report form with a
      fourth place, a message (`<conversation>/<number>`), on the very function the website
      uses. So the report keeps its copy of the messages around it, and it blocks the person.
    - **When it works** (the report form's address, which is not under the switches of
      decision 3): for anyone signed in with the terms accepted, paused or not; with messages
      off for everyone; with messages off for the apps; and from a copy of the app that
      became too old while the form was open. (A copy that is already too old when it is
      opened shows only "please update", as today, so nobody reaches a message in it.) The
      report form's answers hold no message and no conversation.
    - **The receipt comes to the app.** Today the app shows one sentence after a report and
      "Done" leads Home. When the website would show its receipt (the block is not there, or
      nobody could find out, or a call could not be cancelled), the app now gets the report's
      number too and shows the same: the sentence, and a "Block" button that blocks the
      person that report was about (the website's `blockReportedAction`, as a shared function
      behind a new address). This is for all four places a report can come from, so it also
      mends what is missing today after a report from a host's page. A press on "Block"
      never makes a second report. The answer only grows: a copy of the app that does not
      know the new field shows the sentence as before.
    - **The receipt's "Block" address** is gated like the report form itself: anyone signed
      in with the terms accepted, a copy that has become too old included. On every press
      the server looks up afresh whose report that number is (`reportedOf`, for the person
      signed in now); someone else's number is not found. It answers with one sentence and
      nothing else.
    - **Afterwards** "Done" leads, for a report from a message, back to the conversation if
      it can still be read; otherwise to Messages if the app has that place right now;
      otherwise Home. For the other three places it leads Home, as today. Where the app must
      show "log in" or "please update" instead, it does, as everywhere.

15. **On the phone itself.**
    - **Nothing of a conversation is written to the phone's storage:** no messages, no draft.
      Everything on the screen is what the server just said, and it is gone when the screen
      is. When somebody else signs in, or the person signs out, every screen is made anew
      and whatever a conversation's screen held is dropped.
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
    | `GET /api/app/conversations` | the list, and the person's own switch for alerts | `conversationsOf` |
    | `GET /api/app/conversations/count` | the number for the bottom bar | `newConversationCount` |
    | `POST /api/app/conversations` | "Write to …" from a call: answers the conversation's id | `openConversation` |
    | `GET /api/app/conversations/[id]` (with `from`) | one conversation | `viewFor` |
    | `POST /api/app/conversations/[id]/send` | sends a message; answers its key and number | `sendMessage` |
    | `POST /api/app/conversations/[id]/shown` | "shown from A to B" | `markShownUpTo`, after the check of decision 8 |
    | `POST /api/app/conversations/[id]/mute` | the customer's switch | `setMuted` |
    | `POST /api/app/conversations/[id]/block` | blocks the other person | `block` |
    | `POST /api/app/conversations/alerts` | the person's own switch for alerts (decision 19) | new, one column |
    | `/api/app/report` (there already) | a fourth place: a message | `sendReportFor` |
    | `POST /api/app/report/saved/[reference]/block` | "Block" on a report's receipt | the website's receipt function |

    Nothing an answer holds is kept by anything on the way (the door's rule).

17. **What changes on the server besides.** None of it changes what the website does:
    - The sentence for a refused message moves from the website's action code into one
      shared function.
    - The sentences that today live inside the website's page and box move into `words.ts`,
      and the app's own sentences of decisions 5, 7 and 13 are added there.
    - "Can he book her the ordinary way" (decision 13), "does a call between the two still
      stand after a block" (decision 11) and "block the person of this report"
      (decision 14) each become one shared function.
    - The report's place check accepts a message's place; the report's answer to the app
      grows by the receipt.
    - The request's answer to the app grows by "Write to …"; what the app is told on opening
      grows by the new switch. **Answers that copies of the app already read only grow:**
      nothing in them is renamed, removed or given a new meaning, and no sentence or refusal
      code they carry today changes.
    - The founder's switches get the new line (one migration), and the founder's page its
      button.
    - `mayWrite` and the other rules are not touched. `sendMessage` is touched in one place
      only, and only when notifications exist (decision 19).

18. **When the server stumbles in the middle of a send** in a way it did not foresee, the
    app's address for sending never answers "not sent". It answers without a sentence (the
    report form's address does the same today), and the app treats that as "not known"
    (decision 9): the words and the key are kept, and pressing Send again is safe.

### The notification

19. **"A new message" joins part 12's list of what becomes a notification.** It is built
    with part 12 or with this part, whichever is built second; until then the apps have
    messages without it, as the website does. The address the app asks when an alert is
    touched is part 12's; this part only says what it must answer for a message.
    - **What it says:** "You have a new message." Nothing else: no name, no words of the
      message (part 12, decision 4). Two numbers travel with it to Apple or Google, both made
      up by Connect and meaning nothing outside it: the notification's own, which the app
      hands back when it is touched; and one that stays the same for this phone and this
      conversation, so that a newer alert can take an older one's place. Neither is the
      conversation's id or a person's.
    - **Where it is written.** In `sendMessage`, in the same database step as the message,
      on the branch where a new message was really saved (not where an earlier press is
      answered again), for messages sent from the website and from the app alike. Nothing is
      sent to the outside from there; that is the helper's work, as for every notification.
      The order of locks stays: the two calendars, the conversation's row, then the
      notification's row. The helper never waits for a calendar or a conversation while it
      holds a notification's row.
    - **One waiting row per phone and conversation.** For each installation of the app that
      the other person is signed in on and that allows notifications, there is at most one
      row "waiting" for this conversation. It carries the number of the newest message it
      stands for. A further message while it waits moves that number up, in the same step,
      and writes no second row. Once the helper has taken a row to send it, the row is no
      longer "waiting": a later message writes a new one. A late word from the outside
      service about a row settles that row only.
    - **Checked again right before it is handed over** (part 12, decision 3), against the
      row's newest message: is that message still there (messages are deleted after
      12 months, and the conversation stays); is this installation still signed in as that
      person, with the sign-in the row was written under; has the person not yet been shown
      that message (on the website or in the app); is there no block between the two, in
      either direction; is the person's account open; are messages on for the apps; does the
      person want these alerts. If any answer is no, nothing is sent. (Because the row
      carries its newest message, a person who has read up to an earlier one is still told
      about the later one.)
    - **Signing out** is part 12's decision 8: when the server learns of a sign-out, or that
      the phone now belongs to another sign-in, the registration and its waiting rows end.
      *What that cannot cover:* a phone can sign out while it cannot reach the server; the
      server then does not know, and an alert can still be handed over afterwards. And an
      alert already handed to Apple or Google can always still arrive. That is why the alert
      says nothing, and why:
    - **Touching it** asks the server what that notification was for, through the gate like
      every address of this part (signed in, the copy not too old, messages on for the
      apps). The server answers only the conversation's id, and only if the person now signed
      in is the one the alert was written for. Being one of the conversation's two people is
      not enough: the next person on that phone could be the other one. The messages
      themselves are then read through the conversation's own address, with all its checks.
    - **An ordinary notification,** not the urgent kind of a "call now" request. On Android
      a channel of its own, "Messages", so a person can quieten it by itself. The phone is
      asked to keep one line per conversation, a newer alert taking the older one's place
      (each kind of phone has its own field for that), and the app takes the line away when
      the conversation is opened, where the phone lets it. A delayed alert can still show up
      afterwards.
    - **A person's own switch,** "Tell me about new messages on my phone", on at first, at
      the foot of the Messages list; one column on the person, read with the list and moved
      through its own address. On an iPhone there is no way to quieten one kind of
      notification of an app; without this switch a person tired of messages would switch off
      all of Connect's notifications, the "call now" alert included.
    - **While the app is in front** the phone shows no banner for a message. The number on
      Messages is asked again instead, and a conversation that is in front is read at once.
    - **Asking for permission** (part 12, decision 6) gets one more moment: after a person
      sends their first message from the app, if they were never asked.
    - A notification is not promised to arrive, and may arrive twice (part 12, decision 7).
      Nothing here depends on it: it is a nudge, and the message waits in the list either way.
    - *The five-in-a-row limit of plan 49 does not replace any of this:* it starts again with
      every answer and every newly agreed call.

### Building it

20. **Order.** This part needs only parts 01 to 09, which are built. It can be built as soon
    as the pause ends, before or after any later part. What it shares with later parts is
    said above: the button on the page after a call (part 10) and on Contacts (part 17), the
    member's way to book (part 13), the apps' own rules page (part 18), and the notification
    (part 12), each built with whichever part comes second.

## Keeping the 4.9%

21. Messages take no money. **What is certain, and what is a risk a store's review decides:**
    - *Certain:* nothing in this part takes a payment, and no word or link written by Connect
      points to paying on the website. The button to book leads to the app's own host page,
      where a one-to-one call is booked as everywhere in the app (the kind of sale both
      stores leave to an app's own payment, plan 39).
    - *A risk, and what is done about it:* words that make booking look like the price of
      writing. That is why the app does not say "Book a call to write to Hana again"
      (decision 13). Messages are free; a call is what is paid for; the notes for the
      stores' reviewers (part 20) say so in those words.
    - *A risk that stays:* what people write. A host can type "pay me on my website". The app
      turns nothing in a message into a link and changes no word of it (plan 49 keeps a
      person's words as written), but it cannot stop the sentence. The line beside the box
      says "Calls and payments for them stay on Connect."; the rules forbid taking calls and
      payments elsewhere; such a message can be reported like any other (the report form
      already has the reason "Asked to pay outside Connect."), and the founder acts on the
      report. This is told to the reviewers too. It is not claimed that a store
      will be content with it.
    - The notification says "You have a new message." and sells nothing.

## What a store may ask

Read on 27 November 2026 (sources at the end). None of this is known for certain until a store
has reviewed the app.

- **Apple (rule 1.2)** asks an app in which people write to each other for: a way to report
  and **timely answers to reports**; a way to block; contact information people can find; and
  "a method for filtering objectionable material from being posted". The app has report and
  block on the conversation's screen, and with this part the support address on the Messages
  screen. Three things are open, all the founder's:
  - **A real support address** (today it is a placeholder) and **who reads reports, and how
    fast.** Today that is the founder alone.
  - **No filter on what is written.** Reports, blocks, the limits and the founder's look at
    reported messages are what Connect has. No exception for messages between two people who
    had a call was found in Apple's rules. Building a filter is not planned here; it would be
    a plan of its own.
  - **The switch of decision 3 is a way to take messages out of the apps at once,** not a
    promise that Apple then approves, or approves without the app being sent in again.
    Reviewers are told about messages and about the switch.
- **Google** asks that people accept the terms before they can write (they do: "18 or older
  and the terms" comes before everything), that the terms say what is not allowed (the rules
  page does), that reports are acted on, and that reporting and blocking are inside the app,
  easy to find and clearly named, wherever one person can write to another. This part has
  both on the conversation's screen, as two separate, named buttons.
- **Apple (rule 4.5.4):** an app must work without notifications (it does); nothing
  sensitive or confidential may travel in one (Connect's own rule is stricter: nothing about
  the person at all); and advertising by notification needs a person's clear
  yes inside the app and a way out. The alert here is not advertising: it says only that a
  message is waiting. Its switch being on at first is not such a yes, and is not meant as
  one.
- **The stores' forms** (part 20): with this part people's messages are something the app
  collects. Apple's privacy form has "Emails or Text Messages" for it; Google's has "Other
  in-app messages". The age rating's questions about writing between users are answered yes.

## How it is tried

- **The website's own checks stay green and untouched:** `conversation-check` (163 checks),
  `journey-check`, `safety-check`.
- **A new check script, `app-conversations-check`,** asking as the app does (signed in the
  app's way, through the gate). Where it compares the app with the website it uses two sets
  of people made alike, one for each, because sending and blocking change what they touch.
  - *The gate:* no app header, nobody signed in, email not confirmed, terms not accepted, a
    copy too old, the apps' switch off (every address under `/api/app/conversations` refused,
    the website unchanged, and a report from a message still going through), someone else's
    conversation and one that does not exist (the same answer), a closed account (nobody) and
    a conversation with a closed account (the rules' sentence).
  - *The list and the number:* the website's order, the website's name for each role, a
    conversation with no message not listed, the number equal to `newConversationCount`.
  - *One conversation, for every state the rules know* (around a call; a host waking a quiet
    one; a customer inside and outside the 7 days, made with a host's message dated so that
    the 7 days run out a few seconds later, as `conversation-check` does; switched off by the
    customer; blocked each way; paused; closed accounts; the host's page not public; messages
    off for everyone; an old "End call and report"): the same sentence as the website's page,
    except the one of decision 13; the box exactly when the website offers it; a booking
    button exactly by decision 13, a member-only way included.
  - *What an answer may hold:* each answer, to a reading and to a press, is checked field by
    field against the list of decision 6. The fields that could carry a person's id, an
    account name where a host name belongs, the other person's mark, or the rules' name for a
    refusal are checked; a message's own words are not searched. A host blocked by her
    customer and a host switched off by him, outside a call, get answers alike field for
    field, for a reading and for a message sent a moment too late, also when she is paused.
  - *Sending:* goes through, and the answer names the key; the same key and words again give
    the first answer and one message, also after the conversation has closed; the same key
    with other words is refused; every limit; too long; empty. A refusal's sentence equals
    the website's, except for a customer whose 7 days are over: there the app's own sentence
    of decision 13 is expected, and "This conversation is closed." where he has only a
    member's way to book. **An answer lost after the message was saved:** the script sends,
    throws the answer away, and sends again. **A later try that is taken up before the first
    one:** the later try is refused by a limit, the first is then let through, and the
    message is there; so a refusal after "not known" proves nothing, as decision 9 says.
  - *"Shown":* a stretch the server allowed is marked; a report whose A lies after an unshown
    message marks nothing (a 500-message stretch with a gap before it); a B higher than the
    last message is refused; A above B, zero and words instead of numbers are refused; never
    down; only the person's own mark moves; a message that arrives after the answer stays
    "New".
  - *The switch:* only the customer of that conversation can move it, and only he is told of
    it.
  - *Block from a conversation:* the block is there, the calls between the two are
    cancelled, the conversation says so; with a call that could not be cancelled the button
    is still offered on the next readings.
  - *Report from a message:* the report exists with its kept copy, the person is blocked; a
    message of one's own, one that is gone and someone else's conversation are refused alike;
    it works for a paused person, with messages off for everyone, and with the apps' switch
    off. Each outcome the website knows after a report (blocked; blocked but a call stands;
    blocked but unsure about the calls; not blocked; not known) gives the app the website's
    sentence and, where the website has a receipt, the receipt; "Block" on it blocks and
    makes no second report; someone else's receipt is not found.
  - *"Write to …":* from a call of one's own; from someone else's call (refused, nothing
    made); a conversation that exists is opened though writing is no longer allowed.
  - *What copies of the app already read:* the app's own readers of today (the checks in
    `mobile/src/lib/*-rules.ts` that decide whether an answer can be used), kept as they are
    at the commit this part starts from, are run over the new answers on opening, of a
    request and of a report: each must still take them. (From the moment a copy is in a
    store, part 20's rule asks this for the oldest copy still allowed.)
- **Tests in the app** for what the app decides by itself, with a stand-in for the server
  that can lose one answer after "saving": when a key is kept and when a new one is made;
  that "sent" is believed only with the same key; that "not known" survives a reading, a
  closing and a refusal of a later try, and ends only with "sent" for the same key (or new
  words); one send at a time; one
  reading at a time, and a reading begun before a press never replaces the press's answer;
  "shown" not reported for a screen in the background; a missing switch on opening hides
  Messages.
- **On the Android test phone, with pictures,** two people (one on the phone, one on the
  website): the list and its number; writing both ways and seeing the other's message arrive
  within a few seconds; a conversation whose 7 days are over (prepared as in the check
  script) with its sentence and the button leading to the host's page; the customer's switch;
  block; a report from a message, then the founder's page showing the kept copy (an ordinary
  report has no receipt; the receipt is shown once on the phone from a prepared case in
  which a future call between the two cannot be cancelled, and its other outcomes are left
  to the check script); a send with the connection cut beforehand (how "could not confirm"
  looks; that it is *right* is proved by the tests above, since the test phone reaches the server over a cable
  and an answer cannot be lost on purpose there); the screen left open and the phone locked,
  a message sent from the website, and the website's side showing it still "New" for that
  person **while the phone is still locked**.
- **The notification** (when part 12 exists): `notifications-check` grows by this kind: one
  waiting row per phone and conversation; a second message moves its number and writes no
  row; a message after the helper took the row writes a new one; two phones; a person shown
  only the earlier message is still told; nothing after the newest was shown, after the
  message was deleted, after a block in either direction, with the alert switched off,
  signed out, or the apps' switch off; two alerts for one conversation on one phone carry the
  same replacing number and different numbers of their own; a
  message that was not saved after all leaves no row; the same press again writes none; the
  text holds no name and no word of the message; touching it as the conversation's *other*
  person opens nothing, and so does touching it with the apps' switch off or from a copy
  that is too old. On the test phone a notification made by the phone itself shows how
  it looks, and no more than that.

## What cannot be tried here

- A notification that really travels from the server to a phone, and whether a newer one
  really takes an older one's place on each kind of phone (needs the founder's Google
  account; an iPhone needs Apple's membership).
- An iPhone at all, until the iPhone build exists (part 20): the keyboard over the box, the
  bottom bar's number, the banner while the app is in front.
- What Apple and Google say to messages in the app. Only their review shows it.
- Many people writing at once on real mobile networks.

## Found on the way

- **The website's box has a small weakness of its own.** After an answer that never came, if
  the conversation closes before the person presses Send again, the box reads "What you wrote
  was not sent. You can still copy it." and has no button. The message may have been sent.
  The app does this right from the start (decision 9). For the website it is a small change
  of its own, proposed, not part of this plan.
- **After a report from a host's page the app has no way to block** when the report's own
  block failed. Decision 14 mends it.

## Not in this part

- **"From Connect": what Connect itself wrote to a person** (plan 47's notices about a bank
  dispute, money owed back, and the like). On the website it shares the Messages page. In the
  apps most of those notices point to pages the apps do not have (a dispute's page, part 16c
  as proposed). It is proposed as a small part of its own once those pages are decided. Each
  such notice is also emailed, so nobody misses one meanwhile.
- **A filter on what is written** (see "What a store may ask").
- **A host's "Write to …" from Contacts** (part 17) and **from the page after a call**
  (part 10).
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
  3. **In the app the closed conversation does not say "Book a call to write to Hana
     again"** (your words for the website) but "You can write to Hana again around your next
     call.", with the ordinary button "Book a time with Hana" (decision 13). The other way
     would have been your words in the app too, with the risk that a store reads them as
     selling messages. **Settled on 27 November 2026:** the founder was asked and left it to
     the builder ("do what you think is the best"); the neutral words stay. The website
     keeps its words.
  4. A person's own switch for message notifications, on at first (decision 19).
  5. The apps' own switch for messages, born on (decision 3).
  6. "From Connect" is not in this part.
  7. Nothing of a conversation is kept on the phone, so a draft is lost when the screen is
     left; screenshots are allowed (decisions 9 and 15).
- **Only the founder can do:** a real support address; say who reads reports and how fast;
  the store accounts.

## Astra's check

**First check, 27 November 2026: "not ready", 16 points.** What was done with each:

1. *A send whose answer was lost could later be called "not sent", and a weak key could make
   a different message count as sent.* Decision 9, rewritten: a secure key, one send at a
   time, "sent" only with the same key, and "not known" stays until "sent" comes back for
   that key (made stricter after the second check, below).
2. *The app's "shown" address could not hold what it promised.* Decision 8: the server asks
   the gap question again. Not taken: a signed slip (said there, with the reason).
3. *The apps' switch and reporting contradicted each other.* Decision 3's table, decision 14.
4. *"No person's id" was not enough to keep what the website hides.* Decision 6: the answer
   field by field, and the test that two answers are alike.
5. *"Would the app's host page let him book" was not something the code can answer.*
   Decision 13: the ordinary way only, from the website's own function; a member's way waits
   for part 13 and reads "closed" meanwhile.
6. *The 4.9% claim was too strong.* Decisions 13 and 21: neutral words in the app, and what
   stays a risk is said as one; "Read the rules" has its place (decision 6).
7. *A second message could lose the only alert.* Decision 19: the waiting row carries its
   newest message.
8. *Where the alert is written.* Decision 19: in `sendMessage`'s own step; decision 17 now
   says so; the order of locks.
9. *Signing out, touching an alert, the person's switch, one line per conversation.*
   Decision 19, and the switch has its column and address (decision 16).
10. *The store section left things out.* Rewritten: timely answers, the support address, who
    reads reports, what the switch does not promise, the forms.
11. *After a report whose block failed, the app had no way to block.* Decision 14 (the
    receipt), decision 11 (the button comes back while a call stands).
12. *A draft cannot outlive the sign-in in this app.* Decision 9 no longer promises it;
    decision 7 says what is taken off the screen and when.
13. *"Only the newest question counts" starves a slow connection.* Decision 7: one question
    at a time, and a press has its own answer.
14. *Some of the proof could not prove what it claimed.* "How it is tried", rewritten.
15. *Answers that copies of the app already read; three wrong statements about today's
    code.* Decision 17; "What is there today" corrected.
16. *The host's "Write to …" by naming a customer has nothing to press yet.* Decision 10:
    left to part 17.

**Second check, 27 November 2026: "ready with changes", 8 points, all worked in.** Astra
found ten of the first sixteen settled, and agreed with the four things that were left out
on purpose (no signed slip for "shown", if the trust is said openly; a draft may be lost
with the sign-in; reports about paying elsewhere go the ordinary way; no filter is planned
and that stays an open question for the stores).

1. *A refusal of a later try does not prove the first try failed* (the first can still
   arrive). Decision 9: after "not known", only "sent" with the same key settles it; the app
   never says "not sent" then. A gate refusal takes the screen away and says nothing.
2. *The check of "shown" promised more than it can hold.* Decision 8 now says what is
   checked (the numbers, the gap) and what is trusted (that the phone reports the stretch it
   was given), and that "shown" means what it means on the website.
3. *An ordinary offer is not a free time, and "closed" belongs only where the answer would
   be "book again".* Decision 13.
4. *One number cannot both name a single alert and replace older ones.* Decision 19: two
   numbers; touching goes through the gate and answers only the conversation's id.
5. *A deleted message, and signing out without a connection.* Decision 19.
6. *"Done" after a report could lead to a place that is not there; the receipt's gate.*
   Decision 14.
7. *The key in an answer, the switch's position, the closed account's sentence.* Decisions
   4, 6 and 12.
8. *Three checks expected the wrong thing.* "How it is tried".

**CodeRabbit (pull request 118, 27 November 2026):** it had reached its limit of reviews
("next included review available in 31 minutes"). By the standing rule it was not waited
for: the builder read the whole change once more instead. Found and put right: a jump in
the numbering of the decisions (18 was missing; the sentence about a send the server
stumbles over is decision 18 again), one note of the first check that the second check had
overtaken, and a line that named no address for a touched alert.

## Sources

- Apple, App Review Guidelines (rules 1.2, 3.1.3 and 4.5.4):
  https://developer.apple.com/app-store/review/guidelines/
- Apple, what an app's privacy form asks: https://developer.apple.com/app-store/app-privacy-details/
- Google Play, User Generated Content:
  https://support.google.com/googleplay/android-developer/answer/9876937
- Google Play, the Data safety form:
  https://support.google.com/googleplay/android-developer/answer/10787469
- Expo, sending notifications (the fields for one line per conversation):
  https://docs.expo.dev/push-notifications/sending-notifications/
