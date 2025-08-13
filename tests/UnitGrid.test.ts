import { PlayerInfo, PlayerType, UnitType } from "../src/core/game/Game";
import { UnitGrid } from "../src/core/game/UnitGrid";
import { setup } from "./util/Setup";

async function checkRange(
  mapName: string,
  unitPosX: number,
  rangeCheck: number,
  range: number,
) {
  const game = await setup(mapName, { infiniteGold: true, instantBuild: true });
  const grid = new UnitGrid(game.map());
  const player = game.addPlayer(
    new PlayerInfo("test_player", PlayerType.Human, null, "test_id"),
  );
  const unitTile = game.map().ref(unitPosX, 0);
  grid.addUnit(player.buildUnit("Defense Post", unitTile, {}));
  const tileToCheck = game.map().ref(rangeCheck, 0);
  return grid.hasUnitNearby(tileToCheck, range, "Defense Post", "test_id");
}

async function nearbyUnits(
  mapName: string,
  unitPosX: number,
  rangeCheck: number,
  range: number,
  unitTypes: readonly UnitType[],
) {
  const game = await setup(mapName, { infiniteGold: true, instantBuild: true });
  const grid = new UnitGrid(game.map());
  const player = game.addPlayer(
    new PlayerInfo("test_player", PlayerType.Human, null, "test_id"),
  );
  const unitTile = game.map().ref(unitPosX, 0);
  for (const unitType of unitTypes) {
    grid.addUnit(player.buildUnit(unitType, unitTile, {}));
  }
  const tileToCheck = game.map().ref(rangeCheck, 0);
  return grid.nearbyUnits(tileToCheck, range, unitTypes);
}

describe("Unit Grid range tests", () => {
  const hasUnitCases = [
    ["plains", 0, 10, 0, true], // Same spot
    ["plains", 0, 10, 10, true], // Exactly on the range
    ["plains", 0, 10, 11, false], // Exactly 1px outside
    ["big_plains", 0, 198, 42, true], // Inside huge range
    ["big_plains", 0, 198, 199, false], // Exactly 1px outside huge range
  ] as const;

  describe("Is unit in range", () => {
    test.each(hasUnitCases)(
      "on %p map, look if unit at position %p with a range of %p is in range of %p position, returns %p",
      async (
        mapName: string,
        unitPosX: number,
        range: number,
        rangeCheck: number,
        expectedResult: boolean,
      ) => {
        const result = await checkRange(mapName, unitPosX, rangeCheck, range);
        expect(result).toBe(expectedResult);
      },
    );
  });

  const unitsInRangeCases = [
    ["plains", 0, 10, 0, ["Warship"], 1], // Same spot
    ["plains", 0, 10, 0, ["City", "Port"], 2], // 2 in range
    ["plains", 0, 10, 0, [], 0], // no unit
    ["plains", 0, 10, 10, ["City"], 1], // Exactly on the range
    ["plains", 0, 10, 11, ["Defense Post"], 0], // 1px outside
    ["big_plains", 0, 198, 42, ["Trade Ship"], 1], // Inside huge range
    ["big_plains", 0, 198, 199, ["Transport Ship"], 0], // 1px outside
  ] as const;

  describe("Retrieve all units in range", () => {
    test.each(unitsInRangeCases)(
      "on %p map, look if unit at position %p with a range of %p is in range of %p position, returns %p",
      async (mapName, unitPosX, range, rangeCheck, units, expectedResult) => {
        const result = await nearbyUnits(
          mapName,
          unitPosX,
          rangeCheck,
          range,
          units, // remove readonly
        );
        expect(result.length).toBe(expectedResult);
      },
    );

    test("Wrong unit type in range", async () => {
      const game = await setup("plains", {
        infiniteGold: true,
        instantBuild: true,
      });
      const grid = new UnitGrid(game.map());
      const player = game.addPlayer(
        new PlayerInfo("test_player", PlayerType.Human, null, "test_id"),
      );
      const unitTile = game.map().ref(0, 0);
      grid.addUnit(player.buildUnit("City", unitTile, {}));
      const tileToCheck = game.map().ref(0, 0);
      expect(grid.nearbyUnits(tileToCheck, 10, ["Port"])).toHaveLength(0);
    });

    test("One inside, one outside of range", async () => {
      const game = await setup("plains", {
        infiniteGold: true,
        instantBuild: true,
      });
      const grid = new UnitGrid(game.map());
      const player = game.addPlayer(
        new PlayerInfo("test_player", PlayerType.Human, null, "test_id"),
      );
      const unitType = "City";
      const unitTile = game.map().ref(0, 0);
      grid.addUnit(player.buildUnit(unitType, unitTile, {}));
      const outsideTile = game.map().ref(99, 0);
      grid.addUnit(player.buildUnit(unitType, outsideTile, {}));
      const tileToCheck = game.map().ref(0, 0);
      expect(grid.nearbyUnits(tileToCheck, 10, [unitType])).toHaveLength(1);
    });
  });
});
