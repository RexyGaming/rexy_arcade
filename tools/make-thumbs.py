#!/usr/bin/env python3
"""
Write out arcade card thumbnails from each racer level.

The level editor already renders a 480x300 track thumbnail on export and stores
it inside the level file as `arcade.thumb` (a data-URL PNG). This just extracts
that to art/<id>.png so the arcade cards have matching images.

Run from the arcade root (the folder with games.json):
    python tools/make-thumbs.py           # only writes thumbs that don't exist yet
    python tools/make-thumbs.py --force    # rewrite every thumb

Add a level = drop its <id>.json into games/racer/levels/ and run this.
(No Pillow needed — the thumbnail is already a PNG inside the level file.)
"""
import os, sys, json, base64, glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LEVELS = os.path.join(ROOT, "games", "racer", "levels")
ART = os.path.join(ROOT, "art")
FORCE = "--force" in sys.argv

def main():
    os.makedirs(ART, exist_ok=True)
    made = skipped = 0
    for path in sorted(glob.glob(os.path.join(LEVELS, "*.json"))):
        lid = os.path.splitext(os.path.basename(path))[0]
        out = os.path.join(ART, lid + ".png")
        if os.path.exists(out) and not FORCE:
            skipped += 1; continue
        try:
            d = json.load(open(path, encoding="utf-8"))
            thumb = (d.get("arcade") or {}).get("thumb")
            if not thumb or "," not in thumb:
                print(f"  – {lid}: no arcade.thumb in level (re-export it from the editor), skipped")
                continue
            open(out, "wb").write(base64.b64decode(thumb.split(",", 1)[1]))
            print(f"  ✓ {lid}: art/{lid}.png")
            made += 1
        except Exception as e:
            print(f"  ! {lid}: {e}")
    print(f"Done — {made} written, {skipped} already existed"
          + ("" if FORCE else " (use --force to rewrite those)"))

if __name__ == "__main__":
    main()
