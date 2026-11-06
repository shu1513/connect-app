import { unsubscribeWithToken } from "@/lib/notifications/unsubscribe";

/**
 * The page behind the "stop reminder emails" link. Opening it does nothing;
 * pressing the button does. No login needed.
 */
export default async function UnsubscribePage(props: PageProps<"/unsubscribe">) {
  const { token, done } = await props.searchParams;
  const value = typeof token === "string" ? token : "";
  async function stop(formData: FormData) {
    "use server";
    const ok = await unsubscribeWithToken(String(formData.get("token") ?? ""));
    const { redirect } = await import("next/navigation");
    redirect(`/unsubscribe?done=${ok ? "yes" : "no"}`);
  }
  return (
    <main className="mx-auto w-full max-w-md px-4 py-16">
      <h1 className="text-2xl font-semibold">Reminder emails</h1>
      {done === "yes" ? (
        <p className="mt-4 text-sm">Done. You will not get reminder emails any more. You can switch them back on from your account page.</p>
      ) : done === "no" ? (
        <p className="mt-4 text-sm">That link is not valid. Log in and change your choice on your account page instead.</p>
      ) : (
        <form action={stop} className="mt-4 text-sm">
          <input type="hidden" name="token" value={value} />
          <p>Stop reminder emails before calls and about requests? Emails about things that happen (an answer, a cancellation, money) are still sent.</p>
          <button type="submit" className="mt-4 rounded bg-blue-600 px-4 py-2 font-medium text-white">
            Stop reminder emails
          </button>
        </form>
      )}
    </main>
  );
}
