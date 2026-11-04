import type { NextConfig } from "next";

// Skill display assets live under public/skills/<skillId>/, but a
// production server only serves the public files present at boot. These
// rewrites run before filesystem lookup in dev and prod, so a freshly
// learned skill's clip, keyframes, and references play immediately.
// The Electron desktop shell runs this same app from a bundled server, so
// keep the build self-contained: the standalone trace lets the packaged
// app start with `node .next/standalone/server.js` and no dev install.
// The desktop packager writes dist/ inside the project, and the trace
// root is the project: without this exclusion each packaged build nests
// the previous dist/ output inside the next standalone server (gigabytes
// deep and codesign-fatal). Normal web builds never notice.
const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingExcludes: {
    "*": ["./dist/**/*"],
  },
  async rewrites() {
    return [
      { source: "/skills/:id/clip.mp4", destination: "/api/skill-assets/:id/clip.mp4" },
      { source: "/skills/:id/keyframes/:file", destination: "/api/skill-assets/:id/keyframes/:file" },
      {
        source: "/skills/:id/references/:file",
        destination: "/api/skill-assets/:id/references/:file",
      },
    ];
  },
};

export default nextConfig;
