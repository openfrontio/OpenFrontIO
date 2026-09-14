import { UnitType } from "../../../src/core/game/Game";
import { Cluster, TrainStation } from "../../../src/core/game/TrainStation";

const createStation = (id: number = 1): TrainStation => {
  const station = new TrainStation(
    { ticks: () => 0 } as any,
    {
      type: () => UnitType.City,
      owner: () => ({ canTrade: () => true }),
    } as any,
  );
  station.id = id;
  return station;
};

describe("Cluster tests", () => {
  let cluster: Cluster;
  let stationA: TrainStation;
  let stationB: TrainStation;
  let stationC: TrainStation;

  beforeEach(() => {
    cluster = new Cluster();
    stationA = createStation(1);
    stationB = createStation(2);
    stationC = createStation(3);
  });

  test("addStation adds station and sets cluster bidirectionally", () => {
    cluster.addStation(stationA);
    expect(cluster.has(stationA)).toBe(true);
    expect(stationA.getCluster()).toBe(cluster);
  });

  test("duplicate addStation is idempotent and preserves trade destination", () => {
    cluster.addStation(stationA);
    cluster.addStation(stationA);
    expect(cluster.has(stationA)).toBe(true);
    expect(stationA.getCluster()).toBe(cluster);
    expect(
      cluster.hasAnyTradeDestination({ canTrade: () => true } as any),
    ).toBe(true);
  });

  test("removeStation removes station from cluster", () => {
    cluster.addStation(stationA);
    cluster.removeStation(stationA);
    expect(cluster.has(stationA)).toBe(false);
  });

  test("addStations adds multiple stations and sets cluster", () => {
    cluster.addStations(new Set([stationA, stationB]));
    expect(cluster.has(stationA)).toBe(true);
    expect(cluster.has(stationB)).toBe(true);
    expect(stationA.getCluster()).toBe(cluster);
    expect(stationB.getCluster()).toBe(cluster);
  });

  test("merge combines stations from another cluster and migrates clusters", () => {
    const otherCluster = new Cluster();
    otherCluster.addStation(stationB);
    otherCluster.addStation(stationC);
    cluster.addStation(stationA);
    cluster.merge(otherCluster);
    expect(cluster.has(stationA)).toBe(true);
    expect(cluster.has(stationB)).toBe(true);
    expect(cluster.has(stationC)).toBe(true);
    expect(stationB.getCluster()).toBe(cluster);
  });

  test("has returns false for non-member stations", () => {
    expect(cluster.has(stationA)).toBe(false);
  });
});
