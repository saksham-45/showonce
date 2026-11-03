# ShowOnce

Learn any physical skill from one video — then a real-time AI coach watches you back.

Record a 60-second clip of an expert doing a physical task. ShowOnce studies it into a
step-by-step skill graph, then coaches you live over the camera: every few seconds a still
frame is judged against the current step and a spoken correction tells you what to fix until
every checkpoint passes and the completion badge lights. You can also just type a skill name
and jump straight into coaching its video.

Built for the Meta Global AI Developer Hackathon 2026 (indie track) on the Meta Model API:
Muse Spark reasoning, SAM 3.1 video segmentation, Muse Image corrective references, and
Muse Voice transcription.

## Run it

```sh
npm install
npm run build
npm run start -- -p 3000
```

Open [http://localhost:3000](http://localhost:3000) in a browser, upload a clip, press
“Run Learn pipeline”, then open the Coach view and press “Start coaching”. The Meta path
needs a key:

```sh
export META_API_KEY="..."
export SHOWNCE_PROVIDER=meta # default; "stub" runs the deterministic local stand-in
export SHOWNCE_CLIP=/path/to/expert-clip.mp4 # optional: proof clip used by the smoke scripts
```

The key is read from `META_API_KEY` (Next.js also loads it from `.env.local`) and is never
committed. `SHOWNCE_DATA_DIR` overrides the per-skill storage root. Swapping the placeholder
clip for the real expert clip is config-only: set `SHOWNCE_CLIP` or upload through the form —
no code change.

## Demo script (2 minutes)

1. Home: upload an expert clip with a title, or type a learned skill name to find its
   session.
2. Skill page: press “Run Learn pipeline”. Five steps appear, each with a checkpoint, a
   keyframe from the clip, and a generated corrective reference image.
3. Coach view: press “Start coaching” and try the task in front of the camera. The status
   pill reads Live while frames stream through segment → judge → verdict; hiccups show
   Retrying with backoff instead of freezing.
4. Each passed checkpoint fills one progress segment. All five light the completion badge
   (with spoken confirmation).

## How it works

Learn pipeline (`lib/pipeline.ts`), five stages for one uploaded clip. Nothing in the
pipeline, coach, or UI branches on the skill: the graph schema is generic, the stub
stand-in splits any clip into configured timed phases, and the Meta path lets the model
infer steps for whatever the clip shows.

1. Upload stores the clip with a skill id (`POST /api/skills`, 200 MB cap, video-only).
2. `lib/extract.ts` samples frames at ~1 fps and the mono 16 kHz audio track via ffmpeg.
3. `MetaProvider` (`lib/providers.ts`) segments frames with `sam-3.1` and transcribes
   narration with `muse-voice-transcribe-1.0`.
4. `muse-spark-1.3` fuses frames, masks, and transcript into `skill-graph.json` (title plus
   steps with id, instruction, checkpoint, keyframe, mistakes).
5. `muse-image-1.0` generates one corrective reference image per step. Everything persists
   per skill under `public/skills/<skillId>/` and serves from disk through the skill-assets
   route (`next.config.ts` rewrites), so a freshly learned skill plays without restarting
   the server.

Real-time coach (`lib/coach.ts`, `app/coach/[id]/page.tsx`):

- A still frame is captured every 2.5 s and compared against the current step. Ticks never
  overlap and never fire inside a backoff window — a slow model delays the next judgement
  instead of piling up blocked requests.
- `POST /api/skills/[id]/coach` answers JSON by default (`{ verdict, correction, advance }`),
  or newline-delimited progress events (`received → segmenting → judging → verdict` with
  `via: meta|stub`) when sent `Accept: application/x-ndjson` — Route Handler streaming via
  a `ReadableStream` response.
- Every Meta call is time-bounded (`SEGMENT_TIMEOUT_MS` 15 s, `JUDGE_TIMEOUT_MS` 25 s,
  client backstop 50 s); failures and timeouts fall back to the deterministic stub verdict
  so the loop keeps moving.
- Network failures back off exponentially (1 s → 8 s cap) with an explicit Retrying state;
  the UI always shows one of Idle / Live / Retrying plus the current phase and whether the
  verdict came via Meta live or the local stand-in.
- Typed entry (`lib/skillmatch.ts`, `SkillFinder` component): type a skill name to rank the
  learned sessions (exact → prefix → substring → token overlap) and jump to coaching.

With no key present, the stub providers run the whole flow deterministically: 5-step paper
airplane graph, pass-on-visible-frame coaching, and the badge.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `META_API_KEY` | — (required for `meta`) | Bearer [REDACTED] Meta Model API, also read from `.env.local` |
| `SHOWNCE_PROVIDER` | `meta` | `meta` for live models, `stub` for deterministic local proof |
| `SHOWNCE_STEPS` | `5` | Phases the stub stand-in splits any clip into (1–12; the Meta path lets the model decide) |
| `SHOWNCE_CLIP` | — | Expert clip path; used by the smoke scripts when set |
| `SHOWNCE_SMOKE_CLIP` | — | Clip file for `scripts/smoke-*.sh` (falls back to `SHOWNCE_CLIP`) |
| `SHOWNCE_DATA_DIR` | `public/skills` | Per-skill storage root (proof runs point it at a temp dir) |
| `META_API_BASE` | `https://api.meta.ai/v1` | Meta Model API base URL |

## Rewards

Points, tiers, badges, and ratings (`lib/progress.ts`) are earned only through real
activity recorded where it happens: a finished Learn pipeline (+10), a passed checkpoint
(+5, once per step), a full circuit (+25, clean bonus +15). Tiers run Rookie (0) →
Driller (40) → Polished (120) → Master (250). Six badges — First Light, Full Circuit,
Clean Run, Quick Study, Triple Threat, Master's Mark — carry point bonuses and show on
your profile. Each finished skill rates 1–5 from friction (nudges/misses before passing);
the profile keeps your best per skill and averages toward Master's Mark. The
[Library](/skills) and [Profile](/profile) pages read the API plus your local record —
nothing is mocked.

## Interface polish

The Meta-blue world, real-time coach behavior, reward system, and generic
pipeline are fixed points; this section records the feel conventions added
on top of them so later edits stay consistent.

Feel system (`app/globals.css`): nested radii step down (16 → 12 → 8) so
cards, controls, and in-card images stay concentric; live numbers and state
labels use tabular numerals; buttons press to 0.96 and every transition
names explicit properties (never `transition: all`) so mid-gesture
interruptions stay smooth; step rails and badge shelves stagger in at
~80 ms per chunk with a soft 14 px rise, and `prefers-reduced-motion`
disables all of it; interactive targets clear 40 px (44 px for buttons and
finder rows); headings balance-wrap while body copy pretty-wraps.

Loading-first states: home, library, skill, and profile each render a
loading line before their listing resolves, so a slow fetch never flashes
a false empty state; errors announce through `role="alert"`, retry and
finder notes through `role="status"`, and the coach phase line through a
polite live region. Landmarks: a skip link, a current-section nav mark
(`SiteNav`), a labeled camera preview, and an `aria-current="step"`
checklist item. Below-fold skill imagery lazy-loads with async decoding.
Responsive: session rows wrap, the tier rail scrolls horizontally, the
profile name form stacks, and the oversized step numeral shrinks — all at
the existing 640 px / 480 px breakpoints.

## Verify it

```sh
npm install
npm run build
SHOWNCE_PROVIDER=stub npm run start -- -p 3000 &
SHOWNCE_SMOKE_CLIP=path/to/clip.mp4 sh scripts/smoke-learn.sh http://localhost:3000
SHOWNCE_SMOKE_CLIP=path/to/clip.mp4 sh scripts/smoke-coach.sh http://localhost:3000
```

`smoke-learn.sh` proves the Learn end to end (5-step graph validates, clip/keyframes/
references serve for a skill learned after boot) plus upload and pipeline edge cases,
and that the Library and Profile surfaces render.
`smoke-coach.sh` proves correct/nudge/wrong verdicts, the four error cases, the NDJSON
stream phases, and all 5 steps advancing — the same progression that lights the badge.
`smoke-generalize.sh` learns two distinct clips plus a micro-clip through the same
unmodified path (asserting only the generic graph contract) and proves a corrupt clip
fails gracefully with a clear 400. Distinct fixtures come from
`scripts/make-placeholder-clip.sh` (`PHASES`, `PHASE_SECS`, `HUE_BASE`, `FREQ_BASE` tune
phases, length, look, and sound).

Status: Learn plus real-time Coach run end to end on the stub providers in production
builds; the live one-skill Meta proof runs when `META_API_KEY` is reachable.
