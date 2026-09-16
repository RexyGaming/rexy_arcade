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

## Rexy Racer levels

Every Rexy Racer level is played by **one engine**, `games/racer/index.html`,
which loads a level file:

```
games/racer/index.html        the engine; ?level=<id> picks the level
games/racer/core.js           road geometry + collision, shared with the editor
games/racer/art.json          sprites, textures, medals (shared by all levels)
games/racer/snd.json          sounds (shared by all levels)
games/racer/levels/<id>.json  one file per level
editor/                       the level editor (not linked from the arcade)
tools/add_level.py            adds an exported level to the arcade
```

`editor/index.html` draws roads (curves, straight lines or track pieces, over an
optional traced image or PDF), places furniture, coins and checkpoints, checks
the level with the game's own collision rules (completable? racing line? how
much skill does each coin take?), test-plays it, and exports one `<id>.json`.
To publish an exported level:

```
python tools/add_level.py path/to/<id>.json
```

A level can also carry its own look: a backdrop image laid under the track and
custom road/grass tile textures (the editor's Look panel). Exports carry them
inline; `add_level.py` saves them to `games/racer/levels/<id>/`.

That writes the level file, the card thumbnail and the `games.json` entry. Scores
are keyed by the level id, so never rename the id of a level that has scores.
`games/rexy-racer-aco/` and `games/rexy-logo/` are the old one-page builds, kept
for reference; the arcade no longer points at them.

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
