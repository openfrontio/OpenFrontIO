import { Config } from "../configuration/Config";
import { PseudoRandom } from "../PseudoRandom";
import { simpleHash } from "../Util";
import { GameMap, TileRef } from "./GameMap";

export function generateOilFields(map: GameMap, config: Config) {
  const random = new PseudoRandom(
    simpleHash("oil-fields-" + config.randomSeed()),
  );

  const landTiles = map.numLandTiles();
  let numFields: number;

  if (landTiles < 500000) {
    // Small maps
    numFields = random.nextInt(2, 5);
  } else if (landTiles < 1500000) {
    // Medium maps
    numFields = random.nextInt(4, 8);
  } else {
    // Large maps
    numFields = random.nextInt(7, 11);
  }

  const width = map.width();
  const height = map.height();

  // 1. Grid-based Seeding (Ensures spread across the map)
  const gridDivs = Math.ceil(Math.sqrt(numFields + 2));
  const cellW = width / gridDivs;
  const cellH = height / gridDivs;

  const cells: { r: number; c: number }[] = [];
  for (let r = 0; r < gridDivs; r++) {
    for (let c = 0; c < gridDivs; c++) {
      cells.push({ r, c });
    }
  }

  for (let i = cells.length - 1; i > 0; i--) {
    const j = random.nextInt(0, i + 1);
    [cells[i], cells[j]] = [cells[j], cells[i]];
  }

  const seeds: TileRef[] = [];
  for (let i = 0; i < numFields && i < cells.length; i++) {
    const cell = cells[i];
    let foundSeed = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const rx = random.nextInt(
        Math.floor(cell.c * cellW + cellW * 0.1),
        Math.floor((cell.c + 1) * cellW - cellW * 0.1),
      );
      const ry = random.nextInt(
        Math.floor(cell.r * cellH + cellH * 0.1),
        Math.floor((cell.r + 1) * cellH - cellH * 0.1),
      );
      if (map.isValidCoord(rx, ry)) {
        const t = map.ref(rx, ry);
        if (map.isLand(t)) {
          seeds.push(t);
          foundSeed = true;
          break;
        }
      }
    }
    if (!foundSeed) {
      for (let fallback = 0; fallback < 100; fallback++) {
        const rx = random.nextInt(0, width);
        const ry = random.nextInt(0, height);
        const t = map.ref(rx, ry);
        if (map.isLand(t)) {
          seeds.push(t);
          foundSeed = true;
          break;
        }
      }
    }
  }

  // 2. Elliptical Noise Base
  const avgTilesPerField = (landTiles * 0.045) / numFields;

  for (const seed of seeds) {
    const targetSize = avgTilesPerField * (0.6 + random.next() * 1.8);
    const centerX = map.x(seed);
    const centerY = map.y(seed);

    // Random rotation and aspect ratio (not too extreme to avoid "thin" shapes)
    const angle = random.next() * Math.PI;
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    const ratio = 0.6 + random.next() * 0.4; // 1:1 to 1:1.6

    // Rough radius based on area A = PI * r1 * r2 => A = PI * r * (r * ratio)
    const r1 = Math.sqrt(targetSize / (Math.PI * ratio));
    const r2 = r1 * ratio;

    const fieldTiles = new Set<TileRef>();

    // Fill an ellipse with noise - this is the "raw material" for the CA
    const searchRadius = Math.ceil(Math.max(r1, r2) * 1.5);
    for (let dx = -searchRadius; dx <= searchRadius; dx++) {
      for (let dy = -searchRadius; dy <= searchRadius; dy++) {
        const x = centerX + dx;
        const y = centerY + dy;
        if (!map.isValidCoord(x, y)) continue;

        // Rotated coordinate system
        const rx = dx * cosA + dy * sinA;
        const ry = -dx * sinA + dy * cosA;

        const dist = (rx * rx) / (r1 * r1) + (ry * ry) / (r2 * r2);

        // Add jittered probability to create organic edges
        const prob = 0.85 - dist * 0.5;
        if (random.next() < prob && map.isLand(map.ref(x, y))) {
          const t = map.ref(x, y);
          map.setOilField(t, true);
          fieldTiles.add(t);
        }
      }
    }

    // 3. Heavy Smoothing Pass (Cellular Automata)
    // Running 5 passes creates very clean, lumpy organic blobs
    for (let pass = 0; pass < 5; pass++) {
      const toAdd: TileRef[] = [];
      const toRemove: TileRef[] = [];

      // Slightly larger bounds to allow smoothing to expand/contract
      const bounds = getBounds(map, fieldTiles, 2);
      for (let x = bounds.minX; x <= bounds.maxX; x++) {
        for (let y = bounds.minY; y <= bounds.maxY; y++) {
          if (!map.isValidCoord(x, y)) continue;
          const t = map.ref(x, y);
          const isLand = map.isLand(t);

          let oilNeighbors = 0;
          for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
              if (dx === 0 && dy === 0) continue;
              const nx = x + dx,
                ny = y + dy;
              if (
                map.isValidCoord(nx, ny) &&
                map.hasOilField(map.ref(nx, ny))
              ) {
                oilNeighbors++;
              }
            }
          }

          if (map.hasOilField(t)) {
            // Standard CA "Life" rules for smoothing:
            // Keep if 4+ neighbors, remove if 3 or less (prunes thin parts)
            if (oilNeighbors <= 3 || !isLand) {
              toRemove.push(t);
            }
          } else if (isLand) {
            // Fill if 5+ neighbors (fills gaps/holes)
            if (oilNeighbors >= 5) {
              toAdd.push(t);
            }
          }
        }
      }

      for (const t of toAdd) {
        map.setOilField(t, true);
        fieldTiles.add(t);
      }
      for (const t of toRemove) {
        map.setOilField(t, false);
        fieldTiles.delete(t);
      }
    }

    // 4. Guaranteed Hole Filling (Flood fill)
    if (fieldTiles.size > 0) {
      fillHoles(map, fieldTiles);
    }
  }
}

function fillHoles(map: GameMap, fieldTiles: Set<TileRef>) {
  const bounds = getBounds(map, fieldTiles, 1);
  const outside = new Set<TileRef>();
  const queue: TileRef[] = [];

  for (let x = bounds.minX; x <= bounds.maxX; x++) {
    for (let y = bounds.minY; y <= bounds.maxY; y++) {
      if (
        x === bounds.minX ||
        x === bounds.maxX ||
        y === bounds.minY ||
        y === bounds.maxY
      ) {
        if (map.isValidCoord(x, y)) {
          const t = map.ref(x, y);
          if (!map.hasOilField(t)) {
            outside.add(t);
            queue.push(t);
          }
        }
      }
    }
  }

  while (queue.length > 0) {
    const curr = queue.shift()!;
    const cx = map.x(curr);
    const cy = map.y(curr);
    const dirs = [
      [0, 1],
      [0, -1],
      [1, 0],
      [-1, 0],
    ];
    for (const [dx, dy] of dirs) {
      const nx = cx + dx,
        ny = cy + dy;
      if (
        nx >= bounds.minX &&
        nx <= bounds.maxX &&
        ny >= bounds.minY &&
        ny <= bounds.maxY &&
        map.isValidCoord(nx, ny)
      ) {
        const next = map.ref(nx, ny);
        if (!map.hasOilField(next) && !outside.has(next)) {
          outside.add(next);
          queue.push(next);
        }
      }
    }
  }

  for (let x = bounds.minX; x <= bounds.maxX; x++) {
    for (let y = bounds.minY; y <= bounds.maxY; y++) {
      if (map.isValidCoord(x, y)) {
        const t = map.ref(x, y);
        if (!map.hasOilField(t) && !outside.has(t) && map.isLand(t)) {
          map.setOilField(t, true);
        }
      }
    }
  }
}

function getBounds(map: GameMap, tiles: Set<TileRef>, margin: number) {
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const t of tiles) {
    const x = map.x(t);
    const y = map.y(t);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return {
    minX: minX - margin,
    maxX: maxX + margin,
    minY: minY - margin,
    maxY: maxY + margin,
  };
}
