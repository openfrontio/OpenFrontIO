import { PlayerInfo, PlayerType } from "@openfront/engine-api/game/GameTypes";
import { GameID } from "@openfront/engine-api/Schemas";
import { GrantResourcesExecution } from "@openfront/engine/execution/GrantResourcesExecution";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import { describe, expect, it } from "vitest";
import { setup } from "./util/Setup";

const gameID: GameID = "game_id";

async function setupWithTarget() {
  const game = await setup("ocean_and_land", {
    infiniteGold: false,
    infiniteTroops: false,
  });
  const targetInfo = new PlayerInfo(
    "target",
    PlayerType.Human,
    null,
    "target_id",
  );
  game.addPlayer(targetInfo);
  const target = game.player(targetInfo.id);
  game.addExecution(new SpawnExecution(gameID, targetInfo, game.ref(0, 10)));
  game.executeNextTick();
  return { game, target };
}

describe("GrantResources", () => {
  it("grants both gold and troops to the target", async () => {
    const { game, target } = await setupWithTarget();

    const goldBefore = target.gold();
    const troopsBefore = target.troops();

    game.addExecution(new GrantResourcesExecution(target.id(), 5000, 1234));
    game.executeNextTick();
    game.executeNextTick();

    // 1 tick elapsed; PlayerExecution adds 100n passive income from workers.
    // Troops also grow every tick (population), so assert the delta, like
    // Donate.test.ts does.
    const passiveIncome = 100n;
    expect(target.gold()).toBe(goldBefore + 5000n + passiveIncome);
    expect(target.troops() - troopsBefore).toBeGreaterThanOrEqual(1234);
  });

  it("grants gold only when troops is null", async () => {
    const { game, target } = await setupWithTarget();

    const goldBefore = target.gold();

    game.addExecution(new GrantResourcesExecution(target.id(), 2500, null));
    game.executeNextTick();
    game.executeNextTick();

    const passiveIncome = 100n;
    expect(target.gold()).toBe(goldBefore + 2500n + passiveIncome);
    // Troops grow naturally every tick (population), so a natural-growth-only
    // delta can't be asserted exactly; the troops-only test covers granting.
  });

  it("grants troops only when gold is null", async () => {
    const { game, target } = await setupWithTarget();

    const goldBefore = target.gold();
    const troopsBefore = target.troops();

    game.addExecution(new GrantResourcesExecution(target.id(), null, 7500));
    game.executeNextTick();
    game.executeNextTick();

    const passiveIncome = 100n;
    expect(target.gold()).toBe(goldBefore + passiveIncome);
    expect(target.troops() - troopsBefore).toBeGreaterThanOrEqual(7500);
  });

  it("deactivates without crashing when the target is missing", async () => {
    const { game } = await setupWithTarget();

    const exec = new GrantResourcesExecution("missing_id", 1000, 1000);
    game.addExecution(exec);
    // Must not throw on init or tick.
    game.executeNextTick();
    game.executeNextTick();

    expect(exec.isActive()).toBe(false);
  });
});
