/**
 * The one sentence a host is told after "Use my Instagram photo", "Use my TikTok photo",
 * "Update" or "Upload a photo" (plans/29, plans/33, plans/35). Plain words in one place, for the
 * button's action, the return from TikTok and the upload's address.
 */
import type { PhotoOutcome, PhotoResult } from "./photo";
import { PHOTO, type PhotoSource } from "./photo-rules";

/** An upload has no network to name: the sentences that name one are never said after an upload. */
const LABEL: Record<PhotoSource, string> = { instagram: "Instagram", tiktok: "TikTok", upload: "social media" };

/** `asCustomer`: the person has no host profile, so their photo is only for hosts they ask (plans/35). */
export function photoNotice(result: PhotoResult, network: PhotoSource, asCustomer = false): string {
  const label = LABEL[network];
  const upload = network === "upload";
  const later = "Please try again in a few minutes.";
  // A service refused the very picture that was the host's photo: that photo is no longer shown.
  if (result.outcome === "not_accepted" && result.tookDown) {
    return "That photo was not accepted. It looks like it breaks the rules on nudity, violence or self-harm. It is the same picture as the photo you had, so that photo was taken down.";
  }
  const said: Record<PhotoOutcome, string> = {
    shown: asCustomer
      ? "Your photo passed the check and is saved. Hosts you ask for a call see it beside your name."
      : "Your photo passed the check and is saved. It is shown on your page whenever your page is open to everyone, and beside you wherever you appear in the search results.",
    not_accepted: "That photo was not accepted. It looks like it breaks the rules on nudity, violence or self-harm. Nothing was changed.",
    refused_before: "That photo was not accepted before, so it was not taken again. Nothing was changed.",
    no_picture: upload
      ? `We could not read your picture. Nothing was changed. ${later}`
      : network === "instagram"
        ? "We could not read a profile picture for your Instagram account. It must be a Creator or Business account. If you have changed its name, confirm the account again first."
        : "TikTok did not give us a profile picture for your account. Nothing was changed.",
    not_fetched: upload ? `We could not read your picture right now. Nothing was changed. ${later}` : `We could not fetch your photo right now. Nothing was changed. ${later}`,
    unusable: `${upload ? "That picture" : "Your profile picture"} cannot be used. ${result.detail ?? ""}`.trim(),
    not_checked: `Your photo could not be checked right now, so nothing was changed. ${later}`,
    stopped: `Something changed while we were ${upload ? "checking your picture" : "fetching your photo"}, so nothing was taken. Look below to see where things stand.`,
    cannot: "Your account cannot do this at the moment. Nothing was changed.",
    locked: "Your photo was removed by Connect, and you cannot choose another one.",
    no_account: `Confirm your ${label} account first.`,
    // (A try under way can be of either network, whichever button was pressed now.)
    running: "Your last try for a photo is still under way. If you were sent to TikTok, finish there. Otherwise wait two minutes and try again.",
    limit: `You have tried ${PHOTO.triesPerDay} times in the last 24 hours, which is the limit. Please try again tomorrow.`,
    busy: "Many people are using this right now. Please try again in a little while.",
    no_checker: `Photos cannot be checked right now, so none can be taken. ${later}`,
    place_taken: "Another picture is being worked on right now. Please try again in a moment.",
    failed: "Something went wrong on our side, and we could not finish. Look below to see whether your photo changed before you try again.",
    other_account: `You signed in at ${label} with a different account from the one on your page. Nothing was changed. To change your account, press "Connect your ${label}".`,
    taken_account: `That ${label} account is confirmed for another host. Nothing was changed. If it is yours, write to us.`,
    already_returned: "This sign-in was already used, or something changed in the meantime. Nothing more was done. Look below to see where things stand.",
  };
  return said[result.outcome];
}
