import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "ShowOnce",
  description: "Learn a physical skill from one expert clip, then get coached through it live.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "-apple-system, 'Segoe UI', Helvetica, Arial, sans-serif",
          margin: 0,
          color: "#1a1a1a",
          background: "#fff",
          lineHeight: 1.5,
        }}
      >
        <main style={{ maxWidth: 860, margin: "0 auto", padding: "32px 20px 64px" }}>{children}</main>
      </body>
    </html>
  );
}
