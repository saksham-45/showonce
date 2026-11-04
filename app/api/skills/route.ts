import { NextResponse } from "next/server";
import { createSkill, listSkills } from "@/lib/store";

// Cap upload bytes so oversized files fail fast here instead of
// mid-pipeline. Clip length is free: extraction reduces any duration to the
// fixed model frame budget.
const MAX_CLIP_BYTES = 200 * 1024 * 1024;

export async function GET() {
  return NextResponse.json({ skills: await listSkills() });
}

export async function POST(request: Request) {
  const form = await request.formData();
  const clip = form.get("clip");
  const title = String(form.get("title") ?? "Untitled skill");
  if (!(clip instanceof File) || clip.size === 0) {
    return NextResponse.json({ error: "Upload a clip file as 'clip'." }, { status: 400 });
  }
  if (clip.size > MAX_CLIP_BYTES) {
    return NextResponse.json({ error: "Clip exceeds the 200 MB limit." }, { status: 413 });
  }
  if (clip.type && !clip.type.startsWith("video/")) {
    return NextResponse.json({ error: `Upload a video clip, not '${clip.type}'.` }, { status: 400 });
  }
  const skillId = await createSkill(Buffer.from(await clip.arrayBuffer()), title);
  return NextResponse.json({ skillId });
}
