// world.js - Blacktop City: islands, roads, bridges, streetlights, ocean, beaches, cloudy sky.
import * as THREE from 'three';

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
const SAND = 25;           // beach width beyond the city slab
const BRIDGE_HALF = 9;     // half width of bridge deck
const STATION_BLOCK = { x0: 0, x1: 80, z0: 0, z1: 80 };

function rng(seed) {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; }
  return t;
}

export function buildWorld(scene) {
  const R = rng(1337);
  const colliders = [];
  const nodes = new Map();
  const edges = [];
  const roadPoints = [];
  const buildings = [];   // for the map

  // ------------------------------------------------------------- road graph
  const node = (x, z) => {
    const k = x + ',' + z;
    if (!nodes.has(k)) nodes.set(k, { x, z, adj: [] });
    return nodes.get(k);
  };
  const link = (a, b, bridge) => {
    const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz);
    const e = { a, b, len, dx: dx / len, dz: dz / len, bridge: !!bridge };
    edges.push(e);
    a.adj.push({ to: b, edge: e }); b.adj.push({ to: a, edge: e });
  };
  for (const isl of ISLANDS) {
    for (const x of isl.xs) for (const z of isl.zs) node(x, z);
    for (let i = 0; i < isl.xs.length; i++) for (let j = 0; j < isl.zs.length; j++) {
      if (i + 1 < isl.xs.length) link(node(isl.xs[i], isl.zs[j]), node(isl.xs[i + 1], isl.zs[j]));
      if (j + 1 < isl.zs.length) link(node(isl.xs[i], isl.zs[j]), node(isl.xs[i], isl.zs[j + 1]));
    }
  }
  for (const b of BRIDGES) link(node(b.a[0], b.a[1]), node(b.b[0], b.b[1]), true);
  for (const e of edges) for (let t = 0; t <= e.len; t += 20)
    roadPoints.push({ x: e.a.x + e.dx * t, y: 0, z: e.a.z + e.dz * t });

  function distToRoads(x, z) {
    let best = 1e9;
    for (const e of edges) {
      const t = Math.max(0, Math.min(e.len, (x - e.a.x) * e.dx + (z - e.a.z) * e.dz));
      best = Math.min(best, Math.hypot(x - (e.a.x + e.dx * t), z - (e.a.z + e.dz * t)));
    }
    return best;
  }

  // -------------------------------------------------------- land / water test
  function onLand(x, z, r = 0) {
    for (const i of ISLANDS)
      if (Math.abs(x - i.cx) < i.hw + SAND - 1 - r && Math.abs(z - i.cz) < i.hd + SAND - 1 - r) return true;
    return false;
  }
  function onBridge(x, z, r = 0) {
    for (const b of BRIDGES) {
      const along = b.axis === 'x' ? x : z, perp = b.axis === 'x' ? z - b.c : x - b.c;
      if (Math.abs(perp) < BRIDGE_HALF - r && along > Math.min(b.from, b.to) - 4 && along < Math.max(b.from, b.to) + 4) return true;
    }
    return false;
  }
  const isBlocked = (x, z, r = 0) => !(onLand(x, z, r) || onBridge(x, z, r));

  // ------------------------------------------------------- sky, fog, lights
  const fog = new THREE.Fog(0xbcc6cf, 200, 1000);
  scene.fog = fog;
  scene.background = new THREE.Color(0xbcc6cf);
  const skyTex = canvasTex(8, 256, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#5f7288'); gr.addColorStop(0.55, '#a9b6c3'); gr.addColorStop(1, '#d3d9df');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1800, 24, 12),
    new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false, depthWrite: false }));
  dome.renderOrder = -10; scene.add(dome);

  const cloudTex = canvasTex(256, 128, (g, w, h) => {
    for (let i = 0; i < 14; i++) {
      const x = 40 + Math.random() * (w - 80), y = 40 + Math.random() * (h - 70), r = 25 + Math.random() * 30;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(235,238,242,0.55)'); gr.addColorStop(1, 'rgba(235,238,242,0)');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
    }
  });
  const clouds = [];
  for (let i = 0; i < 45; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: cloudTex, fog: false, transparent: true, depthWrite: false, opacity: 0.85 }));
    const w = 220 + Math.random() * 260; s.scale.set(w, w * 0.45, 1);
    s.position.set((Math.random() - 0.5) * 2400, 260 + Math.random() * 160, (Math.random() - 0.5) * 2400);
    scene.add(s); clouds.push(s);
  }

  scene.add(new THREE.HemisphereLight(0xdfe6ee, 0x5d6672, 0.95));
  const sun = new THREE.DirectionalLight(0xfff1dc, 0.85);
  sun.position.set(70, 130, 40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera; sc.left = sc.bottom = -110; sc.right = sc.top = 110; sc.near = 10; sc.far = 400;
  sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target);

  // ----------------------------------------------------------------- ocean
  const oceanTex = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#2f6f8f'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 260; i++) {
      g.fillStyle = `rgba(190,225,240,${0.05 + Math.random() * 0.12})`;
      g.fillRect(Math.random() * w, Math.random() * h, 8 + Math.random() * 26, 1 + Math.random() * 2);
    }
  }, true);
  oceanTex.repeat.set(180, 180);
  const ocean = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000),
    new THREE.MeshPhongMaterial({ map: oceanTex, color: 0xffffff, shininess: 80, specular: 0x8899aa }));
  ocean.rotation.x = -Math.PI / 2; ocean.position.y = -0.7; ocean.receiveShadow = true;
  scene.add(ocean);

  // ----------------------------------------------------------------- islands
  const slabMat = new THREE.MeshLambertMaterial({ color: 0x8d9094 });
  const sandMat = new THREE.MeshLambertMaterial({ color: 0xe0cf9c });
  const wetMat = new THREE.MeshLambertMaterial({ color: 0xb8a574 });
  const box = (w, h, d, mat, x, y, z, shadow) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z); m.receiveShadow = true; m.castShadow = !!shadow; scene.add(m); return m;
  };
  for (const i of ISLANDS) {
    box(i.hw * 2 + (SAND + 10) * 2, 2, i.hd * 2 + (SAND + 10) * 2, wetMat, i.cx, -1.25, i.cz);
    box(i.hw * 2 + SAND * 2, 2, i.hd * 2 + SAND * 2, sandMat, i.cx, -1, i.cz);
    box(i.hw * 2, 2, i.hd * 2, slabMat, i.cx, 0.02 - 1, i.cz);
  }

  // ------------------------------------------------------------------- roads
  const roadMat = new THREE.MeshLambertMaterial({ color: 0x2a2c30, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const flat = new THREE.PlaneGeometry(1, 1); flat.rotateX(-Math.PI / 2);
  const roads = new THREE.InstancedMesh(flat, roadMat, edges.length);
  const dashMat = new THREE.MeshBasicMaterial({ color: 0xe8c547, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  const dashList = [];
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), P = new THREE.Vector3();
  edges.forEach((e, i) => {
    const ang = Math.atan2(e.dz, e.dx);
    Q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -ang);
    P.set((e.a.x + e.b.x) / 2, 0.05, (e.a.z + e.b.z) / 2);
    S.set(e.len + ROAD_W, 1, ROAD_W);
    roads.setMatrixAt(i, M.compose(P, Q, S));
    for (let t = 14; t < e.len - 14; t += 8) dashList.push([e.a.x + e.dx * t, e.a.z + e.dz * t, ang]);
  });
  roads.receiveShadow = true; scene.add(roads);
  const dashes = new THREE.InstancedMesh(flat, dashMat, dashList.length);
  dashList.forEach(([x, z, a], i) => {
    Q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a);
    dashes.setMatrixAt(i, M.compose(P.set(x, 0.07, z), Q, S.set(3.5, 1, 0.3)));
  });
  scene.add(dashes);

  // ----------------------------------------------------------------- bridges
  const deckMat = new THREE.MeshLambertMaterial({ color: 0x6f737a });
  const railMat = new THREE.MeshLambertMaterial({ color: 0xaab0b6 });
  const pierGeo = new THREE.CylinderGeometry(1.3, 1.6, 5, 10);
  for (const b of BRIDGES) {
    const len = Math.abs(b.to - b.from) + 8, mid = (b.from + b.to) / 2, X = b.axis === 'x';
    const dims = (l, h, w) => (X ? [l, h, w] : [w, h, l]);
    const at = (along, y, perp) => (X ? [along, y, perp + b.c] : [perp + b.c, y, along]);
    box(...dims(len, 0.8, BRIDGE_HALF * 2), deckMat, ...at(mid, 0.03 - 0.4, 0), true);
    for (const s of [-1, 1]) box(...dims(len, 1.1, 0.3), railMat, ...at(mid, 0.6, s * (BRIDGE_HALF - 0.15)), true);
    for (let a = Math.min(b.from, b.to) + 8; a < Math.max(b.from, b.to); a += 30)
      for (const s of [-1, 1]) {
        const p = new THREE.Mesh(pierGeo, deckMat);
        p.position.set(...at(a, -2.9, s * 6)); p.castShadow = true; scene.add(p);
      }
  }

  // ------------------------------------------------------------- streetlights
  const poleGeo = new THREE.CylinderGeometry(0.1, 0.14, 7, 6); poleGeo.translate(0, 3.5, 0);
  const armGeo = new THREE.BoxGeometry(1.6, 0.18, 0.5); armGeo.translate(0.7, 7, 0);
  const lampPoles = [];
  for (const e of edges) for (const t of [e.len * 0.25, e.len * 0.75]) for (const side of [-1, 1]) {
    if (e.bridge && (t < 20 || t > e.len - 20)) continue;
    const off = e.bridge ? BRIDGE_HALF - 0.6 : 8.5;
    lampPoles.push({ x: e.a.x + e.dx * t - e.dz * off * side, z: e.a.z + e.dz * t + e.dx * off * side,
      ry: Math.atan2(e.dx * side, e.dz * side) });   // arm (+X) points toward the road
  }
  const poles = new THREE.InstancedMesh(poleGeo, new THREE.MeshLambertMaterial({ color: 0x3b3f45 }), lampPoles.length);
  const lamps = new THREE.InstancedMesh(armGeo, new THREE.MeshBasicMaterial({ color: 0xfff0b0 }), lampPoles.length);
  lampPoles.forEach((p, i) => {
    Q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.ry);
    M.compose(P.set(p.x, 0, p.z), Q, S.set(1, 1, 1));
    poles.setMatrixAt(i, M); lamps.setMatrixAt(i, M);
  });
  poles.castShadow = true; scene.add(poles, lamps);

  // --------------------------------------------------------------- buildings
  const winTex = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#c4c6cb'; g.fillRect(0, 0, w, h);
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
      g.fillStyle = Math.random() < 0.22 ? '#ffe7a0' : '#2c3a50';
      g.fillRect(c * 64 + 12, r * 64 + 14, 40, 36);
      g.fillStyle = 'rgba(255,255,255,0.2)'; g.fillRect(c * 64 + 12, r * 64 + 14, 40, 10);
    }
  }, true);
  const tints = [0xffffff, 0xe9d8c0, 0xc9d6e6, 0xd8c9c9, 0xcfe0cf, 0xb7b9c4];
  const sideMats = tints.map(c => new THREE.MeshLambertMaterial({ map: winTex, color: c }));
  const roofMat = new THREE.MeshLambertMaterial({ color: 0x5c5f66 });

  function addBuilding(x0, z0, x1, z1, h, tintIdx, custom) {
    const w = x1 - x0, d = z1 - z0;
    const geo = new THREE.BoxGeometry(w, h, d);
    const uv = geo.attributes.uv;
    for (let f = 0; f < 6; f++) {
      const su = (f < 2 ? d : w) / 16, sv = h / 16;
      for (let v = f * 4; v < f * 4 + 4; v++) uv.setXY(v, uv.getX(v) * su, uv.getY(v) * sv);
    }
    const mats = custom || [sideMats[tintIdx], sideMats[tintIdx], roofMat, roofMat, sideMats[tintIdx], sideMats[tintIdx]];
    const m = new THREE.Mesh(geo, mats);
    m.position.set((x0 + x1) / 2, h / 2, (z0 + z1) / 2);
    m.castShadow = m.receiveShadow = true; scene.add(m);
    colliders.push({ min: { x: x0, z: z0 }, max: { x: x1, z: z1 } });
    buildings.push({ x0, z0, x1, z1, h });
    return m;
  }

  let station = { x: 40, z: 70 };
  for (const isl of ISLANDS) {
    for (let i = 0; i + 1 < isl.xs.length; i++) for (let j = 0; j + 1 < isl.zs.length; j++) {
      const bx0 = isl.xs[i] + 13, bx1 = isl.xs[i + 1] - 13, bz0 = isl.zs[j] + 13, bz1 = isl.zs[j + 1] - 13;
      const isStation = isl === ISLANDS[0] && isl.xs[i] === STATION_BLOCK.x0 && isl.zs[j] === STATION_BLOCK.z0;
      if (isStation) {
        const blue = new THREE.MeshLambertMaterial({ color: 0x2f4f9c });
        const white = new THREE.MeshLambertMaterial({ color: 0xf0f0f0 });
        const m = addBuilding(bx0 + 6, bz0 + 6, bx1 - 6, bz1 - 6, 14, 0, [blue, blue, white, white, blue, blue]);
        const red = new THREE.Mesh(new THREE.BoxGeometry(3, 1, 3), new THREE.MeshBasicMaterial({ color: 0xff2030 }));
        const blu = new THREE.Mesh(new THREE.BoxGeometry(3, 1, 3), new THREE.MeshBasicMaterial({ color: 0x2a60ff }));
        red.position.set(m.position.x - 3, 14.5, m.position.z); blu.position.set(m.position.x + 3, 14.5, m.position.z);
        scene.add(red, blu);
        station = { x: (bx0 + bx1) / 2, z: bz1 + 3 };
        continue;
      }
      const cx = isl.cx, cz = isl.cz;
      const dist = Math.hypot((bx0 + bx1) / 2 - 0, (bz0 + bz1) / 2 - 0);
      const hMax = isl === ISLANDS[0] ? Math.max(22, 75 - dist * 0.18) : 30;
      const split = R() < 0.4 ? 1 : 2;
      const lw = (bx1 - bx0 - (split - 1) * 4) / split, ld = (bz1 - bz0 - (split - 1) * 4) / split;
      for (let a = 0; a < split; a++) for (let b = 0; b < split; b++) {
        const x0 = bx0 + a * (lw + 4) + 1, z0 = bz0 + b * (ld + 4) + 1;
        addBuilding(x0, z0, x0 + lw - 2, z0 + ld - 2, 8 + R() * (hMax - 8), (R() * tints.length) | 0);
      }
    }
  }

  // ------------------------------------------------------------------- palms
  const trunkGeo = new THREE.CylinderGeometry(0.18, 0.28, 5, 6); trunkGeo.translate(0, 2.5, 0);
  const crownGeo = new THREE.SphereGeometry(1.6, 8, 5); crownGeo.scale(1.6, 0.55, 1.6); crownGeo.translate(0, 5.3, 0);
  const palmSpots = [];
  for (const isl of ISLANDS) {
    for (let tries = 0, n = 0; tries < 800 && n < 34; tries++) {
      const x = isl.cx + (R() * 2 - 1) * (isl.hw + SAND - 3), z = isl.cz + (R() * 2 - 1) * (isl.hd + SAND - 3);
      const inSlab = Math.abs(x - isl.cx) < isl.hw && Math.abs(z - isl.cz) < isl.hd;
      if (inSlab && (distToRoads(x, z) < 16 || colliders.some(c => x > c.min.x - 3 && x < c.max.x + 3 && z > c.min.z - 3 && z < c.max.z + 3))) continue;
      if (onBridge(x, z, -14)) continue;
      palmSpots.push([x, z]); n++;
    }
  }
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial({ color: 0x7a5a3a }), palmSpots.length);
  const crowns = new THREE.InstancedMesh(crownGeo, new THREE.MeshLambertMaterial({ color: 0x3f8a4a }), palmSpots.length);
  palmSpots.forEach(([x, z], i) => {
    const sc = 0.8 + R() * 0.6;
    Q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), R() * 6);
    M.compose(P.set(x, 0.02, z), Q, S.set(sc, sc, sc));
    trunks.setMatrixAt(i, M); crowns.setMatrixAt(i, M);
  });
  trunks.castShadow = crowns.castShadow = true; scene.add(trunks, crowns);

  // ---------------------------------------------------------------- per frame
  function update(dt, focus) {
    oceanTex.offset.x += dt * 0.0015; oceanTex.offset.y += dt * 0.0008;
    dome.position.copy(focus);
    ocean.position.x = focus.x; ocean.position.z = focus.z;
    oceanTex.offset.x += (focus.x - (update.lx ?? focus.x)) / 6000 * 180;
    oceanTex.offset.y -= (focus.z - (update.lz ?? focus.z)) / 6000 * 180;
    update.lx = focus.x; update.lz = focus.z;
    for (const c of clouds) {
      c.position.x += dt * 4;
      if (c.position.x - focus.x > 1300) c.position.x -= 2600;
      if (c.position.x - focus.x < -1300) c.position.x += 2600;
      if (c.position.z - focus.z > 1300) c.position.z -= 2600;
      if (c.position.z - focus.z < -1300) c.position.z += 2600;
    }
    sun.target.position.set(focus.x, 0, focus.z);
    sun.position.set(focus.x + 70, 130, focus.z + 40);
  }

  function setGraphics(level) {
    sun.castShadow = level !== 'low';
    sun.shadow.mapSize.set(level === 'high' ? 2048 : 1024, level === 'high' ? 2048 : 1024);
    if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    fog.far = level === 'low' ? 500 : level === 'medium' ? 800 : 1100;
    fog.near = fog.far * 0.2;
    clouds.forEach((c, i) => { c.visible = level === 'low' ? i % 3 === 0 : true; });
  }

  return { islands: ISLANDS, bridges: BRIDGES, colliders, nodes: [...nodes.values()], edges, roadPoints, buildings, station,
    isBlocked, onLand, onBridge, update, setGraphics, distToRoads };
}
