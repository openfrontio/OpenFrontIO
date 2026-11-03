// Writes resources/images/EarthMap.svg, the map picker's Earth view, from
// Natural Earth's 1:50m countries (world-atlas TopoJSON).
// Run with `npx tsx scripts/genEarthMap.ts [topojson path or URL]`.
import { geoArea, geoEqualEarth, geoPath } from "d3";
import fs from "fs";
import path from "path";
import {
  EARTH_MAP_HEIGHT,
  EARTH_MAP_SCALE,
  EARTH_MAP_WIDTH,
  projectEarth,
} from "../src/client/components/map/EarthProjection";

const SOURCE =
  "https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-50m.json";
const OUT = path.resolve(
  import.meta.dirname,
  "../resources/images/EarthMap.svg",
);
// Simplification tolerance and smallest area kept, in viewBox units.
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

const projection = geoEqualEarth()
  .scale(EARTH_MAP_SCALE)
  .translate([EARTH_MAP_WIDTH / 2, EARTH_MAP_HEIGHT / 2])
  .precision(0.5);

const project = ([lon, lat]: Point): Point => projectEarth(lat, lon);

// Arc points as [lon, lat].
function decodeArc(topology: Topology, arc: Point[]): Point[] {
  const [sx, sy] = topology.transform.scale;
  const [tx, ty] = topology.transform.translate;
  let x = 0;
  let y = 0;
  return arc.map(([dx, dy]) => {
    x += dx;
    y += dy;
    return [x * sx + tx, y * sy + ty];
  });
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

// Douglas-Peucker on the projected points, keeping the original coordinates.
function simplify(points: Point[]): Point[] {
  if (points.length <= 2) return points;
  const projected = points.map(project);
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = keep[points.length - 1] = true;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    let farthest = -1;
    let maxDistance = TOLERANCE;
    for (let i = first + 1; i < last; i++) {
      const d = segmentDistance(
        projected[i],
        projected[first],
        projected[last],
      );
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

function formatNumber(n: number): string {
  return (Math.round(n * 10) / 10).toString().replace(/^(-?)0\./, "$1.");
}

// d3 writes absolute "Mx,yLx,y…Z" rings; relative moves are a third smaller.
function relative(d: string): string {
  return d
    .split("Z")
    .map((ring) =>
      ring
        .slice(1)
        .split("L")
        .map((p) => p.split(",").map(Number)),
    )
    .filter((points) => points.length >= 3)
    .map((points) => {
      let ring = `M${formatNumber(points[0][0])} ${formatNumber(points[0][1])}l`;
      for (let i = 1; i < points.length; i++) {
        const dx = formatNumber(points[i][0] - points[i - 1][0]);
        const dy = formatNumber(points[i][1] - points[i - 1][1]);
        ring += `${i > 1 && !dx.startsWith("-") ? " " : ""}${dx}${dy.startsWith("-") ? "" : " "}${dy}`;
      }
      return ring + "z";
    })
    .join("");
}

// Equal Earth keeps areas, so spherical area converts straight to viewBox units.
// The smaller side counts: Antarctica's outer ring is "everything but the pole".
function largeEnough(rings: Point[][]): boolean {
  const area = geoArea({ type: "Polygon", coordinates: rings });
  const smaller = Math.min(area, 4 * Math.PI - area);
  return smaller * EARTH_MAP_SCALE * EARTH_MAP_SCALE >= MIN_RING_AREA;
}

async function main() {
  for (const [lat, lon] of [
    [51.5, -0.1],
    [-33.9, 151.2],
    [64.1, -21.9],
  ]) {
    const [x, y] = projection([lon, lat])!;
    const [ex, ey] = projectEarth(lat, lon);
    if (Math.hypot(x - ex, y - ey) > 0.01) {
      throw new Error("d3's Equal Earth disagrees with EarthProjection.ts");
    }
  }

  const source = process.argv[2] ?? SOURCE;
  const topology: Topology = JSON.parse(
    source.startsWith("http")
      ? await (await fetch(source)).text()
      : fs.readFileSync(source, "utf8"),
  );
  const raw = topology.arcs.map((arc) => decodeArc(topology, arc));
  const simplified = raw.map(simplify);
  const join = (arcs: Point[][], indices: number[]): Point[] =>
    indices.flatMap((index, i) => {
      const arc = index >= 0 ? arcs[index] : [...arcs[~index]].reverse();
      return i === 0 ? arc : arc.slice(1);
    });
  // A ring that simplifies down to a line, like the pole cap, keeps its points.
  const ring = (indices: number[]): Point[] => {
    const points = join(simplified, indices);
    return points.length >= 4 ? points : join(raw, indices);
  };

  const polygons: Point[][][] = [];
  for (const geometry of topology.objects.countries.geometries) {
    const parts = geometry.type === "Polygon" ? [geometry.arcs] : geometry.arcs;
    for (const part of parts) {
      const [outer, ...holes] = part.map(ring);
      const kept = holes.filter((hole) => largeEnough([hole]));
      if (largeEnough([outer, ...kept])) polygons.push([outer, ...kept]);
    }
  }

  const draw = geoPath(projection).digits(1);
  const sphere = relative(draw({ type: "Sphere" })!);
  const land = relative(draw({ type: "MultiPolygon", coordinates: polygons })!);
  fs.writeFileSync(
    OUT,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${EARTH_MAP_WIDTH} ${EARTH_MAP_HEIGHT}"><path id="sphere" fill="#0f172a" d="${sphere}"/><path id="land" fill="#1e293b" stroke="#334155" stroke-width="0.3" fill-rule="evenodd" d="${land}"/></svg>\n`,
  );
  console.log(`Wrote ${OUT} (${polygons.length} polygons)`);
}

void main();
