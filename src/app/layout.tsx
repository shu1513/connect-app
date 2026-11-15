import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  // Each page gives its own name; the site name is added after it.
  title: { default: "Connect", template: "%s — Connect" },
  description: "Private one-to-one video calls.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
