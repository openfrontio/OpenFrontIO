import { Config } from "../../../src/core/configuration/Config";
import { NationExecution } from "../../../src/core/execution/NationExecution";
import { SpawnExecution } from "../../../src/core/execution/SpawnExecution";
import {
  Cell,
  Difficulty,
  Game,
  Nation,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../../../src/core/game/Game";
import { setup } from "../../util/Setup";
import { expectSnapshotRoundTrip } from "../../util/Snapshot";
import { TestConfig, UseRealAttackLogic } from "../../util/TestConfig";

const MAP = "world";
const GAME_ID = "snapshot_nations";

// European and North African nations, close enough to fight, build ports,
// send boats and warships, and nuke each other.
const NATIONS: [string, number, number][] = [
  ["United Kingdom", 925, 186],
  ["France", 958, 220],
  ["Spain", 908, 264],
  ["Germany", 997, 205],
  ["Italy", 1004, 250],
  ["Poland", 1046, 193],
  ["Algeria", 918, 342],
  ["Morocco", 853, 373],
];

const TRIBES: [number, number][] = [
  [980, 240],
  [1030, 225],
  [890, 330],
  [960, 330],
];

async function nationGame(
  difficulty: Difficulty,
  ConfigClass: typeof Config = TestConfig,
): Promise<Game> {
  const nations = NATIONS.map(
    ([name, x, y], i) =>
      new Nation(
        new Cell(x, y),
        new PlayerInfo(name, PlayerType.Nation, null, `nation_${i}`),
      ),
  );
  const game = await setup(
    MAP,
    // Plenty of gold, so nations build ports, silos and SAMs, and send
    // boats, warships and nukes early.
    {
      difficulty,
      instantBuild: true,
      startingGold: 30_000_000,
      goldMultiplier: 20,
    },
    [],
    undefined,
    ConfigClass,
    false,
    nations,
  );
  for (const n of game.nations()) {
    game.addExecution(new NationExecution(GAME_ID, n));
  }
  // A dynamically created nation (not in game.nations(), no spawn cell),
  // as HumansVsNations makes: stored inline rather than by index.
  game.addExecution(
    new NationExecution(
      GAME_ID,
      new Nation(
        undefined,
        new PlayerInfo("Dynamic", PlayerType.Nation, null, "nation_dyn"),
      ),
    ),
  );
  // An idle human: nations only send emojis to humans.
  game.addExecution(
    new SpawnExecution(
      GAME_ID,
      new PlayerInfo("human", PlayerType.Human, "client_h", "human"),
      game.ref(1020, 180),
    ),
  );
  TRIBES.forEach(([x, y], i) => {
    const info = new PlayerInfo(
      `tribe${i}`,
      PlayerType.Bot,
      null,
      `tribe_${i}`,
    );
    game.addExecution(new SpawnExecution(GAME_ID, info, game.ref(x, y)));
  });
  return game;
}

function run(game: Game, ticks: number) {
  for (let i = 0; i < ticks; i++) game.executeNextTick();
}

function unitCount(game: Game, type: UnitType): number {
  return game.allPlayers().reduce((n, p) => n + p.units(type).length, 0);
}

describe("nation and tribe snapshots", () => {
  test("round-trips before init and during the spawn phase", async () => {
    const game = await nationGame(Difficulty.Hard);
    // Executions queued but not yet initialized.
    await expectSnapshotRoundTrip(game, MAP, 3);
    run(game, 5);
    await expectSnapshotRoundTrip(game, MAP, 10);
  }, 60_000);

  test("round-trips once behaviors run", async () => {
    const game = await nationGame(Difficulty.Hard);
    run(game, 15);
    game.endSpawnPhase();
    // Behaviors initialize on the first tick after the spawn phase.
    run(game, 3);
    await expectSnapshotRoundTrip(game, MAP, 20);
    run(game, 100);
    await expectSnapshotRoundTrip(game, MAP, 60);
  }, 60_000);

  test("round-trips a long impossible game", async () => {
    const game = await nationGame(Difficulty.Impossible, UseRealAttackLogic);
    run(game, 15);
    game.endSpawnPhase();
    for (const ticks of [200, 300, 300, 200, 200]) {
      run(game, ticks);
      await expectSnapshotRoundTrip(game, MAP, 50);
    }
    // The scenario reached the interesting states.
    expect(unitCount(game, UnitType.Port)).toBeGreaterThan(0);
    expect(unitCount(game, UnitType.MissileSilo)).toBeGreaterThan(0);
    expect(unitCount(game, UnitType.Warship)).toBeGreaterThan(0);
    expect(game.allPlayers().some((p) => !p.isAlive())).toBe(true);
  }, 300_000);
});
