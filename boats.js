// boats.js - Update 1.4: speedboats and jet skis. Moored at every island's shore, plus a few AI boats cruising around the islands.
import * as THREE from 'three';
import { makeVehicle, makeHuman, animateHuman } from './models.js';

const pick = (a) => a[(Math.random() * a.length) | 0];
const WATER = -0.7;

export class Boats {
  constructor(scene, world) {
    this.scene = scene; this.world = world; this.list = []; this.t = 0;
    for (const isl of world.islands) {
      const sides = [[0, -1], [0, 1], [1, 0], [-1, 0]].sort(() => Math.random() - 0.5);
      let made = 0;
      for (const [sx, sz] of sides) {
        if (made >= 2) break;
        for (let tries = 0; tries < 12 && made < 2; tries++) {
          const along = (Math.random() * 2 - 1) * 0.7;
          let x = isl.cx + (sx ? 0 : along * isl.hw), z = isl.cz + (sz ? 0 : along * isl.hd);
          let ok = false;
          for (let k = 0; k < 140; k++) { if (!world.onLand(x, z, 0) && !world.onBridge(x, z, 0)) { ok = true; break; } x += sx; z += sz; }
          if (!ok) continue;
          x += sx * 4.5; z += sz * 4.5;
          if (world.onLand(x, z, 3) || world.onBridge(x, z, 8) || this.list.some(b => Math.hypot(b.mesh.position.x - x, b.mesh.position.z - z) < 8)) continue;
          this.add(made === 0 ? 'boat' : 'jetski', x, z, Math.atan2(sx, sz)); made++;
        }
      }
    }
    // AI boats cruising around islands
    for (let i = 0; i < 6; i++) this.addCruiser();
  }

  add(type, x, z, h) {
    const mesh = makeVehicle(type); mesh.position.set(x, mesh.userData.baseY, z); mesh.rotation.y = h; this.scene.add(mesh);
    const b = { mesh, type, water: true, speed: 0, parked: true, driven: false, maxV: type === 'jetski' ? 30 : 24, ai: null, phase: Math.random() * 6, lean: 0 };
    this.list.push(b); return b;
  }

  ringPoint(a, u) {
    const hw = a.isl.hw + a.m, hd = a.isl.hd + a.m, w = hw * 2, d = hd * 2, P = 2 * (w + d);
    u = ((u % P) + P) % P; let x, z;
    if (u < w) { x = -hw + u; z = -hd; } else if (u < w + d) { x = hw; z = -hd + (u - w); } else if (u < 2 * w + d) { x = hw - (u - w - d); z = hd; } else { x = -hw; z = hd - (u - 2 * w - d); }
    return { x: a.isl.cx + x, z: a.isl.cz + z };
  }

  addCruiser() {
    for (let tries = 0; tries < 40; tries++) {
      const isl = pick(this.world.islands), m = pick([34, 42, 50, 60]), a = { isl, m, u: Math.random() * 3000, dir: Math.random() < 0.5 ? 1 : -1, v: 6 + Math.random() * 4 };
      let ok = true;
      for (let u = 0; u < 4000 && ok; u += 40) { const p = this.ringPoint(a, u); if (this.world.onLand(p.x, p.z, 4)) ok = false; }
      if (!ok) continue;
      const p = this.ringPoint(a, a.u), b = this.add(pick(['boat', 'jetski', 'boat']), p.x, p.z, 0); b.ai = a; b.parked = false;
      const rider = makeHuman({ quality: 'mid', jacket: pick([0xd0302a, 0x1f5fa8, 0xf2f2f2]), longSleeve: true }); rider.pose = 'ride';
      const seat = b.mesh.userData.seat; rider.group.position.set(seat.x, seat.y - 0.955 + 0.02, seat.z); b.mesh.add(rider.group); animateHuman(rider, 0, 0, 1 / 60); b.rider = rider;
      return b;
    }
    return null;
  }

  take(b) { b.driven = true; b.parked = true; b.ai = null; if (b.rider) b.rider.group.visible = false; }
  park(b) { b.driven = false; b.parked = true; b.speed = 0; b.mesh.rotation.z = 0; }

  // bob on the waves; lean = roll in radians
  bob(b, dt, lean = 0) {
    const m = b.mesh, base = m.userData.baseY, t = this.t + b.phase, v = Math.abs(b.speed);
    m.position.y = base + Math.sin(t * 1.6) * 0.045 + Math.min(0.12, v * 0.006);
    m.rotation.x = -Math.min(0.1, v * 0.004) + Math.sin(t * 1.1) * 0.012;
    m.rotation.z = lean + Math.sin(t * 1.3 + 1) * 0.02;
    const wk = m.userData.wake; if (wk) for (const p of wk.children) p.material.opacity = Math.min(0.45, v / 18 * 0.45);
  }

  update(dt, focus) {
    this.t += dt;
    for (const b of this.list) {
      if (b.driven) continue;
      const m = b.mesh, near = Math.abs(m.position.x - focus.x) < 300 && Math.abs(m.position.z - focus.z) < 300;
      m.visible = near;
      if (b.ai) {
        const a = b.ai; a.u += a.dir * a.v * dt; const p = this.ringPoint(a, a.u), q = this.ringPoint(a, a.u + a.dir * 4);
        m.position.x = p.x; m.position.z = p.z; const h = Math.atan2(q.x - p.x, q.z - p.z); let d = h - m.rotation.y; d = Math.atan2(Math.sin(d), Math.cos(d)); m.rotation.y += d * Math.min(1, dt * 3);
        b.speed = a.v;
      }
      if (near) this.bob(b, dt, 0);
    }
  }
}
