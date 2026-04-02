import { describe, expect, test } from "vitest";
import { NukeTrajectoryPreviewLayer } from "../../../../src/client/graphics/layers/NukeTrajectoryPreviewLayer";
import { UnitType } from "../../../../src/core/game/Game";

function createLayer(isOcean: boolean) {
  return new NukeTrajectoryPreviewLayer(
    {
      config: () => ({
        samRange: () => 10,
      }),
      euclideanDistSquared: () => 25,
      isOcean: () => isOcean,
      myPlayer: () => ({
        isFriendly: () => false,
      }),
    } as any,
    {} as any,
    {} as any,
    {} as any,
  );
}

function mockWarship(level: number) {
  return {
    level: () => level,
    owner: () => ({
      isMe: () => false,
      smallID: () => 2,
    }),
    tile: () => 42,
    type: () => UnitType.Warship,
  };
}

describe("NukeTrajectoryPreviewLayer", () => {
  test("predicts interception by upgraded warships for sea targets", () => {
    const layer = createLayer(true) as any;

    expect(
      layer.canBeInterceptedByAirDefense(
        mockWarship(2),
        25,
        84,
        new Set<number>(),
      ),
    ).toBe(true);
  });

  test("ignores upgraded warships for land targets", () => {
    const layer = createLayer(false) as any;

    expect(
      layer.canBeInterceptedByAirDefense(
        mockWarship(2),
        25,
        84,
        new Set<number>(),
      ),
    ).toBe(false);
  });
});
