"use client";

// Profile: the learner's operate surface. Identity, tier progression, and
// the badge shelf — every number derived from real recorded activity
// (Learn runs and judged coach frames), never mocked. Graphs behind the
// ratings come from the API; the activity itself lives in this browser.

import { useEffect, useState } from "react";
import {
  BADGES,
  TIERS,
  emptyProfile,
  loadProfile,
  nextTier,
  saveProfile,
  tierFor,
  type LearnerProfile,
} from "@/lib/progress";
import Medallion from "../components/Medallion";
import Rating from "../components/Rating";

function nextStep(profile: LearnerProfile): string {
  const skills = Object.values(profile.skills);
  if (skills.length === 0) return "Learn your first skill to earn First Light (+10).";
  const unfinished = skills.find((s) => s.completions === 0);
  if (unfinished) return `Finish a full circuit on “${unfinished.title}” to earn Full Circuit (+25).`;
  if (skills.length < 3)
    return `Learn ${3 - skills.length} more skill${skills.length === 2 ? "" : "s"} to earn Triple Threat (+20).`;
  const rated = skills.filter((s) => s.completions > 0);
  const avg = rated.reduce((sum, s) => sum + s.bestRating, 0) / Math.max(1, rated.length);
  if (avg < 4.5) return "Chase a Clean Run — zero nudges, zero misses — to push ratings toward 4.5.";
  if (!profile.badges.includes("masters-mark"))
    return "Master's Mark is in reach: hold the average across one more finished skill.";
  return "Master tier. Teach it once, own it forever — keep the shelf polished.";
}

export default function ProfilePage() {
  const [profile, setProfile] = useState<LearnerProfile>(emptyProfile);
  const [name, setName] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const loaded = loadProfile();
    setProfile(loaded);
    setName(loaded.name);
    setReady(true);
  }, []);

  function saveName(event: React.FormEvent) {
    event.preventDefault();
    const updated = { ...profile, name: name.trim() };
    setProfile(updated);
    saveProfile(updated);
  }

  const tier = tierFor(profile.points);
  const upcoming = nextTier(profile.points);
  const skills = Object.values(profile.skills).sort((a, b) => b.learnedAt - a.learnedAt);
  const checkpoints = skills.reduce((sum, s) => sum + s.passedSteps.length, 0);
  const completions = skills.reduce((sum, s) => sum + s.completions, 0);

  return (
    <>
      <p className="crumbs">
        <a href="/">Home</a>
        {" · "}
        <a href="/skills">Library</a>
      </p>
      <h1 className="display" style={{ fontSize: "clamp(40px, 6vw, 72px)" }}>
        {profile.name ? profile.name : "Learner"}
      </h1>
      <p className="meta-line" style={{ marginBottom: 24 }}>
        {tier.name} · {profile.points} pts{upcoming ? ` · ${upcoming.at - profile.points} to ${upcoming.name}` : " · top tier"}
      </p>

      <section className="card" style={{ marginBottom: 24 }}>
        <form onSubmit={saveName}>
          <div className="field">
            <label htmlFor="profile-name">Display name</label>
            <div className="name-row">
              <input
                id="profile-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="What should the coach call you?"
                autoComplete="nickname"
              />
              <button type="submit" className="btn">
                Save
              </button>
            </div>
          </div>
        </form>
      </section>

      <h2 className="display" style={{ fontSize: 30, marginBottom: 12 }}>
        Progression
      </h2>
      <div className="tier-rail" aria-label={`Current tier ${tier.name}`}>
        {TIERS.map((t) => {
          const hit = profile.points >= t.at;
          const isNext = upcoming?.id === t.id;
          return (
            <span key={t.id} className={hit ? "hit" : isNext ? "next" : ""}>
              {t.name} · {t.at}
            </span>
          );
        })}
      </div>
      <p className="lede" style={{ marginBottom: 24 }}>
        {ready ? nextStep(profile) : "Loading your record…"}
      </p>

      <h2 className="display" style={{ fontSize: 30, marginBottom: 12 }}>
        Record
      </h2>
      <ul className="stat-list" style={{ marginBottom: 24 }}>
        <li>
          <span className="stat-label">Points</span>
          <span className="stat-value">{profile.points}</span>
        </li>
        <li>
          <span className="stat-label">Skills learned</span>
          <span className="stat-value">{skills.length}</span>
        </li>
        <li>
          <span className="stat-label">Checkpoints passed</span>
          <span className="stat-value">{checkpoints}</span>
        </li>
        <li>
          <span className="stat-label">Full circuits</span>
          <span className="stat-value">{completions}</span>
        </li>
        <li>
          <span className="stat-label">Badges</span>
          <span className="stat-value">
            {profile.badges.length}/{BADGES.length}
          </span>
        </li>
      </ul>

      <h2 className="display" style={{ fontSize: 30, marginBottom: 12 }}>
        Badges
      </h2>
      <div className="badge-shelf" style={{ marginBottom: 24 }}>
        {BADGES.map((badge) => (
          <Medallion key={badge.id} badge={badge} earned={profile.badges.includes(badge.id)} />
        ))}
      </div>

      <h2 className="display" style={{ fontSize: 30, marginBottom: 12 }}>
        Skill ratings
      </h2>
      {!ready ? (
        <p className="lede">Loading your record…</p>
      ) : skills.length === 0 ? (
        <p className="lede">
          No ratings yet — ratings are earned in the coach, never assigned.{" "}
          <a href="/">Learn a skill</a> first.
        </p>
      ) : (
        <div className="card">
          {skills.map((skill) => (
            <div className="session-row" key={skill.skillId}>
              <div>
                <p className="session-name">
                  <a href={`/skills/${skill.skillId}`}>{skill.title}</a>
                </p>
                <p className="session-meta">
                  {skill.completions > 0
                    ? `${skill.completions} circuit${skill.completions === 1 ? "" : "s"}${skill.cleanRuns > 0 ? ` · ${skill.cleanRuns} clean` : ""}`
                    : "in training"}
                </p>
                {skill.bestRating > 0 ? (
                  <p style={{ margin: "4px 0 0" }}>
                    <Rating value={skill.bestRating} />
                  </p>
                ) : null}
              </div>
              <a className="go-link" href={`/coach/${skill.skillId}`}>
                Coach →
              </a>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
