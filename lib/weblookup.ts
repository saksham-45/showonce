// Web skill lookup: given a typed skill name, find videos to watch and
// written instructions on the net, then distill them into guide steps with
// cited sources. The guide feeds the existing Learn/Coach loop: saving it
// creates a skill whose graph the coach judges frames against.
import { RunBudget, cacheKey, cachedJson } from "./apicache";
import { recordApiCall } from "./usage";
//
// Provider choice mirrors the Learn pipeline. "meta" uses the Meta Model
// API's search grounding (Responses API with the `web_search` tool, per
// https://dev.meta.ai/docs/search-grounding): the model searches the live
// web itself and returns `url_citation` annotations that become the cited
// sources — no separate search index or API key to manage. There is no
// Meta search endpoint to call directly, so where no key is reachable the
// "stub" provider covers the flow offline with deterministic search-shaped
// results (honest search-page links, never fabricated video URLs).

export interface WebVideo {
  title: string;
  url: string;
}

export interface WebArticle {
  title: string;
  url: string;
  snippet: string;
}

export interface GuideStepDraft {
  instruction: string;
  checkpoint: string;
  mistakes: string[];
}

export interface GuideSource {
  title: string;
  url: string;
}

export interface WebGuide {
  query: string;
  summary: string;
  videos: WebVideo[];
  articles: WebArticle[];
  steps: GuideStepDraft[];
  // Every source the guide cites, in first-cited order.
  sources: GuideSource[];
  via: "meta" | "stub";
}

export interface WebLookupProvider {
  lookup(query: string): Promise<WebGuide>;
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isYouTubeUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "").replace(/^m\./, "");
    return host === "youtube.com" || host === "youtu.be";
  } catch {
    return false;
  }
}

function cleanSteps(value: unknown): GuideStepDraft[] {
  if (!Array.isArray(value)) return [];
  const steps: GuideStepDraft[] = [];
  for (const candidate of value.slice(0, 8)) {
    if (typeof candidate !== "object" || candidate === null) continue;
    const step = candidate as Record<string, unknown>;
    if (typeof step.instruction !== "string" || step.instruction.trim().length === 0) continue;
    if (typeof step.checkpoint !== "string" || step.checkpoint.trim().length === 0) continue;
    const mistakes = Array.isArray(step.mistakes)
      ? step.mistakes.filter((m): m is string => typeof m === "string" && m.length > 0).slice(0, 4)
      : [];
    steps.push({ instruction: step.instruction.trim(), checkpoint: step.checkpoint.trim(), mistakes });
  }
  return steps;
}

function dedupeSources(sources: GuideSource[]): GuideSource[] {
  const seen = new Set<string>();
  const out: GuideSource[] = [];
  for (const source of sources) {
    if (!isHttpUrl(source.url) || seen.has(source.url)) continue;
    seen.add(source.url);
    out.push({ title: source.title || source.url, url: source.url });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Meta provider: Responses API search grounding.
// ---------------------------------------------------------------------------

const LOOKUP_PROMPT = (query: string) =>
  [
    `A learner wants to learn this physical skill from videos and written instructions: "${query}".`,
    "Search the web for the best YouTube videos to watch and the best written how-to instructions to read.",
    "Then distill everything into a short step-by-step coaching guide for a beginner.",
    "Reply with JSON only, exactly this shape:",
    '{"summary": string, "videos": [{"title": string, "url": string}],',
    '"articles": [{"title": string, "url": string, "snippet": string}],',
    '"steps": [{"instruction": string, "checkpoint": string, "mistakes": string[]}]}.',
    "Rules: 2-4 videos, each a real youtube.com/watch or youtu.be URL you actually found — never invent one;",
    "2-4 articles with one-sentence snippets; 4-6 steps, each instruction one sentence,",
    "each checkpoint the exact visual to check before moving on, each mistakes list 2-3 common errors;",
    "summary one paragraph naming what the sources agree on.",
  ].join(" ");

interface ResponsesOutputText {
  type: string;
  text?: string;
  annotations?: { type?: string; url?: string; title?: string }[];
}

interface ResponsesItem {
  type?: string;
  results?: { url?: string; title?: string }[];
  content?: ResponsesOutputText[];
}

export class MetaLookupProvider implements WebLookupProvider {
  constructor(
    private apiBase: string,
    private apiKey: string,
    private budget: RunBudget = RunBudget.unlimited(),
  ) {}

  // One Responses call per distinct query: the raw Responses body is
  // cached under the normalized query, so case/whitespace variants of a
  // repeated test query share one call. Parsing still runs every time, so
  // validation stays exact and the guide echoes the current spelling.
  async lookup(query: string): Promise<WebGuide> {
    const key = cacheKey({
      model: "muse-spark-1.3",
      kind: "lookup",
      query: query.trim().toLowerCase().replace(/\s+/g, " "),
    });
    const { value: body } = await cachedJson<{ output?: ResponsesItem[] }>("lookup", key, async () => {
      this.budget.consume("muse-spark web lookup");
      recordApiCall("muse-spark-1.3");
      const res = await fetch(`${this.apiBase}/responses`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "muse-spark-1.3",
          input: LOOKUP_PROMPT(query),
          tools: [{ type: "web_search" }],
          include: ["web_search_call.results"],
        }),
        signal: AbortSignal.timeout(90_000),
      });
      if (!res.ok) {
        throw new Error(`Meta API web lookup failed: ${res.status} ${await res.text()}`);
      }
      try {
        return (await res.json()) as { output?: ResponsesItem[] };
      } catch {
        throw new Error("Meta API web lookup returned a non-JSON response.");
      }
    });
    const output = Array.isArray(body.output) ? body.output : [];

    const texts: string[] = [];
    const citations: GuideSource[] = [];
    const considered: GuideSource[] = [];
    for (const item of output) {
      if (item.type === "web_search_call" && Array.isArray(item.results)) {
        for (const hit of item.results) {
          if (hit && typeof hit.url === "string") {
            considered.push({ title: typeof hit.title === "string" ? hit.title : hit.url, url: hit.url });
          }
        }
      }
      if (item.type === "message" && Array.isArray(item.content)) {
        for (const block of item.content) {
          if (block.type !== "output_text" || typeof block.text !== "string") continue;
          texts.push(block.text);
          for (const annotation of block.annotations ?? []) {
            if (annotation.type === "url_citation" && typeof annotation.url === "string") {
              citations.push({ title: annotation.title ?? annotation.url, url: annotation.url });
            }
          }
        }
      }
    }
    const raw = texts.join("\n").trim();
    if (!raw) throw new Error("Meta API web lookup returned no answer text.");
    let parsed: { summary?: unknown; videos?: unknown; articles?: unknown; steps?: unknown };
    try {
      parsed = JSON.parse(raw) as typeof parsed;
    } catch {
      throw new Error("Meta API web lookup returned malformed JSON.");
    }

    const videos: WebVideo[] = Array.isArray(parsed.videos)
      ? parsed.videos
          .filter(
            (v): v is { title: string; url: string } =>
              typeof v === "object" &&
              v !== null &&
              typeof (v as { title?: unknown }).title === "string" &&
              isYouTubeUrl((v as { url?: unknown }).url as string),
          )
          .map((v) => ({ title: v.title.trim() || v.url, url: v.url }))
          .slice(0, 4)
      : [];
    const articles: WebArticle[] = Array.isArray(parsed.articles)
      ? parsed.articles
          .filter(
            (a): a is { title: string; url: string; snippet?: string } =>
              typeof a === "object" &&
              a !== null &&
              typeof (a as { title?: unknown }).title === "string" &&
              isHttpUrl((a as { url?: unknown }).url),
          )
          .map((a) => ({
            title: a.title.trim() || a.url,
            url: a.url,
            snippet: typeof a.snippet === "string" ? a.snippet : "",
          }))
          .slice(0, 4)
      : [];
    const steps = cleanSteps(parsed.steps);
    if (videos.length === 0 && articles.length === 0) {
      throw new Error("Meta API web lookup cited no usable sources.");
    }
    if (steps.length === 0) {
      throw new Error("Meta API web lookup returned no guide steps.");
    }
    return {
      query,
      summary: typeof parsed.summary === "string" ? parsed.summary : "",
      videos,
      articles,
      steps,
      // Cited passages first, then the rest of what the model considered.
      sources: dedupeSources([...citations, ...considered]),
      via: "meta",
    };
  }
}

// ---------------------------------------------------------------------------
// Stub provider: deterministic offline cover for the lookup flow. Links go
// to live search pages for the query (YouTube, Wikipedia, DuckDuckGo) so a
// learner can still continue by hand — it never invents video URLs.
// ---------------------------------------------------------------------------

const STUB_MISTAKES = [
  "Rushing the transition into this phase",
  "Holding your breath instead of moving steadily",
  "Mirroring the wrong side",
];

export class StubLookupProvider implements WebLookupProvider {
  async lookup(query: string): Promise<WebGuide> {
    const q = query.trim();
    const encoded = encodeURIComponent(q);
    const videos: WebVideo[] = [
      { title: `YouTube: ${q} tutorial`, url: `https://www.youtube.com/results?search_query=${encodeURIComponent(`${q} tutorial`)}` },
      { title: `YouTube: ${q} for beginners`, url: `https://www.youtube.com/results?search_query=${encodeURIComponent(`${q} for beginners`)}` },
    ];
    const articles: WebArticle[] = [
      {
        title: `Wikipedia: ${q}`,
        url: `https://en.wikipedia.org/w/index.php?search=${encoded}`,
        snippet: `Background reading on ${q}; skim for terms, then watch the movements.`,
      },
      {
        title: `DuckDuckGo: how to ${q}`,
        url: `https://duckduckgo.com/?q=${encodeURIComponent(`how to ${q}`)}`,
        snippet: `A sweep of written how-tos for ${q}; open two and compare their steps.`,
      },
    ];
    const steps: GuideStepDraft[] = Array.from({ length: 5 }, (_, i) => ({
      instruction: `Phase ${i + 1}: study how the ${q} sources show this part, then copy it slowly.`,
      checkpoint: `Your pose matches the phase-${i + 1} pictures in the sources above.`,
      mistakes: [...STUB_MISTAKES],
    }));
    return {
      query: q,
      summary: `Start with the two video searches for ${q}, read both written guides, then work the five phases in order — each checkpoint tells you what to match before moving on.`,
      videos,
      articles,
      steps,
      sources: dedupeSources([
        ...videos.map((v) => ({ title: v.title, url: v.url })),
        ...articles.map((a) => ({ title: a.title, url: a.url })),
      ]),
      via: "stub",
    };
  }
}
