// Weekly arcade summary, in markdown on stdout.
//
//   node tools/weekly_summary.mjs
//
// Reads the project URL and anon key from lib/config.js and the game list from
// games.json, so there is nothing to keep in step by hand. Everything it asks
// for is what any player's browser can already read (profiles and scores are
// world-readable by policy); it never writes, and never needs a private key.
// The keep-supabase-awake workflow runs this on Mondays.
import { readFileSync } from 'node:fs';

const cfg = readFileSync('lib/config.js', 'utf8');
const BASE = (cfg.match(/https:\/\/[a-z0-9]+\.supabase\.co/) || [])[0];
const KEY = (cfg.match(/eyJ[A-Za-z0-9._-]+/) || [])[0];
if (!BASE || !KEY) throw new Error('could not read SUPABASE_URL / SUPABASE_ANON_KEY from lib/config.js');
const GAMES = JSON.parse(readFileSync('games.json', 'utf8'));

const H = { apikey: KEY, Authorization: 'Bearer ' + KEY };
async function get(path) {
  const r = await fetch(BASE + '/rest/v1/' + path, { headers: H });
  if (!r.ok) throw new Error('GET ' + path + ' -> HTTP ' + r.status);
  return r.json();
}
async function count(path) {
  const r = await fetch(BASE + '/rest/v1/' + path, { method: 'HEAD', headers: { ...H, Prefer: 'count=exact', Range: '0-0' } });
  if (!r.ok) throw new Error('HEAD ' + path + ' -> HTTP ' + r.status);
  return Number((r.headers.get('content-range') || '/0').split('/')[1] || 0);
}
async function rpc(fn, body) {
  const r = await fetch(BASE + '/rest/v1/rpc/' + fn, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error('RPC ' + fn + ' -> HTTP ' + r.status);
  return r.json();
}

// a score is stored as base - milliseconds for a time trial, so turn it back
function showScore(game, score) {
  const s = game && game.score;
  if (s && s.type === 'time') return ((s.base - score) / 1000).toFixed(s.decimals ?? 2) + 's';
  return Number(score).toLocaleString('en-GB');
}
const byId = Object.fromEntries(GAMES.map(g => [g.id, g]));
const title = id => (byId[id] ? byId[id].title.replace(/^Rexy Racer\s*—\s*/, '') : id);
const esc = s => String(s).replace(/\|/g, '\\|');
const day = d => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

const since = new Date(Date.now() - 7 * 864e5).toISOString();
const t0 = Date.now();
const [runs, profiles, totalRuns, totalPlayers] = await Promise.all([
  get(`scores?select=game_id,score,control,created_at,user_id&created_at=gte.${since}&order=created_at.desc&limit=2000`),
  get('profiles?select=display_name,created_at&order=created_at.desc&limit=500'),
  count('scores?select=id'),
  count('profiles?select=id'),
]);
const ms = Date.now() - t0;

const out = [];
const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
out.push(`## Rexy Arcade — week to ${today}`, '');

const newPlayers = profiles.filter(p => p.created_at >= since);
if (!runs.length) {
  out.push('**No runs this week.** The board is quiet, and the database is awake — that is what this check is for.', '');
} else {
  const players = new Set(runs.map(r => r.user_id)).size;
  out.push(`**${runs.length} run${runs.length === 1 ? '' : 's'}** from **${players} player${players === 1 ? '' : 's'}**` +
           ` across ${new Set(runs.map(r => r.game_id)).size} game${new Set(runs.map(r => r.game_id)).size === 1 ? '' : 's'}.`, '');
  const groups = new Map();
  for (const r of runs) {
    const g = groups.get(r.game_id) || { runs: 0, best: -Infinity, players: new Set() };
    g.runs++; g.players.add(r.user_id);
    if (r.score > g.best) g.best = r.score;
    groups.set(r.game_id, g);
  }
  out.push('| game | runs | players | best this week |', '|---|---:|---:|---:|');
  for (const [id, g] of [...groups].sort((a, b) => b[1].runs - a[1].runs))
    out.push(`| ${esc(title(id))} | ${g.runs} | ${g.players.size} | ${showScore(byId[id], g.best)} |`);
  out.push('');
}

// all-time top three per live game, straight from the board the games read
out.push('### Top of the boards', '');
let anyBoard = false;
for (const g of GAMES.filter(x => x.status === 'live')) {
  let rows = [];
  try { rows = await rpc('get_leaderboard', { p_game_id: g.id, p_control: 'all', p_period: 'all', p_limit: 3 }); }
  catch (e) { out.push(`- **${esc(title(g.id))}** — board unavailable (${e.message})`); continue; }
  if (!rows.length) { out.push(`- **${esc(title(g.id))}** — no scores yet`); continue; }
  anyBoard = true;
  out.push(`- **${esc(title(g.id))}** — ` + rows.map((r, i) =>
    `${i + 1}. ${esc(r.display_name)} ${showScore(g, r.score)}`).join(' · '));
}
if (!anyBoard) out.push('', 'Nothing on the boards yet — the first submitted run starts them off.');
out.push('');

out.push('### Players', '',
  `${totalPlayers} signed up, ${totalRuns} run${totalRuns === 1 ? '' : 's'} recorded all time.`);
if (newPlayers.length)
  out.push('', `New this week: ${newPlayers.map(p => esc(p.display_name || '(no name yet)') + ' (' + day(p.created_at) + ')').join(', ')}.`);
out.push('', `<sub>Read from Supabase in ${ms} ms · project answered, so it stays awake another week.</sub>`);

process.stdout.write(out.join('\n') + '\n');
