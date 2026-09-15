// ============================================================
// Rexy Racer core — level geometry and collision, shared by the game engine
// (games/racer/index.html) and the level editor (editor/). One copy of the
// maths means the editor's "is this completable / is this coin tight" checks
// are answered by exactly the code the game plays with.
//
// A level's road is the union of:
//   roads : [{w, p:[[x,y]...]}]   open polylines, drivable within w/2
//   kerbs : [[[x,y]...]]          closed polygons, drivable inside (even-odd)
// Furniture is circles {t,x,y,h} or oriented boxes {t,x,y,hx,hy,a(deg)}.
// ============================================================
(function (root) {
'use strict';

const RULES = {
  markerR: 44,        // Clappa's radius: touching anything with it runs the penalty clock
  warnBand: 26,       // red glow this far before contact
  obsKillDepth: 0,    // centre inside furniture = out
  finishR: 190,       // centre within this of the finish point ends the run
  cpR: 320,           // centre within this of a checkpoint ticks it
  coinGrabExtra: 0.5  // coin collected when centre within coinR + markerR*this
};

const DEFAULTS = {
  format: 'rexy-racer-level', version: 1,
  id: 'untitled', title: 'Untitled', byline: '', blurb: 'Steady hands. Follow the track, don\'t touch the walls.',
  tips: [], badges: ['rexy', 'aco', 'tinytape'],
  roads: [], kerbs: [], obstacles: [], coins: [], checkpoints: [],
  start: [0, 0], finish: [1000, 0], finishYaw: 0, startStyle: 'dot',
  coinR: 55, coinBonus: 0.5, edgePad: 50,
  gold: 30, silver: 45, bronze: 60
};

function normalise(src) {
  const L = Object.assign({}, DEFAULTS, src || {});
  // older extracts used halfWidthPad for the same thing
  if (src && src.halfWidthPad != null && src.edgePad == null) L.edgePad = src.halfWidthPad;
  for (const k of ['roads', 'kerbs', 'obstacles', 'coins', 'checkpoints', 'tips', 'badges'])
    if (!Array.isArray(L[k])) L[k] = [];
  return L;
}

// ---------- road sources -> polylines (the editor keeps sources, the game plays polylines) ----------

// Centripetal Catmull-Rom through the control points: smooth, passes through every
// point you click, and never loops or overshoots on uneven spacing.
function sampleCurve(ctrl, step) {
  step = step || 30;
  const n = ctrl.length;
  if (n < 2) return ctrl.map(p => [p[0], p[1]]);
  if (n === 2) return lineSample(ctrl[0], ctrl[1], step, true);
  const P = [mirror(ctrl[1], ctrl[0])].concat(ctrl, [mirror(ctrl[n - 2], ctrl[n - 1])]);
  const out = [[ctrl[0][0], ctrl[0][1]]];
  for (let i = 1; i < P.length - 2; i++) {
    const p0 = P[i - 1], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2];
    const t0 = 0;
    const t1 = t0 + Math.pow(Math.max(1e-6, dist(p0, p1)), 0.5);
    const t2 = t1 + Math.pow(Math.max(1e-6, dist(p1, p2)), 0.5);
    const t3 = t2 + Math.pow(Math.max(1e-6, dist(p2, p3)), 0.5);
    const segs = Math.max(2, Math.ceil(dist(p1, p2) / step));
    for (let s = 1; s <= segs; s++) {
      const t = t1 + (t2 - t1) * s / segs;
      const A1 = lerpT(p0, p1, t0, t1, t), A2 = lerpT(p1, p2, t1, t2, t), A3 = lerpT(p2, p3, t2, t3, t);
      const B1 = lerpT(A1, A2, t0, t2, t), B2 = lerpT(A2, A3, t1, t3, t);
      out.push(lerpT(B1, B2, t1, t2, t));
    }
  }
  return out;
}
function mirror(a, b) { return [2 * b[0] - a[0], 2 * b[1] - a[1]]; }
function lerpT(a, b, ta, tb, t) {
  const k = (tb - ta) ? (t - ta) / (tb - ta) : 0;
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
}
function lineSample(a, b, step, withFirst) {
  const n = Math.max(1, Math.ceil(dist(a, b) / step)), out = [];
  for (let i = withFirst ? 0 : 1; i <= n; i++) out.push([a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n]);
  return out;
}

// Track pieces: an origin {x,y,deg} then a chain of straights {t:'S',len} and
// arcs {t:'A',r,deg} (deg > 0 turns right on screen, < 0 left). Headings in degrees,
// 0 = +x, increasing clockwise because screen y points down.
function buildPieces(origin, pieces) {
  let x = origin.x, y = origin.y, h = (origin.deg || 0) * Math.PI / 180;
  const out = [[x, y]], ends = [{ x, y, deg: origin.deg || 0 }];
  for (const pc of pieces || []) {
    if (pc.t === 'S') {
      const n = Math.max(1, Math.ceil(pc.len / 50));
      for (let i = 1; i <= n; i++) out.push([x + Math.cos(h) * pc.len * i / n, y + Math.sin(h) * pc.len * i / n]);
      x += Math.cos(h) * pc.len; y += Math.sin(h) * pc.len;
    } else {
      const s = pc.deg >= 0 ? 1 : -1, th = pc.deg * Math.PI / 180;
      const cx = x + pc.r * Math.cos(h + s * Math.PI / 2), cy = y + pc.r * Math.sin(h + s * Math.PI / 2);
      const a0 = h - s * Math.PI / 2;
      const n = Math.max(2, Math.ceil(Math.abs(th) * pc.r / 36));
      for (let i = 1; i <= n; i++) {
        const a = a0 + th * i / n;
        out.push([cx + pc.r * Math.cos(a), cy + pc.r * Math.sin(a)]);
      }
      x = cx + pc.r * Math.cos(a0 + th); y = cy + pc.r * Math.sin(a0 + th); h += th;
    }
    ends.push({ x, y, deg: h * 180 / Math.PI });
  }
  return { pts: out, ends };
}

// editor road source -> game polyline
function compileRoad(src) {
  let p;
  if (src.kind === 'pieces') p = buildPieces(src.origin, src.pieces).pts;
  else if (src.kind === 'curve') p = sampleCurve(src.ctrl, 30);
  else p = src.ctrl.map(q => [q[0], q[1]]);
  return { w: src.w, p: p.map(q => [round1(q[0]), round1(q[1])]) };
}
function round1(v) { return Math.round(v * 10) / 10; }
function dist(a, b) { return Math.hypot(b[0] - a[0], b[1] - a[1]); }

// ---------- collision world ----------
// A uniform hash where every segment / obstacle is filed into every cell within its
// reach (its own size plus the widest threshold the game ever tests). A query then
// reads ONE cell. If a cell holds nothing, the point is further out than any rule
// cares about, so "far" is the exact answer the rules need.
const CELL = 250, FAR = 1e6;

function makeHash() { return new Map(); }
function hkey(ix, iy) { return ix * 73856093 ^ iy * 19349663; }
function hput(H, x0, y0, x1, y1, item) {
  const ix0 = Math.floor(x0 / CELL), ix1 = Math.floor(x1 / CELL);
  const iy0 = Math.floor(y0 / CELL), iy1 = Math.floor(y1 / CELL);
  for (let ix = ix0; ix <= ix1; ix++) for (let iy = iy0; iy <= iy1; iy++) {
    const k = hkey(ix, iy);
    let b = H.get(k);
    if (!b) { b = []; H.set(k, b); }
    b.push(item);
  }
}
function hget(H, x, y) { return H.get(hkey(Math.floor(x / CELL), Math.floor(y / CELL))); }

function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
  let t = L ? ((px - ax) * dx + (py - ay) * dy) / L : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function buildWorld(levelIn) {
  const L = normalise(levelIn);
  const reach = Math.max(L.edgePad, RULES.markerR + RULES.warnBand) + 12;

  const roadH = makeHash();
  for (const r of L.roads) {
    const m = r.w / 2 + reach;
    for (let i = 0; i < r.p.length - 1; i++) {
      const a = r.p[i], b = r.p[i + 1];
      hput(roadH, Math.min(a[0], b[0]) - m, Math.min(a[1], b[1]) - m,
                  Math.max(a[0], b[0]) + m, Math.max(a[1], b[1]) + m,
                  [a[0], a[1], b[0], b[1], r.w / 2]);
    }
    if (r.p.length === 1) {
      const a = r.p[0];
      hput(roadH, a[0] - m, a[1] - m, a[0] + m, a[1] + m, [a[0], a[1], a[0], a[1], r.w / 2]);
    }
  }

  // kerbs: distance hash, plus a y-band index of edges for the inside test
  const kerbH = makeHash(), BAND = 100, kerbBands = new Map();
  for (const poly of L.kerbs) {
    const n = poly.length;
    for (let i = 0; i < n; i++) {
      const a = poly[i], b = poly[(i + 1) % n];
      hput(kerbH, Math.min(a[0], b[0]) - reach, Math.min(a[1], b[1]) - reach,
                  Math.max(a[0], b[0]) + reach, Math.max(a[1], b[1]) + reach, [a[0], a[1], b[0], b[1]]);
      const j0 = Math.floor(Math.min(a[1], b[1]) / BAND), j1 = Math.floor(Math.max(a[1], b[1]) / BAND);
      for (let j = j0; j <= j1; j++) {
        let e = kerbBands.get(j);
        if (!e) { e = []; kerbBands.set(j, e); }
        e.push([a[0], a[1], b[0], b[1]]);
      }
    }
  }

  const obsH = makeHash();
  for (const o of L.obstacles) {
    const size = o.h != null ? o.h : Math.hypot(o.hx, o.hy);
    const m = size + reach;
    hput(obsH, o.x - m, o.y - m, o.x + m, o.y + m, o);
  }

  function insideKerb(px, py) {
    const e = kerbBands.get(Math.floor(py / BAND));
    if (!e) return false;
    let c = false;
    for (const s of e) {
      if (((s[1] > py) !== (s[3] > py)) && (px < (s[2] - s[0]) * (py - s[1]) / (s[3] - s[1]) + s[0])) c = !c;
    }
    return c;
  }

  // signed: negative inside the road, positive once outside
  function edgeOvershoot(px, py) {
    let best = FAR;
    const rb = hget(roadH, px, py);
    if (rb) for (const s of rb) {
      const o = segDist(px, py, s[0], s[1], s[2], s[3]) - s[4];
      if (o < best) best = o;
    }
    if (L.kerbs.length) {
      let d = FAR;
      const kb = hget(kerbH, px, py);
      if (kb) for (const s of kb) { const q = segDist(px, py, s[0], s[1], s[2], s[3]); if (q < d) d = q; }
      const k = insideKerb(px, py) ? -d : d;
      if (k < best) best = k;
    }
    return best;
  }

  function obsGapOne(o, px, py) {
    if (o.h != null) return Math.max(0, Math.hypot(px - o.x, py - o.y) - o.h);
    const dx = px - o.x, dy = py - o.y, r = (o.a || 0) * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
    const lx = Math.abs(dx * c + dy * s), ly = Math.abs(-dx * s + dy * c);
    return Math.hypot(Math.max(lx - o.hx, 0), Math.max(ly - o.hy, 0));
  }
  function obsPenOne(o, px, py) {
    if (o.h != null) return Math.max(0, o.h - Math.hypot(px - o.x, py - o.y));
    const dx = px - o.x, dy = py - o.y, r = (o.a || 0) * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
    const lx = Math.abs(dx * c + dy * s), ly = Math.abs(-dx * s + dy * c);
    return (lx <= o.hx && ly <= o.hy) ? Math.min(o.hx - lx, o.hy - ly) : 0;
  }
  function obstacleGap(px, py) {
    let best = FAR;
    const b = hget(obsH, px, py);
    if (b) for (const o of b) { const g = obsGapOne(o, px, py); if (g < best) { best = g; if (best <= 0) return 0; } }
    return best;
  }
  function obstaclePenetration(px, py) {
    let deep = 0;
    const b = hget(obsH, px, py);
    if (b) for (const o of b) { const d = obsPenOne(o, px, py); if (d > deep) deep = d; }
    return deep;
  }

  // everything the rules decide at one point
  function probe(px, py) {
    const over = edgeOvershoot(px, py), gap = obstacleGap(px, py), pen = obstaclePenetration(px, py);
    const R = RULES.markerR;
    const dead = over > L.edgePad || pen > RULES.obsKillDepth;
    const touching = !dead && (over + R > 0 || gap < R);
    return { over, gap, pen, dead, touching, clean: !dead && !touching,
             room: Math.min(-(over + R), gap - R) };   // spare clearance for Clappa, <0 = contact
  }

  // road direction + width near a point (for finish strips, barrier placement)
  function roadAt(px, py) {
    let best = null, bd = Infinity;
    for (const r of L.roads) for (let i = 0; i < r.p.length - 1; i++) {
      const a = r.p[i], b = r.p[i + 1], d = segDist(px, py, a[0], a[1], b[0], b[1]);
      if (d < bd) { bd = d; best = { deg: Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI, w: r.w, kerb: false, d }; }
    }
    for (const poly of L.kerbs) for (let i = 0, n = poly.length; i < n; i++) {
      const a = poly[i], b = poly[(i + 1) % n], d = segDist(px, py, a[0], a[1], b[0], b[1]);
      // a kerb runs alongside the road, so its direction is the road's
      if (d < bd) { bd = d; best = { deg: Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI, w: null, kerb: true, d }; }
    }
    return best;
  }

  function bounds(margin) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const eat = (p) => { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; };
    for (const r of L.roads) for (const p of r.p) eat(p);
    for (const k of L.kerbs) for (const p of k) eat(p);
    if (!isFinite(x0)) { eat(L.start); eat(L.finish); }
    const m = margin || 0;
    return { x0: x0 - m, y0: y0 - m, x1: x1 + m, y1: y1 + m };
  }

  return { L, RULES, edgeOvershoot, obstacleGap, obstaclePenetration, probe, roadAt, bounds, insideKerb };
}

root.RacerCore = { RULES, DEFAULTS, normalise, sampleCurve, buildPieces, compileRoad, buildWorld, segDist };
})(typeof window !== 'undefined' ? window : self);
