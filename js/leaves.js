(function () {
  function create(canvas) {
    const ctx = canvas.getContext("2d");
    const leaves = [];
    const outline = [];
    for (let i = 0; i <= 14; i++) {
      const t = i / 14;
      const along = (t - 0.08) * 2.1;
      const width = Math.sin(Math.PI * Math.pow(t, 0.85)) * (0.62 - 0.18 * t);
      const bend = Math.sin(t * Math.PI) * 0.22;
      outline.push([width, along, bend]);
    }
    for (let i = 14; i >= 0; i--) {
      const t = i / 14;
      const along = (t - 0.08) * 2.1;
      const width = Math.sin(Math.PI * Math.pow(t, 0.85)) * (0.62 - 0.18 * t);
      const bend = Math.sin(t * Math.PI) * 0.22;
      outline.push([-width, along, bend]);
    }

    function view() {
      return {
        w: window.innerWidth,
        h: window.innerHeight,
        dpr: Math.min(window.devicePixelRatio || 1, 2)
      };
    }

    function resize() {
      const box = view();
      const w = Math.max(1, Math.round(box.w * box.dpr));
      const h = Math.max(1, Math.round(box.h * box.dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
    }

    function born(along) {
      const box = view();
      const vx = 36 + Math.random() * 150;
      const vy = 42 + Math.random() * 120;
      const speed = Math.hypot(vx, vy);
      const travel = (along ? Math.random() : 0) * (box.w + box.h) * 0.95;
      const time = travel / speed;
      return {
        x: -30 - Math.random() * 70 + vx * time,
        y: -24 - Math.random() * 36 + vy * time,
        vx: vx,
        vy: vy,
        depth: 0.4 + Math.random() * 0.85,
        rx: Math.random() * Math.PI * 2,
        ry: Math.random() * Math.PI * 2,
        rz: Math.random() * Math.PI * 2,
        sx: (Math.random() < 0.5 ? -1 : 1) * (0.35 + Math.random() * 0.7),
        sy: (Math.random() < 0.5 ? -1 : 1) * (0.25 + Math.random() * 0.55),
        sz: (Math.random() < 0.5 ? -1 : 1) * (0.15 + Math.random() * 0.35),
        size: 16 + Math.random() * 18
      };
    }

    resize();
    for (let i = 0; i < 26; i++) leaves.push(born(true));

    let last = 0;

    function frame(time) {
      resize();
      const box = view();
      const t = time || 0;
      const dt = Math.min(32, last ? t - last : 16) / 1000;
      last = t;
      ctx.setTransform(box.dpr, 0, 0, box.dpr, 0, 0);
      ctx.clearRect(0, 0, box.w, box.h);
      leaves.forEach(function (leaf) {
        leaf.x += leaf.vx * dt;
        leaf.y += leaf.vy * dt;
        leaf.rx += leaf.sx * dt;
        leaf.ry += leaf.sy * dt;
        leaf.rz += leaf.sz * dt;
        if (leaf.x > box.w + 80 || leaf.y > box.h + 80) {
          const next = born(false);
          leaf.x = next.x;
          leaf.y = next.y;
          leaf.vx = next.vx;
          leaf.vy = next.vy;
          leaf.depth = next.depth;
          leaf.size = next.size;
        }
      });
      const ordered = leaves.slice().sort(function (a, b) { return a.depth - b.depth; });
      ordered.forEach(function (leaf) {
        const cx = Math.cos(leaf.rx), sx = Math.sin(leaf.rx);
        const cy = Math.cos(leaf.ry), sy = Math.sin(leaf.ry);
        const cz = Math.cos(leaf.rz), sz = Math.sin(leaf.rz);
        const pts = [];
        let facing = 0;
        outline.forEach(function (p) {
          const x = p[0];
          const y = p[1];
          const z = p[2];
          const y1 = y * cx - z * sx;
          const z1 = y * sx + z * cx;
          const x2 = x * cy + z1 * sy;
          const z2 = -x * sy + z1 * cy;
          const x3 = x2 * cz - y1 * sz;
          const y3 = x2 * sz + y1 * cz;
          pts.push([x3, y3, z2]);
        });
        if (pts.length > 3) facing = pts[3][0] * pts[10][1] - pts[10][0] * pts[3][1];
        const light = Math.min(1, Math.abs(facing) * 1.4);
        const shade = Math.round(6 + light * 26 + (1 - leaf.depth) * 16);
        const scale = leaf.size * (0.6 + leaf.depth * 0.55);
        ctx.beginPath();
        pts.forEach(function (p, i) {
          const x = leaf.x + p[0] * scale;
          const y = leaf.y + p[1] * scale;
          if (i) ctx.lineTo(x, y);
          else ctx.moveTo(x, y);
        });
        ctx.closePath();
        ctx.fillStyle = "rgb(" + shade + "," + shade + "," + shade + ")";
        ctx.fill();
      });
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    return { frame: frame, resize: resize };
  }

  window.Leaves = { create: create };
})();
