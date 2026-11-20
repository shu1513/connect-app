/**
 * Everything a host's page is made of for the person looking at it (plans/45-phone-apps/05-search-and-a-hosts-page.md),
 * put together in one place for the two that show it: the website's page (src/app/h/[handle]/page.tsx)
 * and the phone app's address (src/app/api/app/hosts/[handle]/route.ts). Every rule about who may
 * open which page, and what is left out for whom, lives here, once.
 *
 * It only reads. `project`: her running project and its diary. The website's page asks for it; the
 * phone app never does (projects are not in the apps), and then nothing of a project is read at all.
 */
import "server-only";
import { instantOffer, offerOf, openTimes } from "@/lib/booking/bookings";
import { firstLength } from "@/lib/booking/rules";
import { followingOf, hasBlocked } from "@/lib/follows/follows";
import { hostForMemberByHandle, membershipsOf } from "@/lib/membership/access";
import { memberBookingView, memberOpenTimes } from "@/lib/membership/book";
import { languageNames } from "@/lib/profiles/languages";
import { photosOf } from "@/lib/profiles/photo";
import { publicProfile, type PublicProfile } from "@/lib/profiles/profiles";
import { contributionOf } from "@/lib/projects/ask";
import { postsOf } from "@/lib/projects/posts";
import { diaryFor } from "@/lib/projects/projects";
import { averageFor } from "@/lib/ratings/ratings";
import { isBlockedEitherWay } from "@/lib/safety/block-check";
import { identityState } from "@/lib/safety/identity";

/**
 * The page a handle leads to for this viewer, or null. A page that is hidden from the public still
 * opens for a member of this host, and for someone she has invited, and for nobody else: that is
 * asked of the membership's own access rules, and the public reader is not loosened.
 */
export async function hostProfileFor(viewer: { id: string } | null, handle: string) {
  const open = await publicProfile(handle);
  // The host's photo is shown only on a page that is open to everyone (plans/29): a member or an invited person
  // who can open a hidden page sees the letter.
  if (open) return { ...open, photoId: (await photosOf([open.userId])).get(open.userId) ?? null, openToAll: true };
  const forMember = viewer ? await hostForMemberByHandle(viewer.id, handle) : null;
  return forMember ? { ...forMember, socials: [] as PublicProfile["socials"], photoId: null, openToAll: false } : null;
}
export type HostProfileShown = NonNullable<Awaited<ReturnType<typeof hostProfileFor>>>;

export async function gatherHostPage(viewer: { id: string } | null, profile: HostProfileShown, asked: { length?: unknown; mlength?: unknown }, options: { project: boolean }) {
  // What can be booked. Worked out fresh on every visit; nothing here says why a time is closed.
  const blocked = viewer ? await isBlockedEitherWay(viewer.id, profile.userId) : false;
  const offer = blocked ? null : await offerOf(profile.userId);
  const { length, mlength } = asked;
  // The Follow button: for everyone but the host themselves and someone who has blocked this host. Whether the
  // host has blocked the viewer plays no part, so the button never gives a block away (plans/30, decision 3).
  // A new follow is only offered on a page that is open to everyone: that is what can be followed. Someone who
  // already follows keeps "Following / Unfollow" on a hidden page they can still open as a member.
  const ownFollow = viewer && viewer.id !== profile.userId && !(await hasBlocked(viewer.id, profile.userId)) ? await followingOf(viewer.id, profile.userId) : null;
  const follow = viewer?.id === profile.userId ? null : !viewer ? (profile.openToAll ? ("visitor" as const) : null) : ownFollow === "following" || profile.openToAll ? ownFollow : null;
  // A member of this host: their time left and the times they can book with it, beside the ordinary way.
  const memberView = viewer && viewer.id !== profile.userId && !blocked ? await memberBookingView(viewer.id, profile.userId, new Date()) : null;
  // Their own membership with this host, whatever state it is in: an invitation, the card step, a failed payment or a pause each get a line and a link.
  const own = viewer && viewer.id !== profile.userId && !blocked ? (await membershipsOf(viewer.id)).find((membership) => membership.hostId === profile.userId && membership.status !== "ended") : undefined;
  const invitedUntil = own?.status === "invited" && own.inviteId && own.inviteExpiresAt && own.inviteExpiresAt > new Date() ? own.inviteExpiresAt : null;
  const memberChosen = !memberView || memberView.lengths.length === 0 ? null : typeof mlength === "string" && memberView.lengths.includes(Number(mlength)) ? Number(mlength) : firstLength(memberView.lengths);
  const memberTimes = memberView && memberChosen ? await memberOpenTimes(memberView, memberChosen, new Date()) : [];
  // The length the customer chose stays chosen; before any choice, the offered length closest to 30 minutes is shown.
  const chosen = offer && typeof length === "string" && offer.lengths.includes(Number(length)) ? Number(length) : offer ? firstLength(offer.lengths) : null;
  const starts = offer && chosen ? await openTimes(offer, chosen, new Date()) : [];
  const now = offer ? await instantOffer(profile.userId, new Date()) : null;
  const rating = await averageFor(profile.userId, "host", new Date());
  const languages = languageNames(profile.languages);
  // Her running project, with the newest post of its diary. Asked of the diary's own rule, which is "her page is
  // open to everyone": a member or an invited person who can open a hidden page does not see the project here.
  const diary = options.project ? await diaryFor(profile.handle) : null;
  const project = diary?.project.status === "running" ? diary.project : null;
  const [latestPost] = project ? (await postsOf(project.id)).posts : [];
  // A signed-in visitor's own line beside it: what they contribute, a card step to finish, or the way to contribute.
  const mine = project && viewer ? await contributionOf(viewer.id, project) : null;
  // A signed-in visitor who would be stopped at the booking page is offered the ID check here already.
  const offerIdCheck = Boolean(offer?.verifiedOnly && viewer && viewer.id !== profile.userId && !(await identityState(viewer.id)).passed);
  return { blocked, offer, follow, memberView, own, invitedUntil, memberChosen, memberTimes, chosen, starts, now, rating, languages, project, latestPost, mine, offerIdCheck };
}
