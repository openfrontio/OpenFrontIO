/**
 * Exporting a scenario (docs/ScenarioEditor.md, "Finalising for export"):
 * the editing engine writes its terrain out as map files, a second engine
 * on those files replays everything but terrain and is finalised, and its
 * snapshot is the playable start. Restored onto the exported files, the
 * nations play and the structures work.
 */

import type { EditorCommand } from "@openfront/engine-api/EditorCommands";
import { TileRef } from "@openfront/engine-api/game/GameMap";
import {
  CustomGameMap,
  GameMapSize,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import {
  ErrorUpdate,
  GameUpdateViewData,
} from "@openfront/engine-api/game/GameUpdates";
import { MapFiles } from "@openfront/engine-api/game/MapFiles";
import { GameStartInfo } from "@openfront/engine-api/Schemas";
import { GameMapImpl } from "@openfront/engine-lib/game/GameMapImpl";
import { CityExecution } from "@openfront/engine/execution/CityExecution";
import { DefensePostExecution } from "@openfront/engine/execution/DefensePostExecution";
import { DoomsdayClockExecution } from "@openfront/engine/execution/DoomsdayClockExecution";
import { FactoryExecution } from "@openfront/engine/execution/FactoryExecution";
import { MissileSiloExecution } from "@openfront/engine/execution/MissileSiloExecution";
import { NationExecution } from "@openfront/engine/execution/NationExecution";
import { PlayerExecution } from "@openfront/engine/execution/PlayerExecution";
import { PortExecution } from "@openfront/engine/execution/PortExecution";
import { RecomputeRailClusterExecution } from "@openfront/engine/execution/RecomputeRailClusterExecution";
import { SAMLauncherExecution } from "@openfront/engine/execution/SAMLauncherExecution";
import { WinCheckExecution } from "@openfront/engine/execution/WinCheckExecution";
import { Execution, Game } from "@openfront/engine/game/Game";
import {
  createGameRunner,
  createGameRunnerFromSnapshot,
  GameRunner,
} from "@openfront/engine/GameRunner";
import { scriptedGameStart } from "../../util/ScriptedGame";

const W = 200;
const H = 160;
const OCEAN_BIT = 0x20;

function editorStart(): GameStartInfo {
  return {
    ...scriptedGameStart({
      gameMap: CustomGameMap,
      gameMapSize: GameMapSize.Normal,
      nations: "disabled",
      bots: 0,
    }),
    players: [],
  };
}

/** A blank map: all ocean, as the generator makes one. */
function blankFiles(): MapFiles {
  const blank = (w: number, h: number) => new Uint8Array(w * h).fill(OCEAN_BIT);
  const meta = (w: number, h: number) => ({
    width: w,
    height: h,
    num_land_tiles: 0,
  });
  return {
    map: CustomGameMap,
    mapSize: GameMapSize.Normal,
    manifest: {
      name: "Scenario",
      translation_key: "map.scenario",
      nations: [],
      map: meta(W, H),
      map4x: meta(W / 2, H / 2),
      map16x: meta(W / 4, H / 4),
    } as unknown as MapFiles["manifest"],
    mapBin: blank(W, H),
    map4xBin: blank(W / 2, H / 2),
  };
}

/** Fresh copies: a game takes over the files it loads. */
function copy(files: MapFiles): MapFiles {
  return {
    ...files,
    mapBin: files.mapBin!.slice(),
    map4xBin: files.map4xBin!.slice(),
    map16xBin: files.map16xBin!.slice(),
  };
}

function throwOnError(gu: GameUpdateViewData | ErrorUpdate): void {
  if ("errMsg" in gu) throw new Error(gu.errMsg);
}

function editor(files: MapFiles): Promise<GameRunner> {
  return createGameRunner(editorStart(), undefined, files, throwOnError, true);
}

const tile = (x: number, y: number): TileRef => y * W + x;

function rect(x: number, y: number, w: number, h: number): TileRef[] {
  const tiles: TileRef[] = [];
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) tiles.push(tile(x + dx, y + dy));
  }
  return tiles;
}

// A continent with free land around two nations, and a nation with none.
const CONTINENT = rect(20, 30, 160, 100);
const SCENARIO: EditorCommand[] = [
  {
    type: "set_terrain",
    tiles: CONTINENT,
    terrain: CONTINENT.map(() => 0x85),
  },
  { type: "add_nation", id: "WESTNAT1", name: "West", flag: null },
  { type: "add_nation", id: "EASTNAT1", name: "East", flag: null },
  { type: "add_nation", id: "NOLAND01", name: "Nowhere", flag: null },
  { type: "set_nation", id: "WESTNAT1", troops: 20_000 },
  { type: "set_nation", id: "EASTNAT1", troops: 20_000 },
  { type: "set_owner", tiles: rect(20, 60, 25, 25), owner: "WESTNAT1" },
  { type: "set_owner", tiles: rect(155, 80, 25, 25), owner: "EASTNAT1" },
  // West's coast is x = 20, East's x = 179.
  ...(
    [
      [UnitType.Port, 20, 70, 1],
      [UnitType.City, 30, 65, 2],
      [UnitType.Factory, 32, 75, 1],
      [UnitType.DefensePost, 40, 62, 1],
      [UnitType.SAMLauncher, 40, 80, 1],
      [UnitType.MissileSilo, 25, 82, 1],
    ] as const
  ).map(([unit, x, y, level]): EditorCommand => ({
    type: "place_structure",
    unit,
    tile: tile(x, y),
    nation: "WESTNAT1",
    level,
  })),
  {
    type: "place_structure",
    unit: UnitType.Port,
    tile: tile(179, 90),
    nation: "EASTNAT1",
    level: 1,
  },
];

const isTerrain = (c: EditorCommand) =>
  c.type === "set_terrain" || c.type === "end_terrain_edit";

function count(game: Game, cls: abstract new (...a: never[]) => Execution) {
  return game.executions().filter((e) => e instanceof cls).length;
}

/** Exports SCENARIO: the map files and the playable snapshot. */
async function exportScenario(): Promise<{
  files: MapFiles;
  snapshot: Uint8Array;
}> {
  const editing = await editor(blankFiles());
  for (const command of SCENARIO) editing.applyEditorCommand(command);
  const files = editing.applyEditorCommand({ type: "export_terrain" })!;

  const second = await editor(copy(files));
  for (const command of SCENARIO.filter((c) => !isTerrain(c))) {
    second.applyEditorCommand(command);
  }
  // On the exported files, the scenario has no terrain of its own.
  expect((second.game.map() as GameMapImpl).editedTerrainTiles()).toHaveLength(
    0,
  );
  second.applyEditorCommand({ type: "finalize" });
  return { files, snapshot: second.snapshot() };
}

test("an exported scenario restores onto its map files and plays", async () => {
  const { files, snapshot } = await exportScenario();
  expect(files.map).toBe(CustomGameMap);
  expect(files.manifest.map.num_land_tiles).toBe(CONTINENT.length);

  const runner = await createGameRunnerFromSnapshot(
    editorStart(),
    snapshot,
    undefined,
    copy(files),
    throwOnError,
  );
  const game = runner.game;
  expect(game.inSpawnPhase()).toBe(false);

  const west = game.player("WESTNAT1");
  const east = game.player("EASTNAT1");
  const noLand = game.player("NOLAND01");
  expect(west.numTilesOwned()).toBe(625);
  expect(east.numTilesOwned()).toBe(625);
  // Spawned, as a nation that picked its spawn has.
  expect(west.hasSpawned()).toBe(true);
  expect(noLand.hasSpawned()).toBe(false);

  // What finalize added, still waiting for their first tick.
  expect(count(game, NationExecution)).toBe(3);
  expect(count(game, PlayerExecution)).toBe(2);
  expect(count(game, WinCheckExecution)).toBe(1);
  expect(count(game, DoomsdayClockExecution)).toBe(1);
  expect(count(game, RecomputeRailClusterExecution)).toBe(1);
  expect(count(game, PortExecution)).toBe(2);
  expect(count(game, CityExecution)).toBe(1);
  expect(count(game, FactoryExecution)).toBe(1);
  expect(count(game, DefensePostExecution)).toBe(1);
  expect(count(game, SAMLauncherExecution)).toBe(1);
  expect(count(game, MissileSiloExecution)).toBe(1);

  for (let turn = 0; turn < 300; turn++) {
    runner.addTurn({ turnNumber: turn, intents: [] });
    expect(runner.executeNextTick()).toBe(true);
  }

  // The nations play: they grow into the free land around them.
  expect(west.isAlive()).toBe(true);
  expect(east.isAlive()).toBe(true);
  expect(west.numTilesOwned()).toBeGreaterThan(2 * 625);
  expect(east.numTilesOwned()).toBeGreaterThan(2 * 625);
  // The nation with no land is dead, its AI stopped.
  expect(noLand.isAlive()).toBe(false);
  expect(count(game, NationExecution)).toBe(2);

  // The structures work: the factory, and the city and port beside it,
  // joined the rail network, and the ports trade.
  const at = (x: number, y: number) =>
    game.units().find((u) => u.tile() === tile(x, y))!;
  expect(at(32, 75).hasTrainStation()).toBe(true);
  expect(at(30, 65).hasTrainStation()).toBe(true);
  expect(at(20, 70).hasTrainStation()).toBe(true);
  expect(at(30, 65).level()).toBe(2);
  expect(game.units(UnitType.TradeShip).length).toBeGreaterThan(0);
}, 60_000);

test("finalize runs once", async () => {
  const runner = await editor(blankFiles());
  runner.applyEditorCommand({ type: "finalize" });
  expect(() => runner.applyEditorCommand({ type: "finalize" })).toThrow(
    /already finalized/,
  );
});

test("only an editor engine exports its terrain", async () => {
  const runner = await createGameRunner(
    editorStart(),
    undefined,
    blankFiles(),
    throwOnError,
  );
  expect(() => runner.applyEditorCommand({ type: "export_terrain" })).toThrow(
    /only an editor engine/,
  );
});

test("an export holds the edits before it and not those after", async () => {
  const runner = await editor(blankFiles());
  const island = rect(50, 50, 10, 10);
  runner.applyEditorCommand({
    type: "set_terrain",
    tiles: island,
    terrain: island.map(() => 0x80),
  });
  const before = runner.applyEditorCommand({ type: "export_terrain" })!;
  const bin = before.mapBin!.slice();
  runner.applyEditorCommand({
    type: "set_terrain",
    tiles: [tile(100, 100)],
    terrain: [0x80],
  });
  const after = runner.applyEditorCommand({ type: "export_terrain" })!;

  expect(before.manifest.map.num_land_tiles).toBe(100);
  expect(before.mapBin).toEqual(bin);
  expect(before.mapBin![tile(100, 100)] & 0x80).toBe(0);
  expect(after.manifest.map.num_land_tiles).toBe(101);
  expect(after.mapBin![tile(100, 100)] & 0x80).toBe(0x80);
});
