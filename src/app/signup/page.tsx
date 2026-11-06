import { redirect } from "next/navigation";
import { SignUpForm } from "@/components/auth-forms";
import { googleSignInConfigured } from "@/lib/auth";
import { getSignedIn } from "@/lib/session";

export default async function SignUpPage() {
  const person = await getSignedIn();
  if (person && !person.closed) redirect("/");
  return (
    <main className="mx-auto w-full max-w-sm px-4 py-16">
      <h1 className="text-2xl font-semibold">Create your account</h1>
      <SignUpForm google={googleSignInConfigured} />
    </main>
  );
}
