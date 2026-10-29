// Writes resources/images/EarthMap.svg, the map picker's Earth view, from
// Natural Earth's 1:50m countries (world-atlas TopoJSON).
// Run with `npx tsx scripts/genEarthMap.ts [topojson path or URL]`.
import fs from "fs";
import path from "path";
import {
  EARTH_MAP_HEIGHT,
  EARTH_MAP_WIDTH,
  projectEarth,
} from "../src/client/components/map/EarthProjection";

const SOURCE =
  "https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-50m.json";
const OUT = path.resolve(
  import.meta.dirname,
  "../resources/images/EarthMap.svg",
);
// Simplification tolerance and smallest ring kept, in viewBox units.
const TOLERANCE = 0.12;
const MIN_RING_AREA = 0.15;

type Point = [number, number];
interface Topology {
  transform: { scale: Point; translate: Point };
  objects: {
    countries: {
      geometries: (
        | { type: "Polygon"; arcs: number[][] }
        | { type: "MultiPolygon"; arcs: number[][][] }
      )[];
    };
  };
  arcs: Point[][];
}

function decodeArc(topology: Topology, arc: Point[]): Point[] {
  const [sx, sy] = topology.transform.scale;
  const [tx, ty] = topology.transform.translate;
  let x = 0;
  let y = 0;
  return unwrap(
    arc.map(([dx, dy]) => {
      x += dx;
      y += dy;
      return projectEarth(y * sy + ty, x * sx + tx);
    }),
  );
}

// Removes jumps across the antimeridian, so a line crossing it stays short
// and may run past the map's left or right edge.
function unwrap(points: Point[]): Point[] {
  let offset = 0;
  return points.map(([x, y], i) => {
    const jump = i === 0 ? 0 : x - points[i - 1][0];
    if (jump > EARTH_MAP_WIDTH / 2) offset -= EARTH_MAP_WIDTH;
    if (jump < -EARTH_MAP_WIDTH / 2) offset += EARTH_MAP_WIDTH;
    return [x + offset, y];
  });
}

// The ring, plus a copy on the other side for any part past an edge.
function wrapped(ring: Point[]): Point[][] {
  const xs = ring.map(([x]) => x);
  const copies = [ring];
  if (Math.min(...xs) < 0) {
    copies.push(ring.map(([x, y]) => [x + EARTH_MAP_WIDTH, y]));
  }
  if (Math.max(...xs) > EARTH_MAP_WIDTH) {
    copies.push(ring.map(([x, y]) => [x - EARTH_MAP_WIDTH, y]));
  }
  return copies;
}

function segmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSq = dx * dx + dy * dy;
  const t =
    lengthSq === 0
      ? 0
      : Math.max(
          0,
          Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSq),
        );
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function simplify(points: Point[]): Point[] {
  if (points.length <= 2) return points;
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = keep[points.length - 1] = true;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    let farthest = -1;
    let maxDistance = TOLERANCE;
    for (let i = first + 1; i < last; i++) {
      const d = segmentDistance(points[i], points[first], points[last]);
      if (d > maxDistance) {
        maxDistance = d;
        farthest = i;
      }
    }
    if (farthest !== -1) {
      keep[farthest] = true;
      stack.push([first, farthest], [farthest, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

function ringArea(ring: Point[]): number {
  let area = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    area += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  }
  return Math.abs(area / 2);
}

function formatNumber(n: number): string {
  return (Math.round(n * 10) / 10).toString().replace(/^(-?)0\./, "$1.");
}

function ringPath(ring: Point[]): string {
  const rounded = ring.map(([x, y]) => [
    Math.round(x * 10) / 10,
    Math.round(y * 10) / 10,
  ]);
  let d = `M${formatNumber(rounded[0][0])} ${formatNumber(rounded[0][1])}l`;
  for (let i = 1; i < rounded.length - 1; i++) {
    const dx = formatNumber(rounded[i][0] - rounded[i - 1][0]);
    const dy = formatNumber(rounded[i][1] - rounded[i - 1][1]);
    d += `${i > 1 && !dx.startsWith("-") ? " " : ""}${dx}${dy.startsWith("-") ? "" : " "}${dy}`;
  }
  return d + "z";
}

async function main() {
  const source = process.argv[2] ?? SOURCE;
  const topology: Topology = JSON.parse(
    source.startsWith("http")
      ? await (await fetch(source)).text()
      : fs.readFileSync(source, "utf8"),
  );
  const arcs = topology.arcs.map((arc) => simplify(decodeArc(topology, arc)));
  const ring = (indices: number[]): Point[] =>
    indices.flatMap((index, i) => {
      const arc = index >= 0 ? arcs[index] : [...arcs[~index]].reverse();
      return i === 0 ? arc : arc.slice(1);
    });

  const paths: string[] = [];
  for (const geometry of topology.objects.countries.geometries) {
    const polygons =
      geometry.type === "Polygon" ? [geometry.arcs] : geometry.arcs;
    for (const polygon of polygons) {
      for (const indices of polygon) {
        const points = unwrap(ring(indices));
        if (points.length >= 4 && ringArea(points) >= MIN_RING_AREA) {
          paths.push(...wrapped(points).map(ringPath));
        }
      }
    }
  }

  fs.writeFileSync(
    OUT,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${EARTH_MAP_WIDTH} ${EARTH_MAP_HEIGHT}"><path fill="#1e293b" stroke="#334155" stroke-width="0.3" fill-rule="evenodd" d="${paths.join("")}"/></svg>\n`,
  );
  console.log(`Wrote ${OUT} (${paths.length} rings)`);
}

void main();
