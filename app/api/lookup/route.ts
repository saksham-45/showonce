import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/config";
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
  try {
    if (config.provider === "stub") {
      return NextResponse.json(await new StubLookupProvider().lookup(query));
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
    return NextResponse.json(await new MetaLookupProvider(config.apiBase, config.apiKey).lookup(query));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Web lookup failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
