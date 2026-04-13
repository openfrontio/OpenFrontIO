#!/usr/bin/env python3
from __future__ import annotations

import argparse
import math
from pathlib import Path

from PIL import Image


OIL_RGBA = (24, 24, 24, 255)


def is_target_land(r: int, g: int, b: int, a: int) -> bool:
    if a == 0:
        return False
    # Water in the terrain source is a saturated dark blue; keep the test broad
    # so the script still works if coastline antialiasing varies slightly.
    return not (b > 80 and r < 60 and g < 80 and b > r + 30 and b > g + 20)


def is_reference_land(r: int, g: int, b: int, a: int) -> bool:
    return a > 0 and not (r > 245 and g > 245 and b > 245)


def is_reference_oil(r: int, g: int, b: int, a: int) -> bool:
    if a == 0:
        return False
    return r > 110 and r > g + 35 and r > b + 35 and g < 180 and b < 180


def mask_bbox(mask: list[list[bool]]) -> tuple[int, int, int, int]:
    xs: list[int] = []
    ys: list[int] = []
    for y, row in enumerate(mask):
        for x, value in enumerate(row):
            if value:
                xs.append(x)
                ys.append(y)
    if not xs:
        raise ValueError("mask has no positive pixels")
    return min(xs), min(ys), max(xs), max(ys)


def build_mask(image: Image.Image, predicate) -> list[list[bool]]:
    width, height = image.size
    mask: list[list[bool]] = []
    for y in range(height):
        row: list[bool] = []
        for x in range(width):
            row.append(predicate(*image.getpixel((x, y))))
        mask.append(row)
    return mask


def axis_counts(mask: list[list[bool]], axis: str) -> list[int]:
    height = len(mask)
    width = len(mask[0])
    if axis == "x":
        counts = [0] * width
        for row in mask:
            for x, value in enumerate(row):
                if value:
                    counts[x] += 1
        return counts

    counts = [0] * height
    for y, row in enumerate(mask):
        counts[y] = sum(1 for value in row if value)
    return counts


def longest_run_above_threshold(values: list[int], threshold: int) -> tuple[int, int]:
    best = (0, len(values) - 1)
    best_len = -1
    start: int | None = None
    for idx, value in enumerate(values + [0]):
        if value >= threshold and start is None:
            start = idx
        elif value < threshold and start is not None:
            end = idx - 1
            run_len = end - start + 1
            if run_len > best_len:
                best = (start, end)
                best_len = run_len
            start = None
    return best


def projected_axis_score(
    ref_counts: list[int],
    target_counts: list[int],
    scale: float,
    shift: float,
) -> float:
    projected = [0.0] * len(target_counts)
    for ref_idx, count in enumerate(ref_counts):
        if count == 0:
            continue
        start = ref_idx * scale + shift
        end = (ref_idx + 1) * scale + shift
        left = max(0, int(math.floor(start)))
        right = min(len(projected), int(math.ceil(end)))
        for target_idx in range(left, right):
            overlap = min(end, target_idx + 1) - max(start, target_idx)
            if overlap > 0:
                projected[target_idx] += count * overlap

    dot = 0.0
    ref_norm = 0.0
    target_norm = 0.0
    for projected_value, target_value in zip(projected, target_counts):
        dot += projected_value * target_value
        ref_norm += projected_value * projected_value
        target_norm += target_value * target_value

    if ref_norm == 0 or target_norm == 0:
        return float("-inf")
    return dot / math.sqrt(ref_norm * target_norm)


def fit_axis(
    ref_counts: list[int],
    target_counts: list[int],
    initial_scale: float,
    initial_shift: float,
    scale_span: float,
    shift_span: float,
    scale_step: float,
    shift_step: float,
) -> tuple[float, float]:
    best_scale = initial_scale
    best_shift = initial_shift
    best_score = float("-inf")

    scale_start = initial_scale - scale_span
    scale_end = initial_scale + scale_span
    shift_start = initial_shift - shift_span
    shift_end = initial_shift + shift_span

    scale = scale_start
    while scale <= scale_end + 1e-9:
        shift = shift_start
        while shift <= shift_end + 1e-9:
            score = projected_axis_score(ref_counts, target_counts, scale, shift)
            if score > best_score:
                best_score = score
                best_scale = scale
                best_shift = shift
            shift += shift_step
        scale += scale_step

    return best_scale, best_shift


def sample_points(mask: list[list[bool]], stride: int) -> list[tuple[int, int]]:
    points: list[tuple[int, int]] = []
    for y in range(0, len(mask), stride):
        row = mask[y]
        for x in range(0, len(row), stride):
            if row[x]:
                points.append((x, y))
    return points


def transform_score(
    points: list[tuple[int, int]],
    target_land: list[list[bool]],
    sx: float,
    sy: float,
    tx: float,
    ty: float,
) -> float:
    height = len(target_land)
    width = len(target_land[0])
    hit = 0.0
    water = 0.0
    out = 0.0

    for x, y in points:
        mapped_x = int(round(x * sx + tx))
        mapped_y = int(round(y * sy + ty))
        if mapped_x < 0 or mapped_x >= width or mapped_y < 0 or mapped_y >= height:
            out += 1.0
            continue
        if target_land[mapped_y][mapped_x]:
            hit += 1.0
        else:
            water += 1.0

    total = max(len(points), 1)
    return (hit - 0.7 * water - 0.4 * out) / total


def refine_transform(
    points: list[tuple[int, int]],
    target_land: list[list[bool]],
    sx: float,
    sy: float,
    tx: float,
    ty: float,
) -> tuple[float, float, float, float]:
    best = (sx, sy, tx, ty)
    best_score = transform_score(points, target_land, *best)

    for scale_step, shift_step in ((0.05, 8.0), (0.02, 4.0), (0.01, 2.0), (0.005, 1.0)):
        improved = True
        while improved:
            improved = False
            candidates = [
                (best[0] + scale_step, best[1], best[2], best[3]),
                (best[0] - scale_step, best[1], best[2], best[3]),
                (best[0], best[1] + scale_step, best[2], best[3]),
                (best[0], best[1] - scale_step, best[2], best[3]),
                (best[0], best[1], best[2] + shift_step, best[3]),
                (best[0], best[1], best[2] - shift_step, best[3]),
                (best[0], best[1], best[2], best[3] + shift_step),
                (best[0], best[1], best[2], best[3] - shift_step),
            ]
            for candidate in candidates:
                score = transform_score(points, target_land, *candidate)
                if score > best_score:
                    best = candidate
                    best_score = score
                    improved = True
    return best


def apply_oil_overlay(
    terrain: Image.Image,
    terrain_land: list[list[bool]],
    oil_mask: list[list[bool]],
    sx: float,
    sy: float,
    tx: float,
    ty: float,
) -> int:
    width, height = terrain.size
    painted = 0
    pixels = terrain.load()

    for y, row in enumerate(oil_mask):
        for x, is_oil in enumerate(row):
            if not is_oil:
                continue

            start_x = max(0, int(math.floor(x * sx + tx)))
            end_x = min(width, int(math.ceil((x + 1) * sx + tx)))
            start_y = max(0, int(math.floor(y * sy + ty)))
            end_y = min(height, int(math.ceil((y + 1) * sy + ty)))

            for target_y in range(start_y, end_y):
                for target_x in range(start_x, end_x):
                    if not terrain_land[target_y][target_x]:
                        continue
                    if pixels[target_x, target_y] != OIL_RGBA:
                        pixels[target_x, target_y] = OIL_RGBA
                        painted += 1

    return painted


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Transfer red oil-reserve markings from a reference world map onto the "
            "terrain map by auto-aligning the two images."
        )
    )
    parser.add_argument("terrain", type=Path, help="path to the terrain image to edit")
    parser.add_argument("reference", type=Path, help="path to the reference image with red oil areas")
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        help="output path for the edited terrain image (defaults to overwriting terrain)",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    output_path = args.output or args.terrain

    terrain = Image.open(args.terrain).convert("RGBA")
    reference = Image.open(args.reference).convert("RGBA")

    terrain_land = build_mask(terrain, is_target_land)
    reference_land = build_mask(reference, is_reference_land)
    reference_oil = build_mask(reference, is_reference_oil)

    ref_x0, ref_y0, ref_x1, ref_y1 = mask_bbox(reference_land)
    ref_width = ref_x1 - ref_x0 + 1
    ref_height = ref_y1 - ref_y0 + 1

    target_cols = axis_counts(terrain_land, "x")
    target_rows = axis_counts(terrain_land, "y")
    target_y0, target_y1 = longest_run_above_threshold(target_rows, max(100, terrain.width // 20))

    initial_sx = terrain.width / ref_width
    initial_tx = -ref_x0 * initial_sx
    initial_sy = (target_y1 - target_y0 + 1) / ref_height
    initial_ty = target_y0 - ref_y0 * initial_sy

    ref_cols = axis_counts(reference_land, "x")
    ref_rows = axis_counts(reference_land, "y")

    sx, tx = fit_axis(
        ref_cols,
        target_cols,
        initial_sx,
        initial_tx,
        scale_span=initial_sx * 0.18,
        shift_span=max(40.0, terrain.width * 0.04),
        scale_step=0.01,
        shift_step=1.0,
    )
    sy, ty = fit_axis(
        ref_rows,
        target_rows,
        initial_sy,
        initial_ty,
        scale_span=max(0.2, initial_sy * 0.18),
        shift_span=max(60.0, terrain.height * 0.08),
        scale_step=0.01,
        shift_step=1.0,
    )

    sampled_land_points = sample_points(reference_land, stride=3)
    sx, sy, tx, ty = refine_transform(sampled_land_points, terrain_land, sx, sy, tx, ty)

    painted = apply_oil_overlay(terrain, terrain_land, reference_oil, sx, sy, tx, ty)
    terrain.save(output_path)

    print(f"Saved {output_path}")
    print(f"Alignment: sx={sx:.4f}, sy={sy:.4f}, tx={tx:.2f}, ty={ty:.2f}")
    print(f"Painted {painted} terrain pixels as oil")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
