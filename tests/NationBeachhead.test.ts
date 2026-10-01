import { AttackExecution } from "../src/core/execution/AttackExecution";
import { NationAllianceBehavior } from "../src/core/execution/nation/NationAllianceBehavior";
import { NationEmojiBehavior } from "../src/core/execution/nation/NationEmojiBehavior";
import { NationWarshipBehavior } from "../src/core/execution/nation/NationWarshipBehavior";
import { TransportShipExecution } from "../src/core/execution/TransportShipExecution";
import { AiAttackBehavior } from "../src/core/execution/utils/AiAttackBehavior";
import {
  Difficulty,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import { PseudoRandom } from "../src/core/PseudoRandom";
import { createGame, L, W } from "./core/pathfinding/_fixtures";
import { setup } from "./util/Setup";

// ocean_and_land: land at x <= 7, open water, and a small island at x >= 14.
describe("Nation beachhead boats", () => {
  async function setupBeachhead(
    difficulty: Difficulty,
    islandType: PlayerType = PlayerType.Nation,
  ) {
    const game = await setup("ocean_and_land", { difficulty }, [
      new PlayerInfo("nation", PlayerType.Nation, null, "nation_id"),
      new PlayerInfo("island", islandType, null, "island_id"),
      new PlayerInfo("navy", PlayerType.Human, null, "navy_id"),
      new PlayerInfo("rival", PlayerType.Nation, null, "rival_id"),
    ]);
    const nation = game.player("nation_id");
    const island = game.player("island_id");
    game.map().forEachTile((tile) => {
      if (!game.map().isLand(tile)) return;
      (game.x(tile) <= 7 ? nation : island).conquer(tile);
    });
    nation.setTroops(100_000);
    island.setTroops(10_000);
    const random = new PseudoRandom(42);
    const emoji = new NationEmojiBehavior(random, game, nation);
    const behavior = new AiAttackBehavior(
      random,
      game,
      nation,
      0, // triggerRatio
      0, // reserveRatio
      0, // expandRatio
      new NationAllianceBehavior(random, game, nation, emoji),
      emoji,
      new NationWarshipBehavior(random, game, nation, emoji),
    );
    const spy = vi.spyOn(game, "addExecution");
    const executions = () => spy.mock.calls.map((c) => c[0]);
    const attacks = (fromBoat: boolean, targetID = island.id()) =>
      executions().filter(
        (e) =>
          e instanceof AttackExecution &&
          e.targetID() === targetID &&
          (e["sourceTile"] !== null) === fromBoat,
      );
    return { game, nation, island, behavior, executions, attacks };
  }

  it("Hard attacks by land the tick after its beachhead boat lands", async () => {
    const { game, island, behavior, executions, attacks } =
      await setupBeachhead(Difficulty.Hard);
    expect(behavior.sendAttack(island)).toBe(true);
    const boats = executions().filter(
      (e) => e instanceof TransportShipExecution,
    );
    expect(boats.map((e) => e["troops"])).toEqual([1_000]);

    let landedAt = -1;
    let followedAt = -1;
    for (let i = 0; i < 50 && followedAt < 0; i++) {
      game.executeNextTick();
      if (landedAt < 0 && attacks(true).length > 0) landedAt = i;
      behavior.followUpLandings();
      if (attacks(false).length > 0) followedAt = i;
    }
    expect(landedAt).toBeGreaterThan(0);
    expect(followedAt).toBe(landedAt);
    const [followUp] = attacks(false) as AttackExecution[];
    // Everything left at home goes in: the reserve ratio is 0 here
    expect(followUp["startTroops"]).toBe(99_000);
  });

  it("makes no land attack when its boat sinks", async () => {
    const { game, nation, island, behavior, attacks } = await setupBeachhead(
      Difficulty.Impossible,
    );
    expect(behavior.sendAttack(island)).toBe(true);
    game.executeNextTick();
    const [boat] = nation.units(UnitType.TransportShip);
    boat.delete(false, game.player("navy_id"));
    for (let i = 0; i < 20; i++) {
      game.executeNextTick();
      behavior.followUpLandings();
    }
    expect(attacks(true)).toHaveLength(0);
    expect(attacks(false)).toHaveLength(0);
  });

  it("keeps the landing tile but attacks nobody when someone else took that coast", async () => {
    const { game, nation, island, behavior, attacks } = await setupBeachhead(
      Difficulty.Hard,
    );
    const rival = game.player("rival_id");
    rival.setTroops(10_000);
    expect(behavior.sendAttack(island)).toBe(true);
    game.executeNextTick();
    for (const tile of [...island.tiles()]) rival.conquer(tile);
    for (let i = 0; i < 50; i++) {
      game.executeNextTick();
      behavior.followUpLandings();
    }
    expect(attacks(true)).toHaveLength(1);
    expect(attacks(false)).toHaveLength(0);
    expect(attacks(false, rival.id())).toHaveLength(0);
    expect([...nation.tiles()].some((t) => game.x(t) >= 14)).toBe(true);
  });

  it("Hard lands a beachhead on a bot island too", async () => {
    const { island, behavior, executions } = await setupBeachhead(
      Difficulty.Hard,
      PlayerType.Bot,
    );
    expect(behavior.sendAttack(island)).toBe(true);
    const boats = executions().filter(
      (e) => e instanceof TransportShipExecution,
    );
    expect(boats.map((e) => e["troops"])).toEqual([1_000]);
  });

  it("Medium still boats a fifth of its troops", async () => {
    const { island, behavior, executions } = await setupBeachhead(
      Difficulty.Medium,
    );
    expect(behavior.sendAttack(island)).toBe(true);
    const boats = executions().filter(
      (e) => e instanceof TransportShipExecution,
    );
    expect(boats.map((e) => e["troops"])).toEqual([20_000]);
  });
});

// Our land at x <= 4, a 4-tile strait, unowned land at x >= 9
describe("Nation beachheads on unowned land", () => {
  it.each([
    [Difficulty.Hard, 1_000],
    [Difficulty.Medium, 20_000],
  ])("%s boats %i troops across the strait", (difficulty, troops) => {
    const width = 16;
    const height = 8;
    const grid: string[] = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) grid.push(x <= 4 || x >= 9 ? L : W);
    }
    const game = createGame({ width, height, grid }, { difficulty });
    game.addPlayer(
      new PlayerInfo("nation", PlayerType.Nation, null, "nation_id"),
    );
    const nation = game.player("nation_id");
    game.map().forEachTile((tile) => {
      if (game.map().isLand(tile) && game.x(tile) <= 4) nation.conquer(tile);
    });
    nation.setTroops(100_000);
    const random = new PseudoRandom(42);
    const emoji = new NationEmojiBehavior(random, game, nation);
    const behavior = new AiAttackBehavior(
      random,
      game,
      nation,
      0,
      0,
      0,
      new NationAllianceBehavior(random, game, nation, emoji),
      emoji,
      new NationWarshipBehavior(random, game, nation, emoji),
    );
    const spy = vi.spyOn(game, "addExecution");
    expect(behavior.sendAttack(game.terraNullius())).toBe(true);
    const boats = spy.mock.calls
      .map((c) => c[0])
      .filter((e) => e instanceof TransportShipExecution);
    expect(boats.map((e) => e["troops"])).toEqual([troops]);
  });
});
