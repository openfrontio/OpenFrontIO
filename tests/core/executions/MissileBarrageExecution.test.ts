import { describe, expect, it } from "vitest";
import { MissileBarrageExecution } from "../../../src/core/execution/MissileBarrageExecution";
import { NukeExecution } from "../../../src/core/execution/NukeExecution";
import { Game, Player, Unit, UnitType } from "../../../src/core/game/Game";

function setup(options?: { ready?: number; gold?: bigint; targets?: Unit[] }) {
  const silo = {
    isActive: () => true,
    isUnderConstruction: () => false,
    level: () => options?.ready ?? 5,
    missileTimerQueue: () => [],
  } as unknown as Unit;
  const attacker = {
    id: () => "attacker",
    isAlive: () => true,
    isOnSameTeam: () => false,
    gold: () => options?.gold ?? 10_000_000n,
    units: (type: UnitType) => (type === UnitType.MissileSilo ? [silo] : []),
  } as unknown as Player;
  const targets =
    options?.targets ??
    ([
      {
        id: () => 2,
        tile: () => 202,
        isActive: () => true,
        type: () => UnitType.Factory,
      },
      {
        id: () => 1,
        tile: () => 101,
        isActive: () => true,
        type: () => UnitType.City,
      },
    ] as unknown as Unit[]);
  const target = {
    id: () => "target",
    isAlive: () => true,
    units: (types: readonly UnitType[]) =>
      targets.filter((unit) => types.includes(unit.type())),
    tiles: () => new Set([101, 202]),
  } as unknown as Player;
  const added: NukeExecution[] = [];
  const game = {
    ticks: () => 50,
    player: () => target,
    config: () => ({ isUnitDisabled: () => false }),
    unitInfo: () => ({ cost: () => 750_000n }),
    addExecution: (execution: NukeExecution) => added.push(execution),
  } as unknown as Game;
  return { attacker, target, game, added };
}

describe("MissileBarrageExecution", () => {
  it("targets buildings deterministically and repeats round-robin", () => {
    const ctx = setup();
    const execution = new MissileBarrageExecution(
      ctx.attacker,
      "target",
      5,
      "all_buildings",
    );
    execution.init(ctx.game, 0);
    execution.tick(0);

    expect(ctx.added).toHaveLength(5);
    expect(ctx.added.every((nuke) => nuke instanceof NukeExecution)).toBe(true);
    expect(ctx.added.map((nuke) => (nuke as any).dst)).toEqual([
      101, 202, 101, 202, 101,
    ]);
  });

  it("reduces the launch to current affordability and readiness", () => {
    const ctx = setup({ ready: 5, gold: 1_500_000n });
    const execution = new MissileBarrageExecution(
      ctx.attacker,
      "target",
      20,
      "all_buildings",
    );
    execution.init(ctx.game, 0);
    execution.tick(0);
    expect(ctx.added).toHaveLength(2);
  });

  it("requires selected building types to resolve a target", () => {
    const ctx = setup();
    const execution = new MissileBarrageExecution(
      ctx.attacker,
      "target",
      5,
      "selected_types",
      [UnitType.MissileSilo],
    );
    execution.init(ctx.game, 0);
    execution.tick(0);
    expect(ctx.added).toHaveLength(0);
  });
});
