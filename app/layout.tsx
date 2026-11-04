import type { Metadata } from "next";
import { Fraunces, IBM_Plex_Mono, Newsreader } from "next/font/google";
import ShellChrome, { DesktopHooks } from "./components/ShellChrome";
import "./globals.css";

// Type pairing (each family has a job, never a single identity):
// Fraunces — refined editorial display for headlines and numerals.
// Newsreader — refined serif for reading: instructions, labels, corrections.
// IBM Plex Mono — data and state only: timings, counts, statuses, ids.
const display = Fraunces({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-display" });
const body = Newsreader({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-body" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "ShowOnce",
  description: "Learn a physical skill from one expert clip, then get coached through it live.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>
        <a className="skip-link" href="#content">
          Skip to content
        </a>
        <DesktopHooks />
        <main className="site">
          <ShellChrome>{children}</ShellChrome>
        </main>
      </body>
    </html>
  );
}
