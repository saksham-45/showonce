import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { runLearnPipeline } from "@/lib/pipeline";
import { skillDir } from "@/lib/store";

export const maxDuration = 300;

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let title = "Untitled skill";
  try {
    const meta = JSON.parse(await fs.readFile(path.join(skillDir(id), "meta.json"), "utf8")) as { title: string };
    title = meta.title;
  } catch {
    return NextResponse.json({ error: "Unknown skill id." }, { status: 404 });
  }
  try {
    const graph = await runLearnPipeline(id, title);
    return NextResponse.json(graph);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Pipeline failed.";
    const clientError =
      message.includes("META_API_KEY") ||
      message.includes("not valid video") ||
      message.includes("no frames");
    return NextResponse.json({ error: message }, { status: clientError ? 400 : 500 });
  }
}
