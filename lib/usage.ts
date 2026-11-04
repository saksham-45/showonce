// API usage visibility: per-process cumulative counters over every Meta
// Model API call the app attempts, plus the cache/dedup hits that avoided
// one. Counters reset on restart (documented follow-up: persist them); the
// per-run log lines give test runs their itemized view and GET /api/usage
// plus the profile page section give the cumulative one.
//
// Token totals accumulate from Responses API `usage` blocks when present;
// the ledger otherwise records what is always known — call counts by
// model, budgeted frames, transcript characters, and image payload
// bytes — instead of inventing token numbers.

export interface UsageSnapshot {
  startedAt: string;
  apiCalls: { total: number; byModel: Record<string, number> };
  cacheHits: number;
  cacheMisses: number;
  dedupHits: number;
  runs: { learn: number; lookup: number; coach: number; coachMeta: number };
  framesSent: number;
  transcriptCharsSent: number;
  referenceImages: number;
  tokens: { input: number; output: number; total: number };
}

const state = {
  startedAt: new Date().toISOString(),
  apiCallsByModel: {} as Record<string, number>,
  cacheHits: 0,
  cacheMisses: 0,
  dedupHits: 0,
  learnRuns: 0,
  lookupRuns: 0,
  coachRequests: 0,
  coachMetaCalls: 0,
  framesSent: 0,
  transcriptCharsSent: 0,
  referenceImages: 0,
  tokensInput: 0,
  tokensOutput: 0,
};

export function recordApiCall(model: string): void {
  state.apiCallsByModel[model] = (state.apiCallsByModel[model] ?? 0) + 1;
}

// Token totals from Responses API `usage` blocks, when present. Only
// finite positive counts accumulate, so a malformed block cannot poison
// the ledger.
export function recordTokenUsage(inputTokens: number, outputTokens: number): void {
  if (Number.isFinite(inputTokens) && inputTokens > 0) state.tokensInput += Math.floor(inputTokens);
  if (Number.isFinite(outputTokens) && outputTokens > 0) state.tokensOutput += Math.floor(outputTokens);
}

export function recordCacheHit(): void {
  state.cacheHits += 1;
}

export function recordCacheMiss(): void {
  state.cacheMisses += 1;
}

export function recordDedupHit(): void {
  state.dedupHits += 1;
}

export function recordLearnRun(): void {
  state.learnRuns += 1;
}

export function recordLookupRun(): void {
  state.lookupRuns += 1;
}

export function recordCoachRequest(via: "meta" | "stub" | "dedup"): void {
  state.coachRequests += 1;
  if (via === "meta") state.coachMetaCalls += 1;
  if (via === "dedup") state.dedupHits += 1;
}

export function recordFrames(count: number): void {
  state.framesSent += count;
}

export function recordTranscriptChars(count: number): void {
  state.transcriptCharsSent += count;
}

export function recordReferenceImage(): void {
  state.referenceImages += 1;
}

export function usageSnapshot(): UsageSnapshot {
  const total = Object.values(state.apiCallsByModel).reduce((sum, n) => sum + n, 0);
  return {
    startedAt: state.startedAt,
    apiCalls: { total, byModel: { ...state.apiCallsByModel } },
    cacheHits: state.cacheHits,
    cacheMisses: state.cacheMisses,
    dedupHits: state.dedupHits,
    runs: { learn: state.learnRuns, lookup: state.lookupRuns, coach: state.coachRequests, coachMeta: state.coachMetaCalls },
    framesSent: state.framesSent,
    transcriptCharsSent: state.transcriptCharsSent,
    referenceImages: state.referenceImages,
    tokens: {
      input: state.tokensInput,
      output: state.tokensOutput,
      total: state.tokensInput + state.tokensOutput,
    },
  };
}

// Itemized per-run line for server logs: one line per Learn/Lookup run so
// a test run's cost is visible without opening the usage endpoint.
export function logRunLine(line: string): void {
  console.log(`[showonce-usage] ${line}`);
}
