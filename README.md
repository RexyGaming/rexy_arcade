# Rexy Arcade

Static shell for the Rexy mini-games, with global leaderboards.
Live: https://rexygaming.github.io/rexy_arcade/

## This repo is the canonical home of the client code

`lib/` holds the **single source of truth** for the shared front-end pieces.
Anything that needs them — the arcade, a game, the demo — imports from here.
Do not keep private copies; that is how they drift.

| file | what it is |
|---|---|
| `lib/rexy-leaderboard.js` | the client SDK: auth, profiles, score submit, board reads |
| `lib/config.js` | Supabase URL + **anon** public key (safe to ship; RLS protects the data) |
| `lib/rexy-theme.css` | the shared Rexy Bridge dark theme |
| `demo.html` | minimal SDK reference — sign in, submit, render a board |

The **database** lives elsewhere: `schema.sql`, `migration-control.sql` and the
setup notes stay in the `leaderboard/` folder, since they are applied to Supabase
rather than served to a browser.

## Layout

```
index.html          shell: game grid + game view
arcade.js           manifest load, grid, launcher, leaderboard panel
arcade.css          layout only — colours and components come from lib/rexy-theme.css
games.json          the registry; adding a game means adding an entry here
demo.html           SDK reference
GAME-CONTRACT.md    how a game attaches and reports a score
art/                card thumbnails
games/<id>/         each game, same origin so it inherits the signed-in session
lib/                canonical shared client code (see above)
```

## Running it locally

ES modules need http, not `file://`:

```
python -m http.server 8788
```

Then http://localhost:8788. Note that a local origin has its **own** Supabase
session and its own saved sign-in — signing in on localhost does not sign you in
on the live site, and vice versa. Add any origin you test from to
Supabase → Authentication → URL Configuration → Redirect URLs.

## Adding a game

1. Drop the game under `games/<id>/`.
2. Add one entry to `games.json`.
3. Follow `GAME-CONTRACT.md` so it submits scores and tells the shell to refresh.
