import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { SampledFrame } from "./skillgraph";

const execFileAsync = promisify(execFile);

export interface Extraction {
  frames: SampledFrame[];
  audioPath: string;
  durationSeconds: number;
}

async function probeDurationSeconds(clipPath: string): Promise<number> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    clipPath,
  ]);
  return Number(stdout.trim());
}

// Pick at most `budget` frames with even temporal coverage: the first and
// last sampled frames are always kept and the rest spread uniformly between
// them. Pure index math, no randomness, so repeated runs over the same clip
// select the same frames and the stub path stays deterministic.
export function selectBudgetedFrames(frames: SampledFrame[], budget: number): SampledFrame[] {
  if (!Number.isInteger(budget) || budget < 1) throw new Error("Frame budget must be a positive integer.");
  if (frames.length <= budget) return frames;
  if (budget === 1) return [frames[0]!];
  const picked: SampledFrame[] = [];
  for (let i = 0; i < budget; i++) {
    picked.push(frames[Math.round((i * (frames.length - 1)) / (budget - 1))]!);
  }
  return picked;
}

// Extract ~1fps frames plus the mono 16kHz audio track for transcription,
// then reduce the frames to the fixed model budget: clips of any length
// cost the model the same. Unselected frame files are deleted so disk use
// stays flat too; the uploaded clip itself is kept for playback. Kept
// frames retain their original timestamps, so the model still sees true
// positions in the clip.
export async function extractMedia(
  skillDirPath: string,
  framesPerSecond: number,
  modelFrameBudget = 60,
): Promise<Extraction> {
  const clipPath = path.join(skillDirPath, "clip.mp4");
  const framesDir = path.join(skillDirPath, "frames");
  const audioPath = path.join(skillDirPath, "audio.wav");
  await fs.mkdir(framesDir, { recursive: true });

  try {
    await execFileAsync("ffmpeg", [
      "-y",
      "-i",
      clipPath,
      "-vf",
      `fps=${framesPerSecond}`,
      "-q:v",
      "3",
      path.join(framesDir, "frame-%04d.jpg"),
    ]);
    await execFileAsync("ffmpeg", [
      "-y",
      "-i",
      clipPath,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      audioPath,
    ]);
  } catch {
    throw new Error("Uploaded clip is not valid video: ffmpeg could not decode it.");
  }

  const names = (await fs.readdir(framesDir)).filter((n) => n.endsWith(".jpg")).sort();
  const durationSeconds = await probeDurationSeconds(clipPath);
  const sampled: SampledFrame[] = names.map((file, i) => ({
    file,
    index: i,
    atSeconds: framesPerSecond > 0 ? i / framesPerSecond : 0,
  }));
  const frames = selectBudgetedFrames(sampled, modelFrameBudget);
  if (frames.length < sampled.length) {
    const kept = new Set(frames.map((frame) => frame.file));
    await Promise.all(
      sampled.filter((frame) => !kept.has(frame.file)).map((frame) => fs.unlink(path.join(framesDir, frame.file))),
    );
  }
  return { frames, audioPath, durationSeconds };
}
