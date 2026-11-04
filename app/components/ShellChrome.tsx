"use client";

// Shell chrome: the web top bar on browsers, the desktop rail plus drag
// strip inside Electron. The rail mirrors the app menu (Learn / Library /
// Profile with the same Cmd/Ctrl+1-3 hints), stays honest about the
// connection, and keeps one skip link and one current-section mark either
// way. Also carries the router hooks that answer main-process menu events.

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { isDesktop, shortcutMod } from "./desktop";
import SiteNav, { LINKS } from "./SiteNav";

function sectionTitle(path: string): string {
  if (path === "/") return "Learn";
  if (path === "/skills" || path.startsWith("/skills/")) return "Library";
  if (path === "/profile") return "Profile";
  if (path.startsWith("/coach/")) return "Coach";
  return "ShowOnce";
}

function isActive(path: string, href: string): boolean {
  if (href === "/") return path === "/";
  return path === href || path.startsWith(`${href}/`);
}

export function DesktopHooks() {
  const router = useRouter();
  const path = usePathname();

  useEffect(() => {
    if (!isDesktop() || !window.showonce) return;
    const offNavigate = window.showonce.onNavigate((route) => {
      router.push(route);
    });
    const offImport = window.showonce.onImportClip(() => {
      // The picker lives on Learn: navigate there first when needed, then
      // hand the menu event to the drop zone.
      if (path !== "/") {
        router.push("/");
        window.setTimeout(() => {
          window.dispatchEvent(new CustomEvent("showonce:import-clip"));
        }, 600);
      } else {
        window.dispatchEvent(new CustomEvent("showonce:import-clip"));
      }
    });
    return () => {
      offNavigate();
      offImport();
    };
  }, [router, path]);

  return null;
}

export default function ShellChrome({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const [desktop, setDesktop] = useState(false);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    if (isDesktop()) {
      document.documentElement.classList.add("is-desktop");
      setDesktop(true);
    }
    setOnline(typeof navigator === "undefined" ? true : navigator.onLine);
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  const offlineBar = !online ? (
    <p className="offline-bar" role="status" data-testid="offline-bar">
      <span className="dot" aria-hidden="true" />
      You are offline. Learned skills and the coach stay available on this machine; web lookup
      needs a connection.
    </p>
  ) : null;

  const mod = desktop ? shortcutMod() : null;

  if (desktop) {
    return (
      <div className="desk" data-testid="desktop-shell">
        <aside className="rail" aria-label="Primary">
          <div className="rail-head">
            <Link className="wordmark" href="/">
              ShowOnce
            </Link>
          </div>
          <nav className="rail-nav" aria-label="Sections">
            {LINKS.map((link, i) => (
              <Link
                key={link.href}
                href={link.href}
                aria-current={isActive(path, link.href) ? "page" : undefined}
              >
                {link.label}
                <span className="kbd" aria-hidden="true">
                  {mod}
                  {i + 1}
                </span>
              </Link>
            ))}
          </nav>
          <div className="rail-foot">
            <span className={`conn-line${online ? "" : " is-off"}`} role="status">
              <span className="dot" aria-hidden="true" />
              {online ? "Online" : "Offline"}
            </span>
            <span className="provider-note">Desktop shell</span>
          </div>
        </aside>
        <div className="stage">
          <div className="dtitle" aria-hidden="true">
            <span className="dtitle-doc">{sectionTitle(path)}</span>
          </div>
          <div id="content" className="stage-body">
            {offlineBar}
            {children}
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <header className="topbar">
        <Link className="wordmark" href="/">
          ShowOnce
        </Link>
        <SiteNav />
      </header>
      <div id="content">
        {offlineBar}
        {children}
      </div>
    </>
  );
}
