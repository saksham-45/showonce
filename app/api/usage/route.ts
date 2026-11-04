import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/config";
import { usageSnapshot } from "@/lib/usage";

// GET /api/usage — cumulative Meta API usage since server boot: call
// counts by model, cache/dedup hits, per-flow run counts, and budgeted
// input totals, plus the active budgets and caps. No key material, no
// request bodies: safe for the home page panel to poll.
export async function GET() {
  const config = loadConfig();
  return NextResponse.json({
    ...usageSnapshot(),
    budgets: {
      modelFrameBudget: config.modelFrameBudget,
      transcriptBudgetChars: config.transcriptBudgetChars,
      regionsPerFrame: config.regionsPerFrame,
      apiCallCap: config.apiCallCap,
      coachDedupMs: config.coachDedupMs,
      cache: process.env.SHOWNCE_CACHE !== "off",
    },
    provider: config.provider,
  });
}
