import type { Metadata } from "next";
import { Anton, IBM_Plex_Mono, Newsreader } from "next/font/google";
import "./globals.css";

// Type pairing (each family has a job, never a single identity):
// Anton — condensed poster display for headlines and step numerals.
// Newsreader — refined serif for reading: instructions, labels, corrections.
// IBM Plex Mono — data and state only: timings, counts, statuses, ids.
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
        <main className="site">
          <header className="topbar">
            <a className="wordmark" href="/">
              SHOW<b>ONCE</b>
            </a>
            <nav className="sitenav" aria-label="Sections">
              <a href="/">Learn</a>
              <a href="/skills">Library</a>
              <a href="/profile">Profile</a>
            </nav>
          </header>
          {children}
        </main>
      </body>
    </html>
  );
}
