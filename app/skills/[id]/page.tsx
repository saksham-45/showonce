"use client";

import { use, useCallback, useEffect, useState } from "react";
import { BADGES, loadProfile, recordLearn, saveProfile } from "@/lib/progress";
import type { SkillGraph } from "@/lib/skillgraph";

interface StoredGuide {
  query: string;
  summary: string;
  videos: { title: string; url: string }[];
  articles: { title: string; url: string; snippet?: string }[];
  sources: { title: string; url: string }[];
}

export default function SkillPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [graph, setGraph] = useState<SkillGraph | null>(null);
  const [guide, setGuide] = useState<StoredGuide | null>(null);
  const [clipMissing, setClipMissing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [earned, setEarned] = useState<string[]>([]);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/skills/${id}`);
      if (res.ok) {
        setGraph((await res.json()) as SkillGraph);
      }
      const guideRes = await fetch(`/api/skills/${id}/guide`);
      if (guideRes.ok) {
        setGuide((await guideRes.json()) as StoredGuide);
      }
    } finally {
      setLoaded(true);
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
      // Real activity, recorded where it happens: a finished pipeline run
      // is what earns Learn points and badges.
      const profile = loadProfile();
      const event = recordLearn(profile, id, body.title);
      saveProfile(profile);
      setEarned(event.earned);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Pipeline failed.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <>
      <p className="crumbs">
        <a href="/">All skills</a>
        {" · "}
        <a href={`/coach/${id}`}>Coach view</a>
      </p>
      <h1 className="display" style={{ fontSize: "clamp(40px, 6vw, 72px)" }}>
        {graph ? graph.title : "Skill"}
      </h1>
      <p className="meta-line" style={{ marginBottom: 24 }}>
        {!loaded ? "Loading skill…" : graph ? `${graph.steps.length} steps · studied` : "Not studied yet"}
      </p>

      <a className="coach-cta" href={`/coach/${id}`}>
        <span>
          <strong>Take it to the coach</strong>
          <span>Camera on, corrections spoken, badge on completion.</span>
        </span>
        <span className="go-link">Coach view →</span>
      </a>

      <div className="skill-grid">
        <div>
          <div className="clip-frame">
            {clipMissing ? (
              <p className="lede" role="status" style={{ padding: 16 }}>
                No expert clip — this skill was learned from web sources, listed below. The steps
                and the coach work from the distilled guide.
              </p>
            ) : (
              <video src={`/skills/${id}/clip.mp4`} controls onError={() => setClipMissing(true)} />
            )}
          </div>
          <div style={{ marginTop: 16 }}>
            <button onClick={run} disabled={running} className="btn btn-primary">
              {running ? "Learning…" : graph ? "Re-run Learn pipeline" : "Run Learn pipeline"}
            </button>
            {error ? (
              <p className="error" role="alert">
                {error}
              </p>
            ) : null}
            {earned.length > 0 ? (
              <p style={{ color: "var(--good)" }}>
                Badge earned: {earned.map((bid) => BADGES.find((b) => b.id === bid)?.name ?? bid).join(", ")}.
                See it on your <a href="/profile">profile</a>.
              </p>
            ) : null}
          </div>
        </div>

        <div>
          {!loaded ? (
            <p className="lede">Loading skill…</p>
          ) : graph ? (
            <ol className="step-rail">
              {graph.steps.map((step, i) => (
                <li key={step.id} className="step">
                  <span className="step-num" aria-hidden="true">
                    {i + 1}
                  </span>
                  <h3>{step.instruction}</h3>
                  <p className="checkpoint">Checkpoint: {step.checkpoint}</p>
                  <div className="step-figures">
                    <figure>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`/skills/${id}/${step.keyframe}`}
                        alt={`Keyframe for ${step.id}`}
                        loading="lazy"
                        decoding="async"
                      />
                      <figcaption>Keyframe</figcaption>
                    </figure>
                    <figure>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`/skills/${id}/${step.referenceImage}`}
                        alt={`Corrective reference for ${step.id}`}
                        loading="lazy"
                        decoding="async"
                      />
                      <figcaption>Corrective reference</figcaption>
                    </figure>
                  </div>
                  <p className="mistakes">Common mistakes: {step.mistakes.join("; ")}</p>
                </li>
              ))}
            </ol>
          ) : (
            <p className="lede">Not learned yet. Run the pipeline to extract steps.</p>
          )}
          {guide ? (
            <section aria-label="Web sources" style={{ marginTop: 24 }}>
              <h2 className="display" style={{ fontSize: 26, marginBottom: 8 }}>
                On the web
              </h2>
              {guide.summary ? <p className="lede">{guide.summary}</p> : null}
              {guide.videos.length > 0 ? (
                <>
                  <h3 style={{ fontSize: 18, margin: "12px 0 4px" }}>Watch</h3>
                  <ul style={{ margin: 0, paddingLeft: 20 }}>
                    {guide.videos.map((video) => (
                      <li key={video.url}>
                        <a href={video.url} target="_blank" rel="noreferrer">
                          {video.title}
                        </a>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
              {guide.articles.length > 0 ? (
                <>
                  <h3 style={{ fontSize: 18, margin: "12px 0 4px" }}>Read</h3>
                  <ul style={{ margin: 0, paddingLeft: 20 }}>
                    {guide.articles.map((article) => (
                      <li key={article.url}>
                        <a href={article.url} target="_blank" rel="noreferrer">
                          {article.title}
                        </a>
                        {article.snippet ? <span className="session-meta"> — {article.snippet}</span> : null}
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
              {guide.sources.length > 0 ? (
                <p className="mistakes">
                  Sources:{" "}
                  {guide.sources.map((source, i) => (
                    <span key={source.url}>
                      {i > 0 ? "; " : ""}
                      <a href={source.url} target="_blank" rel="noreferrer">
                        {source.title}
                      </a>
                    </span>
                  ))}
                </p>
              ) : null}
            </section>
          ) : null}
        </div>
      </div>
    </>
  );
}
