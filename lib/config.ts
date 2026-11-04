// Learn-pipeline configuration. Every value here is config-only: swapping the
// placeholder clip for the real expert clip means setting SHOWNCE_CLIP (or
// uploading through the UI) - no code change.

export interface LearnConfig {
  // Path to a clip file ingested as the placeholder skill, or null when every
  // skill comes from the upload form.
  clipSource: string | null;
  // "meta" calls the Meta Model API; "stub" runs a deterministic local stand-in
  // for pipeline proof when no key is reachable.
  provider: "meta" | "stub";
  // Base URL of the Meta Model API.
  apiBase: string;
  // Bearer key, from META_API_KEY or .env.local. Never logged, never committed.
  apiKey: string | null;
  // Frames sampled per second during extraction.
  framesPerSecond: number;
  // Fixed model budget: no matter how long the input clip is, at most this
  // many sampled frames reach the provider, so model cost stays flat while
  // input length is free.
  modelFrameBudget: number;
  // How many phases the stub stand-in splits a clip into. The Meta path lets
  // the model decide the step count; the stub needs a configured default so
  // clips of any length and any skill still fuse to a valid graph.
  stubSteps: number;
  // Fixed fuse-input budgets in the extract.ts pattern: the transcript past
  // this many characters is cut to a leading prefix of segments, and each
  // frame keeps only its top-scoring regions, so fuse input cost stays flat
  // while narration length and scene clutter are free.
  transcriptBudgetChars: number;
  regionsPerFrame: number;
  // Per-run Meta call cap for one Learn or Lookup run (attempted HTTP calls
  // only; cache hits are free). Tripping it fails fast with a named 429 —
  // a clear UI state, never a silent wrong output.
  apiCallCap: number;
  // Coach dedup window: an identical step + frame judged inside this window
  // reuses the verdict with zero new calls (test ticks repeat the same
  // still). 0 disables.
  coachDedupMs: number;
}

function providerFromEnv(value: string | undefined): "meta" | "stub" {
  if (value === "stub") return "stub";
  return "meta";
}

function stubStepsFromEnv(value: string | undefined): number {
  const parsed = Number(value ?? "");
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 12) return 5;
  return parsed;
}

function modelFrameBudgetFromEnv(value: string | undefined): number {
  const parsed = Number(value ?? "");
  if (!Number.isInteger(parsed) || parsed < 8 || parsed > 240) return 60;
  return parsed;
}

function transcriptBudgetFromEnv(value: string | undefined): number {
  const parsed = Number(value ?? "");
  if (!Number.isInteger(parsed) || parsed < 1000 || parsed > 48000) return 8000;
  return parsed;
}

function regionsPerFrameFromEnv(value: string | undefined): number {
  const parsed = Number(value ?? "");
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) return 20;
  return parsed;
}

// Default cap covers one full Learn run at the configured frame budget:
// every budgeted frame segmented, plus transcribe, fuse, and a generous
// reference-image allowance. Out-of-range values fall back to the default
// rather than silently running uncapped or capped at zero.
function apiCallCapFromEnv(value: string | undefined, modelFrameBudget: number): number {
  const parsed = Number(value ?? "");
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 10000) return modelFrameBudget + 64;
  return parsed;
}

function coachDedupMsFromEnv(value: string | undefined): number {
  if (value === undefined) return 30_000;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 300_000) return 30_000;
  return parsed;
}

export function loadConfig(): LearnConfig {
  const modelFrameBudget = modelFrameBudgetFromEnv(process.env.SHOWNCE_MODEL_FRAMES);
  return {
    clipSource: process.env.SHOWNCE_CLIP ?? null,
    provider: providerFromEnv(process.env.SHOWNCE_PROVIDER),
    apiBase: process.env.META_API_BASE ?? "https://api.meta.ai/v1",
    apiKey: process.env.META_API_KEY ?? null,
    framesPerSecond: 1,
    stubSteps: stubStepsFromEnv(process.env.SHOWNCE_STEPS),
    modelFrameBudget,
    transcriptBudgetChars: transcriptBudgetFromEnv(process.env.SHOWNCE_TRANSCRIPT_CHARS),
    regionsPerFrame: regionsPerFrameFromEnv(process.env.SHOWNCE_REGIONS_PER_FRAME),
    apiCallCap: apiCallCapFromEnv(process.env.SHOWNCE_API_CALL_CAP, modelFrameBudget),
    coachDedupMs: coachDedupMsFromEnv(process.env.SHOWNCE_COACH_DEDUP_MS),
  };
}
