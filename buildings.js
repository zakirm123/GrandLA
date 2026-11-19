// buildings.js - Update 1.2: detailed city buildings (podium shop fronts, PBR facades with lit windows at night,
// cornices, setback towers, rooftops with AC units / tanks / antennas) and the police station.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { facadeMaterial, canvasTex, nightEmissive } from './gfx.js';

export const BASE_Y = 0.17;
const PODIUM = 4;                      // podium (shop floor) height, one storey
const NI = (g) => (g.index ? g.toNonIndexed() : g);
const bx = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);

let roofMat = null;
const roofMaterial = () => (roofMat ??= new THREE.MeshStandardMaterial({ color: 0x777a7f, roughness: 0.85, metalness: 0.1 }));

// A box whose side faces tile a facade texture in whole modules (16 m x 16 m) so windows line up with floors.
function facadeBox(w, h, d, side, top, modU = 16, modV = 16) {
  const g = new THREE.BoxGeometry(w, h, d), uv = g.attributes.uv;
  const faces = [[d, h], [d, h], [1, 1], [1, 1], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let v = f * 4; v < f * 4 + 4; v++) {
    const su = f === 2 || f === 3 ? 1 : faces[f][0] / modU, sv = f === 2 || f === 3 ? 1 : faces[f][1] / modV;
    uv.setXY(v, uv.getX(v) * su, uv.getY(v) * sv);
  }
  const m = new THREE.Mesh(g, [side, side, top, top, side, side]);
  m.castShadow = m.receiveShadow = true; return m;
}

function roofParts(x0, z0, x1, z1, y, R, tall) {
  const w = x1 - x0, d = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, P = [];
  P.push(bx(w, 0.8, 0.3, cx, y + 0.4, z0 + 0.15), bx(w, 0.8, 0.3, cx, y + 0.4, z1 - 0.15), bx(0.3, 0.8, d, x0 + 0.15, y + 0.4, cz), bx(0.3, 0.8, d, x1 - 0.15, y + 0.4, cz));
  const n = 1 + ((R() * 3) | 0);
  for (let i = 0; i < n; i++) {
    const px = x0 + 2.5 + R() * Math.max(0.1, w - 5), pz = z0 + 2.5 + R() * Math.max(0.1, d - 5);
    P.push(bx(2.2, 1.3, 1.6, px, y + 0.65, pz), new THREE.CylinderGeometry(0.45, 0.45, 0.15, 10).translate(px - 0.4, y + 1.38, pz));
  }
  P.push(bx(3, 2.4, 3, cx + (R() - 0.5) * w * 0.4, y + 1.2, cz + (R() - 0.5) * d * 0.4));
  if (R() < 0.5) {
    const tx = x0 + 3 + R() * Math.max(0.1, w - 6), tz = z0 + 3 + R() * Math.max(0.1, d - 6);
    P.push(new THREE.CylinderGeometry(1.2, 1.2, 2.4, 12).translate(tx, y + 3.4, tz), new THREE.ConeGeometry(1.3, 0.7, 12).translate(tx, y + 4.95, tz));
    for (const [a, b] of [[-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8]]) P.push(bx(0.12, 2.2, 0.12, tx + a, y + 1.1, tz + b));
  }
  if (tall) P.push(new THREE.CylinderGeometry(0.07, 0.1, 8, 6).translate(cx, y + 4, cz), bx(0.6, 0.6, 0.6, cx, y + 8, cz));
  const m = new THREE.Mesh(mergeGeometries(P.map(NI)), roofMaterial()); m.castShadow = true; m.receiveShadow = true; return m;
}

const STYLE_TINTS = {
  glass: [0xffffff, 0xd6e6f4, 0xc7e0dd], office: [0xffffff, 0xeae2d2, 0xd8dde6], brick: [0xffffff, 0xe8cbb9, 0xd9b9a2],
  stone: [0xffffff, 0xf2e9d6], concrete: [0xffffff, 0xe2e2de, 0xd5d8dc],
};
const styleFor = (h, R) => {
  const p = (a) => a[(R() * a.length) | 0];
  return h > 46 ? p(['glass', 'glass', 'office']) : h > 24 ? p(['office', 'stone', 'concrete', 'glass']) : p(['brick', 'brick', 'concrete', 'stone']);
};

export function buildBuildings(scene, ctx) {
  const { ISLANDS, STATION_BLOCK, R, colliders, buildings } = ctx;
  const shop = [0xffffff, 0xffe9cf, 0xdfeaff].map((t) => facadeMaterial('shop', t));
  const concrete = roofMaterial();
  let station = { x: 40, z: 70 };

  function addBuilding(x0, z0, x1, z1, hRaw) {
    const w = x1 - x0, d = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const h = Math.max(8, Math.round(hRaw / 4) * 4), style = styleFor(h, R);
    const tint = STYLE_TINTS[style][(R() * STYLE_TINTS[style].length) | 0], mat = facadeMaterial(style, tint);
    const group = new THREE.Group(); group.position.set(cx, BASE_Y, cz);
    const parts = [];
    let y = 0;
    if (h > 8) {                                                // shop-front podium + cornice
      const p = facadeBox(w, PODIUM, d, shop[(R() * shop.length) | 0], concrete, 8, PODIUM);
      p.position.y = PODIUM / 2; group.add(p); y = PODIUM; parts.push(bx(w + 0.8, 0.3, d + 0.8, 0, y + 0.15, 0)); y += 0.0;
    }
    let top = y, rx0 = x0, rz0 = z0, rx1 = x1, rz1 = z1;
    const tall = h >= 44, h1 = tall ? Math.max(PODIUM + 8, Math.round(h * 0.62 / 4) * 4) : h;
    const t1 = facadeBox(w, h1 - y, d, mat, concrete); t1.position.y = y + (h1 - y) / 2; group.add(t1); top = h1;
    if (tall) {                                                 // setback upper tier
      const inset = Math.min(w, d) * 0.15, uw = w - inset * 2, ud = d - inset * 2, uh = h - h1;
      parts.push(bx(w + 0.5, 0.3, d + 0.5, 0, h1 + 0.15, 0));
      const t2 = facadeBox(uw, uh, ud, mat, concrete); t2.position.y = h1 + uh / 2; group.add(t2);
      rx0 = x0 + inset; rx1 = x1 - inset; rz0 = z0 + inset; rz1 = z1 - inset; top = h;
    } else if (h > 8) parts.push(bx(w + 0.5, 0.35, d + 0.5, 0, h - 0.17, 0));
    if (parts.length) { const c = new THREE.Mesh(mergeGeometries(parts.map(NI)), concrete); c.castShadow = c.receiveShadow = true; group.add(c); }
    const rp = roofParts(rx0 - cx, rz0 - cz, rx1 - cx, rz1 - cz, top, R, tall); group.add(rp);
    scene.add(group);
    colliders.push({ min: { x: x0, z: z0 }, max: { x: x1, z: z1 } });
    buildings.push({ x0, z0, x1, z1, h: top + 1 });
  }

  function addStation(x0, z0, x1, z1) {
    const w = x1 - x0, d = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, g = new THREE.Group(); g.position.set(cx, BASE_Y, cz);
    const wall = new THREE.MeshStandardMaterial({ color: 0xd9dee8, roughness: 0.8 }), blue = new THREE.MeshStandardMaterial({ color: 0x254a9a, roughness: 0.6, metalness: 0.2 });
    const glass = new THREE.MeshPhysicalMaterial({ color: 0x1a2a3c, metalness: 0.9, roughness: 0.06 });
    const add = (geo, m, x, y, z) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; g.add(o); return o; };
    add(new THREE.BoxGeometry(w, 14, d), wall, 0, 7, 0);
    add(new THREE.BoxGeometry(w + 0.6, 1.6, d + 0.6), blue, 0, 13.2, 0);
    add(new THREE.BoxGeometry(w + 1, 0.4, d + 1), blue, 0, 14.2, 0);
    for (let r = 0; r < 2; r++) for (let c = 0; c < 5; c++) add(new THREE.BoxGeometry(3.2, 3.4, 0.2), glass, -w / 2 + 5 + c * ((w - 10) / 4), 4.6 + r * 4.8, d / 2 + 0.02);
    add(new THREE.BoxGeometry(8, 0.4, 4), blue, 0, 3.6, d / 2 + 2);
    for (const s of [-1, 1]) add(new THREE.CylinderGeometry(0.2, 0.2, 3.6, 8), wall, s * 3.6, 1.8, d / 2 + 3.6);
    const signTex = canvasTex(512, 128, (c) => { c.fillStyle = '#254a9a'; c.fillRect(0, 0, 512, 128); c.fillStyle = '#fff'; c.font = 'bold 84px Arial'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('POLICE', 256, 70); }, { repeat: false });
    const signMat = new THREE.MeshStandardMaterial({ map: signTex, emissiveMap: signTex, emissive: 0xffffff, emissiveIntensity: 0 }); nightEmissive(signMat, 1.2);
    add(new THREE.PlaneGeometry(10, 2.5), signMat, 0, 10.6, d / 2 + 0.05);
    const red = new THREE.MeshStandardMaterial({ color: 0xff2030, emissive: 0xff2030, emissiveIntensity: 2.5 }), blu = new THREE.MeshStandardMaterial({ color: 0x2a60ff, emissive: 0x2a60ff, emissiveIntensity: 2.5 });
    add(new THREE.BoxGeometry(2.4, 0.9, 2.4), red, -3, 14.85, 0); add(new THREE.BoxGeometry(2.4, 0.9, 2.4), blu, 3, 14.85, 0);
    scene.add(g);
    colliders.push({ min: { x: x0, z: z0 }, max: { x: x1, z: z1 } }); buildings.push({ x0, z0, x1, z1, h: 15 });
  }

  for (const isl of ISLANDS) {
    for (let i = 0; i + 1 < isl.xs.length; i++) for (let j = 0; j + 1 < isl.zs.length; j++) {
      const bx0 = isl.xs[i] + 13, bx1 = isl.xs[i + 1] - 13, bz0 = isl.zs[j] + 13, bz1 = isl.zs[j + 1] - 13;
      if (isl === ISLANDS[0] && isl.xs[i] === STATION_BLOCK.x0 && isl.zs[j] === STATION_BLOCK.z0) {
        addStation(bx0 + 6, bz0 + 6, bx1 - 6, bz1 - 6); station = { x: (bx0 + bx1) / 2, z: bz1 + 3 }; continue;
      }
      const dist = Math.hypot((bx0 + bx1) / 2, (bz0 + bz1) / 2);
      const hMax = isl === ISLANDS[0] ? Math.max(24, 84 - dist * 0.2) : 32;
      const split = R() < 0.4 ? 1 : 2;
      const lw = (bx1 - bx0 - (split - 1) * 4) / split, ld = (bz1 - bz0 - (split - 1) * 4) / split;
      for (let a = 0; a < split; a++) for (let b = 0; b < split; b++) {
        const x0 = bx0 + a * (lw + 4) + 1, z0 = bz0 + b * (ld + 4) + 1;
        addBuilding(x0, z0, x0 + lw - 2, z0 + ld - 2, 8 + R() * (hMax - 8));
      }
    }
  }
  return station;
}
