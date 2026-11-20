/**
 * Measures the scenario editor's terrain edits on a stock map, by default
 * the largest (World 10000, 10000x5000), against loading it into an editor
 * engine: a brush stroke's local repair (set_terrain), the terrain pass at
 * the stroke's end (end_terrain_edit), and the water graph rebuild that
 * waits for test play and export (rebuildWaterGraph).
 *
 * Run with: npx tsx tests/perf/TerrainEditFullPassPerf.ts [map folder]
 */
import type { EditorCommand } from "@openfront/engine-api/EditorCommands";
import { TileRef } from "@openfront/engine-api/game/GameMap";
import {
  CustomGameMap,
  GameMapSize,
} from "@openfront/engine-api/game/GameTypes";
import { MapManifest } from "@openfront/engine-api/game/MapFiles";
import { createGameRunner } from "@openfront/engine/GameRunner";
import { DebugSpan } from "@openfront/engine/utilities/DebugSpan";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { scriptedGameStart } from "../util/ScriptedGame";

type Span = { name: string; duration?: number; children: Span[] };

DebugSpan.enable();

function lastRootSpan(name: string): Span | undefined {
  const all: Span[] = (globalThis as any).__DEBUG_SPANS__ ?? [];
  for (let i = all.length - 1; i >= 0; i--) {
    if (all[i].name === name) return all[i];
  }
  return undefined;
}

function ms(v: number | undefined): string {
  return v === undefined ? "-" : v.toFixed(0);
}

const mapName = process.argv[2] ?? "world10000";
const dir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../resources/maps",
  mapName,
);
const read = (file: string) =>
  new Uint8Array(fs.readFileSync(path.join(dir, file)));

const loadStart = performance.now();
const manifest = JSON.parse(
  fs.readFileSync(path.join(dir, "manifest.json"), "utf8"),
) as MapManifest;
const runner = await createGameRunner(
  {
    ...scriptedGameStart({
      gameMap: CustomGameMap,
      gameMapSize: GameMapSize.Normal,
      nations: "disabled",
      bots: 0,
    }),
    players: [],
  },
  undefined,
  {
    map: CustomGameMap,
    mapSize: GameMapSize.Normal,
    manifest,
    mapBin: read("map.bin"),
    map4xBin: read("map4x.bin"),
  },
  () => {},
  true,
);
const loadMs = performance.now() - loadStart;
const game = runner.game;
const w = game.width();
const h = game.height();
console.log(
  `${mapName} (${w}x${h}) loaded into an editor engine in ${ms(loadMs)}ms` +
    ` (initial water graph build ${ms(lastRootSpan("AbstractGraphBuilder:build")?.duration)}ms)`,
);

function disc(cx: number, cy: number, r: number): TileRef[] {
  const tiles: TileRef[] = [];
  for (let y = Math.max(0, cy - r); y <= Math.min(h - 1, cy + r); y++) {
    for (let x = Math.max(0, cx - r); x <= Math.min(w - 1, cx + r); x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) tiles.push(game.ref(x, y));
    }
  }
  return tiles;
}

function timed(label: string, run: () => void): void {
  const t0 = performance.now();
  run();
  console.log(`${label}: ${ms(performance.now() - t0)}ms`);
}

// Strokes of each kind of terrain in the middle of the map.
const cx = Math.floor(w / 2);
const cy = Math.floor(h / 2);
for (const [label, value, r] of [
  ["water, r=20", 0, 20],
  ["land, r=20", 0x80 | 5, 20],
  ["impassable, r=50", 0x9f, 50],
  ["water, r=200", 0, 200],
] as const) {
  const tiles = disc(cx, cy, r);
  const edit = (command: EditorCommand) => () =>
    runner.applyEditorCommand(command);
  timed(
    `set_terrain ${label} (${tiles.length} tiles)`,
    edit({ type: "set_terrain", tiles, terrain: tiles.map(() => value) }),
  );
  timed("  end_terrain_edit", edit({ type: "end_terrain_edit" }));
  timed("  rebuildWaterGraph", () => game.rebuildWaterGraph());
}
