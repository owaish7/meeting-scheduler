import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Meeting Scheduler",
  description:
    "Find meeting times across time zones, and get a useful answer when no single time works.",
};

/*
 * Props are declared explicitly rather than using Next's generated `LayoutProps`
 * helper. That helper is written into `.next/types` during a build, so it exists
 * on a machine that has already run one and not on a clean checkout - which made
 * `tsc --noEmit` pass locally and fail in CI.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
