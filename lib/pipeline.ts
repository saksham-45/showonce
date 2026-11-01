import { promises as fs } from "node:fs";
import path from "node:path";
import { loadConfig } from "./config";
import { extractMedia } from "./extract";
import { MetaProvider, StubProvider, type LearnProvider } from "./providers";
import { isSkillGraph, type SkillGraph } from "./skillgraph";
import { skillDir } from "./store";

// Run the Learn pipeline for one skill: extract, segment, transcribe, fuse,
// generate reference images, persist the skill-graph JSON + assets.
export async function runLearnPipeline(skillId: string, title: string): Promise<SkillGraph> {
  const config = loadConfig();
  const dir = skillDir(skillId);

  let provider: LearnProvider;
  if (config.provider === "stub") {
    provider = new StubProvider();
  } else {
    if (!config.apiKey) {
      throw new Error(
        "Learn pipeline needs META_API_KEY (or set SHOWNCE_PROVIDER=stub for local proof). Put the key in the META_API_KEY environment variable or .env.local; it is never committed.",
      );
    }
    provider = new MetaProvider(config.apiBase, config.apiKey);
  }

  const { frames, audioPath, durationSeconds } = await extractMedia(dir, config.framesPerSecond);
  if (frames.length === 0) {
    throw new Error("Frame extraction produced no frames; is the uploaded clip valid video?");
  }

  const segmentations = await provider.segmentFrames(frames, path.join(dir, "frames"));
  for (const seg of segmentations) {
    await fs.writeFile(path.join(dir, "masks", `${path.parse(seg.frame).name}.json`), JSON.stringify(seg, null, 2));
  }

  const transcript = await provider.transcribe(audioPath);
  await fs.writeFile(path.join(dir, "transcript.json"), JSON.stringify(transcript, null, 2));

  const fused = await provider.fuse({ title, durationSeconds, frames, segmentations, transcript });

  const steps = [];
  for (const draft of fused.steps) {
    const referenceBytes = await provider.referenceImage(draft);
    const referenceName = `${draft.id}.png`;
    await fs.writeFile(path.join(dir, "references", referenceName), referenceBytes);
    const keyframeName = `${draft.id}.jpg`;
    await fs.copyFile(path.join(dir, "frames", draft.keyframe), path.join(dir, "keyframes", keyframeName));
    steps.push({ ...draft, referenceImage: `references/${referenceName}`, keyframe: `keyframes/${keyframeName}` });
  }

  const graph: SkillGraph = {
    version: 1,
    skillId,
    title: fused.title,
    clipDurationSeconds: durationSeconds,
    transcript,
    steps,
  };
  if (!isSkillGraph(graph)) {
    throw new Error("Fused skill graph failed validation");
  }
  await fs.writeFile(path.join(dir, "skill-graph.json"), JSON.stringify(graph, null, 2));
  return graph;
}
