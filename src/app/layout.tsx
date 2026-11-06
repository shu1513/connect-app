import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Connect — call test",
  description: "Step 1: video call with time tracking.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
