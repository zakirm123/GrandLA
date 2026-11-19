// mobile.js - Update 1.2 touch controls: floating joystick, drag-to-look, action buttons.
// Shared state is read by main.js every frame (see `touch`). Nothing here touches the game directly.

export const isTouchDevice = (() => {
  try { return matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window || navigator.maxTouchPoints > 0; } catch (e) { return false; }
})();

export const touch = {
  mx: 0, my: 0,            // joystick: x right, y up (-1..1)
  lookX: 0, lookY: 0,      // pending look drag in pixels (main.js consumes and zeroes)
  sprint: false, brake: false, attack: false,
};

const css = `
#touch-ui{position:fixed;inset:0;z-index:15;pointer-events:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;touch-action:none}
#touch-ui .zone{position:absolute;pointer-events:auto;touch-action:none}
#joy-zone{left:0;bottom:0;width:42%;height:70%}
#look-zone{right:0;top:0;width:58%;height:100%}
#joy-base{position:absolute;width:130px;height:130px;margin:-65px 0 0 -65px;border-radius:50%;border:2px solid #ffffff55;background:#ffffff14;display:none}
#joy-knob{position:absolute;left:50%;top:50%;width:58px;height:58px;margin:-29px 0 0 -29px;border-radius:50%;background:#ffffffaa;box-shadow:0 0 10px #0008}
.tbtn{position:absolute;pointer-events:auto;touch-action:none;border-radius:50%;border:2px solid #ffffff66;background:#10131acc;color:#fff;
  font:bold 12px Arial;letter-spacing:1px;display:flex;align-items:center;justify-content:center;text-align:center;line-height:1.1;box-shadow:0 2px 8px #0008}
.tbtn.on,.tbtn:active{background:#ffd21f;color:#000;border-color:#fff}
.tbtn.small{width:44px;height:44px;font-size:10px}
.tbtn.big{width:74px;height:74px;font-size:13px}
.tbtn.mid{width:62px;height:62px}
.tbtn.hidden{display:none}
#tb-action{right:calc(22px + env(safe-area-inset-right));bottom:calc(30px + env(safe-area-inset-bottom))}
#tb-attack{right:calc(112px + env(safe-area-inset-right));bottom:calc(22px + env(safe-area-inset-bottom))}
#tb-sprint{right:calc(34px + env(safe-area-inset-right));bottom:calc(122px + env(safe-area-inset-bottom))}
#tb-brake{right:calc(112px + env(safe-area-inset-right));bottom:calc(22px + env(safe-area-inset-bottom))}
#tb-cam{left:calc(14px + env(safe-area-inset-left));top:calc(14px + env(safe-area-inset-top))}
#tb-map{left:calc(66px + env(safe-area-inset-left));top:calc(14px + env(safe-area-inset-top))}
#tb-pause{left:calc(118px + env(safe-area-inset-left));top:calc(14px + env(safe-area-inset-top))}
#rotate-hint{position:fixed;inset:0;z-index:60;display:none;align-items:center;justify-content:center;flex-direction:column;background:#0c0e13;color:#fff;font:bold 20px Arial;text-align:center;padding:30px}
@media (orientation:portrait){body.touch #rotate-hint{display:flex}}
`;

export function initMobile(h) {
  if (!isTouchDevice) return { setMode() {}, enabled: false };
  document.body.classList.add('touch');
  const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);
  const root = document.createElement('div'); root.id = 'touch-ui';
  root.innerHTML = `
    <div id="look-zone" class="zone"></div>
    <div id="joy-zone" class="zone"><div id="joy-base"><div id="joy-knob"></div></div></div>
    <div class="tbtn big" id="tb-action">ENTER<br>/ EXIT</div>
    <div class="tbtn mid" id="tb-attack">PUNCH</div>
    <div class="tbtn mid hidden" id="tb-brake">BRAKE</div>
    <div class="tbtn mid" id="tb-sprint">RUN</div>
    <div class="tbtn small" id="tb-cam">VIEW</div>
    <div class="tbtn small" id="tb-map">MAP</div>
    <div class="tbtn small" id="tb-pause">MENU</div>`;
  document.body.appendChild(root);
  const rh = document.createElement('div'); rh.id = 'rotate-hint'; rh.innerHTML = '<div style="font-size:54px">&#8635;</div>Rotate your phone<br>to landscape to play'; document.body.appendChild(rh);
  addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('gesturestart', (e) => e.preventDefault());

  const $ = (id) => document.getElementById(id);
  const hold = (el, key) => {
    const set = (v) => { touch[key] = v; el.classList.toggle('on', v); };
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); el.setPointerCapture(e.pointerId); set(true); });
    for (const t of ['pointerup', 'pointercancel']) el.addEventListener(t, () => set(false));
  };
  const tap = (el, fn) => el.addEventListener('pointerdown', (e) => { e.preventDefault(); fn(); });
  hold($('tb-sprint'), 'sprint'); hold($('tb-brake'), 'brake'); hold($('tb-attack'), 'attack');
  tap($('tb-action'), h.onEnter); tap($('tb-cam'), h.onCamera); tap($('tb-map'), h.onMap); tap($('tb-pause'), h.onPause);

  // ---- floating joystick
  const zone = $('joy-zone'), base = $('joy-base'), knob = $('joy-knob'), R = 55;
  let joyId = null, cx = 0, cy = 0;
  zone.addEventListener('pointerdown', (e) => {
    if (joyId !== null) return; e.preventDefault(); zone.setPointerCapture(e.pointerId); joyId = e.pointerId;
    cx = e.clientX; cy = e.clientY; base.style.display = 'block'; base.style.left = cx + 'px'; base.style.top = cy + 'px';
    knob.style.transform = 'translate(0,0)';
  });
  zone.addEventListener('pointermove', (e) => {
    if (e.pointerId !== joyId) return;
    let dx = e.clientX - cx, dy = e.clientY - cy; const d = Math.hypot(dx, dy);
    if (d > R) { dx = dx / d * R; dy = dy / d * R; }
    knob.style.transform = `translate(${dx}px,${dy}px)`;
    let mx = dx / R, my = -dy / R; const m = Math.hypot(mx, my);
    if (m < 0.14) { mx = my = 0; } else { const k = (m - 0.14) / 0.86 / m; mx *= k; my *= k; }
    touch.mx = mx; touch.my = my;
  });
  const endJoy = (e) => { if (e.pointerId !== joyId) return; joyId = null; touch.mx = touch.my = 0; base.style.display = 'none'; };
  zone.addEventListener('pointerup', endJoy); zone.addEventListener('pointercancel', endJoy);

  // ---- drag to look
  const look = $('look-zone'); let lookId = null, lx = 0, ly = 0;
  look.addEventListener('pointerdown', (e) => { if (lookId !== null) return; e.preventDefault(); look.setPointerCapture(e.pointerId); lookId = e.pointerId; lx = e.clientX; ly = e.clientY; });
  look.addEventListener('pointermove', (e) => { if (e.pointerId !== lookId) return; touch.lookX += e.clientX - lx; touch.lookY += e.clientY - ly; lx = e.clientX; ly = e.clientY; });
  const endLook = (e) => { if (e.pointerId === lookId) lookId = null; };
  look.addEventListener('pointerup', endLook); look.addEventListener('pointercancel', endLook);

  let mode = 'foot';
  return {
    enabled: true,
    setMode(m) {
      if (m === mode) return; mode = m;
      $('tb-attack').classList.toggle('hidden', m === 'car'); $('tb-sprint').classList.toggle('hidden', m === 'car'); $('tb-brake').classList.toggle('hidden', m !== 'car');
      touch.sprint = touch.attack = touch.brake = false;
    },
    show(v) { root.style.display = v ? 'block' : 'none'; },
    async fullscreen() {
      try { const el = document.documentElement; if (!document.fullscreenElement && el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' }); } catch (e) { /* not allowed */ }
      try { if (screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape'); } catch (e) { /* not supported */ }
    },
  };
}
