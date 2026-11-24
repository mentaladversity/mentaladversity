(function () {
  function create(canvas) {
    const ctx = canvas.getContext("2d");
    const roll = new Float32Array(720);
    let rollHead = 0;
    let raw = [];
    let locked = [];
    let lockIndex = 0;
    let lockAt = 0;
    let liveAt = 0;
    let loud = 0;
    let mode = "trig";
    let time = "mid";
    let gain = 1;
    const modes = ["trig", "roll", "fill"];
    const times = ["short", "mid", "long"];
    const gains = [1, 2, 4];
    const spanOf = { short: 0.16, mid: 0.42, long: 0.9 };

    const modeBtn = document.getElementById("kmode");
    const timeBtn = document.getElementById("ktime");
    const gainBtn = document.getElementById("kgain");

    function cycle(list, value) {
      return list[(list.indexOf(value) + 1) % list.length];
    }

    modeBtn.addEventListener("click", function () {
      mode = cycle(modes, mode);
      modeBtn.textContent = mode;
    });
    timeBtn.addEventListener("click", function () {
      time = cycle(times, time);
      timeBtn.textContent = time;
    });
    gainBtn.addEventListener("click", function () {
      gain = cycle(gains, gain);
      gainBtn.textContent = gain + "x";
    });

    function resize() {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(rect.width * dpr));
      const h = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
    }

    function absorb(samples) {
      if (!samples || !samples.length) return;
      raw = samples;
      let acc = 0;
      for (let i = 0; i < samples.length; i++) acc += Math.abs(samples[i]);
      loud += (acc / samples.length - loud) * 0.4;
    }

    function push(sample) {
      roll[rollHead] = sample;
      rollHead = (rollHead + 1) % roll.length;
    }

    function findTrigger(samples, count) {
      const room = Math.max(1, samples.length - count);
      let peak = 0;
      for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
      const minRise = Math.max(0.08, peak * 0.18);
      let best = 0;
      let bestRise = minRise;
      for (let i = 1; i < room; i++) {
        const rise = samples[i] - samples[i - 1];
        if (samples[i - 1] <= 0 && samples[i] > 0 && rise > bestRise) {
          bestRise = rise;
          best = i;
        }
      }
      return best;
    }

    function considerLock(force) {
      if (!raw.length) return;
      const now = performance.now();
      if (!force && locked.length && now - lockAt < 900) return;
      const count = Math.max(32, Math.floor(raw.length * (spanOf[time] || 0.42)));
      locked = raw.slice();
      lockIndex = findTrigger(locked, count);
      lockAt = now;
    }

    function setWave(samples) {
      if (!samples || !samples.length) return;
      absorb(samples);
      liveAt = performance.now();
      const step = Math.max(1, Math.floor(samples.length / 8));
      for (let i = 0; i < samples.length; i += step) push(samples[i]);
      considerLock(false);
    }

    function hold(samples) {
      absorb(samples);
      considerLock(true);
    }

    function windowed() {
      const frac = spanOf[time] || 0.42;
      const rolling = mode === "roll" && performance.now() - liveAt < 400;
      if (rolling) {
        const count = Math.max(32, Math.floor(roll.length * frac));
        const out = new Array(count);
        for (let i = 0; i < count; i++) {
          out[i] = roll[(rollHead - count + i + roll.length) % roll.length];
        }
        return out;
      }
      const src = locked.length ? locked : raw;
      if (!src.length) return [];
      const count = Math.max(32, Math.min(src.length, Math.floor(src.length * frac)));
      const start = Math.min(lockIndex, Math.max(0, src.length - count));
      return src.slice(start, start + count);
    }

    function frame() {
      resize();
      const samples = windowed();
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      const mid = h / 2;
      ctx.strokeStyle = "#d6d6d6";
      ctx.lineWidth = Math.max(1, h / 220);
      ctx.beginPath();
      ctx.moveTo(0, mid);
      ctx.lineTo(w, mid);
      ctx.stroke();
      if (!samples.length) return;
      const amp = h * 0.4;
      ctx.beginPath();
      for (let i = 0; i < samples.length; i++) {
        const x = (i / (samples.length - 1)) * (w - 2) + 1;
        const y = mid - Math.max(-1.4, Math.min(1.4, samples[i])) * amp * gain;
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      }
      if (mode === "fill") {
        ctx.lineTo(w - 1, mid);
        ctx.lineTo(1, mid);
        ctx.closePath();
        ctx.fillStyle = "#111";
        ctx.globalAlpha = 0.14;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.strokeStyle = "#111";
      ctx.lineWidth = Math.max(1.5, h / 150);
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.stroke();
    }

    return {
      frame: frame,
      resize: resize,
      setWave: setWave,
      hold: hold,
      push: push,
      loud: function () { return loud; }
    };
  }

  window.Scope = { create: create };
})();
