"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import SkillFinder from "./components/SkillFinder";

interface SkillEntry {
  skillId: string;
  title: string;
}

export default function HomePage() {
  const router = useRouter();
  const [skills, setSkills] = useState<SkillEntry[]>([]);
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/skills")
      .then((res) => res.json())
      .then((body) => setSkills(body.skills ?? []))
      .catch(() => setSkills([]));
  }, []);

  async function upload(event: React.FormEvent) {
    event.preventDefault();
    if (!file) {
      setError("Choose a clip file first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("clip", file);
      form.append("title", title || file.name);
      const res = await fetch("/api/skills", { method: "POST", body: form });
      const body = (await res.json()) as { skillId?: string; error?: string };
      if (!res.ok || !body.skillId) throw new Error(body.error ?? "Upload failed.");
      router.push(`/skills/${body.skillId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <header className="topbar">
        <Link className="wordmark" href="/">
          SHOW<b>ONCE</b>
        </Link>
        <span className="provider-note">Meta Model API · indie track</span>
      </header>

      <section className="hero">
        <div>
          <p className="kicker">One video in · a live coach out</p>
          <h1 className="display hero-title">
            Show it
            <br />
            <span className="accent-line">once.</span>
          </h1>
          <p className="lede">
            Record a 60-second clip of an expert doing a physical task. ShowOnce studies it into
            steps, then watches you back over the camera with spoken corrections until every step
            checks off.
          </p>
        </div>

        <div className="card hero-card">
          <h2 className="display" style={{ fontSize: 26, marginBottom: 16 }}>
            New skill
          </h2>
          <form onSubmit={upload}>
            <div className="field" style={{ marginBottom: 12 }}>
              <label htmlFor="skill-title">Skill title</label>
              <input
                id="skill-title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Fold a paper airplane"
              />
            </div>
            <div className="field" style={{ marginBottom: 12 }}>
              <label htmlFor="skill-clip">Expert clip · short video, 60s target</label>
              <input
                id="skill-clip"
                type="file"
                accept="video/*"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </div>
            {error ? <p className="error">{error}</p> : null}
            <button type="submit" disabled={busy} className="btn btn-primary">
              {busy ? "Uploading..." : "Upload clip"}
            </button>
          </form>
          <div style={{ marginTop: 24 }}>
            <SkillFinder />
          </div>
        </div>
      </section>

      <section>
        <p className="kicker">Sessions on record</p>
        {skills.length === 0 ? (
          <p className="lede">No skills yet. Upload a clip above.</p>
        ) : (
          <div className="card">
            {skills.map((skill) => (
              <div className="session-row" key={skill.skillId}>
                <div>
                  <p className="session-name">
                    <Link href={`/skills/${skill.skillId}`}>{skill.title}</Link>
                  </p>
                  <p className="session-meta">skill · {skill.skillId.slice(0, 8)}</p>
                </div>
                <Link className="go-link" href={`/coach/${skill.skillId}`}>
                  Coach →
                </Link>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
