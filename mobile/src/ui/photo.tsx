import { createContext, useContext, useEffect, useRef, useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
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

/**
 * A page that asks the server again from time to time hands its photos the moment of its newest
 * answer here. A photo that is on the screen then asks again whether it may still be shown, at
 * most every five minutes (the time a photo anyone may see may be kept); a "no" takes it away. So
 * a photo does not stay on a screen for hours after its owner hid it.
 */
export const PhotosAsOf = createContext(0);
const RECHECK_MS = 300_000;

function OnePhoto({ photoId, name, small }: { photoId: string | null; name: string; small: boolean }) {
  const colors = useColors();
  const asOf = useContext(PhotosAsOf);
  const [picture, setPicture] = useState<string | null>(null);
  const askedAt = useRef(0);
  useEffect(() => {
    if (!photoId) return;
    if (askedAt.current > 0 && Date.now() - askedAt.current < RECHECK_MS) return;
    askedAt.current = Date.now();
    let here = true;
    void photo(photoId).then((got) => {
      // Shown when there is one for this person; taken away again when the answer is "no".
      if (here) setPicture(got);
    });
    return () => {
      here = false;
    };
  }, [photoId, asOf]);
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
