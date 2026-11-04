// Deterministic Meta API response cache plus per-run call budgets.
//
// Identical inputs hash to identical keys, so identical reruns (the norm
// across test runs) make zero new HTTP calls: memory first, then the file
// cache, then one shared in-flight fetch for concurrent duplicates. The
// Meta request shapes stay exact — a cache miss sends byte-for-byte what
// the uncached path would have sent.
//
// The file cache is best-effort: read/write failures fall through to a
// live call, so read-only hosts (packaged desktop resources) simply run
// uncached. `SHOWNCE_CACHE=off` disables both layers; the in-process
// in-flight map still dedups concurrent duplicates within a run.

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { recordCacheHit, recordCacheMiss, recordDedupHit } from "./usage";

export function sha256Hex(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

// Canonical JSON: object keys sorted recursively, so equivalent inputs
// hash equally regardless of key insertion order. Deterministic output
// for the same logical input is what makes reruns cache-hit.
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function cacheKey(parts: Record<string, unknown>): string {
  return sha256Hex(canonical(parts));
}

export function cacheEnabled(): boolean {
  return process.env.SHOWNCE_CACHE !== "off";
}

// File cache root. Defaults to a dot-directory at the process root (never
// under public/, so cached model responses are not web-served); proof runs
// point it at a temp dir. Failures are non-fatal by contract.
export function cacheRoot(): string {
  return process.env.SHOWNCE_CACHE_DIR ?? path.join(process.cwd(), ".showonce-cache");
}

function safeNamespace(namespace: string): string {
  if (!/^[a-z0-9-]+$/.test(namespace)) throw new Error(`Bad cache namespace '${namespace}'.`);
  return namespace;
}

function safeKey(key: string): string {
  if (!/^[0-9a-f]{16,128}$/.test(key)) throw new Error("Bad cache key.");
  return key;
}

async function readCacheFile(namespace: string, key: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(path.join(cacheRoot(), safeNamespace(namespace), `${safeKey(key)}.bin`));
  } catch {
    return null;
  }
}

async function writeCacheFile(namespace: string, key: string, bytes: Buffer): Promise<void> {
  try {
    const dir = path.join(cacheRoot(), safeNamespace(namespace));
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, `${safeKey(key)}.bin`), bytes);
  } catch {
    // Best-effort: a read-only host runs uncached rather than failing.
  }
}

const memory = new Map<string, Buffer>();
const inflight = new Map<string, Promise<Buffer>>();

// Fetch bytes through the cache layers. Resolves with the bytes and
// whether any new work happened (hit false means the caller just ran fn).
export async function cachedBytes(
  namespace: string,
  key: string,
  fn: () => Promise<Buffer>,
): Promise<{ bytes: Buffer; hit: boolean }> {
  const full = `${namespace}/${key}`;
  const remembered = memory.get(full);
  if (remembered) {
    recordCacheHit();
    return { bytes: remembered, hit: true };
  }
  if (cacheEnabled()) {
    const fromDisk = await readCacheFile(namespace, key);
    if (fromDisk) {
      memory.set(full, fromDisk);
      recordCacheHit();
      return { bytes: fromDisk, hit: true };
    }
  }
  const pending = inflight.get(full);
  if (pending) {
    recordDedupHit();
    return { bytes: await pending, hit: true };
  }
  recordCacheMiss();
  const task = (async () => {
    const bytes = await fn();
    memory.set(full, bytes);
    if (cacheEnabled()) await writeCacheFile(namespace, key, bytes);
    return bytes;
  })();
  inflight.set(full, task);
  try {
    return { bytes: await task, hit: false };
  } finally {
    inflight.delete(full);
  }
}

// JSON convenience over cachedBytes. T must survive a JSON round trip.
export async function cachedJson<T>(namespace: string, key: string, fn: () => Promise<T>): Promise<{ value: T; hit: boolean }> {
  const { bytes, hit } = await cachedBytes(namespace, key, async () => Buffer.from(JSON.stringify(await fn()), "utf8"));
  return { value: JSON.parse(bytes.toString("utf8")) as T, hit };
}

// ---------------------------------------------------------------------------
// Per-run call budgets. The budget counts attempted HTTP calls (misses
// only — cache hits are free), so a rerun of previously completed work
// succeeds even under a tight cap. Tripping the cap throws ApiCapError,
// which the routes translate to a 429 with the cap named: a clear UI
// state, never a silent wrong output.
// ---------------------------------------------------------------------------

export class ApiCapError extends Error {
  constructor(
    readonly used: number,
    readonly cap: number,
    readonly what: string,
  ) {
    super(
      `API call cap exceeded: ${used}/${cap} Meta calls used, refusing ${what}. ` +
        `Raise SHOWNCE_API_CALL_CAP for bigger runs; identical reruns are cache hits and cost nothing.`,
    );
    this.name = "ApiCapError";
  }
}

export class RunBudget {
  private used = 0;

  constructor(private cap: number) {}

  static unlimited(): RunBudget {
    return new RunBudget(Number.POSITIVE_INFINITY);
  }

  consume(what: string): void {
    if (this.used >= this.cap) throw new ApiCapError(this.used, this.cap, what);
    this.used += 1;
  }

  get usedCount(): number {
    return this.used;
  }
}
