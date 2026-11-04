"use client";

// Expert-clip drop zone: drag a video anywhere onto the well, or browse
// for one. A chosen clip becomes a file chip with its size and a remove
// control; the hidden input stays keyboard-focusable so the picker opens
// without a mouse. The app menu's Import entry talks to it through the
// `showonce:import-clip` window event.

import { useEffect, useRef, useState } from "react";

export const MAX_CLIP_BYTES = 200 * 1024 * 1024;

function describeSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function problemFor(file: File): string | null {
  const looksVideo =
    file.type.startsWith("video/") || /\.(mp4|mov|m4v|webm)$/i.test(file.name);
  if (!looksVideo) return "That file is not a video — drop an MP4 or MOV expert clip.";
  if (file.size > MAX_CLIP_BYTES) return "That clip is over the 200 MB upload cap — trim it first.";
  return null;
}

function UploadGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path
        d="M10 13.5v-9m0 0L6.5 8M10 4.5L13.5 8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M3.5 12.5v2.25a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V12.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function ClipDropzone({
  file,
  onPick,
  onClear,
  externalError,
  disabled,
}: {
  file: File | null;
  onPick: (file: File) => void;
  onClear: () => void;
  externalError: string | null;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [over, setOver] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    const open = () => {
      if (!disabled) inputRef.current?.click();
    };
    window.addEventListener("showonce:import-clip", open);
    return () => window.removeEventListener("showonce:import-clip", open);
  }, [disabled]);

  function take(next: File | null) {
    if (!next || disabled) return;
    const problem = problemFor(next);
    if (problem) {
      setLocalError(problem);
      return;
    }
    setLocalError(null);
    onPick(next);
  }

  const error = externalError ?? localError;

  return (
    <div>
      <div
        className={`dropzone${over ? " is-over" : ""}`}
        data-testid="clip-dropzone"
        onClick={() => {
          if (!file && !disabled) inputRef.current?.click();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          take(e.dataTransfer.files?.[0] ?? null);
        }}
        aria-describedby="skill-clip-hint"
      >
        {file ? (
          <div className="file-chip" data-testid="clip-chip">
            <div className="file-meta">
              <p className="file-name">{file.name}</p>
              <p className="file-size">
                {describeSize(file.size)} · ready to upload
              </p>
            </div>
            <button
              type="button"
              className="file-remove"
              data-testid="clip-remove"
              onClick={(e) => {
                e.stopPropagation();
                setLocalError(null);
                onClear();
              }}
              disabled={disabled}
            >
              Remove
            </button>
          </div>
        ) : (
          <>
            <div className="dropzone-icon" aria-hidden="true">
              <UploadGlyph />
            </div>
            <p className="dropzone-title">Drop your expert clip here</p>
            <p className="dropzone-sub" id="skill-clip-hint">
              or{" "}
              <button
                type="button"
                data-testid="clip-browse"
                disabled={disabled}
                onClick={(e) => {
                  e.stopPropagation();
                  inputRef.current?.click();
                }}
              >
                browse files
              </button>{" "}
              · MP4 or MOV · any length · up to 200 MB
            </p>
          </>
        )}
      </div>
      <input
        ref={inputRef}
        id="skill-clip"
        data-testid="clip-input"
        type="file"
        accept="video/*"
        disabled={disabled}
        onChange={(e) => take(e.target.files?.[0] ?? null)}
        style={{
          position: "absolute",
          width: 1,
          height: 1,
          overflow: "hidden",
          clip: "rect(0 0 0 0)",
          whiteSpace: "nowrap",
        }}
      />
      {error ? (
        <p className="error" role="alert" data-testid="clip-error" style={{ marginTop: 8 }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
