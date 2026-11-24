import base64
import hashlib
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
STAMP_PATH = os.path.join(ROOT, ".inbox-seal")
BLOCKED = {".inbox-secret", "inbox-data.json", ".inbox-seal"}
GIST_ID = "10139de4077471515386b5a280439afa"
_FRAME_N = 160
_FRAME_DT = 125
_RING_KEEP = 800
_ring_lock = threading.Lock()
_ring = []


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
    threading.Thread(target=_publish_inbox, args=(list(items),), daemon=True).start()


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


def _items_hash(items):
    raw = json.dumps(items, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def _seal(items):
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

    salt = os.urandom(16)
    iv = os.urandom(12)
    kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=200000)
    key = kdf.derive(SECRET.encode("utf-8"))
    locked = AESGCM(key).encrypt(iv, json.dumps(items).encode("utf-8"), None)
    return {
        "v": 1,
        "iter": 200000,
        "salt": base64.b64encode(salt).decode("ascii"),
        "iv": base64.b64encode(iv).decode("ascii"),
        "ct": base64.b64encode(locked).decode("ascii"),
    }


def _put_file(token, name, text, message):
    url = "https://api.github.com/repos/mentaladversity/mentaladversity/contents/" + name
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
        "message": message,
        "content": base64.b64encode(text.encode("utf-8")).decode("ascii"),
    }
    if sha:
        body["sha"] = sha
    put = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        method="PUT",
        headers=dict(headers, **{"Content-Type": "application/json"}),
    )
    with urllib.request.urlopen(put, timeout=20) as res:
        res.read()


def _publish_inbox(items):
    digest = _items_hash(items)
    if os.path.exists(STAMP_PATH):
        with open(STAMP_PATH, encoding="utf-8") as handle:
            if handle.read().strip() == digest:
                return
    token = _gh_token()
    if not token or not SECRET:
        print("inbox lock skipped")
        return
    try:
        _put_file(token, "inbox.enc", json.dumps(_seal(items), separators=(",", ":")), "lock the inbox")
    except Exception as err:
        print("inbox lock failed", getattr(err, "code", ""))
        return
    with open(STAMP_PATH, "w", encoding="utf-8") as handle:
        handle.write(digest)


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


def _capture_frame():
    wave = ears.current().get("wave") or []
    n = _FRAME_N
    if len(wave) < 8:
        return [0] * n
    span = len(wave)
    out = []
    for i in range(n):
        sample = float(wave[min(span - 1, int(i * span / n))])
        out.append(int(max(-127, min(127, round(sample * 70)))))
    return out


def _record_scope():
    nxt = time.perf_counter()
    while True:
        nxt += _FRAME_DT / 1000
        delay = nxt - time.perf_counter()
        if delay > 0:
            time.sleep(delay)
        else:
            nxt = time.perf_counter()
        frame = _capture_frame()
        with _ring_lock:
            _ring.append(frame)
            extra = len(_ring) - _RING_KEEP
            if extra > 0:
                del _ring[:extra]


def _scope_blob(at_ms):
    with _ring_lock:
        frames = list(_ring)
    if len(frames) < 8:
        return None
    peak = 0
    for frame in frames:
        for value in frame:
            if abs(value) > peak:
                peak = abs(value)
    if peak < 3:
        return None
    raw = bytearray()
    for frame in frames:
        for value in frame:
            raw.append(value & 0xFF)
    return {
        "n": _FRAME_N,
        "dt": _FRAME_DT,
        "t0": int(at_ms - (len(frames) - 1) * _FRAME_DT),
        "b": base64.b64encode(bytes(raw)).decode("ascii"),
    }


def _patch_gist(token, payload):
    url = "https://api.github.com/gists/" + GIST_ID
    body = json.dumps({
        "files": {
            "now.json": {"content": json.dumps(payload, separators=(",", ":"))}
        }
    }).encode("utf-8")
    headers = {
        "Authorization": "Bearer " + token,
        "Accept": "application/vnd.github+json",
        "User-Agent": "bench",
        "Content-Type": "application/json",
    }
    req = urllib.request.Request(url, data=body, method="PATCH", headers=headers)
    with urllib.request.urlopen(req, timeout=20) as res:
        res.read()


def _mirror():
    last = None
    last_gist = 0.0
    wait_until = 0.0
    token = ""
    while True:
        time.sleep(2)
        if time.time() < wait_until:
            continue
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
        changed = key != last
        due = (time.time() - last_gist) >= (15 if snap["playing"] else 45)
        if not changed and not due:
            continue
        if not token:
            token = _gh_token()
        if not token:
            continue
        rich = dict(snap)
        if wave:
            rich["wave"] = wave
        if snap["playing"]:
            blob = _scope_blob(snap["at"])
            if blob:
                rich["scope"] = blob
        try:
            _patch_gist(token, rich)
        except Exception as err:
            token = ""
            wait_until = time.time() + 15
            print("now save failed", getattr(err, "code", ""))
            continue
        last_gist = time.time()
        last = key


if __name__ == "__main__":
    desk.start()
    ears.start()
    threading.Thread(target=_record_scope, name="scope", daemon=True).start()
    threading.Thread(target=_mirror, name="now", daemon=True).start()
    threading.Thread(target=_publish_inbox, args=(load_items(),), name="inbox", daemon=True).start()
    port = int(os.environ.get("PORT", "8765"))
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
