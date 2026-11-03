// Learner progress + reward system. Pure logic over real Learn/Coach
// activity — no mocks: every point, badge, and rating below is derived from
// events the app records when a pipeline actually runs (recordLearn) and
// when frames are actually judged (recordStepPass / recordCompletion).
// Persistence is a localStorage snapshot of this same shape (see the
// load/save helpers); the skill graphs it references come from the API.

export type VerdictKind = "correct" | "nudge" | "wrong";

export interface SkillProgress {
  skillId: string;
  title: string;
  learnedAt: number;
  // Steps ever passed, by step id — points are awarded once per step.
  passedSteps: string[];
  completions: number;
  cleanRuns: number;
  // Best session rating so far, 1–5.
  bestRating: number;
}

export interface SessionRecord {
  skillId: string;
  startedAt: number;
  completedAt?: number;
  // Step ids that saw a nudge or wrong before passing, this session.
  frictionSteps: string[];
}

export interface LearnerProfile {
  version: 1;
  name: string;
  points: number;
  skills: Record<string, SkillProgress>;
  // Badge ids in earned order.
  badges: string[];
  openSession: SessionRecord | null;
}

export const POINTS = {
  learn: 10,
  checkpoint: 5,
  completion: 25,
  cleanBonus: 15,
} as const;

export interface Tier {
  id: string;
  name: string;
  at: number;
  blurb: string;
}

// Progression path to mastery: points thresholds, ascending.
export const TIERS: Tier[] = [
  { id: "rookie", name: "Rookie", at: 0, blurb: "Every master starts with one rep." },
  { id: "driller", name: "Driller", at: 40, blurb: "Showing up and checking steps off." },
  { id: "polished", name: "Polished", at: 120, blurb: "Clean runs, sharp checkpoints." },
  { id: "master", name: "Master", at: 250, blurb: "Teach it once, own it forever." },
];

export interface BadgeDef {
  id: string;
  name: string;
  desc: string;
  bonus: number;
}

export const BADGES: BadgeDef[] = [
  { id: "first-light", name: "First Light", desc: "Finish your first Learn pipeline.", bonus: 10 },
  { id: "full-circuit", name: "Full Circuit", desc: "Pass every checkpoint of one skill.", bonus: 25 },
  { id: "clean-run", name: "Clean Run", desc: "Full Circuit with zero nudges or misses.", bonus: 15 },
  { id: "quick-study", name: "Quick Study", desc: "Full Circuit within 10 minutes of starting.", bonus: 15 },
  { id: "triple-threat", name: "Triple Threat", desc: "Learn three distinct skills.", bonus: 20 },
  { id: "masters-mark", name: "Master's Mark", desc: "Average rating 4.5+ across two or more finished skills.", bonus: 30 },
];

const QUICK_STUDY_MS = 10 * 60 * 1000;

export function emptyProfile(): LearnerProfile {
  return { version: 1, name: "", points: 0, skills: {}, badges: [], openSession: null };
}

export function tierFor(points: number): Tier {
  let tier = TIERS[0];
  for (const candidate of TIERS) {
    if (points >= candidate.at) tier = candidate;
  }
  return tier;
}

export function nextTier(points: number): Tier | null {
  for (const candidate of TIERS) {
    if (candidate.at > points) return candidate;
  }
  return null;
}

// Session rating 1–5 from friction: a step that passes on the first verdict
// without a prior nudge/wrong is clean. Maps clean-step ratio to stars.
export function rateSession(stepCount: number, frictionSteps: string[]): number {
  if (stepCount <= 0) return 1;
  const clean = stepCount - new Set(frictionSteps).size;
  const ratio = clean / stepCount;
  if (ratio >= 1) return 5;
  if (ratio >= 0.8) return 4;
  if (ratio >= 0.6) return 3;
  if (ratio >= 0.4) return 2;
  return 1;
}

function grant(profile: LearnerProfile, id: string): boolean {
  const def = BADGES.find((b) => b.id === id);
  if (!def || profile.badges.includes(id)) return false;
  profile.badges.push(id);
  profile.points += def.bonus;
  return true;
}

function evaluateBadges(profile: LearnerProfile, session?: SessionRecord, rating?: number): string[] {
  const earned: string[] = [];
  const learned = Object.keys(profile.skills).length;
  if (learned >= 1 && grant(profile, "first-light")) earned.push("first-light");
  if (learned >= 3 && grant(profile, "triple-threat")) earned.push("triple-threat");

  if (session?.completedAt) {
    if (grant(profile, "full-circuit")) earned.push("full-circuit");
    if (session.frictionSteps.length === 0 && grant(profile, "clean-run")) earned.push("clean-run");
    if (session.completedAt - session.startedAt <= QUICK_STUDY_MS && grant(profile, "quick-study")) {
      earned.push("quick-study");
    }
  }

  const rated = Object.values(profile.skills).filter((s) => s.completions > 0);
  if (rated.length >= 2) {
    const avg = rated.reduce((sum, s) => sum + s.bestRating, 0) / rated.length;
    if (avg >= 4.5 && grant(profile, "masters-mark")) earned.push("masters-mark");
  }
  void rating;
  return earned;
}

export interface ProgressEvent {
  earned: string[];
}

function ensureSkill(profile: LearnerProfile, skillId: string, title: string): SkillProgress {
  let skill = profile.skills[skillId];
  if (!skill) {
    skill = {
      skillId,
      title,
      learnedAt: Date.now(),
      passedSteps: [],
      completions: 0,
      cleanRuns: 0,
      bestRating: 0,
    };
    profile.skills[skillId] = skill;
  } else if (title && skill.title !== title) {
    skill.title = title;
  }
  return skill;
}

// Record a finished Learn pipeline. Points once per skill; title refreshes.
export function recordLearn(profile: LearnerProfile, skillId: string, title: string): ProgressEvent {
  const isNew = !profile.skills[skillId];
  ensureSkill(profile, skillId, title || "Untitled skill");
  if (isNew) profile.points += POINTS.learn;
  return { earned: evaluateBadges(profile) };
}

export function startSession(profile: LearnerProfile, skillId: string): void {
  profile.openSession = { skillId, startedAt: Date.now(), frictionSteps: [] };
}

export function recordFriction(profile: LearnerProfile, stepId: string): void {
  const session = profile.openSession;
  if (!session || session.completedAt) return;
  if (!session.frictionSteps.includes(stepId)) session.frictionSteps.push(stepId);
}

// Record a passed checkpoint. Points only the first time each step passes;
// friction flag comes from nudges/wrongs seen before the passing verdict.
export function recordStepPass(profile: LearnerProfile, skillId: string, stepId: string): ProgressEvent {
  const skill = ensureSkill(profile, skillId, profile.skills[skillId]?.title || "Untitled skill");
  if (!skill.passedSteps.includes(stepId)) {
    skill.passedSteps.push(stepId);
    profile.points += POINTS.checkpoint;
  }
  return { earned: [] };
}

export function recordCompletion(profile: LearnerProfile, skillId: string, stepCount: number): ProgressEvent {
  const skill = ensureSkill(profile, skillId, profile.skills[skillId]?.title || "Untitled skill");
  const session = profile.openSession?.skillId === skillId ? profile.openSession : null;
  const friction = session?.frictionSteps ?? [];
  const rating = rateSession(stepCount, friction);
  skill.completions += 1;
  skill.bestRating = Math.max(skill.bestRating, rating);
  profile.points += POINTS.completion;
  if (friction.length === 0) {
    skill.cleanRuns += 1;
    profile.points += POINTS.cleanBonus;
  }
  if (session) session.completedAt = Date.now();
  const earned = evaluateBadges(profile, session ?? undefined, rating);
  profile.openSession = null;
  return { earned };
}

// --- Persistence: a localStorage snapshot of the same shape. -------------

const STORAGE_KEY = "showonce.learner.v1";

export function loadProfile(): LearnerProfile {
  try {
    if (typeof window === "undefined") return emptyProfile();
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyProfile();
    const parsed = JSON.parse(raw) as LearnerProfile;
    if (parsed?.version !== 1 || typeof parsed.points !== "number") return emptyProfile();
    return { ...emptyProfile(), ...parsed };
  } catch {
    return emptyProfile();
  }
}

export function saveProfile(profile: LearnerProfile): void {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // Private mode or quota: progress stays in memory for the session.
  }
}
