import { describe, expect, it } from "vitest";
import { TrainExecution } from "../../../src/core/execution/TrainExecution";
import {
  Game,
  PlayerInfo,
  PlayerType,
  TrainType,
  UnitType,
} from "../../../src/core/game/Game";
import { TileRef } from "../../../src/core/game/GameMap";
import { Railroad } from "../../../src/core/game/Railroad";
import { TrainStation } from "../../../src/core/game/TrainStation";
import { setup } from "../../util/Setup";

/** The leading engine: the unit whose tile is the train's position. */
function engineTile(game: Game): TileRef {
  const engine = game
    .units(UnitType.Train)
    .find((u) => u.trainType() === TrainType.Engine);
  expect(engine).toBeDefined();
  return engine!.tile();
}

describe("TrainExecution", () => {
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
    expect(exec.tradeStopsVisited()).toBe(4);
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

  // The route is walked 1, 2, 3, 5, 7 whatever tick the split lands on, so the
  // split timing only decides how much of it has been travelled by then. The
  // recovery has to carry `currentTile` onto the segment holding the train
  // rather than restarting it at the front of the reconstructed route -- a
  // rewind would show up as a repeat of a tile already left behind.
  //
  // The trade stop count follows from how many junctions are still ahead when
  // the split lands: on tick 2 the train is on D1's tile, so D2 is still ahead
  // of it and is credited; from tick 3 on, both new junctions are behind it and
  // passing them is not a stop.
  it.each([
    [2, 3],
    [3, 2],
    [4, 2],
    [5, 2],
  ])(
    "keeps the train's position when the split lands on tick %i",
    async (splitAt, expectedTradeStops) => {
      const game = await setup("plains", { instantBuild: true }, [
        new PlayerInfo("p1", PlayerType.Human, null, "p1"),
      ]);
      const player = game.player("p1")!;

      [0, 1, 2, 3, 4, 5, 6, 7, 8].forEach((t) => player.conquer(t));
      const [stationA, stationB, stationC, stationD1, stationD2] = [
        0, 1, 8, 2, 3,
      ].map(
        (t) => new TrainStation(game, player.buildUnit(UnitType.City, t, {})),
      );

      const net = game.railNetwork();
      const stationManager = net.stationManager();
      [stationA, stationB, stationC].forEach((s) =>
        stationManager.addStation(s),
      );

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
      const railBC = link(
        stationB,
        stationC,
        [1, 2, 2, 3, 3, 4, 5, 6, 7, 8],
        2,
      );

      const exec = new TrainExecution(net, player, stationA, stationC, 1);
      exec.init(game, 0);

      const seen: TileRef[] = [];
      for (let t = 1; t <= splitAt; t++) {
        exec.tick(t);
        seen.push(engineTile(game));
      }

      // Split B->C into B->D1 [1, 2], D1->D2 [2, 3] and D2->C [3..8], with the
      // train still inside the segment it is travelling.
      stationB.removeRailroad(railBC);
      stationC.removeRailroad(railBC);
      stationManager.addStation(stationD1);
      stationManager.addStation(stationD2);
      link(stationB, stationD1, [1, 2], 3);
      link(stationD1, stationD2, [2, 3], 4);
      link(stationD2, stationC, [3, 4, 5, 6, 7, 8], 5);

      for (let t = splitAt + 1; t <= 12 && exec.isActive(); t++) {
        exec.tick(t);
        if (exec.isActive()) seen.push(engineTile(game));
      }

      // Every tick after the split still moves two tiles along the original
      // route, whatever the recovery had to skip to get there.
      expect(seen).toEqual([1, 2, 3, 5, 7]);
      expect(exec.isActive()).toBe(false);
      // Recovery never credits a junction it skipped past: the train is not
      // stopping there, it already went by.
      expect(exec.tradeStopsVisited()).toBe(expectedTradeStops);
    },
  );
});
