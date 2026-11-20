import { useState } from "react";
import { dayOf } from "../../../../src/lib/home/rules";
import { Calendar } from "@/home/calendar";
import { NextCall } from "@/home/next-call";
import { HostsYouFollow, SuggestedHosts, WaitingForYou, YourRequests } from "@/home/sections";
import { useHome } from "@/home/use-home";
import { phoneZone } from "@/lib/home-rules";
import { useStart } from "@/lib/opening";
import { Card, Heading, Loading, Notice, Page, Problem, Words } from "@/ui/pieces";

/**
 * Home (plans/45-phone-apps/04-the-home-page.md): the website's home page on a phone. From top
 * to bottom: the next call with its countdown, what is waiting for this person, their calendar,
 * their own requests, the hosts they follow, and suggested hosts. One page for everyone; a host
 * sees more on it. No diary, no project, no tip.
 *
 * It shows what the server says and decides nothing itself. It never opens a room.
 */
export default function HomePlace() {
  const start = useStart();
  const me = start?.me;
  // The day the calendar shows; null is today. It is part of the question to the server.
  const [day, setDay] = useState<string | null>(null);
  const { home, problem, pulling, pull, reload, asking, refused } = useHome(day);

  if (!home) return problem ? <Problem words={problem} onRetry={() => void reload()} /> : <Loading />;
  const nextCall = home.next ? (home.calls.find((call) => call.id === home.next!.id) ?? null) : null;
  // Other days are on their way only while a question is under way and the days asked for are not the days shown.
  // ("Today" and today's own date are the same days.)
  const today = dayOf(new Date(home.serverNow), phoneZone());
  const moving = asking && (day ?? today) !== (home.calendar.day ?? today);
  return (
    <Page title={home.firstName ? `Hello, ${home.firstName}` : "Hello"} refreshing={pulling} onRefresh={() => void pull()}>
      {/* What is on the screen is the last answer that came. If a newer one did not come, that is said. */}
      {problem ? <Notice>{problem}</Notice> : null}
      {me?.paused ? (
        // Told in the app, in the words of the website's own page for it: that page shows whoever is signed in to the
        // browser, who need not be the person in the app.
        <Notice>
          Your account is paused: you can look, but not book, host or join calls.
          {me.pausedReason ? `\n\nReason: ${me.pausedReason}` : ""}
          {`\n\nIf you think this is a mistake, write to ${start?.supportEmail}.`}
        </Notice>
      ) : null}
      {home.hosting?.page ? <Words soft>You are a host. Your page: /h/{home.hosting.page}</Words> : null}

      {nextCall && home.next ? (
        <NextCall call={nextCall} next={home.next} serverNow={home.serverNow} onDue={() => void reload()} />
      ) : (
        <Card>
          <Heading>Your next call</Heading>
          <Words soft>{home.noCall ?? "You have no call coming up."}</Words>
        </Card>
      )}

      <WaitingForYou toAnswer={home.toAnswer} toRate={home.toRate} serverNow={home.serverNow} />

      {home.calendar.shown ? (
        <Card>
          <Heading>Your calendar</Heading>
          <Calendar
            calls={home.calls}
            asks={home.calendar.asks}
            serverNow={home.serverNow}
            // The days shown are the days this answer is for. Other days asked for appear when their answer is in.
            day={home.calendar.day}
            moving={moving}
            cut={home.calendar.cut}
            most={home.calendar.most}
            nextId={home.next?.id ?? null}
            // Asking for the same days again (after they did not come) asks the server again.
            onDay={(next) => (next === day ? void reload() : setDay(next))}
          />
        </Card>
      ) : null}

      <YourRequests requests={home.requests} />
      <HostsYouFollow followed={home.followed} />
      {home.suggested ? <SuggestedHosts suggested={home.suggested} onChanged={() => void reload()} refused={refused} /> : null}
    </Page>
  );
}
