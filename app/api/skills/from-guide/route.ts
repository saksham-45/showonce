import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { StubProvider } from "@/lib/providers";
import { isSkillGraph, type SkillStep } from "@/lib/skillgraph";
import { createGuideSkill, skillDir } from "@/lib/store";

// POST /api/skills/from-guide — save a web-lookup guide as a skill so the
// existing Learn/Coach loop can coach it. Body: { title, guide } where
// guide is a WebGuide (videos/articles/steps/sources from /api/lookup).
// Guide skills carry placeholder keyframe/reference art (no clip frames to
// copy) and persist the guide itself as guide.json for cited sources.

const MAX_TEXT = 2000;

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function cleanLinks(value: unknown, withSnippet: boolean) {
  if (!Array.isArray(value)) return [];
  const out: { title: string; url: string; snippet?: string }[] = [];
  for (const candidate of value.slice(0, 10)) {
    if (typeof candidate !== "object" || candidate === null) continue;
    const link = candidate as Record<string, unknown>;
    if (typeof link.title !== "string" || !isHttpUrl(link.url)) continue;
    const entry: { title: string; url: string; snippet?: string } = {
      title: link.title.slice(0, 300),
      url: link.url as string,
    };
    if (withSnippet && typeof link.snippet === "string") entry.snippet = link.snippet.slice(0, 1000);
    out.push(entry);
  }
  return out;
}

export async function POST(request: Request) {
  let body: { title?: unknown; guide?: unknown };
  try {
    body = (await request.json()) as { title?: unknown; guide?: unknown };
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) {
    return NextResponse.json({ error: "Give the guide skill a title." }, { status: 400 });
  }
  if (typeof body.guide !== "object" || body.guide === null) {
    return NextResponse.json({ error: "Save a lookup result: the request needs a 'guide'." }, { status: 400 });
  }
  const guide = body.guide as Record<string, unknown>;
  if (!Array.isArray(guide.steps) || guide.steps.length === 0 || guide.steps.length > 8) {
    return NextResponse.json({ error: "A guide skill needs 1–8 steps." }, { status: 400 });
  }
  const drafts: { instruction: string; checkpoint: string; mistakes: string[] }[] = [];
  for (const candidate of guide.steps) {
    if (typeof candidate !== "object" || candidate === null) {
      return NextResponse.json({ error: "Every guide step needs an instruction and a checkpoint." }, { status: 400 });
    }
    const step = candidate as Record<string, unknown>;
    if (typeof step.instruction !== "string" || step.instruction.trim().length === 0) {
      return NextResponse.json({ error: "Every guide step needs an instruction and a checkpoint." }, { status: 400 });
    }
    if (typeof step.checkpoint !== "string" || step.checkpoint.trim().length === 0) {
      return NextResponse.json({ error: "Every guide step needs an instruction and a checkpoint." }, { status: 400 });
    }
    const mistakes = Array.isArray(step.mistakes)
      ? step.mistakes.filter((m): m is string => typeof m === "string").map((m) => m.slice(0, 300))
      : [];
    drafts.push({
      instruction: step.instruction.slice(0, MAX_TEXT),
      checkpoint: step.checkpoint.slice(0, MAX_TEXT),
      mistakes: mistakes.slice(0, 4),
    });
  }
  const summary = typeof guide.summary === "string" ? guide.summary.slice(0, MAX_TEXT) : "";
  const query = typeof guide.query === "string" ? guide.query.slice(0, 140) : title;
  const videos = cleanLinks(guide.videos, false);
  const articles = cleanLinks(guide.articles, true);
  const sources = cleanLinks(guide.sources, false);
  if (videos.length === 0 && articles.length === 0 && sources.length === 0) {
    return NextResponse.json({ error: "A guide skill needs at least one cited source." }, { status: 400 });
  }
  const skillId = await createGuideSkill(title.slice(0, 200));
  const dir = skillDir(skillId);
  // No clip frames exist for a guide skill, so both display images come
  // from the deterministic placeholder renderer — same bytes the pipeline
  // stub path uses, served by the existing skill-assets route.
  const art = new StubProvider(1);
  const steps: SkillStep[] = [];
  for (let i = 0; i < drafts.length; i++) {
    // The placeholder renderer only reads id/instruction/checkpoint; the
    // keyframe slot is filled in below once the asset files are written.
    const draft = { id: `step-${i + 1}`, keyframe: "", ...drafts[i] };
    const bytes = await art.referenceImage(draft);
    await fs.writeFile(path.join(dir, "references", `${draft.id}.png`), bytes);
    await fs.writeFile(path.join(dir, "keyframes", `${draft.id}.png`), bytes);
    steps.push({ ...draft, keyframe: `keyframes/${draft.id}.png`, referenceImage: `references/${draft.id}.png` });
  }
  const graph = {
    version: 1,
    skillId,
    title: title.slice(0, 200),
    clipDurationSeconds: 0,
    transcript: { segments: [] },
    steps,
  };
  if (!isSkillGraph(graph)) {
    return NextResponse.json({ error: "Guide steps failed validation." }, { status: 400 });
  }
  await fs.writeFile(path.join(dir, "skill-graph.json"), JSON.stringify(graph, null, 2));
  await fs.writeFile(
    path.join(dir, "guide.json"),
    JSON.stringify({ query, summary, videos, articles, sources, via: guide.via ?? "web", savedAt: new Date().toISOString() }, null, 2),
  );
  return NextResponse.json({ skillId });
}
