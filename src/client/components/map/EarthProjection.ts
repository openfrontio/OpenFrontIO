// Miller cylindrical projection, cropped to 84°N–86°S, in the viewBox units of
// resources/images/EarthMap.svg (written by scripts/genEarthMap.ts).
const NORTH = 84;
const SOUTH = -86;

export const EARTH_MAP_WIDTH = 1000;

function millerY(lat: number): number {
  return 1.25 * Math.log(Math.tan(Math.PI / 4 + (0.4 * lat * Math.PI) / 180));
}

const TOP = millerY(NORTH);
const SCALE = EARTH_MAP_WIDTH / (2 * Math.PI);

export const EARTH_MAP_HEIGHT = Math.round((TOP - millerY(SOUTH)) * SCALE);

export function projectEarth(lat: number, lon: number): [number, number] {
  return [((lon + 180) / 360) * EARTH_MAP_WIDTH, (TOP - millerY(lat)) * SCALE];
}
