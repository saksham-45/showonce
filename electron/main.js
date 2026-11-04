// ShowOnce desktop shell: the same Next.js app in a native-feeling window
// for macOS and Windows. Dev loads the local `next dev` server; a packaged
// build starts the bundled standalone server on 127.0.0.1 and loads that,
// so Learn, Coach, and lookup work offline from the app like they do in the
// browser.
//
// Native behavior lives here: a hidden title bar with platform window
// controls (traffic lights on macOS, overlay controls on Windows), a real
// app menu with section shortcuts, a loading page while the server boots,
// single-instance focus, and window-bounds persistence across launches.
//
// Data dir: the default skill root (public/skills) is read-only once
// packaged, so the shell points SHOWNCE_DATA_DIR at the per-user app data
// folder unless it is already set.
//
// Smoke mode (`--showonce-smoke` or SHOWNCE_ELECTRON_SMOKE=1): boot the
// server, GET /api/skills, print the result, and exit without opening a
// window. scripts/smoke-electron.sh drives the packaged app this way.

const { app, BrowserWindow, Menu, screen, shell } = require("electron");
const { fork } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");

const DEV_URL = process.env.ELECTRON_DEV_URL || "http://localhost:3000";
const SMOKE =
  process.argv.includes("--showonce-smoke") || process.env.SHOWNCE_ELECTRON_SMOKE === "1";

app.setAboutPanelOptions({
  applicationName: "ShowOnce",
  applicationVersion: app.getVersion(),
  copyright: "Copyright © 2026 ShowOnce",
  credits: "Learn any physical skill from one video, then get coached live.",
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

function standaloneDir() {
  if (app.isPackaged) return path.join(process.resourcesPath, "standalone");
  return path.join(__dirname, "..", ".next", "standalone");
}

function loadingPage() {
  return path.join(__dirname, "loading.html");
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 3000;
      server.close(() => resolve(port));
    });
  });
}

function waitForServer(url, timeoutMs) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      fetch(url)
        .then((res) => {
          if (res.ok || res.status === 404) return resolve(url);
          throw new Error(`HTTP ${res.status}`);
        })
        .catch((err) => {
          if (Date.now() - startedAt > timeoutMs) return reject(err);
          setTimeout(attempt, 500);
        });
    };
    attempt();
  });
}

async function startBundledServer() {
  const dir = standaloneDir();
  const port = await freePort();
  if (!process.env.SHOWNCE_DATA_DIR) {
    process.env.SHOWNCE_DATA_DIR = path.join(app.getPath("userData"), "skills");
  }
  // The bundled server needs a plain Node runtime, but the packaged app
  // ships only the Electron binary: ELECTRON_RUN_AS_NODE makes that same
  // binary run server.js as Node instead of opening a second app window.
  const child = fork(path.join(dir, "server.js"), {
    cwd: dir,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", PORT: String(port), HOSTNAME: "127.0.0.1" },
    silent: true,
  });
  child.stdout?.on("data", (chunk) => process.stdout.write(`[next] ${chunk}`));
  child.stderr?.on("data", (chunk) => process.stderr.write(`[next] ${chunk}`));
  child.once("exit", (code) => {
    if (!app.isReady() || SMOKE) return;
    console.error(`Bundled Next.js server exited with code ${code}.`);
  });
  app.once("before-quit", () => {
    try {
      child.kill();
    } catch {
      // Already gone; quitting anyway.
    }
  });
  const url = `http://127.0.0.1:${port}`;
  await waitForServer(`${url}/api/skills`, 45_000);
  return url;
}

// Window-state persistence: remember bounds across launches. A stale save
// from an unplugged monitor falls back to a centered default instead of
// opening off-screen.
function stateFile() {
  return path.join(app.getPath("userData"), "showonce-window.json");
}

function loadWindowState() {
  const fallback = { width: 1180, height: 780, maximized: false };
  let saved = null;
  try {
    saved = JSON.parse(fs.readFileSync(stateFile(), "utf8"));
  } catch {
    return fallback;
  }
  const sane = (v) => typeof v === "number" && Number.isFinite(v);
  if (!saved || !sane(saved.width) || !sane(saved.height)) return fallback;
  const width = Math.min(Math.max(Math.round(saved.width), 960), 3840);
  const height = Math.min(Math.max(Math.round(saved.height), 640), 2160);
  const state = { width, height, maximized: saved.maximized === true };
  if (sane(saved.x) && sane(saved.y)) {
    const point = { x: Math.round(saved.x), y: Math.round(saved.y) };
    try {
      const display = screen.getDisplayNearestPoint(point);
      const area = display.workArea;
      const inside =
        point.x >= area.x &&
        point.x < area.x + area.width &&
        point.y >= area.y &&
        point.y < area.y + area.height;
      if (inside) {
        state.x = point.x;
        state.y = point.y;
      }
    } catch {
      // No displays to check (headless smoke): float centered.
    }
  }
  return state;
}

function saveWindowState(window) {
  if (!window || window.isDestroyed()) return;
  try {
    const bounds = window.getBounds();
    fs.writeFileSync(
      stateFile(),
      JSON.stringify({ ...bounds, maximized: window.isMaximized() }),
    );
  } catch {
    // A failed save must never block quitting.
  }
}

function sendNavigate(window, route) {
  if (window && !window.isDestroyed()) {
    window.webContents.send("showonce:navigate", route);
  }
}

function buildMenu(window) {
  const navigate = (route) => () => sendNavigate(window, route);
  const importClip = () => {
    if (window && !window.isDestroyed()) {
      window.webContents.send("showonce:import-clip");
    }
  };

  const macAppMenu = {
    label: app.name,
    submenu: [
      { role: "about" },
      { type: "separator" },
      { role: "services" },
      { type: "separator" },
      { role: "hide" },
      { role: "hideOthers" },
      { role: "unhide" },
      { type: "separator" },
      { role: "quit" },
    ],
  };

  const template = [
    ...(process.platform === "darwin" ? [macAppMenu] : []),
    {
      label: "File",
      submenu: [
        {
          label: "Import Expert Clip…",
          accelerator: "CmdOrCtrl+O",
          click: importClip,
        },
        { type: "separator" },
        process.platform === "darwin" ? { role: "close" } : { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { label: "Learn", accelerator: "CmdOrCtrl+1", click: navigate("/") },
        { label: "Library", accelerator: "CmdOrCtrl+2", click: navigate("/skills") },
        { label: "Profile", accelerator: "CmdOrCtrl+3", click: navigate("/profile") },
        { type: "separator" },
        { role: "reload" },
        { role: "forceReload" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        ...(process.platform === "darwin"
          ? [{ role: "front" }, { type: "separator" }, { role: "window" }]
          : [{ role: "close" }]),
      ],
    },
    {
      label: "Help",
      submenu: [
        {
          label: "ShowOnce Help",
          click: () => {
            shell.openExternal("https://github.com/saksham-45/showonce").catch(() => {});
          },
        },
        ...(process.platform === "darwin" ? [] : [{ type: "separator" }, { role: "about" }]),
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow(url) {
  const saved = loadWindowState();
  const isMac = process.platform === "darwin";
  const window = new BrowserWindow({
    ...saved,
    ...(saved.x !== undefined ? { x: saved.x, y: saved.y } : {}),
    minWidth: 960,
    minHeight: 640,
    title: "ShowOnce",
    backgroundColor: "#ffffff",
    // Native chrome without the browser look: macOS keeps its traffic
    // lights in a hidden bar; Windows draws overlay caption buttons into
    // the drag strip the renderer provides.
    ...(isMac
      ? { titleBarStyle: "hidden", trafficLightPosition: { x: 14, y: 12 } }
      : {}),
    ...(!isMac ? { titleBarOverlay: { color: "#f4f4f5", symbolColor: "#141416", height: 40 } } : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
    },
  });
  if (saved.maximized) window.maximize();
  buildMenu(window);
  // A local loading page covers the boot gap so the window never flashes
  // a blank viewport while the bundled server warms up.
  window.loadFile(loadingPage()).catch(() => {});
  window.webContents.on("did-fail-load", (_event, code, desc, failedUrl) => {
    if (failedUrl === url) {
      window.loadFile(loadingPage(), { query: { error: "unreachable" } }).catch(() => {});
    }
  });
  window.loadURL(url).catch((err) => {
    console.error(`Could not load ${url}: ${err.message}`);
    window.loadFile(loadingPage(), { query: { error: "unreachable" } }).catch(() => {});
  });
  window.on("resize", () => saveWindowState(window));
  window.on("move", () => saveWindowState(window));
  window.on("close", () => saveWindowState(window));
  return window;
}

app.whenReady().then(async () => {
  if (SMOKE) {
    // Packaged launch proof without a window: boot and hit the API, plus
    // one app route (dynamic server runtime) and the home page. Any HTTP
    // status from those two proves the bundled chunks load — only a crash
    // or a hanging server fails the smoke.
    try {
      const base = app.isPackaged ? await startBundledServer() : DEV_URL;
      const target = app.isPackaged ? base : DEV_URL;
      const skillsUrl = await waitForServer(`${target}/api/skills`, 45_000);
      console.log(`electron-smoke ok GET ${skillsUrl}`);
      const lookupRes = await fetch(`${target}/api/lookup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "fold a paper airplane" }),
      });
      await lookupRes.text().catch(() => {});
      // 200 stub answer, 400 no-key meta guard, 502 meta failure: all prove
      // the route module loads. A 500 would mean a bundled chunk crashed.
      if (![200, 400, 502].includes(lookupRes.status)) {
        throw new Error(`POST /api/lookup answered HTTP ${lookupRes.status}.`);
      }
      console.log(`electron-smoke ok POST /api/lookup (HTTP ${lookupRes.status})`);
      const homeRes = await fetch(`${target}/`);
      await homeRes.text().catch(() => {});
      if (homeRes.status !== 200) throw new Error(`GET / answered HTTP ${homeRes.status}.`);
      console.log("electron-smoke ok GET /");
      app.exit(0);
    } catch (err) {
      console.error(`electron-smoke FAIL ${err instanceof Error ? err.message : err}`);
      app.exit(1);
    }
    return;
  }
  const base = app.isPackaged ? await startBundledServer().catch(() => null) : DEV_URL;
  if (!base) {
    console.error("Bundled server did not start; quitting.");
    app.quit();
    return;
  }
  createWindow(base);
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(base);
  });
});

app.on("second-instance", () => {
  const window = BrowserWindow.getAllWindows()[0];
  if (window) {
    if (window.isMinimized()) window.restore();
    window.focus();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
