/**
 * The scenario editor's terrain edits (docs/ScenarioEditor.md, "Terrain"):
 * the author decides water, land at an elevation or impassable per tile, and
 * the engine derives the rest of the terrain byte and the minimap the way the
 * map generator does. The test of that is a stock map's own files: its
 * authored bytes, painted onto a blank map, must give back what it ships.
 */

import type { EditorCommand } from "@openfront/engine-api/EditorCommands";
import { GameMap, TileRef } from "@openfront/engine-api/game/GameMap";
import {
  CustomGameMap,
  GameMapSize,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { GameUpdateViewData } from "@openfront/engine-api/game/GameUpdates";
import { MapManifest } from "@openfront/engine-api/game/MapFiles";
import { GameStartInfo } from "@openfront/engine-api/Schemas";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import { createGameRunner, GameRunner } from "@openfront/engine/GameRunner";
import { snapshotGame } from "@openfront/engine/snapshot/GameSnapshot";
import { loadMapFiles } from "@openfront/shared/GameMapLoader";
import fs from "fs";
import path from "path";
import { scriptedGameStart, TestDataMapLoader } from "../../util/ScriptedGame";

const OCEAN_BIT = 0x20;
const IMPASSABLE = 0x9f;

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

interface Shipped {
  manifest: MapManifest;
  map: Uint8Array;
  map4x: Uint8Array;
}

function shipped(name: string): Shipped {
  const dir = path.join(__dirname, "../../../resources/maps", name);
  const read = (file: string) =>
    new Uint8Array(fs.readFileSync(path.join(dir, file)));
  return {
    manifest: JSON.parse(
      fs.readFileSync(path.join(dir, "manifest.json"), "utf8"),
    ) as MapManifest,
    map: read("map.bin"),
    map4x: read("map4x.bin"),
  };
}

/** What the author decides for a tile: see SetTerrainCommandSchema. */
function authored(b: number): number {
  return (b & 0x80) === 0 ? 0 : b & 0x9f;
}

interface Editor {
  runner: GameRunner;
  apply: (command: EditorCommand) => GameUpdateViewData;
  /** The full map's terrain as the tile updates sent so far leave it. */
  client: Uint8Array;
  terrain: () => Uint8Array;
  miniTerrain: () => Uint8Array;
}

async function editorOn(
  files: Parameters<typeof createGameRunner>[2],
  client: Uint8Array,
): Promise<Editor> {
  const sent: GameUpdateViewData[] = [];
  const runner = await createGameRunner(
    editorStart(),
    undefined,
    files,
    (gu) => {
      if (!("updates" in gu)) throw new Error(gu.errMsg);
      sent.push(gu);
      const packed = gu.packedTileUpdates;
      for (let i = 0; i < packed.length; i += 2) {
        client[packed[i]] = (packed[i + 1] >>> 16) & 0xff;
      }
    },
    true,
  );
  const game = runner.game;
  const bytes = (map: GameMap) => {
    const out = new Uint8Array(map.width() * map.height());
    for (let t = 0; t < out.length; t++) out[t] = map.terrainByte(t);
    return out;
  };
  return {
    runner,
    client,
    apply: (command) => {
      const before = sent.length;
      runner.applyEditorCommand(command);
      expect(sent.length).toBe(before + 1);
      return sent[sent.length - 1];
    },
    terrain: () => bytes(game.map()),
    miniTerrain: () => bytes(game.miniMap()),
  };
}

/** An editor on a blank map the size of `s`: all water, as the generator makes it. */
function blankEditor(s: Shipped): Promise<Editor> {
  const { map, map4x, map16x } = s.manifest;
  const blank = (size: number) => new Uint8Array(size).fill(OCEAN_BIT);
  return editorOn(
    {
      map: CustomGameMap,
      mapSize: GameMapSize.Normal,
      manifest: {
        ...s.manifest,
        nations: [],
        map: { ...map, num_land_tiles: 0 },
        map4x: { ...map4x, num_land_tiles: 0 },
        map16x: { ...map16x, num_land_tiles: 0 },
      },
      mapBin: blank(map.width * map.height),
      map4xBin: blank(map4x.width * map4x.height),
    },
    blank(map.width * map.height),
  );
}

async function testMapEditor(name: string): Promise<Editor> {
  const start = editorStart();
  const files = await loadMapFiles(
    new TestDataMapLoader(name),
    start.config.gameMap,
    start.config.gameMapSize,
  );
  return editorOn(files, files.mapBin!.slice());
}

function setTerrain(tiles: TileRef[], terrain: number[]): EditorCommand {
  return { type: "set_terrain", tiles, terrain };
}

function disc(
  w: number,
  h: number,
  cx: number,
  cy: number,
  r: number,
): TileRef[] {
  const tiles: TileRef[] = [];
  for (let y = Math.max(0, cy - r); y <= Math.min(h - 1, cy + r); y++) {
    for (let x = Math.max(0, cx - r); x <= Math.min(w - 1, cx + r); x++) {
      if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r) {
        tiles.push(y * w + x);
      }
    }
  }
  return tiles;
}

/** Counts the bytes that differ, ignoring the bits in `ignore`. */
function differences(a: Uint8Array, b: Uint8Array, ignore = 0): number {
  expect(a.length).toBe(b.length);
  let count = 0;
  for (let i = 0; i < a.length; i++) {
    if ((a[i] & ~ignore) !== (b[i] & ~ignore)) count++;
  }
  return count;
}

function expectShipped(e: Editor, s: Shipped): void {
  expect(differences(e.terrain(), s.map)).toBe(0);
  expect(differences(e.miniTerrain(), s.map4x)).toBe(0);
  expect(differences(e.client, s.map)).toBe(0);
  expect(e.runner.game.numLandTiles()).toBe(s.manifest.map.num_land_tiles);
  expect(e.runner.game.miniMap().numLandTiles()).toBe(
    s.manifest.map4x.num_land_tiles,
  );
}

describe("terrain edits reproduce a stock map's files", () => {
  // Tutorial and More Than Luck are two of the stock maps whose minimap
  // the generator didn't change after downscaling (see the Germany test).
  test("Tutorial, painted as many overlapping strokes in shuffled order", async () => {
    const s = shipped("tutorial");
    const { width: w, height: h } = s.manifest.map;
    const e = await blankEditor(s);
    const random = new PseudoRandom(873);

    // Scribble first, ending each stroke, so the strokes that follow paint
    // over every kind of terrain and the full pass runs on many shapes.
    for (let i = 0; i < 40; i++) {
      const tiles = disc(
        w,
        h,
        random.nextInt(0, w),
        random.nextInt(0, h),
        random.nextInt(1, 25),
      );
      const kind = random.nextInt(0, 3);
      const value =
        kind === 0 ? 0 : kind === 1 ? 0x80 | random.nextInt(0, 31) : IMPASSABLE;
      e.apply(setTerrain(tiles, new Array<number>(tiles.length).fill(value)));
      e.apply({ type: "end_terrain_edit" });
    }

    // Then the map, as overlapping discs covering it, in shuffled order
    // and as one stroke.
    const step = 12;
    const strokes: TileRef[][] = [];
    for (let cy = 0; cy < h + step; cy += step) {
      for (let cx = 0; cx < w + step; cx += step) {
        strokes.push(disc(w, h, cx, cy, step));
      }
    }
    for (const tiles of random.shuffleArray(strokes)) {
      e.apply(
        setTerrain(
          tiles,
          tiles.map((t) => authored(s.map[t])),
        ),
      );
    }
    // The local repairs are exact but for the ocean bit, which waits for
    // the end of the stroke. (The map has no water body without a coast.)
    expect(differences(e.terrain(), s.map, OCEAN_BIT)).toBe(0);
    expect(differences(e.miniTerrain(), s.map4x, OCEAN_BIT)).toBe(0);

    e.apply({ type: "end_terrain_edit" });
    expectShipped(e, s);
  });

  test("More Than Luck, with impassable terrain, as one edit", async () => {
    const s = shipped("morethanluck");
    const e = await blankEditor(s);
    const tiles = Array.from(s.map.keys());
    e.apply(
      setTerrain(
        tiles,
        tiles.map((t) => authored(s.map[t])),
      ),
    );
    expect(differences(e.terrain(), s.map, OCEAN_BIT)).toBe(0);
    expect(differences(e.miniTerrain(), s.map4x, OCEAN_BIT)).toBe(0);
    e.apply({ type: "end_terrain_edit" });
    expectShipped(e, s);
  }, 30_000);

  test("Germany, with water bodies that have no coast: the full map", async () => {
    // Water enclosed by impassable terrain has no coast: the generator
    // gives it depth 0, or 10 beside impassable, and only the full pass
    // can tell. Germany's minimap isn't compared: the generator removed
    // small islands from it after downscaling, which the editor leaves to
    // a later tool, so it isn't a function of the full map alone.
    const s = shipped("germany");
    const e = await blankEditor(s);
    const tiles = Array.from(s.map.keys());
    e.apply(
      setTerrain(
        tiles,
        tiles.map((t) => authored(s.map[t])),
      ),
    );
    e.apply({ type: "end_terrain_edit" });
    expect(differences(e.terrain(), s.map)).toBe(0);
    expect(differences(e.client, s.map)).toBe(0);
    expect(e.runner.game.numLandTiles()).toBe(s.manifest.map.num_land_tiles);
    // The only stock map with water that has no coast, and a large one.
  }, 30_000);
});

describe("set_terrain and end_terrain_edit", () => {
  const ADD_FRANCE: EditorCommand = {
    type: "add_nation",
    id: "FRANCE01",
    name: "France",
    flag: null,
  };

  test("clear the owner, structures and ships off tiles that change kind", async () => {
    const e = await testMapEditor("half_land_half_ocean");
    const game = e.runner.game;
    const land: TileRef[] = [];
    game.forEachTile((t) => {
      if (game.isLand(t)) land.push(t);
    });
    e.apply(ADD_FRANCE);
    e.apply({ type: "set_owner", tiles: land, owner: "FRANCE01" });
    const france = game.player("FRANCE01");
    const [city, kept, raised] = [land[20], land[40], land[60]];
    for (const tile of [city, kept]) {
      e.apply({
        type: "place_structure",
        unit: UnitType.City,
        tile,
        nation: "FRANCE01",
        level: 1,
      });
    }
    const water = game.ref(12, 8);
    expect(game.isWater(water)).toBe(true);
    france.buildUnit(UnitType.Warship, water, { patrolTile: water });

    e.apply(setTerrain([city, raised, water], [0, 0x80 | 20, 0x80 | 5]));
    expect(game.isWater(city)).toBe(true);
    expect(game.owner(city).isPlayer()).toBe(false);
    expect(game.units(UnitType.City).map((u) => u.tile())).toEqual([kept]);
    expect(game.units(UnitType.Warship)).toEqual([]);
    expect(game.isLand(water)).toBe(true);
    expect(game.owner(water).isPlayer()).toBe(false);
    // Land at another elevation is still land: it keeps its owner.
    expect(game.magnitude(raised)).toBe(20);
    expect(game.owner(raised)).toBe(france);
    expect(france.numTilesOwned()).toBe(land.length - 1);
  });

  test("delete a port whose shore an edit beside it takes away", async () => {
    const e = await testMapEditor("half_land_half_ocean");
    const game = e.runner.game;
    const land: TileRef[] = [];
    game.forEachTile((t) => {
      if (game.isLand(t)) land.push(t);
    });
    e.apply(ADD_FRANCE);
    e.apply({ type: "set_owner", tiles: land, owner: "FRANCE01" });
    const port = land.find((t) => game.isShore(t))!;
    e.apply({
      type: "place_structure",
      unit: UnitType.Port,
      tile: port,
      nation: "FRANCE01",
      level: 1,
    });
    const water = game.neighbors(port).filter((n) => game.isWater(n));
    e.apply(
      setTerrain(
        water,
        water.map(() => 0x80),
      ),
    );
    expect(game.isShore(port)).toBe(false);
    expect(game.units(UnitType.Port)).toEqual([]);
  });

  test("land splitting the ocean: the smaller side loses the ocean bit and gets its own water component", async () => {
    // Land on the left half, water on the right.
    const e = await testMapEditor("half_land_half_ocean");
    const game = e.runner.game;
    const w = game.width();
    const h = game.height();
    // A wall of land two tiles wide down the water at x = 10 and 11, so
    // the minimap is split too.
    const wall: TileRef[] = [];
    for (let y = 0; y < h; y++) wall.push(game.ref(10, y), game.ref(11, y));
    const left = game.ref(8, 0);
    const right = game.ref(w - 1, 0);
    expect(game.isOcean(left) && game.isOcean(right)).toBe(true);
    const leftBefore = game.getWaterComponent(left);
    expect(game.getWaterComponent(right)).toBe(leftBefore);
    const graphVersion = game.waterGraphVersion();
    const waterVersion = game.map().waterVersion();

    e.apply(
      setTerrain(
        wall,
        wall.map(() => 0x80),
      ),
    );
    expect(game.map().waterVersion()).toBeGreaterThan(waterVersion);
    // Until the stroke ends the ocean bit is stale.
    expect(game.isOcean(left)).toBe(true);

    e.apply({ type: "end_terrain_edit" });
    expect(game.isOcean(left)).toBe(false);
    expect(game.isOcean(right)).toBe(true);
    // The water graph waits for the rebuild before test play and export.
    expect(game.waterGraphVersion()).toBe(graphVersion);
    expect(game.getWaterComponent(left)).toBe(leftBefore);
    game.rebuildWaterGraph();
    expect(game.waterGraphVersion()).toBe(graphVersion + 1);
    expect(game.getWaterComponent(left)).not.toBe(
      game.getWaterComponent(right),
    );
    // The minimap turned to land under the wall.
    const mini = game.miniMap();
    for (let my = 0; my < mini.height(); my++) {
      expect(mini.isLand(mini.ref(5, my))).toBe(true);
      expect(mini.isWater(mini.ref(4, my))).toBe(true);
    }

    // Removing the wall joins them again.
    e.apply(
      setTerrain(
        wall,
        wall.map(() => 0),
      ),
    );
    e.apply({ type: "end_terrain_edit" });
    game.rebuildWaterGraph();
    expect(game.isOcean(left)).toBe(true);
    expect(game.getWaterComponent(left)).toBe(game.getWaterComponent(right));
  });

  describe("rejects bad commands and changes nothing", () => {
    async function rejects(command: unknown, error: RegExp): Promise<void> {
      const e = await testMapEditor("half_land_half_ocean");
      const before = snapshotGame(e.runner.game);
      expect(() =>
        e.runner.applyEditorCommand(command as EditorCommand),
      ).toThrow(error);
      expect(snapshotGame(e.runner.game)).toEqual(before);
    }

    test("a tile off the map, anywhere in the batch", async () => {
      await rejects(setTerrain([0, 1, 16 * 16], [0, 0, 0]), /not on the map/);
    });

    test("as many tiles as terrain values", async () => {
      await rejects(setTerrain([0, 1], [0]), /2 tiles but 1 terrain values/);
    });

    test("a value that isn't authored terrain", async () => {
      for (const value of [0x20, 0x40, 0x7f, 0xa0, 0xff, -1]) {
        await rejects(setTerrain([0], [value]), /./);
      }
    });
  });
});
