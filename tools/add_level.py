"""Add (or update) a Rexy Racer level exported from the level editor.

    python tools/add_level.py path/to/my-level.json

Writes games/racer/levels/<id>.json, art/<id>.png (the card thumbnail the editor
embedded), and adds or updates the level's entry in games.json. Updating an
existing id keeps its place in the grid and its leaderboard - scores are keyed
by id, so never rename the id of a level that already has scores.
"""
import base64
import io
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENGINE_URL = 'games/racer/index.html?level=%s'


IMG_EXT = {'png': 'png', 'jpeg': 'jpg', 'jpg': 'jpg', 'webp': 'webp', 'gif': 'gif', 'svg+xml': 'svg'}


def extract_images(doc, lid):
    # Backdrop and textures arrive inline as data: URLs. Save each as a file in
    # games/racer/levels/<id>/ and point the level at it (paths are relative to levels/).
    folder = os.path.join(ROOT, 'games', 'racer', 'levels', lid)
    slots = []                            # (file name, dict holding the source, key)
    if doc.get('backdrop'):
        slots.append(('backdrop', doc['backdrop'], 'src'))
    for k, v in (doc.get('textures') or {}).items():
        slots.append((k, v, 'src'))
    images = doc.get('images') or {}      # sticker images, by id
    for k in images:
        if not re.fullmatch(r'[A-Za-z0-9_-]+', k) or k in ('backdrop', 'road', 'grass'):
            sys.exit('bad sticker image id %r' % k)
        slots.append((k, images, k))
    saved, keep = [], set()
    for name, holder, key in slots:
        src = holder.get(key, '')
        m = re.match(r'data:image/([a-z+]+);base64,(.*)', src, re.S)
        if not m:
            if src.startswith(lid + '/'):   # already a file in this level's folder
                keep.add(src.split('/', 1)[1])
            continue
        ext = IMG_EXT.get(m.group(1))
        if not ext:
            sys.exit('unsupported %s image type: %s' % (name, m.group(1)))
        os.makedirs(folder, exist_ok=True)
        fname = name + '.' + ext
        with open(os.path.join(folder, fname), 'wb') as f:
            f.write(base64.b64decode(m.group(2)))
        holder[key] = '%s/%s' % (lid, fname)
        keep.add(fname)
        saved.append('games/racer/levels/' + holder[key])
    # anything else in the level's folder is left over from an earlier version
    if os.path.isdir(folder):
        for old in sorted(os.listdir(folder)):
            if old not in keep:
                os.remove(os.path.join(folder, old))
                saved.append('removed games/racer/levels/%s/%s' % (lid, old))
    return saved


def main(path):
    with io.open(path, encoding='utf-8') as f:
        doc = json.load(f)
    if doc.get('format') != 'rexy-racer-level':
        sys.exit('not a Rexy Racer level file: %s' % path)
    lid = doc.get('id', '')
    if not re.fullmatch(r'[a-z0-9][a-z0-9_-]*', lid) or lid == 'draft':
        sys.exit('bad level id %r - lowercase letters, digits, - and _ only' % lid)

    saved = extract_images(doc, lid)

    arcade = dict(doc.get('arcade') or {})
    thumb = arcade.pop('thumb', None)
    doc['arcade'] = arcade          # description + credit stay with the level for re-editing

    lvl_path = os.path.join(ROOT, 'games', 'racer', 'levels', lid + '.json')
    with io.open(lvl_path, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(doc, f, ensure_ascii=False, separators=(',', ':'))

    thumb_rel = None
    if thumb and thumb.startswith('data:image/png;base64,'):
        thumb_rel = 'art/%s.png' % lid
        with open(os.path.join(ROOT, thumb_rel), 'wb') as f:
            f.write(base64.b64decode(thumb.split(',', 1)[1]))

    gpath = os.path.join(ROOT, 'games.json')
    with io.open(gpath, encoding='utf-8') as f:
        games = json.load(f)
    entry = next((g for g in games if g.get('id') == lid), None)
    is_new = entry is None
    if is_new:
        entry = {
            'id': lid,
            'inputs': ['rexy_wheels', 'mouse'],
            'score': {'type': 'time', 'base': 600000, 'decimals': 2,
                      'note': 'Submitted as base minus total milliseconds, so faster is a higher score.'},
            'status': 'live',
        }
        games.append(entry)
    entry['title'] = 'Rexy Racer — ' + doc.get('title', lid)
    if arcade.get('description'):
        entry['description'] = arcade['description']
    entry.setdefault('description', doc.get('blurb', ''))
    if arcade.get('credit'):
        entry['credit'] = arcade['credit']
    if thumb_rel:
        entry['thumb'] = thumb_rel
    entry['url'] = ENGINE_URL % lid
    # keep a readable key order in the manifest
    order = ['id', 'title', 'description', 'credit', 'thumb', 'url', 'inputs', 'score', 'status']
    games[games.index(entry)] = {k: entry[k] for k in order if k in entry} | {k: v for k, v in entry.items() if k not in order}

    with io.open(gpath, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(games, f, ensure_ascii=False, indent=2)
        f.write('\n')

    print('%s level %s: %d roads, %d kerbs, %d furniture, %d coins, %d checkpoints, medals %s/%s/%s' % (
        'added' if is_new else 'updated', lid, len(doc.get('roads', [])), len(doc.get('kerbs', [])),
        len(doc.get('obstacles', [])), len(doc.get('coins', [])), len(doc.get('checkpoints', [])),
        doc.get('gold'), doc.get('silver'), doc.get('bronze')))
    print('  ' + os.path.relpath(lvl_path, ROOT))
    if thumb_rel:
        print('  ' + thumb_rel)
    for s in saved:
        print('  ' + s)
    print('  games.json -> ' + entry['url'])


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
