import { GameUpdates, NameViewData } from "../../core/game/Game";
import { TileRef } from "../../core/game/GameMap";
import { PlayerUpdate, UnitUpdate } from "../../core/game/GameUpdates";

export type TimelineRailroad = { id: number; tiles: TileRef[] };

export type TimelineTickRecord = {
  tick: number;
  packedTileUpdatesBuffer: ArrayBuffer;
  updates: GameUpdates;
  playerNameViewData: Record<string, NameViewData>;
};

export type TimelineCheckpointRecord = {
  tick: number;
  mapStateBuffer: ArrayBuffer;
  numTilesWithFallout: number;
  players: PlayerUpdate[];
  units: UnitUpdate[];
  playerNameViewData: Record<string, NameViewData>;
  toDeleteUnitIds: number[];
  railroads: TimelineRailroad[];
};
