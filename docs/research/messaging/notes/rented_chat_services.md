# Rented (hosted) chat services for one-to-one customer-to-host messaging — November 2026

All pricing pages were read on 2026-11-14 unless stated. Most pricing pages show no "effective date"; where a page did show one it is noted. Vendor blogs and comparison posts are marked as vendor-written (biased). Items marked "background knowledge, not re-verified" come from the researcher's prior knowledge and were not confirmed by a source in this session.

## 1. Current pricing (free tier, cost at ~100 / 1,000 / 10,000 MAU, startup plans)

### Takeaway
Only Stream (free Build plan, 1,000 MAU; free Maker plan, 2,000 MAU if eligible), PubNub (free, 200 MAU), Ably (free, 500 MAU), Pusher (free Sandbox, by connections not MAU), Supabase (free) and LiveKit (free Build) let a live app run at $0. TalkJS and CometChat free modes are development-only: going live costs $279/mo (TalkJS) or from $239/mo (CometChat). The full chat products (Stream, Sendbird, TalkJS, CometChat) all land around $240–$600/mo at 10,000 MAU. The cheapest per-MAU options at 10,000 MAU are Ably (about $480/mo, an estimate) and the build-it-yourself backends (Supabase from $25/mo, Pusher from $49/mo), but those need the chat features built by hand.

### Cited Findings

**Stream Chat** — pricing page https://getstream.io/chat/pricing/ (read 2026-11-14, no date on page)
- Build (free): $0, 1,000 MAU, 100 concurrent connections, 1M API calls, 10 GB bandwidth, no credit card, community support only — [Stream pricing](https://getstream.io/chat/pricing/)
- Start: $399/mo billed annually or $499/mo monthly; 10,000 MAU, 500 concurrent, up to 5M stored messages; overage $0.09 per MAU, $0.99 per concurrent connection, $5 per 1M stored messages, $7 per 1M API calls above 2M — [Stream pricing](https://getstream.io/chat/pricing/)
- Elevate: $599/mo annual or $675/mo monthly; 10,000 MAU, 10M stored messages — [Stream pricing](https://getstream.io/chat/pricing/)
- Maker Account: free if the company has 5 or fewer team members, less than $100k funding raised, and less than $10k monthly revenue; Chat is a "modified Chat Start Plan" capped at 2,000 MAU and 100 concurrent connections; includes $100/month AI Moderation credit; "hard limits" to avoid surprise bills; "availability is limited!"; you apply from the dashboard — [Stream Maker Account](https://getstream.io/maker-account/)
- The pricing page itself words the Maker condition as fewer than 5 people and under $10k monthly revenue, slightly different from the Maker page — [Stream pricing](https://getstream.io/chat/pricing/); [Stream Maker Account](https://getstream.io/maker-account/)
- Cost at 100 MAU: $0. At 1,000 MAU: $0 (Build) — but only 100 concurrent connections. At 10,000 MAU: $399–$499/mo (Start). (Derived from the figures above.)

**Sendbird** — pricing page https://sendbird.com/pricing/chat (read 2026-11-14)
- Free trial / Developer: free, no credit card, "no overages allowed"; FAQ says "the Developer plan is free and remains active as long as you log into the Sendbird dashboard once a year"; a feature table lists "Up to 1,000" MAU and "Up to 20" peak concurrent connections but does not tie these to a named plan — [Sendbird pricing](https://sendbird.com/pricing/chat)
- Starter 5K: $349/mo annual or $399/mo monthly; Pro 5K: $499/mo annual or $599/mo monthly — [Sendbird pricing](https://sendbird.com/pricing/chat)
- Higher tiers come from a table on the same page labelled "Latest Sendbird pricing (June, 2021)": Starter 10K $499, 25K $1,199; Pro 10K $749, 25K $1,799. These may be out of date (5 years old label) — [Sendbird pricing](https://sendbird.com/pricing/chat)
- Peak concurrent connections are capped at 5% of MAU on Starter/Pro (counted per device); overage rates are not published — [Sendbird pricing](https://sendbird.com/pricing/chat)
- Cost at 100 MAU: $0 (Developer, if the 1,000 MAU / 20 concurrent figures apply). At 1,000 MAU: $0 on Developer only if 20 concurrent devices is enough, otherwise Starter 5K at $349–$399/mo. At 10,000 MAU: about $499/mo (Starter 10K, 2021-labelled table).

**TalkJS** — pricing page https://talkjs.com/pricing/ (read 2026-11-14, no date on page)
- Basic: $279/mo, 10,000 MAU, $0.04 per extra MAU, 1 webhook, email notifications included, unlimited message retention — [TalkJS pricing](https://talkjs.com/pricing/)
- Growth: $569/mo, 25,000 MAU, $0.03 per extra MAU, 3 webhooks, custom notification emails, message search — [TalkJS pricing](https://talkjs.com/pricing/)
- "Forever free development mode" on all plans, but going live requires a card and checkout; test and live apps are fully separate — [TalkJS pricing](https://talkjs.com/pricing/)
- Cost at 100, 1,000 and 10,000 MAU: $279/mo in every case (no live free tier).

**PubNub** — pricing page https://www.pubnub.com/pricing/ (page metadata "last updated 2026-11-10")
- Free: $0 "forever free", 200 MAU or 1M transactions/month, whichever first; message persistence retained up to 7 days and 1 GB — [PubNub pricing](https://www.pubnub.com/pricing/)
- Starter: $98/mo, 1,000 MAU included, extra MAU charged proportionally (rate not stated); persistence up to 6 months — [PubNub pricing](https://www.pubnub.com/pricing/)
- Pro (annual commitment) estimates: 1k MAU $190, 5k $370, 10k $550, 25k $1,130, 50k $2,100/mo; "no per-message fees"; unlimited retention — [PubNub pricing](https://www.pubnub.com/pricing/)
- The page's own Pro formula does not exactly match its examples (e.g. formula gives $187 for 1k, page says $190) — [PubNub pricing](https://www.pubnub.com/pricing/)
- Cost at 100 MAU: $0. At 1,000 MAU: $98/mo (Starter). At 10,000 MAU: about $550/mo (Pro, annual) or Starter plus unknown proportional overage.

**Ably** — pricing page https://ably.com/pricing (read 2026-11-14, no date on page)
- Free: $0, up to 500 MAU, 1 month message retention, community support — [Ably pricing](https://ably.com/pricing)
- Pro: $29/mo (annual) for 1K MAU, 1-year retention; Business: $349/mo (annual) for 1K MAU; Enterprise custom with indefinite retention; Chat is covered by the same plans, and "the plan you choose never limits which products or features you can use" — [Ably pricing](https://ably.com/pricing)
- Ably moved to MAU pricing effective 2026-11-05 (third-party digest); existing accounts on resource-based pricing keep their terms — [AgentDeals digest 2026-w45](https://agentdeals.dev/digest/2026-w45)
- Ably docs list the MAU rate as $0.05 per user, possibly as low as $0.01 at volume (the $0.01 figure is from a docs mirror) — [Ably pricing docs](https://ably.com/docs/platform/pricing.md); [Mintlify mirror](https://mintlify.com/ably/docs/platform/pricing)
- Ably previously launched per-minute consumption pricing in October 2024 — [Ably blog, Oct 2024](https://ably.com/blog/new-ably-per-minute-consumption-pricing)
- Cost at 100 MAU: $0. At 1,000 MAU: $29/mo (Pro, annual). At 10,000 MAU: not shown on the page; see Inferences.

**Pusher Channels** — pricing page https://pusher.com/channels/pricing/ (read 2026-11-14, no date on page)
- Priced by messages/day and concurrent connections, not MAU: Sandbox free (200k messages/day, 100 connections); Startup $49/mo (1M/day, 500); Pro $99/mo (4M/day, 2,000); Business $299/mo (10M/day, 5,000) — [Pusher pricing](https://pusher.com/channels/pricing/)
- Cost at 100 and 1,000 MAU: likely $0 (Sandbox) if under 100 simultaneous connections. At 10,000 MAU: likely $49–$99/mo — but this buys only message delivery, not storage or chat features.

**CometChat** — pricing page https://www.cometchat.com/pricing (read 2026-11-14, no date on page)
- Build: $0, up to 100 users, 25 concurrent connections, "free for development"; "You must subscribe to a paid plan to go live" — [CometChat pricing](https://www.cometchat.com/pricing)
- Basic: $239/mo billed annually; Advanced: $359/mo billed annually (monthly billing about 20% more); MAU included "as per tier" (number not shown); overage $0.10 per MAU decreasing at higher tiers and $1 per concurrent connection; concurrency 5% of MAU — [CometChat pricing](https://www.cometchat.com/pricing)
- Enterprise "starts from 10k MAU"; if usage exceeds limits the account is automatically upgraded — [CometChat pricing](https://www.cometchat.com/pricing)
- Cost at 100 MAU live: $239/mo minimum. At 1,000 and 10,000 MAU: not determinable from the page.

**Supabase Realtime** — pricing page https://supabase.com/pricing (read 2026-11-14, no date on page)
- Free: $0, 200 concurrent Realtime connections, 2M Realtime messages/month, 500 MB database, projects paused after 1 week of inactivity, 2 active projects — [Supabase pricing](https://supabase.com/pricing)
- Pro: from $25/mo, 500 concurrent connections then $10 per 1,000; 5M messages then $2.50 per million; 8 GB disk — [Supabase pricing](https://supabase.com/pricing)
- Cost at 100/1,000 MAU: $0–$25/mo; 10,000 MAU: about $25–$35/mo. Supabase is a separate database/back end from the app's existing Postgres.

**LiveKit Cloud** — pricing page https://livekit.com/pricing (livekit.io redirects here; read 2026-11-14)
- Build: $0, 5,000 WebRTC minutes, 100 concurrent connections, 50 GB downstream; Ship from $50/mo (150,000 minutes, 1,000 concurrent); Scale from $500/mo — [LiveKit pricing](https://livekit.com/pricing)
- The pricing page does not mention data-packet, text-stream or chat pricing — [LiveKit pricing](https://livekit.com/pricing)

### Inferences
- Ably at 10,000 MAU: $29 for the first 1,000 plus 9,000 × $0.05 ≈ $480/mo, if the docs rate applies to the Pro plan. Not confirmed on the pricing page.
- The biggest "cliff" is Stream: $0 up to 1,000 MAU (2,000 on Maker), then the next plan is $399+/mo. There is no middle tier.
- TalkJS is the most predictable: a flat $279/mo from first live user up to 10,000 MAU.
- Concurrency caps matter more than MAU at small scale: Stream Build/Maker allow 100 simultaneous connections, Sendbird Developer only 20.

### Gaps
- CometChat's MAU count per tier (Basic/Advanced) is not shown on the page.
- Sendbird's 10K+ prices carry a "June 2021" label; current figures need confirmation from sales.
- PubNub Starter per-MAU overage rate is not published.
- Ably's paid price above 1,000 MAU is only on a slider not captured.

## 2. What each provides out of the box

### Takeaway
Stream, Sendbird, TalkJS and CometChat are complete chat products with ready React screens, stored history, unread counts, notifications, moderation, blocking and dashboards. PubNub and Ably sit in the middle (chat SDKs and storage, but less turnkey). Pusher, Supabase Realtime and LiveKit are delivery pipes only: the app must build storage, unread counts, notifications and moderation itself.

### Cited Findings
- Stream: moderation dashboard, role controls, message flagging, profanity filters, pre-send hooks, mute/ban, push notifications and webhooks on all plans including free; AI moderation (spam, image, semantic filters) is an Enterprise add-on on the pricing grid, though the Maker plan gives $100/month AI Moderation credit — [Stream pricing](https://getstream.io/chat/pricing/); [Stream Maker Account](https://getstream.io/maker-account/)
- Stream has a client-side `client.blockUser("bob")` / `unblockUser` / `getBlockedUsers` and a React guide for adding a block action — [Stream React blocking guide](https://getstream.io/chat/docs/sdk/react/guides/blocking-users/); [Stream moderation docs](https://getstream.io/chat/docs/javascript/block_user/)
- Sendbird: Starter includes "messaging essentials, basic moderation, analytics"; Pro adds translation, data export, image moderation, message search, auto-moderation and webhooks; push notifications are listed as essentials — [Sendbird pricing](https://sendbird.com/pricing/chat)
- TalkJS: drop-in chat UI, email notifications included on all plans, custom notification emails on Growth; the pricing page does not mention moderation or data export — [TalkJS pricing](https://talkjs.com/pricing/); [TalkJS vs Stream (vendor)](https://talkjs.com/compare/talkjs-vs-stream/)
- CometChat: rule-based, word/pattern, profanity, phone/email filters on all plans; AI moderation on Advanced and Enterprise (not Basic); email notifications (needs your own SendGrid account) and SMS (Twilio) on Advanced+; push on all; moderation webhooks on Advanced+ — [CometChat pricing](https://www.cometchat.com/pricing)
- PubNub: mobile push on all plans; BizOps Workspace (admin/moderator tools) is a trial on Free, add-on on Starter, included on Pro; the pricing page does not mention a chat UI kit — [PubNub pricing](https://www.pubnub.com/pricing/)
- Ably: Chat is a listed product with message history (1 month free, 1 year Pro) — [Ably pricing](https://ably.com/pricing)
- Supabase offers a shadcn-installable "Realtime Chat" component for Next.js — [Supabase Realtime Chat docs](https://supabase.com/library/docs/nextjs/realtime-chat)
- LiveKit offers prebuilt React `Chat` component and `useChat` hook, but they do not store messages — [LiveKit text streams docs](https://docs.livekit.io/home/client/data/text-streams/)

### Inferences
- Phone/email filters (CometChat) and pre-send hooks (Stream) are useful for a marketplace to stop people taking payment off-platform.
- For this app, which already has its own blocking/reporting/admin, the vendor moderation dashboards would duplicate existing tools; the app would need to sync its blocks into the vendor.

### Gaps
- Ably Chat's React UI components and PubNub's chat UI status were not verified this session.
- Whether Stream's free Build plan sends email (not push) notifications for missed messages was not verified; Stream historically relied on webhooks for email.
- Pusher: no chat features found on the pricing page (it is a pub/sub service).

## 3. Where messages are stored, export/own copy, retention, GDPR

### Takeaway
With the full chat products, messages live on the vendor's servers. Webhooks let the app keep its own copy in Postgres. Cheap-plan retention limits differ a lot: Sendbird and CometChat keep 6 months, PubNub Free 7 days and Starter 6 months, Ably Free 1 month, while Stream (within storage caps) and TalkJS keep messages as long as the plan is active.

### Cited Findings
- Stream: messages "securely stored for as long as your plan is active"; caps of 5M (Start) / 10M (Elevate) stored messages, then $5 per 1M; webhooks on all plans — [Stream pricing](https://getstream.io/chat/pricing/)
- Sendbird: 6-month retention, extended only on Enterprise; data export listed as a Pro feature but the FAQ says export is an add-on "not available to customers of the Starter and Pro plans" (contradictory on the same page) — [Sendbird pricing](https://sendbird.com/pricing/chat)
- TalkJS: unlimited retention on all plans; webhooks (1 on Basic) signed with `X-TalkJS-Signature`; REST API with admin token can list every message (max 100 per request) — [TalkJS pricing](https://talkjs.com/pricing/); [TalkJS webhooks](https://talkjs.com/docs/Webhooks/); [TalkJS REST API](https://talkjs.com/docs/REST_API/)
- CometChat: 6 months on all plans, extendable for a fee; data export not stated on pricing page — [CometChat pricing](https://www.cometchat.com/pricing)
- PubNub: Free 7 days/1 GB; Starter 6 months; Pro unlimited — [PubNub pricing](https://www.pubnub.com/pricing/)
- Ably: Free 1 month; Pro/Business 1 year; Enterprise indefinite; regional routing (EU/US/AUS) only on Business — [Ably pricing](https://ably.com/pricing)
- LiveKit: no storage at all — "All data is transmitted in realtime between connected participants only" — [LiveKit text streams docs](https://docs.livekit.io/home/client/data/text-streams/)
- Supabase stores messages in your own Supabase Postgres table; free projects pause after 1 week inactivity — [Supabase pricing](https://supabase.com/pricing)

### Inferences
- With a 6-month retention cap, old customer-host threads would disappear unless the app copies them via webhook — which partly defeats the point of renting.
- Keeping a Postgres copy through webhooks is possible with Stream, TalkJS, Sendbird (Pro), CometChat and PubNub, but means two sources of truth.

### Gaps
- GDPR data-processing agreements (DPA) and EU data residency per vendor were not checked in this session; all major vendors are believed to offer a DPA (background knowledge, not re-verified).

## 4. Authenticating users from the app's own accounts, enforcing "only these two" and "blocked cannot message"

### Takeaway
All the chat products use the same pattern: the app's server signs a token for the logged-in user (Stream token, TalkJS JWT/HMAC signature, Sendbird session token, etc.). Enforcing "only these two people" is done by the app's server creating the one-to-one conversation and not giving users permission to create their own. Enforcing the app's own block list requires syncing it into the vendor or using a pre-send hook; it is not automatic.

### Cited Findings
- TalkJS: identity verification is an HMAC-SHA256 signature of the user ID made with the secret key on your backend; once enabled, unsigned requests are blocked; newer JWT "user tokens" are the recommended default — [TalkJS identity verification](https://talkjs.com/docs/Features/Security_Settings/Identity_Verification); [TalkJS advanced authentication](https://talkjs.com/docs/Features/Security/Advanced_Authentication/)
- TalkJS REST API uses admin tokens with full account access and must stay on the backend — [TalkJS REST API](https://talkjs.com/docs/REST_API/)
- Stream has a permission `CreateDistinctChannelForOthers` controlling who can create one-to-one ("distinct") channels — [Stream permissions reference](https://getstream.io/chat/docs/javascript/permissions-reference.md)
- Stream blocking: if a blocked user tries to add the blocker to a channel, the add is ignored; in the React DM channel details the block button needs `ban-channel-members` permission — [Stream moderation docs](https://getstream.io/chat/docs/javascript/block_user/); [Stream React blocking guide](https://getstream.io/chat/docs/sdk/react/guides/blocking-users/)
- Stream offers "pre-send hooks" on all plans — [Stream pricing](https://getstream.io/chat/pricing/)
- CometChat pre-event webhook ("custom API review") is only on Build (dev) and Enterprise, not Basic/Advanced — [CometChat pricing](https://www.cometchat.com/pricing)

### Inferences
- A pre-send hook (Stream on all plans; CometChat only Enterprise) is the cleanest way to have the app's own Postgres block list decide whether a message goes through.
- Without hooks, the app must mirror each block/unblock into the vendor via its server API — another thing that can drift.

### Gaps
- Exact behaviour of Stream distinct channels when one member blocks the other was not found.
- Sendbird, PubNub, Ably token details were not re-read this session (all use server-issued tokens per background knowledge).

## 5. Lock-in and risk

### Takeaway
The main risks are big jumps from free to the first paid tier (Stream $0 → $399), per-MAU overage, and vendors changing plans: Sendbird dropped and later reshaped its free plan, Ably changed its pricing model twice (Oct 2024 per-minute, Nov 2026 MAU), and Stream's free Maker plan has "limited availability". Switching later means migrating stored messages and replacing UI components.

### Cited Findings
- Stream overage: $0.09/MAU and $0.99 per concurrent connection over plan limits — [Stream pricing](https://getstream.io/chat/pricing/)
- CometChat: Enterprise accounts are "automatically upgraded" when exceeding limits; where both MAU and concurrency are exceeded, the higher charge applies — [CometChat pricing](https://www.cometchat.com/pricing)
- Sendbird: overage fees charged after MAU limit, rates not published; payments non-refundable — [Sendbird pricing](https://sendbird.com/pricing/chat)
- Sendbird's free Developer plan (100 MAU) was dropped in early 2024, per a pricing tracker; a free plan appears again on today's page — [PricingSaaS Sendbird 2024Q1](https://pricingsaas.com/companies/sendbird/diffs/2024Q1); [Sendbird pricing](https://sendbird.com/pricing/chat)
- Sendbird's self-serve AI Chatbot plans removed early 2025 and AI prices withdrawn April 2025 (AI product only) — [UsagePricing Sendbird](https://www.usagepricing.com/blueprint/sendbird); [UsagePricing deprecation 2025-04-17](https://www.usagepricing.com/blueprint/activity/sendbird-2025-04-17-deprecation)
- A third-party tracker says Sendbird's Developer "free-forever" claim was "no longer in force" as of September 2026, conflicting with other entries calling it stable — [AgentDeals Sendbird](https://agentdeals.dev/vendor/sendbird)
- Ably: per-minute pricing introduced Oct 2024; MAU pricing effective 2026-11-05 — [Ably blog Oct 2024](https://ably.com/blog/new-ably-per-minute-consumption-pricing); [AgentDeals digest 2026-w45](https://agentdeals.dev/digest/2026-w45)
- Stream Maker: "availability is limited!" — [Stream Maker Account](https://getstream.io/maker-account/)
- Weavy (a competitor) argued Sendbird customers could double monthly cost after a few high-volume days under previously advertised overage rules — opinion — [Weavy, Feb 2022](https://www.weavy.com/blog/sendbird-alternatives-how-sendbird-fares-against-the-competition)
- A Fora Soft guide notes SaaS chat pricing scales with MAU and switching vendors later is hard — [Fora Soft](https://www.forasoft.com/blog/article/chat-solutions-what-to-choose-between-firebase-sandbird-node-js-socket-io-218)

### Inferences
- Pusher's earlier chat product, Chatkit, was shut down in 2020, and Pusher is owned by MessageBird/Bird (background knowledge, not re-verified this session). This is the clearest example of a hosted chat product disappearing.
- Lowest lock-in: Supabase/Pusher/Ably delivery with messages in the app's own Postgres. Highest: vendor-stored messages plus vendor UI.

### Gaps
- No acquisitions or shutdowns among these vendors in 2025–2026 were found in this session's searches.

## 6. Is LiveKit's chat / data channel suitable for messaging outside a live call?

### Takeaway
No. LiveKit text streams and data packets only reach people connected to the same room at that moment. Nothing is stored, there is no history, and offline users never receive the message. It is fine for in-call chat only.

### Cited Findings
- "All data is transmitted in realtime between connected participants only." — [LiveKit text streams docs](https://docs.livekit.io/home/client/data/text-streams/)
- Participants joining after a stream starts "will not receive any of it"; no history is kept; storing messages requires your own database — [LiveKit text streams docs](https://docs.livekit.io/home/client/data/text-streams/)
- The React `Chat` component / `useChat` hook do not persist messages — [LiveKit text streams docs](https://docs.livekit.io/home/client/data/text-streams/)
- LiveKit Build allows 100 concurrent connections and bills WebRTC minutes; keeping users connected to a room just to wait for messages would consume minutes — [LiveKit pricing](https://livekit.com/pricing)

### Inferences
- Using LiveKit as an inbox would require both parties online in a room at once, plus the app's own storage, unread counts and email alerts — i.e. building chat anyway, on a transport not designed for it.

### Gaps
- None material.

## 7. What independent developers say (2024–2026)

### Takeaway
Very little genuinely independent discussion was found; most "comparison" articles are written by the vendors themselves (Stream, Sendbird, TalkJS, Ably). The common thread: buy if you need rich chat features fast; build on your own database if chat is simple and you want ownership and low cost. Vendor build-vs-buy cost figures are inflated for a simple one-to-one case.

### Cited Findings
- Sendbird (vendor) claims basic chat from scratch costs $300k–$500k in people costs year one — [Sendbird build vs buy](https://sendbird.com/blog/build-vs-buy-build-chat-from-scratch-or-jump-start-with-a-chat-api-and-sdk)
- LowCode Agency (sells Stream integrations) estimates 8–16 weeks for a custom WebSocket build versus 1–3 weeks with Stream, and says delivery-state handling is where custom systems cut corners — opinion — [LowCode Agency](https://www.lowcode.agency/blog/real-time-chat-notification-systems)
- Stream (vendor) says TalkJS fits a web marketplace inbox — [Stream: Sendbird alternatives](https://getstream.io/blog/sendbird-alternatives/)
- A Stream case study describes a company leaving Sendbird over price after negotiations failed — vendor — [Stream: Hio switched](https://getstream.io/blog/hio-switched-from-sendbird-to-stream/)
- Toolradar describes Stream as a full chat product and Supabase Realtime as general state sync over WebSockets — [Toolradar](https://toolradar.com/compare/stream-vs-supabase-realtime)
- Supabase Realtime requires the messages table to be added to the realtime publication or inserts won't notify clients — [Supabase Realtime Chat docs](https://supabase.com/library/docs/nextjs/realtime-chat)
- An Indie Hackers thread "Any cheap chat APIs out there?" exists but could not be read (HTTP 403) — [Indie Hackers](https://www.indiehackers.com/post/any-cheap-chat-apis-out-there-f0f6534c44)

### Inferences
- For text-only one-to-one threads between two known users, the hard parts vendors sell (group chat, scaling to millions, typing indicators) matter little; the parts that matter (storage, unread counts, email for missed messages, block enforcement) are modest to build on an existing Postgres plus a delivery service.
- For this app, which already has its own accounts, blocking, reporting and admin tools, renting a full chat product would duplicate those tools and add a sync job.

### Gaps
- No Reddit r/webdev, r/nextjs, r/SaaS or Hacker News threads from 2024–2026 were retrieved; search results returned mainly vendor content. Developer sentiment is therefore thinly sourced.
