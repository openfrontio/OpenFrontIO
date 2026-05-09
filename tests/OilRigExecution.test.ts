import { vi } from "vitest";
import { ConstructionExecution } from "../src/core/execution/ConstructionExecution";
import { OilRigExecution } from "../src/core/execution/OilRigExecution";
import { TrainExecution } from "../src/core/execution/TrainExecution";
import { TrainStationExecution } from "../src/core/execution/TrainStationExecution";
import { UnitType } from "../src/core/game/Game";
import { TrainStation } from "../src/core/game/TrainStation";

function makeOilRigUnit(
  opts: {
    active?: boolean;
    underConstruction?: boolean;
    hasTrainStation?: boolean;
    tile?: number;
    owner?: any;
    level?: number;
  } = {},
): any {
  const owner = opts.owner ?? { name: "owner" };
  return {
    isActive: vi.fn(() => opts.active ?? true),
    isUnderConstruction: vi.fn(() => opts.underConstruction ?? false),
    hasTrainStation: vi.fn(() => opts.hasTrainStation ?? true),
    tile: vi.fn(() => opts.tile ?? 10),
    owner: vi.fn(() => owner),
    level: vi.fn(() => opts.level ?? 1),
    setTrainStation: vi.fn(),
    setUnderConstruction: vi.fn(),
    type: vi.fn(() => UnitType.OilRig),
  };
}

function makeFactoryUnit(opts: { tile?: number; owner?: any } = {}): any {
  const owner = opts.owner ?? { addGold: vi.fn() };
  return {
    tile: vi.fn(() => opts.tile ?? 20),
    owner: vi.fn(() => owner),
    type: vi.fn(() => UnitType.Factory),
    level: vi.fn(() => 1),
    fuel: vi.fn(() => 0),
    addFuel: vi.fn((amount: number) => Math.min(100, amount)),
  };
}

function makeOilRigGame(
  opts: {
    tick?: number;
    interval?: number;
    nearbyFactory?: boolean;
    sourceStation?: any | null;
    maxRange?: number;
  } = {},
) {
  const addedExecutions: unknown[] = [];
  const currentTick = { value: opts.tick ?? 0 };
  const mg = {
    ticks: vi.fn(() => currentTick.value),
    config: vi.fn(() => ({
      oilRigIncomeInterval: vi.fn(() => opts.interval ?? 5),
      trainStationMaxRange: vi.fn(() => opts.maxRange ?? 12),
    })),
    hasUnitNearby: vi.fn(() => opts.nearbyFactory ?? false),
    addExecution: vi.fn((execution: unknown) => {
      addedExecutions.push(execution);
    }),
    railNetwork: vi.fn(() => ({
      stationManager: vi.fn(() => ({
        findStation: vi.fn(() => opts.sourceStation ?? null),
      })),
    })),
  };

  return { mg, addedExecutions, currentTick };
}

describe("OilRigExecution", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("becomes inactive when the oil rig is no longer active", () => {
    const oilRig = makeOilRigUnit({ active: false });
    const execution = new OilRigExecution(oilRig);
    const { mg, addedExecutions } = makeOilRigGame();

    execution.init(mg as any, 0);
    execution.tick(0);

    expect(execution.isActive()).toBe(false);
    expect(addedExecutions).toHaveLength(0);
  });

  it("does nothing while the oil rig is under construction", () => {
    const oilRig = makeOilRigUnit({
      underConstruction: true,
      hasTrainStation: false,
    });
    const execution = new OilRigExecution(oilRig);
    const { mg, addedExecutions } = makeOilRigGame({
      tick: 0,
      nearbyFactory: true,
    });

    execution.init(mg as any, 0);
    execution.tick(0);

    expect(execution.isActive()).toBe(true);
    expect(addedExecutions).toHaveLength(0);
  });

  it("connects an oil rig to the rail network when a nearby factory exists", () => {
    const oilRig = makeOilRigUnit({ hasTrainStation: false });
    const execution = new OilRigExecution(oilRig);
    const { mg, addedExecutions } = makeOilRigGame({
      tick: 1,
      interval: 5,
      nearbyFactory: true,
    });

    execution.init(mg as any, 0);
    execution.tick(0);

    expect(addedExecutions).toHaveLength(1);
    expect(addedExecutions[0]).toBeInstanceOf(TrainStationExecution);
  });

  it("does not connect an oil rig to the rail network without a nearby factory", () => {
    const oilRig = makeOilRigUnit({ hasTrainStation: false });
    const execution = new OilRigExecution(oilRig);
    const { mg, addedExecutions } = makeOilRigGame({
      tick: 1,
      interval: 5,
      nearbyFactory: false,
    });

    execution.init(mg as any, 0);
    execution.tick(0);

    expect(addedExecutions).toHaveLength(0);
  });

  it("does not send an oil shipment before the income interval elapses", () => {
    const oilRig = makeOilRigUnit({ hasTrainStation: true });
    const execution = new OilRigExecution(oilRig);
    const destinationUnit = makeFactoryUnit();
    const destinationStation = { unit: destinationUnit };
    const cluster = {
      randomFuelDestination: vi.fn(() => destinationStation),
    };
    const sourceStation = {
      unit: oilRig,
      getCluster: vi.fn(() => cluster),
    };
    const { mg, addedExecutions } = makeOilRigGame({
      tick: 1,
      interval: 5,
      sourceStation,
    });

    execution.init(mg as any, 0);
    execution.tick(0);

    expect(addedExecutions).toHaveLength(0);
    expect(cluster.randomFuelDestination).not.toHaveBeenCalled();
  });

  it("does not send an oil shipment when the rig has no rail station", () => {
    const oilRig = makeOilRigUnit({ hasTrainStation: true });
    const execution = new OilRigExecution(oilRig);
    const { mg, addedExecutions } = makeOilRigGame({
      tick: 0,
      interval: 5,
      sourceStation: null,
    });

    execution.init(mg as any, 0);
    execution.tick(0);

    expect(addedExecutions).toHaveLength(0);
  });

  it("does not send an oil shipment when the rig is not connected to a rail cluster", () => {
    const oilRig = makeOilRigUnit({ hasTrainStation: true });
    const execution = new OilRigExecution(oilRig);
    const sourceStation = {
      unit: oilRig,
      getCluster: vi.fn(() => null),
    };
    const { mg, addedExecutions } = makeOilRigGame({
      tick: 0,
      interval: 5,
      sourceStation,
    });

    execution.init(mg as any, 0);
    execution.tick(0);

    expect(addedExecutions).toHaveLength(0);
  });

  it("does not send an oil shipment when the owner has no reachable factory destination", () => {
    const oilRigOwner = { id: "oil-owner" };
    const oilRig = makeOilRigUnit({
      hasTrainStation: true,
      owner: oilRigOwner,
    });
    const execution = new OilRigExecution(oilRig);
    const cluster = {
      randomFuelDestination: vi.fn(() => null),
    };
    const sourceStation = {
      unit: oilRig,
      getCluster: vi.fn(() => cluster),
    };
    const { mg, addedExecutions } = makeOilRigGame({
      tick: 0,
      interval: 5,
      sourceStation,
    });

    execution.init(mg as any, 0);
    execution.tick(0);

    expect(cluster.randomFuelDestination).toHaveBeenCalledWith(
      sourceStation,
      oilRigOwner,
    );
    expect(addedExecutions).toHaveLength(0);
  });

  it("sends an oil shipment to the nearest owned factory on the income interval", () => {
    const oilRigOwner = { id: "oil-owner" };
    const oilRig = makeOilRigUnit({
      hasTrainStation: true,
      owner: oilRigOwner,
    });
    const execution = new OilRigExecution(oilRig);
    const destinationUnit = makeFactoryUnit();
    const destinationStation = { unit: destinationUnit };
    const cluster = {
      randomFuelDestination: vi.fn(() => destinationStation),
    };
    const sourceStation = {
      unit: oilRig,
      getCluster: vi.fn(() => cluster),
    };
    const { mg, addedExecutions } = makeOilRigGame({
      tick: 0,
      interval: 5,
      sourceStation,
    });

    execution.init(mg as any, 0);
    execution.tick(0);

    expect(addedExecutions).toHaveLength(1);
    expect(addedExecutions[0]).toBeInstanceOf(TrainExecution);

    const freight = addedExecutions[0] as TrainExecution;
    expect(freight.owner()).toBe(oilRigOwner);
    expect(freight.sourceUnit()).toBe(oilRig);
    expect(freight.destinationUnit()).toBe(destinationUnit);
    expect(freight.trainMission()).toBe("freight");
  });
});

describe("Oil rig construction integration", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("schedules OilRigExecution when construction completes", () => {
    const owner = {};
    const structure = makeOilRigUnit({ owner });
    const queuedExecutions: unknown[] = [];
    const player = {
      canBuild: vi.fn(() => 10),
      buildUnit: vi.fn(() => structure),
    };
    const game = {
      config: vi.fn(() => ({
        isUnitDisabled: vi.fn(() => false),
      })),
      isValidRef: vi.fn(() => true),
      unitInfo: vi.fn(() => ({
        constructionDuration: 0,
      })),
      addExecution: vi.fn((execution: unknown) => {
        queuedExecutions.push(execution);
      }),
    };
    const execution = new ConstructionExecution(
      player as any,
      UnitType.OilRig,
      10 as any,
    );

    execution.init(game as any, 0);
    execution.tick(0);

    expect(player.canBuild).toHaveBeenCalledWith(UnitType.OilRig, 10);
    expect(player.buildUnit).toHaveBeenCalledWith(UnitType.OilRig, 10, {});
    expect(queuedExecutions).toHaveLength(1);
    expect(queuedExecutions[0]).toBeInstanceOf(OilRigExecution);
  });
});

describe("Oil rig fuel delivery", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fills a fueled structure when a freight train stops there", () => {
    const owner = {
      addGold: vi.fn(),
      isOnSameTeam: vi.fn(() => false),
      isAlliedWith: vi.fn(() => true),
    };
    const factory = makeFactoryUnit({ tile: 42, owner });
    const mg = {
      ticks: vi.fn(() => 0),
      config: vi.fn(() => ({
        fuelAllyGoldMultiplier: vi.fn(() => 0.5),
        trainGold: vi.fn(() => 10_000n),
      })),
      stats: vi.fn(() => ({
        trainExternalTrade: vi.fn(),
        trainSelfTrade: vi.fn(),
      })),
    };
    const station = new TrainStation(mg as any, factory);
    const trainExecution = {
      trainMission: vi.fn(() => "freight"),
      fuelRemaining: vi.fn(() => 300),
      deliverFuel: vi.fn(),
      owner: vi.fn(() => owner),
    };

    station.onTrainStop(trainExecution as any);

    expect(factory.addFuel).toHaveBeenCalledWith(300);
    expect(trainExecution.deliverFuel).toHaveBeenCalledWith(100);
    expect(owner.addGold).not.toHaveBeenCalled();
  });

  it("rewards the train owner when fuel is delivered to an ally", () => {
    const owner = {
      addGold: vi.fn(),
      isOnSameTeam: vi.fn(() => false),
      isAlliedWith: vi.fn(() => true),
    };
    const ally = {
      addGold: vi.fn(),
    };
    const factory = makeFactoryUnit({ tile: 42, owner: ally });
    const mg = {
      ticks: vi.fn(() => 0),
      config: vi.fn(() => ({
        fuelAllyGoldMultiplier: vi.fn(() => 0.5),
        trainGold: vi.fn(() => 10_000n),
      })),
      stats: vi.fn(() => ({
        trainExternalTrade: vi.fn(),
        trainSelfTrade: vi.fn(),
      })),
    };
    const station = new TrainStation(mg as any, factory);
    const trainExecution = {
      trainMission: vi.fn(() => "freight"),
      fuelRemaining: vi.fn(() => 300),
      deliverFuel: vi.fn(),
      owner: vi.fn(() => owner),
    };

    station.onTrainStop(trainExecution as any);

    expect(factory.addFuel).toHaveBeenCalledWith(300);
    expect(trainExecution.deliverFuel).toHaveBeenCalledWith(100);
    expect(owner.addGold).toHaveBeenCalledWith(5_000n, 42, "oil");
  });
});
