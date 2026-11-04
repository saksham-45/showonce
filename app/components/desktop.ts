// Desktop-only helpers. Every export no-ops in a plain browser so the
// same app code runs on the web and in the Electron shell.

export function isDesktop(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.showonce !== "undefined" &&
    window.showonce.desktop === true
  );
}

export function desktopPlatform(): string | undefined {
  if (!isDesktop()) return undefined;
  return window.showonce?.platform;
}

export function shortcutMod(): string {
  return desktopPlatform() === "darwin" ? "\u2318" : "Ctrl";
}

// Native notification through the host OS (Electron maps the Web
// Notification API to Notification Center / Action Center). Silent
// everywhere else: call sites never branch on their own.
export async function notifyDesktop(title: string, body: string): Promise<void> {
  if (!isDesktop()) return;
  if (typeof window === "undefined" || !("Notification" in window)) return;
  try {
    if (Notification.permission === "default") {
      await Notification.requestPermission().catch(() => {});
    }
    if (Notification.permission !== "granted") return;
    new Notification(title, { body });
  } catch {
    // A denied or headless host simply stays quiet.
  }
}

// Best-effort permission priming from a user gesture (coach start, learn
// run) so completion notices later are allowed to appear.
export async function primeDesktopNotifications(): Promise<void> {
  if (!isDesktop()) return;
  if (typeof window === "undefined" || !("Notification" in window)) return;
  try {
    if (Notification.permission === "default") {
      await Notification.requestPermission().catch(() => {});
    }
  } catch {
    // Ignore: later notices will no-op.
  }
}
