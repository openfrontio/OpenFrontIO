// Minimal structural read-views of the core game objects. Engine logic that is
// also reused over the client's read-model (PlayerView / UnitView / GameView)
// accepts these instead of importing the concrete client classes — which would
// make the engine depend on the client. TypeScript is structural, so both the
// engine interfaces (Player/Unit/Game) and the client views satisfy these
// automatically, no `implements` needed.
//
// Self-referential members (owner(), units(), nearbyUnits()) are narrowed to
// the exact shape each call site reads, so the type doesn't drag in the full
// Player-vs-PlayerView / Unit-vs-UnitView distinction.
import { Player, type PlayerID, Unit } from "./Game";
import { GameMap, type TileRef } from "./GameMap";
import { UnitType } from "engine-public/game/GameTypes";

/** Player members read by Config gold/troop calculations. */
export type PlayerLike = Pick<
  Player,
  "isLobbyCreator" | "numTilesOwned" | "troops" | "type"
> & {
  units(...types: UnitType[]): Array<{
    isUnderConstruction(): boolean;
    level(): number;
  }>;
};

/**
 * Unit members read by UnitGrid. `owner()` is narrowed to just `id()` so the
 * type doesn't pull in the full Player vs PlayerView distinction.
 */
export type UnitLike = Pick<
  Unit,
  "tile" | "lastTile" | "type" | "isActive" | "isUnderConstruction"
> & {
  owner(): { id(): PlayerID };
};

/**
 * Game members read by the nuke/alliance check in execution/Util: it is passed
 * where a GameMap is expected and reads units' owner smallID via nearbyUnits.
 */
export type GameLike = GameMap & {
  nearbyUnits(
    tile: TileRef,
    searchRange: number,
    types: readonly UnitType[] | UnitType,
  ): Array<{ unit: { owner(): { smallID(): number } }; distSquared: number }>;
  anyUnitNearby(
    tile: TileRef,
    searchRange: number,
    types: readonly UnitType[],
    predicate: (unit: {
      owner(): { isPlayer(): boolean; smallID(): number };
    }) => boolean,
  ): boolean;
};
