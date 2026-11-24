import "./heart.js";

(function () {
  var bench = document.getElementById("bench");
  var wires = document.getElementById("wires");
  var song = document.getElementById("song");
  var statusEl = document.getElementById("status");
  function say(text) { if (statusEl) statusEl.textContent = text; }
  var leaves = Leaves.create(document.getElementById("leaves"));
  var heart = Heart.create(document.getElementById("heart"));
  var scope = Scope.create(document.getElementById("scope"));
  var meta = document.getElementById("spotmeta");
  var mq = window.matchMedia("(max-width: 800px)");

  (function typeHello() {
    var el = document.getElementById("hello");
    if (!el) return;
    var line = ">hi.";
    var caret = document.createElement("i");
    var i = 0;
    function step() {
      el.textContent = line.slice(0, i);
      el.appendChild(caret);
      if (i >= line.length) return;
      var wait = i === 0 ? 280 : 130;
      i += 1;
      setTimeout(step, wait);
    }
    step();
  })();

  var lifted = false;
  var follow = true;
  var playing = false;
  var blob = null;
  var actx = null;
  var analyser = null;
  var freq = null;
  var waveBytes = null;
  var drag = null;

  function flash() {
    heart.thump();
  }

  var cables = [
    { a: "heart", b: "monitor-in", mess: [0, 14, 0, -12] },
    { a: "heart-side", b: "repos-side", mess: [16, 10, -16, -8] },
    { a: "plate", b: "repos-top", mess: [20, 6, -16, -6] },
    { a: "monitor-out", b: "spotify", mess: [0, 16, 0, -14] },
    { a: "repos", b: "doodle", mess: [28, 18, -16, 14] },
    { a: "doodle-out", b: "note", mess: [64, 22, 58, -18] }
  ];
  var paths = cables.map(function () {
    var p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    wires.appendChild(p);
    return p;
  });

  function stacked() { return mq.matches; }

  function portPos(name, box) {
    var el = bench.querySelector('[data-port="' + name + '"]');
    if (!el) return null;
    var r = el.getBoundingClientRect();
    return {
      x: r.left + r.width / 2 - box.left,
      y: r.top + r.height / 2 - box.top,
      side: el.getAttribute("data-side")
    };
  }

  var DIR = { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0] };

  function drawWires() {
    if (stacked()) {
      wires.style.display = "none";
      return;
    }
    wires.style.display = "";
    var box = bench.getBoundingClientRect();
    wires.setAttribute("preserveAspectRatio", "none");
    wires.setAttribute("viewBox", "0 0 " + box.width + " " + box.height);
    wires.style.width = box.width + "px";
    wires.style.height = box.height + "px";
    for (var i = 0; i < cables.length; i++) {
      var A = portPos(cables[i].a, box);
      var B = portPos(cables[i].b, box);
      if (!A || !B) continue;
      var mess = cables[i].mess;
      var da = DIR[A.side];
      var db = DIR[B.side];
      var span = Math.hypot(B.x - A.x, B.y - A.y) || 1;
      var lead = Math.min(90, span * 0.38);
      var c1x = A.x + da[0] * lead + mess[0];
      var c1y = A.y + da[1] * lead + mess[1];
      var c2x = B.x + db[0] * lead + mess[2];
      var c2y = B.y + db[1] * lead + mess[3];
      paths[i].setAttribute("d", "M " + A.x + " " + A.y + " C " + c1x + " " + c1y + ", " + c2x + " " + c2y + ", " + B.x + " " + B.y);
    }
  }

  function measureItems() {
    var box = bench.getBoundingClientRect();
    return Array.prototype.map.call(bench.querySelectorAll(".gizmo"), function (el) {
      var r = el.getBoundingClientRect();
      return { el: el, l: r.left - box.left, t: r.top - box.top, w: r.width, h: r.height };
    });
  }

  function paintAbs(items, height) {
    bench.style.height = height + "px";
    items.forEach(function (it) {
      it.el.classList.add("lifted");
      it.el.style.gridColumn = "auto";
      it.el.style.gridRow = "auto";
      it.el.style.left = it.l + "px";
      it.el.style.top = it.t + "px";
      it.el.style.width = it.w + "px";
    });
    lifted = true;
  }

  function freeze() {
    if (lifted || stacked()) return;
    var items = measureItems();
    var bottom = 0;
    items.forEach(function (it) { bottom = Math.max(bottom, it.t + it.h); });
    paintAbs(items, bottom + 8);
  }

  function savePos() {
    if (!lifted) return;
    var box = bench.getBoundingClientRect();
    var data = {};
    bench.querySelectorAll(".gizmo").forEach(function (el) {
      var r = el.getBoundingClientRect();
      data[el.id] = { l: r.left - box.left, t: r.top - box.top, w: r.width };
    });
    localStorage.setItem("bench-pos-v4", JSON.stringify(data));
  }

  function restoreSaved() {
    if (stacked()) return;
    var raw = localStorage.getItem("bench-pos-v4");
    if (!raw) return;
    var saved;
    try { saved = JSON.parse(raw); } catch (e) { return; }
    var items = measureItems();
    var bottom = 0;
    items.forEach(function (it) {
      var s = saved[it.el.id];
      if (s) { it.l = s.l; it.t = s.t; it.w = s.w; }
      bottom = Math.max(bottom, it.t + it.h);
    });
    paintAbs(items, bottom + 8);
  }

  function growBench() {
    if (!lifted || stacked()) return;
    var bottom = 0;
    bench.querySelectorAll(".gizmo").forEach(function (el) {
      bottom = Math.max(bottom, el.offsetTop + el.offsetHeight);
    });
    var next = Math.ceil(bottom + 12);
    if (Math.abs(next - bench.clientHeight) > 3) bench.style.height = next + "px";
  }

  bench.addEventListener("pointerdown", function (e) {
    if (stacked()) return;
    if (e.target.closest("button, a, input, textarea, #pad")) return;
    var heading = e.target.closest(".gizmo h2");
    var spot = e.target.closest("#spotify, #note, #doodle, #heartbox, #plate, #repos");
    if (!heading && !spot) return;
    freeze();
    var el = (heading || spot).closest(".gizmo");
    var r = el.getBoundingClientRect();
    drag = { el: el, dx: e.clientX - r.left, dy: e.clientY - r.top };
    try { el.setPointerCapture(e.pointerId); } catch (err) {}
    el.style.zIndex = "6";
  });

  window.addEventListener("pointermove", function (e) {
    if (!drag) return;
    var box = bench.getBoundingClientRect();
    var l = e.clientX - drag.dx - box.left;
    var t = e.clientY - drag.dy - box.top;
    drag.el.style.left = l + "px";
    drag.el.style.top = t + "px";
    growBench();
  });

  window.addEventListener("pointerup", function () {
    if (!drag) return;
    drag.el.style.zIndex = "";
    drag = null;
    savePos();
    growBench();
  });

  document.getElementById("reset").addEventListener("click", function () {
    localStorage.removeItem("bench-pos-v4");
    bench.querySelectorAll(".gizmo").forEach(function (el) {
      el.classList.remove("lifted");
      el.style.left = "";
      el.style.top = "";
      el.style.width = "";
      el.style.gridColumn = "";
      el.style.gridRow = "";
      el.style.zIndex = "";
    });
    bench.style.height = "";
    lifted = false;
    drawWires();
  });

  mq.addEventListener("change", function () {
    if (stacked()) {
      bench.querySelectorAll(".gizmo").forEach(function (el) {
        el.classList.remove("lifted");
        el.style.left = "";
        el.style.top = "";
        el.style.width = "";
        el.style.gridColumn = "";
        el.style.gridRow = "";
      });
      bench.style.height = "";
      lifted = false;
      wires.style.display = "none";
    } else {
      restoreSaved();
    }
    leaves.resize();
    heart.resize();
    scope.resize();
    sizePad(true);
  });

  var pad = document.getElementById("pad");
  var pctx = pad.getContext("2d");
  var drawing = false;
  var last = null;
  var ink = 2.2;
  var erasing = false;

  function applyInk() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    pctx.lineCap = "round";
    pctx.lineJoin = "round";
    if (erasing) {
      pctx.globalCompositeOperation = "destination-out";
      pctx.lineWidth = 16 * dpr;
    } else {
      pctx.globalCompositeOperation = "source-over";
      pctx.strokeStyle = "#111";
      pctx.lineWidth = ink * dpr;
    }
  }

  function markInk(id) {
    ["inkthin", "inkmid", "inkthick", "inkeraser"].forEach(function (name) {
      document.getElementById(name).classList.toggle("on", name === id);
    });
  }

  document.getElementById("inkthin").addEventListener("click", function () {
    erasing = false;
    ink = 1.1;
    applyInk();
    markInk("inkthin");
  });
  document.getElementById("inkmid").addEventListener("click", function () {
    erasing = false;
    ink = 2.2;
    applyInk();
    markInk("inkmid");
  });
  document.getElementById("inkthick").addEventListener("click", function () {
    erasing = false;
    ink = 4.4;
    applyInk();
    markInk("inkthick");
  });
  document.getElementById("inkeraser").addEventListener("click", function () {
    erasing = true;
    applyInk();
    markInk("inkeraser");
  });
  markInk("inkmid");

  function sizePad(keep) {
    var rect = pad.getBoundingClientRect();
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = Math.max(1, Math.round(rect.width * dpr));
    var h = Math.max(1, Math.round(rect.height * dpr));
    if (pad.width === w && pad.height === h) return;
    var prev = keep && pad.width ? pad.toDataURL() : null;
    pad.width = w;
    pad.height = h;
    pctx.lineCap = "round";
    pctx.lineJoin = "round";
    applyInk();
    var stored = prev || localStorage.getItem("bench-doodle");
    if (stored) {
      var img = new Image();
      img.onload = function () { pctx.drawImage(img, 0, 0, w, h); };
      img.src = stored;
    }
  }

  function padPoint(e) {
    var r = pad.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * (pad.width / r.width),
      y: (e.clientY - r.top) * (pad.height / r.height)
    };
  }

  pad.addEventListener("pointerdown", function (e) {
    drawing = true;
    pad.setPointerCapture(e.pointerId);
    last = padPoint(e);
  });
  pad.addEventListener("pointermove", function (e) {
    if (!drawing) return;
    var q = padPoint(e);
    pctx.beginPath();
    pctx.moveTo(last.x, last.y);
    pctx.lineTo(q.x, q.y);
    pctx.stroke();
    last = q;
  });
  function endDraw() {
    if (!drawing) return;
    drawing = false;
    try { localStorage.setItem("bench-doodle", pad.toDataURL()); } catch (e) {}
  }
  pad.addEventListener("pointerup", endDraw);
  pad.addEventListener("pointercancel", endDraw);

  document.getElementById("clearpad").addEventListener("click", function () {
    pctx.clearRect(0, 0, pad.width, pad.height);
    localStorage.removeItem("bench-doodle");
  });

  function sendIn(body) {
    return fetch("/api/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }).then(function (res) {
      if (!res.ok) throw new Error("nope");
    });
  }

  document.getElementById("drawform").addEventListener("submit", function (e) {
    e.preventDefault();
    var pix = pctx.getImageData(0, 0, pad.width, pad.height).data;
    var ink = 0;
    for (var i = 3; i < pix.length; i += 40) if (pix[i] > 20) ink++;
    if (!ink) return;
    sendIn({
      kind: "drawing",
      name: "",
      image: pad.toDataURL("image/png")
    });
  });

  document.getElementById("noteform").addEventListener("submit", function (e) {
    e.preventDefault();
    var box = document.getElementById("notetext");
    var text = box.value.trim();
    if (!text) return;
    var name = document.getElementById("notename").value;
    sendIn({ kind: "note", name: name, text: text }).then(function () {
      box.value = "";
    });
  });

  var localAudio = false;

  function ensureAudio() {
    if (actx) return;
    var AC = window.AudioContext || window.webkitAudioContext;
    actx = new AC();
    var src = actx.createMediaElementSource(song);
    analyser = actx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.55;
    src.connect(analyser);
    analyser.connect(actx.destination);
    freq = new Uint8Array(analyser.frequencyBinCount);
    waveBytes = new Uint8Array(analyser.fftSize);
  }

  async function playSrc(url) {
    ensureAudio();
    if (actx.state === "suspended") await actx.resume();
    song.src = url;
    follow = true;
    try {
      await song.play();
      playing = true;
      return true;
    } catch (e) {
      playing = false;
      say("playback got blocked. try the file again.");
      return false;
    }
  }

  song.addEventListener("ended", function () {
    playing = false;
    localAudio = false;
    say("quiet");
  });

  NowPlaying.start(function (info) {
    if (localAudio) return;
    if (!info || !info.title) {
      say(info && info.open === false ? "spotify isn't open" : "spotify is quiet");
      return;
    }
    say((info.playing ? "now: " : "paused: ") + info.title + (info.artist ? ", " + info.artist : ""));
    growBench();
  });

  var monitorBox = document.getElementById("monitorbox");
  monitorBox.addEventListener("dragover", function (e) {
    if (!e.dataTransfer || !e.dataTransfer.types || e.dataTransfer.types.indexOf("Files") === -1) return;
    e.preventDefault();
    monitorBox.classList.add("hot");
  });
  monitorBox.addEventListener("dragleave", function () { monitorBox.classList.remove("hot"); });
  monitorBox.addEventListener("drop", async function (e) {
    if (!e.dataTransfer) return;
    e.preventDefault();
    monitorBox.classList.remove("hot");
    var file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (!file) return;
    if (file.type && file.type.indexOf("audio") !== 0 && !/\.(mp3|wav|ogg|m4a|flac|aac)$/i.test(file.name)) {
      say("that file isn't audio");
      return;
    }
    if (blob) URL.revokeObjectURL(blob);
    blob = URL.createObjectURL(file);
    meta.textContent = file.name;
    var heardFile = await playSrc(blob);
    if (heardFile) {
      localAudio = true;
      say("listening to " + file.name);
    }
  });

  var prevBass = 0;
  var lastHit = 0;
  function hear(bytes) {
    if (!bytes || !bytes.length) return;
    var bass = 0;
    var n = Math.min(6, bytes.length);
    for (var i = 0; i < n; i++) bass += bytes[i];
    bass /= n;
    var now = performance.now();
    if (bass > 42 && bass > prevBass + 16 && now - lastHit > 260) {
      lastHit = now;
      flash();
    }
    prevBass = prevBass * 0.7 + bass * 0.3;
  }

  function loop(t) {
    if (playing && analyser) {
      analyser.getByteFrequencyData(freq);
      hear(freq);
      analyser.getByteTimeDomainData(waveBytes);
      var samples = new Array(waveBytes.length);
      for (var i = 0; i < waveBytes.length; i++) samples[i] = (waveBytes[i] - 128) / 128;
      scope.setWave(samples);
    }
    borrowedWave();
    scope.frame();
    heart.frame(scope.loud(), t || 0);
    leaves.frame(t || 0);
    NowPlaying.tick();
    drawWires();
    requestAnimationFrame(loop);
  }

  var seenHit = 0;
  var heardScope = 0;
  var heldWave = "";
  setInterval(function () {
    if (localAudio && playing && follow) return;
    fetch("/api/spectrum").then(function (res) { return res.json(); }).then(function (data) {
      if (!data) return;
      if (data.wave && scope.setWave(data.wave)) heardScope = performance.now();
      if (!data.live || !data.hit || data.hit === seenHit) return;
      seenHit = data.hit;
      flash();
    }).catch(function () {});
  }, 70);

  function borrowedWave() {
    if (localAudio && playing) return;
    if (performance.now() - heardScope < 800) return;
    var wave = NowPlaying.wave();
    if (!wave || wave.length < 8) return;
    var mark = wave.length + ":" + wave[0] + ":" + wave[wave.length >> 1] + ":" + wave[wave.length - 1];
    if (mark === heldWave) return;
    heldWave = mark;
    scope.hold(wave);
  }

  function gmail(addr) {
    return "https://mail.google.com/mail/?view=cm&fs=1&to=" + encodeURIComponent(addr);
  }

  function decode64(b64) {
    var bin = atob(String(b64 || "").replace(/\s/g, ""));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  function letter(text) {
    var esc = String(text || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    esc = esc.replace(/\[([^\]]+)\]\(mailto:([^)\s]+)\)/gi, function (_, label, addr) {
      return '<a href="' + gmail(addr) + '" target="_blank" rel="noreferrer">' + label + "</a>";
    });
    esc = esc.replace(/(^|[^"'=/>])([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/gi, function (_, pre, addr) {
      return pre + '<a href="' + gmail(addr) + '" target="_blank" rel="noreferrer">' + addr + "</a>";
    });
    return esc;
  }

  function pour(id, text) {
    var box = document.getElementById(id);
    if (!box) return;
    var lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
    var next = "";
    lines.forEach(function (line) {
      if (!line.trim()) return;
      next += "<p>" + letter(line) + "</p>";
    });
    if (box.innerHTML === next) return;
    box.innerHTML = next;
    growBench();
  }

  function pullSheet(file, id) {
    var url = "https://api.github.com/repos/mentaladversity/mentaladversity/contents/" + file + "?t=" + Date.now();
    return fetch(url, { cache: "no-store" }).then(function (res) {
      if (!res.ok) throw new Error("nope");
      return res.json();
    }).then(function (data) {
      pour(id, decode64(data.content));
    }).catch(function () {});
  }

  function pullWords() {
    pullSheet("README.md", "readcopy");
    pullSheet("inbox.md", "inboxcopy");
  }

  pullWords();
  setInterval(pullWords, 60000);
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) pullWords();
  });

  sizePad(false);
  restoreSaved();
  requestAnimationFrame(loop);
  window.addEventListener("resize", function () {
    leaves.resize();
    heart.resize();
    scope.resize();
    sizePad(true);
    drawWires();
  });
})();
