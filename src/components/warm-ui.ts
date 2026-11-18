import { Plus_Jakarta_Sans } from "next/font/google";
import "./warm-ui.css";

// One font instance and one stylesheet for the site's warm look (see warm-ui.css).
export const warmFont = Plus_Jakarta_Sans({ subsets: ["latin"], display: "swap" });

/** The warm look's class names, as the pages use them. */
export const warm = {
  auth: "warm-auth",
  available: "warm-available",
  brand: "warm-brand",
  button: "warm-button",
  card: "warm-card",
  document: "warm-document",
  focus: "warm-focus",
  footer: "warm-footer",
  footerLinks: "warm-footerLinks",
  header: "warm-header",
  headerInner: "warm-headerInner",
  input: "warm-input",
  nav: "warm-nav",
  navLink: "warm-navLink",
  page: "warm-page",
  root: "warm-root",
  searchInput: "warm-searchInput",
  searchPill: "warm-searchPill",
  secondary: "warm-secondary",
  signup: "warm-signup",
  slots: "warm-slots",
  title: "warm-title",
} as const;
