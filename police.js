// =============================================================================
// police.js  -  Grand Larceny Auto 1  -  Update 1.1
// Wanted stars, police pursuit AI, synthesized sirens, escape timer, BUSTED.
// ES module. No external assets. THREE is passed in via Police.init().
//
// Conventions (change in CONFIG if your game differs):
//   - A car faces +Z in local space (forward = (sin h, cos h), h = rotation.y)
//   - Units are metres / seconds
// =============================================================================

const CONFIG = {
  heat: { pedestrian: 25, carTheft: 20, policeCrash: 70 },
  starThresholds: [1, 60, 120, 200, 300],   // heat needed for stars 1..5
  baseChaseRadius: 80,                      // patrol cars this close join the chase
  radiusPerStar: 30,                        // ...plus this per star
  chaserTarget: [0, 2, 3, 5, 7, 9],         // desired active chasers per star level
  maxBackups: 8,                            // cap on spawned backup cruisers
  backupInterval: 3,                        // seconds between backup spawns
  spawnMin: 70, spawnMax: 130,              // backup spawn ring around the player
  baseSpeed: 20, speedPerStar: 2.5,         // chase top speed = base + stars * perStar
  turnRate: 2.6,                            // rad/s at speed
  carRadius: 1.6,                           // collision radius vs. buildings
  escapeTime: 15,                           // seconds hidden before stars clear
  sightRadius: 70, closeSightRadius: 20,    // line-of-sight range / always-seen range
  bustedTime: 3,                            // seconds trapped to be busted
  bustedSpeed: 1.5,                         // "near zero speed"
  bustedRadius: 8, bustedCops: 1,           // cops needed within radius
  bustedScreenTime: 3.5,                    // how long the BUSTED screen stays
  crashRadius: 3.2, crashSpeed: 8,          // player ramming a cruiser
  sirenRange: 160, volumeScale: 0.18,       // siren audibility / master loudness
};

export const Police = (() => {
  let THREE, scene, camera, opt = {}, cfg = CONFIG;
  let cars = [];
  let colliders = [];
  let heat = 0, stars = 0, hidden = 0, arrest = 0;
  let state = 'free';                       // 'free' | 'busted'
  let bustedT = 0, time = 0, active = true;
  let lastCrash = -99, spawnT = 0, msgT = 0, sightT = 0, seen = true;
  const pos = { x: 0, y: 0, z: 0 };
  let havePrev = false, pSpeed = 0, pvx = 0, pvz = 0;
  let hud = {}, audio = null;
  let redMat, blueMat, unitBox, cruiserMats, cruiserGeo, flashPhase = -1;

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const angDiff = (a, b) => ((a - b + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;

  // ---------------------------------------------------------------- collision
  function blocked(x, z, r) {
    if (opt.isBlocked && opt.isBlocked(x, z, r)) return true;   // e.g. open water
    for (let i = 0; i < colliders.length; i++) {
      const b = colliders[i];
      if (x > b.min.x - r && x < b.max.x + r && z > b.min.z - r && z < b.max.z + r) return true;
    }
    return false;
  }

  function segHitsBox(ax, az, bx, bz, b) {
    let t0 = 0, t1 = 1;
    const dx = bx - ax, dz = bz - az;
    if (Math.abs(dx) < 1e-9) { if (ax < b.min.x || ax > b.max.x) return false; }
    else {
      let a = (b.min.x - ax) / dx, c = (b.max.x - ax) / dx;
      if (a > c) { const t = a; a = c; c = t; }
      t0 = Math.max(t0, a); t1 = Math.min(t1, c); if (t0 > t1) return false;
    }
    if (Math.abs(dz) < 1e-9) { if (az < b.min.z || az > b.max.z) return false; }
    else {
      let a = (b.min.z - az) / dz, c = (b.max.z - az) / dz;
      if (a > c) { const t = a; a = c; c = t; }
      t0 = Math.max(t0, a); t1 = Math.min(t1, c); if (t0 > t1) return false;
    }
    return true;
  }

  function lineBlocked(ax, az, bx, bz) {
    for (let i = 0; i < colliders.length; i++) if (segHitsBox(ax, az, bx, bz, colliders[i])) return true;
    return false;
  }

  // ----------------------------------------------------------------- vehicles
  function buildSharedAssets() {
    redMat = new THREE.MeshBasicMaterial({ color: 0xff1020 });
    blueMat = new THREE.MeshBasicMaterial({ color: 0x1a50ff });
    unitBox = new THREE.BoxGeometry(1, 1, 1);
    const m = (c) => new THREE.MeshLambertMaterial({ color: c });
    cruiserMats = { body: m(0x15181f), door: m(0xf2f2f2), glass: m(0x1b2430), wheel: m(0x080808) };
    cruiserGeo = {
      body: new THREE.BoxGeometry(2, 0.75, 4.5),
      door: new THREE.BoxGeometry(2.02, 0.5, 2.2),
      cabin: new THREE.BoxGeometry(1.7, 0.6, 2.2),
      wheel: new THREE.CylinderGeometry(0.38, 0.38, 0.3, 12),
    };
  }

  function createCruiser() {
    if (opt.createCruiser) return opt.createCruiser(THREE);
    const g = new THREE.Group();
    const add = (geo, mat, x, y, z, rz) => {
      const mesh = new THREE.Mesh(geo, mat); mesh.position.set(x, y, z);
      if (rz) mesh.rotation.z = rz; g.add(mesh); return mesh;
    };
    add(cruiserGeo.body, cruiserMats.body, 0, 0.75, 0);
    add(cruiserGeo.door, cruiserMats.door, 0, 0.75, 0);
    add(cruiserGeo.cabin, cruiserMats.glass, 0, 1.45, -0.2);
    for (const sx of [-1, 1]) for (const sz of [-1.4, 1.4])
      add(cruiserGeo.wheel, cruiserMats.wheel, sx * 1.0, 0.38, sz, Math.PI / 2);
    return g;
  }

  function ensureLightBar(car) {
    if (car._bar) { car._bar.visible = true; return; }
    const m = car.mesh;
    let roof = m.userData.roofY, w = m.userData.barWidth;       // models.js supplies exact roof height / bar width
    if (roof === undefined || w === undefined) {
      const rot = m.rotation.y; m.rotation.y = 0; m.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(m);
      m.rotation.y = rot; m.updateMatrixWorld(true);
      const size = box.getSize(new THREE.Vector3());
      const sc = m.scale.y || 1;
      roof = (box.max.y - m.position.y) / sc;
      w = Math.min(size.x, size.z) / (m.scale.x || 1);
    }
    const bar = new THREE.Group();
    const mk = (mat, x) => {
      const l = new THREE.Mesh(unitBox, mat);
      l.scale.set(w * 0.32, 0.12, 0.3); l.position.set(x, 0, 0); bar.add(l);
    };
    mk(redMat, -w * 0.2); mk(blueMat, w * 0.2);
    bar.position.set(0, roof + 0.06, 0);
    m.add(bar); car._bar = bar;
  }

  function registerCar(car) {
    if (!car || !car.mesh || cars.includes(car)) return car;
    car._h = car.mesh.rotation.y; car._v = 0; car._stuck = 0; car._rev = 0;
    car.chasing = false; cars.push(car);
    return car;
  }

  function unregisterCar(car) {
    const i = cars.indexOf(car); if (i >= 0) cars.splice(i, 1);
  }

  function startChase(car) {
    car.chasing = true; car.leaving = false;
    car._h = car.mesh.rotation.y; car._v = car.speed || car._v || 0;
    ensureLightBar(car);
  }

  function stopChase(car) {
    car.chasing = false;
    if (car._bar) car._bar.visible = false;
    if (car.isBackup) { car.leaving = true; car.leaveT = 0; }
  }

  function removeCar(car) {
    unregisterCar(car);
    if (car.mesh.parent) car.mesh.parent.remove(car.mesh);
  }

  // ---------------------------------------------------------------- driving AI
  function drive(car, tx, tz, maxV, dt, mayStick) {
    const m = car.mesh, p = m.position;
    let h = car._h, v = car._v;
    let want = Math.atan2(tx - p.x, tz - p.z);
    const L = 5 + Math.abs(v) * 0.6, r = cfg.carRadius;
    const probe = (a, d) => blocked(p.x + Math.sin(h + a) * d, p.z + Math.cos(h + a) * d, r);
    const c = probe(0, L) || probe(0, L * 0.5);
    const l = probe(0.65, L * 0.8), rt = probe(-0.65, L * 0.8);
    let slow = 1;
    if (c || l || rt) {
      slow = 0.45;
      if (c) {
        if (!l && rt) want = h + 1.1;
        else if (l && !rt) want = h - 1.1;
        else if (!l && !rt) want = h + (angDiff(want, h) >= 0 ? 1.1 : -1.1);
        else { want = h + 1.1; slow = 0.2; }
      } else if (l) want = h - 0.7;
      else want = h + 0.7;
    }

    if (car._rev > 0) {                          // unstick: back up while swinging the nose
      car._rev -= dt;
      v += clamp(-5 - v, -30 * dt, 30 * dt);
      h += (car._revDir || 1) * 1.2 * dt;
    } else {
      const diff = angDiff(want, h);
      const rate = cfg.turnRate * Math.min(1, 0.25 + Math.abs(v) / 8);
      h += clamp(diff, -rate * dt, rate * dt);
      const target = maxV * slow * (1 - Math.min(0.6, Math.abs(diff) / Math.PI * 0.9));
      v += clamp(target - v, -26 * dt, 14 * dt);
    }

    const nx = p.x + Math.sin(h) * v * dt, nz = p.z + Math.cos(h) * v * dt;
    if (blocked(nx, nz, r * 0.8)) { v *= -0.1; car._stuck += dt * 2; }
    else { p.x = nx; p.z = nz; }

    if (mayStick && Math.abs(v) < 1.2 && maxV > 3) car._stuck += dt;
    else car._stuck = Math.max(0, car._stuck - dt);
    if (car._stuck > 1 && car._rev <= 0) { car._rev = 0.9; car._revDir = Math.random() < 0.5 ? -1 : 1; car._stuck = 0; }

    if (opt.getGroundY) p.y = opt.getGroundY(p.x, p.z) + (car._yOff || 0);
    m.rotation.y = h; car._h = h; car._v = v; car.speed = v;
  }

  function chase(car, dt) {
    const p = car.mesh.position;
    const dx = pos.x - p.x, dz = pos.z - p.z, d = Math.hypot(dx, dz);
    let maxV = cfg.baseSpeed + stars * cfg.speedPerStar;
    let tx = pos.x, tz = pos.z;
    if (d > 15) { tx += pvx * 0.4; tz += pvz * 0.4; }          // lead the target a little
    if (d < 10) maxV = Math.max(0, pSpeed) + 2;                // box the player in
    if (d < 7 && pSpeed < 2) maxV = 0;
    drive(car, tx, tz, maxV, dt, d > 9);
  }

  function separate() {
    for (let i = 0; i < cars.length; i++) for (let j = i + 1; j < cars.length; j++) {
      const a = cars[i].mesh.position, b = cars[j].mesh.position;
      const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
      if (d > 0.01 && d < 3.4 && (cars[i].chasing || cars[j].chasing)) {
        const push = (3.4 - d) / 2 / d;
        if (!blocked(a.x - dx * push, a.z - dz * push, 1)) { a.x -= dx * push; a.z -= dz * push; }
        if (!blocked(b.x + dx * push, b.z + dz * push, 1)) { b.x += dx * push; b.z += dz * push; }
      }
    }
  }

  // ------------------------------------------------------------- wanted logic
  function starsFromHeat(h) {
    let s = 0;
    for (let i = 0; i < cfg.starThresholds.length; i++) if (h >= cfg.starThresholds[i]) s = i + 1;
    return s;
  }

  function reportCrime(type) {
    if (!active || state === 'busted') return;
    heat += cfg.heat[type] || 10;
    const old = stars;
    stars = starsFromHeat(heat);
    hidden = 0; seen = true; arrest = 0;
    if (stars > old) {
      flashMessage(stars + (stars === 1 ? ' STAR' : ' STARS') + ' WANTED', 2);
      if (opt.onWantedChange) opt.onWantedChange(stars);
    }
  }

  function clearWanted(message) {
    const had = stars > 0;
    heat = 0; stars = 0; hidden = 0; arrest = 0;
    for (const c of cars) if (c.chasing) stopChase(c);
    if (had) {
      if (message) flashMessage(message, 2.5);
      if (opt.onWantedChange) opt.onWantedChange(0);
    }
  }

  function pullInCops() {
    const radius = cfg.baseChaseRadius + cfg.radiusPerStar * stars;
    for (const c of cars) {
      if (c.chasing || c.leaving) continue;
      const p = c.mesh.position;
      if (Math.hypot(p.x - pos.x, p.z - pos.z) < radius) startChase(c);
    }
  }

  function pickSpawn() {
    const nodes = opt.roadNodes;
    for (let i = 0; i < 24; i++) {
      let x, y, z;
      if (nodes && nodes.length) { const n = nodes[(Math.random() * nodes.length) | 0]; x = n.x; y = n.y; z = n.z; }
      else {
        const a = Math.random() * Math.PI * 2, d = cfg.spawnMin + Math.random() * (cfg.spawnMax - cfg.spawnMin);
        x = pos.x + Math.sin(a) * d; z = pos.z + Math.cos(a) * d; y = pos.y;
      }
      const d = Math.hypot(x - pos.x, z - pos.z);
      if (d < cfg.spawnMin || d > cfg.spawnMax || blocked(x, z, 3)) continue;
      if (opt.getGroundY) y = opt.getGroundY(x, z);
      return { x, y, z };
    }
    return null;
  }

  function spawnBackup() {
    const s = pickSpawn(); if (!s) return;
    const mesh = createCruiser();
    mesh.position.set(s.x, s.y, s.z);
    mesh.rotation.y = Math.atan2(pos.x - s.x, pos.z - s.z);
    scene.add(mesh);
    const car = registerCar({ mesh, isBackup: true });
    startChase(car);
  }

  function maintainBackups(dt) {
    spawnT -= dt;
    const chasers = cars.filter(c => c.chasing).length;
    const backups = cars.filter(c => c.isBackup).length;
    if (chasers < cfg.chaserTarget[stars] && backups < cfg.maxBackups && spawnT <= 0) {
      spawnBackup(); spawnT = cfg.backupInterval;
    }
  }

  function updateSight(dt) {
    sightT -= dt;
    if (sightT <= 0) {
      sightT = 0.25; seen = false;
      for (const c of cars) {
        if (!c.chasing) continue;
        const p = c.mesh.position, d = Math.hypot(p.x - pos.x, p.z - pos.z);
        if (d < cfg.closeSightRadius || (d < cfg.sightRadius && !lineBlocked(p.x, p.z, pos.x, pos.z))) { seen = true; break; }
      }
    }
    if (seen) hidden = 0; else hidden += dt;
    if (hidden >= cfg.escapeTime) clearWanted('WANTED LEVEL CLEARED');
  }

  function detectCrashes() {
    if (pSpeed < cfg.crashSpeed || time - lastCrash < 2) return;
    for (const c of cars) {
      const p = c.mesh.position;
      if (Math.abs(p.y - pos.y) < 3 && Math.hypot(p.x - pos.x, p.z - pos.z) < cfg.crashRadius) {
        lastCrash = time; c._v *= 0.3; reportCrime('policeCrash'); return;
      }
    }
  }

  function updateArrest(dt) {
    let near = 0;
    for (const c of cars) {
      if (!c.chasing) continue;
      const p = c.mesh.position;
      if (Math.hypot(p.x - pos.x, p.z - pos.z) < cfg.bustedRadius) near++;
    }
    if (stars > 0 && pSpeed < cfg.bustedSpeed && near >= cfg.bustedCops) arrest += dt;
    else arrest = Math.max(0, arrest - dt * 1.5);
    if (arrest >= cfg.bustedTime) startBusted();
  }

  function startBusted() {
    state = 'busted'; bustedT = cfg.bustedScreenTime; arrest = 0;
    if (hud.busted) hud.busted.classList.add('show');
    if (opt.onBusted) opt.onBusted();
  }

  function finishBusted() {
    clearWanted();
    for (const c of cars.filter(c => c.isBackup)) removeCar(c);
    if (opt.respawn) opt.respawn();
    havePrev = false; pSpeed = 0;
    state = 'free';
    if (hud.busted) hud.busted.classList.remove('show');
  }

  // --------------------------------------------------------------- player data
  function trackPlayer(dt) {
    const p = opt.getPlayerPosition();
    const dx = p.x - pos.x, dz = p.z - pos.z;
    const d = Math.hypot(dx, dz);
    if (havePrev && d < 30 && dt > 0) {          // ignore teleports (respawn etc.)
      const s = d / dt, k = Math.min(1, dt * 10);
      pSpeed += (s - pSpeed) * k; pvx += (dx / dt - pvx) * k; pvz += (dz / dt - pvz) * k;
    } else { pSpeed = 0; pvx = 0; pvz = 0; }
    pos.x = p.x; pos.y = p.y || 0; pos.z = p.z; havePrev = true;
  }

  // ---------------------------------------------------------------------- HUD
  function flashMessage(text, secs) {
    if (hud.msg) hud.msg.textContent = text;
    msgT = secs;
  }

  function updateHud(dt) {
    if (!hud.root) return;
    const on = active && stars > 0 && state === 'free';
    hud.root.classList.toggle('active', on);
    hud.root.classList.toggle('cooldown', on && hidden > 0.5);
    if (hud.stars) for (let i = 0; i < hud.stars.length; i++) hud.stars[i].classList.toggle('on', i < stars);
    if (msgT > 0) msgT -= dt;
    if (hud.msg) {
      if (msgT > 0) { /* keep flashed text */ }
      else if (on && hidden > 0.5) hud.msg.textContent = 'LOSING THE COPS... ' + Math.ceil(cfg.escapeTime - hidden);
      else hud.msg.textContent = '';
    }
    if (hud.arrest) {
      const show = arrest > 0.05 && state === 'free';
      hud.arrest.classList.toggle('show', show);
      if (hud.arrestFill) hud.arrestFill.style.width = Math.min(100, arrest / cfg.bustedTime * 100) + '%';
    }
  }

  function updateLights() {
    const phase = Math.floor(time * 8) % 2;
    if (phase === flashPhase) return;
    flashPhase = phase;
    redMat.color.setHex(phase ? 0xff1020 : 0x330408).multiplyScalar(phase ? 2.6 : 1);   // >1 so the bloom pass makes them glow
    blueMat.color.setHex(phase ? 0x061440 : 0x2a60ff).multiplyScalar(phase ? 1 : 2.6);
  }

  // -------------------------------------------------------------------- audio
  function initAudio() {
    if (audio) { if (audio.ctx.state === 'suspended') audio.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const master = ctx.createGain(); master.gain.value = 0;
    const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 2400;
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    filter.connect(master);
    if (pan) { master.connect(pan); pan.connect(ctx.destination); } else master.connect(ctx.destination);
    const lfos = [];
    const voice = (type, base, depth, rate, gain) => {
      const osc = ctx.createOscillator(); osc.type = type; osc.frequency.value = base;
      const lfo = ctx.createOscillator(); lfo.frequency.value = rate;
      const lg = ctx.createGain(); lg.gain.value = depth;
      const g = ctx.createGain(); g.gain.value = gain;
      lfo.connect(lg); lg.connect(osc.frequency);
      osc.connect(g); g.connect(filter);
      osc.start(); lfo.start(); lfos.push(lfo);
    };
    voice('sawtooth', 850, 350, 0.45, 0.5);
    voice('square', 1700, 700, 0.45, 0.12);
    voice('sawtooth', 790, 300, 0.37, 0.3);        // second "car", out of phase
    audio = { ctx, master, pan, lfos, yelp: false };
  }

  function updateAudio() {
    if (!audio) return;
    const t = audio.ctx.currentTime;
    let target = 0, nearest = Infinity, nc = null;
    const chasing = active && state === 'free' && stars > 0;
    if (chasing) {
      for (const c of cars) {
        if (!c.chasing) continue;
        const p = c.mesh.position, d = Math.hypot(p.x - pos.x, p.z - pos.z);
        if (d < nearest) { nearest = d; nc = c; }
      }
    }
    if (nc) {
      const vol = clamp(opt.getVolume ? opt.getVolume() : 1, 0, 1);
      const prox = clamp(1 - nearest / cfg.sirenRange, 0.12, 1);
      target = vol * cfg.volumeScale * prox * (hidden > 8 ? 0.6 : 1);
      if (audio.pan && camera) {
        const v = new THREE.Vector3().copy(nc.mesh.position).sub(camera.position).normalize();
        const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
        audio.pan.pan.setTargetAtTime(clamp(v.dot(right), -1, 1), t, 0.1);
      }
    }
    audio.master.gain.setTargetAtTime(target, t, 0.15);
    const yelp = stars >= 4;                        // faster "yelp" at 4-5 stars
    if (yelp !== audio.yelp) {
      audio.yelp = yelp;
      const rates = yelp ? [3.2, 3.2, 2.7] : [0.45, 0.45, 0.37];
      audio.lfos.forEach((l, i) => l.frequency.setTargetAtTime(rates[i], t, 0.2));
    }
  }

  // --------------------------------------------------------------------- main
  function update(dt) {
    if (!active) return;
    dt = Math.min(dt, 0.1); time += dt;
    trackPlayer(dt);
    updateLights();

    if (state === 'busted') {
      bustedT -= dt;
      if (bustedT <= 0) finishBusted();
      updateAudio(); updateHud(dt); return;
    }

    detectCrashes();
    if (stars > 0) { pullInCops(); maintainBackups(dt); }

    for (const c of cars.slice()) {
      if (c.chasing) chase(c, dt);
      else if (c.leaving) {                         // released backups drive off, then vanish
        c.leaveT += dt;
        const p = c.mesh.position;
        drive(c, p.x + Math.sin(c._h) * 30, p.z + Math.cos(c._h) * 30, 8, dt, true);
        if (c.leaveT > 12 || Math.hypot(p.x - pos.x, p.z - pos.z) > 160) removeCar(c);
      }
    }
    separate();
    if (stars > 0) { updateSight(dt); updateArrest(dt); }
    updateAudio(); updateHud(dt);
  }

  function init(options) {
    opt = options; THREE = options.THREE; scene = options.scene; camera = options.camera;
    cfg = Object.assign({}, CONFIG, options.config || {});
    colliders = options.colliders || [];
    buildSharedAssets();
    const $ = (id) => document.getElementById(id);
    hud = {
      root: $('police-hud'), stars: $('wanted-stars') ? $('wanted-stars').children : null,
      msg: $('wanted-msg'), arrest: $('arrest-meter'), arrestFill: $('arrest-fill'), busted: $('busted-screen'),
    };
    (options.policeCars || []).forEach(registerCar);
    const unlock = () => initAudio();              // browsers need a user gesture first
    ['pointerdown', 'keydown', 'touchstart'].forEach(e => window.addEventListener(e, unlock));
    return Police;
  }

  function reset() {
    clearWanted();
    for (const c of cars.filter(c => c.isBackup)) removeCar(c);
    state = 'free'; arrest = 0; hidden = 0; havePrev = false; msgT = 0;
    if (hud.busted) hud.busted.classList.remove('show');
  }

  function setActive(on) {
    active = on;
    if (!on) {
      if (audio) audio.master.gain.setTargetAtTime(0, audio.ctx.currentTime, 0.05);
      if (hud.root) hud.root.classList.remove('active');
    }
  }

  return {
    init, update, reportCrime, registerCar, unregisterCar, reset, setActive,
    getCops: () => cars.filter(c => c.chasing).map(c => c.mesh.position),
    getStars: () => stars, isBusted: () => state === 'busted', isWanted: () => stars > 0,
    clearWanted: () => clearWanted(),
  };
})();

if (typeof window !== 'undefined') window.Police = Police;
