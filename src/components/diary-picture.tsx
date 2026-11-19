/**
 * A picture of a diary. It is fetched from its own address (/pictures/<id>), which decides afresh
 * each time who may see it, and it is the plain file: nothing in between makes or keeps another copy.
 */
export function DiaryPicture({ id, width, height, small = false }: { id: string; width: number; height: number; small?: boolean }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- the framework's picture component would make and keep copies of its own
    <img src={`/pictures/${id}`} width={width} height={height} alt="A picture from this post" loading="lazy" className={small ? "h-auto max-h-40 w-auto max-w-40 rounded" : "h-auto max-w-full rounded"} />
  );
}
