import Link from "next/link";
import { redirect } from "next/navigation";
import { SignOutButton } from "@/components/sign-out-button";
import { TimeZoneSelect } from "@/components/time-zone-select";
import { safeNext } from "@/lib/safe-next";
import { getSignedIn } from "@/lib/session";
import { timeZones } from "@/lib/time-zones";
import { finishSignUp } from "./actions";

/**
 * The last step of signing up, shown once: 18 or older, the terms, and the
 * time zone. The link in the confirmation email lands here too.
 */
export default async function WelcomePage(props: PageProps<"/welcome">) {
  const { error, problem, next: nextParam } = await props.searchParams;
  const next = safeNext(nextParam);
  const person = await getSignedIn();
  if (!person || person.closed || !person.emailVerified) {
    // A confirmation link that has expired or was already used arrives here with an error.
    redirect(typeof error === "string" ? "/login?notice=link" : "/login");
  }
  if (person.welcomed) redirect(next);

  return (
    <main className="mx-auto w-full max-w-sm px-4 py-16">
      <h1 className="text-2xl font-semibold">One last step</h1>
      <p className="mt-2 text-sm opacity-70">Welcome, {person.name}. Your email address is confirmed.</p>

      {problem === "boxes" && (
        <p role="alert" className="mt-4 text-sm text-red-600">
          Please tick both boxes to continue.
        </p>
      )}
      {problem === "zone" && (
        <p role="alert" className="mt-4 text-sm text-red-600">
          Please choose your time zone from the list.
        </p>
      )}

      <form action={finishSignUp} className="mt-6 space-y-4">
        <input type="hidden" name="next" value={next} />
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="adult" required className="mt-1" />
          <span>I am 18 or older.</span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="terms" required className="mt-1" />
          <span>
            I accept the{" "}
            <Link href="/terms" target="_blank" className="underline underline-offset-2">
              terms
            </Link>{" "}
            and the{" "}
            <Link href="/privacy" target="_blank" className="underline underline-offset-2">
              privacy policy
            </Link>
            .
          </span>
        </label>
        <label className="block text-sm">
          Your time zone (used to show call times)
          <TimeZoneSelect zones={timeZones()} saved={person.timeZone} />
        </label>
        <button type="submit" className="w-full rounded bg-blue-600 px-4 py-2 font-medium text-white">
          Continue
        </button>
      </form>

      <p className="mt-6 text-sm">
        Not you? <SignOutButton />
      </p>
    </main>
  );
}
