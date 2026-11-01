import { promises as fs } from "node:fs";
import { deflateSync } from "node:zlib";
import type {
  FrameSegmentation,
  SampledFrame,
  SkillGraph,
  SkillStep,
  Transcript,
} from "./skillgraph";

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
// The API is OpenAI-compatible: Chat Completions / Responses / Messages
// formats, audio transcription, and image generation endpoints. Request shapes
// below follow that surface; they were written without a reachable key, so the
// first live-key run is expected to confirm or correct them.
// ---------------------------------------------------------------------------

interface ChatMessage {
  role: "system" | "user";
  content: string;
}

async function chatCompletions(apiBase: string, apiKey: string, model: string, messages: ChatMessage[]): Promise<string> {
  const res = await fetch(`${apiBase}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, messages, response_format: { type: "json_object" } }),
  });
  if (!res.ok) {
    throw new Error(`Meta API ${model} failed: ${res.status} ${await res.text()}`);
  }
  let body: { choices: { message: { content: string } }[] };
  try {
    body = (await res.json()) as { choices: { message: { content: string } }[] };
  } catch {
    throw new Error(`Meta API ${model} returned a non-JSON response.`);
  }
  const content = body.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error(`Meta API ${model} returned an unexpected response shape.`);
  }
  return content;
}

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

export class MetaProvider implements LearnProvider {
  constructor(
    private apiBase: string,
    private apiKey: string,
  ) {}

  private headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.apiKey}` };
  }

  async segmentFrames(frames: SampledFrame[], framesDir: string): Promise<FrameSegmentation[]> {
    const out: FrameSegmentation[] = [];
    for (const frame of frames) {
      const bytes = await fs.readFile(`${framesDir}/${frame.file}`);
      const res = await fetch(`${this.apiBase}/chat/completions`, {
        method: "POST",
        headers: { ...this.headers(), "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "sam-3.1",
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: 'List the visible hands, tools, and objects as JSON: {"regions": [{"label": string, "box": [x, y, w, h], "score": number}]} with normalized 0-1 boxes.' },
                { type: "image_url", image_url: { url: `data:image/jpeg;base64,${bytes.toString("base64")}` } },
              ],
            },
          ],
          response_format: { type: "json_object" },
        }),
      });
      if (!res.ok) {
        throw new Error(`Meta API sam-3.1 failed: ${res.status} ${await res.text()}`);
      }
      const body = (await res.json()) as { choices: { message: { content: string } }[] };
      const parsed = parseModelJson<{ regions: FrameSegmentation["regions"] }>(
        "sam-3.1",
        body.choices[0].message.content,
      );
      out.push({ frame: frame.file, regions: parsed.regions ?? [] });
    }
    return out;
  }

  async transcribe(audioPath: string): Promise<Transcript> {
    const audio = await fs.readFile(audioPath);
    const form = new FormData();
    form.append("model", "muse-voice-transcribe-1.0");
    form.append("file", new Blob([audio], { type: "audio/wav" }), "audio.wav");
    form.append("response_format", "verbose_json");
    const res = await fetch(`${this.apiBase}/audio/transcriptions`, {
      method: "POST",
      headers: this.headers(),
      body: form,
    });
    if (!res.ok) {
      throw new Error(`Meta API muse-voice-transcribe-1.0 failed: ${res.status} ${await res.text()}`);
    }
    const body = (await res.json()) as { segments?: { start: number; end: number; text: string }[]; text?: string };
    if (body.segments) {
      return { segments: body.segments.map((s) => ({ startSeconds: s.start, endSeconds: s.end, text: s.text })) };
    }
    return { segments: [{ startSeconds: 0, endSeconds: 0, text: body.text ?? "" }] };
  }

  async fuse(input: FuseInput): Promise<{ title: string; steps: StepDraft[] }> {
    const content = await chatCompletions(
      this.apiBase,
      this.apiKey,
      "muse-spark-1.3",
      [
        { role: "system", content: FUSE_SYSTEM_PROMPT },
        {
          role: "user",
          content: JSON.stringify({
            title: input.title,
            durationSeconds: input.durationSeconds,
            frames: input.frames.map((f) => ({ file: f.file, atSeconds: f.atSeconds })),
            segmentations: input.segmentations,
            transcript: input.transcript,
          }),
        },
      ],
    );
    return parseModelJson<{ title: string; steps: StepDraft[] }>("muse-spark-1.3", content);
  }

  async referenceImage(step: StepDraft): Promise<Buffer> {
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
  }
}

// ---------------------------------------------------------------------------
// Stub provider: deterministic stand-in describing the placeholder clip
// (a 60s five-phase paper-airplane fold), used only for pipeline proof.
// ---------------------------------------------------------------------------

const STUB_STEPS: { id: string; instruction: string; checkpoint: string; mistakes: string[] }[] = [
  {
    id: "step-1",
    instruction: "Crease the sheet in half lengthwise, then unfold it flat.",
    checkpoint: "A single straight center crease runs top to bottom.",
    mistakes: ["Crease drifts off-center", "Paper shifts mid-fold"],
  },
  {
    id: "step-2",
    instruction: "Fold the top two corners into the center crease.",
    checkpoint: "Both corner edges meet exactly on the center line.",
    mistakes: ["Corners overlap past the line", "Uneven left and right folds"],
  },
  {
    id: "step-3",
    instruction: "Fold the new slanted edges into the center again.",
    checkpoint: "A sharp narrow nose forms with no gaps.",
    mistakes: ["Loose second fold blunts the nose", "Paper buckles at the tip"],
  },
  {
    id: "step-4",
    instruction: "Fold the plane in half away from you along the center.",
    checkpoint: "All layered folds sit on the outside.",
    mistakes: ["Folding toward you hides the layers", "Misaligned halves twist the body"],
  },
  {
    id: "step-5",
    instruction: "Fold each wing down to meet the belly edge.",
    checkpoint: "Both wings are equal width with flat crisp edges.",
    mistakes: ["One wing wider than the other", "Wings angled instead of level"],
  },
];

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
  async segmentFrames(frames: SampledFrame[]): Promise<FrameSegmentation[]> {
    return frames.map((frame, i) => ({
      frame: frame.file,
      regions: [
        { label: "hands", box: [0.3, 0.4, 0.4, 0.3], score: 0.9 },
        { label: "paper", box: [0.2 + (i % 5) * 0.05, 0.3, 0.5, 0.4], score: 0.85 },
      ],
    }));
  }

  async transcribe(): Promise<Transcript> {
    return {
      segments: STUB_STEPS.map((step, i) => ({
        startSeconds: i * 12,
        endSeconds: (i + 1) * 12,
        text: `Phase ${i + 1}: ${step.instruction}`,
      })),
    };
  }

  async fuse(input: FuseInput): Promise<{ title: string; steps: StepDraft[] }> {
    const per = Math.max(1, Math.floor(input.frames.length / STUB_STEPS.length));
    return {
      title: input.title || "Fold a paper airplane",
      steps: STUB_STEPS.map((step, i) => ({
        ...step,
        keyframe: input.frames[Math.min(input.frames.length - 1, i * per)].file,
      })),
    };
  }

  async referenceImage(step: StepDraft): Promise<Buffer> {
    const palette = [
      [201, 84, 63],
      [59, 130, 180],
      [78, 160, 102],
      [186, 143, 58],
      [130, 96, 168],
    ];
    const [r, g, b] = palette[STUB_STEPS.findIndex((s) => s.id === step.id) % palette.length] ?? [120, 120, 120];
    return solidPng(640, 360, r, g, b, step.id);
  }
}

export type { SkillGraph, SkillStep };
