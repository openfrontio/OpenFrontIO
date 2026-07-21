import { encodeTerrainTile } from "../src/client/render/gl/utils/ColorUtils";
import { AttackExecution } from "../src/core/execution/AttackExecution";
import { NationAllianceBehavior } from "../src/core/execution/nation/NationAllianceBehavior";
import { NationEmojiBehavior } from "../src/core/execution/nation/NationEmojiBehavior";
import { NationNukeBehavior } from "../src/core/execution/nation/NationNukeBehavior";
import { NukeExecution } from "../src/core/execution/NukeExecution";
import { AiAttackBehavior } from "../src/core/execution/utils/AiAttackBehavior";
import {
  Difficulty,
  Game,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
  Player,
  PlayerInfo,
  PlayerType,
  TerrainType,
  UnitType,
} from "../src/core/game/Game";
import { createGame } from "../src/core/game/GameImpl";
import { genTerrainFromBin } from "../src/core/game/TerrainMapLoader";
import { UserSettings } from "../src/core/game/UserSettings";
import { PseudoRandom } from "../src/core/PseudoRandom";
import { GameConfig } from "../src/core/Schemas";
import { TestConfig } from "./util/TestConfig";
import { executeTicks } from "./util/utils";

// ─── Terrain byte constants (must match GameMapImpl) ────────────────────
const LAND_PLAINS = 0b10000000; // isLand=1, magnitude=0 (Plains)
const IMPASSABLE = 0b10011111; // isLand=1, magnitude=31 (Impassable)

const MAP_W = 200;
const MAP_H = 200;
const MINI_W = 100;
const MINI_H = 100;

// The impassable wall is a vertical strip at x = WALL_X.
const WALL_X = 100;
const WALL_WIDTH = 2;

function buildTerrain(
  width: number,
  height: number,
  wallX: number,
  wallWidth: number,
): { data: Uint8Array; numLandTiles: number } {
  const data = new Uint8Array(width * height);
  let numLandTiles = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (x >= wallX && x < wallX + wallWidth) {
        data[idx] = IMPASSABLE;
        // Impassable tiles are NOT counted as land tiles.
      } else {
        data[idx] = LAND_PLAINS;
        numLandTiles++;
      }
    }
  }
  return { data, numLandTiles };
}

async function setupImpassableGame(humans: PlayerInfo[] = []): Promise<Game> {
  vi.spyOn(console, "debug").mockImplementation(() => {});

  const full = buildTerrain(MAP_W, MAP_H, WALL_X, WALL_WIDTH);
  const mini = buildTerrain(MINI_W, MINI_H, Math.floor(WALL_X / 2), 1);

  const gameMap = await genTerrainFromBin(
    { width: MAP_W, height: MAP_H, num_land_tiles: full.numLandTiles },
    full.data,
  );
  const miniGameMap = await genTerrainFromBin(
    { width: MINI_W, height: MINI_H, num_land_tiles: mini.numLandTiles },
    mini.data,
  );

  const gameConfig: GameConfig = {
    gameMap: GameMapType.Asia,
    gameMapSize: GameMapSize.Normal,
    gameMode: GameMode.FFA,
    gameType: GameType.Singleplayer,
    difficulty: Difficulty.Medium,
    nations: "default",
    donateGold: false,
    donateTroops: false,
    bots: 0,
    infiniteGold: true,
    infiniteTroops: true,
    instantBuild: true,
    randomSpawn: false,
  };
  const config = new TestConfig(gameConfig, new UserSettings(), false);

  const game = createGame(humans, [], gameMap, miniGameMap, config);
  game.endSpawnPhase();
  return game;
}

describe("Impassable Terrain", () => {
  let game: Game;
  let player: Player;
  let other: Player;

  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(async () => {
    game = await setupImpassableGame([
      new PlayerInfo("player", PlayerType.Human, "c1", "player_id"),
      new PlayerInfo("other", PlayerType.Human, "c2", "other_id"),
    ]);
    // Override nuke settings for deterministic tests.
    (game.config() as TestConfig).nukeMagnitudes = vi.fn(() => ({
      inner: 5,
      outer: 5,
    }));
    (game.config() as TestConfig).nukeAllianceBreakThreshold = vi.fn(() => 999);
    (game.config() as TestConfig).setDefaultNukeSpeed(50);

    player = game.player("player_id");
    other = game.player("other_id");
  });

  // ── Terrain classification ──────────────────────────────────────────

  test("isImpassable returns true for impassable tiles, false for plains", () => {
    expect(game.isImpassable(game.ref(50, 50))).toBe(false);
    expect(game.isImpassable(game.ref(WALL_X, 50))).toBe(true);
    expect(game.isImpassable(game.ref(WALL_X + 1, 50))).toBe(true);
  });

  test("terrainType returns Impassable for impassable tiles", () => {
    expect(game.terrainType(game.ref(WALL_X, 50))).toBe(TerrainType.Impassable);
  });

  test("isLand returns true for impassable (solid for pathfinding)", () => {
    expect(game.isLand(game.ref(WALL_X, 50))).toBe(true);
  });

  test("numLandTiles excludes impassable tiles", () => {
    expect(game.numLandTiles()).toBe(MAP_W * MAP_H - WALL_WIDTH * MAP_H);
  });

  // ── Ownership ────────────────────────────────────────────────────────

  test("conquer throws on impassable tiles", () => {
    expect(() => player.conquer(game.ref(WALL_X, 50))).toThrow(/impassable/);
  });

  test("conquer succeeds on normal land", () => {
    expect(() => player.conquer(game.ref(50, 50))).not.toThrow();
    expect(game.hasOwner(game.ref(50, 50))).toBe(true);
  });

  // ── Attacks ──────────────────────────────────────────────────────────

  test("canAttack returns false for impassable tiles", () => {
    expect(player.canAttack(game.ref(WALL_X, 50))).toBe(false);
  });

  test("canAttack returns false for impassable tiles even when adjacent to owned land", () => {
    player.conquer(game.ref(WALL_X - 1, 50));
    expect(player.canAttack(game.ref(WALL_X, 50))).toBe(false);
  });

  test("attack does not expand into impassable tiles", () => {
    // Other player owns tiles adjacent to the wall on the right side.
    for (let y = 48; y <= 52; y++) {
      other.conquer(game.ref(WALL_X + 2, y));
    }
    // Player owns tiles on the left side, also adjacent to the wall.
    for (let y = 48; y <= 52; y++) {
      player.conquer(game.ref(WALL_X - 2, y));
    }
    // Player attacks the other player.
    game.addExecution(new AttackExecution(1000, player, other.id()));
    executeTicks(game, 50);
    // Impassable tiles should never be owned by the attacker.
    for (let y = 48; y <= 52; y++) {
      expect(game.ownerID(game.ref(WALL_X, y))).not.toBe(player.smallID());
      expect(game.ownerID(game.ref(WALL_X + 1, y))).not.toBe(player.smallID());
    }
  });

  // ── Nukes: targeting ─────────────────────────────────────────────────

  test("canBuild(AtomBomb) returns false for impassable target", () => {
    expect(player.canBuild(UnitType.AtomBomb, game.ref(WALL_X, 50))).toBe(
      false,
    );
  });

  test("canBuild(MIRV) returns false for impassable target", () => {
    expect(player.canBuild(UnitType.MIRV, game.ref(WALL_X, 50))).toBe(false);
  });

  test("nuke execution deactivates when targeting impassable tile", () => {
    player.conquer(game.ref(10, 10));
    player.buildUnit(UnitType.MissileSilo, game.ref(10, 10), {});
    const nuke = new NukeExecution(
      UnitType.AtomBomb,
      player,
      game.ref(WALL_X, 10),
    );
    game.addExecution(nuke);
    executeTicks(game, 5);
    expect(nuke.isActive()).toBe(false);
  });

  // ── Nukes: blast radius ───────────────────────────────────────────────

  test("nuke blast does not destroy or flood impassable tiles", () => {
    player.conquer(game.ref(10, 100));
    player.buildUnit(UnitType.MissileSilo, game.ref(10, 100), {});
    // Other player owns a tile just left of the wall.
    other.conquer(game.ref(WALL_X - 1, 100));

    const nuke = new NukeExecution(
      UnitType.AtomBomb,
      player,
      game.ref(WALL_X - 1, 100),
      game.ref(10, 100),
    );
    game.addExecution(nuke);
    executeTicks(game, 30);

    // Impassable tiles should still be land and impassable (not flooded).
    for (let y = 95; y <= 105; y++) {
      const t = game.ref(WALL_X, y);
      expect(game.isLand(t)).toBe(true);
      expect(game.isImpassable(t)).toBe(true);
    }
  });

  // ── Nukes: trajectory ─────────────────────────────────────────────────

  test("nuke trajectory blocked by impassable terrain", () => {
    player.conquer(game.ref(20, 100));
    player.buildUnit(UnitType.MissileSilo, game.ref(20, 100), {});
    // Target is on the right side of the wall — trajectory must cross it.
    const target = game.ref(150, 100);
    expect(game.isImpassable(target)).toBe(false);

    const nuke = new NukeExecution(UnitType.AtomBomb, player, target);
    game.addExecution(nuke);
    executeTicks(game, 10);
    // Should have been blocked.
    expect(nuke.isActive()).toBe(false);
  });

  test("nuke can launch when trajectory does not cross impassable terrain", () => {
    player.conquer(game.ref(20, 100));
    player.buildUnit(UnitType.MissileSilo, game.ref(20, 100), {});
    // Target is on the same (left) side — no impassable terrain in between.
    const target = game.ref(50, 100);
    expect(game.isImpassable(target)).toBe(false);

    const nuke = new NukeExecution(UnitType.AtomBomb, player, target);
    game.addExecution(nuke);
    executeTicks(game, 40);
    // Should have detonated and deactivated normally.
    expect(nuke.isActive()).toBe(false);
  });

  // ── Water conversion guard ────────────────────────────────────────────

  test("setWater does not convert impassable tiles", () => {
    const t = game.ref(WALL_X, 50);
    expect(game.isImpassable(t)).toBe(true);
    game.map().setWater(t);
    expect(game.isLand(t)).toBe(true);
    expect(game.isImpassable(t)).toBe(true);
  });

  // ── Rendering ─────────────────────────────────────────────────────────

  test("encodeTerrainTile renders impassable as the map background colour", () => {
    const out = new Uint8Array(4);
    encodeTerrainTile(IMPASSABLE, out, 0);
    // Must match the clear colour in Renderer.ts drawBaseLayer():
    // gl.clearColor(60/255, 60/255, 60/255) → rgb(60, 60, 60).
    expect(out[0]).toBe(60);
    expect(out[1]).toBe(60);
    expect(out[2]).toBe(60);
    expect(out[3]).toBe(255);
  });

  test("encodeTerrainTile renders plains normally (not background)", () => {
    const out = new Uint8Array(4);
    encodeTerrainTile(LAND_PLAINS, out, 0);
    // Plains: r=190, g=220, b=138 — clearly different from background.
    expect(out[0]).toBe(190);
    expect(out[1]).toBe(220);
    expect(out[2]).toBe(138);
  });

  // ── Nation AI: attack behavior near impassable terrain ───────────────

  describe("Nation AI attack behavior near impassable terrain", () => {
    let nation: Player;
    let enemy: Player;

    beforeEach(() => {
      // Create a nation player that owns tiles adjacent to the impassable
      // wall AND directly adjacent to the enemy (no TerraNullius gap).
      nation = game.player("player_id");
      enemy = game.player("other_id");

      // Nation owns the two columns right next to the wall (full height to
      // avoid any unowned passable tiles at the top/bottom borders).
      for (let y = 0; y < MAP_H; y++) {
        nation.conquer(game.ref(WALL_X - 1, y));
        nation.conquer(game.ref(WALL_X - 2, y));
      }
      // Enemy owns the five columns to the left of the nation (full height).
      for (let y = 0; y < MAP_H; y++) {
        for (let x = WALL_X - 7; x <= WALL_X - 3; x++) {
          enemy.conquer(game.ref(x, y));
        }
      }
      // Give both players plenty of troops — nation is stronger so the
      // "weakest" strategy will actually attack.
      nation.addTroops(200000);
      enemy.addTroops(50000);
    });

    test("hasNonNukedTerraNullius does not falsely detect impassable tiles as TerraNullius", () => {
      // The nation borders impassable terrain (the wall at WALL_X).
      // With the fix, nearby() should NOT include TerraNullius from
      // impassable tiles, and the nation should be able to attack the enemy.
      //
      // Verify the core behavior: nearby() returns the enemy but NOT
      // TerraNullius (impassable tiles are excluded).
      const nearby = nation.nearby();
      const hasTerraNullius = nearby.some((n) => !n.isPlayer());
      const hasEnemy = nearby.some((n) => n === enemy);
      expect(hasTerraNullius).toBe(false);
      expect(hasEnemy).toBe(true);

      // Also verify that sendAttack on the enemy works (it creates an
      // AttackExecution targeting the enemy, not TerraNullius).
      const emojiBehavior = new NationEmojiBehavior(
        new PseudoRandom(42),
        game,
        nation,
      );
      const allianceBehavior = new NationAllianceBehavior(
        new PseudoRandom(42),
        game,
        nation,
        emojiBehavior,
      );
      const attackBehavior = new AiAttackBehavior(
        new PseudoRandom(42),
        game,
        nation,
        0.0, // triggerRatio — always ready to attack
        0.0, // reserveRatio — no reserve needed
        0.0, // expandRatio
        allianceBehavior,
        emojiBehavior,
      );

      // Directly send an attack on the enemy — this should succeed.
      const sent = attackBehavior.sendAttack(enemy, true);
      expect(sent).toBe(true);

      // Tick the game so the AttackExecution's init() runs and creates
      // the actual Attack object on the player.
      executeTicks(game, 1);

      // The nation should have an outgoing attack targeting the enemy.
      const attacksOnEnemy = nation
        .outgoingAttacks()
        .filter((a) => a.target() === enemy);
      expect(attacksOnEnemy.length).toBeGreaterThan(0);
    });
  });

  // ── Nation AI: nuke trajectory over impassable terrain ───────────────

  describe("NationNukeBehavior trajectory over impassable terrain", () => {
    let nukePlayer: Player;

    beforeEach(() => {
      nukePlayer = game.player("player_id");
      (game.config() as TestConfig).infiniteGold = () => true;
      (game.config() as TestConfig).instantBuild = () => true;
      (game.config() as TestConfig).nukeMagnitudes = vi.fn(() => ({
        inner: 5,
        outer: 5,
      }));
      (game.config() as TestConfig).nukeAllianceBreakThreshold = vi.fn(
        () => 999,
      );
      (game.config() as TestConfig).setDefaultNukeSpeed(50);
    });

    test("NationNukeBehavior skips nuke targets whose trajectory crosses impassable terrain", () => {
      // Build a silo on the left side of the wall.
      nukePlayer.conquer(game.ref(20, 100));
      nukePlayer.buildUnit(UnitType.MissileSilo, game.ref(20, 100), {});

      // Enemy owns tiles on the RIGHT side of the wall — trajectory must
      // cross the impassable wall.
      const enemy = game.player("other_id");
      enemy.conquer(game.ref(150, 100));

      // Build a NationNukeBehavior and call maybeSendNuke.
      const emojiBehavior = new NationEmojiBehavior(
        new PseudoRandom(42),
        game,
        nukePlayer,
      );
      const allianceBehavior = new NationAllianceBehavior(
        new PseudoRandom(42),
        game,
        nukePlayer,
        emojiBehavior,
      );
      const attackBehavior = new AiAttackBehavior(
        new PseudoRandom(42),
        game,
        nukePlayer,
        0.0,
        0.0,
        0.0,
        allianceBehavior,
        emojiBehavior,
      );
      const nukeBehavior = new NationNukeBehavior(
        new PseudoRandom(42),
        game,
        nukePlayer,
        attackBehavior,
        emojiBehavior,
      );

      // Set the enemy as a hostile target so the nuke behavior considers them.
      nukePlayer.updateRelation(enemy, -100);

      // Run maybeSendNuke — it should NOT launch a nuke because the
      // trajectory crosses impassable terrain.
      nukeBehavior.maybeSendNuke();

      // No nukes should have been launched.
      const nukes = nukePlayer.units(UnitType.AtomBomb, UnitType.HydrogenBomb);
      expect(nukes.length).toBe(0);
    });
  });
});
