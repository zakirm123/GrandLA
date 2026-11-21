// gfx.js - Update 1.2 graphics core: procedural PBR textures, sky + reflections,
// day/night cycle, and optional bloom post-processing. No external image files.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

const MAX_ANISO = 8;
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[(Math.random() * a.length) | 0];

export function canvasTex(w, h, draw, opts = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  if (opts.color !== false) t.colorSpace = THREE.SRGBColorSpace;
  if (opts.repeat !== false) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = MAX_ANISO;
  return t;
}

const speckle = (g, w, h, n, light, dark, size = 2) => {
  for (let i = 0; i < n; i++) {
    g.fillStyle = Math.random() < 0.5 ? light : dark;
    g.fillRect(Math.random() * w, Math.random() * h, Math.random() * size + 1, Math.random() * size + 1);
  }
};

// ---------------------------------------------------- night-reactive materials
export const NightReg = [];
export function nightEmissive(mat, base) { NightReg.push((n) => { mat.emissiveIntensity = base * n; }); return mat; }
export function nightOpacity(mat, base) { NightReg.push((n) => { mat.opacity = base * n; mat.visible = n > 0.02; }); return mat; }

// ------------------------------------------------------------------ ground
export function asphaltMaterial() {
  const map = canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#3b3d41'; g.fillRect(0, 0, w, h);
    speckle(g, w, h, 9000, 'rgba(120,120,125,0.35)', 'rgba(10,10,12,0.4)', 2);
    g.strokeStyle = 'rgba(15,15,18,0.55)'; g.lineWidth = 1;
    for (let i = 0; i < 9; i++) {
      g.beginPath(); let x = Math.random() * w, y = Math.random() * h; g.moveTo(x, y);
      for (let k = 0; k < 6; k++) { x += rand(-30, 30); y += rand(-30, 30); g.lineTo(x, y); }
      g.stroke();
    }
    for (let i = 0; i < 6; i++) { g.fillStyle = 'rgba(10,10,10,0.12)'; g.fillRect(rand(0, w), 0, rand(8, 18), h); } // tyre wear
  });
  return new THREE.MeshStandardMaterial({ map, bumpMap: map, bumpScale: 0.6, roughness: 0.92, metalness: 0 });
}

export function sidewalkMaterial() {
  const map = canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#9b9b96'; g.fillRect(0, 0, w, h);
    speckle(g, w, h, 5000, 'rgba(210,210,205,0.3)', 'rgba(60,60,60,0.3)', 2);
    g.strokeStyle = 'rgba(40,40,40,0.55)'; g.lineWidth = 3;
    for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(i * 128, 0); g.lineTo(i * 128, h); g.moveTo(0, i * 128); g.lineTo(w, i * 128); g.stroke(); }
  });
  return new THREE.MeshStandardMaterial({ map, bumpMap: map, bumpScale: 0.8, roughness: 0.88 });
}

export function sandMaterial(color = 0xe2d2a0) {
  const map = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#e2d2a0'; g.fillRect(0, 0, w, h);
    speckle(g, w, h, 7000, 'rgba(255,245,210,0.5)', 'rgba(150,125,80,0.35)', 2);
  });
  return new THREE.MeshStandardMaterial({ map, color, roughness: 1, bumpMap: map, bumpScale: 0.5 });
}

export function waterMaterial() {
  const S = 256, hgt = new Float32Array(S * S);
  const waves = Array.from({ length: 7 }, () => ({ fx: Math.floor(rand(2, 9)), fy: Math.floor(rand(2, 9)), p: rand(0, 6.28), a: rand(0.4, 1) }));
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let v = 0;
    for (const w of waves) v += w.a * Math.sin((x / S * w.fx + y / S * w.fy) * Math.PI * 2 + w.p);
    hgt[y * S + x] = v;
  }
  const normalMap = canvasTex(S, S, (g) => {
    const img = g.createImageData(S, S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const dx = hgt[y * S + (x + 1) % S] - hgt[y * S + (x + S - 1) % S];
      const dy = hgt[((y + 1) % S) * S + x] - hgt[((y + S - 1) % S) * S + x];
      const nx = -dx * 0.9, ny = -dy * 0.9, nz = 1, l = Math.hypot(nx, ny, nz), i = (y * S + x) * 4;
      img.data[i] = (nx / l * 0.5 + 0.5) * 255; img.data[i + 1] = (ny / l * 0.5 + 0.5) * 255; img.data[i + 2] = (nz / l * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }, { color: false });
  normalMap.repeat.set(220, 220);
  const mat = new THREE.MeshStandardMaterial({ color: 0x1b5875, roughness: 0.1, metalness: 0.15, normalMap, normalScale: new THREE.Vector2(0.55, 0.55) });
  mat.userData.normalMap = normalMap;
  return mat;
}

// ---------------------------------------------------------------- facades
// Every facade module covers 16 m x 16 m (4 floors). Returns {map, orm, emissive}.
// orm: G = roughness, B = metalness (three reads those channels).
function facade(draw) {
  const S = 512, c = {}, make = (fn, color) => canvasTex(S, S, fn, { color });
  const layers = { map: null, orm: null, emi: null };
  const paint = (layer) => (g) => draw(g, layer);
  layers.map = make(paint('map'), true); layers.orm = make(paint('orm'), false); layers.emi = make(paint('emi'), true);
  return { map: layers.map, orm: layers.orm, emissive: layers.emi };
}
const col = (layer, a, rough, metal, em = '#000') => (layer === 'map' ? a : layer === 'orm' ? `rgb(0,${rough},${metal})` : em);

const FACADES = {
  glass: () => facade((g, L) => {
    g.fillStyle = col(L, '#2b3036', 110, 190); g.fillRect(0, 0, 512, 512);
    const tints = ['#5a7a99', '#4d6e8c', '#6b8ba6', '#42606f', '#566f8a'];
    for (let r = 0; r < 4; r++) for (let c = 0; c < 8; c++) {
      const x = c * 64 + 3, y = r * 128 + 4, w = 58, h = 120, lit = Math.random() < 0.3;
      if (L === 'map') { const gr = g.createLinearGradient(x, y, x + w, y + h); const t = pick(tints); gr.addColorStop(0, '#b9cfe0'); gr.addColorStop(0.3, t); gr.addColorStop(1, '#22313f'); g.fillStyle = gr; }
      else g.fillStyle = col(L, '', 18, 235, lit ? '#ffd9a0' : '#000');
      g.fillRect(x, y, w, h);
    }
  }),
  office: () => facade((g, L) => {
    g.fillStyle = col(L, '#bdbdb6', 225, 0); g.fillRect(0, 0, 512, 512);
    for (let r = 0; r < 4; r++) for (let c = 0; c < 8; c++) {
      const x = c * 64 + 5, y = r * 128 + 30, lit = Math.random() < 0.3;
      g.fillStyle = L === 'map' ? '#33445a' : col(L, '', 25, 210, lit ? '#ffe0a8' : '#000'); g.fillRect(x, y, 54, 86);
      if (L === 'map') { g.fillStyle = '#7d93a8'; g.fillRect(x, y, 54, 18); }
    }
  }),
  brick: () => facade((g, L) => {
    g.fillStyle = col(L, '#8b4b3b', 235, 0); g.fillRect(0, 0, 512, 512);
    if (L === 'map') for (let y = 0; y < 512; y += 7) for (let x = (y / 7 % 2) * 8; x < 512; x += 16) { g.fillStyle = `hsl(${rand(6, 16)},${rand(38, 52)}%,${rand(30, 40)}%)`; g.fillRect(x + 1, y + 1, 14, 5); }
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
      const x = c * 128 + 36, y = r * 128 + 22, lit = Math.random() < 0.35;
      g.fillStyle = L === 'map' ? '#d9d3c5' : col(L, '', 190, 0); g.fillRect(x - 5, y - 5, 66, 90);
      g.fillStyle = L === 'map' ? '#26303b' : col(L, '', 30, 170, lit ? '#ffcf8a' : '#000'); g.fillRect(x, y, 56, 78);
      if (L === 'map') { g.fillStyle = '#d9d3c5'; g.fillRect(x + 26, y, 4, 78); g.fillRect(x - 8, y + 80, 72, 6); }
    }
  }),
  stone: () => facade((g, L) => {
    g.fillStyle = col(L, '#cbc2b0', 215, 0); g.fillRect(0, 0, 512, 512);
    for (let c = 0; c < 8; c++) { g.fillStyle = col(L, '#ddd5c4', 205, 0); g.fillRect(c * 64 + 26, 0, 12, 512); }
    for (let r = 0; r < 4; r++) for (let c = 0; c < 8; c++) {
      const x = c * 64 + 7, y = r * 128 + 18, lit = Math.random() < 0.3;
      g.fillStyle = L === 'map' ? '#2d3b4a' : col(L, '', 30, 190, lit ? '#ffd79a' : '#000'); g.fillRect(x, y, 18, 90);
      g.fillRect(x + 38 - 6 + 6, y, 12, 90);
      if (L === 'map') { g.fillStyle = '#a89f8c'; g.fillRect(0, r * 128 + 112, 512, 8); }
    }
  }),
  concrete: () => facade((g, L) => {
    g.fillStyle = col(L, '#a9a9a5', 230, 0); g.fillRect(0, 0, 512, 512);
    if (L === 'map') { g.strokeStyle = 'rgba(40,40,40,0.35)'; g.lineWidth = 2; for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(0, i * 128); g.lineTo(512, i * 128); g.moveTo(i * 128, 0); g.lineTo(i * 128, 512); g.stroke(); } }
    for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) {
      const x = c * 170 + 14, y = r * 128 + 26, lit = Math.random() < 0.3;
      g.fillStyle = L === 'map' ? '#34485c' : col(L, '', 28, 200, lit ? '#ffe3b0' : '#000'); g.fillRect(x, y, 140, 76);
      g.fillStyle = col(L, '#6f6f6c', 120, 120); g.fillRect(x - 4, y + 78, 148, 8);
    }
  }),
};

// Storefront module: 8 m wide x 5 m tall.
function shopFacade() {
  const W = 512, H = 320;
  const draw = (g, L) => {
    g.fillStyle = col(L, '#58585c', 220, 0); g.fillRect(0, 0, W, H);
    const sign = pick(['#c0392b', '#1f6fb5', '#f2b705', '#2e8b57', '#6b3fa0', '#e67e22']);
    g.fillStyle = col(L, sign, 160, 20, sign); g.fillRect(8, 8, W - 16, 56);
    if (L === 'map') { g.fillStyle = 'rgba(255,255,255,0.85)'; for (let i = 0; i < 5; i++) g.fillRect(40 + i * 40, 26, 26 + Math.random() * 6, 18); }
    if (L === 'emi') { g.fillStyle = sign; g.fillRect(8, 8, W - 16, 56); }
    for (let i = 0; i < 2; i++) {
      const x = 14 + i * 250, lit = true;
      g.fillStyle = L === 'map' ? '#5b7b8f' : col(L, '', 12, 230, lit ? '#ffe2b5' : '#000'); g.fillRect(x, 84, 150, 210);
      if (L === 'map') { g.fillStyle = '#2a2a2e'; g.fillRect(x + 74, 84, 3, 210); }
    }
    g.fillStyle = L === 'map' ? '#3a2f28' : col(L, '', 150, 40); g.fillRect(172, 84, 66, 236);
    g.fillStyle = L === 'map' ? '#9fc2d8' : col(L, '', 15, 220, L === 'emi' ? '#ffe2b5' : '#000'); g.fillRect(178, 92, 54, 150);
  };
  return facade2(draw, W, H);
}
function facade2(draw, W, H) {
  const m = (L, color) => canvasTex(W, H, (g) => draw(g, L), { color });
  return { map: m('map', true), orm: m('orm', false), emissive: m('emi', true) };
}

const matCache = new Map();
export const FacadeMats = [];
export function facadeMaterial(style, tint = 0xffffff) {
  const key = style + tint;
  if (matCache.has(key)) return matCache.get(key);
  if (!matCache.has('tex' + style)) matCache.set('tex' + style, style.startsWith('shop') ? shopFacade() : FACADES[style]());
  const t = matCache.get('tex' + style);
  const mat = new THREE.MeshStandardMaterial({ map: t.map, color: tint, roughnessMap: t.orm, metalnessMap: t.orm, roughness: 1, metalness: 1,
    bumpMap: t.map, bumpScale: 0.6, emissiveMap: t.emissive, emissive: 0xffffff, emissiveIntensity: 0 });
  nightEmissive(mat, style.startsWith('shop') ? 1.4 : 1.1);
  matCache.set(key, mat); return mat;
}

// ------------------------------------------------------------- glow decals
export function glowTexture(inner = 'rgba(255,235,170,0.9)') {
  return canvasTex(128, 128, (g) => {
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, inner); gr.addColorStop(0.4, 'rgba(255,220,140,0.25)'); gr.addColorStop(1, 'rgba(255,200,100,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  }, { repeat: false });
}
export function beamTexture() {
  return canvasTex(64, 256, (g) => {
    const gr = g.createLinearGradient(0, 256, 0, 0);
    gr.addColorStop(0, 'rgba(255,245,210,0.55)'); gr.addColorStop(1, 'rgba(255,245,210,0)');
    g.fillStyle = gr; g.beginPath(); g.moveTo(22, 256); g.lineTo(42, 256); g.lineTo(64, 0); g.lineTo(0, 0); g.closePath(); g.fill();
  }, { repeat: false });
}

// ---------------------------------------------------------------- sky / light
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function createEnvironment(scene, renderer, startHour = 16.5) {
  scene.fog = new THREE.Fog(0xb4bec8, 250, 1100);
  const mk = () => {
    const s = new Sky(); s.scale.setScalar(1500);
    const u = s.material.uniforms; u.turbidity.value = 10; u.rayleigh.value = 1.6; u.mieCoefficient.value = 0.018; u.mieDirectionalG.value = 0.8;
    return s;
  };
  const sky = mk(), envSky = mk(), envScene = new THREE.Scene(); envScene.add(envSky); scene.add(sky);
  const pmrem = new THREE.PMREMGenerator(renderer);

  const hemi = new THREE.HemisphereLight(0xdfe8f2, 0x59606a, 0.5); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff0dc, 3); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.05;
  const sc = sun.shadow.camera; sc.left = sc.bottom = -100; sc.right = sc.top = 100; sc.near = 10; sc.far = 500;
  const moon = new THREE.DirectionalLight(0x8fa8ff, 0.0);
  scene.add(sun, sun.target, moon, moon.target);

  // stars
  const sp = new Float32Array(900 * 3);
  for (let i = 0; i < 900; i++) {
    const a = Math.random() * 6.283, e = Math.acos(Math.random()) , r = 1300;
    sp[i * 3] = Math.cos(a) * Math.sin(e) * r; sp[i * 3 + 1] = Math.cos(e) * r; sp[i * 3 + 2] = Math.sin(a) * Math.sin(e) * r;
  }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false });
  const stars = new THREE.Points(sg, starMat); scene.add(stars);

  const state = { hour: startHour, night: 0, envHour: -99, speed: 1 / 60, sunDir: new THREE.Vector3(), clouds: [] };
  const sunV = new THREE.Vector3();
  const dayFog = new THREE.Color(0xb4bec8), nightFog = new THREE.Color(0x070b14), duskFog = new THREE.Color(0xa78e86);

  function applyHour(force) {
    const h = state.hour, ang = (h - 6) / 24 * Math.PI * 2;
    const elev = Math.sin(ang) * 1.1, az = (h - 6) / 12 * Math.PI;    // radians
    const el = Math.asin(Math.max(-1, Math.min(1, elev * 0.9)));
    sunV.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
    state.sunDir.copy(sunV);
    for (const s of [sky, envSky]) s.material.uniforms.sunPosition.value.copy(sunV);
    const up = Math.sin(el);
    state.night = 1 - smooth(-0.12, 0.08, up);
    const dayAmt = smooth(0.0, 0.35, up), dusk = Math.max(0, 1 - Math.abs(up) / 0.25) * (1 - state.night * 0.6);
    sun.intensity = 3.0 * dayAmt * 0.85; sun.color.setHSL(0.1, 0.5 + 0.4 * dusk, 0.82 - 0.25 * dusk);
    moon.intensity = 0.35 * state.night; moon.position.set(-sunV.x * 100, Math.max(40, -sunV.y * 100), -sunV.z * 100);
    hemi.intensity = 0.08 + 0.5 * dayAmt;
    scene.environmentIntensity = 0.1 + 0.8 * dayAmt;
    renderer.toneMappingExposure = 0.95 + 0.25 * state.night;
    scene.fog.color.copy(dayFog).lerp(duskFog, dusk * 0.7).lerp(nightFog, state.night);
    starMat.opacity = Math.max(0, state.night - 0.2) * 1.1;
    for (const c of state.clouds) c.material.color.setScalar(0.35 + 0.65 * (0.15 + dayAmt)).lerp(scene.fog.color, 0.25);
    for (const f of NightReg) f(state.night);
    if (force || Math.abs(h - state.envHour) > 2) {
      state.envHour = h;
      const old = scene.environment; scene.environment = pmrem.fromScene(envScene, 0, 0.1, 2000).texture; if (old) old.dispose();
    }
  }
  applyHour(true);

  return {
    state, sun, moon, sky, stars, hemi,
    setClouds(list) { state.clouds = list; },
    update(dt, focus) {
      state.hour = (state.hour + dt * state.speed) % 24; applyHour(false);
      sky.position.copy(focus); stars.position.copy(focus);
      sun.target.position.set(focus.x, 0, focus.z);
      sun.position.set(focus.x + state.sunDir.x * 150, Math.max(30, state.sunDir.y * 150), focus.z + state.sunDir.z * 150);
      moon.target.position.copy(sun.target.position);
    },
    clock() { const h = Math.floor(state.hour), m = Math.floor((state.hour - h) * 60); return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0'); },
  };
}

// -------------------------------------------------------------- post-processing
export async function createPost(renderer, scene, camera) {
  try {
    const [{ EffectComposer }, { RenderPass }, { UnrealBloomPass }, { OutputPass }] = await Promise.all([
      import('three/addons/postprocessing/EffectComposer.js'), import('three/addons/postprocessing/RenderPass.js'),
      import('three/addons/postprocessing/UnrealBloomPass.js'), import('three/addons/postprocessing/OutputPass.js'),
    ]);
    const size = renderer.getSize(new THREE.Vector2()), pr = renderer.getPixelRatio();
    const rt = new THREE.WebGLRenderTarget(size.x * pr, size.y * pr, { type: THREE.HalfFloatType, samples: 4 });
    const composer = new EffectComposer(renderer, rt);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.35, 0.55, 1.0);
    composer.addPass(bloom); composer.addPass(new OutputPass());
    return { composer, bloom, setSize: (w, h) => { composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(w, h); } };
  } catch (e) { console.warn('Post-processing unavailable:', e); return null; }
}

// ------------------------------------------------------------------ helpers
export function rng(seed) {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
// Scale a BoxGeometry's UVs so textures tile in metres (tu x tv metres per tile).
export function boxUV(geo, w, h, d, tu, tv = tu) {
  const uv = geo.attributes.uv, f = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let k = 0; k < 6; k++) for (let v = k * 4; v < k * 4 + 4; v++) uv.setXY(v, uv.getX(v) * f[k][0] / tu, uv.getY(v) * f[k][1] / tv);
  return geo;
}

// ====================================================== Update 1.3 additions
// ---- wind: sways grass, trees and palms in the vertex shader (one shared time uniform)
export const WIND = { time: { value: 0 } };
export function applyWind(mat, { amp = 0.3, height = 1, freq = 1.6 } = {}) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = WIND.time;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 wp_ = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          wp_ = instanceMatrix * wp_;
        #endif
        float hh_ = clamp(transformed.y / ${height.toFixed(2)}, 0.0, 1.5);
        float w_ = sin(uTime * ${freq.toFixed(2)} + wp_.x * 0.31 + wp_.z * 0.23) + 0.5 * sin(uTime * ${(freq * 2.7).toFixed(2)} + wp_.x * 0.9 - wp_.z * 0.7);
        transformed.x += w_ * ${amp.toFixed(3)} * hh_ * hh_;
        transformed.z += w_ * ${(amp * 0.6).toFixed(3)} * hh_ * hh_;`);
  };
  mat.customProgramCacheKey = () => 'wind' + amp + height + freq;
  return mat;
}

// ---- painted face (maps onto an ellipsoid head; the front of the face sits at u = 0.25)
const faceCache = new Map();
const hex = (n) => '#' + n.toString(16).padStart(6, '0');
export function faceTexture(skin, female, hair, eye = 0x4a3220, lip = 0xb0605a) {
  const key = [skin, female, hair, eye, lip].join('_');
  if (faceCache.has(key)) return faceCache.get(key);
  const tex = canvasTex(512, 256, (g, w, h) => {
    g.fillStyle = hex(skin); g.fillRect(0, 0, w, h);
    const sh = g.createLinearGradient(0, 0, 0, h); sh.addColorStop(0, 'rgba(255,230,210,0.10)'); sh.addColorStop(1, 'rgba(90,40,30,0.12)'); g.fillStyle = sh; g.fillRect(0, 0, w, h);
    const blob = (x, y, rx, ry, col) => { g.save(); g.translate(x, y); g.scale(rx, ry); const r = g.createRadialGradient(0, 0, 0, 0, 0, 1); r.addColorStop(0, col); r.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = r; g.beginPath(); g.arc(0, 0, 1, 0, 6.3); g.fill(); g.restore(); };
    for (const s of [-1, 1]) {
      blob(128 + s * 36, 144, 24, 16, female ? 'rgba(230,110,110,0.20)' : 'rgba(200,100,90,0.12)');       // cheeks
      blob(128 + s * 23, 119, 20, 12, 'rgba(70,40,40,0.20)');                                               // eye sockets
    }
    blob(128, 146, 9, 12, 'rgba(110,60,45,0.22)'); blob(128, 160, 22, 9, 'rgba(120,60,50,0.10)');
    for (const s of [-1, 1]) {
      const ex = 128 + s * 23, ey = 120;
      g.fillStyle = '#f3eeea'; g.beginPath(); g.ellipse(ex, ey, 11, 5.5, 0, 0, 6.3); g.fill();
      g.fillStyle = hex(eye); g.beginPath(); g.arc(ex, ey, 5, 0, 6.3); g.fill();
      g.fillStyle = '#080808'; g.beginPath(); g.arc(ex, ey, 2.4, 0, 6.3); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.9)'; g.beginPath(); g.arc(ex - 1.6, ey - 1.8, 1.2, 0, 6.3); g.fill();
      g.strokeStyle = '#24150f'; g.lineWidth = female ? 3 : 2; g.beginPath(); g.ellipse(ex, ey + 0.5, 11.5, 6.2, 0, Math.PI * 1.05, Math.PI * 1.95); g.stroke();
      g.strokeStyle = 'rgba(120,70,60,0.5)'; g.lineWidth = 1.2; g.beginPath(); g.ellipse(ex, ey + 0.5, 11, 5.8, 0, 0.15, Math.PI - 0.15); g.stroke();
      g.strokeStyle = hex(hair); g.lineWidth = female ? 3.2 : 4.6; g.lineCap = 'round';
      g.beginPath(); g.moveTo(ex - s * 12, 108 + (s > 0 ? 1 : 1)); g.quadraticCurveTo(ex, 102 - (female ? 2 : 0), ex + s * 12, 107); g.stroke();
    }
    g.fillStyle = 'rgba(60,30,25,0.55)'; g.beginPath(); g.arc(122, 153, 2, 0, 6.3); g.arc(134, 153, 2, 0, 6.3); g.fill();
    g.strokeStyle = 'rgba(255,235,220,0.18)'; g.lineWidth = 3; g.beginPath(); g.moveTo(128, 124); g.lineTo(128, 146); g.stroke();
    g.fillStyle = hex(lip); g.beginPath(); g.ellipse(128, 169, 13, female ? 3.6 : 2.8, 0, Math.PI, 0); g.fill();
    g.beginPath(); g.ellipse(128, 173, 12, female ? 5 : 3.8, 0, 0, Math.PI); g.fill();
    g.strokeStyle = 'rgba(70,25,25,0.7)'; g.lineWidth = 1.4; g.beginPath(); g.moveTo(116, 171); g.quadraticCurveTo(128, 173.5, 140, 171); g.stroke();
  }, { repeat: false });
  faceCache.set(key, tex); return tex;
}

// ---- hair: strand texture with alpha (cards) or solid (cap)
const hairCache = new Map();
export function hairTexture(color, opaque) {
  const key = color + '_' + opaque;
  if (hairCache.has(key)) return hairCache.get(key);
  const base = new THREE.Color(color);
  const tex = canvasTex(128, 256, (g, w, h) => {
    if (opaque) { g.fillStyle = hex(color); g.fillRect(0, 0, w, h); } else g.clearRect(0, 0, w, h);
    for (let i = 0; i < 160; i++) {
      const x = Math.random() * w, l = 0.55 + base.getHSL({}).l * 0.8, a = 0.35 + Math.random() * 0.5;
      g.strokeStyle = `hsla(${Math.round(base.getHSL({}).h * 360)},${Math.round(base.getHSL({}).s * 100)}%,${Math.round(Math.min(90, 10 + Math.random() * 40 * l + base.getHSL({}).l * 60))}%,${a})`;
      g.lineWidth = 1 + Math.random() * 2; g.beginPath(); g.moveTo(x, 0); g.bezierCurveTo(x + rand(-8, 8), h * 0.35, x + rand(-10, 10), h * 0.7, x + rand(-6, 6), h * (opaque ? 1 : 0.85 + Math.random() * 0.15)); g.stroke();
    }
  });
  hairCache.set(key, tex); return tex;
}
