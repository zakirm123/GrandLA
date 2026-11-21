// interior.js - Update 1.3: walk-in interiors for every building type (shop, diner, office, apartment, bank,
// hotel, gym, police station) plus Luna's house. Interiors are built lazily, far from the city, and the game
// hides the outside world while the player is inside (see main.js).
import * as THREE from 'three';
import { canvasTex, nightEmissive } from './gfx.js';
import { makeHuman, makeLuna, animateHuman } from './models.js';

const pick = (a) => a[(Math.random() * a.length) | 0];
const matCache = new Map();
const M = (c, r = 0.7, m = 0, extra = {}) => { const k = [c, r, m, JSON.stringify(extra)].join('|'); if (!matCache.has(k)) matCache.set(k, new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m, ...extra })); return matCache.get(k); };
const glow = (c, i = 1.5) => M(c, 0.4, 0, { emissive: c, emissiveIntensity: i });
const box = (w, h, d, m, x = 0, y = h / 2, z = 0) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; return o; };
const cyl = (r, h, m, x = 0, y = h / 2, z = 0, seg = 14) => { const o = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), m); o.position.set(x, y, z); o.castShadow = true; return o; };

const tiled = (draw, w, d, per = 2, size = 256) => {
  const t = canvasTex(size, size, draw); t.repeat.set(w / per, d / per);
  return new THREE.MeshStandardMaterial({ map: t, roughness: 0.6 });
};
const FLOORS = {
  wood: () => (draw) => draw((g, s) => { g.fillStyle = '#8a5a35'; g.fillRect(0, 0, s, s); for (let i = 0; i < 8; i++) { g.fillStyle = `hsl(${24 + Math.random() * 8},${40 + Math.random() * 15}%,${28 + Math.random() * 12}%)`; g.fillRect(0, i * s / 8 + 1, s, s / 8 - 2); } for (let i = 0; i < 40; i++) { g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(Math.random() * s, Math.floor(Math.random() * 8) * s / 8, 1.5, s / 8); } }),
  tile: () => (draw) => draw((g, s) => { for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { g.fillStyle = (x + y) % 2 ? '#e9e6dd' : '#2c2e33'; g.fillRect(x * s / 4, y * s / 4, s / 4, s / 4); } }),
  carpet: (c) => (draw) => draw((g, s) => { g.fillStyle = c; g.fillRect(0, 0, s, s); for (let i = 0; i < 6000; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.06})`; g.fillRect(Math.random() * s, Math.random() * s, 2, 2); g.fillStyle = `rgba(0,0,0,${Math.random() * 0.08})`; g.fillRect(Math.random() * s, Math.random() * s, 2, 2); } }),
  marble: () => (draw) => draw((g, s) => { g.fillStyle = '#d8d5cf'; g.fillRect(0, 0, s, s); g.strokeStyle = 'rgba(90,90,100,0.25)'; for (let i = 0; i < 14; i++) { g.beginPath(); g.moveTo(Math.random() * s, 0); g.bezierCurveTo(Math.random() * s, s * 0.3, Math.random() * s, s * 0.6, Math.random() * s, s); g.stroke(); } g.strokeStyle = 'rgba(40,40,40,0.5)'; g.strokeRect(0, 0, s, s); }),
  rubber: () => (draw) => draw((g, s) => { g.fillStyle = '#26282c'; g.fillRect(0, 0, s, s); for (let i = 0; i < 3000; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.07})`; g.fillRect(Math.random() * s, Math.random() * s, 2, 2); } }),
};
const floorMat = (type, w, d, c) => tiled((g, W) => FLOORS[type](c)((fn) => fn(g, W)), w, d);

const KINDS = {
  shop:      { w: 26, d: 18, wall: 0xe8e2d4, floor: 'tile', light: 0xfff2dd },
  diner:     { w: 26, d: 16, wall: 0xcfe3df, floor: 'tile', light: 0xffe6c4 },
  office:    { w: 30, d: 20, wall: 0xdcdfe4, floor: 'carpet', fc: '#4a5668', light: 0xeef4ff },
  apartment: { w: 24, d: 16, wall: 0xe6d8c4, floor: 'wood', light: 0xffe0b0 },
  bank:      { w: 28, d: 18, wall: 0xdad4c6, floor: 'marble', light: 0xfff0d8 },
  hotel:     { w: 30, d: 20, wall: 0xe5d6c2, floor: 'carpet', fc: '#6a1f2a', light: 0xffe2b5 },
  gym:       { w: 30, d: 18, wall: 0xcfd3da, floor: 'rubber', light: 0xf0f6ff },
  station:   { w: 28, d: 18, wall: 0xcdd6e4, floor: 'tile', light: 0xeaf1ff },
  luna:      { w: 34, d: 24, wall: 0xf1ece6, floor: 'wood', light: 0xffd6ea, height: 4.4 },
};
const LUNA_LINES = [
  "Hey, you. Nobody just walks into Luna's place... but you've got style. Welcome to my house.",
  "Blacktop's loud out there. In here it's music, snacks and zero cops. Make yourself at home.",
  "Ask around the islands - Palm Cove's my favourite. Quietest bridge in the city.",
  "Careful with the heat out there. Five stars and even my sofa won't hide you.",
  "Leave your guns by the door, trouble. ...Kidding. Mostly.",
];
const CLERK_LINES = ["Welcome in. Look around.", "We don't give discounts. Or credit.", "Nice day for it, huh?", "If you're here to cause trouble, the police station is two blocks away."];

let interiorCount = 0;

export function createInteriors(scene) {
  const cache = {};
  function get(kind) { if (!cache[kind]) cache[kind] = build(kind, interiorCount++); return cache[kind]; }

  function build(kind, idx) {
    const K = KINDS[kind] || KINDS.shop, W = K.w, D = K.d, H = K.height || 3.2, OX = 4000 + idx * 80, OZ = 4000;
    const group = new THREE.Group(); group.visible = false; scene.add(group);
    const colliders = [], npcs = [], lights = [], updaters = [];
    const add = (o) => { group.add(o); return o; };
    const at = (o, x, z) => { o.position.x += OX + x; o.position.z += OZ + z; return o; };
    const solid = (x, z, w, d) => colliders.push({ min: { x: OX + x - w / 2, z: OZ + z - d / 2 }, max: { x: OX + x + w / 2, z: OZ + z + d / 2 } });
    const put = (o, x, z, w, d, rotQ = 0, isSolid = true) => {
      const g = new THREE.Group(); g.add(o); g.position.set(OX + x, 0, OZ + z); g.rotation.y = rotQ * Math.PI / 2; group.add(g);
      if (isSolid) solid(x, z, rotQ % 2 ? d : w, rotQ % 2 ? w : d); return g;
    };

    // shell: floor, ceiling, walls
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D).rotateX(-Math.PI / 2), floorMat(K.floor, W, D, K.fc)); floor.position.set(OX, 0, OZ); floor.receiveShadow = true; add(floor);
    add(at(box(W, 0.2, D, M(0xf4f4f2, 0.9), 0, H + 0.1, 0), 0, 0));
    const wallM = M(K.wall, 0.85), base = M(0x3a3a3e, 0.6);
    for (const [w, d, x, z] of [[W + 0.6, 0.3, 0, -D / 2 - 0.15], [W + 0.6, 0.3, 0, D / 2 + 0.15], [0.3, D, -W / 2 - 0.15, 0], [0.3, D, W / 2 + 0.15, 0]]) {
      add(at(box(w, H, d, wallM, 0, H / 2, 0), x, z));
      add(at(box(w - 0.02, 0.16, d - 0.02, base, 0, 0.08, 0), x * 0.995, z * 0.995));
    }
    // exit door (south wall) + sign
    add(at(box(1.8, 2.6, 0.12, M(0x2a1d14, 0.5), 0, 1.3, 0), 0, D / 2 - 0.05));
    add(at(box(1.2, 0.3, 0.06, glow(0x35e08a, 2), 0, 2.95, 0), 0, D / 2 - 0.08));
    // ceiling lights
    const cols = Math.max(2, Math.round(W / 9)), rows = Math.max(1, Math.round(D / 9));
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      const x = -W / 2 + (i + 0.5) * W / cols, z = -D / 2 + (j + 0.5) * D / rows;
      add(at(box(1.6, 0.06, 0.6, glow(K.light, 2.2), 0, H - 0.03, 0), x, z));
      if ((i + j) % 2 === 0 || cols * rows <= 4) { const l = new THREE.PointLight(K.light, kind === 'luna' ? 34 : 26, 20, 2); l.position.set(OX + x, H - 0.5, OZ + z); group.add(l); lights.push(l); }
    }

    FURNISH[kind] ? FURNISH[kind]({ W, D, H, put, add, at, solid, npcs, group, OX, OZ, updaters }) : FURNISH.shop({ W, D, H, put, add, at, solid, npcs, group, OX, OZ, updaters });

    return {
      kind, group, colliders, npcs, lights, bounds: { x0: OX - W / 2 + 0.5, x1: OX + W / 2 - 0.5, z0: OZ - D / 2 + 0.5, z1: OZ + D / 2 - 0.4 }, H,
      spawn: { x: OX, z: OZ + D / 2 - 2.6, h: Math.PI }, exit: { x: OX, z: OZ + D / 2 - 1.3 },
      show(v) { group.visible = v; },
      update(dt, px, pz, t) {
        for (const n of npcs) {
          const dx = px - n.x, dz = pz - n.z, d = Math.hypot(dx, dz);
          if (d < 9) { const want = Math.atan2(dx, dz); let df = ((want - n.h + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI; n.h += df * Math.min(1, dt * 3); }
          n.human.group.position.set(n.x, 0, n.z); n.human.group.rotation.y = n.h; animateHuman(n.human, 0, 0, dt);
        }
        for (const u of updaters) u(t, dt);
      },
    };
  }
  return { get };
}

// ---------------------------------------------------------------------------------- furniture
const sofa = (c, w = 2.3) => { const g = new THREE.Group(), m = M(c, 0.9); g.add(box(w, 0.45, 0.95, m), box(w, 0.55, 0.26, m, 0, 0.72, -0.36), box(0.26, 0.35, 0.95, m, -w / 2 + 0.13, 0.62, 0), box(0.26, 0.35, 0.95, m, w / 2 - 0.13, 0.62, 0), box(w - 0.5, 0.14, 0.7, M(c, 0.8), 0, 0.5, 0.06)); return g; };
const table = (w, d, h, c = 0x6a4a2c) => { const g = new THREE.Group(), m = M(c, 0.5); g.add(box(w, 0.06, d, m, 0, h)); for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) g.add(box(0.06, h, 0.06, M(0x222222, 0.5, 0.6), x * (w / 2 - 0.08), h / 2, z * (d / 2 - 0.08))); return g; };
const chair = (c = 0x333333) => { const g = new THREE.Group(), m = M(c, 0.7); g.add(box(0.45, 0.06, 0.45, m, 0, 0.46), box(0.45, 0.5, 0.06, m, 0, 0.74, -0.2), cyl(0.03, 0.46, M(0x999999, 0.3, 1), 0, 0.23, 0)); return g; };
const plant = (s = 1) => { const g = new THREE.Group(); g.add(cyl(0.28 * s, 0.5 * s, M(0xa66b45, 0.8)), (() => { const o = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5 * s, 1), M(0x2f7a3a, 0.9)); o.position.y = 0.95 * s; o.castShadow = true; return o; })()); return g; };
const screenTex = (c1, c2) => canvasTex(128, 72, (g, w, h) => { const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, c1); gr.addColorStop(1, c2); g.fillStyle = gr; g.fillRect(0, 0, w, h); for (let i = 0; i < 10; i++) { g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(Math.random() * w, Math.random() * h, 20, 3); } }, { repeat: false });
const tv = (w = 1.6) => { const g = new THREE.Group(), h = w * 0.56; g.add(box(w + 0.06, h + 0.06, 0.05, M(0x08080a, 0.3), 0, 1.3, 0)); const s = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: screenTex('#1c3d8f', '#8f2a6a'), emissiveMap: screenTex('#1c3d8f', '#8f2a6a'), emissive: 0xffffff, emissiveIntensity: 1.2 })); s.position.set(0, 1.3, 0.03); g.add(s); return g; };
const products = (n, w, h, d) => { const g = new THREE.Group(), cs = [0xe74c3c, 0xf1c40f, 0x2ecc71, 0x3498db, 0xecf0f1, 0xe67e22, 0x9b59b6]; for (let i = 0; i < n; i++) g.add(box(0.2, 0.28, 0.2, M(pick(cs), 0.6), -w / 2 + 0.2 + (i % Math.floor(w / 0.26)) * 0.26, 0.15 + Math.floor(i / Math.floor(w / 0.26)) * 0.4, 0)); return g; };
const shelf = (w, h = 1.9) => { const g = new THREE.Group(), m = M(0x8a8f96, 0.5, 0.4); g.add(box(w, h, 0.05, m, 0, h / 2, -0.3)); for (const s of [-1, 1]) g.add(box(0.05, h, 0.6, m, s * w / 2, h / 2, 0)); for (let i = 0; i < 4; i++) { g.add(box(w, 0.04, 0.6, m, 0, 0.1 + i * 0.5, 0)); const p = products(Math.floor(w / 0.26) * 1, w, 0.3, 0.3); p.position.set(0, 0.12 + i * 0.5, 0.05); g.add(p); } return g; };
const counter = (w, d = 0.8, h = 1.05, c = 0x4a3a2e) => { const g = new THREE.Group(); g.add(box(w, h, d, M(c, 0.6), 0, h / 2), box(w + 0.1, 0.06, d + 0.1, M(0xd8d8d8, 0.3, 0.2), 0, h + 0.03)); return g; };
const desk = (c = 0xb08a5a) => { const g = new THREE.Group(); g.add(table(1.6, 0.8, 0.74, c), box(0.5, 0.35, 0.03, M(0x0a0a0a, 0.3), 0, 1.0, -0.1), box(0.12, 0.2, 0.12, M(0x333333), 0, 0.85, -0.1)); const s = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.3), new THREE.MeshStandardMaterial({ color: 0x113355, emissive: 0x2266aa, emissiveIntensity: 1.2 })); s.position.set(0, 1.0, -0.083); g.add(s); return g; };
const bed = (c) => { const g = new THREE.Group(); g.add(box(2.1, 0.4, 2.4, M(0x3a2a22, 0.6), 0, 0.2), box(2.0, 0.25, 2.2, M(0xf5f5f5, 0.9), 0, 0.5), box(2.02, 0.12, 1.2, M(c, 0.9), 0, 0.66, 0.5), box(0.7, 0.14, 0.4, M(0xffffff, 0.95), -0.5, 0.68, -0.85), box(0.7, 0.14, 0.4, M(0xffffff, 0.95), 0.5, 0.68, -0.85), box(2.1, 1.1, 0.12, M(0x3a2a22, 0.6), 0, 0.8, -1.25)); return g; };
const neon = (text, color, w = 5, h = 1.3) => { const t = canvasTex(512, 128, (c) => { c.fillStyle = '#0b0610'; c.fillRect(0, 0, 512, 128); c.shadowColor = color; c.shadowBlur = 24; c.fillStyle = color; c.font = 'bold 80px Arial'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(text, 256, 66); }, { repeat: false }); const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 1.4 })); return m; };
const person = (npcs, x, z, h, o, name, lines) => { const human = makeHuman({ quality: 'mid', ...o }); human.group.visible = true; npcs.push({ human, x, z, h, name, lines }); return human; };

const FURNISH = {
  shop: ({ W, D, put, npcs, group, OX, OZ }) => {
    for (let r = 0; r < 3; r++) put(shelf(7), -4 + 0, -D / 2 + 4.5 + r * 3.2, 7, 0.7, 0);
    for (let i = 0; i < 4; i++) { const f = box(1.4, 2.0, 0.7, M(0x1b2a38, 0.3, 0.5)); const gl = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.8), new THREE.MeshStandardMaterial({ color: 0xbfe3ff, emissive: 0x7fc4ff, emissiveIntensity: 0.9, transparent: true, opacity: 0.85 })); gl.position.set(0, 1.0, 0.36); const g = new THREE.Group(); g.add(f, gl); put(g, -W / 2 + 1.0, -D / 2 + 2.5 + i * 3.4, 0.7, 1.4, 1); }
    put(counter(5, 0.9), W / 2 - 4, -D / 2 + 3, 5, 0.9, 0); put(box(0.4, 0.3, 0.35, M(0x333333), 0, 1.25, 0), W / 2 - 5.5, -D / 2 + 3, 0.4, 0.35, 0, false);
    person(npcs, W / 2 - 4, -D / 2 + 1.8, 0, { female: false, shirt: 0x2e86c1 }, 'Clerk', CLERK_LINES);
  },
  diner: ({ W, D, put, add, at, npcs }) => {
    put(counter(12, 0.9, 1.05, 0xb03a3a), 0, -D / 2 + 3, 12, 0.9, 0);
    for (let i = 0; i < 6; i++) { const s = new THREE.Group(); s.add(cyl(0.22, 0.06, M(0xb03a3a, 0.4), 0, 0.72), cyl(0.04, 0.7, M(0xcccccc, 0.2, 1), 0, 0.35)); put(s, -5 + i * 2, -D / 2 + 4.1, 0.4, 0.4, 0, false); }
    for (let i = 0; i < 3; i++) for (const s of [-1, 1]) { const b = new THREE.Group(); b.add(table(1.3, 0.8, 0.74, 0xe8e0d0), chair(0xb03a3a), chair(0xb03a3a)); b.children[1].position.set(0, 0, -0.75); b.children[2].position.set(0, 0, 0.75); b.children[2].rotation.y = Math.PI; put(b, s * 8, -2 + i * 3.6, 1.4, 2.2, 0); }
    const jb = box(1.0, 1.9, 0.7, M(0x6a1f2a, 0.3, 0.3)); const jg = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.9), new THREE.MeshStandardMaterial({ color: 0xffb347, emissive: 0xffb347, emissiveIntensity: 1.6 })); jg.position.set(0, 1.3, 0.36); const j = new THREE.Group(); j.add(jb, jg); put(j, W / 2 - 1.5, D / 2 - 3, 1, 0.8, 0);
    add(at(neon('DINER', '#ff9f1c', 5, 1.3), 0, -D / 2 + 0.2)); person(npcs, 0, -D / 2 + 1.6, 0, { female: true, shirt: 0xecf0f1 }, 'Waitress', ["Take a seat, hon!", "Coffee's fresh. Pie's... less so.", "You look like you're running from something."]);
  },
  office: ({ W, D, put, npcs }) => {
    for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) { const c = new THREE.Group(); c.add(desk(), chair(0x2c3e50), box(1.8, 1.3, 0.05, M(0x7a8793, 0.7), 0, 0.65, 0.5)); c.children[1].position.set(0, 0, -0.8); c.children[1].rotation.y = Math.PI; put(c, -W / 2 + 4.5 + i * 6.5, -D / 2 + 4 + j * 4.6, 2, 1.8, 0); }
    put(counter(4, 0.8, 1.1, 0x2c3e50), 0, D / 2 - 5, 4, 0.8, 0); put(plant(1.2), -W / 2 + 1.2, D / 2 - 2, 0.8, 0.8); put(plant(1.2), W / 2 - 1.2, D / 2 - 2, 0.8, 0.8);
    person(npcs, 0, D / 2 - 6.4, 0, { female: true, shirt: 0xffffff, pants: 0x1c1c1c }, 'Receptionist', ["Do you have an appointment?", "Mr. Meridian is... unavailable. Always.", "Please keep your weapons holstered."]);
  },
  apartment: ({ W, D, put, add, at, npcs }) => {
    put(sofa(0x4a5b7a), -3, 2.5, 2.3, 0.95, 2); put(table(1.2, 0.6, 0.4), -3, 0.6, 1.2, 0.6); const t = tv(1.7); t.position.set(0, 0, 0); put(t, -3, -D / 2 + 0.6, 1.7, 0.1, 0, false);
    put(counter(4.5, 0.7, 0.95, 0x8a8f96), W / 2 - 3, -D / 2 + 1.5, 4.5, 0.7, 0); put(table(1.3, 0.9, 0.75, 0xe8e0d0), W / 2 - 4, 1.5, 1.3, 0.9);
    put(bed(0x7a3a4a), W / 2 - 2, D / 2 - 3.5, 2.1, 2.4, 0); put(box(1.0, 1.9, 0.5, M(0x6a4a2c, 0.5)), -W / 2 + 1, -2, 1, 0.5, 1); put(plant(1), -W / 2 + 1, D / 2 - 2, 0.8, 0.8);
    put(box(2.2, 0.02, 1.5, M(0xb5483a, 0.95), 0, 0.011, 0), -3, 1.6, 2.2, 1.5, 0, false);
  },
  bank: ({ W, D, put, npcs }) => {
    put(counter(16, 0.9, 1.1, 0x3a3a40), 0, -D / 2 + 4.5, 16, 0.9, 0);
    for (let i = 0; i < 4; i++) { const g = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.2, 0.05), new THREE.MeshStandardMaterial({ color: 0xbfd8e8, transparent: true, opacity: 0.35, roughness: 0.05 })); g.position.set(0, 1.7, 0); const h = new THREE.Group(); h.add(g); put(h, -6 + i * 4, -D / 2 + 4.5, 2.2, 0.1, 0, false); person(npcs, -6 + i * 4, -D / 2 + 3.3, 0, { female: i % 2 === 0, shirt: 0xffffff, pants: 0x1a1f2b }, 'Teller', ["Cash or card? ...Just kidding, we're closed to robbers.", "Sign here, please."]); }
    const vault = new THREE.Group(); vault.add((() => { const c = cyl(1.6, 0.5, M(0x8a8f96, 0.25, 1), 0, 1.7, 0.2, 32); c.rotation.x = Math.PI / 2; return c; })(), box(5, 3.1, 0.4, M(0x2f3136, 0.4, 0.8), 0, 1.55, -0.2)); put(vault, 0, -D / 2 + 0.6, 5, 0.6, 0);
    for (const s of [-1, 1]) put(plant(1.3), s * (W / 2 - 1.2), D / 2 - 2, 0.8, 0.8);
  },
  hotel: ({ W, D, put, add, at, npcs }) => {
    put(counter(8, 0.9, 1.1, 0x5a3a24), 0, -D / 2 + 3.5, 8, 0.9, 0);
    for (const s of [-1, 1]) { put(sofa(0x8a2f3a, 2.6), s * 8, 2, 2.6, 0.95, s > 0 ? 3 : 1); put(table(1.4, 0.8, 0.4, 0x2a2a30), s * 6, 2, 1.4, 0.8); put(plant(1.3), s * (W / 2 - 1.2), -D / 2 + 1.5, 0.8, 0.8); }
    for (let i = 0; i < 2; i++) put(box(1.8, 2.6, 0.2, M(0xc9ccd1, 0.25, 1)), -3 + i * 6, -D / 2 + 0.3, 1.8, 0.2, 0);
    const ch = new THREE.Mesh(new THREE.SphereGeometry(0.7, 16, 10), new THREE.MeshStandardMaterial({ color: 0xfff0d0, emissive: 0xffe0a0, emissiveIntensity: 2 })); ch.position.set(0, 2.5, 0); put(ch, 0, 0, 1, 1, 0, false);
    person(npcs, 0, -D / 2 + 2.3, 0, { female: false, shirt: 0x6a1f2a, pants: 0x151515 }, 'Concierge', ["Welcome to the Grand. Room service is... optimistic.", "Checkout is at noon. Escaping is anytime."]);
  },
  gym: ({ W, D, put, add, at, npcs }) => {
    for (let i = 0; i < 5; i++) { const t = new THREE.Group(); t.add(box(0.8, 0.2, 1.8, M(0x1c1c20, 0.6), 0, 0.5), box(0.1, 1.0, 0.1, M(0x666666, 0.3, 1), -0.3, 1.0, 0.8), box(0.1, 1.0, 0.1, M(0x666666, 0.3, 1), 0.3, 1.0, 0.8), box(0.7, 0.25, 0.3, M(0x111111, 0.4), 0, 1.4, 0.85)); put(t, -W / 2 + 3 + i * 2.4, -D / 2 + 2.5, 0.9, 1.9, 0); }
    for (let i = 0; i < 3; i++) { const b = new THREE.Group(); b.add(box(0.5, 0.45, 1.3, M(0x222226, 0.6)), box(1.8, 0.05, 0.05, M(0xcccccc, 0.2, 1), 0, 1.0, -0.1), (() => { const d = cyl(0.28, 0.1, M(0x111111), 0.85, 1.0, -0.1); d.rotation.z = Math.PI / 2; return d; })()); put(b, 2 + i * 3.4, 2, 2, 1.3, 0); }
    const mir = new THREE.Mesh(new THREE.PlaneGeometry(W - 3, 2.2), new THREE.MeshStandardMaterial({ color: 0xcfe3ef, roughness: 0.05, metalness: 1 })); mir.position.set(0, 1.6, 0.05); const mg = new THREE.Group(); mg.add(mir); put(mg, 0, -D / 2 + 0.1, 1, 0.1, 0, false);
    person(npcs, W / 2 - 3, D / 2 - 4, Math.PI, { female: false, shirt: 0xe74c3c, pants: 0x111111 }, 'Trainer', ["No pain, no... wanted level.", "Spot you? Sure, if you're not being chased."]);
  },
  station: ({ W, D, put, add, at, npcs }) => {
    put(counter(7, 0.9, 1.1, 0x2f4a8a), -4, D / 2 - 6, 7, 0.9, 0);
    for (let i = 0; i < 3; i++) put(desk(0x8a8f96), -W / 2 + 4 + i * 4, -2, 1.6, 0.8, 0);
    for (let i = 0; i < 3; i++) { const c = new THREE.Group(); for (let k = 0; k < 9; k++) c.add(cyl(0.025, 2.8, M(0x2a2a2e, 0.4, 0.8), -1.6 + k * 0.4, 1.4, 0, 6)); c.add(box(3.4, 0.08, 0.08, M(0x2a2a2e, 0.4, 0.8), 0, 2.8, 0), box(3.4, 0.08, 0.08, M(0x2a2a2e, 0.4, 0.8), 0, 0.05, 0)); put(c, W / 2 - 3.2, -D / 2 + 2.5 + i * 3.8, 3.4, 0.2, 1, false); solid2(put, W / 2 - 3.2, -D / 2 + 2.5 + i * 3.8); }
    const board = box(3.6, 1.6, 0.08, M(0x6a5a3a, 0.8), 0, 1.6, 0); put(board, -W / 2 + 1, -D / 2 + 0.2, 3.6, 0.1, 0, false);
    person(npcs, -4, D / 2 - 7.2, 0, { female: true, shirt: 0x1d2a4a, pants: 0x1d2a4a, hat: 0x1d2a4a }, 'Desk Sergeant', ["Keep it clean in here.", "You want to turn yourself in? Wrong door, champ.", "We're short on cells and long on coffee."]);
  },
  luna: ({ W, D, H, put, add, at, npcs, updaters, group, OX, OZ }) => {
    // living area
    put(sofa(0xf4e9f1, 3.4), -7, 3, 3.4, 0.95, 2); put(sofa(0xf4e9f1, 2.6), -10.5, 0.2, 2.6, 0.95, 1); put(table(1.8, 0.9, 0.4, 0x24222a), -7, 0.6, 1.8, 0.9);
    const t = tv(2.4); put(t, -7, -D / 2 + 0.6, 2.4, 0.1, 0, false); put(box(3.0, 0.5, 0.5, M(0x24222a, 0.4)), -7, -D / 2 + 0.9, 3, 0.5);
    put(box(3.6, 0.02, 2.4, M(0xd9a3c8, 0.95), 0, 0.011, 0), -7, 1.2, 3.6, 2.4, 0, false);
    // kitchen island
    put(counter(4.6, 1.2, 1.0, 0x1d1b22), 8, -2, 4.6, 1.2, 0); for (let i = 0; i < 3; i++) { const s = new THREE.Group(); s.add(cyl(0.22, 0.06, M(0xff4fa3, 0.4), 0, 0.72), cyl(0.04, 0.7, M(0xdddddd, 0.2, 1), 0, 0.35)); put(s, 6.8 + i * 1.2, -0.7, 0.4, 0.4, 0, false); }
    put(counter(7, 0.7, 0.95, 0xf0eef0), 8, -D / 2 + 0.9, 7, 0.7, 0);
    // bedroom corner
    put(bed(0xff4fa3), W / 2 - 3, D / 2 - 4.5, 2.1, 2.4, 0); put(box(0.5, 0.5, 0.5, M(0x24222a, 0.5)), W / 2 - 5.2, D / 2 - 5.4, 0.5, 0.5);
    const vm = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.8), new THREE.MeshStandardMaterial({ color: 0xcfe3ef, roughness: 0.04, metalness: 1 })); vm.position.set(0, 1.2, 0.05); const vg = new THREE.Group(); vg.add(vm); put(vg, W / 2 - 0.4, 0, 0.1, 1.2, 1, false);
    for (let i = 0; i < 2; i++) put(box(1.4, 2.4, 0.4, M(0x3a2a22, 0.5)), -W / 2 + 0.6 + i * 1.5, D / 2 - 1.2, 1.4, 0.4, 0);
    for (const [x, z] of [[-W / 2 + 1.2, -D / 2 + 1.5], [W / 2 - 1.2, -D / 2 + 1.5], [0, D / 2 - 2.2]]) put(plant(1.6), x, z, 0.8, 0.8);
    // glowing sign, LED strips, skyline "window"
    add(at(neon('LUNA', '#ff4fa3', 6, 1.5), 0, -D / 2 + 0.2).translateY(2.6));
    add(at(box(W - 1, 0.08, 0.08, glow(0xff4fa3, 3), 0, H - 0.2, 0), 0, -D / 2 + 0.3)); add(at(box(0.08, 0.08, D - 1, glow(0x7a5cff, 3), 0, H - 0.2, 0), -W / 2 + 0.3, 0));
    const sky = canvasTex(512, 256, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#120a2e'); gr.addColorStop(1, '#ff7aa8'); g.fillStyle = gr; g.fillRect(0, 0, w, h); for (let i = 0; i < 70; i++) { g.fillStyle = `rgba(20,12,40,0.95)`; const bw = 14 + Math.random() * 30, bh = 20 + Math.random() * 110; g.fillRect(Math.random() * w, h - bh, bw, bh); } for (let i = 0; i < 220; i++) { g.fillStyle = 'rgba(255,230,160,0.9)'; g.fillRect(Math.random() * w, h * 0.45 + Math.random() * h * 0.55, 2, 3); } }, { repeat: false });
    const win = new THREE.Mesh(new THREE.PlaneGeometry(W - 4, H - 0.8), new THREE.MeshStandardMaterial({ map: sky, emissiveMap: sky, emissive: 0xffffff, emissiveIntensity: 0.9 })); win.position.set(OX, H / 2, OZ + D / 2 - 0.02); win.rotation.y = Math.PI; group.add(win);   // (behind the door wall is hidden by the door wall itself)
    const winN = win.clone(); winN.position.set(OX - 0.0, H / 2, OZ - D / 2 + 0.02); winN.rotation.y = 0; winN.scale.set(0.5, 0.8, 1); winN.position.x = OX + 8; group.add(winN);
    // Luna herself
    const luna = makeLuna(); luna.group.visible = true; npcs.push({ human: luna, x: OX - 4.5, z: OZ + 2.5, h: Math.PI * 0.8, name: 'Luna', lines: LUNA_LINES, isLuna: true });
    luna.group.userData.isLuna = true;
  },
};
function solid2() {}
