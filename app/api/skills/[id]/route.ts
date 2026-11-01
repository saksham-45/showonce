import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { isSkillGraph } from "@/lib/skillgraph";
import { skillDir } from "@/lib/store";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const raw = await fs.readFile(path.join(skillDir(id), "skill-graph.json"), "utf8");
    const graph = JSON.parse(raw) as unknown;
    if (!isSkillGraph(graph)) {
      return NextResponse.json({ error: "Stored skill graph is invalid." }, { status: 500 });
    }
    return NextResponse.json(graph);
  } catch {
    return NextResponse.json({ skillId: id, status: "not-run" }, { status: 404 });
  }
}
