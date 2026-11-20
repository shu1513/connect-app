import { useEffect, useState } from "react";
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
 */
export function Photo({ photoId, name, small = false }: { photoId: string | null; name: string; small?: boolean }) {
  const colors = useColors();
  const [shown, setShown] = useState<{ id: string; picture: string } | null>(null);
  useEffect(() => {
    if (!photoId) return;
    let here = true;
    void photo(photoId).then((picture) => {
      if (here && picture) setShown({ id: photoId, picture });
    });
    return () => {
      here = false;
    };
  }, [photoId]);
  const size = small ? 44 : 64;
  const round = { width: size, height: size, borderRadius: size / 2 };
  // Only ever the picture that belongs to the id now asked for: never the one before it.
  if (photoId && shown?.id === photoId) return <Image source={{ uri: shown.picture }} style={round} accessibilityIgnoresInvertColors accessibilityLabel={`Photo of ${name}`} />;
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
