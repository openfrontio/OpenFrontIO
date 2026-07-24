import { vi } from "vitest";
import type { Game } from "../../../src/core/game/Game";
import {
  GameMapSize,
  GameMapType,
  PlayerType,
} from "../../../src/core/game/Game";
import { GameID } from "../../../src/core/Schemas";
import { setup } from "../../util/Setup";

const mockResolveTribeNameData = vi.fn();

vi.mock("../../../src/core/execution/utils/TribeNames", () => ({
  resolveTribeNameData: (...args: unknown[]) =>
    mockResolveTribeNameData(...args),
}));

import { TribeSpawner } from "../../../src/core/execution/TribeSpawner";

const GAME_ID: GameID = "test_game_id";

/** Find the first land tile on the map. */
function findLandTile(game: Game): number {
  for (let x = 0; x < game.width(); x++) {
    for (let y = 0; y < game.height(); y++) {
      const t = game.ref(x, y);
      if (game.isLand(t) && !game.isImpassable(t)) return t;
    }
  }
  throw new Error("no land tile found");
}

/** Find the first water tile on the map. */
function findWaterTile(game: Game): number {
  for (let x = 0; x < game.width(); x++) {
    for (let y = 0; y < game.height(); y++) {
      const t = game.ref(x, y);
      if (game.isWater(t)) return t;
    }
  }
  throw new Error("no water tile found");
}

describe("TribeSpawner", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("positioned tribes spawn before random tribes", async () => {
    const game = await setup("plains", { bots: 3, gameMap: GameMapType.Asia });
    const tile = findLandTile(game);
    const x = game.x(tile);
    const y = game.y(tile);

    mockResolveTribeNameData.mockReturnValue({
      prefixes: ["Alpha"],
      suffixes: ["Tribe"],
      customTribes: [
        { name: "Positioned", coordinates: [x, y] },
        { name: "Random1" },
      ],
    });

    const spawner = new TribeSpawner(game, GAME_ID);
    const execs = spawner.spawnTribes(3);

    expect(execs).toHaveLength(3);
    // Positioned tribe first (has a tile), then random tribes (no tile).
    expect(execs[0].tile).toBeDefined();
    expect(execs[1].tile).toBeUndefined();
    expect(execs[2].tile).toBeUndefined();
  });

  test("compact-map coordinates are halved", async () => {
    const game = await setup("plains", {
      bots: 1,
      gameMap: GameMapType.Asia,
      gameMapSize: GameMapSize.Compact,
    });
    const tile = findLandTile(game);
    const x = game.x(tile);
    const y = game.y(tile);

    mockResolveTribeNameData.mockReturnValue({
      prefixes: ["Test"],
      suffixes: ["Tribe"],
      customTribes: [{ name: "Compact", coordinates: [x * 2, y * 2] }],
    });

    const spawner = new TribeSpawner(game, GAME_ID);
    const execs = spawner.spawnTribes(1);

    expect(execs).toHaveLength(1);
    expect(execs[0].tile).toBe(game.ref(x, y));
  });

  test("returns undefined for coordinates on water", async () => {
    const game = await setup("ocean_and_land", {
      bots: 1,
      gameMap: GameMapType.Asia,
    });
    const tile = findWaterTile(game);
    const x = game.x(tile);
    const y = game.y(tile);

    mockResolveTribeNameData.mockReturnValue({
      prefixes: ["Test"],
      suffixes: ["Tribe"],
      customTribes: [{ name: "WaterTribe", coordinates: [x, y] }],
    });

    const spawner = new TribeSpawner(game, GAME_ID);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const execs = spawner.spawnTribes(1);

    expect(execs).toHaveLength(1);
    // Should fall back to random (no tile set).
    expect(execs[0].tile).toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
  });

  test("falls back to random names when positioned spawn fails", async () => {
    const game = await setup("half_land_half_ocean", {
      bots: 2,
      gameMap: GameMapType.Asia,
    });

    mockResolveTribeNameData.mockReturnValue({
      prefixes: ["Fallback"],
      suffixes: ["Bot"],
      customTribes: [
        { name: "OOB", coordinates: [99999, 99999] },
        { name: "Pool" },
      ],
    });

    const spawner = new TribeSpawner(game, GAME_ID);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const execs = spawner.spawnTribes(2);

    expect(execs).toHaveLength(2);
    // Both should be random (no tile), since OOB failed.
    expect(execs[0].tile).toBeUndefined();
    expect(execs[1].tile).toBeUndefined();
    // OOB must not appear — it has coordinates and failed to spawn.
    const names = execs.map(
      (e) => (e as unknown as { playerInfo: { name: string } }).playerInfo.name,
    );
    expect(names).not.toContain("OOB");
    expect(warnSpy).toHaveBeenCalled();
  });

  test("failed positioned tribe is NOT spawned randomly", async () => {
    const game = await setup("half_land_half_ocean", {
      bots: 3,
      gameMap: GameMapType.Asia,
    });

    mockResolveTribeNameData.mockReturnValue({
      prefixes: ["Fallback"],
      suffixes: ["Bot"],
      customTribes: [{ name: "FixedFail", coordinates: [99999, 99999] }],
    });

    const spawner = new TribeSpawner(game, GAME_ID);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const execs = spawner.spawnTribes(3);

    expect(execs).toHaveLength(3);
    // "FixedFail" must NOT appear — it has coordinates and failed to spawn.
    const names = execs.map(
      (e) => (e as unknown as { playerInfo: { name: string } }).playerInfo.name,
    );
    expect(names).not.toContain("FixedFail");
    expect(warnSpy).toHaveBeenCalled();
  });

  test("random tribe selection avoids duplicates", async () => {
    const game = await setup("plains", {
      bots: 3,
      gameMap: GameMapType.Asia,
    });

    mockResolveTribeNameData.mockReturnValue({
      prefixes: ["A"],
      suffixes: ["B"],
      customTribes: [{ name: "Only" }],
    });

    const spawner = new TribeSpawner(game, GAME_ID);
    const execs = spawner.spawnTribes(3);

    expect(execs).toHaveLength(3);
    // All should be random (no positioned tribes).
    for (const exec of execs) {
      expect(exec.tile).toBeUndefined();
    }
  });

  test("no positioned tribes uses all random names", async () => {
    const game = await setup("plains", {
      bots: 2,
      gameMap: GameMapType.Asia,
    });

    mockResolveTribeNameData.mockReturnValue({
      prefixes: ["X"],
      suffixes: ["Y"],
    });

    const spawner = new TribeSpawner(game, GAME_ID);
    const execs = spawner.spawnTribes(2);

    expect(execs).toHaveLength(2);
    for (const exec of execs) {
      expect(exec.tile).toBeUndefined();
    }
  });

  test("all players spawn on valid land tiles", async () => {
    const game = await setup("plains", {
      bots: 0,
      gameMap: GameMapType.Asia,
    });

    mockResolveTribeNameData.mockReturnValue({
      prefixes: ["Test"],
      suffixes: ["Tribe"],
    });

    const spawner = new TribeSpawner(game, GAME_ID);
    const execs = spawner.spawnTribes(5);

    game.addExecution(...execs);
    game.executeNextTick();
    game.executeNextTick();

    const bots = game.allPlayers().filter((p) => p.type() === PlayerType.Bot);
    expect(bots.length).toBe(5);
    for (const bot of bots) {
      const tile = bot.spawnTile()!;
      expect(tile).toBeDefined();
      expect(game.isLand(tile)).toBe(true);
    }
  });
});
