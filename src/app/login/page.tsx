import { redirect } from "next/navigation";
import { getUser } from "@/lib/session";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  if (await getUser()) redirect("/");
  return (
    <main className="mx-auto w-full max-w-sm px-4 py-16">
      <h1 className="text-2xl font-semibold">Log in</h1>
      <p className="mt-2 text-sm opacity-70">Test accounts only. Public sign-up is not open yet.</p>
      <LoginForm />
    </main>
  );
}
