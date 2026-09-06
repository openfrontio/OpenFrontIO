import { describe, expect, it, vi } from "vitest";
import { TrainStationExecution } from "../../../src/core/execution/TrainStationExecution";
import { Game, Player, Unit } from "../../../src/core/game/Game";
import { TrainStation } from "../../../src/core/game/TrainStation";

function setupExecution(hasDestination = true) {
  const owner = {} as Player;
  const unit = {
    setTrainStation: vi.fn(),
    owner: () => owner,
  } as unknown as Unit;
  const destination = {} as TrainStation;
  const cluster = {
    hasAnyTradeDestination: vi.fn(() => hasDestination),
    randomTradeDestination: vi.fn(() => destination),
  };
  const station = {
    isActive: () => true,
    getCluster: () => cluster,
  } as unknown as TrainStation;
  const addExecution = vi.fn();
  const railNetwork = {} as ReturnType<Game["railNetwork"]>;
  const game = {
    ticks: () => 0,
    config: () => ({ trainSpawnIntervalTicks: () => 200 }),
    addExecution,
    railNetwork: () => railNetwork,
  } as unknown as Game;
  const execution = new TrainStationExecution(unit, true);
  execution.init(game, 0);
  (execution as unknown as { station: TrainStation }).station = station;
  return {
    execution,
    addExecution,
    cluster,
    enableDestination: () =>
      cluster.hasAnyTradeDestination.mockReturnValue(true),
  };
}

describe("TrainStationExecution deterministic cadence", () => {
  it("spawns one train every two hundred ticks", () => {
    const ctx = setupExecution();

    ctx.execution.tick(199);
    expect(ctx.addExecution).not.toHaveBeenCalled();
    ctx.execution.tick(200);
    expect(ctx.addExecution).toHaveBeenCalledOnce();
    ctx.execution.tick(399);
    expect(ctx.addExecution).toHaveBeenCalledOnce();
    ctx.execution.tick(400);
    expect(ctx.addExecution).toHaveBeenCalledTimes(2);
  });

  it("waits when due and launches as soon as a destination becomes available", () => {
    const ctx = setupExecution(false);

    ctx.execution.tick(200);
    expect(ctx.addExecution).not.toHaveBeenCalled();
    ctx.enableDestination();
    ctx.execution.tick(201);
    expect(ctx.addExecution).toHaveBeenCalledOnce();
    ctx.execution.tick(400);
    expect(ctx.addExecution).toHaveBeenCalledOnce();
    ctx.execution.tick(401);
    expect(ctx.addExecution).toHaveBeenCalledTimes(2);
  });
});
