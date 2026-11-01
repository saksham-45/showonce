"use client";

import { use, useCallback, useEffect, useState } from "react";
import type { SkillGraph } from "@/lib/skillgraph";

export default function SkillPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [graph, setGraph] = useState<SkillGraph | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/skills/${id}`);
    if (res.ok) {
      setGraph((await res.json()) as SkillGraph);
    }
  }, [id]);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  async function run() {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch(`/api/skills/${id}/run`, { method: "POST" });
      const body = (await res.json()) as SkillGraph & { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Pipeline failed.");
      setGraph(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Pipeline failed.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <>
      <p>
        <a href="/">All skills</a>
      </p>
      <h1 style={{ fontSize: 28 }}>{graph ? graph.title : "Skill"}</h1>

      <video
        src={`/skills/${id}/clip.mp4`}
        controls
        style={{ width: "100%", maxHeight: 420, background: "#000" }}
      />

      <div style={{ marginTop: 16 }}>
        <button onClick={run} disabled={running} style={{ padding: "8px 16px" }}>
          {running ? "Learning..." : graph ? "Re-run Learn pipeline" : "Run Learn pipeline"}
        </button>
        {error ? <p style={{ color: "#a00" }}>{error}</p> : null}
      </div>

      {graph ? (
        <section style={{ marginTop: 24 }}>
          <h2 style={{ fontSize: 22 }}>Steps ({graph.steps.length})</h2>
          <ol style={{ paddingLeft: 20 }}>
            {graph.steps.map((step) => (
              <li key={step.id} style={{ marginBottom: 24 }}>
                <p style={{ fontWeight: 600, marginBottom: 4 }}>{step.instruction}</p>
                <p style={{ marginTop: 0 }}>Checkpoint: {step.checkpoint}</p>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                  <figure style={{ margin: 0 }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/skills/${id}/${step.keyframe}`}
                      alt={`Keyframe for ${step.id}`}
                      width={320}
                    />
                    <figcaption>Keyframe</figcaption>
                  </figure>
                  <figure style={{ margin: 0 }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/skills/${id}/${step.referenceImage}`}
                      alt={`Corrective reference for ${step.id}`}
                      width={320}
                    />
                    <figcaption>Corrective reference</figcaption>
                  </figure>
                </div>
                <p>Common mistakes: {step.mistakes.join("; ")}</p>
              </li>
            ))}
          </ol>
        </section>
      ) : (
        <p>Not learned yet. Run the pipeline to extract steps.</p>
      )}
    </>
  );
}
