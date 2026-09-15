// ============================================================
// Level check — "can this be finished, where is the racing line, and how much
// skill does each coin take?" Answered on a grid with RacerCore's own probe,
// so the verdicts are the game's rules, not an approximation of them.
// Runs in a Web Worker from the editor (check-worker.js), or under Node for tests.
// ============================================================
(function (root) {
'use strict';

// Pace of a clean, committed run, calibrated on ACO Logo: gold 20s over its
// 17,840-unit clean line. Twistier levels play slower than this.
const GOLD_SPEED = 890;        // world units per second
const SILVER_X = 1.5, BRONZE_X = 2.0;

function MinHeap() { this.k = []; this.v = []; }
MinHeap.prototype.push = function (key, val) {
  const k = this.k, v = this.v;
  let i = k.length; k.push(key); v.push(val);
  while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= key) break; k[i] = k[p]; v[i] = v[p]; i = p; }
  k[i] = key; v[i] = val;
};
MinHeap.prototype.pop = function () {
  const k = this.k, v = this.v, topV = v[0];
  const lk = k.pop(), lv = v.pop(), n = k.length;
  if (n) {
    let i = 0;
    for (;;) {
      const l = 2 * i + 1; if (l >= n) break;
      const r = l + 1, m = (r < n && k[r] < k[l]) ? r : l;
      if (k[m] >= lk) break;
      k[i] = k[m]; v[i] = v[m]; i = m;
    }
    k[i] = lk; v[i] = lv;
  }
  return topV;
};

function analyse(raw) {
  const C = root.RacerCore, R = C.RULES, W = C.buildWorld(raw), L = W.L;
  const out = { issues: [], coins: [], checkpoints: [], grid: null, line: null, medals: null, stats: {} };
  const issue = (level, msg, at) => out.issues.push({ level, msg, at: at || null });

  if (!L.roads.length && !L.kerbs.length) {
    issue('err', 'No road yet — draw one with the Curve, Line or Track pieces tool.');
    return out;
  }

  // ---- classify every cell centre: 0 = out, 1 = touching (penalty), 2 = clean ----
  const b = W.bounds(L.edgePad + R.markerR + 40);
  let cell = 16;
  while (((b.x1 - b.x0) / cell) * ((b.y1 - b.y0) / cell) > 650000) cell *= 1.2;
  const nx = Math.ceil((b.x1 - b.x0) / cell), ny = Math.ceil((b.y1 - b.y0) / cell), N = nx * ny;
  const st = new Uint8Array(N), room = new Float32Array(N);
  for (let j = 0; j < ny; j++) {
    const y = b.y0 + (j + 0.5) * cell;
    for (let i = 0; i < nx; i++) {
      const p = W.probe(b.x0 + (i + 0.5) * cell, y), q = j * nx + i;
      st[q] = p.dead ? 0 : p.touching ? 1 : 2;
      room[q] = p.room;
    }
  }
  const cx = q => b.x0 + (q % nx + 0.5) * cell;
  const cy = q => b.y0 + (((q / nx) | 0) + 0.5) * cell;
  function disc(x, y, r) {
    const res = [];
    const i0 = Math.max(0, Math.floor((x - r - b.x0) / cell)), i1 = Math.min(nx - 1, Math.floor((x + r - b.x0) / cell));
    const j0 = Math.max(0, Math.floor((y - r - b.y0) / cell)), j1 = Math.min(ny - 1, Math.floor((y + r - b.y0) / cell));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const q = j * nx + i, dx = cx(q) - x, dy = cy(q) - y;
      if (dx * dx + dy * dy < r * r) res.push(q);
    }
    return res;
  }
  const clean = q => st[q] === 2, survive = q => st[q] >= 1;

  function dijkstra(pass, seeds) {
    // Float64: a float32 store rounds distances, and "key > dist" would then skip real nodes
    const dist = new Float64Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1), H = new MinHeap();
    for (const s of seeds) { dist[s] = 0; H.push(0, s); }
    const D = cell * Math.SQRT2;
    while (H.k.length) {
      const key = H.k[0], q = H.pop();
      if (key > dist[q]) continue;
      const i = q % nx, j = (q - i) / nx;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= nx || nj >= ny) continue;
        const n = nj * nx + ni;
        if (!pass(n)) continue;
        if (di && dj && (!pass(j * nx + ni) || !pass(nj * nx + i))) continue;   // no squeezing through corners
        const nd = key + (di && dj ? D : cell);
        if (nd < dist[n]) { dist[n] = nd; prev[n] = q; H.push(nd, n); }
      }
    }
    return { dist, prev };
  }

  // Shortest run that ticks every checkpoint then reaches the finish. Checkpoints
  // are taken nearest-first, touching each circle only as much as a player would.
  function route(pass) {
    const seeds = disc(L.start[0], L.start[1], Math.max(cell * 1.6, 60)).filter(pass);
    if (!seeds.length) return { ok: false, why: 'start', reach: null, path: [], len: 0 };
    const left = L.checkpoints.map((_, i) => i), path = [];
    let len = 0, reach = null, from = seeds;
    for (;;) {
      const D = dijkstra(pass, from);
      if (!reach) reach = D.dist;
      const finishing = !left.length;
      let best = null;
      for (const t of (finishing ? [-1] : left)) {
        const p = t < 0 ? L.finish : L.checkpoints[t], r = t < 0 ? R.finishR : R.cpR;
        for (const q of disc(p[0], p[1], r)) if (D.dist[q] < (best ? best.d : Infinity)) best = { t, q, d: D.dist[q] };
      }
      if (!best) return { ok: false, why: finishing ? 'finish' : 'checkpoints', missing: finishing ? [] : left.slice(), reach, path, len };
      const seg = [];
      for (let q = best.q; q !== -1; q = D.prev[q]) seg.push(q);
      for (let k = seg.length - 1; k >= 0; k--) path.push(seg[k]);
      len += best.d;
      if (best.t < 0) return { ok: true, reach, path, len };
      left.splice(left.indexOf(best.t), 1);
      from = [best.q];
    }
  }

  // contiguous stretches of a path that touch something
  function contactRuns(path) {
    const runs = [];
    let cur = null;
    for (const q of path) {
      if (st[q] === 1) { if (!cur) { cur = []; runs.push(cur); } cur.push(q); }
      else cur = null;
    }
    return runs.map(r => ({ len: r.length * cell, at: [cx(r[r.length >> 1]), cy(r[r.length >> 1])] }))
               .sort((a, b2) => b2.len - a.len);
  }

  // ---- start ----
  const sp = W.probe(L.start[0], L.start[1]);
  if (sp.dead) issue('err', 'The start is off the road.', L.start);
  else if (sp.touching) issue('warn', 'Clappa touches something at the start — move it clear of edges and furniture.', L.start);

  if (!L.checkpoints.length)
    issue('warn', 'No checkpoints: the run ends as soon as Clappa reaches the finish, however he got there. Add a few along the route.');

  const S = route(survive), Cl = route(clean);
  out.checkpoints = L.checkpoints.map(() => 'ok');

  if (!S.ok) {
    if (S.why === 'start') { /* already reported */ }
    else if (S.why === 'checkpoints') {
      for (const i of S.missing) {
        out.checkpoints[i] = 'unreachable';
        issue('err', 'Checkpoint ' + (i + 1) + ' can\'t be reached without dying.', L.checkpoints[i]);
      }
    } else issue('err', 'The finish can\'t be reached without dying.', L.finish);
  } else if (!Cl.ok) {
    issue('warn', 'No clean line: every route has to touch a wall or furniture somewhere. That can be deliberate — but it costs every player time.');
    for (const r of contactRuns(S.path).slice(0, 4))
      issue('warn', 'Contact forced here (' + Math.round(r.len) + ' units).', r.at);
  } else {
    if (S.len < Cl.len * 0.85) {
      const pct = Math.round(100 * (1 - S.len / Cl.len));
      const runs = contactRuns(S.path);
      issue('warn', 'Short cut: brushing through is ' + pct + '% shorter than the clean line — a thin wall or narrow gap can be crossed for a small penalty.',
            runs.length ? runs[0].at : null);
    }
  }
  if (!out.issues.some(x => x.level === 'err') && Cl.ok) issue('ok', 'Completable with a clean line.');

  const line = Cl.ok ? Cl : S.ok ? S : null;
  if (line) {
    out.stats.lineLen = Math.round(line.len);
    out.stats.lineClean = line === Cl;
    const gold = Math.max(5, Math.round(line.len / GOLD_SPEED));
    out.medals = { gold, silver: Math.round(gold * SILVER_X), bronze: Math.round(gold * BRONZE_X) };
    const xy = new Float32Array(line.path.length * 2);
    line.path.forEach((q, k) => { xy[2 * k] = cx(q); xy[2 * k + 1] = cy(q); });
    out.line = xy;
  }
  if (S.ok) out.stats.shortestLen = Math.round(S.len);

  // ---- coins: how much does each one ask of the player? ----
  const rr = L.coinR + R.markerR * R.coinGrabExtra;
  const cleanReach = Cl.reach, anyReach = S.reach;
  for (const c of L.coins) {
    const cells = disc(c.x, c.y, rr);
    let bestRoom = -Infinity, status = 'unreachable';
    for (const q of cells) {
      if (clean(q) && cleanReach && cleanReach[q] < Infinity) { status = 'clean'; if (room[q] > bestRoom) bestRoom = room[q]; }
    }
    if (status !== 'clean') for (const q of cells) {
      if (survive(q) && anyReach && anyReach[q] < Infinity) { status = 'contact'; break; }
    }
    // how far the coin's grab zone sits from the racing line
    let off = Infinity;
    if (line) for (let k = 0; k < line.path.length; k++) {
      const q = line.path[k], d = Math.hypot(cx(q) - c.x, cy(q) - c.y);
      if (d < off) off = d;
    }
    off = Math.max(0, off - rr);

    let stars = 0;
    const notes = [];
    if (status === 'unreachable') notes.push('Can\'t be reached without dying.');
    else if (status === 'contact') { stars = 3; notes.push('Only reachable by touching something — it costs penalty time.'); }
    else {
      if (bestRoom < 20) { stars += 2; notes.push('Tight squeeze: under ' + Math.max(0, Math.round(bestRoom)) + ' units to spare.'); }
      else if (bestRoom < 55) { stars += 1; notes.push('Snug: ' + Math.round(bestRoom) + ' units to spare.'); }
      if (off > 300) { stars += 2; notes.push('Well off the racing line (~' + Math.round(off) + ' units out).'); }
      else if (off > 80) { stars += 1; notes.push('Off the racing line (~' + Math.round(off) + ' units out).'); }
      if (!stars) notes.push('Freebie: on the natural line with room to spare.');
      stars = Math.min(3, stars);
      // is the detour worth it? coinBonus seconds against the time to get there and back
      if (isFinite(off) && off > 0) {
        const cost = 2 * off / GOLD_SPEED;
        if (cost > L.coinBonus) notes.push('The detour (~' + cost.toFixed(1) + 's) costs more than the ' + L.coinBonus + 's bonus.');
      }
    }
    out.coins.push({ status, stars, room: isFinite(bestRoom) ? Math.round(bestRoom) : null, off: isFinite(off) ? Math.round(off) : null, notes });
  }
  const free = out.coins.filter(c => c.status === 'clean' && c.stars === 0).length;
  if (free) issue('warn', free + ' coin' + (free === 1 ? ' is a freebie' : 's are freebies') + ' — on the racing line with room to spare.');
  const dead = out.coins.filter(c => c.status === 'unreachable').length;
  if (dead) issue('err', dead + ' coin' + (dead === 1 ? ' can\'t' : 's can\'t') + ' be reached without dying.');

  const reach = new Uint8Array(N);
  if (cleanReach) for (let q = 0; q < N; q++) if (cleanReach[q] < Infinity) reach[q] = 1;
  out.grid = { nx, ny, cell, x0: b.x0, y0: b.y0, st, reach };
  return out;
}

root.RacerCheck = { analyse, GOLD_SPEED };
})(typeof window !== 'undefined' ? window : typeof self !== 'undefined' ? self : globalThis);
