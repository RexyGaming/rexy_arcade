// ============================================================
// Rexy Arcade — shell
// Step 1: header, sign-in (magic link / Google) and profile name.
// Everything auth-, profile- and score-related goes through the shared
// SDK in lib/ — this file never talks to Supabase directly.
// ============================================================
import * as Rexy from "./lib/rexy-leaderboard.js";

const $ = (id) => document.getElementById(id);

const el = {
  dot:      $("authDot"),
  who:      $("whoami"),
  btnAuth:  $("btnAuth"),
  drawer:   $("drawer"),
  signedOut:$("signedOut"),
  signedIn: $("signedIn"),
  email:    $("email"),
  userEmail:$("userEmail"),
  dname:    $("dname"),
  status:   $("status"),
};

let currentUser = null;
let currentProfile = null;

// ---------- small helpers ----------
function say(msg, isError = false) {
  el.status.textContent = msg;
  el.status.classList.toggle("err", !!isError);
}
function openDrawer()  { el.drawer.classList.remove("hidden"); }
function closeDrawer() { el.drawer.classList.add("hidden"); }
function setDot(state) { el.dot.className = "status-dot " + state; el.dot.title = state; }

// Turn an SDK/Postgres error into something a person can act on.
function humanError(e) {
  const m = (e && (e.message || e.error_description)) || String(e);
  if (/Email not confirmed/i.test(m)) return "Check your inbox and click the link first.";
  if (/rate limit|too many/i.test(m))  return "Too many attempts — wait a minute and try again.";
  if (/redirect/i.test(m))             return m + "  (Add this URL to Supabase → Authentication → URL Configuration.)";
  return m;
}

// ---------- render ----------
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

    // Nudge: signed in but no display name yet, so scores would have nowhere to hang.
    if (!name) {
      openDrawer();
      say("Pick a display name — it's what shows on the leaderboards.");
    }
  } else {
    el.who.textContent = "Not signed in";
    el.who.classList.add("muted");
    el.btnAuth.textContent = "Sign in";
    setDot("off");
    el.signedIn.classList.add("hidden");
    el.signedOut.classList.remove("hidden");
  }
  el.btnAuth.classList.remove("hidden");
}

async function refreshProfile() {
  currentProfile = currentUser ? await Rexy.getProfile().catch(() => null) : null;
}

// ---------- wiring ----------
el.btnAuth.onclick   = openDrawer;
$("btnCloseA").onclick = closeDrawer;
$("btnCloseB").onclick = closeDrawer;
el.drawer.addEventListener("click", (e) => { if (e.target === el.drawer) closeDrawer(); });
addEventListener("keydown", (e) => { if (e.key === "Escape") closeDrawer(); });

$("btnMagic").onclick = async () => {
  const email = el.email.value.trim();
  if (!email) { say("Enter your email address first.", true); return; }
  try {
    say("Sending…");
    await Rexy.signIn(email);
    say("Link sent. Open it on this device — it returns you to this page signed in.");
  } catch (e) { say(humanError(e), true); }
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
  const name = el.dname.value.trim();
  try {
    say("Saving…");
    const r = await Rexy.setDisplayName(name);
    currentProfile = r;
    renderAuth();
    say(`Name saved: ${r.display_name}`);
  } catch (e) { say(humanError(e), true); }
};
el.dname.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); $("btnSaveName").click(); }
});

// ---------- boot ----------
(async function boot() {
  try {
    await Rexy.init();
  } catch (e) {
    setDot("err");
    el.who.textContent = "Backend unavailable";
    el.btnAuth.classList.remove("hidden");
    say(humanError(e), true);
    return;
  }

  // Fires on load with the restored session, and again on sign in/out.
  Rexy.onAuthChange(async (user) => {
    currentUser = user;
    await refreshProfile();
    renderAuth();
    if (user) say(`Signed in as ${currentProfile?.display_name || user.email}.`);
  });

  currentUser = await Rexy.getUser().catch(() => null);
  await refreshProfile();
  renderAuth();
  if (!currentUser) say("Not signed in.");
})();
