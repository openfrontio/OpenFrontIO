import { vi, type Mocked } from "vitest";
import { UnitType } from "../../../src/core/game/Game";
import { Cluster, TrainStation } from "../../../src/core/game/TrainStation";

const createMockStation = (id: string): Mocked<TrainStation> => {
  return {
    id,
    unit: {
      type: vi.fn(() => UnitType.City),
    } as any,
    setCluster: vi.fn(),
    getCluster: vi.fn(() => null),
  } as any;
};

describe("Cluster tests", () => {
  let cluster: Cluster;
  let stationA: Mocked<TrainStation>;
  let stationB: Mocked<TrainStation>;
  let stationC: Mocked<TrainStation>;

  beforeEach(() => {
    cluster = new Cluster();
    stationA = createMockStation("A");
    stationB = createMockStation("B");
    stationC = createMockStation("C");
  });

  test("addStation adds a station and sets cluster", () => {
    cluster.addStation(stationA);

    expect(cluster.has(stationA)).toBe(true);
    expect(stationA.setCluster).toHaveBeenCalledWith(cluster);
  });

  test("removeStation removes station from cluster", () => {
    cluster.addStation(stationA);
    cluster.removeStation(stationA);

    expect(cluster.has(stationA)).toBe(false);
  });

  test("addStations adds multiple stations and sets cluster", () => {
    const set = new Set([stationA, stationB]);

    cluster.addStations(set);

    expect(cluster.has(stationA)).toBe(true);
    expect(cluster.has(stationB)).toBe(true);
    expect(stationA.setCluster).toHaveBeenCalledWith(cluster);
    expect(stationB.setCluster).toHaveBeenCalledWith(cluster);
  });

  test("merge combines stations from another cluster", () => {
    const otherCluster = new Cluster();
    otherCluster.addStation(stationB);
    otherCluster.addStation(stationC);

    cluster.addStation(stationA);
    cluster.merge(otherCluster);

    expect(cluster.has(stationA)).toBe(true);
    expect(cluster.has(stationB)).toBe(true);
    expect(cluster.has(stationC)).toBe(true);
  });

  test("has returns false for non-member stations", () => {
    expect(cluster.has(stationA)).toBe(false);
  });
});
