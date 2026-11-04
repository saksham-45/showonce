// Coach-loop frame comparison: stub-first deterministic compare with a Meta
// path (Spark vision + SAM on the live frame vs the step checkpoint) used
// when a key is present. The stub keeps the loop demonstrable with no key;
// the Meta path judges the live frame against the checkpoint text and the
// step's reference image.
//
// Real-time contract: every Meta call below is time-bounded (AbortSignal
// timeout, per the fetch signal docs), so one slow model never blocks the
// live loop — a timeout falls through to the stub verdict and the next
// camera tick keeps moving.

import { createHash } from "node:crypto";
import type { SkillStep } from "./skillgraph";
import { recordApiCall, recordCoachRequest } from "./usage";

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
  // Dedup window in ms: an identical step + frame judged inside it reuses
  // the verdict with zero new calls. 0 disables. Defaults to 30 s.
  dedupMs?: number;
}

// Verdict memo: step identity + frame content hash → recent result. Live
// ticks repeat the same still for seconds at a time (and test runs repeat
// it exactly), so without this every 2.5 s tick costs two model calls.
// Bounded and TTL'd: entries expire, and the map is dropped wholesale past
// its cap so a long session cannot grow it without bound.
const verdictMemo = new Map<string, { at: number; result: CoachResult; via: "meta" | "stub" }>();
const VERDICT_MEMO_CAP = 500;

function memoKey(step: SkillStep, frameBytes: Buffer | null): string {
  const hash = createHash("sha256");
  hash.update(step.id);
  hash.update(step.instruction);
  hash.update(step.checkpoint);
  if (frameBytes) hash.update(frameBytes);
  else hash.update("no-frame");
  return hash.digest("hex");
}

function memoGet(step: SkillStep, frameBytes: Buffer | null, dedupMs: number): { result: CoachResult; via: "meta" | "stub" } | null {
  if (dedupMs <= 0) return null;
  const entry = verdictMemo.get(memoKey(step, frameBytes));
  if (!entry || Date.now() - entry.at > dedupMs) return null;
  return { result: entry.result, via: entry.via };
}

function memoPut(step: SkillStep, frameBytes: Buffer | null, result: CoachResult, via: "meta" | "stub"): void {
  if (verdictMemo.size >= VERDICT_MEMO_CAP) verdictMemo.clear();
  verdictMemo.set(memoKey(step, frameBytes), { at: Date.now(), result, via });
}

// Progress phases the streaming coach route reports before the final
// verdict, so the UI can show connection state instead of a dead wait.
export type CoachPhase = "received" | "segmenting" | "judging";

// Per-call budgets. The vision judgement gets the largest share because it
// waits on two model round trips; the client enforces its own overall
// deadline on top, so these only bound server-side waiting.
export const SEGMENT_TIMEOUT_MS = 15_000;
export const JUDGE_TIMEOUT_MS = 25_000;

// Frames below this size carry no usable pose information (a 1x1 probe PNG
// is ~70 bytes); the stub treats them as "can't see you" rather than a pass.
export const MIN_USEFUL_FRAME_BYTES = 1024;

// Tutor voice: every correction is one short spoken sentence from the same
// personal tutor, on both sides of the verdict. A miss names the concrete
// observed gap against the checkpoint plus exactly one physical redo; a pass
// names exactly what the learner did right against the checkpoint. Warm and
// direct throughout: never generic praise alone, never a multi-step lecture,
// never a question instead of guidance.
//
// Worked examples — one per verdict — so future edits preserve the voice:
//   nudge:   "Almost — that flap stops just short of the edge, so fold it again all the way to the edge."
//   wrong:   "I can't see you at all — step into frame so your hands stay visible for this: fold the top corner to the center crease."
//   correct: "That flap is flush to the edge — clean fold, that's the checkpoint."
export const COACH_VOICE_EXAMPLES: Record<CoachVerdict, string> = {
  nudge:
    "Almost — that flap stops just short of the edge, so fold it again all the way to the edge.",
  wrong:
    "I can't see you at all — step into frame so your hands stay visible for this: fold the top corner to the center crease.",
  correct: "That flap is flush to the edge — clean fold, that's the checkpoint.",
};

// Deterministic stub: frame presence + usability only, no model involved.
// A usable frame passes the current step; anything else holds the learner
// on the step with a spoken correction. Each branch speaks in the tutor
// voice above: specific, checkpoint-grounded, one action.
export function stubCompare(step: SkillStep, frameBytes: Buffer | null): CoachResult {
  if (!frameBytes || frameBytes.length === 0) {
    return {
      verdict: "wrong",
      correction: `I can't see you at all — step into frame so your hands stay visible for this: ${step.checkpoint}`,
      advance: false,
    };
  }
  if (frameBytes.length < MIN_USEFUL_FRAME_BYTES) {
    return {
      verdict: "nudge",
      correction: `I can barely see you — move back until your hands are in frame for this: ${step.checkpoint}`,
      advance: false,
    };
  }
  return {
    verdict: "correct",
    correction: `That's it — nicely held: ${step.checkpoint}`,
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
  timeoutMs: number,
): Promise<string> {
  const res = await fetch(`${apiBase}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, messages, response_format: { type: "json_object" } }),
    // Time-bound: a hung model call aborts instead of stalling the loop.
    signal: AbortSignal.timeout(timeoutMs),
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
  const content = await postChat(
    apiBase,
    apiKey,
    "sam-3.1",
    [
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
    ],
    SEGMENT_TIMEOUT_MS,
  );
  return content;
}

// Spark vision judges the live frame against the step checkpoint.
async function metaCompare(
  input: CoachCompareInput,
  onPhase?: (phase: CoachPhase) => void,
): Promise<CoachResult> {
  const { step, frameBytes, referenceBytes, apiBase, apiKey } = input;
  if (!frameBytes || !apiKey) throw new Error("metaCompare needs a frame and an API key.");

  let regionsSummary = "unavailable";
  onPhase?.("segmenting");
  try {
    recordApiCall("sam-3.1");
    regionsSummary = await segmentLiveFrame(apiBase, apiKey, frameBytes);
  } catch {
    regionsSummary = "unavailable";
  }
  onPhase?.("judging");

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
    "correction is one short spoken sentence in a warm, direct tutor voice.",
    "On nudge or wrong, name the concrete observed gap versus the checkpoint (body part, object, direction, degree — e.g. the flap stops short of the edge) and give exactly one physical redo (e.g. fold that flap again all the way to the edge).",
    "On correct, confirm by naming exactly what the learner did right against the checkpoint (e.g. that flap is flush to the edge — clean fold).",
    "Never generic praise alone, never a multi-step lecture, never a question instead of guidance.",
    "advance is true only when verdict is correct.",
  ].join(" ");

  recordApiCall("muse-spark-1.3");
  const raw = await postChat(
    apiBase,
    apiKey,
    "muse-spark-1.3",
    [{ role: "user", content: [{ type: "text", text: prompt }, ...images] }],
    JUDGE_TIMEOUT_MS,
  );
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
// An identical step + frame inside the dedup window reuses the memoised
// verdict with zero new calls; the memo holds both paths, so a repeated
// still after a Meta failure repeats the stub verdict, not a retry storm.
export async function compareSkillFrame(input: CoachCompareInput): Promise<CoachResult> {
  const dedupMs = input.dedupMs ?? 30_000;
  const memoised = memoGet(input.step, input.frameBytes, dedupMs);
  if (memoised) {
    recordCoachRequest("dedup");
    return memoised.result;
  }
  if (!input.apiKey) {
    const result = stubCompare(input.step, input.frameBytes);
    if (dedupMs > 0) memoPut(input.step, input.frameBytes, result, "stub");
    recordCoachRequest("stub");
    return result;
  }
  try {
    const result = await metaCompare(input);
    if (dedupMs > 0) memoPut(input.step, input.frameBytes, result, "meta");
    recordCoachRequest("meta");
    return result;
  } catch {
    const result = stubCompare(input.step, input.frameBytes);
    if (dedupMs > 0) memoPut(input.step, input.frameBytes, result, "stub");
    recordCoachRequest("stub");
    return result;
  }
}

// Phased entry point for the streaming coach route: same verdict contract,
// but reports segment/judge progress (and which path served the verdict) so
// the UI can render connection state while the models work.
export interface PhasedCoachResult extends CoachResult {
  // "meta" when the Meta path judged the frame, "stub" for the local
  // stand-in or any fallback after a Meta failure or timeout.
  via: "meta" | "stub";
}

export async function compareSkillFramePhased(
  input: CoachCompareInput,
  onPhase: (phase: CoachPhase) => void,
): Promise<PhasedCoachResult> {
  const dedupMs = input.dedupMs ?? 30_000;
  const memoised = memoGet(input.step, input.frameBytes, dedupMs);
  if (memoised) {
    recordCoachRequest("dedup");
    return { ...memoised.result, via: memoised.via };
  }
  if (!input.apiKey) {
    const result = stubCompare(input.step, input.frameBytes);
    if (dedupMs > 0) memoPut(input.step, input.frameBytes, result, "stub");
    recordCoachRequest("stub");
    return { ...result, via: "stub" };
  }
  try {
    const result = await metaCompare(input, onPhase);
    if (dedupMs > 0) memoPut(input.step, input.frameBytes, result, "meta");
    recordCoachRequest("meta");
    return { ...result, via: "meta" };
  } catch {
    const result = stubCompare(input.step, input.frameBytes);
    if (dedupMs > 0) memoPut(input.step, input.frameBytes, result, "stub");
    recordCoachRequest("stub");
    return { ...result, via: "stub" };
  }
}
