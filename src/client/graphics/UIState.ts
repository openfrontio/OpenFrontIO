import { UnitType } from "../../core/game/Game";

export interface UIState {
  attackRatio: number;
  vassalSupportRatio?: number;
  ghostStructure: UnitType | null;
}
