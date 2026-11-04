// Preload runs before the Next.js page in an isolated world: it exposes
// only a tiny read-only bridge, never Node or Electron internals.
const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("showonce", {
  desktop: true,
});
