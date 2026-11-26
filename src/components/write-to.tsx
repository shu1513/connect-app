import { openConversationAction } from "@/app/conversations/actions";
import { CONVERSATION_WORDS } from "@/lib/conversations/words";

/**
 * "Write to …": the way into the conversation of a pair (plans/49-messaging.md). A small form,
 * not a link, because opening may make the conversation's row. The form names a call, or, for a
 * host beside a past customer, that customer; who is the host and whether the two may write at
 * all is worked out on the server.
 *
 * A page draws this only while messages are switched on.
 */
export function WriteTo(props: { name: string; back: string } & ({ callId: string } | { customerId: string })) {
  return (
    <form action={openConversationAction} className="inline" data-write-to>
      {"callId" in props ? <input type="hidden" name="callId" value={props.callId} /> : <input type="hidden" name="customerId" value={props.customerId} />}
      <input type="hidden" name="back" value={props.back} />
      <button type="submit" className="rounded border border-neutral-500 px-3 py-1.5 text-sm">
        {CONVERSATION_WORDS.write(props.name)}
      </button>
    </form>
  );
}
