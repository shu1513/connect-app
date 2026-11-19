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
        When a host adds a picture to the diary of a project, we make our own copy of it, without the place, the camera or anything
        else that was hidden in the file, and we do not keep the file as it was sent. Before anyone else can see the picture, our
        copy is checked automatically. For that it is usually sent to an outside checking service: OpenAI, Microsoft (Azure AI
        Content Safety) or Sightengine. We send the picture only, without the host&apos;s name or anything else about them. A picture
        the check does not accept is shown to nobody and deleted. Before it is deleted it can be compared with a list of known
        illegal pictures.
      </p>
      <p className="mt-4 text-sm">
        When you contribute to a host&apos;s project, the host sees your name, the amount, whether it is once or every month, and
        when you began. Your card is entered on our payment company&apos;s form (Stripe) and we never see its number. For a monthly
        contribution the card is kept at Stripe for that contribution only, and removed when it ends. We keep what you agreed
        to, with the amount and the moment, and a record of every payment and refund. We send you an email for each payment,
        and when a payment fails, a refund is made or a monthly contribution ends.
      </p>
    </SitePage>
  );
}
