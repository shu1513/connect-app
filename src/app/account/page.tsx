import type { Metadata } from "next";
import { and, eq, inArray } from "drizzle-orm";
import Link from "next/link";
import { ChangePasswordForm } from "@/components/auth-forms";
import { SignOutButton } from "@/components/sign-out-button";
import { TimeZoneSelect } from "@/components/time-zone-select";
import { db, schema } from "@/db";
import { LocalTime } from "@/components/local-time";
import { tipsBy } from "@/lib/contributions/tips";
import { stateOf, supportedBy } from "@/lib/contributions/views";
import { membershipsOf } from "@/lib/membership/access";
import { readNotice } from "@/lib/notice";
import { Rating } from "@/components/rating";
import { averageFor } from "@/lib/ratings/ratings";
import { blockedBy } from "@/lib/safety/blocks";
import { identityState } from "@/lib/safety/identity";
import { requireUser } from "@/lib/session";
import { unblockAction } from "../report/actions";
import { timeZones } from "@/lib/time-zones";
import { followEmailsOf } from "@/lib/follows/emails";
import { followEmailsOn } from "@/lib/follows/rules";
import { ownPhotoState } from "@/lib/profiles/photo";
import { PHOTO } from "@/lib/profiles/photo-rules";
import { HostPhoto } from "@/components/host-photo";
import { removeOwnPhoto, saveAccount, saveFollowEmails, saveReminders } from "./actions";
import { SitePage } from "@/components/site-page";

export const metadata: Metadata = { title: "Your account" };

const NOTICES: Record<string, string> = {
  saved: "Your details were saved.",
  reminders: "Your notification choice was saved.",
  name: "Your name must be 2 to 50 characters long.",
  zone: "Please choose your time zone from the list.",
};

const MEMBERSHIP_STATE: Record<string, string> = {
  invited: "Invited",
  joining: "At the card step",
  active: "Member",
  unpaid: "Payment did not go through",
  paused: "Paused",
  ended: "Ended",
};

export default async function AccountPage(props: PageProps<"/account">) {
  const user = await requireUser("/account");
  const query = await props.searchParams;
  const { notice } = query;
  const signed = readNotice("/account", query);
  const [password] = await db
    .select({ id: schema.account.id })
    .from(schema.account)
    .where(and(eq(schema.account.userId, user.id), eq(schema.account.providerId, "credential")));
  const blocked = await blockedBy(user.id);
  const [{ reminders }] = await db.select({ reminders: schema.user.reminderEmails }).from(schema.user).where(eq(schema.user.id, user.id));
  // The switch for emails about hosts they follow, only while those emails exist at all (plans/31).
  const followEmails = followEmailsOn() ? await followEmailsOf(user.id) : null;
  const [asHost, asCustomer] = await Promise.all([averageFor(user.id, "host", new Date()), averageFor(user.id, "customer", new Date())]);
  const idConfirmed = (await identityState(user.id)).passed;
  // The person's own memberships as a member (also paused and ended ones, for their receipts).
  const memberships = await membershipsOf(user.id);
  // "Projects you support". One that was left at the card step and never paid is not listed: nothing was contributed.
  const supported = (await supportedBy(user.id)).filter(({ contribution, began }) => began || contribution.status !== "ended");
  // "Tips you gave" (plans/44): kept apart from projects. One that was left at the card step and never paid is not listed.
  const tips = await tipsBy(user.id);
  const hostNames = new Map(
    memberships.length > 0
      ? (await db.select({ id: schema.hostProfiles.userId, name: schema.hostProfiles.displayName }).from(schema.hostProfiles).where(inArray(schema.hostProfiles.userId, memberships.map((membership) => membership.hostId)))).map((row) => [row.id, row.name])
      : [],
  );
  // "Your photo" (plans/35). A host's photo is on the Hosting page; anyone else's is here.
  const [hostProfile] = await db.select({ userId: schema.hostProfiles.userId }).from(schema.hostProfiles).where(eq(schema.hostProfiles.userId, user.id));
  const photoState = await ownPhotoState(user.id);
  const field = "mt-1 w-full rounded border border-neutral-400 bg-transparent px-3 py-2";

  return (
    <SitePage className="mx-auto w-full max-w-2xl px-4 py-10">
      <h1 className="text-2xl font-semibold">Your account</h1>

      {((typeof notice === "string" && NOTICES[notice]) || signed) && (
        <p role="status" className="mt-4 rounded border border-neutral-400 p-3 text-sm">
          {signed ?? NOTICES[String(notice)]}
        </p>
      )}

      <section className="mt-8">
        <h2 className="text-lg font-semibold">Your details</h2>
        <p className="mt-1 text-sm opacity-70">Email: {user.email}. To change your email address, contact support.</p>
        <form action={saveAccount} className="mt-3 max-w-sm space-y-3">
          <label className="block text-sm">
            Your name
            <input name="name" type="text" defaultValue={user.name} required minLength={2} maxLength={50} className={field} />
          </label>
          <label className="block text-sm">
            Your time zone (used for the times in your emails)
            <TimeZoneSelect zones={timeZones()} saved={user.timeZone} />
          </label>
          <button type="submit" className="rounded border border-neutral-500 px-3 py-1.5 text-sm">
            Save
          </button>
        </form>
      </section>

      <section id="photo" className="mt-10 scroll-mt-4" data-account-photo>
        <h2 className="text-lg font-semibold">Your photo</h2>
        {hostProfile ? (
          <p className="mt-2 text-sm">
            Your photo is on your{" "}
            <Link href="/host#photo" className="underline underline-offset-2">
              Hosting page
            </Link>
            .
          </p>
        ) : photoState.locked ? (
          <p className="mt-2 text-sm">Your photo was removed by Connect, and you cannot choose another one. If you have questions, write to us.</p>
        ) : (
          <>
            <p className="mt-2 text-sm opacity-70">
              You can add a photo. Hosts you ask for a call see it beside your name. Connect&apos;s own staff can see it too, to keep
              the rules; nobody else does. If you become a host, it is shown on your public page. The middle of your picture is shown, in a circle. We make our own copy and have it checked
              automatically before anyone sees it; for the check, our copy is sent to a checking service, without your name. We keep
              our copy until you remove it (the privacy page says when we must keep one longer). You have one photo at a time, and{" "}
              {PHOTO.triesPerDay} tries in 24 hours.
            </p>
            <div className="mt-3 flex items-center gap-4">
              <HostPhoto photoId={photoState.photo?.id ?? null} name={user.name} />
              <p className="text-sm">
                {photoState.photo ? (
                  <>
                    Uploaded <LocalTime iso={photoState.photo.takenAt.toISOString()} />.
                  </>
                ) : (
                  "You have no photo yet. Hosts see this letter."
                )}
              </p>
              {photoState.photo && (
                <form action={removeOwnPhoto}>
                  <button type="submit" className="text-sm underline underline-offset-2">
                    Remove
                  </button>
                </form>
              )}
            </div>
            {/* A plain form to an address of its own: a picture does not fit into the app's ordinary forms. */}
            <form method="post" action="/photo" encType="multipart/form-data" className="mt-4 text-sm" data-photo-upload>
              <label className="block">
                {photoState.photo ? "Upload another picture" : "Upload a picture"} (JPEG, PNG or WebP, up to 10 MB)
                <input name="picture" type="file" accept="image/jpeg,image/png,image/webp" required className="mt-1 block w-full" />
              </label>
              <button type="submit" className="mt-2 rounded border border-neutral-500 px-3 py-1.5">
                Upload a photo
              </button>
            </form>
            {photoState.photo && <p className="mt-2 text-sm opacity-70">Your photo stays as it is until a new one has passed the check.</p>}
          </>
        )}
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-semibold">Your ratings</h2>
        <p className="mt-1 text-sm opacity-70">
          After a call, each person rates the other. You never see what one particular person gave you, only your averages. A rating starts
          to count a week after the call. Each person counts once, with their first rating of you. An average appears once three
          people&apos;s ratings count, and then moves three people at a time.
        </p>
        <p className="mt-2 text-sm">
          As a host: <Rating shown={asHost} newText="not enough ratings yet" />
        </p>
        <p className="mt-1 text-sm">
          As a customer: <Rating shown={asCustomer} newText="not enough ratings yet" />
        </p>
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-semibold">Your ID</h2>
        {idConfirmed ? (
          <p className="mt-2 text-sm text-green-700">Confirmed.</p>
        ) : (
          <p className="mt-2 text-sm">
            Not confirmed.{" "}
            <Link href="/identity" className="underline underline-offset-2">
              Confirm who you are
            </Link>{" "}
            with a photo of your ID and a selfie. Hosts need it, and some hosts only take calls from
            people who have done it.
          </p>
        )}
        <p className="mt-1 text-sm opacity-70">Hosts you ask for a call can see that your ID is confirmed. They never see your ID or the name on it.</p>
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-semibold">Password</h2>
        {password ? (
          <ChangePasswordForm />
        ) : (
          <p className="mt-2 text-sm opacity-70">
            You log in with Google, so there is no password here. To add one, log out and use &quot;Forgot password&quot;
            on the login page.
          </p>
        )}
      </section>

      {memberships.length > 0 && (
        <section id="memberships" className="mt-10 scroll-mt-4">
          <h2 className="text-lg font-semibold">Memberships</h2>
          <p className="mt-1 text-sm opacity-70">Your memberships with hosts: your time, your receipts, and cancelling or resuming.</p>
          <ul className="mt-2 space-y-1 text-sm">
            {memberships.map((membership) => (
              <li key={membership.id}>
                <Link href={`/memberships/${membership.id}`} className="inline-flex min-h-11 items-center underline underline-offset-2">
                  {hostNames.get(membership.hostId) ?? "A host"}
                </Link>
                <span className="ml-2 opacity-70">{MEMBERSHIP_STATE[membership.status] ?? ""}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {supported.length > 0 && (
        <section id="projects" className="mt-10 scroll-mt-4" data-supported>
          <h2 className="text-lg font-semibold">Projects you support</h2>
          <p className="mt-1 text-sm opacity-70">Your contributions to hosts&apos; projects: each payment, cancelling one that is only held, and stopping a monthly one.</p>
          <ul className="mt-2 space-y-1 text-sm">
            {supported.map(({ contribution, projectName, hostName, latest }) => (
              <li key={contribution.id}>
                <Link href={`/contributions/${contribution.id}`} className="inline-flex min-h-11 items-center underline underline-offset-2">
                  {projectName}, by {hostName}
                </Link>
                <span className="ml-2 opacity-70">
                  ${(contribution.amountCents / 100).toFixed(2)}
                  {contribution.kind === "monthly" ? " every month" : ", once"}.{" "}
                  {contribution.status === "ended" ? (
                    contribution.endedHow === "paid" ? "Paid." : "Ended."
                  ) : contribution.status === "card_step" ? (
                    "Waiting for your card."
                  ) : latest?.status === "held" && !latest.endedHow && latest.takeAt ? (
                    <>
                      Held on your card; taken on <LocalTime iso={latest.takeAt.toISOString()} />. You can cancel until then.
                    </>
                  ) : contribution.kind === "monthly" ? (
                    "Running."
                  ) : (
                    ""
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {tips.length > 0 && (
        <section id="tips" className="mt-10 scroll-mt-4" data-tips>
          <h2 className="text-lg font-semibold">Tips you gave</h2>
          <p className="mt-1 text-sm opacity-70">Your tips to hosts after a call. A tip that is only held can be cancelled on its own page.</p>
          <ul className="mt-2 space-y-1 text-sm">
            {tips.map(({ tip, tipCents, row, hostName, callStartsAt }) => {
              const state = stateOf(row.payment);
              return (
                <li key={tip.id}>
                  <Link href={`/contributions/${tip.id}`} className="inline-flex min-h-11 items-center underline underline-offset-2">
                    ${(tipCents / 100).toFixed(2)} for {hostName}
                  </Link>
                  <span className="ml-2 opacity-70">
                    {callStartsAt && (
                      <>
                        For your call on <LocalTime iso={callStartsAt.toISOString()} />.{" "}
                      </>
                    )}
                    {state === "held" && row.payment.takeAt ? (
                      <>
                        Held on your card; taken on <LocalTime iso={row.payment.takeAt.toISOString()} />. You can cancel until then.
                      </>
                    ) : state === "taken" ? (
                      "Paid."
                    ) : state === "cancelled" ? (
                      "Cancelled; nothing was charged."
                    ) : state === "cancelling" ? (
                      "Being cancelled."
                    ) : state === "problem" ? (
                      "Being looked at by Connect."
                    ) : (
                      "Waiting for your card."
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="mt-10">
        <h2 className="text-lg font-semibold">Hosting</h2>
        <p className="mt-2 text-sm">
          <Link href="/host" className="inline-flex min-h-11 items-center underline underline-offset-2">
            Your host profile, payouts and calendar
          </Link>
        </p>
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-semibold">Notifications</h2>
        <p className="mt-1 text-sm opacity-70">
          Emails about things that happen (an answer to a request, a cancellation, money, a report) are always sent. Reminders are up to you.
        </p>
        <form action={saveReminders} className="mt-2 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" name="reminders" defaultChecked={reminders} /> Email me reminders before my calls and about requests
          </label>
          <button type="submit" className="mt-2 rounded border border-neutral-500 px-3 py-1.5">
            Save
          </button>
        </form>
        {followEmails !== null && (
          <form action={saveFollowEmails} className="mt-4 text-sm" data-follow-emails>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="follows" defaultChecked={followEmails} /> Email me about hosts I follow, where I asked for it
            </label>
            <p className="mt-1 opacity-70">
              Which emails, for which host, is chosen under{" "}
              <Link href="/following" className="underline underline-offset-2">
                Hosts you follow
              </Link>
              . Nothing is sent about a host you have not ticked there.
            </p>
            <button type="submit" className="mt-2 rounded border border-neutral-500 px-3 py-1.5">
              Save
            </button>
          </form>
        )}
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-semibold">People you have blocked</h2>
        {blocked.length === 0 ? (
          <p className="mt-2 text-sm opacity-70">Nobody. You can block someone from a request or a call&apos;s page.</p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm">
            {blocked.map((person) => (
              <li key={person.id} className="flex items-center gap-3">
                <span>{person.name}</span>
                <form action={unblockAction}>
                  <input type="hidden" name="userId" value={person.id} />
                  <button type="submit" className="underline underline-offset-2">
                    Unblock
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-10 text-sm">
        <SignOutButton />
        <p className="mt-4 opacity-70">To close your account, contact support.</p>
      </section>
    </SitePage>
  );
}
