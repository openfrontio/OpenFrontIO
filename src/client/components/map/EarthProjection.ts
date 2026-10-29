// Equal Earth projection in the viewBox units of resources/images/EarthMap.svg,
// which scripts/genEarthMap.ts draws with d3's geoEqualEarth at this scale.
const A1 = 1.340264;
const A2 = -0.081106;
const A3 = 0.000893;
const A4 = 0.003796;
const M = Math.sqrt(3) / 2;

function equalEarth(lat: number, lon: number): [number, number] {
  const theta = Math.asin(M * Math.sin((lat * Math.PI) / 180));
  const t2 = theta * theta;
  const t6 = t2 * t2 * t2;
  return [
    (((lon * Math.PI) / 180) * Math.cos(theta)) /
      (M * (A1 + 3 * A2 * t2 + t6 * (7 * A3 + 9 * A4 * t2))),
    theta * (A1 + A2 * t2 + t6 * (A3 + A4 * t2)),
  ];
}

export const EARTH_MAP_WIDTH = 1000;
export const EARTH_MAP_SCALE = EARTH_MAP_WIDTH / 2 / equalEarth(0, 180)[0];
export const EARTH_MAP_HEIGHT = Math.ceil(
  2 * equalEarth(90, 0)[1] * EARTH_MAP_SCALE,
);

export function projectEarth(lat: number, lon: number): [number, number] {
  const [x, y] = equalEarth(lat, lon);
  return [
    EARTH_MAP_WIDTH / 2 + x * EARTH_MAP_SCALE,
    EARTH_MAP_HEIGHT / 2 - y * EARTH_MAP_SCALE,
  ];
}
