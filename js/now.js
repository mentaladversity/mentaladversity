(function () {
  var onTrack = function () {};
  var anchor = { progress: 0, at: 0, duration: 0, playing: false, title: "", snapAt: 0, snapProgress: 0 };
  var lastKey = "";
  var publicAt = 0;
  var gistWait = 0;
  var sharedWave = [];
  var clip = null;
  var playAt = 0;
  var playLocal = 0;
  var GIST = "10139de4077471515386b5a280439afa";
  var previewDown = /(?:\?|&)down=1(?:&|$)/.test(location.search);
  var lastArt = "";

  function clock(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    var m = Math.floor(s / 60);
    s = s % 60;
    return m + ":" + (s < 10 ? "0" : "") + s;
  }

  function note(text) {
    var el = document.getElementById("spotmeta");
    if (el) el.textContent = text || "";
  }

  function paintEmpty(label) {
    var box = document.getElementById("now");
    box.hidden = false;
    box.classList.add("bare");
    box.classList.remove("nodur", "lasted");
    document.getElementById("nowtitle").textContent = label;
    document.getElementById("nowartist").textContent = "";
    document.getElementById("nowart").hidden = true;
    document.getElementById("nowtime").textContent = "";
    document.getElementById("nowfill").style.width = "0";
    var live = document.getElementById("spotlive");
    if (live) live.classList.remove("on");
    anchor.playing = false;
    anchor.duration = 0;
  }

  function shownNow() {
    var ms = anchor.playing ? anchor.progress + (performance.now() - anchor.at) : anchor.progress;
    if (anchor.duration) ms = Math.min(anchor.duration, ms);
    return ms;
  }

  function markServer(down) {
    var box = document.getElementById("monitorbox");
    if (box) box.classList.toggle("down", !!down);
  }

  function gone(info) {
    if (previewDown) return true;
    if (!info || typeof info.at !== "number" || info.at < 1000000000000) return false;
    return Date.now() - info.at > 480000;
  }

  function paintLast(info) {
    var box = document.getElementById("now");
    var title = (info && info.title) || anchor.title || "";
    var art = (info && info.art) || lastArt || "";
    box.hidden = false;
    box.classList.remove("nodur");
    box.classList.toggle("bare", !art);
    box.classList.add("lasted");
    document.getElementById("nowtitle").textContent = title ? "Last played: " + title : "Last played";
    document.getElementById("nowartist").textContent = "";
    var img = document.getElementById("nowart");
    if (art) {
      img.hidden = false;
      if (img.src !== art) img.src = art;
      img.alt = title;
    } else {
      img.hidden = true;
    }
    document.getElementById("nowtime").textContent = "";
    document.getElementById("nowfill").style.width = "0";
    anchor.playing = false;
    markServer(true);
    note("");
  }

  function paintSong(info) {
    var box = document.getElementById("now");
    box.hidden = false;
    box.classList.remove("bare", "lasted");
    box.classList.toggle("nodur", !info.duration);
    markServer(false);
    document.getElementById("nowtitle").textContent = info.title;
    document.getElementById("nowartist").textContent = info.artist || "";
    var img = document.getElementById("nowart");
    if (info.art) {
      lastArt = info.art;
      img.hidden = false;
      if (img.src !== info.art) img.src = info.art;
      img.alt = info.title;
    } else {
      img.hidden = true;
    }
    var live = document.getElementById("spotlive");
    if (live) live.classList.toggle("on", !!info.playing);
  }

  function remember(info) {
    var key = (info.playing ? "1" : "0") + "|" + info.title + "|" + (info.artist || "");
    if (key !== lastKey) {
      lastKey = key;
      onTrack(info);
    }
  }

  function showLocal(info) {
    var shown = shownNow();
    var next = info.progress || 0;
    var playing = !!info.playing;
    var same = info.title && info.title === anchor.title;
    if (playing && anchor.playing && same && next < shown && shown - next < 12000) next = shown;
    anchor.title = info.title || "";
    anchor.progress = next;
    anchor.duration = info.duration || 0;
    anchor.playing = playing;
    anchor.at = performance.now();
  }

  function showPublic(info) {
    var age = Math.max(0, Date.now() - info.at);
    var extra = info.playing ? Math.min(age, 150000) : 0;
    var next = (info.progress || 0) + extra;
    if (info.duration) next = Math.min(info.duration, next);
    var shown = shownNow();
    var same = info.title && info.title === anchor.title;
    var dropped = anchor.snapProgress - (info.progress || 0);
    var seek = same && info.playing && anchor.snapAt && info.at > anchor.snapAt && dropped > 25000;
    if (same && next < shown && !seek) next = shown;
    anchor.snapAt = info.at;
    anchor.snapProgress = info.progress || 0;
    anchor.title = info.title || "";
    anchor.progress = next;
    anchor.duration = info.duration || 0;
    anchor.playing = !!info.playing && age <= 150000;
    anchor.at = performance.now();
  }

  function show(info) {
    if (gone(info)) {
      paintLast(info);
      return;
    }
    paintSong(info);
    if (typeof info.at === "number") showPublic(info);
    else showLocal(info);
    remember(info);
  }

  function quiet(open, at) {
    if (gone({ at: at || 0 }) && (anchor.title || previewDown)) {
      paintLast({ title: anchor.title, art: lastArt });
      return;
    }
    markServer(false);
    paintEmpty(open ? "nothing playing" : "spotify isn't open");
    if (at) anchor.snapAt = at;
    var key = open ? "quiet" : "closed";
    if (lastKey !== key) {
      lastKey = key;
      onTrack(open ? null : { open: false });
    }
  }

  function clipEnd(item) {
    return item.t0 + (item.frames.length - 1) * item.dt;
  }

  function decodeScope(scope, at) {
    var n = scope.n || 160;
    var dt = scope.dt || 125;
    var raw;
    try {
      raw = atob(scope.b);
    } catch (err) {
      return null;
    }
    var count = Math.floor(raw.length / n);
    if (count < 2) return null;
    var frames = new Array(count);
    for (var i = 0; i < count; i++) {
      var row = new Array(n);
      for (var j = 0; j < n; j++) {
        var v = raw.charCodeAt(i * n + j);
        if (v > 127) v -= 256;
        row[j] = v / 70;
      }
      frames[i] = row;
    }
    return { stamp: at, t0: scope.t0 || at, dt: dt, frames: frames };
  }

  function adopt(scope, at) {
    if (clip && clip.stamp === at) return;
    var next = decodeScope(scope, at);
    if (!next) return;
    var now = performance.now();
    var end = clipEnd(next);
    var cursor;
    if (!playLocal) cursor = Math.max(next.t0, end - 70000);
    else {
      cursor = playAt + (now - playLocal);
      if (cursor < next.t0) cursor = Math.max(next.t0, end - 70000);
      else if (cursor > end) cursor = end;
    }
    playAt = cursor;
    playLocal = now;
    clip = next;
  }

  function frame(now) {
    if (!clip) return null;
    var end = clipEnd(clip);
    var cursor = playAt + (now - playLocal);
    if (cursor < clip.t0) cursor = clip.t0;
    if (cursor > end) cursor = end;
    var i = Math.floor((cursor - clip.t0) / clip.dt);
    if (i < 0) i = 0;
    if (i >= clip.frames.length) i = clip.frames.length - 1;
    return { id: clip.stamp + ":" + i, samples: clip.frames[i] };
  }

  async function pullLocal() {
    try {
      var res = await fetch("/api/playing");
      if (!res.ok) return null;
      return await res.json();
    } catch (err) {
      return null;
    }
  }

  async function pullGist() {
    if (gistWait > Date.now()) return null;
    try {
      var res = await fetch("https://api.github.com/gists/" + GIST, {
        headers: { Accept: "application/vnd.github+json" },
        cache: "no-store"
      });
      if (res.status === 403) {
        gistWait = Date.now() + 600000;
        return null;
      }
      if (!res.ok) return null;
      var body = await res.json();
      var file = body.files && body.files["now.json"];
      if (!file || file.truncated || !file.content) return null;
      return JSON.parse(file.content);
    } catch (err) {
      return null;
    }
  }

  async function pullGistFile() {
    try {
      var res = await fetch("https://gist.githubusercontent.com/mentaladversity/" + GIST + "/raw/now.json", { cache: "no-store" });
      if (!res.ok) return null;
      return await res.json();
    } catch (err) {
      return null;
    }
  }

  async function pullPublic() {
    var data = await pullGist();
    if (data) return data;
    return pullGistFile();
  }

  async function poll() {
    var data = await pullLocal();
    if (!data) {
      if (publicAt > Date.now()) return;
      publicAt = Date.now() + 90000;
      data = await pullPublic();
    }
    if (!data) {
      note("");
      var box = document.getElementById("now");
      if (box) box.hidden = true;
      return;
    }
    note("");
    if (typeof data.at === "number" && anchor.snapAt && data.at + 500 < anchor.snapAt) return;
    if (data.scope && data.scope.b) adopt(data.scope, data.at || 0);
    else if (data.wave && data.wave.length > 7) sharedWave = data.wave;
    if (!data.title) {
      quiet(!!data.open, data.at || 0);
      return;
    }
    show(data);
  }

  function tick() {
    if (!anchor.duration) return;
    var ms = shownNow();
    document.getElementById("nowfill").style.width = (100 * ms / anchor.duration) + "%";
    document.getElementById("nowtime").textContent = clock(ms) + " / " + clock(anchor.duration);
  }

  function start(trackChanged) {
    onTrack = trackChanged || onTrack;
    poll();
    setInterval(poll, 2000);
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) poll();
    });
  }

  window.NowPlaying = {
    start: start,
    tick: tick,
    wave: function () { return sharedWave; },
    frame: frame
  };
})();
