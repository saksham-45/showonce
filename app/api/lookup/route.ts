import { NextResponse } from "next/server";
import { ApiCapError, RunBudget } from "@/lib/apicache";
import { loadConfig } from "@/lib/config";
import { logRunLine, recordLookupRun, usageSnapshot } from "@/lib/usage";
import { MetaLookupProvider, StubLookupProvider } from "@/lib/weblookup";

// POST /api/lookup — search the net for one typed skill: videos to watch,
// written instructions to read, distilled into guide steps with cited
// sources. The stub provider covers the flow offline; the Meta provider
// searches via Responses API grounding and needs META_API_KEY.
export const maxDuration = 120;

export async function POST(request: Request) {
  let body: { query?: unknown };
  try {
    body = (await request.json()) as { query?: unknown };
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }
  const query = typeof body.query === "string" ? body.query.trim().replace(/\s+/g, " ") : "";
  if (!query) {
    return NextResponse.json({ error: "Type a skill to search for." }, { status: 400 });
  }
  if (query.length > 140) {
    return NextResponse.json({ error: "Keep the skill search under 140 characters." }, { status: 400 });
  }

  const config = loadConfig();
  recordLookupRun();
  const before = usageSnapshot();
  const runLine = (status: string) => {
    const after = usageSnapshot();
    logRunLine(
      `lookup status=${status} ` +
        `apiCalls=${after.apiCalls.total - before.apiCalls.total} ` +
        `cacheHits=${after.cacheHits - before.cacheHits}`,
    );
  };
  try {
    if (config.provider === "stub") {
      const guide = await new StubLookupProvider().lookup(query);
      runLine("ok-stub");
      return NextResponse.json(guide);
    }
    if (!config.apiKey) {
      return NextResponse.json(
        {
          error:
            "Web lookup needs META_API_KEY (or set SHOWNCE_PROVIDER=stub for local proof). Put the key in the META_API_KEY environment variable or .env.local; it is never committed.",
        },
        { status: 400 },
      );
    }
    const guide = await new MetaLookupProvider(
      config.apiBase,
      config.apiKey,
      new RunBudget(config.apiCallCap),
    ).lookup(query);
    runLine("ok");
    return NextResponse.json(guide);
  } catch (error) {
    if (error instanceof ApiCapError) {
      runLine("cap");
      return NextResponse.json({ error: error.message }, { status: 429 });
    }
    runLine("failed");
    const message = error instanceof Error ? error.message : "Web lookup failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
