// Skill-graph JSON: the single contract the Learn pipeline produces and the
// later Coach stage will consume.

// One video frame sampled during extraction.
export interface SampledFrame {
  file: string;
  index: number;
  atSeconds: number;
}

// One segmented region in a frame (hands, tools, objects).
export interface MaskRegion {
  label: string;
  // Normalized [x, y, width, height] box; sam-3.1 raster masks are summarized
  // to boxes because the API returns them per region.
  box: [number, number, number, number];
  score: number;
}

export interface FrameSegmentation {
  frame: string;
  regions: MaskRegion[];
}

export interface TranscriptSegment {
  startSeconds: number;
  endSeconds: number;
  text: string;
}

export interface Transcript {
  segments: TranscriptSegment[];
}

export interface SkillStep {
  id: string;
  instruction: string;
  checkpoint: string;
  // Frame file backing the keyframe image.
  keyframe: string;
  // Reference image generated for this step, relative to the skill directory.
  referenceImage: string;
  mistakes: string[];
}

export interface SkillGraph {
  version: 1;
  skillId: string;
  title: string;
  clipDurationSeconds: number;
  transcript: Transcript;
  steps: SkillStep[];
}

export function isSkillGraph(value: unknown): value is SkillGraph {
  if (typeof value !== "object" || value === null) return false;
  const graph = value as Record<string, unknown>;
  if (graph.version !== 1) return false;
  if (typeof graph.skillId !== "string") return false;
  if (typeof graph.title !== "string") return false;
  if (!Array.isArray(graph.steps) || graph.steps.length === 0) return false;
  return graph.steps.every((step) => {
    if (typeof step !== "object" || step === null) return false;
    const s = step as Record<string, unknown>;
    return (
      typeof s.id === "string" &&
      typeof s.instruction === "string" &&
      typeof s.checkpoint === "string" &&
      typeof s.keyframe === "string" &&
      typeof s.referenceImage === "string" &&
      Array.isArray(s.mistakes)
    );
  });
}
