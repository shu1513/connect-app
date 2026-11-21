import type { Metadata } from "next";
import Link from "next/link";
import { LocalTime } from "@/components/local-time";
import { SitePage } from "@/components/site-page";
import { warm } from "@/components/warm-ui";
import { messagesOf, MESSAGES_SHOWN, unreadCount } from "@/lib/messages/messages";
import { requireUser } from "@/lib/session";
import { MessagesShown } from "./shown";

export const metadata: Metadata = { title: "Messages" };

// A person's own messages, read fresh every time.
export const dynamic = "force-dynamic";

/**
 * What Connect has written to this person (plans/47, decision 2). Each message here was also
 * emailed, with the same words. Only the person themselves ever sees this page's content.
 */
export default async function MessagesPage() {
  const user = await requireUser("/messages");
  const messages = await messagesOf(user.id);
  // Nothing is written while the page is drawn. The messages count as read once the person's own browser says it has
  // shown them (shown.tsx); until their next page, the top bar and the "New" marks still show what was new on this visit.
  // Asked for whenever anything of theirs is unread, also when none of it is on this page (older than the page shows).
  const anyNew = messages.length > 0 && (await unreadCount(user.id)) > 0;

  return (
    <SitePage className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6 sm:py-12">
      <h1 className={warm.title}>Messages</h1>
      <p className="mt-2 text-sm opacity-70">What Connect has written to you. Each message is also emailed to you.</p>
      {anyNew && <MessagesShown shownIds={messages.map((message) => message.id)} pageWasFull={messages.length === MESSAGES_SHOWN} />}

      {messages.length === 0 ? (
        <p className="mt-6 text-sm" data-no-messages>
          You have no messages.
        </p>
      ) : (
        <ul className="mt-6 space-y-4" data-messages>
          {messages.map((message) => (
            <li key={message.id} className="rounded border border-neutral-400 p-4 text-sm" data-message={message.readAt ? "read" : "new"}>
              <p className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-semibold">{message.subject}</span>
                {!message.readAt && <span className="rounded bg-blue-600 px-1.5 py-0.5 text-xs font-medium text-white">New</span>}
              </p>
              <p className="mt-0.5 opacity-70">
                <LocalTime iso={message.createdAt.toISOString()} />
              </p>
              <p className="mt-3 whitespace-pre-line">{message.body}</p>
              {message.path && (
                <p className="mt-3">
                  <Link href={message.path} className="inline-flex min-h-11 items-center underline underline-offset-2">
                    Open
                  </Link>
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      {messages.length === MESSAGES_SHOWN && <p className="mt-6 text-sm opacity-70">These are your latest {MESSAGES_SHOWN} messages. Older ones were emailed to you.</p>}
    </SitePage>
  );
}
