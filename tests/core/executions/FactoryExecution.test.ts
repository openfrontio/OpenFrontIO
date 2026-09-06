import { describe, expect, it, vi } from "vitest";
import { FactoryExecution } from "../../../src/core/execution/FactoryExecution";
import { Game, Player, Unit } from "../../../src/core/game/Game";

function setupExecution() {
  const firstOwner = {
    addGold: vi.fn(),
    addTrainGold: vi.fn(),
  } as unknown as Player;
  const secondOwner = {
    addGold: vi.fn(),
    addTrainGold: vi.fn(),
  } as unknown as Player;
  let owner = firstOwner;
  let underConstruction = false;
  let connections = 3;
  const factory = {
    id: () => 0,
    isActive: () => true,
    isUnderConstruction: () => underConstruction,
    owner: () => owner,
    level: () => 2,
    tile: () => 42,
    hasTrainStation: () => false,
    setTrainStation: vi.fn(),
  } as unknown as Unit;
  const station = {
    getRailroads: () =>
      new Set(Array.from({ length: connections }, () => ({}))),
  };
  const factoryGold = vi.fn(() => 1_250n);
  const trainSelfTrade = vi.fn();
  const game = {
    nearbyUnits: vi.fn(() => []),
    addExecution: vi.fn(),
    config: () => ({ trainStationMaxRange: () => 110, factoryGold }),
    railNetwork: () => ({
      stationManager: () => ({ findStation: () => station }),
    }),
    stats: () => ({ trainSelfTrade }),
  } as unknown as Game;
  const execution = new FactoryExecution(factory);
  execution.init(game, 0);
  return {
    execution,
    factoryGold,
    firstOwner,
    secondOwner,
    trainSelfTrade,
    capture: () => (owner = secondOwner),
    setConnections: (value: number) => (connections = value),
    setUnderConstruction: (value: boolean) => (underConstruction = value),
  };
}

describe("FactoryExecution deterministic production", () => {
  it("pays exactly once per ten ticks using live level and connections", () => {
    const ctx = setupExecution();

    ctx.execution.tick(9);
    expect(ctx.firstOwner.addGold).not.toHaveBeenCalled();
    ctx.execution.tick(10);
    ctx.execution.tick(11);

    expect(ctx.factoryGold).toHaveBeenCalledOnce();
    expect(ctx.factoryGold).toHaveBeenCalledWith(2, 3, ctx.firstOwner);
    expect(ctx.firstOwner.addGold).toHaveBeenCalledWith(1_250n, 42);
    expect(ctx.firstOwner.addTrainGold).toHaveBeenCalledWith(1_250n);
    expect(ctx.trainSelfTrade).toHaveBeenCalledWith(ctx.firstOwner, 1_250n);
  });

  it("credits the current owner after capture", () => {
    const ctx = setupExecution();
    ctx.execution.tick(10);
    ctx.capture();
    ctx.execution.tick(20);

    expect(ctx.secondOwner.addGold).toHaveBeenCalledWith(1_250n, 42);
    expect(ctx.secondOwner.addTrainGold).toHaveBeenCalledWith(1_250n);
  });

  it("uses live rail topology and skips unfinished factories", () => {
    const ctx = setupExecution();
    ctx.setUnderConstruction(true);
    ctx.execution.tick(10);
    expect(ctx.factoryGold).not.toHaveBeenCalled();

    ctx.setUnderConstruction(false);
    ctx.setConnections(1);
    ctx.execution.tick(20);
    ctx.setConnections(4);
    ctx.execution.tick(30);

    expect(ctx.factoryGold).toHaveBeenNthCalledWith(1, 2, 1, ctx.firstOwner);
    expect(ctx.factoryGold).toHaveBeenNthCalledWith(2, 2, 4, ctx.firstOwner);
  });
});
