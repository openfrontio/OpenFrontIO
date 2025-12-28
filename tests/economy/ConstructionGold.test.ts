import { ConstructionExecution } from "../../src/core/execution/ConstructionExecution";
import { NukeExecution } from "../../src/core/execution/NukeExecution";
import { SpawnExecution } from "../../src/core/execution/SpawnExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../../src/core/game/Game";
import { GameID } from "../../src/core/Schemas";
import { setup } from "../util/Setup";

describe("Construction economy", () => {
  let game: Game;
  const gameID: GameID = "game_id";
  let player: Player;
  let other: Player;
  const builderInfo = new PlayerInfo(
    "builder",
    PlayerType.Human,
    null,
    "builder_id",
  );
  const otherInfo = new PlayerInfo("other", PlayerType.Human, null, "other_id");

  beforeEach(async () => {
    game = await setup(
      "plains",
      {
        infiniteGold: false,
        instantBuild: false,
        infiniteTroops: true,
      },
      [builderInfo, otherInfo],
    );
    const spawn = game.ref(0, 10);
    game.addExecution(new SpawnExecution(gameID, builderInfo, spawn));
    game.addExecution(new SpawnExecution(gameID, otherInfo, spawn));
    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }
    player = game.player(builderInfo.id);
    other = game.player(otherInfo.id);
  });

  test("City charges gold once and no refund thereafter (allow passive income)", () => {
    const target = game.ref(0, 10);
    const cost = game.unitInfo(UnitType.City).cost(game, player);
    player.addGold(cost);
    expect(player.gold()).toBe(cost);

    const startTick = game.ticks();
    game.addExecution(new ConstructionExecution(player, UnitType.City, target));

    // First tick usually initializes the execution, second tick performs build and deduction
    game.executeNextTick();
    game.executeNextTick();
    const afterBuild = player.gold();
    const ticksAfterBuild = BigInt(game.ticks() - startTick);
    const passivePerTick = 100n; // DefaultConfig goldAdditionRate for humans
    expect(afterBuild < cost).toBe(true); // cost was deducted
    expect(afterBuild <= ticksAfterBuild * passivePerTick).toBe(true); // only passive income allowed

    // Advance through construction duration
    const duration = game.unitInfo(UnitType.City).constructionDuration ?? 0;
    for (let i = 0; i <= duration + 2; i++) game.executeNextTick();

    const finalGold = player.gold();
    const ticksElapsed = BigInt(game.ticks() - startTick);
    // Ensure no refund equal to cost snuck back in; only passive income accumulated
    expect(finalGold < cost).toBe(true);
    expect(finalGold <= ticksElapsed * passivePerTick).toBe(true);

    // Structure exists and is active
    expect(player.units(UnitType.City)).toHaveLength(1);
    expect(
      (player.units(UnitType.City)[0] as any).isUnderConstruction?.() ?? false,
    ).toBe(false);
  });

  test("MIRV gets more expensive with each launch", () => {
    expect(game.config().unitInfo(UnitType.MIRV).cost(game, other)).toBe(
      25_000_000n,
    );

    player.addGold(100_000_000n);

    player.conquer(game.ref(1, 1));
    player.buildUnit(UnitType.MissileSilo, game.ref(1, 1), {});

    other.conquer(game.ref(10, 10));
    game.addExecution(
      new NukeExecution(UnitType.MIRV, player, game.ref(10, 10)),
    );
    game.executeNextTick(); // init
    game.executeNextTick(); // create MIRV unit
    game.executeNextTick();

    expect(player.units(UnitType.MIRV)).toHaveLength(1);

    // Price of the MIRV increases for everyone with each launch.
    expect(game.config().unitInfo(UnitType.MIRV).cost(game, other)).toBe(
      40_000_000n,
    );
  });
});
