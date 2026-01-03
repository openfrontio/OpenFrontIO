import { UnitType } from "../../core/game/Game";
import { TileRef } from "../../core/game/GameMap";

export interface UIState {
  attackRatio: number;
  ghostStructure: UnitType | null;
  rocketDirectionUp: boolean;
  lockedGhostTile: TileRef | null;
  overGhostControls: boolean;
}
