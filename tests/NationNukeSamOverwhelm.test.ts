import { MissileSiloExecution } from "../src/core/execution/MissileSiloExecution";
import { NationExecution } from "../src/core/execution/NationExecution";
import { SAMLauncherExecution } from "../src/core/execution/SAMLauncherExecution";
import {
  Cell,
  Difficulty,
  Nation,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import { setup } from "./util/Setup";
import { executeTicks } from "./util/utils";

describe("NationNukeBehavior - maybeDestroyEnemySam", () => {
  test("nation overwhelms enemy SAM with atom bomb salvo on Impossible difficulty", async () => {
    // Impossible difficulty with 2 players forces findBestNukeTarget to
    // return the human. The SAM covers all human territory so every nuke
    // trajectory is interceptable, keeping bestValue ≤ 0 and triggering
    // maybeDestroyEnemySam.
    const game = await setup("big_plains", {
      difficulty: Difficulty.Impossible,
      infiniteGold: true,
      instantBuild: true,
    });

    const nationInfo = new PlayerInfo(
      "nation",
      PlayerType.Nation,
      null,
      "nation_id",
    );
    const humanInfo = new PlayerInfo(
      "human",
      PlayerType.Human,
      null,
      "human_id",
    );

    game.addPlayer(nationInfo);
    game.addPlayer(humanInfo);

    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }

    const nation = game.player("nation_id");
    const human = game.player("human_id");

    // Assign territory blocks (30×30 each, well separated)
    for (let x = 10; x < 40; x++) {
      for (let y = 10; y < 40; y++) {
        const tile = game.ref(x, y);
        if (game.map().isLand(tile)) nation.conquer(tile);
      }
    }
    for (let x = 60; x < 90; x++) {
      for (let y = 60; y < 90; y++) {
        const tile = game.ref(x, y);
        if (game.map().isLand(tile)) human.conquer(tile);
      }
    }

    // Level-1 SAM at center of human territory (samRange = 20 in TestConfig,
    // covering the entire 60-90 block and intercepting all trajectories).
    const samTile = game.ref(75, 75);
    const sam = human.buildUnit(UnitType.SAMLauncher, samTile, {});
    game.addExecution(new SAMLauncherExecution(human, null, sam));

    // 3 level-1 missile silos (1 slot each). Overwhelming a level-1 SAM
    // requires 2 bombs (1 intercepted + 1 passes through).
    for (const [x, y] of [
      [20, 20],
      [25, 25],
      [30, 30],
    ] as const) {
      const silo = nation.buildUnit(UnitType.MissileSilo, game.ref(x, y), {});
      game.addExecution(new MissileSiloExecution(silo));
    }

    // infiniteGold only applies to Human players, so the nation needs gold
    nation.addGold(1_000_000_000n);
    nation.addTroops(100_000);
    human.addTroops(100_000);

    expect(nation.units(UnitType.MissileSilo)).toHaveLength(3);
    expect(human.units(UnitType.SAMLauncher)).toHaveLength(1);
    expect(nation.units(UnitType.AtomBomb)).toHaveLength(0);

    // Try multiple game IDs to account for random attack-tick alignment
    // (attackRate ∈ [30,50] on Impossible). 150 inner ticks guarantees ≥2
    // attack ticks for the worst-case seed: 1st initializes behaviors, 2nd
    // fires maybeSendNuke → maybeDestroyEnemySam.
    const testNation = new Nation(new Cell(25, 25), nation.info());
    let salvoLaunched = false;

    for (let i = 0; i < 10 && !salvoLaunched; i++) {
      // Let any executions from a prior iteration settle
      if (i > 0) executeTicks(game, 50);

      const exec = new NationExecution(`game_${i}`, testNation);
      exec.init(game);

      for (let tick = 0; tick < 150; tick++) {
        exec.tick(tick);
        // Advance the game sparingly so NukeExecution creates atom-bomb units
        // but they don't complete their flight before we detect them.
        if (tick % 10 === 0) game.executeNextTick();

        if (nation.units(UnitType.AtomBomb).length > 0) {
          salvoLaunched = true;
          break;
        }
      }
    }

    expect(salvoLaunched).toBe(true);

    // At least 2 atom bombs to overwhelm the level-1 SAM
    const atomBombs = nation.units(UnitType.AtomBomb);
    expect(atomBombs.length).toBeGreaterThanOrEqual(2);

    // All bombs should target the SAM tile
    for (const bomb of atomBombs) {
      expect(bomb.targetTile()).toBe(samTile);
    }
  });
});
