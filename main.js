// main.js - Grand Larceny Auto 1: game loop, player, camera, driving, crimes, police wiring.
import * as THREE from 'three';
import { buildWorld } from './world.js';
import { Traffic, Peds, makeHuman, makeVehicle, animateHuman, spinWheels } from './actors.js';
import { makeWeapon } from './models.js';
import { createInteriors } from './interior.js';
import { createWeapons, WEAPONS } from './weapons.js';
import { Boats } from './boats.js';
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
const iScene = new THREE.Scene();                      // interiors live in their own scene (world is not rendered while inside)
iScene.background = new THREE.Color(0x14121a);
iScene.add(new THREE.HemisphereLight(0xfff4e8, 0x887766, 1.1));
let activeScene = scene;
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.3, 4000);
camera.rotation.order = 'YXZ';
scene.add(camera);
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
const boats = new Boats(scene, world);
const RIDDEN = ['bike', 'jetski', 'boat'];

const player = {
  x: 10, z: 10, y: 0.17, h: 0, mode: 'foot', car: null, phase: 0, moving: false, punchT: 0,
  human: makeHuman({ female: false, skin: 0xe0ac84, shirt: 0x1d1f24, pants: 0x2a3a55, hair: 0x1b1310, jacket: 0x6b1f1f, longSleeve: true, glasses: false, quality: 'high', hairStyle: 'short' }),
  aimT: 0, latch: false,
};
scene.add(player.human.group);
const look = { yaw: 0, pitch: 0, yawOff: 0, pitchOff: 0, idle: 0, first: false };
const interiors = createInteriors(iScene);
let inside = null;                                      // { int, door } while the player is in a building
const colliders = () => (inside ? inside.int.colliders : world.colliders);
const blockedAt = (x, z, r) => {
  if (!inside) return world.isBlocked(x, z, r);
  const b = inside.int.bounds; if (x < b.x0 + r - 0.4 || x > b.x1 - r + 0.4 || z < b.z0 + r - 0.4 || z > b.z1 + r - 0.2) return true;
  return false;
};

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
  onEnter: () => { if (ui.hasStarted() && !ui.isMenuOpen() && !ui.isMapOpen()) interact(); },
  onReload: () => weapons.reload(),
  onWeapon: () => weapons.cycle(1),
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
  getPlayerPosition: () => (inside ? { x: inside.door.ox, y: 0, z: inside.door.oz } : { x: player.x, y: 0, z: player.z }),
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
let lastCopShot = 0;
const weapons = createWeapons({
  scene, getScene: () => activeScene, world, peds, getVolume: () => ui.settings.vol / 100, onCrime: crime,
  onHitCop: () => { const n = performance.now(); if (n - lastCopShot > 2500) { lastCopShot = n; crime('policeCrash'); } },
});
{ // weapon pickups scattered around the islands (two right next to the spawn point)
  const pts = [{ x: 18, z: 8 }, { x: 4, z: 20 }], rp = world.roadPoints;
  for (let i = 0; i < 40 && pts.length < 30; i++) { const q = rp[(Math.random() * rp.length) | 0], x = q.x + 7.5, z = q.z + (Math.random() - 0.5) * 6; if (!world.isBlocked(x, z, 0.8) && !world.onBridge(x, z, 0)) pts.push({ x, z }); }
  weapons.placePickups(pts);
}
const toast = (t) => { const el = $('dialogue'); if (!el) return; el.innerHTML = `<b>${t}</b>`; el.style.display = 'block'; dlg.t = 2.2; };
const dlg = { t: 0, i: 0 };
function say(name, line) { const el = $('dialogue'); if (!el) return; el.innerHTML = `<b>${name}</b><br>${line}`; el.style.display = 'block'; dlg.t = 5; }
// hand / viewmodel meshes
const handMesh = {}, viewMesh = {}; let shownW = null;
function syncWeaponMeshes() {
  const w = weapons.current;
  if (w === shownW && !weapons.weaponMesh.dirty) return;
  shownW = w; weapons.weaponMesh.dirty = false;
  for (const k in handMesh) handMesh[k].visible = false;
  for (const k in viewMesh) viewMesh[k].visible = false;
  if (WEAPONS[w].melee && w !== 'knife') return;
  if (!handMesh[w]) { handMesh[w] = makeWeapon(w); player.human.handR.add(handMesh[w]); handMesh[w].rotation.x = Math.PI / 2; handMesh[w].position.set(0, -0.02, 0.01); }
  if (!viewMesh[w]) { viewMesh[w] = makeWeapon(w); viewMesh[w].rotation.y = Math.PI; viewMesh[w].scale.setScalar(1.0); camera.add(viewMesh[w]); }
  handMesh[w].visible = true; viewMesh[w].visible = look.first;
}

function respawnPlayer() {
  if (inside) exitInterior(true);
  if (player.car) {
    if (RIDDEN.includes(player.car.type)) { scene.add(player.human.group); player.human.pose = null; player.car.mesh.rotation.z = 0; }
    if (player.car.water) boats.park(player.car); else traffic.park(player.car);
    player.car = null;
  }
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
  else if (e.code === 'KeyF') interact();
  else if (e.code === 'KeyR') weapons.reload();
  else if (/^Digit[1-6]$/.test(e.code)) weapons.select(['fists', 'knife', 'pistol', 'smg', 'shotgun', 'rifle'][+e.code[5] - 1]);
});
addEventListener('wheel', (e) => { if (ui.hasStarted() && !ui.isMenuOpen() && !ui.isMapOpen() && player.mode === 'foot') weapons.cycle(e.deltaY > 0 ? 1 : -1); }, { passive: true });
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
  for (const b of colliders()) {
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
  const bike = car.type === 'bike', offs = car.type === 'truck' ? [2.4, 0, -2.4] : bike ? [0.55, -0.55] : [1.4, -1.4], r = car.type === 'truck' ? 1.4 : bike ? 0.65 : 1.15;
  return offs.map(o => ({ x: p.x + s * o, z: p.z + c * o, r }));
};

// ------------------------------------------------------------ enter / exit car
function toggleCar() {
  if (Police.isBusted()) return;
  if (player.mode === 'car') {
    const car = player.car;
    if (Math.abs(car.speed) > 8) return;
    const h = car.mesh.rotation.y, p = car.mesh.position;
    if (car.water) {                                   // step off onto the nearest shore
      let spot = null;
      for (let r = 3; r <= 9 && !spot; r += 1.5) for (let a = 0; a < 16; a++) { const x = p.x + Math.sin(a * 0.3927) * r, z = p.z + Math.cos(a * 0.3927) * r; if (!world.isBlocked(x, z, 0.5)) { spot = { x, z }; break; } }
      if (!spot) { toast('Get closer to land to get off'); return; }
      player.x = spot.x; player.z = spot.z; scene.add(player.human.group); player.human.pose = null; car.mesh.rotation.z = 0;
      boats.park(car); player.car = null; player.mode = 'foot'; look.yaw = h; look.pitch = 0; player.y = world.groundY(player.x, player.z);
      return;
    }
    for (const side of [1, -1]) {
      const x = p.x + Math.cos(h) * 2.4 * side, z = p.z - Math.sin(h) * 2.4 * side;
      if (!world.isBlocked(x, z, 0.5) && !pushOut({ x, z }, 0.5)) { player.x = x; player.z = z; break; }
      player.x = p.x; player.z = p.z;
    }
    pushOut(player, 0.5);
    if (car.type === 'bike') { scene.add(player.human.group); player.human.pose = null; car.mesh.rotation.z = 0; }
    traffic.park(car); car.parkedT = 0; player.car = null; player.mode = 'foot';
    look.yaw = h; look.pitch = 0;
  } else {
    let best = null, bd = 5.5;
    for (const c of boats.list) {
      if (c.driven || c.ai) continue;
      const d = Math.hypot(c.mesh.position.x - player.x, c.mesh.position.z - player.z);
      if (d < bd) { bd = d; best = c; }
    }
    for (const c of traffic.cars) {
      if (c.driven) continue;
      const d = Math.hypot(c.mesh.position.x - player.x, c.mesh.position.z - player.z);
      if (d < bd) { bd = d; best = c; }
    }
    if (!best || Math.abs(best.speed) > 7) return;
    if (best.type === 'police') Police.unregisterCar(best);
    if (best.water) boats.take(best); else traffic.take(best);
    best.speed = 0; best.parkedT = 0;
    player.car = best; player.mode = 'car'; look.yawOff = 0; look.pitchOff = 0;
    if (RIDDEN.includes(best.type)) {
      if (best.rider) best.rider.group.visible = false;
      const hg = player.human.group; best.mesh.add(hg); hg.position.copy(best.mesh.userData.seat); hg.position.y = best.mesh.userData.seat.y - 0.955 + 0.02; hg.rotation.set(0, 0, 0); hg.visible = true;
      player.human.pose = 'ride'; animateHuman(player.human, 0, 0, 1 / 60);
    }
    if (!best.water) crime('carTheft');
  }
}

// ------------------------------------------------------------ buildings / interiors
function nearestDoor() {
  let best = null, bd = 3.8;
  for (const d of world.doors) { const dd = Math.min(Math.hypot(d.x - player.x, d.z - player.z), Math.hypot(d.ox - player.x, d.oz - player.z)); if (dd < bd) { bd = dd; best = d; } }
  return best;
}
function nearNpc() {
  if (!inside) return null;
  for (const n of inside.int.npcs) if (Math.hypot(n.x - player.x, n.z - player.z) < 2.4) return n;
  return null;
}
function enterInterior(d) {
  const int = interiors.get(d.kind); int.show(true);
  activeScene = iScene; scene.remove(camera); iScene.add(camera);
  iScene.add(player.human.group);
  inside = { int, door: d };
  player.x = int.spawn.x; player.z = int.spawn.z; player.h = Math.PI; player.y = 0; look.yaw = Math.PI; look.pitch = 0;
  player.human.group.position.set(player.x, 0, player.z);
  if (d.kind === 'luna') say('Luna', "Well, well... look who found my place. Come in, don't be shy.");
  else toast(d.name);
}
function exitInterior(forced) {
  if (!inside) return;
  inside.int.show(false);
  activeScene = scene; iScene.remove(camera); scene.add(camera); scene.add(player.human.group);
  player.x = inside.door.ox; player.z = inside.door.oz; player.h = 0; player.y = world.groundY(player.x, player.z); look.yaw = 0; look.pitch = 0;
  inside = null;
}
function interact() {
  if (Police.isBusted()) return;
  if (inside) {
    const n = nearNpc();
    if (n) { say(n.name, n.lines[dlg.i++ % n.lines.length]); return; }
    const e = inside.int.exit; if (Math.hypot(e.x - player.x, e.z - player.z) < 2.2) exitInterior();
    return;
  }
  if (player.mode === 'foot') { const d = nearestDoor(); if (d && !(Police.getStars() >= 4 && d.kind !== 'luna' && false)) { enterInterior(d); return; } }
  toggleCar();
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
    if (!blockedAt(nx, nz, 0.4)) { player.x = nx; player.z = nz; }
    else if (!blockedAt(nx, player.z, 0.4)) player.x = nx;
    else if (!blockedAt(player.x, nz, 0.4)) player.z = nz;
    pushOut(player, 0.45);
    player.h += clamp(angDiff(Math.atan2(mx, mz), player.h), -12 * dt, 12 * dt);
    player.phase += speed * dt * 1.6;
  }
  // ---- attack / shoot
  player.punchT = Math.max(0, player.punchT - dt); player.aimT = Math.max(0, player.aimT - dt);
  const w = weapons.def, gun = !w.melee, wantFire = (mouseDown || touch.attack) && (isTouchDevice || document.pointerLockElement === renderer.domElement);
  const camDir = camera.getWorldDirection(new THREE.Vector3());
  if (wantFire && (w.auto || !player.latch)) {
    player.latch = true;
    const origin = look.first ? camera.position.clone() : camera.position.clone().addScaledVector(camDir, camera.position.distanceTo(new THREE.Vector3(player.x, player.y + 1.4, player.z)) + 0.5);
    const r = weapons.fire({ x: player.x, z: player.z, h: player.h }, camDir, origin, Police.getCops(), look.first, colliders());
    if (r && r.melee) player.punchT = 0.4;
    if (r) { player.aimT = 1.4; if (!r.melee) weapons.flash.position.copy(origin).addScaledVector(camDir, 1.0); }
  }
  if (!wantFire) player.latch = false;
  if (gun && player.aimT > 0) player.h += clamp(angDiff(look.yaw, player.h), -14 * dt, 14 * dt);
  const hm = player.human;
  animateHuman(hm, player.phase, player.moving ? (keys.ShiftLeft || keys.ShiftRight || touch.sprint ? 0.95 : 0.75) : 0, dt, player.moving ? (keys.ShiftLeft || keys.ShiftRight || touch.sprint ? 9 : 5) : 0, player.turnRate || 0);
  if (gun) {                                           // raise the weapon arm(s)
    const up = -1.45 - look.pitch * 0.8, two = weapons.current !== 'pistol';
    hm.armR.rotation.x = up; hm.armR.rotation.z = 0.04; hm.elbowR.rotation.x = -0.04;
    if (two) { hm.armL.rotation.x = up + 0.1; hm.armL.rotation.z = 0.28; hm.elbowL.rotation.x = -0.35; }
    hm.spine.rotation.y += 0.12;
  } else if (player.punchT > 0.12) { hm.armR.rotation.x = -1.5; hm.elbowR.rotation.x = -0.1; }
  else if (player.punchT > 0) { hm.armR.rotation.x = -0.4; }
  const fy = inside ? 0 : world.groundY(player.x, player.z);
  player.y += (fy - player.y) * Math.min(1, dt * 18);
  hm.group.position.set(player.x, player.y, player.z); hm.group.rotation.y = player.h;
  hm.group.visible = !look.first;
}

function updateBoat(dt) {
  const car = player.car, m = car.mesh, p = m.position, jet = car.type === 'jetski';
  const up = keys.KeyW || keys.ArrowUp || touch.my > 0.2, down = keys.KeyS || keys.ArrowDown || touch.my < -0.2;
  const steer = clamp((keys.KeyA || keys.ArrowLeft ? 1 : 0) - (keys.KeyD || keys.ArrowRight ? 1 : 0) - touch.mx, -1, 1);
  const maxF = jet ? 32 : 25;
  let v = car.speed;
  if (up) v += (v < 0 ? 12 : (jet ? 13 : 8.5) * (1 - v / maxF)) * dt;
  else if (down) v -= (v > 0.5 ? 12 : 4) * dt;
  else v -= Math.sign(v) * Math.min(Math.abs(v), 2.2 * dt);
  if (keys.Space || touch.brake) v -= Math.sign(v) * Math.min(Math.abs(v), 14 * dt);
  v = clamp(v, -6, maxF);
  let h = m.rotation.y; h += steer * (jet ? 2.0 : 1.2) / (1 + Math.abs(v) / 20) * clamp(Math.abs(v) / 3, 0, 1) * (v >= 0 ? 1 : -1) * dt;
  const ox = p.x, oz = p.z;
  p.x += Math.sin(h) * v * dt; p.z += Math.cos(h) * v * dt; m.rotation.y = h;
  if (world.onLand(p.x, p.z, jet ? 0.9 : 1.4) || Math.abs(p.x) > 1700 || Math.abs(p.z) > 1700) { p.x = ox; p.z = oz; v *= -0.25; }
  car.speed = v; boats.bob(car, dt, -steer * Math.min(1, Math.abs(v) / 14) * (jet ? 0.45 : 0.3));
  animateHuman(player.human, 0, 0, dt, Math.abs(v), -steer * 0.6); player.human.group.visible = true;
  player.x = p.x; player.z = p.z; player.h = h;
}

function updateCar(dt) {
  const car = player.car, m = car.mesh, p = m.position;
  const bike = car.type === 'bike', maxF = bike ? 38 : car.type === 'truck' ? 20 : car.type === 'police' ? 32 : 28;
  const up = keys.KeyW || keys.ArrowUp || touch.my > 0.2, down = keys.KeyS || keys.ArrowDown || touch.my < -0.2;
  const steer = clamp((keys.KeyA || keys.ArrowLeft ? 1 : 0) - (keys.KeyD || keys.ArrowRight ? 1 : 0) - touch.mx, -1, 1);
  const handbrake = keys.Space || touch.brake;
  let v = car.speed;
  if (up) v += (v < 0 ? 24 : (bike ? 15 : 11) * (1 - v / maxF)) * dt;
  else if (down) v -= (v > 0.5 ? 24 : 9) * dt;
  else v -= Math.sign(v) * Math.min(Math.abs(v), 3.5 * dt);
  if (handbrake) v -= Math.sign(v) * Math.min(Math.abs(v), 28 * dt);
  v = clamp(v, -9, maxF);
  let h = m.rotation.y;
  const rate = (bike ? 2.5 : 1.9) / (1 + Math.abs(v) / 22) * clamp(Math.abs(v) / 5, 0, 1) * (v >= 0 ? 1 : -1);
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
  if (world.isBlocked(p.x, p.z, bike ? 0.8 : 1.3)) { p.x = ox; p.z = oz; hit = true; }
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
  if (bike) {
    car.lean = (car.lean || 0) + (-steer * Math.min(1, Math.abs(v) / 14) * 0.5 - (car.lean || 0)) * Math.min(1, dt * 6); m.rotation.z = car.lean;
    animateHuman(player.human, 0, 0, dt, Math.abs(v), -steer * 0.6); player.human.group.visible = true;
  } else player.human.group.visible = false;
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
    let dist = player.mode === 'car' ? (player.car.type === 'truck' ? 11 : player.car.type === 'bike' || player.car.type === 'jetski' ? 6 : player.car.type === 'boat' ? 8 : 8.5) : inside ? 3 : 4.2;
    for (let d = 0.6; d <= dist; d += 0.5) {          // pull the camera in front of walls
      const x = tgt.x - dir.x * d, y = tgt.y - dir.y * d, z = tgt.z - dir.z * d;
      if (inside) { const b = inside.int.bounds; if (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1 + 0.3 || y > inside.int.H - 0.2) { dist = Math.max(0.8, d - 0.6); break; } continue; }
      if (y < player.y + 0.15 || world.buildings.some(b => x > b.x0 - 0.3 && x < b.x1 + 0.3 && z > b.z0 - 0.3 && z < b.z1 + 0.3 && y < b.h)) { dist = Math.max(1.2, d - 0.6); break; }
    }
    camera.position.set(tgt.x - dir.x * dist, Math.max(0.4, tgt.y - dir.y * dist), tgt.z - dir.z * dist);
    camera.lookAt(tgt);
  }
  for (const k in viewMesh) { const on = k === weapons.current && look.first && player.mode === 'foot'; viewMesh[k].visible = on; if (on) viewMesh[k].position.set(0.2, -0.2 + weapons.kick * 0.01, -0.42 + weapons.kick * 0.09); }
  for (const k in handMesh) if (k !== weapons.current || player.mode !== 'foot') handMesh[k].visible = false; else handMesh[k].visible = true;
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
  if (inside) {
    const n = nearNpc(), e = inside.int.exit;
    if (n) prompt = (isTouchDevice ? 'Tap ENTER to talk to ' : 'F  talk to ') + n.name;
    else if (Math.hypot(e.x - player.x, e.z - player.z) < 2.2) prompt = isTouchDevice ? 'Tap ENTER to leave' : 'F  leave ' + inside.door.name;
  } else if (player.mode === 'foot' && nearestDoor()) { const d = nearestDoor(); prompt = (isTouchDevice ? 'Tap ENTER to go into ' : 'F  enter ') + d.name; }
  else if (player.mode === 'car' && player.car.water) prompt = isTouchDevice ? 'Tap ENTER / EXIT to get off near land' : 'F  get off (near land)';
  else if (player.mode === 'car') prompt = isTouchDevice ? 'Tap ENTER / EXIT to leave the car' : 'F  exit vehicle';
  else {
    for (const c of boats.list) if (!c.driven && !c.ai && Math.hypot(c.mesh.position.x - player.x, c.mesh.position.z - player.z) < 5.5) { prompt = (isTouchDevice ? 'Tap ENTER to take ' : 'F  take ') + (c.type === 'jetski' ? 'jet ski' : 'speedboat'); break; }
    if (!prompt) for (const c of traffic.cars) if (!c.driven && Math.hypot(c.mesh.position.x - player.x, c.mesh.position.z - player.z) < 5.5) { prompt = (isTouchDevice ? 'Tap ENTER / EXIT to take ' : 'F  take ') + (c.type === 'police' ? 'police car' : c.type === 'bike' ? 'motorcycle' : c.type); break; }
  }
  hud.prompt.textContent = prompt;
  hud.cross.style.display = player.mode === 'foot' && (look.first || !weapons.def.melee) ? 'block' : 'none';
  const wh = $('weapon-hud'); if (wh) wh.textContent = player.mode === 'foot' ? weapons.hudText() : '';
  hud.cam.textContent = look.first ? 'FIRST PERSON (V)' : 'THIRD PERSON (V)';
  let zone = inside ? inside.door.name : 'Open Sea';
  if (!inside && world.onBridge(player.x, player.z, 0)) zone = 'Blacktop Bridge';
  if (!inside) for (const i of world.islands) if (Math.abs(player.x - i.cx) < i.hw + 25 && Math.abs(player.z - i.cz) < i.hd + 25) zone = i.name;
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
    if (!Police.isBusted()) { player.mode === 'car' ? (player.car.water ? updateBoat(dt) : updateCar(dt)) : updateFoot(dt); }
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
    peds.update(dt, focus); boats.update(dt, focus);
    Police.update(dt);
    world.update(dt, focus);
    weapons.update(dt, { x: player.x, z: player.z, inside: !!inside, onPickup: (n) => toast('Picked up: ' + n) });
    syncWeaponMeshes();
    if (inside) inside.int.update(dt, player.x, player.z, time);
    if (dlg.t > 0) { dlg.t -= dt; if (dlg.t <= 0) { const el = $('dialogue'); if (el) el.style.display = 'none'; } }
    updateEngine();
    updateHud();
  }
  updateCamera(dt);
  if (ui.isMapOpen()) ui.drawMap(player, Police.getCops(), Police.isWanted(), time);
  if (inside) renderer.render(iScene, camera); else if (post) post.composer.render(); else renderer.render(scene, camera);
}
{ const l = $('loading'); if (l) l.remove(); }
frame();
window.GLA = { Police, player, world, traffic, peds, ui, weapons, interiors, boats };   // handy for debugging in the console
