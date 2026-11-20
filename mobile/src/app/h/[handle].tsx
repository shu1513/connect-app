import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Linking, Pressable, Share, StyleSheet, Text, View } from "react-native";
import type { AppFollowDone, AppHostPage } from "../../../../src/lib/app-door/types";
import { ask } from "@/lib/api";
import { UNREACHABLE } from "@/lib/api-rules";
import { rememberHostPage } from "@/lib/after-sign-in";
import { localTime, ratingWords } from "@/lib/home-rules";
import { isHostPage } from "@/lib/host-rules";
import { useOpening } from "@/lib/opening";
import { Slots } from "@/hosts/slots";
import { BackLink, Button, Card, Heading, Loading, Notice, Page, Problem, TextLink, Words } from "@/ui/pieces";
import { Photo } from "@/ui/photo";
import { type, useColors } from "@/ui/theme";

/**
 * A host's page (plans/45-phone-apps/05-search-and-a-hosts-page.md): who she is, what a call
 * costs, when she is free, and, for a member or someone she invited, what their membership gives.
 * Open to anyone, signed in or not, like the website's page. No project box, no diary.
 *
 * The server decides what is on the page for whoever is looking; this shows it. Choosing a time
 * leads on to asking for it, and "confirm who you are" to the ID check
 * (plans/45-phone-apps/06-asking-for-a-call.md). The other ways on arrive with their own parts:
 * "available now" to calling at once (part 11), a membership and its times to its screens
 * (part 13), "report" to its own.
 */
export default function HostPage() {
  const { handle: given } = useLocalSearchParams<{ handle?: string | string[] }>();
  const handle = typeof given === "string" ? given : "";
  // A screen of its own for each host: when another host's page is opened in this place, nothing of the first
  // one's page, price or buttons is left standing.
  return <OneHostPage key={handle} handle={handle} />;
}

function OneHostPage({ handle }: { handle: string }) {
  const colors = useColors();
  const { opening, refresh: askOpening } = useOpening();
  const signedIn = opening.kind === "ready" && opening.start.me !== null;
  const [page, setPage] = useState<AppHostPage | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [gone, setGone] = useState(false);
  const [length, setLength] = useState<number | null>(null);
  const [memberLength, setMemberLength] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pulling, setPulling] = useState(false);
  const [following, setFollowing] = useState(false);
  // Until when "available now" may be believed: a host is available only while her own screen keeps saying so, and
  // a page read a while ago knows nothing of now. Past this, the words are taken away until the server says so again.
  const [nowUntil, setNowUntil] = useState(0);
  const [clock, setClock] = useState(() => Date.now());
  const newest = useRef(0);
  /** The newest reading that got the page: an older reading's "not found" counts unless a newer one got it since. */
  const gotIt = useRef(0);
  const sending = useRef(false);

  const load = useCallback(async () => {
    const mine = ++newest.current;
    // Only a handle of plain letters is asked for; anything else leads to no page.
    if (!/^[A-Za-z0-9_-]+$/.test(handle)) {
      setGone(true);
      return;
    }
    const chosen = [length ? `length=${length}` : null, memberLength ? `mlength=${memberLength}` : null].filter(Boolean).join("&");
    const answer = await ask<AppHostPage>(`/api/app/hosts/${handle}${chosen ? `?${chosen}` : ""}`);
    // "Not for you" counts even from a reading that a newer one has overtaken, unless a newer one got the page since.
    const shutOut = !answer.ok && answer.code !== "unreachable" && gotIt.current <= mine;
    if (mine !== newest.current && !shutOut) return;
    if (answer.ok && isHostPage(answer.data)) {
      gotIt.current = mine;
      setNowUntil(answer.data.now ? Date.now() + answer.data.now.freshSeconds * 1000 : 0);
      setClock(Date.now());
      setPage(answer.data);
      setProblem(null);
      setGone(false);
    } else if (!answer.ok && answer.code === "not_found") {
      // No such page, or not one for this person: the same answer either way, and nothing of an earlier answer stays.
      setPage(null);
      setGone(true);
    } else if (!answer.ok && answer.code !== "unreachable") {
      // Another refusal (this copy is too old, say): the opening question says where the person belongs.
      setPage(null);
      setGone(false);
      setProblem(answer.message);
      void askOpening();
    } else {
      // Not reached: said beside what is on the screen; and "not found", if that was shown, gives way to it.
      setGone(false);
      setProblem(answer.ok ? UNREACHABLE : answer.message);
    }
  }, [handle, length, memberLength, askOpening]);

  // The reading for what is chosen now. Something that began earlier (following, pulling down) and reads the page
  // again when it is done asks through this, so a length chosen meanwhile is not put back to the one before.
  const latestLoad = useRef(load);
  useEffect(() => {
    latestLoad.current = load;
  }, [load]);

  // At the very moment "available now" may no longer be believed, the clock is looked at, and the server asked again.
  useEffect(() => {
    if (nowUntil <= 0) return;
    const timer = setTimeout(() => {
      setClock(Date.now());
      void load();
    }, Math.max(nowUntil - Date.now(), 0) + 50);
    return () => clearTimeout(timer);
  }, [nowUntil, load]);

  // While the page is in front: now, when a length is chosen, on coming back to the app, and every minute. So what
  // it says about "available now", an invitation, or whether the page is open at all, is never old for long.
  useFocusEffect(
    useCallback(() => {
      setClock(Date.now());
      void load();
      const listener = AppState.addEventListener("change", (state) => {
        if (state === "active") {
          setClock(Date.now());
          void load();
        }
      });
      const timer = setInterval(() => {
        setClock(Date.now());
        if (AppState.currentState === "active") void load();
      }, 60_000);
      return () => {
        listener.remove();
        clearInterval(timer);
      };
    }, [load]),
  );

  async function pull() {
    setPulling(true);
    await latestLoad.current();
    setPulling(false);
  }

  /** Follow, or stop following: by the server's own functions, and the page is read again after. */
  async function setFollow(step: "follow" | "unfollow") {
    if (sending.current) return;
    sending.current = true;
    setFollowing(true);
    const answer = await ask<AppFollowDone>(`/api/app/hosts/${handle}/${step}`, { body: {} });
    if (answer.ok) setNotice(typeof answer.data.words === "string" ? answer.data.words : null);
    else if (answer.code === "not_valid" || answer.code === "unreachable" || answer.code === "paused") setNotice(answer.message);
    else {
      setNotice(answer.message);
      void askOpening();
    }
    await latestLoad.current();
    sending.current = false;
    setFollowing(false);
  }

  /** A time was chosen: on to what is read before asking for it. Someone only looking signs in first, and comes back to this page. */
  function choose(start: string, minutes: number | null) {
    if (!minutes) return;
    if (!signedIn) {
      rememberHostPage(handle);
      router.push("/sign-in");
      return;
    }
    router.push({ pathname: "/book/[handle]", params: { handle, start, length: String(minutes) } });
  }

  const back = () => (router.canGoBack() ? router.back() : router.replace("/"));
  if (gone) {
    return (
      <Page title="Not found">
        <Words soft>There is no page here, or it is not open at the moment.</Words>
        <Button label="Back" kind="plain" onPress={back} />
      </Page>
    );
  }
  if (!page) return problem ? <Problem words={problem} onRetry={() => void load()} /> : <Loading />;
  const member = page.membership?.member ?? null;
  const availableNow = page.now !== null && clock < nowUntil ? page.now : null;
  // The heading over the ordinary way of asking goes with what is shown above it.
  const askHeading = page.now !== null && !availableNow ? page.ask.titleNotNow : page.ask.title;
  return (
      <Page refreshing={pulling} onRefresh={() => void pull()}>
        <BackLink onBack={back} />
        <View style={styles.head}>
          <Photo photoId={page.photoId} name={page.name} />
          <View style={styles.headWords}>
            <Text accessibilityRole="header" style={[styles.name, { color: colors.text }]}>
              {page.name}
            </Text>
            <Text style={[styles.small, { color: colors.soft }]}>@{page.handle}</Text>
            <Text style={[styles.small, { color: colors.text }]}>{ratingWords(page.rating, "New on Connect")}</Text>
            {page.languages.length > 0 ? <Text style={[styles.small, { color: colors.text }]}>Languages: {page.languages.join(", ")}</Text> : null}
          </View>
        </View>

        {problem ? <Notice>{problem}</Notice> : null}
        {notice ? <Notice>{notice}</Notice> : null}
        {page.own ? <Words soft>This is your own page, as others see it.</Words> : null}

        {page.follow === "visitor" ? (
          <Button label="Sign in to follow" kind="plain" onPress={() => router.push("/sign-in")} />
        ) : page.follow === "following" ? (
          <View style={styles.followLine}>
            <Text style={[styles.small, styles.bold, { color: colors.text }]}>Following</Text>
            <TextLink label="Unfollow" onPress={() => void setFollow("unfollow")} />
          </View>
        ) : page.follow ? (
          <Button label="Follow" kind="plain" busy={following} onPress={() => void setFollow("follow")} />
        ) : null}

        {page.about ? <Words soft>{page.about}</Words> : null}

        {page.socials.length > 0 ? (
          <View style={styles.gap}>
            {page.socials.map((social) => (
              <Pressable key={`${social.label}:${social.name}`} accessibilityRole="link" accessibilityLabel={`${social.label}: @${social.name}, account confirmed`} onPress={() => void Linking.openURL(social.url).catch(() => {})} style={styles.social}>
                <Text style={[styles.small, { color: colors.text }]}>
                  {social.label}: <Text style={{ color: colors.accent, textDecorationLine: "underline" }}>@{social.name}</Text> <Text style={{ color: colors.soft }}>(account confirmed)</Text>
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        {page.shareUrl ? <TextLink label="Share this page" onPress={() => void Share.share({ message: page.shareUrl! }).catch(() => {})} /> : null}

        <Card>
          <Heading>{page.price}</Heading>
          {page.seller ? <Words soft>{page.seller}</Words> : null}
          <Words soft>{page.callWords}</Words>
          {page.verifiedOnly ? <Words>{page.name} only takes calls from people who have confirmed their ID.</Words> : null}
          {page.confirmId && signedIn ? <Button label="Confirm who I am" kind="plain" onPress={() => router.push("/identity")} /> : null}
        </Card>

        {page.membership?.invitedUntil ? (
          <Card>
            <Heading>{page.name} invites you to a membership</Heading>
            <Words>
              A fixed amount each month, as talk time with {page.name} at a lower price. The invitation is open until {localTime(page.membership.invitedUntil)}. Nothing is charged unless you join.
            </Words>
          </Card>
        ) : null}
        {page.membership?.state ? (
          <Card>
            <Heading>Your membership</Heading>
            <Words>{page.membership.state.words}</Words>
          </Card>
        ) : null}
        {member ? (
          <Card>
            <Heading>Your membership</Heading>
            <Words>
              <Text style={styles.bold}>{member.left}</Text>, until {localTime(member.until)}. Your price is {member.price}.
            </Words>
            {member.held ? <Words soft>{member.held}</Words> : null}
            {!member.canBook ? null : member.tooLittle ? (
              <Words>The time you have left does not cover a call with {page.name}. You can still ask for one the ordinary way below, at the regular price.</Words>
            ) : (
              <>
                <Words>A call you book with your membership is booked at once: {page.name} does not need to accept it. It must end before your month ends.</Words>
                <Lengths lengths={member.lengths} chosen={member.chosen} onChoose={setMemberLength} />
                {member.times.length === 0 ? (
                  <Words soft>There are no open times for this length before your month ends. Please look again later.</Words>
                ) : (
                  <Slots starts={member.times.map((time) => time.startsAt)} marked={member.times.filter((time) => time.membersOnly).map((time) => time.startsAt)} markedLabel="A time for members only" />
                )}
              </>
            )}
          </Card>
        ) : null}

        {availableNow ? (
          <View style={[styles.available, { backgroundColor: colors.notice, borderColor: colors.noticeLine }]}>
            <View style={styles.availableHead}>
              <View style={styles.dot} />
              <Heading>Available now</Heading>
            </View>
            <Words>
              {page.name} can take a call right away. They answer within {availableNow.answerMinutes} minutes and the call starts a minute after they accept.
              {availableNow.paid ? " You pay for the time you are both in the call." : ""}
            </Words>
          </View>
        ) : null}

        <Card>
          <Heading>{askHeading}</Heading>
          {page.ask.closed ? (
            <Words soft>{page.ask.closed}</Words>
          ) : (
            <>
              {page.ask.words ? <Words>{page.ask.words}</Words> : null}
              <Lengths lengths={page.ask.lengths} chosen={page.ask.chosen} onChoose={setLength} />
              {page.ask.noTimes ? <Words soft>{page.ask.noTimes}</Words> : <Slots starts={page.ask.starts} onChoose={page.own ? undefined : (start) => choose(start, page.ask.chosen)} />}
            </>
          )}
        </Card>
        {!signedIn ? <Words soft>To ask for a call you need an account.</Words> : null}
      </Page>
  );
}

/** The lengths a call can have, to choose one from. The one chosen is marked; choosing another asks the server for its times. */
function Lengths({ lengths, chosen, onChoose }: { lengths: AppHostPage["ask"]["lengths"]; chosen: number | null; onChoose: (minutes: number) => void }) {
  const colors = useColors();
  if (lengths.length === 0) return null;
  return (
    <View style={styles.gap}>
      <Text style={[styles.small, styles.bold, { color: colors.text }]}>Length</Text>
      <View style={styles.lengths} accessibilityRole="radiogroup">
        {lengths.map((one) => {
          const on = one.minutes === chosen;
          return (
            <Pressable
              key={one.minutes}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              accessibilityLabel={one.words}
              onPress={() => onChoose(one.minutes)}
              style={[styles.length, on ? { backgroundColor: colors.text, borderColor: colors.text } : { borderColor: colors.edge }]}
            >
              <Text style={[styles.small, on ? { color: colors.page, fontWeight: "700" } : { color: colors.text }]}>{one.words}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", gap: 16, alignItems: "center" },
  headWords: { flex: 1, gap: 2 },
  name: { fontSize: type.title, fontWeight: "800", lineHeight: 36, letterSpacing: -0.6 },
  small: { fontSize: type.small, lineHeight: 20 },
  bold: { fontWeight: "700" },
  followLine: { flexDirection: "row", alignItems: "center", gap: 16 },
  gap: { gap: 6 },
  social: { minHeight: 44, justifyContent: "center" },
  available: { borderWidth: 1, borderRadius: 24, padding: 20, gap: 8 },
  availableHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 12, height: 12, borderRadius: 6, backgroundColor: "#16a34a" },
  lengths: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  length: { minHeight: 44, borderWidth: 1, borderRadius: 22, paddingHorizontal: 16, alignItems: "center", justifyContent: "center" },
});
