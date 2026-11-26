import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BlockButton } from "@/components/block-button";
import { LocalTime } from "@/components/local-time";
import { RefreshEvery } from "@/components/refresh-every";
import { SitePage } from "@/components/site-page";
import { warm } from "@/components/warm-ui";
import { viewFor } from "@/lib/conversations/read";
import { CONVERSATION } from "@/lib/conversations/rules";
import { CONVERSATION_WORDS, refusalWords } from "@/lib/conversations/words";
import { readNotice } from "@/lib/notice";
import { requireUser } from "@/lib/session";
import { muteAction } from "../actions";
import { Composer } from "../composer";
import { ConversationShown } from "../shown";

export const metadata: Metadata = { title: "Conversation" };

// A person's own conversation, read fresh every time.
export const dynamic = "force-dynamic";

/** How often the page asks the server again while it is in front (plans/49-messaging.md). */
const REFRESH_SECONDS = 5;

/**
 * One conversation between a host and a customer (plans/49-messaging.md). Only its two people
 * ever see it: for anyone else, and for an address that names nothing, the page is "not found".
 */
export default async function ConversationPage(props: PageProps<"/conversations/[id]">) {
  const { id } = await props.params;
  const user = await requireUser(`/conversations/${id}`);
  const query = await props.searchParams;
  const from = typeof query.from === "string" && /^[0-9]{1,9}$/.test(query.from) ? Number(query.from) : undefined;
  const view = await viewFor(user.id, id, new Date(), { from });
  if (!view) notFound();
  const notice = readNotice(`/conversations/${id}`, query);
  const { conversation, other, role, verdict, shownRefusal, bookHref, messages } = view;
  const here = `/conversations/${conversation.id}`;
  const highest = messages.length > 0 ? messages[messages.length - 1].number : 0;
  const shownUpTo = role === "host" ? conversation.hostShownNumber : conversation.customerShownNumber;
  // The customer's switch is his to see once it can mean something: the two have talked, or it is on.
  const showSwitch = role === "customer" && (view.facts.talked || view.facts.muted) && !view.facts.blockedByMe && !view.facts.blockedByOther;
  // A quiet conversation, for the customer: the closed door points at a booking (the founder's decision).
  const bookToWrite = shownRefusal === "book_again" && bookHref !== null;

  return (
    <SitePage className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6 sm:py-12">
      <RefreshEvery seconds={REFRESH_SECONDS} />
      {/* Nothing is written while the page is drawn: the person's own browser says what it has shown. */}
      {highest > shownUpTo && <ConversationShown conversationId={conversation.id} number={highest} />}
      <p className="text-sm">
        <Link href="/messages" className="inline-flex min-h-11 items-center underline underline-offset-2">
          All messages
        </Link>
      </p>
      <h1 className={warm.title}>{other.name}</h1>

      {notice && (
        <p role="status" className="mt-4 rounded border border-neutral-400 p-3 text-sm">
          {notice}
        </p>
      )}

      {view.hasEarlier && view.firstNumber !== null && (
        <p className="mt-4 text-sm">
          <Link href={`${here}?from=${Math.max(1, view.firstNumber - CONVERSATION.shown)}`} className="inline-flex min-h-11 items-center underline underline-offset-2" data-show-earlier>
            Show earlier messages
          </Link>
        </p>
      )}

      {messages.length === 0 ? (
        <p className="mt-6 text-sm opacity-70" data-no-messages>
          No messages yet.
        </p>
      ) : (
        <ol className="mt-6 space-y-3" data-conversation-messages>
          {messages.map((message) => {
            const mine = message.senderId === user.id;
            return (
              <li key={message.id} className={`rounded border border-neutral-400 p-3 text-sm ${mine ? "ml-8" : "mr-8"}`} data-message-number={message.number} data-from={mine ? "me" : "them"}>
                <p className="opacity-70">
                  <span className="font-semibold">{mine ? "You" : other.name}</span> · <LocalTime iso={message.createdAt.toISOString()} />
                </p>
                {/* The words as they were written, as plain text: a web address in them is never a link. */}
                <p className="mt-1 whitespace-pre-line break-words">{message.body}</p>
              </li>
            );
          })}
        </ol>
      )}

      {view.hasLater && (
        <p className="mt-4 text-sm">
          <Link href={here} className="inline-flex min-h-11 items-center underline underline-offset-2" data-show-latest>
            These are older messages. Back to the latest
          </Link>
        </p>
      )}

      {/* Always drawn, open or not: what someone typed stays when the conversation closes under them (composer.tsx). */}
      <Composer conversationId={conversation.id} name={other.name} max={CONVERSATION.maxChars} open={verdict.ok} />

      {verdict.ok ? (
        <p className="mt-2 text-sm opacity-70">
          {CONVERSATION_WORDS.staysOnConnect}{" "}
          <Link href="/rules" className="underline underline-offset-2">
            Read the rules
          </Link>
          .
        </p>
      ) : bookToWrite ? (
        <p className="mt-6 text-sm" data-closed="book_again">
          <Link href={bookHref} className="inline-flex min-h-11 items-center rounded bg-blue-600 px-4 font-medium text-white" data-book-to-write>
            {CONVERSATION_WORDS.bookToWrite(other.name)}
          </Link>
        </p>
      ) : (
        <p className="mt-6 rounded border border-neutral-400 p-3 text-sm" data-closed={shownRefusal ?? "closed"}>
          {refusalWords(shownRefusal ?? "closed", other.name)}
        </p>
      )}

      {/* The ordinary way to book her, wherever he can and the big button above is not already it. */}
      {bookHref && !bookToWrite && (
        <p className="mt-4 text-sm">
          <Link href={bookHref} className="inline-flex min-h-11 items-center rounded border border-neutral-500 px-3" data-book-a-time>
            {CONVERSATION_WORDS.bookATime(other.name)}
          </Link>
        </p>
      )}

      {showSwitch && (
        <form action={muteAction} className="mt-8 text-sm" data-mute={view.facts.muted ? "on" : "off"}>
          <input type="hidden" name="conversationId" value={conversation.id} />
          <input type="hidden" name="on" value={view.facts.muted ? "0" : "1"} />
          <button type="submit" className="rounded border border-neutral-500 px-3 py-1.5">
            {view.facts.muted ? CONVERSATION_WORDS.unmute(other.name) : CONVERSATION_WORDS.mute(other.name)}
          </button>
          {!view.facts.muted && <p className="mt-1 opacity-70">{CONVERSATION_WORDS.muteExplained(other.name)}</p>}
        </form>
      )}

      {!view.facts.blockedByMe && (
        <div className="mt-8 text-sm opacity-70">
          <BlockButton userId={other.id} name={other.name} back={here} />
        </div>
      )}
    </SitePage>
  );
}
