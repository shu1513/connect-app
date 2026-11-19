import type { Metadata } from "next";
import { Diary, diaryMetadata } from "../diary";

// Always built fresh, so hiding a page, ending a project or hiding a post takes effect at once.
export const dynamic = "force-dynamic";

export async function generateMetadata(props: PageProps<"/h/[handle]/project/[id]">): Promise<Metadata> {
  const { handle, id } = await props.params;
  return diaryMetadata(handle, id);
}

/** The diary of exactly one project, so an old link keeps working after the host starts a new one. The project must be hers. */
export default async function OneProjectPage(props: PageProps<"/h/[handle]/project/[id]">) {
  const { handle, id } = await props.params;
  return <Diary handle={handle} projectId={id} query={await props.searchParams} />;
}
