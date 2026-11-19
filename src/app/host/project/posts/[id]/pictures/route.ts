import { withNotice } from "@/lib/notice";
import { acceptUpload, givePlace, pictureCount, takePlace } from "@/lib/projects/pictures";
import { postForHost } from "@/lib/projects/posts";
import { PROJECTS_OFF } from "@/lib/projects/projects";
import { PICTURE, ProjectError } from "@/lib/projects/rules";
import { fromThisSite } from "@/lib/same-site";
import { projectsOnFor } from "@/lib/safety/switches";
import { getUser } from "@/lib/session";

/** The whole request may be this large: the picture, and a little for the form around it. */
const REQUEST_MAX = PICTURE.uploadMaxBytes + PICTURE.formOverheadBytes;
const READ_WITHIN_MS = 30_000;
const TOO_LARGE = "A picture can be up to 10 MB.";

/** Sends the browser on with a sentence. The address is one of our own, written without a host, so nothing a request says about itself is used. */
function goTo(path: string, text?: string): Response {
  return new Response(null, { status: 303, headers: { location: text ? withNotice(path, text) : path, "cache-control": "no-store" } });
}

/**
 * Reads the request piece by piece and stops the moment it is larger than allowed, whatever it
 * said about its own length, or when it takes too long. Null means: too large or too slow.
 */
async function readWithin(request: Request, limit: number): Promise<Buffer | null> {
  const reader = request.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const pieces: Uint8Array[] = [];
  let size = 0;
  let late: NodeJS.Timeout | undefined;
  const tooLate = new Promise<"late">((resolve) => (late = setTimeout(() => resolve("late"), READ_WITHIN_MS)));
  try {
    for (;;) {
      const next = await Promise.race([reader.read(), tooLate]);
      if (next === "late") return null;
      if (next.done) return Buffer.concat(pieces);
      size += next.value.byteLength;
      if (size > limit) return null;
      pieces.push(next.value);
    }
  } finally {
    clearTimeout(late);
    // Whatever was not read is let go of.
    void reader.cancel().catch(() => undefined);
  }
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
    const body = await readWithin(request, REQUEST_MAX);
    if (!body) return goTo(page, TOO_LARGE);
    // Only what was read within the limit is taken apart: exactly one file, and nothing else.
    let parts: Array<[string, FormDataEntryValue]>;
    try {
      parts = [...(await new Response(new Uint8Array(body), { headers: { "content-type": kind } }).formData()).entries()];
    } catch {
      return goTo(page, "That upload could not be read. Please try again.");
    }
    const file = parts.length === 1 && parts[0][0] === "picture" && typeof parts[0][1] !== "string" ? parts[0][1] : null;
    if (!file || file.size === 0) return goTo(page, "Please choose one picture.");
    if (file.size > PICTURE.uploadMaxBytes) return goTo(page, TOO_LARGE);

    const picture = await acceptUpload({ hostId: user.id, postId: found.post.id, original: Buffer.from(await file.arrayBuffer()), now: new Date() });
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
