import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agent AQI — Agent Quality Index",
  description:
    "Rank autonomous agents by reliability, safety, economics, and user feedback.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
