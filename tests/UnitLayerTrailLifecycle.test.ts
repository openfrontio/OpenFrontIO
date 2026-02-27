import { describe, expect, it } from "vitest";
import { pruneInactiveTrails } from "../src/client/graphics/layers/TrailLifecycle";

describe("UnitLayer trail lifecycle helpers", () => {
  it("removes transport and nuke trails for inactive units", () => {
    const nukeTrails = new Map<number, number[]>([
      [10, [1, 2, 3]],
      [11, [4, 5]],
    ]);
    const transportTrails = new Map<number, { xy: number[] }>([
      [10, { xy: [1, 1, 2, 2] }],
      [12, { xy: [5, 5, 6, 6] }],
    ]);

    const result = pruneInactiveTrails(
      nukeTrails,
      transportTrails,
      (unitId) => unitId === 11,
    );

    expect(result).toEqual({ removedNukes: 1, removedTransport: 2 });
    expect(Array.from(nukeTrails.keys())).toEqual([11]);
    expect(transportTrails.size).toBe(0);
  });

  it("keeps all trails when units are active", () => {
    const nukeTrails = new Map<number, number[]>([[1, [1]]]);
    const transportTrails = new Map<number, { xy: number[] }>([
      [2, { xy: [0, 0, 1, 1] }],
    ]);

    const result = pruneInactiveTrails(
      nukeTrails,
      transportTrails,
      () => true,
    );

    expect(result).toEqual({ removedNukes: 0, removedTransport: 0 });
    expect(nukeTrails.size).toBe(1);
    expect(transportTrails.size).toBe(1);
  });
});
