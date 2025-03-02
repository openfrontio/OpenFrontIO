import DOMPurify from "dompurify";
import { customAlphabet } from "nanoid";
import twemoji from "twemoji";
import { Cell, Game, Player, Unit } from "./game/Game";
import { andFN, GameMap, manhattanDistFN, TileRef } from "./game/GameMap";
import {
  ClientID,
  GameConfig,
  GameID,
  GameRecord,
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
export function sourceDstOceanShore(
  gm: Game,
  src: Player,
  tile: TileRef,
): [TileRef | null, TileRef | null] {
  const dst = gm.owner(tile);
  let srcTile = closestOceanShoreFromPlayer(gm, src, tile);
  let dstTile: TileRef | null = null;
  if (dst.isPlayer()) {
    dstTile = closestOceanShoreFromPlayer(gm, dst as Player, tile);
  } else {
    dstTile = closestOceanShoreTN(gm, tile, 300);
  }
  return [srcTile, dstTile];
}

export function targetTransportTile(gm: Game, tile: TileRef): TileRef | null {
  const dst = gm.playerBySmallID(gm.ownerID(tile));
  let dstTile: TileRef | null = null;
  if (dst.isPlayer()) {
    dstTile = closestOceanShoreFromPlayer(gm, dst as Player, tile);
  } else {
    dstTile = closestOceanShoreTN(gm, tile, 300);
  }
  return dstTile;
}

export function closestOceanShoreFromPlayer(
  gm: GameMap,
  player: Player,
  target: TileRef,
): TileRef | null {
  const shoreTiles = Array.from(player.borderTiles()).filter((t) =>
    gm.isOceanShore(t),
  );
  if (shoreTiles.length == 0) {
    return null;
  }

  return shoreTiles.reduce((closest, current) => {
    const closestDistance = manhattanDistWrapped(
      gm.cell(target),
      gm.cell(closest),
      gm.width(),
    );
    const currentDistance = manhattanDistWrapped(
      gm.cell(target),
      gm.cell(current),
      gm.width(),
    );
    return currentDistance < closestDistance ? current : closest;
  });
}

function closestOceanShoreTN(
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
    .filter((t) => gm.isOceanShore(t))
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
    .replace(/[^\p{L}\p{N}\s\p{Emoji}\p{Emoji_Component}\[\]]/gu, "");
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
