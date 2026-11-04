"use client";

// Web skill lookup: type a skill, search the net for videos to watch and
// written instructions to read, then save the distilled guide as a skill
// the coach can train. Stub provider covers the flow offline; the Meta path
// searches via Responses API grounding when a key is present.

import { useState } from "react";

interface LookupVideo {
  title: string;
  url: string;
}

interface LookupArticle {
  title: string;
  url: string;
  snippet: string;
}

interface LookupStep {
  instruction: string;
  checkpoint: string;
  mistakes: string[];
}

export interface LookupGuide {
  query: string;
  summary: string;
  videos: LookupVideo[];
  articles: LookupArticle[];
  steps: LookupStep[];
  sources: { title: string; url: string }[];
  via: "meta" | "stub";
}

export default function WebLookup({ onSaved }: { onSaved?: (skillId: string) => void }) {
  const [query, setQuery] = useState("");
  const [guide, setGuide] = useState<LookupGuide | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function search(event: React.FormEvent) {
    event.preventDefault();
    if (!query.trim() || busy) return;
    setBusy(true);
    setError(null);
    setGuide(null);
    try {
      const res = await fetch("/api/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: query.trim() }),
      });
      const body = (await res.json()) as LookupGuide & { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Web lookup failed.");
      setGuide(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Web lookup failed.");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!guide || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/skills/from-guide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: guide.query, guide }),
      });
      const body = (await res.json()) as { skillId?: string; error?: string };
      if (!res.ok || !body.skillId) throw new Error(body.error ?? "Saving the guide failed.");
      onSaved?.(body.skillId);
      window.location.href = `/skills/${body.skillId}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Saving the guide failed.");
      setSaving(false);
    }
  }

  return (
    <div>
      <form onSubmit={search}>
        <div className="field">
          <label htmlFor="web-lookup">Search the web for a skill</label>
          <input
            id="web-lookup"
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. juggle three balls"
            autoComplete="off"
          />
        </div>
        <button type="submit" disabled={busy || !query.trim()} className="btn btn-primary">
          {busy ? "Searching the web…" : "Search videos and guides"}
        </button>
      </form>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      {busy ? (
        <p className="lede" role="status">
          Searching videos and written guides…
        </p>
      ) : null}
      {guide ? (
        <section aria-label="Web guide results" style={{ marginTop: 16 }}>
          <p className="meta-line" role="status">
            {guide.via === "meta" ? "Grounded in live web results" : "Offline stand-in results"} ·{" "}
            {guide.sources.length} cited {guide.sources.length === 1 ? "source" : "sources"}
          </p>
          {guide.summary ? <p className="lede">{guide.summary}</p> : null}
          {guide.videos.length > 0 ? (
            <>
              <h3 className="display" style={{ fontSize: 20, margin: "12px 0 8px" }}>
                Watch
              </h3>
              <ul className="finder-results" aria-label="Videos to watch">
                {guide.videos.map((video) => (
                  <li key={video.url}>
                    <a href={video.url} target="_blank" rel="noreferrer">
                      <span>{video.title}</span>
                      <span className="go-link">Watch →</span>
                    </a>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {guide.articles.length > 0 ? (
            <>
              <h3 className="display" style={{ fontSize: 20, margin: "12px 0 8px" }}>
                Read
              </h3>
              <ul className="finder-results" aria-label="Written instructions">
                {guide.articles.map((article) => (
                  <li key={article.url}>
                    <a href={article.url} target="_blank" rel="noreferrer">
                      <span>
                        {article.title}
                        {article.snippet ? <span className="session-meta"> — {article.snippet}</span> : null}
                      </span>
                      <span className="go-link">Read →</span>
                    </a>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          <h3 className="display" style={{ fontSize: 20, margin: "12px 0 8px" }}>
            Distilled steps ({guide.steps.length})
          </h3>
          <ol className="step-rail">
            {guide.steps.map((step, i) => (
              <li key={i} className="step">
                <span className="step-num" aria-hidden="true">
                  {i + 1}
                </span>
                <h4>{step.instruction}</h4>
                <p className="checkpoint">Checkpoint: {step.checkpoint}</p>
              </li>
            ))}
          </ol>
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
          <div style={{ marginTop: 12 }}>
            <button onClick={save} disabled={saving} className="btn btn-primary">
              {saving ? "Saving…" : "Save as skill and coach it"}
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
