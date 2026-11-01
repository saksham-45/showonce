"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

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
      <h1 style={{ fontSize: 32, marginBottom: 8 }}>ShowOnce Learn</h1>
      <p style={{ marginTop: 0 }}>
        Upload a 60-second expert clip. The pipeline studies it into a step-by-step skill graph.
      </p>

      <section style={{ border: "1px solid #ddd", borderRadius: 8, padding: 16, marginTop: 24 }}>
        <h2 style={{ fontSize: 20, marginTop: 0 }}>New skill</h2>
        <form onSubmit={upload}>
          <div style={{ marginBottom: 12 }}>
            <label>
              Skill title
              <br />
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Fold a paper airplane"
                style={{ width: "100%", padding: 8, marginTop: 4 }}
              />
            </label>
          </div>
          <div style={{ marginBottom: 12 }}>
            <label>
              Expert clip (short video, 60s target)
              <br />
              <input
                type="file"
                accept="video/*"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                style={{ marginTop: 4 }}
              />
            </label>
          </div>
          {error ? <p style={{ color: "#a00" }}>{error}</p> : null}
          <button type="submit" disabled={busy} style={{ padding: "8px 16px" }}>
            {busy ? "Uploading..." : "Upload clip"}
          </button>
        </form>
      </section>

      <section style={{ marginTop: 32 }}>
        <h2 style={{ fontSize: 20 }}>Skills</h2>
        {skills.length === 0 ? (
          <p>No skills yet. Upload a clip above.</p>
        ) : (
          <ul>
            {skills.map((skill) => (
              <li key={skill.skillId}>
                <Link href={`/skills/${skill.skillId}`}>{skill.title}</Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
