// actors.js - human models, vehicle models, traffic AI, pedestrians and beach visitors.
import * as THREE from 'three';
import { makeHuman, animateHuman, makeVehicle, spinWheels } from './models.js';
export { makeHuman, animateHuman, makeVehicle, spinWheels };

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[(Math.random() * a.length) | 0];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const angDiff = (a, b) => ((a - b + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;

// ----------------------------------------------------------------- traffic
const LANE = 3.5;

export class Traffic {
  constructor(scene, world, counts = { sedan: 20, hatch: 11, suv: 11, taxi: 7, van: 6, truck: 10, police: 11, bike: 10 }) {
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
      mesh.position.set(p.x, 0.05, p.z); mesh.rotation.y = Math.atan2(p.tx, p.tz);
      this.scene.add(mesh);
      const maxV = type === 'bike' ? rnd(12, 16) : type === 'truck' ? rnd(7, 10) : type === 'van' ? rnd(9, 12) : type === 'police' ? rnd(10, 13) : rnd(11, 16);
      const car = { mesh, type, speed: 0, edge: e, sign, next: null, maxV, stuck: 0, ignore: 0, parked: false, radius: type === 'truck' ? 3.6 : type === 'bike' ? 1.3 : 2.4 };
      if (type === 'bike') { const rider = makeHuman({ quality: 'mid', shirt: pick([0x111111, 0xc0392b, 0x2e86c1]), jacket: pick([0x111111, 0x5a3a1a]), hat: 0x151515, longSleeve: true }); rider.pose = 'ride'; rider.group.position.copy(mesh.userData.seat); rider.group.position.y = mesh.userData.seat.y - 0.955 + 0.02; animateHuman(rider, 0, 0, 1 / 60); mesh.add(rider.group); car.rider = rider; }
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
      if (car.parked || car.chasing || car.leaving) { car._was = car.chasing || car.leaving; if (!car.parked) spinWheels(car, dt); continue; }
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
      m.rotation.y = h; spinWheels(car, dt);
    }
  }
}

// ------------------------------------------------------------- pedestrians
const SIDEWALK = 10;

export class Peds {
  constructor(scene, world, nWalk = 110, nStroll = 40, nLie = 30) {
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

  addWalker() {
    const p = this.base('walk', { quality: 'mid', jacket: Math.random() < 0.3 ? pick([0x2b2f36, 0x5a4632, 0x7a2e2e, 0x2f4f6f]) : undefined, hat: Math.random() < 0.12 ? pick([0x222222, 0xc0392b, 0x2c3e50]) : undefined });
    this.placeWalker(p);
  }

  addStroller(isl) {
    const p = this.base('stroll', { quality: 'mid', shirt: pick([0xff8c42, 0x3fc1c9, 0xfc5185, 0xf9ed69]), pants: pick([0xf5f5f5, 0x3a86ff, 0xffbe0b]), swim: true });
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
      const p = this.base('lie', { quality: 'mid', shirt: pick([0xff5d8f, 0x4cc9f0, 0xffd60a]), pants: pick([0xff5d8f, 0x4cc9f0, 0x222222]), swim: true });
      p.x = x; p.z = z; p.h = Math.random() * 6.28;
      const towel = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 2.1), new THREE.MeshLambertMaterial({ color: pick([0xff595e, 0xffca3a, 0x8ac926, 0x1982c4, 0x6a4c93]) }));
      towel.rotation.x = -Math.PI / 2; towel.position.set(x, 0.03, z); towel.rotation.z = p.h; this.scene.add(towel);
      return;
    }
    this.list.pop && 0;
  }

  scare(p, from) {
    if (p.state !== 'ok' || p.kind === 'lie' || p.kind === 'stroll') return;
    p.state = 'flee'; p.fleeT = 6 + Math.random() * 4; p.speed = 4.2; p.h = Math.atan2(p.x - from.x, p.z - from.z);
  }

  hit(p, vx, vz) {
    if (p.state === 'down') return false;
    p.state = 'down'; p.downT = 0; p.vx = vx; p.vz = vz; return true;
  }

  update(dt, focus) {
    for (const p of this.list) {
      const g = p.g;
      g.visible = Math.abs(p.x - focus.x) < 170 && Math.abs(p.z - focus.z) < 170;
      const gy = p.kind === 'walk' ? this.world.groundY(p.x, p.z) : 0.02;
      if (p.state === 'down') {
        p.downT += dt;
        p.x += p.vx * dt; p.z += p.vz * dt; p.vx *= 0.92; p.vz *= 0.92;
        if (this.world.isBlocked(p.x, p.z, 0.5)) { p.x -= p.vx * dt; p.z -= p.vz * dt; p.vx = p.vz = 0; }
        p.tilt += (-Math.PI / 2 - p.tilt) * Math.min(1, dt * 10);
        g.position.set(p.x, gy + 0.2, p.z); g.rotation.set(p.tilt, p.h, 0);
        if (p.downT > 8 && Math.hypot(p.x - focus.x, p.z - focus.z) > 30) {
          p.state = 'ok'; p.tilt = 0; if (p.kind === 'walk') this.placeWalker(p, focus);
        }
        continue;
      }
      if (p.state === 'flee') {
        p.fleeT -= dt; const nx = p.x + Math.sin(p.h) * p.speed * dt, nz = p.z + Math.cos(p.h) * p.speed * dt;
        if (this.world.isBlocked(nx, nz, 0.4)) p.h += 1.6; else { p.x = nx; p.z = nz; }
        if (p.fleeT <= 0) { p.state = 'ok'; p.speed = 1.4; if (p.kind === 'walk') this.placeWalker(p, focus); }
        p.phase += p.speed * dt * 3.2; g.position.set(p.x, this.world.groundY(p.x, p.z), p.z); g.rotation.set(0, p.h, 0);
        animateHuman(p.human, p.phase, 1, dt, 6); continue;
      }
      if (p.kind === 'lie') { g.position.set(p.x, gy + 0.2, p.z); g.rotation.set(-Math.PI / 2, p.h, 0); continue; }
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
      g.position.set(p.x, gy, p.z); g.rotation.set(0, p.h, 0);
      if (Math.abs(p.x - focus.x) < 140 && Math.abs(p.z - focus.z) < 140) animateHuman(p.human, p.phase, p.state === 'flee' ? 1 : 0.6, dt, p.state === 'flee' ? 6 : 1.4);
    }
  }
}
