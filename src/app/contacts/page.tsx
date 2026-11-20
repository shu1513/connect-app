import type { Metadata } from "next";
import Link from "next/link";
import { LocalTime } from "@/components/local-time";
import { NoteForm } from "@/components/note-form";
import type { Membership as MembershipRow } from "@/db/schema";
import { invitingFor } from "@/lib/membership/access";
import { readNotice } from "@/lib/notice";
import { contactsOf, NOTE_MAX } from "@/lib/people/contacts";
import { requireUser } from "@/lib/session";
import { SitePage } from "@/components/site-page";
import { inviteAction, takeBackInviteAction } from "./actions";

export const metadata: Metadata = { title: "People you have talked to" };

export const dynamic = "force-dynamic";

/** The people this person has had calls with. A host can keep a private note about each customer. */
export default async function ContactsPage(props: PageProps<"/contacts">) {
  const user = await requireUser("/contacts");
  const notice = readNotice("/contacts", await props.searchParams);
  const now = new Date();
  const contacts = await contactsOf(user.id, now);
  // For a host: who she can invite to her membership, and where each invitation or membership stands. Only her own.
  const inviting = contacts.some((contact) => contact.wasMyCustomer) ? await invitingFor(user.id) : { canInvite: false, byCustomer: new Map<string, MembershipRow>() };

  return (
    <SitePage className="mx-auto w-full max-w-2xl px-4 py-10">
      <h1 className="text-2xl font-semibold">People you have talked to</h1>
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
                  <Link href={`/h/${contact.hostHandle}`} className="inline-flex min-h-11 items-center underline underline-offset-2">
                    Their page: book another call
                  </Link>
                </p>
              )}
              {contact.wasMyCustomer && <Membership link={inviting.byCustomer.get(contact.userId) ?? null} canInvite={inviting.canInvite} customerId={contact.userId} name={contact.name} now={now} />}
              {contact.wasMyCustomer && <NoteForm customerId={contact.userId} name={contact.name} text={contact.note} max={NOTE_MAX} />}
            </li>
          ))}
        </ul>
      )}
    </SitePage>
  );
}

/**
 * For a host, about one person she was the host for: an open invitation with the moment it runs
 * out and "Take back"; that the person is a member already; or the button to invite them. Nothing
 * is shown when she cannot invite (her membership is off, or memberships are not open for her)
 * and there is nothing between the two.
 */
function Membership(props: { link: MembershipRow | null; canInvite: boolean; customerId: string; name: string; now: Date }) {
  const { link, now } = props;
  const button = "rounded border border-neutral-500 px-3 py-1.5 text-sm";
  const invited = link?.status === "invited" && link.inviteExpiresAt && link.inviteExpiresAt > now ? link : null;
  if (invited) {
    return (
      <div className="mt-3">
        <p>
          Invited to your membership. The invitation runs out on <LocalTime iso={invited.inviteExpiresAt!.toISOString()} />, and holds a place until then.
        </p>
        <form action={takeBackInviteAction} className="mt-2">
          <input type="hidden" name="membershipId" value={invited.id} />
          <button type="submit" className={button}>
            Take the invitation back
          </button>
        </form>
      </div>
    );
  }
  if (link?.status === "joining") return <p className="mt-3">Is joining your membership right now.</p>;
  if (link?.status === "active" || link?.status === "unpaid") return <p className="mt-3">A member of yours.</p>;
  if (link?.status === "paused") return <p className="mt-3">A paused member of yours. They can resume by themselves; no invitation is needed.</p>;
  if (!props.canInvite) return null;
  return (
    <form action={inviteAction} className="mt-3">
      <input type="hidden" name="customerId" value={props.customerId} />
      <button type="submit" className={button}>
        Invite {props.name} to your membership
      </button>
    </form>
  );
}
