import DOMPurify from "dompurify";
import { customAlphabet } from "nanoid";
import twemoji from "twemoji";
import { Cell, Game, Player, Team, Unit } from "./game/Game";
import { andFN, GameMap, manhattanDistFN, TileRef } from "./game/GameMap";
import { PathFindResultType } from "./pathfinding/AStar";
import { PathFinder } from "./pathfinding/PathFinding";
import {
  AllPlayersStats,
  ClientID,
  GameID,
  GameRecord,
  GameStartInfo,
  PlayerRecord,
  Turn,
} from "./Schemas";

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
  const dy = Math.abs(c1.y - c2.y);

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
export function sourceDstOceanShore(
  gm: Game,
  src: Player,
  tile: TileRef,
): [TileRef | null, TileRef | null] {
  const dst = gm.owner(tile);
  const srcTile = closestShoreFromPlayer(gm, src, tile);
  let dstTile: TileRef | null = null;
  if (dst.isPlayer()) {
    dstTile = closestShoreFromPlayer(gm, dst as Player, tile);
  } else {
    dstTile = closestShoreTN(gm, tile, 50);
  }
  return [srcTile, dstTile];
}

export function targetTransportTile(gm: Game, tile: TileRef): TileRef | null {
  const dst = gm.playerBySmallID(gm.ownerID(tile));
  let dstTile: TileRef | null = null;
  if (dst.isPlayer()) {
    dstTile = closestShoreFromPlayer(gm, dst as Player, tile);
  } else {
    dstTile = closestShoreTN(gm, tile, 50);
  }
  return dstTile;
}

export function closestShoreFromPlayer(
  gm: GameMap,
  player: Player,
  target: TileRef,
): TileRef | null {
  const shoreTiles = Array.from(player.borderTiles()).filter((t) =>
    gm.isShore(t),
  );
  if (shoreTiles.length == 0) {
    return null;
  }

  return shoreTiles.reduce((closest, current) => {
    const closestDistance = gm.manhattanDist(target, closest);
    const currentDistance = gm.manhattanDist(target, current);
    return currentDistance < closestDistance ? current : closest;
  });
}

/**
 * Finds the best shore tile for deployment among the player's shore tiles for the shortest route.
 * Calculates paths from 4 extremum tiles and the Manhattan-closest tile.
 */
export function bestShoreDeploymentSource(
  gm: Game,
  player: Player,
  target: TileRef,
): TileRef | null {
  let closestManhattanDistance = Infinity;
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;

  let bestByManhattan: TileRef = null;
  const extremumTiles: Record<string, TileRef> = {
    minX: null,
    minY: null,
    maxX: null,
    maxY: null,
  };

  for (const tile of player.borderTiles()) {
    if (!gm.isShore(tile)) continue;

    const distance = gm.manhattanDist(tile, target);
    const cell = gm.cell(tile);

    // Manhattan-closest tile
    if (distance < closestManhattanDistance) {
      closestManhattanDistance = distance;
      bestByManhattan = tile;
    }

    // Extremum tiles
    if (cell.x < minX) {
      minX = cell.x;
      extremumTiles.minX = tile;
    } else if (cell.y < minY) {
      minY = cell.y;
      extremumTiles.minY = tile;
    } else if (cell.x > maxX) {
      maxX = cell.x;
      extremumTiles.maxX = tile;
    } else if (cell.y > maxY) {
      maxY = cell.y;
      extremumTiles.maxY = tile;
    }
  }

  const candidates = [
    bestByManhattan,
    extremumTiles.minX,
    extremumTiles.minY,
    extremumTiles.maxX,
    extremumTiles.maxY,
  ].filter(Boolean);

  if (!candidates.length) {
    return null;
  }

  // Find the shortest actual path distance
  let closestShoreTile: TileRef | null = null;
  let closestDistance = Infinity;

  for (const shoreTile of candidates) {
    const pathDistance = calculatePathDistance(gm, shoreTile, target);

    if (pathDistance !== null && pathDistance < closestDistance) {
      closestDistance = pathDistance;
      closestShoreTile = shoreTile;
    }
  }

  // Fall back to the Manhattan-closest tile if no path was found
  return closestShoreTile || bestByManhattan;
}

/**
 * Calculates the distance between two tiles using A*
 * Returns null if no path is found
 */
function calculatePathDistance(
  gm: Game,
  start: TileRef,
  target: TileRef,
): number | null {
  let currentTile = start;
  let tileDistance = 0;
  const pathFinder = PathFinder.Mini(gm, 20_000, false);

  while (true) {
    const result = pathFinder.nextTile(currentTile, target);

    if (result.type === PathFindResultType.Completed) {
      return tileDistance;
    } else if (result.type === PathFindResultType.NextTile) {
      currentTile = result.tile;
      tileDistance++;
    } else if (
      result.type === PathFindResultType.PathNotFound ||
      result.type === PathFindResultType.Pending
    ) {
      return null;
    } else {
      // @ts-expect-error type is never
      throw new Error(`Unexpected pathfinding result type: ${result.type}`);
    }
  }
}

function closestShoreTN(
  gm: GameMap,
  tile: TileRef,
  searchDist: number,
): TileRef {
  const tn = Array.from(
    gm.bfs(
      tile,
      andFN((_, t) => !gm.hasOwner(t), manhattanDistFN(tile, searchDist)),
    ),
  )
    .filter((t) => gm.isShore(t))
    .sort((a, b) => gm.manhattanDist(tile, a) - gm.manhattanDist(tile, b));
  if (tn.length == 0) {
    return null;
  }
  return tn[0];
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

export function createGameRecord(
  id: GameID,
  gameStart: GameStartInfo,
  // username does not need to be set.
  players: PlayerRecord[],
  turns: Turn[],
  start: number,
  end: number,
  winner: ClientID | Team | null,
  winnerType: "player" | "team" | null,
  allPlayersStats: AllPlayersStats,
): GameRecord {
  const record: GameRecord = {
    id: id,
    gameStartInfo: gameStart,
    startTimestampMS: start,
    endTimestampMS: end,
    date: new Date().toISOString().split("T")[0],
    turns: [],
    allPlayersStats,
    version: "v0.0.1",
  };

  for (const turn of turns) {
    if (turn.intents.length != 0 || turn.hash != undefined) {
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
  record.winnerType = winnerType;
  return record;
}

export function decompressGameRecord(gameRecord: GameRecord) {
  const turns = [];
  let lastTurnNum = -1;
  for (const turn of gameRecord.turns) {
    while (lastTurnNum < turn.turnNumber - 1) {
      lastTurnNum++;
      turns.push({
        gameID: gameRecord.id,
        turnNumber: lastTurnNum,
        intents: [],
      });
    }
    turns.push(turn);
    lastTurnNum = turn.turnNumber;
  }
  const turnLength = turns.length;
  for (let i = turnLength; i < gameRecord.num_turns; i++) {
    turns.push({
      gameID: gameRecord.id,
      turnNumber: i,
      intents: [],
    });
  }
  gameRecord.turns = turns;
  return gameRecord;
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
