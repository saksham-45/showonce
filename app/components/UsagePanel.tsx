"use client";

// API usage panel: cumulative Meta Model API spend since server boot,
// read from GET /api/usage. Loading-first like every other listing, so a
// slow fetch never flashes a false empty state; zeros are honest zeros
// (the stub path makes no API calls, cache hits make none either).

import { useEffect, useState } from "react";

interface UsageBody {
  apiCalls: { total: number; byModel: Record<string, number> };
  cacheHits: number;
  dedupHits: number;
  runs: { learn: number; lookup: number; coach: number; coachMeta: number };
  framesSent: number;
  budgets: {
    modelFrameBudget: number;
    transcriptBudgetChars: number;
    regionsPerFrame: number;
    apiCallCap: number;
    coachDedupMs: number;
  };
}

export default function UsagePanel() {
  const [usage, setUsage] = useState<UsageBody | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetch("/api/usage")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("usage unavailable"))))
      .then((body) => setUsage(body as UsageBody))
      .catch(() => setFailed(true));
  }, []);

  if (failed) {
    return (
      <p className="lede" role="status">
        Usage is unavailable right now.
      </p>
    );
  }
  if (!usage) {
    return <p className="lede">Loading usage…</p>;
  }
  const models = Object.entries(usage.apiCalls.byModel);
  return (
    <div>
      <ul className="stat-list">
        <li>
          <span className="stat-label">Meta API calls</span>
          <span className="stat-value">{usage.apiCalls.total}</span>
        </li>
        <li>
          <span className="stat-label">Cache + dedup hits</span>
          <span className="stat-value">{usage.cacheHits + usage.dedupHits}</span>
        </li>
        <li>
          <span className="stat-label">Learn runs</span>
          <span className="stat-value">{usage.runs.learn}</span>
        </li>
        <li>
          <span className="stat-label">Frames sent to models</span>
          <span className="stat-value">{usage.framesSent}</span>
        </li>
      </ul>
      <p className="session-meta" role="status">
        {models.length === 0
          ? "No model calls yet — stub runs and cache hits cost nothing."
          : models.map(([model, count]) => `${model} × ${count}`).join(" · ")}
        {` · budgets ${usage.budgets.modelFrameBudget} frames / ${usage.budgets.transcriptBudgetChars} transcript chars / cap ${usage.budgets.apiCallCap} calls per run`}
      </p>
    </div>
  );
}
