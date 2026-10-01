import { describe, expect, it, vi } from "vitest";
import { TrainExecution } from "../../../src/core/execution/TrainExecution";
import { PlayerInfo, PlayerType, UnitType } from "../../../src/core/game/Game";
import { TileRef } from "../../../src/core/game/GameMap";
import { Railroad } from "../../../src/core/game/Railroad";
import { TrainStation } from "../../../src/core/game/TrainStation";
import { setup } from "../../util/Setup";

async function currentSegmentFixture(
  splitIndex: number,
  reverseDirection = false,
) {
  const game = await setup("plains", { instantBuild: true }, [
    new PlayerInfo("p1", PlayerType.Human, null, "p1"),
  ]);
  const player = game.player("p1")!;
  const railTiles = [1, 2, 3, 4, 5, 6, 7, 8, 9] as TileRef[];
  railTiles.forEach((tile) => player.conquer(tile));

  const stationA = new TrainStation(
    game,
    player.buildUnit(UnitType.City, railTiles[0], {}),
  );
  const stationB = new TrainStation(
    game,
    player.buildUnit(UnitType.City, railTiles[railTiles.length - 1], {}),
  );
  const insertedStation = new TrainStation(
    game,
    player.buildUnit(UnitType.City, railTiles[splitIndex], {}),
  );

  const net = game.railNetwork();
  const stationManager = net.stationManager();
  stationManager.addStation(stationA);
  stationManager.addStation(stationB);

  const originalRailroad = new Railroad(stationA, stationB, railTiles, 1);
  stationA.addRailroad(originalRailroad);
  stationB.addRailroad(originalRailroad);

  const source = reverseDirection ? stationB : stationA;
  const destination = reverseDirection ? stationA : stationB;
  const exec = new TrainExecution(net, player, source, destination, 1);
  exec.init(game, 0);
  expect(exec.isActive()).toBe(true);

  const splitRail = () => {
    stationA.removeRailroad(originalRailroad);
    stationB.removeRailroad(originalRailroad);
    stationManager.addStation(insertedStation);

    const first = new Railroad(
      stationA,
      insertedStation,
      railTiles.slice(0, splitIndex),
      2,
    );
    const second = new Railroad(
      insertedStation,
      stationB,
      railTiles.slice(splitIndex),
      3,
    );
    stationA.addRailroad(first);
    insertedStation.addRailroad(first);
    insertedStation.addRailroad(second);
    stationB.addRailroad(second);
  };

  return { exec, insertedStation, player, splitRail };
}

describe("TrainExecution", () => {
  it("visits and pays a station inserted ahead of the engine", async () => {
    const { exec, insertedStation, player, splitRail } =
      await currentSegmentFixture(4);
    const onTrainStop = vi.spyOn(insertedStation, "onTrainStop");

    exec.tick(1);
    splitRail();
    exec.tick(2);

    expect(exec.isActive()).toBe(true);
    expect(onTrainStop).toHaveBeenCalledTimes(1);
    expect(player.trainGold()).toBe(10_000n);
  });

  it("does not visit or pay a station inserted behind the engine", async () => {
    const { exec, insertedStation, player, splitRail } =
      await currentSegmentFixture(3);
    const onTrainStop = vi.spyOn(insertedStation, "onTrainStop");

    exec.tick(1);
    exec.tick(2);
    splitRail();
    exec.tick(3);

    expect(exec.isActive()).toBe(true);
    expect(onTrainStop).not.toHaveBeenCalled();
    expect(player.trainGold()).toBe(0n);
  });

  it("visits and pays a station inserted exactly at the engine once", async () => {
    const { exec, insertedStation, player, splitRail } =
      await currentSegmentFixture(2);
    const onTrainStop = vi.spyOn(insertedStation, "onTrainStop");

    exec.tick(1);
    splitRail();
    exec.tick(2);
    exec.tick(3);

    expect(onTrainStop).toHaveBeenCalledTimes(1);
    expect(player.trainGold()).toBe(10_000n);
  });

  it("does not revisit a passed station while travelling in reverse", async () => {
    const { exec, insertedStation, player, splitRail } =
      await currentSegmentFixture(3, true);
    const onTrainStop = vi.spyOn(insertedStation, "onTrainStop");

    exec.tick(1);
    exec.tick(2);
    exec.tick(3);
    splitRail();
    exec.tick(4);

    expect(exec.isActive()).toBe(true);
    expect(onTrainStop).not.toHaveBeenCalled();
    expect(player.trainGold()).toBe(0n);
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
