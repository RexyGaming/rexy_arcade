# Game contract

How a game attaches to Rexy Arcade. Two steps: add an entry to `games.json`,
and make the game report its score through the shared SDK.

Everything lives under the **same origin** as the shell — that is what lets a
game reuse the Supabase session you signed into in the arcade header. A game
hosted elsewhere will load in the iframe but will always look signed out.

---

## 1 · Register it in `games.json`

`games.json` is the single source of truth. The grid, the launcher and the
leaderboard queries all read it; nothing about a game is hard-coded in the shell.

```json
{
  "id": "rexy-racer-aco",
  "title": "Rexy Racer — ACO",
  "description": "Steady-hand time trial. Follow the track, don't touch the walls.",
  "credit": "Original Unreal game by Koen Ebeling",
  "thumb": "art/rexy-racer-aco.png",
  "url": "games/rexy-racer-aco/index.html",
  "inputs": ["rexy_wheels", "mouse"],
  "score": { "type": "time", "base": 600000, "decimals": 2 },
  "status": "live"
}
```

| field | required | what it does |
|---|---|---|
| `id` | yes | the `game_id` in every leaderboard call. Never change it once scores exist. |
| `title`, `description` | yes | card text |
| `url` | yes | path to the game page, relative to the shell |
| `status` | yes | `live` or `coming soon` — the latter renders a card that isn't clickable |
| `thumb` | no | card image, 16:10 looks best |
| `credit` | no | shown under the title in the game view |
| `inputs` | no | control keys, shown on the card as a hint. Display only — the board filter always reads `Rexy.CONTROLS`, so it can't drift from the database. |
| `score` | no | how to render the raw integer score. Omit for plain points. |

### The `score` block, and why it exists

`get_leaderboard` sorts **`score desc` — higher is better**. That suits a points
game directly, but a time trial is the other way round, so the game submits an
inverted number and the shell turns it back for display.

```
submitted score = base − elapsed_milliseconds     (clamped at 0)
displayed time  = (base − score) / 1000
```

With `base: 600000` (ten minutes), a 22.50s run stores `577500` and sorts above a
30s run's `570000`. Anything slower than the base clamps to `0` and comes last.

- `{ "type": "points" }` or omitted — show the number as-is, thousands separated.
- `{ "type": "time", "base": 600000, "decimals": 2 }` — show `22.50s`.

**The game's `base` and the manifest's `base` must match**, or times will display
wrongly. Keep them together when you change either.

---

## 2 · Report the score

On game over, with a control type the player picked:

```js
import * as Rexy from '../../lib/rexy-leaderboard.js';
await Rexy.init();

const r = await Rexy.submitScore(GAME_ID, control, score, {
  seed, trace, meta            // all optional
});

window.parent.postMessage(
  { type: 'rexy:gameover', id: GAME_ID, control, score, rank: r.rank },
  location.origin
);
```

The shell refreshes that game's board on `rexy:gameover` and shows the new rank.
It ignores messages that aren't from its own origin and its own iframe.

### Control type

`control` must be one of the keys in `Rexy.CONTROLS`
(`rexy_wheels`, `hammerhead_wheels`, `mouse`, `gamepad`, `touchscreen`). Anything
else is rejected by the database with `invalid control …`. Build the picker from
`Rexy.CONTROLS` rather than typing the keys out, and persist the choice in
`localStorage` — at an event everyone on a stand uses the same hardware and
re-picking every run gets old.

It is self-declared and unverified for now. The `trace` from
`Rexy.makeTraceRecorder(canvas)` is what a later server-side classifier will use
to confirm a run really was played on wheels.

### Messages the shell sends back

| message | when | use it for |
|---|---|---|
| `rexy:auth` | on load and whenever sign-in changes | `{ signedIn, displayName }` — show who the score will be posted as |
| — | — | send `{ type:'rexy:needsauth', id }` to ask the shell to open its sign-in drawer |

### Requirements the database enforces

- signed in, **and** a display name already set — otherwise `no profile: set a
  display name first`
- score an integer `0 ≤ score < 100000000`
- at most 30 submissions per user per minute

Surface those as readable messages rather than raw errors; the shell's
`humanError()` shows the pattern.

---

## 3 · Games that also run standalone

Rexy Racer ships as a single self-contained file used both at events (offline,
from a USB stick) and inside the arcade. It does that with one flag:

```js
const IN_ARCADE = (function(){ try { return window.parent !== window; } catch(e){ return false; } })();
```

The arcade bridge sits in a `<script type="module">` guarded by `if (IN_ARCADE)`,
and the SDK is brought in with a **dynamic** `import()` inside that guard — so the
standalone build never requests `../../lib/` and never 404s. Standalone, the game
keeps its own local leaderboard; in the arcade, the local name box is swapped for
a control picker and a submit button.

Its canonical source is the template in the Rexy Racer project; the copy under
`games/rexy-racer-aco/` is a build output. Rebuild there, then copy across.
