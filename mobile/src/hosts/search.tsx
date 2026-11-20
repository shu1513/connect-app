import { router } from "expo-router";
import { useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { AppSearch } from "../../../src/lib/app-door/types";
import { ask } from "@/lib/api";
import { UNREACHABLE } from "@/lib/api-rules";
import { ratingWords } from "@/lib/home-rules";
import { isSearch } from "@/lib/host-rules";
import { BackLink, Button, Field, Notice, Page, Title, Words } from "@/ui/pieces";
import { Photo } from "@/ui/photo";
import { type, useColors } from "@/ui/theme";

/**
 * Finding a host by name, handle or confirmed social media name
 * (plans/45-phone-apps/05-search-and-a-hosts-page.md). Open to anyone, signed in or not, like the
 * website's search. The server searches and says everything there is to say (too little typed,
 * nobody found, more than are shown); this only shows it.
 */
export function Search({ onBack }: { onBack?: () => void }) {
  const colors = useColors();
  const [typed, setTyped] = useState("");
  const [found, setFound] = useState<AppSearch | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Only the newest search counts. */
  const newest = useRef(0);

  async function search() {
    const q = typed.trim();
    if (!q) return;
    const mine = ++newest.current;
    setBusy(true);
    setProblem(null);
    const answer = await ask<AppSearch>(`/api/app/search?q=${encodeURIComponent(q.slice(0, 200))}`);
    if (mine !== newest.current) return;
    setBusy(false);
    if (answer.ok && isSearch(answer.data)) setFound(answer.data);
    else setProblem(answer.ok ? UNREACHABLE : answer.message);
  }

  return (
    <Page>
      {onBack ? <BackLink onBack={onBack} /> : null}
      <Title>Find a host</Title>
      <Field label="Name, @handle, or Instagram, TikTok, YouTube or X name" value={typed} onChangeText={setTyped} autoCapitalize="none" autoCorrect={false} maxLength={50} returnKeyType="search" onSubmitEditing={() => void search()} />
      <Button label="Search" busy={busy} disabled={!typed.trim()} onPress={() => void search()} />
      {problem ? <Notice>{problem}</Notice> : null}
      {found?.hint ? <Words soft>{found.hint}</Words> : null}
      {found?.hosts.map((host) => (
        <Pressable
          key={host.handle}
          accessibilityRole="link"
          accessibilityLabel={`${host.name}, @${host.handle}`}
          onPress={() => router.push({ pathname: "/h/[handle]", params: { handle: host.handle } })}
          style={({ pressed }) => [styles.card, { backgroundColor: pressed ? colors.notice : colors.surface, borderColor: colors.line }]}
        >
          <View style={styles.top}>
            <Photo photoId={host.photoId} name={host.name} small />
            <View style={styles.words}>
              <Text style={[styles.name, { color: colors.text }]}>{host.name}</Text>
              <Text style={[styles.small, { color: colors.soft }]}>@{host.handle}</Text>
            </View>
          </View>
          <Text style={[styles.small, { color: colors.text }]}>
            {ratingWords(host.rating, "New on Connect")} · {host.price}
          </Text>
          {host.languages.length > 0 ? <Text style={[styles.small, { color: colors.text }]}>Languages: {host.languages.join(", ")}</Text> : null}
          {host.socials.length > 0 ? <Text style={[styles.small, { color: colors.soft }]}>{host.socials.map((social) => `${social.label}: @${social.name}`).join(" · ")} (confirmed)</Text> : null}
          {host.about ? (
            <Text style={[styles.small, { color: colors.soft }]} numberOfLines={4}>
              {host.about}
            </Text>
          ) : null}
        </Pressable>
      ))}
      {found?.more ? <Words soft>{found.more}</Words> : null}
    </Page>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 24, padding: 20, gap: 6 },
  top: { flexDirection: "row", gap: 12, alignItems: "center" },
  words: { flex: 1 },
  name: { fontSize: 18, fontWeight: "700", lineHeight: 24 },
  small: { fontSize: type.small, lineHeight: 20 },
});
