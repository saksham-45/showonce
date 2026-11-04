"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import ClipDropzone from "./components/ClipDropzone";
import SkillFinder from "./components/SkillFinder";
import WebLookup from "./components/WebLookup";

interface SkillEntry {
  skillId: string;
  title: string;
}

export default function HomePage() {
  const router = useRouter();
  const [skills, setSkills] = useState<SkillEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/skills")
      .then((res) => res.json())
      .then((body) => setSkills(body.skills ?? []))
      .catch(() => setSkills([]))
      .finally(() => setLoading(false));
  }, []);

  async function upload(event: React.FormEvent) {
    event.preventDefault();
    if (!file) {
      setError("Choose a clip file first — drop one onto the well or browse for it.");
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
    <div className="home-fit">
      <div className="home-col">
        <section className="home-intro" aria-label="Introduction">
          <h1 className="display home-title">
            Show it once.
            <br />
            Learn it for good.
          </h1>
          <hr className="hero-rule" />
          <p className="lede home-lede">
            Record a clip of an expert doing a physical task — any length. ShowOnce studies it into
            steps, then watches you back over the camera with spoken corrections until every step
            checks off.
          </p>
          <p className="meta-line">Meta Model API · indie track · one video in, a live coach out</p>
        </section>

        <section className="home-fill" aria-label="Learn from the web">
          <h2 className="display home-h">No clip? Learn from the web</h2>
          <p className="lede home-lede home-lede-tight">
            Type or speak a skill: ShowOnce searches for videos to watch and written guides to read,
            distills them into steps with cited sources, and coaches you through them.
          </p>
          <div className="card home-card home-scroll-card">
            <div className="home-scroll">
              <WebLookup />
            </div>
          </div>
        </section>
      </div>

      <div className="home-col">
        <section className="card home-card home-create" aria-label="New skill">
          <h2 className="display home-h">New skill</h2>
          <form onSubmit={upload} className="home-form">
            <div className="field home-field">
              <label htmlFor="skill-title">Skill title</label>
              <input
                id="skill-title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Fold a paper airplane"
              />
            </div>
            <div className="field home-field">
              <label htmlFor="skill-clip">Expert clip</label>
              <ClipDropzone
                file={file}
                onPick={setFile}
                onClear={() => setFile(null)}
                externalError={error}
                disabled={busy}
              />
            </div>
            <button type="submit" disabled={busy} className="btn btn-primary">
              {busy ? "Uploading…" : "Upload clip"}
            </button>
          </form>
          <div className="home-finder">
            <SkillFinder />
          </div>
        </section>

        <section className="home-fill home-sessions" aria-label="Sessions on record">
          <h2 className="display home-h">Sessions on record</h2>
          <div className="card home-card home-scroll-card">
            <div className="home-scroll">
              {loading ? (
                <p className="lede home-lede">Loading sessions…</p>
              ) : skills.length === 0 ? (
                <p className="lede home-lede">No skills yet. Upload a clip above.</p>
              ) : (
                skills.map((skill) => (
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
                ))
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
