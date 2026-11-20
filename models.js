// models.js - Update 1.2: realistic vehicles and humans, built procedurally.
// Static parts are merged per material, so a car is ~10 draw calls and a person ~11.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { NightReg, nightOpacity, beamTexture, canvasTex } from './gfx.js';

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

// ================================================================== humans
const HUMAN_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0 });
const vc = (g, c) => {
  g = NI(g); const col = new THREE.Color(c), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = col.r; a[i * 3 + 1] = col.g; a[i * 3 + 2] = col.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g;
};
const S = (r, x, y, z) => new THREE.SphereGeometry(r, 12, 10).scale(x, y, z);
const C = (r, len) => new THREE.CapsuleGeometry(r, len, 4, 10);

export function makeHuman(o = {}) {
  const female = o.female ?? Math.random() < 0.45;
  const skin = o.skin ?? pick([0xf1c9a5, 0xe0ac84, 0xc68863, 0x8d5a3b, 0x5e3a24, 0xf6d5b8]);
  const shirt = o.shirt ?? pick([0xc0392b, 0x2e86c1, 0x27ae60, 0xe8c547, 0x8e44ad, 0xecf0f1, 0xe67e22, 0x2c3e50, 0x16a085]);
  const pants = o.pants ?? pick([0x2c3e50, 0x34495e, 0x5d4e37, 0x1c1c1c, 0x4a6fa5, 0x6b6b6b]);
  const hair = o.hair ?? pick([0x1b1310, 0x4b3220, 0xb08040, 0x222222, 0x8a8a8a, 0x6e3b1f]);
  const shoe = pick([0x151515, 0xf0f0f0, 0x5a3b22]);
  const longSleeve = o.longSleeve ?? Math.random() < 0.55, swim = !!o.swim, wide = female ? 0.93 : 1;
  const torsoC = swim ? (female ? skin : skin) : shirt, armC = swim || !longSleeve ? skin : shirt;

  const torso = [vc(C(0.16, 0.3).scale(female ? 1.05 : 1.2, 1, 0.78).translate(0, 1.2, 0), torsoC), vc(new THREE.CylinderGeometry(0.052, 0.058, 0.1, 8).translate(0, 1.5, 0), skin),
    vc(S(0.15, female ? 1.4 : 1.2, 0.8, 0.85).translate(0, 0.95, 0), swim ? shirt : pants)];
  if (swim && female) torso.push(vc(new THREE.CylinderGeometry(0.168, 0.168, 0.1, 12, 1, true).scale(1.05, 1, 0.8).translate(0, 1.3, 0), shirt));
  if (o.jacket) torso.push(vc(C(0.172, 0.2).scale(1.22, 1, 0.82).translate(0, 1.13, 0), o.jacket));

  const head = [vc(S(0.115, 0.92, 1.08, 1).translate(0, 0, 0), skin), vc(S(0.014, 1, 1, 1).translate(-0.04, 0.02, 0.106), 0x111111), vc(S(0.014, 1, 1, 1).translate(0.04, 0.02, 0.106), 0x111111),
    vc(new THREE.ConeGeometry(0.018, 0.04, 6).rotateX(Math.PI / 2).translate(0, -0.012, 0.118), skin), vc(bx(0.04, 0.008, 0.01, 0, -0.06, 0.108), 0x8a3b3b),
    vc(S(0.022, 0.6, 1, 1).translate(-0.108, 0, 0), skin), vc(S(0.022, 0.6, 1, 1).translate(0.108, 0, 0), skin)];
  const hairGeo = new THREE.SphereGeometry(0.124, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.56).scale(0.95, 1.05, 1.02).rotateX(-0.18).translate(0, 0.012, -0.005);
  if (o.hat) { head.push(vc(new THREE.CylinderGeometry(0.12, 0.125, 0.07, 14).translate(0, 0.095, 0), o.hat), vc(new THREE.CylinderGeometry(0.13, 0.13, 0.012, 14, 1, false, -0.7, 1.4).translate(0, 0.07, 0.1), o.hat)); }
  else head.push(vc(hairGeo, hair));
  if (female && !o.hat) head.push(vc(C(0.085, 0.16).scale(1.2, 1, 0.8).translate(0, -0.1, -0.075), hair));
  if (o.glasses ?? Math.random() < 0.2) head.push(vc(bx(0.17, 0.03, 0.012, 0, 0.022, 0.112), 0x050505));

  const mk = (list) => { const m = new THREE.Mesh(merge(list), HUMAN_MAT); m.castShadow = true; return m; };
  const group = new THREE.Group(), body = new THREE.Group(); group.add(body);
  body.add(mk(torso));
  const headG = new THREE.Group(); headG.position.set(0, 1.63, 0); headG.add(mk(head)); body.add(headG);

  const arm = (s) => {
    const sh = new THREE.Group(); sh.position.set(s * 0.215 * wide, 1.44, 0);
    sh.add(mk([vc(C(0.046, 0.2).translate(0, -0.16, 0), swim || !longSleeve ? (swim ? skin : shirt) : shirt)]));
    const el = new THREE.Group(); el.position.set(0, -0.31, 0);
    el.add(mk([vc(C(0.04, 0.2).translate(0, -0.15, 0), armC), vc(S(0.044, 1, 1.1, 1).translate(0, -0.33, 0), skin)])); sh.add(el); body.add(sh); return [sh, el];
  };
  const leg = (s) => {
    const hip = new THREE.Group(); hip.position.set(s * 0.09, 0.93, 0);
    hip.add(mk([vc(C(0.076, 0.26).translate(0, -0.2, 0), pants)]));
    const kn = new THREE.Group(); kn.position.set(0, -0.45, 0);
    kn.add(mk([vc(C(0.058, 0.28).translate(0, -0.2, 0), swim ? skin : pants), vc(bx(0.1, 0.075, 0.27, 0, -0.5, 0.05), shoe)])); hip.add(kn); body.add(hip); return [hip, kn];
  };
  const [armL, elbowL] = arm(-1), [armR, elbowR] = arm(1), [legL, kneeL] = leg(-1), [legR, kneeR] = leg(1);
  group.scale.setScalar(rnd(0.94, 1.06) * (female ? 0.96 : 1));
  return { group, body, head: headG, armL, armR, elbowL, elbowR, legL, legR, kneeL, kneeR };
}

export function animateHuman(h, phase, amp) {
  const s = Math.sin(phase), c = Math.cos(phase);
  h.legL.rotation.x = s * amp; h.legR.rotation.x = -s * amp;
  h.kneeL.rotation.x = Math.max(0, -s) * amp * 1.3; h.kneeR.rotation.x = Math.max(0, s) * amp * 1.3;
  h.armL.rotation.x = -s * amp * 0.8; h.armR.rotation.x = s * amp * 0.8;
  const bend = amp > 0.01 ? -0.25 - amp * 0.3 : -0.05;
  h.elbowL.rotation.x = bend; h.elbowR.rotation.x = bend;
  h.body.position.y = amp > 0.01 ? Math.abs(c) * 0.035 * amp : 0;
}
