import { useStart } from "@/lib/opening";
import { Notice, Page, Words } from "@/ui/pieces";

/**
 * Home (plans/45-phone-apps/04-the-home-page.md). An empty page for now: its part of the plan
 * fills it. A paused account is told so here, in the words of the website's own page for it
 * (plans/45-phone-apps/03-signing-in.md). It is told in the app, not on a page of the website:
 * that page shows whoever is signed in to the browser, who need not be the person in the app.
 */
export default function HomePlace() {
  const start = useStart();
  const me = start?.me;
  return (
    <Page title="Home">
      {me?.paused ? (
        <Notice>
          Your account is paused: you can look, but not book, host or join calls.
          {me.pausedReason ? `\n\nReason: ${me.pausedReason}` : ""}
          {`\n\nIf you think this is a mistake, write to ${start?.supportEmail}.`}
        </Notice>
      ) : null}
      <Words soft>Your next call, your calendar and your requests will be here.</Words>
    </Page>
  );
}
