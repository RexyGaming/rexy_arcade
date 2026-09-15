'use strict';
// ============================================================
// Rexy Racer level editor.
// Draw roads (smooth curves, straight lines or snap-together track pieces,
// optionally traced over an image or PDF), place the start, finish, furniture,
// coins and checkpoints, check the level with the game's own collision rules,
// test-play it, and export one level file for the arcade.
//
// The project lives in localStorage as you work, so a refresh loses nothing.
// ============================================================
const $ = id => document.getElementById(id);
const C = RacerCore, RULES = C.RULES;
const KEY = { project: 'rexyEditorProject', ulSrc: 'rexyEditorUnderlaySrc', ulXf: 'rexyEditorUnderlay', draft: 'rexyRacerDraft' };
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} }
};
const clone = o => JSON.parse(JSON.stringify(o));
const r1 = v => Math.round(v * 10) / 10;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const normDeg = d => { d = ((d % 360) + 360) % 360; if (d > 180) d -= 360; return r1(d); };
const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

const PAL = {
  cone:    { base: '#28231d', body: '#a95c3c', band: '#bdb7b1', tip: '#8d482a' },
  barrel:  { rim: '#3a2a1e', body: '#553522', hoop: '#b5713a', top: '#704931' },
  barrier: { body: '#716c66', edge: '#302d2b', light: '#8c8580' }
};
const OBS = { cone: { h: 30 }, barrel: { h: 38 }, barrier: { hx: 100, hy: 26 } };

// ---------- project ----------
function blankProject() {
  return {
    level: {
      id: 'my-level', title: 'My Level', byline: '', blurb: 'Steady hands. Follow the track, don\'t touch the walls.',
      tips: [], badges: ['rexy', 'aco', 'tinytape'], startStyle: 'dot', boardKey: null,
      coinR: 55, coinBonus: 0.5, edgePad: 50, gold: 30, silver: 45, bronze: 60, kerbs: [],
      arcade: { description: '', credit: '' }
    },
    roads: [], obstacles: [], coins: [], checkpoints: [],
    start: [0, 0], finish: [2400, 0], finishYaw: 0
  };
}
function projectFromLevel(doc, entry) {
  const N = C.normalise(doc), p = blankProject(), lv = p.level;
  for (const k of ['id', 'title', 'byline', 'blurb', 'tips', 'badges', 'startStyle', 'boardKey', 'coinR', 'coinBonus',
                   'edgePad', 'gold', 'silver', 'bronze', 'kerbs'])
    if (N[k] !== undefined) lv[k] = clone(N[k]);
  lv.arcade = Object.assign({ description: '', credit: '' }, doc.arcade || {});
  if (entry) {
    if (!lv.arcade.description) lv.arcade.description = entry.description || '';
    if (!lv.arcade.credit) lv.arcade.credit = entry.credit || '';
  }
  p.roads = (doc.editor && Array.isArray(doc.editor.roads))
    ? clone(doc.editor.roads)
    : N.roads.map(r => ({ kind: 'poly', w: r.w, ctrl: clone(r.p) }));
  p.obstacles = clone(N.obstacles); p.coins = clone(N.coins); p.checkpoints = clone(N.checkpoints);
  p.start = clone(N.start); p.finish = clone(N.finish); p.finishYaw = N.finishYaw || 0;
  return p;
}
function loadProject() {
  try {
    const s = store.get(KEY.project);
    if (s) { const p = JSON.parse(s); if (p && p.level && Array.isArray(p.roads)) return p; }
  } catch (e) {}
  return blankProject();
}
let P = loadProject();
let dirtySinceExport = false;

function roadValid(r) { return r.kind === 'pieces' ? !!(r.pieces && r.pieces.length) : !!(r.ctrl && r.ctrl.length >= 2); }

// ---------- compiled state: polylines + the collision world ----------
let CR = [], WORLD = null, KERB_PATH = null, KERB_SIG = '';
function compile() {
  const lv = P.level, out = { format: 'rexy-racer-level', version: 1 };
  for (const k of ['id', 'title', 'byline', 'blurb', 'tips', 'badges', 'boardKey', 'startStyle', 'coinR', 'coinBonus',
                   'edgePad', 'gold', 'silver', 'bronze'])
    if (lv[k] != null) out[k] = lv[k];
  out.roads = CR.filter(Boolean);
  out.kerbs = lv.kerbs;
  out.obstacles = P.obstacles; out.coins = P.coins; out.checkpoints = P.checkpoints;
  out.start = P.start; out.finish = P.finish; out.finishYaw = P.finishYaw;
  return out;
}
function rebuild() {
  CR = P.roads.map(r => roadValid(r) ? C.compileRoad(r) : null);
  const k0 = P.level.kerbs[0];
  const sig = P.level.kerbs.length + ':' + (k0 ? k0.length + ':' + k0[0] : '');
  if (sig !== KERB_SIG) {
    KERB_SIG = sig; KERB_PATH = null;
    if (P.level.kerbs.length) {
      KERB_PATH = new Path2D();
      for (const k of P.level.kerbs) {
        KERB_PATH.moveTo(k[0][0], k[0][1]);
        for (let i = 1; i < k.length; i++) KERB_PATH.lineTo(k[i][0], k[i][1]);
        KERB_PATH.closePath();
      }
    }
  }
  WORLD = C.buildWorld(compile());
  need();
}
function exportDoc() {
  rebuild();
  const d = clone(compile());
  if (!d.boardKey) delete d.boardKey;
  d.arcade = { description: P.level.arcade.description || '', credit: P.level.arcade.credit || '' };
  d.editor = { roads: clone(P.roads) };
  if (UL.img) d.editor.underlay = { name: UL.name, x: r1(UL.x), y: r1(UL.y), scale: UL.scale, opacity: UL.opacity };
  return d;
}

// ---------- history ----------
const HIST = { undo: [], redo: [], pending: null };
let version = 0;
const snapshot = () => JSON.stringify(P);
function begin() { if (HIST.pending === null) HIST.pending = snapshot(); }
function end(render) {
  if (HIST.pending === null) return;
  const now = snapshot();
  if (now !== HIST.pending) {
    HIST.undo.push(HIST.pending);
    if (HIST.undo.length > 200) HIST.undo.shift();
    HIST.redo.length = 0;
    afterChange(render !== false);
  }
  HIST.pending = null;
}
function mutate(fn, render) { begin(); fn(); rebuild(); end(render); }
function afterChange(render) {
  version++; dirtySinceExport = true;
  store.set(KEY.project, JSON.stringify(P));
  scheduleCheck();
  if (render) { renderSel(); renderTool(); }
  $('bUndo').disabled = !HIST.undo.length; $('bRedo').disabled = !HIST.redo.length;
}
// live edits from panel fields: saved and re-checked, but the panel is left alone
function liveEdit() { rebuild(); version++; dirtySinceExport = true; store.set(KEY.project, JSON.stringify(P)); scheduleCheck(); }
function restore(json) {
  P = JSON.parse(json); UI.sel = null; UI.drawing = false;
  rebuild(); version++; store.set(KEY.project, JSON.stringify(P)); scheduleCheck(); renderAll();
}
function undo() { end(false); if (!HIST.undo.length) return; HIST.redo.push(snapshot()); restore(HIST.undo.pop()); }
function redo() { end(false); if (!HIST.redo.length) return; HIST.undo.push(snapshot()); restore(HIST.redo.pop()); }

// ---------- tools ----------
const ICON = {
  select: '<path d="M5 3l11 8-5 1 3 6-2 1-3-6-4 4z" fill="currentColor"/>',
  curve: '<path d="M3 16c3-10 7 2 14-11" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
  poly: '<path d="M3 16l5-9 5 6 5-10" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>',
  pieces: '<path d="M3 15h6a5 5 0 0 0 5-5V4" fill="none" stroke="currentColor" stroke-width="3"/><path d="M9 12v6M14 7h4" stroke="currentColor" stroke-width="1.3"/>',
  cone: '<path d="M10 3l5 13H5z" fill="#c9683f"/><rect x="3" y="15" width="14" height="2.5" rx="1" fill="currentColor"/>',
  barrel: '<circle cx="10" cy="10" r="7" fill="#7a4a2a"/><circle cx="10" cy="10" r="4.4" fill="none" stroke="#c9843f" stroke-width="1.4"/>',
  barrier: '<rect x="2" y="7" width="16" height="6" rx="1" fill="#8c8580"/>',
  coin: '<circle cx="10" cy="10" r="7" fill="#f6be1a"/><circle cx="10" cy="10" r="4.2" fill="none" stroke="#7a5400" stroke-width="1.2"/>',
  checkpoint: '<circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-dasharray="3 2.4"/><circle cx="10" cy="10" r="1.8" fill="currentColor"/>',
  start: '<circle cx="10" cy="10" r="7" fill="#ce2a7c"/>',
  finish: '<rect x="4" y="2" width="12" height="16" fill="#eee"/><path d="M4 2h6v4H4zM10 6h6v4h-6zM4 10h6v4H4zM10 14h6v4h-6z" fill="#11151b"/>',
  underlay: '<rect x="2.5" y="4" width="15" height="12" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M4 14l4-5 3 3 2-2 3 4z" fill="currentColor"/>'
};
const TOOLS = [
  { id: 'select', key: 'V', name: 'Select', help: 'Click to select, drag to move. <b>Delete</b> removes, <b>Q</b>/<b>E</b> rotate. Drag empty space, right-drag or hold <b>Space</b> to pan; wheel zooms. Double-click a curve or line road to add a point.' },
  { id: 'curve', key: 'C', name: 'Curve road', help: 'Click to lay points — the road flows smoothly through them. Drag a point to reshape it. <b>Enter</b> or double-click finishes. Click the end of an existing curve to carry it on.' },
  { id: 'poly', key: 'L', name: 'Line road', help: 'Like Curve, but dead straight between points: sharp corners, hairpins, chicanes.' },
  { id: 'pieces', key: 'T', name: 'Track pieces', help: 'Click to start a chain — drag while clicking to aim it, or start on the end of a road to join it. Then <b>↑</b> straight, <b>←</b>/<b>→</b> turns, <b>Backspace</b> removes the last piece.' },
  { sep: true },
  { id: 'cone', key: 'K', name: 'Cone', help: 'Click to place a cone. Clappa clipping it is a penalty; driving through it is out.' },
  { id: 'barrel', key: 'B', name: 'Barrel', help: 'Click to place a barrel — a bigger round obstacle.' },
  { id: 'barrier', key: 'R', name: 'Barrier', help: 'Click to place a barrier. It lands across the road; <b>Q</b>/<b>E</b> rotate, length in Selection.' },
  { id: 'coin', key: 'O', name: 'Coin', help: 'Click to place a coin. The check gives each coin 0–3 stars for the skill it takes: tight gaps and detours off the racing line score, freebies on the line don\'t. Watch the Clappa probe to find tight spots.' },
  { sep: true },
  { id: 'checkpoint', key: 'P', name: 'Check&shy;point', help: 'Clappa must pass through every checkpoint circle before the finish counts. Use them to stop short cuts.' },
  { id: 'start', key: 'S', name: 'Start', help: 'Click to move the start.' },
  { id: 'finish', key: 'F', name: 'Finish', help: 'Click to move the finish. The strip lines itself up with the road; <b>Q</b>/<b>E</b> to adjust.' },
  { sep: true },
  { id: 'underlay', key: 'U', name: 'Underlay', help: 'Drag the tracing image into place. Load one, and set its size and opacity, in the Underlay panel.' }
];
const UI = {
  tool: 'select', sel: null, drawing: false, drag: null, space: false,
  roadW: 300, pieceLen: 600, pieceR: 600, pieceDeg: 90,
  heat: true, line: true, probe: true, auto: true,
  mouse: { in: false, wx: 0, wy: 0 }
};

function buildToolbar() {
  const nav = $('tools');
  for (const t of TOOLS) {
    if (t.sep) { nav.append(h('div', { class: 'sep' })); continue; }
    const b = h('button', { 'data-tool': t.id, title: t.name.replace('&shy;', '') + ' (' + t.key + ')' });
    b.innerHTML = '<svg viewBox="0 0 20 20">' + ICON[t.id] + '</svg><span>' + t.name + '</span><kbd>' + t.key + '</kbd>';
    b.onclick = () => setTool(t.id);
    nav.append(b);
  }
}
function setTool(id) {
  if (UI.drawing) finishDrawing();
  UI.tool = id;
  document.querySelectorAll('#tools button').forEach(b => b.classList.toggle('on', b.dataset.tool === id));
  const t = TOOLS.find(x => x.id === id);
  $('hint').innerHTML = t.help;
  cursorFor();
  renderTool(); need();
}

// ---------- view ----------
const cv = $('cv'), ctx = cv.getContext('2d');
let DPR = 1, CW = 1, CH = 1;
const view = { x: 0, y: 0, z: 0.12 };
function resize() {
  const r = $('stage').getBoundingClientRect();
  DPR = Math.min(window.devicePixelRatio || 1, 2); CW = Math.max(1, r.width); CH = Math.max(1, r.height);
  cv.width = Math.round(CW * DPR); cv.height = Math.round(CH * DPR);
  need();
}
new ResizeObserver(resize).observe($('stage'));
const KK = () => view.z * DPR;
function wt() { const k = KK(); ctx.setTransform(k, 0, 0, k, cv.width / 2 - view.x * k, cv.height / 2 - view.y * k); }
function toScreen(x, y) { const k = KK(); return [(x - view.x) * k + cv.width / 2, (y - view.y) * k + cv.height / 2]; }
function toWorld(e) {
  const r = cv.getBoundingClientRect();
  return [(e.clientX - r.left - CW / 2) / view.z + view.x, (e.clientY - r.top - CH / 2) / view.z + view.y];
}
const px = n => n / view.z;       // css pixels -> world units
let dirty = true;
function need() { dirty = true; }
function loop() { if (dirty) { dirty = false; draw(); } requestAnimationFrame(loop); }

function levelBounds() {
  const b = WORLD ? WORLD.bounds(0) : null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const eat = (x, y) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); };
  if (b && (P.roads.length || P.level.kerbs.length)) { eat(b.x0, b.y0); eat(b.x1, b.y1); }
  eat(P.start[0], P.start[1]); eat(P.finish[0], P.finish[1]);
  for (const o of P.obstacles) eat(o.x, o.y);
  for (const c of P.coins) eat(c.x, c.y);
  return { x0, y0, x1, y1 };
}
function fitView() {
  const b = levelBounds(), w = Math.max(1200, b.x1 - b.x0), hh = Math.max(900, b.y1 - b.y0);
  view.x = (b.x0 + b.x1) / 2; view.y = (b.y0 + b.y1) / 2;
  view.z = Math.min(CW / w, CH / hh) * 0.86;
  need();
}
function zoomAt(f, sx, sy) {
  const wx = (sx - CW / 2) / view.z + view.x, wy = (sy - CH / 2) / view.z + view.y;
  view.z = clamp(view.z * f, 0.008, 4);
  view.x = wx - (sx - CW / 2) / view.z; view.y = wy - (sy - CH / 2) / view.z;
  need();
}
function focusOn(p) { if (!p) return; view.x = p[0]; view.y = p[1]; view.z = Math.max(view.z, 0.28); need(); }

// ---------- underlay ----------
const UL = { img: null, src: null, name: '', x: 0, y: 0, scale: 1, opacity: 0.5, visible: true };
function saveUnderlayXf() {
  if (!UL.img) { store.del(KEY.ulXf); return; }
  store.set(KEY.ulXf, JSON.stringify({ name: UL.name, x: UL.x, y: UL.y, scale: UL.scale, opacity: UL.opacity, visible: UL.visible }));
}
function setUnderlay(src, name, place) {
  const im = new Image();
  im.onload = () => {
    UL.img = im; UL.src = src; UL.name = name;
    if (place) {
      const wWorld = (CW / view.z) * 0.8;
      UL.scale = wWorld / im.naturalWidth;
      UL.x = view.x - (im.naturalWidth * UL.scale) / 2; UL.y = view.y - (im.naturalHeight * UL.scale) / 2;
      UL.visible = true;
    }
    if (!store.set(KEY.ulSrc, src)) toast('The underlay is too big to remember between sessions — you\'ll need to load it again next time.');
    saveUnderlayXf(); renderUnderlay(); need();
    if (place) setTool('underlay');
  };
  im.onerror = () => toast('Couldn\'t read that image.', true);
  im.src = src;
}
function loadScript(src) {
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('could not load ' + src)); document.head.append(s); });
}
async function underlayFromFile(file) {
  try {
    let src;
    if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
      toast('Rendering the PDF…');
      const base = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
      if (!window.pdfjsLib) { await loadScript(base + 'pdf.min.js'); pdfjsLib.GlobalWorkerOptions.workerSrc = base + 'pdf.worker.min.js'; }
      const doc = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
      const page = await doc.getPage(1);
      const v0 = page.getViewport({ scale: 1 }), sc = 2400 / Math.max(v0.width, v0.height);
      const vp = page.getViewport({ scale: sc });
      const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: g, viewport: vp }).promise;
      src = c.toDataURL('image/jpeg', 0.86);
    } else {
      src = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(file); });
      // keep big photos to a size localStorage can hold
      const im = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
      const m = Math.max(im.naturalWidth, im.naturalHeight);
      if (m > 2400 || src.length > 2.5e6) {
        const k = Math.min(1, 2400 / m), c = document.createElement('canvas');
        c.width = Math.round(im.naturalWidth * k); c.height = Math.round(im.naturalHeight * k);
        c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
        src = c.toDataURL('image/jpeg', 0.86);
      }
    }
    setUnderlay(src, file.name, true);
  } catch (e) { toast('Couldn\'t load the underlay: ' + (e.message || e), true); }
}

// ---------- geometry helpers ----------
function roadEnds(exceptIndex) {
  const ends = [];
  CR.forEach((r, i) => {
    if (!r || i === exceptIndex || r.p.length < 2) return;
    const p = r.p, n = p.length;
    ends.push({ x: p[n - 1][0], y: p[n - 1][1], deg: Math.atan2(p[n - 1][1] - p[n - 2][1], p[n - 1][0] - p[n - 2][0]) * 180 / Math.PI, i, end: 'last' });
    ends.push({ x: p[0][0], y: p[0][1], deg: Math.atan2(p[0][1] - p[1][1], p[0][0] - p[1][0]) * 180 / Math.PI, i, end: 'first' });
  });
  return ends;
}
function snapPoint(wx, wy, exceptIndex) {
  let best = null, bd = px(14);
  for (const e of roadEnds(exceptIndex)) { const d = Math.hypot(e.x - wx, e.y - wy); if (d < bd) { bd = d; best = e; } }
  return best ? [r1(best.x), r1(best.y)] : [r1(wx), r1(wy)];
}
function finishRows() {
  const at = WORLD && WORLD.roadAt(P.finish[0], P.finish[1]);
  return (at && !at.kerb) ? Math.max(2, Math.round(at.w / 50)) : 8;
}
function piecesEnd(r) { const b = C.buildPieces(r.origin, r.pieces); return b.ends[b.ends.length - 1]; }
function selRoad() { return UI.sel && UI.sel.t === 'road' ? P.roads[UI.sel.i] : null; }
function rotHandle(s) {
  if (!s) return null;
  if (s.t === 'obs') {
    const o = P.obstacles[s.i];
    if (!o || o.hx == null) return null;
    const a = (o.a || 0) * Math.PI / 180, d = o.hx + px(28);
    return { x: o.x + Math.cos(a) * d, y: o.y + Math.sin(a) * d, cx: o.x, cy: o.y };
  }
  if (s.t === 'finish') {
    const a = (P.finishYaw || 0) * Math.PI / 180, d = 50 + px(30);
    return { x: P.finish[0] + Math.cos(a) * d, y: P.finish[1] + Math.sin(a) * d, cx: P.finish[0], cy: P.finish[1] };
  }
  return null;
}

// ---------- hit testing ----------
function hit(wx, wy) {
  const tol = px(7), s = UI.sel;
  const rh = rotHandle(s);
  if (rh && Math.hypot(rh.x - wx, rh.y - wy) < px(9)) return { t: 'rot' };
  if (s && s.t === 'road') {
    const r = P.roads[s.i];
    if (r && r.kind === 'pieces') {
      if (Math.hypot(r.origin.x - wx, r.origin.y - wy) < px(10)) return { t: 'origin', i: s.i };
    } else if (r) {
      for (let k = r.ctrl.length - 1; k >= 0; k--)
        if (Math.hypot(r.ctrl[k][0] - wx, r.ctrl[k][1] - wy) < px(8)) return { t: 'ctrl', i: s.i, k };
    }
  }
  for (let i = P.coins.length - 1; i >= 0; i--)
    if (Math.hypot(P.coins[i].x - wx, P.coins[i].y - wy) < P.level.coinR * 0.8 + tol) return { t: 'coin', i };
  for (let i = P.obstacles.length - 1; i >= 0; i--) {
    const o = P.obstacles[i];
    if (o.h != null) { if (Math.hypot(o.x - wx, o.y - wy) < o.h + tol) return { t: 'obs', i }; }
    else {
      const a = (o.a || 0) * Math.PI / 180, dx = wx - o.x, dy = wy - o.y;
      const lx = Math.abs(dx * Math.cos(a) + dy * Math.sin(a)), ly = Math.abs(-dx * Math.sin(a) + dy * Math.cos(a));
      if (lx <= o.hx + tol && ly <= o.hy + tol) return { t: 'obs', i };
    }
  }
  if (Math.hypot(P.start[0] - wx, P.start[1] - wy) < Math.max(60, px(10))) return { t: 'start' };
  {
    const a = (P.finishYaw || 0) * Math.PI / 180, dx = wx - P.finish[0], dy = wy - P.finish[1];
    const lx = Math.abs(dx * Math.cos(a) + dy * Math.sin(a)), ly = Math.abs(-dx * Math.sin(a) + dy * Math.cos(a));
    if (lx <= 50 + tol && ly <= finishRows() * 25 + tol) return { t: 'finish' };
  }
  for (let i = P.checkpoints.length - 1; i >= 0; i--)
    if (Math.hypot(P.checkpoints[i][0] - wx, P.checkpoints[i][1] - wy) < Math.max(70, px(10))) return { t: 'cp', i };
  for (let i = CR.length - 1; i >= 0; i--) {
    const r = CR[i];
    if (!r) {
      const src = P.roads[i];
      const q = src.kind === 'pieces' ? [src.origin.x, src.origin.y] : src.ctrl[0];
      if (q && Math.hypot(q[0] - wx, q[1] - wy) < px(10)) return { t: 'road', i };
      continue;
    }
    for (let k = 0; k < r.p.length - 1; k++)
      if (C.segDist(wx, wy, r.p[k][0], r.p[k][1], r.p[k + 1][0], r.p[k + 1][1]) < r.w / 2) return { t: 'road', i };
  }
  return null;
}
function objPos(s) {
  switch (s.t) {
    case 'coin': return [P.coins[s.i].x, P.coins[s.i].y];
    case 'obs': return [P.obstacles[s.i].x, P.obstacles[s.i].y];
    case 'cp': return P.checkpoints[s.i];
    case 'start': return P.start;
    case 'finish': return P.finish;
  }
  return null;
}
function setObjPos(s, x, y) {
  x = r1(x); y = r1(y);
  switch (s.t) {
    case 'coin': P.coins[s.i].x = x; P.coins[s.i].y = y; break;
    case 'obs': P.obstacles[s.i].x = x; P.obstacles[s.i].y = y; break;
    case 'cp': P.checkpoints[s.i] = [x, y]; break;
    case 'start': P.start = [x, y]; break;
    case 'finish': P.finish = [x, y]; break;
  }
}
function select(s) { UI.sel = s; renderSel(); need(); }

// ---------- pointer ----------
cv.addEventListener('contextmenu', e => e.preventDefault());
cv.addEventListener('pointerdown', e => {
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();  // flush field edits into history
  cv.setPointerCapture(e.pointerId);
  const [wx, wy] = toWorld(e);
  if (e.button === 1 || e.button === 2 || UI.space) {
    UI.drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y }; cursorFor(); return;
  }
  if (e.button !== 0) return;
  const fn = DOWN[UI.tool];
  if (fn) fn(wx, wy, e);
  cursorFor();
});
cv.addEventListener('pointermove', e => {
  const [wx, wy] = toWorld(e);
  UI.mouse = { in: true, wx, wy, shift: e.shiftKey };
  $('coords').textContent = Math.round(wx) + ', ' + Math.round(wy) + '   ×' + (view.z * 100).toFixed(1) + '%';
  const d = UI.drag;
  if (d) dragMove(d, wx, wy, e);
  need();
});
cv.addEventListener('pointerleave', () => { UI.mouse.in = false; need(); });
cv.addEventListener('pointerup', e => {
  const d = UI.drag; UI.drag = null;
  if (d && d.kind === 'ul') saveUnderlayXf();
  if (d && d.kind !== 'pan' && d.kind !== 'ul') end();
  cursorFor(); need();
});
cv.addEventListener('dblclick', e => {
  const [wx, wy] = toWorld(e);
  if ((UI.tool === 'curve' || UI.tool === 'poly') && UI.drawing) {
    // the second click of the double-click already added a point at the same spot
    const r = selRoad();
    if (r && r.ctrl.length > 2) {
      const a = r.ctrl[r.ctrl.length - 1], b = r.ctrl[r.ctrl.length - 2];
      if (Math.hypot(a[0] - b[0], a[1] - b[1]) < px(6)) mutate(() => r.ctrl.pop(), false);
    }
    finishDrawing(); return;
  }
  if (UI.tool === 'select') {
    const hh = hit(wx, wy);
    if (hh && hh.t === 'road' && P.roads[hh.i].kind !== 'pieces') {
      const r = P.roads[hh.i];
      let bestK = 0, bd = Infinity;
      for (let k = 0; k < r.ctrl.length - 1; k++) {
        const d = C.segDist(wx, wy, r.ctrl[k][0], r.ctrl[k][1], r.ctrl[k + 1][0], r.ctrl[k + 1][1]);
        if (d < bd) { bd = d; bestK = k; }
      }
      mutate(() => r.ctrl.splice(bestK + 1, 0, [r1(wx), r1(wy)]), false);
      select({ t: 'road', i: hh.i, k: bestK + 1 });
    }
  }
});
cv.addEventListener('wheel', e => {
  e.preventDefault();
  const r = cv.getBoundingClientRect();
  zoomAt(Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.0016)), e.clientX - r.left, e.clientY - r.top);
}, { passive: false });

function startMove(s, wx, wy) {
  const p = objPos(s);
  begin();
  UI.drag = { kind: 'move', s, ox: wx - p[0], oy: wy - p[1] };
}
function placeTool(type) {
  return (wx, wy) => {
    const hh = hit(wx, wy);
    if (hh && ((type === 'coin' && hh.t === 'coin') || (type === 'checkpoint' && hh.t === 'cp') ||
               ((type === 'cone' || type === 'barrel' || type === 'barrier') && hh.t === 'obs'))) {
      select(hh); startMove(hh, wx, wy); return;
    }
    if (hh && hh.t === 'rot') { begin(); UI.drag = { kind: 'rot' }; return; }
    let s;
    begin();
    if (type === 'coin') { P.coins.push({ x: r1(wx), y: r1(wy) }); s = { t: 'coin', i: P.coins.length - 1 }; }
    else if (type === 'checkpoint') { P.checkpoints.push([r1(wx), r1(wy)]); s = { t: 'cp', i: P.checkpoints.length - 1 }; }
    else {
      const o = Object.assign({ t: type, x: r1(wx), y: r1(wy) }, clone(OBS[type]));
      if (type === 'barrier') { const at = WORLD.roadAt(wx, wy); o.a = at ? normDeg(at.deg + 90) : 0; }
      P.obstacles.push(o); s = { t: 'obs', i: P.obstacles.length - 1 };
    }
    rebuild();
    UI.sel = s; renderSel();
    UI.drag = { kind: 'move', s, ox: 0, oy: 0 };
  };
}
function roadTool(kind) {
  return (wx, wy) => {
    const hh = hit(wx, wy), r = selRoad();
    if (hh && hh.t === 'ctrl' && r) {                     // reshape an existing point
      UI.sel = { t: 'road', i: hh.i, k: hh.k }; begin(); UI.drag = { kind: 'ctrl', i: hh.i, k: hh.k }; renderSel(); return;
    }
    if (UI.drawing && r && r.kind === kind) {             // carry on laying points
      begin();
      r.ctrl.push(snapPoint(wx, wy, UI.sel.i));
      UI.sel.k = r.ctrl.length - 1;
      rebuild();
      UI.drag = { kind: 'ctrl', i: UI.sel.i, k: UI.sel.k };
      return;
    }
    // clicking the end of an existing road of this kind continues it
    for (let i = P.roads.length - 1; i >= 0; i--) {
      const src = P.roads[i];
      if (src.kind !== kind || !src.ctrl || src.ctrl.length < 2) continue;
      const a = src.ctrl[0], b = src.ctrl[src.ctrl.length - 1];
      const nearLast = Math.hypot(b[0] - wx, b[1] - wy) < px(10), nearFirst = Math.hypot(a[0] - wx, a[1] - wy) < px(10);
      if (nearLast || nearFirst) {
        if (nearFirst && !nearLast) mutate(() => src.ctrl.reverse(), false);
        UI.sel = { t: 'road', i, k: src.ctrl.length - 1 }; UI.drawing = true; renderSel(); renderTool(); return;
      }
    }
    begin();
    P.roads.push({ kind, w: UI.roadW, ctrl: [snapPoint(wx, wy, -1)] });
    rebuild();
    UI.sel = { t: 'road', i: P.roads.length - 1, k: 0 }; UI.drawing = true;
    UI.drag = { kind: 'ctrl', i: UI.sel.i, k: 0 };
    renderSel(); renderTool();
  };
}
const DOWN = {
  select(wx, wy, e) {
    const hh = hit(wx, wy);
    if (!hh) { select(null); UI.drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y }; return; }
    if (hh.t === 'rot') { begin(); UI.drag = { kind: 'rot' }; return; }
    if (hh.t === 'ctrl') { select({ t: 'road', i: hh.i, k: hh.k }); begin(); UI.drag = { kind: 'ctrl', i: hh.i, k: hh.k }; return; }
    if (hh.t === 'origin') { const o = P.roads[hh.i].origin; begin(); UI.drag = { kind: 'origin', i: hh.i, ox: wx - o.x, oy: wy - o.y }; return; }
    if (hh.t === 'road') {
      const keep = UI.sel && UI.sel.t === 'road' && UI.sel.i === hh.i;
      select({ t: 'road', i: hh.i, k: keep ? UI.sel.k : undefined });
      begin(); UI.drag = { kind: 'moveRoad', i: hh.i, lx: wx, ly: wy }; return;
    }
    select(hh); startMove(hh, wx, wy);
  },
  curve: roadTool('curve'),
  poly: roadTool('poly'),
  pieces(wx, wy) {
    const hh = hit(wx, wy);
    if (hh && hh.t === 'origin') { const o = P.roads[hh.i].origin; begin(); UI.drag = { kind: 'origin', i: hh.i, ox: wx - o.x, oy: wy - o.y }; return; }
    let best = null, bd = px(16);
    for (const e of roadEnds(-1)) { const d = Math.hypot(e.x - wx, e.y - wy); if (d < bd) { bd = d; best = e; } }
    // clicking the end of a pieces chain just selects it, ready to extend
    if (best) {
      const src = P.roads[best.i];
      if (src.kind === 'pieces' && best.end === 'last') { select({ t: 'road', i: best.i }); renderTool(); return; }
    }
    begin();
    const origin = best ? { x: r1(best.x), y: r1(best.y), deg: normDeg(best.deg) } : { x: r1(wx), y: r1(wy), deg: 0 };
    P.roads.push({ kind: 'pieces', w: UI.roadW, origin, pieces: [] });
    rebuild();
    UI.sel = { t: 'road', i: P.roads.length - 1 };
    UI.drag = best ? { kind: 'none' } : { kind: 'aim', i: UI.sel.i };
    renderSel(); renderTool();
  },
  cone: placeTool('cone'), barrel: placeTool('barrel'), barrier: placeTool('barrier'),
  coin: placeTool('coin'), checkpoint: placeTool('checkpoint'),
  start(wx, wy) { const s = { t: 'start' }; begin(); P.start = [r1(wx), r1(wy)]; rebuild(); select(s); UI.drag = { kind: 'move', s, ox: 0, oy: 0 }; },
  finish(wx, wy) {
    const hh = hit(wx, wy);
    if (hh && hh.t === 'rot') { begin(); UI.drag = { kind: 'rot' }; return; }
    const s = { t: 'finish' }; begin();
    P.finish = [r1(wx), r1(wy)];
    const at = WORLD.roadAt(wx, wy); if (at) P.finishYaw = normDeg(at.deg);
    rebuild(); select(s); UI.drag = { kind: 'finishPlace', s };
  },
  underlay(wx, wy) { if (!UL.img) { toast('Load an image or PDF in the Underlay panel first.'); return; } UI.drag = { kind: 'ul', ox: wx - UL.x, oy: wy - UL.y }; }
};

function dragMove(d, wx, wy, e) {
  switch (d.kind) {
    case 'pan':
      view.x = d.vx - (e.clientX - d.sx) / view.z; view.y = d.vy - (e.clientY - d.sy) / view.z; break;
    case 'move':
      setObjPos(d.s, wx - d.ox, wy - d.oy); rebuild(); break;
    case 'finishPlace': {
      P.finish = [r1(wx), r1(wy)];
      const at = WORLD.roadAt(wx, wy); if (at) P.finishYaw = normDeg(at.deg);
      rebuild(); break;
    }
    case 'ctrl': {
      const r = P.roads[d.i]; if (!r) break;
      r.ctrl[d.k] = snapPoint(wx, wy, d.i); rebuild(); break;
    }
    case 'origin': {
      const o = P.roads[d.i].origin; o.x = r1(wx - d.ox); o.y = r1(wy - d.oy); rebuild(); break;
    }
    case 'aim': {
      const o = P.roads[d.i].origin;
      if (Math.hypot(wx - o.x, wy - o.y) > px(12)) {
        let deg = Math.atan2(wy - o.y, wx - o.x) * 180 / Math.PI;
        if (!e.shiftKey) deg = Math.round(deg / 15) * 15;
        o.deg = normDeg(deg); rebuild();
      }
      break;
    }
    case 'moveRoad': {
      const r = P.roads[d.i], dx = wx - d.lx, dy = wy - d.ly;
      if (r.kind === 'pieces') { r.origin.x = r1(r.origin.x + dx); r.origin.y = r1(r.origin.y + dy); }
      else r.ctrl = r.ctrl.map(q => [r1(q[0] + dx), r1(q[1] + dy)]);
      d.lx = wx; d.ly = wy; rebuild(); break;
    }
    case 'rot': {
      const rh = rotHandle(UI.sel); if (!rh) break;
      let deg = Math.atan2(wy - rh.cy, wx - rh.cx) * 180 / Math.PI;
      if (!e.shiftKey) deg = Math.round(deg / 5) * 5;
      if (UI.sel.t === 'obs') P.obstacles[UI.sel.i].a = normDeg(deg); else P.finishYaw = normDeg(deg);
      rebuild(); break;
    }
    case 'ul':
      UL.x = wx - d.ox; UL.y = wy - d.oy; break;
  }
}
function cursorFor() {
  const t = UI.tool;
  cv.style.cursor = (UI.drag && UI.drag.kind === 'pan') ? 'grabbing' : UI.space ? 'grab'
    : t === 'select' ? 'default' : t === 'underlay' ? 'move' : 'crosshair';
}

function finishDrawing() {
  const r = selRoad();
  UI.drawing = false;
  if (r && r.kind !== 'pieces' && r.ctrl.length < 2) {
    const i = UI.sel.i;
    mutate(() => P.roads.splice(i, 1));
    UI.sel = null;
  }
  renderSel(); renderTool(); need();
}

// ---------- editing commands ----------
function deleteSel() {
  const s = UI.sel; if (!s) return;
  if (s.t === 'road') {
    const r = P.roads[s.i];
    if (s.k != null && r.kind !== 'pieces' && r.ctrl.length > 2) {
      mutate(() => r.ctrl.splice(s.k, 1)); UI.sel = { t: 'road', i: s.i }; renderSel(); return;
    }
    mutate(() => P.roads.splice(s.i, 1)); UI.drawing = false;
  } else if (s.t === 'obs') mutate(() => P.obstacles.splice(s.i, 1));
  else if (s.t === 'coin') mutate(() => P.coins.splice(s.i, 1));
  else if (s.t === 'cp') mutate(() => P.checkpoints.splice(s.i, 1));
  else { toast('The start and finish can be moved but not deleted.'); return; }
  select(null);
}
function duplicateSel() {
  const s = UI.sel; if (!s) return;
  if (s.t === 'obs') { mutate(() => { const o = clone(P.obstacles[s.i]); o.x += 80; o.y += 80; P.obstacles.push(o); }); select({ t: 'obs', i: P.obstacles.length - 1 }); }
  else if (s.t === 'coin') { mutate(() => { const c = clone(P.coins[s.i]); c.x += 80; c.y += 80; P.coins.push(c); }); select({ t: 'coin', i: P.coins.length - 1 }); }
}
function rotateSel(dir, fine) {
  const s = UI.sel, step = (fine ? 5 : 15) * dir; if (!s) return;
  if (s.t === 'obs') mutate(() => { const o = P.obstacles[s.i]; if (o.h != null) return; o.a = normDeg((o.a || 0) + step); });
  else if (s.t === 'finish') mutate(() => { P.finishYaw = normDeg((P.finishYaw || 0) + step); });
  else if (s.t === 'road' && P.roads[s.i].kind === 'pieces') mutate(() => { const o = P.roads[s.i].origin; o.deg = normDeg(o.deg + step); });
}
function nudgeSel(dx, dy) {
  const s = UI.sel; if (!s) return;
  if (s.t === 'road') {
    mutate(() => {
      const r = P.roads[s.i];
      if (r.kind === 'pieces') { r.origin.x += dx; r.origin.y += dy; }
      else if (s.k != null) { r.ctrl[s.k] = [r.ctrl[s.k][0] + dx, r.ctrl[s.k][1] + dy]; }
      else r.ctrl = r.ctrl.map(q => [q[0] + dx, q[1] + dy]);
    });
    return;
  }
  const p = objPos(s); if (p) mutate(() => setObjPos(s, p[0] + dx, p[1] + dy));
}
function addPiece(kind) {
  const r = selRoad();
  if (!r || r.kind !== 'pieces') { toast('Select a track-pieces road first (or click on the map to start one).'); return; }
  mutate(() => {
    if (kind === 'S') r.pieces.push({ t: 'S', len: UI.pieceLen });
    else r.pieces.push({ t: 'A', r: UI.pieceR, deg: kind === 'L' ? -UI.pieceDeg : UI.pieceDeg });
  });
}
function popPiece() { const r = selRoad(); if (r && r.kind === 'pieces' && r.pieces.length) mutate(() => r.pieces.pop()); }
function autoCheckpoints() {
  const roads = CR.filter(Boolean);
  if (!roads.length) { toast('Auto checkpoints follow drawn roads — there are none yet.'); return; }
  const SPACING = 1800, keepOff = [P.start, P.finish];
  mutate(() => {
    P.checkpoints = [];
    for (const r of roads) {
      let acc = 0, next = SPACING * 0.6;
      const lens = [];
      let total = 0;
      for (let i = 0; i < r.p.length - 1; i++) { const l = Math.hypot(r.p[i + 1][0] - r.p[i][0], r.p[i + 1][1] - r.p[i][1]); lens.push(l); total += l; }
      for (let i = 0; i < r.p.length - 1; i++) {
        while (acc + lens[i] >= next && next < total - SPACING * 0.4) {
          const t = (next - acc) / lens[i];
          const q = [r1(r.p[i][0] + (r.p[i + 1][0] - r.p[i][0]) * t), r1(r.p[i][1] + (r.p[i + 1][1] - r.p[i][1]) * t)];
          const crowded = keepOff.concat(P.checkpoints).some(k => Math.hypot(k[0] - q[0], k[1] - q[1]) < 900);
          if (!crowded) P.checkpoints.push(q);
          next += SPACING;
        }
        acc += lens[i];
      }
    }
  });
  toast(P.checkpoints.length + ' checkpoints placed along the roads. Drag any that sit on a dead end or a spur players shouldn\'t have to visit.');
}

// ---------- keyboard ----------
addEventListener('keydown', e => {
  const tag = e.target && e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
    if (e.key === 'Escape') e.target.blur();
    if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) { e.preventDefault(); e.target.blur(); exportLevel(); }
    return;
  }
  const k = e.key, mod = e.ctrlKey || e.metaKey;
  if (mod && (k === 'z' || k === 'Z')) { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && (k === 'y' || k === 'Y')) { e.preventDefault(); redo(); return; }
  if (mod && (k === 'd' || k === 'D')) { e.preventDefault(); duplicateSel(); return; }
  if (mod && (k === 's' || k === 'S')) { e.preventDefault(); exportLevel(); return; }
  if (mod) return;
  if (k === ' ') { e.preventDefault(); if (!UI.space) { UI.space = true; cursorFor(); } return; }
  if (k === 'Escape') { if (UI.drawing) finishDrawing(); else if (UI.sel) select(null); else setTool('select'); return; }
  if (k === 'Enter') { if (UI.drawing) finishDrawing(); return; }

  const r = selRoad();
  if (UI.tool === 'pieces' && r && r.kind === 'pieces') {
    if (k === 'ArrowUp') { e.preventDefault(); addPiece('S'); return; }
    if (k === 'ArrowLeft') { e.preventDefault(); addPiece('L'); return; }
    if (k === 'ArrowRight') { e.preventDefault(); addPiece('R'); return; }
    if (k === 'Backspace' || k === 'ArrowDown') { e.preventDefault(); popPiece(); return; }
  }
  if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); deleteSel(); return; }
  if (k === 'q' || k === 'Q') { rotateSel(-1, e.shiftKey); return; }
  if (k === 'e' || k === 'E') { rotateSel(1, e.shiftKey); return; }
  const step = e.shiftKey ? 50 : 10;
  if (k === 'ArrowLeft') { e.preventDefault(); nudgeSel(-step, 0); return; }
  if (k === 'ArrowRight') { e.preventDefault(); nudgeSel(step, 0); return; }
  if (k === 'ArrowUp') { e.preventDefault(); nudgeSel(0, -step); return; }
  if (k === 'ArrowDown') { e.preventDefault(); nudgeSel(0, step); return; }
  if (k === '0') { fitView(); return; }
  if (k === 'h' || k === 'H') { UI.heat = !UI.heat; $('oHeat').checked = UI.heat; need(); return; }
  const t = TOOLS.find(x => x.key && x.key.toLowerCase() === k.toLowerCase());
  if (t) setTool(t.id);
});
addEventListener('keyup', e => { if (e.key === ' ') { UI.space = false; cursorFor(); } });
addEventListener('blur', () => { UI.space = false; });

// ---------- drawing ----------
function polyPath(pts) {
  const p = new Path2D();
  pts.forEach((q, i) => i ? p.lineTo(q[0], q[1]) : p.moveTo(q[0], q[1]));
  return p;
}
function draw() {
  const k = KK();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#0b0e13'; ctx.fillRect(0, 0, cv.width, cv.height);
  wt();
  drawGrid(k);

  if (UL.img && UL.visible) {
    ctx.globalAlpha = UL.opacity; ctx.imageSmoothingEnabled = true;
    ctx.drawImage(UL.img, UL.x, UL.y, UL.img.naturalWidth * UL.scale, UL.img.naturalHeight * UL.scale);
    ctx.globalAlpha = 1;
  }

  // roads, drawn like the game: tolerance shoulder, surface, centre dashes / kerb line
  const tracing = UL.img && UL.visible;
  ctx.globalAlpha = tracing ? 0.72 : 1;
  const paths = CR.map(r => r && polyPath(r.p));
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = '#1b212a';
  CR.forEach((r, i) => { if (r) { ctx.lineWidth = r.w + P.level.edgePad * 2; ctx.stroke(paths[i]); } });
  if (KERB_PATH) { ctx.lineWidth = P.level.edgePad * 2; ctx.stroke(KERB_PATH); }
  ctx.strokeStyle = '#2c333e';
  CR.forEach((r, i) => { if (r) { ctx.lineWidth = r.w; ctx.stroke(paths[i]); } });
  if (KERB_PATH) { ctx.fillStyle = '#2c333e'; ctx.fill(KERB_PATH, 'evenodd'); ctx.strokeStyle = 'rgba(160,175,195,.35)'; ctx.lineWidth = Math.max(7, px(1)); ctx.stroke(KERB_PATH); }
  ctx.strokeStyle = 'rgba(255,255,255,.13)'; ctx.lineWidth = Math.max(4, px(1)); ctx.setLineDash([26, 30]);
  CR.forEach((r, i) => { if (r) ctx.stroke(paths[i]); });
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;

  drawHeat();
  if (UI.line && CHECK && CHECK.line) {
    const L = CHECK.line;
    ctx.beginPath();
    for (let i = 0; i < L.length; i += 4) i ? ctx.lineTo(L[i], L[i + 1]) : ctx.moveTo(L[i], L[i + 1]);
    ctx.strokeStyle = checkStale() ? 'rgba(79,209,255,.35)' : 'rgba(79,209,255,.9)';
    ctx.lineWidth = px(2); ctx.stroke();
  }

  drawCheckpoints();
  drawFinish();
  drawStart();
  drawObstacles();
  drawCoins();
  drawRoadHandles();
  drawSelection();
  drawProbe();
  drawLabels();
}
function drawGrid(k) {
  const step = k * 500 > 18 * DPR ? 500 : k * 2500 > 18 * DPR ? 2500 : 12500;
  const x0 = view.x - cv.width / 2 / k, x1 = view.x + cv.width / 2 / k, y0 = view.y - cv.height / 2 / k, y1 = view.y + cv.height / 2 / k;
  ctx.lineWidth = px(1);
  ctx.strokeStyle = 'rgba(255,255,255,.035)';
  ctx.beginPath();
  for (let x = Math.floor(x0 / step) * step; x <= x1; x += step) { ctx.moveTo(x, y0); ctx.lineTo(x, y1); }
  for (let y = Math.floor(y0 / step) * step; y <= y1; y += step) { ctx.moveTo(x0, y); ctx.lineTo(x1, y); }
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,.09)';
  ctx.beginPath(); ctx.moveTo(0, y0); ctx.lineTo(0, y1); ctx.moveTo(x0, 0); ctx.lineTo(x1, 0); ctx.stroke();
}
function drawCheckpoints() {
  ctx.setLineDash([px(6), px(5)]);
  P.checkpoints.forEach((c, i) => {
    const bad = CHECK && !checkStale() && CHECK.checkpoints && CHECK.checkpoints[i] === 'unreachable';
    ctx.beginPath(); ctx.arc(c[0], c[1], RULES.cpR, 0, Math.PI * 2);
    ctx.strokeStyle = bad ? 'rgba(255,90,74,.8)' : 'rgba(79,143,203,.65)'; ctx.lineWidth = px(1.5); ctx.stroke();
    ctx.beginPath(); ctx.arc(c[0], c[1], px(3.5), 0, Math.PI * 2); ctx.fillStyle = bad ? '#ff5a4a' : '#4F8FCB'; ctx.fill();
  });
  ctx.setLineDash([]);
}
function drawFinish() {
  const rows = finishRows(), sq = 50, at = WORLD && WORLD.roadAt(P.finish[0], P.finish[1]);
  ctx.save();
  if (at && at.kerb && KERB_PATH) ctx.clip(KERB_PATH, 'evenodd');
  ctx.translate(P.finish[0], P.finish[1]); ctx.rotate((P.finishYaw || 0) * Math.PI / 180);
  for (let i = 0; i < rows; i++) for (let j = 0; j < 2; j++) {
    ctx.fillStyle = (i + j) % 2 ? '#f2f4f8' : '#11151b';
    ctx.fillRect(-sq + j * sq, -rows * sq / 2 + i * sq, sq, sq);
  }
  ctx.restore();
  ctx.beginPath(); ctx.arc(P.finish[0], P.finish[1], RULES.finishR, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(246,190,26,.45)'; ctx.lineWidth = px(1.2); ctx.setLineDash([px(4), px(4)]); ctx.stroke(); ctx.setLineDash([]);
}
function drawStart() {
  const p = P.start;
  ctx.beginPath(); ctx.arc(p[0], p[1], RULES.markerR, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(206,42,124,.85)'; ctx.fill();
  ctx.strokeStyle = '#fff'; ctx.lineWidth = px(1.5); ctx.stroke();
}
function drawObstacles() {
  for (const o of P.obstacles) {
    ctx.save(); ctx.translate(o.x, o.y); ctx.rotate((o.a || 0) * Math.PI / 180);
    const r = o.h != null ? o.h : Math.max(o.hx, o.hy);
    if (o.t === 'cone') {
      const Q = PAL.cone;
      ring(r, Q.base); ring(r * 0.84, Q.body); ring(r * 0.56, Q.band); ring(r * 0.32, Q.tip);
    } else if (o.t === 'barrel') {
      const Q = PAL.barrel;
      ring(r, Q.rim); ring(r * 0.88, Q.body);
      ctx.beginPath(); ctx.arc(0, 0, r * 0.6, 0, Math.PI * 2); ctx.strokeStyle = Q.hoop; ctx.lineWidth = r * 0.13; ctx.stroke();
      ring(r * 0.22, Q.top);
    } else {
      const Q = PAL.barrier, w = o.hx * 2, hh = o.hy * 2;
      ctx.fillStyle = Q.body; ctx.fillRect(-w / 2, -hh / 2, w, hh);
      ctx.fillStyle = Q.light; ctx.fillRect(-w / 2, -hh / 2, w, hh * 0.22);
      ctx.strokeStyle = Q.edge; ctx.lineWidth = Math.min(w, hh) * 0.12; ctx.strokeRect(-w / 2, -hh / 2, w, hh);
    }
    ctx.restore();
  }
}
function ring(r, col) { ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill(); }
function drawCoins() {
  const grab = P.level.coinR + RULES.markerR * RULES.coinGrabExtra;
  P.coins.forEach((c, i) => {
    if (UI.tool === 'coin' || (UI.sel && UI.sel.t === 'coin' && UI.sel.i === i)) {
      ctx.beginPath(); ctx.arc(c.x, c.y, grab, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(246,190,26,.35)'; ctx.lineWidth = px(1); ctx.setLineDash([px(3), px(3)]); ctx.stroke(); ctx.setLineDash([]);
    }
    const r = P.level.coinR * 0.78;
    ctx.beginPath(); ctx.arc(c.x, c.y, r * 1.5, 0, Math.PI * 2); ctx.fillStyle = 'rgba(246,190,26,.16)'; ctx.fill();
    ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, Math.PI * 2); ctx.fillStyle = '#f6be1a'; ctx.fill();
    ctx.beginPath(); ctx.arc(c.x, c.y, r * 0.62, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(120,84,0,.55)'; ctx.lineWidth = r * 0.16; ctx.stroke();
  });
}
function drawRoadHandles() {
  const roadTool = UI.tool === 'curve' || UI.tool === 'poly' || UI.tool === 'pieces';
  if (roadTool) {
    for (const e of roadEnds(-1)) {
      ctx.beginPath(); ctx.arc(e.x, e.y, px(5), 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(79,143,203,.9)'; ctx.lineWidth = px(1.5); ctx.stroke();
    }
  }
  const s = UI.sel; if (!s || s.t !== 'road') return;
  const r = P.roads[s.i], c = CR[s.i]; if (!r) return;
  if (c) { ctx.strokeStyle = 'rgba(79,143,203,.9)'; ctx.lineWidth = px(2); ctx.stroke(polyPath(c.p)); }
  if (r.kind === 'pieces') {
    const b = C.buildPieces(r.origin, r.pieces);
    for (const e of b.ends) { ctx.beginPath(); ctx.arc(e.x, e.y, px(3), 0, Math.PI * 2); ctx.fillStyle = '#4F8FCB'; ctx.fill(); }
    ctx.beginPath(); ctx.arc(r.origin.x, r.origin.y, px(7), 0, Math.PI * 2); ctx.fillStyle = '#131822'; ctx.fill();
    ctx.strokeStyle = '#4F8FCB'; ctx.lineWidth = px(2); ctx.stroke();
    // where the next piece will go, and the three choices
    const end = b.ends[b.ends.length - 1];
    arrow(end.x, end.y, end.deg, px(40));
    if (UI.tool === 'pieces') {
      ctx.setLineDash([px(5), px(5)]); ctx.lineWidth = px(1.5); ctx.strokeStyle = 'rgba(234,241,248,.35)';
      for (const pc of [{ t: 'S', len: UI.pieceLen }, { t: 'A', r: UI.pieceR, deg: -UI.pieceDeg }, { t: 'A', r: UI.pieceR, deg: UI.pieceDeg }])
        ctx.stroke(polyPath(C.buildPieces(end, [pc]).pts));
      ctx.setLineDash([]);
    }
  } else {
    ctx.beginPath(); r.ctrl.forEach((q, i) => i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]));
    ctx.strokeStyle = 'rgba(234,241,248,.25)'; ctx.lineWidth = px(1); ctx.stroke();
    r.ctrl.forEach((q, i) => {
      const on = s.k === i, sz = px(on ? 6 : 4.5);
      ctx.fillStyle = on ? '#4F8FCB' : '#131822'; ctx.fillRect(q[0] - sz, q[1] - sz, sz * 2, sz * 2);
      ctx.strokeStyle = '#4F8FCB'; ctx.lineWidth = px(1.5); ctx.strokeRect(q[0] - sz, q[1] - sz, sz * 2, sz * 2);
    });
    if (UI.drawing && UI.mouse.in && (UI.tool === 'curve' || UI.tool === 'poly') && !UI.drag) {
      const q = r.ctrl[r.ctrl.length - 1];
      ctx.beginPath(); ctx.moveTo(q[0], q[1]); ctx.lineTo(UI.mouse.wx, UI.mouse.wy);
      ctx.setLineDash([px(5), px(4)]); ctx.strokeStyle = 'rgba(79,143,203,.8)'; ctx.lineWidth = px(1.5); ctx.stroke(); ctx.setLineDash([]);
    }
  }
}
function arrow(x, y, deg, len) {
  const a = deg * Math.PI / 180, tx = x + Math.cos(a) * len, ty = y + Math.sin(a) * len;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(tx, ty);
  ctx.moveTo(tx, ty); ctx.lineTo(tx - Math.cos(a - 0.5) * len * 0.35, ty - Math.sin(a - 0.5) * len * 0.35);
  ctx.moveTo(tx, ty); ctx.lineTo(tx - Math.cos(a + 0.5) * len * 0.35, ty - Math.sin(a + 0.5) * len * 0.35);
  ctx.strokeStyle = '#4F8FCB'; ctx.lineWidth = px(2.2); ctx.stroke();
}
function drawSelection() {
  const s = UI.sel; if (!s || s.t === 'road') return;
  ctx.strokeStyle = '#4F8FCB'; ctx.lineWidth = px(2);
  if (s.t === 'obs') {
    const o = P.obstacles[s.i]; if (!o) return;
    ctx.save(); ctx.translate(o.x, o.y); ctx.rotate((o.a || 0) * Math.PI / 180);
    if (o.h != null) { ctx.beginPath(); ctx.arc(0, 0, o.h + px(5), 0, Math.PI * 2); ctx.stroke(); }
    else ctx.strokeRect(-o.hx - px(5), -o.hy - px(5), o.hx * 2 + px(10), o.hy * 2 + px(10));
    ctx.restore();
  } else if (s.t === 'coin') {
    const c = P.coins[s.i]; if (!c) return;
    ctx.beginPath(); ctx.arc(c.x, c.y, P.level.coinR * 0.78 + px(5), 0, Math.PI * 2); ctx.stroke();
  } else if (s.t === 'cp') {
    const c = P.checkpoints[s.i]; if (!c) return;
    ctx.beginPath(); ctx.arc(c[0], c[1], RULES.cpR, 0, Math.PI * 2); ctx.lineWidth = px(2.5); ctx.stroke();
  } else if (s.t === 'start') {
    ctx.beginPath(); ctx.arc(P.start[0], P.start[1], RULES.markerR + px(5), 0, Math.PI * 2); ctx.stroke();
  } else if (s.t === 'finish') {
    const rows = finishRows();
    ctx.save(); ctx.translate(P.finish[0], P.finish[1]); ctx.rotate((P.finishYaw || 0) * Math.PI / 180);
    ctx.strokeRect(-50 - px(4), -rows * 25 - px(4), 100 + px(8), rows * 50 + px(8)); ctx.restore();
  }
  const rh = rotHandle(s);
  if (rh) {
    ctx.beginPath(); ctx.moveTo(rh.cx, rh.cy); ctx.lineTo(rh.x, rh.y); ctx.lineWidth = px(1); ctx.stroke();
    ctx.beginPath(); ctx.arc(rh.x, rh.y, px(6), 0, Math.PI * 2); ctx.fillStyle = '#131822'; ctx.fill();
    ctx.lineWidth = px(2); ctx.stroke();
  }
}
let PROBE = null;
function drawProbe() {
  PROBE = null;
  if (!UI.probe || !UI.mouse.in || !WORLD || UI.space) return;
  if (UI.drag && UI.drag.kind === 'pan') return;
  if (!['select', 'coin', 'cone', 'barrel', 'barrier', 'checkpoint', 'start'].includes(UI.tool)) return;
  const p = WORLD.probe(UI.mouse.wx, UI.mouse.wy);
  PROBE = p;
  const col = p.dead ? '255,90,74' : p.touching ? '255,170,40' : '70,211,154';
  ctx.beginPath(); ctx.arc(UI.mouse.wx, UI.mouse.wy, RULES.markerR, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(' + col + ',.18)'; ctx.fill();
  ctx.strokeStyle = 'rgba(' + col + ',.9)'; ctx.lineWidth = px(1.5); ctx.stroke();
}
// screen-space text: checkpoint numbers, coin stars, probe readout
function drawLabels() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = '600 ' + (11 * DPR) + 'px Inter, system-ui, sans-serif';
  P.checkpoints.forEach((c, i) => {
    const [sx, sy] = toScreen(c[0], c[1]);
    ctx.fillStyle = 'rgba(79,143,203,.95)'; ctx.fillText(String(i + 1), sx, sy - 12 * DPR);
  });
  const [ssx, ssy] = toScreen(P.start[0], P.start[1]);
  ctx.fillStyle = '#fff'; ctx.fillText('START', ssx, ssy - Math.max(16, RULES.markerR * view.z + 10) * DPR);
  const [fsx, fsy] = toScreen(P.finish[0], P.finish[1]);
  ctx.fillStyle = '#f6be1a'; ctx.fillText('FINISH', fsx, fsy - Math.max(16, finishRows() * 25 * view.z + 10) * DPR);

  if (CHECK && CHECK.coins && CHECK.coins.length === P.coins.length) {
    ctx.globalAlpha = checkStale() ? 0.45 : 1;
    ctx.font = (12 * DPR) + 'px Inter, system-ui, sans-serif';
    P.coins.forEach((c, i) => {
      const info = CHECK.coins[i]; if (!info) return;
      const [sx, sy] = toScreen(c.x, c.y), y = sy - Math.max(14, P.level.coinR * view.z + 10) * DPR;
      let txt, col;
      if (info.status === 'unreachable') { txt = '✕'; col = '#ff5a4a'; }
      else if (info.status === 'contact') { txt = '★★★!'; col = '#ff9f40'; }
      else if (!info.stars) { txt = 'free'; col = '#8497A8'; }
      else { txt = '★'.repeat(info.stars) + '☆'.repeat(3 - info.stars); col = '#F6BE1A'; }
      ctx.fillStyle = 'rgba(10,13,18,.75)';
      const w = ctx.measureText(txt).width + 8 * DPR;
      ctx.fillRect(sx - w / 2, y - 8 * DPR, w, 16 * DPR);
      ctx.fillStyle = col; ctx.fillText(txt, sx, y);
    });
    ctx.globalAlpha = 1;
  }
  if (PROBE) {
    const [sx, sy] = toScreen(UI.mouse.wx, UI.mouse.wy);
    const txt = PROBE.dead ? 'out' : PROBE.touching ? 'contact' : 'room ' + Math.round(PROBE.room);
    ctx.font = (11 * DPR) + 'px "JetBrains Mono", monospace';
    ctx.fillStyle = PROBE.dead ? '#ff7a6a' : PROBE.touching ? '#ffb454' : '#46d39a';
    ctx.fillText(txt, sx, sy + Math.max(18, RULES.markerR * view.z + 12) * DPR);
  }
}

// ---------- level check (in a worker) ----------
let CHECK = null, checkVersion = -1, checkTimer = 0, worker = null, checkBusy = false, checkQueued = false, checkSeq = 0;
let HEAT = null;
const checkStale = () => checkVersion !== version;
function scheduleCheck() {
  updateCheckStatus();
  if (!UI.auto) return;
  clearTimeout(checkTimer);
  checkTimer = setTimeout(runCheck, 650);
}
function runCheck() {
  if (checkBusy) { checkQueued = true; return; }
  if (!worker) {
    try {
      worker = new Worker('check-worker.js');
      worker.onmessage = onCheck;
      worker.onerror = e => { checkBusy = false; $('checkStatus').textContent = 'Check failed: ' + (e.message || 'worker error'); };
    } catch (e) { $('checkStatus').textContent = 'Checking needs the editor served over http (it is on localhost and GitHub Pages).'; return; }
  }
  rebuild();
  checkBusy = true;
  worker.postMessage({ level: JSON.parse(JSON.stringify(compile())), id: ++checkSeq, version });
  pendingVersion = version;
  updateCheckStatus();
}
let pendingVersion = -1;
function onCheck(e) {
  checkBusy = false;
  const res = e.data;
  if (res.error) { $('checkStatus').textContent = 'Check failed: ' + res.error.split('\n')[0]; console.error(res.error); }
  else {
    CHECK = res; checkVersion = pendingVersion;
    HEAT = res.grid ? buildHeat(res.grid) : null;
  }
  renderCheck(); renderSel(); updateCheckStatus(); need();
  if (checkQueued || (UI.auto && checkStale())) { checkQueued = false; clearTimeout(checkTimer); checkTimer = setTimeout(runCheck, 250); }
}
function buildHeat(g) {
  const c = document.createElement('canvas'); c.width = g.nx; c.height = g.ny;
  const x = c.getContext('2d'), im = x.createImageData(g.nx, g.ny), d = im.data;
  for (let q = 0; q < g.st.length; q++) {
    const s = g.st[q], o = q * 4;
    if (s === 2) { if (g.reach[q]) { d[o] = 49; d[o + 1] = 209; d[o + 2] = 88; d[o + 3] = 52; } else { d[o] = 110; d[o + 1] = 130; d[o + 2] = 255; d[o + 3] = 60; } }
    else if (s === 1) { d[o] = 255; d[o + 1] = 160; d[o + 2] = 30; d[o + 3] = 80; }
  }
  x.putImageData(im, 0, 0);
  return { c, x0: g.x0, y0: g.y0, w: g.nx * g.cell, h: g.ny * g.cell };
}
function drawHeat() {
  if (!UI.heat || !HEAT) return;
  ctx.globalAlpha = checkStale() ? 0.35 : 1;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(HEAT.c, HEAT.x0, HEAT.y0, HEAT.w, HEAT.h);
  ctx.imageSmoothingEnabled = true;
  ctx.globalAlpha = 1;
}
function updateCheckStatus() {
  const el = $('checkStatus');
  if (checkBusy) el.textContent = 'Checking…';
  else if (!CHECK) el.textContent = UI.auto ? 'Waiting…' : 'Not checked yet.';
  else if (checkStale()) el.textContent = UI.auto ? 'Changed — re-checking shortly…' : 'Out of date — press Check now.';
  else el.textContent = 'Up to date · ' + CHECK.ms + ' ms';
  const errs = CHECK ? CHECK.issues.filter(i => i.level === 'err').length : 0, warns = CHECK ? CHECK.issues.filter(i => i.level === 'warn').length : 0;
  $('checkBadge').textContent = CHECK ? (errs ? errs + ' problem' + (errs > 1 ? 's' : '') : warns ? warns + ' note' + (warns > 1 ? 's' : '') : 'all good') : '';
}

// ---------- panel ----------
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) for (const k in props) {
    const v = props[k];
    if (v == null) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected') el[k] = v;
    else el.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
}
// a field bound into the project: every keystroke applies live, the whole edit is one undo step
function field(label, get, set, opt) {
  opt = opt || {};
  const type = opt.type || 'number';
  const inp = type === 'textarea' ? h('textarea', { rows: opt.rows || 3 }) : h('input', { type, step: opt.step || 'any', min: opt.min, max: opt.max, placeholder: opt.placeholder });
  inp.value = get() == null ? '' : String(get());
  inp.addEventListener('focus', () => begin());
  inp.addEventListener('input', () => {
    let v = inp.value;
    if (type === 'number') { v = parseFloat(v); if (!isFinite(v)) return; if (opt.min != null) v = Math.max(opt.min, v); if (opt.max != null) v = Math.min(opt.max, v); }
    set(v); liveEdit();
    if (opt.after) opt.after();
  });
  inp.addEventListener('blur', () => end(false));
  return h('div', null, h('label', null, label), inp);
}
function uiNumber(label, get, set, choices) {
  const sel = h('select', { onchange: () => { set(parseFloat(sel.value)); need(); } },
    choices.map(c => h('option', { value: String(c), selected: c === get() }, String(c))));
  return h('div', null, h('label', null, label), sel);
}

function renderTool() {
  const box = $('toolBody'); box.innerHTML = '';
  const t = TOOLS.find(x => x.id === UI.tool);
  box.append(h('div', { class: 'toolname' }, t.name.replace('&shy;', '')), h('p', { class: 'hintp', html: t.help }));
  if (UI.tool === 'curve' || UI.tool === 'poly' || UI.tool === 'pieces') {
    const w = h('input', { type: 'number', min: 100, max: 1000, step: 10, value: String(UI.roadW) });
    w.oninput = () => { const v = parseFloat(w.value); if (isFinite(v)) UI.roadW = clamp(v, 100, 1000); };
    box.append(h('div', { class: 'cols2' }, h('div', null, h('label', null, 'New road width'), w),
      h('div', null, h('label', null, ' '), h('p', { class: 'hintp' }, 'ACO Logo roads are 300.'))));
    if (UI.drawing) box.append(h('div', { class: 'row' }, h('button', { class: 'primary', onclick: finishDrawing }, 'Finish road (Enter)')));
  }
  if (UI.tool === 'pieces') {
    box.append(h('div', { class: 'cols3' },
      uiNumber('Straight', () => UI.pieceLen, v => UI.pieceLen = v, [150, 300, 450, 600, 900, 1200, 1800]),
      uiNumber('Turn radius', () => UI.pieceR, v => UI.pieceR = v, [150, 225, 300, 450, 600, 900, 1200]),
      uiNumber('Turn angle', () => UI.pieceDeg, v => UI.pieceDeg = v, [15, 30, 45, 60, 90, 120, 135, 180])));
    const r = selRoad(), ok = r && r.kind === 'pieces';
    box.append(h('div', { class: 'row' },
      h('button', { onclick: () => addPiece('L'), disabled: !ok, title: '← key' }, '◀ Left'),
      h('button', { onclick: () => addPiece('S'), disabled: !ok, title: '↑ key' }, '▲ Straight'),
      h('button', { onclick: () => addPiece('R'), disabled: !ok, title: '→ key' }, 'Right ▶'),
      h('button', { onclick: popPiece, disabled: !ok || !r.pieces.length, title: 'Backspace' }, 'Undo piece')));
    box.append(h('p', { class: 'hintp' }, 'Turn radius is measured to the road centre. Keep it above half the road width (150 for a 300 road) or the inside of the bend folds over.'));
  }
  if (UI.tool === 'checkpoint') {
    box.append(h('div', { class: 'row' },
      h('button', { onclick: autoCheckpoints }, 'Auto-place along roads'),
      h('button', { class: 'danger', onclick: () => { if (P.checkpoints.length && confirm('Remove all ' + P.checkpoints.length + ' checkpoints?')) { mutate(() => P.checkpoints = []); select(null); } } }, 'Clear all')));
  }
  if (UI.tool === 'coin' && P.coins.length) {
    box.append(h('p', { class: 'hintp' }, P.coins.length + ' coins · ' + P.level.coinBonus + 's bonus each.'));
  }
}

function renderSel() {
  const box = $('selBody'); box.innerHTML = '';
  const s = UI.sel;
  if (!s) {
    const furn = P.obstacles.length;
    box.append(h('p', { class: 'hintp' }, 'Nothing selected.'),
      h('p', { class: 'hintp' }, P.roads.length + ' road' + (P.roads.length === 1 ? '' : 's') + (P.level.kerbs.length ? ' + traced maze' : '') +
        ' · ' + furn + ' furniture · ' + P.coins.length + ' coins · ' + P.checkpoints.length + ' checkpoints'));
    return;
  }
  const del = (label) => h('button', { class: 'danger', onclick: deleteSel }, label || 'Delete');
  if (s.t === 'road') {
    const r = P.roads[s.i]; if (!r) { UI.sel = null; return renderSel(); }
    const kindName = { curve: 'Curve road', poly: 'Line road', pieces: 'Track pieces' }[r.kind];
    box.append(h('div', { class: 'toolname' }, kindName + ' ' + (s.i + 1)));
    box.append(h('div', { class: 'cols2' }, field('Width', () => r.w, v => r.w = v, { min: 100, max: 1000, step: 10 }),
      h('div', null, h('label', null, r.kind === 'pieces' ? 'Pieces' : 'Points'), h('p', { class: 'hintp' }, String(r.kind === 'pieces' ? r.pieces.length : r.ctrl.length)))));
    const row = h('div', { class: 'row' });
    if (r.kind === 'curve') row.append(h('button', { onclick: () => mutate(() => r.kind = 'poly') }, 'Make straight-lined'));
    if (r.kind === 'poly') row.append(h('button', { onclick: () => mutate(() => r.kind = 'curve') }, 'Make curved'));
    if (r.kind === 'pieces') {
      row.append(h('button', { onclick: () => { UI.tool !== 'pieces' && setTool('pieces'); } }, 'Add pieces'));
      row.append(h('button', { title: 'Turn the chain into draggable points', onclick: () => mutate(() => {
        const pts = C.buildPieces(r.origin, r.pieces).pts, keep = [];
        pts.forEach((q, i) => { if (i === 0 || i === pts.length - 1 || i % 3 === 0) keep.push([r1(q[0]), r1(q[1])]); });
        r.kind = 'poly'; r.ctrl = keep; delete r.origin; delete r.pieces;
      }) }, 'Convert to points'));
      box.append(h('div', { class: 'cols2' },
        field('Start X', () => r.origin.x, v => r.origin.x = v), field('Start Y', () => r.origin.y, v => r.origin.y = v)));
      box.append(field('Start heading (°)', () => r.origin.deg, v => r.origin.deg = normDeg(v)));
    }
    if (r.kind !== 'pieces' && s.k != null && r.ctrl[s.k]) {
      box.append(h('p', { class: 'hintp' }, 'Point ' + (s.k + 1) + ' selected — Delete removes just the point.'));
    }
    row.append(h('button', { onclick: () => mutate(() => {
      if (r.kind === 'pieces') {
        // reverse a chain: start from its end, heading back, with every turn mirrored
        const end = piecesEnd(r);
        r.origin = { x: r1(end.x), y: r1(end.y), deg: normDeg(end.deg + 180) };
        r.pieces = r.pieces.slice().reverse().map(p => p.t === 'A' ? { t: 'A', r: p.r, deg: -p.deg } : p);
      } else r.ctrl.reverse();
    }) }, 'Reverse'));
    row.append(h('button', { class: 'danger', onclick: () => { UI.sel = { t: 'road', i: s.i }; deleteSel(); } }, 'Delete road'));
    box.append(row);
    return;
  }
  if (s.t === 'obs') {
    const o = P.obstacles[s.i]; if (!o) { UI.sel = null; return renderSel(); }
    const type = h('select', { onchange: () => { mutate(() => {
      const t = type.value; o.t = t;
      if (t === 'barrier' && o.h != null) { delete o.h; o.hx = OBS.barrier.hx; o.hy = OBS.barrier.hy; const at = WORLD.roadAt(o.x, o.y); o.a = at ? normDeg(at.deg + 90) : 0; }
      if (t !== 'barrier' && o.h == null && o.t !== 'barrier') { delete o.hx; delete o.hy; delete o.a; o.h = OBS[t].h; }
    }); } }, ['cone', 'barrel', 'barrier'].map(t => h('option', { value: t, selected: o.t === t }, t)));
    box.append(h('div', { class: 'toolname' }, 'Furniture'), h('label', null, 'Type'), type);
    if (o.h != null) box.append(h('div', { class: 'cols2' }, field('Radius', () => o.h, v => o.h = v, { min: 8, max: 400 })));
    else {
      box.append(h('div', { class: 'cols3' },
        field('Length', () => o.hx * 2, v => o.hx = v / 2, { min: 10, max: 3000, step: 10 }),
        field('Thickness', () => o.hy * 2, v => o.hy = v / 2, { min: 10, max: 3000, step: 2 }),
        field('Angle °', () => o.a || 0, v => o.a = normDeg(v), { step: 5 })));
      if (o.t !== 'barrier') box.append(h('p', { class: 'hintp' }, 'Imported ' + o.t + ' with a box-shaped hit area.'));
    }
    box.append(h('div', { class: 'row' }, h('button', { onclick: duplicateSel }, 'Duplicate'), del()));
    return;
  }
  if (s.t === 'coin') {
    const c = P.coins[s.i]; if (!c) { UI.sel = null; return renderSel(); }
    box.append(h('div', { class: 'toolname' }, 'Coin ' + (s.i + 1)));
    box.append(h('div', { class: 'cols2' }, field('X', () => c.x, v => c.x = v), field('Y', () => c.y, v => c.y = v)));
    const info = CHECK && CHECK.coins && CHECK.coins[s.i];
    if (info) {
      const rep = h('div', { class: 'report' });
      rep.append(h('p', null, h('span', { class: starClass(info) }, starText(info)), '  ',
        info.room != null ? 'room ' + info.room : '', info.off != null ? ' · ' + info.off + ' off the line' : ''));
      for (const n of info.notes) rep.append(h('p', null, n));
      if (checkStale()) rep.append(h('p', null, '(from the last check — the level has changed since)'));
      box.append(rep);
    }
    box.append(h('div', { class: 'row' }, h('button', { onclick: duplicateSel }, 'Duplicate'), del()));
    return;
  }
  if (s.t === 'cp') {
    const c = P.checkpoints[s.i]; if (!c) { UI.sel = null; return renderSel(); }
    box.append(h('div', { class: 'toolname' }, 'Checkpoint ' + (s.i + 1)),
      h('p', { class: 'hintp' }, 'Clappa\'s centre must come within ' + RULES.cpR + ' units. Order doesn\'t matter — every one must be ticked before the finish.'),
      h('div', { class: 'cols2' }, field('X', () => c[0], v => c[0] = v), field('Y', () => c[1], v => c[1] = v)),
      h('div', { class: 'row' }, del()));
    return;
  }
  if (s.t === 'start') {
    const st = h('select', { onchange: () => mutate(() => P.level.startStyle = st.value) },
      h('option', { value: 'dot', selected: P.level.startStyle !== 'cap' }, 'Small green dot (ACO Logo)'),
      h('option', { value: 'cap', selected: P.level.startStyle === 'cap' }, 'Blue pad filling the road end (Rexy Logo)'));
    box.append(h('div', { class: 'toolname' }, 'Start'),
      h('div', { class: 'cols2' }, field('X', () => P.start[0], v => P.start[0] = v), field('Y', () => P.start[1], v => P.start[1] = v)),
      h('label', null, 'Marking in game'), st);
    return;
  }
  if (s.t === 'finish') {
    box.append(h('div', { class: 'toolname' }, 'Finish'),
      h('div', { class: 'cols3' }, field('X', () => P.finish[0], v => P.finish[0] = v), field('Y', () => P.finish[1], v => P.finish[1] = v),
        field('Angle °', () => P.finishYaw, v => P.finishYaw = normDeg(v), { step: 5 })),
      h('p', { class: 'hintp' }, 'The run ends when Clappa\'s centre comes within ' + RULES.finishR + ' units of the strip\'s middle (dashed ring), once every checkpoint is ticked.'),
      h('div', { class: 'row' }, h('button', { onclick: () => mutate(() => { const at = WORLD.roadAt(P.finish[0], P.finish[1]); if (at) P.finishYaw = normDeg(at.deg); }) }, 'Line up with road')));
  }
}
const starText = i => i.status === 'unreachable' ? '✕ unreachable' : i.status === 'contact' ? '★★★ costs contact' : i.stars ? '★'.repeat(i.stars) + '☆'.repeat(3 - i.stars) : 'free';
const starClass = i => 'stars ' + (i.status === 'unreachable' ? 'bad' : i.status === 'contact' ? 'contact' : i.stars ? '' : 'free');

function renderCheck() {
  const box = $('checkBody'); box.innerHTML = '';
  if (!CHECK) return;
  const list = h('ul', { class: 'issues' });
  const order = { err: 0, warn: 1, ok: 2 };
  CHECK.issues.slice().sort((a, b) => order[a.level] - order[b.level]).forEach(it => {
    list.append(h('li', { class: it.level }, h('span', { class: 'dot' }), h('span', { class: 'msg' }, it.msg),
      it.at ? h('button', { onclick: () => focusOn(it.at) }, 'Show') : null));
  });
  box.append(list);

  if (CHECK.stats.lineLen) {
    const m = CHECK.medals, lv = P.level;
    const same = m && m.gold === lv.gold && m.silver === lv.silver && m.bronze === lv.bronze;
    box.append(h('div', { class: 'medalSuggest' },
      h('div', null, CHECK.stats.lineClean ? 'Clean racing line ' : 'Shortest survivable line ', h('b', null, CHECK.stats.lineLen.toLocaleString()), ' units.'),
      m ? h('div', null, 'Suggested medals ', h('b', null, m.gold + ' / ' + m.silver + ' / ' + m.bronze + ' s'),
        ' (yours ' + lv.gold + ' / ' + lv.silver + ' / ' + lv.bronze + ')') : null,
      m && !same ? h('div', { class: 'row', style: 'margin-top:6px' }, h('button', { onclick: () => { mutate(() => { lv.gold = m.gold; lv.silver = m.silver; lv.bronze = m.bronze; }); renderLevel(); } }, 'Use suggested times')) : null,
      h('div', { class: 'hintp', style: 'margin-top:4px' }, 'An estimate from line length at ACO Logo\'s gold pace. Twisty levels play slower — test-play and adjust.')));
  }

  if (CHECK.coins.length) {
    const tbl = h('table', { class: 'coinTable' }, h('tr', null, h('th', null, '#'), h('th', null, 'Skill'), h('th', null, 'Room'), h('th', null, 'Off line')));
    CHECK.coins.forEach((c, i) => {
      tbl.append(h('tr', { onclick: () => { const p = P.coins[i]; if (p) { focusOn([p.x, p.y]); select({ t: 'coin', i }); } }, title: c.notes.join(' ') },
        h('td', null, String(i + 1)), h('td', null, h('span', { class: starClass(c) }, starText(c))),
        h('td', { class: 'num' }, c.room != null ? String(c.room) : '—'), h('td', { class: 'num' }, c.off != null ? String(c.off) : '—')));
    });
    box.append(h('label', null, 'Coins — click one to go to it'), tbl);
  }
  box.append(h('p', { class: 'hintp', style: 'margin-top:8px' },
    'Zones: green = clean and reachable, amber = Clappa touches something (penalty), blue = clean but cut off from the start, blank = out.'));
}

function renderLevel() {
  const box = $('levelBody'); box.innerHTML = '';
  const lv = P.level;
  let idTouched = lv.id !== slug(lv.title);
  const idField = field('Level id (never change once it has scores)', () => lv.id, v => { lv.id = slug(v) || 'level'; idTouched = true; }, { type: 'text' });
  box.append(
    field('Title', () => lv.title, v => { lv.title = v; if (!idTouched) { lv.id = slug(v) || 'level'; idField.querySelector('input').value = lv.id; } updateDocName(); }, { type: 'text' }),
    idField,
    field('Byline (under the title)', () => lv.byline, v => lv.byline = v, { type: 'text', placeholder: 'e.g. created by …' }),
    field('Intro line', () => lv.blurb, v => lv.blurb = v, { type: 'textarea', rows: 2 }),
    field('Extra tips (one per line, <b>bold</b> allowed)', () => (lv.tips || []).join('\n'), v => lv.tips = v.split('\n').map(x => x.trim()).filter(Boolean), { type: 'textarea', rows: 2 }),
    field('Arcade card description', () => lv.arcade.description, v => lv.arcade.description = v, { type: 'textarea', rows: 2 }),
    field('Credit (shown under the title in the arcade)', () => lv.arcade.credit, v => lv.arcade.credit = v, { type: 'text' }),
    h('div', { class: 'cols3' },
      field('Gold (s)', () => lv.gold, v => lv.gold = v, { min: 1, step: 1 }),
      field('Silver (s)', () => lv.silver, v => lv.silver = v, { min: 1, step: 1 }),
      field('Bronze (s)', () => lv.bronze, v => lv.bronze = v, { min: 1, step: 1 })),
    h('div', { class: 'cols2' },
      field('Coin bonus (s)', () => lv.coinBonus, v => lv.coinBonus = v, { min: 0, step: 0.1 }),
      field('Edge tolerance', () => lv.edgePad, v => lv.edgePad = v, { min: 0, max: 200, step: 5 })),
    h('p', { class: 'hintp' }, 'Edge tolerance is how far past an edge Clappa\'s centre can go before he\'s out. Both existing levels use 50.')
  );
  const badges = h('div', { class: 'row' });
  for (const [k, name] of [['rexy', 'Rexy'], ['aco', 'ACO'], ['tinytape', 'Tiny Tape']]) {
    const cb = h('input', { type: 'checkbox', checked: lv.badges.includes(k) });
    cb.onchange = () => mutate(() => { lv.badges = ['rexy', 'aco', 'tinytape'].filter(b => b === k ? cb.checked : lv.badges.includes(b)); }, false);
    badges.append(h('label', { class: 'chk' }, cb, name));
  }
  box.append(h('label', null, 'Logos on the start screen'), badges);
  if (lv.kerbs.length) box.append(h('p', { class: 'hintp' }, 'This level\'s maze came from traced artwork (' + lv.kerbs[0].length + ' kerb points). Its walls can\'t be reshaped here, but you can add roads, furniture, coins and checkpoints.'));
}

function renderUnderlay() {
  const box = $('underBody'); box.innerHTML = '';
  box.append(h('p', { class: 'hintp' }, 'Load a picture or PDF of a logo or sketch, size it, then draw roads over it. It\'s only a guide — it never goes into the level.'));
  box.append(h('div', { class: 'row' }, h('button', { class: 'primary', onclick: () => $('fUnder').click() }, UL.img ? 'Replace image / PDF' : 'Load image / PDF')));
  if (!UL.img) return;
  const vis = h('input', { type: 'checkbox', checked: UL.visible });
  vis.onchange = () => { UL.visible = vis.checked; saveUnderlayXf(); need(); };
  const op = h('input', { type: 'range', min: 0.05, max: 1, step: 0.05, value: String(UL.opacity) });
  op.oninput = () => { UL.opacity = parseFloat(op.value); saveUnderlayXf(); need(); };
  const wWorld = () => Math.round(UL.img.naturalWidth * UL.scale);
  const size = h('input', { type: 'number', min: 100, step: 50, value: String(wWorld()) });
  size.oninput = () => {
    const v = parseFloat(size.value); if (!isFinite(v) || v < 50) return;
    // resize about the image centre so it doesn't slide away
    const cx = UL.x + UL.img.naturalWidth * UL.scale / 2, cy = UL.y + UL.img.naturalHeight * UL.scale / 2;
    UL.scale = v / UL.img.naturalWidth;
    UL.x = cx - UL.img.naturalWidth * UL.scale / 2; UL.y = cy - UL.img.naturalHeight * UL.scale / 2;
    saveUnderlayXf(); need();
  };
  box.append(
    h('p', { class: 'hintp' }, h('b', null, UL.name), ' · ' + UL.img.naturalWidth + '×' + UL.img.naturalHeight + ' px'),
    h('label', { class: 'chk' }, vis, 'Show underlay'),
    h('label', null, 'Opacity'), op,
    h('label', null, 'Width in world units'), size,
    h('p', { class: 'hintp' }, 'For scale: a road is about 300 wide, and ACO Logo is about 7,000 across.'),
    h('div', { class: 'row' },
      h('button', { onclick: () => setTool('underlay') }, 'Move it (U)'),
      h('button', { onclick: () => { const cx = view.x, cy = view.y; UL.x = cx - UL.img.naturalWidth * UL.scale / 2; UL.y = cy - UL.img.naturalHeight * UL.scale / 2; saveUnderlayXf(); need(); } }, 'Centre in view'),
      h('button', { class: 'danger', onclick: () => { UL.img = null; UL.src = null; store.del(KEY.ulSrc); store.del(KEY.ulXf); renderUnderlay(); need(); } }, 'Remove')));
}
function updateDocName() { $('docName').textContent = P.level.title + '  ·  ' + P.level.id; }
function renderAll() { renderTool(); renderSel(); renderCheck(); renderLevel(); renderUnderlay(); updateDocName(); updateCheckStatus();
  $('bUndo').disabled = !HIST.undo.length; $('bRedo').disabled = !HIST.redo.length; }

// ---------- thumbnails (the arcade card image) ----------
function makeThumb(lvl) {
  const W0 = 480, H0 = 300, c = document.createElement('canvas'); c.width = W0; c.height = H0;
  const g = c.getContext('2d');
  g.fillStyle = '#131822'; g.fillRect(0, 0, W0, H0);
  const w = C.buildWorld(lvl), b = w.bounds(0);
  if (!isFinite(b.x0)) return c.toDataURL('image/png');
  const pad = 26, bw = Math.max(1, b.x1 - b.x0), bh = Math.max(1, b.y1 - b.y0);
  const s = Math.min((W0 - 2 * pad) / bw, (H0 - 2 * pad) / bh);
  const ox = (W0 - bw * s) / 2 - b.x0 * s, oy = (H0 - bh * s) / 2 - b.y0 * s;
  const X = x => ox + x * s, Y = y => oy + y * s;
  g.save(); g.setTransform(s, 0, 0, s, ox, oy);
  g.strokeStyle = '#3a404a'; g.lineCap = 'round'; g.lineJoin = 'round';
  for (const r of lvl.roads) { g.lineWidth = r.w; g.stroke(polyPath(r.p)); }
  if (lvl.kerbs.length) {
    const kp = new Path2D();
    for (const k of lvl.kerbs) { kp.moveTo(k[0][0], k[0][1]); for (let i = 1; i < k.length; i++) kp.lineTo(k[i][0], k[i][1]); kp.closePath(); }
    g.fillStyle = '#3a404a'; g.fill(kp, 'evenodd');
  }
  g.restore();
  const dot = (x, y, r, col) => { g.beginPath(); g.arc(X(x), Y(y), r, 0, Math.PI * 2); g.fillStyle = col; g.fill(); };
  for (const o of lvl.obstacles) dot(o.x, o.y, o.t === 'cone' ? 2.2 : o.t === 'barrel' ? 3.2 : 5.5, o.t === 'cone' ? '#f96527' : o.t === 'barrel' ? '#c93b3b' : '#8d949e');
  dot(lvl.start[0], lvl.start[1], 8, '#ce2a7c');
  dot(lvl.finish[0], lvl.finish[1], 8, '#f6be1a');
  return c.toDataURL('image/png');
}

// ---------- files ----------
function download(name, text) {
  const blob = new Blob([text], { type: 'application/json' }), url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name }); document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function exportLevel() {
  const d = exportDoc();
  if (CHECK && !checkStale()) {
    const errs = CHECK.issues.filter(i => i.level === 'err');
    if (errs.length && !confirm('The level check found ' + errs.length + ' problem' + (errs.length > 1 ? 's' : '') + ':\n\n' +
        errs.map(e => '• ' + e.msg).join('\n') + '\n\nExport anyway?')) return;
  }
  if (KNOWN.some(g => g.id === d.id) && !confirm('"' + d.id + '" is already in the arcade. Exporting with this id will replace that level (its leaderboard stays).\n\nCarry on?')) return;
  d.arcade.thumb = makeThumb(d);
  download(d.id + '.json', JSON.stringify(d));
  dirtySinceExport = false;
  toast('Exported ' + d.id + '.json — the level, its editable roads and a card thumbnail, all in one file.');
}
function testPlay() {
  rebuild();
  const d = JSON.parse(JSON.stringify(compile()));
  if (!store.set(KEY.draft, JSON.stringify(d))) { toast('Couldn\'t hand the level to the game — browser storage is blocked or full.', true); return; }
  const w = window.open('../games/racer/index.html?level=draft', 'rexyRacerTest');
  if (!w) toast('The test tab was blocked — allow pop-ups for this page.', true);
}
function confirmReplace() {
  return !dirtySinceExport || confirm('Replace the level you\'re working on?\n\nIt hasn\'t been exported since your last change — export first if you want to keep it.');
}
function loadDoc(doc, entry) {
  if (!doc || doc.format !== 'rexy-racer-level') { toast('That isn\'t a Rexy Racer level file.', true); return; }
  P = projectFromLevel(doc, entry);
  HIST.undo.length = 0; HIST.redo.length = 0; HIST.pending = null;
  UI.sel = null; UI.drawing = false; CHECK = null; HEAT = null;
  rebuild(); version++; store.set(KEY.project, JSON.stringify(P));
  dirtySinceExport = false;
  fitView(); renderAll(); scheduleCheck();
}
let KNOWN = [];
async function populateOpen() {
  const sel = $('bOpen');
  try {
    const games = await (await fetch('../games.json', { cache: 'no-cache' })).json();
    KNOWN = games.filter(g => /racer\/index\.html\?level=/.test(g.url || ''));
    for (const g of KNOWN) sel.append(h('option', { value: g.id }, g.title.replace(/^Rexy Racer\s*—\s*/, '')));
  } catch (e) { sel.append(h('option', { value: '', disabled: true }, '(arcade levels unavailable)')); }
  sel.onchange = async () => {
    const id = sel.value; sel.value = '';
    if (!id || !confirmReplace()) return;
    try {
      const doc = await (await fetch('../games/racer/levels/' + encodeURIComponent(id) + '.json', { cache: 'no-cache' })).json();
      loadDoc(doc, KNOWN.find(g => g.id === id));
      toast('Opened ' + P.level.title + '. Export with the same id to update it in the arcade.');
    } catch (e) { toast('Couldn\'t open that level: ' + (e.message || e), true); }
  };
}

let toastTimer = 0;
function toast(msg, err) {
  const t = $('toast'); t.textContent = msg; t.classList.toggle('err', !!err); t.classList.remove('hidden');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), err ? 7000 : 4500);
}

// ---------- wiring ----------
$('bNew').onclick = () => { if (!confirmReplace()) return; loadDoc(Object.assign({ format: 'rexy-racer-level' }, compileBlank())); setTool('curve'); };
function compileBlank() { const b = blankProject(); return Object.assign({}, b.level, { roads: [], obstacles: [], coins: [], checkpoints: [], start: b.start, finish: b.finish, finishYaw: 0 }); }
$('bImport').onclick = () => $('fImport').click();
$('fImport').onchange = async () => {
  const f = $('fImport').files[0]; $('fImport').value = '';
  if (!f || !confirmReplace()) return;
  try { loadDoc(JSON.parse(await f.text())); toast('Opened ' + f.name); }
  catch (e) { toast('Couldn\'t read that file: ' + (e.message || e), true); }
};
$('fUnder').onchange = () => { const f = $('fUnder').files[0]; $('fUnder').value = ''; if (f) underlayFromFile(f); };
$('bUndo').onclick = undo; $('bRedo').onclick = redo;
$('bExport').onclick = exportLevel; $('bTest').onclick = testPlay;
$('bFit').onclick = fitView;
$('bZoomIn').onclick = () => zoomAt(1.4, CW / 2, CH / 2);
$('bZoomOut').onclick = () => zoomAt(1 / 1.4, CW / 2, CH / 2);
$('bCheck').onclick = runCheck;
$('oAuto').onchange = e => { UI.auto = e.target.checked; if (UI.auto && checkStale()) runCheck(); updateCheckStatus(); };
$('oHeat').onchange = e => { UI.heat = e.target.checked; need(); };
$('oLine').onchange = e => { UI.line = e.target.checked; need(); };
$('oProbe').onchange = e => { UI.probe = e.target.checked; need(); };
addEventListener('beforeunload', () => end(false));

// ---------- boot ----------
buildToolbar();
resize();
rebuild();
try {
  const xf = JSON.parse(store.get(KEY.ulXf) || 'null'), src = store.get(KEY.ulSrc);
  if (xf && src) { Object.assign(UL, xf); setUnderlay(src, xf.name, false); }
} catch (e) {}
setTool('select');
renderAll();
requestAnimationFrame(() => { resize(); fitView(); });
populateOpen();
scheduleCheck();
loop();
