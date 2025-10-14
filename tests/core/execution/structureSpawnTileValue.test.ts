import { structureSpawnTileValue } from "../../../src/core/execution/nation/structureSpawnTileValue";
import { Player, Relation, Unit, UnitType } from "../../../src/core/game/Game";
import { TileRef } from "../../../src/core/game/GameMap";

describe("structureSpawnTileValue", () => {
  const makeUnit = (tile: TileRef, unitType: UnitType = UnitType.City) => {
    const base = {
      tile: () => tile,
      level: () => 1,
      type: () => unitType,
    } satisfies Pick<Unit, "tile" | "level" | "type">;

    return base as Unit;
  };

  const createPlayer = (options?: { includePorts?: boolean }) => {
    const portUnits =
      options?.includePorts === false
        ? []
        : [makeUnit(70 as TileRef, UnitType.Port)];

    const unitsByType = new Map<UnitType, Array<ReturnType<typeof makeUnit>>>([
      [UnitType.City, [makeUnit(5 as TileRef, UnitType.City)]],
      [UnitType.Factory, [makeUnit(30 as TileRef, UnitType.Factory)]],
      [UnitType.Port, portUnits],
      [UnitType.MissileSilo, []],
    ]);

    const base = {
      borderTiles: () => new Set<TileRef>([0 as TileRef]),
      units: (...types: UnitType[]) => {
        if (types.length === 0) {
          return Array.from(unitsByType.values()).flat();
        }
        return types
          .flatMap((type) => unitsByType.get(type) ?? [])
          .map((unit) => unit as Unit);
      },
      unitsOwned: (_type: UnitType) => 0,
      relation: () => Relation.Hostile,
      smallID: () => 1,
      canBuild: (_type: UnitType, tile: TileRef) => tile,
    } satisfies Pick<
      Player,
      | "borderTiles"
      | "units"
      | "unitsOwned"
      | "relation"
      | "smallID"
      | "canBuild"
    >;

    return base as unknown as Player;
  };

  const createGame = () => {
    const config = {
      nukeMagnitudes: () => ({ outer: 10 }),
      defaultSamRange: () => 100,
    };

    return {
      config: () => config,
      magnitude: () => 0,
      manhattanDist: (a: TileRef, b: TileRef) =>
        Math.abs((a as number) - (b as number)),
    } as unknown as import("../../../src/core/game/Game").Game;
  };

  it("awards additional weight when a city is placed near complementary structures", () => {
    const game = createGame();

    const playerWithPorts = createPlayer();
    const playerWithoutPorts = createPlayer({ includePorts: false });

    const tile = 40 as TileRef;

    const withPorts = structureSpawnTileValue(
      game,
      playerWithPorts,
      UnitType.City,
    )(tile);
    const withoutPorts = structureSpawnTileValue(
      game,
      playerWithoutPorts,
      UnitType.City,
    )(tile);

    expect(withPorts).toBeGreaterThan(withoutPorts);
  });
});
