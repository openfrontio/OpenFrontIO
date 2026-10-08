import { TileRef } from "@openfront/engine-api/game/GameMap";
import {
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { TrainExecution } from "@openfront/engine/execution/TrainExecution";
import { unpackMotionPlans } from "@openfront/engine-lib/game/MotionPlans";
import { Railroad } from "@openfront/engine/game/Railroad";
import { TrainStation } from "@openfront/engine/game/TrainStation";
import { describe, expect, it } from "vitest";
import { setup } from "../../util/Setup";

describe("TrainExecution", () => {
  it("stacks a 30% speed bonus per nearby Oil Mine for factory-origin trains", async () => {
    const game = await setup("plains", { instantBuild: true }, [
      new PlayerInfo("p1", PlayerType.Human, null, "p1"),
    ]);
    const player = game.player("p1")!;

    for (let t = 0; t <= 20; t++) player.conquer(t);

    const factory = player.buildUnit(UnitType.Factory, 0, {});
    player.buildUnit(UnitType.OilMine, 2, {});
    player.buildUnit(UnitType.OilMine, 4, {});
    const destination = player.buildUnit(UnitType.City, 20, {});

    const sourceStation = new TrainStation(game, factory);
    const destinationStation = new TrainStation(game, destination);
    const net = game.railNetwork();
    const stationManager = net.stationManager();
    stationManager.addStation(sourceStation);
    stationManager.addStation(destinationStation);

    const railroad = new Railroad(
      sourceStation,
      destinationStation,
      Array.from({ length: 21 }, (_, i) => i),
      1,
    );
    sourceStation.addRailroad(railroad);
    destinationStation.addRailroad(railroad);

    const exec = new TrainExecution(
      net,
      player,
      sourceStation,
      destinationStation,
      1,
    );
    exec.init(game, 0);

    const packed = game.drainPackedMotionPlans();
    expect(packed).not.toBeNull();
    expect(unpackMotionPlans(packed!)[0]).toMatchObject({
      speed: 3.2,
    });
  });

  it("re-resolves intermediate stations when railroad is split in transit", async () => {
    const game = await setup("plains", { instantBuild: true }, [
      new PlayerInfo("p1", PlayerType.Human, null, "p1"),
    ]);
    const player = game.player("p1")!;

    [0, 1, 2, 3, 4].forEach((t) => player.conquer(t));
    const [stationA, stationB, stationC, stationD1, stationD2] = [
      0, 1, 4, 2, 3,
    ].map(
      (t) => new TrainStation(game, player.buildUnit(UnitType.City, t, {})),
    );

    const net = game.railNetwork();
    const stationManager = net.stationManager();
    [stationA, stationB, stationC].forEach((s) => stationManager.addStation(s));

    const link = (
      a: TrainStation,
      b: TrainStation,
      tiles: TileRef[],
      id: number,
    ) => {
      const r = new Railroad(a, b, tiles, id);
      a.addRailroad(r);
      b.addRailroad(r);
      return r;
    };

    link(stationA, stationB, [0, 1], 1);
    const railBC = link(stationB, stationC, [1, 2, 2, 3, 3, 4], 2);

    const exec = new TrainExecution(net, player, stationA, stationC, 1);
    exec.init(game, 0);

    // Split edge B->C into B->D1, D1->D2, and D2->C while train is in transit
    stationB.removeRailroad(railBC);
    stationC.removeRailroad(railBC);
    stationManager.addStation(stationD1);
    stationManager.addStation(stationD2);
    link(stationB, stationD1, [1, 2], 3);
    link(stationD1, stationD2, [2, 3], 4);
    link(stationD2, stationC, [3, 4], 5);

    exec.tick(1);
    expect(exec.isActive()).toBe(true);
    exec.tick(2);
    expect(exec.isActive()).toBe(true);
    exec.tick(3);
    expect(exec.isActive()).toBe(true);
    exec.tick(4);
    expect(exec.isActive()).toBe(false);
  });

  it("rejects detour when railroad is rerouted off original motion plan", async () => {
    const game = await setup("plains", { instantBuild: true }, [
      new PlayerInfo("p1", PlayerType.Human, null, "p1"),
    ]);
    const player = game.player("p1")!;

    [0, 1, 2, 3, 4].forEach((t) => player.conquer(t));
    const [stationA, stationB, stationC, stationD] = [0, 1, 2, 4].map(
      (t) => new TrainStation(game, player.buildUnit(UnitType.City, t, {})),
    );

    const net = game.railNetwork();
    const stationManager = net.stationManager();
    [stationA, stationB, stationC].forEach((s) => stationManager.addStation(s));

    const link = (
      a: TrainStation,
      b: TrainStation,
      tiles: TileRef[],
      id: number,
    ) => {
      const r = new Railroad(a, b, tiles, id);
      a.addRailroad(r);
      b.addRailroad(r);
      return r;
    };

    link(stationA, stationB, [0, 1], 1);
    const railBC = link(stationB, stationC, [1, 3, 2], 2);

    const exec = new TrainExecution(net, player, stationA, stationC, 1);
    exec.init(game, 0);

    // Replace B->C with a detour through station D (tile 4, not on original path [0, 1, 1, 3, 2])
    stationB.removeRailroad(railBC);
    stationC.removeRailroad(railBC);
    stationManager.addStation(stationD);
    link(stationB, stationD, [1, 4], 3);
    link(stationD, stationC, [4, 2], 4);

    exec.tick(1);
    // At station B, the train attempts nextStation() but rejects the detour through tile 4
    expect(exec.isActive()).toBe(false);
  });

  it("re-resolves when intermediate station is placed off-track (adjacent building tile)", async () => {
    const game = await setup("plains", { instantBuild: true }, [
      new PlayerInfo("p1", PlayerType.Human, null, "p1"),
    ]);
    const player = game.player("p1")!;

    [0, 1, 2, 3, 4, 10].forEach((t) => player.conquer(t));
    // Station D is at tile 10 (adjacent off-track building tile, not in the railroad tile array)
    const [stationA, stationB, stationC, stationD] = [0, 1, 3, 10].map(
      (t) => new TrainStation(game, player.buildUnit(UnitType.City, t, {})),
    );

    const net = game.railNetwork();
    const stationManager = net.stationManager();
    [stationA, stationB, stationC].forEach((s) => stationManager.addStation(s));

    const link = (
      a: TrainStation,
      b: TrainStation,
      tiles: TileRef[],
      id: number,
    ) => {
      const r = new Railroad(a, b, tiles, id);
      a.addRailroad(r);
      b.addRailroad(r);
      return r;
    };

    link(stationA, stationB, [0, 1], 1);
    const railBC = link(stationB, stationC, [1, 2, 2, 3], 2);

    const exec = new TrainExecution(net, player, stationA, stationC, 1);
    exec.init(game, 0);

    // Split edge B->C into B->D [1, 2] and D->C [2, 3], where stationD.tile() = 10
    stationB.removeRailroad(railBC);
    stationC.removeRailroad(railBC);
    stationManager.addStation(stationD);
    link(stationB, stationD, [1, 2], 3);
    link(stationD, stationC, [2, 3], 4);

    exec.tick(1);
    expect(exec.isActive()).toBe(true);
    exec.tick(2);
    expect(exec.isActive()).toBe(true);
    exec.tick(3);
    expect(exec.isActive()).toBe(false);
  });

  it("rejects detour when only the final segment detours off motion plan", async () => {
    const game = await setup("plains", { instantBuild: true }, [
      new PlayerInfo("p1", PlayerType.Human, null, "p1"),
    ]);
    const player = game.player("p1")!;

    [0, 1, 2, 3, 9].forEach((t) => player.conquer(t));
    const [stationA, stationB, stationC, stationD] = [0, 1, 3, 2].map(
      (t) => new TrainStation(game, player.buildUnit(UnitType.City, t, {})),
    );

    const net = game.railNetwork();
    const stationManager = net.stationManager();
    [stationA, stationB, stationC].forEach((s) => stationManager.addStation(s));

    const link = (
      a: TrainStation,
      b: TrainStation,
      tiles: TileRef[],
      id: number,
    ) => {
      const r = new Railroad(a, b, tiles, id);
      a.addRailroad(r);
      b.addRailroad(r);
      return r;
    };

    link(stationA, stationB, [0, 1], 1);
    const railBC = link(stationB, stationC, [1, 2, 2, 3], 2);

    const exec = new TrainExecution(net, player, stationA, stationC, 1);
    exec.init(game, 0);

    // B->D uses planned tiles [1, 2], but D->C detours through tile 9 [2, 9, 3]
    stationB.removeRailroad(railBC);
    stationC.removeRailroad(railBC);
    stationManager.addStation(stationD);
    link(stationB, stationD, [1, 2], 3);
    link(stationD, stationC, [2, 9, 3], 4);

    exec.tick(1);
    // Rejects because final segment D->C uses unrecorded tile 9
    expect(exec.isActive()).toBe(false);
  });
});
