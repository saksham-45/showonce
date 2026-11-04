// Preload runs before the Next.js page in an isolated world: it exposes
// a tiny typed desktop bridge — identity, platform, and the two menu
// channels (section navigation, clip import) — never Node or Electron
// internals.
const { contextBridge, ipcRenderer } = require("electron");

function subscribe(channel, listener) {
  const handler = (_event, payload) => listener(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld("showonce", {
  desktop: true,
  platform: process.platform,
  onNavigate: (listener) => subscribe("showonce:navigate", listener),
  onImportClip: (listener) => subscribe("showonce:import-clip", listener),
});
