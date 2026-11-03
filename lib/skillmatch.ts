// Typed skill lookup: the user types a skill name and the coach finds the
// matching learned video/skill-graph. Pure function over the GET /api/skills
// listing, so lookup stays instant and local; learning (upload + pipeline)
// remains the only way new videos enter the set.

export interface SkillEntry {
  skillId: string;
  title: string;
}

function normalize(value: string): string {
  return value.toLowerCase().trim().replace(/\s+/g, " ");
}

function score(query: string, title: string): number {
  if (query.length === 0) return 0;
  if (title === query) return 100;
  if (title.startsWith(query)) return 75;
  if (title.includes(query)) return 50;
  const queryTokens = new Set(query.split(" "));
  const titleTokens = title.split(" ");
  let overlap = 0;
  for (const token of queryTokens) {
    if (token.length > 1 && titleTokens.some((t) => t.startsWith(token))) overlap += 1;
  }
  if (overlap === 0) return 0;
  return Math.round((overlap / queryTokens.size) * 40);
}

// Rank learned skills against a typed query, best match first, capped so a
// type-ahead list stays scannable. No match scores above zero, so callers
// can render an explicit "nothing learned yet" state.
export function matchSkills(query: string, skills: SkillEntry[], limit = 5): SkillEntry[] {
  const q = normalize(query);
  return skills
    .map((skill) => ({ skill, rank: score(q, normalize(skill.title)) }))
    .filter((candidate) => candidate.rank > 0)
    .sort((a, b) => b.rank - a.rank || a.skill.title.localeCompare(b.skill.title))
    .slice(0, limit)
    .map((candidate) => candidate.skill);
}
