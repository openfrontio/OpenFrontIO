import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
  Nation,
} from "../src/core/game/Game";
import { createNationsForGame } from "../src/core/game/NationCreation";
import {
  AdditionalNation,
  Nation as ManifestNation,
} from "../src/core/game/TerrainMapLoader";
import { PseudoRandom } from "../src/core/PseudoRandom";
import { GameConfig, GameStartInfo } from "../src/core/Schemas";

function makeManifestNations(count: number): ManifestNation[] {
  const result: ManifestNation[] = [];
  for (let i = 0; i < count; i++) {
    result.push({
      coordinates: [i, i],
      flag: "",
      name: `Manifest${i}`,
    });
  }
  return result;
}

function makeAdditionalNations(names: string[]): AdditionalNation[] {
  return names.map((name) => ({ name }));
}

function makeGameStart(targetNations: number): GameStartInfo {
  const config: GameConfig = {
    gameMap: GameMapType.World,
    gameMapSize: GameMapSize.Normal,
    gameMode: GameMode.FFA,
    gameType: GameType.Singleplayer,
    difficulty: Difficulty.Medium,
    nations: targetNations,
    donateGold: false,
    donateTroops: false,
    bots: 0,
    infiniteGold: false,
    infiniteTroops: false,
    instantBuild: false,
    randomSpawn: false,
  };
  return {
    gameID: "test1234",
    lobbyCreatedAt: 0,
    config,
    players: [],
  };
}

function nationNames(nations: Nation[]): string[] {
  return nations.map((n) => n.playerInfo.name);
}

describe("createNationsForGame: additionalNations pool", () => {
  test("does not draw from the pool when manifest already covers the count", () => {
    const manifest = makeManifestNations(4);
    const extras = makeAdditionalNations(["ExtraA", "ExtraB", "ExtraC"]);
    const random = new PseudoRandom(1);

    const nations = createNationsForGame(
      makeGameStart(3),
      manifest,
      extras,
      0,
      random,
    );

    expect(nations).toHaveLength(3);
    for (const name of nationNames(nations)) {
      expect(name.startsWith("Manifest")).toBe(true);
    }
  });

  test("fills the deficit entirely from the pool when it is large enough", () => {
    const manifest = makeManifestNations(2);
    const extras = makeAdditionalNations([
      "ExtraA",
      "ExtraB",
      "ExtraC",
      "ExtraD",
      "ExtraE",
    ]);
    const random = new PseudoRandom(7);

    const nations = createNationsForGame(
      makeGameStart(5),
      manifest,
      extras,
      0,
      random,
    );

    expect(nations).toHaveLength(5);
    const names = nationNames(nations);

    expect(names.filter((n) => n.startsWith("Manifest"))).toHaveLength(2);

    const fromPool = names.filter((n) => n.startsWith("Extra"));
    expect(fromPool).toHaveLength(3);
    for (const name of fromPool) {
      expect(extras.some((e) => e.name === name)).toBe(true);
    }
  });

  test("randomly selects from the pool when it has more entries than needed", () => {
    const manifest = makeManifestNations(2);
    const pool = [
      "ExtraA",
      "ExtraB",
      "ExtraC",
      "ExtraD",
      "ExtraE",
      "ExtraF",
      "ExtraG",
      "ExtraH",
    ];
    const extras = makeAdditionalNations(pool);

    const seen = new Set<string>();
    for (let seed = 1; seed <= 25; seed++) {
      const random = new PseudoRandom(seed);
      const nations = createNationsForGame(
        makeGameStart(4),
        manifest,
        extras,
        0,
        random,
      );
      expect(nations).toHaveLength(4);

      const fromPool = nationNames(nations).filter((n) =>
        n.startsWith("Extra"),
      );
      expect(fromPool).toHaveLength(2);
      for (const name of fromPool) {
        expect(pool).toContain(name);
      }
      fromPool.forEach((n) => seen.add(n));
    }
    expect(seen.size).toBeGreaterThan(2);
  });

  test("falls back to generated names when the pool is too small", () => {
    const manifest = makeManifestNations(1);
    const extras = makeAdditionalNations(["ExtraA", "ExtraB"]);
    const random = new PseudoRandom(42);

    const nations = createNationsForGame(
      makeGameStart(5),
      manifest,
      extras,
      0,
      random,
    );

    expect(nations).toHaveLength(5);
    const names = nationNames(nations);

    expect(names.filter((n) => n.startsWith("Manifest"))).toHaveLength(1);

    const fromPool = names.filter((n) => extras.some((e) => e.name === n));
    expect(fromPool).toHaveLength(2);

    const generated = names.filter(
      (n) => !n.startsWith("Manifest") && !extras.some((e) => e.name === n),
    );
    expect(generated).toHaveLength(2);
  });

  test("falls back to generated names when the pool is empty", () => {
    const manifest = makeManifestNations(2);
    const random = new PseudoRandom(11);

    const nations = createNationsForGame(
      makeGameStart(4),
      manifest,
      [],
      0,
      random,
    );

    expect(nations).toHaveLength(4);
    expect(
      nationNames(nations).filter((n) => n.startsWith("Manifest")),
    ).toHaveLength(2);
  });

  test("skips pool entries whose name collides with a manifest nation", () => {
    const manifest = makeManifestNations(2);
    const extras = makeAdditionalNations([
      "Manifest0",
      "Manifest1",
      "UniqueExtra",
    ]);
    const random = new PseudoRandom(3);

    const nations = createNationsForGame(
      makeGameStart(3),
      manifest,
      extras,
      0,
      random,
    );

    const names = nationNames(nations);
    expect(names).toHaveLength(3);
    expect(new Set(names).size).toBe(3);
    expect(names).toContain("UniqueExtra");
  });

  test("uses coordinates from additional nations when provided", () => {
    const manifest = makeManifestNations(1);
    const extras: AdditionalNation[] = [
      { name: "WithCoords", coordinates: [42, 99] },
      { name: "WithoutCoords" },
    ];
    const random = new PseudoRandom(5);

    const nations = createNationsForGame(
      makeGameStart(3),
      manifest,
      extras,
      0,
      random,
    );

    const withCoords = nations.find((n) => n.playerInfo.name === "WithCoords");
    const withoutCoords = nations.find(
      (n) => n.playerInfo.name === "WithoutCoords",
    );

    expect(withCoords).toBeDefined();
    expect(withoutCoords).toBeDefined();
    expect(withCoords!.spawnCell?.x).toBe(42);
    expect(withCoords!.spawnCell?.y).toBe(99);
    expect(withoutCoords!.spawnCell).toBeUndefined();
  });

  test("uses coordinates from manifest nations when provided, undefined when omitted", () => {
    const manifest: ManifestNation[] = [
      { name: "WithCoords", coordinates: [10, 20] },
      { name: "WithoutCoords" },
    ];
    const random = new PseudoRandom(5);

    const nations = createNationsForGame(
      makeGameStart(2),
      manifest,
      [],
      0,
      random,
    );

    expect(nations).toHaveLength(2);
    const withCoords = nations.find((n) => n.playerInfo.name === "WithCoords");
    const withoutCoords = nations.find(
      (n) => n.playerInfo.name === "WithoutCoords",
    );

    expect(withCoords).toBeDefined();
    expect(withoutCoords).toBeDefined();
    expect(withCoords!.spawnCell?.x).toBe(10);
    expect(withCoords!.spawnCell?.y).toBe(20);
    expect(withoutCoords!.spawnCell).toBeUndefined();
  });

  test("produces unique nation names overall", () => {
    const manifest = makeManifestNations(3);
    const extras = makeAdditionalNations(["Ex1", "Ex2", "Ex3"]);
    const random = new PseudoRandom(99);

    const nations = createNationsForGame(
      makeGameStart(8),
      manifest,
      extras,
      0,
      random,
    );

    const names = nationNames(nations);
    expect(names).toHaveLength(8);
    expect(new Set(names).size).toBe(8);
  });
});
