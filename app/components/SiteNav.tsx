"use client";

// Section nav with an honest current-page mark. Client-side on purpose:
// the active section depends on the pathname, which only the browser
// knows at render time.

import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Learn" },
  { href: "/skills", label: "Library" },
  { href: "/profile", label: "Profile" },
];

function isActive(path: string, href: string): boolean {
  if (href === "/") return path === "/";
  return path === href || path.startsWith(`${href}/`);
}

export default function SiteNav() {
  const path = usePathname();
  return (
    <nav className="sitenav" aria-label="Sections">
      {LINKS.map((link) => (
        <a
          key={link.href}
          href={link.href}
          aria-current={isActive(path, link.href) ? "page" : undefined}
        >
          {link.label}
        </a>
      ))}
    </nav>
  );
}
