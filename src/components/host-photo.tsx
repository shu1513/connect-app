/**
 * A host's round photo, or the first letter of their name in a circle when they have none
 * (plans/29). The photo is fetched from its own address (/host-photos/<id>), which decides afresh
 * each time who may see it, and it is the plain file: nothing in between makes or keeps another
 * copy. The name stands right beside it on every page, so the picture itself says nothing aloud.
 */
export function HostPhoto({ photoId, name, small = false }: { photoId: string | null; name: string; small?: boolean }) {
  const size = small ? "size-11 text-lg" : "size-16 text-2xl";
  if (!photoId) {
    return (
      <div aria-hidden data-host-letter className={`flex ${size} shrink-0 items-center justify-center rounded-full bg-[#ffedd5] font-bold text-[#9a3412]`}>
        {(Array.from(name)[0] ?? "").toUpperCase()}
      </div>
    );
  }
  const side = small ? 44 : 64;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- the framework's picture component would make and keep copies of its own
    <img src={`/host-photos/${photoId}`} width={side} height={side} alt="" data-host-photo className={`${size} shrink-0 rounded-full bg-[#ffedd5] object-cover`} />
  );
}
