import asyncio
import ctypes
import json
import threading
import time
import urllib.parse
import urllib.request
from ctypes import wintypes

_lock = threading.Lock()
_snap = {
    "title": "",
    "artist": "",
    "art": "",
    "playing": False,
    "progress": 0,
    "duration": 0,
    "open": False,
}
_art = {"key": "", "url": ""}
_art_lock = threading.Lock()


def current():
    with _lock:
        return dict(_snap)


def share():
    snap = current()
    art = snap.get("art") or ""
    key = (snap.get("artist") or "") + "\0" + (snap.get("title") or "")
    if not str(art).startswith("http"):
        with _art_lock:
            cached = _art["url"] if _art["key"] == key else ""
        if str(cached).startswith("http"):
            art = cached
        elif snap.get("title"):
            _cover(snap.get("artist") or "", snap.get("title") or "")
            art = ""
    return {
        "title": snap.get("title") or "",
        "artist": snap.get("artist") or "",
        "art": art if str(art).startswith("http") else "",
        "playing": bool(snap.get("playing")),
        "progress": int(snap.get("progress") or 0),
        "duration": int(snap.get("duration") or 0),
        "open": bool(snap.get("open")),
        "at": int(time.time() * 1000),
    }


def start():
    threading.Thread(target=_run, name="desk", daemon=True).start()


def _run():
    import sys
    sys.coinit_flags = 2
    asyncio.run(_loop())


def _spotify_open():
    user32 = ctypes.windll.user32
    kernel32 = ctypes.windll.kernel32
    user32.GetWindowTextLengthW.argtypes = [wintypes.HWND]
    user32.GetWindowTextLengthW.restype = ctypes.c_int
    user32.GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
    user32.IsWindowVisible.argtypes = [wintypes.HWND]
    user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
    kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel32.OpenProcess.restype = wintypes.HANDLE
    kernel32.QueryFullProcessImageNameW.argtypes = [
        wintypes.HANDLE, wintypes.DWORD, wintypes.LPWSTR, ctypes.POINTER(wintypes.DWORD)
    ]
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    titles = []

    @ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    def each(hwnd, _lparam):
        if not user32.IsWindowVisible(hwnd):
            return True
        length = user32.GetWindowTextLengthW(hwnd)
        if length <= 0:
            return True
        title = ctypes.create_unicode_buffer(length + 1)
        user32.GetWindowTextW(hwnd, title, length + 1)
        pid = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        handle = kernel32.OpenProcess(0x1000, False, pid.value)
        if not handle:
            return True
        try:
            path = ctypes.create_unicode_buffer(1024)
            size = wintypes.DWORD(1024)
            ok = kernel32.QueryFullProcessImageNameW(handle, 0, path, ctypes.byref(size))
            if ok and path.value.lower().endswith("\\spotify.exe"):
                titles.append(title.value)
        finally:
            kernel32.CloseHandle(handle)
        return True

    user32.EnumWindows(each, 0)
    return titles


def _from_window(titles):
    for title in titles:
        if " - " not in title:
            continue
        song, artist = title.split(" - ", 1)
        song = song.strip()
        artist = artist.strip()
        if not song:
            continue
        return {
            "title": song,
            "artist": artist,
            "art": _cover(artist, song),
            "playing": True,
            "progress": 0,
            "duration": 0,
            "open": True,
        }
    return {
        "title": "",
        "artist": "",
        "art": "",
        "playing": False,
        "progress": 0,
        "duration": 0,
        "open": True,
    }


def _cover(artist, title):
    key = artist + "\0" + title
    with _art_lock:
        if _art["key"] == key:
            return _art["url"]
        _art["key"] = key
        _art["url"] = ""
    threading.Thread(target=_fetch_cover, args=(key, artist, title), daemon=True).start()
    return ""


def _fetch_cover(key, artist, title):
    url = ""
    try:
        query = urllib.parse.urlencode({"term": artist + " " + title, "entity": "song", "limit": "1"})
        with urllib.request.urlopen("https://itunes.apple.com/search?" + query, timeout=4) as res:
            data = json.load(res)
        results = data.get("results") or []
        if results:
            url = (results[0].get("artworkUrl100") or "").replace("100x100bb", "300x300bb")
    except (OSError, ValueError, KeyError):
        url = ""
    with _art_lock:
        if _art["key"] == key:
            _art["url"] = url


def _ms(value):
    if value is None:
        return 0
    total = getattr(value, "total_seconds", None)
    if total:
        return max(0, int(total() * 1000))
    try:
        return max(0, int(value) // 10000)
    except (TypeError, ValueError):
        return 0


async def _thumb(props):
    ref = props.thumbnail
    if ref is None:
        return ""
    from winrt.windows.storage.streams import DataReader
    stream = await ref.open_read_async()
    size = int(stream.size)
    if size <= 0 or size > 1_500_000:
        return ""
    reader = DataReader(stream)
    loaded = await reader.load_async(size)
    raw = bytearray(int(loaded or size))
    reader.read_bytes(raw)
    kind = "jpeg"
    if raw[:8] == b"\x89PNG\r\n\x1a\n":
        kind = "png"
    import base64
    return "data:image/" + kind + ";base64," + base64.b64encode(raw).decode("ascii")


async def _from_session(session):
    from winrt.windows.media.control import GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status
    props = await session.try_get_media_properties_async()
    if props is None or not (props.title or "").strip():
        return None
    info = session.get_playback_info()
    timeline = session.get_timeline_properties()
    title = (props.title or "").strip()
    artist = (props.artist or "").strip()
    art = ""
    try:
        art = await _thumb(props)
    except (OSError, RuntimeError, TypeError, ValueError):
        art = ""
    if not art:
        art = _cover(artist, title)
    return {
        "title": title,
        "artist": artist,
        "art": art,
        "playing": info.playback_status == Status.PLAYING,
        "progress": _ms(timeline.position),
        "duration": _ms(timeline.end_time),
        "open": True,
    }


def _is_spotify(session):
    name = (session.source_app_user_model_id or "").lower()
    return "spotify" in name


async def _read():
    titles = _spotify_open()
    from winrt.windows.media.control import GlobalSystemMediaTransportControlsSessionManager as Manager
    manager = await Manager.request_async()
    sessions = [session for session in manager.get_sessions() if _is_spotify(session)]
    current_session = manager.get_current_session()
    if current_session is not None and _is_spotify(current_session):
        sessions.insert(0, current_session)
    for session in sessions:
        snap = await _from_session(session)
        if snap:
            return snap
    if titles:
        return _from_window(titles)
    return {
        "title": "",
        "artist": "",
        "art": "",
        "playing": False,
        "progress": 0,
        "duration": 0,
        "open": False,
    }


async def _loop():
    while True:
        try:
            snap = await _read()
        except Exception:
            snap = {
                "title": "",
                "artist": "",
                "art": "",
                "playing": False,
                "progress": 0,
                "duration": 0,
                "open": False,
            }
        with _lock:
            _snap.clear()
            _snap.update(snap)
        await asyncio.sleep(1)
