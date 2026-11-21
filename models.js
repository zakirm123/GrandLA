// models.js - Update 1.2: realistic vehicles and humans, built procedurally.
// Static parts are merged per material, so a car is ~10 draw calls and a person ~11.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { NightReg, nightOpacity, beamTexture, canvasTex, faceTexture, hairTexture } from './gfx.js';
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const pick = (a) => a[(Math.random() * a.length) | 0];
const rnd = (a, b) => a + Math.random() * (b - a);
const NI = (g) => (g.index ? g.toNonIndexed() : g);
const merge = (list) => mergeGeometries(list.map(NI));

// ================================================================= vehicles
const mats = {};
const M = (k, f) => (mats[k] ??= f());
const paintMat = (c) => M('p' + c, () => new THREE.MeshPhysicalMaterial({ color: c, metalness: 0.55, roughness: 0.34, clearcoat: 1, clearcoatRoughness: 0.08 }));
const glassMat = () => M('glass', () => new THREE.MeshPhysicalMaterial({ color: 0x0d141b, metalness: 0.9, roughness: 0.05, transparent: true, opacity: 0.82 }));
const detailMat = () => M('detail', () => new THREE.MeshStandardMaterial({ color: 0x1b1c1f, roughness: 0.65, metalness: 0.1 }));
const tireMat = () => M('tire', () => new THREE.MeshStandardMaterial({ color: 0x121212, roughness: 0.95 }));
const rimMat = () => M('rim', () => new THREE.MeshStandardMaterial({ color: 0xcfd3d9, roughness: 0.22, metalness: 1 }));
const headMat = () => M('head', () => { const m = new THREE.MeshStandardMaterial({ color: 0xf4f1e6, emissive: 0xfff3c4, emissiveIntensity: 0.5, roughness: 0.2 }); NightReg.push((n) => { m.emissiveIntensity = 0.5 + 3.2 * n; }); return m; });
const tailMat = () => M('tail', () => { const m = new THREE.MeshStandardMaterial({ color: 0x6a0808, emissive: 0xff1010, emissiveIntensity: 0.5, roughness: 0.3 }); NightReg.push((n) => { m.emissiveIntensity = 0.5 + 1.6 * n; }); return m; });
const beamMat = () => M('beam', () => nightOpacity(new THREE.MeshBasicMaterial({ map: beamTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0, side: THREE.DoubleSide, fog: false }), 0.9));
const PAINTS = [0xb3202b, 0x1f5fa8, 0x2f2f33, 0xdedede, 0x6c7078, 0x1b6b45, 0x8a1f1f, 0xd9d4c5, 0x24304d, 0xc77b24, 0x0f0f12, 0x7e4f9a];

const bx = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);

function extrudeProfile(profile, width, bevel = 0.07) {
  const s = new THREE.Shape(); profile.forEach(([z, y], i) => (i ? s.lineTo(z, y) : s.moveTo(z, y))); s.closePath();
  const d = Math.max(0.05, width - 2 * bevel);
  const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, steps: 1, curveSegments: 1 });
  g.translate(0, 0, -d / 2); g.rotateY(-Math.PI / 2);
  return g;
}

function decalTex(text, bg, fg, w = 256, h = 64) {
  return canvasTex(w, h, (g) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h); g.fillStyle = fg; g.font = `bold ${h * 0.62}px Arial, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, w / 2, h / 2 + 2);
  }, { repeat: false });
}

const DEFS = {
  sedan: { lower: [[-2.2, .32], [-2.2, .8], [-1.75, .95], [-.6, .98], [.9, .98], [1.9, .9], [2.2, .78], [2.2, .32]], house: [[-1.3, .95], [-.9, 1.45], [.55, 1.45], [1.2, .95]], w: 1.85, zF: 2.2, zR: -2.2, wz: [1.38, -1.38], wr: .34, roof: 1.5 },
  hatch: { lower: [[-1.85, .34], [-1.85, .85], [-1.5, .98], [.8, .98], [1.65, .9], [1.9, .76], [1.9, .34]], house: [[-1.6, .95], [-1.45, 1.52], [.5, 1.52], [1.1, .95]], w: 1.75, zF: 1.9, zR: -1.85, wz: [1.15, -1.15], wr: .32, roof: 1.57 },
  suv: { lower: [[-2.3, .42], [-2.3, 1.12], [-2.15, 1.25], [1.2, 1.25], [2.2, 1.08], [2.32, .9], [2.32, .42]], house: [[-2.2, 1.22], [-2.1, 1.9], [.8, 1.9], [1.35, 1.22]], w: 1.95, zF: 2.32, zR: -2.3, wz: [1.45, -1.45], wr: .4, roof: 1.95 },
  van: { lower: [[-2.6, .42], [-2.6, 1.3], [1.9, 1.3], [2.5, 1.02], [2.55, .42]], house: [[-2.55, 1.28], [-2.5, 2.15], [1.25, 2.15], [1.85, 1.3]], w: 2.0, zF: 2.55, zR: -2.6, wz: [1.7, -1.7], wr: .38, roof: 2.2, houseIsPaint: true },
};
DEFS.taxi = DEFS.sedan; DEFS.police = DEFS.sedan;

const carCache = {};
function carParts(type) {
  if (carCache[type]) return carCache[type];
  const D = DEFS[type], w = D.w, hw = w / 2, P = [], G = [], T = [], H = [], L = [], W = [], DEC = [];
  P.push(extrudeProfile(D.lower, w));
  const house = extrudeProfile(D.house, w - 0.2, 0.05);
  (D.houseIsPaint ? P : G).push(house);
  if (!D.houseIsPaint) {
    P.push(bx(w - 0.22, 0.05, Math.abs(D.house[2][0] - D.house[1][0]) + 0.1, 0, D.roof + 0.01, (D.house[1][0] + D.house[2][0]) / 2));
    for (const s of [-1, 1]) { P.push(bx(0.06, D.roof - 1.0, 0.11, s * (hw - 0.1), (D.roof + 1.0) / 2, (D.house[1][0] + D.house[2][0]) / 2 - 0.15)); }
  } else {
    G.push(new THREE.BoxGeometry(w - 0.3, 0.75, 0.05).rotateX(-0.85).translate(0, 1.78, 1.62));
    for (const s of [-1, 1]) G.push(bx(0.03, 0.5, 0.9, s * (hw + 0.005), 1.75, 1.1));
  }
  // bumpers, grille, trims
  const hoodY = D.lower[D.lower.length - 3][1];
  T.push(bx(w - 0.06, 0.24, 0.14, 0, 0.42, D.zF - 0.04), bx(w - 0.06, 0.24, 0.14, 0, 0.42, D.zR + 0.04));
  T.push(bx(w * 0.52, 0.17, 0.05, 0, hoodY - 0.2, D.zF + 0.005));
  for (const s of [-1, 1]) {
    T.push(bx(0.02, hoodY - 0.5, 0.012, s * (hw + 0.002), 0.78, 0.55), bx(0.02, hoodY - 0.5, 0.012, s * (hw + 0.002), 0.78, -0.55));
    T.push(bx(0.09, 0.07, 0.14, s * (hw + 0.06), hoodY + 0.12, D.house[3][0] - 0.1));
  }
  T.push(bx(0.5, 0.11, 0.02, 0, 0.42, D.zF + 0.035));   // front plate
  T.push(bx(0.5, 0.11, 0.02, 0, 0.62, D.zR - 0.01));
  // interior
  const sz = (D.house[1][0] + D.house[2][0]) / 2;
  for (const s of [-1, 1]) { T.push(bx(0.45, 0.5, 0.1, s * 0.42, 1.15, sz - 0.1), bx(0.45, 0.12, 0.5, s * 0.42, 0.78, sz + 0.2)); }
  T.push(bx(w - 0.3, 0.14, 0.4, 0, hoodY - 0.02, D.house[3][0] - 0.2), new THREE.TorusGeometry(0.15, 0.02, 6, 14).rotateX(-1.1).translate(0.42, hoodY + 0.12, D.house[3][0] - 0.4));
  if (type !== 'van') T.push(bx(w - 0.3, 0.55, 0.35, 0, 1.1, D.house[0][0] + 0.25));
  // lights
  for (const s of [-1, 1]) {
    H.push(bx(0.4, 0.14, 0.06, s * (hw - 0.28), hoodY - 0.14, D.zF + 0.005));
    L.push(bx(0.5, 0.13, 0.05, s * (hw - 0.3), D.lower[1][1] - 0.1, D.zR - 0.005));
  }
  if (type === 'taxi') { H.push(bx(0.6, 0.16, 0.22, 0, D.roof + 0.14, sz)); T.push(bx(0.62, 0.04, 0.24, 0, D.roof + 0.04, sz)); }
  if (type === 'police') {
    T.push(bx(w * 0.6, 0.3, 0.05, 0, 0.5, D.zF + 0.1), bx(0.04, 0.34, 0.04, -0.4, 0.5, D.zF + 0.12), bx(0.04, 0.34, 0.04, 0.4, 0.5, D.zF + 0.12));
    for (const s of [-1, 1]) W.push(bx(0.02, 0.5, 1.8, s * (hw + 0.003), 0.7, 0.05));
    for (const s of [-1, 1]) DEC.push(new THREE.PlaneGeometry(1.5, 0.36).rotateY(s * Math.PI / 2).translate(s * (hw + 0.018), 0.72, 0.05));
  }
  if (type === 'taxi') for (const s of [-1, 1]) W.push(bx(0.02, 0.12, 2.4, s * (hw + 0.003), 0.68, 0.0));
  const parts = { paint: merge(P), glass: merge(G), detail: merge(T), head: merge(H), tail: merge(L), white: W.length ? merge(W) : null, decal: DEC.length ? merge(DEC) : null };
  carCache[type] = parts; return parts;
}

let wheelGeo = {};
function wheelGeometry(r, wdt) {
  const key = r + '_' + wdt;
  if (wheelGeo[key]) return wheelGeo[key];
  const tire = new THREE.CylinderGeometry(r, r, wdt, 22).rotateZ(Math.PI / 2);
  const rim = [new THREE.CylinderGeometry(r * 0.64, r * 0.64, wdt + 0.012, 16).rotateZ(Math.PI / 2)];
  const spokes = [];
  for (let k = 0; k < 5; k++) spokes.push(new THREE.BoxGeometry(wdt + 0.03, r * 1.15, r * 0.14).rotateX(k * Math.PI * 2 / 5));
  const geo = mergeGeometries([NI(tire), NI(merge(rim)), NI(merge(spokes))], true);
  wheelGeo[key] = geo; return geo;
}

function addWheels(g, positions, r, wdt) {
  const geo = wheelGeometry(r, wdt), mt = [tireMat(), rimMat(), M('spoke', () => new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.4, metalness: 0.8 }))];
  const list = [];
  for (const [x, z] of positions) {
    const wg = new THREE.Group(); wg.position.set(x, r, z);
    const m = new THREE.Mesh(geo, mt); m.castShadow = true; wg.add(m); g.add(wg); list.push({ g: wg, r, spin: 0 });
  }
  g.userData.wheels = list;
}

function addBeam(g, zFront, width = 3.4, len = 11) {
  const b = new THREE.Mesh(new THREE.PlaneGeometry(width, len).rotateX(Math.PI / 2), beamMat());
  b.position.set(0, 0.07, zFront + len / 2 - 0.4); b.renderOrder = 2; g.add(b);
}

function buildTruck(g) {
  const col = pick([0xb3202b, 0x1f5fa8, 0xd9a21b, 0x2d7a4f]);
  const cabLower = extrudeProfile([[1.25, 0.95], [1.25, 2.6], [2.3, 2.7], [3.2, 2.1], [3.25, 0.95]], 2.4, 0.08);
  const P = [cabLower, bx(2.5, 0.12, 0.3, 0, 1.0, 3.22)];
  const T = [bx(1.9, 0.16, 5.0, 0, 0.78, -0.6), bx(2.3, 0.22, 0.18, 0, 0.72, 3.3), bx(0.9, 0.35, 0.05, 0, 1.35, 3.27), bx(2.45, 0.2, 0.15, 0, 0.75, -3.7)];
  const G = [new THREE.BoxGeometry(2.15, 0.95, 0.05).rotateX(-0.45).translate(0, 2.05, 2.75)];
  for (const s of [-1, 1]) G.push(bx(0.03, 0.8, 0.85, s * 1.215, 2.05, 2.15));
  for (let i = 0; i < 6; i++) for (const s of [-1, 1]) T.push(bx(0.04, 2.5, 0.08, s * 1.3, 2.25, -3.45 + i * 0.9));
  const H = [bx(0.35, 0.18, 0.06, -0.9, 1.4, 3.28), bx(0.35, 0.18, 0.06, 0.9, 1.4, 3.28)], L = [bx(0.3, 0.16, 0.05, -1.0, 1.0, -3.72), bx(0.3, 0.16, 0.05, 1.0, 1.0, -3.72)];
  const cargo = new THREE.Mesh(NI(new THREE.BoxGeometry(2.55, 2.55, 5.0).translate(0, 2.3, -1.15)), paintMat(0xe9e9e6));
  const add = (geo, mat, shadow) => { const m = new THREE.Mesh(geo, mat); m.castShadow = !!shadow; g.add(m); return m; };
  add(merge(P), paintMat(col), true); add(cargo.geometry, cargo.material, true); add(merge(T), detailMat(), false);
  add(merge(G), glassMat()); add(merge(H), headMat()); add(merge(L), tailMat());
  const dg = []; for (const s of [-1, 1]) dg.push(new THREE.PlaneGeometry(4.2, 0.8).rotateY(s * Math.PI / 2).translate(s * 1.282, 2.5, -1.15));
  add(merge(dg), M('freightDecal', () => new THREE.MeshStandardMaterial({ map: decalTex('BLACKTOP FREIGHT', '#e9e9e6', '#b3202b', 512, 96), roughness: 0.6 })));
  addWheels(g, [[-1.1, 2.3], [1.1, 2.3], [-1.1, -1.9], [1.1, -1.9], [-1.1, -3.0], [1.1, -3.0]], 0.5, 0.34);
  g.userData.roofY = 2.7 + 0.05; g.userData.barWidth = 1.2;
  addBeam(g, 3.3, 3.6, 12);
}

export function makeVehicle(type = 'sedan', color) {
  const g = new THREE.Group(); g.userData.type = type;
  if (type === 'truck') { buildTruck(g); return g; }
  if (type === 'bike') { buildBike(g, color); return g; }
  if (type === 'boat') { buildBoat(g, color); return g; }
  if (type === 'jetski') { buildJetski(g, color); return g; }
  const D = DEFS[type] || DEFS.sedan, P = carParts(DEFS[type] ? type : 'sedan');
  const base = type === 'police' ? 0x14161b : type === 'taxi' ? 0xf1b40a : (color ?? pick(PAINTS));
  const add = (geo, mat, shadow) => { const m = new THREE.Mesh(geo, mat); m.castShadow = !!shadow; g.add(m); return m; };
  add(P.paint, paintMat(base), true); add(P.glass, glassMat()); add(P.detail, detailMat()); add(P.head, headMat()); add(P.tail, tailMat());
  if (P.white) add(P.white, paintMat(type === 'police' ? 0xf2f2f2 : 0x151515));
  if (P.decal) add(P.decal, M('policeDecal', () => new THREE.MeshStandardMaterial({ map: decalTex('POLICE', '#f2f2f2', '#14161b'), roughness: 0.5, transparent: true })));
  addWheels(g, [[-(D.w / 2 - 0.1), D.wz[0]], [D.w / 2 - 0.1, D.wz[0]], [-(D.w / 2 - 0.1), D.wz[1]], [D.w / 2 - 0.1, D.wz[1]]], D.wr, 0.24);
  g.userData.roofY = D.roof + (type === 'taxi' ? 0.3 : 0.05); g.userData.barWidth = 1.1;
  addBeam(g, D.zF);
  return g;
}

export function spinWheels(car, dt) {
  const ws = car.mesh.userData.wheels; if (!ws) return;
  for (const w of ws) { w.spin += car.speed * dt / w.r; w.g.rotation.x = w.spin; }
}

// ================================================================== humans (Update 1.3)
// Lathe-shaped limbs and torso, painted face, strand-card hair, jointed skeleton and spring-driven
// secondary motion (hair, coat tails, soft body bounce). 'high' = player/NPCs, 'mid' = street pedestrians.
const BODY_MAT = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.7, sheen: 0.35, sheenColor: new THREE.Color(0xffcdb8), sheenRoughness: 0.6 });
const skinMats = new Map();
const skinMat = (c) => { if (!skinMats.has(c)) skinMats.set(c, new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.55, sheen: 0.4, sheenColor: new THREE.Color(0xffb8a0), sheenRoughness: 0.5 })); return skinMats.get(c); };
const faceMats = new Map();
const faceMat = (skin, female, hair, eye, lip) => {
  const k = [skin, female, hair, eye, lip].join('_');
  if (!faceMats.has(k)) faceMats.set(k, new THREE.MeshPhysicalMaterial({ map: faceTexture(skin, female, hair, eye, lip), roughness: 0.5, sheen: 0.4, sheenColor: new THREE.Color(0xffb8a0), sheenRoughness: 0.5 }));
  return faceMats.get(k);
};
const hairCapMats = new Map(), hairCardMats = new Map();
const hairCap = (c) => { if (!hairCapMats.has(c)) hairCapMats.set(c, new THREE.MeshStandardMaterial({ map: hairTexture(c, true), roughness: 0.45, metalness: 0.05 })); return hairCapMats.get(c); };
const hairCard = (c) => { if (!hairCardMats.has(c)) hairCardMats.set(c, new THREE.MeshStandardMaterial({ map: hairTexture(c, false), alphaTest: 0.35, side: THREE.DoubleSide, roughness: 0.45 })); return hairCardMats.get(c); };
const clothMats = new Map();
const clothDS = (c) => { if (!clothMats.has(c)) clothMats.set(c, new THREE.MeshStandardMaterial({ color: c, side: THREE.DoubleSide, roughness: 0.8 })); return clothMats.get(c); };

const lathe = (pts, seg = 14) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);
const vcFn = (g, fn) => {
  g = NI(g); const p = g.attributes.position, n = p.count, a = new Float32Array(n * 3), c = new THREE.Color();
  for (let i = 0; i < n; i++) { c.set(fn(p.getX(i), p.getY(i), p.getZ(i))); a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g;
};
const vc = (g, c) => vcFn(g, () => c);
const ell = (r, x, y, z, w = 14, h = 10) => new THREE.SphereGeometry(r, w, h).scale(x, y, z);

const TORSO_M = [[0, -0.05], [0.13, -0.04], [0.15, 0.04], [0.142, 0.16], [0.138, 0.24], [0.158, 0.36], [0.176, 0.46], [0.16, 0.53], [0.1, 0.57], [0.055, 0.6], [0, 0.6]];
const TORSO_F = [[0, -0.05], [0.145, -0.04], [0.168, 0.04], [0.135, 0.17], [0.126, 0.24], [0.152, 0.34], [0.166, 0.4], [0.152, 0.47], [0.14, 0.52], [0.09, 0.56], [0.052, 0.6], [0, 0.6]];
const UPPER_ARM = [[0, -0.29], [0.036, -0.285], [0.04, -0.2], [0.047, -0.08], [0.05, 0.0], [0.03, 0.04], [0, 0.045]];
const FORE_ARM = [[0, -0.27], [0.028, -0.26], [0.032, -0.2], [0.04, -0.05], [0.037, 0], [0, 0]];
const THIGH = [[0, -0.445], [0.056, -0.44], [0.066, -0.36], [0.078, -0.22], [0.093, -0.06], [0.088, 0], [0, 0]];
const SHIN = [[0, -0.44], [0.034, -0.43], [0.038, -0.36], [0.05, -0.22], [0.064, -0.08], [0.06, 0], [0, 0]];
const PELVIS_Y = 0.955;

function mkSpring(obj, k, c, gain, kind) { return { obj, kind, ax: 0, az: 0, vx: 0, vz: 0, k, c, gain }; }

export function makeHuman(o = {}) {
  const female = o.female ?? Math.random() < 0.45, high = o.quality === 'high', swim = !!o.swim, ph = o.physics ?? 1;
  const skin = o.skin ?? pick([0xf1c9a5, 0xe0ac84, 0xc68863, 0x8d5a3b, 0x5e3a24, 0xf6d5b8]);
  const shirt = o.shirt ?? pick([0xc0392b, 0x2e86c1, 0x27ae60, 0xe8c547, 0x8e44ad, 0xecf0f1, 0xe67e22, 0x2c3e50, 0x16a085]);
  const pants = o.pants ?? pick([0x2c3e50, 0x34495e, 0x5d4e37, 0x1c1c1c, 0x4a6fa5, 0x6b6b6b]);
  const hair = o.hair ?? pick([0x1b1310, 0x4b3220, 0xb08040, 0x222222, 0x8a8a8a, 0x6e3b1f]);
  const shoe = o.shoe ?? pick([0x151515, 0xf0f0f0, 0x5a3b22]);
  const eye = o.eye ?? pick([0x4a3220, 0x2a5a3a, 0x3a5a8a, 0x5a4a30]);
  const lip = o.lip ?? (female ? pick([0xb0605a, 0xc0405a, 0xa0504a]) : 0x9a5a50);
  const style = o.hairStyle ?? (female ? pick(['long', 'long', 'pony', 'short']) : 'short');
  const longSleeve = o.longSleeve ?? Math.random() < 0.55, jacket = o.jacket;
  const sx = female ? 1.1 : 1.22, wide = female ? 0.93 : 1;

  const mk = (parts, mat = BODY_MAT) => { const m = new THREE.Mesh(merge(parts), mat); m.castShadow = true; return m; };
  const group = new THREE.Group(), body = new THREE.Group(), pelvis = new THREE.Group(), spine = new THREE.Group();
  group.add(body); body.add(pelvis); pelvis.position.set(0, PELVIS_Y, 0); pelvis.add(spine);

  // ---- torso (+ hips coloured by height: pants below the belt line, top/jacket above)
  const topC = swim ? skin : (jacket ?? shirt);
  const torsoGeo = lathe(female ? TORSO_F : TORSO_M, 18).scale(sx, 1, 0.74);
  const parts = [vcFn(torsoGeo, (x, y) => (y < 0.07 ? (swim ? shirt : pants) : (swim && female && y > 0.3 && y < 0.44 ? shirt : topC)))];
  if (jacket && shirt !== jacket) parts.push(vc(new THREE.CylinderGeometry(0.07, 0.09, 0.1, 10).translate(0, 0.58, 0.02), shirt));      // shirt collar under jacket
  const torso = mk(parts); spine.add(torso);

  // ---- head
  const head = new THREE.Group(); head.position.set(0, 0.745, 0); spine.add(head);
  const neck = mk([vc(new THREE.CylinderGeometry(0.048, 0.056, 0.14, 10).translate(0, -0.1, 0), skin)]); head.add(neck);
  if (high) {
    const face = new THREE.Mesh(new THREE.SphereGeometry(0.105, 28, 20).scale(0.92, 1.1, 1.0), faceMat(skin, female, hair, eye, lip)); face.castShadow = true; head.add(face);
    const jaw = new THREE.Mesh(merge([new THREE.SphereGeometry(0.07, 14, 10).scale(1.0, 0.85, 0.95).translate(0, -0.075, 0.025), new THREE.SphereGeometry(0.02, 8, 6).scale(0.6, 1, 1).translate(-0.095, -0.005, 0), new THREE.SphereGeometry(0.02, 8, 6).scale(0.6, 1, 1).translate(0.095, -0.005, 0)]), skinMat(skin));
    head.add(jaw);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.112, 26, 16, 0, Math.PI * 2, 0, Math.PI * (style === 'short' ? 0.55 : 0.6)).scale(0.93, 1.1, 1.04).rotateX(-0.38).translate(0, 0.004, -0.004), hairCap(hair));
    head.add(cap);
    if (style === 'short' && !female) { const side = new THREE.Mesh(merge([bx(0.012, 0.05, 0.05, -0.096, -0.005, 0.02), bx(0.012, 0.05, 0.05, 0.096, -0.005, 0.02)]), hairCap(hair)); head.add(side); }
  } else {
    head.add(mk([vc(ell(0.105, 0.92, 1.1, 1.0, 14, 10), skin), vc(ell(0.07, 1.0, 0.85, 0.95, 10, 8).translate(0, -0.075, 0.025), skin), vc(ell(0.013, 1, 1, 1, 6, 5).translate(-0.04, 0.012, 0.1), 0x151515), vc(ell(0.013, 1, 1, 1, 6, 5).translate(0.04, 0.012, 0.1), 0x151515),
      vc(new THREE.SphereGeometry(0.112, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.58).scale(0.93, 1.1, 1.04).rotateX(-0.38).translate(0, 0.004, -0.004), hair)]));
  }
  if (o.hat) head.add(mk([vc(new THREE.CylinderGeometry(0.113, 0.118, 0.07, 14).translate(0, 0.095, 0), o.hat), vc(new THREE.CylinderGeometry(0.125, 0.125, 0.012, 14, 1, false, -0.8, 1.6).translate(0, 0.066, 0.1), o.hat)]));
  if (o.glasses ?? (high ? false : Math.random() < 0.2)) head.add(mk([vc(bx(0.17, 0.03, 0.012, 0, 0.022, 0.104), 0x050505)]));

  const springs = [];
  if (high && (style === 'long' || style === 'pony')) {                       // hair cards that swing independently
    const mat = hairCard(hair), pivot = new THREE.Group(); pivot.position.set(0, 0.03, -0.075); head.add(pivot);
    const n = style === 'long' ? 7 : 3, len = style === 'long' ? 0.52 : 0.34;
    for (let i = 0; i < n; i++) {
      const c = new THREE.PlaneGeometry(style === 'long' ? 0.17 : 0.1, len, 1, 5), pos = c.attributes.position;
      for (let v = 0; v < pos.count; v++) { const t = (0.5 - pos.getY(v) / len); pos.setZ(v, -t * t * 0.05 + Math.sin(t * 5 + i) * 0.012); pos.setX(v, pos.getX(v) * (1 - t * 0.35)); pos.setY(v, pos.getY(v) - len / 2); }
      c.computeVertexNormals();
      const m = new THREE.Mesh(c, mat); const a = (i / (n - 1) - 0.5) * (style === 'long' ? 2.6 : 0.5);
      m.position.set(Math.sin(a) * 0.1, 0, -Math.cos(a) * 0.02 - 0.0); m.rotation.y = -a * 0.8 + Math.PI; m.rotation.x = 0.06 + Math.abs(a) * 0.05; m.castShadow = true; pivot.add(m);
    }
    springs.push(mkSpring(pivot, 38, 4.2, 1.0 * ph, 'hair'));
    if (o.streak) { const s = new THREE.Mesh(new THREE.PlaneGeometry(0.035, len * 0.95, 1, 3).translate(0, -len / 2, 0), new THREE.MeshStandardMaterial({ color: o.streak, side: THREE.DoubleSide, roughness: 0.5 })); s.position.set(-0.05, -0.005, -0.1); s.rotation.x = 0.05; pivot.add(s); }
  }
  if (!high && style !== 'short') { /* mid-quality hair is the baked cap only */ }

  // ---- arms
  const armC = swim || !longSleeve ? skin : (jacket ?? shirt), sleeveTop = swim ? skin : (jacket ?? shirt);
  const mkArm = (s) => {
    const sh = new THREE.Group(); sh.position.set(s * 0.215 * wide * (female ? 0.96 : 1), 0.5, 0); spine.add(sh);
    const el = new THREE.Group(); el.position.set(0, -0.29, 0); sh.add(el);
    const hand = ell(0.04, 1, 1.3, 0.62, 10, 8).translate(0, -0.3, 0.005);
    if (high) {
      sh.add(mk([vcFn(lathe(UPPER_ARM, 10), (x, y) => (swim ? skin : (longSleeve || y > -0.1 ? sleeveTop : skin)))]));
      el.add(mk([vcFn(lathe(FORE_ARM, 10), (x, y) => (longSleeve && !swim ? armC : skin)), vc(hand, skin)]));
    } else {
      sh.add(mk([vcFn(lathe(UPPER_ARM, 8), (x, y) => (longSleeve || y > -0.1 ? sleeveTop : skin)), vcFn(lathe(FORE_ARM, 8).translate(0, -0.29, 0), () => armC), vc(hand.translate(0, -0.29, 0), skin)]));
    }
    const handG = new THREE.Group(); handG.position.set(0, -0.3, 0); el.add(handG);
    return [sh, el, handG];
  };
  const [armL, elbowL] = mkArm(-1), [armR, elbowR, handR] = mkArm(1);

  // ---- legs
  const mkLeg = (s) => {
    const hip = new THREE.Group(); hip.position.set(s * 0.09, -0.04, 0); pelvis.add(hip);
    const kn = new THREE.Group(); kn.position.set(0, -0.44, 0); hip.add(kn);
    hip.add(mk([vc(lathe(THIGH, 12), pants)]));
    const shoeParts = [vc(ell(0.052, 1, 0.8, 2.3, 10, 8).translate(0, -0.465, 0.05), shoe), vc(bx(0.098, 0.026, 0.26, 0, -0.497, 0.045), 0x1b1b1b)];
    kn.add(mk([vc(lathe(SHIN, 12), swim ? skin : pants), ...shoeParts]));
    return [hip, kn];
  };
  const [legL, kneeL] = mkLeg(-1), [legR, kneeR] = mkLeg(1);

  // ---- coat tail that swings (jackets)
  if (jacket && high) {
    const tail = new THREE.Group(); tail.position.set(0, 0.02, 0); pelvis.add(tail);
    const m = new THREE.Mesh(lathe([[0.215, -0.34], [0.2, -0.18], [0.178, -0.04], [0.172, 0.03]], 18).scale(1.18, 1, 0.82), clothDS(jacket)); m.castShadow = true; tail.add(m);
    springs.push(mkSpring(tail, 55, 5.5, 0.9 * ph, 'coat'));
  }
  group.scale.setScalar((high ? 1 : rnd(0.94, 1.06)) * (female ? 0.97 : 1));
  return { group, body, pelvis, spine, head, torso, armL, armR, elbowL, elbowR, handR, legL, legR, kneeL, kneeR, springs, t: Math.random() * 20, mv: 0, seed: Math.random() * 6.28,
    prevSpeed: 0, prevBob: 0, prevBobV: 0, soft: { y: 0, v: 0 }, physics: ph, pose: null, name: o.name || '' };
}

const stepSpring = (s, tx, tz, dt) => {
  s.vx += ((tx - s.ax) * s.k - s.vx * s.c) * dt; s.vz += ((tz - s.az) * s.k - s.vz * s.c) * dt;
  s.ax = clamp1(s.ax + s.vx * dt, 1.2); s.az = clamp1(s.az + s.vz * dt, 0.9);
  s.obj.rotation.x = s.ax; s.obj.rotation.z = s.az;
};
const clamp1 = (v, m) => Math.max(-m, Math.min(m, v));

// phase: walk cycle phase; amp: stride amplitude (0 = idle, ~0.7 walk, ~0.95 run); speed in m/s; turn in rad/s.
export function animateHuman(h, phase, amp, dt = 1 / 60, speed = amp * 5, turn = 0) {
  h.t += dt;
  h.mv += ((amp > 0.02 ? 1 : 0) - h.mv) * Math.min(1, dt * 9);
  const A = amp * h.mv, I = 1 - h.mv, t = h.t, s = Math.sin(phase), c = Math.cos(phase), run = Math.max(0, Math.min(1, (amp - 0.75) / 0.25)) * h.mv;
  const lean = 0.03 * A + run * 0.2;
  if (h.pose === 'ride') {
    h.legL.rotation.x = h.legR.rotation.x = -1.2; h.kneeL.rotation.x = h.kneeR.rotation.x = 1.4;
    h.legL.rotation.z = 0.12; h.legR.rotation.z = -0.12;
    h.armL.rotation.set(-1.02, 0, -0.1); h.armR.rotation.set(-1.02, 0, 0.1); h.elbowL.rotation.x = h.elbowR.rotation.x = -0.12;
    h.spine.rotation.set(0.55, 0, 0); h.pelvis.rotation.set(0, 0, 0); h.head.rotation.set(-0.5, 0, 0); h.body.position.y = 0;
  } else {
    h.legL.rotation.z = h.legR.rotation.z = 0;
    h.legL.rotation.x = s * A + Math.sin(t * 0.6 + h.seed) * 0.015 * I; h.legR.rotation.x = -s * A;
    h.kneeL.rotation.x = Math.max(0, -s) * A * 1.35 + run * 0.3 * Math.max(0, -s); h.kneeR.rotation.x = Math.max(0, s) * A * 1.35 + run * 0.3 * Math.max(0, s);
    h.armL.rotation.x = -s * A * 0.85; h.armR.rotation.x = s * A * 0.85;
    const sh = Math.sin(t * 1.7 + h.seed) * 0.012 * I;                                    // breathing lifts the shoulders
    h.armL.rotation.z = -0.07 - sh * 3 - run * 0.1; h.armR.rotation.z = 0.07 + sh * 3 + run * 0.1;
    const bend = -0.12 - A * 0.4 - run * 0.7; h.elbowL.rotation.x = bend; h.elbowR.rotation.x = bend;
    h.pelvis.rotation.y = s * 0.15 * A; h.pelvis.rotation.z = -s * 0.05 * A + Math.sin(t * 0.55 + h.seed) * 0.02 * I;
    h.spine.rotation.y = -s * 0.13 * A; h.spine.rotation.z = s * 0.035 * A; h.spine.rotation.x = lean + Math.sin(t * 1.7 + h.seed) * 0.01 * I;
    h.head.rotation.y = -h.spine.rotation.y * 0.8 + Math.sin(t * 0.33 + h.seed) * 0.32 * I; h.head.rotation.x = -lean * 0.8 + Math.sin(t * 0.5 + h.seed) * 0.05 * I;
    h.head.rotation.z = -h.spine.rotation.z;
    h.body.position.y = Math.abs(c) * (0.03 + run * 0.03) * A;
  }
  // ---- secondary motion: springs lag behind body acceleration (hair, coat tails) + soft body bounce
  const acc = dt > 0 ? (speed - h.prevSpeed) / dt : 0; h.prevSpeed = speed;
  const bobV = dt > 0 ? (h.body.position.y - h.prevBob) / dt : 0, bobA = dt > 0 ? (bobV - h.prevBobV) / dt : 0; h.prevBob = h.body.position.y; h.prevBobV = bobV;
  for (const sp of h.springs) {
    const g = sp.gain, tx = (speed * 0.045 + Math.max(-4, Math.min(6, acc)) * 0.01 + bobV * 0.25) * g * (sp.kind === 'coat' ? 0.9 : 1) + (sp.kind === 'hair' ? 0.05 : 0);
    stepSpring(sp, tx, -turn * 0.18 * g + Math.sin(t * 1.3 + h.seed) * 0.02 * g, dt);
  }
  const k = h.soft; k.v += (-k.y * 260 - k.v * 11 - bobA * 0.012) * dt; k.y = clamp1(k.y + k.v * dt, 0.04);
  h.torso.position.y = k.y * 0.5 * h.physics; h.torso.scale.set(1 + k.y * 0.5, 1 + Math.sin(t * 1.7 + h.seed) * 0.006 * I - k.y * 0.4, 1 + k.y * 0.5);
}

export const makeLuna = () => makeHuman({ name: 'Luna', quality: 'high', female: true, skin: 0xd8a07c, hair: 0x120a10, hairStyle: 'long', streak: 0xff4fa3, eye: 0x2a5a3a, lip: 0xc0405a,
  shirt: 0xff4fa3, jacket: 0x1d1b26, pants: 0x14141a, shoe: 0xf2f2f2, longSleeve: true, physics: 1.7 });

// ==================================================================== bike
let bikeParts = null;
function bikeGeometry() {
  if (bikeParts) return bikeParts;
  const P = [], D = [], CH = [], H = [], L = [];
  P.push(new THREE.CapsuleGeometry(0.15, 0.34, 4, 10).rotateX(Math.PI / 2).scale(1, 0.95, 1).translate(0, 0.88, 0.2));                   // tank
  P.push(bx(0.2, 0.14, 0.62, 0, 0.82, -0.62).rotateX(0.08), bx(0.28, 0.3, 0.3, 0, 0.9, 0.58).rotateX(-0.25));                                // tail cowl, fairing
  P.push(bx(0.1, 0.03, 0.5, 0, 0.62, -0.9), bx(0.16, 0.03, 0.5, 0, 0.65, 0.95));                                                              // fenders
  D.push(bx(0.3, 0.3, 0.42, 0, 0.45, 0.02), bx(0.3, 0.09, 0.6, 0, 0.74, -0.32), bx(0.09, 0.09, 0.09, 0, 0.5, -0.5), bx(0.5, 0.04, 0.04, 0, 0.38, 0.0));
  for (const s of [-1, 1]) {
    D.push(new THREE.CylinderGeometry(0.022, 0.022, 0.72, 8).rotateX(0.38).translate(s * 0.1, 0.68, 0.76));                                      // fork
    D.push(new THREE.CylinderGeometry(0.014, 0.014, 0.22, 6).rotateZ(Math.PI / 2).translate(s * 0.33, 1.02, 0.52), bx(0.05, 0.05, 0.1, s * 0.2, 1.1, 0.5));  // grips, mirrors
    CH.push(new THREE.CylinderGeometry(0.045, 0.05, 0.95, 10).rotateX(Math.PI / 2).translate(s * 0.2, 0.33, -0.15));                           // exhausts
    D.push(bx(0.03, 0.03, 0.14, s * 0.26, 0.33, 0.02));                                                                                        // footpegs
  }
  D.push(new THREE.CylinderGeometry(0.014, 0.014, 0.68, 8).rotateZ(Math.PI / 2).translate(0, 1.0, 0.54));                                         // handlebar
  H.push(new THREE.SphereGeometry(0.09, 12, 8).scale(1, 1, 0.7).translate(0, 0.98, 0.74)); L.push(bx(0.12, 0.05, 0.04, 0, 0.82, -0.92));
  bikeParts = { paint: merge(P), detail: merge(D), chrome: merge(CH), head: merge(H), tail: merge(L) };
  return bikeParts;
}
function buildBike(g, color) {
  const P = bikeGeometry(), add = (geo, mat, sh) => { const m = new THREE.Mesh(geo, mat); m.castShadow = !!sh; g.add(m); return m; };
  add(P.paint, paintMat(color ?? pick([0xb3202b, 0x1f5fa8, 0x111114, 0xe9e9e9, 0xd9a21b, 0x1b6b45])), true); add(P.detail, detailMat(), true);
  add(P.chrome, rimMat()); add(P.head, headMat()); add(P.tail, tailMat());
  addWheels(g, [[0, -0.78], [0, 0.82]], 0.33, 0.15);
  g.userData.roofY = 1.1; g.userData.barWidth = 0.3; g.userData.seat = new THREE.Vector3(0, 0.83, -0.3);
  addBeam(g, 0.95, 1.6, 10);
}

// ================================================================ boats
const hullGeo = (pts, h) => { const s = new THREE.Shape(); pts.forEach(([x, z], i) => (i ? s.lineTo(x, -z) : s.moveTo(x, -z))); s.closePath(); return new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false }).rotateX(-Math.PI / 2); };
const foamMat = () => M('foam', () => new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
function addWake(g, len, w, wl) {
  const wk = new THREE.Group();
  for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.PlaneGeometry(w, len).rotateX(-Math.PI / 2).translate(0, wl, -len / 2), foamMat()); p.rotation.y = s * 0.22; wk.add(p); }
  g.add(wk); g.userData.wake = wk;
}
function buildBoat(g, color) {
  const c = color ?? pick([0xf2f2f2, 0x1f5fa8, 0xb3202b, 0x111114]), add = (geo, mat, sh) => { const m = new THREE.Mesh(geo, mat); m.castShadow = !!sh; g.add(m); return m; };
  add(hullGeo([[-0.9, -2.5], [0.9, -2.5], [1.0, -0.3], [0.0, 2.7], [-1.0, -0.3]], 0.75), paintMat(c), true);
  add(hullGeo([[-0.93, -2.5], [0.93, -2.5], [1.03, -0.3], [0.0, 2.75], [-1.03, -0.3]], 0.12).translate(0, 0.02, 0), paintMat(c === 0xf2f2f2 ? 0x1f5fa8 : 0xf2f2f2));        // waterline stripe
  add(merge([bx(1.7, 0.05, 3.4, 0, 0.77, -0.7), bx(1.2, 0.05, 1.6, 0, 0.77, 1.3)]), paintMat(0xb08a5a));                                              // teak deck
  add(merge([bx(0.9, 0.5, 0.7, 0, 1.02, 0.35), bx(1.3, 0.3, 0.55, 0, 0.95, -1.05), bx(0.35, 0.9, 0.35, 0, 0.7, -2.55)]), detailMat(), true);                // console, bench seat, outboard
  add(bx(1.55, 0.5, 0.05, 0, 1.3, 0.8).rotateX(-0.55), glassMat());                                                                                  // windshield
  add(merge([cyl2(0.015, 1.7, -0.9, 1.75, 0.15, 0)]), rimMat());
  add(merge([bx(0.12, 0.08, 0.06, 0, 0.7, 2.4), bx(0.2, 0.05, 0.05, 0, 0.85, -2.5)]), headMat());
  g.userData.roofY = 1.4; g.userData.barWidth = 0.35; g.userData.seat = new THREE.Vector3(0, 1.0, -0.55); g.userData.baseY = -0.85;
  addWake(g, 7, 0.9, 0.15);
}
const cyl2 = (r, l, x, y, z) => new THREE.CylinderGeometry(r, r, l, 8).rotateZ(Math.PI / 2).translate(x + 0.85, y, z);
function buildJetski(g, color) {
  const c = color ?? pick([0xe8c21b, 0xd0302a, 0x1f9bd0, 0x22b573]), add = (geo, mat, sh) => { const m = new THREE.Mesh(geo, mat); m.castShadow = !!sh; g.add(m); return m; };
  add(hullGeo([[-0.42, -1.15], [0.42, -1.15], [0.46, -0.2], [0.0, 1.3], [-0.46, -0.2]], 0.42), paintMat(c), true);
  add(merge([bx(0.5, 0.18, 1.5, 0, 0.5, -0.2), bx(0.42, 0.26, 0.5, 0, 0.55, 0.85).rotateX(0.2)]), paintMat(0xf4f4f4), true);
  add(merge([bx(0.34, 0.12, 0.85, 0, 0.64, -0.45), new THREE.CylinderGeometry(0.014, 0.014, 0.6, 8).rotateZ(Math.PI / 2).translate(0, 0.95, 0.55), bx(0.03, 0.32, 0.03, 0, 0.78, 0.55)]), detailMat(), true);
  add(bx(0.4, 0.22, 0.04, 0, 0.88, 0.7).rotateX(-0.5), glassMat());
  g.userData.roofY = 1.0; g.userData.barWidth = 0.25; g.userData.seat = new THREE.Vector3(0, 0.7, -0.4); g.userData.baseY = -0.65;
  addWake(g, 5, 0.6, 0.0);
}

// ================================================================== weapons
const wMats = {};
const wMat = (k, f) => (wMats[k] ??= f());
const steel = () => wMat('steel', () => new THREE.MeshStandardMaterial({ color: 0xc4c8ce, roughness: 0.25, metalness: 1 }));
const gunMetal = () => wMat('gun', () => new THREE.MeshStandardMaterial({ color: 0x1a1c20, roughness: 0.4, metalness: 0.85 }));
const wood = () => wMat('wood', () => new THREE.MeshStandardMaterial({ color: 0x6a4527, roughness: 0.55, metalness: 0 }));
const grip = () => wMat('grip', () => new THREE.MeshStandardMaterial({ color: 0x232323, roughness: 0.8 }));
const cyl = (r, l, x, y, z) => new THREE.CylinderGeometry(r, r, l, 10).rotateX(Math.PI / 2).translate(x, y, z);

// Weapon forward is +z, grip near the origin. userData.muzzle = local muzzle position.
export function makeWeapon(type) {
  const g = new THREE.Group(), M = [];
  const add = (parts, mat) => { if (parts.length) { const m = new THREE.Mesh(merge(parts), mat); m.castShadow = true; g.add(m); } };
  if (type === 'knife') {
    const s = new THREE.Shape(); [[0, -0.016], [0.2, -0.016], [0.255, 0.004], [0.2, 0.022], [0, 0.022]].forEach(([z, y], i) => (i ? s.lineTo(z, y) : s.moveTo(z, y)));
    const blade = new THREE.ExtrudeGeometry(s, { depth: 0.004, bevelEnabled: false }).rotateY(-Math.PI / 2).translate(0.002, 0, 0);
    add([blade, bx(0.012, 0.05, 0.012, 0, 0.0, 0.0)], steel()); add([bx(0.03, 0.036, 0.12, 0, 0, -0.07)], grip());
    g.userData.muzzle = new THREE.Vector3(0, 0, 0.25);
  } else if (type === 'pistol') {
    add([bx(0.028, 0.04, 0.18, 0, 0.035, 0.07), cyl(0.009, 0.04, 0, 0.03, 0.18)], gunMetal()); add([bx(0.03, 0.1, 0.045, 0, -0.035, -0.005).rotateX(0.18)], grip());
    g.userData.muzzle = new THREE.Vector3(0, 0.03, 0.2);
  } else if (type === 'smg') {
    add([bx(0.04, 0.06, 0.32, 0, 0.03, 0.12), cyl(0.011, 0.12, 0, 0.035, 0.34), bx(0.024, 0.15, 0.04, 0, -0.07, 0.12), bx(0.02, 0.02, 0.2, 0, 0.03, -0.17)], gunMetal()); add([bx(0.03, 0.09, 0.045, 0, -0.04, -0.01).rotateX(0.2)], grip());
    g.userData.muzzle = new THREE.Vector3(0, 0.035, 0.4);
  } else if (type === 'shotgun') {
    add([cyl(0.016, 0.72, 0, 0.04, 0.4), cyl(0.012, 0.6, 0, 0.0, 0.36), bx(0.045, 0.07, 0.22, 0, 0.03, 0.05)], gunMetal()); add([bx(0.05, 0.045, 0.2, 0, -0.005, 0.38), bx(0.04, 0.09, 0.3, 0, -0.02, -0.2), bx(0.034, 0.05, 0.09, 0, -0.05, 0.0)], wood());
    g.userData.muzzle = new THREE.Vector3(0, 0.04, 0.78);
  } else {                                   // rifle
    add([bx(0.045, 0.07, 0.34, 0, 0.035, 0.1), cyl(0.011, 0.38, 0, 0.05, 0.52), bx(0.026, 0.14, 0.05, 0, -0.08, 0.16).rotateX(0.25)], gunMetal()); add([bx(0.04, 0.05, 0.28, 0, 0.0, 0.42), bx(0.04, 0.1, 0.3, 0, -0.02, -0.21), bx(0.03, 0.09, 0.045, 0, -0.045, 0.0)], wood());
    g.userData.muzzle = new THREE.Vector3(0, 0.05, 0.72);
  }
  g.userData.type = type; return g;
}
