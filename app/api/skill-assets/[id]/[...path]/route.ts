import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { dataRoot } from "@/lib/store";

// Serve skill display assets (clip, keyframes, reference images) from disk.
//
// The files live under public/skills/<skillId>/, but a production server
// only serves the public files present at boot: a freshly learned skill's
// clip and images 404 until restart. next.config rewrites route those same
// /skills/<id>/... URLs here, so new skills play immediately in dev and
// prod alike. Only the display assets the pages need are exposed; transcripts,
// masks, and graphs stay behind their API routes.

const CONTENT_TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
};

function assetPath(skillId: string, parts: string[]): string | null {
  if (typeof skillId !== "string" || skillId.length === 0) return null;
  if (parts.length === 0 || parts.some((part) => part.length === 0)) return null;
  const [head, ...rest] = parts;
  const ok =
    (head === "clip.mp4" && rest.length === 0) ||
    ((head === "keyframes" || head === "references") &&
      rest.length === 1 &&
      (rest[0].endsWith(".jpg") || rest[0].endsWith(".png")));
  if (!ok) return null;
  const resolved = path.resolve(dataRoot(), skillId, ...parts);
  if (!resolved.startsWith(path.resolve(dataRoot(), skillId) + path.sep)) return null;
  return resolved;
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; path: string[] }> }) {
  const { id, path: parts } = await params;
  const filePath = assetPath(id, parts ?? []);
  if (!filePath) {
    return NextResponse.json({ error: "Unknown skill asset." }, { status: 404 });
  }
  try {
    const bytes = await fs.readFile(filePath);
    return new NextResponse(new Uint8Array(bytes), {
      headers: { "Content-Type": CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream" },
    });
  } catch {
    return NextResponse.json({ error: "Unknown skill asset." }, { status: 404 });
  }
}
