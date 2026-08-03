import { vi } from "vitest";
import type { Game } from "../../../src/core/game/Game";
import {
  Cell,
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

  test("purchased names each go to exactly one tribe", async () => {
    const game = await setup("plains", { bots: 5, gameMap: GameMapType.Asia });

    mockResolveTribeNameData.mockReturnValue({
      prefixes: ["Alpha"],
      suffixes: ["Tribe"],
    });

    const spawner = new TribeSpawner(game, GAME_ID);
    const execs = spawner.spawnTribes(5, ["Dragon Riders", "Night Wolves"]);

    expect(execs).toHaveLength(5);
    const names = execs.map(
      (e) => (e as unknown as { playerInfo: { name: string } }).playerInfo.name,
    );
    expect(names.filter((n) => n === "Dragon Riders")).toHaveLength(1);
    expect(names.filter((n) => n === "Night Wolves")).toHaveLength(1);
    expect(names.filter((n) => n === "Alpha Tribe")).toHaveLength(3);
  });

  test("purchased names beyond the open slots are dropped from the tail", async () => {
    const game = await setup("plains", { bots: 2, gameMap: GameMapType.Asia });

    mockResolveTribeNameData.mockReturnValue({
      prefixes: ["Alpha"],
      suffixes: ["Tribe"],
    });

    const spawner = new TribeSpawner(game, GAME_ID);
    const execs = spawner.spawnTribes(2, [
      "First Name",
      "Second Name",
      "Third Name",
    ]);

    const names = execs.map(
      (e) => (e as unknown as { playerInfo: { name: string } }).playerInfo.name,
    );
    expect(names).toContain("First Name");
    expect(names).toContain("Second Name");
    expect(names).not.toContain("Third Name");
  });

  test("positioned map tribes keep their slots ahead of purchased names", async () => {
    const game = await setup("plains", { bots: 2, gameMap: GameMapType.Asia });
    const tile = findLandTile(game);

    mockResolveTribeNameData.mockReturnValue({
      prefixes: ["Alpha"],
      suffixes: ["Tribe"],
      customTribes: [
        { name: "Positioned", coordinates: [game.x(tile), game.y(tile)] },
      ],
    });

    const spawner = new TribeSpawner(game, GAME_ID);
    const execs = spawner.spawnTribes(2, ["Bought One", "Bought Two"]);

    const names = execs.map(
      (e) => (e as unknown as { playerInfo: { name: string } }).playerInfo.name,
    );
    expect(names).toContain("Positioned");
    expect(names).toContain("Bought One");
    expect(names).not.toContain("Bought Two");
  });

  test("purchased assignment is identical for the same game id", async () => {
    const game = await setup("plains", { bots: 6, gameMap: GameMapType.Asia });

    mockResolveTribeNameData.mockReturnValue({
      prefixes: ["Alpha", "Beta", "Gamma"],
      suffixes: ["Tribe", "Clan"],
    });

    const purchased = ["Dragon Riders", "Night Wolves"];
    const spawn = () =>
      new TribeSpawner(game, GAME_ID)
        .spawnTribes(6, purchased)
        .map(
          (e) =>
            (e as unknown as { playerInfo: { name: string; id: string } })
              .playerInfo,
        );

    const first = spawn();
    const second = spawn();
    expect(second.map((p) => p.name)).toEqual(first.map((p) => p.name));
    expect(second.map((p) => p.id)).toEqual(first.map((p) => p.id));
  });

  test("no purchased names leaves the organic sequence unchanged", async () => {
    const game = await setup("plains", { bots: 4, gameMap: GameMapType.Asia });

    mockResolveTribeNameData.mockReturnValue({
      prefixes: ["Alpha", "Beta", "Gamma"],
      suffixes: ["Tribe", "Clan"],
    });

    const spawn = (purchased?: string[]) =>
      purchased === undefined
        ? new TribeSpawner(game, GAME_ID).spawnTribes(4)
        : new TribeSpawner(game, GAME_ID).spawnTribes(4, purchased);
    const infos = (execs: ReturnType<typeof spawn>) =>
      execs.map(
        (e) =>
          (e as unknown as { playerInfo: { name: string; id: string } })
            .playerInfo,
      );

    // An empty purchased list must not shift the PRNG stream — the names
    // AND ids must match the no-argument (replay-compatible) path.
    const withoutArg = infos(spawn());
    const withEmpty = infos(spawn([]));
    expect(withEmpty.map((p) => p.name)).toEqual(withoutArg.map((p) => p.name));
    expect(withEmpty.map((p) => p.id)).toEqual(withoutArg.map((p) => p.id));
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

  test("constructor ignores out-of-bounds nation cells without throwing", async () => {
    const game = await setup("plains", { bots: 1, gameMap: GameMapType.Asia });

    mockResolveTribeNameData.mockReturnValue({
      prefixes: ["Test"],
      suffixes: ["Tribe"],
    });

    const oobCell = new Cell(99999, 99999);
    // Must not throw despite the out-of-bounds cell.
    const spawner = new TribeSpawner(game, GAME_ID, [oobCell]);
    const execs = spawner.spawnTribes(1);

    expect(execs).toHaveLength(1);
    // Tribe should still spawn normally (random, no fixed tile).
    expect(execs[0].tile).toBeUndefined();
  });

  test("valid nation cell prevents positioned tribe from occupying that tile", async () => {
    const game = await setup("plains", { bots: 1, gameMap: GameMapType.Asia });
    const tile = findLandTile(game);
    const x = game.x(tile);
    const y = game.y(tile);

    mockResolveTribeNameData.mockReturnValue({
      prefixes: ["Test"],
      suffixes: ["Tribe"],
      customTribes: [{ name: "Occupied", coordinates: [x, y] }],
    });

    // A nation already sits on this tile.
    const nationCell = new Cell(x, y);
    const spawner = new TribeSpawner(game, GAME_ID, [nationCell]);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const execs = spawner.spawnTribes(1);

    expect(execs).toHaveLength(1);
    // The positioned tribe was rejected (tile occupied by nation), so
    // it falls back to a random spawn with no fixed tile.
    expect(execs[0].tile).toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
  });
});
