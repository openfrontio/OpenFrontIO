"""Validate nation and tribe spawns against the generated map.bin and map4x.bin.

Usage: python -I fix_spawns.py <repo root>

A spawn must be ownable land (land bit set, magnitude != 31) at full size and, for tribes, also at half size
(Compact games divide coordinates by 2). Offending spawns move to the nearest tile that passes both checks.
The game only reads map.bin, so this never changes the terrain, only info.json coordinates.
"""
import sys, os, json

root = sys.argv[1]
info_path = os.path.join(root, 'map-generator', 'assets', 'maps', 'canada', 'info.json')
maps = os.path.join(root, 'resources', 'maps', 'canada')
manifest = json.load(open(os.path.join(maps, 'manifest.json'), encoding='utf-8'))
full = open(os.path.join(maps, 'map.bin'), 'rb').read()
half = open(os.path.join(maps, 'map4x.bin'), 'rb').read()
W, H = manifest['map']['width'], manifest['map']['height']
W4, H4 = manifest['map4x']['width'], manifest['map4x']['height']


def ownable(data, w, h, x, y):
    """True when (x, y) is inside the map and a land tile that is not impassable."""
    if not (0 <= x < w and 0 <= y < h):
        return False
    b = data[y * w + x]
    return bool(b & 0x80) and (b & 0x1f) != 31


def ok(x, y, compact):
    """Spawn check at full size, plus half size when compact is True."""
    if not ownable(full, W, H, x, y):
        return False
    return (not compact) or ownable(half, W4, H4, x // 2, y // 2)


def nearest_ok(x, y, compact, radius=40):
    """Nearest tile to (x, y) passing ok(), searched in growing squares."""
    for r in range(1, radius + 1):
        best = None
        for dy in range(-r, r + 1):
            for dx in range(-r, r + 1):
                if max(abs(dx), abs(dy)) != r:
                    continue
                if ok(x + dx, y + dy, compact):
                    d = dx * dx + dy * dy
                    if best is None or d < best[0]:
                        best = (d, x + dx, y + dy)
        if best:
            return best[1], best[2]
    return None


info = json.load(open(info_path, encoding='utf-8'))
moved = 0
for kind, compact in (('nations', False), ('custom_tribes', True)):
    for e in info.get(kind, []):
        if 'coordinates' not in e:
            continue
        x, y = e['coordinates']
        if ok(x, y, compact):
            continue
        new = nearest_ok(x, y, compact)
        if new is None:
            print(f'!! {kind} {e["name"]} at {x},{y}: no ownable tile within 40 px')
            continue
        print(f'{kind} {e["name"]}: {x},{y} -> {new[0]},{new[1]} (compact check: {compact})')
        e['coordinates'] = [new[0], new[1]]
        moved += 1
open(info_path, 'w', encoding='utf-8', newline='\n').write(json.dumps(info, ensure_ascii=False, indent=2) + '\n')
print('moved', moved)
