"use client";

// Library: every learned skill in one scanable rail — rating, completions,
// and links into Learn and Coach. All rows come from real data: the
// /api/skills listing, each skill's stored graph, and this learner's
// locally recorded activity. Nothing is mocked.

import { useEffect, useState } from "react";
import { loadProfile, type LearnerProfile } from "@/lib/progress";
import type { SkillGraph } from "@/lib/skillgraph";
import Rating from "../components/Rating";

interface Row {
  skillId: string;
  title: string;
  steps: number;
}

export default function LibraryPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<LearnerProfile | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const list = (await (await fetch("/api/skills")).json()) as {
          skills: { skillId: string; title: string }[];
        };
        const entries = list.skills ?? [];
        const detailed = await Promise.all(
          entries.map(async (entry) => {
            try {
              const res = await fetch(`/api/skills/${entry.skillId}`);
              if (!res.ok) return { ...entry, steps: 0 };
              const graph = (await res.json()) as SkillGraph;
              return { ...entry, steps: graph.steps?.length ?? 0 };
            } catch {
              return { ...entry, steps: 0 };
            }
          }),
        );
        if (!cancelled) {
          setRows(detailed);
          setProfile(loadProfile());
        }
      } catch {
        if (!cancelled) setRows([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <p className="crumbs">
        <a href="/">Home</a>
      </p>
      <h1 className="display" style={{ fontSize: "clamp(40px, 6vw, 72px)" }}>
        Library
      </h1>
      <p className="meta-line" style={{ marginBottom: 24 }}>
        {loading
          ? "Loading library…"
          : rows.length === 0
            ? "No skills learned yet"
            : `${rows.length} learned skill${rows.length === 1 ? "" : "s"}`}
      </p>

      {loading ? (
        <p className="lede">Loading library…</p>
      ) : rows.length === 0 ? (
        <p className="lede">
          Nothing here yet. <a href="/">Learn your first skill</a> and it lands on this shelf.
        </p>
      ) : (
        <div className="card">
          {rows.map((row) => {
            const activity = profile?.skills[row.skillId];
            return (
              <div className="session-row" key={row.skillId}>
                <div>
                  <p className="session-name">
                    <a href={`/skills/${row.skillId}`}>{row.title}</a>
                  </p>
                  <p className="session-meta">
                    {row.steps > 0 ? `${row.steps} steps` : "not studied yet"}
                    {activity && activity.completions > 0
                      ? ` · ${activity.completions} full circuit${activity.completions === 1 ? "" : "s"}`
                      : ""}
                  </p>
                  {activity && activity.bestRating > 0 ? (
                    <p style={{ margin: "4px 0 0" }}>
                      <Rating value={activity.bestRating} />
                    </p>
                  ) : null}
                </div>
                <span style={{ display: "flex", gap: 16 }}>
                  <a className="go-link" href={`/skills/${row.skillId}`}>
                    Study
                  </a>
                  <a className="go-link" href={`/coach/${row.skillId}`}>
                    Coach →
                  </a>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
