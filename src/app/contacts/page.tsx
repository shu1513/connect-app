import Link from "next/link";
import { LocalTime } from "@/components/local-time";
import { NoteForm } from "@/components/note-form";
import { readNotice } from "@/lib/notice";
import { contactsOf } from "@/lib/people/contacts";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/** The people this person has had calls with. A host can keep a private note about each customer. */
export default async function ContactsPage(props: PageProps<"/contacts">) {
  const user = await requireUser();
  const notice = readNotice("/contacts", await props.searchParams);
  const contacts = await contactsOf(user.id, new Date());

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10">
      <p className="text-sm">
        <Link href="/" className="underline underline-offset-2">
          ← Your calls
        </Link>
      </p>
      <h1 className="mt-4 text-2xl font-semibold">People you have talked to</h1>
      <p className="mt-2 text-sm opacity-70">Everyone you have had a call with. Someone you have blocked, or who has blocked you, is not listed.</p>

      {notice && (
        <p role="status" className="mt-4 rounded border border-neutral-400 p-3 text-sm">
          {notice}
        </p>
      )}

      {contacts.length === 0 ? (
        <p className="mt-6 text-sm opacity-70">Nobody yet. People appear here after a call you were both in.</p>
      ) : (
        <ul className="mt-6 space-y-4">
          {contacts.map((contact) => (
            <li key={contact.userId} className="rounded border border-neutral-400 p-4 text-sm">
              <p className="text-base font-medium">{contact.name}</p>
              <p className="mt-1 opacity-70">
                {contact.calls} {contact.calls === 1 ? "call" : "calls"}, the last on <LocalTime iso={contact.lastCallAt.toISOString()} />
              </p>
              {contact.hostHandle && (
                <p className="mt-2">
                  <Link href={`/h/${contact.hostHandle}`} className="underline underline-offset-2">
                    Their page: book another call
                  </Link>
                </p>
              )}
              {contact.wasMyCustomer && <NoteForm customerId={contact.userId} name={contact.name} text={contact.note} back="/contacts" />}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
