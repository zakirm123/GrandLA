// actors.js - human models, vehicle models, traffic AI, pedestrians and beach visitors.
import * as THREE from 'three';

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[(Math.random() * a.length) | 0];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const angDiff = (a, b) => ((a - b + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
const matCache = new Map();
const mat = (c) => { if (!matCache.has(c)) matCache.set(c, new THREE.MeshLambertMaterial({ color: c })); return matCache.get(c); };

// ----------------------------------------------------------------- humans
export function makeHuman(o = {}) {
  const skin = o.skin ?? pick([0xf1c9a5, 0xe0ac84, 0xc68863, 0x8d5a3b, 0x5e3a24]);
  const shirt = o.shirt ?? pick([0xc0392b, 0x2e86c1, 0x27ae60, 0xf1c40f, 0x8e44ad, 0xecf0f1, 0xe67e22]);
  const pants = o.pants ?? pick([0x2c3e50, 0x34495e, 0x5d4e37, 0x1c1c1c, 0x4a6fa5]);
  const hair = o.hair ?? pick([0x1b1310, 0x4b3220, 0xb08040, 0x222222, 0x8a8a8a]);
  const g = new THREE.Group();
  const add = (p, w, h, d, c, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(c));
    m.position.set(x, y, z); m.castShadow = true; p.add(m); return m;
  };
  add(g, 0.5, 0.7, 0.28, shirt, 0, 1.2, 0);
  const head = new THREE.Group(); head.position.set(0, 1.69, 0); g.add(head);
  add(head, 0.27, 0.28, 0.27, skin, 0, 0, 0);
  add(head, 0.29, 0.1, 0.29, hair, 0, 0.13, -0.01);
  const limb = (x, y, w, h, c, hand) => {
    const p = new THREE.Group(); p.position.set(x, y, 0); add(p, w, h, w, c, 0, -h / 2, 0);
    if (hand) add(p, w, 0.13, w, skin, 0, -h - 0.02, 0);
    g.add(p); return p;
  };
  const h = { group: g, head,
    legL: limb(-0.13, 0.85, 0.21, 0.85, pants), legR: limb(0.13, 0.85, 0.21, 0.85, pants),
    armL: limb(-0.35, 1.5, 0.15, 0.62, shirt, true), armR: limb(0.35, 1.5, 0.15, 0.62, shirt, true) };
  return h;
}

export function animateHuman(h, phase, amp) {
  const s = Math.sin(phase) * amp;
  h.legL.rotation.x = s; h.legR.rotation.x = -s;
  h.armL.rotation.x = -s * 0.8; h.armR.rotation.x = s * 0.8;
}

// --------------------------------------------------------------- vehicles
export function makeVehicle(type = 'sedan', color) {
  const g = new THREE.Group();
  const part = (w, h, d, c, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(c));
    m.position.set(x, y, z); m.castShadow = true; g.add(m); return m;
  };
  const wheel = (r, x, z) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.3, 12), mat(0x0a0a0a));
    m.rotation.z = Math.PI / 2; m.position.set(x, r, z); g.add(m);
  };
  const glass = 0x1c2a3a;
  if (type === 'truck') {
    color = color ?? pick([0xc0392b, 0x2c7bb6, 0xe0a030, 0x3f8f5a]);
    part(2.2, 0.5, 6.8, 0x222222, 0, 0.75, -0.3);
    part(2.3, 1.5, 1.9, color, 0, 1.75, 2.2);
    part(2.0, 0.6, 0.1, glass, 0, 2.05, 3.16);
    part(2.5, 2.3, 4.5, 0xe6e6e6, 0, 2.15, -1.2);
    for (const z of [2.2, -0.9, -2.5]) for (const x of [-1.1, 1.1]) wheel(0.55, x, z);
    part(0.4, 0.3, 0.1, 0xfff2b0, -0.8, 1.2, 3.18); part(0.4, 0.3, 0.1, 0xfff2b0, 0.8, 1.2, 3.18);
  } else {
    const police = type === 'police';
    color = police ? 0x14161c : (color ?? pick([0xd7263d, 0x1b73b3, 0xf4c20d, 0x2e8b57, 0xeeeeee, 0x5c5c66, 0x7a3e9d, 0xff7f2a]));
    part(1.9, 0.6, 4.3, color, 0, 0.65, 0);
    if (police) part(1.93, 0.42, 2.1, 0xf4f4f4, 0, 0.62, -0.1);
    part(1.7, 0.55, 2.2, police ? 0x1c2a3a : glass, 0, 1.2, -0.2);
    part(1.6, 0.06, 2.0, color, 0, 1.5, -0.2);
    for (const z of [1.4, -1.4]) for (const x of [-0.95, 0.95]) wheel(0.4, x, z);
    part(0.35, 0.2, 0.1, 0xfff2b0, -0.65, 0.75, 2.17); part(0.35, 0.2, 0.1, 0xfff2b0, 0.65, 0.75, 2.17);
    part(0.35, 0.2, 0.1, 0xb01020, -0.65, 0.75, -2.17); part(0.35, 0.2, 0.1, 0xb01020, 0.65, 0.75, -2.17);
  }
  g.userData.type = type;
  return g;
}

// ----------------------------------------------------------------- traffic
const LANE = 3.5;

export class Traffic {
  constructor(scene, world, counts = { sedan: 34, truck: 8, police: 9 }) {
    this.scene = scene; this.world = world; this.cars = [];
    this.total = world.edges.reduce((s, e) => s + e.len, 0);
    for (const [type, n] of Object.entries(counts)) for (let i = 0; i < n; i++) this.spawn(type);
  }

  randEdge() {
    let r = Math.random() * this.total;
    for (const e of this.world.edges) { r -= e.len; if (r <= 0) return e; }
    return this.world.edges[0];
  }

  lanePoint(e, sign, s) {
    const tx = e.dx * sign, tz = e.dz * sign;
    const bx = sign > 0 ? e.a.x : e.b.x, bz = sign > 0 ? e.a.z : e.b.z;
    return { x: bx + tx * s - tz * LANE, z: bz + tz * s + tx * LANE, tx, tz };
  }

  spawn(type, avoid) {
    for (let tries = 0; tries < 60; tries++) {
      const e = this.randEdge(), sign = Math.random() < 0.5 ? 1 : -1, s = rnd(14, e.len - 14);
      const p = this.lanePoint(e, sign, s);
      if (avoid && Math.hypot(p.x - avoid.x, p.z - avoid.z) < 90) continue;
      if (this.cars.some(c => Math.hypot(c.mesh.position.x - p.x, c.mesh.position.z - p.z) < 10)) continue;
      const mesh = makeVehicle(type);
      mesh.position.set(p.x, 0, p.z); mesh.rotation.y = Math.atan2(p.tx, p.tz);
      this.scene.add(mesh);
      const maxV = type === 'truck' ? rnd(7, 10) : type === 'police' ? rnd(10, 13) : rnd(11, 16);
      const car = { mesh, type, speed: 0, edge: e, sign, next: null, maxV, stuck: 0, ignore: 0, parked: false, radius: type === 'truck' ? 3.6 : 2.4 };
      this.cars.push(car); return car;
    }
    return null;
  }

  pickNext(car) {
    const node = car.sign > 0 ? car.edge.b : car.edge.a;
    let opts = node.adj.filter(o => o.edge !== car.edge);
    if (!opts.length) opts = node.adj;
    const o = pick(opts);
    return { edge: o.edge, sign: o.edge.a === node ? 1 : -1 };
  }

  take(car) { car.parked = true; car.driven = true; car.chasing = false; car.leaving = false; if (car._bar) car._bar.visible = false; }
  park(car) { car.driven = false; car.parked = true; car.speed = 0; }

  snap(car) {
    const p = car.mesh.position, h = car.mesh.rotation.y;
    let best = 1e9, be = null, bs = 1;
    for (const e of this.world.edges) {
      const t = clamp((p.x - e.a.x) * e.dx + (p.z - e.a.z) * e.dz, 0, e.len);
      const d = Math.hypot(p.x - (e.a.x + e.dx * t), p.z - (e.a.z + e.dz * t));
      if (d < best) { best = d; be = e; bs = (e.dx * Math.sin(h) + e.dz * Math.cos(h)) >= 0 ? 1 : -1; }
    }
    car.edge = be; car.sign = bs; car.next = null; car.speed = Math.min(car.speed, 6);
  }

  // blockers: [{x,z}] of pedestrians / player; extra: meshes of parked or player vehicles
  update(dt, blockers, extra) {
    for (const car of this.cars) {
      if (car.parked || car.chasing || car.leaving) { car._was = car.chasing || car.leaving; continue; }
      if (car._was) { car._was = false; this.snap(car); }
      const m = car.mesh, p = m.position;
      let h = m.rotation.y, e = car.edge, sign = car.sign;
      const base = sign > 0 ? e.a : e.b, tx = e.dx * sign, tz = e.dz * sign;
      let s = (p.x - base.x) * tx + (p.z - base.z) * tz;
      if (s >= e.len) {
        const nx = car.next || this.pickNext(car);
        car.edge = e = nx.edge; car.sign = sign = nx.sign; car.next = null;
        const b2 = sign > 0 ? e.a : e.b;
        s = (p.x - b2.x) * e.dx * sign + (p.z - b2.z) * e.dz * sign;
      }
      const look = 5 + car.speed * 0.5;
      let tgt;
      if (s + look <= e.len) tgt = this.lanePoint(e, sign, s + look);
      else { if (!car.next) car.next = this.pickNext(car); tgt = this.lanePoint(car.next.edge, car.next.sign, s + look - e.len); }
      const diff = angDiff(Math.atan2(tgt.x - p.x, tgt.z - p.z), h);
      h += clamp(diff, -2.4 * dt * Math.min(1, car.speed / 3 + 0.3), 2.4 * dt * Math.min(1, car.speed / 3 + 0.3));

      let want = car.maxV * (1 - Math.min(0.55, Math.abs(diff) * 0.8));
      let blocked = false;
      if (car.ignore > 0) car.ignore -= dt;
      else {
        const sh = Math.sin(h), ch = Math.cos(h), reach = 7 + car.speed * 0.6;
        const test = (x, z, lat) => {
          const dx = x - p.x, dz = z - p.z, f = dx * sh + dz * ch;
          return f > 0.5 && f < reach && Math.abs(dx * ch - dz * sh) < lat;
        };
        for (const o of this.cars) if (o !== car && test(o.mesh.position.x, o.mesh.position.z, 2.3)) { blocked = true; break; }
        if (!blocked) for (const o of extra) if (test(o.x, o.z, 2.6)) { blocked = true; break; }
        if (!blocked) for (const o of blockers) if (test(o.x, o.z, 1.8)) { blocked = true; break; }
      }
      if (blocked) want = 0;
      car.stuck = blocked && car.speed < 0.3 ? car.stuck + dt : 0;
      if (car.stuck > 5) { car.ignore = 2.5; car.stuck = 0; }
      car.speed += clamp(want - car.speed, -16 * dt, 6 * dt);
      p.x += Math.sin(h) * car.speed * dt; p.z += Math.cos(h) * car.speed * dt;
      m.rotation.y = h;
    }
  }
}

// ------------------------------------------------------------- pedestrians
const SIDEWALK = 10;

export class Peds {
  constructor(scene, world, nWalk = 70, nStroll = 22, nLie = 18) {
    this.scene = scene; this.world = world; this.list = [];
    this.total = world.edges.reduce((s, e) => s + e.len, 0);
    for (let i = 0; i < nWalk; i++) this.addWalker();
    const isl = world.islands;
    for (let i = 0; i < nStroll; i++) this.addStroller(pick(isl));
    for (let i = 0; i < nLie; i++) this.addSunbather(pick(isl));
  }

  base(kind, o = {}) {
    const human = makeHuman(o);
    this.scene.add(human.group);
    const p = { kind, human, g: human.group, state: 'ok', x: 0, z: 0, h: 0, speed: 1.4, phase: Math.random() * 6, downT: 0, vx: 0, vz: 0, tilt: 0 };
    this.list.push(p); return p;
  }

  sidePoint(e, sign, s) {
    const tx = e.dx * sign, tz = e.dz * sign;
    const bx = sign > 0 ? e.a.x : e.b.x, bz = sign > 0 ? e.a.z : e.b.z;
    return { x: bx + tx * s - tz * SIDEWALK, z: bz + tz * s + tx * SIDEWALK };
  }

  placeWalker(p, far) {
    const edges = this.world.edges.filter(e => !e.bridge);
    for (let i = 0; i < 20; i++) {
      const e = pick(edges), sign = Math.random() < 0.5 ? 1 : -1, s = rnd(5, e.len - 5);
      const q = this.sidePoint(e, sign, s);
      if (far && Math.hypot(q.x - far.x, q.z - far.z) < 60) continue;
      Object.assign(p, { edge: e, sign, x: q.x, z: q.z, h: Math.atan2(e.dx * sign, e.dz * sign), next: null }); return;
    }
  }

  addWalker() { const p = this.base('walk'); this.placeWalker(p); }

  addStroller(isl) {
    const p = this.base('stroll', { shirt: pick([0xff8c42, 0x3fc1c9, 0xfc5185, 0xf9ed69]), pants: pick([0xf5f5f5, 0x3a86ff, 0xffbe0b]) });
    Object.assign(p, { isl, u: Math.random() * 10000, dir: Math.random() < 0.5 ? 1 : -1, speed: rnd(0.8, 1.2) });
  }

  ringPoint(isl, u) {
    const hw = isl.hw + 11, hd = isl.hd + 11, w = hw * 2, d = hd * 2, P = 2 * (w + d);
    u = ((u % P) + P) % P;
    let x, z;
    if (u < w) { x = -hw + u; z = -hd; }
    else if (u < w + d) { x = hw; z = -hd + (u - w); }
    else if (u < 2 * w + d) { x = hw - (u - w - d); z = hd; }
    else { x = -hw; z = hd - (u - 2 * w - d); }
    return { x: isl.cx + x, z: isl.cz + z };
  }

  addSunbather(isl) {
    for (let i = 0; i < 40; i++) {
      const a = (Math.random() * 4) | 0, along = (Math.random() * 2 - 1);
      const x = isl.cx + (a % 2 === 0 ? along * isl.hw : (a === 1 ? 1 : -1) * (isl.hw + rnd(4, 18)));
      const z = isl.cz + (a % 2 === 0 ? (a === 0 ? -1 : 1) * (isl.hd + rnd(4, 18)) : along * isl.hd);
      if (this.world.onBridge(x, z, -14)) continue;
      const p = this.base('lie', { shirt: pick([0xff5d8f, 0x4cc9f0, 0xffd60a]), pants: pick([0xff5d8f, 0x4cc9f0, 0x222222]) });
      p.x = x; p.z = z; p.h = Math.random() * 6.28;
      const towel = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 2.1), new THREE.MeshLambertMaterial({ color: pick([0xff595e, 0xffca3a, 0x8ac926, 0x1982c4, 0x6a4c93]) }));
      towel.rotation.x = -Math.PI / 2; towel.position.set(x, 0.03, z); towel.rotation.z = p.h; this.scene.add(towel);
      return;
    }
    this.list.pop && 0;
  }

  hit(p, vx, vz) {
    if (p.state === 'down') return false;
    p.state = 'down'; p.downT = 0; p.vx = vx; p.vz = vz; return true;
  }

  update(dt, focus) {
    for (const p of this.list) {
      const g = p.g;
      if (p.state === 'down') {
        p.downT += dt;
        p.x += p.vx * dt; p.z += p.vz * dt; p.vx *= 0.92; p.vz *= 0.92;
        if (this.world.isBlocked(p.x, p.z, 0.5)) { p.x -= p.vx * dt; p.z -= p.vz * dt; p.vx = p.vz = 0; }
        p.tilt += (-Math.PI / 2 - p.tilt) * Math.min(1, dt * 10);
        g.position.set(p.x, 0.2, p.z); g.rotation.set(p.tilt, p.h, 0);
        if (p.downT > 8 && Math.hypot(p.x - focus.x, p.z - focus.z) > 30) {
          p.state = 'ok'; p.tilt = 0; if (p.kind === 'walk') this.placeWalker(p, focus);
        }
        continue;
      }
      if (p.kind === 'lie') { g.position.set(p.x, 0.2, p.z); g.rotation.set(-Math.PI / 2, p.h, 0); continue; }
      if (p.kind === 'stroll') {
        p.u += p.dir * p.speed * dt;
        const q = this.ringPoint(p.isl, p.u), q2 = this.ringPoint(p.isl, p.u + p.dir * 0.5);
        p.x = q.x; p.z = q.z; p.h = Math.atan2(q2.x - q.x, q2.z - q.z);
      } else {
        const e = p.edge, sign = p.sign, bx = sign > 0 ? e.a.x : e.b.x, bz = sign > 0 ? e.a.z : e.b.z;
        const tx = e.dx * sign, tz = e.dz * sign;
        let s = (p.x - bx) * tx + (p.z - bz) * tz;
        if (s >= e.len - 1) {
          const node = sign > 0 ? e.b : e.a;
          let opts = node.adj.filter(o => o.edge !== e && !o.edge.bridge);
          if (!opts.length) opts = node.adj.filter(o => !o.edge.bridge);
          const o = pick(opts);
          p.edge = o.edge; p.sign = o.edge.a === node ? 1 : -1; p.next = null;
          s = 0;
        }
        const ee = p.edge, ss = p.sign;
        const q = this.sidePoint(ee, ss, clamp(Math.max(0, (p.x - (ss > 0 ? ee.a.x : ee.b.x)) * ee.dx * ss + (p.z - (ss > 0 ? ee.a.z : ee.b.z)) * ee.dz * ss) + 3, 0, ee.len));
        const want = Math.atan2(q.x - p.x, q.z - p.z);
        p.h += clamp(angDiff(want, p.h), -4 * dt, 4 * dt);
        p.x += Math.sin(p.h) * p.speed * dt; p.z += Math.cos(p.h) * p.speed * dt;
      }
      p.phase += p.speed * dt * 4.5;
      g.position.set(p.x, 0, p.z); g.rotation.set(0, p.h, 0);
      if (Math.abs(p.x - focus.x) < 140 && Math.abs(p.z - focus.z) < 140) animateHuman(p.human, p.phase, 0.6);
    }
  }
}
