// ============================================================
// Rexy Arcade — shell
//   • header + sign-in + profile            (step 1)
//   • games.json -> card grid               (step 2)
//   • game view: iframe + leaderboard panel (step 3)
//
// Auth, profiles, scores and board reads all go through the shared SDK in
// lib/ — this file never talks to Supabase directly. games.json is the only
// place a game is declared; nothing here hard-codes a game.
// ============================================================
import * as Rexy from "./lib/rexy-leaderboard.js";

const $ = (id) => document.getElementById(id);
const el = {
  dot: $("authDot"), who: $("whoami"), btnAuth: $("btnAuth"),
  drawer: $("drawer"), signedOut: $("signedOut"), signedIn: $("signedIn"),
  email: $("email"), pw: $("pw"), pwNew: $("pwNew"),
  userEmail: $("userEmail"), dname: $("dname"), status: $("status"),
  grid: $("grid"), viewHome: $("viewHome"), viewGame: $("viewGame"),
  frame: $("gameFrame"), screen: $("screen"),
  gTitle: $("gTitle"), gCredit: $("gCredit"),
  fControl: $("fControl"), fPeriod: $("fPeriod"),
  boardBody: $("boardBody"), boardStatus: $("boardStatus"),
};

let currentUser = null, currentProfile = null;
let GAMES = [], activeGame = null;
let filterControl = "all", filterPeriod = "all";

// ---------- helpers ----------
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function say(msg, isError = false) {
  el.status.textContent = msg;
  el.status.classList.toggle("err", !!isError);
}
function boardSay(msg, isError = false) {
  el.boardStatus.textContent = msg;
  el.boardStatus.classList.toggle("err", !!isError);
}
const openDrawer = () => el.drawer.classList.remove("hidden");
const closeDrawer = () => el.drawer.classList.add("hidden");
const setDot = (s) => { el.dot.className = "status-dot " + s; el.dot.title = s; };

function humanError(e) {
  const m = (e && (e.message || e.error_description)) || String(e);
  if (/Invalid login credentials/i.test(m))
    return "Wrong email or password. If you have never set a password, use the email link below.";
  if (/Password should be|at least 8/i.test(m)) return "Password must be at least 8 characters.";
  if (/no profile/i.test(m))          return "Set a display name before submitting a score.";
  if (/not authenticated/i.test(m))   return "Sign in first — scores are tied to an account.";
  if (/rate limited/i.test(m))        return "Too many submissions in a minute. Wait a moment.";
  if (/rate limit|too many/i.test(m)) return "Too many attempts — wait a minute and try again.";
  if (/redirect/i.test(m))            return m + "  (Add this URL to Supabase → Authentication → URL Configuration.)";
  return m;
}

// A game declares in games.json how its raw integer score should read.
// Time trials submit `base - milliseconds`, so faster sorts higher.
function formatScore(game, raw) {
  const f = game?.score || { type: "points" };
  if (f.type === "time") {
    const ms = Math.max(0, (f.base ?? 600000) - raw);
    return (ms / 1000).toFixed(f.decimals ?? 2) + "s";
  }
  return Number(raw).toLocaleString();
}

// ---------- auth ----------
function renderAuth() {
  if (currentUser) {
    const name = currentProfile?.display_name;
    el.who.textContent = name || currentUser.email;
    el.who.classList.toggle("muted", !name);
    el.btnAuth.textContent = name ? "Profile" : "Choose a name";
    setDot("on");
    el.signedOut.classList.add("hidden");
    el.signedIn.classList.remove("hidden");
    el.userEmail.textContent = currentUser.email || "";
    if (!el.dname.value) el.dname.value = name || "";
    if (!name) { openDrawer(); say("Pick a display name — it's what shows on the leaderboards."); }
  } else {
    el.who.textContent = "Not signed in";
    el.who.classList.add("muted");
    el.btnAuth.textContent = "Sign in";
    setDot("off");
    el.signedIn.classList.add("hidden");
    el.signedOut.classList.remove("hidden");
  }
  el.btnAuth.classList.remove("hidden");
  // let a running game know who it is submitting as
  postToGame({ type: "rexy:auth", signedIn: !!currentUser,
               displayName: currentProfile?.display_name || null });
}
async function refreshProfile() {
  currentProfile = currentUser ? await Rexy.getProfile().catch(() => null) : null;
}

el.btnAuth.onclick = openDrawer;
$("btnCloseA").onclick = closeDrawer;
$("btnCloseB").onclick = closeDrawer;
el.drawer.addEventListener("click", (e) => { if (e.target === el.drawer) closeDrawer(); });
addEventListener("keydown", (e) => { if (e.key === "Escape") closeDrawer(); });

$("btnPw").onclick = async () => {
  const email = el.email.value.trim(), pw = el.pw.value;
  if (!email || !pw) { say("Enter your email and password, or use the email link below.", true); return; }
  try { say("Signing in…"); await Rexy.signInWithPassword(email, pw); el.pw.value = ""; closeDrawer(); }
  catch (e) { say(humanError(e), true); }
};
el.pw.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); $("btnPw").click(); } });

$("btnSetPw").onclick = async () => {
  try {
    say("Saving password…");
    await Rexy.setPassword(el.pwNew.value);
    el.pwNew.value = "";
    say("Password saved. You can now sign in with your email and password.");
  } catch (e) { say(humanError(e), true); }
};

$("btnMagic").onclick = async () => {
  const email = el.email.value.trim();
  if (!email) { say("Enter your email address first.", true); return; }
  try { say("Sending…"); await Rexy.signIn(email);
        say("Link sent. Open it on this device — it returns you here signed in."); }
  catch (e) { say(humanError(e), true); }
};
$("btnGoogle").onclick = async () => {
  try { say("Redirecting to Google…"); await Rexy.signInWithGoogle(); }
  catch (e) { say(humanError(e), true); }
};
$("btnSignOut").onclick = async () => {
  try { await Rexy.signOut(); el.dname.value = ""; say("Signed out."); }
  catch (e) { say(humanError(e), true); }
};
$("btnSaveName").onclick = async () => {
  try {
    say("Saving…");
    const wanted = el.dname.value.trim();
    const r = await Rexy.setDisplayName(wanted);
    currentProfile = r; renderAuth(); say(`Name saved: ${r.display_name}`);
    if (activeGame) loadBoard();
  } catch (e) { say(humanError(e), true); }
};
el.dname.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); $("btnSaveName").click(); }
});

// ---------- grid ----------
function cardHTML(g) {
  const live = g.status === "live";
  const thumb = g.thumb ? ` style="background-image:url('${esc(g.thumb)}')"` : "";
  const inputs = (g.inputs || []).map((k) => Rexy.controlLabel(k)).join(" · ");
  return `<article class="gcard" data-id="${esc(g.id)}" ${live ? "" : 'data-soon="1"'}>
    <div class="thumb"${thumb}></div>
    <div class="body">
      <h2>${esc(g.title)}</h2>
      <div class="desc">${esc(g.description || "")}</div>
      <div class="foot">
        <span class="faint" style="font-size:.62rem">${esc(inputs)}</span>
        <span class="badge ${live ? "live" : "soon"}">${live ? "Play" : "Coming soon"}</span>
      </div>
    </div>
  </article>`;
}
function renderGrid() {
  if (!GAMES.length) {
    el.grid.innerHTML = `<div class="placeholder muted">No games in games.json yet.</div>`;
    return;
  }
  el.grid.innerHTML = GAMES.map(cardHTML).join("");
  el.grid.querySelectorAll(".gcard").forEach((c) => {
    c.onclick = () => {
      if (c.dataset.soon) return;
      location.hash = "#game=" + c.dataset.id;
    };
  });
  hydrateThumbs();
}

// ---------- automatic card thumbnails ----------
// A curated art/<id>.png always wins. If a game has none, fall back to the
// track thumbnail the level editor already embedded in the level file
// (arcade.thumb) — so adding a level needs no thumbnail step at all.
function levelJsonURL(g) {
  const m = /[?&]level=([^&]+)/.exec(g.url || "");
  if (!m) return null;                       // not a racer level; nothing to derive
  const base = (g.url.split("?")[0]).replace(/index\.html$/, "");
  return base + "levels/" + m[1] + ".json";
}
function setCardThumb(id, src) {
  const t = el.grid.querySelector('.gcard[data-id="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"] .thumb');
  if (t) t.style.backgroundImage = "url('" + src + "')";
}
function imageLoads(src) {
  return new Promise((res) => { const im = new Image(); im.onload = () => res(true); im.onerror = () => res(false); im.src = src; });
}
async function hydrateThumbs() {
  for (const g of GAMES) {
    if (g.thumb && await imageLoads(g.thumb)) continue;    // static png present — use it
    const key = "rexyThumb_" + g.id;
    let cached = null; try { cached = localStorage.getItem(key); } catch (e) {}
    if (cached) { setCardThumb(g.id, cached); continue; }
    const lu = levelJsonURL(g); if (!lu) continue;
    try {
      const lv = await (await fetch(lu, { cache: "no-cache" })).json();
      const t = lv && lv.arcade && lv.arcade.thumb;
      if (t) { try { localStorage.setItem(key, t); } catch (e) {} setCardThumb(g.id, t); }
    } catch (e) {}
  }
}

// ---------- leaderboard panel ----------
function renderControlFilter() {
  el.fControl.innerHTML =
    `<option value="all">All controls</option>` +
    Rexy.CONTROLS.map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join("");
  el.fControl.value = filterControl;
}
el.fControl.onchange = () => { filterControl = el.fControl.value; loadBoard(); };
el.fPeriod.querySelectorAll("button").forEach((b) => {
  b.onclick = () => {
    filterPeriod = b.dataset.p;
    el.fPeriod.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
    loadBoard();
  };
});

async function loadBoard() {
  if (!activeGame) return;
  boardSay("Loading…");
  try {
    const rows = await Rexy.getLeaderboard(activeGame.id, filterControl, filterPeriod, 50);
    const meId = currentUser?.id || null;
    if (!rows.length) {
      el.boardBody.innerHTML = `<tr class="emptyRow"><td colspan="4">No scores yet — set the first one.</td></tr>`;
    } else {
      el.boardBody.innerHTML = rows.map((r) => `
        <tr class="${r.user_id === meId ? "me" : ""}">
          <td class="rank">${r.rank}</td>
          <td>${esc(r.display_name)}</td>
          <td class="num" style="text-align:right">${esc(formatScore(activeGame, r.score))}</td>
          <td><span class="tag">${esc(Rexy.controlLabel(r.control))}</span></td>
        </tr>`).join("");
    }
    const mine = meId ? rows.find((r) => r.user_id === meId) : null;
    boardSay(mine ? `Your best here: #${mine.rank} · ${formatScore(activeGame, mine.score)}`
                  : (currentUser ? "No score from you on this filter yet."
                                 : "Sign in to appear on the board."));
  } catch (e) {
    el.boardBody.innerHTML = `<tr class="emptyRow"><td colspan="4">Board unavailable.</td></tr>`;
    boardSay(humanError(e), true);
  }
}

// ---------- routing / game view ----------
function postToGame(msg) {
  try { el.frame.contentWindow?.postMessage(msg, location.origin); } catch (e) {}
}
function openGame(g) {
  activeGame = g;
  el.gTitle.textContent = g.title;
  el.gCredit.textContent = g.credit || "";
  el.viewHome.classList.add("hidden");
  el.viewGame.classList.remove("hidden");
  renderControlFilter();
  el.frame.src = g.url;
  loadBoard();
  scrollTo(0, 0);
}
function closeGame() {
  activeGame = null;
  el.frame.src = "about:blank";
  el.viewGame.classList.add("hidden");
  el.viewHome.classList.remove("hidden");
}
function route() {
  const m = location.hash.match(/^#game=(.+)$/);
  const g = m ? GAMES.find((x) => x.id === decodeURIComponent(m[1])) : null;
  if (g && g.status === "live") openGame(g);
  else { if (m) location.hash = ""; closeGame(); }
}
addEventListener("hashchange", route);
$("btnBack").onclick = () => { location.hash = ""; };
$("brandHome").onclick = () => { location.hash = ""; };
$("brandHome").addEventListener("keydown", (e) => { if (e.key === "Enter") location.hash = ""; });
$("btnGameFull").onclick = () => {
  const s = el.screen;
  if (!document.fullscreenElement) (s.requestFullscreen || s.webkitRequestFullscreen)?.call(s);
  else (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
};

// ---------- the game contract ----------
// A game posts {type:'rexy:gameover', id, score, control} when a run ends.
// We only trust messages from our own origin and from the running iframe.
addEventListener("message", (e) => {
  if (e.origin !== location.origin) return;
  if (e.source !== el.frame.contentWindow) return;
  const d = e.data;
  if (!d || typeof d !== "object") return;

  if (d.type === "rexy:gameover" && activeGame && d.id === activeGame.id) {
    if (d.control && d.control !== filterControl && filterControl !== "all") {
      filterControl = "all"; renderControlFilter();      // don't hide their own run
    }
    loadBoard();
    if (typeof d.rank === "number") boardSay(`Run submitted — you're #${d.rank}.`);
  }
  if (d.type === "rexy:needsauth") { openDrawer(); say("Sign in to post a score to the global board."); }
});

// An auth email can return with an error in the hash instead of a session.
// Left unhandled that just looks like "nothing happened", so say what went wrong.
function consumeAuthHash() {
  const h = location.hash || "";
  if (!h.includes("error")) return null;
  const q = new URLSearchParams(h.replace(/^#/, ""));
  const code = q.get("error_code") || q.get("error") || "";
  const desc = (q.get("error_description") || "").replace(/\+/g, " ");
  history.replaceState(null, "", location.pathname + location.search);
  if (/expired|invalid/i.test(code + desc))
    return "That sign-in link didn't work — they're single use and last an hour. " +
           "Request a fresh one and open it straight away, in this browser.";
  return desc || code || "Sign-in failed.";
}

// ---------- boot ----------
(async function boot() {
  const authErr = consumeAuthHash();
  try {
    GAMES = await (await fetch("games.json", { cache: "no-cache" })).json();
  } catch (e) {
    GAMES = [];
    el.grid.innerHTML = `<div class="placeholder muted">Could not read games.json — ${esc(e.message)}</div>`;
  }
  renderGrid();

  try { await Rexy.init(); }
  catch (e) {
    setDot("err"); el.who.textContent = "Backend unavailable";
    el.btnAuth.classList.remove("hidden"); say(humanError(e), true);
    route(); return;
  }

  Rexy.onAuthChange(async (user) => {
    currentUser = user;
    await refreshProfile();
    renderAuth();
    if (activeGame) loadBoard();
    if (user) say(`Signed in as ${currentProfile?.display_name || user.email}.`);
  });

  currentUser = await Rexy.getUser().catch(() => null);
  await refreshProfile();
  renderAuth();
  if (authErr) { openDrawer(); say(authErr, true); }
  else if (!currentUser) say("Not signed in.");
  route();
})();
