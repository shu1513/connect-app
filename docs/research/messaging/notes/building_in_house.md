# Building one-to-one messaging in-house (Next.js 16 + Postgres + worker), as of November 2026

Scope note: research was capped at about 15 tool calls. Official docs were fetched for Vercel limits, Vercel WebSockets, the Next.js self-hosting guide, and Recall.ai's LISTEN/NOTIFY post. Many other points come from search-result summaries of blogs. Those are marked as weaker where relevant. Points that come only from general engineering knowledge, not a source, are kept in "Inferences" or "Gaps".

## Transport: polling vs SSE vs WebSockets vs Postgres LISTEN/NOTIFY

### Takeaway
At 0 to 10,000 monthly users with few live conversations, polling a small JSON route every 2 to 5 seconds is a sound first version and reuses a pattern the app already has. SSE is the natural upgrade and works in Next.js 16 route handlers. On a long-running Node server it can be fed by the existing worker or by LISTEN/NOTIFY. On Vercel it is capped by function duration (300s Hobby, 800s Pro), and every open stream keeps an instance billable. WebSockets on Vercel are now in public beta but need Redis for fan-out across instances. LISTEN/NOTIFY's known scaling problem only shows up with many concurrent writers, far beyond this app's scale.

### Cited Findings
**Vercel (serverless with Fluid compute)**
- Maximum duration with Fluid compute (Node.js/Bun/Python): Hobby 300s default and max. Pro/Enterprise 300s default, 800s max, 1800s "extended maximum" in beta. The limit "includes time spent processing the request and sending the response, including streamed responses". When it is hit, Vercel returns 504 `FUNCTION_INVOCATION_TIMEOUT`. Page last updated 2026-08-24. — [Vercel Functions Limits](https://vercel.com/docs/functions/limitations)
- Edge runtime must start responding within 25s and can stream for up to 300s. — [Vercel Functions Limits](https://vercel.com/docs/functions/limitations)
- Cost model: pay for active CPU time plus provisioned memory time. Waiting on I/O does not count as active CPU, but memory is billed for as long as the instance runs. Auto-scales up to 30,000 concurrency (Hobby/Pro). 1,024 file descriptors are shared across concurrent executions on an instance, and open sockets and DB connections count toward this. — [Vercel Functions Limits](https://vercel.com/docs/functions/limitations)
- The 4.5 MB response body limit does not apply to streamed responses. — [Vercel Functions Limits](https://vercel.com/docs/functions/limitations)
- WebSockets on Vercel Functions are in **public beta on all plans** and need Fluid compute. A connection is pinned to the instance that accepted it. It is limited by the same max duration (300s Hobby; 800s Pro; 1800s beta), so "every connection eventually closes" and clients need reconnect logic. — [Vercel KB: WebSocket support](https://vercel.com/kb/guide/do-vercel-serverless-functions-support-websocket-connections)
- Next.js has no built-in WebSocket upgrade API. On Vercel you use `experimental_upgradeWebSocket()` from `@vercel/functions` inside a `GET` route handler. — [Vercel KB](https://vercel.com/kb/guide/do-vercel-serverless-functions-support-websocket-connections)
- An open WebSocket keeps its instance's provisioned memory billable until it closes. Data sent counts toward Fast Data Transfer. In-memory state only reaches connections on the same instance, so Vercel recommends Redis pub/sub for cross-instance fan-out. After a deploy, existing connections stay on the old deployment until they close. — [Vercel KB](https://vercel.com/kb/guide/do-vercel-serverless-functions-support-websocket-connections)
- A community thread reports that functions on the 1800s extended-duration beta "rarely reuse instances" (20x more new instances). Treat this as anecdotal. — [Vercel Community](https://community.vercel.com/t/functions-with-1800s-extended-duration-beta-rarely-reuses-instances-20x-more-new-instances/49614)

**Netlify / Cloudflare (weaker, third-party sources)**
- Netlify Functions reportedly run on AWS Lambda, with "no native WebSockets" and a 20 MB response cap. I could not confirm Netlify's current streaming timeout from official docs. — [apiscout.dev (third-party)](https://apiscout.dev/blog/best-serverless-function-platforms-2026)
- On Cloudflare, WebSockets go through Durable Objects. WebSocket Hibernation is the main cost lever: the server can sleep while connections stay open. Pricing figures in results came from unofficial summaries (for example Workers Paid at a $5/month minimum). — [websocket.org Cloudflare guide](https://websocket.org/guides/infrastructure/cloudflare/); [Cloudflare Durable Objects product page](https://www.cloudflare.com/product/durable-objects/)

**Next.js 16 route handlers and SSE**
- The common pattern: a route handler `GET` returns a `Response` wrapping a Web `ReadableStream` with `Content-Type: text/event-stream`. Route handlers use Web Streams, not Node streams. — [Upstash blog](https://upstash.com/blog/sse-streaming-llm-responses.md); [Vercel streaming docs](https://vercel.com/docs/functions/streaming-functions)
- Streaming is on by default for Node.js functions on Vercel. Max duration can be raised with `maxDuration`. — [Vercel streaming functions](https://vercel.com/docs/functions/streaming-functions)
- 2026 community posts warn that a naive SSE handler "breaks on Vercel serverless" (timeouts, buffering). — [dev.to stacknotice 2026](https://dev.to/stacknotice/sse-vs-websockets-in-nextjs-app-router-real-time-done-right-2026-1lc4); [Medium: fixing slow SSE on Next.js/Vercel](https://medium.com/@oyetoketoby80/fixing-slow-sse-server-sent-events-streaming-in-next-js-and-vercel-99f42fbdb996)
- Self-hosting (Next.js docs, updated 2026-10-15): the App Router supports streaming self-hosted. Behind nginx you must turn off buffering, for example with the `X-Accel-Buffering: no` header set in `next.config.js` `headers()`. Load balancers and reverse proxies must pass chunked or HTTP/2 streaming through without buffering. Next.js also recommends a reverse proxy in front for slow-connection attacks and rate limiting. — [Next.js self-hosting guide](https://nextjs.org/docs/app/guides/self-hosting)
- Running several Next.js instances needs a shared `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`. Otherwise server actions fail with "Failed to find Server Action". In-memory state (and therefore any in-process SSE fan-out) is per instance. — [Next.js self-hosting guide](https://nextjs.org/docs/app/guides/self-hosting)

**Postgres LISTEN/NOTIFY**
- Recall.ai (2025): a `NOTIFY` inside a transaction takes a global `AccessExclusiveLock` on "database 0" during `COMMIT`, which serializes commits across the whole instance. With tens of thousands of concurrent writers, this caused three outages (March 19–22, 2025). Their advice: "Don't use LISTEN/NOTIFY if you want your database to scale to many writers." Moving notifications to the application layer took them under a day. — [Recall.ai](https://recall.ai/blog/postgres-listen-notify-does-not-scale)
- Recall.ai later added an update saying upstream commit 282b1cde removed the bottleneck (credited to Joel Jacobson). However, the PostgreSQL 19 release notes item found describes a different change: NOTIFY now wakes only the backends listening on that channel. A July 2026 pgsql thread still lists the commit-time global lock as a known limit. **Conflict: unconfirmed whether the commit lock is gone in PG 19.** As of mid-November 2026, PG 19 GA appears not yet released (GA press release draft dated November 19, 2026). — [Recall.ai](https://recall.ai/blog/postgres-listen-notify-does-not-scale); [PG 19 release notes (draft)](https://www.postgresql.org/docs/19/release-19.html); [pgsql docs thread](https://postgrespro.com/list/thread-id/2743933)
- HN reaction (opinion): "99% of PostgreSQL instances out there are not big 'scale'". Others criticized its lack of access controls and payload typing. — [HN discussion](https://news.ycombinator.com/item?id=44490510)
- DBOS reports 60K writes/s on one Postgres server with LISTEN/NOTIFY-backed streams (vendor claim). — [DBOS](https://dbos.dev/blog/postgres-listen-notify-scalability)
- Simon Willison's summary quotes the Postgres source comment explaining that the global lock keeps queue entries in commit order. — [Simon Willison](https://simonwillison.net/2025/Jul/11/postgres-listen-notify/)

**Experienced-engineer opinion on Postgres-as-messaging**
- HN, 2025–2026 (opinion): one commenter wished they had "just used postgresql for both messages and data" instead of RabbitMQ plus Postgres. Another runs a small B2B app on a cheap VPS with Postgres as the messaging layer. Skeptics prefer purpose-built queues. — [HN: PostgreSQL for Everything](https://news.ycombinator.com/item?id=49361279)

### Inferences
- **Polling is acceptable for v1.** Rough load estimate: 50 people with a chat screen open, each polling every 3s, is about 17 small requests per second. Each is one indexed query (`messages where conversation_id = ? and id > ?`). Postgres and a single Node server handle that easily. On Vercel each poll is a short invocation billed mostly on CPU. Main costs are wasted requests and up to N seconds of delay, both fine for marketplace DMs, which are not live group chat.
- Make polling adaptive: poll fast (2–3s) only while a conversation is open and the tab is visible (Page Visibility API), slow down (15–30s) for the inbox badge, and stop when the tab is hidden. Return `304`/empty quickly when nothing changed (compare a `last_message_id` or `updated_at` cursor).
- Long polling saves requests but holds a function open on serverless (billed memory time). It gains little over 3s short polling at this scale.
- **SSE upgrade path on a long-running Node host (Railway/Render/Fly/VPS):** one SSE route per user. The server process holds an in-memory map userId→stream. New messages reach it either (a) from the send handler in the same process, (b) from LISTEN/NOTIFY on one dedicated pg connection (payload = conversation id only, then the client re-fetches), or (c) via the existing worker. With a single web instance, (a) is enough. With more than one instance, LISTEN/NOTIFY is the cheapest cross-instance signal and needs no Redis. At this app's write rate the Recall.ai lock issue is irrelevant.
- Note: LISTEN needs a dedicated, persistent (session-mode) connection. Transaction-mode poolers such as PgBouncer in transaction mode or some serverless Postgres poolers do not support LISTEN. Check the Postgres provider (gap: not verified per provider).
- **On Vercel:** SSE streams end at 300s/800s. EventSource reconnects automatically (using `Last-Event-ID`), so this works, but every open tab keeps an instance billed. Polling is likely cheaper and simpler on Vercel at this scale.
- **WebSockets** add two-way messaging the app doesn't need: sends can stay as server actions or POSTs. They also add reconnect, heartbeat and fan-out work. Not worth it for v1.
- Whatever the transport, the database stays the source of truth. The push channel should only say "something changed", and the client re-fetches through the same authorized JSON route. That way missed events never lose messages, and polling remains the fallback.

### Gaps
- No authoritative HN or blog thread was found that directly says "polling every few seconds is fine for 1:1 chat". The recommendation above is inference.
- Netlify's current function streaming timeout and official WebSocket stance were not verified from Netlify docs. Cloudflare Durable Objects pricing was not verified from official docs.
- Whether Neon/Supabase/Railway Postgres poolers support LISTEN was not checked.
- Whether the PG commit-lock fix shipped in PG 19 is unresolved (sources conflict).

## Data model: tables, indexes, cursor pagination, idempotency, ordering, unread counts

### Takeaway
The proven shape is three tables: `conversations`, `conversation_participants` (one row per user, holding that user's read position), and `messages`. Unread counts come from comparing message ids to each participant's `last_read_message_id`, or from a stored counter. Sends are made idempotent with a client-generated key behind a unique constraint.

### Cited Findings
- Common pattern: the participant row stores `last_read_at` / `last_read_message_id` (and optionally `unread_count`). The count is bumped for other participants on each new message and reset to 0 on open. — [OneUptime chat schema (MySQL), 2026](https://oneuptime.com/blog/post/2026-03-31-mysql-design-schema-for-chat-application/view)
- Alternative: compute unread as the count of messages with id > `last_read_message_id` for that participant. — [techinterview.org messaging LLD](https://www.techinterview.org/post/3233467139/lld-messaging-system/)
- The read cursor should be forward-only (it never moves backward). — [company-docs chat example](https://company-docs-3pf.pages.dev/backend/chat)
- Denormalize `last_message_at` onto `conversations` to sort the inbox fast. — [OneUptime](https://oneuptime.com/blog/post/2026-03-31-mysql-design-schema-for-chat-application/view)
- A Stack Overflow thread warns that keeping a stored counter in sync "just shifts and spreads the problem" compared with computing it from a read marker. — [via search summary; Stack Overflow mirror](https://backiee.wasmer.app/https_stackoverflow_com/questions/79828496/frequent-update-of-records-in-database)
- Idempotent sends: the client creates one key per logical send and reuses it on every retry. A fresh key per retry defeats deduplication. — [OpenReplay idempotency](https://blog.openreplay.com/idempotency-api/)
- Enforce with a single atomic insert arbitrated by a unique constraint, not check-then-insert. One source calls the unique constraint non-optional. — [glukhov.org](https://glukhov.org/app-architecture/integration-patterns/idempotency-in-distributed-systems/); [pandastack](https://pandastack.io/blog/idempotency-in-apis-guide)
- On replay, return the original message id rather than an error. A different body with the same key returns 409 (Blooio messaging API behavior). — [Blooio docs](https://docs.blooio.com/idempotency); [omr.it.com](https://omr.it.com/blog/stateful-websocket-reconnect-idempotency-keys/)

### Inferences
Suggested Drizzle/Postgres shape (synthesized from the above plus standard practice):
- `conversations(id uuid pk, kind, created_at, last_message_id, last_message_at, pair_key text unique)`. `pair_key` = the two user ids sorted and joined (for example `minId:maxId`). The unique constraint guarantees exactly one 1:1 conversation per pair and makes "start or open conversation" a safe `INSERT ... ON CONFLICT DO NOTHING` followed by a select. Optionally scope it by context (for example per booking/listing) if the marketplace wants separate threads.
- `conversation_participants(conversation_id, user_id, last_read_message_id, last_read_at, muted, archived_at, last_notified_message_id; pk(conversation_id, user_id))`, index on `(user_id, conversation_id)`. This row is also the authorization check ("is this user in this conversation").
- `messages(id bigint identity or uuidv7 pk, conversation_id, sender_id, body text, client_key uuid, created_at, edited_at, deleted_at)`, with `unique(sender_id, client_key)` and index `(conversation_id, id desc)`.
- **Ordering and cursors:** order by a monotonic id (bigint identity, or UUIDv7, which is time-ordered), not by `created_at` alone, because timestamps tie. Page backward with `WHERE conversation_id = $1 AND id < $cursor ORDER BY id DESC LIMIT 50`. Poll forward with `id > $lastSeen`. Avoid OFFSET pagination. Caveat: a bigint identity is assigned at insert, but concurrent transactions can commit out of order, so a poller using `id > x` could skip a row that commits late. In 1:1 chat with low write rates this is rare. Mitigations: re-fetch a small overlap window, or take a per-conversation lock or row update (for example `UPDATE conversations SET last_message_id = ...` inside the same transaction), which serializes writes within one conversation.
- **Unread counts:** for one user's badge, `SELECT count(*) FROM messages m JOIN conversation_participants p ON ... WHERE p.user_id = $me AND m.id > coalesce(p.last_read_message_id, 0) AND m.sender_id <> $me AND m.deleted_at IS NULL`. This is cheap with the `(conversation_id, id)` index when conversations are few. For a simple "has unread" dot, compare `conversations.last_message_id > participant.last_read_message_id` with no count at all. That is the cheapest option and enough for most marketplace UIs. A stored counter is an optimization to defer.
- **Soft delete:** set `deleted_at` and render "message deleted". Keep the original body (or move it to an audit table) so reported conversations can still be reviewed. Hard-delete only under a retention or erasure policy.
- Wrap send in one transaction: insert message → update `conversations.last_message_id/at` → (optional) enqueue a notification row for the worker. This reuses the app's existing outbox pattern.

### Gaps
- No Slack/Discord/Basecamp primary engineering posts were fetched in this pass (tool budget). The Discord message-storage write-ups (Cassandra→ScyllaDB, snowflake ids) are well known but were not re-verified here, and are about scale this app won't reach.

## Features and their real cost

### Takeaway
Cheap: unread dots and badges, message length limits, per-user rate limits, soft delete, basic "seen" in 1:1 (it's the same `last_read_message_id`), and email notification of missed messages batched by the existing worker plus outbox. Moderate: editing (needs history for moderation), search (Postgres full-text is enough). Traps for a small team: typing indicators and presence (need a real-time push and ephemeral state), link previews (server fetching of arbitrary URLs leads to SSRF), attachments (out of scope), multi-device read sync polish, and abuse/spam tooling.

### Cited Findings
- Sendbird's CTO (2019, vendor-biased) names the hardest parts as read receipts (per-user, per-conversation state synced across devices, multiplying event traffic), abuse prevention (blocking stops targeted harassment but not random abuse; ban evasion through new accounts; slow spammers are hard to detect), reliability, compliance, and feature interdependence (typing indicators must coordinate with message and idle state). Anti-spam "might take weeks to months to develop." — [Sendbird blog, Harry Kim, 2019](https://sendbird.com/blog/dont-try-this-at-home-why-you-shouldnt-build-chat-in-house)
- The same author says his two in-house chat attempts failed because users expect iMessage/WhatsApp-level polish, and engineers underestimate persistent connections compared with REST. — [Sendbird blog](https://sendbird.com/blog/dont-try-this-at-home-why-you-shouldnt-build-chat-in-house)

### Inferences
- **Unread badges:** cheap with the `last_message_id > last_read_message_id` comparison. Update the read marker when the conversation is visible (a server action, forward-only `GREATEST()` update).
- **"Seen" receipts (1:1):** nearly free. Show "Seen" under the sender's last message if the other participant's `last_read_message_id >= that id`. Returned in the same poll response. The group-chat complexity Sendbird describes does not apply to 1:1.
- **Typing indicators:** a trap with polling. They need sub-second updates and ephemeral state (writes every keystroke or throttled). Skip in v1. If added later, do it only on the SSE/WS transport with an in-memory TTL, never in Postgres rows.
- **Email for missed messages:** fits the existing worker plus outbox. Pattern: on send, do nothing extra. Every N minutes the worker finds participants whose `last_read_message_id < conversations.last_message_id` and `last_notified_message_id < last_message_id`, and whose oldest unread message is older than a delay (for example 10–15 min, so people actively chatting don't get emailed). It sends one email per recipient summarizing all unread conversations, then sets `last_notified_message_id`. That gives at most one email per new batch and no spam. Add a per-user setting (off / immediate-ish / daily digest) and an unsubscribe link. Avoid putting full message text in emails if moderation or privacy matters. "You have a new message from X" with a link is safer and avoids leaking content.
- **Length limit:** enforce server-side (for example 2,000–4,000 characters) in the zod schema plus a DB `CHECK (char_length(body) <= N)`. Trivial.
- **Rate limits:** per sender, for example X messages per minute and Y new conversations per day. They can be done in Postgres (count of recent rows by `sender_id`, indexed) with no Redis. Limit new-conversation creation hardest, since that is where spam lives in marketplaces.
- **Search:** defer. If needed, Postgres `tsvector` plus a GIN index on `messages.body`, always filtered to the user's own conversations. Don't add an external search service.
- **Edit:** moderate cost. Store `edited_at` and keep the previous versions (a `message_edits` table) so a reported conversation shows what was actually sent. Consider allowing edits only within a short window.
- **Delete:** soft delete only (see the data model). Show a "deleted" placeholder. Keep the content for moderators for a defined retention period.
- **Blocking/reporting:** essential for a marketplace and cheap. A `user_blocks` table checked on send. A `message_reports` table that copies a snapshot of the conversation for the reviewer.

### Gaps
- No small-team primary source with measured hours per feature was found.

## Security pitfalls

### Takeaway
The big risks in home-built chat are missing authorization checks (IDOR: reading someone else's conversation by changing an id), unsafe link rendering (`javascript:` URLs, which React does not block), and spam. React's default text escaping handles most stored XSS as long as you never render message HTML. Encryption at rest from the database host plus TLS is the sensible default. End-to-end encryption conflicts with a marketplace's need to review reported conversations.

### Cited Findings
- React escapes text content but does NOT sanitize URL attributes. `<a href={userInput}>` will run `javascript:` or `data:` URLs. Recommended fix: parse with the `URL` constructor and allowlist `http:`/`https:` (and `mailto:` if intended). Blocklists based on string matching have been bypassed. — [OneUptime: prevent XSS in React, 2026](https://oneuptime.com/blog/post/2026-01-15-prevent-xss-attacks-react/view); [lolware React XSS cheat sheet](https://lolware.net/blog/react-xss-protection-cheat-sheet/)
- If rendering markdown, `react-markdown` doesn't render raw HTML by default. If using DOMPurify, add `rel="noopener noreferrer"` to anchors. — [OneUptime sanitize input](https://oneuptime.com/blog/post/2026-01-15-sanitize-user-input-react-injection/view)
- eslint-plugin-react has a `jsx-no-script-url` rule to catch `javascript:` URLs. — [eslint-plugin-react rule source](https://github-redirect.dependabot.com/jsx-eslint/eslint-plugin-react/blob/2f267ca50f003d7e9720381563e59ef3a815ef88/lib/rules/jsx-no-script-url.js)
- Vercel's WebSocket upgrade path runs middleware, Firewall rules and rate limits before the upgrade. — [Vercel KB](https://vercel.com/kb/guide/do-vercel-serverless-functions-support-websocket-connections)
- HN criticism of LISTEN/NOTIFY includes that it has no access controls: any connected DB role can listen on any channel. — [HN](https://news.ycombinator.com/item?id=44490510)
- Abuse: blocking doesn't stop random abuse, bans are evaded with new accounts, slow spammers evade filters (vendor source). — [Sendbird blog](https://sendbird.com/blog/dont-try-this-at-home-why-you-shouldnt-build-chat-in-house)

### Inferences
- **Authorization on every read and write:** every route or server action (list conversations, fetch messages, poll, send, mark read, edit, delete, report) must join on `conversation_participants` with the session user id, or for edit/delete check `sender_id = me`. Server actions are public HTTP endpoints, so checks belong inside each one, not only on the page. Put this in one helper (for example `requireParticipant(convId, userId)`) and test it, including that a non-participant gets 404 rather than 403, so existence isn't leaked.
- **Id enumeration:** use random UUIDs (v4, or v7 for ordering) for conversation ids exposed in URLs. Still rely on the authorization check, not on ids being secret.
- **Stored XSS:** store message body as plain text, render as a React text node with `white-space: pre-wrap`, and never use `dangerouslySetInnerHTML`. If you auto-link URLs, build `<a>` elements yourself only for URLs that pass the http/https allowlist, with `target="_blank" rel="noopener noreferrer nofollow ugc"`. Also sanitize message text in emails (HTML-escape it in templates).
- **Link previews:** skip in v1. A server-side preview fetcher is an SSRF risk (it could be made to fetch internal or metadata URLs), and it is upkeep. If added, run it in the worker with private-IP blocking, timeouts and size caps, and escape all fetched metadata.
- **Link abuse/phishing:** consider an "external link" warning interstitial, limiting links for new or unverified accounts, and flagging messages that try to move payment off-platform (emails, phone numbers, payment app names). This is common marketplace practice (not verified against a source here).
- **Rate limiting/spam:** per-user limits on sends and new conversations, plus stricter limits for brand-new accounts. Block lists. A report button that snapshots content.
- **Encryption:** managed Postgres hosts typically encrypt disks at rest, and TLS covers data in transit (not verified per provider in this pass). Application-level field encryption adds key management and breaks search, for little gain against the main threat (an app-level authorization bug). **End-to-end encryption is not advisable** for a marketplace that must review reported conversations, enforce off-platform-payment rules, and respond to legal requests. E2EE would make server-side moderation impossible except through user-submitted reports, and multi-device key management is a large project. Be honest in the privacy policy that staff can access messages for safety reviews.
- **Retention/privacy:** define how long messages are kept, and how account deletion treats messages (for example anonymize the sender but keep content the other party received, subject to legal advice). This is a GDPR/CCPA point (not researched in depth here).

### Gaps
- OWASP's own cheat-sheet text was not fetched. The guidance above relies on secondary sources.
- No source was found that specifically analyzes E2EE vs moderation for marketplaces. The recommendation is inference.

## Effort and upkeep: in-house vs vendor (Stream/Sendbird/TalkJS), regrets, rules of thumb

### Takeaway
Almost all published "don't build chat" material comes from chat vendors, and their cost figures assume full-featured, real-time, multi-platform chat at large scale. No credible first-hand 2023–2026 regret story about a small team building simple 1:1 web messaging was found. The general build-vs-buy heuristic: build if it's core to the product and simple, buy if you need messenger-grade polish (mobile push, presence, typing, attachments, offline sync) quickly.

### Cited Findings
- Stream (vendor) estimates chat-as-a-service at about $15,000/month at 1 million MAU, against roughly $900,000 up front for a "high-end" in-house build. Vendor-biased, and the scale is irrelevant to this app. — [Stream build vs buy guide, via HN search summary](https://getstream.io/blog/build-vs-buy-chat/)
- Sendbird's CTO: both of his in-house chat attempts failed, with long timelines and only basic features. 2019, vendor-biased. — [Sendbird](https://sendbird.com/blog/dont-try-this-at-home-why-you-shouldnt-build-chat-in-house)
- Stream case studies describe marketplaces (for example Subito) that stopped maintaining in-house chat infrastructure and moved to a vendor. One testimonial describes a company that left Sendbird and wrote its own Go chat backend because of Sendbird scalability issues. Both vendor-published. — [Stream: Subito](https://getstream.io/blog/subito-marketplace-messaging/); [Stream vs Sendbird](https://getstream.io/compare/stream-vs-sendbird/)
- RST Software (agency) argues that even flexible vendors eventually "hit a wall" on customization. Ably (vendor) describes a middle ground: a chat SDK on its own infrastructure that still needs front-end UI work. — [RST Software](https://www.rst.software/blog/sendbird-alternatives); [Ably, July 2025](https://ably.com/blog/chat-sdk-vs-self-build-choosing-the-right-architecture-for-in-app-messaging)
- HN build-vs-buy heuristics (opinion): build when it gives competitive advantage or is core to the business process; buy peripheral tools. — [Ask HN: build vs buy you got wrong](https://news.ycombinator.com/item?id=34163624); [HN: Buy Don't Build](https://news.ycombinator.com/item?id=25399250)

### Inferences
- For this app (web-only, 1:1, text-only, existing polling plus worker plus outbox), an in-house v1 is roughly 4 tables, about 6 routes/actions, 2 screens (inbox, thread), and 1 worker job. That is small for AI builders and adds no new vendor, bill, data-processing agreement or SDK upgrade cycle. The ongoing work is mostly moderation tooling and abuse response, which a vendor would not fully remove anyway.
- Signals that in-house is no longer enough: native mobile apps needing push and offline sync; group chats; attachments/media; typing and presence becoming product requirements; regulatory or compliance demands (data residency, audit); live users in the thousands concurrently, where polling cost and latency become noticeable; or chat becoming a large share of engineering time.
- Vendor lock-in risk: migrating message history out of a vendor later is work. Keeping messages in your own Postgres from day one keeps that option open in both directions.

### Gaps
- No first-hand, non-vendor 2023–2026 write-up from a small marketplace or SaaS team that built or bought 1:1 chat was found in this pass. That gap is itself meaningful: the "regret" literature is dominated by vendors.
- Current Stream/Sendbird/TalkJS pricing was not checked (likely covered by another researcher).

## Open-source building blocks

### Takeaway
For this app, UI-only kits that plug into your own backend (such as chatscope's MIT `chat-ui-kit-react`, or MUI X Chat) can save some front-end time, though a simple Tailwind thread view is little work anyway. Self-hosted chat servers (Matrix/Synapse, Rocket.Chat, and similar) would add a second system to run, with its own database and auth, which is far more upkeep than four Postgres tables.

### Cited Findings
- chatscope `chat-ui-kit-react`: open-source, MIT, UI-only, so the backend is yours. — [ecosyste.ms entry](https://awesome.ecosyste.ms/projects/github.com%2Fchatscope%2Fchat-ui-kit-react)
- MUI X Chat: a React component that connects to any backend, aimed at AI assistants, support, and messaging. License not confirmed. — [MUI X Chat](https://mui.com/x/react-chat/)
- assistant-ui, Hugging Face chat-ui, LibreChat and OpenAI ChatKit are AI-assistant chat UIs or apps, not person-to-person messaging. — [designrevision assistant-ui alternatives](https://designrevision.com/alternatives/assistant-ui)
- Hosted kits (Sendbird, CometChat UI kits) are tied to the vendor's backend. One review says that once you want a different layout or backend "you are working against the kit". — [designrevision](https://designrevision.com/alternatives/assistant-ui)
- HN (opinion): one commenter would have moved a self-hosted Rocket.Chat to Postgres to avoid MongoDB operational pain. — [HN: PostgreSQL for Everything](https://news.ycombinator.com/item?id=49361279)

### Inferences
- A UI kit adds a dependency and styling conflicts (chatscope ships its own CSS) for a screen that is a scrolling list plus a textarea. With Tailwind and AI builders, hand-built is likely about as fast and has no upkeep. Worth a look only if the team wants polished components quickly.
- Self-hosting Matrix or Rocket.Chat means a separate server, separate user sync with Better Auth, separate backups and upgrades. That is wrong for a one-founder team.

### Gaps
- Maintenance status (last release, activity) of chatscope in 2026 was not verified. Matrix/Rocket.Chat embed options were not researched (no results returned).
