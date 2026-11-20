import { answer, appRequest } from "@/lib/app-door/gate";
import { searchFor } from "@/lib/app-door/host-page";

/**
 * Finding a host by name, handle or confirmed social media name, for the phone app
 * (plans/45-phone-apps/05-search-and-a-hosts-page.md). Open to anyone, like the website's search.
 * Who is searching only matters for one thing: a pair with a block in either direction never find
 * each other. As on the website, someone with "18 and terms" still to do counts as a guest here.
 */
export async function GET(request: Request) {
  const asked = await appRequest(request, "anyone");
  if (asked instanceof Response) return asked;
  const viewer = asked.person?.welcomed ? { id: asked.person.id } : null;
  return answer(await searchFor(viewer, new URL(request.url).searchParams.get("q")));
}
