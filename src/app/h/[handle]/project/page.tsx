import type { Metadata } from "next";
import { Diary, diaryMetadata } from "./diary";

// Always built fresh, so hiding a page, ending a project or hiding a post takes effect at once.
export const dynamic = "force-dynamic";

export async function generateMetadata(props: PageProps<"/h/[handle]/project">): Promise<Metadata> {
  const { handle } = await props.params;
  return diaryMetadata(handle);
}

/** The diary of a host's running project, or of the one that ended last when none is running. */
export default async function ProjectPage(props: PageProps<"/h/[handle]/project">) {
  const { handle } = await props.params;
  return <Diary handle={handle} query={await props.searchParams} />;
}
