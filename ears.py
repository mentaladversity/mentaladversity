import threading
import time

import numpy as np
import soundcard as sc

BANDS = 28
_lock = threading.Lock()
_bands = [0.0] * BANDS
_wave = [0.0] * 640
_live = False
_hit = 0.0
_gap = 980.0


def current():
    with _lock:
        return {"bins": list(_bands), "wave": list(_wave), "live": _live, "hit": _hit, "gap": _gap}


def start():
    threading.Thread(target=_run, name="ears", daemon=True).start()


def _shape(data):
    mono = data.mean(axis=1) if getattr(data, "ndim", 1) == 2 else data
    mono = np.asarray(mono, dtype=np.float64)
    mono = mono - mono.mean()
    rms = float(np.sqrt(np.mean(mono * mono)))
    spec = np.abs(np.fft.rfft(mono * np.hanning(mono.shape[0])))[1:]
    hi = len(spec)
    out = []
    for i in range(BANDS):
        a = int((i / BANDS) ** 1.35 * (hi - 1))
        b = int(((i + 1) / BANDS) ** 1.35 * (hi - 1)) + 1
        if b <= a:
            b = a + 1
        out.append(float(spec[a:b].mean()))
    return rms, out


def _scope(data, hold):
    mono = data.mean(axis=1) if getattr(data, "ndim", 1) == 2 else data
    mono = np.asarray(mono, dtype=np.float64)
    mono = mono - mono.mean()
    n = int(mono.shape[0])
    inst = float(np.max(np.abs(mono))) if n else 0.0
    if n < 8 or hold < 1e-5:
        return [0.0] * len(_wave), inst
    idx = np.linspace(0, n - 1, len(_wave)).astype(int)
    samples = mono[idx] / hold
    return [float(max(-1.6, min(1.6, s))) for s in samples], inst


def _scan():
    best = ""
    best_rms = -1.0
    for speaker in sc.all_speakers():
        name = str(speaker.name)
        try:
            mic = sc.get_microphone(id=name, include_loopback=True)
            with mic.recorder(samplerate=44100) as rec:
                rms, _ = _shape(rec.record(numframes=2048))
        except Exception:
            continue
        if rms > best_rms:
            best_rms = rms
            best = name
    if best:
        return best
    return str(sc.default_speaker().name)


def _corr(series, lag):
    if lag < 8 or lag >= len(series) // 2:
        return 0.0
    a = series[:-lag]
    b = series[lag:]
    denom = float(np.linalg.norm(a) * np.linalg.norm(b))
    if denom < 1e-6:
        return 0.0
    return float(np.dot(a, b) / denom)


def _period(history, around):
    if len(history) < 24:
        return None
    t0 = history[0][0]
    t1 = history[-1][0]
    if t1 - t0 < 2.4:
        return None
    step = 0.02
    n = int((t1 - t0) / step)
    if n < 40:
        return None
    series = np.zeros(n)
    for tt, bb in history:
        i = int((tt - t0) / step)
        if 0 <= i < n:
            series[i] = max(series[i], bb)
    series = series - series.mean()
    lo, hi = 340, 1100
    if around:
        lo = max(340, int(around * 0.86))
        hi = min(1100, int(around * 1.14))
    best = None
    best_c = 0.22
    for lag_ms in range(lo, hi, 20):
        score = _corr(series, int(lag_ms / 20))
        if score > best_c:
            best_c = score
            best = lag_ms
    if best and best * 2 <= 1100:
        slower = _corr(series, int(best * 2 / 20))
        if slower >= best_c * 0.82:
            best *= 2
    return best


def _run():
    global _live, _hit, _gap
    peak = 1e-4
    wave_hold = 1e-4
    env = 0.0
    history = []
    clock = 0.0
    quiet = 0
    while True:
        try:
            name = _scan()
            mic = sc.get_microphone(id=name, include_loopback=True)
            with mic.recorder(samplerate=44100) as rec:
                quiet = 0
                while quiet < 30:
                    data = rec.record(numframes=2048)
                    rms, mags = _shape(data)
                    wave, inst = _scope(data, wave_hold)
                    wave_hold = max(wave_hold * 0.97, inst, 1e-5)
                    clock += 2048 / 44100
                    loud = max(mags) if mags else 0.0
                    peak = max(peak * 0.96, loud, 1e-6)
                    norm = [min(1.0, m / peak) for m in mags]
                    bass = float(sum(mags[:4]) / 4)
                    heard = rms > 0.0015
                    if heard:
                        quiet = 0
                        history.append((clock, bass))
                        history = [(tt, bb) for tt, bb in history if clock - tt < 6]
                    else:
                        quiet += 1
                    found = _period(history, _gap if _hit else None)
                    now_ms = time.time() * 1000
                    with _lock:
                        if heard or quiet < 8:
                            _bands[:] = norm
                            _live = True
                            if found and heard:
                                _gap = found
                                due = _hit == 0 or now_ms >= _hit + found * 0.85
                                if due and bass > max(0.15, env * 1.3):
                                    _hit = now_ms
                                elif _hit and now_ms - _hit > found * 1.2:
                                    _hit = _hit + found
                            if heard:
                                env = max(bass, env * 0.92)
                                _wave[:] = wave
                        else:
                            _bands[:] = [0.0] * BANDS
                            _wave[:] = [0.0] * len(_wave)
                            _live = False
                            env *= 0.9
        except Exception:
            with _lock:
                _live = False
            time.sleep(0.4)
