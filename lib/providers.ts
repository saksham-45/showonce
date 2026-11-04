import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import { deflateSync } from "node:zlib";
import { promisify } from "node:util";
import * as path from "node:path";
import { RunBudget, cacheKey, cachedBytes, cachedJson, sha256Hex } from "./apicache";
import { audioContent, postResponsesText, visionContent } from "./metaresponses";
import type {
  FrameSegmentation,
  SampledFrame,
  SkillGraph,
  SkillStep,
  Transcript,
} from "./skillgraph";
import { recordApiCall, recordFrames, recordReferenceImage, recordTranscriptChars } from "./usage";

// One provider call set per pipeline run. "meta" targets the Meta Model API;
// "stub" is a deterministic local stand-in used for pipeline proof when no
// META_API_KEY is reachable.

export interface StepDraft {
  id: string;
  instruction: string;
  checkpoint: string;
  keyframe: string;
  mistakes: string[];
}

export interface FuseInput {
  title: string;
  durationSeconds: number;
  frames: SampledFrame[];
  segmentations: FrameSegmentation[];
  transcript: Transcript;
}

export interface LearnProvider {
  segmentFrames(frames: SampledFrame[], framesDir: string): Promise<FrameSegmentation[]>;
  transcribe(audioPath: string): Promise<Transcript>;
  fuse(input: FuseInput): Promise<{ title: string; steps: StepDraft[] }>;
  referenceImage(step: StepDraft): Promise<Buffer>;
}

// ---------------------------------------------------------------------------
// Meta Model API provider (https://api.meta.ai/v1, Bearer META_API_KEY).
// Every model call below is POST {apiBase}/responses (text prompts send a
// plain input string; vision and audio prompts send input content parts),
// shared with the coach judge through lib/metaresponses.ts. Reference
// images still render through /images/generations, which serves them.
// ---------------------------------------------------------------------------

// Parse model-emitted JSON with the model named in the failure.
function parseModelJson<T>(model: string, text: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Meta API ${model} returned malformed JSON.`);
  }
}

const FUSE_SYSTEM_PROMPT = [
  "You fuse video segmentation summaries and a narration transcript into a",
  "step-by-step skill graph for a physical skill.",
  'Reply with JSON: {"title": string, "steps": [{"id": string, "instruction": string,',
  '"checkpoint": string, "keyframe": string, "mistakes": string[]}]}.',
  "keyframe must be one of the sampled frame file names from the input.",
  "checkpoint describes the exact visual to check before moving on.",
].join(" ");

// Fuse-input budgets in the extract.ts pattern: the transcript past
// `transcriptBudgetChars` is cut to a leading prefix of segments (the first
// segment is always kept, so a non-empty transcript never fuses as silent),
// and each frame keeps only its `regionsPerFrame` top-scoring regions.
// Both cuts are deterministic — same input, same budgeted input, same
// cache key — so reruns stay zero-call.
export function capTranscriptChars(transcript: Transcript, budgetChars: number): Transcript {
  const kept: Transcript["segments"] = [];
  let used = 0;
  for (const segment of transcript.segments) {
    if (kept.length > 0 && used + segment.text.length > budgetChars) break;
    kept.push(segment);
    used += segment.text.length;
  }
  return { segments: kept };
}

const execFileAsync = promisify(execFile);

// The extracted track is a WAV; the Responses audio part takes mp3, so the
// transcription call re-encodes it next to the OS temp dir (never into the
// skill dir) and removes it afterwards. ffmpeg is already a hard pipeline
// dependency (frame extraction shells to it).
async function wavFileToMp3Bytes(audioPath: string): Promise<Buffer> {
  const out = path.join(os.tmpdir(), `showonce-transcribe-${process.pid}.mp3`);
  try {
    await execFileAsync("ffmpeg", [
      "-y",
      "-v",
      "error",
      "-i",
      audioPath,
      "-ac",
      "1",
      "-ar",
      "16000",
      "-codec:a",
      "libmp3lame",
      "-b:a",
      "64k",
      out,
    ]);
    return await fs.readFile(out);
  } finally {
    await fs.rm(out, { force: true });
  }
}

// Transcription prompt: plain speech text, or NONE when the clip is silent.
const TRANSCRIBE_PROMPT = "Transcribe any speech in this audio. If none, reply NONE.";

const SEGMENT_PROMPT =
  'List the visible hands, tools, and objects as JSON: {"regions": [{"label": string, "box": [x, y, w, h], "score": number}]} with normalized 0-1 boxes.';

export function capRegionsPerFrame(segmentations: FrameSegmentation[], regionsPerFrame: number): FrameSegmentation[] {
  // Array sort is stable, so score ties keep their input order: the cut is
  // deterministic for the same segmentation.
  return segmentations.map((seg) => ({
    frame: seg.frame,
    regions: [...seg.regions].sort((a, b) => b.score - a.score).slice(0, Math.max(1, regionsPerFrame)),
  }));
}

export class MetaProvider implements LearnProvider {
  constructor(
    private apiBase: string,
    private apiKey: string,
    private budget: RunBudget = RunBudget.unlimited(),
    private transcriptBudgetChars = 8000,
    private regionsPerFrame = 20,
  ) {}

  private headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.apiKey}` };
  }

  // One Responses call per frame: SAM takes a single image, so no batch
  // shape exists to use — the savings are the frame budget upstream plus
  // this content-hash cache, which turns identical reruns (and duplicate
  // frames inside one run) into zero new calls. An empty answer means the
  // model listed nothing, so the frame fuses with no regions.
  async segmentFrames(frames: SampledFrame[], framesDir: string): Promise<FrameSegmentation[]> {
    const out: FrameSegmentation[] = [];
    for (const frame of frames) {
      const bytes = await fs.readFile(`${framesDir}/${frame.file}`);
      const key = cacheKey({ model: "sam-3.1", kind: "segment", frame: sha256Hex(bytes) });
      const { value } = await cachedJson<{ regions: FrameSegmentation["regions"] }>("segment", key, async () => {
        this.budget.consume("sam-3.1 frame segmentation");
        recordApiCall("sam-3.1");
        recordFrames(1);
        const text = await postResponsesText(this.apiBase, this.apiKey, "sam-3.1", [
          {
            role: "user",
            content: visionContent(SEGMENT_PROMPT, [`data:image/jpeg;base64,${bytes.toString("base64")}`]),
          },
        ]);
        if (text.trim().length === 0) return { regions: [] };
        const parsed = parseModelJson<{ regions: FrameSegmentation["regions"] }>("sam-3.1", text);
        return { regions: parsed.regions ?? [] };
      });
      out.push({ frame: frame.file, regions: value.regions });
    }
    return out;
  }

  async transcribe(audioPath: string): Promise<Transcript> {
    const audio = await fs.readFile(audioPath);
    const key = cacheKey({ model: "muse-spark-1.3", kind: "transcript", audio: sha256Hex(audio) });
    const { value } = await cachedJson<Transcript>("transcript", key, async () => {
      this.budget.consume("muse-spark transcription");
      recordApiCall("muse-spark-1.3");
      const mp3 = await wavFileToMp3Bytes(audioPath);
      const text = await postResponsesText(this.apiBase, this.apiKey, "muse-spark-1.3", [
        { role: "user", content: audioContent(TRANSCRIBE_PROMPT, mp3.toString("base64")) },
      ]);
      if (text.trim().length === 0 || text.trim().toUpperCase() === "NONE") return { segments: [] };
      return { segments: [{ startSeconds: 0, endSeconds: 0, text: text.trim() }] };
    });
    return value;
  }

  async fuse(input: FuseInput): Promise<{ title: string; steps: StepDraft[] }> {
    const transcript = capTranscriptChars(input.transcript, this.transcriptBudgetChars);
    const segmentations = capRegionsPerFrame(input.segmentations, this.regionsPerFrame);
    const transcriptChars = transcript.segments.reduce((sum, s) => sum + s.text.length, 0);
    const payload = {
      title: input.title,
      durationSeconds: input.durationSeconds,
      frames: input.frames.map((f) => ({ file: f.file, atSeconds: f.atSeconds })),
      segmentations,
      transcript,
    };
    const key = cacheKey({ model: "muse-spark-1.3", kind: "fuse", input: payload });
    const { value } = await cachedJson<{ title: string; steps: StepDraft[] }>("fuse", key, async () => {
      this.budget.consume("muse-spark fuse");
      recordApiCall("muse-spark-1.3");
      recordTranscriptChars(transcriptChars);
      const content = await postResponsesText(
        this.apiBase,
        this.apiKey,
        "muse-spark-1.3",
        `${FUSE_SYSTEM_PROMPT}\n${JSON.stringify(payload)}`,
      );
      return parseModelJson<{ title: string; steps: StepDraft[] }>("muse-spark-1.3", content);
    });
    return value;
  }

  // One image call per step: the generations endpoint takes a single
  // prompt, so identical steps (same instruction + checkpoint) share one
  // cached image instead of repeat renders.
  async referenceImage(step: StepDraft): Promise<Buffer> {
    const key = cacheKey({
      model: "muse-image-1.0",
      kind: "reference",
      instruction: step.instruction,
      checkpoint: step.checkpoint,
    });
    const { bytes } = await cachedBytes("reference", key, async () => {
      this.budget.consume(`muse-image reference for ${step.id}`);
      recordApiCall("muse-image-1.0");
      const res = await fetch(`${this.apiBase}/images/generations`, {
        method: "POST",
        headers: { ...this.headers(), "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "muse-image-1.0",
          prompt: `Corrective reference photo for a learner doing this step of a physical skill. Show the correct hand position and object placement, photorealistic, close-up, neutral background. Step: ${step.instruction} Checkpoint: ${step.checkpoint}`,
        }),
      });
      if (!res.ok) {
        throw new Error(`Meta API muse-image-1.0 failed: ${res.status} ${await res.text()}`);
      }
      const body = (await res.json()) as { data: { b64_json?: string; url?: string }[] };
      const first = body.data[0];
      if (first.b64_json) return Buffer.from(first.b64_json, "base64");
      if (first.url) {
        const img = await fetch(first.url);
        return Buffer.from(await img.arrayBuffer());
      }
      throw new Error("Meta API muse-image-1.0 returned no image data");
    });
    recordReferenceImage();
    return bytes;
  }
}

// ---------------------------------------------------------------------------
// Stub provider: deterministic skill-agnostic stand-in, used only for
// pipeline proof when no key is reachable. It splits whatever clip arrives
// into the configured number of timed phases (SHOWNCE_STEPS, default 5) and
// describes each phase by its observed time range — no skill-specific
// branching anywhere: the same path serves a paper airplane, a dance move,
// or a repair task. The Meta path replaces these time-based drafts with
// model-inferred steps for the real skill. Both providers fuse only the
// budgeted frame subset extraction selected, so long clips cost the same.
// ---------------------------------------------------------------------------

// Skill-agnostic coaching mistakes: true of learning any physical movement.
const GENERIC_MISTAKES = [
  "Rushing the transition into this phase",
  "Holding your breath instead of moving steadily",
  "Mirroring the wrong side",
];

function phaseBounds(index: number, count: number, durationSeconds: number): { start: number; end: number } {
  const start = (durationSeconds * index) / count;
  const end = (durationSeconds * (index + 1)) / count;
  return { start, end };
}

function clock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function solidPng(width: number, height: number, r: number, g: number, b: number, label: string): Buffer {
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x++) {
    row[1 + x * 3] = r;
    row[1 + x * 3 + 1] = g;
    row[1 + x * 3 + 2] = b;
  }
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const chunk = (type: string, data: Buffer): Buffer => {
    const out = Buffer.alloc(8 + data.length + 4);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, "ascii");
    data.copy(out, 8);
    out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])), 8 + data.length);
    return out;
  };
  const text = Buffer.from(`t:${label}`);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("tEXt", Buffer.concat([Buffer.from("Comment\0"), text])),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

export class StubProvider implements LearnProvider {
  constructor(private stepCount = 5) {}

  async segmentFrames(frames: SampledFrame[]): Promise<FrameSegmentation[]> {
    return frames.map((frame, i) => ({
      frame: frame.file,
      regions: [
        { label: "hands", box: [0.3, 0.4, 0.4, 0.3], score: 0.9 },
        { label: "subject", box: [0.2 + ((i % this.stepCount) / this.stepCount) * 0.3, 0.3, 0.5, 0.4], score: 0.85 },
      ],
    }));
  }

  async transcribe(): Promise<Transcript> {
    // The stub has no model, so it cannot know what was said; the pipeline
    // tolerates an empty transcript by design and fuses from vision alone.
    return { segments: [] };
  }

  async fuse(input: FuseInput): Promise<{ title: string; steps: StepDraft[] }> {
    const count = Math.max(1, this.stepCount);
    const duration = Number.isFinite(input.durationSeconds) && input.durationSeconds > 0 ? input.durationSeconds : count;
    const per = Math.max(1, Math.floor(input.frames.length / count));
    const steps: StepDraft[] = [];
    for (let i = 0; i < count; i++) {
      const { start, end } = phaseBounds(i, count, duration);
      steps.push({
        id: `step-${i + 1}`,
        instruction: `Phase ${i + 1}: repeat the movement shown between ${clock(start)} and ${clock(end)}.`,
        checkpoint: `Match the pose held around ${clock((start + end) / 2)} into the clip.`,
        keyframe: input.frames[Math.min(input.frames.length - 1, i * per)].file,
        mistakes: [...GENERIC_MISTAKES],
      });
    }
    return { title: input.title || "Untitled skill", steps };
  }

  async referenceImage(step: StepDraft): Promise<Buffer> {
    const palette = [
      [201, 84, 63],
      [59, 130, 180],
      [78, 160, 102],
      [186, 143, 58],
      [130, 96, 168],
    ];
    const index = Math.max(0, parseInt(step.id.replace("step-", ""), 10) - 1 || 0);
    const [r, g, b] = palette[index % palette.length] ?? [120, 120, 120];
    return solidPng(640, 360, r, g, b, step.id);
  }
}

export type { SkillGraph, SkillStep };
