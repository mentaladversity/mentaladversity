(function () {
  var onTrack = function () {};
  var anchor = { progress: 0, at: 0, duration: 0, playing: false, title: "" };
  var lastKey = "";
  var publicAt = 0;
  var sharedWave = [];

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
    box.classList.remove("nodur");
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

  function show(info) {
    var box = document.getElementById("now");
    box.hidden = false;
    box.classList.remove("bare");
    box.classList.toggle("nodur", !info.duration);
    document.getElementById("nowtitle").textContent = info.title;
    document.getElementById("nowartist").textContent = info.artist || "";
    var img = document.getElementById("nowart");
    if (info.art) {
      img.hidden = false;
      if (img.src !== info.art) img.src = info.art;
      img.alt = info.title;
    } else {
      img.hidden = true;
    }
    var live = document.getElementById("spotlive");
    if (live) live.classList.toggle("on", !!info.playing);
    var shown = anchor.playing
      ? Math.min(anchor.duration || Infinity, anchor.progress + (performance.now() - anchor.at))
      : anchor.progress;
    var next = info.progress || 0;
    var playing = !!info.playing;
    var same = info.title && info.title === anchor.title;
    if (playing && anchor.playing && same && next < shown && shown - next < 12000) next = shown;
    anchor.title = info.title || "";
    anchor.progress = next;
    anchor.duration = info.duration || 0;
    anchor.playing = playing;
    anchor.at = performance.now();
    var key = (info.playing ? "1" : "0") + "|" + info.title + "|" + (info.artist || "");
    if (key !== lastKey) {
      lastKey = key;
      onTrack(info);
    }
  }

  function quiet(open) {
    paintEmpty(open ? "nothing playing" : "spotify isn't open");
    var key = open ? "quiet" : "closed";
    if (lastKey !== key) {
      lastKey = key;
      onTrack(open ? null : { open: false });
    }
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

  function catchUp(info) {
    if (info && info.playing && info.at) {
      var extra = Math.min(8000, Math.max(0, Date.now() - info.at));
      var moved = (info.progress || 0) + extra;
      info.progress = info.duration ? Math.min(info.duration, moved) : moved;
    }
    return info;
  }

  async function pullPublic() {
    var urls = [
      "https://raw.githubusercontent.com/mentaladversity/mentaladversity/main/now.json?t=" + Date.now(),
      "now.json?t=" + Date.now()
    ];
    for (var i = 0; i < urls.length; i++) {
      try {
        var res = await fetch(urls[i], { cache: "no-store" });
        if (!res.ok) continue;
        return catchUp(await res.json());
      } catch (err) {}
    }
    return null;
  }

  async function poll() {
    var data = await pullLocal();
    if (!data) {
      if (publicAt > Date.now()) return;
      publicAt = Date.now() + 4000;
      data = await pullPublic();
    }
    if (!data) {
      note("");
      var box = document.getElementById("now");
      if (box) box.hidden = true;
      return;
    }
    note("");
    if (data.wave && data.wave.length > 7) sharedWave = data.wave;
    if (!data.title) {
      quiet(!!data.open);
      return;
    }
    show(data);
  }

  function tick() {
    if (!anchor.duration) return;
    var ms = anchor.playing
      ? Math.min(anchor.duration, anchor.progress + (performance.now() - anchor.at))
      : anchor.progress;
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
    wave: function () { return sharedWave; }
  };
})();
