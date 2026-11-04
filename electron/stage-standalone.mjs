// Stage the standalone server for `npm start` and for packaging:
// `next build` traces only the JS it needs, so public assets and the static
// bundle are copied in beside server.js exactly as the Next.js standalone
// docs describe. Idempotent; safe to run after every build.
import { cpSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const standalone = path.join(root, ".next", "standalone");

if (!existsSync(path.join(standalone, "server.js"))) {
  console.error("stage-standalone: .next/standalone/server.js is missing — is next.config.ts output 'standalone'?");
  process.exit(1);
}
// Fresh clones have no public/ (git tracks no empty dirs and
// /public/skills is gitignored), so a missing source means "nothing to
// copy", never a failure — the server creates skill dirs on demand.
for (const [src, dest] of [
  [path.join(root, "public"), path.join(standalone, "public")],
  [path.join(root, ".next", "static"), path.join(standalone, ".next", "static")],
]) {
  if (existsSync(src)) {
    cpSync(src, dest, { recursive: true });
  } else {
    mkdirSync(dest, { recursive: true });
  }
}
// The trace prunes node_modules to statically referenced files, but app
// routes load their server runtime through a dynamic require (e.g.
// next/dist/compiled/next-server/app-route-turbo.runtime.prod.js), which the
// trace drops — and the packaged app has no parent node_modules to fall back
// to. Overlay the full runtime frameworks so the bundled server resolves
// exactly what `next start` resolves in development.
for (const pkg of ["next", "react", "react-dom"]) {
  cpSync(path.join(root, "node_modules", pkg), path.join(standalone, "node_modules", pkg), { recursive: true });
}
console.log(`stage-standalone: staged ${standalone}`);
