import { NextResponse } from "next/server";
import { createSkill, listSkills } from "@/lib/store";

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
  const skillId = await createSkill(Buffer.from(await clip.arrayBuffer()), title);
  return NextResponse.json({ skillId });
}
