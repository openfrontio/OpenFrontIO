import {
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { wouldNukeCauseBetrayal } from "@openfront/engine-lib/execution/NukeAlliance";
import { Executor } from "@openfront/engine/execution/ExecutionManager";
import { Game, Player, Unit } from "@openfront/engine/game/Game";
import { setup } from "./util/Setup";
import { expectSnapshotRoundTrip } from "./util/Snapshot";
import { executeTicks } from "./util/utils";

const NUKES = [UnitType.AtomBomb, UnitType.HydrogenBomb, UnitType.MIRV];

describe("nuclear betrayal protection", () => {
  let game: Game;
  let player: Player;
  let ally: Player;
  let silo: Unit;
  let target: number;

  beforeEach(async () => {
    game = await setup("plains", { instantBuild: true }, [
      new PlayerInfo("player", PlayerType.Human, "c1", "p1"),
      new PlayerInfo("ally", PlayerType.Human, "c2", "p2"),
    ]);
    player = game.player("p1");
    ally = game.player("p2");
    player.conquer(game.ref(0, 0));
    target = game.ref(70, 70);
    ally.conquer(target);
    player.addGold(1_000_000_000n);
    ally.addGold(1_000_000_000n);
    silo = player.buildUnit(UnitType.MissileSilo, game.ref(0, 0), {});
    ally.buildUnit(UnitType.City, target, {});
    player.createAllianceRequest(ally)!.accept();
  });

  function launch(unit: UnitType, preventBetrayal?: boolean, amount?: number) {
    game.addExecution(
      new Executor(game, "game_id", "c1").createExec({
        type: "build_unit",
        clientID: "c1",
        unit,
        tile: target,
        preventBetrayal,
        amount,
      }),
    );
  }

  test.each(NUKES)(
    "blocks %s before charging or changing alliances",
    (unit) => {
      const gold = player.gold();
      const cooldown = [...silo.missileTimerQueue()];
      const relation = ally.relation(player);
      launch(unit, true, 3);
      executeTicks(game, 3);

      expect(player.units(unit)).toHaveLength(0);
      expect(player.gold()).toBe(gold);
      expect(silo.missileTimerQueue()).toEqual(cooldown);
      expect(ally.relation(player)).toBe(relation);
      expect(player.isAlliedWith(ally)).toBe(true);
      expect(player.isTraitor()).toBe(false);
    },
  );

  test.each(NUKES)("keeps unprotected %s launches unchanged", (unit) => {
    launch(unit);
    executeTicks(game, 3);

    expect(player.units(unit)).toHaveLength(1);
    expect(player.isAlliedWith(ally)).toBe(false);
    expect(player.isTraitor()).toBe(true);
  });

  test.each(NUKES)(
    "rechecks alliances when a queued %s is processed",
    (unit) => {
      player.removeAllAlliances();
      launch(unit, true, 3);
      executeTicks(game, 2);
      player.createAllianceRequest(ally)!.accept();
      game.executeNextTick();

      expect(player.units(unit)).toHaveLength(0);
      expect(player.isAlliedWith(ally)).toBe(true);
      expect(player.isTraitor()).toBe(false);
    },
  );

  test.each(NUKES)("allows %s against a disconnected ally", (unit) => {
    ally.markDisconnected(true);
    launch(unit, true);
    executeTicks(game, 3);

    expect(player.units(unit)).toHaveLength(1);
    expect(player.isAlliedWith(ally)).toBe(false);
    expect(player.isTraitor()).toBe(false);
  });

  test.each(NUKES)(
    "allows %s against an ally who is already a traitor",
    (unit) => {
      ally.markTraitor();
      launch(unit, true);
      executeTicks(game, 3);

      expect(player.units(unit)).toHaveLength(1);
      expect(player.isAlliedWith(ally)).toBe(false);
      expect(player.isTraitor()).toBe(false);
    },
  );

  test("prevents renewing the launcher's betrayal debuff", () => {
    player.markTraitor();
    const betrayals = player.betrayals();
    launch(UnitType.AtomBomb, true);
    executeTicks(game, 3);

    expect(player.units(UnitType.AtomBomb)).toHaveLength(0);
    expect(player.betrayals()).toBe(betrayals);
    expect(player.isAlliedWith(ally)).toBe(true);
  });

  test("MIRV protection checks its target player, not nearby allied structures", () => {
    const targetTile = game.ref(69, 70);
    expect(
      wouldNukeCauseBetrayal({
        game,
        player,
        targetTile,
        unitType: UnitType.MIRV,
      }),
    ).toBe(false);
    expect(
      wouldNukeCauseBetrayal({
        game,
        player,
        targetTile,
        unitType: UnitType.AtomBomb,
      }),
    ).toBe(true);
  });

  test.each(NUKES)(
    "preserves protection for pending and queued %s snapshots",
    async (unit) => {
      launch(unit, true, 3);
      await expectSnapshotRoundTrip(game, "plains", 2);
      await expectSnapshotRoundTrip(game, "plains", 1);

      expect(player.units(unit)).toHaveLength(0);
      expect(player.isAlliedWith(ally)).toBe(true);
      expect(player.isTraitor()).toBe(false);
    },
  );
});
