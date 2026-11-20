import { withNotice } from "@/lib/notice";
import { acceptUpload, givePlace, pictureCount, takePlace } from "@/lib/projects/pictures";
import { postForHost } from "@/lib/projects/posts";
import { PROJECTS_OFF } from "@/lib/projects/projects";
import { PICTURE, ProjectError } from "@/lib/projects/rules";
import { readOnePicture, REQUEST_MAX } from "@/lib/projects/upload-body";
import { fromThisSite } from "@/lib/same-site";
import { projectsOnFor } from "@/lib/safety/switches";
import { getUser } from "@/lib/session";

const TOO_LARGE = "A picture can be up to 10 MB.";

/** Sends the browser on with a sentence. The address is one of our own, written without a host, so nothing a request says about itself is used. */
function goTo(path: string, text?: string): Response {
  return new Response(null, { status: 303, headers: { location: text ? withNotice(path, text) : path, "cache-control": "no-store" } });
}

/**
 * A host adds one picture to one of her posts (plans/24, "Uploading a picture"). A picture does
 * not fit into the app's ordinary forms, which are limited to 1 MB, so it has this address of its
 * own. Everything that can be checked is checked before anything is read.
 */
export async function POST(request: Request, ctx: RouteContext<"/host/project/posts/[id]/pictures">) {
  // 1. Only from Connect's own page: another website cannot send an upload through a logged-in person's browser.
  if (!fromThisSite(request.headers)) return new Response("Not allowed.", { status: 403, headers: { "cache-control": "no-store" } });
  const { id } = await ctx.params;
  const page = /^[0-9a-f-]{36}$/i.test(id) ? `/host/project/posts/${id}` : "/host/project";

  // 2. The full gate for an active user.
  const user = await getUser();
  if (!user) return goTo(`/login?next=${encodeURIComponent(page)}`);
  if (user.paused) return goTo("/paused");

  // 3. and 4. The switch, and the post: hers, not removed, not hidden, in her running project, with room for a picture.
  const found = await postForHost(user.id, id);
  if (!found) return new Response("Not found.", { status: 404, headers: { "cache-control": "no-store" } });
  if (!(await projectsOnFor(user.id))) return goTo(page, PROJECTS_OFF);
  if (found.project.status !== "running") return goTo(page, "This project has ended, so no pictures can be added to its posts.");
  if (found.post.hiddenAt) return goTo(page, "This post was hidden by Connect, so no pictures can be added to it.");
  if ((await pictureCount(found.post.id)) >= PICTURE.perPost) return goTo(page, `A post can have up to ${PICTURE.perPost} pictures. Remove one first.`);

  // 5. A file form, and not one that says it is too large.
  const kind = request.headers.get("content-type") ?? "";
  if (!kind.toLowerCase().startsWith("multipart/form-data")) return goTo(page, "Please choose a picture.");
  const said = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(said) && said > REQUEST_MAX) return goTo(page, TOO_LARGE);

  // 6. One picture is worked on at a time. A second upload is told to try again; it is not kept waiting in memory.
  if (!takePlace()) return goTo(page, "Another picture is being worked on right now. Please try again in a moment.");
  try {
    const file = await readOnePicture(request, kind);
    if (file === "too_large") return goTo(page, TOO_LARGE);
    if (file === "unreadable") return goTo(page, "That upload could not be read. Please try again.");
    if (file === "not_one") return goTo(page, "Please choose one picture.");

    const picture = await acceptUpload({ hostId: user.id, postId: found.post.id, original: file, now: new Date() });
    if (picture.state === "refused") return goTo(page, "This picture was not accepted before, so it was not added again.");
    if (picture.state === "locked") return goTo(page, "That picture cannot be used on Connect.");
    return goTo(page, "Your picture was added. It is being checked, which usually takes a few seconds.");
  } catch (error) {
    if (error instanceof ProjectError) return goTo(page, error.message);
    console.error("[projects] an upload failed", error);
    return goTo(page, "Something went wrong. The picture was not added. Please try again.");
  } finally {
    givePlace();
  }
}
