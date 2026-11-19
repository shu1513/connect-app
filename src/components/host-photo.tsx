"use client";

import { useState } from "react";

/**
 * A host's round photo, or the first letter of their name in a circle when they have none
 * (plans/29). The photo is fetched from its own address (/host-photos/<id>), which decides afresh
 * each time who may see it, and it is the plain file: nothing in between makes or keeps another
 * copy. The name stands right beside it on every page, so the picture itself says nothing aloud.
 *
 * If the photo cannot be fetched (it was removed or replaced after the page was drawn), the letter
 * is shown in its place.
 */
export function HostPhoto({ photoId, name, small = false }: { photoId: string | null; name: string; small?: boolean }) {
  // Which photo failed, not just "one failed": a newer photo on the same page gets its own try.
  const [failed, setFailed] = useState<string | null>(null);
  const size = small ? "size-11 text-lg" : "size-16 text-2xl";
  if (!photoId || failed === photoId) {
    return (
      <div aria-hidden data-host-letter className={`flex ${size} shrink-0 items-center justify-center rounded-full bg-[#ffedd5] font-bold text-[#9a3412]`}>
        {(Array.from(name)[0] ?? "").toUpperCase()}
      </div>
    );
  }
  const side = small ? 44 : 64;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- the framework's picture component would make and keep copies of its own
    <img
      src={`/host-photos/${photoId}`}
      width={side}
      height={side}
      alt=""
      data-host-photo
      className={`${size} shrink-0 rounded-full bg-[#ffedd5] object-cover`}
      onError={() => setFailed(photoId)}
      // A picture that had already failed before this page's script was ready never tells onError: it is looked at once here.
      ref={(image) => {
        if (image && image.complete && image.naturalWidth === 0) setFailed(photoId);
      }}
    />
  );
}
