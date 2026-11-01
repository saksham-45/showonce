// Coach-loop frame comparison: stub-first deterministic compare with a Meta
// path (Spark vision + SAM on the live frame vs the step checkpoint) used
// when a key is present. The stub keeps the loop demonstrable with no key;
// the Meta path judges the live frame against the checkpoint text and the
// step's reference image.

import type { SkillStep } from "./skillgraph";

export type CoachVerdict = "correct" | "nudge" | "wrong";

export interface CoachResult {
  verdict: CoachVerdict;
  correction: string;
  advance: boolean;
}

export interface CoachCompareInput {
  step: SkillStep;
  // Decoded live-frame bytes, or null when no frame arrived.
  frameBytes: Buffer | null;
  // Decoded reference-image bytes for the step, or null when unavailable.
  referenceBytes: Buffer | null;
  apiBase: string;
  apiKey: string | null;
}

// Frames below this size carry no usable pose information (a 1x1 probe PNG
// is ~70 bytes); the stub treats them as "can't see you" rather than a pass.
export const MIN_USEFUL_FRAME_BYTES = 1024;

// Deterministic stub: frame presence + usability only, no model involved.
// A usable frame passes the current step; anything else holds the learner
// on the step with a spoken correction.
export function stubCompare(step: SkillStep, frameBytes: Buffer | null): CoachResult {
  if (!frameBytes || frameBytes.length === 0) {
    return {
      verdict: "wrong",
      correction: "No camera frame arrived. Check the camera permission and hold still.",
      advance: false,
    };
  }
  if (frameBytes.length < MIN_USEFUL_FRAME_BYTES) {
    return {
      verdict: "nudge",
      correction: `I can barely see you. Move back so your upper body is in frame, then match this: ${step.checkpoint}`,
      advance: false,
    };
  }
  return {
    verdict: "correct",
    correction: `Good. ${step.checkpoint}`,
    advance: true,
  };
}

function verdictFrom(value: unknown): CoachVerdict {
  return value === "correct" || value === "wrong" ? value : "nudge";
}

interface MetaChatContent {
  role: "user";
  content: unknown[];
}

async function postChat(
  apiBase: string,
  apiKey: string,
  model: string,
  messages: MetaChatContent[],
): Promise<string> {
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
  const body = (await res.json()) as { choices: { message: { content: string } }[] };
  return body.choices[0].message.content;
}

// SAM 3.1 segments the live frame; the region summary grounds the Spark
// vision judgement that follows. Segmentation failure is non-fatal: the
// vision call still runs without it.
async function segmentLiveFrame(
  apiBase: string,
  apiKey: string,
  frameBytes: Buffer,
): Promise<string> {
  const content = await postChat(apiBase, apiKey, "sam-3.1", [
    {
      role: "user",
      content: [
        {
          type: "text",
          text: 'List the visible hands, tools, and objects as JSON: {"regions": [{"label": string, "box": [x, y, w, h], "score": number}]} with normalized 0-1 boxes.',
        },
        {
          type: "image_url",
          image_url: { url: `data:image/jpeg;base64,${frameBytes.toString("base64")}` },
        },
      ],
    },
  ]);
  return content;
}

// Spark vision judges the live frame against the step checkpoint.
async function metaCompare(input: CoachCompareInput): Promise<CoachResult> {
  const { step, frameBytes, referenceBytes, apiBase, apiKey } = input;
  if (!frameBytes || !apiKey) throw new Error("metaCompare needs a frame and an API key.");

  let regionsSummary = "unavailable";
  try {
    regionsSummary = await segmentLiveFrame(apiBase, apiKey, frameBytes);
  } catch {
    regionsSummary = "unavailable";
  }

  const images: unknown[] = [
    {
      type: "image_url",
      image_url: { url: `data:image/jpeg;base64,${frameBytes.toString("base64")}` },
    },
  ];
  if (referenceBytes) {
    images.push({
      type: "image_url",
      image_url: { url: `data:image/png;base64,${referenceBytes.toString("base64")}` },
    });
  }

  const prompt = [
    "You coach a learner doing a physical skill over webcam.",
    `Current step instruction: ${step.instruction}`,
    `Checkpoint to verify before advancing: ${step.checkpoint}`,
    `Common mistakes to watch for: ${step.mistakes.join("; ") || "none listed"}`,
    `SAM segmentation of the live frame: ${regionsSummary}`,
    "The first image is the learner's live frame.",
    referenceBytes
      ? "The second image is the ideal reference pose for this step."
      : "No reference image is available; judge against the checkpoint text.",
    'Reply with JSON only: {"verdict": "correct" | "nudge" | "wrong", "correction": string, "advance": boolean}.',
    'verdict "correct" only when the checkpoint is clearly met; "nudge" when close; "wrong" when far off or no person is visible.',
    "correction is one short spoken sentence telling the learner what to fix, or confirming the checkpoint.",
    "advance is true only when verdict is correct.",
  ].join(" ");

  const raw = await postChat(apiBase, apiKey, "muse-spark", [
    { role: "user", content: [{ type: "text", text: prompt }, ...images] },
  ]);
  let parsed: { verdict?: unknown; correction?: unknown; advance?: unknown };
  try {
    parsed = JSON.parse(raw) as { verdict?: unknown; correction?: unknown; advance?: unknown };
  } catch {
    throw new Error("Meta API returned non-JSON coach verdict.");
  }
  const verdict = verdictFrom(parsed.verdict);
  const correction =
    typeof parsed.correction === "string" && parsed.correction.length > 0
      ? parsed.correction
      : step.checkpoint;
  return { verdict, correction, advance: verdict === "correct" && parsed.advance !== false };
}

// Entry point for the coach route: Meta path when a key is present, with a
// stub fallback so one failed model call never freezes the live loop.
export async function compareSkillFrame(input: CoachCompareInput): Promise<CoachResult> {
  if (!input.apiKey) return stubCompare(input.step, input.frameBytes);
  try {
    return await metaCompare(input);
  } catch {
    return stubCompare(input.step, input.frameBytes);
  }
}
