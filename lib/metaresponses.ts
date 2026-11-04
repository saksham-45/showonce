// Meta Responses API transport shared by the Learn provider
// (`lib/providers.ts`) and the coach judge (`lib/coach.ts`).
//
// Every model call is POST {apiBase}/responses with Bearer [REDACTED]:
// text prompts send {"model", "input": "<prompt>"} while vision and audio
// prompts send {"model", "input": [{role: "user", content: [...]}]} with
// input_text / input_image / input_audio parts. The answer text lives in
// the output[] entry with type "message", in its content[] entry with type
// "output_text". API error objects surface readably (code + message), and
// token usage is recorded when the response carries it.

import { recordTokenUsage } from "./usage";

export type ResponsesInputContent =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string }
  | { type: "input_audio"; input_audio: { data: string; format: string } };

export type ResponsesInput = string | { role: "user"; content: ResponsesInputContent[] }[];

export interface ResponsesBody {
  output?: { type?: unknown; content?: { type?: unknown; text?: unknown }[] }[];
  error?: { code?: unknown; message?: unknown };
  usage?: { input_tokens?: unknown; output_tokens?: unknown };
}

// One text part plus one image part per image, in order: the callers keep
// the live frame first and the reference image second.
export function visionContent(prompt: string, imageDataUrls: string[]): ResponsesInputContent[] {
  return [
    { type: "input_text", text: prompt },
    ...imageDataUrls.map((image_url): ResponsesInputContent => ({ type: "input_image", image_url })),
  ];
}

export function audioContent(prompt: string, mp3Base64: string): ResponsesInputContent[] {
  return [
    { type: "input_text", text: prompt },
    { type: "input_audio", input_audio: { data: mp3Base64, format: "mp3" } },
  ];
}

function errorText(model: string, status: number, error: { code?: unknown; message?: unknown }): string {
  const code = typeof error.code === "string" && error.code.length > 0 ? error.code : `http_${status}`;
  const message = typeof error.message === "string" && error.message.length > 0 ? error.message : "request failed";
  return `Meta API ${model} failed: ${code} ${message}`;
}

// Pull the answer text out of a Responses payload: the output[] entry with
// type "message", its content[] entry with type "output_text". An API error
// object surfaces as a readable failure. Empty text is returned as-is —
// callers with a graceful empty path (SAM silence) handle it; callers
// needing JSON let their JSON parse reject it.
export function extractResponsesText(model: string, body: ResponsesBody): string {
  if (body && typeof body === "object" && body.error && typeof body.error === "object") {
    throw new Error(errorText(model, 0, body.error));
  }
  const output = Array.isArray(body?.output) ? body.output : [];
  for (const item of output) {
    if (!item || item.type !== "message" || !Array.isArray(item.content)) continue;
    for (const block of item.content) {
      if (block && block.type === "output_text" && typeof block.text === "string") return block.text;
    }
  }
  throw new Error(`Meta API ${model} returned no answer text.`);
}

function nonNegativeNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

export function recordResponsesUsage(body: ResponsesBody): void {
  const usage = body && typeof body === "object" ? body.usage : undefined;
  if (!usage || typeof usage !== "object") return;
  const input = nonNegativeNumber(usage.input_tokens);
  const output = nonNegativeNumber(usage.output_tokens);
  if (input > 0 || output > 0) recordTokenUsage(input, output);
}

export async function postResponsesText(
  apiBase: string,
  apiKey: string,
  model: string,
  input: ResponsesInput,
  opts?: { timeoutMs?: number },
): Promise<string> {
  const res = await fetch(`${apiBase}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, input }),
    // Time-bound when the caller passes a budget (the coach loop); the
    // Learn pipeline calls without one, as before.
    ...(opts?.timeoutMs ? { signal: AbortSignal.timeout(opts.timeoutMs) } : {}),
  });
  const raw = await res.text();
  let body: ResponsesBody;
  try {
    body = (raw.length > 0 ? JSON.parse(raw) : {}) as ResponsesBody;
  } catch {
    throw new Error(`Meta API ${model} failed: http_${res.status} non-JSON response.`);
  }
  if (!res.ok) {
    if (body && typeof body === "object" && body.error && typeof body.error === "object") {
      throw new Error(errorText(model, res.status, body.error));
    }
    throw new Error(`Meta API ${model} failed: ${res.status} ${raw.slice(0, 200)}`);
  }
  const text = extractResponsesText(model, body);
  recordResponsesUsage(body);
  return text;
}
