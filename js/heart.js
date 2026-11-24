import * as THREE from "three";

function buildSolid() {
  const solid = new THREE.Group();
  const material = new THREE.LineBasicMaterial({
    color: 0x111111,
    transparent: true,
    opacity: 0.9
  });
  const geometry = new THREE.IcosahedronGeometry(1, 1);
  solid.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry), material));
  return solid;
}

function create(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: true });
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 20);
  camera.position.set(0, 0, 4.1);
  const solid = buildSolid();
  scene.add(solid);

  let yaw = 0.4;
  let thump = 0;
  let last = 0;

  function resize() {
    const w = Math.max(1, canvas.clientWidth);
    const h = Math.max(1, canvas.clientHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function frame(level, time) {
    resize();
    const t = time || 0;
    const dt = last ? Math.min(40, t - last) : 16;
    last = t;
    yaw += dt * 0.00045;
    thump *= Math.exp(-dt / 170);
    const pump = 1 + Math.min(0.16, (level || 0) * 0.22) + thump * 0.14;
    solid.rotation.y = yaw;
    solid.rotation.x = yaw * 0.37;
    solid.scale.setScalar(pump);
    renderer.render(scene, camera);
  }

  return {
    frame: frame,
    resize: resize,
    thump: function () { thump = 1; }
  };
}

window.Heart = { create: create };
