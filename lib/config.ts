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
}

function providerFromEnv(value: string | undefined): "meta" | "stub" {
  if (value === "stub") return "stub";
  return "meta";
}

export function loadConfig(): LearnConfig {
  return {
    clipSource: process.env.SHOWNCE_CLIP ?? null,
    provider: providerFromEnv(process.env.SHOWNCE_PROVIDER),
    apiBase: process.env.META_API_BASE ?? "https://api.meta.ai/v1",
    apiKey: process.env.META_API_KEY ?? null,
    framesPerSecond: 1,
  };
}
