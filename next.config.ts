import type { NextConfig } from "next";

// Skill display assets live under public/skills/<skillId>/, but a
// production server only serves the public files present at boot. These
// rewrites run before filesystem lookup in dev and prod, so a freshly
// learned skill's clip, keyframes, and references play immediately.
const nextConfig: NextConfig = {
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
