import { useEffect, useRef, useState, type ComponentRef } from "react";
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import type { AppHome, AppSuggestedHost } from "../../../src/lib/app-door/types";
import { ask } from "@/lib/api";
import { localTime, ratingWords } from "@/lib/home-rules";
import { Button, Card, Heading, usePageSettled, Words } from "@/ui/pieces";
import { Photo } from "@/ui/photo";
import { type, useColors } from "@/ui/theme";

/** How long is left, in words, until a moment: "2 hours 5 minutes", "12 minutes", "under a minute". */
function leftWords(untilMs: number): string {
  const minutes = Math.floor(untilMs / 60_000);
  if (minutes < 1) return "under a minute";
  const hours = Math.floor(minutes / 60);
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  if (hours >= 48) return plural(Math.floor(hours / 24), "day");
  if (hours >= 1) return minutes % 60 > 0 ? `${plural(hours, "hour")} ${plural(minutes % 60, "minute")}` : plural(hours, "hour");
  return plural(minutes, "minute");
}

/**
 * "Waiting for you" (plans/38): the requests a host must answer, each with the time left to
 * answer it, and the calls still to rate. The rows lead to the request's own screen, and Accept
 * and Decline appear, when part 07 has built them; rating a call is part 10's.
 */
export function WaitingForYou({ toAnswer, toRate, serverNow }: { toAnswer: AppHome["toAnswer"]; toRate: AppHome["toRate"]; serverNow: string }) {
  const colors = useColors();
  if (toAnswer.count === 0 && toRate.length === 0) return null;
  const now = Date.parse(serverNow);
  return (
    <View style={[styles.waiting, { backgroundColor: colors.notice, borderColor: colors.noticeLine }]}>
      <Heading>Waiting for you</Heading>
      {toAnswer.count > 0 ? (
        <View style={styles.gap}>
          <Text style={[styles.small, { color: colors.text }]}>
            You have {toAnswer.count} {toAnswer.count === 1 ? "request" : "requests"} for a call waiting for your answer.
          </Text>
          {toAnswer.shown.map((request) => (
            <View key={request.id} style={[styles.line, { borderTopColor: colors.noticeLine }]}>
              <Text style={[styles.rowTitle, { color: colors.text }]}>
                {localTime(request.startsAt)} · {request.name}
              </Text>
              <Text style={[styles.small, { color: colors.soft }]}>
                {request.minutes} minutes · {request.price}
              </Text>
              {request.respondBy ? (
                <Text style={[styles.small, { color: colors.accentDeep }]}>
                  {Date.parse(request.respondBy) > now ? `Answer within ${leftWords(Date.parse(request.respondBy) - now)} (by ${localTime(request.respondBy)})` : `Answer by ${localTime(request.respondBy)}`}
                </Text>
              ) : null}
            </View>
          ))}
          {toAnswer.shown.length < toAnswer.count ? <Text style={[styles.small, { color: colors.soft }]}>And {toAnswer.count - toAnswer.shown.length} more, for later times.</Text> : null}
        </View>
      ) : null}
      {toRate.length > 0 ? (
        <View style={styles.gap}>
          <Text style={[styles.small, styles.bold, { color: colors.text }]}>Waiting for your rating</Text>
          {toRate.map((call) => (
            <Text key={call.callId} style={[styles.small, { color: colors.text }]}>
              Your call with {call.otherName} <Text style={{ color: colors.soft }}>({localTime(call.endsAt)})</Text>
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** "Your requests": what this person has asked hosts for, and how each stands. */
export function YourRequests({ requests }: { requests: AppHome["requests"] }) {
  const colors = useColors();
  if (requests.length === 0) return null;
  return (
    <Card>
      <Heading>Your requests</Heading>
      {requests.map((request) => (
        <Text key={request.id} style={[styles.small, { color: colors.text }]}>
          <Text style={styles.bold}>
            {request.hostName}, {localTime(request.startsAt)}
          </Text>
          : {request.words}
        </Text>
      ))}
    </Card>
  );
}

/** "Hosts you follow": the first few, the available ones first. A host whose page is not open is a name only. */
export function HostsYouFollow({ followed }: { followed: AppHome["followed"] }) {
  const colors = useColors();
  if (followed.total === 0) return null;
  return (
    <Card>
      <Heading>Hosts you follow</Heading>
      {followed.hosts.map((host, index) => (
        <View key={host.handle ?? `${host.name}-${index}`} style={[styles.person, { borderTopColor: colors.line }, index === 0 ? styles.first : null]}>
          <Photo photoId={host.photoId} name={host.name} small />
          <View style={styles.personWords}>
            <Text style={[styles.rowTitle, { color: colors.text }]}>{host.name}</Text>
            {host.available ? (
              <View style={styles.availableLine}>
                <View style={styles.dot} />
                <Text style={[styles.small, styles.bold, { color: colors.text }]}>Available now</Text>
              </View>
            ) : null}
          </View>
        </View>
      ))}
      {followed.total > followed.hosts.length ? <Words soft>And {followed.total - followed.hosts.length} more.</Words> : null}
    </Card>
  );
}

/**
 * One suggested host: what a search result shows, the next open time, and the X. When half the
 * card has been on the screen it tells the list, once (`onSeen`): that is what "seen" means.
 */
function SuggestedCard({ host, first, onSeen, onHide }: { host: AppSuggestedHost; first: boolean; onSeen: (place: number) => void; onHide: (host: AppSuggestedHost) => void }) {
  const colors = useColors();
  const settled = usePageSettled();
  const window = useWindowDimensions();
  const box = useRef<ComponentRef<typeof View>>(null);
  const told = useRef(host.seen);
  useEffect(() => {
    if (told.current) return;
    // Where the card is on the screen now that the page has come to rest: seen when its middle is on it.
    box.current?.measureInWindow((_x, y, _width, height) => {
      const middle = y + height / 2;
      if (!told.current && height > 0 && middle > 0 && middle < window.height) {
        told.current = true;
        onSeen(host.place);
      }
    });
  }, [settled, window.height, host.place, onSeen]);
  return (
    <View ref={box} style={[styles.person, { borderTopColor: colors.line }, first ? styles.first : null]} collapsable={false}>
      <Photo photoId={host.photoId} name={host.name} small />
      <View style={styles.personWords}>
        <Text style={[styles.rowTitle, { color: colors.text }]}>
          {host.name} <Text style={[styles.small, { color: colors.soft, fontWeight: "400" }]}>@{host.handle}</Text>
        </Text>
        <Text style={[styles.small, { color: colors.text }]}>
          {ratingWords(host.rating, "New on Connect")} · {host.price}
        </Text>
        {host.languages.length > 0 ? <Text style={[styles.small, { color: colors.soft }]}>Languages: {host.languages.join(", ")}</Text> : null}
        {host.availableNow ? (
          <View style={styles.availableLine}>
            <View style={styles.dot} />
            <Text style={[styles.small, styles.bold, { color: colors.text }]}>Available now</Text>
          </View>
        ) : host.nextOpen ? (
          <Text style={[styles.small, { color: colors.text }]}>Next open time: {localTime(host.nextOpen)}</Text>
        ) : null}
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={`Hide ${host.name} from your suggestions`} onPress={() => onHide(host)} style={styles.hide} hitSlop={4}>
        <Text style={[styles.x, { color: colors.soft }]}>×</Text>
      </Pressable>
    </View>
  );
}

/**
 * "Suggested hosts" (plans/37, 41): up to six hosts the person does not know yet. The first three
 * are shown; the others are behind "Show more", so the page stays calm, and are not counted as
 * seen until they are opened. The row never says why a host is there; the text under it is the
 * same for everyone, and comes from the server.
 */
export function SuggestedHosts({ suggested, onChanged }: { suggested: NonNullable<AppHome["suggested"]>; onChanged: () => void }) {
  const colors = useColors();
  const [more, setMore] = useState(false);
  const [why, setWhy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  /** Places seen and not yet told to the server; sent together a moment later. */
  const waiting = useRef<number[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const day = suggested.day;
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  if (suggested.hosts.length === 0) return notice ? <Card><Words soft>{notice}</Words></Card> : null;

  const seen = (place: number) => {
    waiting.current.push(place);
    if (timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      const places = waiting.current.splice(0);
      if (places.length > 0) void ask("/api/app/suggestions/seen", { body: { day, places } });
    }, 800);
  };
  const hide = async (host: AppSuggestedHost) => {
    const done = await ask("/api/app/suggestions/hide", { body: { handle: host.handle } });
    setNotice(done.ok ? "Hidden. You will not be suggested this host again. You can still find them with the search." : "Something went wrong. Nothing was changed. Please try again.");
    if (done.ok) onChanged();
  };
  const first = suggested.hosts.slice(0, suggested.shownFirst);
  const rest = suggested.hosts.slice(suggested.shownFirst);
  return (
    <Card>
      <Heading>Suggested hosts</Heading>
      {notice ? <Words soft>{notice}</Words> : null}
      {first.map((host, index) => (
        <SuggestedCard key={`${day}:${host.place}`} host={host} first={index === 0} onSeen={seen} onHide={(one) => void hide(one)} />
      ))}
      {rest.length > 0 && !more ? <Button label={`Show ${rest.length} more`} kind="plain" onPress={() => setMore(true)} /> : null}
      {more ? rest.map((host) => <SuggestedCard key={`${day}:${host.place}`} host={host} first={false} onSeen={seen} onHide={(one) => void hide(one)} />) : null}
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: why }} onPress={() => setWhy(!why)} style={styles.whyHead}>
        <Text style={[styles.small, { color: colors.soft, textDecorationLine: "underline" }]}>{why ? "▾" : "▸"} Why these hosts?</Text>
      </Pressable>
      {why ? <Text style={[styles.small, { color: colors.soft }]}>{suggested.why}</Text> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  waiting: { borderWidth: 1, borderRadius: 24, padding: 20, gap: 12 },
  gap: { gap: 6 },
  line: { borderTopWidth: 1, paddingTop: 8, gap: 2 },
  small: { fontSize: type.small, lineHeight: 20 },
  bold: { fontWeight: "700" },
  rowTitle: { fontSize: type.body, fontWeight: "700", lineHeight: 22 },
  person: { flexDirection: "row", gap: 12, paddingTop: 12, borderTopWidth: 1, alignItems: "flex-start" },
  first: { borderTopWidth: 0, paddingTop: 0 },
  personWords: { flex: 1, gap: 2 },
  availableLine: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 12, height: 12, borderRadius: 6, backgroundColor: "#16a34a" },
  hide: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 22 },
  x: { fontSize: 24, lineHeight: 28 },
  whyHead: { minHeight: 44, justifyContent: "center" },
});
