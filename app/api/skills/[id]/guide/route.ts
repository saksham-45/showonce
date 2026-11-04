import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { skillDir } from "@/lib/store";

// GET /api/skills/[id]/guide — the cited web sources behind a guide skill
// (videos, articles, summary), persisted at save time by from-guide.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const raw = await fs.readFile(path.join(skillDir(id), "guide.json"), "utf8");
    return NextResponse.json(JSON.parse(raw) as unknown);
  } catch {
    return NextResponse.json({ error: "No web guide for this skill." }, { status: 404 });
  }
}
