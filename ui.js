// ui.js - main menu, settings (graphics / sensitivity / volume), full-screen city map, news screen.
import { ROAD_W } from './world.js';
import { isTouchDevice } from './mobile.js';

const NEWS = [
  ['Council approves third bridge to South Cape', 'Commuters rejoice as the new span links Downtown with the Cape. Police warn that bridge chases "are a bad idea for everyone".'],
  ['Blacktop PD: "Our cruisers are not free rides"', 'The department reminds citizens that car theft draws an immediate response. Backup units are on standby across all four islands.'],
  ['East Bay beaches packed as clouds roll in', 'Sunbathers refuse to leave despite a grey sky. Lifeguards report one very confused seagull.'],
  ['Mayor opens West Harbor promenade', 'Palm trees, new lamps and a very long ribbon. Traffic on the harbor road is expected to be "mostly fine".'],
  ['Truck drivers demand wider lanes', 'Union says Blacktop\'s 14 metre roads were designed "by someone who has never seen a truck".'],
  ['Weather: cloudy with a chance of sirens', 'Overcast all week. Visibility is fine - ask anyone being chased.'],
];

export function createUI(world, hooks) {
  const $ = (id) => document.getElementById(id);
  const settings = { gfx: 'high', sens: 5, vol: 70 };
  let hadSaved = false;
  try { const raw = localStorage.getItem('gla1-settings'); if (raw) { hadSaved = true; Object.assign(settings, JSON.parse(raw)); } } catch (e) { /* storage blocked */ }
  if (!hadSaved && isTouchDevice) settings.gfx = 'low';   // phones start on Low for smooth play
  const save = () => { try { localStorage.setItem('gla1-settings', JSON.stringify(settings)); } catch (e) { /* ignore */ } };
  const stats = { crimes: 0, busts: 0, maxStars: 0, escapes: 0 };
  let menuOpen = true, mapOpen = false, started = false;

  // ---------------------------------------------------------------- views
  const showView = (name) => {
    document.querySelectorAll('#menu .view').forEach(v => v.classList.toggle('hidden', v.id !== 'v-' + name));
    if (name === 'news') renderNews();
  };
  function openMenu(view = 'main') {
    menuOpen = true; $('menu').classList.remove('hidden'); showView(view);
    $('btn-play').textContent = started ? 'RESUME' : 'PLAY';
  }
  function closeMenu() { menuOpen = false; $('menu').classList.add('hidden'); }

  function renderNews() {
    const box = $('news-list'); box.innerHTML = '';
    const live = stats.crimes
      ? `LIVE: ${stats.crimes} crime${stats.crimes > 1 ? 's' : ''} reported this session; ${stats.busts} arrest${stats.busts === 1 ? '' : 's'}, ${stats.escapes} suspect${stats.escapes === 1 ? '' : 's'} escaped. Peak alert level: ${stats.maxStars} star${stats.maxStars === 1 ? '' : 's'}.`
      : 'LIVE: Blacktop is quiet. Suspiciously quiet.';
    const items = [['BREAKING', live], ...NEWS];
    for (const [h, b] of items) {
      const d = document.createElement('div'); d.className = 'news-item';
      const t = document.createElement('h3'); t.textContent = h;
      const p = document.createElement('p'); p.textContent = b;
      d.append(t, p); box.append(d);
    }
  }

  // ------------------------------------------------------------- settings
  const gfx = $('set-gfx'), sens = $('set-sens'), vol = $('set-vol');
  gfx.value = settings.gfx; sens.value = settings.sens; vol.value = settings.vol;
  const labels = () => { $('lbl-sens').textContent = settings.sens; $('lbl-vol').textContent = settings.vol + '%'; };
  const changed = () => {
    settings.gfx = gfx.value; settings.sens = +sens.value; settings.vol = +vol.value;
    labels(); save(); hooks.onSettingsChange(settings);
  };
  [gfx, sens, vol].forEach(el => el.addEventListener('input', changed));
  labels();

  // ------------------------------------------------------------- buttons
  $('btn-play').onclick = () => { started = true; closeMenu(); hooks.onPlay(); };
  $('btn-settings').onclick = () => showView('settings');
  $('btn-news').onclick = () => showView('news');
  $('btn-map').onclick = () => openMap();
  document.querySelectorAll('[data-back]').forEach(b => b.onclick = () => showView('main'));
  $('map-close').onclick = () => closeMap();

  // ------------------------------------------------------------------ map
  const cv = $('map-canvas'), ctx = cv.getContext('2d');
  const B = { x0: -600, x1: 600, z0: -560, z1: 560 };
  let layer = null, sc = 1, ox = 0, oz = 0;
  const wx = (x) => ox + (x - B.x0) * sc, wz = (z) => oz + (z - B.z0) * sc;

  function buildLayer() {
    const W = cv.width = innerWidth, H = cv.height = innerHeight;
    sc = Math.min((W - 80) / (B.x1 - B.x0), (H - 120) / (B.z1 - B.z0));
    ox = (W - (B.x1 - B.x0) * sc) / 2; oz = (H - (B.z1 - B.z0) * sc) / 2 + 20;
    layer = document.createElement('canvas'); layer.width = W; layer.height = H;
    const g = layer.getContext('2d');
    g.fillStyle = '#1d4f6b'; g.fillRect(0, 0, W, H);
    for (const i of world.islands) {
      g.fillStyle = '#d9c996';
      g.fillRect(wx(i.cx - i.hw - 25), wz(i.cz - i.hd - 25), (i.hw + 25) * 2 * sc, (i.hd + 25) * 2 * sc);
      g.fillStyle = '#7e8287';
      g.fillRect(wx(i.cx - i.hw), wz(i.cz - i.hd), i.hw * 2 * sc, i.hd * 2 * sc);
    }
    g.lineCap = 'butt';
    for (const e of world.edges) {
      g.strokeStyle = e.bridge ? '#caa86a' : '#3a3d42'; g.lineWidth = Math.max(2, (e.bridge ? 18 : ROAD_W) * sc);
      g.beginPath(); g.moveTo(wx(e.a.x), wz(e.a.z)); g.lineTo(wx(e.b.x), wz(e.b.z)); g.stroke();
    }
    g.fillStyle = '#b9bcc4';
    for (const b of world.buildings) g.fillRect(wx(b.x0), wz(b.z0), (b.x1 - b.x0) * sc, (b.z1 - b.z0) * sc);
    g.fillStyle = '#fff'; g.font = 'bold 14px Arial'; g.textAlign = 'center';
    for (const i of world.islands) g.fillText(i.name.toUpperCase(), wx(i.cx), wz(i.cz - i.hd - 32));
    g.fillStyle = '#3d6fe0'; g.fillRect(wx(world.station.x) - 7, wz(world.station.z) - 7, 14, 14);
    g.fillStyle = '#fff'; g.fillText('P', wx(world.station.x), wz(world.station.z) + 5);
    const lh = (world.doors || []).find(d => d.kind === 'luna');
    if (lh) { g.fillStyle = '#ff4fa3'; g.beginPath(); g.arc(wx(lh.x), wz(lh.z), 6, 0, 7); g.fill(); g.fillStyle = '#fff'; g.fillText("LUNA'S HOUSE", wx(lh.x), wz(lh.z) - 10); }
  }
  addEventListener('resize', () => { layer = null; });

  function drawMap(player, cops, wanted, t) {
    if (!layer) buildLayer();
    ctx.drawImage(layer, 0, 0);
    if (wanted) for (const c of cops) {
      ctx.fillStyle = (Math.floor(t * 6) % 2) ? '#ff2a3a' : '#3a6bff';
      ctx.beginPath(); ctx.arc(wx(c.x), wz(c.z), 5, 0, 7); ctx.fill();
    }
    ctx.save(); ctx.translate(wx(player.x), wz(player.z)); ctx.rotate(Math.PI - player.h);
    ctx.fillStyle = '#ffd21f'; ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, -11); ctx.lineTo(8, 9); ctx.lineTo(0, 5); ctx.lineTo(-8, 9); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  function openMap() { mapOpen = true; layer = null; $('map-overlay').classList.remove('hidden'); hooks.onMapToggle(true); }
  function closeMap() { mapOpen = false; $('map-overlay').classList.add('hidden'); hooks.onMapToggle(false); }

  showView('main');
  return {
    settings, stats, openMenu, closeMenu, openMap, closeMap, drawMap,
    toggleMap() { mapOpen ? closeMap() : openMap(); },
    isMenuOpen: () => menuOpen, isMapOpen: () => mapOpen, hasStarted: () => started,
  };
}
