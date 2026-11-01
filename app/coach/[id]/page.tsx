"use client";

import { use, useEffect, useRef, useState } from "react";
import type { SkillGraph } from "@/lib/skillgraph";

type Verdict = "correct" | "nudge" | "wrong";

interface CoachReply {
  verdict: Verdict;
  correction: string;
  advance: boolean;
}

// One still frame is judged every few seconds while coaching runs.
const CAPTURE_INTERVAL_MS = 3000;

function speak(text: string) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
}

export default function CoachPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [graph, setGraph] = useState<SkillGraph | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [current, setCurrent] = useState(0);
  const [doneSteps, setDoneSteps] = useState<string[]>([]);
  const [coaching, setCoaching] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [lastReply, setLastReply] = useState<CoachReply | null>(null);
  const [checking, setChecking] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
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

  const complete =
    graph !== null && graph.steps.length > 0 && current >= graph.steps.length;

  useEffect(() => {
    if (complete && graph) {
      speak(`Skill complete. You finished ${graph.title}. Badge earned.`);
    }
  }, [complete, graph]);

  // Capture loop: one still every few seconds, judged against current step.
  useEffect(() => {
    if (!coaching) return;
    async function captureOnce() {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const active = graphRef.current;
      if (!video || !canvas || !active) return;
      if (video.readyState < 2 || video.videoWidth === 0) return;
      const step = active.steps[currentRef.current];
      if (!step) return;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(video, 0, 0);
      const frame = canvas.toDataURL("image/jpeg", 0.8);
      const requestedId = step.id;
      setChecking(true);
      try {
        const res = await fetch(`/api/skills/${active.skillId}/coach`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stepId: requestedId, frame }),
        });
        const reply = (await res.json()) as CoachReply & { error?: string };
        if (!res.ok) return;
        // Drop stale responses: a slow verdict for an earlier step must not
        // advance (or overwrite feedback for) the step the learner is on now.
        const live = graphRef.current;
        const liveStep = live?.steps[currentRef.current];
        if (!liveStep || liveStep.id !== requestedId) return;
        setLastReply(reply);
        if (reply.correction) speak(reply.correction);
        if (reply.advance) {
          setDoneSteps((prev) => (prev.includes(step.id) ? prev : [...prev, step.id]));
          const next = currentRef.current + 1;
          setCurrent(next);
          if (next >= active.steps.length) {
            setCoaching(false);
            streamRef.current?.getTracks().forEach((track) => track.stop());
            streamRef.current = null;
          }
        }
      } catch {
        // Transient capture or network failure: the next tick retries.
      } finally {
        setChecking(false);
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
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  const step = graph && !complete ? graph.steps[current] : null;

  return (
    <>
      <p>
        <a href="/">All skills</a>
        {graph ? (
          <>
            {" · "}<a href={`/skills/${id}`}>Learn view</a>
          </>
        ) : null}
      </p>
      <h1 style={{ fontSize: 28 }}>{graph ? `Coach: ${graph.title}` : "Coach"}</h1>

      {loadError && !graph ? (
        <p style={{ color: "#a00" }}>{loadError}</p>
      ) : !graph ? (
        <p>Loading skill…</p>
      ) : graph.steps.length === 0 ? (
        <p>
          This skill has no steps to coach yet.{" "}
          <a href={`/skills/${id}`}>Run the Learn pipeline first</a>.
        </p>
      ) : complete ? (
        <section
          style={{
            marginTop: 24,
            padding: 24,
            border: "2px solid #1a7f37",
            borderRadius: 8,
            textAlign: "center",
          }}
        >
          <h2 style={{ fontSize: 24, margin: "0 0 8px" }}>Completion badge earned</h2>
          <p style={{ margin: "0 0 8px" }}>
            You completed every step of <strong>{graph.title}</strong>.
          </p>
          <p style={{ margin: 0, color: "#555" }}>
            {graph.steps.length} of {graph.steps.length} checkpoints passed.
          </p>
        </section>
      ) : (
        <>
          <video
            ref={videoRef}
            muted
            playsInline
            style={{ width: "100%", maxHeight: 360, background: "#000" }}
          />
          <canvas ref={canvasRef} hidden />

          <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
            {coaching ? (
              <button onClick={stop} style={{ padding: "8px 16px" }}>
                Stop coaching
              </button>
            ) : (
              <button onClick={start} style={{ padding: "8px 16px" }}>
                Start coaching
              </button>
            )}
            <span style={{ alignSelf: "center", color: "#555" }}>
              {coaching
                ? checking
                  ? "Checking your form…"
                  : "Watching — a frame is judged every 3 seconds."
                : "Press start to turn on the camera."}
            </span>
          </div>
          {cameraError ? <p style={{ color: "#a00" }}>{cameraError}</p> : null}

          {step ? (
            <section style={{ marginTop: 20 }}>
              <h2 style={{ fontSize: 22, marginBottom: 4 }}>
                Step {current + 1} of {graph.steps.length}: {step.instruction}
              </h2>
              <p style={{ marginTop: 0 }}>Checkpoint: {step.checkpoint}</p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/skills/${id}/${step.referenceImage}`}
                alt={`Reference pose for step ${current + 1}`}
                width={320}
              />
              <p>Watch out for: {step.mistakes.join("; ") || "nothing listed"}</p>
              {lastReply ? (
                <p
                  style={{
                    color:
                      lastReply.verdict === "correct"
                        ? "#1a7f37"
                        : lastReply.verdict === "nudge"
                          ? "#9a6700"
                          : "#a00",
                  }}
                >
                  Coach: {lastReply.correction}
                </p>
              ) : null}
            </section>
          ) : null}

          <section style={{ marginTop: 24 }}>
            <h2 style={{ fontSize: 20 }}>Checklist</h2>
            <ol style={{ paddingLeft: 20 }}>
              {graph.steps.map((candidate, index) => {
                const done = doneSteps.includes(candidate.id);
                const isCurrent = index === current;
                return (
                  <li
                    key={candidate.id}
                    style={{
                      fontWeight: isCurrent ? 700 : 400,
                      color: done ? "#1a7f37" : "#1a1a1a",
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
