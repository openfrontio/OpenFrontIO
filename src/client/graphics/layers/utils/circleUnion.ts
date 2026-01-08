export type Interval = [number, number];

export interface CircleLike {
  x: number;
  y: number;
  r: number;
  arcs: Interval[];
}

/**
 * Compute for a given circle which angular segments are NOT covered by other circles.
 * Mutates `circle.arcs` in place.
 *
 * `shouldConsider` allows skipping circles that shouldn't cover `circle`
 * (e.g., different owners). If it returns false, that other circle is ignored.
 */
export function computeUncoveredArcIntervals<T extends CircleLike>(
  circle: T,
  circles: T[],
  shouldConsider?: (circle: T, other: T) => boolean,
) {
  circle.arcs = [];
  const TWO_PI = Math.PI * 2;
  const EPS = 1e-9;

  const normalize = (a: number) => {
    while (a < 0) a += TWO_PI;
    while (a >= TWO_PI) a -= TWO_PI;
    return a;
  };

  const mergeIntervals = (
    intervals: Array<[number, number]>,
  ): Array<[number, number]> => {
    if (intervals.length === 0) return [];
    const flat: Array<[number, number]> = [];
    for (const [s, e] of intervals) {
      const ns = normalize(s);
      const ne = normalize(e);
      if (ne < ns) {
        flat.push([ns, TWO_PI]);
        flat.push([0, ne]);
      } else {
        flat.push([ns, ne]);
      }
    }
    flat.sort((a, b) => a[0] - b[0]);
    const merged: Array<[number, number]> = [];
    let cur = flat[0].slice() as [number, number];
    for (let i = 1; i < flat.length; i++) {
      const it = flat[i];
      if (it[0] <= cur[1] + EPS) {
        cur[1] = Math.max(cur[1], it[1]);
      } else {
        merged.push([cur[0], cur[1]]);
        cur = it.slice() as [number, number];
      }
    }
    merged.push([cur[0], cur[1]]);
    return merged;
  };

  const covered: Interval[] = [];
  let fullyCovered = false;

  for (const other of circles) {
    if (circle === other) continue;
    if (shouldConsider && !shouldConsider(circle, other)) continue;

    const dx = other.x - circle.x;
    const dy = other.y - circle.y;
    const d = Math.hypot(dx, dy);

    // circle fully inside other
    if (d + circle.r <= other.r + EPS) {
      fullyCovered = true;
      break;
    }

    // no overlap
    if (d >= circle.r + other.r - EPS) continue;

    // coincident centers
    if (d <= EPS) {
      if (other.r >= circle.r) {
        fullyCovered = true;
        break;
      }
      continue;
    }

    // angular span on circle covered by other
    const theta = Math.atan2(dy, dx);
    const cosPhi =
      (circle.r * circle.r + d * d - other.r * other.r) / (2 * circle.r * d);
    const phi = Math.acos(Math.max(-1, Math.min(1, cosPhi)));

    covered.push([theta - phi, theta + phi]);
  }

  if (fullyCovered) return;

  const merged = mergeIntervals(covered);

  // subtract from [0, 2π)
  const uncovered: Interval[] = [];
  if (merged.length === 0) {
    uncovered.push([0, TWO_PI]);
  } else {
    let cursor = 0;
    for (const [s, e] of merged) {
      if (s > cursor + EPS) {
        uncovered.push([cursor, s]);
      }
      cursor = Math.max(cursor, e);
    }
    if (cursor < TWO_PI - EPS) {
      uncovered.push([cursor, TWO_PI]);
    }
  }
  circle.arcs = uncovered;
}
