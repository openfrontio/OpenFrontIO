import {
  packEvents,
  unpackEvents,
} from "../../../../src/client/replay/codec/PackedEvents";

test("nuke impacts and dead units round-trip, tiles sorted", () => {
  const events = {
    nukeImpacts: [
      { tick: 300, land: [40_010, 4, 40_001], water: [] },
      { tick: 301, land: [], water: [7] },
    ],
    deadUnitEvents: [
      {
        tick: 301,
        unitId: 90_000,
        unitType: "Hydrogen Bomb",
        ownerSmallID: 511,
        pos: 3_999_999,
        reachedTarget: true,
      },
      {
        tick: 305,
        unitId: 2,
        unitType: "Transport",
        ownerSmallID: 1,
        pos: 0,
        reachedTarget: false,
      },
    ],
  };
  const back = unpackEvents(packEvents(events));
  events.nukeImpacts[0].land.sort((a, b) => a - b);
  expect(back).toEqual(events);
});
