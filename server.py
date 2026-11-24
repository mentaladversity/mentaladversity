import base64
import json
import os
import secrets
import subprocess
import threading
import time
import urllib.error
import urllib.request
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
            snap = desk.current()
            wave = _clip_wave(snap)
            if wave:
                snap = dict(snap)
                snap["wave"] = wave
            self.send_json(200, snap)
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


def _gh_token():
    env = os.environ.copy()
    env["GH_CONFIG_DIR"] = os.path.join(os.path.expanduser("~"), ".config", "gh-personal")
    try:
        out = subprocess.check_output(
            ["gh", "auth", "token"],
            env=env,
            stderr=subprocess.DEVNULL,
            timeout=8,
        )
    except (OSError, subprocess.SubprocessError):
        return ""
    return out.decode("utf-8", "replace").strip()


def _put_now(token, payload):
    url = "https://api.github.com/repos/mentaladversity/mentaladversity/contents/now.json"
    headers = {
        "Authorization": "Bearer " + token,
        "Accept": "application/vnd.github+json",
        "User-Agent": "bench",
    }
    sha = ""
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=8) as res:
            sha = json.load(res).get("sha") or ""
    except urllib.error.HTTPError as err:
        if err.code != 404:
            raise
    body = {
        "message": "now playing",
        "content": base64.b64encode(json.dumps(payload).encode("utf-8")).decode("ascii"),
    }
    if sha:
        body["sha"] = sha
    raw = json.dumps(body).encode("utf-8")
    put = urllib.request.Request(
        url,
        data=raw,
        method="PUT",
        headers=dict(headers, **{"Content-Type": "application/json"}),
    )
    with urllib.request.urlopen(put, timeout=8) as res:
        res.read()


_kept = {"key": "", "wave": []}
_seeded = False


def _song_key(snap):
    return (snap.get("title") or "") + "\0" + (snap.get("artist") or "")


def _clip_wave(snap):
    wave = ears.current().get("wave") or []
    step = max(1, len(wave) // 160) if wave else 1
    out = []
    for i in range(0, len(wave), step):
        out.append(round(float(wave[i]), 3))
        if len(out) >= 160:
            break
    peak = 0.0
    for value in out:
        peak = max(peak, abs(value))
    key = _song_key(snap)
    if peak >= 0.04:
        _kept["key"] = key
        _kept["wave"] = out
        return out
    if _kept["key"] == key and _kept["wave"]:
        return _kept["wave"]
    return []


def _seed_wave(token, snap):
    global _seeded
    if _seeded or _kept["wave"]:
        _seeded = True
        return
    _seeded = True
    headers = {
        "Authorization": "Bearer " + token,
        "Accept": "application/vnd.github+json",
        "User-Agent": "bench",
    }
    url = "https://api.github.com/repos/mentaladversity/mentaladversity/commits?path=now.json&per_page=8"
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=8) as res:
            commits = json.load(res)
    except Exception:
        return
    want = _song_key(snap)
    for item in commits:
        sha = item.get("sha") or ""
        if not sha:
            continue
        file_url = "https://api.github.com/repos/mentaladversity/mentaladversity/contents/now.json?ref=" + sha
        try:
            req = urllib.request.Request(file_url, headers=headers)
            with urllib.request.urlopen(req, timeout=8) as res:
                body = json.load(res)
            data = json.loads(base64.b64decode(body.get("content") or ""))
        except Exception:
            continue
        wave = data.get("wave") or []
        if _song_key(data) == want and len(wave) >= 8:
            _kept["key"] = want
            _kept["wave"] = wave
            return


def _mirror():
    last = None
    held = False
    token = ""
    while True:
        time.sleep(4)
        try:
            snap = desk.share()
            if not token:
                token = _gh_token()
            if token and not _kept["wave"]:
                _seed_wave(token, snap)
            wave = _clip_wave(snap)
        except Exception:
            continue
        key = (snap["title"], snap["artist"], snap["art"], bool(snap["playing"]), bool(snap["open"]))
        if key != last:
            held = False
        if key == last and (held or not wave):
            continue
        snap["wave"] = wave
        if not token:
            token = _gh_token()
        if not token:
            continue
        try:
            _put_now(token, snap)
            last = key
            held = bool(wave)
        except Exception:
            token = ""


if __name__ == "__main__":
    desk.start()
    ears.start()
    threading.Thread(target=_mirror, name="now", daemon=True).start()
    port = int(os.environ.get("PORT", "8765"))
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
