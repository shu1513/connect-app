import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { withNotice } from "@/lib/notice";
import { uploadPhoto } from "@/lib/profiles/photo";
import { photoNotice } from "@/lib/profiles/photo-words";
import { ProjectError } from "@/lib/projects/rules";
import { readOnePicture, REQUEST_MAX } from "@/lib/projects/upload-body";
import { fromThisSite } from "@/lib/same-site";
import { getUser } from "@/lib/session";

const TOO_LARGE = "A picture can be up to 10 MB.";

/** Sends the browser on with a sentence. The address is one of our own, written without a host, so nothing a request says about itself is used. */
function goTo(path: string, text?: string): Response {
  return new Response(null, { status: 303, headers: { location: text ? `${withNotice(path, text)}#photo` : path, "cache-control": "no-store" } });
}

/**
 * "Upload a photo" (plans/35): a person, a host or not, uploads the picture that becomes their photo. A picture
 * does not fit into the app's ordinary forms, which are limited to 1 MB, so it has this address of
 * its own, built like the one for a diary's pictures. Everything that can be checked is checked
 * before anything is read: who may have a photo, the limit of tries and the rest are decided at
 * the start of the try (uploadPhoto), and the file is read only once that has said yes.
 */
export async function POST(request: Request) {
  // 1. Only from Connect's own page: another website cannot send an upload through a logged-in person's browser.
  if (!fromThisSite(request.headers)) return new Response("Not allowed.", { status: 403, headers: { "cache-control": "no-store" } });

  // 2. The full gate for an active user.
  const user = await getUser();
  if (!user) return goTo(`/login?next=${encodeURIComponent("/account")}`);
  if (user.paused) return goTo("/paused");
  // Where the person is sent back to: a host's photo is on the Hosting page, anyone else's on the Account page.
  // Decided here, from the login: never from anything the request says.
  const [hostProfile] = await db.select({ userId: schema.hostProfiles.userId }).from(schema.hostProfiles).where(eq(schema.hostProfiles.userId, user.id));
  const PAGE = hostProfile ? "/host" : "/account";

  // 3. A file form, and not one that says it is too large.
  const kind = request.headers.get("content-type") ?? "";
  if (!kind.toLowerCase().startsWith("multipart/form-data")) return goTo(PAGE, "Please choose a picture.");
  const said = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(said) && said > REQUEST_MAX) return goTo(PAGE, TOO_LARGE);

  // 4. The whole press. The file is read inside it, after the start, while the one place for pictures is held.
  try {
    const result = await uploadPhoto({
      userId: user.id,
      read: async () => {
        const file = await readOnePicture(request, kind);
        if (file === "too_large") throw new ProjectError(TOO_LARGE);
        if (file === "unreadable") throw new ProjectError("The upload could not be read. Please try again.");
        if (file === "not_one") throw new ProjectError("Please choose one picture.");
        return file;
      },
    });
    return goTo(PAGE, photoNotice(result, "upload", !hostProfile));
  } catch (error) {
    console.error("[host-photo] an upload failed", error instanceof Error ? error.name : "error");
    return goTo(PAGE, "Something went wrong. Your photo was not changed. Please try again.");
  }
}
