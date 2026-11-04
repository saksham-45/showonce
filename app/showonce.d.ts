// Typed surface of the Electron preload bridge (`electron/preload.js`).
// Browsers have no `window.showonce`; every desktop-only call site must
// guard with `isDesktop()` from `./desktop` first.

interface ShowonceDesktopBridge {
  readonly desktop: true;
  readonly platform: NodeJS.Platform | string;
  onNavigate: (listener: (route: string) => void) => () => void;
  onImportClip: (listener: () => void) => () => void;
}

interface Window {
  showonce?: ShowonceDesktopBridge;
}
