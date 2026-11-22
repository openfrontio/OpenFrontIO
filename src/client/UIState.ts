import { PlayerBuildableUnitType } from "@openfront/engine-api/game/GameTypes";

export interface UIState {
  preventStacking?: boolean;
  attackRatio: number;
  ghostStructure: PlayerBuildableUnitType | null;
  rocketDirectionUp: boolean;
  upgradeMultiplier: number;
  /**
   * AIR update: aircraft are selected, so a click on the map is an order
   * for them (WarshipSelectionController), not a ground attack.
   */
  aircraftSelected?: boolean;
}
