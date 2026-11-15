/* ==================================================================
   UNLEASH THE BEAST - M5 Competition-style car site (phone friendly)

   - Loads a real car model (car.glb) with studio reflections.
     If the file is missing it falls back to a built-in low-poly car.
   - Twin-turbo V8 engine sound is synthesised live (no audio files),
     or you can plug in a real recording (CONFIG.engineSample).
   - Pixel ratio is capped and auto-lowered if the phone struggles.
   ================================================================== */

/* ---- V8 engine DSP: runs inside an AudioWorklet (own audio thread) ---- */
function m5Worklet() {
  const AMP = [1.0, 0.72, 0.9, 0.62, 0.95, 0.7, 0.82, 0.66]; // cross-plane unevenness
  const JIT = [0, 0.06, -0.04, 0.08, -0.02, 0.05, -0.06, 0.03];

  class M5Engine extends AudioWorkletProcessor {
    static get parameterDescriptors() {
      return [
        { name: 'rpm', defaultValue: 850, minValue: 300, maxValue: 9000, automationRate: 'k-rate' },
        { name: 'throttle', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
        { name: 'boost', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' }
      ];
    }
    constructor() {
      super();
      this.ph = 0; this.cyl = 0; this.burst = 0; this.pop = 0;
      this.seed = 22222; this.nlp = 0; this.plp = 0; this.wph = 0;
      this.crk = 0; this.hpl = 0; this.bang = 0; this.bph = 0;
      this.cd = Math.exp(-1 / (sampleRate * 0.0012));
      this.bgd = Math.exp(-1 / (sampleRate * 0.11));
      this.port.onmessage = (e) => { if (e.data === 'bang') this.bang = 1; };
      this.bd = Math.exp(-1 / (sampleRate * 0.0025));
      this.pd = Math.exp(-1 / (sampleRate * 0.03));
      // exhaust / body resonances (phone speakers need energy above ~200 Hz)
      this.f = [this.bp(190, 1.6, 1.0), this.bp(400, 2.0, 0.9), this.bp(820, 1.8, 0.7), this.bp(1800, 1.2, 0.35)];
    }
    bp(freq, q, gain) {
      const w = 2 * Math.PI * freq / sampleRate, al = Math.sin(w) / (2 * q), a0 = 1 + al;
      return { b0: al / a0, b2: -al / a0, a1: -2 * Math.cos(w) / a0, a2: (1 - al) / a0, x1: 0, x2: 0, y1: 0, y2: 0, g: gain };
    }
    rnd() {
      this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
      return this.seed / 4294967296;
    }
    process(inputs, outputs, p) {
      const out = outputs[0][0];
      const rpm = p.rpm[0], thr = p.throttle[0], boost = p.boost[0];
      const fire = rpm / 15 / sampleRate; // V8: 4 firings per revolution
      const drive = 2.2 + 2.2 * thr;
      // sport-exhaust crackle when off the throttle at revs
      const over = (thr < 0.25 && rpm > 1800) ? Math.min(1, rpm / 5000) : 0;
      const crkP = 140 * over / sampleRate;
      for (let i = 0; i < out.length; i++) {
        this.ph += fire * (1 + JIT[this.cyl]);
        if (this.ph >= 1) {
          this.ph -= 1;
          const k = this.cyl;
          this.cyl = (k + 1) & 7;
          const a = AMP[k] * (0.65 + 0.35 * thr) * (0.85 + 0.3 * this.rnd());
          this.burst = Math.min(1.6, this.burst + a);
          // overrun burble / pops when off throttle at revs
          if (thr < 0.2 && rpm > 2200 && this.rnd() < 0.09 * Math.min(1, rpm / 7000)) {
            this.pop = Math.min(1.5, this.pop + 0.9);
          }
        }
        this.burst *= this.bd;
        this.pop *= this.pd;
        const n = this.rnd() * 2 - 1;
        if (crkP > 0 && this.rnd() < crkP) this.crk = 0.4 + 0.6 * this.rnd();
        this.crk *= this.cd;
        this.hpl += (n - this.hpl) * 0.3;
        const crack = this.crk * (n - this.hpl);
        this.bang *= this.bgd;
        const src = this.burst * (0.55 + 0.9 * n);
        let ex = 0;
        for (let j = 0; j < 4; j++) {
          const f = this.f[j];
          const y = f.b0 * src + f.b2 * f.x2 - f.a1 * f.y1 - f.a2 * f.y2;
          f.x2 = f.x1; f.x1 = src; f.y2 = f.y1; f.y1 = y;
          ex += y * f.g;
        }
        ex = Math.tanh(ex * drive) * 0.75;
        this.nlp += (n - this.nlp) * 0.12;
        const intake = this.nlp * (0.03 + 0.10 * thr) * Math.min(1, rpm / 7000);
        this.plp += (n - this.plp) * 0.07;
        const popS = this.pop * this.plp * 1.6;
        this.wph += (2200 + 3300 * boost) / sampleRate;
        if (this.wph >= 1) this.wph -= 1;
        const whistle = Math.sin(6.2831853 * this.wph) * 0.02 * boost; // turbo spool
        this.bph += (70 + 90 * this.bang) / sampleRate;
        if (this.bph >= 1) this.bph -= 1;
        const bangS = this.bang * (0.55 * Math.sin(6.2831853 * this.bph) + 2.0 * this.plp);
        out[i] = Math.tanh((ex * 0.7 + intake + popS + whistle + crack * 0.5 + bangS * 0.8) * 1.1);
      }
      return true;
    }
  }
  registerProcessor('m5-engine', M5Engine);
}
/* WORKLET-END */

(() => {
  'use strict';

  const SITE = window.SITE || {};

  /* ------------------------- EDIT ME ------------------------- */
  const CONFIG = {
    modelUrl: null,        // put your own BMW model here, e.g. 'car.glb' (same folder). null = built-in M5-style car.
    modelFlip: false,      // set true if the car drives backwards
    wheelAxis: 'x',        // axis the wheels spin around inside your model ('x', 'y' or 'z')
    spinWheels: true,      // set false if wheels wobble in your model
    paintMatch: /body|paint|carpaint|exterior|shell/i, // material names that get recoloured
    engineSample: null,    // optional real recording, e.g. 'engine.mp3' (see notes)
    sampleRpm: 3000,       // rpm the recording was made at (only for engineSample)
    volume: 0.9,
    // hex = car paint, glow = colour of the lights / page glow when that paint is picked
    colors: [
      { name: 'Blue',   hex: 0x1c3fd1, glow: 0x2f6bff },
      { name: 'Red',    hex: 0xc4101f, glow: 0xe11d48 },
      { name: 'Black',  hex: 0x1b1c20, glow: 0x8b5cf6 },
      { name: 'White',  hex: 0xe8e8ec, glow: 0x0ea5e9 },
      { name: 'Purple', hex: 0x6d28d9, glow: 0xa855f7 },
      { name: 'Lime',   hex: 0xa6e11a, glow: 0x65a30d }
    ],
    // Links come from config.js (edit them there, once)
    destinations: [
      { label: 'TikTok',       url: SITE.tiktok },
      { label: 'YouTube',      url: SITE.youtube },
      { label: 'My Portfolio', url: SITE.portfolio || 'portfolio.html' }
    ]
  };
  /* ----------------------------------------------------------- */

  const $ = (id) => document.getElementById(id);
  const canvas = $('scene');
  const ui = $('ui');

  function showError(msg) {
    const el = $('error');
    el.textContent = msg;
    el.classList.add('show');
  }

  if (typeof THREE === 'undefined') {
    showError('Could not load Three.js. Check your internet connection and reload.');
    return;
  }

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: true,
      powerPreference: 'high-performance'
    });
  } catch (e) {
    showError('WebGL is not available on this device or browser.');
    return;
  }

  let pixelRatio = Math.min(window.devicePixelRatio || 1, 1.25);
  renderer.setPixelRatio(pixelRatio);
  renderer.setClearColor(0x000000, 0);
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;

  // colours are written as normal hex; convert for correct (sRGB) output
  const C = (hex) => new THREE.Color(hex).convertSRGBToLinear();
  const TAU = Math.PI * 2;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(C(0x08080a), 16, 75);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);

  /* ------------------------- lights ------------------------- */
  scene.add(new THREE.AmbientLight(0xffffff, 0.35));
  const key = new THREE.DirectionalLight(0xffffff, 0.9);
  key.position.set(4, 6, 5);
  scene.add(key);
  const rim = new THREE.DirectionalLight(C(CONFIG.colors[0].glow), 0.9);
  rim.position.set(-5, 3, -4);
  scene.add(rim);
  const rim2 = new THREE.DirectionalLight(C(CONFIG.colors[0].glow), 0.6);
  rim2.position.set(5, 2, -3.5);
  scene.add(rim2);

  /* ------------------------- helpers ------------------------- */
  function radialTexture(size, stops) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    stops.forEach(([o, col]) => grd.addColorStop(o, col));
    g.fillStyle = grd;
    g.fillRect(0, 0, size, size);
    const t = new THREE.CanvasTexture(c);
    t.encoding = THREE.sRGBEncoding;
    return t;
  }

  function extrudeProfile(pts, depth, bevel) {
    const shape = new THREE.Shape();
    shape.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0], pts[i][1]);
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth,
      bevelEnabled: true,
      bevelThickness: bevel,
      bevelSize: bevel,
      bevelSegments: 1,
      curveSegments: 1
    });
    geo.translate(0, 0, -depth / 2);
    return geo;
  }

  function angleDiff(a, b) {
    return ((a - b + Math.PI) % TAU + TAU) % TAU - Math.PI;
  }

  /* ------------------------- studio reflections ------------------------- */
  // A tiny painted "photo studio" turned into a reflection map (made once).
  function makeEnvironment() {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 256;
    const g = c.getContext('2d');
    const grd = g.createLinearGradient(0, 0, 0, 256);
    grd.addColorStop(0, '#cfd6e0');
    grd.addColorStop(0.45, '#4a4f59');
    grd.addColorStop(0.5, '#15161a');
    grd.addColorStop(1, '#050506');
    g.fillStyle = grd;
    g.fillRect(0, 0, 512, 256);
    [[40, 30, 90, 26, '#ffffff'], [190, 24, 120, 20, '#7dd3fc'], [360, 34, 100, 26, '#ffffff'],
     [290, 70, 36, 60, '#f472b6'], [452, 90, 30, 70, '#8b5cf6'], [110, 80, 30, 50, '#22d3ee']
    ].forEach((r) => { g.fillStyle = r[4]; g.fillRect(r[0], r[1], r[2], r[3]); });
    g.fillStyle = 'rgba(255,255,255,0.5)';
    g.fillRect(0, 118, 512, 5);
    const tex = new THREE.CanvasTexture(c);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.encoding = THREE.sRGBEncoding;
    const pm = new THREE.PMREMGenerator(renderer);
    const rt = pm.fromEquirectangular(tex);
    tex.dispose();
    pm.dispose();
    return rt.texture;
  }
  let envTex = null;
  try {
    envTex = makeEnvironment();
    scene.environment = envTex;
  } catch (e) { /* reflections are optional */ }

  /* ------------------------- car containers ------------------------- */
  const carRoot = new THREE.Group();   // yaw + position
  const carPitch = new THREE.Group();  // squat / nose-up
  carRoot.add(carPitch);
  scene.add(carRoot);

  const paintMats = [];                 // materials recoloured by the swatches
  const paintTarget = C(CONFIG.colors[0].hex);
  const wheels = [];                    // { obj, axis, base }
  let smokeX = -1.45, smokeZ = 0.8;     // where tire smoke comes from (car space)

  /* ------------------------- built-in M5-style car ------------------------- */
  function buildProceduralCar() {
    const withEnv = (m, r) => { if (envTex) { m.envMap = envTex; m.reflectivity = r; } return m; };
    const paint = withEnv(new THREE.MeshPhongMaterial({ color: paintTarget.clone(), specular: 0xcccccc, shininess: 110 }), 0.42);
    paintMats.push(paint);
    const dark = new THREE.MeshLambertMaterial({ color: C(0x0a0a0c) });
    const carbon = withEnv(new THREE.MeshPhongMaterial({ color: C(0x0d0e12), specular: 0x555566, shininess: 90 }), 0.25);
    const glass = withEnv(new THREE.MeshPhongMaterial({ color: C(0x080b10), specular: 0x6677aa, shininess: 140 }), 0.5);
    const tire = new THREE.MeshLambertMaterial({ color: C(0x0c0c0c) });
    const gun = new THREE.MeshPhongMaterial({ color: C(0x2a2d33), specular: 0xaaaaaa, shininess: 80 });
    const spokeMat = new THREE.MeshPhongMaterial({ color: C(0xc9ccd2), specular: 0xffffff, shininess: 70 });
    const chrome = withEnv(new THREE.MeshPhongMaterial({ color: C(0xb0b4bb), specular: 0xffffff, shininess: 100 }), 0.5);
    const headMat = new THREE.MeshBasicMaterial({ color: C(0xeaf4ff) });
    const drlMat = new THREE.MeshBasicMaterial({ color: C(0x9fd8ff) });
    const tailMat = new THREE.MeshBasicMaterial({ color: C(0xff1a1a) });
    const black = new THREE.MeshBasicMaterial({ color: 0x000000 });

    const WY = 0.4, WX = 1.45, AR = 0.5;
    function arch(cx) {
      const pts = [[cx - AR, 0.3]];
      for (let i = 0; i <= 10; i++) {
        const th = Math.PI * (1 - i / 10);
        pts.push([cx + AR * Math.cos(th), WY + AR * Math.sin(th)]);
      }
      pts.push([cx + AR, 0.3]);
      return pts;
    }
    const bodyProfile = [
      [-2.4, 0.3], ...arch(-WX), ...arch(WX),
      [2.3, 0.3], [2.46, 0.55], [2.48, 0.82], [2.36, 0.96],
      [1.0, 1.03], [0.7, 1.0], [-1.3, 1.04], [-2.3, 1.08], [-2.43, 0.95]
    ];
    carPitch.add(new THREE.Mesh(extrudeProfile(bodyProfile, 1.72, 0.04), paint));
    carPitch.add(new THREE.Mesh(
      extrudeProfile([[-1.35, 1.03], [-0.85, 1.4], [0.05, 1.44], [0.75, 1.01]], 1.5, 0.03), glass));

    function addBox(w, h, d, x, y, z, mat) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      carPitch.add(m);
      return m;
    }

    // roof (carbon), hood ridges
    const roof = addBox(0.95, 0.05, 1.56, -0.4, 1.435, 0, carbon);
    roof.rotation.z = 0.044;
    addBox(1.3, 0.02, 0.07, 1.55, 1.035, 0.28, paint);
    addBox(1.3, 0.02, 0.07, 1.55, 1.035, -0.28, paint);

    // front end: twin kidney grille, intakes, splitter, headlights + light signature
    [-1, 1].forEach((s2) => {
      addBox(0.07, 0.2, 0.4, 2.5, 0.6, s2 * 0.23, carbon);
      addBox(0.075, 0.025, 0.34, 2.5, 0.64, s2 * 0.23, chrome);
      addBox(0.075, 0.025, 0.34, 2.5, 0.56, s2 * 0.23, chrome);
      addBox(0.07, 0.14, 0.34, 2.47, 0.42, s2 * 0.62, dark);
      addBox(0.05, 0.07, 0.5, 2.46, 0.88, s2 * 0.58, headMat);
      addBox(0.05, 0.02, 0.5, 2.465, 0.935, s2 * 0.58, drlMat);
      addBox(0.34, 0.05, 0.025, 1.75, 0.8, s2 * 0.905, dark);   // fender gills
      addBox(2.0, 0.07, 0.05, 0, 0.33, s2 * 0.9, carbon);       // side skirts
      addBox(0.15, 0.1, 0.24, 0.7, 1.1, s2 * 0.98, carbon);     // mirrors
    });
    addBox(0.07, 0.13, 1.1, 2.49, 0.38, 0, dark);
    addBox(0.3, 0.04, 1.8, 2.4, 0.28, 0, carbon);

    // rear: split tail lights, small lip spoiler, diffuser, quad exhaust
    addBox(0.05, 0.1, 0.62, -2.44, 0.97, 0.52, tailMat);
    addBox(0.05, 0.1, 0.62, -2.44, 0.97, -0.52, tailMat);
    addBox(0.05, 0.025, 0.4, -2.44, 0.99, 0, tailMat);
    addBox(0.16, 0.05, 1.45, -2.34, 1.11, 0, carbon);
    addBox(0.28, 0.1, 1.5, -2.42, 0.38, 0, carbon);
    [-0.72, -0.46, 0.46, 0.72].forEach((z) => {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.2, 14), chrome);
      p.rotation.z = Math.PI / 2;
      p.position.set(-2.5, 0.4, z);
      carPitch.add(p);
      const hole = new THREE.Mesh(new THREE.CircleGeometry(0.055, 12), black);
      hole.rotation.y = -Math.PI / 2;
      hole.position.set(-2.602, 0.4, z);
      carPitch.add(hole);
    });

    // dark filler inside the wheel arches (hides see-through)
    [-WX, WX].forEach((x) => addBox(1.0, 0.6, 1.3, x, 0.62, 0, dark));

    // wheels: gunmetal rim with 10 silver spokes
    const spokeGeo = new THREE.BoxGeometry(0.05, 0.2, 0.025);
    function makeWheel(x, z) {
      const sgn = z > 0 ? 1 : -1;
      const g = new THREE.Group();
      const t = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.32, 22), tire);
      const r = new THREE.Mesh(new THREE.CylinderGeometry(0.29, 0.29, 0.33, 20), gun);
      const h = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.36, 10), chrome);
      t.rotation.x = r.rotation.x = h.rotation.x = Math.PI / 2;
      g.add(t, r, h);
      for (let i = 0; i < 10; i++) {
        const a = i * TAU / 10;
        const sp = new THREE.Mesh(spokeGeo, spokeMat);
        sp.position.set(Math.cos(a) * 0.165, Math.sin(a) * 0.165, sgn * 0.168);
        sp.rotation.z = a - Math.PI / 2;
        g.add(sp);
      }
      g.position.set(x, WY, z);
      carPitch.add(g);
      wheels.push({ obj: g, axis: 'z', base: 0 });
    }
    makeWheel(WX, 0.8); makeWheel(WX, -0.8); makeWheel(-WX, 0.8); makeWheel(-WX, -0.8);
    smokeX = -WX; smokeZ = 0.8;
  }

  /* ------------------------- shadow + floor ------------------------- */
  const shadowTex = radialTexture(64, [[0, 'rgba(0,0,0,0.85)'], [0.6, 'rgba(0,0,0,0.35)'], [1, 'rgba(0,0,0,0)']]);
  const blob = new THREE.Mesh(
    new THREE.PlaneGeometry(6.4, 3.4),
    new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false })
  );
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.02;
  blob.renderOrder = 1;
  carRoot.add(blob);

  const spotTex = radialTexture(128, [[0, 'rgba(255,255,255,0.28)'], [0.5, 'rgba(255,255,255,0.1)'], [1, 'rgba(255,255,255,0)']]);
  const floorSpot = new THREE.Mesh(
    new THREE.PlaneGeometry(15, 15),
    new THREE.MeshBasicMaterial({ map: spotTex, transparent: true, depthWrite: false })
  );
  floorSpot.rotation.x = -Math.PI / 2;
  floorSpot.position.y = 0.001;
  scene.add(floorSpot);

  // glowing rings under the car (colour follows the paint)
  const ringMat1 = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide });
  const ringMat2 = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25, depthWrite: false, side: THREE.DoubleSide });
  const ring1 = new THREE.Mesh(new THREE.RingGeometry(3.0, 3.07, 72), ringMat1);
  const ring2 = new THREE.Mesh(new THREE.RingGeometry(3.55, 3.58, 72), ringMat2);
  ring1.rotation.x = ring2.rotation.x = -Math.PI / 2;
  ring1.position.y = ring2.position.y = 0.015;
  scene.add(ring1, ring2);

  // paint-linked glow colour (kept in sRGB for the page, converted for 3D)
  const tintSrgb = new THREE.Color(CONFIG.colors[0].glow);
  const tintTarget = new THREE.Color(CONFIG.colors[0].glow);
  const tintLin = new THREE.Color();
  let lastTintStr = '';
  function applyTint() {
    tintLin.copy(tintSrgb).convertSRGBToLinear();
    floorSpot.material.color.copy(tintLin);
    ringMat1.color.copy(tintLin);
    ringMat2.color.copy(tintLin);
    rim.color.copy(tintLin);
    rim2.color.copy(tintLin);
    const str = Math.round(tintSrgb.r * 255) + ',' + Math.round(tintSrgb.g * 255) + ',' + Math.round(tintSrgb.b * 255);
    if (str !== lastTintStr) {
      lastTintStr = str;
      document.documentElement.style.setProperty('--tint-rgb', str);
    }
  }
  applyTint();

  /* ------------------------- real model (car.glb) ------------------------- */
  const loaderEl = $('loader');
  const loaderTxt = $('loader-text');

  function hideLoader(delay) {
    setTimeout(() => loaderEl.classList.add('gone'), delay || 0);
  }

  function useFallback(reason) {
    buildProceduralCar();
    loaderTxt.textContent = reason;
    hideLoader(2200);
  }

  function isAncestor(a, o) {
    let n = o.parent;
    while (n) { if (n === a) return true; n = n.parent; }
    return false;
  }

  function setupModel(root) {
    // 1) orient: long axis -> +X (car forward)
    root.rotation.y = 0;
    root.updateMatrixWorld(true);
    let box = new THREE.Box3().setFromObject(root);
    let size = box.getSize(new THREE.Vector3());
    root.rotation.y = (size.z > size.x ? Math.PI / 2 : 0) + (CONFIG.modelFlip ? Math.PI : 0);
    root.updateMatrixWorld(true);

    // 2) scale to a 4.9 unit long car, sit on the ground, centre it
    box = new THREE.Box3().setFromObject(root);
    size = box.getSize(new THREE.Vector3());
    const s = 4.9 / size.x;
    root.scale.multiplyScalar(s);
    root.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(root);
    const ctr = box.getCenter(new THREE.Vector3());
    root.position.x -= ctr.x;
    root.position.z -= ctr.z;
    root.position.y -= box.min.y;
    root.updateMatrixWorld(true);
    size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());

    // 3) find paint materials + count triangles per material
    const counts = new Map();
    root.traverse((o) => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const g = o.geometry;
      const tris = (g.index ? g.index.count : g.attributes.position.count) / 3;
      mats.forEach((m) => counts.set(m, (counts.get(m) || 0) + tris));
    });
    let found = [];
    counts.forEach((c, m) => { if (CONFIG.paintMatch.test(m.name || '')) found.push(m); });
    if (!found.length) {
      const skip = /glass|window|tire|tyre|rubber|wheel|rim|light|chrome|interior|seat|brake|disc|black|plastic|carbon|grill/i;
      let best = null, bc = 0;
      counts.forEach((c, m) => { if (!skip.test(m.name || '') && c > bc) { best = m; bc = c; } });
      if (best) found = [best];
    }
    found.forEach((m) => {
      if (m.color) m.color.copy(paintTarget);
      if (m.map) m.map = null;
      if ('metalness' in m) { m.metalness = 0.6; m.roughness = 0.28; }
      m.envMapIntensity = 1.3;
      paintMats.push(m);
    });
    counts.forEach((c, m) => { if ('envMapIntensity' in m && !found.includes(m)) m.envMapIntensity = 1.1; });

    // 4) wheels
    if (CONFIG.spinWheels) {
      const cand = [];
      root.traverse((o) => {
        if (/wheel/i.test(o.name) && !/(brake|caliper|disc|nut|bolt)/i.test(o.name)) cand.push(o);
      });
      const top = cand.filter((o) => !cand.some((p) => p !== o && isAncestor(p, o)));
      if (top.length >= 2 && top.length <= 8) {
        top.forEach((o) => wheels.push({ obj: o, axis: CONFIG.wheelAxis, base: o.rotation[CONFIG.wheelAxis] }));
      }
    }

    // 5) smoke from the rear wheels, shadow sized to the car
    smokeX = -size.x * 0.3;
    smokeZ = size.z * 0.4;
    blob.scale.set(1, size.z / 1.85, 1);

    carPitch.add(root);
  }

  (function loadCar() {
    if (!CONFIG.modelUrl) { buildProceduralCar(); hideLoader(0); return; }
    if (!THREE.GLTFLoader) { useFallback('Model loader missing - using built-in car'); return; }
    const loader = new THREE.GLTFLoader();
    if (THREE.DRACOLoader) {
      const draco = new THREE.DRACOLoader();
      draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.4.1/');
      loader.setDRACOLoader(draco);
    }
    loader.load(
      CONFIG.modelUrl,
      (gltf) => {
        try {
          setupModel(gltf.scene);
          hideLoader(0);
        } catch (err) {
          console.error(err);
          useFallback('Could not read the model - using built-in car');
        }
      },
      (xhr) => {
        if (xhr.lengthComputable) loaderTxt.textContent = 'LOADING CAR ' + Math.round(xhr.loaded / xhr.total * 100) + '%';
      },
      (err) => {
        console.warn('car.glb not loaded:', err);
        useFallback(CONFIG.modelUrl + ' not found - using built-in car');
      }
    );
  })();

  /* ------------------------- road ------------------------- */
  const roadMat = new THREE.MeshLambertMaterial({ color: C(0x121214), transparent: true, opacity: 0 });
  const road = new THREE.Mesh(new THREE.PlaneGeometry(9, 260), roadMat);
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, 0, -110);
  scene.add(road);

  const lineMat = new THREE.MeshBasicMaterial({ color: C(0xdddddd), transparent: true, opacity: 0 });
  [-4.2, 4.2].forEach((x) => {
    const l = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 260), lineMat);
    l.rotation.x = -Math.PI / 2;
    l.position.set(x, 0.01, -110);
    scene.add(l);
  });

  const DASH_SPAN = 128, POLE_SPAN = 140;
  const dashes = [];
  for (let i = 0; i < 16; i++) {
    const d = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 2.4), lineMat);
    d.rotation.x = -Math.PI / 2;
    d.position.set(0, 0.012, 10 - i * 8);
    scene.add(d);
    dashes.push(d);
  }

  const poleGroup = new THREE.Group();
  scene.add(poleGroup);
  const poles = [];
  const poleBody = new THREE.BoxGeometry(0.12, 4.5, 0.12);
  const poleTop = new THREE.BoxGeometry(0.55, 0.1, 0.55);
  const poleDark = new THREE.MeshLambertMaterial({ color: C(0x1a1a1d) });
  const poleGlow = new THREE.MeshBasicMaterial({ color: C(0xffc680) });
  [-6.4, 6.4].forEach((x) => {
    for (let i = 0; i < 10; i++) {
      const g = new THREE.Group();
      const b = new THREE.Mesh(poleBody, poleDark);
      b.position.y = 2.25;
      const t = new THREE.Mesh(poleTop, poleGlow);
      t.position.y = 4.5;
      g.add(b, t);
      g.position.set(x, 0, 14 - i * 14);
      poleGroup.add(g);
      poles.push(g);
    }
  });
  poleGroup.scale.y = 0.001;

  /* ------------------------- tire smoke ------------------------- */
  const smokeTex = radialTexture(64, [[0, 'rgba(255,255,255,0.9)'], [0.5, 'rgba(255,255,255,0.35)'], [1, 'rgba(255,255,255,0)']]);
  const puffs = [];
  for (let i = 0; i < 40; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: smokeTex, transparent: true, depthWrite: false, opacity: 0, color: 0xdddddd
    }));
    s.visible = false;
    scene.add(s);
    puffs.push({ s, life: 0, max: 1, vx: 0, vy: 0, vz: 0, on: false });
  }
  const tmp = new THREE.Vector3();
  let smokeAcc = 0, smokeSide = 1;

  function emitPuff(yaw) {
    const p = puffs.find((q) => !q.on);
    if (!p) return;
    smokeSide = -smokeSide;
    tmp.set(smokeX, 0.15, smokeSide * smokeZ);
    carPitch.localToWorld(tmp);
    p.s.position.copy(tmp);
    p.on = true;
    p.life = 0;
    p.max = 0.9 + Math.random() * 0.6;
    const fx = Math.cos(yaw), fz = -Math.sin(yaw);
    p.vx = -fx * 1.2 + (Math.random() - 0.5) * 0.8;
    p.vy = 0.6 + Math.random() * 0.5;
    p.vz = -fz * 1.2 + (Math.random() - 0.5) * 0.8;
    p.s.visible = true;
  }

  function updatePuffs(dt, scroll) {
    for (const p of puffs) {
      if (!p.on) continue;
      p.life += dt;
      const t = p.life / p.max;
      if (t >= 1) { p.on = false; p.s.visible = false; continue; }
      p.s.position.x += p.vx * dt;
      p.s.position.y += p.vy * dt;
      p.s.position.z += p.vz * dt + scroll * dt;
      const sc = 0.8 + t * 3.2;
      p.s.scale.set(sc, sc, 1);
      p.s.material.opacity = (1 - t) * Math.min(t / 0.1, 1) * 0.55;
    }
  }

  /* ------------------------- state ------------------------- */
  const SHOWROOM_YAW = -0.6;
  const DRIVE_YAW = Math.PI / 2;

  let mode = 'idle', modeT = 0;
  let yaw = SHOWROOM_YAW;
  let dragging = false, lastX = 0, lastInteract = 0;
  let revTimer = 0;
  let roadSpeed = 0, roadFade = 0;
  let wheelAngle = 0;
  let destination = null, leaving = false, went = false;
  let rpmNow = 850, thrNow = 0, lastAudioPush = 0;

  const showCamPos = new THREE.Vector3(0, 2.1, 10);
  const showLook = new THREE.Vector3(0, 0.8, 0);
  const chasePos = new THREE.Vector3(0, 2.3, 9);
  const chaseLook = new THREE.Vector3(0, 0.9, -8);
  const camPos = showCamPos.clone();
  const camLook = showLook.clone();

  function setMode(m) { mode = m; modeT = 0; }

  /* ------------------------- sound ------------------------- */
  let audio = null, eng = null, master = null;
  let pRpm, pThr, pBoost;
  let soundOn = false, audioBusy = false;
  let sampleSrc = null;

  async function initAudio() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try {
      audio = new AC({ latencyHint: 'interactive' });
      if (!audio.audioWorklet) throw new Error('AudioWorklet not supported');
      const src = '(' + m5Worklet.toString() + ')();';
      const url = URL.createObjectURL(new Blob([src], { type: 'application/javascript' }));
      await audio.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);

      eng = new AudioWorkletNode(audio, 'm5-engine', { numberOfInputs: 0, outputChannelCount: [1] });
      pRpm = eng.parameters.get('rpm');
      pThr = eng.parameters.get('throttle');
      pBoost = eng.parameters.get('boost');

      master = audio.createGain();
      master.gain.value = 0;
      const comp = audio.createDynamicsCompressor();
      master.connect(comp);
      comp.connect(audio.destination);

      let useSample = false;
      if (CONFIG.engineSample) {
        try {
          const buf = await (await fetch(CONFIG.engineSample)).arrayBuffer();
          const decoded = await audio.decodeAudioData(buf);
          sampleSrc = audio.createBufferSource();
          sampleSrc.buffer = decoded;
          sampleSrc.loop = true;
          sampleSrc.connect(master);
          sampleSrc.start();
          useSample = true;
        } catch (e) { console.warn('engine sample failed, using synth', e); sampleSrc = null; }
      }
      if (!useSample) eng.connect(master); // synth only when no real recording is used
      return true;
    } catch (e) {
      console.warn('Audio init failed', e);
      audio = null;
      return false;
    }
  }

  function pushEngine(now, rpm, thr, boost) {
    if (!audio || !soundOn || now - lastAudioPush < 33) return;
    lastAudioPush = now;
    const t = audio.currentTime;
    pRpm.setTargetAtTime(rpm, t, 0.03);
    pThr.setTargetAtTime(thr, t, 0.03);
    pBoost.setTargetAtTime(boost, t, 0.05);
    if (sampleSrc) {
      sampleSrc.playbackRate.setTargetAtTime(Math.min(2.5, Math.max(0.4, rpm / CONFIG.sampleRpm)), t, 0.05);
    }
  }

  function sendBang() {
    if (eng && soundOn) eng.port.postMessage('bang');
  }

  const soundBtn = $('sound');
  soundBtn.addEventListener('click', async () => {
    if (audioBusy) return;
    if (!audio) {
      audioBusy = true;
      soundBtn.textContent = 'LOADING...';
      const ok = await initAudio();
      audioBusy = false;
      if (!ok) { soundBtn.textContent = 'NO SOUND'; return; }
      soundOn = true;
    } else {
      soundOn = !soundOn;
    }
    soundBtn.textContent = soundOn ? 'SOUND ON' : 'SOUND OFF';
    soundBtn.setAttribute('aria-pressed', String(soundOn));
    if (soundOn) {
      audio.resume();
      master.gain.setTargetAtTime(CONFIG.volume, audio.currentTime, 0.05);
    } else {
      master.gain.setTargetAtTime(0, audio.currentTime, 0.05);
      setTimeout(() => { if (!soundOn && audio) audio.suspend(); }, 250);
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (!audio) return;
    if (document.hidden) audio.suspend();
    else if (soundOn) audio.resume();
  });

  /* ------------------------- UI wiring ------------------------- */
  const swatchWrap = $('swatches');
  CONFIG.colors.forEach((c, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch' + (i === 0 ? ' on' : '');
    b.style.background = '#' + c.hex.toString(16).padStart(6, '0');
    b.setAttribute('aria-label', c.name + ' paint');
    b.addEventListener('click', () => {
      paintTarget.copy(C(c.hex));
      tintTarget.set(c.glow);
      swatchWrap.querySelectorAll('.swatch').forEach((s) => s.classList.remove('on'));
      b.classList.add('on');
    });
    swatchWrap.appendChild(b);
  });

  const menu = $('menu');
  const menuList = $('menu-list');
  function openMenu() { menu.classList.add('open'); menu.setAttribute('aria-hidden', 'false'); }
  function closeMenu() { menu.classList.remove('open'); menu.setAttribute('aria-hidden', 'true'); }

  CONFIG.destinations.forEach((d) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'dest';
    b.innerHTML = '<span></span><span>&#8599;</span>';
    b.firstChild.textContent = d.label;
    b.addEventListener('click', () => startDrive(d));
    menuList.appendChild(b);
  });

  $('where').addEventListener('click', () => { if (mode === 'idle') openMenu(); });
  $('menu-close').addEventListener('click', closeMenu);
  menu.addEventListener('click', (e) => { if (e.target === menu) closeMenu(); });
  const REV_T = 3.4;
  let revBang = false, lastGear = 0;
  $('rev').addEventListener('click', () => {
    if (mode === 'idle' && revTimer <= 0) { revTimer = REV_T; revBang = false; }
  });

  function startDrive(dest) {
    if (mode !== 'idle') return;
    destination = dest;
    revTimer = 0;
    lastGear = 0;
    closeMenu();
    ui.classList.add('away');
    document.body.classList.add('driving');
    yaw = ((yaw % TAU) + TAU) % TAU;
    setMode('turn');
  }

  function go() {
    if (went) return;
    went = true;
    window.location.href = destination.url;
  }

  function resetToShowroom() {
    mode = 'idle';
    modeT = 0;
    yaw = SHOWROOM_YAW;
    roadSpeed = 0;
    roadFade = 0;
    revTimer = 0;
    leaving = false;
    went = false;
    carRoot.position.set(0, 0, 0);
    camPos.copy(showCamPos);
    camLook.copy(showLook);
    camera.fov = 45;
    camera.updateProjectionMatrix();
    document.body.classList.remove('driving');
    ui.classList.remove('away');
    $('curtain').classList.remove('show');
    lastInteract = performance.now();
  }
  window.addEventListener('pageshow', (e) => { if (e.persisted) resetToShowroom(); });

  canvas.addEventListener('pointerdown', (e) => {
    if (mode !== 'idle') return;
    dragging = true;
    lastX = e.clientX;
    lastInteract = performance.now();
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    yaw += (e.clientX - lastX) * 0.01;
    lastX = e.clientX;
    lastInteract = performance.now();
  });
  const endDrag = () => { dragging = false; lastInteract = performance.now(); };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  /* ------------------------- resize ------------------------- */
  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const a = camera.aspect;
    showCamPos.z = a < 0.8 ? 13.5 : a < 1.3 ? 10.5 : 8.6;
  }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 200));
  resize();
  camPos.copy(showCamPos);

  /* ------------------------- adaptive quality ------------------------- */
  let qFrames = 0, qAcc = 0, qWarm = 0;
  function adaptQuality(dt) {
    if (qWarm < 120) { qWarm++; return; }
    qAcc += dt;
    qFrames++;
    if (qFrames >= 90) {
      const avg = qAcc / qFrames;
      if (avg > 0.026 && pixelRatio > 0.6) {
        pixelRatio = Math.max(0.6, pixelRatio - 0.2);
        renderer.setPixelRatio(pixelRatio);
        resize();
      }
      qFrames = 0;
      qAcc = 0;
    }
  }

  /* ------------------------- main update ------------------------- */
  const SHIFTS = [0.9, 1.8, 2.6];            // gear change times while driving away
  const GEAR_LOW = [4200, 4700, 5000, 5200]; // rpm right after each shift

  function update(dt, now) {
    modeT += dt;

    let tPos = showCamPos, tLook = showLook;
    let wheelSpeed = 0, pitchT = 0, shake = 0, smokeRate = 0, tFov = 45;
    let rpmT = 850, thrT = 0;
    const limiter = (now % 110) < 75 ? 1 : 0.15;

    if (mode === 'idle') {
      rpmT = 1000 + Math.sin(now * 0.007) * 30;
      if (!dragging && now - lastInteract > 1800) yaw += 0.35 * dt;
      if (revTimer > 0) {
        revTimer -= dt;
        const e = REV_T - revTimer;
        if (e < 1.5) { smokeRate = 32; wheelSpeed = 38; shake = 0.012; pitchT = 0.03; }
        if (e < 0.45)      { rpmT = 4800; thrT = 1; }               // blip 1
        else if (e < 0.9)  { rpmT = 2000; thrT = 0; }               // lift: crackle
        else if (e < 1.3)  { rpmT = 6800; thrT = 1; }               // blip 2
        else if (e < 1.5)  { rpmT = 6800; thrT = limiter; }         // limiter bounce
        else               { rpmT = 1000; thrT = 0; }               // lift: burble + crackle
        if (e > 1.52 && !revBang) { revBang = true; sendBang(); }  // big bang on lift
      }
    } else if (mode === 'turn') {
      yaw += angleDiff(DRIVE_YAW, yaw) * (1 - Math.exp(-5 * dt));
      roadFade = Math.min(1, roadFade + dt * 0.9);
      tPos = chasePos; tLook = chaseLook;
      wheelSpeed = 4;
      rpmT = 2200; thrT = 0.35;
      if (modeT > 1.2) { yaw = DRIVE_YAW; setMode('launch'); }
    } else if (mode === 'launch') {
      roadFade = 1;
      tPos = chasePos; tLook = chaseLook;
      smokeRate = 45; wheelSpeed = 45; shake = 0.02; pitchT = 0.05;
      rpmT = 5600; thrT = limiter;
      if (modeT > 1.0) setMode('drive');
    } else if (mode === 'drive') {
      const k = Math.min(modeT / 2.4, 1);
      roadSpeed = 85 * k * k;
      tPos = chasePos; tLook = chaseLook;
      wheelSpeed = 20 + 25 * k;
      smokeRate = k < 0.5 ? 40 * (1 - k * 2) : 0;
      pitchT = 0.02;
      shake = 0.02 * k;
      tFov = 45 + 25 * k;

      let g = 0;
      while (g < SHIFTS.length && modeT > SHIFTS[g]) g++;
      const start = g === 0 ? 0 : SHIFTS[g - 1];
      const end = g < SHIFTS.length ? SHIFTS[g] : 3.4;
      const frac = Math.min(1, (modeT - start) / (end - start));
      rpmT = GEAR_LOW[g] + (7000 - GEAR_LOW[g]) * frac;
      thrT = (g > 0 && modeT - start < 0.14) ? 0 : 1; // lift off for the shift -> burble
      if (g !== lastGear) { lastGear = g; if (g > 0) sendBang(); }

      const away = Math.max(0, modeT - 1.6);
      carRoot.position.z = -away * away * 2.5;
      if (modeT > 2.3 && !leaving) {
        leaving = true;
        $('curtain-text').textContent = 'Taking you to ' + destination.label + '...';
        $('curtain').classList.add('show');
      }
      if (modeT > 3.1) go();
    }

    // engine state + sound
    rpmNow += (rpmT - rpmNow) * (1 - Math.exp(-(rpmT > rpmNow ? 8 : 2.5) * dt));
    thrNow += (thrT - thrNow) * (1 - Math.exp(-25 * dt));
    pushEngine(now, rpmNow, thrNow, thrNow * Math.min(1, rpmNow / 6500));

    // paint fade
    const pk = 1 - Math.exp(-8 * dt);
    for (let i = 0; i < paintMats.length; i++) paintMats[i].color.lerp(paintTarget, pk);
    tintSrgb.lerp(tintTarget, 1 - Math.exp(-6 * dt));
    applyTint();

    // car transform
    carRoot.rotation.y = yaw;
    carRoot.position.x = shake ? (Math.random() - 0.5) * shake * 0.6 : 0;
    carPitch.rotation.z += (pitchT - carPitch.rotation.z) * (1 - Math.exp(-8 * dt));
    carPitch.position.y = shake ? (Math.random() - 0.5) * shake : 0;

    wheelAngle -= wheelSpeed * dt;
    for (let i = 0; i < wheels.length; i++) {
      const w = wheels[i];
      w.obj.rotation[w.axis] = w.base + wheelAngle;
    }

    // world fade (showroom floor <-> road)
    floorSpot.material.opacity = 1 - roadFade;
    ringMat1.opacity = 0.6 * (1 - roadFade);
    ringMat2.opacity = 0.25 * (1 - roadFade);
    ring1.rotation.z = ring2.rotation.z = now * 0.0002;
    roadMat.opacity = roadFade;
    lineMat.opacity = roadFade * 0.85;
    poleGroup.scale.y = Math.max(0.001, roadFade);

    if (roadSpeed > 0) {
      const dz = roadSpeed * dt;
      for (let i = 0; i < dashes.length; i++) {
        dashes[i].position.z += dz;
        if (dashes[i].position.z > 14) dashes[i].position.z -= DASH_SPAN;
      }
      for (let i = 0; i < poles.length; i++) {
        poles[i].position.z += dz;
        if (poles[i].position.z > 14) poles[i].position.z -= POLE_SPAN;
      }
    }

    // smoke
    carRoot.updateMatrixWorld(true);
    smokeAcc += smokeRate * dt;
    while (smokeAcc >= 1) { smokeAcc -= 1; emitPuff(yaw); }
    updatePuffs(dt, roadSpeed);

    // camera
    const lk = 1 - Math.exp(-3 * dt);
    camPos.lerp(tPos, lk);
    camLook.lerp(tLook, lk);
    const sk = mode === 'drive' ? 0.03 * Math.min(modeT / 2.4, 1) : 0;
    camera.position.set(
      camPos.x + (sk ? (Math.random() - 0.5) * sk : 0),
      camPos.y + (sk ? (Math.random() - 0.5) * sk : 0),
      camPos.z
    );
    camera.lookAt(camLook);
    const df = (tFov - camera.fov) * (1 - Math.exp(-4 * dt));
    if (Math.abs(df) > 0.01) {
      camera.fov += df;
      camera.updateProjectionMatrix();
    }
  }

  /* ------------------------- loop ------------------------- */
  let last = performance.now();
  lastInteract = last;
  function tick(now) {
    requestAnimationFrame(tick);
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    update(dt, now);
    renderer.render(scene, camera);
    adaptQuality(dt);
  }
  requestAnimationFrame(tick);
})();