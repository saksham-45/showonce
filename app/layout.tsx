import type { Metadata } from "next";
import { Anton, IBM_Plex_Mono, Newsreader } from "next/font/google";
import "./globals.css";

// Type pairing (each family has a job, never a single identity):
// Anton — condensed poster display for headlines and step numerals.
// Newsreader — refined serif for reading: instructions, corrections.
// IBM Plex Mono — data labels: timings, statuses, kickers.
const display = Anton({ subsets: ["latin"], weight: "400", variable: "--font-display" });
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
        <main className="site">{children}</main>
      </body>
    </html>
  );
}
