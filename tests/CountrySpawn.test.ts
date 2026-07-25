/**
 * Country-start mode engine tests on the 100x100 all-land `plains` fixture
 * with a 4-quadrant region raster grouped into three countries:
 *   Alpha  = regions 1,2 (top half, 5000 tiles)
 *   Bravo  = region 3 (bottom-left quadrant, 2500 tiles)
 *   Charlie = region 4 (bottom-right quadrant, 2500 tiles)
 *
 * Covers: nations pre-filling their countries (staggered), country-spawn
 * troops, humans taking whole countries on click, first-click-wins conflicts,
 * relocation returning the old country to its nation, singleplayer spawn-end,
 * post-spawn nation behavior, and the spawn-phase ownership-uniformity
 * invariant that the single-tile claim check relies on.
 */
import { NationExecution } from "../src/core/execution/NationExecution";
import { SpawnExecution } from "../src/core/execution/SpawnExecution";
import {
  Game,
  GameType,
  Nation,
  Player,
  PlayerInfo,
  PlayerType,
} from "../src/core/game/Game";
import { CountriesJson } from "../src/core/game/RegionMap";
import { GameConfig, GameID } from "../src/core/Schemas";
import { setup } from "./util/Setup";
import { executeTicks } from "./util/utils";

const gameID: GameID = "country_spawn_test";
const W = 100;

/** Quadrant regions: 1=(x<50,y<50), 2=(x>=50,y<50), 3=(x<50,y>=50), 4=rest. */
function quadrantRaster(): Uint16Array {
  const raster = new Uint16Array(W * W);
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      raster[y * W + x] = (x < 50 ? 0 : 1) + (y < 50 ? 0 : 2) + 1;
    }
  }
  return raster;
}

const COUNTRIES: CountriesJson = {
  version: 1,
  countries: [
    { name: "Alpha", flag: "al", regions: [1, 2] },
    { name: "Bravo", flag: "ba", regions: [3] },
    { name: "Charlie", flag: "ch", regions: [4] },
  ],
};

const ALPHA_TILES = 5000;
const BRAVO_TILES = 2500;

async function setupGame(
  config: Partial<GameConfig> = {},
): Promise<{ game: Game; nations: Nation[] }> {
  const nations = COUNTRIES.countries.map(
    (c, i) =>
      new Nation(
        undefined,
        new PlayerInfo(c.name, PlayerType.Nation, null, `nation_${i + 1}`),
        i + 1,
      ),
  );
  const game = await setup(
    "plains",
    { gameType: GameType.Private, ...config },
    [],
    undefined,
    undefined,
    false, // do not auto-end the spawn phase
    quadrantRaster(),
    COUNTRIES,
    nations,
  );
  for (const nation of nations) {
    game.addExecution(new NationExecution(gameID, nation));
  }
  return { game, nations };
}

function addHuman(game: Game, id: string): PlayerInfo {
  const info = new PlayerInfo(id, PlayerType.Human, `client_${id}`, id);
  game.addPlayer(info);
  return info;
}

/**
 * Spawn-phase invariant: ownership is country-uniform — every ownable tile
 * of a country has the same owner (possibly TerraNullius).
 */
function expectCountryUniformOwnership(game: Game): void {
  const rm = game.regionMap()!;
  for (let countryId = 1; countryId <= rm.countryCount(); countryId++) {
    let ownerSmallId: number | null = null;
    rm.forEachCountryTile(countryId, (tile) => {
      const owner = game.owner(tile);
      const id = owner.isPlayer() ? (owner as Player).smallID() : 0;
      if (ownerSmallId === null) {
        ownerSmallId = id;
      } else {
        expect(id).toBe(ownerSmallId);
      }
    });
  }
}

function countryOwnedTiles(game: Game, player: Player, countryId: number) {
  const rm = game.regionMap()!;
  let owned = 0;
  rm.forEachCountryTile(countryId, (tile) => {
    if (game.owner(tile) === player) owned++;
  });
  return owned;
}

describe("Country-start mode", () => {
  test("nations paint their whole countries during the spawn phase (staggered)", async () => {
    const { game } = await setupGame();
    // Stagger ticks are 1..29 — by tick 30 every nation has painted.
    executeTicks(game, 31);
    expect(game.inSpawnPhase()).toBe(true);

    const alpha = game.player("nation_1");
    const bravo = game.player("nation_2");
    const charlie = game.player("nation_3");
    expect(alpha.numTilesOwned()).toBe(ALPHA_TILES);
    expect(bravo.numTilesOwned()).toBe(BRAVO_TILES);
    expect(charlie.numTilesOwned()).toBe(BRAVO_TILES);
    expect(alpha.hasSpawned()).toBe(true);
    expectCountryUniformOwnership(game);

    // Country-spawn troops: 20% of maxTroops at country size.
    expect(alpha.troops()).toBe(
      Math.floor(0.2 * game.config().maxTroops(alpha)),
    );
  });

  test("human click takes the entire country and the nation goes dormant", async () => {
    const { game } = await setupGame();
    executeTicks(game, 31);
    const human = addHuman(game, "human_1");
    // Click somewhere inside Alpha (top half).
    game.addExecution(new SpawnExecution(gameID, human, game.ref(10, 10)));
    executeTicks(game, 2);

    const humanPlayer = game.player("human_1");
    const alpha = game.player("nation_1");
    expect(humanPlayer.numTilesOwned()).toBe(ALPHA_TILES);
    expect(countryOwnedTiles(game, humanPlayer, 1)).toBe(ALPHA_TILES);
    expect(alpha.numTilesOwned()).toBe(0);
    expect(alpha.isAlive()).toBe(false);
    expect(humanPlayer.troops()).toBe(
      Math.floor(0.2 * game.config().maxTroops(humanPlayer)),
    );
    expectCountryUniformOwnership(game);
  });

  test("second human clicking a claimed country is a deterministic no-op", async () => {
    const { game } = await setupGame();
    executeTicks(game, 31);
    const human1 = addHuman(game, "human_1");
    const human2 = addHuman(game, "human_2");
    game.addExecution(new SpawnExecution(gameID, human1, game.ref(10, 10)));
    executeTicks(game, 2);
    // human_2 clicks a different tile of the same (now human-held) country.
    game.addExecution(new SpawnExecution(gameID, human2, game.ref(80, 10)));
    executeTicks(game, 2);

    expect(game.player("human_1").numTilesOwned()).toBe(ALPHA_TILES);
    expect(game.player("human_2").hasSpawned()).toBe(false);
    expect(game.player("human_2").numTilesOwned()).toBe(0);
    expectCountryUniformOwnership(game);
  });

  test("relocation returns the old country to its nation with fresh troops", async () => {
    const { game } = await setupGame();
    executeTicks(game, 31);
    const human = addHuman(game, "human_1");
    game.addExecution(new SpawnExecution(gameID, human, game.ref(10, 10)));
    executeTicks(game, 2);
    expect(game.player("nation_1").isAlive()).toBe(false);

    // Re-click into Bravo (bottom-left quadrant).
    game.addExecution(new SpawnExecution(gameID, human, game.ref(10, 80)));
    executeTicks(game, 2);

    const humanPlayer = game.player("human_1");
    const alpha = game.player("nation_1");
    const bravo = game.player("nation_2");
    expect(humanPlayer.numTilesOwned()).toBe(BRAVO_TILES);
    expect(countryOwnedTiles(game, humanPlayer, 2)).toBe(BRAVO_TILES);
    expect(bravo.numTilesOwned()).toBe(0);
    expect(alpha.numTilesOwned()).toBe(ALPHA_TILES);
    expect(alpha.isAlive()).toBe(true);
    expect(alpha.troops()).toBe(
      Math.floor(0.2 * game.config().maxTroops(alpha)),
    );
    expectCountryUniformOwnership(game);
  });

  test("re-clicking inside the player's own country changes nothing", async () => {
    const { game } = await setupGame();
    executeTicks(game, 31);
    const human = addHuman(game, "human_1");
    game.addExecution(new SpawnExecution(gameID, human, game.ref(10, 10)));
    executeTicks(game, 2);
    const troopsBefore = game.player("human_1").troops();

    game.addExecution(new SpawnExecution(gameID, human, game.ref(80, 10)));
    executeTicks(game, 2);
    expect(game.player("human_1").numTilesOwned()).toBe(ALPHA_TILES);
    expect(game.player("human_1").troops()).toBe(troopsBefore);
  });

  test("singleplayer: spawn phase ends on the human's click; late nations paint post-spawn", async () => {
    const { game } = await setupGame({ gameType: GameType.Singleplayer });
    const human = addHuman(game, "human_1");
    // Click on tick 1 — before any nation's stagger tick.
    game.addExecution(new SpawnExecution(gameID, human, game.ref(10, 10)));
    executeTicks(game, 2);
    expect(game.inSpawnPhase()).toBe(false);
    expect(game.player("human_1").numTilesOwned()).toBe(ALPHA_TILES);

    // Nations whose countries are free paint on the first post-spawn ticks;
    // Alpha (human-held) stays dormant.
    executeTicks(game, 3);
    expect(game.player("nation_1").hasSpawned()).toBe(false);
    expect(game.player("nation_2").numTilesOwned()).toBe(BRAVO_TILES);
    expect(game.player("nation_3").numTilesOwned()).toBe(BRAVO_TILES);
  });

  test("random spawn takes a whole country (nation-owned centers accepted)", async () => {
    const { game } = await setupGame({ randomSpawn: true });
    executeTicks(game, 31);
    const human = addHuman(game, "human_1");
    // Random spawn ignores the click tile; every land tile is nation-owned,
    // so the random-center loop must accept a nation-owned center.
    game.addExecution(new SpawnExecution(gameID, human));
    executeTicks(game, 2);

    const humanPlayer = game.player("human_1");
    expect(humanPlayer.hasSpawned()).toBe(true);
    expect([ALPHA_TILES, BRAVO_TILES]).toContain(humanPlayer.numTilesOwned());
    expectCountryUniformOwnership(game);
  });

  test("post-spawn: dormant nation deactivates, live nations run the AI without errors", async () => {
    const { game } = await setupGame();
    executeTicks(game, 31);
    const human = addHuman(game, "human_1");
    game.addExecution(new SpawnExecution(gameID, human, game.ref(10, 10)));
    executeTicks(game, 2);
    // End the multiplayer spawn phase (normally done by SpawnTimerExecution).
    game.endSpawnPhase();

    // ~50 ticks of post-spawn AI: no throws, nations stay functional.
    executeTicks(game, 50);
    expect(game.player("nation_1").isAlive()).toBe(false);
    const bravo = game.player("nation_2");
    const charlie = game.player("nation_3");
    expect(bravo.isAlive()).toBe(true);
    expect(charlie.isAlive()).toBe(true);
    // Troop regen ran (PlayerExecutions were registered by conquerCountry).
    expect(bravo.troops()).toBeGreaterThan(
      Math.floor(0.2 * game.config().maxTroops(bravo)),
    );
  });
});
