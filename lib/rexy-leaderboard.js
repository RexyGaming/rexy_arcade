// ============================================================
// Rexy Leaderboard — client SDK  (ES module)
// One import for every Rexy mini-game to sign in, submit verifiable
// scores, and read the Open / Wheels-Verified boards.
//
//   import * as Rexy from './rexy-leaderboard.js';
//   await Rexy.init();                       // uses ./config.js
//   await Rexy.signIn('me@example.com');     // magic-link email
//   await Rexy.setDisplayName('RexyRob');
//   await Rexy.submitScore('zen-sandbox','open', 1234, { seed, trace, meta });
//   const rows = await Rexy.getLeaderboard('zen-sandbox','open');
// ============================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

let sb = null;

export async function init(cfg) {
  if (!cfg) cfg = await import("./config.js");
  if (!cfg.SUPABASE_URL || cfg.SUPABASE_URL.includes("YOUR-PROJECT"))
    throw new Error("Rexy Leaderboard: fill in config.js with your Supabase URL and anon key.");
  sb = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  return sb;
}
function need() { if (!sb) throw new Error("Call Rexy.init() first."); return sb; }

// ---------- auth ----------
// Where an auth email should return you. Deliberately strips the hash and query:
// a bare origin+path is far more likely to match the Redirect URLs allow-list in
// Supabase, and coming back to "#game=..." mid-sign-in is not what you want.
export function returnUrl() {
  return window.location.origin + window.location.pathname;
}

export async function signIn(email) {
  const { error } = await need().auth.signInWithOtp({
    email,
    options: { emailRedirectTo: returnUrl() },
  });
  if (error) throw error;
  return { sent: true };            // user clicks the emailed magic link
}
export async function signInWithGoogle() {
  const { error } = await need().auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: returnUrl() },
  });
  if (error) throw error;
}
export async function signOut() { await need().auth.signOut(); }

// Password sign-in. A magic link is still how you first prove the email is
// yours; once in, call setPassword() and you can sign straight back in after
// that without waiting for an email.
export async function signInWithPassword(email, password) {
  const { error } = await need().auth.signInWithPassword({ email, password });
  if (error) throw error;
  return { ok: true };
}

// Sets (or changes) the password on the account you are currently signed into.
// No confirmation email — you already proved the address via the magic link.
export async function setPassword(password) {
  if (!password || password.length < 8) throw new Error("Password must be at least 8 characters.");
  const { error } = await need().auth.updateUser({ password });
  if (error) throw error;
  return { ok: true };
}

export async function getUser() {
  const { data } = await need().auth.getUser();
  return data?.user || null;
}
export function onAuthChange(cb) {
  need().auth.onAuthStateChange((_e, session) => cb(session?.user || null));
}

// ---------- profile ----------
export async function getProfile() {
  const u = await getUser(); if (!u) return null;
  const { data } = await need().from("profiles").select("*").eq("id", u.id).maybeSingle();
  return data;
}
export async function setDisplayName(name) {
  const u = await getUser(); if (!u) throw new Error("Sign in first.");
  name = (name || "").trim();
  if (name.length < 2 || name.length > 24) throw new Error("Name must be 2–24 characters.");
  const { error } = await need().from("profiles").upsert({ id: u.id, display_name: name });
  if (error) {
    if (error.code === "23505")
      throw new Error("That name is already used by another account — if it is one of yours, sign in as that account instead, or pick a different name.");
    throw error;
  }
  return { display_name: name };
}

// ---------- controls ----------
// Self-declared input type. Order = how it appears in pickers.
export const CONTROLS = [
  ["rexy_wheels", "Rexy Wheels"],
  ["hammerhead_wheels", "Hammerhead"],
  ["mouse", "Mouse"],
  ["gamepad", "Gamepad"],
  ["touchscreen", "Touchscreen"],
];
export const controlLabel = (c) => (CONTROLS.find(([k]) => k === c)?.[1]) || c || "—";

// ---------- scores ----------
// control = one of CONTROLS keys (self-reported)
export async function submitScore(gameId, control, score, { seed = null, trace = null, meta = null } = {}) {
  const { data, error } = await need().rpc("submit_score", {
    p_game_id: gameId, p_control: control, p_score: Math.round(score),
    p_seed: seed, p_trace: trace, p_meta: meta,
  });
  if (error) throw error;
  return data;                      // { id, rank, control }
}

// control = 'all' or a specific control key
export async function getLeaderboard(gameId, control = "all", period = "all", limit = 50) {
  const { data, error } = await need().rpc("get_leaderboard", {
    p_game_id: gameId, p_control: control, p_period: period, p_limit: limit,
  });
  if (error) throw error;
  return data || [];                // [{rank, display_name, score, control, user_id, created_at}]
}

// ---------- input-trace recorder (for later classification / replay) ----------
// Attach to a canvas/element; call .stop() to get a compact trace object you can
// pass as `trace` to submitScore. Mirrors the input-lab capture format.
export function makeTraceRecorder(target) {
  const t0 = performance.now(), ptr = [], pad = [];
  const r1 = v => Math.round(v * 10) / 10, r4 = v => Math.round(v * 1e4) / 1e4;
  let prev = null, raf = 0, recording = true;
  const onMove = (e, code) => {
    if (!recording) return;
    const r = target.getBoundingClientRect();
    const cx = (e.clientX ?? e.touches?.[0]?.clientX ?? 0) - r.left;
    const cy = (e.clientY ?? e.touches?.[0]?.clientY ?? 0) - r.top;
    const dx = e.movementX ?? (prev ? cx - prev.x : 0);
    const dy = e.movementY ?? (prev ? cy - prev.y : 0);
    prev = { x: cx, y: cy };
    ptr.push([Math.round(performance.now() - t0), code, r1(cx), r1(cy), r1(dx), r1(dy)]);
  };
  const mm = e => onMove(e, 0), tm = e => onMove(e, 3);
  target.addEventListener("mousemove", mm);
  target.addEventListener("touchmove", tm, { passive: true });
  const poll = () => {
    if (!recording) return;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) if (p) {
      const v = []; for (let i = 0; i < 6; i++) v.push(r4(p.axes[i] || 0));
      let b = 0; p.buttons.forEach((x, i) => { if (x.pressed) b |= (1 << i); });
      pad.push([Math.round(performance.now() - t0), ...v, b]);
      break;
    }
    raf = requestAnimationFrame(poll);
  };
  raf = requestAnimationFrame(poll);
  return {
    stop() {
      recording = false; cancelAnimationFrame(raf);
      target.removeEventListener("mousemove", mm);
      target.removeEventListener("touchmove", tm);
      return { schema: "rexy-trace-v1", pointer: ptr, gamepad: pad,
               ua: navigator.userAgent, dpr: Math.min(2, devicePixelRatio || 1) };
    },
  };
}
