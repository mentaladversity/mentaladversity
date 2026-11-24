import json
import os
import secrets
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

import desk
import ears

ROOT = os.path.dirname(os.path.abspath(__file__))
SECRET_PATH = os.path.join(ROOT, ".inbox-secret")
DATA_PATH = os.path.join(ROOT, "inbox-data.json")
BLOCKED = {".inbox-secret", "inbox-data.json"}


def load_secret():
    if os.path.exists(SECRET_PATH):
        with open(SECRET_PATH, encoding="utf-8") as handle:
            return handle.read().strip()
    secret = secrets.token_urlsafe(18)
    with open(SECRET_PATH, "w", encoding="utf-8") as handle:
        handle.write(secret)
    return secret


SECRET = load_secret()


def load_items():
    if not os.path.exists(DATA_PATH):
        return []
    with open(DATA_PATH, encoding="utf-8") as handle:
        try:
            data = json.load(handle)
        except json.JSONDecodeError:
            return []
    return data if isinstance(data, list) else []


def save_items(items):
    with open(DATA_PATH, "w", encoding="utf-8") as handle:
        json.dump(items, handle)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def authorized(self):
        return self.headers.get("X-Inbox-Key", "") == SECRET

    def send_json(self, code, payload):
        raw = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/playing":
            self.send_json(200, desk.current())
            return
        if path == "/api/spectrum":
            self.send_json(200, ears.current())
            return
        if path == "/api/inbox":
            if not self.authorized():
                self.send_json(401, {"error": "no"})
                return
            self.send_json(200, {"items": load_items()})
            return
        name = os.path.basename(path.rstrip("/"))
        if name in BLOCKED or name.startswith("."):
            self.send_error(404)
            return
        super().do_GET()

    def do_POST(self):
        if urlparse(self.path).path != "/api/send":
            self.send_error(404)
            return
        length = int(self.headers.get("Content-Length", "0") or "0")
        if length <= 0 or length > 2_000_000:
            self.send_error(413)
            return
        try:
            body = json.loads(self.rfile.read(length).decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            self.send_error(400)
            return
        kind = body.get("kind")
        name = str(body.get("name") or "").strip()[:40] or "Anon"
        text = str(body.get("text") or "").strip()[:180]
        image = body.get("image") or ""
        if kind == "note":
            if not text:
                self.send_error(400)
                return
            image = ""
        elif kind == "drawing":
            if not isinstance(image, str) or not image.startswith("data:image/png") or len(image) > 1_500_000:
                self.send_error(400)
                return
        else:
            self.send_error(400)
            return
        items = load_items()
        items.insert(0, {
            "id": secrets.token_hex(8),
            "kind": kind,
            "name": name,
            "text": text,
            "image": image,
            "at": time.strftime("%Y-%m-%d %H:%M"),
        })
        save_items(items[:200])
        self.send_json(200, {"ok": True})

    def do_DELETE(self):
        path = urlparse(self.path).path
        prefix = "/api/inbox/"
        if not path.startswith(prefix):
            self.send_error(404)
            return
        if not self.authorized():
            self.send_json(401, {"error": "no"})
            return
        item_id = path[len(prefix):]
        items = [item for item in load_items() if item.get("id") != item_id]
        save_items(items)
        self.send_json(200, {"ok": True})


if __name__ == "__main__":
    desk.start()
    ears.start()
    port = int(os.environ.get("PORT", "8765"))
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
