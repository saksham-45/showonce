"use client";

// Voice search mic: wraps the Web Speech API recognition so a spoken
// phrase fills the existing typed query. The typed field always stays,
// so browsers without recognition (or denied mic permission) keep a
// working fallback. Recognition starts only on an explicit press.

import { useEffect, useId, useRef, useState } from "react";

// Minimal Web Speech API shapes: TS DOM libs do not ship them, and the
// runtime surface differs per browser (SpeechRecognition vs.
// webkitSpeechRecognition), so declare just what this button uses.
interface SpeechRecognitionResultLike {
  readonly transcript: string;
}

interface SpeechRecognitionEventLike {
  readonly results: ArrayLike<ArrayLike<SpeechRecognitionResultLike>>;
}

interface SpeechRecognitionErrorEventLike {
  readonly error: string;
}

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  abort: () => void;
}

type RecognitionCtor = new () => SpeechRecognitionLike;

function getRecognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Record<string, unknown>;
  const ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (typeof ctor !== "function") return null;
  return ctor as RecognitionCtor;
}

function messageFor(code: string): string {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "Microphone blocked — allow access in the address bar, then try again. Typing works too.";
    case "audio-capture":
      return "No microphone found — type the skill instead.";
    case "no-speech":
      return "No speech heard — try again or type instead.";
    case "network":
    case "service-error":
      return "Voice search unavailable right now — type instead.";
    case "aborted":
      return "";
    default:
      return "Voice search had trouble — try again or type instead.";
  }
}

function MicGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <rect x="6" y="1" width="4" height="8" rx="2" fill="currentColor" />
      <path
        d="M3.5 7.5a4.5 4.5 0 0 0 9 0"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <line x1="8" y1="12" x2="8" y2="15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <line x1="5.5" y1="15" x2="10.5" y2="15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export default function VoiceMicButton({
  onTranscript,
  inputId,
}: {
  onTranscript: (text: string) => void;
  inputId: string;
}) {
  // SSR has no window: render the unsupported fallback so the first
  // paint (and headless smoke checks) always show the typed path.
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const statusId = useId();

  useEffect(() => {
    setSupported(getRecognitionCtor() !== null);
    return () => {
      recognitionRef.current?.abort();
      recognitionRef.current = null;
    };
  }, []);

  function stop() {
    recognitionRef.current?.abort();
    recognitionRef.current = null;
    setListening(false);
  }

  function start() {
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;
    // A failed recognition object is discarded; each press builds a
    // fresh one so a previous error never poisons the next attempt.
    recognitionRef.current?.abort();
    const recognition = new Ctor();
    recognitionRef.current = recognition;
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    setNote(null);
    setFailed(false);
    recognition.onresult = (event) => {
      const transcript = event.results?.[0]?.[0]?.transcript?.trim() ?? "";
      if (transcript) {
        onTranscript(transcript);
        setNote(`Heard “${transcript}”.`);
      } else {
        setNote("No speech heard — try again or type instead.");
        setFailed(true);
      }
    };
    recognition.onerror = (event) => {
      const message = messageFor(event.error);
      recognitionRef.current = null;
      setListening(false);
      if (message) {
        setNote(message);
        setFailed(true);
      } else {
        setNote(null);
        setFailed(false);
      }
    };
    recognition.onend = () => {
      // onerror already handled failures; onend just releases the press.
      if (recognitionRef.current === recognition) {
        recognitionRef.current = null;
        setListening(false);
      }
    };
    try {
      recognition.start();
      setListening(true);
    } catch {
      recognitionRef.current = null;
      setListening(false);
      setNote("Voice search had trouble — try again or type instead.");
      setFailed(true);
    }
  }

  if (!supported) {
    return (
      <span className="voice-wrap">
        <button
          type="button"
          className="btn mic-btn"
          disabled
          aria-label="Search by voice (not supported in this browser)"
          data-testid="voice-mic"
          title="Voice search needs Chrome or Edge"
        >
          <MicGlyph />
        </button>
        <span className="voice-status" role="status" data-testid="voice-note">
          Voice search not supported in this browser — type instead.
        </span>
        <span className="voice-anchor" data-voice-for={inputId} hidden />
      </span>
    );
  }

  return (
    <span className="voice-wrap">
      <button
        type="button"
        className="btn mic-btn"
        onClick={listening ? stop : start}
        aria-label={listening ? "Stop voice search" : `Search by voice for ${inputId}`}
        aria-pressed={listening}
        aria-describedby={statusId}
        data-testid="voice-mic"
      >
        <MicGlyph />
        {listening ? "Listening…" : "Voice"}
      </button>
      <span
        id={statusId}
        className={`voice-status${failed ? " voice-error" : ""}`}
        role="status"
        data-testid="voice-note"
      >
        {listening ? "Listening… speak the skill name." : (note ?? "")}
      </span>
      <span className="voice-anchor" data-voice-for={inputId} hidden />
    </span>
  );
}
