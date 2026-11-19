// main.js - Grand Larceny Auto 1: game loop, player, camera, driving, crimes, police wiring.
import * as THREE from 'three';
import { buildWorld } from './world.js';
import { Traffic, Peds, makeHuman, makeVehicle, animateHuman, spinWheels } from './actors.js';
import { createPost } from './gfx.js';
import { touch, isTouchDevice, initMobile } from './mobile.js';
import { createUI } from './ui.js';
import { Police } from './police.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const angDiff = (a, b) => ((a - b + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;

// ------------------------------------------------------------ renderer/scene
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
$('game').appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.3, 4000);
camera.rotation.order = 'YXZ';
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  if (post) post.setSize(innerWidth, innerHeight);
});
let post = null;

// ---------------------------------------------------------------- world/actors
const world = buildWorld(scene, renderer);
const traffic = new Traffic(scene, world);
const peds = new Peds(scene, world);

const player = {
  x: 10, z: 10, y: 0.17, h: 0, mode: 'foot', car: null, phase: 0, moving: false, punchT: 0,
  human: makeHuman({ female: false, skin: 0xe0ac84, shirt: 0x1d1f24, pants: 0x2a3a55, hair: 0x1b1310, jacket: 0x6b1f1f, longSleeve: true, glasses: false }),
};
scene.add(player.human.group);
const look = { yaw: 0, pitch: 0, yawOff: 0, pitchOff: 0, idle: 0, first: false };

// -------------------------------------------------------------------- UI
let paused = true, lastPaused = null;
const ui = createUI(world, {
  onPlay: () => { if (isTouchDevice) mobile.fullscreen && mobile.fullscreen(); else renderer.domElement.requestPointerLock && renderer.domElement.requestPointerLock(); },
  onSettingsChange: applyGraphics,
  onMapToggle: (open) => { if (!isTouchDevice && !open && ui.hasStarted() && !ui.isMenuOpen()) renderer.domElement.requestPointerLock(); },
});
function applyGraphics() {
  const g = ui.settings.gfx, dpr = devicePixelRatio || 1;
  renderer.setPixelRatio(g === 'low' ? 1 : g === 'medium' ? Math.min(dpr, 1.5) : Math.min(dpr, 2));
  renderer.setSize(innerWidth, innerHeight);
  world.setGraphics(g);
  if (g === 'high' && !isTouchDevice) { if (!post && !applyGraphics.loading) { applyGraphics.loading = true; createPost(renderer, scene, camera).then((p) => { post = p; applyGraphics.loading = false; if (ui.settings.gfx !== 'high') post = null; }); } else if (post) post.setSize(innerWidth, innerHeight); }
  else post = null;
}
// touch controls
const mobile = initMobile({
  onEnter: () => { if (ui.hasStarted() && !ui.isMenuOpen() && !ui.isMapOpen()) toggleCar(); },
  onCamera: () => { look.first = !look.first; },
  onMap: () => { if (ui.hasStarted() && !ui.isMenuOpen()) ui.toggleMap(); },
  onPause: () => { if (ui.hasStarted()) { ui.closeMap(); ui.openMenu('main'); } },
});
applyGraphics();

// ------------------------------------------------------------------- police
let justBusted = false;
Police.init({
  THREE, scene, camera,
  policeCars: traffic.cars.filter(c => c.type === 'police'),
  colliders: world.colliders,
  isBlocked: (x, z, r) => world.isBlocked(x, z, r),
  roadNodes: world.roadPoints,
  getPlayerPosition: () => ({ x: player.x, y: 0, z: player.z }),
  getGroundY: () => 0.05,
  getVolume: () => ui.settings.vol / 100,
  createCruiser: () => makeVehicle('police'),
  config: { crashRadius: 0 },                 // crashes are reported from main.js (accurate car shapes)
  onWantedChange: (s) => {
    ui.stats.maxStars = Math.max(ui.stats.maxStars, s);
    if (s === 0 && !justBusted) ui.stats.escapes++;
    if (s === 0) justBusted = false;
  },
  onBusted: () => { ui.stats.busts++; justBusted = true; },
  respawn: respawnPlayer,
});
function crime(type) { ui.stats.crimes++; Police.reportCrime(type); }

function respawnPlayer() {
  if (player.car) { traffic.park(player.car); player.car = null; }
  player.mode = 'foot';
  player.x = world.station.x; player.z = world.station.z; player.h = 0;
  look.yaw = 0; look.pitch = 0;
}

// --------------------------------------------------------------------- input
const keys = {};
let mouseDown = false;
addEventListener('keydown', (e) => {
  if (e.repeat) { if (['Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault(); return; }
  keys[e.code] = true;
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  if (!ui.hasStarted() || ui.isMenuOpen()) return;
  if (e.code === 'KeyM') ui.toggleMap();
  else if (ui.isMapOpen()) { if (e.code === 'Escape') ui.closeMap(); }
  else if (e.code === 'KeyV') look.first = !look.first;
  else if (e.code === 'KeyF') toggleCar();
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
addEventListener('mousedown', (e) => { if (e.button === 0) mouseDown = true; initEngine(); });
addEventListener('mouseup', (e) => { if (e.button === 0) mouseDown = false; });
function applyLook(dx, dy, scale = 1) {
  const k = (0.0003 + ui.settings.sens * 0.00045) * scale;
  if (player.mode === 'car') {
    look.yawOff = clamp(look.yawOff - dx * k, -Math.PI, Math.PI);
    look.pitchOff = clamp(look.pitchOff - dy * k, -0.8, 0.8); look.idle = 0;
  } else {
    look.yaw -= dx * k; look.pitch = clamp(look.pitch - dy * k, -1.2, 1.2);
  }
}
addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== renderer.domElement || paused) return;
  applyLook(e.movementX, e.movementY);
});
document.addEventListener('pointerlockchange', () => {
  if (!isTouchDevice && document.pointerLockElement !== renderer.domElement && ui.hasStarted() && !ui.isMapOpen()) ui.openMenu('main');
});
renderer.domElement.addEventListener('click', () => {
  if (!isTouchDevice && ui.hasStarted() && !ui.isMenuOpen() && !ui.isMapOpen() && document.pointerLockElement !== renderer.domElement)
    renderer.domElement.requestPointerLock();
});

// --------------------------------------------------------------- collisions
function pushOut(pos, r) {
  let hit = false;
  for (const b of world.colliders) {
    const { min, max } = b;
    if (pos.x < min.x - r || pos.x > max.x + r || pos.z < min.z - r || pos.z > max.z + r) continue;
    const cx = clamp(pos.x, min.x, max.x), cz = clamp(pos.z, min.z, max.z);
    const dx = pos.x - cx, dz = pos.z - cz, d = Math.hypot(dx, dz);
    if (d >= r) continue;
    if (d > 1e-6) { pos.x = cx + dx / d * r; pos.z = cz + dz / d * r; }
    else {
      const l = pos.x - min.x, rt = max.x - pos.x, t = pos.z - min.z, bt = max.z - pos.z, m = Math.min(l, rt, t, bt);
      if (m === l) pos.x = min.x - r; else if (m === rt) pos.x = max.x + r; else if (m === t) pos.z = min.z - r; else pos.z = max.z + r;
    }
    hit = true;
  }
  return hit;
}

const circlesFor = (car) => {
  const h = car.mesh.rotation.y, s = Math.sin(h), c = Math.cos(h), p = car.mesh.position;
  const offs = car.type === 'truck' ? [2.4, 0, -2.4] : [1.4, -1.4], r = car.type === 'truck' ? 1.4 : 1.15;
  return offs.map(o => ({ x: p.x + s * o, z: p.z + c * o, r }));
};

// ------------------------------------------------------------ enter / exit car
function toggleCar() {
  if (Police.isBusted()) return;
  if (player.mode === 'car') {
    const car = player.car;
    if (Math.abs(car.speed) > 8) return;
    const h = car.mesh.rotation.y, p = car.mesh.position;
    for (const side of [1, -1]) {
      const x = p.x + Math.cos(h) * 2.4 * side, z = p.z - Math.sin(h) * 2.4 * side;
      if (!world.isBlocked(x, z, 0.5) && !pushOut({ x, z }, 0.5)) { player.x = x; player.z = z; break; }
      player.x = p.x; player.z = p.z;
    }
    pushOut(player, 0.5);
    traffic.park(car); car.parkedT = 0; player.car = null; player.mode = 'foot';
    look.yaw = h; look.pitch = 0;
  } else {
    let best = null, bd = 5.5;
    for (const c of traffic.cars) {
      if (c.driven) continue;
      const d = Math.hypot(c.mesh.position.x - player.x, c.mesh.position.z - player.z);
      if (d < bd) { bd = d; best = c; }
    }
    if (!best || Math.abs(best.speed) > 7) return;
    if (best.type === 'police') Police.unregisterCar(best);
    traffic.take(best); best.speed = 0; best.parkedT = 0;
    player.car = best; player.mode = 'car'; look.yawOff = 0; look.pitchOff = 0;
    crime('carTheft');
  }
}

// ----------------------------------------------------------------- player
function updateFoot(dt) {
  const f = clamp((keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0) + touch.my, -1, 1);
  const r = clamp((keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0) + touch.mx, -1, 1);
  const sy = Math.sin(look.yaw), cy = Math.cos(look.yaw);
  let mx = sy * f - cy * r, mz = cy * f + sy * r;
  const len = Math.hypot(mx, mz), mag = Math.min(1, len);
  player.moving = len > 0.01;
  if (player.moving) {
    mx /= len; mz /= len;
    const speed = (keys.ShiftLeft || keys.ShiftRight || touch.sprint ? 9 : 5) * Math.max(0.35, mag);
    const nx = player.x + mx * speed * dt, nz = player.z + mz * speed * dt;
    if (!world.isBlocked(nx, nz, 0.4)) { player.x = nx; player.z = nz; }
    else if (!world.isBlocked(nx, player.z, 0.4)) player.x = nx;
    else if (!world.isBlocked(player.x, nz, 0.4)) player.z = nz;
    pushOut(player, 0.45);
    player.h += clamp(angDiff(Math.atan2(mx, mz), player.h), -12 * dt, 12 * dt);
    player.phase += speed * dt * 1.6;
  }
  // punch
  player.punchT = Math.max(0, player.punchT - dt);
  if ((mouseDown || touch.attack) && player.punchT <= 0 && (isTouchDevice || document.pointerLockElement === renderer.domElement)) {
    player.punchT = 0.45;
    const fx = Math.sin(look.first ? look.yaw : player.h), fz = Math.cos(look.first ? look.yaw : player.h);
    for (const p of peds.list) {
      if (p.state === 'down') continue;
      const dx = p.x - player.x, dz = p.z - player.z, d = Math.hypot(dx, dz);
      if (d < 1.9 && (dx * fx + dz * fz) / (d || 1) > 0.2 && peds.hit(p, fx * 4, fz * 4)) { crime('pedestrian'); break; }
    }
  }
  const hm = player.human;
  animateHuman(hm, player.phase, player.moving ? 0.75 : 0);
  if (player.punchT > 0.15) { hm.armR.rotation.x = -1.5; }
  player.y += (world.groundY(player.x, player.z) - player.y) * Math.min(1, dt * 18);
  hm.group.position.set(player.x, player.y, player.z); hm.group.rotation.y = player.h;
  hm.group.visible = !look.first;
}

function updateCar(dt) {
  const car = player.car, m = car.mesh, p = m.position;
  const maxF = car.type === 'truck' ? 20 : car.type === 'police' ? 32 : 28;
  const up = keys.KeyW || keys.ArrowUp || touch.my > 0.2, down = keys.KeyS || keys.ArrowDown || touch.my < -0.2;
  const steer = clamp((keys.KeyA || keys.ArrowLeft ? 1 : 0) - (keys.KeyD || keys.ArrowRight ? 1 : 0) - touch.mx, -1, 1);
  const handbrake = keys.Space || touch.brake;
  let v = car.speed;
  if (up) v += (v < 0 ? 24 : 11 * (1 - v / maxF)) * dt;
  else if (down) v -= (v > 0.5 ? 24 : 9) * dt;
  else v -= Math.sign(v) * Math.min(Math.abs(v), 3.5 * dt);
  if (handbrake) v -= Math.sign(v) * Math.min(Math.abs(v), 28 * dt);
  v = clamp(v, -9, maxF);
  let h = m.rotation.y;
  const rate = 1.9 / (1 + Math.abs(v) / 22) * clamp(Math.abs(v) / 5, 0, 1) * (v >= 0 ? 1 : -1);
  h += steer * rate * dt * (handbrake ? 1.5 : 1);
  const ox = p.x, oz = p.z;
  p.x += Math.sin(h) * v * dt; p.z += Math.cos(h) * v * dt;
  m.rotation.y = h;
  // buildings
  let hit = false;
  for (const c of circlesFor(car)) {
    const t = { x: c.x, z: c.z };
    if (pushOut(t, c.r)) { p.x += t.x - c.x; p.z += t.z - c.z; hit = true; }
  }
  if (world.isBlocked(p.x, p.z, 1.3)) { p.x = ox; p.z = oz; hit = true; }
  if (hit) v *= 0.45;
  // other vehicles
  for (const o of traffic.cars) {
    if (o === car) continue;
    const dx = o.mesh.position.x - p.x, dz = o.mesh.position.z - p.z;
    if (dx * dx + dz * dz > 100) continue;
    let pushed = false;
    for (const a of circlesFor(car)) for (const b of circlesFor(o)) {
      const ddx = b.x - a.x, ddz = b.z - a.z, d = Math.hypot(ddx, ddz), min = a.r + b.r;
      if (d < min && d > 1e-4) {
        const k = (min - d) / d;
        o.mesh.position.x += ddx * k * 0.7; o.mesh.position.z += ddz * k * 0.7;
        p.x -= ddx * k * 0.3; p.z -= ddz * k * 0.3; pushed = true;
      }
    }
    if (pushed) {
      if (o.type === 'police' && Math.abs(v) > 6 && !o.parked && (performance.now() - (updateCar.lastCrash || 0)) > 2000) {
        updateCar.lastCrash = performance.now(); crime('policeCrash');
      }
      v *= 0.7; o.speed = Math.max(0, o.speed * 0.4);
    }
  }
  // pedestrians
  if (Math.abs(v) > 3.5) {
    const fx = Math.sin(h), fz = Math.cos(h);
    for (const q of peds.list) {
      if (q.state === 'down') continue;
      const dx = q.x - p.x, dz = q.z - p.z, ahead = dx * fx + dz * fz, side = Math.abs(dx * fz - dz * fx);
      if (ahead > -1.5 && ahead < 2.8 && side < 1.4 && peds.hit(q, fx * v * 0.9 + (Math.random() - 0.5) * 3, fz * v * 0.9 + (Math.random() - 0.5) * 3)) crime('pedestrian');
    }
  }
  car.speed = v; spinWheels(car, dt);
  player.x = p.x; player.z = p.z; player.h = h;
  player.human.group.visible = false;
}

// ----------------------------------------------------------------- camera
function updateCamera(dt) {
  let pos = new THREE.Vector3(), yaw, pitch, targetY;
  if (player.mode === 'car') {
    const m = player.car.mesh, h = m.rotation.y;
    look.idle += dt;
    if (look.idle > 1.2) { const k = Math.max(0, 1 - 3 * dt); look.yawOff *= k; look.pitchOff *= k; }
    yaw = h + look.yawOff; pitch = look.pitchOff + (look.first ? 0 : -0.22); targetY = 1.8;
    if (look.first) pos.set(m.position.x + Math.cos(h) * 0.4 + Math.sin(h) * 0.3, 1.3, m.position.z - Math.sin(h) * 0.4 + Math.cos(h) * 0.3);
  } else { yaw = look.yaw; pitch = look.pitch; targetY = player.y + 1.48; if (look.first) pos.set(player.x, player.y + 1.48, player.z); }
  const dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
  if (look.first) { camera.position.copy(pos); camera.lookAt(pos.clone().add(dir)); }
  else {
    const tgt = new THREE.Vector3(player.x, targetY, player.z);
    let dist = player.mode === 'car' ? (player.car.type === 'truck' ? 11 : 8.5) : 4.2;
    for (let d = 0.6; d <= dist; d += 0.5) {          // pull the camera in front of walls
      const x = tgt.x - dir.x * d, y = tgt.y - dir.y * d, z = tgt.z - dir.z * d;
      if (y < player.y + 0.15 || world.buildings.some(b => x > b.x0 - 0.3 && x < b.x1 + 0.3 && z > b.z0 - 0.3 && z < b.z1 + 0.3 && y < b.h)) { dist = Math.max(1.2, d - 0.6); break; }
    }
    camera.position.set(tgt.x - dir.x * dist, Math.max(0.4, tgt.y - dir.y * dist), tgt.z - dir.z * dist);
    camera.lookAt(tgt);
  }
}

// ------------------------------------------------------------- engine audio
let eng = null;
function initEngine() {
  if (eng) { if (eng.ctx.state === 'suspended') eng.ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
  const ctx = new AC(), osc = ctx.createOscillator(), lp = ctx.createBiquadFilter(), gain = ctx.createGain();
  osc.type = 'sawtooth'; lp.type = 'lowpass'; lp.frequency.value = 420; gain.gain.value = 0;
  osc.connect(lp); lp.connect(gain); gain.connect(ctx.destination); osc.start();
  eng = { ctx, osc, gain };
}
addEventListener('keydown', initEngine, { once: true });
function updateEngine() {
  if (!eng) return;
  const inCar = player.mode === 'car' && !paused, v = inCar ? Math.abs(player.car.speed) : 0;
  const t = eng.ctx.currentTime;
  eng.osc.frequency.setTargetAtTime(42 + v * 4.2, t, 0.08);
  eng.gain.gain.setTargetAtTime(inCar ? ui.settings.vol / 100 * 0.05 * (0.4 + Math.min(1, v / 25)) : 0, t, 0.1);
}

// --------------------------------------------------------------------- HUD
const hud = { clock: $('clock'), speed: $('speed'), prompt: $('prompt'), cross: $('crosshair'), zone: $('zone'), cam: $('camtag') };
function updateHud() {
  hud.clock.textContent = world.env.clock();
  mobile.setMode(player.mode);
  hud.speed.textContent = player.mode === 'car' ? Math.round(Math.abs(player.car.speed) * 3.6) + ' km/h' : '';
  let prompt = '';
  if (player.mode === 'car') prompt = isTouchDevice ? 'Tap ENTER / EXIT to leave the car' : 'F  exit vehicle';
  else {
    for (const c of traffic.cars) if (!c.driven && Math.hypot(c.mesh.position.x - player.x, c.mesh.position.z - player.z) < 5.5) { prompt = (isTouchDevice ? 'Tap ENTER / EXIT to take ' : 'F  take ') + (c.type === 'police' ? 'police car' : c.type); break; }
  }
  hud.prompt.textContent = prompt;
  hud.cross.style.display = look.first && player.mode === 'foot' ? 'block' : 'none';
  hud.cam.textContent = look.first ? 'FIRST PERSON (V)' : 'THIRD PERSON (V)';
  let zone = 'Open Sea';
  if (world.onBridge(player.x, player.z, 0)) zone = 'Blacktop Bridge';
  for (const i of world.islands) if (Math.abs(player.x - i.cx) < i.hw + 25 && Math.abs(player.z - i.cz) < i.hd + 25) zone = i.name;
  hud.zone.textContent = zone;
}

// ----------------------------------------------------------- main loop
const clock = new THREE.Clock();
const focus = new THREE.Vector3();
let time = 0;
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);
  paused = !ui.hasStarted() || ui.isMenuOpen() || ui.isMapOpen();
  if (paused !== lastPaused) { Police.setActive(!paused); lastPaused = paused; }
  if (!paused) {
    time += dt;
    if (touch.lookX || touch.lookY) { applyLook(touch.lookX, touch.lookY, 1.4); touch.lookX = touch.lookY = 0; }
    if (!Police.isBusted()) { player.mode === 'car' ? updateCar(dt) : updateFoot(dt); }
    const blockers = [{ x: player.x, z: player.z }];
    for (const p of peds.list) if (p.state !== 'down' && p.kind !== 'lie') blockers.push(p);
    const extra = [];
    for (const c of traffic.cars) if (c.parked) extra.push({ x: c.mesh.position.x, z: c.mesh.position.z });
    traffic.update(dt, blockers, extra);
    for (const c of traffic.cars.slice()) {           // abandoned cars eventually vanish, new traffic spawns
      if (!c.parked || c.driven) continue;
      c.parkedT = (c.parkedT || 0) + dt;
      if (c.parkedT > 45 && Math.hypot(c.mesh.position.x - player.x, c.mesh.position.z - player.z) > 90) {
        scene.remove(c.mesh); traffic.cars.splice(traffic.cars.indexOf(c), 1);
        const n = traffic.spawn(c.type, { x: player.x, z: player.z });
        if (n && n.type === 'police') Police.registerCar(n);
      }
    }
    focus.set(player.x, 0, player.z);
    peds.update(dt, focus);
    Police.update(dt);
    world.update(dt, focus);
    updateEngine();
    updateHud();
  }
  updateCamera(dt);
  if (ui.isMapOpen()) ui.drawMap(player, Police.getCops(), Police.isWanted(), time);
  if (post) post.composer.render(); else renderer.render(scene, camera);
}
{ const l = $('loading'); if (l) l.remove(); }
frame();
window.GLA = { Police, player, world, traffic, peds, ui };   // handy for debugging in the console
