#!/usr/bin/env python3
"""Counting fake Meta Model API for scripts/smoke-cost.sh.

Canned Responses payloads for every endpoint the app calls (/responses
for sam-3.1 segment / muse-spark fuse+transcribe / coach judge / search
grounding, plus image generations), one appended line per request in
$SHOWNCE_COST_COUNTS. The fuse reply points steps at the request's own
frame files, so the pipeline's unknown-keyframe guard passes.
"""

import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

COUNTS = os.environ["SHOWNCE_COST_COUNTS"]
PNG_1X1_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
)


USAGE = {"input_tokens": 100, "output_tokens": 20, "total_tokens": 120}


def responses_text(text):
    return {
        "output": [{"type": "message", "content": [{"type": "output_text", "text": text}]}],
        "usage": dict(USAGE),
    }


def guide_payload():
    steps = [
        {
            "instruction": f"Fake phase {i}: copy the movement.",
            "checkpoint": f"Fake checkpoint {i}.",
            "mistakes": ["Rushing it", "Wrong side"],
        }
        for i in range(1, 6)
    ]
    guide = {
        "summary": "Fake summary of agreed steps.",
        "videos": [{"title": "Fake video", "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"}],
        "articles": [{"title": "Fake article", "url": "https://example.com/howto", "snippet": "Fake snippet."}],
        "steps": steps,
    }
    return {
        "output": [
            {
                "type": "web_search_call",
                "results": [
                    {"url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "title": "Fake video"},
                    {"url": "https://example.com/howto", "title": "Fake article"},
                ],
            },
            {
                "type": "message",
                "content": [
                    {
                        "type": "output_text",
                        "text": json.dumps(guide),
                        "annotations": [
                            {
                                "type": "url_citation",
                                "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
                                "title": "Fake video",
                            },
                            {
                                "type": "url_citation",
                                "url": "https://example.com/howto",
                                "title": "Fake article",
                            },
                        ],
                    },
                ],
            },
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

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b""
        with open(COUNTS, "a") as f:
            f.write(self.path + "\n")
        if self.path == "/images/generations":
            self._send({"data": [{"b64_json": PNG_1X1_B64}]})
        elif self.path == "/responses":
            try:
                req = json.loads(raw.decode())
            except Exception:
                req = {}
            if req.get("tools"):
                self._send(guide_payload())
                return
            model = req.get("model", "")
            prompt_input = req.get("input", "")
            if model == "sam-3.1":
                self._send(responses_text('{"regions": []}'))
            elif isinstance(prompt_input, list) and any(
                isinstance(part, dict) and part.get("type") == "input_audio"
                for item in prompt_input
                if isinstance(item, dict)
                for part in (item.get("content") or [])
            ):
                self._send(responses_text("fake narration one. fake narration two."))
            elif isinstance(prompt_input, str) and "fuse video segmentation" in prompt_input:
                try:
                    # The payload JSON is appended after the prompt's final
                    # newline (the prompt itself carries braces, so a plain
                    # index("{") would grab the wrong one).
                    payload = json.loads(prompt_input[prompt_input.rindex("\n{") + 1 :])
                    frames = payload.get("frames", [])
                except Exception:
                    frames = []
                self._send(responses_text(json.dumps(fuse_payload(frames))))
            else:
                self._send(
                    responses_text(
                        json.dumps(
                            {
                                "verdict": "correct",
                                "correction": "Fake correction holds.",
                                "advance": True,
                            }
                        )
                    )
                )
        else:
            self.send_response(404)
            self.end_headers()


port = int(sys.argv[1])
ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
