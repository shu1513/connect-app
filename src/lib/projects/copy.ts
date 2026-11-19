/**
 * Making Connect's own copy of an uploaded picture (plans/23, "What Connect does with a picture";
 * plans/24, "Making Connect's copy"). The file as it arrived is never kept, checked or shown: only
 * this copy is.
 *
 * The copy is a JPEG in standard colours, turned the right way up, no wider or taller than 1,600
 * pixels and no larger than 1 MB, with nothing of what was hidden in the file: not the place the
 * photo was taken, not the camera, not the file's own colour description.
 */
import sharp, { type Metadata, type OutputInfo } from "sharp";
import { isAnimatedPng, PICTURE, pictureKind, ProjectError } from "./rules";

export type Copy = { bytes: Buffer; width: number; height: number };

const WRONG_KIND = "Please use a JPEG, PNG or WebP picture.";
const MOVING = "A picture that moves cannot be used. Please use a still picture.";
const UNREADABLE = "That file could not be read as a picture. Please try another one.";

/**
 * The copy of this file, or a ProjectError with words for the host. Heavy work: the caller makes
 * sure only one picture is worked on at a time.
 */
export async function makeCopy(original: Buffer): Promise<Copy> {
  if (original.length > PICTURE.uploadMaxBytes) throw new ProjectError("A picture can be up to 10 MB.");
  const kind = pictureKind(original);
  if (!kind) throw new ProjectError(WRONG_KIND);
  if (kind === "png" && isAnimatedPng(original)) throw new ProjectError(MOVING);

  // The limit on points is set on the reader itself, so a small file that would unpack into something
  // enormous is refused before it is unpacked. The reader's own strictness about broken data is left as it is.
  const open = () => sharp(original, { limitInputPixels: PICTURE.maxPixels });
  let seen: Metadata;
  try {
    seen = await open().metadata();
  } catch {
    throw new ProjectError(UNREADABLE);
  }
  // What the reader found must be what the first bytes said. Anything else is a file dressed up as another.
  if (seen.format !== kind) throw new ProjectError(WRONG_KIND);
  if ((seen.pages ?? 1) > 1) throw new ProjectError(MOVING);
  if (!seen.width || !seen.height) throw new ProjectError(UNREADABLE);
  if (seen.width * seen.height > PICTURE.maxPixels) throw new ProjectError("That picture is too large. Please use one with fewer than 50 million points.");
  if (Math.min(seen.width, seen.height) < PICTURE.minSide) throw new ProjectError(`That picture is too small. It needs at least ${PICTURE.minSide} points on each side.`);

  for (const quality of PICTURE.qualities) {
    let made: { data: Buffer; info: OutputInfo };
    try {
      made = await open()
        // Turned the right way up first: the note that says which way is up is among what is left out.
        .rotate()
        .resize({ width: PICTURE.side, height: PICTURE.side, fit: "inside", withoutEnlargement: true })
        // White behind anything see-through: a JPEG cannot be see-through.
        .flatten({ background: "#ffffff" })
        // Written in standard colours (the file's own colour description is used for that, then left out),
        // and without anything else that was hidden in the file. Both are what the library does unless told otherwise.
        .jpeg({ quality, mozjpeg: true })
        .toBuffer({ resolveWithObject: true });
    } catch {
      throw new ProjectError(UNREADABLE);
    }
    // A very long, thin picture is large enough as it comes and too small once it is shrunk to fit. The copy is what is checked and shown, so the copy must be large enough.
    if (Math.min(made.info.width, made.info.height) < PICTURE.minSide) throw new ProjectError(`That picture is too long and thin. Once it is shrunk to fit, it needs at least ${PICTURE.minSide} points on each side.`);
    if (made.data.length <= PICTURE.maxBytes) return { bytes: made.data, width: made.info.width, height: made.info.height };
  }
  throw new ProjectError("That picture is too detailed to be kept under 1 MB. Please try another one.");
}
