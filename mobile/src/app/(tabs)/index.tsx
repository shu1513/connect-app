import { useStart } from "@/lib/opening";
import { openWebsite } from "@/lib/website";
import { Notice, Page, TextLink, Words } from "@/ui/pieces";

/**
 * Home (plans/45-phone-apps/04-the-home-page.md). An empty page for now: its part of the plan
 * fills it. A paused account is told so here, in the website's words
 * (plans/45-phone-apps/03-signing-in.md).
 */
export default function HomePlace() {
  const me = useStart()?.me;
  return (
    <Page title="Home">
      {me?.paused ? (
        <>
          <Notice>Your account is paused: you can look, but not book, host or join calls.</Notice>
          <TextLink label="Why, and what to do" onPress={() => void openWebsite("/paused")} />
        </>
      ) : null}
      <Words soft>Your next call, your calendar and your requests will be here.</Words>
    </Page>
  );
}
