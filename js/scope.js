(function () {
  function create(canvas) {
    const ctx = canvas.getContext("2d");
    const roll = new Float32Array(720);
    let rollHead = 0;
    let raw = [];
    let loud = 0;
    let trigAt = 0;
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

    function setWave(samples) {
      if (!samples || !samples.length) return;
      absorb(samples);
      const step = Math.max(1, Math.floor(samples.length / 40));
      for (let i = 0; i < samples.length; i += step) push(samples[i]);
    }

    function windowed() {
      const frac = spanOf[time] || 0.42;
      if (mode === "roll") {
        const count = Math.max(32, Math.floor(roll.length * frac));
        const out = new Array(count);
        for (let i = 0; i < count; i++) {
          out[i] = roll[(rollHead - count + i + roll.length) % roll.length];
        }
        return out;
      }
      if (!raw.length) return [];
      const count = Math.max(32, Math.floor(raw.length * frac));
      const room = Math.max(1, raw.length - count);
      let peak = 0;
      for (let i = 0; i < raw.length; i++) peak = Math.max(peak, Math.abs(raw[i]));
      const minRise = Math.max(0.08, peak * 0.18);
      let best = -1;
      let bestRise = minRise;
      for (let i = 1; i < room; i++) {
        const rise = raw[i] - raw[i - 1];
        if (raw[i - 1] <= 0 && raw[i] > 0 && rise > bestRise) {
          bestRise = rise;
          best = i;
        }
      }
      if (best >= 0 && trigAt) {
        let near = -1;
        let nearRise = bestRise * 0.55;
        const lo = Math.max(1, trigAt - 30);
        const hi = Math.min(room, trigAt + 30);
        for (let i = lo; i < hi; i++) {
          const rise = raw[i] - raw[i - 1];
          if (raw[i - 1] <= 0 && raw[i] > 0 && rise > nearRise) {
            nearRise = rise;
            near = i;
          }
        }
        if (near >= 0) best = near;
      }
      if (best < 0) best = Math.min(trigAt, room - 1);
      trigAt = best;
      return raw.slice(best, best + count);
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
      hold: absorb,
      push: push,
      loud: function () { return loud; }
    };
  }

  window.Scope = { create: create };
})();
