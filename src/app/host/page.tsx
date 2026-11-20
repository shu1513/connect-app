import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import Link from "next/link";
import { LocalTime } from "@/components/local-time";
import { db, schema } from "@/db";
import { hoursAndTimeOff } from "@/lib/booking/calendar";
import { readNotice } from "@/lib/notice";
import { getHostSettings, refreshPayoutsReady } from "@/lib/payments/hosts";
import { HOME_COUNTRY, HOST_COUNTRIES, hostCountryName } from "@/lib/profiles/countries";
import { FREE_CANCEL_CHOICES_MINUTES } from "@/lib/payments/rules";
import { stripeConfigured } from "@/lib/payments/stripe";
import { bioSettings, isAutomatic } from "@/lib/profiles/bio-check";
import { ownPhotoState } from "@/lib/profiles/photo";
import { languageNames } from "@/lib/profiles/languages";
import { PHOTO } from "@/lib/profiles/photo-rules";
import { ABOUT_MAX, NAME_MAX, NAME_MIN, sellerKindOf } from "@/lib/profiles/profiles";
import { acceptedHostAgreementBefore, holdsHostAgreement, shownValue } from "@/legal/accept";
import { dayInWords } from "@/legal/notices";
import { agreementsToAccept, comingVersion, versionHref } from "@/legal/versions";
import { isNetwork, NETWORKS } from "@/lib/profiles/social";
import { instagramSignInOn } from "@/lib/profiles/instagram";
import { tiktokSignInOn } from "@/lib/profiles/tiktok";
import { runningProjectOf, startProblem } from "@/lib/projects/projects";
import { identityState } from "@/lib/safety/identity";
import { requireUser } from "@/lib/session";
import {
  answerHostBoxAction,
  addSocial,
  connectInstagram,
  connectTikTok,
  createProfile,
  removeOwnPhoto,
  removeSocial,
  saveCancelRule,
  saveProfile,
  saveVerifiedOnly,
  setHidden,
  socialReady,
  startPayoutSetup,
  usePhoto,
  useTikTokPhoto,
} from "./actions";
import { HostPhoto } from "@/components/host-photo";
import { SitePage } from "@/components/site-page";
import { Earnings } from "./earnings";
import { LanguagePicker } from "./language-picker";
import { MembershipPart } from "./membership";

export const metadata: Metadata = { title: "Hosting" };

const RULE_LABEL: Record<number, string> = {
  0: "Any time before the start (our default)",
  60: "Until 1 hour before the start",
  720: "Until 12 hours before the start",
  1440: "Until 24 hours before the start",
};

export default async function HostPage(props: PageProps<"/host">) {
  const user = await requireUser("/host");
  const notice = readNotice("/host", await props.searchParams);
  const identity = await identityState(user.id);
  const [profile] = await db.select().from(schema.hostProfiles).where(eq(schema.hostProfiles.userId, user.id));
  // The Host Agreement in effect, as the forms below show and send it (plans/46, part 1).
  const hostAgreements = agreementsToAccept("hosting", new Date());
  const sellerKind = profile ? sellerKindOf(profile) : null;
  // A host from before the Host Agreement existed, or one who has not said business or private, is asked in a box at the top.
  const holdsAgreement = profile ? await holdsHostAgreement(user.id, new Date()) : true;
  const boxNeeded = Boolean(profile) && (!holdsAgreement || sellerKind === null);
  // The box's words follow what is missing. A host who has said business or private is only asked for the Host
  // Agreement: as "a new version" if she accepted an earlier one (part 2), and as the one thing missing if not.
  const agreementOnly = Boolean(profile) && !holdsAgreement && sellerKind !== null;
  const boxWords = !agreementOnly
    ? { title: "Two things we need from you", text: "Hosts on Connect accept the Host Agreement and say how they offer their calls. Please answer both below." }
    : (await acceptedHostAgreementBefore(user.id))
      ? { title: "The Host Agreement has a new version", text: "Please read the new version and accept it below. Your answer about how you offer calls is kept; you can change it here." }
      : { title: "One thing we need from you", text: "Hosts on Connect accept the Host Agreement. Please read it and accept it below. Your answer about how you offer calls is kept; you can change it here." };
  // A version of the Host Agreement whose day has not come: said here ahead of its day, as the email says it, also
  // to someone who is about to apply, beside the form that accepts today's version.
  const comingAgreement = comingVersion("host-agreement", new Date());
  const sellerChoice = (chosen: string | null) => (
    <fieldset className="text-sm">
      <legend>Do you offer calls as a business, or as a private person?</legend>
      <label className="mt-1 flex items-start gap-2">
        <input type="radio" name="sellerKind" value="private" required defaultChecked={chosen === "private"} className="mt-1" />
        <span>As a private person</span>
      </label>
      <label className="mt-1 flex items-start gap-2">
        <input type="radio" name="sellerKind" value="business" required defaultChecked={chosen === "business"} className="mt-1" />
        <span>As a business (it is part of your work or trade, or you do it regularly to earn money)</span>
      </label>
      <span className="mt-1 block opacity-70">Your page shows this. In some countries a customer has more rights when buying from a business.</span>
    </fieldset>
  );
  const hostAgreementTick = (
    <>
      <input type="hidden" name="shown" value={shownValue(hostAgreements)} />
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="hostAgreement" required className="mt-1" />
        <span>
          I have read and accept the{" "}
          {hostAgreements.map((agreement) => (
            <Link key={agreement.name} href={agreement.href} target="_blank" className="underline underline-offset-2" data-agreement={`${agreement.name}@${agreement.version}`}>
              {agreement.title}
            </Link>
          ))}
          .
        </span>
      </label>
    </>
  );
  const socials = profile
    ? await db.select().from(schema.socialAccounts).where(eq(schema.socialAccounts.userId, user.id)).orderBy(schema.socialAccounts.network)
    : [];
  const field = "mt-1 w-full rounded border border-neutral-400 bg-transparent px-3 py-2";
  const smallButton = "rounded border border-neutral-500 px-3 py-1.5 text-sm";
  const primaryButton = "rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white";
  const now = new Date();

  let settings = await getHostSettings(user.id);
  // Always ask Stripe; never assume the account is ready. If Stripe cannot be asked, the page says so:
  // what it then shows is what was last known, not a fresh answer.
  let payoutsUnchecked = false;
  if (settings.stripeAccountId && stripeConfigured()) {
    await refreshPayoutsReady(user.id).catch(() => {
      payoutsUnchecked = true;
    });
    settings = await getHostSettings(user.id);
  }

  // "Getting started": what a new host has to do before anyone can ask for a call, in order. It reads what is already stored.
  const { hours } = await hoursAndTimeOff(user.id, now);
  const paid = profile ? profile.pricePer15Cents > 0 : false;
  // A host outside the United States is paid in their own money, which Stripe turns their dollars into.
  const abroad = profile ? profile.country !== HOME_COUNTRY : false;
  // The host's saved languages by name; none for a host who has not chosen yet (plans/34-host-languages.md).
  const savedLanguages = profile ? languageNames(profile.languages) : [];
  const proven = socials.some((social) => social.confirmedAt);
  const checkSettings = bioSettings();
  // While this is on, a TikTok account is proven by signing in at TikTok, and no longer with a code.
  const tiktokOn = tiktokSignInOn();
  // While this is on, an Instagram account can also be proven by signing in at Meta. The code stays.
  const instagramOn = instagramSignInOn();
  // The host's photo (plans/29, plans/33): taken from a confirmed Instagram account, with the key that reads bios,
  // or from a confirmed TikTok account, at a sign-in there (Connect keeps no key from TikTok).
  const photoState = profile ? await ownPhotoState(user.id) : { photo: null, locked: false };
  const photoFromInstagram = Boolean(checkSettings.instagram) && socials.some((social) => social.network === "instagram" && social.confirmedAt);
  const photoFromTikTok = tiktokOn && socials.some((social) => social.network === "tiktok" && social.confirmedAt);
  const steps: Array<{ done: boolean; text: string; note?: string; href?: string; go?: string }> = [
    { done: Boolean(profile), text: "Fill in your profile and send it for approval.", href: "#profile", go: "Your host profile" },
    { done: identity.passed, text: "Confirm who you are, with a photo of your ID and a selfie.", href: "/identity?next=%2Fhost", go: "Start the check" },
    {
      done: proven,
      text: "Prove one social media account: Instagram, TikTok, YouTube or X.",
      ...(profile ? { href: "#social", go: "Your social media accounts" } : { note: "You can do this once your profile is sent (step 1)." }),
    },
    {
      done: profile?.status === "approved",
      text: "We approve your page.",
      note: !profile
        ? "This comes after steps 1, 2 and 3."
        : profile.status === "pending"
          ? identity.passed && proven
            ? "We look at every profile ourselves. You will get an email with the answer."
            : !identity.passed && !proven
              ? "We look at your profile once you have confirmed who you are (step 2) and proven one social media account (step 3)."
              : !identity.passed
                ? "We look at your profile once you have confirmed who you are (step 2)."
                : "We look at your profile once you have proven one social media account (step 3)."
          : profile.status === "declined"
            ? "Not approved as it is. Change your profile below and we look at it again."
            : profile.status === "suspended"
              ? "Your page is suspended. Contact support if you think this is a mistake."
              : undefined,
    },
    ...(paid ? [{ done: settings.payoutsReady, text: "Set up payouts, so you can be paid for calls.", href: "#paid", go: "Getting paid" }] : []),
    { done: hours.length > 0, text: "Set up your calendar: your time zone, the call lengths you offer, and your hours.", href: "/host/calendar", go: "Your calendar" },
  ];
  const allDone = steps.every((step) => step.done);

  return (
    <SitePage className="mx-auto w-full max-w-2xl px-4 py-10">
      <h1 className="text-2xl font-semibold">Hosting</h1>
      <p className="mt-2 text-sm">
        <Link href="/host/requests" className="underline underline-offset-2">
          Requests for calls
        </Link>
        <Link href="/host/calendar" className="ml-4 underline underline-offset-2">
          Your calendar (hours, time off, call lengths)
        </Link>
        <Link href="/host/now" className="ml-4 underline underline-offset-2">
          Available now
        </Link>
        <Link href="/connection-test" className="ml-4 underline underline-offset-2">
          Test your connection
        </Link>
      </p>

      {notice && (
        <p role="status" className="mt-4 rounded border border-neutral-400 p-3 text-sm">
          {notice}
        </p>
      )}

      {user.paused && (
        <p className="mt-6 rounded border border-red-600 p-3 text-sm">
          Your account is paused, so nobody can ask you for a call at the moment, whatever is set up below.{" "}
          <Link href="/paused" className="underline underline-offset-2">
            Why, and what to do
          </Link>
        </p>
      )}

      {!allDone && (
        <section className="mt-6 rounded border border-blue-600 p-4 text-sm">
          <h2 className="text-base font-semibold">Getting started</h2>
          <p className="mt-1 opacity-80">People can ask you for a call once every step here is done.</p>
          <ol className="mt-3 space-y-2">
            {steps.map((step, index) => (
              <li key={step.text} className="flex gap-2">
                <span aria-hidden className={step.done ? "text-green-700" : "opacity-50"}>
                  {step.done ? "✓" : "○"}
                </span>
                <span>
                  <span className="sr-only">{step.done ? "Done: " : "To do: "}</span>
                  {index + 1}. {step.text}
                  {!step.done && step.href && (
                    <>
                      {" "}
                      <Link href={step.href} className="underline underline-offset-2">
                        {step.go}
                      </Link>
                    </>
                  )}
                  {!step.done && step.note && <span className="block opacity-80">{step.note}</span>}
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}

      <section className="mt-8">
        <h2 className="text-lg font-semibold">Confirm who you are</h2>
        {identity.passed ? (
          <p className="mt-2 text-sm text-green-700">Done. Your identity is confirmed.</p>
        ) : (
          <p className="mt-2 text-sm">
            Before your profile can be approved, confirm that you are a real adult with a photo of your ID and a selfie, on Stripe&apos;s own
            pages.{" "}
            <Link href="/identity?next=%2Fhost" className="underline underline-offset-2">
              Start here
            </Link>
            .
          </p>
        )}
      </section>

      {comingAgreement && (
        <p role="note" className="mt-8 rounded border border-neutral-400 p-3 text-sm" data-agreement-coming={`host-agreement@${comingAgreement.version}`}>
          <strong>A new version of the Host Agreement takes effect on {dayInWords(comingAgreement.effectiveFrom)}.</strong> {comingAgreement.summary}{" "}
          <Link href={versionHref("host-agreement", comingAgreement.version)} target="_blank" className="underline underline-offset-2">
            Read the new version
          </Link>
          . {profile ? "From that day this page asks you to accept it." : "If you apply before that day you accept today's version, and from that day this page asks you to accept the new one."}
        </p>
      )}

      {boxNeeded && (
        <section className="mt-8 rounded border border-neutral-500 p-4" data-host-box>
          <h2 className="text-lg font-semibold">{boxWords.title}</h2>
          <p className="mt-2 text-sm">{boxWords.text}</p>
          <form action={answerHostBoxAction} className="mt-3 max-w-md space-y-3">
            {sellerChoice(sellerKind)}
            {hostAgreementTick}
            <button type="submit" className="rounded bg-blue-600 px-4 py-2 font-medium text-white">
              Save
            </button>
          </form>
        </section>
      )}

      <section id="profile" className="mt-8 scroll-mt-4">
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
              <LanguagePicker chosen={[]} />
              <label className="block text-sm">
                Price per 15 minutes, in US dollars (at least $5)
                <input name="price" type="number" min={5} step="0.01" defaultValue="20" required className={field} />
              </label>
              <label className="block text-sm">
                Where are you based?
                <select name="country" required defaultValue="" className={field}>
                  <option value="" disabled>
                    Choose your country
                  </option>
                  {HOST_COUNTRIES.map((country) => (
                    <option key={country.code} value={country.code}>
                      {country.name}
                    </option>
                  ))}
                </select>
                <span className="mt-1 block opacity-70">
                  For now, hosts can only be paid in these countries. Choose carefully: this cannot be changed later, because your payout account is
                  opened for this country. Outside the United States: your price and your earnings are in US dollars, and Stripe pays you in your
                  own money at its exchange rate of that moment.
                </span>
              </label>
              {sellerChoice(null)}
              {hostAgreementTick}
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
              {(profile.status === "declined" || profile.status === "suspended") && profile.decidedReason && (
                <span className="mt-1 block" data-decided-reason>
                  The reason: {profile.decidedReason}
                </span>
              )}
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
              <p className="text-sm opacity-70" data-host-country={profile.country}>
                Based in: {hostCountryName(profile.country)} (this cannot be changed; write to support if it is wrong)
              </p>
              <label className="block text-sm">
                Display name
                <input name="displayName" type="text" defaultValue={profile.displayName} required minLength={NAME_MIN} maxLength={NAME_MAX} className={field} />
                <span className="mt-1 block opacity-70">Changing your display name sends your profile for approval again.</span>
              </label>
              <label className="block text-sm">
                About you (up to {ABOUT_MAX} characters)
                <textarea name="about" rows={3} maxLength={ABOUT_MAX} defaultValue={profile.about} className={field} />
              </label>
              <p className="text-sm" data-host-languages={savedLanguages.length}>
                {savedLanguages.length > 0 ? (
                  <span className="opacity-70">{`Saved languages: ${savedLanguages.join(", ")}`}</span>
                ) : (
                  "You have not chosen your languages yet. Tick the ones you can hold a call in, so people know they can talk with you."
                )}
              </p>
              <LanguagePicker chosen={profile.languages} />
              {sellerChoice(sellerKind)}
              <label className="block text-sm">
                Price per 15 minutes, in US dollars (at least $5)
                {/* A host from before free calls were taken away is shown the lowest price, and must save one. */}
                <input name="price" type="number" min={5} step="0.01" defaultValue={(Math.max(profile.pricePer15Cents, 500) / 100).toFixed(2)} required className={field} />
                {profile.pricePer15Cents === 0 && (
                  <span className="mt-1 block text-sm" data-free-no-more>
                    You can no longer set a price of zero. Saving this form sets your price for new requests to at least $5 per 15 minutes. Requests and calls already made keep their price.
                  </span>
                )}
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
        <section id="social" className="mt-10 scroll-mt-4">
          <h2 className="text-lg font-semibold">Your social media accounts</h2>
          <p className="mt-2 text-sm opacity-70">
            People find you by these names, and one of them shows us that you run that account. Your page needs at least one
            confirmed account before we can approve it. Add an account, put the code we give you in that account&apos;s bio
            (on YouTube, the channel&apos;s description), and press the button next to it. Where we can, the account is
            confirmed at once; otherwise we look ourselves. Only confirmed accounts are shown on your page.
          </p>
          {tiktokOn && (
            <form action={connectTikTok} className="mt-3">
              <button type="submit" className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white">
                Connect your TikTok
              </button>
              <p className="mt-1 text-sm opacity-70">
                For TikTok there is no code: you log in at TikTok, and your account is confirmed at once. We never see your
                TikTok password.
              </p>
            </form>
          )}
          {instagramOn && (
            <form action={connectInstagram} className="mt-3">
              <button type="submit" className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white">
                Connect your Instagram
              </button>
              <p className="mt-1 text-sm opacity-70">
                A way to confirm your Instagram account without a code: log in at Meta and share the account with us. It works for
                Creator and Business accounts. Meta will ask you to pick a business portfolio and the account to share; share only
                the one for your page. Meta&apos;s screen says we can &quot;access profile and posts&quot;; we read the account&apos;s number
                and name and nothing else. We never see your password.
              </p>
            </form>
          )}
          {socials.length > 0 && (
            <ul className="mt-3 space-y-3">
              {socials.map((social) => {
                const expired = social.codeExpiresAt <= now;
                // Connect looks itself (Instagram and YouTube, when their settings are there), or the founder does.
                const automatic = isAutomatic(social.network, checkSettings);
                const place = social.network === "youtube" ? "that channel's description" : "that account's bio";
                // TikTok while its sign-in is on: no code and no "I've done it"; the button above is the way.
                const bySignIn = tiktokOn && social.network === "tiktok";
                return (
                  <li key={social.id} className="rounded border border-neutral-400 p-3 text-sm">
                    <p className="font-medium">
                      {isNetwork(social.network) ? NETWORKS[social.network].label : social.network}: @{social.nameKey}
                    </p>
                    {social.confirmedAt ? (
                      <p className="mt-1 text-green-700">
                        {social.providerAccountId ? "Confirmed. It is shown on your page." : "Confirmed. It is shown on your page. You can remove the code from the bio."}
                      </p>
                    ) : bySignIn && (expired || !social.claimedAt) ? (
                      <p className="mt-1">Press &quot;Connect your TikTok&quot; above to confirm this account.</p>
                    ) : expired ? (
                      <p className="mt-1">The code has run out. Add the account again to get a new one.</p>
                    ) : social.claimedAt && !automatic ? (
                      <p className="mt-1">
                        Waiting for us to check. Keep <code className="font-mono">{social.code}</code> in {place} until it is confirmed.
                        {bySignIn && " Or press \"Connect your TikTok\" above to finish at once."}
                      </p>
                    ) : (
                      <>
                        <p className="mt-1">
                          Put this code anywhere in {place}: <code className="font-mono font-semibold">{social.code}</code>
                        </p>
                        <p className="mt-1 opacity-70">
                          The code works until <LocalTime iso={social.codeExpiresAt.toISOString()} />.
                          {automatic && social.network === "instagram" && " This works for Creator and Business accounts."}
                        </p>

                      </>
                    )}
                    {/* For an Instagram account that is not confirmed, in whatever state its code is: the other way. */}
                    {instagramOn && social.network === "instagram" && !social.confirmedAt && <p className="mt-1 opacity-70">Or press &quot;Connect your Instagram&quot; above.</p>}
                    <div className="mt-2 flex gap-4">
                      {!social.confirmedAt && !expired && !bySignIn && (automatic || !social.claimedAt) && (
                        <form action={socialReady}>
                          <input type="hidden" name="id" value={social.id} />
                          <button type="submit" className={smallButton}>
                            {automatic ? "Check now" : "I've done it"}
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
                {Object.entries(NETWORKS)
                  .filter(([key]) => !(tiktokOn && key === "tiktok"))
                  .map(([key, rule]) => (
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

      {profile && (
        <section id="photo" className="mt-10 scroll-mt-4">
          <h2 className="text-lg font-semibold">Your photo</h2>
          {photoState.locked ? (
            <p className="mt-2 text-sm">Your photo was removed by Connect, and you cannot choose another one. If you have questions, write to us.</p>
          ) : (
            <>
              <p className="mt-2 text-sm opacity-70">
                Your page and the search results can show a photo in place of the first letter of your name. You can upload a picture
                {checkSettings.instagram || tiktokOn ? `, or use the profile picture of your confirmed ${checkSettings.instagram ? "Instagram" : "TikTok"}${checkSettings.instagram && tiktokOn ? " or TikTok" : ""} account` : ""}
                . We make our own copy and have it checked automatically before anyone sees it. For the check, our copy is sent to a
                checking service, without your name. We keep our copy until you remove it (the privacy page says when we must keep one
                longer). You have one photo at a time, and {PHOTO.triesPerDay} tries in 24 hours. Of a picture you upload, the middle is
                shown, in a circle. When you ask another host for a call, they see this photo beside your name.
                {Boolean(checkSettings.instagram) && " On Instagram it works for Creator and Business accounts."}
                {tiktokOn && " For TikTok you log in at TikTok once more: that is how we get the picture. Your account on this page is not changed by it."}
              </p>
              <div className="mt-3 flex items-center gap-4">
                <HostPhoto photoId={photoState.photo?.id ?? null} name={profile.displayName} />
                <p className="text-sm">
                  {photoState.photo?.network === "upload" ? (
                    <>
                      Uploaded <LocalTime iso={photoState.photo.takenAt.toISOString()} />.
                    </>
                  ) : photoState.photo ? (
                    <>
                      From {isNetwork(photoState.photo.network) ? NETWORKS[photoState.photo.network].label : photoState.photo.network} @{photoState.photo.sourceNameKey}, taken{" "}
                      <LocalTime iso={photoState.photo.takenAt.toISOString()} />.
                    </>
                  ) : (
                    "You have no photo yet. Your page shows this letter."
                  )}
                </p>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-4">
                {/* One button for each confirmed account that can give a photo. The one the photo came from reads "Update". */}
                {photoFromInstagram && (
                  <form action={usePhoto}>
                    <input type="hidden" name="network" value="instagram" />
                    <button type="submit" className={photoState.photo ? smallButton : primaryButton}>
                      {photoState.photo?.network === "instagram" ? "Update" : "Use my Instagram photo"}
                    </button>
                  </form>
                )}
                {photoFromTikTok && (
                  <form action={useTikTokPhoto}>
                    <button type="submit" className={photoState.photo ? smallButton : primaryButton}>
                      {photoState.photo?.network === "tiktok" ? "Update" : "Use my TikTok photo"}
                    </button>
                  </form>
                )}
                {photoState.photo && (
                  <form action={removeOwnPhoto}>
                    <button type="submit" className="text-sm underline underline-offset-2">
                      Remove
                    </button>
                  </form>
                )}
              </div>
              {/* A plain form to an address of its own: a picture does not fit into the app's ordinary forms (plans/35). */}
              <form method="post" action="/photo" encType="multipart/form-data" className="mt-4 text-sm" data-photo-upload>
                <label className="block">
                  {photoState.photo ? "Upload another picture" : "Upload a picture"} (JPEG, PNG or WebP, up to 10 MB)
                  <input name="picture" type="file" accept="image/jpeg,image/png,image/webp" required className="mt-1 block w-full" />
                </label>
                <button type="submit" className={`mt-2 ${!photoState.photo && !photoFromInstagram && !photoFromTikTok ? primaryButton : smallButton}`}>
                  Upload a photo
                </button>
              </form>
              {photoState.photo && (
                <p className="mt-2 text-sm opacity-70">
                  {photoState.photo.network !== "upload" && <>&quot;Update&quot; fetches your profile picture again, for when you have changed it. </>}
                  Your photo stays as it is until a new one has passed the check. (One exception: if the check refuses the very picture you already have,
                  that photo is taken down.)
                </p>
              )}
            </>
          )}
        </section>
      )}

      <section id="paid" className="mt-10 scroll-mt-4">
        <h2 className="text-lg font-semibold">Getting paid</h2>
        {payoutsUnchecked && (
          <p className="mt-2 text-sm text-amber-700" data-payouts-unchecked>
            We could not check your payout account with Stripe just now. What is shown here is what we last knew.
          </p>
        )}
        {!stripeConfigured() ? (
          <p className="mt-2 text-sm opacity-70">Paid calls are switched off because Stripe is not set up.</p>
        ) : !profile ? (
          // The payout account is opened for the country on the profile, so the profile comes first. (Also for someone
          // who set payouts up before applying, which was possible once: their buttons would only be refused.)
          <p className="mt-2 text-sm opacity-70" data-paid-needs-profile>
            To host paid calls you set up a payout account at Stripe. First send your host profile above: the account is opened for the country you
            are based in.
          </p>
        ) : settings.payoutsReady ? (
          <>
            <p className="mt-2 text-sm text-green-700">Your payout account is ready. You can host paid calls.</p>
            <p className="mt-1 text-sm opacity-70">
              You collect your earnings yourself, with the button below. The money for a call is ready 24 hours after the call ends, once
              the customer&apos;s payment has gone through. If the customer asks for a refund, it is ready 2 days after the call at the earliest, and only once you have answered them. You can
              collect once every 24 hours. Our fee is 4.9% plus 30 cents per paid call (1.5% more when the customer&apos;s card is from
              outside the United States), and 25 cents each time you collect.
            </p>
            {abroad && (
              <p className="mt-1 text-sm opacity-70" data-paid-abroad>
                Your earnings are counted in US dollars. When you collect, Stripe turns them into your own money at its exchange rate of that
                moment, and pays your bank. What that exchange costs is in Stripe&apos;s rate.
              </p>
            )}
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
                ? "Your payout account is not ready yet. Stripe may still be checking your details, which can take a few minutes: look at this page again. If Stripe needs something more from you, you can continue the setup below. If the setup cannot be continued, write to support."
                : "To host paid calls, set up a payout account. Stripe collects your identity and bank details on its own secure pages; we never see them."}
            </p>
            <form action={startPayoutSetup} className="mt-3">
              <button type="submit" className="rounded bg-blue-600 px-4 py-2 font-medium text-white">
                {settings.stripeAccountId ? "Continue payout setup" : "Set up payouts"}
              </button>
            </form>
          </>
        )}
        {/* Also shown while the payout account is not ready: money already earned is still theirs to see. */}
        {stripeConfigured() && settings.stripeAccountId && <Earnings hostId={user.id} payoutsReady={settings.payoutsReady} abroad={abroad} now={now} />}
      </section>

      <MembershipPart hostId={user.id} regularPricePer15Cents={profile?.pricePer15Cents ?? null} payoutsReady={Boolean(settings.payoutsReady) && stripeConfigured()} now={now} />

      <ProjectPart hostId={user.id} />

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

      <section className="mt-10">
        <h2 className="text-lg font-semibold">Who can ask you for a call</h2>
        <form action={saveVerifiedOnly} className="mt-3 space-y-2">
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="verifiedOnly" defaultChecked={settings.verifiedOnly} className="mt-1" />
            <span>Only people who have confirmed their ID can ask me for a call.</span>
          </label>
          <p className="text-sm opacity-70">
            We check a photo ID and a matching selfie through Stripe. You see only that the check was passed (&quot;ID confirmed&quot; next
            to the person&apos;s name), never the ID or the name on it. Fewer people may ask you for calls. Requests already waiting stay;
            you can decline them.
            {profile?.pricePer15Cents === 0 ? " Your calls are free, so everyone who asks already has to confirm their ID." : ""}
          </p>
          <button type="submit" className="rounded border border-neutral-500 px-3 py-1.5 text-sm">
            Save
          </button>
        </form>
      </section>
    </SitePage>
  );
}

/**
 * The part "Your project" of Hosting: a short note and the way to the project's own page, where
 * everything about it is done (plans/24, choice 1).
 */
async function ProjectPart({ hostId }: { hostId: string }) {
  const running = await runningProjectOf(hostId);
  const cannotStart = running ? null : await startProblem(hostId);
  return (
    <section id="project" className="mt-10 scroll-mt-4">
      <h2 className="text-lg font-semibold">Your project</h2>
      <p className="mt-2 text-sm opacity-70">Something you are working on, with a diary anyone can read on your page.</p>
      <p className="mt-2 text-sm">
        {running ? (
          <>
            Running: <strong>{running.name}</strong>.{" "}
          </>
        ) : cannotStart ? (
          <>{cannotStart} </>
        ) : (
          "You have no project at the moment. "
        )}
        <Link href="/host/project" className="underline underline-offset-2">
          {running ? "Write a post, change or end it" : cannotStart ? "See your earlier projects" : "Start a project"}
        </Link>
      </p>
    </section>
  );
}
