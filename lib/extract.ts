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

// Extract ~1fps frames plus the mono 16kHz audio track for transcription.
export async function extractMedia(skillDirPath: string, framesPerSecond: number): Promise<Extraction> {
  const clipPath = path.join(skillDirPath, "clip.mp4");
  const framesDir = path.join(skillDirPath, "frames");
  const audioPath = path.join(skillDirPath, "audio.wav");
  await fs.mkdir(framesDir, { recursive: true });

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

  const names = (await fs.readdir(framesDir)).filter((n) => n.endsWith(".jpg")).sort();
  const durationSeconds = await probeDurationSeconds(clipPath);
  const frames: SampledFrame[] = names.map((file, i) => ({
    file,
    index: i,
    atSeconds: framesPerSecond > 0 ? i / framesPerSecond : 0,
  }));
  return { frames, audioPath, durationSeconds };
}
