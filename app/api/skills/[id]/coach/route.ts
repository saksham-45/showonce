import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { compareSkillFrame } from "@/lib/coach";
import { isSkillGraph } from "@/lib/skillgraph";
import { skillDir } from "@/lib/store";

// POST /api/skills/[id]/coach — judge one live frame against one step.
// Body: { stepId: string, frame: string } where frame is a data URL
// (data:image/jpeg;base64,...) or bare base64. Returns
// { verdict: correct|nudge|wrong, correction: string, advance: boolean }.
function frameToBytes(frame: unknown): Buffer | null {
  if (typeof frame !== "string" || frame.length === 0) return null;
  const comma = frame.indexOf(",");
  const encoded = comma >= 0 ? frame.slice(comma + 1) : frame;
  try {
    const bytes = Buffer.from(encoded, "base64");
    return bytes.length > 0 ? bytes : null;
  } catch {
    return null;
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let body: { stepId?: unknown; frame?: unknown };
  try {
    body = (await request.json()) as { stepId?: unknown; frame?: unknown };
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }
  if (typeof body.stepId !== "string" || body.stepId.length === 0) {
    return NextResponse.json({ error: "Missing stepId." }, { status: 400 });
  }

  let graph: unknown;
  try {
    const raw = await fs.readFile(path.join(skillDir(id), "skill-graph.json"), "utf8");
    graph = JSON.parse(raw) as unknown;
  } catch {
    return NextResponse.json({ error: "Unknown skill id." }, { status: 404 });
  }
  if (!isSkillGraph(graph)) {
    return NextResponse.json({ error: "Stored skill graph is invalid." }, { status: 500 });
  }
  const step = graph.steps.find((candidate) => candidate.id === body.stepId);
  if (!step) {
    return NextResponse.json({ error: "Unknown step for this skill." }, { status: 400 });
  }

  let referenceBytes: Buffer | null = null;
  try {
    referenceBytes = await fs.readFile(path.join(skillDir(id), step.referenceImage));
  } catch {
    referenceBytes = null;
  }

  const result = await compareSkillFrame({
    step,
    frameBytes: frameToBytes(body.frame),
    referenceBytes,
    apiBase: process.env.META_API_BASE ?? "https://api.meta.ai/v1",
    apiKey: process.env.META_API_KEY ?? null,
  });
  return NextResponse.json(result);
}
