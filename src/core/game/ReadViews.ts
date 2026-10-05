import {
  Gold,
  PlayerID,
  PlayerType,
  SamLauncherState,
  TerraNullius,
  UnitType,
} from "./Game";
import { GameMap, TileRef } from "./GameMap";
import { ReadonlyTileSet } from "./TileSet";
import { UnitPredicate } from "./UnitGrid";

/*
 * Read-only views of game state that rules code (Config, UnitGrid,
 * execution/Util) runs on. The engine's Player/Unit/Game and the client's
 * PlayerView/UnitView/GameView both satisfy them, so the same rules run on
 * either side without the rules importing the engine or the client.
 *
 * Each interface lists exactly the members rules code calls. Add a member
 * only when a rule needs it, and implement it on both sides.
 */

export interface PlayerLike {
  id(): PlayerID;
  smallID(): number;
  isPlayer(): boolean;
  type(): PlayerType;
  isLobbyCreator(): boolean;
  numTilesOwned(): number;
  troops(): number;
  gold(): Gold;
  units(type: UnitType): readonly UnitLike[];
}

export interface UnitLike {
  type(): UnitType;
  owner(): PlayerLike;
  tile(): TileRef;
  lastTile(): TileRef;
  isActive(): boolean;
  isUnderConstruction(): boolean;
  level(): number;
}

export interface GameLike extends GameMap {
  owner(ref: TileRef): PlayerLike | TerraNullius;
  anyUnitNearby(
    tile: TileRef,
    searchRange: number,
    types: readonly UnitType[],
    predicate: (unit: UnitLike) => boolean,
    playerId?: PlayerID,
    includeUnderConstruction?: boolean,
  ): boolean;
  nearbyUnits(
    tile: TileRef,
    searchRange: number,
    types: UnitType | readonly UnitType[],
    predicate?: UnitPredicate,
  ): Array<{ unit: UnitLike; distSquared: number }>;
}

/*
 * State only the engine tracks, read by rules the client never evaluates
 * (build costs, SAM range, MIRV targeting). The views don't carry it.
 */

export interface EnginePlayerLike extends PlayerLike {
  unitsOwned(type: UnitType): number;
  unitsConstructed(type: UnitType): number;
  borderTiles(): ReadonlyTileSet;
}

export interface EngineUnitLike extends UnitLike {
  samLauncherState(): SamLauncherState | undefined;
}

export interface EngineGameLike extends GameLike {
  mirvsLaunched(): number;
}
