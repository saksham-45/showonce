# ShowOnce

Learn any physical skill from one video — then an AI coach watches you back.

Record a 60-second clip of an expert doing a physical task. ShowOnce studies
it and turns it into a live coach: prop up your phone, try the task, and get
spoken corrections as you go until every step checks off.

Built for the Meta Global AI Developer Hackathon 2026 (indie track) on the
Meta Model API: Muse Spark reasoning, SAM 3.1 video segmentation,
Muse Image corrective references, and Muse Voice transcription.

## Learn pipeline

Stack: Next.js App Router + TypeScript. The server-side pipeline
(`lib/pipeline.ts`) runs the Learn stages end to end for one uploaded clip:

1. Upload stores the clip with a skill id (`POST /api/skills`).
2. `lib/extract.ts` samples frames at ~1fps and the audio track via ffmpeg.
3. `lib/providers.ts` (`MetaProvider`) segments frames with `sam-3.1`.
4. The same provider transcribes narration with `muse-voice-transcribe-1.0`.
5. `muse-spark-1.3` fuses frames, masks, and transcript into `skill-graph.json`
   (title plus steps with id, instruction, checkpoint, keyframe, mistakes).
6. `muse-image-1.0` generates one corrective reference image per step.
7. Everything persists per skill under `public/skills/<skillId>/`; the skill
   page (`/skills/<id>`) shows the clip, steps, keyframes, and references.
   The clip and images are served from disk through the skill-assets route
   (see the `next.config.ts` rewrites), so a freshly learned skill plays
   without restarting the server.

Run it:

```sh
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in a browser, upload a
clip, then press "Run Learn pipeline". The API needs a key:

```sh
export META_API_KEY="..."
export SHOWNCE_PROVIDER=meta # default; "stub" runs the deterministic local stand-in
export SHOWNCE_CLIP=/path/to/expert-clip.mp4 # optional placeholder source
```

The key is read from `META_API_KEY` or `.env.local` and is never committed.
`SHOWNCE_DATA_DIR` overrides the per-skill storage root.
Swapping the placeholder clip for the real expert clip is config-only:
set `SHOWNCE_CLIP` or upload through the form.

## Coach loop

The skill page links to its Coach view (`/coach/<id>`). The coach page
(`app/coach/[id]/page.tsx`) loads the learned graph, starts the camera on
"Start coaching", and judges one still frame every 3 seconds against the
current step (`POST /api/skills/[id]/coach` with `{ stepId, frame }`, where
frame is a JPEG data URL or bare base64). The endpoint replies with
`{ verdict: correct|nudge|wrong, correction, advance }`; `correct` checks
the step off and moves on, `nudge`/`wrong` hold the learner with a spoken
correction. `lib/coach.ts` (`compareSkillFrame`) runs the stub-first
deterministic compare when no key is present and the Meta path (SAM 3.1 plus
Spark vision against the checkpoint and reference image) when one is, with a
stub fallback so one failed model call never freezes the live loop. All five
checkpoints passing lights the completion badge.

Smoke it:

```sh
SHOWNCE_SMOKE_CLIP=path/to/clip.mp4 sh scripts/smoke-coach.sh http://localhost:3000
```

Status: Learn plus Coach both run end to end on the stub providers; the live
one-skill Meta proof runs when `META_API_KEY` is reachable.
