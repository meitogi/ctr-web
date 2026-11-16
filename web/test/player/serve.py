#!/usr/bin/env python3
"""Serves a web build for the player suites, every file revalidated on every load.

    python3 web/test/player/serve.py <build-web-dir> [port]

The agent browser keeps its profile between runs, and a debug and a release
build served in turn on one port share every URL : with web/serve.sh (plain
http.server, no cache header) Chromium reused the release ctr_native.js and
.wasm from its cache under a debug run — no window.__ctr, no request in the
server log. Every file is sent with `Cache-Control: no-cache` and an ETag of its own (inode, mtime,
size ; no Last-Modified, whose date a build served after a newer one would pass) : the browser asks
each time and gets what is being served, but an unchanged file comes back as 304, not the 6 MB
game again.
Default port 8093, bound to 127.0.0.1 like web/serve.sh.

/__build : the served game's id (ctr_native.wasm's SHA-256, 16 hex digits), the snapshots' folder.
/__states/<build>/<name>.ctrstate|.json : the tests' snapshots (web/ui/src/dev/fast.js), read from
web/test/player/.states/ (gitignored), where the harness writes them (ctr.mjs saveState, the bytes
pulled over the devtools connection). A snapshot holds the game's memory, pieces of the disc : local
only, never committed, never in a site (web/pages/guard.sh refuses them).
/__saves/<name>/index.json, /__saves/<name>/<file> : the tests' memory cards (web/ui/src/dev/precise.js
?card=), from web/test/player/.saves/<name>/ ; /__replays/<name>/… : the tests' recorded races
(ctrDev.replay.play), from web/test/player/.replays/<name>/ — index.json lists a folder's files.
Both hold pieces of the game too (a save's icon frames, a replay's checkpoint) : local only, the same.

    python3 web/test/player/serve.py --phone <site-dir> [port]

A phone on the developer's own HTTPS tunnel (web/dev.sh phone) : /__states, /__saves and /__replays
answer 404 (a tunnel would publish them), and POST /__report (JSON, 256 KB at most : the measuring
panel's report, web/ui/src/dev/measure.js) is written to web/test/player/.reports/ (gitignored).
"""
import functools
import hashlib
import http.server
import json
import os
import re
import sys
import time
import urllib.parse

STATES = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".states")
BUILD = {}
STATE_PATH = re.compile(r"^/__states/([0-9a-f]{16})/([A-Za-z0-9._:+-]{1,80})\.(ctrstate|json)$")
HERE = os.path.dirname(os.path.abspath(__file__))
# /__saves/<name>/<file> and /__replays/<name>/<file, maybe in a folder>
REPORTS = os.path.join(HERE, ".reports")
REPORT_MAX = 256 * 1024
KEPT_PATH = re.compile(r"^/__(saves|replays)/([A-Za-z0-9._+-]{1,80})/([A-Za-z0-9._+/-]{1,120})$")


class Handler(http.server.SimpleHTTPRequestHandler):
    etag = None
    phone = False
    # keep-alive : a page's ~30 files over a few connections. One new connection per file (HTTP/1.0)
    # through the forwarded port left a request now and then that never reached this server : the
    # page stalled on « Looking for the game… » or before its first frame, one load in five
    # (measured in session 45 : 2 stalls in 10 loads ; 0 in 16 with keep-alive)
    protocol_version = "HTTP/1.1"

    def send_header(self, keyword, value):
        if keyword != "Last-Modified":
            super().send_header(keyword, value)

    def end_headers(self):
        if self.etag:
            self.send_header("ETag", self.etag)
            self.send_header("Cache-Control", "no-cache")
        else:
            self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def revalidated(self):
        """True when the browser's copy is the file served (304 sent)."""
        f = self.translate_path(self.path)
        if not os.path.isfile(f):
            return False
        st = os.stat(f)
        self.etag = f'"{st.st_ino:x}-{st.st_mtime_ns:x}-{st.st_size:x}"'
        if self.headers.get("If-None-Match") != self.etag:
            return False
        self.send_response(304)
        self.end_headers()
        return True

    def state_file(self):
        m = STATE_PATH.match(urllib.parse.unquote(self.path.split("?")[0]))
        if not m or ".." in m.group(2):
            return None
        return os.path.join(STATES, m.group(1), f"{m.group(2)}.{m.group(3)}")

    def kept_file(self):
        """A save's or a replay's file, or its folder's index.json ; (path, None) or (None, json)."""
        m = KEPT_PATH.match(urllib.parse.unquote(self.path.split("?")[0]))
        if not m or ".." in m.group(2) or ".." in m.group(3):
            return None, None
        folder = os.path.join(HERE, f".{m.group(1)}", m.group(2))
        if m.group(3) == "index.json" and os.path.isdir(folder):
            files = sorted(os.path.relpath(os.path.join(d, f), folder) for d, _, fs in os.walk(folder) for f in fs)
            return None, json.dumps({"files": [f for f in files if f != "what.json"]})
        return os.path.join(folder, m.group(3)), None

    def do_POST(self):
        if not self.phone or self.path.split("?")[0] != "/__report":
            return self.send_error(404)
        size = int(self.headers.get("Content-Length") or 0)
        if size <= 0 or size > REPORT_MAX:
            return self.send_error(413)
        try:
            report = json.loads(self.rfile.read(size))
        except ValueError:
            return self.send_error(400)
        os.makedirs(REPORTS, exist_ok=True)
        ua = re.sub(r"[^A-Za-z0-9]+", "-", str(report.get("device", {}).get("platform", "phone")))[:24]
        name = f"{time.strftime('%Y%m%d-%H%M%S')}-{ua}.json"
        with open(os.path.join(REPORTS, name), "w") as fh:
            json.dump(report, fh, indent=1)
        print(f"serve.py: report {name}", flush=True)
        self.send_body(json.dumps({"saved": name}).encode(), "application/json")

    def do_GET(self):
        if self.phone and self.path.startswith(("/__states/", "/__saves/", "/__replays/")):
            return self.send_error(404)
        if self.path.split("?")[0] == "/__build":
            return self.send_body(self.build_id().encode(), "text/plain")
        if self.path.startswith(("/__saves/", "/__replays/")):
            f, index = self.kept_file()
            if index is not None:
                return self.send_body(index.encode(), "application/json")
            if not f or not os.path.isfile(f):
                return self.send_error(404)
            with open(f, "rb") as fh:
                return self.send_body(fh.read(), "application/octet-stream")
        if not self.path.startswith("/__states/"):
            return None if self.revalidated() else super().do_GET()
        f = self.state_file()
        if not f or not os.path.isfile(f):
            return self.send_error(404)
        with open(f, "rb") as fh:
            self.send_body(fh.read(), "application/octet-stream")

    def send_body(self, body, kind):
        self.send_response(200)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def build_id(self):
        """The served game's id : the first 16 hex digits of ctr_native.wasm's SHA-256 (cached by mtime)."""
        f = os.path.join(self.directory, "ctr_native.wasm")
        key = os.stat(f).st_mtime_ns
        if BUILD.get("key") != key:
            with open(f, "rb") as fh:
                BUILD.update(key=key, id=hashlib.sha256(fh.read()).hexdigest()[:16])
        return BUILD["id"]


if __name__ == "__main__":
    args = sys.argv[1:]
    Handler.phone = bool(args) and args[0] == "--phone"
    if Handler.phone:
        args = args[1:]
    if not args:
        sys.exit(__doc__)
    port = int(args[1]) if len(args) > 1 else 8093
    handler = functools.partial(Handler, directory=args[0])
    http.server.ThreadingHTTPServer(("127.0.0.1", port), handler).serve_forever()
