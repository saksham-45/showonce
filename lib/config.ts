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

export function loadConfig(): LearnConfig {
  return {
    clipSource: process.env.SHOWNCE_CLIP ?? null,
    provider: providerFromEnv(process.env.SHOWNCE_PROVIDER),
    apiBase: process.env.META_API_BASE ?? "https://api.meta.ai/v1",
    apiKey: process.env.META_API_KEY ?? null,
    framesPerSecond: 1,
    stubSteps: stubStepsFromEnv(process.env.SHOWNCE_STEPS),
    modelFrameBudget: modelFrameBudgetFromEnv(process.env.SHOWNCE_MODEL_FRAMES),
  };
}
