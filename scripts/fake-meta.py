#!/usr/bin/env python3
"""Counting fake Meta Model API for scripts/smoke-cost.sh.

Canned responses for every endpoint the app calls (chat completions for
sam-3.1 / muse-spark fuse / coach judge, audio transcriptions, image
generations, Responses search grounding), one appended line per request in
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
        ]
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
        if self.path == "/chat/completions":
            try:
                req = json.loads(raw.decode())
            except Exception:
                req = {}
            model = req.get("model", "")
            msgs = req.get("messages", [])
            system = msgs[0].get("content", "") if msgs and isinstance(msgs[0], dict) else ""
            if model == "sam-3.1":
                self._send({"choices": [{"message": {"content": '{"regions": []}'}}]})
            elif "fuse video segmentation" in str(system):
                try:
                    user = json.loads(msgs[1]["content"])
                    frames = user.get("frames", [])
                except Exception:
                    frames = []
                self._send({"choices": [{"message": {"content": json.dumps(fuse_payload(frames))}}]})
            else:
                self._send(
                    {
                        "choices": [
                            {
                                "message": {
                                    "content": json.dumps(
                                        {
                                            "verdict": "correct",
                                            "correction": "Fake correction holds.",
                                            "advance": True,
                                        }
                                    )
                                }
                            }
                        ]
                    }
                )
        elif self.path == "/audio/transcriptions":
            self._send(
                {
                    "segments": [
                        {"start": 0, "end": 1, "text": "fake narration one"},
                        {"start": 1, "end": 2, "text": "fake narration two"},
                    ]
                }
            )
        elif self.path == "/images/generations":
            self._send({"data": [{"b64_json": PNG_1X1_B64}]})
        elif self.path == "/responses":
            self._send(guide_payload())
        else:
            self.send_response(404)
            self.end_headers()


port = int(sys.argv[1])
ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
