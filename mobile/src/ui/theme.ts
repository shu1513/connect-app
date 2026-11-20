/**
 * The look of the app: the website's warm look (src/components/warm-ui.css), rebuilt with the
 * phone's own parts (plans/45-phone-apps/02-the-frame.md). One set of colours for light, one for
 * dark; the phone decides which. Sizes are in the phone's own points and grow with its text size.
 */
import { useColorScheme } from "react-native";

export type Colors = {
  /** The page behind everything. */
  page: string;
  /** Cards and fields. */
  surface: string;
  text: string;
  /** Lesser text: hints, captions. */
  soft: string;
  /** The line around a card. */
  line: string;
  /** The line around a field or a plain button. */
  edge: string;
  /** Connect's own colour: the main button, a link, the place you are in. */
  accent: string;
  /** The same, pressed. */
  accentDeep: string;
  /** Text on the accent colour. */
  onAccent: string;
  /** A notice's background and line. */
  notice: string;
  noticeLine: string;
  /** Something went wrong, and buttons that cannot be undone. */
  danger: string;
};

const light: Colors = {
  page: "#fffbf7",
  surface: "#ffffff",
  text: "#1c1917",
  soft: "#57534e",
  line: "#e7e5e4",
  edge: "#a8a29e",
  accent: "#c2410c",
  accentDeep: "#9a3412",
  onAccent: "#ffffff",
  notice: "#fff7ed",
  noticeLine: "#fed7aa",
  danger: "#b91c1c",
};

/** The website has no dark look of its own (only the call screen is dark). These keep its warmth and its contrast. */
const dark: Colors = {
  page: "#1c1917",
  surface: "#292524",
  text: "#fafaf9",
  soft: "#d6d3d1",
  line: "#44403c",
  edge: "#78716c",
  accent: "#fb923c",
  accentDeep: "#fdba74",
  onAccent: "#1c1917",
  notice: "#431407",
  noticeLine: "#9a3412",
  danger: "#fca5a5",
};

export function useColors(): Colors {
  return useColorScheme() === "dark" ? dark : light;
}

/** Shapes and sizes, the website's own: cards rounded at 24, fields at 12, buttons as pills, nothing to touch smaller than 44. */
export const shape = { card: 24, field: 12, pill: 999, touch: 44, gap: 16, pad: 24 } as const;
export const type = { title: 30, heading: 20, body: 16, small: 14 } as const;
