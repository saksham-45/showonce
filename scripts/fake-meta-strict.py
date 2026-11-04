#!/usr/bin/env python3
"""Strict validating fake for scripts/smoke-meta-responses.sh.

Unlike scripts/fake-meta.py (which counts loosely), this server rejects any
/responses body that does not match the Responses shapes the app must send,
with a 400 naming the mismatch. Payloads mirror recorded Responses shapes:
a leading non-message entry plus the message/output_text entry plus a usage
block, so a passing run proves the parser skips to the message entry and
records token usage. Every request body is appended to $STRICT_BODIES as
JSONL for the shell's post-hoc shape assertions.

sam-3.1 answers with empty text (probed live behavior for listing prompts);
transcribe answers NONE (silent-clip path).
"""

import base64
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

BODIES = os.environ["STRICT_BODIES"]
PNG_1X1_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
)
USAGE = {"input_tokens": 100, "output_tokens": 20, "total_tokens": 120}
TRANSCRIBE_PROMPT = "Transcribe any speech in this audio. If none, reply NONE."


def responses_text(text):
    return {
        "output": [
            {"type": "reasoning", "summary": []},
            {"type": "message", "content": [{"type": "output_text", "text": text}]},
        ],
        "usage": dict(USAGE),
    }


def fuse_payload(frames):
    files = [f["file"] for f in frames if isinstance(f, dict) and f.get("file")] or ["frame-0001.jpg"]
    steps = [
        {
            "id": f"step-{i}",
            "instruction": f"Fake phase {i}: copy the movement.",
            "checkpoint": f"Fake checkpoint {i}.",
            "keyframe": files[(i - 1) % len(files)],
            "mistakes": ["Rushing it", "Wrong side"],
        }
        for i in range(1, 6)
    ]
    return {"title": "Fake skill", "steps": steps}


def fail(message):
    raise ValueError(message)


def check_segment(req):
    if req.get("model") != "sam-3.1":
        fail(f"segment: want model sam-3.1, got {req.get('model')!r}")
    items = req.get("input")
    if not isinstance(items, list) or len(items) != 1:
        fail("segment: want a single-item input list")
    content = items[0].get("content")
    if not isinstance(content, list) or len(content) != 2:
        fail("segment: want [input_text, input_image] content")
    if content[0].get("type") != "input_text" or not content[0].get("text"):
        fail("segment: first part must be input_text with the listing prompt")
    if content[1].get("type") != "input_image":
        fail("segment: second part must be input_image")
    url = content[1].get("image_url", "")
    if not isinstance(url, str) or not url.startswith("data:image/jpeg;base64,"):
        fail("segment: image_url must be a base64 jpeg data URL")


def check_audio(req):
    if req.get("model") != "muse-spark-1.3":
        fail(f"transcribe: want model muse-spark-1.3, got {req.get('model')!r}")
    items = req.get("input")
    if not isinstance(items, list) or len(items) != 1:
        fail("transcribe: want a single-item input list")
    content = items[0].get("content")
    if not isinstance(content, list) or len(content) != 2:
        fail("transcribe: want [input_text, input_audio] content")
    if content[0].get("type") != "input_text" or content[0].get("text") != TRANSCRIBE_PROMPT:
        fail(f"transcribe: input_text must be exactly {TRANSCRIBE_PROMPT!r}")
    audio = content[1]
    if audio.get("type") != "input_audio":
        fail("transcribe: second part must be input_audio")
    part = audio.get("input_audio") or {}
    if part.get("format") != "mp3":
        fail(f"transcribe: input_audio format must be mp3, got {part.get('format')!r}")
    try:
        raw = base64.b64decode(part.get("data", ""))
    except Exception:
        fail("transcribe: input_audio data is not valid base64")
    if len(raw) < 100:
        fail("transcribe: input_audio data too short to be an mp3")


def check_fuse(req):
    if req.get("model") != "muse-spark-1.3":
        fail(f"fuse: want model muse-spark-1.3, got {req.get('model')!r}")
    text = req.get("input")
    if not isinstance(text, str):
        fail("fuse: input must be a plain prompt string")
    if "You fuse video segmentation summaries" not in text:
        fail("fuse: input must start with the fuse system prompt")
    try:
        # The payload JSON follows the prompt's final newline; the prompt
        # itself carries braces, so a plain index("{") would grab the wrong
        # one.
        payload = json.loads(text[text.rindex("\n{") + 1 :])
    except Exception:
        fail("fuse: input must carry the payload JSON after the prompt")
    for key in ("frames", "segmentations", "transcript"):
        if key not in payload:
            fail(f"fuse: payload JSON missing {key}")
    return payload.get("frames", [])


def check_judge(req):
    if req.get("model") != "muse-spark-1.3":
        fail(f"judge: want model muse-spark-1.3, got {req.get('model')!r}")
    items = req.get("input")
    if not isinstance(items, list) or len(items) != 1:
        fail("judge: want a single-item input list")
    content = items[0].get("content")
    if not isinstance(content, list) or len(content) not in (2, 3):
        fail("judge: want [input_text, live input_image, reference input_image?]")
    if content[0].get("type") != "input_text" or "You coach a learner" not in content[0].get("text", ""):
        fail("judge: first part must be the coach prompt")
    if content[1].get("type") != "input_image":
        fail("judge: live frame must be an input_image")
    live = content[1].get("image_url", "")
    if not isinstance(live, str) or not live.startswith("data:image/jpeg;base64,"):
        fail("judge: live frame must be a base64 jpeg data URL")
    if len(content) == 3:
        if content[2].get("type") != "input_image":
            fail("judge: reference must be an input_image")
        ref = content[2].get("image_url", "")
        if not isinstance(ref, str) or not ref.startswith("data:image/png;base64,"):
            fail("judge: reference must be a base64 png data URL")
    if '"verdict"' not in content[0].get("text", ""):
        fail("judge: prompt must carry the JSON-only verdict contract")


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _send(self, obj):
        body = json.dumps(obj).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _reject(self, message):
        body = json.dumps({"error": {"code": "strict_shape_mismatch", "message": message}}).encode()
        self.send_response(400)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b""
        try:
            req = json.loads(raw.decode()) if raw else {}
        except Exception:
            req = {}
        with open(BODIES, "a") as f:
            f.write(json.dumps({"path": self.path, "body": req}) + "\n")
        try:
            if self.path == "/images/generations":
                self._send({"data": [{"b64_json": PNG_1X1_B64}]})
            elif self.path == "/responses":
                if req.get("tools"):
                    self._reject("strict fake serves no lookup tools; lookup is out of scope here")
                elif req.get("model") == "sam-3.1":
                    check_segment(req)
                    self._send(responses_text(""))
                elif isinstance(req.get("input"), list) and any(
                    isinstance(part, dict) and part.get("type") == "input_audio"
                    for item in (req.get("input") or [])
                    if isinstance(item, dict)
                    for part in (item.get("content") or [])
                ):
                    check_audio(req)
                    self._send(responses_text("NONE"))
                elif isinstance(req.get("input"), str):
                    frames = check_fuse(req)
                    self._send(responses_text(json.dumps(fuse_payload(frames))))
                else:
                    check_judge(req)
                    self._send(
                        responses_text(
                            json.dumps(
                                {
                                    "verdict": "correct",
                                    "correction": "That flap is flush to the edge, clean fold.",
                                    "advance": True,
                                }
                            )
                        )
                    )
            else:
                self.send_response(404)
                self.end_headers()
        except ValueError as e:
            self._reject(str(e))


port = int(sys.argv[1])
ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
