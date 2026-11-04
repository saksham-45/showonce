// ShowOnce desktop shell: the same Next.js app in a window for macOS and
// Windows. Dev loads the local `next dev` server; a packaged build starts
// the bundled standalone server on 127.0.0.1 and loads that, so Learn,
// Coach, and lookup work offline from the app like they do in the browser.
//
// Data dir: the default skill root (public/skills) is read-only once
// packaged, so the shell points SHOWNCE_DATA_DIR at the per-user app data
// folder unless it is already set.
//
// Smoke mode (`--showonce-smoke` or SHOWNCE_ELECTRON_SMOKE=1): boot the
// server, GET /api/skills, print the result, and exit without opening a
// window. scripts/smoke-electron.sh drives the packaged app this way.

const { app, BrowserWindow } = require("electron");
const { fork } = require("node:child_process");
const net = require("node:net");
const path = require("node:path");

const DEV_URL = process.env.ELECTRON_DEV_URL || "http://localhost:3000";
const SMOKE =
  process.argv.includes("--showonce-smoke") || process.env.SHOWNCE_ELECTRON_SMOKE === "1";

function standaloneDir() {
  if (app.isPackaged) return path.join(process.resourcesPath, "standalone");
  return path.join(__dirname, "..", ".next", "standalone");
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

function createWindow(url) {
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: "ShowOnce",
    backgroundColor: "#0a1428",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
    },
  });
  window.loadURL(url).catch((err) => {
    console.error(`Could not load ${url}: ${err.message}`);
  });
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
  const base = app.isPackaged ? await startBundledServer().catch((err) => null) : DEV_URL;
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

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
