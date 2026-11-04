# ShowOnce

Learn any physical skill from one video — then a real-time AI coach watches you back.

Record a clip of an expert doing a physical task — any length. ShowOnce studies it into a
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
npm run start
```

`npm run start` serves the staged standalone server on port 3000 (`PORT=3101
npm run start` to change it).

Open [http://localhost:3000](http://localhost:3000) in a browser, upload a clip, press
“Run Learn pipeline”, then open the Coach view and press “Start coaching”. Or skip the
clip: the home page “Learn from the web” search finds videos and written guides for a
typed skill and coaches you through the distilled steps. The Meta path
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

1. Upload stores the clip with a skill id (`POST /api/skills`, 200 MB cap, video-only, any length).
2. `lib/extract.ts` samples frames at ~1 fps and the mono 16 kHz audio track via ffmpeg, then reduces the frames to a fixed model budget (default 60, `SHOWNCE_MODEL_FRAMES`): long clips keep even temporal coverage with original timestamps, so model cost stays flat while input length is free.
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

Web skill lookup (`lib/weblookup.ts`, `WebLookup` component, `POST /api/lookup`): type a
skill you have no clip for and ShowOnce searches the net for videos to watch (YouTube) and
written instructions to read, then distills them into guide steps with cited sources.
Saving (`POST /api/skills/from-guide`) creates a clip-free skill whose steps, persisted
sources (`GET /api/skills/[id]/guide`), and existing coach loop work exactly like a
clip-learned one — placeholder keyframe/reference art stands in for extracted frames.
The Meta path searches through the Model API itself: a Responses API call with the
`web_search` tool (per the search-grounding docs) lets the model search the live web and
return `url_citation` annotations, which become the cited sources — no separate search
service or API key. Where no key is reachable, the stub covers the flow offline with
deterministic search-page links (never invented video URLs).

With no key present, the stub providers run the whole flow deterministically: 5-step paper
airplane graph, pass-on-visible-frame coaching, and the badge.

## API cost budgeting

Same features, fewer and smarter calls. Per Learn run the Meta path costs at most one
segmentation call per budgeted frame, one transcription, one fuse, and one reference image
per step (a default run: 60 + 1 + 1 + ~5); the coach costs two calls per judged tick and
web lookup costs one Responses call per distinct query.
Four mechanisms keep that number down across repeated test runs.
Fixed input budgets extend the frame-budget pattern: transcript characters
(`SHOWNCE_TRANSCRIPT_CHARS`) and regions per frame (`SHOWNCE_REGIONS_PER_FRAME`) sent to
the fuse call are capped deterministically, so narration length and scene clutter are free.
A deterministic response cache (`lib/apicache.ts`, `SHOWNCE_CACHE_DIR`) keyed by input
hash means identical reruns make zero new calls — file-backed across restarts, shared
in-flight within a run; the Meta request shapes are byte-identical on a miss.
Request dedup covers what the cache cannot: duplicate frames inside one Learn run share
one segmentation, and the coach reuses the last verdict for an identical step + frame
inside `SHOWNCE_COACH_DEDUP_MS`.
A configurable per-run cap (`SHOWNCE_API_CALL_CAP`, default frames + 64) counts attempted
calls only — cache hits are free, so reruns succeed under tight caps — and tripping it
fails fast with a 429 naming the cap, surfaced by the existing error states; the coach
keeps its stub fallback with its `via` marker.
No Meta endpoint here takes a batch of items (SAM segments one image, generations
renders one prompt), so batching has no supported shape; the budget + cache + dedup
combination is the batching-equivalent saving.
Usage is visible, never blind: every Learn/Lookup run logs one `[showonce-usage]` line
with its call and hit counts, `GET /api/usage` reports cumulative calls by model plus
budgeted input totals since boot, and the home page carries an API-usage section fed by
that endpoint.
Token totals are deliberately not reported: the responses used here do not guarantee a
usage field, so the ledger records calls, frames, transcript characters, and image
counts instead of inventing token numbers.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `META_API_KEY` | — (required for `meta`) | Bearer [REDACTED] Meta Model API, also read from `.env.local` |
| `SHOWNCE_PROVIDER` | `meta` | `meta` for live models, `stub` for deterministic local proof |
| `SHOWNCE_STEPS` | `5` | Phases the stub stand-in splits any clip into (1–12; the Meta path lets the model decide) |
| `SHOWNCE_MODEL_FRAMES` | `60` | Max sampled frames sent to the model per Learn run (8–240); longer clips are evenly downsampled to this budget |
| `SHOWNCE_TRANSCRIPT_CHARS` | `8000` | Max transcript characters sent to the fuse call (1000–48000); longer narration is cut to a leading prefix of segments |
| `SHOWNCE_REGIONS_PER_FRAME` | `20` | Max segmentation regions per frame sent to the fuse call (1–100); kept by score, highest first |
| `SHOWNCE_API_CALL_CAP` | frames + 64 | Max attempted Meta calls per Learn or Lookup run (1–10000); tripping it answers 429 naming the cap |
| `SHOWNCE_COACH_DEDUP_MS` | `30000` | Window in which an identical step + frame reuses the last verdict with zero new calls (0 disables, max 300000) |
| `SHOWNCE_CACHE` | on | Set to `off` to disable the deterministic Meta response cache (memory + `.showonce-cache/`) |
| `SHOWNCE_CACHE_DIR` | `.showonce-cache/` | Override for the Meta response cache directory (proof runs point it at a temp dir) |
| `SHOWNCE_CLIP` | — | Expert clip path; used by the smoke scripts when set |
| `SHOWNCE_SMOKE_CLIP` | — | Clip file for `scripts/smoke-*.sh` (falls back to `SHOWNCE_CLIP`) |
| `SHOWNCE_DATA_DIR` | `public/skills` | Per-skill storage root (proof runs point it at a temp dir) |
| `META_API_BASE` | `https://api.meta.ai/v1` | Meta Model API base URL |

## Desktop app

The same Next.js app ships as a macOS and Windows desktop shell (`electron/`,
packaged with electron-builder per `electron-builder.yml`). The window is native
chrome, not a website in a viewport: a hidden title bar keeps the platform
window controls (traffic lights on macOS, overlay caption buttons on Windows)
above a drag strip, a sidebar rail replaces the web top bar, and a real app menu
drives the sections.
Shortcuts: `Cmd/Ctrl+1` Learn, `Cmd/Ctrl+2` Library, `Cmd/Ctrl+3` Profile,
`Cmd/Ctrl+O` Import expert clip (opens the drop zone, navigating home first),
plus the standard Edit roles so web inputs behave, and View roles for reload
and zoom.
Native notifications announce finished Learn runs, passed checkpoints while the
coach tab is in the background, and full circuits with earned badges.
Window bounds persist across launches (`showonce-window.json` in the per-user
app-data folder, with an off-screen fallback to a centered default), a second
launch focuses the running window, and a local loading page covers the boot gap
with an explicit error state if the bundled server never answers.
An offline banner names what still works without a connection (learned skills
and the coach on this machine) instead of failing silently.
The window loads the
local dev server in development and the bundled standalone server in production,
so Learn, Coach, and web lookup behave exactly like the browser build.

```sh
npm run electron:dev  # starts next dev, waits for it, then opens the desktop shell
npm run dist:mac      # unsigned-by-default .dmg + .zip in dist/ (macOS)
npm run dist:win      # .exe installer + .zip in dist/ (Windows)
```

Windows packaging is produced by committed CI (`.github/workflows/desktop.yml` builds
both platforms and uploads the artifacts); local Windows builds work wherever the
Electron toolchain runs. Unsigned dev builds are acceptable for submission and never
block: macOS signs with a local Developer ID when one exists and skips notarization,
and the build needs no signing credentials to succeed.

Packaging notes: `npm run build` stages the standalone server (standalone JS trace
plus copied `public/` and `.next/static/`) so the packaged app starts with no dev
install; `next.config.ts` keeps `dist/` out of the trace so repeat builds never nest
previous outputs. The shell points `SHOWNCE_DATA_DIR` at the per-user app-data folder
unless it is already set, because the bundled resources are read-only. App icon and
camera rationale ship in the package: `electron/icon.png` is the committed source
(regenerated by `node electron/make-icons.mjs`), `icon.icns`/`icon.ico` are its
converted forms, and the macOS build declares the camera usage string coaching needs
for its permission prompt. `SHOWNCE_ELECTRON_SMOKE=1` boots the packaged app without
a window for `scripts/smoke-electron.sh`.

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

The quiet-premium world, real-time coach behavior, reward system, and generic
pipeline are fixed points; this section records the feel conventions added
on top of them so later edits stay consistent.
The old Meta-blue theme is the anti-reference: no gradients, no blue-forward
accents, no glow shadows anywhere in the app or the shell.
Palette is restrained neutrals (paper, paper-2, ink, hairline borders) with one
quiet botanical accent reserved for live state, progress, and focus; primary
actions are ink slabs, everything else is a hairline ghost.
Headlines are set in Fraunces (sentence case, never shouty uppercase), reading
in Newsreader, data and state in IBM Plex Mono with tabular numerals.
Uploads land on a real drop zone (drag anywhere onto the well, browse as
fallback, file chip with size and remove) rather than a bare file row.

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

Voice search (`VoiceMicButton`, used by `SkillFinder` and `WebLookup`): a mic
control beside each typed query fills the field via the Web Speech API
(Chrome/Edge). The typed field always stays as fallback; browsers without
recognition, denied mic permission, and recognition errors each render an
explicit inline state, recognition starts only on an explicit press, and
results announce through a polite live region. The coach page adds a mute
toggle for spoken corrections (stored as `showonce-coach-muted` in
localStorage): pages stay silent where speech synthesis is missing, and the
learner can silence it where present. Headless smokes prove the typed
fallback plus the no-voice states; the mic itself needs a manual pass
(see the PR body checklist).

## Verify it

```sh
npm install
npm run build
PORT=3000 SHOWNCE_PROVIDER=stub npm run start &
SHOWNCE_SMOKE_CLIP=path/to/clip.mp4 sh scripts/smoke-learn.sh http://localhost:3000
SHOWNCE_SMOKE_CLIP=path/to/clip.mp4 sh scripts/smoke-coach.sh http://localhost:3000
sh scripts/smoke-lookup.sh http://localhost:3000
sh scripts/smoke-generalize.sh http://localhost:3000
sh scripts/smoke-cost.sh
npm run dist:mac && sh scripts/smoke-electron.sh
```

`smoke-learn.sh` proves the Learn end to end (5-step graph validates, clip/keyframes/
references serve for a skill learned after boot) plus upload and pipeline edge cases,
and that the Library and Profile surfaces render.
`smoke-coach.sh` proves correct/nudge/wrong verdicts, the four error cases, the NDJSON
stream phases, and all 5 steps advancing — the same progression that lights the badge.
`smoke-generalize.sh` learns two distinct clips plus a micro-clip through the same
unmodified path (asserting only the generic graph contract), proves a multi-minute clip
flows end to end with its full duration preserved while the model frame budget holds,
and proves a corrupt clip fails gracefully with a clear 400. Distinct fixtures come from
`scripts/make-placeholder-clip.sh` (`PHASES`, `PHASE_SECS`, `HUE_BASE`, `FREQ_BASE` tune
phases, length, look, and sound).
`smoke-lookup.sh` proves web search-and-distill end to end on the stub (videos, articles,
5 steps, cited sources), saving the guide as a coachable skill with persisted sources,
and that the guide feeds the existing coach loop; `smoke-electron.sh` proves the packaged
macOS app boots its bundled server and serves the API, an app route, and the home page.
`smoke-desktop.sh http://localhost:3102` proves the native shell and the redesign without
a display: main-process chrome (hidden titlebar, menu, section and import shortcuts,
window-state persistence, single-instance lock, About, loading page), the typed preload
bridge, the renderer shell (drop zone, sidebar rail, offline bar, notification call
sites), zero blue-forward remnants, and that the served prod home carries the new
drop zone while web SSR keeps browser chrome.
`smoke-cost.sh` boots its own servers (stub plus a counting fake Meta API, so it spends
no real key) and proves the budgeting contract: stub flows make zero API calls, a cold
metered Learn costs exactly frames + 1 + 1 + steps with the frame budget holding on a
12-frame clip at budget 8, identical Learn/lookup/coach repeats make zero new calls,
a cap of 2 trips after exactly 2 attempts with a named 429, and `/api/usage` plus the
home section report the cumulative totals.
`smoke-overlap.sh` boots its own stub server and proves the layout contract in a real
headless Chrome (needs `CHROME_BIN`): every route at desktop and phone widths, on the
website and with the desktop-shell class, has no control collisions, no horizontal
overflow, and focused-field outline clearance (regression: the lookup submit button
used to swallow the query input's focused ring).

Status: Learn, real-time Coach, and web lookup run end to end on the stub providers in
production builds, and the packaged macOS app launches green; the live Meta proofs
(one-skill pipeline plus grounded lookup) run when `META_API_KEY` is reachable.
