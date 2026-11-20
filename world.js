// world.js - Blacktop City (Update 1.2): islands, merged road mesh with markings, raised sidewalks,
// bridges, PBR water, beaches, plus sky/day-night via gfx.js, buildings.js and props.js.
import * as THREE from 'three';
import { asphaltMaterial, sidewalkMaterial, sandMaterial, waterMaterial, createEnvironment, canvasTex } from './gfx.js';
import { buildBuildings, BASE_Y } from './buildings.js';
import { buildProps } from './props.js';

export const ROAD_W = 14;
export const ISLANDS = [
  { name: 'Downtown',    cx: 0,    cz: 0,   hw: 200, hd: 200, xs: [-160, -80, 0, 80, 160], zs: [-160, -80, 0, 80, 160] },
  { name: 'East Bay',    cx: 430,  cz: 0,   hw: 110, hd: 150, xs: [350, 430, 510], zs: [-80, 0, 80] },
  { name: 'West Harbor', cx: -430, cz: 0,   hw: 110, hd: 150, xs: [-510, -430, -350], zs: [-80, 0, 80] },
  { name: 'South Cape',  cx: 0,    cz: 410, hw: 130, hd: 90,  xs: [-80, 0, 80], zs: [350, 430] },
];
export const BRIDGES = [
  { axis: 'x', c: 0, from: 225, to: 295,  a: [160, 0],  b: [350, 0] },
  { axis: 'x', c: 0, from: -295, to: -225, a: [-160, 0], b: [-350, 0] },
  { axis: 'z', c: 0, from: 225, to: 295,  a: [0, 160],  b: [0, 350] },
];
const SAND = 25, BRIDGE_HALF = 9, STATION_BLOCK = { x0: 0, x1: 80, z0: 0, z1: 80 }, CURB = BASE_Y - 0.02;

function rng(seed) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

// Small indexed-geometry builder used for roads, markings and sidewalks (one draw call each).
class GeoBuilder {
  constructor() { this.pos = []; this.nor = []; this.uv = []; this.col = []; this.idx = []; }
  quad(pts, n, uvf, color) {
    let [a, b, c] = pts;
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const cr = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    if (cr[0] * n[0] + cr[1] * n[1] + cr[2] * n[2] < 0) pts = [pts[0], pts[3], pts[2], pts[1]];
    const base = this.pos.length / 3;
    for (const p of pts) { this.pos.push(p[0], p[1], p[2]); this.nor.push(n[0], n[1], n[2]); const t = uvf(p); this.uv.push(t[0], t[1]); if (color) this.col.push(color[0], color[1], color[2]); }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2)); if (this.col.length) g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx); return g;
  }
}

export function buildWorld(scene, renderer) {
  const R = rng(1337);
  const colliders = [], nodes = new Map(), edges = [], roadPoints = [], buildings = [];

  // ------------------------------------------------------------- road graph
  const node = (x, z) => { const k = x + ',' + z; if (!nodes.has(k)) nodes.set(k, { x, z, adj: [] }); return nodes.get(k); };
  const link = (a, b, bridge) => {
    const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz), e = { a, b, len, dx: dx / len, dz: dz / len, bridge: !!bridge };
    edges.push(e); a.adj.push({ to: b, edge: e }); b.adj.push({ to: a, edge: e });
  };
  for (const isl of ISLANDS) {
    for (const x of isl.xs) for (const z of isl.zs) node(x, z);
    for (let i = 0; i < isl.xs.length; i++) for (let j = 0; j < isl.zs.length; j++) {
      if (i + 1 < isl.xs.length) link(node(isl.xs[i], isl.zs[j]), node(isl.xs[i + 1], isl.zs[j]));
      if (j + 1 < isl.zs.length) link(node(isl.xs[i], isl.zs[j]), node(isl.xs[i], isl.zs[j + 1]));
    }
  }
  for (const b of BRIDGES) link(node(b.a[0], b.a[1]), node(b.b[0], b.b[1]), true);
  for (const e of edges) for (let t = 0; t <= e.len; t += 20) roadPoints.push({ x: e.a.x + e.dx * t, y: 0, z: e.a.z + e.dz * t });
  function distToRoads(x, z) {
    let best = 1e9;
    for (const e of edges) { const t = Math.max(0, Math.min(e.len, (x - e.a.x) * e.dx + (z - e.a.z) * e.dz)); best = Math.min(best, Math.hypot(x - (e.a.x + e.dx * t), z - (e.a.z + e.dz * t))); }
    return best;
  }

  // ------------------------------------------------------- land / water tests
  const onLand = (x, z, r = 0) => ISLANDS.some((i) => Math.abs(x - i.cx) < i.hw + SAND - 1 - r && Math.abs(z - i.cz) < i.hd + SAND - 1 - r);
  const onBridge = (x, z, r = 0) => BRIDGES.some((b) => {
    const along = b.axis === 'x' ? x : z, perp = b.axis === 'x' ? z - b.c : x - b.c;
    return Math.abs(perp) < BRIDGE_HALF - r && along > Math.min(b.from, b.to) - 4 && along < Math.max(b.from, b.to) + 4;
  });
  const isBlocked = (x, z, r = 0) => !(onLand(x, z, r) || onBridge(x, z, r));

  // -------------------------------------------------------- environment / sky
  const env = createEnvironment(scene, renderer, 16.5);
  const cloudTex = canvasTex(256, 128, (g, w, h) => {
    for (let i = 0; i < 16; i++) {
      const x = 40 + Math.random() * (w - 80), y = 36 + Math.random() * (h - 66), r = 22 + Math.random() * 32, gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(255,255,255,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
    }
  }, { repeat: false });
  const clouds = [];
  for (let i = 0; i < 46; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: cloudTex, fog: false, transparent: true, depthWrite: false, opacity: 0.8 }));
    const w = 240 + Math.random() * 280; s.scale.set(w, w * 0.42, 1);
    s.position.set((Math.random() - 0.5) * 2400, 260 + Math.random() * 160, (Math.random() - 0.5) * 2400); scene.add(s); clouds.push(s);
  }
  env.setClouds(clouds);

  // -------------------------------------------------------------------- sea
  const waterMat = waterMaterial();
  const ocean = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000).rotateX(-Math.PI / 2), waterMat); ocean.position.y = -0.7; ocean.receiveShadow = true; scene.add(ocean);

  // ----------------------------------------------------------------- islands
  const concrete = new THREE.MeshStandardMaterial({ color: 0x7c7f84, roughness: 0.95 });
  const sandFor = (w, d, color) => { const m = sandMaterial(color); m.map = m.map.clone(); m.map.repeat.set(w / 8, d / 8); m.map.needsUpdate = true; m.bumpMap = m.map; return m; };
  const foam = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false });
  const box = (w, h, d, mat, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.receiveShadow = true; scene.add(m); return m; };
  for (const i of ISLANDS) {
    const ww = i.hw * 2 + (SAND + 10) * 2, dd = i.hd * 2 + (SAND + 10) * 2;
    box(ww, 2, dd, sandFor(ww, dd, 0xb09d72), i.cx, -1.25, i.cz);
    box(i.hw * 2 + SAND * 2, 2, i.hd * 2 + SAND * 2, sandFor(i.hw * 2 + SAND * 2, i.hd * 2 + SAND * 2), i.cx, -1, i.cz);
    box(i.hw * 2, 2, i.hd * 2, concrete, i.cx, -0.98, i.cz);
    const fx = i.hw + SAND + 10, fz = i.hd + SAND + 10;
    for (const s of [-1, 1]) { box(fx * 2 + 6, 0.02, 4, foam, i.cx, -0.68, i.cz + s * (fz + 1)); box(4, 0.02, fz * 2 + 6, foam, i.cx + s * (fx + 1), -0.68, i.cz); }
  }

  // ----------------------------------------------------- roads + markings
  const roadB = new GeoBuilder(), markB = new GeoBuilder(), UPN = [0, 1, 0];
  const worldUV = (k) => (p) => [p[0] / k, p[2] / k];
  const WHITE = [0.93, 0.93, 0.9], YELLOW = [0.9, 0.7, 0.1];
  const rect = (b, cx, cz, dx, dz, len, wid, y, color) => {
    const px = -dz, pz = dx, hl = len / 2, hw = wid / 2;
    b.quad([[cx - dx * hl - px * hw, y, cz - dz * hl - pz * hw], [cx - dx * hl + px * hw, y, cz - dz * hl + pz * hw], [cx + dx * hl + px * hw, y, cz + dz * hl + pz * hw], [cx + dx * hl - px * hw, y, cz + dz * hl - pz * hw]], UPN, worldUV(8), color);
  };
  for (const e of edges) {
    const mid = { x: (e.a.x + e.b.x) / 2, z: (e.a.z + e.b.z) / 2 }, at = (t, off) => [e.a.x + e.dx * t - e.dz * off, e.a.z + e.dz * t + e.dx * off];
    rect(roadB, mid.x, mid.z, e.dx, e.dz, e.len + ROAD_W, ROAD_W, 0.05);
    for (const o of [-0.18, 0.18]) { const [x, z] = at(e.len / 2, o); rect(markB, x, z, e.dx, e.dz, e.len - 29, 0.14, 0.062, YELLOW); }
    for (const o of [-6.45, 6.45]) { const [x, z] = at(e.len / 2, o); rect(markB, x, z, e.dx, e.dz, e.len - 16, 0.15, 0.062, WHITE); }
    for (const end of [0, 1]) {
      const t = end ? e.len - 10.7 : 10.7;
      for (let k = -5; k <= 5; k++) { const [x, z] = at(t, k * 1.1); rect(markB, x, z, e.dx, e.dz, 3, 0.55, 0.062, WHITE); }
      const [sx, sz] = at(end ? e.len - 13.6 : 13.6, end ? 3.5 : -3.5); rect(markB, sx, sz, e.dx, e.dz, 0.4, 3.2, 0.062, WHITE);
    }
  }
  const asphalt = asphaltMaterial();
  const roads = new THREE.Mesh(roadB.build(), asphalt); roads.receiveShadow = true; scene.add(roads);
  const marks = new THREE.Mesh(markB.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
  marks.receiveShadow = true; scene.add(marks);

  // --------------------------------------------------------------- sidewalks
  const corridors = edges.map((e) => {
    const x0 = Math.min(e.a.x, e.b.x) - 7, x1 = Math.max(e.a.x, e.b.x) + 7, z0 = Math.min(e.a.z, e.b.z) - 7, z1 = Math.max(e.a.z, e.b.z) + 7;
    return e.dx !== 0 ? { x0, x1, z0: e.a.z - 7, z1: e.a.z + 7 } : { x0: e.a.x - 7, x1: e.a.x + 7, z0, z1 };
  });
  const subtract = (r, c) => {
    if (c.x0 >= r.x1 || c.x1 <= r.x0 || c.z0 >= r.z1 || c.z1 <= r.z0) return [r];
    const out = [], cx0 = Math.max(c.x0, r.x0), cx1 = Math.min(c.x1, r.x1);
    if (c.x0 > r.x0) out.push({ x0: r.x0, x1: c.x0, z0: r.z0, z1: r.z1 });
    if (c.x1 < r.x1) out.push({ x0: c.x1, x1: r.x1, z0: r.z0, z1: r.z1 });
    if (c.z0 > r.z0) out.push({ x0: cx0, x1: cx1, z0: r.z0, z1: c.z0 });
    if (c.z1 < r.z1) out.push({ x0: cx0, x1: cx1, z0: c.z1, z1: r.z1 });
    return out;
  };
  const slabs = [];
  for (const isl of ISLANDS) {
    const iv = (arr, lo, hi) => { const o = [[lo, arr[0] - 7]]; for (let i = 0; i + 1 < arr.length; i++) o.push([arr[i] + 7, arr[i + 1] - 7]); o.push([arr[arr.length - 1] + 7, hi]); return o; };
    for (const [xa, xb] of iv(isl.xs, isl.cx - isl.hw + 1, isl.cx + isl.hw - 1)) for (const [za, zb] of iv(isl.zs, isl.cz - isl.hd + 1, isl.cz + isl.hd - 1)) {
      let pieces = [{ x0: xa, x1: xb, z0: za, z1: zb }];
      for (const c of corridors) pieces = pieces.flatMap((p) => subtract(p, c));
      for (const p of pieces) if (p.x1 - p.x0 > 0.5 && p.z1 - p.z0 > 0.5) slabs.push(p);
    }
  }
  const swB = new GeoBuilder(), Y0 = 0.02;
  for (const s of slabs) {
    swB.quad([[s.x0, BASE_Y, s.z0], [s.x0, BASE_Y, s.z1], [s.x1, BASE_Y, s.z1], [s.x1, BASE_Y, s.z0]], UPN, worldUV(4));
    const side = (a, b, n) => swB.quad([[a[0], Y0, a[1]], [a[0], BASE_Y, a[1]], [b[0], BASE_Y, b[1]], [b[0], Y0, b[1]]], n, (p) => [(p[0] + p[2]) / 4, p[1] * 4], null);
    side([s.x0, s.z0], [s.x1, s.z0], [0, 0, -1]); side([s.x0, s.z1], [s.x1, s.z1], [0, 0, 1]); side([s.x0, s.z0], [s.x0, s.z1], [-1, 0, 0]); side([s.x1, s.z0], [s.x1, s.z1], [1, 0, 0]);
  }
  const sidewalks = new THREE.Mesh(swB.build(), sidewalkMaterial()); sidewalks.receiveShadow = true; sidewalks.castShadow = true; scene.add(sidewalks);
  const inSlab = (x, z) => slabs.some((s) => x > s.x0 && x < s.x1 && z > s.z0 && z < s.z1);
  const groundY = (x, z) => (inSlab(x, z) ? BASE_Y : 0.03);

  // ----------------------------------------------------------------- bridges
  const deckMat = new THREE.MeshStandardMaterial({ color: 0x8b8e93, roughness: 0.9 }), steel = new THREE.MeshStandardMaterial({ color: 0xb9bec5, roughness: 0.35, metalness: 0.9 });
  const pierGeo = new THREE.CylinderGeometry(1.2, 1.7, 6, 12);
  for (const b of BRIDGES) {
    const len = Math.abs(b.to - b.from) + 8, mid = (b.from + b.to) / 2, X = b.axis === 'x';
    const dims = (l, h, w) => (X ? [l, h, w] : [w, h, l]), at = (a, y, p) => (X ? [a, y, p + b.c] : [p + b.c, y, a]);
    const add = (d, m, p, sh = true) => { const o = box(...d, m, ...p); o.castShadow = sh; return o; };
    add(dims(len, 0.9, BRIDGE_HALF * 2), deckMat, at(mid, 0.03 - 0.45, 0));
    for (const s of [-1, 1]) {
      add(dims(len, 0.9, 0.45), deckMat, at(mid, 0.55, s * (BRIDGE_HALF - 0.22)));
      add(dims(len, 0.1, 0.16), steel, at(mid, 1.25, s * (BRIDGE_HALF - 0.22)));
      for (let a = Math.min(b.from, b.to) + 4; a < Math.max(b.from, b.to); a += 6) add(dims(0.1, 0.8, 0.1), steel, at(a, 0.9, s * (BRIDGE_HALF - 0.22)), false);
    }
    for (let a = Math.min(b.from, b.to) + 10; a < Math.max(b.from, b.to); a += 30) {
      for (const s of [-1, 1]) { const p = new THREE.Mesh(pierGeo, deckMat); p.position.set(...at(a, -3.4, s * 5.5)); p.castShadow = true; scene.add(p); }
      add(dims(2.6, 1.0, BRIDGE_HALF * 1.6), deckMat, at(a, -0.9, 0));
    }
  }

  // ----------------------------------------------------- buildings + props
  const ctx = { ISLANDS, STATION_BLOCK, R, colliders, buildings, edges, onBridge, onLand, inSlab, distToRoads };
  const station = buildBuildings(scene, ctx);
  buildProps(scene, ctx);

  // ---------------------------------------------------------------- per frame
  let lx = null, lz = null, t = 0;
  function update(dt, focus) {
    t += dt; env.update(dt, focus);
    ocean.position.x = focus.x; ocean.position.z = focus.z;
    const n = waterMat.userData.normalMap; n.offset.x += dt * 0.004; n.offset.y += dt * 0.0025;
    if (lx !== null) { n.offset.x += (focus.x - lx) * 220 / 6000; n.offset.y -= (focus.z - lz) * 220 / 6000; }
    lx = focus.x; lz = focus.z;
    foam.opacity = 0.38 + Math.sin(t * 1.3) * 0.15;
    for (const c of clouds) {
      c.position.x += dt * 4;
      if (c.position.x - focus.x > 1300) c.position.x -= 2600; if (c.position.x - focus.x < -1300) c.position.x += 2600;
      if (c.position.z - focus.z > 1300) c.position.z -= 2600; if (c.position.z - focus.z < -1300) c.position.z += 2600;
    }
  }
  function setGraphics(level) {
    env.sun.castShadow = level !== 'low';
    const s = level === 'high' ? 2048 : 1024; env.sun.shadow.mapSize.set(s, s);
    if (env.sun.shadow.map) { env.sun.shadow.map.dispose(); env.sun.shadow.map = null; }
    scene.fog.far = level === 'low' ? 600 : level === 'medium' ? 900 : 1200; scene.fog.near = scene.fog.far * 0.22;
    clouds.forEach((c, i) => { c.visible = level === 'low' ? i % 3 === 0 : true; });
  }

  return { islands: ISLANDS, bridges: BRIDGES, colliders, nodes: [...nodes.values()], edges, roadPoints, buildings, station,
    isBlocked, onLand, onBridge, update, setGraphics, distToRoads, env, groundY, inSlab };
}
