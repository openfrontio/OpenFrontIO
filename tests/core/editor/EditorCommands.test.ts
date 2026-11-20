/**
 * The scenario editor's engine applies commands at once, without a tick,
 * and sends the updates each made. A command that can't apply throws and
 * changes nothing.
 */

import {
  authoredTerrain,
  type EditorCommand,
  SetTerrainCommandSchema,
} from "@openfront/engine-api/EditorCommands";
import { TileRef } from "@openfront/engine-api/game/GameMap";
import {
  CustomGameMap,
  GameMapSize,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import {
  GameUpdateType,
  GameUpdateViewData,
  PlayerUpdate,
} from "@openfront/engine-api/game/GameUpdates";
import { GameStartInfo } from "@openfront/engine-api/Schemas";
import { createGameRunner, GameRunner } from "@openfront/engine/GameRunner";
import { snapshotGame } from "@openfront/engine/snapshot/GameSnapshot";
import { loadMapFiles } from "@openfront/shared/GameMapLoader";
import { scriptedGameStart, TestDataMapLoader } from "../../util/ScriptedGame";

const MAP = "half_land_half_ocean";

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

interface Editor {
  runner: GameRunner;
  sent: GameUpdateViewData[];
  apply: (command: EditorCommand) => GameUpdateViewData;
  land: TileRef[];
  shore: TileRef;
  water: TileRef;
}

async function editor(): Promise<Editor> {
  const start = editorStart();
  const sent: GameUpdateViewData[] = [];
  const runner = await createGameRunner(
    start,
    undefined,
    await loadMapFiles(
      new TestDataMapLoader(MAP),
      start.config.gameMap,
      start.config.gameMapSize,
    ),
    (gu) => {
      if ("updates" in gu) sent.push(gu);
      else throw new Error(gu.errMsg);
    },
    true,
  );
  const game = runner.game;
  const land: TileRef[] = [];
  let water: TileRef | undefined;
  game.forEachTile((t) => {
    if (game.isLand(t)) land.push(t);
    else water ??= t;
  });
  const shore = land.find((t) => game.isShore(t));
  if (shore === undefined || water === undefined) throw new Error("bad map");
  return {
    runner,
    sent,
    land,
    shore,
    water,
    apply: (command) => {
      const before = sent.length;
      runner.applyEditorCommand(command);
      expect(sent.length).toBe(before + 1);
      return sent[sent.length - 1];
    },
  };
}

function playerUpdates(gu: GameUpdateViewData): PlayerUpdate[] {
  return gu.updates[GameUpdateType.Player] as PlayerUpdate[];
}

function tileOwners(gu: GameUpdateViewData): TileRef[] {
  const tiles: TileRef[] = [];
  for (let i = 0; i < gu.packedTileUpdates.length; i += 2) {
    tiles.push(gu.packedTileUpdates[i]);
  }
  return tiles;
}

const ADD_FRANCE: EditorCommand = {
  type: "add_nation",
  id: "FRANCE01",
  name: "France",
  flag: "fr",
};

describe("editor commands", () => {
  test("the editor engine starts with no executions", async () => {
    const { runner } = await editor();
    expect(runner.game.executions()).toEqual([]);
  });

  test("add_nation adds a nation and sends its player", async () => {
    const e = await editor();
    const gu = e.apply(ADD_FRANCE);
    const france = e.runner.game.player("FRANCE01");
    expect(france.type()).toBe(PlayerType.Nation);
    expect(france.name()).toBe("France");
    expect(france.info().nationFlag).toBe("fr");
    expect(e.runner.game.nations().map((n) => n.playerInfo.id)).toEqual([
      "FRANCE01",
    ]);
    expect(playerUpdates(gu)).toEqual([
      expect.objectContaining({
        id: "FRANCE01",
        name: "France",
        nationFlag: "fr",
      }),
    ]);
    expect(gu.tick).toBe(0);
    expect(e.runner.game.ticks()).toBe(0);
  });

  test("set_nation changes only the fields given", async () => {
    const e = await editor();
    e.apply(ADD_FRANCE);
    const gu = e.apply({
      type: "set_nation",
      id: "FRANCE01",
      name: "Gaul",
      troops: 5000,
      gold: 1234,
      playable: true,
    });
    const france = e.runner.game.player("FRANCE01");
    expect(france.name()).toBe("Gaul");
    expect(france.info().nationFlag).toBe("fr");
    expect(france.troops()).toBe(5000);
    expect(france.gold()).toBe(1234n);
    expect(france.playable()).toBe(true);
    expect(e.runner.game.nations()[0].playerInfo.name).toBe("Gaul");
    expect(playerUpdates(gu)).toEqual([
      {
        type: GameUpdateType.Player,
        id: "FRANCE01",
        name: "Gaul",
        displayName: "Gaul",
        playable: true,
      },
    ]);
    // Gold and troops travel packed: [smallID, tiles, gold, troops, earned].
    expect(Array.from(gu.packedPlayerUpdates!)).toEqual([
      france.smallID(),
      0,
      1234,
      5000,
      0,
    ]);

    const flagOnly = e.apply({
      type: "set_nation",
      id: "FRANCE01",
      flag: null,
    });
    expect(france.info().nationFlag).toBeNull();
    expect(france.name()).toBe("Gaul");
    expect(playerUpdates(flagOnly)).toEqual([
      expect.objectContaining({ id: "FRANCE01", nationFlag: null }),
    ]);
    expect(e.runner.game.ticks()).toBe(0);
  });

  test("set_owner gives tiles to a nation and back to nobody", async () => {
    const e = await editor();
    const game = e.runner.game;
    e.apply(ADD_FRANCE);
    const tiles = e.land.slice(0, 10);
    const gu = e.apply({ type: "set_owner", tiles, owner: "FRANCE01" });
    const france = game.player("FRANCE01");
    for (const t of tiles) expect(game.owner(t)).toBe(france);
    expect(france.numTilesOwned()).toBe(10);
    expect(new Set(tileOwners(gu))).toEqual(new Set(tiles));

    const freed = e.apply({
      type: "set_owner",
      tiles: tiles.slice(0, 4),
      owner: null,
    });
    expect(france.numTilesOwned()).toBe(6);
    expect(game.owner(tiles[0]).isPlayer()).toBe(false);
    expect(new Set(tileOwners(freed))).toEqual(new Set(tiles.slice(0, 4)));
    expect(game.ticks()).toBe(0);
  });

  test("set_owner deletes structures left on land their nation lost", async () => {
    const e = await editor();
    const game = e.runner.game;
    e.apply(ADD_FRANCE);
    e.apply({ ...ADD_FRANCE, id: "SPAIN001", name: "Spain" });
    e.apply({ type: "set_owner", tiles: e.land, owner: "FRANCE01" });
    const tile = e.land[20];
    e.apply({
      type: "place_structure",
      unit: UnitType.City,
      tile,
      nation: "FRANCE01",
      level: 1,
    });
    const gu = e.apply({ type: "set_owner", tiles: [tile], owner: "SPAIN001" });
    expect(game.units(UnitType.City)).toEqual([]);
    expect(gu.packedUnitUpdates).toBeDefined();
  });

  test("place_structure builds a free structure at its level", async () => {
    const e = await editor();
    const game = e.runner.game;
    e.apply(ADD_FRANCE);
    e.apply({ type: "set_owner", tiles: e.land, owner: "FRANCE01" });
    e.apply({ type: "set_nation", id: "FRANCE01", gold: 100 });
    const gu = e.apply({
      type: "place_structure",
      unit: UnitType.City,
      tile: e.land[20],
      nation: "FRANCE01",
      level: 3,
    });
    const [city] = game.units(UnitType.City);
    expect(city.tile()).toBe(e.land[20]);
    expect(city.owner()).toBe(game.player("FRANCE01"));
    expect(city.level()).toBe(3);
    // Priced later as a nation that built all three levels.
    expect(game.player("FRANCE01").unitsConstructed(UnitType.City)).toBe(3);
    expect(city.isUnderConstruction()).toBe(false);
    expect(game.player("FRANCE01").gold()).toBe(100n);
    expect(gu.packedUnitUpdates).toBeDefined();

    e.apply({
      type: "place_structure",
      unit: UnitType.Port,
      tile: e.shore,
      nation: "FRANCE01",
      level: 1,
    });
    expect(game.units(UnitType.Port).map((u) => u.tile())).toEqual([e.shore]);
    expect(game.ticks()).toBe(0);
  });

  test("a structure placed at a level is loaded, and a SAM at full range", async () => {
    const e = await editor();
    const game = e.runner.game;
    e.apply(ADD_FRANCE);
    e.apply({ type: "set_owner", tiles: e.land, owner: "FRANCE01" });
    e.apply({
      type: "place_structure",
      unit: UnitType.SAMLauncher,
      tile: e.land[20],
      nation: "FRANCE01",
      level: 3,
    });
    e.apply({
      type: "place_structure",
      unit: UnitType.MissileSilo,
      tile: e.land[40],
      nation: "FRANCE01",
      level: 2,
    });
    const [sam] = game.units(UnitType.SAMLauncher);
    expect(sam.level()).toBe(3);
    expect(game.config().dynamicSamRange(sam, game.ticks())).toBe(
      game.config().samRange(3),
    );
    const [silo] = game.units(UnitType.MissileSilo);
    expect(silo.level()).toBe(2);
    expect(silo.missileTimerQueue()).toEqual([]);
    expect(sam.missileTimerQueue()).toEqual([]);
  });

  test("add_nation refuses once tiles can't store another owner id", async () => {
    const e = await editor();
    const game = e.runner.game;
    // Small ids run 1 to 0xfff; removed nations keep theirs.
    for (let i = 1; i < 0xfff; i++) {
      game.addNation(
        new PlayerInfo(
          `N${i}`,
          PlayerType.Nation,
          null,
          `NATION${String(i).padStart(4, "0")}`,
          false,
          null,
          [],
          null,
          null,
        ),
      );
    }
    e.apply(ADD_FRANCE); // takes 0xfff, the last
    expect(game.player("FRANCE01").smallID()).toBe(0xfff);
    e.apply({ type: "remove_nation", id: "FRANCE01" });
    expect(() =>
      e.runner.applyEditorCommand({ ...ADD_FRANCE, id: "SPAIN001" }),
    ).toThrow(/no player ids left/);
    expect(game.hasPlayer("SPAIN001")).toBe(false);
    // A removed nation still has its id to come back under.
    e.apply(ADD_FRANCE);
    expect(game.player("FRANCE01").smallID()).toBe(0xfff);
  });

  test("remove_structure deletes the structure on the tile", async () => {
    const e = await editor();
    const game = e.runner.game;
    e.apply(ADD_FRANCE);
    e.apply({ type: "set_owner", tiles: e.land, owner: "FRANCE01" });
    e.apply({
      type: "place_structure",
      unit: UnitType.DefensePost,
      tile: e.land[20],
      nation: "FRANCE01",
      level: 1,
    });
    const gu = e.apply({ type: "remove_structure", tile: e.land[20] });
    expect(game.units(UnitType.DefensePost)).toEqual([]);
    expect(gu.packedUnitUpdates).toBeDefined();
    expect(game.ticks()).toBe(0);
  });

  test("remove_nation frees its land and structures and its id", async () => {
    const e = await editor();
    const game = e.runner.game;
    e.apply(ADD_FRANCE);
    e.apply({ type: "set_owner", tiles: e.land, owner: "FRANCE01" });
    e.apply({
      type: "place_structure",
      unit: UnitType.City,
      tile: e.land[20],
      nation: "FRANCE01",
      level: 1,
    });
    const france = game.player("FRANCE01");
    const gu = e.apply({ type: "remove_nation", id: "FRANCE01" });
    expect(game.hasPlayer("FRANCE01")).toBe(false);
    expect(game.nations()).toEqual([]);
    expect(game.units(UnitType.City)).toEqual([]);
    for (const t of e.land) expect(game.owner(t).isPlayer()).toBe(false);
    expect(new Set(tileOwners(gu))).toEqual(new Set(e.land));
    expect(playerUpdates(gu)).toEqual([
      expect.objectContaining({ id: "FRANCE01", isAlive: false }),
    ]);
    expect(france.isAlive()).toBe(false);
    expect(game.ticks()).toBe(0);
  });

  test("add_nation brings a removed nation back as its own player", async () => {
    const e = await editor();
    const game = e.runner.game;
    e.apply(ADD_FRANCE);
    const france = game.player("FRANCE01");
    e.apply({
      type: "set_nation",
      id: "FRANCE01",
      troops: 777,
      gold: 888,
      playable: true,
    });
    e.apply({ type: "set_owner", tiles: e.land, owner: "FRANCE01" });
    e.apply({ type: "remove_nation", id: "FRANCE01" });

    const gu = e.apply({ ...ADD_FRANCE, name: "Gaul" });
    // The same player and small id, so a view sees it return.
    expect(game.player("FRANCE01")).toBe(france);
    expect(game.allPlayers()).toEqual([france]);
    expect(game.nations().map((n) => n.playerInfo.name)).toEqual(["Gaul"]);
    expect(playerUpdates(gu)).toEqual([
      expect.objectContaining({ id: "FRANCE01", name: "Gaul" }),
    ]);
    // It starts as a new nation would: no land, and the author's troops,
    // gold and playable gone.
    expect(france.numTilesOwned()).toBe(0);
    expect(france.playable()).toBe(false);
    const fresh = await editor();
    fresh.apply(ADD_FRANCE);
    const added = fresh.runner.game.player("FRANCE01");
    expect(france.troops()).toBe(added.troops());
    expect(france.gold()).toBe(added.gold());
  });

  describe("rejects bad commands and changes nothing", () => {
    async function rejects(
      setup: EditorCommand[],
      command: unknown,
      error: RegExp,
    ): Promise<void> {
      const e = await editor();
      for (const c of setup) e.apply(c);
      const before = snapshotGame(e.runner.game);
      const sent = e.sent.length;
      expect(() =>
        e.runner.applyEditorCommand(command as EditorCommand),
      ).toThrow(error);
      expect(e.sent.length).toBe(sent);
      expect(snapshotGame(e.runner.game)).toEqual(before);
    }

    test("an unknown nation", async () => {
      await rejects([], { type: "remove_nation", id: "NOBODY01" }, /no nation/);
      await rejects(
        [],
        { type: "set_nation", id: "NOBODY01", troops: 1 },
        /no nation/,
      );
    });

    test("a duplicate id", async () => {
      await rejects([ADD_FRANCE], ADD_FRANCE, /already exists/);
    });

    test("a tile off the map, anywhere in the batch", async () => {
      const e = await editor();
      await rejects(
        [ADD_FRANCE],
        { type: "set_owner", tiles: [e.land[0], 16 * 16], owner: "FRANCE01" },
        /not on the map/,
      );
      await rejects(
        [],
        { type: "remove_structure", tile: 16 * 16 + 5 },
        /not on the map/,
      );
    });

    test("water for a nation", async () => {
      const e = await editor();
      await rejects(
        [ADD_FRANCE],
        { type: "set_owner", tiles: [e.land[0], e.water], owner: "FRANCE01" },
        /can't be owned/,
      );
    });

    test("a unit that isn't a structure", async () => {
      const e = await editor();
      await rejects(
        [ADD_FRANCE, { type: "set_owner", tiles: e.land, owner: "FRANCE01" }],
        {
          type: "place_structure",
          unit: UnitType.Warship,
          tile: e.land[20],
          nation: "FRANCE01",
          level: 1,
        },
        /Invalid option/,
      );
    });

    test("a structure on another nation's land, or an occupied tile", async () => {
      const e = await editor();
      const city: EditorCommand = {
        type: "place_structure",
        unit: UnitType.City,
        tile: e.land[20],
        nation: "FRANCE01",
        level: 1,
      };
      await rejects([ADD_FRANCE], city, /is not FRANCE01's/);
      await rejects(
        [
          ADD_FRANCE,
          { type: "set_owner", tiles: e.land, owner: "FRANCE01" },
          city,
        ],
        city,
        /already has a structure/,
      );
    });

    test("a port inland, a level on a structure without levels", async () => {
      const e = await editor();
      const owned: EditorCommand[] = [
        ADD_FRANCE,
        { type: "set_owner", tiles: e.land, owner: "FRANCE01" },
      ];
      const inland = e.land.find((t) => !e.runner.game.isShore(t))!;
      await rejects(
        owned,
        {
          type: "place_structure",
          unit: UnitType.Port,
          tile: inland,
          nation: "FRANCE01",
          level: 1,
        },
        /needs a shore/,
      );
      await rejects(
        owned,
        {
          type: "place_structure",
          unit: UnitType.DefensePost,
          tile: e.land[20],
          nation: "FRANCE01",
          level: 2,
        },
        /has no levels/,
      );
    });

    test("no structure to remove", async () => {
      const e = await editor();
      await rejects(
        [],
        { type: "remove_structure", tile: e.land[0] },
        /has no structure/,
      );
    });
  });
});

describe("authoredTerrain", () => {
  test("keeps the land bit and elevation, and drops what is derived", () => {
    // Water, ocean, and water with a shoreline and depth.
    expect(authoredTerrain(0x00)).toBe(0);
    expect(authoredTerrain(0x20)).toBe(0);
    expect(authoredTerrain(0x45)).toBe(0);
    // Land at elevation 7, inland and on a shore.
    expect(authoredTerrain(0x87)).toBe(0x87);
    expect(authoredTerrain(0xc7)).toBe(0x87);
    // Impassable, inland and on a shore.
    expect(authoredTerrain(0x9f)).toBe(0x9f);
    expect(authoredTerrain(0xdf)).toBe(0x9f);
  });

  test("gives a value set_terrain takes for every byte", () => {
    const terrain = Array.from({ length: 256 }, (_, b) => authoredTerrain(b));
    const tiles = terrain.map((_, i) => i);
    expect(
      SetTerrainCommandSchema.safeParse({ type: "set_terrain", tiles, terrain })
        .success,
    ).toBe(true);
  });
});
