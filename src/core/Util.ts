import { v4 as uuidv4 } from "uuid";
import twemoji from "twemoji";
import DOMPurify from "dompurify";
import { Cell, Game, Player, Unit } from "./game/Game";
import {
  ClientID,
  GameConfig,
  GameID,
  GameRecord,
  PlayerRecord,
  Turn,
} from "./Schemas";
import { customAlphabet, nanoid } from "nanoid";
import { andFN, GameMap, manhattanDistFN, TileRef } from "./game/GameMap";

export function manhattanDistWrapped(
  c1: Cell,
  c2: Cell,
  width: number,
): number {
  // Calculate x distance
  let dx = Math.abs(c1.x - c2.x);
  // Check if wrapping around the x-axis is shorter
  dx = Math.min(dx, width - dx);

  // Calculate y distance (no wrapping for y-axis)
  let dy = Math.abs(c1.y - c2.y);

  // Return the sum of x and y distances
  return dx + dy;
}

export function within(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function distSort(
  gm: GameMap,
  target: TileRef,
): (a: TileRef, b: TileRef) => number {
  return (a: TileRef, b: TileRef) => {
    return gm.manhattanDist(a, target) - gm.manhattanDist(b, target);
  };
}

export function distSortUnit(
  gm: GameMap,
  target: Unit | TileRef,
): (a: Unit, b: Unit) => number {
  const targetRef = typeof target === "number" ? target : target.tile();

  return (a: Unit, b: Unit) => {
    return (
      gm.manhattanDist(a.tile(), targetRef) -
      gm.manhattanDist(b.tile(), targetRef)
    );
  };
}

// TODO: refactor to new file
// export function sourceDstOceanShore(
//   gm: Game,
//   src: Player,
//   tile: TileRef,
// ): [TileRef | null, TileRef | null] {
//   const dst = gm.owner(tile);
//   let srcTile = closestShoreFromPlayer(gm, src, tile);
//   let dstTile: TileRef | null = null;
//   let borderTile: TileRef | null = null;
//   if (dst.isPlayer()) {
//     [dstTile, borderTile] = closestShoreTN(gm, src, tile, 50, dst as Player);
//   } else {
//     [dstTile, borderTile] = closestShoreTN(gm, src, tile, 50);
//   }
//   return [srcTile, dstTile];
// }

export function targetTransportTile(
  gm: Game,
  tile: TileRef,
  player: Player,
): [TileRef | null, TileRef | null] {
  const dst = gm.playerBySmallID(gm.ownerID(tile));
  let dstTile: TileRef | null = null;
  let borderTile: TileRef | null = null;
  if (dst.isPlayer()) {
    [dstTile, borderTile] = closestShoreTN(gm, player, tile, 50, dst as Player);
  } else {
    [dstTile, borderTile] = closestShoreTN(gm, player, tile, 50);
  }
  return [dstTile, borderTile];
}

// export function closestShoreFromPlayer(
//   gm: GameMap,
//   player: Player,
//   target: TileRef,
// ): TileRef | null {
//   const shoreTiles = Array.from(player.borderTiles()).filter((t) =>
//     gm.isShore(t),
//   );
//   if (shoreTiles.length == 0) {
//     return null;
//   }

//   return shoreTiles.reduce((closest, current) => {
//     const closestDistance = manhattanDistWrapped(
//       gm.cell(target),
//       gm.cell(closest),
//       gm.width(),
//     );
//     const currentDistance = manhattanDistWrapped(
//       gm.cell(target),
//       gm.cell(current),
//       gm.width(),
//     );
//     return currentDistance < closestDistance ? current : closest;
//   });
// }

// searches the nearest shore based on the position of the player and the target tile
export function closestShoreTN(
  gm: GameMap,
  attacker: Player,
  target: TileRef,
  searchDist: number,
  defender?: Player,
): [TileRef | null, TileRef | null] {
  const borderTiles = Array.from(attacker.borderTiles()).filter((t) =>
    gm.isShore(t),
  );

  var targetIsWater = gm.isWater(target);

  // prevents the search from ignoring islands when the target is a water tile
  if (targetIsWater) {
    const tn = Array.from(
      gm.bfs(
        target,
        andFN(
          (_, t) => !(gm.ownerID(t) === attacker.smallID()),
          manhattanDistFN(target, searchDist),
        ),
      ),
    )
      .filter((t) => gm.isShore(t))
      .sort(
        (a, b) => gm.manhattanDist(target, a) - gm.manhattanDist(target, b),
      );

    target = tn.length > 0 ? tn[0] : null;
    targetIsWater = gm.isWater(target);
    if (!target) return [null, null];
  }

  const queue: [TileRef, number][] = [[target, 0]];
  const visited = new Set<TileRef>();
  const shoreTiles: TileRef[] = [];

  while (queue.length > 0) {
    const [tile, dist] = queue.shift()!;
    if (visited.has(tile) || dist > searchDist) continue;
    visited.add(tile);

    // when sending a ship to another player prevent the search using shores not belonging to the player you try to attack and shores belonging to yourself
    if (gm.isShore(tile) && dist > 0) {
      if (
        (!defender || gm.ownerID(tile) === defender.smallID()) &&
        !(gm.ownerID(tile) === attacker.smallID())
      ) {
        shoreTiles.push(tile);
      }
      continue;
    }

    //search the neighboring tiles that are not water tiles (prevents shores from other islands from being used) but not when the starting tile is water itself
    for (const neighbor of gm.neighbors(tile)) {
      if (
        !visited.has(neighbor) &&
        !(gm.ownerID(neighbor) === attacker.smallID()) &&
        (targetIsWater || !gm.isWater(neighbor))
      ) {
        queue.push([neighbor, dist + 1]);
      }
    }
  }

  if (shoreTiles.length === 0) return [null, null];

  let bestShore: TileRef | null = null;
  let bestBorderTile: TileRef | null = null;
  let minDist = Infinity;

  // based on the players border tiles get the shortest path from player to shore
  for (const shore of shoreTiles) {
    for (const border of borderTiles) {
      const dist = gm.manhattanDist(border, shore);
      if (dist < minDist) {
        minDist = dist;
        bestShore = shore;
        bestBorderTile = border;
      }
    }
  }

  return [bestShore, bestBorderTile];
}

export function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}

export function calculateBoundingBox(
  gm: GameMap,
  borderTiles: ReadonlySet<TileRef>,
): { min: Cell; max: Cell } {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;

  borderTiles.forEach((tile: TileRef) => {
    const cell = gm.cell(tile);
    minX = Math.min(minX, cell.x);
    minY = Math.min(minY, cell.y);
    maxX = Math.max(maxX, cell.x);
    maxY = Math.max(maxY, cell.y);
  });

  return { min: new Cell(minX, minY), max: new Cell(maxX, maxY) };
}

export function calculateBoundingBoxCenter(
  gm: GameMap,
  borderTiles: ReadonlySet<TileRef>,
): Cell {
  const { min, max } = calculateBoundingBox(gm, borderTiles);
  return new Cell(
    min.x + Math.floor((max.x - min.x) / 2),
    min.y + Math.floor((max.y - min.y) / 2),
  );
}

export function inscribed(
  outer: { min: Cell; max: Cell },
  inner: { min: Cell; max: Cell },
): boolean {
  return (
    outer.min.x <= inner.min.x &&
    outer.min.y <= inner.min.y &&
    outer.max.x >= inner.max.x &&
    outer.max.y >= inner.max.y
  );
}

export function getMode(list: Set<number>): number {
  // Count occurrences
  const counts = new Map<number, number>();
  for (const item of list) {
    counts.set(item, (counts.get(item) || 0) + 1);
  }

  // Find the item with the highest count
  let mode = 0;
  let maxCount = 0;

  for (const [item, count] of counts) {
    if (count > maxCount) {
      maxCount = count;
      mode = item;
    }
  }

  return mode;
}

export function sanitize(name: string): string {
  return Array.from(name)
    .join("")
    .replace(/[^\p{L}\p{N}\s\p{Emoji}\p{Emoji_Component}\[\]_]/gu, "");
}

export function processName(name: string): string {
  // First sanitize the raw input - strip everything except text and emojis
  const sanitizedName = sanitize(name);
  // Process emojis with twemoji
  const withEmojis = twemoji.parse(sanitizedName, {
    base: "https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/",
    folder: "svg",
    ext: ".svg",
  });

  // Add CSS styles inline to the wrapper span
  const styledHTML = `
        <span class="player-name" style="
            display: inline-flex;
            align-items: center;
            gap: 0.25rem;
            font-weight: 500;
            vertical-align: middle;
        ">
            ${withEmojis}
        </span>
    `;

  // Add CSS for the emoji images
  const withEmojiStyles = styledHTML.replace(
    /<img/g,
    '<img style="height: 1.2em; width: 1.2em; vertical-align: -0.2em; margin: 0 0.05em 0 0.1em;"',
  );

  // Sanitize the final HTML, allowing styles and specific attributes
  return onlyImages(withEmojiStyles);
}

export function onlyImages(html: string) {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ["span", "img"],
    ALLOWED_ATTR: ["src", "alt", "class", "style"],
    ALLOWED_URI_REGEXP: /^https:\/\/cdn\.jsdelivr\.net\/gh\/twitter\/twemoji/,
    ADD_ATTR: ["style"],
  });
}

export function CreateGameRecord(
  id: GameID,
  gameConfig: GameConfig,
  // username does not need to be set.
  players: PlayerRecord[],
  turns: Turn[],
  start: number,
  end: number,
  winner: ClientID | null,
): GameRecord {
  const record: GameRecord = {
    id: id,
    gameConfig: gameConfig,
    startTimestampMS: start,
    endTimestampMS: end,
    date: new Date().toISOString().split("T")[0],
    turns: [],
  };

  for (const turn of turns) {
    if (turn.intents.length != 0) {
      record.turns.push(turn);
      for (const intent of turn.intents) {
        if (intent.type == "spawn") {
          for (const playerRecord of players) {
            if (playerRecord.clientID == intent.clientID) {
              playerRecord.username = intent.name;
            }
          }
        }
      }
    }
  }
  record.players = players;
  record.durationSeconds = Math.floor(
    (record.endTimestampMS - record.startTimestampMS) / 1000,
  );
  record.num_turns = turns.length;
  record.winner = winner;
  return record;
}

export function assertNever(x: never): never {
  throw new Error("Unexpected value: " + x);
}

export function generateID(): GameID {
  const nanoid = customAlphabet(
    "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",
    8,
  );
  return nanoid();
}

export function toInt(num: number): bigint {
  if (num === Infinity) {
    return BigInt(Number.MAX_SAFE_INTEGER);
  }
  if (num === -Infinity) {
    return BigInt(Number.MIN_SAFE_INTEGER);
  }
  return BigInt(Math.floor(num));
}

export function maxInt(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}

export function minInt(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}
export function withinInt(num: bigint, min: bigint, max: bigint): bigint {
  const atLeastMin = maxInt(num, min);
  return minInt(atLeastMin, max);
}
