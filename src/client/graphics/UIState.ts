import { UnitType } from "../../core/game/GameUpdates";

export interface UIState {
  attackRatio: number;
  ghostStructure: UnitType | null;
}
