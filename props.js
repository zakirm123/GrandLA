// props.js - Update 1.2: streetlights with night glow, trees, palms, benches, bins and hydrants.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { glowTexture, nightEmissive, nightOpacity } from './gfx.js';
import { BASE_Y } from './buildings.js';

const NI = (g) => (g.index ? g.toNonIndexed() : g);
const bx = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
const vcol = (g, c) => {
  g = NI(g); const col = new THREE.Color(c), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = col.r; a[i * 3 + 1] = col.g; a[i * 3 + 2] = col.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g;
};
const Q = new THREE.Quaternion(), M = new THREE.Matrix4(), P = new THREE.Vector3(), S = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);

function place(mesh, list) {
  list.forEach((p, i) => { Q.setFromAxisAngle(UP, p.ry || 0); mesh.setMatrixAt(i, M.compose(P.set(p.x, p.y, p.z), Q, S.set(p.s || 1, p.s || 1, p.s || 1))); });
  mesh.instanceMatrix.needsUpdate = true; mesh.count = list.length;
}

function treeGeometry() {
  const parts = [vcol(new THREE.CylinderGeometry(0.16, 0.26, 3.2, 7).translate(0, 1.6, 0), 0x5b4130)];
  const greens = [0x3d7a3a, 0x4a8c3f, 0x336b34, 0x58954a];
  [[0, 4.2, 0, 2.1], [1.0, 3.7, 0.4, 1.5], [-0.9, 3.9, -0.4, 1.6], [0.2, 5.2, -0.5, 1.4], [-0.3, 3.5, 1.0, 1.3]].forEach(([x, y, z, r], i) =>
    parts.push(vcol(new THREE.IcosahedronGeometry(r, 1).translate(x, y, z), greens[i % greens.length])));
  return mergeGeometries(parts);
}

function palmGeometry() {
  const parts = []; let x = 0, y = 0, tilt = 0;
  for (let i = 0; i < 6; i++) {
    const h = 1.0, g = new THREE.CylinderGeometry(0.15 - i * 0.012, 0.19 - i * 0.012, h, 7).translate(0, h / 2, 0);
    g.rotateZ(-tilt); g.translate(x, y, 0); parts.push(vcol(g, i % 2 ? 0x8a6b48 : 0x7d5f3e));
    x += Math.sin(tilt) * h; y += Math.cos(tilt) * h; tilt += 0.05;
  }
  for (let k = 0; k < 9; k++) {
    const f = new THREE.PlaneGeometry(0.75, 3.4, 1, 5), pos = f.attributes.position;
    for (let v = 0; v < pos.count; v++) { const t = (pos.getY(v) + 1.7) / 3.4; pos.setZ(v, -t * t * 1.5); pos.setX(v, pos.getX(v) * (1 - t * 0.7)); pos.setY(v, t * 3.4); }
    f.computeVertexNormals(); f.rotateX(-1.0 + (k % 2) * 0.35); f.rotateY(k * Math.PI * 2 / 9); f.translate(x, y, 0);
    parts.push(vcol(f, k % 2 ? 0x3f8a46 : 0x2f7a3c));
  }
  return mergeGeometries(parts);
}

export function buildProps(scene, ctx) {
  const { edges, ISLANDS, R, colliders, onBridge, onLand, inSlab, distToRoads } = ctx;
  const out = {};

  // ----------------------------------------------------------- streetlights
  const lamps = [];
  for (const e of edges) for (const t of [e.len * 0.25, e.len * 0.75]) for (const side of [-1, 1]) {
    if (e.bridge && (t < 22 || t > e.len - 22)) continue;
    const off = e.bridge ? 8.4 : 8.5;
    lamps.push({ x: e.a.x + e.dx * t - e.dz * off * side, z: e.a.z + e.dz * t + e.dx * off * side, y: e.bridge && t > 24 && t < e.len - 24 ? 0.04 : BASE_Y,
      ry: Math.atan2(e.dx * side, e.dz * side) });
  }
  const poleGeo = mergeGeometries([NI(new THREE.CylinderGeometry(0.09, 0.14, 7.2, 8).translate(0, 3.6, 0)), NI(bx(1.8, 0.12, 0.14, 0.9, 7.1, 0)), NI(bx(0.9, 0.18, 0.42, 1.7, 7.05, 0)),
    NI(new THREE.CylinderGeometry(0.2, 0.2, 0.5, 8).translate(0, 0.25, 0))]);
  const poles = new THREE.InstancedMesh(poleGeo, new THREE.MeshStandardMaterial({ color: 0x30343a, roughness: 0.5, metalness: 0.7 }), lamps.length);
  const bulbMat = nightEmissive(new THREE.MeshStandardMaterial({ color: 0xfff1c4, emissive: 0xffe6a8, emissiveIntensity: 0 }), 5);
  const bulbs = new THREE.InstancedMesh(bx(0.7, 0.05, 0.34, 1.7, 6.93, 0), bulbMat, lamps.length);
  const pools = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    nightOpacity(new THREE.MeshBasicMaterial({ map: glowTexture(), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }), 0.8), lamps.length);
  place(poles, lamps); place(bulbs, lamps);
  lamps.forEach((l, i) => {
    Q.identity(); M.compose(P.set(l.x + Math.cos(l.ry) * 1.7,l.y + (l.y > 0.1 ? 0.03 : 0.04), l.z - Math.sin(l.ry) * 1.7), Q, S.set(15, 1, 15));
    pools.setMatrixAt(i, M);
  });
  poles.castShadow = true; pools.renderOrder = 1; scene.add(poles, bulbs, pools);

  // ------------------------------------------------------ sidewalk furniture
  const sidewalkEdges = edges.filter((e) => !e.bridge);
  const along = (n, off, margin) => {
    const l = [];
    for (let i = 0; i < n; i++) {
      const e = sidewalkEdges[(R() * sidewalkEdges.length) | 0], t = margin + R() * (e.len - margin * 2), side = R() < 0.5 ? -1 : 1;
      l.push({ x: e.a.x + e.dx * t - e.dz * off * side, z: e.a.z + e.dz * t + e.dx * off * side, y: BASE_Y, ry: Math.atan2(e.dz * side, -e.dx * side), s: 1 });
    }
    return l;
  };
  const benchGeo = mergeGeometries([vcol(bx(1.7, 0.07, 0.45, 0, 0.47, 0), 0x8a5a33), vcol(bx(1.7, 0.45, 0.06, 0, 0.78, -0.22), 0x8a5a33), vcol(bx(0.08, 0.47, 0.45, -0.75, 0.235, 0), 0x2b2d31), vcol(bx(0.08, 0.47, 0.45, 0.75, 0.235, 0), 0x2b2d31)]);
  const benches = new THREE.InstancedMesh(benchGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 }), 40);
  place(benches, along(40, 11.7, 20)); benches.castShadow = true;
  const bins = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.26, 0.23, 0.95, 10).translate(0, 0.475, 0), new THREE.MeshStandardMaterial({ color: 0x2f4a3a, roughness: 0.6, metalness: 0.3 }), 60);
  place(bins, along(60, 7.9, 14)); bins.castShadow = true;
  const hydrant = mergeGeometries([vcol(new THREE.CylinderGeometry(0.13, 0.15, 0.6, 8).translate(0, 0.3, 0), 0xc4261f), vcol(new THREE.SphereGeometry(0.14, 8, 6).translate(0, 0.65, 0), 0xc4261f), vcol(bx(0.4, 0.1, 0.1, 0, 0.42, 0), 0xc4261f)]);
  const hydrants = new THREE.InstancedMesh(hydrant, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.4 }), 40);
  place(hydrants, along(40, 7.6, 24)); hydrants.castShadow = true;
  scene.add(benches, bins, hydrants);

  // ----------------------------------------------------------- trees & palms
  const treeSpots = [], palmSpots = [];
  for (const isl of ISLANDS) {
    for (let tries = 0, n = 0; tries < 1200 && n < 24; tries++) {
      const x = isl.cx + (R() * 2 - 1) * (isl.hw - 3), z = isl.cz + (R() * 2 - 1) * (isl.hd - 3);
      if (!inSlab(x, z) || distToRoads(x, z) < 14 || colliders.some((c) => x > c.min.x - 3 && x < c.max.x + 3 && z > c.min.z - 3 && z < c.max.z + 3)) continue;
      treeSpots.push({ x, y: BASE_Y, z, ry: R() * 6.28, s: 0.8 + R() * 0.7 }); n++;
    }
    for (let tries = 0, n = 0; tries < 800 && n < 30; tries++) {
      const x = isl.cx + (R() * 2 - 1) * (isl.hw + 22), z = isl.cz + (R() * 2 - 1) * (isl.hd + 22);
      if (Math.abs(x - isl.cx) < isl.hw + 3 && Math.abs(z - isl.cz) < isl.hd + 3) continue;
      if (onBridge(x, z, -14) || !onLand(x, z, 2)) continue;
      palmSpots.push({ x, y: 0, z, ry: R() * 6.28, s: 0.85 + R() * 0.55 }); n++;
    }
  }
  const trees = new THREE.InstancedMesh(treeGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }), treeSpots.length);
  const palms = new THREE.InstancedMesh(palmGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide }), palmSpots.length);
  place(trees, treeSpots); place(palms, palmSpots); trees.castShadow = palms.castShadow = true; scene.add(trees, palms);
  out.lamps = lamps.length;
  return out;
}
