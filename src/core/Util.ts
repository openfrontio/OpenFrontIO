import DOMPurify from "dompurify";
import { customAlphabet } from "nanoid";
import { exp } from "./DetMath";
import { Cell, GameType, PlayerType, Unit } from "./game/Game";
import { GameMap, TileRef } from "./game/GameMap";
import { TileSet } from "./game/TileSet";
import {
  GameConfig,
  GameID,
  GameRecord,
  GameStartInfo,
  PartialGameRecord,
  PlayerRecord,
  PlayerReport,
  Tribe,
  Turn,
  Winner,
} from "./Schemas";

import { resolveTribeNameData } from "./execution/utils/TribeNames";

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

/**
 * Finds minimum, by score, with single pass search
 * Faster than array.reduce()
 */
export function findMinimumBy<T>(
  values: readonly T[],
  score: (value: T) => number,
  isCandidate?: (value: T) => boolean,
): T | null {
  let best: T | null = null;
  let bestScore = Infinity;

  if (isCandidate === undefined) {
    for (let i = 0, len = values.length; i < len; i++) {
      const value = values[i];
      const currentScore = score(value);
      if (currentScore < bestScore) {
        bestScore = currentScore;
        best = value;
      }
    }
    return best;
  }

  for (let i = 0, len = values.length; i < len; i++) {
    const value = values[i];
    if (!isCandidate(value)) continue;

    const currentScore = score(value);
    if (currentScore < bestScore) {
      bestScore = currentScore;
      best = value;
    }
  }

  return best;
}

/**
 * Finds closest by fast. Example usage:
 * findClosestBy(
 *       this.units(UnitType.MissileSilo),
 *       (silo) => mg.manhattanDist(silo.tile(), tile),
 *       (silo) => !silo.isInCooldown() && !silo.isUnderConstruction(),
 *     )
 */
export function findClosestBy<T>(
  values: readonly T[],
  distance: (value: T) => number,
  isCandidate?: (value: T) => boolean,
): T | null {
  return findMinimumBy(values, distance, isCandidate);
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
  borderTiles: Iterable<TileRef>,
): { min: Cell; max: Cell } {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;

  const visit = (tile: TileRef) => {
    const x = gm.x(tile);
    const y = gm.y(tile);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  // Indexed/forEach paths: for..of over a large Set (player border sets)
  // allocates an iterator-result object per element.
  if (Array.isArray(borderTiles)) {
    for (let i = 0; i < borderTiles.length; i++) {
      visit(borderTiles[i]);
    }
  } else if (borderTiles instanceof Set || borderTiles instanceof TileSet) {
    borderTiles.forEach(visit);
  } else {
    for (const tile of borderTiles) {
      visit(tile);
    }
  }

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
  borderTiles: Iterable<TileRef>,
): Cell {
  const { min, max } = calculateBoundingBox(gm, borderTiles);
  return boundingBoxCenter({ min, max });
}

export function boundingBoxCenter(box: { min: Cell; max: Cell }): Cell {
  return new Cell(
    box.min.x + Math.floor((box.max.x - box.min.x) / 2),
    box.min.y + Math.floor((box.max.y - box.min.y) / 2),
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

// Replays rebuild GameStartInfo from the archived record, which keeps
// players' real clanTag and friends (analytics reads them). Live clients
// never simulated with those: the server blanks clanTag when clan tags are
// disabled, and clanTag + friends when names are anonymized — identically
// for every client, because both feed deterministic team assignment
// (TeamAssignment.ts). Mirrors GameServer.start() (wireGameStartInfo) and
// startInfoFor(); replays must apply the same blanking before simulating,
// or team games with either setting diverge from the recorded hashes.
// Singleplayer records were simulated (and archived) with the real values —
// no server, no blanking — so they replay as-is.
export function toWireGameStartInfo(info: GameStartInfo): GameStartInfo {
  const config = info.config;
  if (config.gameType === GameType.Singleplayer) {
    return info;
  }
  const blankClanTags =
    (config.disableClanTags ?? false) || (config.anonymizeNames ?? false);
  const blankFriends = config.anonymizeNames ?? false;
  if (!blankClanTags && !blankFriends) {
    return info;
  }
  return {
    ...info,
    players: info.players.map((p) => ({
      ...p,
      clanTag: blankClanTags ? null : p.clanTag,
      friends: blankFriends ? undefined : p.friends,
    })),
  };
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
  // lobby creation time (ms). Defaults to start time for singleplayer.
  lobbyCreatedAt?: number,
  // Time the lobby became visible to players (ms).
  visibleAt?: number,
  // Purchased bot tribe names in use this game (public games only). Infra
  // ingest reads them from the record for owner appearance stats, and
  // replays rebuild GameStartInfo from the record so the same names spawn.
  tribes?: Tribe[],
  // Player reports filed during the game (multiplayer only; see
  // GameServer.handleReport). The API ingests them for moderation.
  reports?: PlayerReport[],
): PartialGameRecord {
  const duration = Math.floor((end - start) / 1000);
  const num_turns = allTurns.length;
  const turns = allTurns.filter(
    (t) => t.intents.length !== 0 || t.hash !== undefined,
  );

  // Use start time as lobby creation time for singleplayer
  const actualLobbyCreatedAt = lobbyCreatedAt ?? start;
  const lobbyFillTime = Math.max(
    0,
    start - (visibleAt ?? actualLobbyCreatedAt),
  );

  const record: PartialGameRecord = {
    info: {
      gameID,
      lobbyCreatedAt: actualLobbyCreatedAt,
      visibleAt,
      lobbyFillTime,
      config,
      players,
      start,
      end,
      duration,
      num_turns,
      winner,
      tribes,
      reports,
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
  playerType: PlayerType,
): string | null {
  let randomName: string | null = null;
  if (playerType === PlayerType.Human) {
    const { prefixes, suffixes } = resolveTribeNameData();
    const hash = simpleHash(name);
    const prefixIndex = hash % prefixes.length;
    const suffixIndex = Math.floor(hash / prefixes.length) % suffixes.length;

    randomName = `👤 ${prefixes[prefixIndex]} ${suffixes[suffixIndex]}`;
  }
  return randomName;
}

export const emojiTable = [
  ["😀", "😊", "🥰", "😇", "😎"],
  ["😞", "🥺", "😭", "😱", "😡"],
  ["😈", "🤡", "🥱", "🫡", "🖕"],
  ["👋", "👏", "✋", "🙏", "💪"],
  ["👍", "👎", "🫴", "🤌", "🤦‍♂️"],
  ["🤝", "🆘", "🕊️", "🏳️", "⏳"],
  ["🔥", "💥", "💀", "☢️", "⚠️"],
  ["↖️", "⬆️", "↗️", "👑", "🥇"],
  ["⬅️", "🎯", "➡️", "🥈", "🥉"],
  ["↙️", "⬇️", "↘️", "❤️", "💔"],
  ["💰", "⚓", "⛵", "🏡", "🛡️"],
  ["🏭", "🚂", "❓", "🐔", "🐀"],
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
  return 1 / (1 + exp(-decayRate * (value - midpoint)));
}

export function formatPlayerDisplayName(
  username: string,
  clanTag?: string | null,
): string {
  return clanTag ? `[${clanTag}] ${username}` : username;
}

const CLAN_TAG_CHARS = "a-zA-Z0-9";

const CLAN_TAG_INVALID_CHARS = new RegExp(`[^${CLAN_TAG_CHARS}]`, "g");

export function sanitizeClanTag(tag: string): string {
  return tag.replace(CLAN_TAG_INVALID_CHARS, "").substring(0, 5).toUpperCase();
}

// Longest label a featured lobby may show in the browser. Long enough for
// "Europe — Official OpenFront Masters Scrims", short enough that one row
// cannot crowd out the rest of the list. Lives here rather than in Schemas so
// the sanitiser that enforces it has no import back into Schemas — that edge
// would close a require cycle.
export const LOBBY_LABEL_MAX = 48;

// A featured lobby's label is host-supplied text shown in the lobby browser, so
// it is sanitised before it can reach anyone: control characters and bidi
// overrides stripped (they let text render as something entirely different),
// whitespace collapsed, then length-capped. Rendered as TEXT, never markup —
// emoji work because they are ordinary codepoints.
export function sanitizeLobbyLabel(raw: string): string {
  const kept: string[] = [];
  // Iterated by CODE POINT, not code unit: an emoji is a surrogate pair, and
  // slicing one in half is how a label turns into a replacement glyph.
  for (const ch of raw) {
    const cp = ch.codePointAt(0)!;
    // Tab/newline/vertical tab/form feed/carriage return are C0 controls, but
    // they are also word separators: dropping them outright would weld
    // "Europe\nScrims" into "EuropeScrims". They become spaces, and the
    // collapse below folds any run of them into one.
    if (cp === 0x09 || (cp >= 0x0a && cp <= 0x0d)) {
      kept.push(" ");
      continue;
    }
    if (cp < 0x20 || cp === 0x7f) continue; // other C0 controls and DEL
    if (cp >= 0x80 && cp <= 0x9f) continue; // C1 controls
    // Bidi overrides, isolates and marks: they make following text render in
    // another direction, which is how a label claims to be something it isn't.
    if (cp >= 0x202a && cp <= 0x202e) continue;
    if (cp >= 0x2066 && cp <= 0x2069) continue;
    if (cp === 0x200e || cp === 0x200f) continue;
    if (cp === 0x061c) continue; // ARABIC LETTER MARK — zero-width, bidi-active
    // NB: U+200D ZERO WIDTH JOINER is deliberately KEPT — emoji sequences like
    // 👨‍👩‍👧 are built from it, and stripping it would break them apart.
    kept.push(ch);
  }
  return Array.from(kept.join("").replace(/\s+/g, " ").trim())
    .slice(0, LOBBY_LABEL_MAX)
    .join("");
}
