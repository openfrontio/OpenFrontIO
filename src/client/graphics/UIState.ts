import { PlayerBuildableUnitType } from "../../core/game/Game";

export interface UIState {
  attackRatio: number;
  ghostStructure: PlayerBuildableUnitType | null;
  overlappingRailroads: number[];
  rocketDirectionUp: boolean;
}
