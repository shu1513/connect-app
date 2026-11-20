import type { Metadata } from "next";
import { and, asc, desc, eq, gt, inArray, isNotNull, isNull } from "drizzle-orm";
import Link from "next/link";
import { LocalTime } from "@/components/local-time";
import { db, schema } from "@/db";
import { readNotice } from "@/lib/notice";
import { formatMoney } from "@/lib/payments/access";
import { hostCountryName } from "@/lib/profiles/countries";
import { languageNames } from "@/lib/profiles/languages";
import { photosForAdmin } from "@/lib/profiles/photo";
import { INSTAGRAM_PHOTO, INSTAGRAM_SIGN_IN, refusedBioChecks } from "@/lib/profiles/profiles";
import { isNetwork, NETWORKS } from "@/lib/profiles/social";
import { identityState } from "@/lib/safety/identity";
import { requireAdmin } from "@/lib/session";
import { RULES } from "@/lib/terms";
import { HIGHEST_TOP_PRICE_PER_15_CENTS, MAX_PRICE_PER_15_CENTS, topPriceOf } from "@/lib/payments/pricing";
import { closeAccountAction, decideProfileAction, decideSocialAction, lockPhotoAction, photoReportMadeAction, removePhotoAction, reopenAccountAction, setTopPriceAction } from "./actions";
import { SitePage } from "@/components/site-page";

export const metadata: Metadata = { title: "Hosts and accounts" };

const STATUS_LABEL: Record<string, string> = {
  pending: "Waiting for approval",
  approved: "Approved",
  declined: "Declined",
  suspended: "Suspended",
};

export default async function AdminPeoplePage(props: PageProps<"/admin/people">) {
  const admin = await requireAdmin();
  // The rules a decision can name. The person is told the rule and the sentence typed beside it (plans/46, decision 11).
  const ruleOptions = RULES.map((rule) => (
    <option key={rule.key} value={rule.key}>
      {rule.title}
    </option>
  ));
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
  const identity = new Map<string, Awaited<ReturnType<typeof identityState>>>();
  for (const { profile } of profiles) identity.set(profile.userId, await identityState(profile.userId));
  // Automatic checks of a bio that failed because a network did not accept our own key or permission.
  const refused = await refusedBioChecks(new Date());
  const waiting = profiles.filter((p) => p.profile.status === "pending");
  const others = profiles.filter((p) => p.profile.status !== "pending");
  // The hosts the founder gave a higher top price than everyone's (plans/48).
  const raised = profiles.filter((p) => p.profile.topPricePer15Cents !== null);
  // The confirmed accounts of each waiting host: what the founder compares the name and the handle with.
  const confirmed = waiting.length
    ? await db
        .select({ userId: schema.socialAccounts.userId, network: schema.socialAccounts.network, nameKey: schema.socialAccounts.nameKey, url: schema.socialAccounts.url })
        .from(schema.socialAccounts)
        .where(and(inArray(schema.socialAccounts.userId, waiting.map((p) => p.profile.userId)), isNotNull(schema.socialAccounts.confirmedAt)))
        .orderBy(schema.socialAccounts.network)
    : [];
  // Everyone's photo, a customer's as a host's, the removed-and-reported ones too (plans/29, plans/35). The facts only; a
  // photo itself comes from its own address.
  const photos = await photosForAdmin();
  const hostOf = (userId: string) => profiles.find((p) => p.profile.userId === userId)?.profile;
  const shownPhotos = photos.filter((photo) => !photo.lockedAt);
  const lockedPhotos = photos.filter((photo) => photo.lockedAt);
  const button = "rounded border border-neutral-500 px-3 py-1.5";
  const primary = "rounded bg-blue-600 px-3 py-1.5 font-medium text-white";

  return (
    <SitePage className="mx-auto w-full max-w-4xl px-4 py-10">
      <p className="text-sm">
        <Link href="/admin" className="inline-flex min-h-11 items-center underline underline-offset-2">
          ← Admin
        </Link>
      </p>
      <h1 className="mt-4 text-2xl font-semibold">Admin: hosts and accounts</h1>

      {notice && (
        <p role="status" className="mt-4 rounded border border-neutral-400 p-3 text-sm">
          {notice}
        </p>
      )}

      {refused.map(({ network, count }) =>
        network === INSTAGRAM_PHOTO ? (
          // A request for a host's photo, not a check of a bio.
          <p key={network} role="alert" className="mt-4 rounded border border-red-600 p-3 text-sm">
            Hosts&apos; photos from Instagram have been failing: Meta did not accept our key or our permission, {count} {count === 1 ? "time" : "times"} in the last 24
            hours. Hosts are told to try again later; no photo is taken wrongly.
          </p>
        ) : network === INSTAGRAM_SIGN_IN ? (
          // A sign-in at Meta, not a check of a bio: its own words from start to end.
          <p key={network} role="alert" className="mt-4 rounded border border-red-600 p-3 text-sm">
            &quot;Connect your Instagram&quot; has been failing: Meta did not accept our app&apos;s number or return address when a host signed in, {count}{" "}
            {count === 1 ? "time" : "times"} in the last 24 hours. Hosts are told to try again later or to use the code; nobody is confirmed wrongly.
          </p>
        ) : (
          <p key={network} role="alert" className="mt-4 rounded border border-red-600 p-3 text-sm">
            Automatic {isNetwork(network) ? NETWORKS[network].label : network} checks have been failing:{" "}
            {network === "youtube" ? "Google" : network === "tiktok" ? "TikTok" : "Meta"} did not accept our key or our permission in {count}{" "}
            {count === 1 ? "check" : "checks"} in the last 24 hours. Hosts are told to try again later; nobody is confirmed wrongly.
          </p>
        ),
      )}

      <h2 className="mt-8 text-lg font-semibold">Host profiles waiting for approval ({waiting.length})</h2>
      <p className="mt-1 text-sm opacity-70">
        A profile is not public until you approve it. Check that the person is not posing as someone else: do the name
        and the handle fit the confirmed accounts?
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
                Account: {accountName}, {email}. Based in: {hostCountryName(profile.country)}. Languages:{" "}
                {languageNames(profile.languages).join(", ") || "none chosen"}.
              </p>
              <p className="mt-1">
                {identity.get(profile.userId)?.passed
                  ? `Identity confirmed. Name on the ID: ${identity.get(profile.userId)?.verifiedName ?? "(not given)"}.`
                  : "Identity not confirmed yet: this profile cannot be approved until it is."}
              </p>
              <p className="mt-1">
                {confirmed.some((account) => account.userId === profile.userId) ? (
                  <>
                    Confirmed accounts:{" "}
                    {confirmed
                      .filter((account) => account.userId === profile.userId)
                      .map((account, index) => (
                        <span key={account.network}>
                          {index > 0 && ", "}
                          <a href={account.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                            {isNetwork(account.network) ? NETWORKS[account.network].label : account.network} @{account.nameKey}
                          </a>
                        </span>
                      ))}
                  </>
                ) : (
                  "No confirmed social media account yet: this profile cannot be approved until there is one."
                )}
              </p>
              <p className="mt-1">
                {profile.pricePer15Cents === 0 ? "Free calls" : `${formatMoney(profile.pricePer15Cents)} per 15 minutes`}
              </p>
              {profile.about && <p className="mt-1 whitespace-pre-line">{profile.about}</p>}
              <form action={decideProfileAction} className="mt-3 flex flex-wrap items-end gap-3">
                <input type="hidden" name="userId" value={profile.userId} />
                <label className="block text-sm">
                  To decline: the rule
                  <select name="ruleKey" defaultValue="" className="mt-1 block rounded border border-neutral-400 bg-transparent px-2 py-1">
                    <option value="">Choose a rule</option>
                    {ruleOptions}
                  </select>
                </label>
                <label className="block text-sm">
                  What happened, in a sentence (the person is told this)
                  <input name="reasonNote" maxLength={500} className="mt-1 block w-72 rounded border border-neutral-400 bg-transparent px-2 py-1" />
                </label>
                <input type="hidden" name="seenName" value={profile.displayName} />
                <input type="hidden" name="seenAbout" value={profile.about} />
                <input type="hidden" name="seenIdentity" value={identity.get(profile.userId)?.checkId ?? ""} />
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
        Open the link, look for the code in that account&apos;s bio, and say whether it is there. Instagram and YouTube
        accounts are normally confirmed by Connect itself. They come here only when their keys are not set up, or when
        they were already waiting.
      </p>
      {claims.length === 0 ? (
        <p className="mt-3 text-sm opacity-70">Nothing is waiting.</p>
      ) : (
        <ul className="mt-3 space-y-4">
          {claims.map(({ claim, displayName, handle }) => (
            <li key={claim.id} className="rounded border border-neutral-400 p-4 text-sm">
              <p className="font-medium">
                {displayName} <span className="opacity-70">@{handle}</span> says they run{" "}
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
                  <td className="py-1.5 pr-3">
                    {email}
                    <span className="opacity-70">
                      , {hostCountryName(profile.country)}, {languageNames(profile.languages).join(", ") || "no languages chosen"}
                    </span>
                  </td>
                  <td className="py-1.5 pr-3">
                    {STATUS_LABEL[profile.status] ?? profile.status}
                    {profile.hidden ? ", hidden by the host" : ""}
                  </td>
                  <td className="py-1.5">
                    <form action={decideProfileAction} className="space-y-1">
                      <input type="hidden" name="userId" value={profile.userId} />
                <input type="hidden" name="seenName" value={profile.displayName} />
                <input type="hidden" name="seenAbout" value={profile.about} />
                      {profile.status === "approved" && (
                        <>
                <label className="block text-sm">
                  To suspend: the rule
                  <select name="ruleKey" defaultValue="" className="mt-1 block rounded border border-neutral-400 bg-transparent px-2 py-1">
                    <option value="">Choose a rule</option>
                    {ruleOptions}
                  </select>
                </label>
                <label className="block text-sm">
                  What happened, in a sentence (the person is told this)
                  <input name="reasonNote" maxLength={500} className="mt-1 block w-72 rounded border border-neutral-400 bg-transparent px-2 py-1" />
                </label>
                        </>
                      )}
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

      <h2 id="top-price" className="mt-10 text-lg font-semibold">A higher top price for one host ({raised.length})</h2>
      <p className="mt-1 text-sm opacity-70">
        Every host can charge up to {formatMoney(MAX_PRICE_PER_15_CENTS)} per 15 minutes. Here you can let one host charge more, up to{" "}
        {formatMoney(HIGHEST_TOP_PRICE_PER_15_CENTS)}. Give this only to a host you have checked yourself: the whole price of a call is held on the customer&apos;s card, and Connect
        carries the loss when a customer&apos;s bank takes a payment back. To take it away again, choose the host and press &quot;Put back to{" "}
        {formatMoney(MAX_PRICE_PER_15_CENTS)}&quot;. If a host&apos;s price is above the new top price, it comes down to it at once and the host is told by email; requests and calls already made keep their price.
      </p>
      {profiles.length === 0 ? (
        <p className="mt-2 text-sm opacity-70">There are no hosts yet.</p>
      ) : (
        <form action={setTopPriceAction} className="mt-3 flex flex-wrap items-end gap-3 text-sm" data-top-price-form>
          <label className="block">
            Host
            <select name="userId" required defaultValue="" className="mt-1 block max-w-full rounded border border-neutral-400 bg-transparent px-2 py-1">
              <option value="" disabled>
                Choose a host
              </option>
              {[...profiles]
                .sort((a, b) => a.profile.displayName.localeCompare(b.profile.displayName))
                .map(({ profile }) => (
                  <option key={profile.userId} value={profile.userId}>
                    {profile.displayName} @{profile.handle}: price {formatMoney(profile.pricePer15Cents)}, top price {formatMoney(topPriceOf(profile))}
                  </option>
                ))}
            </select>
          </label>
          <label className="block">
            Top price per 15 minutes, in US dollars
            <input
              name="topPrice"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              placeholder="for example 2000"
              className="mt-1 block w-48 rounded border border-neutral-400 bg-transparent px-2 py-1"
            />
          </label>
          <button type="submit" className={primary}>
            Save the top price
          </button>
          <button type="submit" name="takeAway" value="1" className={button}>
            Put back to {formatMoney(MAX_PRICE_PER_15_CENTS)}
          </button>
        </form>
      )}
      {raised.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm" data-top-prices>
          {raised.map(({ profile, email }) => (
            <li key={profile.userId}>
              {profile.displayName} <span className="opacity-70">@{profile.handle}</span>, {email}: up to {formatMoney(topPriceOf(profile))} per 15 minutes. Their price now:{" "}
              {formatMoney(profile.pricePer15Cents)}.
            </li>
          ))}
        </ul>
      )}

      <h2 id="photos" className="mt-10 text-lg font-semibold">Photos ({shownPhotos.length})</h2>
      <p className="mt-1 text-sm opacity-70">
        A photo is a picture the person uploaded, or for a host the profile picture of their confirmed Instagram or TikTok account, checked by an outside service before it was shown.
        A customer&apos;s photo is seen only by hosts they have asked for a call. &quot;Remove&quot; deletes it; the person can choose one again. &quot;Remove and report&quot; is for a photo
        you suspect of showing child abuse: nobody sees it again, it is kept exactly as it is, and the person can choose no other.
      </p>
      {shownPhotos.length === 0 ? (
        <p className="mt-2 text-sm opacity-70">Nobody has a photo.</p>
      ) : (
        <ul className="mt-3 space-y-3" data-host-photos>
          {shownPhotos.map((photo) => (
            <li key={photo.id} className="flex flex-wrap items-center gap-4 rounded border border-neutral-400 p-3 text-sm">
              {/* eslint-disable-next-line @next/next/no-img-element -- the framework's picture component would make and keep copies of its own */}
              <img src={`/host-photos/${photo.id}`} width={96} height={96} alt="" className="size-24 rounded object-cover" />
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {hostOf(photo.userId) ? (
                    <>
                      {hostOf(photo.userId)?.displayName} <span className="opacity-70">@{hostOf(photo.userId)?.handle}</span>
                    </>
                  ) : (
                    <>
                      {photo.name} <span className="opacity-70">(not a host)</span>
                    </>
                  )}
                </p>
                <p className="mt-1">
                  {photo.network === "upload" ? "Uploaded" : <>From {isNetwork(photo.network) ? NETWORKS[photo.network].label : photo.network} @{photo.sourceNameKey}, taken</>}{" "}
                  <LocalTime iso={photo.takenAt.toISOString()} />.
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-4">
                  <form action={removePhotoAction}>
                    <input type="hidden" name="photoId" value={photo.id} />
                    <button type="submit" className={button}>
                      Remove
                    </button>
                  </form>
                  <form action={lockPhotoAction} className="flex flex-wrap items-center gap-2">
                    <input type="hidden" name="photoId" value={photo.id} />
                    <label className="flex items-center gap-1">
                      <input type="checkbox" name="sure" /> I am sure
                    </label>
                    <button type="submit" className="rounded border border-red-600 px-3 py-1.5">
                      Remove and report
                    </button>
                  </form>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {lockedPhotos.length > 0 && (
        <>
          <h3 className="mt-6 font-semibold">Removed and reported ({lockedPhotos.length})</h3>
          <p className="mt-1 text-sm opacity-70">
            These photos are kept exactly as they were and shown by nothing in the app. Report each to the authorities the way your lawyer has told you to, then write
            down here when you did.
          </p>
          <ul className="mt-3 space-y-3" data-locked-photos>
            {lockedPhotos.map((photo) => (
              <li key={photo.id} className="rounded border border-red-600 p-3 text-sm">
                <p>
                  The photo of {hostOf(photo.userId) ? `${hostOf(photo.userId)?.displayName} (@${hostOf(photo.userId)?.handle})` : `${photo.name} (not a host)`},{" "}
                  {photo.network === "upload" ? "uploaded" : <>from {isNetwork(photo.network) ? NETWORKS[photo.network].label : photo.network} @{photo.sourceNameKey}</>}. Removed and kept{" "}
                  <LocalTime iso={photo.lockedAt!.toISOString()} />.
                </p>
                {photo.reportMadeAt ? (
                  <p className="mt-1">
                    You made the report <LocalTime iso={photo.reportMadeAt.toISOString()} />.
                  </p>
                ) : (
                  <form action={photoReportMadeAction} className="mt-2 flex flex-wrap items-end gap-3">
                    <input type="hidden" name="photoId" value={photo.id} />
                    <label>
                      When you made the report ({admin.timeZone ?? "UTC"} time)
                      <input name="madeAt" type="datetime-local" required className="mt-1 block rounded border border-neutral-400 bg-transparent px-2 py-1" />
                    </label>
                    <button type="submit" className={button}>
                      I have made the report
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      <h2 className="mt-10 text-lg font-semibold">Close an account</h2>
      <p className="mt-1 text-sm opacity-70">
        For fakes, abuse, or when a person asks. The account is logged out everywhere and cannot log in, and its calls
        that have not started are cancelled at no charge. Nothing is deleted but the host&apos;s photo, and you can open the account again below.
      </p>
      <p className="mt-1 text-sm opacity-70">
        The person is emailed the reason you give. For a host in the United Kingdom or Europe, the Host Agreement (17.5) promises 30 days&apos; written
        notice before a page is closed for good, unless the law requires it sooner, the host broke the agreement repeatedly, or the reason is illegal or
        harmful content, fraud or a risk to someone&apos;s safety. Suspend first, and close after the notice, when none of those applies.
      </p>
      <form action={closeAccountAction} className="mt-3 flex flex-wrap items-end gap-2 text-sm">
        <label>
          The account&apos;s email address
          <input name="email" type="email" required className="mt-1 block w-72 rounded border border-neutral-400 bg-transparent px-2 py-1" />
        </label>
                <label className="block text-sm">
                  The rule
                  <select name="ruleKey" defaultValue="" className="mt-1 block rounded border border-neutral-400 bg-transparent px-2 py-1">
                    <option value="">Choose a rule</option>
                    <option value="own_request">At the person&apos;s own request (no rule)</option>
                    {ruleOptions}
                  </select>
                </label>
                <label className="block text-sm">
                  What happened, in a sentence (the person is told this)
                  <input name="reasonNote" maxLength={500} className="mt-1 block w-72 rounded border border-neutral-400 bg-transparent px-2 py-1" />
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
    </SitePage>
  );
}
