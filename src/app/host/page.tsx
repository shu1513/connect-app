import { eq } from "drizzle-orm";
import Link from "next/link";
import { LocalTime } from "@/components/local-time";
import { db, schema } from "@/db";
import { readNotice } from "@/lib/notice";
import { getHostSettings, refreshPayoutsReady } from "@/lib/payments/hosts";
import { FREE_CANCEL_CHOICES_MINUTES } from "@/lib/payments/rules";
import { stripeConfigured } from "@/lib/payments/stripe";
import { ABOUT_MAX, NAME_MAX, NAME_MIN } from "@/lib/profiles/profiles";
import { isNetwork, NETWORKS } from "@/lib/profiles/social";
import { requireUser } from "@/lib/session";
import {
  addSocial,
  createProfile,
  removeSocial,
  saveCancelRule,
  saveProfile,
  setHidden,
  socialReady,
  startPayoutSetup,
} from "./actions";

const RULE_LABEL: Record<number, string> = {
  0: "Any time before the start (our default)",
  60: "Until 1 hour before the start",
  720: "Until 12 hours before the start",
  1440: "Until 24 hours before the start",
};

export default async function HostPage(props: PageProps<"/host">) {
  const user = await requireUser();
  const notice = readNotice("/host", await props.searchParams);
  const [profile] = await db.select().from(schema.hostProfiles).where(eq(schema.hostProfiles.userId, user.id));
  const socials = profile
    ? await db.select().from(schema.socialAccounts).where(eq(schema.socialAccounts.userId, user.id)).orderBy(schema.socialAccounts.network)
    : [];
  const field = "mt-1 w-full rounded border border-neutral-400 bg-transparent px-3 py-2";
  const smallButton = "rounded border border-neutral-500 px-3 py-1.5 text-sm";
  const now = new Date();

  let settings = await getHostSettings(user.id);
  // Always ask Stripe; never assume the account is ready.
  if (settings.stripeAccountId && stripeConfigured()) {
    await refreshPayoutsReady(user.id).catch(() => undefined);
    settings = await getHostSettings(user.id);
  }

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10">
      <p className="text-sm">
        <Link href="/" className="underline underline-offset-2">
          ← Your calls
        </Link>
      </p>
      <h1 className="mt-4 text-2xl font-semibold">Hosting settings</h1>

      {notice && (
        <p role="status" className="mt-4 rounded border border-neutral-400 p-3 text-sm">
          {notice}
        </p>
      )}

      <section className="mt-8">
        <h2 className="text-lg font-semibold">Your host profile</h2>
        {!profile ? (
          <>
            <p className="mt-2 text-sm opacity-70">
              Fill this in to become a host. Your page becomes public once we have approved it.
            </p>
            <form action={createProfile} className="mt-3 max-w-md space-y-3">
              <label className="block text-sm">
                Display name (what people see)
                <input name="displayName" type="text" defaultValue={user.name} required minLength={NAME_MIN} maxLength={NAME_MAX} className={field} />
              </label>
              <label className="block text-sm">
                Handle (the address of your page: /h/your_handle)
                <input name="handle" type="text" required minLength={3} maxLength={30} pattern="[A-Za-z0-9_]+" autoCapitalize="none" className={field} />
                <span className="mt-1 block opacity-70">
                  3 to 30 letters, numbers and underscores. Choose carefully: only support can change it later.
                </span>
              </label>
              <label className="block text-sm">
                About you (up to {ABOUT_MAX} characters)
                <textarea name="about" rows={3} maxLength={ABOUT_MAX} className={field} />
              </label>
              <label className="block text-sm">
                Price per 15 minutes, in US dollars (at least $5, or 0 for free calls)
                <input name="price" type="number" min={0} step="0.01" defaultValue="20" required className={field} />
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="us" required className="mt-1" />
                <span>I am based in the United States. (For now, only hosts in the United States can be paid.)</span>
              </label>
              <button type="submit" className="rounded bg-blue-600 px-4 py-2 font-medium text-white">
                Send for approval
              </button>
            </form>
          </>
        ) : (
          <>
            <p className="mt-2 text-sm">
              {profile.status === "pending" && "Waiting for approval. Your page is not public yet."}
              {profile.status === "declined" && "Your profile was not approved. You can change it below and it will be looked at again."}
              {profile.status === "suspended" && "Your profile has been suspended and is not public. Contact support if you think this is a mistake."}
              {profile.status === "approved" && profile.hidden && "Your profile is approved, but hidden by you. Nobody can find it."}
              {profile.status === "approved" && !profile.hidden && (
                <>
                  Your page is public:{" "}
                  <Link href={`/h/${profile.handle}`} className="underline underline-offset-2">
                    /h/{profile.handle}
                  </Link>
                </>
              )}
            </p>
            <form action={saveProfile} className="mt-3 max-w-md space-y-3">
              <p className="text-sm opacity-70">Handle: @{profile.handle} (contact support to change it)</p>
              <label className="block text-sm">
                Display name
                <input name="displayName" type="text" defaultValue={profile.displayName} required minLength={NAME_MIN} maxLength={NAME_MAX} className={field} />
                <span className="mt-1 block opacity-70">Changing your display name sends your profile for approval again.</span>
              </label>
              <label className="block text-sm">
                About you (up to {ABOUT_MAX} characters)
                <textarea name="about" rows={3} maxLength={ABOUT_MAX} defaultValue={profile.about} className={field} />
              </label>
              <label className="block text-sm">
                Price per 15 minutes, in US dollars (at least $5, or 0 for free calls)
                <input name="price" type="number" min={0} step="0.01" defaultValue={(profile.pricePer15Cents / 100).toFixed(2)} required className={field} />
              </label>
              <button type="submit" className={smallButton}>
                Save profile
              </button>
            </form>
            <form action={setHidden} className="mt-3">
              <input type="hidden" name="hidden" value={profile.hidden ? "no" : "yes"} />
              <button type="submit" className="text-sm underline underline-offset-2">
                {profile.hidden ? "Stop hiding my profile" : "Hide my profile (calls already booked still happen)"}
              </button>
            </form>
          </>
        )}
      </section>

      {profile && (
        <section className="mt-10">
          <h2 className="text-lg font-semibold">Your social media accounts</h2>
          <p className="mt-2 text-sm opacity-70">
            Show people that you are the real owner of your accounts. Add an account, put the code we give you in that
            account&apos;s bio, and we will confirm it. Only confirmed accounts are shown on your page.
          </p>
          {socials.length > 0 && (
            <ul className="mt-3 space-y-3">
              {socials.map((social) => {
                const expired = social.codeExpiresAt <= now;
                return (
                  <li key={social.id} className="rounded border border-neutral-400 p-3 text-sm">
                    <p className="font-medium">
                      {isNetwork(social.network) ? NETWORKS[social.network].label : social.network}: @{social.nameKey}
                    </p>
                    {social.confirmedAt ? (
                      <p className="mt-1 text-green-700">Confirmed. It is shown on your page. You can remove the code from the bio.</p>
                    ) : expired ? (
                      <p className="mt-1">The code has run out. Add the account again to get a new one.</p>
                    ) : social.claimedAt ? (
                      <p className="mt-1">
                        Waiting for us to check. Keep <code className="font-mono">{social.code}</code> in the bio until it is confirmed.
                      </p>
                    ) : (
                      <>
                        <p className="mt-1">
                          Put this code anywhere in that account&apos;s bio: <code className="font-mono font-semibold">{social.code}</code>
                        </p>
                        <p className="mt-1 opacity-70">
                          The code works until <LocalTime iso={social.codeExpiresAt.toISOString()} />.
                        </p>
                      </>
                    )}
                    <div className="mt-2 flex gap-4">
                      {!social.confirmedAt && !social.claimedAt && !expired && (
                        <form action={socialReady}>
                          <input type="hidden" name="id" value={social.id} />
                          <button type="submit" className={smallButton}>
                            I&apos;ve done it
                          </button>
                        </form>
                      )}
                      <form action={removeSocial}>
                        <input type="hidden" name="id" value={social.id} />
                        <button type="submit" className="underline underline-offset-2">
                          Remove
                        </button>
                      </form>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <form action={addSocial} className="mt-4 flex max-w-md flex-wrap items-end gap-2">
            <label className="block text-sm">
              Network
              <select name="network" className={field}>
                {Object.entries(NETWORKS).map(([key, rule]) => (
                  <option key={key} value={key}>
                    {rule.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block flex-1 text-sm">
              Account name
              <input name="name" type="text" required maxLength={200} placeholder="@yourname" autoCapitalize="none" className={field} />
            </label>
            <button type="submit" className={smallButton}>
              Add
            </button>
          </form>
          <p className="mt-1 text-sm opacity-70">One account per network. Adding a different name replaces the old one.</p>
        </section>
      )}

      <section className="mt-10">
        <h2 className="text-lg font-semibold">Getting paid</h2>
        {!stripeConfigured() ? (
          <p className="mt-2 text-sm opacity-70">Paid calls are switched off because Stripe is not set up.</p>
        ) : settings.payoutsReady ? (
          <>
            <p className="mt-2 text-sm text-green-700">Your payout account is ready. You can host paid calls.</p>
            <p className="mt-1 text-sm opacity-70">
              You are paid once a week, for calls that ended at least 7 days earlier. Our fee is 4.9% plus 30 cents per
              paid call (1.5% more when the customer&apos;s card is from outside the United States), and 25 cents per payout.
            </p>
            <form action={startPayoutSetup} className="mt-3">
              <button type="submit" className="text-sm underline underline-offset-2">
                Update your payout details at Stripe
              </button>
            </form>
          </>
        ) : (
          <>
            <p className="mt-2 text-sm">
              {settings.stripeAccountId
                ? "Your payout account is not finished yet. Stripe still needs some details from you."
                : "To host paid calls, set up a payout account. Stripe collects your identity and bank details on its own secure pages; we never see them."}
            </p>
            <form action={startPayoutSetup} className="mt-3">
              <button type="submit" className="rounded bg-blue-600 px-4 py-2 font-medium text-white">
                {settings.stripeAccountId ? "Continue payout setup" : "Set up payouts"}
              </button>
            </form>
          </>
        )}
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-semibold">Your cancelling rule</h2>
        <p className="mt-2 text-sm opacity-70">
          How long before the start can a customer cancel for free? After that, cancelling costs them the full booked
          price, and you can still choose to refund them. You can always cancel your own calls for free before they start.
        </p>
        <form action={saveCancelRule} className="mt-3 space-y-2">
          {FREE_CANCEL_CHOICES_MINUTES.map((minutes) => (
            <label key={minutes} className="flex items-center gap-2 text-sm">
              <input type="radio" name="freeCancelMinutes" value={minutes} defaultChecked={settings.freeCancelMinutes === minutes} />
              {RULE_LABEL[minutes]}
            </label>
          ))}
          <button type="submit" className="mt-2 rounded border border-neutral-500 px-3 py-1.5 text-sm">
            Save rule
          </button>
        </form>
      </section>
    </main>
  );
}
