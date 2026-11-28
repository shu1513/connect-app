import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SignOutButton } from "@/components/sign-out-button";
import { TimeZoneSelect } from "@/components/time-zone-select";
import { shownValue } from "@/legal/accept";
import { comingAtSignUp } from "@/legal/notices";
import { agreementsToAccept } from "@/legal/versions";
import { safeNext } from "@/lib/safe-next";
import { getSignedIn } from "@/lib/session";
import { timeZones } from "@/lib/time-zones";
import { finishSignUp } from "./actions";
import { acceptedBefore, WELCOME_PROBLEMS } from "@/lib/welcome";
import { SitePage } from "@/components/site-page";
import { warm } from "@/components/warm-ui";

export const metadata: Metadata = { title: "One last step" };

/**
 * The last step of signing up: 18 or older, the time zone, and, by pressing the button, the three
 * general documents (plans/46-agreements-live.md, decision 4). The link in the confirmation email
 * lands here too. A person sees it again when one of those documents has a new version in effect.
 *
 * The sentence that names the documents sits right beside the button, and each name leads to the
 * exact version the button accepts. That is what makes pressing it an acceptance; it must never
 * move away from the button or lose a link.
 */
export default async function WelcomePage(props: PageProps<"/welcome">) {
  const { error, problem, next: nextParam } = await props.searchParams;
  const next = safeNext(nextParam);
  const person = await getSignedIn();
  if (!person || person.closed || !person.emailVerified) {
    // A confirmation link that has expired or was already used arrives here with an error.
    // Either way the person keeps the page they were heading for.
    const carried = next === "/" ? "" : `next=${encodeURIComponent(next)}`;
    redirect(typeof error === "string" ? `/login?notice=link${carried && `&${carried}`}` : `/login${carried && `?${carried}`}`);
  }
  if (person.welcomed) redirect(next);
  // Someone who accepted an older version of the terms is asked again.
  const returning = await acceptedBefore(person.id);
  const now = new Date();
  const agreements = agreementsToAccept("sign_up", now);
  // Every version that is announced and not yet in effect, said above the button, so that someone signing up today
  // knows of it before agreeing. Also for the two documents that are told and not accepted (the Privacy Policy, the
  // Copyright Policy). The same list, in the same words, that the phone app's step is sent (without the summary).
  const coming = comingAtSignUp(now);
  const documentLinks = agreements.map((agreement, index) => (
    <span key={agreement.name}>
      {index > 0 && (index === agreements.length - 1 ? " and the " : ", the ")}
      <Link href={agreement.href} target="_blank" className="underline underline-offset-2" data-agreement={`${agreement.name}@${agreement.version}`}>
        {agreement.title}
      </Link>
    </span>
  ));

  return (
    <SitePage bare className={warm.auth}>
      <h1 className={warm.title}>{returning ? "We have updated our terms" : "One last step"}</h1>
      <p className="mt-2 text-sm opacity-70">
        {returning ? `${person.name}, please read the current terms and accept them to carry on.` : `Welcome, ${person.name}. Your email address is confirmed.`}
      </p>

      {problem === "boxes" && (
        <p role="alert" className="mt-4 text-sm text-red-600">
          {WELCOME_PROBLEMS.boxes}
        </p>
      )}
      {problem === "changed" && (
        <p role="alert" className="mt-4 text-sm text-red-600">
          {WELCOME_PROBLEMS.changed}
        </p>
      )}
      {problem === "zone" && (
        <p role="alert" className="mt-4 text-sm text-red-600">
          {WELCOME_PROBLEMS.zone}
        </p>
      )}

      <form action={finishSignUp} className="mt-6 space-y-4">
        <input type="hidden" name="next" value={next} />
        {/* What this page showed. The server refuses the step when these are no longer the versions in effect. */}
        <input type="hidden" name="shown" value={shownValue(agreements)} />
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="adult" required className="mt-1" />
          <span>I am 18 or older.</span>
        </label>
        <label className="block text-sm">
          Your time zone (used for the times in your emails)
          <TimeZoneSelect zones={timeZones()} saved={person.timeZone} />
        </label>
        {coming.map((one) => (
          <p key={`${one.name}@${one.version}`} className="rounded border border-neutral-400 p-3 text-sm" data-agreement-coming={`${one.name}@${one.version}`}>
            {one.applies} {one.summary}{" "}
            <Link href={one.href} target="_blank" className="underline underline-offset-2">
              {one.read}
            </Link>
            .{one.thenAccept ? ` ${one.thenAccept}` : ""}
          </p>
        ))}
        <p className="text-sm" data-agreement-sentence>
          {returning ? "By pressing the button you agree to the updated " : "By finishing sign-up you agree to the "}
          {documentLinks}.
        </p>
        <button type="submit" className="w-full rounded bg-blue-600 px-4 py-2 font-medium text-white">
          {returning ? "Accept the updated terms" : "Finish sign-up"}
        </button>
        <p className="text-sm opacity-70">
          Our{" "}
          <Link href="/privacy" target="_blank" className="underline underline-offset-2">
            Privacy Policy
          </Link>{" "}
          explains what we do with your information.
        </p>
      </form>

      <p className="mt-6 text-sm">
        Not you? <SignOutButton />
      </p>
    </SitePage>
  );
}
