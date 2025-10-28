import DOMPurify from "dompurify";
import { customAlphabet } from "nanoid";
import { Cell, Unit } from "./game/Game";
import { GameMap, TileRef } from "./game/GameMap";
import {
  GameConfig,
  GameID,
  GameRecord,
  PartialGameRecord,
  PlayerRecord,
  Turn,
  Winner,
} from "./Schemas";

import {
  BOT_NAME_PREFIXES,
  BOT_NAME_SUFFIXES,
} from "./execution/utils/BotNames";

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

export function boundingBoxTiles(
  gm: GameMap,
  center: TileRef,
  radius: number,
): TileRef[] {
  const tiles: TileRef[] = [];

  const centerX = gm.x(center);
  const centerY = gm.y(center);

  const minX = centerX - radius;
  const maxX = centerX + radius;
  const minY = centerY - radius;
  const maxY = centerY + radius;

  // Top and bottom edges (full width)
  for (let x = minX; x <= maxX; x++) {
    if (gm.isValidCoord(x, minY)) {
      tiles.push(gm.ref(x, minY));
    }
    if (gm.isValidCoord(x, maxY) && minY !== maxY) {
      tiles.push(gm.ref(x, maxY));
    }
  }

  // Left and right edges (exclude corners already added)
  for (let y = minY + 1; y < maxY; y++) {
    if (gm.isValidCoord(minX, y)) {
      tiles.push(gm.ref(minX, y));
    }
    if (gm.isValidCoord(maxX, y) && minX !== maxX) {
      tiles.push(gm.ref(maxX, y));
    }
  }

  return tiles;
}

export function getMode<T>(counts: Map<T, number>): T | null {
  let mode: T | null = null;
  let maxCount = 0;

  for (const [item, count] of counts) {
    if (count > maxCount) {
      maxCount = count;
      mode = item;
    }
  }

  return mode;
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

export function sanitize(name: string): string {
  return Array.from(name)
    .join("")
    .replace(/[^\p{L}\p{N}\s\p{Emoji}\p{Emoji_Component}[\]_]/gu, "");
}

export function onlyImages(html: string) {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ["span", "img"],
    ALLOWED_ATTR: ["src", "alt", "class", "style"],
    ALLOWED_URI_REGEXP: /^https:\/\/cdn\.jsdelivr\.net\/gh\/twitter\/twemoji/,
    ADD_ATTR: ["style"],
  });
}

export function createPartialGameRecord(
  gameID: GameID,
  config: GameConfig,
  // username does not need to be set.
  players: PlayerRecord[],
  allTurns: Turn[],
  start: number,
  end: number,
  winner: Winner,
): PartialGameRecord {
  const duration = Math.floor((end - start) / 1000);
  const num_turns = allTurns.length;
  const turns = allTurns.filter(
    (t) => t.intents.length !== 0 || t.hash !== undefined,
  );
  const record: PartialGameRecord = {
    info: {
      gameID,
      config,
      players,
      start,
      end,
      duration,
      num_turns,
      winner,
    },
    version: "v0.0.2",
    turns,
  };
  return record;
}

export function decompressGameRecord(gameRecord: GameRecord) {
  const turns: Turn[] = [];
  let lastTurnNum = -1;
  for (const turn of gameRecord.turns) {
    while (lastTurnNum < turn.turnNumber - 1) {
      lastTurnNum++;
      turns.push({
        turnNumber: lastTurnNum,
        intents: [],
      });
    }
    turns.push(turn);
    lastTurnNum = turn.turnNumber;
  }
  const turnLength = turns.length;
  for (let i = turnLength; i < gameRecord.info.num_turns; i++) {
    turns.push({
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
    "123456789abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ",
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

export function createRandomName(
  name: string,
  playerType: string,
): string | null {
  let randomName: string | null = null;
  if (playerType === "HUMAN") {
    const hash = simpleHash(name);
    const prefixIndex = hash % BOT_NAME_PREFIXES.length;
    const suffixIndex =
      Math.floor(hash / BOT_NAME_PREFIXES.length) % BOT_NAME_SUFFIXES.length;

    randomName = `👤 ${BOT_NAME_PREFIXES[prefixIndex]} ${BOT_NAME_SUFFIXES[suffixIndex]}`;
  }
  return randomName;
}

export const emojiTable = [
  ["😀", "😊", "😇", "😎", "😈"],
  ["😞", "🥺", "😭", "😱", "😡"],
  ["⏳", "🥱", "🤦‍♂️", "🖕", "🤡"],
  ["👋", "👏", "👻", "💪", "🎃"],
  ["👍", "👎", "❓", "🐔", "🐀"],
  ["🆘", "🤝", "🕊️", "🏳️", "🛡️"],
  ["🔥", "💥", "💀", "☢️", "⚠️"],
  ["↖️", "⬆️", "↗️", "👑", "🥇"],
  ["⬅️", "🎯", "➡️", "🥈", "🥉"],
  ["↙️", "⬇️", "↘️", "❤️", "💔"],
  ["💰", "🏭", "🚂", "⚓", "⛵"],
] as const;
// 2d to 1d array
export const flattenedEmojiTable = emojiTable.flat();

export type Emoji = (typeof flattenedEmojiTable)[number];

/**
 * JSON.stringify replacer function that converts bigint values to strings.
 */
export function replacer(_key: string, value: any): any {
  return typeof value === "bigint" ? value.toString() : value;
}

export function sigmoid(
  value: number,
  decayRate: number,
  midpoint: number,
): number {
  return 1 / (1 + Math.exp(-decayRate * (value - midpoint)));
}

// Compute clan from name
export function getClanTag(name: string): string | null {
  if (!name.includes("[") || !name.includes("]")) {
    return null;
  }
  const clanMatch = name.match(/\[([a-zA-Z0-9]{2,5})\]/);
  return clanMatch ? clanMatch[1].toUpperCase() : null;
}
