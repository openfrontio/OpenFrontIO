import {
  Cell,
  Difficulty,
  Nation,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import {
  Config,
  NukeMagnitude,
} from "@openfront/engine-lib/configuration/Config";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import { MissileSiloExecution } from "@openfront/engine/execution/MissileSiloExecution";
import { NationAllianceBehavior } from "@openfront/engine/execution/nation/NationAllianceBehavior";
import { NationEmojiBehavior } from "@openfront/engine/execution/nation/NationEmojiBehavior";
import { NationNukeBehavior } from "@openfront/engine/execution/nation/NationNukeBehavior";
import { NationExecution } from "@openfront/engine/execution/NationExecution";
import { SAMLauncherExecution } from "@openfront/engine/execution/SAMLauncherExecution";
import { AiAttackBehavior } from "@openfront/engine/execution/utils/AiAttackBehavior";
import { Game, Player } from "@openfront/engine/game/Game";
import { setup } from "./util/Setup";
import { TestConfig } from "./util/TestConfig";
import { executeTicks } from "./util/utils";

class RealNukeRadiusConfig extends TestConfig {
  nukeMagnitudes(unitType: UnitType): NukeMagnitude {
    return Config.prototype.nukeMagnitudes.call(this, unitType);
  }
}

function conquerRect(
  game: Game,
  player: Player,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
) {
  for (let x = x0; x < x1; x++) {
    for (let y = y0; y < y1; y++) {
      player.conquer(game.ref(x, y));
    }
  }
}

function sendNukes(game: Game, nation: Player) {
  const emojiBehavior = new NationEmojiBehavior(
    new PseudoRandom(1),
    game,
    nation,
  );
  const attackBehavior = new AiAttackBehavior(
    new PseudoRandom(1),
    game,
    nation,
    0.5,
    0.3,
    0.2,
    new NationAllianceBehavior(
      new PseudoRandom(1),
      game,
      nation,
      emojiBehavior,
    ),
    emojiBehavior,
  );
  new NationNukeBehavior(
    // Seed 2 doesn't roll a hydro-only nation
    new PseudoRandom(2),
    game,
    nation,
    attackBehavior,
    emojiBehavior,
  ).maybeSendNuke();
  // First tick initializes the NukeExecutions, the second launches the bombs
  game.executeNextTick();
  game.executeNextTick();
}

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

  it.each([
    [false, 2],
    [true, 0],
  ])(
    "only overwhelms a SAM whose blast would hit a third player if not allied with them (allied: %s)",
    async (allied, expectedBombs) => {
      const game = await setup(
        "big_plains",
        {
          difficulty: Difficulty.Impossible,
          // A SAM-only target is worth nothing to an atom bomb, so the nation falls back to overwhelming the SAM
          disabledUnits: [UnitType.HydrogenBomb],
        },
        [
          new PlayerInfo("nation", PlayerType.Nation, null, "nation_id"),
          new PlayerInfo("human", PlayerType.Human, null, "human_id"),
          new PlayerInfo("other", PlayerType.Nation, null, "other_id"),
        ],
        undefined,
        RealNukeRadiusConfig,
      );
      const nation = game.player("nation_id");
      const human = game.player("human_id");
      const other = game.player("other_id");

      conquerRect(game, nation, 0, 0, 15, 15);
      nation.buildUnit(UnitType.MissileSilo, game.ref(5, 5), {});
      nation.buildUnit(UnitType.MissileSilo, game.ref(10, 10), {});
      nation.addGold(10_000_000n);
      conquerRect(game, human, 130, 130, 170, 170);
      const samTile = game.ref(150, 150);
      human.buildUnit(UnitType.SAMLauncher, samTile, {});
      // 20 tiles from the SAM, inside the atom bomb's 30-tile blast
      conquerRect(game, other, 170, 130, 185, 170);
      nation.updateRelation(human, -100);
      if (allied) nation.createAllianceRequest(other)?.accept();

      sendNukes(game, nation);

      const atomBombs = nation.units(UnitType.AtomBomb);
      expect(atomBombs).toHaveLength(expectedBombs);
      for (const bomb of atomBombs) {
        expect(bomb.targetTile()).toBe(samTile);
      }
      expect(nation.isAlliedWith(other)).toBe(allied);
    },
  );
});
