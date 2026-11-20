import { useEffect, useState } from "react";
import { AppState, Image, StyleSheet, Text, View } from "react-native";
import { photo } from "@/lib/photos";
import { useColors } from "./theme";

/** The first letters of a name, for someone with no photo to show: "Ada Lovelace" is "AL". */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "")).toUpperCase() || "?";
}

/**
 * A person's photo in a circle, or their initials when there is none, or none for whoever is
 * looking (plans/45-phone-apps/04-the-home-page.md, decision 4). It asks the server for the photo
 * by its id; a "no" looks exactly like having no photo.
 *
 * Each photo id gets a piece of its own: when the id changes, or goes and comes back, nothing of
 * the picture before is left to show.
 */
export function Photo({ photoId, name, small = false }: { photoId: string | null; name: string; small?: boolean }) {
  return <OnePhoto key={photoId ?? "none"} photoId={photoId} name={name} small={small} />;
}

function OnePhoto({ photoId, name, small }: { photoId: string | null; name: string; small: boolean }) {
  const colors = useColors();
  const [picture, setPicture] = useState<string | null>(null);
  useEffect(() => {
    if (!photoId) return;
    let here = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let until = 0;
    let asking = false;
    // Asks whether this photo may be shown. A "yes" holds for a while (the server's five minutes); when that has
    // run out the question is asked again, and whatever the answer is then is what is shown: a "no", or no answer
    // at all, takes the picture away. So it is never on the screen for long after its owner hid it.
    const ask = async () => {
      if (asking) return;
      asking = true;
      const got = await photo(photoId);
      asking = false;
      if (!here) return;
      setPicture(got?.picture ?? null);
      until = got?.until ?? 0;
      if (timer) clearTimeout(timer);
      timer = got ? setTimeout(() => void ask(), Math.max(got.until - Date.now(), 1000)) : null;
    };
    void ask();
    // A phone that was asleep does not count the time: on coming back, a photo whose time has run out asks at once.
    const listener = AppState.addEventListener("change", (state) => {
      if (state === "active" && until > 0 && until <= Date.now()) void ask();
    });
    return () => {
      here = false;
      if (timer) clearTimeout(timer);
      listener.remove();
    };
  }, [photoId]);
  const size = small ? 44 : 64;
  const round = { width: size, height: size, borderRadius: size / 2 };
  if (picture) return <Image source={{ uri: picture }} style={round} accessibilityIgnoresInvertColors accessibilityLabel={`Photo of ${name}`} />;
  return (
    <View style={[round, styles.initials, { backgroundColor: colors.notice, borderColor: colors.noticeLine }]} accessibilityElementsHidden importantForAccessibility="no">
      <Text style={[styles.letters, { color: colors.accentDeep, fontSize: small ? 15 : 20 }]}>{initialsOf(name)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  initials: { alignItems: "center", justifyContent: "center", borderWidth: 1 },
  letters: { fontWeight: "800" },
});
