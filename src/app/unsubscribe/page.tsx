import type { Metadata } from "next";
import { stopFollowEmailsWithToken } from "@/lib/follows/emails";
import { readStops, unsubscribeWithToken } from "@/lib/notifications/unsubscribe";
import { SitePage } from "@/components/site-page";

export const metadata: Metadata = { title: "Email choices" };

/**
 * The page behind the "stop these emails" link of an email. Opening it does nothing; pressing
 * the button does. No login needed. The link says which emails it stops: reminders, or with
 * `what=follows` the emails about hosts the person follows (plans/31). Each stops only its own.
 */
export default async function UnsubscribePage(props: PageProps<"/unsubscribe">) {
  const { token, done, what } = await props.searchParams;
  const value = typeof token === "string" ? token : "";
  const follows = readStops(what) === "follows";
  async function stop(formData: FormData) {
    "use server";
    const stopsFollows = readStops(formData.get("what")) === "follows";
    const secret = String(formData.get("token") ?? "");
    const ok = stopsFollows ? await stopFollowEmailsWithToken(secret) : await unsubscribeWithToken(secret);
    const { redirect } = await import("next/navigation");
    redirect(`/unsubscribe?done=${ok ? "yes" : "no"}${stopsFollows ? "&what=follows" : ""}`);
  }
  return (
    <SitePage className="mx-auto w-full max-w-md px-4 py-16">
      <h1 className="text-2xl font-semibold">{follows ? "Emails about hosts you follow" : "Reminder emails"}</h1>
      {done === "yes" ? (
        <p className="mt-4 text-sm">
          {follows
            ? "Done. You will not get emails about hosts you follow any more. You still follow them, and your choices for each host are kept: you can switch these emails back on from your account page."
            : "Done. You will not get reminder emails any more. You can switch them back on from your account page."}
        </p>
      ) : done === "no" ? (
        <p className="mt-4 text-sm">That link is not valid. Log in and change your choice on your account page instead.</p>
      ) : (
        <form action={stop} className="mt-4 text-sm">
          <input type="hidden" name="token" value={value} />
          <input type="hidden" name="what" value={follows ? "follows" : "reminders"} />
          <p>
            {follows
              ? "Stop all emails about hosts you follow (when one is available now, or writes in their diary)? You keep following them. Other emails are not changed."
              : "Stop reminder emails before calls and about requests? Emails about things that happen (an answer, a cancellation, money) are still sent."}
          </p>
          <button type="submit" className="mt-4 rounded bg-blue-600 px-4 py-2 font-medium text-white">
            {follows ? "Stop these emails" : "Stop reminder emails"}
          </button>
        </form>
      )}
    </SitePage>
  );
}
