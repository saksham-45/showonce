"use client";

import { use, useEffect, useRef, useState } from "react";
import type { SkillGraph } from "@/lib/skillgraph";
import SkillFinder from "../../components/SkillFinder";

type Verdict = "correct" | "nudge" | "wrong";

interface CoachReply {
  verdict: Verdict;
  correction: string;
  advance: boolean;
  via?: "meta" | "stub";
}

// One still frame is judged every few seconds while coaching runs. Ticks
// never overlap: a tick fires only when no compare is in flight, so a slow
// model delays the next judgement instead of piling up blocked requests.
const CAPTURE_INTERVAL_MS = 2500;
// Backstop above the server-side model budgets (15s segment + 25s judge).
const REQUEST_TIMEOUT_MS = 50_000;
const MAX_BACKOFF_MS = 8000;

type ConnState = "idle" | "live" | "retrying";

function speak(text: string) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
}

// Read the NDJSON coach stream event by event. Phases update the status
// line; the final event carries the verdict handled like the JSON route.
async function readCoachStream(
  res: Response,
  onPhase: (phase: string) => void,
  signal: AbortSignal,
): Promise<CoachReply> {
  const reader = res.body?.getReader();
  if (!reader) throw new Error("Streaming is not supported here.");
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (signal.aborted) {
      reader.cancel().catch(() => {});
      throw new DOMException("Compare aborted.", "AbortError");
    }
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const event = JSON.parse(trimmed) as CoachReply & { phase?: string };
      if (event.phase) {
        onPhase(event.phase);
      } else if (event.verdict) {
        reader.cancel().catch(() => {});
        return event;
      }
    }
  }
  throw new Error("Coach stream ended without a verdict.");
}

const PHASE_LABELS: Record<string, string> = {
  received: "frame received",
  segmenting: "segmenting hands and tools",
  judging: "judging against the checkpoint",
};

export default function CoachPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [graph, setGraph] = useState<SkillGraph | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [current, setCurrent] = useState(0);
  const [doneSteps, setDoneSteps] = useState<string[]>([]);
  const [coaching, setCoaching] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [lastReply, setLastReply] = useState<CoachReply | null>(null);
  const [phase, setPhase] = useState<string | null>(null);
  const [conn, setConn] = useState<ConnState>("idle");
  const [retryNote, setRetryNote] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const stallTicksRef = useRef(0);
  const busyRef = useRef(false);
  const backoffUntilRef = useRef(0);
  const retryCountRef = useRef(0);
  const graphRef = useRef<SkillGraph | null>(null);
  const currentRef = useRef(0);
  graphRef.current = graph;
  currentRef.current = current;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/skills/${id}`);
        if (!res.ok) {
          if (!cancelled) {
            setLoadError("This skill has not been learned yet. Run the Learn pipeline first.");
          }
          return;
        }
        const body = (await res.json()) as SkillGraph;
        if (!cancelled) setGraph(body);
      } catch {
        if (!cancelled) setLoadError("Could not load this skill. Check the skill id and try again.");
      }
    }
    load().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Stop camera tracks when the page unmounts.
  useEffect(() => {
    const held = streamRef;
    return () => {
      held.current?.getTracks().forEach((track) => track.stop());
      held.current = null;
    };
  }, []);

  const complete = graph !== null && graph.steps.length > 0 && current >= graph.steps.length;

  useEffect(() => {
    if (complete && graph) {
      speak(`Skill complete. You finished ${graph.title}. Badge earned.`);
    }
  }, [complete, graph]);

  // Capture loop: one still every few seconds, judged against current step.
  useEffect(() => {
    if (!coaching) return;
    async function captureOnce() {
      // Never overlap compares and never fire inside a backoff window: the
      // loop skips instead of blocking.
      if (busyRef.current || Date.now() < backoffUntilRef.current) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const active = graphRef.current;
      if (!video || !canvas || !active) return;
      if (video.readyState < 2 || video.videoWidth === 0) {
        // The camera is on but no picture is flowing; say so instead of
        // watching silently. Three missed ticks is ~8 seconds.
        stallTicksRef.current += 1;
        if (stallTicksRef.current === 3) {
          setCameraError("Camera is on but no picture is arriving. Check the lens cover and try another browser.");
        }
        return;
      }
      stallTicksRef.current = 0;
      const step = active.steps[currentRef.current];
      if (!step) return;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(video, 0, 0);
      const frame = canvas.toDataURL("image/jpeg", 0.8);
      const requestedId = step.id;
      busyRef.current = true;
      setPhase(null);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const res = await fetch(`/api/skills/${active.skillId}/coach`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
          body: JSON.stringify({ stepId: requestedId, frame }),
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`Coach compare failed: ${res.status}`);
        const reply = await readCoachStream(
          res,
          (next) => setPhase(next),
          controller.signal,
        );
        // Drop stale responses: a slow verdict for an earlier step must not
        // advance (or overwrite feedback for) the step the learner is on now.
        const live = graphRef.current;
        const liveStep = live?.steps[currentRef.current];
        if (!liveStep || liveStep.id !== requestedId) return;
        retryCountRef.current = 0;
        backoffUntilRef.current = 0;
        setConn("live");
        setRetryNote(null);
        setLastReply(reply);
        if (reply.correction) speak(reply.correction);
        if (reply.advance) {
          setDoneSteps((prev) => (prev.includes(step.id) ? prev : [...prev, step.id]));
          const next = currentRef.current + 1;
          setCurrent(next);
          if (next >= active.steps.length) {
            setCoaching(false);
            setConn("idle");
            streamRef.current?.getTracks().forEach((track) => track.stop());
            streamRef.current = null;
          }
        }
      } catch (err) {
        // Aborts from unmount/stop are intentional, not failures.
        if (err instanceof DOMException && err.name === "AbortError") return;
        // Transient capture or network failure: back off exponentially and
        // say so, then let the next tick retry.
        const attempt = retryCountRef.current + 1;
        retryCountRef.current = attempt;
        backoffUntilRef.current = Date.now() + Math.min(MAX_BACKOFF_MS, 1000 * 2 ** (attempt - 1));
        setConn("retrying");
        setRetryNote(`Connection hiccup — retrying (attempt ${attempt}). Your step is held.`);
      } finally {
        clearTimeout(timeout);
        busyRef.current = false;
      }
    }
    const timer = setInterval(() => {
      captureOnce().catch(() => {});
    }, CAPTURE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [coaching]);

  async function start() {
    setCameraError(null);
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.getUserMedia !== "function"
    ) {
      setCameraError("This browser exposes no camera. Open this page over localhost or HTTPS and try again.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play();
      }
      retryCountRef.current = 0;
      backoffUntilRef.current = 0;
      setConn("live");
      setCoaching(true);
    } catch (err) {
      setCameraError(
        err instanceof DOMException && err.name === "NotAllowedError"
          ? "Camera access was denied. Allow it in the address bar, then press start."
          : "Camera unavailable. Check that no other app is using it and try again.",
      );
    }
  }

  function stop() {
    setCoaching(false);
    setConn("idle");
    setPhase(null);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  const step = graph && !complete ? graph.steps[current] : null;
  const connLabel =
    conn === "live" ? "Live" : conn === "retrying" ? "Retrying" : coaching ? "Starting" : "Idle";
  const connClass = conn === "live" ? "status-live" : conn === "retrying" ? "status-retry" : "";

  return (
    <>
      <header className="topbar">
        <a className="wordmark" href="/">
          SHOW<b>ONCE</b>
        </a>
        <span className="provider-note">Live coach session</span>
      </header>

      <p className="crumbs">
        <a href="/">All skills</a>
        {graph ? (
          <>
            {" · "}<a href={`/skills/${id}`}>Learn view</a>
          </>
        ) : null}
      </p>
      <p className="kicker">Personal skill tutor · real-time</p>
      <h1 className="display" style={{ fontSize: "clamp(40px, 6vw, 72px)", marginBottom: 16 }}>
        {graph ? `Coach: ${graph.title}` : "Coach"}
      </h1>

      <div style={{ marginBottom: 24, maxWidth: 460 }}>
        <SkillFinder coach />
      </div>

      {loadError && !graph ? (
        <p className="error">{loadError}</p>
      ) : !graph ? (
        <p className="lede">Loading skill…</p>
      ) : graph.steps.length === 0 ? (
        <p className="lede">
          This skill has no steps to coach yet.{" "}
          <a href={`/skills/${id}`}>Run the Learn pipeline first</a>.
        </p>
      ) : complete ? (
        <section className="badge" aria-live="polite">
          <p className="kicker">Completion badge earned</p>
          <h2>Skill locked in</h2>
          <p style={{ margin: "0 0 8px" }}>
            You completed every step of <strong>{graph.title}</strong>.
          </p>
          <p style={{ margin: 0, color: "var(--muted)" }}>
            {graph.steps.length} of {graph.steps.length} checkpoints passed.
          </p>
        </section>
      ) : (
        <>
          <div className="coach-grid">
            <div>
              <div className="viewfinder">
                <video ref={videoRef} muted playsInline />
                <span className="corner corner-tl" aria-hidden="true" />
                <span className="corner corner-tr" aria-hidden="true" />
                <span className="corner corner-bl" aria-hidden="true" />
                <span className="corner corner-br" aria-hidden="true" />
              </div>
              <canvas ref={canvasRef} hidden />

              <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                {coaching ? (
                  <button onClick={stop} className="btn">
                    Stop coaching
                  </button>
                ) : (
                  <button onClick={start} className="btn btn-primary">
                    Start coaching
                  </button>
                )}
                <span className={`status-pill ${connClass}`} role="status">
                  <span className="dot" aria-hidden="true" />
                  {connLabel}
                </span>
              </div>
              <p style={{ color: "var(--muted)", fontSize: 15, minHeight: 24 }}>
                {coaching
                  ? phase
                    ? `${PHASE_LABELS[phase] ?? phase}…`
                    : "Watching — a frame is judged every few seconds."
                  : "Press start to turn on the camera."}
              </p>
              {retryNote && conn === "retrying" ? <p className="error">{retryNote}</p> : null}
              {cameraError ? <p className="error">{cameraError}</p> : null}
            </div>

            <div>
              <div className="progress-segments" aria-label={`${doneSteps.length} of ${graph.steps.length} steps complete`}>
                {graph.steps.map((candidate) => (
                  <i key={candidate.id} className={doneSteps.includes(candidate.id) ? "hit" : ""} />
                ))}
              </div>
              {step ? (
                <section className="card">
                  <p className="kicker">
                    Step {current + 1} of {graph.steps.length}
                    {lastReply?.via ? ` · via ${lastReply.via === "meta" ? "Meta live" : "local stand-in"}` : ""}
                  </p>
                  <h2 style={{ fontSize: 22, margin: "0 0 4px" }}>{step.instruction}</h2>
                  <p className="checkpoint">Checkpoint: {step.checkpoint}</p>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/skills/${id}/${step.referenceImage}`}
                    alt={`Reference pose for step ${current + 1}`}
                    style={{ width: "100%", borderRadius: "var(--radius)", border: "1px solid var(--line)" }}
                  />
                  <p className="mistakes">Watch out for: {step.mistakes.join("; ") || "nothing listed"}</p>
                  <div className="verdict-feed" aria-live="polite">
                    {lastReply ? (
                      <>
                        <span className={`verdict-tag verdict-${lastReply.verdict}`}>
                          {lastReply.verdict}
                        </span>
                        <p className="correction">Coach: {lastReply.correction}</p>
                      </>
                    ) : null}
                  </div>
                </section>
              ) : null}
            </div>
          </div>

          <section style={{ marginTop: 24 }}>
            <p className="kicker">Checklist</p>
            <ol style={{ paddingLeft: 20, margin: 0 }}>
              {graph.steps.map((candidate, index) => {
                const done = doneSteps.includes(candidate.id);
                const isCurrent = index === current;
                return (
                  <li
                    key={candidate.id}
                    style={{
                      fontWeight: isCurrent ? 700 : 400,
                      color: done ? "var(--good)" : "var(--paper)",
                      marginBottom: 4,
                    }}
                  >
                    {done ? "Done — " : isCurrent ? "Now — " : ""}
                    {candidate.instruction}
                  </li>
                );
              })}
            </ol>
          </section>
        </>
      )}
    </>
  );
}
