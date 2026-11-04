#!/usr/bin/env node
// Overlap + overflow audit: loads each route at desktop and phone widths in
// headless Chrome (CDP, one socket per target), focuses the lookup query
// input (the captain's report involves the focused ring), and reports:
//   - horizontal overflow (scrollWidth > innerWidth)
//   - pairwise visual collisions between interactive controls
//     (button/input/select/textarea/linked-a/video), ignoring
//     ancestor/descendant containment (labels wrapping controls on purpose)
// Usage: node scripts/audit-overlap.mjs <base-url> [chrome-remote-port]
import { spawn } from "node:child_process";

const BASE = process.argv[2] ?? "http://127.0.0.1:3102";
const DEBUG_PORT = Number(process.argv[3] ?? 9333);
// No default browser: driving the installed system Chrome is forbidden, so
// CHROME_BIN (a cached headless shell) must be set explicitly.
const CHROME = process.env.CHROME_BIN ?? "";
if (!CHROME) {
  console.error("audit-overlap: set CHROME_BIN to a headless-shell binary (see scripts/smoke-overlap.sh)");
  process.exit(2);
}

const SKILL = process.env.OV_SKILL ?? "";
const ROUTES = ["/", "/skills", "/profile", ...(SKILL ? [`/skills/${SKILL}`, `/coach/${SKILL}`] : [])];
// Second pass with the desktop-shell class the Electron preload sets, so
// shell-only layout rules (.desk grid) get audited too.
const SHELL_CLASS = process.env.OV_SHELL === "1";
// OV_STUB=1 injects the preload's window.showonce flag before page scripts
// run, so the app renders its real desktop rail (.desk) exactly as it does
// inside Electron — the closest headless equivalent of the packaged shell.
const SHELL_STUB = process.env.OV_STUB === "1";
const STUB_JS = `window.showonce = Object.assign(window.showonce || {}, { desktop: true, platform: "darwin", onNavigate: () => () => {}, onImportClip: () => () => {}, onOpenSkills: () => () => {} });`;
const VIEWPORTS = [
  { name: "desktop", w: 1280, h: 900 },
  { name: "phone", w: 390, h: 844 },
];

function socket(url) {
  let id = 0;
  const pending = new Map();
  const ws = new WebSocket(url, { maxPayload: 256 * 1024 * 1024 });
  const ready = new Promise((resolve, reject) => {
    ws.addEventListener("open", () => resolve(), { once: true });
    ws.addEventListener("error", (e) => reject(e), { once: true });
  });
  ws.addEventListener("message", (e) => {
    const msg = JSON.parse(String(e.data));
    if (msg.id !== undefined && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(`${msg.method ?? "?"}: ${JSON.stringify(msg.error)}`));
      else resolve(msg.result);
    }
  });
  return {
    send: async (method, params = {}) => {
      await ready;
      id += 1;
      const cur = id;
      return new Promise((resolve, reject) => {
        pending.set(cur, { resolve, reject });
        ws.send(JSON.stringify({ id: cur, method, params }));
      });
    },
    close: () => ws.close(),
  };
}

async function waitFor(url, pred, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      const j = await res.json();
      const hit = pred(j);
      if (hit) return hit;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`never ready: ${url}`);
}

const AUDIT_JS = `(() => {
  const out = { scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth, els: [] };
  const nodes = [...document.querySelectorAll("button, input, select, textarea, a[href], video")];
  const rects = new Map();
  for (const el of nodes) {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    rects.set(el, r);
    const label = String(el.getAttribute("aria-label") || el.id || (el.textContent || "").trim() || el.className || el.tagName || "").trim().slice(0, 60).replace(/\s+/g, " ");
    out.els.push({ idx: out.els.length, tag: el.tagName.toLowerCase(), label, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) });
  }
  out.contained = [];
  const list = [...rects.keys()];
  for (let i = 0; i < list.length; i++) for (let j = 0; j < list.length; j++) {
    if (i !== j && list[i].contains(list[j])) out.contained.push([i, j]);
  }
  return out;
})()`;

const FOCUS_JS = `(() => {
  const px = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
  const label = (el) => String(el.getAttribute("aria-label") || el.id || (el.textContent || "").trim() || el.tagName || "").trim().slice(0, 60).replace(/\s+/g, " ");
  const faults = [];
  const fields = [...document.querySelectorAll('input[type="text"], input:not([type])')];
  const others = [...document.querySelectorAll("button, select, textarea, a[href]")];
  for (const field of fields) {
    field.focus();
    const cs = getComputedStyle(field);
    if (cs.outlineStyle === "none" || px(cs.outlineWidth) === 0) continue;
    const extent = px(cs.outlineWidth) + px(cs.outlineOffset);
    const r = field.getBoundingClientRect();
    for (const other of others) {
      if (other === field || field.contains(other) || other.contains(field)) continue;
      const o = other.getBoundingClientRect();
      if (o.width < 1 || o.height < 1) continue;
      const ix = Math.min(r.x + r.width, o.x + o.width) - Math.max(r.x, o.x);
      const iy = Math.min(r.y + r.height, o.y + o.height) - Math.max(r.y, o.y);
      if (ix > 0 && iy > 0) continue; // true overlap belongs to the OVERLAP check
      if (ix <= 0 && iy <= 0) continue; // diagonal, no shared edge
      // Gap along the separating axis; the ring must clear it.
      const gap = iy <= 0
        ? (o.y >= r.y ? o.y - (r.y + r.height) : r.y - (o.y + o.height))
        : (o.x >= r.x ? o.x - (r.x + r.width) : r.x - (o.x + o.width));
      if (gap < extent) {
        faults.push({ tag: field.tagName.toLowerCase(), label: label(field), extent: Math.round(extent), otherTag: other.tagName.toLowerCase(), otherLabel: label(other), gap: Math.round(gap) });
      }
    }
  }
  return faults;
})()`;

async function main() {
  const chrome = spawn(CHROME, [
    "--headless",
    "--disable-gpu",
    "--no-sandbox",
    `--remote-debugging-port=${DEBUG_PORT}`,
    "--user-data-dir=/tmp/ov-cdp-profile",
    "about:blank",
  ], { stdio: "ignore" });
  const browserUrl = await waitFor(`http://127.0.0.1:${DEBUG_PORT}/json/version`, (j) => j.webSocketDebuggerUrl);
  const browser = socket(browserUrl);

  let failures = 0;
  try {
  for (const vp of VIEWPORTS) {
    for (const route of ROUTES) {
      const tag = `${vp.name} ${route}`;
      const { targetId } = await browser.send("Target.createTarget", { url: "about:blank" });
      const target = await waitFor(`http://127.0.0.1:${DEBUG_PORT}/json/list`, (list) =>
        (Array.isArray(list) ? list : []).find((t) => t.id === targetId && t.webSocketDebuggerUrl),
      );
      const page = socket(target.webSocketDebuggerUrl);
      await page.send("Page.enable");
      await page.send("Emulation.setDeviceMetricsOverride", {
        width: vp.w, height: vp.h, deviceScaleFactor: 1, mobile: vp.name === "phone",
      });
      if (SHELL_STUB) {
        await page.send("Page.addScriptToEvaluateOnNewDocument", { source: STUB_JS });
      }
      await page.send("Page.navigate", { url: BASE + route });
      await new Promise((r) => setTimeout(r, 3000));
      if (SHELL_CLASS) {
        await page.send("Runtime.evaluate", {
          expression: `document.documentElement.classList.add("is-desktop")`,
        });
        await new Promise((r) => setTimeout(r, 500));
      }
      await page.send("Runtime.evaluate", {
        expression: `(() => { const q = document.querySelector("#web-lookup"); if (q) q.focus(); return !!q; })()`,
      });
      await new Promise((r) => setTimeout(r, 500));
      const evalRes = await page.send("Runtime.evaluate", { expression: AUDIT_JS, returnByValue: true });
      if (!evalRes.result || evalRes.result.value === undefined) {
        console.log(`EVAL-FAIL ${tag}: ${JSON.stringify(evalRes).slice(0, 500)}`);
        failures += 1;
        page.close();
        await browser.send("Target.closeTarget", { targetId });
        continue;
      }
      const audit = evalRes.result.value;
      if (audit.scrollW > audit.innerW + 1) {
        console.log(`OVERFLOW ${tag}: scrollWidth=${audit.scrollW} innerWidth=${audit.innerW}`);
        failures += 1;
      } else {
        console.log(`ok width ${tag} (scrollWidth=${audit.scrollW})`);
      }
      const contained = new Set(audit.contained.map(([a, b]) => `${a}>${b}`));
      const els = audit.els;
      for (let i = 0; i < els.length; i++) {
        for (let j = i + 1; j < els.length; j++) {
          if (contained.has(`${i}>${j}`) || contained.has(`${j}>${i}`)) continue;
          const a = els[i], b = els[j];
          const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
          const iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
          if (ix > 2 && iy > 2) {
            console.log(`OVERLAP ${tag}: <${a.tag} "${a.label}"> [${a.x},${a.y} ${a.w}x${a.h}] x <${b.tag} "${b.label}"> [${b.x},${b.y} ${b.w}x${b.h}] (ix=${ix}, iy=${iy})`);
            failures += 1;
          }
        }
      }
      // Focus-ring clearance: a focused control's outline paints outside
      // its border box, so the box expanded by the outline extent must
      // clear every other control — otherwise the ring is swallowed and
      // the neighbor reads as sitting on top of the field.
      const focusRes = await page.send("Runtime.evaluate", { expression: FOCUS_JS, returnByValue: true });
      const faults = focusRes.result && focusRes.result.value ? focusRes.result.value : [];
      for (const f of faults) {
        console.log(`FOCUS-RING ${tag}: focused <${f.tag} "${f.label}"> ring extends ${f.extent}px but <${f.otherTag} "${f.otherLabel}"> starts ${f.gap}px below its edge`);
        failures += 1;
      }
      page.close();
      await browser.send("Target.closeTarget", { targetId });
    }
  }
  console.log(failures === 0 ? "audit: no overlaps, no overflows" : `audit: ${failures} finding(s)`);
  process.exitCode = failures === 0 ? 0 : 1;
  } finally {
    browser.close();
    chrome.kill();
  }
}

main().catch((e) => {
  console.error(`audit failed: ${e.message}`);
  process.exit(2);
});
