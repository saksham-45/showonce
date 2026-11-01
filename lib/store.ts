import { createHash, randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

// Per-skill persistence. Layout under <root>/skills/<skillId>/:
//   clip.mp4, audio.wav, frames/frame-NNNN.jpg, keyframes/<step>.jpg,
//   masks/<frame>.json, transcript.json, skill-graph.json, references/<step>.png
// The root defaults to public/skills so the app can serve clips and images
// as static assets; SHOWNCE_DATA_DIR overrides it (used by proof runs).

export function dataRoot(): string {
  return process.env.SHOWNCE_DATA_DIR ?? path.join(process.cwd(), "public", "skills");
}

export function skillDir(skillId: string): string {
  return path.join(dataRoot(), skillId);
}

export function newSkillId(): string {
  return randomBytes(8).toString("hex");
}

export async function createSkill(clipBytes: Buffer, title: string): Promise<string> {
  const skillId = newSkillId();
  const dir = skillDir(skillId);
  await fs.mkdir(path.join(dir, "frames"), { recursive: true });
  await fs.mkdir(path.join(dir, "keyframes"), { recursive: true });
  await fs.mkdir(path.join(dir, "masks"), { recursive: true });
  await fs.mkdir(path.join(dir, "references"), { recursive: true });
  await fs.writeFile(path.join(dir, "clip.mp4"), clipBytes);
  await fs.writeFile(path.join(dir, "meta.json"), JSON.stringify({ skillId, title, createdAt: new Date().toISOString() }, null, 2));
  return skillId;
}

export async function listSkills(): Promise<{ skillId: string; title: string }[]> {
  const root = dataRoot();
  let entries: string[] = [];
  try {
    entries = await fs.readdir(root);
  } catch {
    return [];
  }
  const skills: { skillId: string; title: string }[] = [];
  for (const entry of entries) {
    try {
      const raw = await fs.readFile(path.join(root, entry, "meta.json"), "utf8");
      const meta = JSON.parse(raw) as { skillId: string; title: string };
      skills.push({ skillId: meta.skillId, title: meta.title });
    } catch {
      continue;
    }
  }
  return skills;
}

export function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}
