"use client";

import { useActionState } from "react";
import { LocalTime } from "@/components/local-time";
import { keptMessagesAction } from "./actions";
import type { KeptState } from "./kept-state";

/**
 * For the founder, beside a report that was made from a message: that messages are kept with it,
 * and a button to read them (plans/49-messaging.md, decision 24). The words are not in the page
 * until the button is pressed, and every press is written into the record of admin actions
 * before anything comes back. Pressing again reads them again, and is written down again.
 */
export function KeptMessages({ reportId, keptCount, olderLeftOut, reporterName, reportedName }: { reportId: string; keptCount: number; olderLeftOut: number; reporterName: string; reportedName: string }) {
  const [state, formAction, pending] = useActionState<KeptState, FormData>(keptMessagesAction, { error: null, kept: null });
  return (
    <div className="mt-2 rounded border border-neutral-500 p-3" data-kept-messages={reportId}>
      <p>
        Made from a message. {keptCount} {keptCount === 1 ? "message is" : "messages are"} kept with this report
        {olderLeftOut > 0 ? `; ${olderLeftOut} older ${olderLeftOut === 1 ? "one was" : "ones were"} left out` : ""}. Reading them is written into the record below.
      </p>
      <form action={formAction} className="mt-2">
        <input type="hidden" name="reportId" value={reportId} />
        <button type="submit" disabled={pending} className="rounded border border-neutral-500 px-3 py-1.5">
          {pending ? "Reading…" : state.kept ? "Read the kept messages again" : "Read the kept messages"}
        </button>
      </form>
      {state.error && (
        <p role="alert" className="mt-2 rounded border border-red-600 p-2">
          {state.error}
        </p>
      )}
      {state.kept && (
        <ol className="mt-3 space-y-2" data-kept-shown>
          {state.kept.messages.map((message) => (
            <li key={message.number} className={`rounded border p-2 ${message.number === state.kept!.reportedNumber ? "border-red-600" : "border-neutral-400"}`}>
              <p className="opacity-70">
                <span className="font-semibold">{message.from === "reporter" ? reporterName : reportedName}</span> ({message.from === "reporter" ? "made the report" : "reported"}) · <LocalTime iso={message.at} />
                {message.number === state.kept!.reportedNumber ? " · the reported message" : ""}
              </p>
              <p className="mt-1 whitespace-pre-wrap break-words">{message.body}</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
