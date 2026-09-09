# Rexy Arcade

Static shell for the Rexy mini-games, with global leaderboards.

- `games.json` is the registry — the grid, the launcher and the board queries all read it.
- `lib/rexy-leaderboard.js` is the shared Supabase SDK. Auth happens once in the
  shell and every game inherits the session (same origin).
- See `GAME-CONTRACT.md` for how a game reports a score.

Serve over http (ES modules do not load from `file://`):

    python -m http.server 8788
