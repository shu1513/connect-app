import type { Metadata } from "next";
import { SitePage } from "@/components/site-page";
import { warm } from "@/components/warm-ui";

export const metadata: Metadata = { title: "Privacy" };
export default function PrivacyPage() {
  return (
    <SitePage className={warm.document}>
      <h1 className={warm.title}>Privacy policy</h1>
      <p className="mt-4 text-sm">
        This is a placeholder. The real text will be written by a lawyer before the app opens to the public. Until then
        the app is for testing only.
      </p>
      <p className="mt-4 text-sm">
        To confirm an Instagram or YouTube account, we read its public bio (on YouTube, the channel&apos;s description)
        through Instagram&apos;s or YouTube&apos;s own service and look for the code. We do not keep the text.
      </p>
      <p className="mt-4 text-sm">
        When you connect TikTok by signing in there, we read the account&apos;s number and name, nothing else, and we keep
        no key.
      </p>
      <p className="mt-4 text-sm">
        When you connect Instagram by signing in at Meta, we ask Meta once which Instagram account you shared, and keep that
        account&apos;s number and name, nothing else. (Meta&apos;s own screen describes what you allow as &quot;access profile and posts&quot;; we
        do not read your posts.) We do not keep Meta&apos;s key. Meta lists Connect among the apps connected to
        your business portfolio until you remove it there (in Meta&apos;s Business Settings, under Integrations, Connected apps).
        The two are separate: removing it at Meta does not take the account off your Connect page, and removing the account
        from your Connect page (&quot;Remove&quot; on your Hosting page) does not remove the connection at Meta. An approved host&apos;s
        page needs one confirmed account, so to take away the last one, confirm another first or write to us.
      </p>
      <p className="mt-4 text-sm">
        When a host adds a picture to the diary of a project, we make our own copy of it, without the place, the camera or anything
        else that was hidden in the file, and we do not keep the file as it was sent. Before anyone else can see the picture, our
        copy is checked automatically. For that it is usually sent to an outside checking service: OpenAI, Microsoft (Azure AI
        Content Safety) or Sightengine. We send the picture only, without the host&apos;s name or anything else about them. A picture
        the check does not accept is shown to nobody and deleted. Before it is deleted it can be compared with a list of known
        illegal pictures.
      </p>
      <p className="mt-4 text-sm">
        When a host chooses to use the profile picture of their confirmed Instagram or TikTok account as their photo, we fetch
        that public picture through Instagram&apos;s or TikTok&apos;s own service, make our own copy in the same way, and send our
        copy to one of the same checking services before anyone sees it, without the host&apos;s name. For TikTok the host signs in
        at TikTok for this, and only then do we also read where the account&apos;s profile picture is; we keep no key. We keep our copy until the host removes it, the
        account it came from is taken off their page, or their Connect account is closed. (A photo we have had to remove and
        report is kept for as long as the law asks.) A photo the check does not accept is not
        kept; we keep only a fingerprint of it, so that the same picture is not accepted later.
      </p>
      <p className="mt-4 text-sm">
        A host can also upload a picture as their photo. We make our own copy in the same way, keep only a square cut from the
        middle of it, and do not keep the file as it was sent. Our copy goes to one of the same checking services before anyone
        sees it, without the host&apos;s name. We keep it until the host removes it or their Connect account is closed; it does
        not depend on any social media account. The rest is as for a photo from Instagram or TikTok.
      </p>
      <p className="mt-4 text-sm">
        When you contribute to a host&apos;s project, the host sees your name, the amount, whether it is once or every month, and
        when you began. Your card is entered on our payment company&apos;s form (Stripe) and we never see its number. For a monthly
        contribution the card is kept at Stripe for that contribution only, and removed when it ends. We keep what you agreed
        to, with the amount and the moment, and a record of every payment and refund. We send you an email for each payment,
        and when a payment fails, a refund is made or a monthly contribution ends.
      </p>
      <p className="mt-4 text-sm">
        When you follow a host, by pressing &quot;Follow&quot; or by having a call with them, we keep that you follow them, so that we
        can show you when they are available. Only you see who you follow. The host is not told who follows them, or how many
        people do. You can unfollow at any time, and a host you unfollowed is not followed again for you after a later call.
      </p>
      <p className="mt-4 text-sm">
        We email you about a host you follow only if you ticked it for that host, under &quot;Hosts you follow&quot;: when they are
        available now, or when they write in their diary. Every such email has a link that stops all of them with one press,
        and you can stop them on your account page. The emails never contain anything a host wrote.
      </p>
      <p className="mt-4 text-sm">
        A host you have asked for a call can keep private notes about you, to remember what you talked about. Only that host can
        read them: no other host can, and they are not shown on any page of yours. If you block the host, or the host blocks
        you, or your account is closed, the host can no longer read or change their notes about you.
      </p>
    </SitePage>
  );
}
