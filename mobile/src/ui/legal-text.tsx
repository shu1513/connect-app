/**
 * Draws the text of a legal document as the website does (src/legal/legal-text.tsx): headings,
 * paragraphs, lists, tables, set-off blocks and lines; inside them plain words, bold, links, and
 * blanks that are not filled in yet, which stand out so that nobody takes a draft for a finished
 * text. Only fixed documents of Connect are ever drawn with this, checked first
 * (lib/legal-rules.ts), never anything a person typed.
 */
import * as WebBrowser from "expo-web-browser";
import { Fragment } from "react";
import { Linking, StyleSheet, Text, View } from "react-native";
import type { AppLegalBlock, AppLegalInline } from "../../../src/lib/app-door/types";
import { legalLink } from "@/lib/legal-rules";
import { openWebsite } from "@/lib/website";
import { type, useColors } from "./theme";

/** Opens where a link leads: a page of the website or an address outside in the browser sheet, an email address in the phone's mail app. */
function open(link: { href: string; outside: boolean }) {
  const to = legalLink(link);
  if (!to) return;
  if (to.kind === "page") void openWebsite(to.path);
  else if (to.kind === "outside") void WebBrowser.openBrowserAsync(to.url).catch(() => {});
  else void Linking.openURL(to.url).catch(() => {});
}

function Inline({ parts }: { parts: AppLegalInline[] }) {
  const colors = useColors();
  return (
    <>
      {parts.map((part, index) => {
        if (part.t === "text") return <Fragment key={index}>{part.v}</Fragment>;
        if (part.t === "bold")
          return (
            <Text key={index} style={styles.bold}>
              <Inline parts={part.c} />
            </Text>
          );
        if (part.t === "blank")
          return (
            <Text key={index} style={{ backgroundColor: colors.notice, color: colors.text }}>
              {part.v}
            </Text>
          );
        // A link that leads nowhere the app may open is plain words.
        if (!legalLink(part)) return <Inline key={index} parts={part.c} />;
        return (
          <Text key={index} accessibilityRole="link" onPress={() => open(part)} style={[styles.link, { color: colors.accent }]}>
            <Inline parts={part.c} />
          </Text>
        );
      })}
    </>
  );
}

export function LegalText({ blocks }: { blocks: AppLegalBlock[] }) {
  const colors = useColors();
  const words = [styles.words, { color: colors.text }];
  return (
    <View style={styles.gap}>
      {blocks.map((block, index) => {
        if (block.t === "heading") {
          // The screen draws the document's own title itself (level 1), with its version.
          if (block.level === 1) return null;
          return (
            <Text key={index} accessibilityRole="header" style={[block.level === 2 ? styles.section : styles.part, { color: colors.text }]}>
              <Inline parts={block.c} />
            </Text>
          );
        }
        if (block.t === "paragraph")
          return (
            <Text key={index} style={words}>
              <Inline parts={block.c} />
            </Text>
          );
        if (block.t === "list")
          return (
            <View key={index} style={styles.list}>
              {block.items.map((item, at) => (
                <View key={at} style={styles.item}>
                  <Text style={[styles.words, styles.mark, { color: colors.text }]}>{block.ordered ? `${block.start + at}.` : "•"}</Text>
                  <Text style={[styles.words, styles.fill, { color: colors.text }]}>
                    <Inline parts={item} />
                  </Text>
                </View>
              ))}
            </View>
          );
        if (block.t === "table")
          // A phone is too narrow for columns: each row is a small box, every cell under the name of its column.
          return (
            <View key={index} style={styles.list}>
              {block.rows.map((row, at) => (
                <View key={at} style={[styles.row, { borderColor: colors.line }]}>
                  {row.map((cell, column) => (
                    <Text key={column} style={words}>
                      {block.head[column] ? (
                        <Text style={styles.bold}>
                          <Inline parts={block.head[column]} />
                          {": "}
                        </Text>
                      ) : null}
                      <Inline parts={cell} />
                    </Text>
                  ))}
                </View>
              ))}
            </View>
          );
        if (block.t === "quote")
          return (
            <View key={index} style={[styles.quote, { borderLeftColor: colors.line }]}>
              {block.lines.map((line, at) => (
                <Text key={at} style={words}>
                  <Inline parts={line} />
                </Text>
              ))}
            </View>
          );
        return <View key={index} style={[styles.line, { backgroundColor: colors.line }]} />;
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  gap: { gap: 12 },
  words: { fontSize: type.small, lineHeight: 21 },
  bold: { fontWeight: "700" },
  link: { textDecorationLine: "underline" },
  section: { fontSize: type.body, fontWeight: "700", lineHeight: 24, marginTop: 8 },
  part: { fontSize: type.small, fontWeight: "700", lineHeight: 21, marginTop: 4 },
  list: { gap: 6 },
  item: { flexDirection: "row", gap: 8 },
  mark: { minWidth: 18 },
  fill: { flex: 1 },
  row: { borderWidth: 1, borderRadius: 12, padding: 10, gap: 4 },
  quote: { borderLeftWidth: 4, paddingLeft: 12, gap: 2 },
  line: { height: 1, marginVertical: 8 },
});
