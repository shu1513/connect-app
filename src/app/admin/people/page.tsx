import { and, asc, desc, eq, gt, isNotNull, isNull } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LocalTime } from "@/components/local-time";
import { db, schema } from "@/db";
import { readNotice } from "@/lib/notice";
import { formatMoney, isAdmin } from "@/lib/payments/access";
import { isNetwork, NETWORKS } from "@/lib/profiles/social";
import { requireUser } from "@/lib/session";
import { closeAccountAction, decideProfileAction, decideSocialAction, reopenAccountAction } from "./actions";

const STATUS_LABEL: Record<string, string> = {
  pending: "Waiting for approval",
  approved: "Approved",
  declined: "Declined",
  suspended: "Suspended",
};

export default async function AdminPeoplePage(props: PageProps<"/admin/people">) {
  const user = await requireUser();
  // Someone who is not an admin sees the same "not found" as for any missing page.
  if (!(await isAdmin(user.id))) notFound();
  const notice = readNotice("/admin/people", await props.searchParams);

  const [profiles, claims, closed] = await Promise.all([
    db
      .select({ profile: schema.hostProfiles, email: schema.user.email, accountName: schema.user.name })
      .from(schema.hostProfiles)
      .innerJoin(schema.user, eq(schema.user.id, schema.hostProfiles.userId))
      .orderBy(desc(schema.hostProfiles.updatedAt)),
    db
      .select({ claim: schema.socialAccounts, displayName: schema.hostProfiles.displayName, handle: schema.hostProfiles.handle })
      .from(schema.socialAccounts)
      .innerJoin(schema.hostProfiles, eq(schema.hostProfiles.userId, schema.socialAccounts.userId))
      .where(
        and(
          isNotNull(schema.socialAccounts.claimedAt),
          isNull(schema.socialAccounts.confirmedAt),
          gt(schema.socialAccounts.codeExpiresAt, new Date()),
        ),
      )
      .orderBy(asc(schema.socialAccounts.claimedAt)),
    db
      .select({ id: schema.user.id, name: schema.user.name, email: schema.user.email, closedAt: schema.user.closedAt })
      .from(schema.user)
      .where(isNotNull(schema.user.closedAt))
      .orderBy(desc(schema.user.closedAt)),
  ]);
  const waiting = profiles.filter((p) => p.profile.status === "pending");
  const others = profiles.filter((p) => p.profile.status !== "pending");
  const button = "rounded border border-neutral-500 px-3 py-1.5";
  const primary = "rounded bg-blue-600 px-3 py-1.5 font-medium text-white";

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-10">
      <p className="text-sm">
        <Link href="/admin" className="underline underline-offset-2">
          ← Admin: payments
        </Link>
      </p>
      <h1 className="mt-4 text-2xl font-semibold">Admin: hosts and accounts</h1>

      {notice && (
        <p role="status" className="mt-4 rounded border border-neutral-400 p-3 text-sm">
          {notice}
        </p>
      )}

      <h2 className="mt-8 text-lg font-semibold">Host profiles waiting for approval ({waiting.length})</h2>
      <p className="mt-1 text-sm opacity-70">
        A profile is not public until you approve it. Check that the person is not posing as someone else.
      </p>
      {waiting.length === 0 ? (
        <p className="mt-3 text-sm opacity-70">Nothing is waiting.</p>
      ) : (
        <ul className="mt-3 space-y-4">
          {waiting.map(({ profile, email, accountName }) => (
            <li key={profile.userId} className="rounded border border-neutral-400 p-4 text-sm">
              <p className="font-medium">
                {profile.displayName} <span className="opacity-70">@{profile.handle}</span>
              </p>
              <p className="mt-1 opacity-80">
                Account: {accountName}, {email}
              </p>
              <p className="mt-1">
                {profile.pricePer15Cents === 0 ? "Free calls" : `${formatMoney(profile.pricePer15Cents)} per 15 minutes`}
              </p>
              {profile.about && <p className="mt-1 whitespace-pre-line">{profile.about}</p>}
              <form action={decideProfileAction} className="mt-3 flex gap-3">
                <input type="hidden" name="userId" value={profile.userId} />
                <input type="hidden" name="seenName" value={profile.displayName} />
                <input type="hidden" name="seenAbout" value={profile.about} />
                <button type="submit" name="decision" value="approved" className={primary}>
                  Approve
                </button>
                <button type="submit" name="decision" value="declined" className={button}>
                  Decline
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}

      <h2 className="mt-10 text-lg font-semibold">Social media accounts to check ({claims.length})</h2>
      <p className="mt-1 text-sm opacity-70">
        Open the link, look for the code in that account&apos;s bio, and say whether it is there.
      </p>
      {claims.length === 0 ? (
        <p className="mt-3 text-sm opacity-70">Nothing is waiting.</p>
      ) : (
        <ul className="mt-3 space-y-4">
          {claims.map(({ claim, displayName, handle }) => (
            <li key={claim.id} className="rounded border border-neutral-400 p-4 text-sm">
              <p className="font-medium">
                {displayName} <span className="opacity-70">@{handle}</span> says they own{" "}
                {isNetwork(claim.network) ? NETWORKS[claim.network].label : claim.network} @{claim.nameKey}
              </p>
              <p className="mt-1">
                Open:{" "}
                <a href={claim.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                  {claim.url}
                </a>
              </p>
              <p className="mt-1">
                The bio must contain: <code className="font-mono font-semibold">{claim.code}</code>
              </p>
              <form action={decideSocialAction} className="mt-3 flex gap-3">
                <input type="hidden" name="id" value={claim.id} />
                <input type="hidden" name="nameKey" value={claim.nameKey} />
                <input type="hidden" name="code" value={claim.code} />
                <button type="submit" name="found" value="yes" className={primary}>
                  The code is there: confirm
                </button>
                <button type="submit" name="found" value="no" className={button}>
                  The code is not there
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}

      <h2 className="mt-10 text-lg font-semibold">All other host profiles ({others.length})</h2>
      {others.length > 0 && (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-neutral-400">
              <tr>
                <th className="py-2 pr-3 font-medium">Host</th>
                <th className="py-2 pr-3 font-medium">Account</th>
                <th className="py-2 pr-3 font-medium">Status</th>
                <th className="py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {others.map(({ profile, email }) => (
                <tr key={profile.userId} className="border-b border-neutral-300/40">
                  <td className="py-1.5 pr-3">
                    {profile.displayName} <span className="opacity-70">@{profile.handle}</span>
                  </td>
                  <td className="py-1.5 pr-3">{email}</td>
                  <td className="py-1.5 pr-3">
                    {STATUS_LABEL[profile.status] ?? profile.status}
                    {profile.hidden ? ", hidden by the host" : ""}
                  </td>
                  <td className="py-1.5">
                    <form action={decideProfileAction}>
                      <input type="hidden" name="userId" value={profile.userId} />
                <input type="hidden" name="seenName" value={profile.displayName} />
                <input type="hidden" name="seenAbout" value={profile.about} />
                      {profile.status === "approved" ? (
                        <button type="submit" name="decision" value="suspended" className="underline underline-offset-2">
                          Suspend
                        </button>
                      ) : (
                        <button type="submit" name="decision" value="approved" className="underline underline-offset-2">
                          Approve
                        </button>
                      )}
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="mt-10 text-lg font-semibold">Close an account</h2>
      <p className="mt-1 text-sm opacity-70">
        For fakes, abuse, or when a person asks. The account is logged out everywhere and cannot log in, and its calls
        that have not started are cancelled at no charge. Nothing is deleted, and you can open the account again below.
      </p>
      <form action={closeAccountAction} className="mt-3 flex items-end gap-2 text-sm">
        <label>
          The account&apos;s email address
          <input name="email" type="email" required className="mt-1 block w-72 rounded border border-neutral-400 bg-transparent px-2 py-1" />
        </label>
        <button type="submit" className={button}>
          Close this account
        </button>
      </form>

      {closed.length > 0 && (
        <>
          <h3 className="mt-6 font-semibold">Closed accounts ({closed.length})</h3>
          <ul className="mt-2 space-y-1 text-sm">
            {closed.map((person) => (
              <li key={person.id} className="flex flex-wrap items-center gap-3">
                <span>
                  {person.name}, {person.email}, closed <LocalTime iso={person.closedAt!.toISOString()} />
                </span>
                <form action={reopenAccountAction}>
                  <input type="hidden" name="userId" value={person.id} />
                  <button type="submit" className="underline underline-offset-2">
                    Open again
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
