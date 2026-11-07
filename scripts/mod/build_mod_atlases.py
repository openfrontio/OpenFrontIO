#!/usr/bin/env python3
"""
Appends the mod's icons to the game's sprite atlases, drawn from the Font
Awesome Free SVGs in resources/icons/fa/ (CC BY 4.0, see LICENSE.txt there).

  icon-atlas.png  structure icons, 64x64 cells, white single-colour glyphs.
                  Existing cells are left untouched; new cells are appended.
  unit-atlas.png  moving-unit sprites, 13x13 cells. Same colour conventions the
                  shader recolours: 180 grey = territory colour, 70 grey = border.

Idempotent: it trims the atlases back to their original width first, so
running it twice gives the same result.

Needs: rsvg-convert, Pillow.   Usage: python3 scripts/mod/build_mod_atlases.py
"""
import io
import subprocess
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
FA = ROOT / "resources" / "icons" / "fa"
ATLASES = ROOT / "resources" / "atlases"

ICON_CELL = 64
ICON_BASE_COLS = 6
# Glyph fills about this much of a cell; matches the existing icons (~40px).
ICON_GLYPH = 40
ICON_NEW = ["plane-departure", "person-shelter"]  # Airport, Survivor Camp

UNIT_CELL = 13
UNIT_BASE_COLS = 12
# Tank, Fighter Jet, Cargo Plane. Font Awesome Free has no tank glyph, and at
# 13px a truck is an unreadable blob, so the tank is drawn by hand (below).
# (glyph, inner size before the 1px outline). Sprites are drawn at map scale, so
# keep them small: a transport is 5px and a warship 11px.
UNIT_NEW = [(None, 0), ("jet-fighter", 7), ("plane", 5)]

# '#' = border (70), 'o' = territory colour (180).
TANK_ART = [
    ".............",
    ".............",
    ".............",
    "....###......",
    "....#o#......",
    "....#o####...",
    "...#######...",
    "..#ooooooo#..",
    "..#ooooooo#..",
    "...#######...",
    ".............",
    ".............",
    ".............",
]


def rasterize(name: str, box: int) -> Image.Image:
    """White-on-transparent glyph fitted inside a box x box square."""
    svg = (FA / f"{name}.svg").read_text().replace("currentColor", "#ffffff")
    png = subprocess.run(
        ["rsvg-convert", "-f", "png", "-w", str(box), "-h", str(box),
         "--keep-aspect-ratio"],
        input=svg.encode(), capture_output=True, check=True,
    ).stdout
    glyph = Image.open(io.BytesIO(png)).convert("RGBA")
    out = Image.new("RGBA", (box, box), (0, 0, 0, 0))
    out.paste(glyph, ((box - glyph.width) // 2, (box - glyph.height) // 2), glyph)
    return out


def extend(path: Path, base_cols: int, cell: int, new_cells: list[Image.Image]):
    atlas = Image.open(path).convert("RGBA")
    atlas = atlas.crop((0, 0, base_cols * cell, atlas.height))
    out = Image.new("RGBA", (atlas.width + len(new_cells) * cell, atlas.height))
    out.paste(atlas, (0, 0))
    for i, c in enumerate(new_cells):
        out.paste(c, (atlas.width + i * cell, 0))
    out.save(path, optimize=True)
    print(f"{path.name}: {atlas.width}px -> {out.width}px")


def icon_cell(name: str) -> Image.Image:
    cell = Image.new("RGBA", (ICON_CELL, ICON_CELL), (0, 0, 0, 0))
    g = rasterize(name, ICON_GLYPH)
    cell.paste(g, ((ICON_CELL - ICON_GLYPH) // 2, (ICON_CELL - ICON_GLYPH) // 2), g)
    return cell


def art_cell(art: list[str]) -> Image.Image:
    cell = Image.new("RGBA", (UNIT_CELL, UNIT_CELL), (0, 0, 0, 0))
    for y, row in enumerate(art):
        for x, ch in enumerate(row):
            if ch == "#":
                cell.putpixel((x, y), (70, 70, 70, 255))
            elif ch == "o":
                cell.putpixel((x, y), (180, 180, 180, 255))
    return cell


def unit_cell(spec: tuple[str | None, int]) -> Image.Image:
    """Hard-edged sprite: 180 fill with a 70 outline, like the other units."""
    name, inner = spec
    if name is None:
        return art_cell(TANK_ART)
    glyph = rasterize(name, inner)
    mask = [[glyph.getpixel((x, y))[3] > 110 for x in range(inner)]
            for y in range(inner)]
    off = (UNIT_CELL - inner) // 2
    solid = set()
    for y in range(inner):
        for x in range(inner):
            if mask[y][x]:
                solid.add((x + off, y + off))
    cell = Image.new("RGBA", (UNIT_CELL, UNIT_CELL), (0, 0, 0, 0))
    for (x, y) in solid:
        cell.putpixel((x, y), (180, 180, 180, 255))
    for (x, y) in solid:
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            n = (x + dx, y + dy)
            if (0 <= n[0] < UNIT_CELL and 0 <= n[1] < UNIT_CELL
                    and n not in solid):
                cell.putpixel(n, (70, 70, 70, 255))
    return cell


if __name__ == "__main__":
    extend(ATLASES / "icon-atlas.png", ICON_BASE_COLS, ICON_CELL,
           [icon_cell(n) for n in ICON_NEW])
    extend(ATLASES / "unit-atlas.png", UNIT_BASE_COLS, UNIT_CELL,
           [unit_cell(n) for n in UNIT_NEW])
