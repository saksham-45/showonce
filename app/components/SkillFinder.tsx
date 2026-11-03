"use client";

// Typed skill entry: the user types a skill name and the coach looks up the
// matching learned video/skill-graph. Colocated with the pages that use it
// (Next.js App Router colocation: non-page files stay private to their
// route segment), rendered on both the home page and the coach page.

import { useEffect, useState } from "react";
import { matchSkills, type SkillEntry } from "@/lib/skillmatch";

export default function SkillFinder({ coach = false }: { coach?: boolean }) {
  const [skills, setSkills] = useState<SkillEntry[]>([]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    fetch("/api/skills")
      .then((res) => res.json())
      .then((body) => setSkills(body.skills ?? []))
      .catch(() => setSkills([]));
  }, []);

  const matches = matchSkills(query, skills);
  const showEmpty = query.trim().length > 0 && matches.length === 0;

  return (
    <div>
      <div className="field">
        <label htmlFor={coach ? "finder-coach" : "finder-home"}>
          {coach ? "Switch skill — type its name" : "Already learned? Type the skill"}
        </label>
        <input
          id={coach ? "finder-coach" : "finder-home"}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="e.g. paper airplane"
          autoComplete="off"
        />
      </div>
      {matches.length > 0 ? (
        <ul className="finder-results">
          {matches.map((skill) => (
            <li key={skill.skillId}>
              <a href={coach ? `/coach/${skill.skillId}` : `/skills/${skill.skillId}`}>
                <span>{skill.title}</span>
                <span className="go-link">{coach ? "Coach →" : "Open →"}</span>
              </a>
            </li>
          ))}
        </ul>
      ) : null}
      {showEmpty ? (
        <p className="finder-empty">
          No learned skill matches “{query.trim()}”. Upload the clip above to teach it.
        </p>
      ) : null}
    </div>
  );
}
