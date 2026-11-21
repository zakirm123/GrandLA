// weapons.js - Update 1.3: inventory, melee + hitscan guns, ammo, reload, pickups, synthesized sounds, tracers.
import * as THREE from 'three';
import { makeWeapon } from './models.js';

export const WEAPONS = {
  fists:   { name: 'Fists',   slot: 1, melee: true, rate: 0.45, range: 1.9, dmg: 1 },
  knife:   { name: 'Knife',   slot: 2, melee: true, rate: 0.38, range: 2.1, dmg: 1 },
  pistol:  { name: 'Pistol',  slot: 3, mag: 12, reserve: 48, rate: 0.28, spread: 0.008, range: 90, pellets: 1, snd: [520, 0.1] },
  smg:     { name: 'SMG',     slot: 4, mag: 30, reserve: 120, rate: 0.085, spread: 0.03, range: 70, pellets: 1, auto: true, snd: [420, 0.07] },
  shotgun: { name: 'Shotgun', slot: 5, mag: 6, reserve: 24, rate: 0.85, spread: 0.075, range: 38, pellets: 8, snd: [190, 0.22] },
  rifle:   { name: 'Rifle',   slot: 6, mag: 30, reserve: 90, rate: 0.12, spread: 0.006, range: 170, pellets: 1, auto: true, snd: [300, 0.12] },
};
const ORDER = Object.keys(WEAPONS);

export function createWeapons({ scene, getScene, world, peds, getVolume, onCrime, onHitCop }) {
  const inv = { fists: true }, ammo = {};
  let cur = 'fists', cd = 0, reloadT = 0, flashT = 0, lastCrime = -9, time = 0, ctx = null, kick = 0;
  const fx = [];                                            // tracers
  const tracerMat = new THREE.LineBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0.9 });

  // ---------------------------------------------------------------- audio
  const audio = () => { if (!ctx) { const AC = window.AudioContext || window.webkitAudioContext; if (AC) ctx = new AC(); } return ctx; };
  function bang(freq, dur, vol = 1) {
    const c = audio(); if (!c) return; if (c.state === 'suspended') c.resume();
    const v = getVolume() * 0.5 * vol, t = c.currentTime, n = c.createBufferSource(), len = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    n.buffer = buf; const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq * 6; const g = c.createGain(); g.gain.value = v;
    const o = c.createOscillator(); o.type = 'square'; o.frequency.setValueAtTime(freq, t); o.frequency.exponentialRampToValueAtTime(40, t + dur); const og = c.createGain(); og.gain.setValueAtTime(v * 0.5, t); og.gain.exponentialRampToValueAtTime(0.001, t + dur);
    n.connect(f); f.connect(g); g.connect(c.destination); o.connect(og); og.connect(c.destination); n.start(t); o.start(t); o.stop(t + dur);
  }
  const click = (f = 900) => { const c = audio(); if (!c) return; const o = c.createOscillator(), g = c.createGain(); o.frequency.value = f; g.gain.setValueAtTime(getVolume() * 0.12, c.currentTime); g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.05); o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime + 0.06); };

  // ------------------------------------------------------------ inventory
  function give(type, mags = 1) {
    const w = WEAPONS[type]; if (!w) return;
    if (!inv[type]) { inv[type] = true; if (w.mag) ammo[type] = { mag: w.mag, reserve: w.reserve * 0 }; }
    if (w.mag) { ammo[type].reserve = Math.min(w.reserve * 3, ammo[type].reserve + w.reserve * mags); }
    if (cur === 'fists' || !inv[cur]) cur = type;
  }
  function select(type) { if (inv[type] && type !== cur) { cur = type; reloadT = 0; click(500); weaponMesh.dirty = true; } }
  function cycle(d) { const owned = ORDER.filter(k => inv[k]); select(owned[(owned.indexOf(cur) + d + owned.length) % owned.length]); }
  function reload() {
    const w = WEAPONS[cur], a = ammo[cur]; if (!w.mag || !a || reloadT > 0 || a.mag >= w.mag || a.reserve <= 0) return;
    reloadT = cur === 'shotgun' ? 1.6 : 1.2; click(300);
  }

  // ------------------------------------------------------- weapon meshes
  const meshes = {}; const weaponMesh = { dirty: true };
  const getMesh = (k) => (meshes[k] ??= makeWeapon(k));

  // ---------------------------------------------------------------- pickups
  const pickups = [];
  function placePickups(points) {
    const types = ['pistol', 'knife', 'smg', 'shotgun', 'rifle', 'pistol', 'knife', 'smg'];
    points.forEach((p, i) => {
      const type = types[i % types.length], g = new THREE.Group();
      const w = makeWeapon(type).clone(); w.scale.setScalar(type === 'knife' || type === 'pistol' ? 2.2 : 1.3); w.position.y = 0.8; w.rotation.z = 0;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.04, 8, 28).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xff3a3a, transparent: true, opacity: 0.75 })); ring.position.y = 0.1;
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 2.6, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0xff3a3a, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide })); beam.position.y = 1.4;
      g.add(w, ring, beam); g.position.set(p.x, world.groundY(p.x, p.z), p.z); scene.add(g);
      pickups.push({ type, g, w, x: p.x, z: p.z, t: Math.random() * 6, taken: 0 });
    });
  }

  // ---------------------------------------------------------------- shooting
  const ray = new THREE.Raycaster();
  function rayHitWorld(ox, oy, oz, dx, dy, dz, max, cols) {
    let best = max;
    for (const b of cols) {                      // 2D slab test, ignore if the ray is above the building
      let t0 = 0, t1 = best; const mn = [b.min.x, b.min.z], mx = [b.max.x, b.max.z], o = [ox, oz], d = [dx, dz];
      let ok = true;
      for (let i = 0; i < 2; i++) {
        if (Math.abs(d[i]) < 1e-8) { if (o[i] < mn[i] || o[i] > mx[i]) { ok = false; break; } }
        else { let a = (mn[i] - o[i]) / d[i], c = (mx[i] - o[i]) / d[i]; if (a > c) [a, c] = [c, a]; t0 = Math.max(t0, a); t1 = Math.min(t1, c); if (t0 > t1) { ok = false; break; } }
      }
      if (ok && t0 < best && oy + dy * t0 < (b.h || 40)) best = t0;
    }
    return best;
  }
  function rayPeds(ox, oy, oz, dx, dy, dz, max) {
    let best = null, bt = max;
    for (const p of peds.list) {
      if (p.state === 'down' || !p.g.visible) continue;
      const px = p.x - ox, pz = p.z - oz, t = px * dx + pz * dz; if (t < 0 || t > bt) continue;
      const cx = ox + dx * t - p.x, cz = oz + dz * t - p.z, y = oy + dy * t - (p.g.position.y || 0);
      if (cx * cx + cz * cz < 0.28 * 0.28 && y > 0 && y < 1.9) { bt = t; best = p; }
    }
    return best ? { p: best, t: bt } : null;
  }
  function addTracer(a, b) {
    const geo = new THREE.BufferGeometry().setFromPoints([a, b]); const l = new THREE.Line(geo, tracerMat); getScene().add(l); fx.push({ o: l, t: 0.06 });
  }

  // flash light on the muzzle
  const flash = new THREE.PointLight(0xffc870, 0, 12, 2); scene.add(flash);
  const syncFlash = () => { const sc = getScene(); if (flash.parent !== sc) sc.add(flash); };

  // returns true if an attack was made. `p`: {x,y,z,h}, `aim`: camera forward dir; muzzleWorld: Vector3 or null
  function fire(p, aim, origin, cops, firstPerson, cols = world.colliders) {
    const w = WEAPONS[cur];
    if (cd > 0 || reloadT > 0) return false;
    cd = w.rate;
    if (w.melee) {
      const fx_ = Math.sin(firstPerson ? Math.atan2(aim.x, aim.z) : p.h), fz_ = Math.cos(firstPerson ? Math.atan2(aim.x, aim.z) : p.h);
      let hit = false;
      for (const q of peds.list) {
        if (q.state === 'down') continue;
        const dx = q.x - p.x, dz = q.z - p.z, d = Math.hypot(dx, dz);
        if (d < w.range && (dx * fx_ + dz * fz_) / (d || 1) > 0.2 && peds.hit(q, fx_ * (cur === 'knife' ? 2 : 4), fz_ * (cur === 'knife' ? 2 : 4), cur === 'knife')) { onCrime('pedestrian'); hit = true; break; }
      }
      return { melee: true, hit };
    }
    const a = ammo[cur];
    if (!a || a.mag <= 0) { click(); if (a && a.reserve > 0) reload(); return false; }
    a.mag--; bang(w.snd[0], w.snd[1] + 0.05, cur === 'shotgun' ? 1.3 : 1); flashT = 0.05; kick = cur === 'shotgun' ? 1 : 0.5;
    if (time - lastCrime > 3) { lastCrime = time; onCrime('weapon'); }
    const org = origin.clone();
    for (let i = 0; i < w.pellets; i++) {
      const d = aim.clone(); d.x += (Math.random() - 0.5) * w.spread * 2; d.y += (Math.random() - 0.5) * w.spread * 2; d.z += (Math.random() - 0.5) * w.spread * 2; d.normalize();
      let t = Math.min(w.range, rayHitWorld(org.x, org.y, org.z, d.x, d.y, d.z, w.range, cols));
      if (d.y < -0.001) t = Math.min(t, -org.y / d.y);      // ground
      const hp = rayPeds(org.x, org.y, org.z, d.x, d.y, d.z, t);
      if (hp) { t = hp.t; if (peds.hit(hp.p, d.x * 6, d.z * 6, true)) onCrime('pedestrian'); }
      if (cops && onHitCop) for (const c of cops) { const px = c.x - org.x, pz = c.z - org.z, tt = px * d.x + pz * d.z; if (tt > 0 && tt < t && Math.hypot(org.x + d.x * tt - c.x, org.z + d.z * tt - c.z) < 1.6) { onHitCop(c); t = tt; break; } }
      if (i < 3 || w.pellets === 1) addTracer(org.clone().addScaledVector(d, 0.8), org.clone().addScaledVector(d, t));
    }
    // peds nearby flee
    for (const q of peds.list) { if (q.state === 'ok' && Math.hypot(q.x - p.x, q.z - p.z) < 40 && q.kind !== 'lie' && peds.scare) peds.scare(q, p); }
    return { melee: false };
  }

  function update(dt, owner) {
    time += dt; cd = Math.max(0, cd - dt); kick = Math.max(0, kick - dt * 6);
    if (reloadT > 0) { reloadT -= dt; if (reloadT <= 0) { const w = WEAPONS[cur], a = ammo[cur]; const n = Math.min(w.mag - a.mag, a.reserve); a.mag += n; a.reserve -= n; } }
    for (let i = fx.length - 1; i >= 0; i--) { fx[i].t -= dt; if (fx[i].t <= 0) { fx[i].o.removeFromParent(); fx[i].o.geometry.dispose(); fx.splice(i, 1); } }
    syncFlash(); flashT = Math.max(0, flashT - dt); flash.intensity = flashT > 0 ? 60 : 0;
    for (const k of pickups) {
      k.t += dt; k.w.rotation.y = k.t * 1.6; k.w.position.y = 0.8 + Math.sin(k.t * 2) * 0.1;
      const near = Math.abs(k.x - owner.x) < 130 && Math.abs(k.z - owner.z) < 130;
      k.g.visible = near && k.taken <= 0;
      if (k.taken > 0) { k.taken -= dt; continue; }
      if (near && Math.hypot(k.x - owner.x, k.z - owner.z) < 1.6 && !owner.inside) { give(k.type, 1); k.taken = 90; click(1200); if (owner.onPickup) owner.onPickup(WEAPONS[k.type].name); }
    }
  }

  return {
    inv, ammo, give, select, cycle, reload, fire, update, placePickups, getMesh, flash,
    get current() { return cur; }, get def() { return WEAPONS[cur]; }, get reloading() { return reloadT > 0; }, get kick() { return kick; }, get cooldown() { return cd; },
    get cooling() { return cd > 0; }, bang, click, pickups, weaponMesh,
    hudText() { const w = WEAPONS[cur]; if (w.melee) return w.name; const a = ammo[cur]; return `${w.name}  ${reloadT > 0 ? 'RELOADING' : a.mag + ' / ' + a.reserve}`; },
  };
}
