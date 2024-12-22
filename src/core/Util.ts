import { v4 as uuidv4 } from 'uuid';
import twemoji from 'twemoji';
import DOMPurify from 'dompurify';


import { Cell, Game, Player, TerraNullius, Tile, Unit } from "./game/Game";
import { number } from 'zod';
import { GameConfig, GameID, GameRecord, PlayerRecord, Turn } from './Schemas';
import { customAlphabet, nanoid } from 'nanoid';


export const MIN_USERNAME_LENGTH = 3;
export const MAX_USERNAME_LENGTH = 12;

export function manhattanDist(c1: Cell, c2: Cell): number {
    return Math.abs(c1.x - c2.x) + Math.abs(c1.y - c2.y);
}

export function euclideanDist(c1: Cell, c2: Cell): number {
    return Math.sqrt(Math.pow(c1.x - c2.x, 2) + Math.pow(c1.y - c2.y, 2));
}

export function manhattanDistWrapped(c1: Cell, c2: Cell, width: number): number {
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

export function euclDist(root: Tile, dist: number): (tile: Tile) => boolean {
    return (n: Tile) => euclideanDist(root.cell(), n.cell()) <= dist;
}

export function dist(root: Tile, dist: number): (tile: Tile) => boolean {
    return (n: Tile) => manhattanDist(root.cell(), n.cell()) <= dist;
}

export function distSort(target: Tile): (a: Tile, b: Tile) => number {
    return (a: Tile, b: Tile) => {
        return manhattanDist(a.cell(), target.cell()) - manhattanDist(b.cell(), target.cell());
    }
}

export function distSortUnit(target: Unit | Tile): (a: Unit, b: Unit) => number {
    const targetCell = ('tile' in target) ? target.tile().cell() : target.cell();

    return (a: Unit, b: Unit) => {
        return manhattanDist(a.tile().cell(), targetCell) - manhattanDist(b.tile().cell(), targetCell);
    }
}

export function and(x: (tile: Tile) => boolean, y: (tile: Tile) => boolean): (tile: Tile) => boolean {
    return (tile: Tile) => x(tile) && y(tile)
}

// TODO: refactor to new file
export function sourceDstOceanShore(game: Game, src: Player, tile: Tile): [Tile | null, Tile | null] {
    const dst = tile.owner()
    let srcTile = closestOceanShoreFromPlayer(src, tile, game.width())
    let dstTile: Tile | null = null
    if (dst.isPlayer()) {
        dstTile = closestOceanShoreFromPlayer(dst as Player, tile, game.width())
    } else {
        dstTile = closestOceanShoreTN(tile, 300)
    }
    return [srcTile, dstTile]
}

export function targetTransportTile(game: Game, tile: Tile): Tile | null {
    const dst = tile.owner()
    let dstTile: Tile | null = null
    if (dst.isPlayer()) {
        dstTile = closestOceanShoreFromPlayer(dst as Player, tile, game.width())
    } else {
        dstTile = closestOceanShoreTN(tile, 300)
    }
    return dstTile
}

export function closestOceanShoreFromPlayer(player: Player, target: Tile, width: number): Tile | null {
    const shoreTiles = Array.from(player.borderTiles()).filter(t => t.isOceanShore())
    if (shoreTiles.length == 0) {
        return null
    }

    return shoreTiles.reduce((closest, current) => {
        const closestDistance = manhattanDistWrapped(target.cell(), closest.cell(), width);
        const currentDistance = manhattanDistWrapped(target.cell(), current.cell(), width);
        return currentDistance < closestDistance ? current : closest;
    });
}

function closestOceanShoreTN(tile: Tile, searchDist: number): Tile {
    const tn = Array.from(bfs(tile, and(t => !t.hasOwner(), dist(tile, searchDist))))
        .filter(t => t.isOceanShore())
        .sort((a, b) => manhattanDist(tile.cell(), a.cell()) - manhattanDist(tile.cell(), b.cell()))
    if (tn.length == 0) {
        return null
    }
    return tn[0]
}

export function bfs(tile: Tile, filter: (tile: Tile) => boolean): Set<Tile> {
    const seen = new Set<Tile>
    const q: Tile[] = []
    q.push(tile)
    while (q.length > 0) {
        const curr = q.pop()
        seen.add(curr)
        for (const n of curr.neighbors()) {
            if (!seen.has(n) && filter(n)) {
                q.push(n)
            }
        }
    }
    return seen
}

export function simpleHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
}

export function calculateBoundingBox(borderTiles: ReadonlySet<Tile>): { min: Cell; max: Cell } {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    borderTiles.forEach((tile: Tile) => {
        const cell = tile.cell();
        minX = Math.min(minX, cell.x);
        minY = Math.min(minY, cell.y);
        maxX = Math.max(maxX, cell.x);
        maxY = Math.max(maxY, cell.y);
    });

    return { min: new Cell(minX, minY), max: new Cell(maxX, maxY) }
}

export function calculateBoundingBoxCenter(borderTiles: ReadonlySet<Tile>): Cell {
    const { min, max } = calculateBoundingBox(borderTiles)
    return new Cell(
        min.x + Math.floor((max.x - min.x) / 2),
        min.y + Math.floor((max.y - min.y) / 2)
    )
}

export function inscribed(outer: { min: Cell; max: Cell }, inner: { min: Cell; max: Cell }): boolean {
    return (
        outer.min.x <= inner.min.x &&
        outer.min.y <= inner.min.y &&
        outer.max.x >= inner.max.x &&
        outer.max.y >= inner.max.y
    );
}

export function getMode(list: string[]): string {
    // Count occurrences
    const counts: { [key: string]: number } = {};
    for (const item of list) {
        counts[item] = (counts[item] || 0) + 1;
    }

    // Find the item with the highest count
    let mode = '';
    let maxCount = 0;

    for (const item in counts) {
        if (counts[item] > maxCount) {
            maxCount = counts[item];
            mode = item;
        }
    }

    return mode;
}

export function sanitize(name: string): string {
    return Array.from(name).join('').replace(/[^\p{L}\p{N}\s\p{Emoji}\p{Emoji_Component}]/gu, '');
}

export function processName(name: string): string {
    // First sanitize the raw input - strip everything except text and emojis
    const sanitizedName = sanitize(name);

    // Process emojis with twemoji
    const withEmojis = twemoji.parse(sanitizedName, {
        base: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/',
        folder: 'svg',
        ext: '.svg'
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
        '<img style="height: 1.2em; width: 1.2em; vertical-align: -0.2em; margin: 0 0.05em 0 0.1em;"'
    );

    // Sanitize the final HTML, allowing styles and specific attributes
    return onlyImages(withEmojiStyles)
}

export function onlyImages(html: string) {

    return DOMPurify.sanitize(html, {
        ALLOWED_TAGS: ['span', 'img'],
        ALLOWED_ATTR: ['src', 'alt', 'class', 'style'],
        ALLOWED_URI_REGEXP: /^https:\/\/cdn\.jsdelivr\.net\/gh\/twitter\/twemoji/,
        ADD_ATTR: ['style']
    });
}

export function CreateGameRecord(
    id: GameID,
    gameConfig: GameConfig,
    // username does not need to be set.
    players: PlayerRecord[],
    turns: Turn[],
    start: number,
    end: number
): GameRecord {
    const record: GameRecord = {
        id: id,
        gameConfig: gameConfig,
        startTimestampMS: start,
        endTimestampMS: end,
        date: new Date().toISOString().split('T')[0],
        turns: []
    }

    for (const turn of turns) {
        if (turn.intents.length != 0) {
            record.turns.push(turn)
            for (const intent of turn.intents) {
                if (intent.type == "spawn") {
                    for (const playerRecord of players) {
                        if (playerRecord.clientID == intent.clientID) {
                            playerRecord.username = intent.name
                        }
                    }
                }
            }
        }
    }
    record.players = players
    record.durationSeconds = Math.floor((record.endTimestampMS - record.startTimestampMS) / 1000)
    record.num_turns = turns.length
    return record;
}

export function assertNever(x: never): never {
    throw new Error('Unexpected value: ' + x);
}

export function generateID(): GameID {
    const nanoid = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ', 8)
    return nanoid()
}
