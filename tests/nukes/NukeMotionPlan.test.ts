import { ConstructionExecution } from "../../src/core/execution/ConstructionExecution";
import { NukeExecution } from "../../src/core/execution/NukeExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  Unit,
  UnitType,
} from "../../src/core/game/Game";
import { TileRef } from "../../src/core/game/GameMap";
import { GameUpdateType, UnitUpdate } from "../../src/core/game/GameUpdates";
import {
  GridPathPlan,
  unpackMotionPlans,
} from "../../src/core/game/MotionPlans";
import { setup } from "../util/Setup";

describe("Nuke motion plan", () => {
  let game: Game;
  let player: Player;
  const info = new PlayerInfo("p", PlayerType.Human, null, "p");

  beforeEach(async () => {
    game = await setup("plains", { infiniteGold: true, instantBuild: true }, [
      info,
    ]);
    player = game.player(info.id);
    player.conquer(game.ref(1, 1));
    game.addExecution(
      new ConstructionExecution(player, UnitType.MissileSilo, game.ref(1, 1)),
    );
    game.executeNextTick();
    game.executeNextTick();
    expect(player.units(UnitType.MissileSilo)).toHaveLength(1);
    game.drainPackedMotionPlans();
  });

  function buildNuke(): Unit {
    for (
      let i = 0;
      i < 10 && player.units(UnitType.AtomBomb).length === 0;
      i++
    ) {
      game.executeNextTick();
    }
    const nukes = player.units(UnitType.AtomBomb);
    expect(nukes).toHaveLength(1);
    return nukes[0];
  }

  function drainGridPlan(unitId: number): GridPathPlan {
    const packed = game.drainPackedMotionPlans();
    expect(packed).not.toBeNull();
    const plan = unpackMotionPlans(packed!).find(
      (r): r is GridPathPlan => r.kind === "grid" && r.unitId === unitId,
    );
    expect(plan).toBeDefined();
    return plan!;
  }

  // game.ticks() after executeNextTick() matches the tick the client receives
  // for that update batch (GameRunner reads ticks() post-increment), so this
  // mirrors GameView.advanceMotionPlannedUnits exactly.
  function expectedTile(plan: GridPathPlan, tick: number): TileRef {
    const dt = tick - plan.startTick;
    const stepIndex =
      dt <= 0 ? 0 : Math.floor(dt / Math.max(1, plan.ticksPerStep));
    const idx = Math.max(0, Math.min(plan.path.length - 1, stepIndex));
    return plan.path[idx] as TileRef;
  }

  test("records a grid plan matching the nuke's per-tick positions", () => {
    game.addExecution(
      new ConstructionExecution(player, UnitType.AtomBomb, game.ref(80, 80)),
    );
    const nuke = buildNuke();
    const plan = drainGridPlan(nuke.id());

    expect(plan.ticksPerStep).toBe(1);
    expect(plan.startTick).toBe(game.ticks());
    expect(plan.path[0]).toBe(nuke.tile());
    expect(plan.path.length).toBeGreaterThan(2);

    let moveTicks = 0;
    for (let i = 0; i < 10_000 && nuke.isActive(); i++) {
      const lastTile = nuke.tile();
      game.executeNextTick();
      if (!nuke.isActive()) break;
      expect(nuke.tile()).toBe(expectedTile(plan, game.ticks()));
      if (nuke.tile() !== lastTile) moveTicks++;
    }
    expect(nuke.isActive()).toBe(false);
    expect(moveTicks).toBeGreaterThan(2);
  });

  test("plan start accounts for waitTicks", () => {
    const waitTicks = 5;
    game.addExecution(
      new NukeExecution(
        UnitType.AtomBomb,
        player,
        game.ref(80, 80),
        null,
        -1,
        waitTicks,
      ),
    );
    const nuke = buildNuke();
    const spawn = nuke.tile();
    const plan = drainGridPlan(nuke.id());

    expect(plan.startTick).toBe(game.ticks() + waitTicks);

    for (let i = 0; i < 10_000 && nuke.isActive(); i++) {
      game.executeNextTick();
      if (!nuke.isActive()) break;
      if (i < waitTicks) {
        expect(nuke.tile()).toBe(spawn);
      }
      expect(nuke.tile()).toBe(expectedTile(plan, game.ticks()));
    }
    expect(nuke.isActive()).toBe(false);
  });

  test("does not emit per-tick unit updates while in flight", () => {
    game.addExecution(
      new ConstructionExecution(player, UnitType.AtomBomb, game.ref(80, 80)),
    );
    const nuke = buildNuke();
    let lastTargetable = nuke.isTargetable();

    for (let i = 0; i < 10_000 && nuke.isActive(); i++) {
      const updates = game.executeNextTick();
      const nukeUpdates = (updates[GameUpdateType.Unit] as UnitUpdate[]).filter(
        (u) => u.id === nuke.id(),
      );
      for (const u of nukeUpdates) {
        // Moves are plan-driven; only deletion and targetable flips may emit.
        expect(u.isActive === false || u.targetable !== lastTargetable).toBe(
          true,
        );
        lastTargetable = u.targetable;
      }
    }
    expect(nuke.isActive()).toBe(false);
  });
});
