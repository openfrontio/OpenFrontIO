import { UnitType } from "../../core/game/Game";

export interface UIState {
  attackRatio: number;
  ghostStructure: UnitType | null;
}
